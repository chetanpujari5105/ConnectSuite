package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The half of `media.*` that has no Android in it: the cursor, the ordering, and the payload shapes.
 *
 * It is a separate object for the reason `CLAUDE.md` gives by name. A JVM unit test that merely
 * *references* an object holding an Android static in a field initializer dies with
 * `ExceptionInInitializerError` — `SmsStore` does, through `CONTENT_CONVERSATIONS_URI` — and the
 * answer is never `returnDefaultValues = true`, which makes every Android call in the module
 * silently return null. It is to move the pure part out, which is where `SmsPayloads` and
 * `CallWatcher.dispositionOf` came from. [MediaStoreReader] is the half that touches the provider,
 * and it is the only file in `media.*` that names a `MediaStore` symbol.
 *
 * ### The column names are literals here, deliberately
 *
 * Referencing `MediaStore.Files.FileColumns.BUCKET_ID` would drag the stub class into a JVM test and
 * defeat the split above. Each constant below names the platform constant it mirrors, and they are
 * safe to spell out because they are the provider's on-the-wire column names — public API values
 * that cannot change without breaking every app that has ever queried `MediaStore`. If one were
 * wrong the query would throw or return nothing, and the everything-cursor reading in
 * [listSelection] is what catches that on the first run rather than at a page boundary later.
 */
object MediaPayloads {

    /** `MediaStore.MediaColumns._ID`. */
    const val COL_ID = "_id"

    /** `MediaStore.MediaColumns.DATE_ADDED` — **in seconds**, which is the whole problem below. */
    const val COL_DATE_ADDED = "date_added"

    /** `MediaStore.MediaColumns.BUCKET_ID`. */
    const val COL_BUCKET_ID = "bucket_id"

    /** `MediaStore.MediaColumns.BUCKET_DISPLAY_NAME`. */
    const val COL_BUCKET_NAME = "bucket_display_name"

    /** `MediaStore.MediaColumns.MIME_TYPE`. */
    const val COL_MIME = "mime_type"

    /** `MediaStore.MediaColumns.SIZE`. */
    const val COL_SIZE = "_size"

    /** `MediaStore.MediaColumns.WIDTH`. */
    const val COL_WIDTH = "width"

    /** `MediaStore.MediaColumns.HEIGHT`. */
    const val COL_HEIGHT = "height"

    /** `MediaStore.MediaColumns.DURATION` — null for images. */
    const val COL_DURATION = "duration"

    /** `MediaStore.Files.FileColumns.MEDIA_TYPE`. */
    const val COL_MEDIA_TYPE = "media_type"

    /** `MediaStore.MediaColumns.RELATIVE_PATH`. */
    const val COL_RELATIVE_PATH = "relative_path"

    /** `MediaStore.MediaColumns.OWNER_PACKAGE_NAME`. */
    const val COL_OWNER = "owner_package_name"

    /** `MediaStore.MediaColumns.DISPLAY_NAME`. */
    const val COL_DISPLAY_NAME = "_display_name"

    /** `MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE`. */
    const val MEDIA_TYPE_IMAGE = 1

    /** `MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO`. */
    const val MEDIA_TYPE_VIDEO = 3

    /**
     * Newest first, then id descending — the `beforeId` decision from `docs/phase-5-proposals.md`.
     *
     * The tiebreaker is not decoration on this pager, it carries the common case. See
     * [listSelection].
     */
    const val ORDER_BY = "$COL_DATE_ADDED DESC, $COL_ID DESC"

    const val DEFAULT_LIMIT = 200
    const val MAX_LIMIT = 500
    const val MAX_THUMB_IDS = 32
    const val MAX_THUMB_EDGE = 512

    /** Only images and videos. Audio and documents live in the same table and are not this feature. */
    val VISUAL_MEDIA_TYPES = listOf(MEDIA_TYPE_IMAGE, MEDIA_TYPE_VIDEO)

    /**
     * A selection and its arguments, plus whether the cursor it encodes can skip rows.
     *
     * [lossy] is not cosmetic: it is the difference between a page boundary that is exact and one
     * that can drop everything sharing a second with the last item on the previous page. It is
     * carried out of here so the caller can log it, because a pager that silently degrades is
     * indistinguishable from one that works until someone counts.
     */
    data class Selection(
        val where: String,
        val args: List<String>,
        val lossy: Boolean,
    )

