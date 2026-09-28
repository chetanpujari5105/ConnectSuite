package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Readings
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Refusal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Stage 1 (development only): [ShareAdmission.forCopy] with the live per-copy budget supplied
 * (docs/feature-a-multi-offer-proposal.md rev 4 §4). The readings are synthetic and chosen so the
 * boundaries are exact; **no figure measured on a device appears here**. The claims:
 *
 * - below version 3, or with nothing held, the budget is never consulted — even with every reading
 *   missing — and the answer is exactly the version-2 preflight;
 * - at version 3 with copies held, the limit is `min(Bq, Bs, limitOver)`, a file of that size is
 *   admitted and one byte more is refused **with the measured limit**;
 * - a stale, future or missing reading refuses only the extra copy, and says no measurement was made;
 * - without readings the Stage A cap path is unchanged.
 */
class ShareAdmissionBudgetTest {

    private val mib = 1024L * 1024
    private val gib = 1024L * mib
    private val now = 1_000_000L
    private val held = 1 * mib

    /** Q = 200 MiB, nothing else in the cache, 40 GiB usable of 100 GiB: Bq = 100 MiB − Σ = 99 MiB, and Bq binds. */
    private fun readings(
        h: Long = held, quota: Long? = 200 * mib, ownCache: Long? = h, usable: Long? = 40 * gib,
        total: Long? = 100 * gib, readAt: Long = now,
    ) = Readings(quota, ownCache, h, usable, total, readAt)

    private var reads = 0
    private fun concurrent(r: (Long) -> Readings = { readings(it) }, at: Long = now) =
        ShareAdmission.Concurrent(read = { reads++; r(it) }, nowMs = { at })

    private val bq = 100 * mib - held // ⌊Q·½⌋ − N − Σ, N = 0

    private fun preflightAsCopy(expected: Long?, free: Long): ShareAdmission.Copy = when (val p = ShareStaging.preflight(expected, free)) {
        is ShareStaging.Preflight.Go -> ShareAdmission.Copy.Go(p.limit)
        is ShareStaging.Preflight.NoSpace -> ShareAdmission.Copy.NoSpace(p.expected, p.available, p.needed)
    }

    @Test fun `below version 3 the budget is never read, whatever is held`() {
        val never = ShareAdmission.Concurrent(read = { error("read below version 3") }, nowMs = { error("clock read below version 3") })
        for (version in listOf(0, 1, 2)) for (h in listOf(0L, held, 3 * gib)) for (expected in listOf(null, 100_718L, 30 * gib)) {
            assertEquals("v$version held=$h size=$expected", preflightAsCopy(expected, 40 * gib),
                ShareAdmission.forCopy(version, expected, h, 40 * gib, ShareAdmission.APPROVED_CAP, never))
        }
    }

    @Test fun `a file alone at version 3 is the version-2 preflight, even with every reading missing`() {
        val never = ShareAdmission.Concurrent(read = { error("read for a file alone") }, nowMs = { error("clock") })
        for (expected in listOf(null, 0L, 100_718L, 20 * gib, 39 * gib)) for (free in listOf(300 * mib, 40 * gib)) {
            assertEquals(preflightAsCopy(expected, free), ShareAdmission.forCopy(3, expected, 0, free, null, never))
        }
    }

    @Test fun `at version 3 with a copy held, exactly the measured limit is admitted and one byte more is refused with it`() {
        assertEquals(ShareAdmission.Copy.Go(bq), ShareAdmission.forCopy(3, bq, held, 40 * gib, null, concurrent()))
        assertEquals(
            ShareAdmission.Copy.OverBudget(held, bq + 1, bq, Refusal.OVER_QUOTA_BUDGET),
            ShareAdmission.forCopy(3, bq + 1, held, 40 * gib, null, concurrent()),
        )
        // Unknown size: admitted, bounded by the same limit, which the copy enforces.
        assertEquals(ShareAdmission.Copy.Go(bq), ShareAdmission.forCopy(3, null, held, 40 * gib, null, concurrent()))
    }

    @Test fun `the space budget binds when the floor does - one byte over it is refused with the measured limit`() {
        // Usable = floor + margin(Σ + x) + x exactly: H = the fixed 1 GiB reserve (Option B, 2026-09-29);
        // x = 50 MiB fits exactly under the floor.
        val x = 50 * mib
        val usable = 1 * gib + x + ShareStaging.margin(held + x)
        val c = concurrent({ readings(it, usable = usable) })
        assertEquals(ShareAdmission.Copy.Go(x), ShareAdmission.forCopy(3, x, held, 40 * gib, null, c))
        assertEquals(ShareAdmission.Copy.OverBudget(held, x + 1, x, Refusal.OVER_SPACE_BUDGET), ShareAdmission.forCopy(3, x + 1, held, 40 * gib, null, c))
    }

