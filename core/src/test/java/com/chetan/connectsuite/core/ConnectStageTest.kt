package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.core.link.PairRejectReason
import com.chetan.connectsuite.core.link.PairingOutcome
import com.chetan.connectsuite.core.link.RefusedConnection
import com.chetan.connectsuite.core.link.ScannedPairing
import com.chetan.connectsuite.core.protocol.Link
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Connect-a-Mac stage machine.
 *
 * Every case here is a *transition* or a *precedence*, which is the half `LinkWaitStatusTest` could
 * not reach — `CLAUDE.md`'s defect 67 is the worked example of a decision function with eleven
 * green tests over a feature that had never worked, because nothing tested the write. `ConnectStage`
 * takes the scan time as an argument for exactly that reason: the thing that goes wrong is *when* a
 * stage becomes true, so a test has to be able to move the clock.
 */
class ConnectStageTest {

    private val t0 = 1_700_000_000_000L
    private val ttl = Link.PAIR_TOKEN_TTL_MS

    private fun listening(refusal: RefusedConnection? = null, clients: List<String> = emptyList()) =
        LinkState(running = true, clients = clients, waitingSinceMillis = t0, lastRefusal = refusal)

    private val scan = ScannedPairing("Chetans-MacBook-Pro", t0)

    @Test
    fun `nothing scanned and a network is the entry screen`() {
        assertEquals(ConnectStage.Entry, ConnectStage.of(listening(), null, "10.0.0.5", t0))
    }

    @Test
    fun `no local address outranks the entry screen`() {
        assertEquals(ConnectStage.NoNetwork, ConnectStage.of(listening(), null, null, t0))
    }

    /**
     * A live session beats a missing address, and it has to: if a Mac is connected then there is
     * plainly a network, and the interface read is the thing that is wrong. Ordering these the
     * other way would show "No network connection" over a working link.
     */
    @Test
    fun `a connected session outranks a missing address`() {
        val stage = ConnectStage.of(listening(clients = listOf("Chetans-MacBook-Pro")), null, null, t0)
        assertEquals(ConnectStage.Connected("Chetans-MacBook-Pro"), stage)
    }

    @Test
    fun `a scan produces a wait with the servers own deadline`() {
        val stage = ConnectStage.of(listening(), scan, "10.0.0.5", t0 + 1_000) as ConnectStage.Waiting
        assertEquals(t0 + ttl, stage.expiresAtMillis)
        assertEquals("Chetans-MacBook-Pro", stage.macName)
    }

    /**
     * The boundary, from both sides. One millisecond before the deadline this is still a wait; at
     * the deadline it is expired — the same instant `LinkServer.checkPairToken` starts rejecting.
     */
    @Test
    fun `the expiry boundary`() {
        assertTrue(ConnectStage.of(listening(), scan, "10.0.0.5", t0 + ttl - 1) is ConnectStage.Waiting)
        assertEquals(
            ConnectStage.Expired("Chetans-MacBook-Pro"),
            ConnectStage.of(listening(), scan, "10.0.0.5", t0 + ttl),
        )
    }

    @Test
    fun `the countdown drains from one to zero and does not go negative`() {
        val stage = ConnectStage.of(listening(), scan, "10.0.0.5", t0) as ConnectStage.Waiting
        assertEquals(1f, stage.fractionLeft(t0), 0.001f)
        assertEquals(0.5f, stage.fractionLeft(t0 + ttl / 2), 0.01f)
        assertEquals(0f, stage.fractionLeft(t0 + ttl), 0.001f)
        assertEquals(0f, stage.fractionLeft(t0 + ttl * 10), 0.001f)
        assertEquals(0L, stage.millisLeft(t0 + ttl * 10))
    }

    /**
     * A refusal *after* the scan is about this attempt and replaces the wait. One from before it is
     * about something else and must not — otherwise a stranger who was turned away an hour ago
     * would hijack the screen of somebody who has just scanned a perfectly good code.
     */
    @Test
    fun `a refusal after the scan wins, one before it does not`() {
        val after = listening(RefusedConnection("ab12cd34", "10.0.0.9", t0 + 5_000))
        assertTrue(ConnectStage.of(after, scan, "10.0.0.5", t0 + 6_000) is ConnectStage.Refused)

        val before = listening(RefusedConnection("ab12cd34", "10.0.0.9", t0 - 5_000))
        assertTrue(ConnectStage.of(before, scan, "10.0.0.5", t0 + 6_000) is ConnectStage.Waiting)
    }