    /**
     * `DATE_ADDED` is in **seconds**; every timestamp on this wire is in milliseconds.
     *
     * Floor division rather than truncation so a pre-epoch value cannot round the wrong way. The
     * consequence is the reason `beforeId` exists here: converting a millisecond cursor back to
     * seconds puts *every row in that whole second* into the tie group, so a burst of camera frames
     * — which share a second by construction, not by bad luck — is spanned entirely by the id
     * tiebreak. On this pager the tiebreak carries the common path, not an edge case.
     */
    fun secondsOf(millis: Long): Long = Math.floorDiv(millis, 1000L)

    /**
     * The `WHERE` for one page of one bucket.
     *
     * Reading the shapes it can return, because each is a different claim:
     *
     *  - **No cursor at all** (`beforeMs == null`) — the first page, and also the diagnostic whose
     *    correct answer is *everything*. A `media.list` with no `before` must return the bucket's
     *    whole count across its pages; if it returns zero, the selection never ran, and no wrong
     *    cursor *value* can produce that. Send it first.
     *  - **Cursor with `beforeId`** — exact. `(date_added < s) OR (date_added = s AND _id < id)`
     *    advances inside a shared second, which a bare timestamp cannot do.
     *  - **Cursor without `beforeId`** — `date_added < s`, and [Selection.lossy] is true. This skips
     *    the rest of the second the previous page ended in. It exists only so a Mac that has not
     *    been updated still pages instead of looping forever; it is not the shape our own client
     *    sends.
     *
     * Arguments are **bound**, not inlined. That is the opposite of `SmsStore.threads`, and the
     * difference is not a preference: `content://mms-sms/conversations` is a union view that
     * answers a bound argument with an empty cursor (defect 50), while `MediaStore.Files` is an
     * ordinary table. Which of those is true here is a question about this provider, so it is
     * settled by running the everything-cursor through the app's own client, never through
     * `adb shell content query` — the shell inlines its literal and would be answering a different
     * question.
     */
    /**
     * **Defect 89.** Samsung Gallery "deletes" a photo by moving it under `Android/.Trash/<its package>/`
     * rather than using `MediaStore`'s own trash, so `IS_TRASHED` is empty on this handset and the
     * person's deleted photographs appeared as an ordinary album. Excluded from every listing here.
     */
    const val TRASH_PATH_PREFIX = "Android/.Trash/"

    fun isTrashPath(relativePath: String?): Boolean =
        relativePath != null && relativePath.startsWith(TRASH_PATH_PREFIX, ignoreCase = true)

    /**
     * The trash exclusion as SQL. A **literal**, never a bound argument (defect 50: a provider can answer a
     * bound argument with an empty cursor), and `IS NULL` first because `NULL NOT LIKE …` is NULL, which
     * would silently drop every row with no relative path.
     */
    const val NOT_TRASH_CLAUSE = "($COL_RELATIVE_PATH IS NULL OR $COL_RELATIVE_PATH NOT LIKE 'Android/.Trash/%')"

    fun listSelection(bucketId: String?, beforeMs: Long?, beforeId: Long?): Selection {
        val clauses = mutableListOf<String>()
        val args = mutableListOf<String>()

        clauses += "$COL_MEDIA_TYPE IN (${VISUAL_MEDIA_TYPES.joinToString(",")})"
        clauses += NOT_TRASH_CLAUSE

        if (bucketId != null) {
            clauses += "$COL_BUCKET_ID = ?"
            args += bucketId
        }

        val cursor = cursorOf(beforeMs, beforeId)
        when (cursor) {
            is Cursor.None -> Unit
            is Cursor.TimestampOnly -> {
                clauses += "$COL_DATE_ADDED < ?"
                args += cursor.seconds.toString()
            }
            is Cursor.TimestampAndId -> {
                clauses += "($COL_DATE_ADDED < ? OR ($COL_DATE_ADDED = ? AND $COL_ID < ?))"
                args += cursor.seconds.toString()
                args += cursor.seconds.toString()
                args += cursor.id.toString()
            }
        }

        return Selection(clauses.joinToString(" AND "), args, cursor is Cursor.TimestampOnly)
    }

    /**
     * What a cursor *means*, decided once and rendered twice.
     *
     * The SQL in [listSelection] and the in-memory answer in [isBeyond] both switch on this, so
     * they cannot disagree about where a page boundary falls — and a test that pages over rows in
     * memory is exercising the same decision the provider is given, rather than a second copy of
     * the rule that can drift from it. Dropping the id tiebreak means changing this function, and
     * both the query and the boundary test change with it. That is the difference between a test
     * that can fail and one that only looks like evidence.
     */
    sealed interface Cursor {
        object None : Cursor
        data class TimestampOnly(val seconds: Long) : Cursor
        data class TimestampAndId(val seconds: Long, val id: Long) : Cursor
    }

