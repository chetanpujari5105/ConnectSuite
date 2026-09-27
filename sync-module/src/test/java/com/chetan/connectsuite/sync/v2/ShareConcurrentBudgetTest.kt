package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Candidate
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Readings
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Refusal
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The PROPOSED concurrent-copy budget, at the SM-S938B's supervised reading (2026-09-26 10:14:15):
 * quota 183,326,942 · own cache 634,880 · usable 22,683,615,232 · total 489,993,273,344. Every expected
 * number below was computed independently of the code (a separate script, exact integer arithmetic),
 * and the policy values are CANDIDATES passed in — none is a production constant.
 */
class ShareConcurrentBudgetTest {

    private val mib = 1_048_576L
    private val gib = 1_073_741_824L
    private val now = 1_790_397_855_204L

    /** f = 1/2, floor = 3% of T + 1 GiB, readings at most 5 s old — candidates, not approved values. */
    private val candidate = Candidate(quotaNumerator = 1, quotaDenominator = 2, floorPerMille = 30, floorExtraBytes = gib, maxReadingAgeMs = 5_000)

    /** The measured reading, with one 1 MiB copy already held (so the cache is 634,880 + 1 MiB). */
    private fun measured(
        held: Long = mib,
        quota: Long? = 183_326_942,
        ownCache: Long? = 634_880 + held,
        usable: Long? = 22_683_615_232,
        total: Long? = 489_993_273_344,
        readAt: Long = now,
    ) = Readings(quota, ownCache, held, usable, total, readAt)

    // ---- the proposed budget, exactly ------------------------------------------------------------

    @Test fun `at the measured reading the quota budget is 89,980,015 bytes and it is the binding one`() {
        // ⌊183,326,942 / 2⌋ = 91,663,471 − N 634,880 − Σ 1,048,576 = 89,980,015; Bs = 6,281,791,226.
        assertEquals(Verdict.Admit(89_980_015, 89_980_015, 6_281_791_226), ShareConcurrentBudget.admit(89_980_015, measured(), candidate, now))
    }