    @Test
    fun `a refusal with nothing scanned still reaches the screen`() {
        val state = listening(RefusedConnection("ab12cd34", "10.0.0.9", t0))
        val stage = ConnectStage.of(state, null, "10.0.0.5", t0 + 1_000)
        assertEquals(ConnectStage.Refused("ab12cd34", "10.0.0.9"), stage)
    }

    /**
     * `LinkWaitStatus.REFUSAL_VISIBLE_MS` decides how long a refusal is on screen, and this must
     * inherit that rather than hold its own copy. Past the window the stage falls back to the wait.
     */
    @Test
    fun `a stale refusal stops outranking the wait`() {
        val state = listening(RefusedConnection("ab12cd34", "10.0.0.9", t0 + 1_000))
        val late = t0 + 1_000 + 61_000

        // Past the 60s window and still inside the 5-minute token, so this falls through to the
        // wait — not to Expired. Worth spelling out: the first version of this test asserted
        // Expired and was wrong about which of two clocks it was reading.
        assertTrue(late < t0 + ttl)
        assertTrue(ConnectStage.of(state, scan, "10.0.0.5", late) is ConnectStage.Waiting)
    }

    // ---- pairing v2: scan, verification, success, failure, cancellation ------------------------------

    private val macFp = "AB:".repeat(31) + "AB"
    private val v2scan = ScannedPairing("Chetans-MacBook-Pro", t0, macFingerprint = macFp)

    @Test
    fun `a scan is verifying, never paired, until this phone verifies the Mac`() {
        assertEquals(PairingOutcome.Verifying, ConnectStage.pairingOutcome(listening(), v2scan, t0 + 1_000))
        assertTrue(ConnectStage.of(listening(), v2scan, "10.0.0.5", t0 + 1_000) is ConnectStage.Waiting)
    }

    /** The defect this wording fix is for: any connected session used to read as success after a scan. */
    @Test
    fun `a different Mac connected while this one is verifying is not success`() {
        val otherMacConnected = listening(clients = listOf("Some-Other-Mac"))
        val stage = ConnectStage.of(otherMacConnected, v2scan, "10.0.0.5", t0 + 1_000)
        assertTrue("was $stage", stage is ConnectStage.Waiting)
    }

    @Test
    fun `only a verified pairing of THIS Mac, after the scan, is Paired`() {
        val verified = listening().afterPairSucceeded(macFp.replace(":", "").lowercase(), "Chetans-MacBook-Pro", t0 + 2_000)
        assertEquals(PairingOutcome.Paired, ConnectStage.pairingOutcome(verified, v2scan, t0 + 3_000))
        assertEquals(ConnectStage.Paired("Chetans-MacBook-Pro"), ConnectStage.of(verified, v2scan, "10.0.0.5", t0 + 3_000))

        val otherMac = listening().afterPairSucceeded("CD:".repeat(31) + "CD", "Other", t0 + 2_000)
        assertEquals("another Mac's success is not this one's", PairingOutcome.Verifying, ConnectStage.pairingOutcome(otherMac, v2scan, t0 + 3_000))
        val stale = listening().afterPairSucceeded(macFp, "Chetans-MacBook-Pro", t0 - 1)
        assertEquals("a success before this scan is not this scan's", PairingOutcome.Verifying, ConnectStage.pairingOutcome(stale, v2scan, t0 + 3_000))
    }

    @Test
    fun `a refusal, an expiry and a cancellation each say so`() {
        val refused = listening().afterPairRejected(PairRejectReason.PROOF_INVALID, t0 + 1_000)
        assertEquals(PairingOutcome.Rejected(PairRejectReason.PROOF_INVALID), ConnectStage.pairingOutcome(refused, v2scan, t0 + 2_000))
        assertEquals(PairingOutcome.Expired, ConnectStage.pairingOutcome(listening(), v2scan, t0 + ttl))
        val cancelled = v2scan.copy(cancelled = true)
        assertEquals(PairingOutcome.Cancelled, ConnectStage.pairingOutcome(listening(), cancelled, t0 + 1_000))
        assertEquals(ConnectStage.Cancelled("Chetans-MacBook-Pro"), ConnectStage.of(listening(), cancelled, "10.0.0.5", t0 + 1_000))
        val verifiedThenCancelledLater = listening().afterPairSucceeded(macFp, "Chetans-MacBook-Pro", t0 + 2_000)
        assertEquals("Cancel is the person's last word", PairingOutcome.Cancelled, ConnectStage.pairingOutcome(verifiedThenCancelledLater, cancelled, t0 + 3_000))
    }
}
