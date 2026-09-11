package com.chetan.connectsuite.probe

import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.provider.Telephony
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.v2.SmsFeature
import com.chetan.connectsuite.sync.v2.SmsStore
import kotlinx.serialization.json.jsonPrimitive
import kotlin.concurrent.thread

/**
 * Defect 50 on hardware: **does `content://mms-sms/conversations` honour a _bound_ selection?**
 *
 * Debug-only, beside the other six probes, for the same reason: it exists to settle a claim and
 * must not ship.
 *
 * ### Why this exists at all
 *
 * Defect 50 has been carried as `unknown, single-device` for a week on a **provenance argument** —
 * the moto runs a stock `TelephonyProvider.apk` where the SM-S938B runs Samsung's
 * `SecTelephonyProvider.apk`, so the quirk "must" be Samsung's. `docs/single-device-audit.md` §2's
 * own rule says a package name is not provenance, and the inverse holds: **a stock path is not a
 * promise of stock behaviour.** No instrument for the behavioural reading has ever existed. This is
 * it.
 *
 * ### The reading is NOT "do consecutive pages work"
 *
 * That distinction has been fudged and it is the reason this is still open. There are **two**
 * questions and only one of them is defect 50:
 *
 *  - **A. The provider question (defect 50).** Given a selection that should match everything, does
 *    the *bound* form return rows? The product no longer asks this — `SmsStore.threads` inlines the
 *    literal, which *is* the fix — so only a probe can ask it. Reading A is [readingA].
 *  - **B. The pager question (N4).** Do consecutive pages advance and not repeat? That exercises the
 *    **fixed** query and would pass on a device where the bound form is broken. Passing B says
 *    nothing whatever about A. Reading B is [readingB].
 *
 * A run that takes only B and reports "defect 50 resolved" is the third variety of untestable test
 * in `CLAUDE.md`: the right call, at a layer the defect is not in.
 *
 * ### Reading A's shape — three queries, one of which is the denominator
 *
 * `CLAUDE.md`'s diagnostic: **pass a parameter whose correct answer is "everything".** A cursor
 * above the newest row must return every row, so a *wrong value* cannot produce zero — only a
 * selection that never ran can.
 *
 *  | # | selection | expected if the provider binds | expected if it does not |
 *  |---|---|---|---|
 *  | A0 | `null` — **the denominator** | N | N |
 *  | A1 | `date < <literal>` inlined | N | N |
 *  | A2 | `date < ?` **bound** | N | **0** |
 *
 * A0 is what makes A2 a reading rather than a lookalike: without it, `0` is indistinguishable from
 * a phone with no messages, from an ungranted permission, and from a provider that refused. All
 * three produce exactly the same empty cursor.
 *
 * ### It reads no message content, and that is deliberate
 *
 * The g34 run declined this reading because taking it meant "paging a third party's real message
 * threads", which was not proportionate to the question. **The question does not need the
 * messages.** This probe reads row *counts*, thread *ids* and *dates* — never a body, never an
 * address, never a contact name — and logs no field that could identify a correspondent. That is
 * what makes it takeable on a handset whose owner is not the developer, and anyone widening it to
 * print a body has changed what consent was given for.
 *
 * Run:  `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.SmsProbeActivity --ei limit 50 --ei maxPages 40`
 * Read: `adb logcat -s SmsProbe:V`
 */
class SmsProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val limit = intent.getIntExtra("limit", 50)
        val maxPages = intent.getIntExtra("maxPages", 40)

        Log.i(TAG, "--- sms probe start; targetSdk=${applicationInfo.targetSdkVersion} " +
            "limit=$limit maxPages=$maxPages ---")

        // Logged FIRST and whatever it is. A page count with no grant state beside it cannot be
        // told from a page count against a provider that refused — the denominator rule.
        Log.i(TAG, "PERMISSION: sms granted=${SmsFeature.granted(this)}")
        Log.i(TAG, "PROVIDER: uri=$CONVERSATIONS")

        thread(name = "sms-probe") {
            runCatching {
                readingA()
                readingB(limit, maxPages)
            }.onFailure { Log.e(TAG, "probe failed", it) }
            Log.i(TAG, "--- sms probe end ---")
            finish()
        }
    }

    // ---- Reading A — the provider question, which is the whole of defect 50 -------------------

    private fun readingA() {
        Log.i(TAG, "=== READING A: does this provider honour a BOUND selection? ===")

        // "Everything." A value above the newest row, so the correct answer to A1 and A2 is the
        // same N that A0 returns. Chosen rather than Long.MAX_VALUE so the literal stays a
        // plausible date and cannot be dismissed as an overflow artefact; both were run and agree.
        val everything = System.currentTimeMillis() + 86_400_000L

        val a0 = countRows(selection = null, args = null, label = "A0 no selection (DENOMINATOR)")
        val a1 = countRows(
            selection = "date < $everything",
            args = null,
            label = "A1 inlined  date < $everything",
        )
        val a2 = countRows(
            selection = "date < ?",
            args = arrayOf(everything.toString()),
            label = "A2 BOUND    date < ?  [$everything]",
        )

        Log.i(TAG, "A RESULT: denominator=$a0  inlined=$a1  bound=$a2")

        when {
            a0 == null -> Log.w(
                TAG,
                "A VERDICT: NO READING — the denominator query itself failed or returned null. " +
                    "Nothing below it means anything; fix access before reading A2.",
            )
            a0 == 0 -> Log.w(
                TAG,
                "A VERDICT: NO READING — this phone reports 0 conversations with NO selection at " +
                    "all. An empty provider produces the same 0 as a dead selection, which is the " +
                    "exact lookalike A0 exists to exclude. Needs a device with messages.",
            )
            a2 == null -> Log.w(TAG, "A VERDICT: NO READING — the bound query threw rather than returning a cursor.")
            a2 == 0 && a1 == a0 ->
                Log.w(
                    TAG,
                    "A VERDICT: DEFECT 50 REPRODUCES. Bound selection returned 0 against a " +
                        "denominator of $a0, while the same predicate inlined returned $a1. The " +
                        "selection did not run; this is not a wrong cursor value.",
                )
            a2 == a0 && a1 == a0 ->
                Log.i(
                    TAG,
                    "A VERDICT: DEFECT 50 DOES NOT REPRODUCE. The bound form returned the full " +
                        "$a0 rows, so this provider binds arguments on this URI.",
                )
            else ->
                Log.w(
                    TAG,
                    "A VERDICT: UNEXPECTED — denominator=$a0 inlined=$a1 bound=$a2. Not the " +
                        "reproduce shape and not the clean shape. Record the three numbers and do " +
                        "not round them into either verdict.",
                )
        }
    }

    /** Row count for one selection, or null if the query failed. **No column is read.** */
    private fun countRows(selection: String?, args: Array<String>?, label: String): Int? {
        val startedAt = System.nanoTime()
        var cursor: Cursor? = null
        return try {
            cursor = contentResolver.query(CONVERSATIONS, null, selection, args, "date DESC")
            if (cursor == null) {
                Log.w(TAG, "$label -> NULL CURSOR (the provider refused outright)")
                null
            } else {
                var n = 0
                while (cursor.moveToNext()) n++
                val ms = (System.nanoTime() - startedAt) / 1_000_000
                Log.i(TAG, "$label -> $n rows, ${ms} ms, columns=${cursor.columnCount}")
                n
            }
        } catch (t: Throwable) {
            // The exception's TYPE is kept. `runCatching { }.getOrNull()` here would discard the
            // one thing that separates "refused" from "no such column" — defect 57's rule.
            Log.w(TAG, "$label -> THREW ${t.javaClass.simpleName}: ${t.message}")
            null
        } finally {
            cursor?.close()
        }
    }

    // ---- Reading B — the pager, through the product's own client ------------------------------

    private fun readingB(limit: Int, maxPages: Int) {
        Log.i(TAG, "=== READING B: consecutive pages through SmsStore.threads (the product path) ===")

        val seen = mutableSetOf<String>()
        var before: Long? = null
        var total = 0
        var page = 0
        var duplicates = 0
        var stopped = "exhausted"
        val startedAt = System.nanoTime()

        while (true) {
            if (page >= maxPages) { stopped = "page cap"; break }
            val pageStart = System.nanoTime()
            val (rows, hasMore) = SmsStore.threads(this, limit, before)
            val pageMs = (System.nanoTime() - pageStart) / 1_000_000
            page++

            if (rows.isEmpty()) { stopped = if (page == 1) "empty first page" else "empty page"; break }

            var newest: Long? = null
            var oldest: Long? = null
            rows.forEach { row ->
                val id = row["threadId"]?.jsonPrimitive?.content ?: "?"
                if (!seen.add(id)) duplicates++
                val d = row["dateMs"]?.jsonPrimitive?.content?.toLongOrNull()
                if (d != null) {
                    if (newest == null || d > newest!!) newest = d
                    if (oldest == null || d < oldest!!) oldest = d
                }
            }
            total += rows.size

            // Elapsed per page, beside the counts — defect 55's rule. A pager with no clock beside
            // it can pass every correctness check and still be unusable.
            Log.i(
                TAG,
                "PAGE $page: ${rows.size} rows, running total=$total, distinct=${seen.size}, " +
                    "duplicates=$duplicates, hasMore=$hasMore, ${pageMs} ms, before=$before",
            )

            if (!hasMore) { stopped = "exhausted"; break }
            if (oldest == null) { stopped = "no date to page on"; break }
            if (before != null && oldest!! >= before!!) { stopped = "cursor did not advance"; break }
            before = oldest
        }

        val totalMs = (System.nanoTime() - startedAt) / 1_000_000
        // Every bound the instrument imposed appears in what it reports.
        Log.i(
            TAG,
            "B RESULT: pages=$page total=$total distinct=${seen.size} duplicates=$duplicates " +
                "elapsed=${totalMs}ms stopped=$stopped (limit=$limit maxPages=$maxPages)",
        )
        when (stopped) {
            "page cap" -> Log.w(
                TAG,
                "B VERDICT: the pager advanced $page pages and the PROBE ended the run. " +
                    "sums=not tested — capped. This proves advancement and proves nothing " +
                    "about the total.",
            )
            "cursor did not advance" -> Log.w(
                TAG,
                "B VERDICT: STALLED — a page returned an oldest date not older than the cursor " +
                    "it was fetched with. That is the defect 50 stall shape seen from the pager end.",
            )
            "empty first page" -> Log.w(
                TAG,
                "B VERDICT: NO READING — page one was empty. Check reading A's denominator before " +
                    "concluding anything; an ungranted permission looks exactly like this.",
            )
            else -> Log.i(
                TAG,
                "B VERDICT: pager ran to $stopped over $page consecutive pages with " +
                    "$duplicates duplicate thread ids.",
            )
        }
        if (page < 2) {
            Log.w(
                TAG,
                "B CAVEAT: fewer than two pages were fetched, so this run does NOT satisfy the " +
                    "repo's precondition that a provider pager is recorded on CONSECUTIVE pages. " +
                    "Page one returning rows is not evidence.",
            )
        }
    }

    private companion object {
        const val TAG = "SmsProbe"
        val CONVERSATIONS: Uri = Telephony.MmsSms.CONTENT_CONVERSATIONS_URI
    }
}
