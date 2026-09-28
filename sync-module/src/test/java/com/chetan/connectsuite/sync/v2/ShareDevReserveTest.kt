package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Readings
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Refusal
import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **Option B, development only (owner, 2026-09-29): the free-space floor for an extra concurrent copy
 * is a fixed 1 GiB reserve**, replacing `⌈3%·T⌉ + 1 GiB`. Everything else in the per-copy budget is
 * unchanged and is asserted here beside it, because the change must not loosen anything but the floor:
 * the ½ quota share, the 256 MiB margin, readings at most 5 s old, the re-check while the copy runs,
 * and refusal on any missing reading.
 *
 * The case that made this necessary is shaped like the paused Run A baseline — a very large phone
 * with a few GiB free — but **the numbers are synthetic**; no figure measured on a device appears here.
 * On such a phone `3%·T` alone exceeds what is free, so under the old floor no second copy could ever
 * start however small, and two waiting cards could not form.
 */
class ShareDevReserveTest {

    private val mib = 1024L * 1024
    private val gib = 1024L * mib
    private val now = 5_000_000L
    private val c = ShareAdmission.PROVISIONAL_DEV_CANDIDATE

    /** A 456 GiB phone with 9.5 GiB usable, one 100,000-byte copy held, a 175 MiB quota, nothing else cached. */
    private fun bigPhone(
        held: Long = 100_000, usable: Long? = 9 * gib + 512 * mib, total: Long? = 456 * gib,
        quota: Long? = 175 * mib, ownCache: Long? = held, readAt: Long = now,
    ) = Readings(quota, ownCache, held, usable, total, readAt)

    @Test fun `the development floor is a fixed 1 GiB, with no share of the volume's size`() {
        assertEquals("no proportional part", 0L, c.floorPerMille)
        assertEquals("the fixed reserve", gib, c.floorExtraBytes)
        // Unchanged by Option B:
        assertEquals(1L, c.quotaNumerator); assertEquals(2L, c.quotaDenominator)
        assertEquals(5_000L, c.maxReadingAgeMs)
        assertEquals("the version-2 margin is still 256 MiB for a small file", 256 * mib, ShareStaging.margin(230_778))
        assertNull("the Stage A cap is still unset", ShareAdmission.APPROVED_CAP)
    }

    @Test fun `a small second file is admitted on a large, nearly full phone`() {
        val v = ShareConcurrentBudget.admit(230_778, bigPhone(), c, now)
        assertTrue("admitted, was $v", v is Verdict.Admit)
    }

    @Test fun `the space budget is usable minus the 1 GiB reserve minus the margin, whatever the volume's size`() {
        val small = ShareConcurrentBudget.admit(230_778, bigPhone(total = 64 * gib), c, now) as Verdict.Admit
        val huge = ShareConcurrentBudget.admit(230_778, bigPhone(total = 2048 * gib), c, now) as Verdict.Admit
        assertEquals("T no longer moves the floor", small.spaceBudget, huge.spaceBudget)
        // Bs is the largest x with x + M(Σ + x) ≤ A − 1 GiB: it fits exactly, and one byte more does not.
        val room = 9 * gib + 512 * mib - gib
        val bs = small.spaceBudget
        assertTrue("Bs fits under the 1 GiB reserve", bs + ShareStaging.margin(100_000 + bs) <= room)
        assertTrue("Bs + 1 does not", bs + 1 + ShareStaging.margin(100_000 + bs + 1) > room)
    }

    @Test fun `the reserve still refuses when free space is at or under 1 GiB plus the margin`() {
        val edge = gib + 256 * mib + 230_778
        assertTrue("exactly enough is admitted", ShareConcurrentBudget.admit(230_778, bigPhone(usable = edge), c, now) is Verdict.Admit)
        assertEquals(Verdict.Refuse(Refusal.OVER_SPACE_BUDGET), ShareConcurrentBudget.admit(230_778, bigPhone(usable = edge - 1), c, now))
        assertEquals(Verdict.Refuse(Refusal.OVER_SPACE_BUDGET), ShareConcurrentBudget.admit(0, bigPhone(usable = gib), c, now))
        assertEquals("nothing may be written at all", 0L, ShareConcurrentBudget.measuredLimit(bigPhone(usable = gib), c, now))
    }

    @Test fun `the quota share still binds on a phone with room`() {
        // ⌊175 MiB · ½⌋ − N − Σ, N = 0: the quota, not the reserve, is the limit here.
        val v = ShareConcurrentBudget.admit(230_778, bigPhone(), c, now) as Verdict.Admit
        assertEquals(175 * mib / 2 - 100_000, v.quotaBudget)
        assertEquals(v.quotaBudget, v.limit)
        assertEquals(Verdict.Refuse(Refusal.OVER_QUOTA_BUDGET), ShareConcurrentBudget.admit(v.quotaBudget + 1, bigPhone(), c, now))
    }

    @Test fun `a missing, stale or future reading still refuses the extra copy`() {
        assertEquals(Verdict.Refuse(Refusal.USABLE_UNREADABLE), ShareConcurrentBudget.admit(1, bigPhone(usable = null), c, now))
        assertEquals(Verdict.Refuse(Refusal.TOTAL_UNREADABLE), ShareConcurrentBudget.admit(1, bigPhone(total = null), c, now))
        assertEquals(Verdict.Refuse(Refusal.QUOTA_UNREADABLE), ShareConcurrentBudget.admit(1, bigPhone(quota = null), c, now))
        assertEquals(Verdict.Refuse(Refusal.READING_STALE), ShareConcurrentBudget.admit(1, bigPhone(readAt = now - 5_001), c, now))
        assertEquals(Verdict.Refuse(Refusal.READING_FROM_THE_FUTURE), ShareConcurrentBudget.admit(1, bigPhone(readAt = now + 1), c, now))
    }

    @Test fun `a running copy is stopped when free space falls to the reserve`() {
        val written = 50 * mib
        // Still room: keep going.
        assertTrue(ShareConcurrentBudget.duringCopy(written, bigPhone(ownCache = 100_000 + written, quota = 1024 * mib), c, now) is Verdict.Admit)
        // Free space fell to exactly the reserve plus less than the margin: stop.
        val squeezed = bigPhone(ownCache = 100_000 + written, quota = 1024 * mib, usable = gib + 100 * mib)
        assertEquals(Verdict.Refuse(Refusal.OVER_SPACE_BUDGET), ShareConcurrentBudget.duringCopy(written, squeezed, c, now))
    }

    @Test fun `through the sheet's admission, a small second file on a nearly full phone is a Go, not OverBudget`() {
        val concurrent = ShareAdmission.Concurrent(read = { h -> bigPhone(held = h) }, nowMs = { now })
        val copy = ShareAdmission.forCopy(3, 230_778, 100_000, 9 * gib + 512 * mib, ShareAdmission.APPROVED_CAP, concurrent)
        assertTrue("Go, was $copy", copy is ShareAdmission.Copy.Go)
    }
}
