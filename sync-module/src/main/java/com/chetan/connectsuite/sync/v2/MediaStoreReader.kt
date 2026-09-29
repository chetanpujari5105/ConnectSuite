package com.chetan.connectsuite.sync.v2

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The half of `media.*` that touches the provider. Everything else is in [MediaPayloads].
 *
 * This is the only file in the feature that names a `MediaStore` symbol, which is what keeps
 * `MediaPayloads` testable on a plain JVM — see the note at the top of that file.
 *
 * Images and videos are read from **one** table, `MediaStore.Files`, filtered to the two media
 * types. Querying `Images.Media` and `Video.Media` separately would give two cursors that have to
 * be merged in memory to restore a single ordering, and a merged ordering is exactly where a cursor
 * loses rows at a page boundary. One table, one `ORDER BY`, one cursor.
 */
object MediaStoreReader {

    private val collection: Uri
        get() = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)

    /** What one `media.list` page came back with, plus what it took to get it. */
    data class Page(
        val items: List<JsonObject>,
        val hasMore: Boolean,
        val scanned: Int,
    )

    /**
     * Every bucket holding images or videos, newest first, counted.
     *
     * Aggregated **in memory** over one ordered scan rather than with a `GROUP BY`. `MediaStore`
     * strips a group-by appended to the sort order, and `QUERY_ARG_SQL_GROUP_BY` is honoured
     * unevenly across OEM providers — so this is the version whose behaviour does not depend on a
     * provider feature we would have to verify separately. The scan is ordered newest-first, so the
     * first row seen for a bucket is its newest, which is both the cover and `newestMs`.
     *
     * The count it produces is not decoration: it is the denominator `media.list`'s pages have to
     * sum to, and it is the only number on this feature that can tell a working pager from one that
     * stalls after its first page.
     */
    fun buckets(context: Context): List<JsonObject> {
        val startedAt = System.currentTimeMillis()
        val selection = MediaPayloads.listSelection(bucketId = null, beforeMs = null, beforeId = null)

        data class Aggregate(
            var name: String,
            var count: Int,
            val newestSeconds: Long,
            val coverId: Long,
            val relativePath: String?,
        )

        val byBucket = LinkedHashMap<String, Aggregate>()
        var scanned = 0
        var trashSeen = 0

        query(
            context,
            projection = arrayOf(
                MediaPayloads.COL_ID,
                MediaPayloads.COL_BUCKET_ID,
                MediaPayloads.COL_BUCKET_NAME,
                MediaPayloads.COL_DATE_ADDED,
                MediaPayloads.COL_RELATIVE_PATH,
            ),
            selection = selection,
            sortOrder = MediaPayloads.ORDER_BY,
        ) { cursor ->
            while (cursor.moveToNext()) {
                scanned++
                val bucketId = cursor.stringOf(MediaPayloads.COL_BUCKET_ID) ?: continue
                // The selection already excludes it; this is the second line, counted, not assumed.
                if (MediaPayloads.isTrashPath(cursor.stringOf(MediaPayloads.COL_RELATIVE_PATH))) { trashSeen++; continue }
                val existing = byBucket[bucketId]
                if (existing == null) {
                    byBucket[bucketId] = Aggregate(
                        name = cursor.stringOf(MediaPayloads.COL_BUCKET_NAME) ?: bucketId,
                        count = 1,
                        newestSeconds = cursor.longOf(MediaPayloads.COL_DATE_ADDED) ?: 0L,
                        coverId = cursor.longOf(MediaPayloads.COL_ID) ?: 0L,
                        relativePath = cursor.stringOf(MediaPayloads.COL_RELATIVE_PATH),
                    )
                } else {
                    existing.count++
                }
            }
        }

        val buckets = byBucket.map { (bucketId, aggregate) ->
            val packageName = MediaPayloads.packageSegmentOf(aggregate.relativePath)
            MediaPayloads.bucket(
                bucketId = bucketId,
                bucketName = aggregate.name,
                count = aggregate.count,
                newestSeconds = aggregate.newestSeconds,
                coverId = aggregate.coverId,
                packageName = packageName,
                appName = packageName?.let { AppLabels.of(context, it) },
                relativePath = aggregate.relativePath,
            )
        }

        LinkLog.i(
            "media",
            "media.buckets → ${buckets.size} buckets over $scanned items " +
                "in ${System.currentTimeMillis() - startedAt}ms; trash rows reaching the reader: $trashSeen (0 expected — the selection excludes them)",
        )
        return buckets
    }

    /**
     * One page of a bucket, newest first.
     *
     * [scanned] is reported beside the item count because they are different numbers and only their
     * ratio says whether the cursor is doing its job: a page that scans far more rows than it
     * returns is a selection that is not selecting.
     */
    fun list(
        context: Context,
        bucketId: String?,
        limit: Int,
        beforeMs: Long?,
        beforeId: Long?,
    ): Page {
        val capped = limit.coerceIn(1, MediaPayloads.MAX_LIMIT)
        val selection = MediaPayloads.listSelection(bucketId, beforeMs, beforeId)
        if (selection.lossy) {
            LinkLog.w(
                "media",
                "media.list paged with `before` and no `beforeId`: the boundary can skip rows " +
                    "sharing a second with the last item of the previous page. Send beforeId.",
            )
        }

        val items = mutableListOf<JsonObject>()
        var hasMore = false
        var scanned = 0

        query(
            context,
            projection = arrayOf(
                MediaPayloads.COL_ID,
                MediaPayloads.COL_MEDIA_TYPE,
                MediaPayloads.COL_MIME,
                MediaPayloads.COL_SIZE,
                MediaPayloads.COL_WIDTH,
                MediaPayloads.COL_HEIGHT,
                MediaPayloads.COL_DATE_ADDED,
                MediaPayloads.COL_DURATION,
                MediaPayloads.COL_OWNER,
            ),
            selection = selection,
            // No `LIMIT` in the sort order. Appending one works on API 29 and is not portable
            // above it — MediaStore parses the sort argument and rejects trailing tokens on some
            // versions — so the page is bounded by stopping the read, which is what `SmsStore`
            // does and what the cursor window makes cheap. `hasMore` is the row after the last one
            // taken, seen but not built.
            sortOrder = MediaPayloads.ORDER_BY,
        ) { cursor ->
            while (cursor.moveToNext()) {
                scanned++
                if (items.size == capped) {
                    hasMore = true
                    break
                }
                val id = cursor.longOf(MediaPayloads.COL_ID) ?: continue
                val owner = cursor.stringOf(MediaPayloads.COL_OWNER)
                items += MediaPayloads.item(
                    id = id,
                    kind = MediaPayloads.kindOf(
                        cursor.intOf(MediaPayloads.COL_MEDIA_TYPE),
                        cursor.stringOf(MediaPayloads.COL_MIME),
                    ),
                    mime = cursor.stringOf(MediaPayloads.COL_MIME),
                    size = cursor.longOf(MediaPayloads.COL_SIZE) ?: 0L,
                    width = cursor.intOf(MediaPayloads.COL_WIDTH),
                    height = cursor.intOf(MediaPayloads.COL_HEIGHT),
                    dateAddedSeconds = cursor.longOf(MediaPayloads.COL_DATE_ADDED) ?: 0L,
                    durationMs = cursor.longOf(MediaPayloads.COL_DURATION),
                    ownerPackage = owner,
                    ownerAppName = owner?.let { AppLabels.of(context, it) },
                )
            }
        }

        return Page(items, hasMore, scanned)
    }

    /**
     * Thumbnails for up to [MediaPayloads.MAX_THUMB_IDS] ids, base64 on the control channel.
     *
     * A failure is **per item**, never a failed ack: one deleted photo in a batch of 32 must not
     * lose the other 31. Both outcomes are counted on one line, because a batch that reports "4
     * errors" with no successes beside it reads as a broken feature and a batch that reports
     * nothing reads as a working one.
     */
    fun thumbs(context: Context, ids: List<String>, maxEdge: Int): List<JsonObject> {
        val edge = maxEdge.coerceIn(32, MediaPayloads.MAX_THUMB_EDGE)
        var made = 0
        var missing = 0
        var unrenderable = 0
        var bad = 0

        val thumbs = ids.map { rawId ->
            val id = rawId.toLongOrNull()
            if (id == null) {
                bad++
                return@map buildJsonObject {
                    put("id", rawId)
                    put("error", "BAD_REQUEST")
                }
            }
            val uri = ContentUris.withAppendedId(collection, id)
            val attempt = runCatching {
                context.contentResolver.loadThumbnail(uri, Size(edge, edge), null)
            }
            val bitmap = attempt.getOrNull()
            if (bitmap == null) {
                // **Defect 57.** `loadThumbnail` answers the same way for two different facts — the
                // row is gone, and the row is there over bytes that will not decode — and this used
                // to send `NOT_FOUND` for both. *"That photo is no longer on the phone"* is a lie
                // about the second one, and it is the lie that makes a person stop looking for a
                // file that is sitting right there.
                //
                // The discriminator is a existence query, which is cheap and only runs on the
                // failure path. `fs.thumb` has separated these since Phase 5 and this namespace is
                // adopting its vocabulary rather than inventing a third word.
                val stillThere = existsById(context, id)
                if (stillThere) {
                    unrenderable++
                    // Logged, with the cause. `getOrNull()` used to swallow the exception entirely,
                    // so the one branch that had something to say was the silent one.
                    LinkLog.w(
                        "media",
                        "media.thumb $rawId is present in MediaStore and could not be decoded",
                        attempt.exceptionOrNull(),
                    )
                    return@map buildJsonObject {
                        put("id", rawId)
                        put("error", "NO_THUMBNAIL")
                    }
                }
                missing++
                return@map buildJsonObject {
                    put("id", rawId)
                    put("error", "NOT_FOUND")
                }
            }
            // **Defect 136.** `loadThumbnail(Size)` returns *at least* the size asked on some providers
            // (640 × 480 and 453 × 806 for maxEdge 512, measured), so the bitmap is bounded here by the
            // one rule `fs.thumb` already uses — never a second copy of it — and the produced size is
            // what the ack reports.
            val thumb = FsThumbs.encode(bitmap, edge)
            if (thumb == null) {
                unrenderable++
                LinkLog.w("media", "media.thumb $rawId decoded but could not be encoded at maxEdge=$edge")
                return@map buildJsonObject {
                    put("id", rawId)
                    put("error", "NO_THUMBNAIL")
                }
            }
            made++
            buildJsonObject {
                put("id", rawId)
                put("mime", "image/jpeg")
                put("width", thumb.width)
                put("height", thumb.height)
                put("data", Base64.encodeToString(thumb.bytes, Base64.NO_WRAP))
            }
        }

        // Every outcome named, not summed. "4 failed" cannot be told from "4 photos deleted while
        // the grid was open", which is the ordinary case and not a fault at all.
        LinkLog.i(
            "media",
            "media.thumb → $made made / $missing gone / $unrenderable undecodable / $bad malformed-id " +
                "of ${ids.size} asked, maxEdge=$edge",
        )
        return thumbs
    }

    /**
     * Whether a `MediaStore` row with this id still exists.
     *
     * Only ever called on the thumbnail failure path, so the cost is paid per failed item rather
     * than per item. It asks for `_ID` alone: the question is existence, and reading columns nobody
     * needs is how a cheap query stops being cheap.
     *
     * A query that itself throws returns `false` — the honest answer when we cannot establish that
     * the row is there is not to claim it is.
     */
    private fun existsById(context: Context, id: Long): Boolean = runCatching {
        context.contentResolver.query(
            ContentUris.withAppendedId(collection, id),
            arrayOf(MediaStore.MediaColumns._ID),
            null,
            null,
            null,
        )?.use { it.moveToFirst() } ?: false
    }.getOrElse { failure ->
        LinkLog.w("media", "media.thumb could not establish whether id $id still exists", failure)
        false
    }

    private inline fun query(
        context: Context,
        projection: Array<String>,
        selection: MediaPayloads.Selection,
        sortOrder: String,
        body: (Cursor) -> Unit,
    ) {
        runCatching {
            context.contentResolver.query(
                collection,
                projection,
                selection.where,
                selection.args.toTypedArray(),
                sortOrder,
            )?.use(body) ?: LinkLog.w("media", "MediaStore returned no cursor at all for $sortOrder")
        }.onFailure { LinkLog.e("media", "MediaStore query failed", it) }
    }

    private fun Cursor.stringOf(column: String): String? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { if (isNull(it)) null else getString(it) }

    private fun Cursor.longOf(column: String): Long? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { if (isNull(it)) null else getLong(it) }

    private fun Cursor.intOf(column: String): Int? =
        getColumnIndex(column).takeIf { it >= 0 }?.let { if (isNull(it)) null else getInt(it) }

}