    @Test fun `the version-2 margin over everything held still bounds a budgeted copy`() {
        // free (what the sheet read) is far tighter than the readings' usable: limitOver binds.
        val free = 300 * mib
        val go = ShareAdmission.forCopy(3, null, held, free, null, concurrent()) as ShareAdmission.Copy.Go
        assertEquals(ShareAdmission.limitOver(held, free), go.limit)
        assertTrue("control: tighter than the budget", go.limit < bq)
    }

    @Test fun `readings exactly 5 s old are used, 5 s and 1 ms old refuse only the extra copy, unmeasured`() {
        assertTrue(ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, concurrent({ readings(it, readAt = now - 5_000) })) is ShareAdmission.Copy.Go)
        assertEquals(
            ShareAdmission.Copy.OverBudget(held, 1000, null, Refusal.READING_STALE),
            ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, concurrent({ readings(it, readAt = now - 5_001) })),
        )
        assertEquals(
            ShareAdmission.Copy.OverBudget(held, 1000, null, Refusal.READING_FROM_THE_FUTURE),
            ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, concurrent({ readings(it, readAt = now + 1) })),
        )
    }

    @Test fun `each missing reading refuses only the extra copy, names the reading, and states no limit`() {
        for ((why, r) in listOf(
            Refusal.QUOTA_UNREADABLE to { h: Long -> readings(h, quota = null) },
            Refusal.OWN_CACHE_UNREADABLE to { h: Long -> readings(h, ownCache = null) },
            Refusal.USABLE_UNREADABLE to { h: Long -> readings(h, usable = null) },
            Refusal.TOTAL_UNREADABLE to { h: Long -> readings(h, total = null) },
        )) {
            assertEquals("$why", ShareAdmission.Copy.OverBudget(held, 1000, null, why), ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, concurrent(r)))
            // Control: the same file alone is admitted by the version-2 rule with the same broken readings.
            assertTrue("$why alone", ShareAdmission.forCopy(3, 1000, 0, 40 * gib, null, concurrent(r)) is ShareAdmission.Copy.Go)
        }
    }

    @Test fun `the readings are asked for the bytes held for other offers, fresh on every call`() {
        var asked = -1L
        val c = ShareAdmission.Concurrent(read = { asked = it; reads++; readings(it) }, nowMs = { now })
        ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, c)
        ShareAdmission.forCopy(3, 1000, held, 40 * gib, null, c)
        assertEquals(held, asked)
        assertEquals("one read per admission, never cached", 2, reads)
    }

    @Test fun `without readings, version 3 is the Stage A cap path, unchanged`() {
        assertEquals(ShareAdmission.Copy.CapNotApproved(held), ShareAdmission.forCopy(3, 1000, held, 40 * gib, ShareAdmission.APPROVED_CAP))
        assertEquals(ShareAdmission.Copy.CapNotApproved(held), ShareAdmission.forCopy(3, 1000, held, 40 * gib, ShareAdmission.APPROVED_CAP, concurrent = null))
    }

    // ---- stopCopying: the re-check while a concurrent copy runs, and the facts it carries -------------

    /** During a copy the app's own cache holds Σ plus what this copy has written so far (N = 0). */
    private fun during(w: Long, quota: Long? = 200 * mib, usable: Long? = 40 * gib, readAt: Long = now) =
        concurrent({ readings(it, quota = quota, ownCache = it + w, usable = usable, readAt = readAt) })

    @Test fun `stopCopying - keeps going inside the budget, exactly at it, and never governs a file alone`() {
        assertNull(ShareAdmission.stopCopying(during(10 * mib), { held }, written = 10 * mib))
        assertNull("exactly at the budget", ShareAdmission.stopCopying(during(bq), { held }, written = bq))
        assertEquals("one byte past the budget", Refusal.OVER_QUOTA_BUDGET,
            ShareAdmission.stopCopying(during(bq + 1), { held }, written = bq + 1)?.why)
        // The other offers all ended (Σ = 0): no longer concurrent; the budget stops nothing and reads nothing.
        val never = ShareAdmission.Concurrent(read = { error("read for a copy no longer concurrent") }, nowMs = { error("clock") })
        assertNull(ShareAdmission.stopCopying(never, { 0L }, written = 30 * gib))
    }

    @Test fun `a quota that dropped mid-copy stops it with the reason and the measured room - never unmeasured`() {
        // Q fell to 20 MiB: ⌊20 MiB / 2⌋ − Σ − w = 10 − 1 − (9 MiB + 1) < 0. With the partial deleted the
        // room for this file is ⌊Q/2⌋ − Σ = 9 MiB exactly; space (40 GiB usable) does not bind.
        val w = 9 * mib + 1
        assertEquals(
            ShareAdmission.Stop(Refusal.OVER_QUOTA_BUDGET, held, 9 * mib),
            ShareAdmission.stopCopying(during(w, quota = 20 * mib), { held }, written = w),
        )
    }

    @Test fun `free space that fell mid-copy stops it with the reason and the measured room - never unmeasured`() {
        // H = the fixed 1 GiB reserve (Option B, 2026-09-29). Usable falls to H + M(Σ + w) − 1, so even x = 0
        // no longer fits.
        // With the partial's 10 MiB back in A the room is H + 256 MiB − 1 + 10 MiB, and the largest x with
        // x + M(Σ + x) ≤ 266 MiB − 1 is 10 MiB − 1 (the margin is its 256 MiB floor throughout).
        val w = 10 * mib
        val floor = 1 * gib
        val usable = floor + ShareStaging.margin(held + w) - 1
        assertEquals(256 * mib, ShareStaging.margin(held + w)) // control: the arithmetic above assumes the floor
        assertEquals(
            ShareAdmission.Stop(Refusal.OVER_SPACE_BUDGET, held, 10 * mib - 1),
            ShareAdmission.stopCopying(during(w, usable = usable), { held }, written = w),
        )
        // Control: one byte more of usable space and the same copy keeps going.
        assertNull(ShareAdmission.stopCopying(during(w, usable = usable + 1), { held }, written = w))
    }

    @Test fun `only a missing or stale reading is unmeasured, and it still names the reading`() {
        val w = 10 * mib
        assertEquals(ShareAdmission.Stop(Refusal.READING_STALE, held, null),
            ShareAdmission.stopCopying(during(w, readAt = now - 5_001), { held }, written = w))
        assertEquals(ShareAdmission.Stop(Refusal.QUOTA_UNREADABLE, held, null),
            ShareAdmission.stopCopying(during(w, quota = null), { held }, written = w))
        assertEquals(ShareAdmission.Stop(Refusal.USABLE_UNREADABLE, held, null),
            ShareAdmission.stopCopying(during(w, usable = null), { held }, written = w))
        // Control: the same readings 5 s old exactly are fresh and keep the copy going.
        assertNull(ShareAdmission.stopCopying(during(w, readAt = now - 5_000), { held }, written = w))
    }

    @Test fun `the Σ a stop carries is the one its re-check read, asked for once`() {
        var asks = 0
        val sigma = 3 * mib
        val stop = ShareAdmission.stopCopying(during(bq, quota = 20 * mib), { asks++; sigma }, written = bq)
        assertEquals(1, asks)
        assertEquals(sigma, stop?.held)
    }

    @Test fun `limitAfterDiscarding is the measured limit once the partial is out of K and back in A`() {
        val c = ShareAdmission.PROVISIONAL_DEV_CANDIDATE
        val w = 5 * mib
        val r = readings(held, ownCache = held + w, usable = 40 * gib - w)
        assertEquals("equal to the readings with nothing written",
            ShareConcurrentBudget.measuredLimit(readings(held), c, now), ShareConcurrentBudget.limitAfterDiscarding(w, r, c, now))
        assertEquals(bq, ShareConcurrentBudget.limitAfterDiscarding(w, r, c, now))
        assertNull("K smaller than the partial is inconsistent, not a number", ShareConcurrentBudget.limitAfterDiscarding(w, readings(held, ownCache = w - 1), c, now))
        assertNull("stale stays unmeasured", ShareConcurrentBudget.limitAfterDiscarding(w, r.copy(readAtMs = now - 5_001), c, now))
    }

    @Test fun `the provisional development candidate is the owner's three values and nothing else`() {
        val c = ShareAdmission.PROVISIONAL_DEV_CANDIDATE
        assertEquals(1L, c.quotaNumerator); assertEquals(2L, c.quotaDenominator)
        // Option B (2026-09-29): a fixed 1 GiB reserve, no proportional part. ShareDevReserveTest has the why.
        assertEquals(0L, c.floorPerMille); assertEquals(gib, c.floorExtraBytes)
        assertEquals(5_000L, c.maxReadingAgeMs)
        assertEquals("the Stage A cap is still unset", null, ShareAdmission.APPROVED_CAP)
    }
}
