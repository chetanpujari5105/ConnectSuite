package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Version 3 foundation (PROPOSED, not wired): whether one more private copy may start while others
 * are held — docs/protocol.md → Share → Version 3 §4. **The cap `C` has no value in the contract**, so
 * every test passes one; none of these numbers is a product limit.
 */
class ShareAdmissionTest {

    private val mib = 1024L * 1024
    private val gib = 1024L * mib

    @Test fun `alone, the rule is exactly the version-2 preflight, through the same margin`() {
        for (free in listOf(0L, 256 * mib, 300 * mib, 3 * gib, 40 * gib)) {
            for (size in listOf(0L, 1L, 100_718L, 44 * mib, 2 * gib, 30 * gib)) {
                val v2Go = ShareStaging.preflight(size, free) is ShareStaging.Preflight.Go
                val admitted = ShareAdmission.admit(size, held = 0, free = free, cap = 1) is ShareAdmission.Verdict.Admit
                assertEquals("size=$size free=$free", v2Go, admitted)
            }
        }
    }

    @Test fun `the margin is taken over everything held, but bytes already held are not counted again`() {
        val held = 3 * gib
        val size = 100 * mib
        val needed = size + ShareStaging.margin(held + size) // bytes held are already absent from free
        assertEquals(ShareAdmission.Verdict.Admit, ShareAdmission.admit(size, held, free = needed, cap = 10 * gib))
        val refused = ShareAdmission.admit(size, held, free = needed - 1, cap = 10 * gib)
        assertTrue(refused.toString(), refused is ShareAdmission.Verdict.NoSpace)
        assertEquals(needed, (refused as ShareAdmission.Verdict.NoSpace).needed)
    }

    @Test fun `a file alone is never refused by the cap — there is no fixed per-file size`() {
        for (size in listOf(5 * gib, 500L * 1000 * 1000 * 1000)) {
            val free = size + ShareStaging.margin(size)
            assertEquals("size=$size", ShareAdmission.Verdict.Admit, ShareAdmission.admit(size, held = 0, free = free, cap = 1))
        }
    }

    @Test fun `with copies held, the cap bounds the total at once — equal is inside, one byte over is not`() {
        val cap = 1 * gib
        val held = 900 * mib
        val plenty = 100 * gib
        assertEquals(ShareAdmission.Verdict.Admit, ShareAdmission.admit(cap - held, held, plenty, cap))
        val over = ShareAdmission.admit(cap - held + 1, held, plenty, cap)
        assertTrue(over.toString(), over is ShareAdmission.Verdict.OverCap)
    }

    @Test fun `space is judged before the cap, so a person is told the reason that actually stops it`() {
        val v = ShareAdmission.admit(size = 10 * gib, held = 1, free = 1 * gib, cap = 1)
        assertTrue(v.toString(), v is ShareAdmission.Verdict.NoSpace)
    }

    @Test fun `negative inputs and an overflowing total are refused, never wrapped`() {
        for ((s, h, c) in listOf(Triple(-1L, 0L, 1L), Triple(0L, -1L, 1L), Triple(0L, 0L, -1L))) {
            try {
                ShareAdmission.admit(s, h, free = gib, cap = c)
                throw AssertionError("accepted size=$s held=$h cap=$c")
            } catch (expected: IllegalArgumentException) {
            }
        }
        try {
            ShareAdmission.admit(Long.MAX_VALUE, held = 1, free = Long.MAX_VALUE, cap = Long.MAX_VALUE)
            throw AssertionError("an overflowing total was accepted")
        } catch (expected: ArithmeticException) {
        }
    }

    @Test fun `no approved cap - a file alone keeps its space rule, and a second concurrent copy is refused`() {
        val size = 100 * mib
        val free = 40 * gib
        assertEquals(ShareAdmission.Verdict.Admit, ShareAdmission.admit(size, held = 0, free = free, cap = null))
        val second = ShareAdmission.admit(size, held = 1, free = free, cap = null)
        assertEquals(ShareAdmission.Verdict.CapNotApproved(size, 1), second)
    }

    // ---- forCopy: what the sheet runs before its copy (2026-09-26) ---------------------------------