    @Test fun `one byte over the quota budget is refused, and names the quota`() {
        assertEquals(Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET), ShareConcurrentBudget.admit(89_980_016, measured(), candidate, now))
    }

    @Test fun `the space budget binds exactly at its own boundary`() {
        // A = H + 256 MiB + 1000 with H = ⌈3% of T⌉ + 1 GiB = 15,773,540,025: x + M(Σ+x) ≤ 268,435,456 + 1000 → x ≤ 1000.
        val r = measured(usable = 16_041_976_481)
        assertEquals(Verdict.Admit(1000, 89_980_015, 1000), ShareConcurrentBudget.admit(1000, r, candidate, now))
        assertEquals(Verdict.Refuse(Refusal.OVER_SPACE_BUDGET), ShareConcurrentBudget.admit(1001, r, candidate, now))
    }

    @Test fun `an unknown size is admitted with the smaller budget as the copy's limit`() {
        assertEquals(Verdict.Admit(89_980_015, 89_980_015, 6_281_791_226), ShareConcurrentBudget.admit(null, measured(), candidate, now))
    }

    @Test fun `this app's other cache shrinks the budget byte for byte`() {
        val more = measured(ownCache = 634_880 + mib + 10_000_000)
        assertEquals(Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET), ShareConcurrentBudget.admit(89_980_015 - 10_000_000 + 1, more, candidate, now))
        assertTrue(ShareConcurrentBudget.admit(89_980_015 - 10_000_000, more, candidate, now) is Verdict.Admit)
    }

    // ---- a file alone is the version-2 rule's, whatever the quota ----------------------------------

    @Test fun `a single large file is not governed by the concurrent budget — the version-2 rule decides`() {
        val oneGb = 1_000_000_000L
        assertEquals(Verdict.NotConcurrent, ShareConcurrentBudget.admit(oneGb, measured(held = 0, ownCache = 634_880), candidate, now))
        // Even with every reading missing: nothing here applies to a file alone.
        assertEquals(Verdict.NotConcurrent, ShareConcurrentBudget.admit(oneGb, Readings(null, null, 0, null, null, 0), candidate, now))
        // And the version-2 rule admits it against the measured free space (1 GB + 100 MB margin ≤ 22.68 GB).
        assertTrue(ShareStaging.preflight(oneGb, 22_683_615_232) is ShareStaging.Preflight.Go)
        assertTrue("control: 183 MB is not a size limit — the file is 5× the quota", oneGb > 183_326_942 * 5)
    }

    // ---- missing, impossible or stale readings fail closed ------------------------------------------

    @Test fun `each missing or impossible reading refuses with its own reason`() {
        fun why(r: Readings) = (ShareConcurrentBudget.admit(mib, r, candidate, now) as Verdict.Refuse).why
        assertEquals(Refusal.QUOTA_UNREADABLE, why(measured(quota = null)))
        assertEquals(Refusal.QUOTA_NOT_POSITIVE, why(measured(quota = 0)))
        assertEquals(Refusal.OWN_CACHE_UNREADABLE, why(measured(ownCache = null)))
        assertEquals(Refusal.OWN_CACHE_BELOW_KNOWN, why(measured(ownCache = mib - 1)))
        assertEquals(Refusal.USABLE_UNREADABLE, why(measured(usable = null)))
        assertEquals(Refusal.USABLE_UNREADABLE, why(measured(usable = -1)))
        assertEquals(Refusal.TOTAL_UNREADABLE, why(measured(total = null)))
        assertEquals(Refusal.TOTAL_UNREADABLE, why(measured(total = 0)))
        assertEquals(Refusal.HELD_INVALID, why(measured(held = -1)))
    }

    @Test fun `a reading exactly at the age bound is used, one millisecond older is stale, and one from the future is refused`() {
        assertTrue(ShareConcurrentBudget.admit(mib, measured(readAt = now - 5_000), candidate, now) is Verdict.Admit)
        assertEquals(Verdict.Refuse(Refusal.READING_STALE), ShareConcurrentBudget.admit(mib, measured(readAt = now - 5_001), candidate, now))
        assertEquals(Verdict.Refuse(Refusal.READING_FROM_THE_FUTURE), ShareConcurrentBudget.admit(mib, measured(readAt = now + 1), candidate, now))
    }

    @Test fun `an invalid candidate or size is refused rather than guessed at`() {
        fun cand(num: Long = 1, den: Long = 2, pm: Long = 30, extra: Long = gib, age: Long = 5_000) = Candidate(num, den, pm, extra, age)
        listOf(cand(den = 0), cand(num = 0), cand(num = 3, den = 2), cand(pm = 1001), cand(pm = -1), cand(extra = -1), cand(age = 0)).forEach {
            assertEquals(it.toString(), Verdict.Refuse(Refusal.CANDIDATE_INVALID), ShareConcurrentBudget.admit(mib, measured(), it, now))
        }
        assertEquals(Verdict.Refuse(Refusal.SIZE_INVALID), ShareConcurrentBudget.admit(-1, measured(), candidate, now))
    }

    @Test fun `overflow is a refusal, never a wrapped small number`() {
        val huge = Candidate(quotaNumerator = 3, quotaDenominator = 4, floorPerMille = 30, floorExtraBytes = gib, maxReadingAgeMs = 5_000)
        assertEquals(Verdict.Refuse(Refusal.ARITHMETIC_OVERFLOW), ShareConcurrentBudget.admit(mib, measured(quota = Long.MAX_VALUE), huge, now))
        assertEquals(Verdict.Refuse(Refusal.ARITHMETIC_OVERFLOW), ShareConcurrentBudget.admit(mib, measured(total = Long.MAX_VALUE), candidate, now))
    }

    // ---- while the copy runs ---------------------------------------------------------------------

    @Test fun `mid-copy, a quota that drops stops the copy, and the same written bytes continue when it holds`() {
        val w = 50_000_000L
        val cacheNow = 634_880 + mib + w
        // Control: quota unchanged → 39,980,015 bytes still to go.
        assertEquals(
            Verdict.Admit(w + 39_980_015, 39_980_015, 6_231_791_226),
            ShareConcurrentBudget.duringCopy(w, measured(ownCache = cacheNow, usable = 22_683_615_232 - w), candidate, now),
        )
        // The quota recomputed down to 100,000,000 → the budget is −1,683,456: stop.
        assertEquals(
            Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET),
            ShareConcurrentBudget.duringCopy(w, measured(quota = 100_000_000, ownCache = cacheNow, usable = 22_683_615_232 - w), candidate, now),
        )
    }

    @Test fun `mid-copy, a reading that vanishes or goes stale stops the copy, and free space at the floor stops it`() {
        val w = 5 * mib
        val cacheNow = 634_880 + mib + w
        assertEquals(Verdict.Refuse(Refusal.QUOTA_UNREADABLE), ShareConcurrentBudget.duringCopy(w, measured(quota = null, ownCache = cacheNow), candidate, now))
        assertEquals(Verdict.Refuse(Refusal.READING_STALE), ShareConcurrentBudget.duringCopy(w, measured(ownCache = cacheNow, readAt = now - 5_001), candidate, now))
        // A = H + M(Σ + w) − 1: one byte under what the written copy needs above the floor.
        assertEquals(
            Verdict.Refuse(Refusal.OVER_SPACE_BUDGET),
            ShareConcurrentBudget.duringCopy(w, measured(ownCache = cacheNow, usable = 15_773_540_025 + 268_435_456 - 1), candidate, now),
        )
        // A cache reading that does not even contain what is known to be written is not believed.
        assertEquals(Verdict.Refuse(Refusal.OWN_CACHE_BELOW_KNOWN), ShareConcurrentBudget.duringCopy(w, measured(ownCache = mib + w - 1), candidate, now))
    }

    @Test fun `a copy alone stays the version-2 rule's while it runs, too`() {
        assertEquals(Verdict.NotConcurrent, ShareConcurrentBudget.duringCopy(900 * mib, measured(held = 0, ownCache = 634_880 + 900 * mib), candidate, now))
    }

    // ---- the measured readings are not a size limit, and nothing uses this yet --------------------

    @Test fun `the measured quota never limits a file alone - at any size, the version-2 rule decides`() {
        listOf(183_326_943L, 20_000_000_000L, 1_000_000_000_000L, Long.MAX_VALUE / 2).forEach { size ->
            assertEquals("size $size", Verdict.NotConcurrent, ShareConcurrentBudget.admit(size, measured(held = 0, ownCache = 634_880), candidate, now))
        }
        // 20 GB — 109× the quota — is admitted by the version-2 rule against the measured free space:
        // 20,000,000,000 + margin 2,000,000,000 = 22,000,000,000 ≤ 22,683,615,232.
        assertTrue(ShareStaging.preflight(20_000_000_000L, 22_683_615_232) is ShareStaging.Preflight.Go)
        // Control: the version-2 rule itself still refuses what does not fit, for its own reason (space).
        assertTrue(ShareStaging.preflight(21_000_000_000L, 22_683_615_232) is ShareStaging.Preflight.NoSpace)
    }

    /*
     * Was: "unwired — no production source uses the budget". Stage 1 (owner, 2026-09-26) wires it for
     * development only. Not loosened to "at most N users": each production user is named, with the one
     * question it answers — ShareAdmission decides with it; ShareBudgetReadings supplies its readings.
     * A third user fails here and has to say which question it answers.
     *
     * The third (2026-09-26, the BudgetStopped wording fix): ShareToMacCopy.kt answers *how is the
     * budget's refusal worded to a person?* It names the [ShareConcurrentBudget.Refusal] enum and
     * nothing else — it may not compute a budget, so the only form it may use is `ShareConcurrentBudget.Refusal`.
     *
     * The fourth (2026-09-27, Stage 2, development only): ShareManyQueue.kt answers *which reason is a
     * waiting file waiting for?* It carries the refusal [ShareAdmission.forCopy] returned into
     * `WaitReason.NoRoom`, unchanged, and decides through ShareAdmission — so it too may only name the enum.
     */
    @Test fun `wired in exactly two deciding sources, plus the sheet's wording, which only names the refusal reason`() {
        val root = listOf(File("."), File("..")).first { File(it, "sync-module").isDirectory }
        val code = { f: File -> f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "") }
        val sources = root.listFiles()!!.filter { File(it, "src").isDirectory }.flatMap { m ->
            listOf("main", "debug").map { File(m, "src/$it") }.filter { it.isDirectory }
                .flatMap { d -> d.walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }
        }
        assertTrue("control: the production sources were read", sources.any { it.name == "ShareFeature.kt" && code(it).contains("ShareOffer.respond(") })
        val users = sources.filter { it.name != "ShareConcurrentBudget.kt" && code(it).contains("ShareConcurrentBudget") }.map { it.name }
        assertEquals(listOf("ShareAdmission.kt", "ShareBudgetReadings.kt", "ShareManyQueue.kt", "ShareToMacCopy.kt"), users.sorted())
        for (name in listOf("ShareToMacCopy.kt", "ShareManyQueue.kt")) {
            val text = code(sources.single { it.name == name })
            val uses = Regex("ShareConcurrentBudget\\.?([A-Za-z]*)").findAll(text).map { it.groupValues[1] }.toSet()
            assertEquals("$name names the reason enum and calls nothing", setOf("Refusal"), uses - "")
        }
    }
}
