package com.chetan.connectsuite.mirror.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 52: three reasons, three counters, and the third one counted at all.
 *
 * **Reaches the counting and the wording; does not reach `VideoChannel.offer`**, which needs a
 * socket. What the channel calls is asserted by `VideoChannelDropWiringTest` through the callback,
 * as far as a JVM test can go.
 */
class VideoDropTallyTest {

    @Test
    fun `an oversize frame is counted, which it never used to be`() {
        val t = VideoDropTally()
        t.oversize()
        assertEquals(1, t.oversizeCount())
        // The regression that matters: it must reach the number that goes on the wire as
        // `droppedFrames`, which is where the mirror's only correctness fault used to be invisible.
        assertEquals(1, t.total())
    }

    @Test
    fun `the three reasons do not share a counter`() {
        val t = VideoDropTally()
        t.staleEvicted()
        t.newestShed()
        t.newestShed()
        t.oversize()
        assertEquals(1, t.staleCount())
        assertEquals(2, t.newestCount())
        assertEquals(1, t.oversizeCount())
        assertEquals(4, t.total())
    }

    /**
     * The headline may never assert a cause the counters do not support.
     *
     * "the Mac is behind" over an oversize frame is false — the Mac is not behind and never saw it.
     */
    @Test
    fun `an oversize drop is never reported as the Mac being behind`() {
        val t = VideoDropTally()
        t.oversize()
        val line = t.headline()
        assertTrue("must name the encoder: $line", line.contains("encoder"))
        assertTrue("must not blame the link: $line", !line.contains("behind"))
    }

    @Test
    fun `a fault outranks congestion however much congestion there is`() {
        val t = VideoDropTally()
        repeat(500) { t.staleEvicted() }
        repeat(500) { t.newestShed() }
        t.oversize()
        assertTrue(t.headline().contains("encoder"))
    }

    @Test
    fun `eviction and shedding get different sentences`() {
        val evicting = VideoDropTally().apply { staleEvicted() }
        val shedding = VideoDropTally().apply { newestShed() }
        assertTrue(evicting.headline().contains("briefly behind"))
        assertTrue(shedding.headline().contains("badly behind"))
        assertTrue(
            "a run of N evictions and a run of N sheds must not read the same",
            evicting.headline() != shedding.headline(),
        )
    }

    @Test
    fun `the summary carries a denominator`() {
        val t = VideoDropTally()
        repeat(97) { t.acceptedNow() }
        repeat(3) { t.staleEvicted() }
        val line = t.summary()
        assertTrue("must say what the drops are out of: $line", line.contains("of 100 offered"))
    }

    @Test
    fun `nothing dropped says so rather than reporting a cause`() {
        assertEquals("nothing dropped", VideoDropTally().headline())
    }
}
