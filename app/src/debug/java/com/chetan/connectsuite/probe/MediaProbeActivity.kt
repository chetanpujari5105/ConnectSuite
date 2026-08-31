package com.chetan.connectsuite.probe

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.v2.MediaFeature
import com.chetan.connectsuite.sync.v2.MediaPayloads
import com.chetan.connectsuite.sync.v2.MediaStoreReader
import kotlinx.serialization.json.jsonPrimitive
import kotlin.concurrent.thread

/**
 * Pages `media.list` on hardware through **the app's own client**, and counts what comes back.
 *
 * Debug-only, beside the other two probes, for the same reason: it exists to settle a claim and
 * must not ship.
 *
 * ### Why this and not `adb shell content query`
 *
 * Because that is the mistake defect 50 is made of. The shell **inlines its literal** where this
 * app **binds a `?`**, so a provider that ignores bound arguments answers the shell with rows and
 * the app with an empty cursor, and every layer reports the truth about a query that never ran.
 * This probe issues the query through `MediaStoreReader`, which is the same `ContentResolver` call,
 * the same bound arguments and the same selection string the `media.list` handler uses — so what it
 * exercises is the product's client, not a lookalike.
 *
 * What it does **not** cover is stated rather than glossed: the control channel, the envelope and
 * the handler sit above this and are not exercised here. Slice 3 gives the Mac a client and owes
 * that half.
 *
 * ### The three readings, in the order they must be taken
 *
 *  1. **Permissions**, logged first, whatever they are. A page count with no grant state beside it
 *     cannot be told from a page count against an empty provider.
 *  2. **The everything-cursor.** A cursor above the newest row must return every row. A wrong
 *     cursor *value* cannot return zero — only a selection that never ran can — so this separates
 *     "the cursor is wrong" from "the selection is dead" before any tuning, and it costs one query.
 *  3. **Consecutive pages, counted.** Not the first page returning rows, which is what defect 32's
 *     record forbids: the running total after each page, every entry distinct, against the
 *     denominator `media.buckets` already published for that bucket.
 *
 * Run: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.MediaProbeActivity --ei limit 50`
 * Read: `adb logcat -s MediaProbe:V`
 */
class MediaProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val limit = intent.getIntExtra("limit", 50)
        val bucket = intent.getStringExtra("bucket")
        Log.i(TAG, "--- media probe start; targetSdk=${applicationInfo.targetSdkVersion} limit=$limit ---")
        Log.i(TAG, "PERMISSION: photos read granted=${MediaFeature.granted(this)}")

        thread(name = "media-probe") {
            runCatching { probe(limit, bucket) }
                .onFailure { Log.e(TAG, "probe failed", it) }
            finish()
        }
    }

    private fun probe(limit: Int, wantedBucket: String?) {
        val buckets = MediaStoreReader.buckets(this)
        if (buckets.isEmpty()) {
            Log.w(TAG, "BUCKETS: none. Either nothing is granted or this phone holds no media.")
            return
        }
        buckets.take(12).forEach { bucket ->
            Log.i(
                TAG,
                "BUCKET ${bucket.str("bucketId")} name=${bucket.str("bucketName")} " +
                    "count=${bucket.str("count")} newestMs=${bucket.str("newestMs")} " +
                    "pkg=${bucket.str("packageName") ?: "-"} app=${bucket.str("appName") ?: "-"}",
            )
        }

        val largest = wantedBucket?.let { id -> buckets.firstOrNull { it.str("bucketId") == id } }
            ?: buckets.maxByOrNull { it.str("count")?.toIntOrNull() ?: 0 }!!
        val bucketId = largest.str("bucketId")!!
        val declared = largest.str("count")?.toIntOrNull() ?: 0
        Log.i(TAG, "PAGING bucket=$bucketId (${largest.str("bucketName")}), declared count=$declared")

        // Reading 2 — the parameter whose correct answer is "everything". A cursor a year past the
        // newest row must return the newest row. Zero here would mean the selection never ran.
        val future = System.currentTimeMillis() + 365L * 24 * 60 * 60 * 1000
        val everything = MediaStoreReader.list(this, bucketId, limit, future, Long.MAX_VALUE)
        Log.i(
            TAG,
            "EVERYTHING-CURSOR: before=$future beforeId=Long.MAX → ${everything.items.size} items, " +
                "hasMore=${everything.hasMore}. Zero here means the selection never ran, not that " +
                "the cursor value is wrong.",
        )

        // Reading 3 — consecutive pages, counted, with the running total after each.
        val seen = LinkedHashSet<String>()
        var before: Long? = null
        var beforeId: Long? = null
        var pages = 0
        var duplicates = 0
        // Rows on the far side of a boundary that share the previous page's last second. These are
        // precisely the rows a bare-millisecond cursor would have skipped, so this number is the
        // hardware measure of what the id tiebreak is holding on to. Zero would mean the pager was
        // never asked the question this cursor exists to answer.
        var rescuedByTiebreak = 0
        var boundariesInsideATieGroup = 0
        var previousLastDateMs: Long? = null

        while (pages < MAX_PAGES) {
            val page = MediaStoreReader.list(this, bucketId, limit, before, beforeId)
            if (page.items.isEmpty()) {
                Log.i(TAG, "PAGE ${pages + 1}: empty, stopping. running total=${seen.size}")
                break
            }
            pages++
            previousLastDateMs?.let { boundary ->
                val shared = page.items.count { it.str("dateMs")!!.toLong() == boundary }
                if (shared > 0) {
                    boundariesInsideATieGroup++
                    rescuedByTiebreak += shared
                }
            }
            val newThisPage = page.items.count { seen.add(it.str("id")!!) }
            duplicates += page.items.size - newThisPage
            val last = page.items.last()
            previousLastDateMs = last.str("dateMs")!!.toLong()
            before = last.str("dateMs")!!.toLong()
            beforeId = last.str("id")!!.toLong()
            Log.i(
                TAG,
                "PAGE $pages: ${page.items.size} items ($newThisPage new, ${page.items.size - newThisPage} " +
                    "repeated) → running total ${seen.size} of $declared; hasMore=${page.hasMore}; " +
                    "next cursor before=$before beforeId=$beforeId; scanned=${page.scanned}",
            )
            if (!page.hasMore) break
        }

        // Why it stopped matters as much as where it stopped. A run that hits the page cap has
        // proven the pager advances and has proven **nothing** about the total, and printing
        // `match=false` for that would be the probe reporting its own limit as a defect.
        val exhausted = pages < MAX_PAGES
        Log.i(
            TAG,
            "RESULT: $pages pages, ${seen.size} distinct ids, $duplicates repeats, " +
                "declared count=$declared, stopped=" + (if (exhausted) "exhausted" else "page cap") +
                ", boundaries inside a tie group=$boundariesInsideATieGroup " +
                "(rows a bare-ms cursor would have dropped: $rescuedByTiebreak)" +
                ", sums=" + (if (!exhausted) "not tested — capped at $MAX_PAGES pages"
                    else if (seen.size == declared) "yes, ${seen.size} == $declared"
                    else "NO, ${seen.size} != $declared"),
        )
    }

    private fun kotlinx.serialization.json.JsonObject.str(key: String): String? =
        this[key]?.jsonPrimitive?.content

    private companion object {
        const val TAG = "MediaProbe"
        const val MAX_PAGES = 2000
    }
}
