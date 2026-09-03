package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 51: an after-send miss is a **deferral**, not a loss.
 *
 * **What this reaches and what it does not.** It reaches the classification and the reconciliation
 * across two calls, which is where the defect lived — a counter incremented in one place and never
 * made good in another. It does **not** reach `SmsFeature.pushNewestSent`, which needs a `Context`,
 * a `ControlSession` and a live `Telephony` provider. The evidence that the real path takes these
 * branches is step 71's log in `docs/testing.md`, not this file.
 */
class SentPushTallyTest {

    @Test
    fun `an after-send miss is deferred, never dropped`() {
        val tally = SentPushTally()
        assertEquals(SentPushTally.Outcome.DEFERRED, tally.missedAfterSend())
        assertEquals(1, tally.deferredCount())
        assertEquals(1, tally.outstandingNow())
        assertEquals("nothing has been lost yet", 0, tally.recoveredCount())
    }

    /** The case measured 2 of 2 in step 71: early look, observer delivers, nothing lost. */
    @Test
    fun `the observer push afterwards makes the deferral good`() {
        val tally = SentPushTally()
        tally.missedAfterSend()
        assertEquals(SentPushTally.Outcome.RECOVERED, tally.pushedNow())
        assertEquals(1, tally.recoveredCount())
        assertEquals("nothing is still owed", 0, tally.outstandingNow())
    }

    @Test
    fun `a push with nothing owed is an ordinary delivery`() {
        val tally = SentPushTally()
        assertEquals(SentPushTally.Outcome.DELIVERED, tally.pushedNow())
        assertEquals(0, tally.recoveredCount())
        assertEquals(0, tally.outstandingNow())
    }

    /**
     * The number that would have made defect 51 visible on the day it was introduced.
     *
     * A deferral nothing makes good stays on the line as `still owed`, which is the only one of
     * these four counts that is a real problem.
     */
    @Test
    fun `a deferral nothing makes good stays visible as still owed`() {
        val tally = SentPushTally()
        tally.missedAfterSend()
        assertEquals(1, tally.outstandingNow())
        assertTrue(tally.summary().contains("1 still owed"))
    }

    @Test
    fun `recovered never exceeds deferred, however many pushes follow`() {
        val tally = SentPushTally()
        tally.missedAfterSend()
        repeat(5) { tally.pushedNow() }
        assertEquals("one deferral can be made good exactly once", 1, tally.recoveredCount())
        assertEquals(1, tally.deferredCount())
        assertEquals(0, tally.outstandingNow())
        assertEquals(5, tally.pushedCount())
    }

    @Test
    fun `two deferrals need two pushes`() {
        val tally = SentPushTally()
        tally.missedAfterSend()
        tally.missedAfterSend()
        assertEquals(2, tally.outstandingNow())
        assertEquals(SentPushTally.Outcome.RECOVERED, tally.pushedNow())
        assertEquals(1, tally.outstandingNow())
        assertEquals(SentPushTally.Outcome.RECOVERED, tally.pushedNow())
        assertEquals(0, tally.outstandingNow())
        assertEquals(SentPushTally.Outcome.DELIVERED, tally.pushedNow())
    }

    /** Every count that gives another meaning is on the line — the denominator rule. */
    @Test
    fun `the summary carries all four counts`() {
        val tally = SentPushTally()
        tally.missedAfterSend()
        tally.pushedNow()
        val line = tally.summary()
        listOf("pushed", "deferred", "recovered", "still owed").forEach {
            assertTrue("summary must name $it: $line", line.contains(it))
        }
    }
}