    fun cursorOf(beforeMs: Long?, beforeId: Long?): Cursor = when {
        beforeMs == null -> Cursor.None
        beforeId == null -> Cursor.TimestampOnly(secondsOf(beforeMs))
        else -> Cursor.TimestampAndId(secondsOf(beforeMs), beforeId)
    }

    /** True when a row sorts strictly after [cursor] under [ORDER_BY] — the query's own predicate. */
    fun isBeyond(cursor: Cursor, rowSeconds: Long, rowId: Long): Boolean = when (cursor) {
        is Cursor.None -> true
        is Cursor.TimestampOnly -> rowSeconds < cursor.seconds
        is Cursor.TimestampAndId ->
            rowSeconds < cursor.seconds || (rowSeconds == cursor.seconds && rowId < cursor.id)
    }

    /** `image` or `video`, from the row's media type, falling back to its MIME prefix. */
    fun kindOf(mediaType: Int?, mime: String?): String = when {
        mediaType == MEDIA_TYPE_VIDEO -> "video"
        mediaType == MEDIA_TYPE_IMAGE -> "image"
        mime?.startsWith("video/") == true -> "video"
        else -> "image"
    }

    /**
     * The package id in a media path, or null — the machine handle half of the package-id rule.
     *
     * `Android/media/com.whatsapp/WhatsApp Images/` yields `com.whatsapp`. The label is resolved by
     * the caller through `AppLabels.of`, always, including when it fails, so the fallback is
     * *counted* rather than a raw id being interpolated somewhere that never asks.
     *
     * Deliberately narrow: it matches only a segment under `Android/media` or `Android/data`, and
     * only one that looks like a package id. A folder a person named `com.something` in their own
     * `Pictures` is not an app-owned bucket, and inventing an app name for it would be the
     * package-id rule producing exactly the sentence it exists to prevent.
     */
    fun packageSegmentOf(relativePath: String?): String? {
        val segments = relativePath?.trim('/')?.split('/')?.filter { it.isNotBlank() } ?: return null
        if (segments.size < 3) return null
        if (!segments[0].equals("Android", ignoreCase = true)) return null
        if (segments[1] !in setOf("media", "data", "obb")) return null
        return segments[2].takeIf { looksLikePackageId(it) }
    }

    private fun looksLikePackageId(segment: String): Boolean {
        if (!segment.contains('.')) return false
        val parts = segment.split('.')
        if (parts.size < 2) return false
        return parts.all { part ->
            part.isNotEmpty() && part.first().isLetter() && part.all { it.isLetterOrDigit() || it == '_' }
        }
    }

    /**
     * One `media.list` item.
     *
     * `dateMs` is milliseconds on the wire even though the column is seconds — the conversion
     * happens once, here, so no other layer has to remember which unit it is holding.
     */
    fun item(
        id: Long,
        kind: String,
        mime: String?,
        size: Long,
        width: Int?,
        height: Int?,
        dateAddedSeconds: Long,
        durationMs: Long?,
        ownerPackage: String?,
        ownerAppName: String?,
    ): JsonObject = buildJsonObject {
        put("id", id.toString())
        put("kind", kind)
        put("mime", mime ?: "application/octet-stream")
        put("size", size)
        put("width", width)
        put("height", height)
        put("dateMs", dateAddedSeconds * 1000L)
        put("durationMs", durationMs)
        if (ownerPackage != null) {
            put("ownerPackage", ownerPackage)
            // The label goes on the wire beside the handle, never instead of it and never alone.
            // AppLabels.of returns the package id as its honest fallback, so this is non-null
            // whenever ownerPackage is.
            put("ownerAppName", ownerAppName ?: ownerPackage)
        }
    }

    /** One `media.buckets` bucket. */
    fun bucket(
        bucketId: String,
        bucketName: String,
        count: Int,
        newestSeconds: Long,
        coverId: Long,
        packageName: String?,
        appName: String?,
        /** The folder, as `MediaStore` names it — the only thing that tells same-named albums apart (defect 89). */
        relativePath: String? = null,
    ): JsonObject = buildJsonObject {
        put("bucketId", bucketId)
        put("bucketName", bucketName)
        put("count", count)
        put("newestMs", newestSeconds * 1000L)
        put("coverId", coverId.toString())
        if (packageName != null) {
            put("packageName", packageName)
            put("appName", appName ?: packageName)
        }
        if (relativePath != null) put("relativePath", relativePath)
    }
}