    private fun preflightAsCopy(expected: Long?, free: Long): ShareAdmission.Copy = when (val p = ShareStaging.preflight(expected, free)) {
        is ShareStaging.Preflight.Go -> ShareAdmission.Copy.Go(p.limit)
        is ShareStaging.Preflight.NoSpace -> ShareAdmission.Copy.NoSpace(p.expected, p.available, p.needed)
    }

    @Test fun `below version 3 the sheet's admission is exactly today's preflight, whatever is held and whatever the cap`() {
        var seen = 0
        for (version in listOf(0, 1, 2)) for (free in listOf(0L, 256 * mib, 300 * mib, 3 * gib, 40 * gib)) {
            for (expected in listOf(null, 0L, 100_718L, 2 * gib, 30 * gib)) for (held in listOf(0L, 230_778L, 5 * gib)) {
                for (cap in listOf(null, 1L, 100 * gib)) {
                    assertEquals("v$version e=$expected h=$held f=$free c=$cap", preflightAsCopy(expected, free),
                        ShareAdmission.forCopy(version, expected, held, free, cap))
                    seen++
                }
            }
        }
        assertEquals("control: every combination was read", 3 * 5 * 5 * 3 * 3, seen)
    }

    @Test fun `at version 3 with nothing held it is also today's preflight — the first file is never refused by the cap`() {
        for (free in listOf(0L, 300 * mib, 40 * gib)) for (expected in listOf(null, 100_718L, 30 * gib)) {
            assertEquals(preflightAsCopy(expected, free), ShareAdmission.forCopy(3, expected, 0, free, cap = null))
            assertEquals(preflightAsCopy(expected, free), ShareAdmission.forCopy(3, expected, 0, free, cap = 1))
        }
    }

    @Test fun `the shipped cap is unset, so at version 3 a second concurrent copy is refused with the bytes held`() {
        assertEquals(null, ShareAdmission.APPROVED_CAP)
        for (expected in listOf(null, 1L, 230_778L)) {
            assertEquals(ShareAdmission.Copy.CapNotApproved(100_718), ShareAdmission.forCopy(3, expected, 100_718, 40 * gib, ShareAdmission.APPROVED_CAP))
        }
    }

    @Test fun `with a cap given (tests only), a known size is admitted within it and bounded by the space left over everything held`() {
        val held = 100_718L
        val cap = 1 * gib
        val go = ShareAdmission.forCopy(3, 230_778, held, 40 * gib, cap)
        assertEquals(ShareAdmission.Copy.Go(cap - held), go)
        assertEquals(ShareAdmission.Copy.OverCap(held, cap), ShareAdmission.forCopy(3, cap - held + 1, held, 40 * gib, cap))
        val tight = 230_778L + ShareStaging.margin(held + 230_778L)
        assertEquals(ShareAdmission.Copy.NoSpace(230_778, tight - 1, tight), ShareAdmission.forCopy(3, 230_778, held, tight - 1, cap))
    }

    @Test fun `with a cap given (tests only), an unknown size is bounded by the cap and by the margin over everything held`() {
        val held = 3 * gib
        val go = ShareAdmission.forCopy(3, null, held, 40 * gib, 4 * gib) as ShareAdmission.Copy.Go
        assertEquals(1 * gib, go.limit)
        val tight = ShareAdmission.forCopy(3, null, held, 1 * gib, 100 * gib) as ShareAdmission.Copy.Go
        assertTrue(tight.limit + ShareStaging.margin(held + tight.limit) <= 1 * gib)
        assertTrue((tight.limit + 1) + ShareStaging.margin(held + tight.limit + 1) > 1 * gib)
        assertEquals(ShareAdmission.Copy.OverCap(4 * gib, 4 * gib), ShareAdmission.forCopy(3, null, 4 * gib, 40 * gib, 4 * gib))
        assertTrue(ShareAdmission.forCopy(3, null, held, 200 * mib, 100 * gib) is ShareAdmission.Copy.NoSpace)
    }

    @Test fun `limitOver with nothing held is ShareStaging's own limit`() {
        for (free in listOf(0L, 1L, 256 * mib, 256 * mib + 1, 2816 * mib, 3 * gib, 40 * gib)) {
            assertEquals("free=$free", ShareStaging.limit(free), ShareAdmission.limitOver(0, free))
        }
    }
}
