package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.core.link.PairRejectReason
import com.chetan.connectsuite.core.link.PairRejection
import com.chetan.connectsuite.core.link.ScannedPairing
import com.chetan.connectsuite.core.protocol.Link
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `LinkState.lastPairReject` reaching the screen.
 *
 * The field existed nowhere before this: `acceptPairToken` decided one of three reasons, sent
 * `pair.rejected` to the Mac, wrote a log line, and the phone's own user saw a plain wait. These
 * tests are about the two things that wiring has to get right — that each reason arrives with its
 * own already-written sentence, and that it **outranks** the locally-derived expiry when both
 * could apply at once.
 */
class PairRejectStageTest {

    private val t0 = 1_700_000_000_000L
    private val ttl = Link.PAIR_TOKEN_TTL_MS
    private val scan = ScannedPairing("Chetans-MacBook-Pro", t0)

    private fun listening(reject: PairRejection? = null) =
        LinkState(running = true, waitingSinceMillis = t0, lastPairReject = reject)

    @Test
    fun `each reason reaches the screen and keeps its own copy`() {
        PairRejectReason.entries.forEach { reason ->
            val state = listening(PairRejection(reason, t0 + 1_000))
            val stage = ConnectStage.of(state, scan, "10.0.0.5", t0 + 2_000)

            assertTrue("$reason did not reach the screen", stage is ConnectStage.Rejected)
            stage as ConnectStage.Rejected
            assertEquals(reason, stage.reason)
            assertEquals("Chetans-MacBook-Pro", stage.macName)

            // The sentence is `core`'s, not the screen's. Asserting it is non-blank here is what
            // stops a reason being added later with no copy and rendering as an empty card.
            assertNotNull(reason.message)
            assertTrue("$reason has no copy", reason.message.isNotBlank())
        }
    }

    @Test
    fun `the three reasons do not share one sentence`() {
        val messages = PairRejectReason.entries.map { it.message }
        assertEquals(
            "a reason that reads like its neighbour tells the user nothing",
            messages.size,
            messages.toSet().size,
        )
    }

    /**
     * **The precedence this wiring exists for.** A Mac that arrives one second late produces a real
     * `TOKEN_EXPIRED` *and* satisfies the local clock. Before this, only the clock was visible, so
     * "your Mac turned up too late" was shown as "nothing ever came" — a different event.
     */
    @Test
    fun `a real rejection outranks the locally derived expiry`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_EXPIRED, t0 + ttl + 1_000))
        val now = t0 + ttl + 2_000

        // Both apply: the local clock is past the deadline …
        assertTrue(now >= scan.expiresAtMillis)
        // … and the server has spoken. The server wins.
        val stage = ConnectStage.of(state, scan, "10.0.0.5", now)
        assertTrue(stage is ConnectStage.Rejected)
        assertFalse(stage is ConnectStage.Expired)
    }

    /** With no rejection published, the local derivation still has to work. */
    @Test
    fun `without a rejection the local expiry still shows`() {
        val stage = ConnectStage.of(listening(), scan, "10.0.0.5", t0 + ttl + 1)
        assertEquals(ConnectStage.Expired("Chetans-MacBook-Pro"), stage)
    }

    /**
     * A rejection from before this scan belongs to a previous attempt. Scanning again is precisely
     * the act that makes the old one irrelevant, so it must not hijack the new wait.
     */
    @Test
    fun `a rejection from before the scan does not hijack the new attempt`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_MISMATCH, t0 - 30_000))
        assertTrue(ConnectStage.of(state, scan, "10.0.0.5", t0 + 1_000) is ConnectStage.Waiting)
    }

    /** With nothing scanned there is no attempt for a rejection to be about. */
    @Test
    fun `a rejection with nothing scanned shows the entry screen`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_MISSING, t0))
        assertEquals(ConnectStage.Entry, ConnectStage.of(state, null, "10.0.0.5", t0 + 1_000))
    }

    /**
     * **Changed 2026-10-06 with pairing v2's wording fix.** This test used to assert that a live session
     * outranks a rejection after a scan. It no longer may: a connected session is not evidence that THIS
     * scan paired — it can be a different trusted Mac, or this Mac reconnecting on a legacy pin — so the
     * scan's own outcome is shown. Only a verified pairing (`afterPairSucceeded`) outranks a rejection.
     */
    @Test
    fun `after a scan, a connected session does not hide the scan's rejection`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_EXPIRED, t0 + 1_000))
            .copy(clients = listOf("Chetans-MacBook-Pro"))
        val stage = ConnectStage.of(state, scan, "10.0.0.5", t0 + 2_000)
        assertEquals(ConnectStage.Rejected(PairRejectReason.TOKEN_EXPIRED, "Chetans-MacBook-Pro"), stage)
    }

    @Test
    fun `a verified pairing after an earlier rejection is Paired`() {
        val state = listening(PairRejection(PairRejectReason.PROOF_INVALID, t0 + 1_000))
            .afterPairSucceeded("AB".repeat(32), "Chetans-MacBook-Pro", t0 + 3_000)
        assertEquals(ConnectStage.Paired("Chetans-MacBook-Pro"), ConnectStage.of(state, scan, "10.0.0.5", t0 + 4_000))
    }

    @Test
    fun `with nothing scanned, a live session still outranks a rejection`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_EXPIRED, t0 + 1_000))
            .copy(clients = listOf("Chetans-MacBook-Pro"))
        assertEquals(ConnectStage.Connected("Chetans-MacBook-Pro"), ConnectStage.of(state, null, "10.0.0.5", t0 + 2_000))
    }

    /**
     * **The write, not just the decision.**
     *
     * Every other test here hands `ConnectStage.of` a `lastPairReject` it built itself, which asks
     * nothing about whether anything real ever produces one. `LinkServer.rejectPair` calls exactly
     * this function, so this is the nearest a JVM test can get to the write — `LinkServer` itself
     * needs a `Context` and the Android Keystore. What stays unreached is one line: the call.
     */
    @Test
    fun `the transition the server actually performs sets the field`() {
        val before = listening()
        assertEquals(null, before.lastPairReject)

        val after = before.afterPairRejected(PairRejectReason.TOKEN_MISMATCH, t0 + 9_000)

        assertEquals(PairRejectReason.TOKEN_MISMATCH, after.lastPairReject?.reason)
        assertEquals(t0 + 9_000, after.lastPairReject?.atMillis)
        // Nothing else moved: this is a rejection, not a disconnect.
        assertEquals(before.running, after.running)
        assertEquals(before.clients, after.clients)
        assertEquals(before.lastRefusal, after.lastRefusal)
    }

    /**
     * A fresh listen clears it, for the reason `lastRefusal` is cleared: a rejection from before
     * the server came up is not an explanation for this wait's silence.
     */
    @Test
    fun `listening again clears the rejection`() {
        val state = listening(PairRejection(PairRejectReason.TOKEN_EXPIRED, t0))
        assertEquals(null, state.afterListeningStarted(t0 + 5_000).lastPairReject)
    }
}
