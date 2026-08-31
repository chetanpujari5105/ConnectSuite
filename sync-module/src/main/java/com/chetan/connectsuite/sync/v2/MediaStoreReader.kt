package com.chetan.connectsuite.sync.v2

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream

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
            )
        }

        LinkLog.i(
            "media",
            "media.buckets → ${buckets.size} buckets over $scanned items " +
                "in ${System.currentTimeMillis() - startedAt}ms",
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
        var failed = 0

        val thumbs = ids.map { rawId ->
            val id = rawId.toLongOrNull()
            if (id == null) {
                failed++
                return@map buildJsonObject {
                    put("id", rawId)
                    put("error", "BAD_REQUEST")
                }
            }
            val uri = ContentUris.withAppendedId(collection, id)
            val bitmap = runCatching {
                context.contentResolver.loadThumbnail(uri, Size(edge, edge), null)
            }.getOrNull()
            if (bitmap == null) {
                failed++
                return@map buildJsonObject {
                    put("id", rawId)
                    put("error", "NOT_FOUND")
                }
            }
            made++
            val bytes = ByteArrayOutputStream().use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
                out.toByteArray()
            }
            buildJsonObject {
                put("id", rawId)
                put("mime", "image/jpeg")
                put("width", bitmap.width)
                put("height", bitmap.height)
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
        }

        LinkLog.i("media", "media.thumb → $made made / $failed failed of ${ids.size} asked, maxEdge=$edge")
        return thumbs
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

    private const val JPEG_QUALITY = 80
}
