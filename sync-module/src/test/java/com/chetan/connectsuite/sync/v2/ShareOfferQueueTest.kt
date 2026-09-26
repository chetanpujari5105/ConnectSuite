package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.Effect
import com.chetan.connectsuite.sync.v2.ShareOffer.Reply
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Version 3 on the phone (PROPOSED; neither side advertises it): an accepted offer may wait for its
 * pull, bounded from the Accept by a **candidate** lifetime, and one share pull runs per session at a
 * time. Every test here calls the transitions `ShareFeature` calls.
 */
class ShareOfferQueueTest {

    private val t0 = 1_000_000L
    private val life = 60L * 60 * 1000
    private fun offer(id: String, session: String = "token-A") =
        ShareOffer.Offer(id, session, 100_718, "1".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = "same-name.png")
    private val a = offer("s-AAAAAAAAAAAAAAAAAAAAAA")
    private val b = offer("s-BBBBBBBBBBBBBBBBBBBBBB")

    private fun accept(o: ShareOffer.Offer, version: Int, at: Long = t0 + 1) =
        ShareOffer.respond(o, "token-A", o.offerId, "accept", null, at, negotiatedVersion = version, queueLifetimeMs = life, stagedIntact = true)

    @Test fun `version 2 accept is unchanged - no queue bound, no backstop, and the offer TTL still ends it`() {
        val r = accept(a, 2)
        assertEquals(State.Accepted, r.offer!!.state)
        assertNull(r.offer!!.queueUntilMs)
        assertEquals(emptyList<Effect>(), r.effects)
        val ended = ShareOffer.expire(r.offer!!, a.expiresAtMs)
        assertEquals(State.Expired, ended.offer!!.state)
        assertTrue(ended.effects.contains(Effect.SendCancel("expired")) && ended.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `version 3 accept sets a bound from the Accept and schedules the backstop`() {
        val r = accept(a, 3, at = t0 + 5_000)
        assertEquals(t0 + 5_000 + life, r.offer!!.queueUntilMs)
        assertEquals(listOf<Effect>(Effect.ScheduleQueueEnd(t0 + 5_000 + life)), r.effects)
        assertEquals(Reply.Ack(mapOf("offerId" to a.offerId, "state" to "accepted")), r.reply)
    }

    @Test fun `a queued offer outlives the offer TTL, then the backstop ends it, tells the Mac, and deletes the copy`() {
        val queued = accept(a, 3).offer!!
        val atTtl = ShareOffer.expire(queued, a.expiresAtMs + 1)
        assertEquals("the 10-minute TTL no longer ends an accepted offer at 3", State.Accepted, atTtl.offer!!.state)
        assertEquals(emptyList<Effect>(), atTtl.effects)
        val atBound = ShareOffer.expire(queued, queued.queueUntilMs!!)
        assertEquals(State.Expired, atBound.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("expired"), Effect.DeleteStaged), atBound.effects)
    }

    @Test fun `its turn after the TTL still pulls, and after the bound it is refused and ends`() {
        val queued = accept(a, 3).offer!!
        val late = ShareOffer.beginPull(queued, "token-A", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", a.expiresAtMs + 60_000, 262_144)
        assertEquals(State.Sending, late.offer!!.state)
        val tooLate = ShareOffer.beginPull(queued, "token-A", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", queued.queueUntilMs!!, 262_144)
        assertEquals(State.Expired, tooLate.offer!!.state)
        assertTrue(tooLate.reply is Reply.Error)
        assertTrue(tooLate.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `the Mac cancelling a queued offer past its TTL is a cancel, not an expiry`() {
        val queued = accept(a, 3).offer!!
        val r = ShareOffer.cancelFromMac(queued, "token-A", a.offerId, "user", a.expiresAtMs + 60_000)
        assertEquals(State.Cancelled(ShareOffer.Side.MAC, "user"), r.offer!!.state)
        assertTrue(r.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `session binding - another session cannot pull it, and its own session ending ends it without a message`() {
        val queued = accept(a, 3).offer!!
        val foreign = ShareOffer.beginPull(queued, "token-B", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 262_144)
        assertEquals(State.Accepted, foreign.offer!!.state)
        assertEquals("NOT_FOUND", (foreign.reply as Reply.Error).code)
        val gone = ShareOffer.sessionEnded(queued, "token-A")
        assertEquals(State.SessionEnded, gone.offer!!.state)
        assertEquals(listOf<Effect>(Effect.DeleteStaged), gone.effects)
    }

    @Test fun `one share pull per session - a second offer waits while the first is sending, other sessions are not affected`() {
        val sendingA = ShareOffer.beginPull(accept(a, 3).offer!!, "token-A", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 262_144).offer!!
        val queuedB = accept(b, 3).offer!!
        assertSame(sendingA, ShareOffer.pullInFlight(listOf(sendingA, queuedB), "token-A", b.offerId))
        assertNull("a pull never blocks itself", ShareOffer.pullInFlight(listOf(sendingA), "token-A", a.offerId))
        assertNull(ShareOffer.pullInFlight(listOf(sendingA, queuedB), "token-B", b.offerId))
        assertNull("nothing sending, nothing blocks", ShareOffer.pullInFlight(listOf(queuedB), "token-A", a.offerId))
    }

    @Test fun `a failure after a long wait keeps its Retry window, bounded by the queue bound rather than the old TTL`() {
        val queued = accept(a, 3).offer!!
        val now = a.expiresAtMs + 60_000 // long past the offer TTL
        val sending = ShareOffer.beginPull(queued, "token-A", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", now, 262_144).offer!!
        val failed = ShareOffer.saved(sending, "token-A", a.offerId, false, null, null, null, "checksum", now)
        assertEquals(State.Failed("checksum"), failed.offer!!.state)
        assertEquals(now + ShareOffer.RETRY_WINDOW_MS, failed.offer!!.retryUntilMs)
    }

    // ---- two separate small-file shares on one session (2026-09-26) ---------------------------------

    private fun pull(o: ShareOffer.Offer, tx: String, at: Long = t0 + 2, session: String = "token-A") =
        ShareOffer.beginPull(o, session, o.offerId, "0", tx, at, 262_144)

    @Test fun `an offer nobody accepted is never pulled, even while another on its session is accepted and sending`() {
        val sendingA = pull(accept(a, 3).offer!!, "ts-AAAAAAAAAAAAAAAAAAAAAA").offer!!
        assertEquals(State.Sending, sendingA.state)
        val r = pull(b, "ts-BBBBBBBBBBBBBBBBBBBBBB")
        assertEquals("B was only offered", State.Offered, r.offer!!.state)
        assertTrue(r.reply is Reply.Error)
        assertEquals(emptyList<Effect>(), r.effects)
    }

    @Test fun `each offer is saved only by its own verdict - A's share saved leaves B exactly as it was`() {
        val sendingA = pull(accept(a, 3).offer!!, "ts-AAAAAAAAAAAAAAAAAAAAAA").offer!!
        val queuedB = accept(b, 3).offer!!
        val savedA = ShareOffer.saved(sendingA, "token-A", a.offerId, true, 100_718, true, "same-name.png", null, t0 + 3)
        assertEquals(State.Saved("same-name.png"), savedA.offer!!.state)
        val wrongId = ShareOffer.saved(queuedB, "token-A", a.offerId, true, 100_718, true, "same-name.png", null, t0 + 3)
        assertSame("a verdict naming A cannot touch B", queuedB, wrongId.offer)
        assertTrue(wrongId.reply is Reply.Error)
        val notYet = ShareOffer.saved(queuedB, "token-A", b.offerId, true, 100_718, true, "same-name (2).png", null, t0 + 3)
        assertEquals("B was never sent, so it cannot be saved", State.Accepted, notYet.offer!!.state)
    }

    @Test fun `declining one leaves the other live, and deletes only its own copy`() {
        val declinedA = ShareOffer.respond(a, "token-A", a.offerId, "decline", "user", t0 + 1, negotiatedVersion = 3, stagedIntact = true)
        assertTrue(declinedA.offer!!.state is State.Declined)
        assertEquals(listOf<Effect>(Effect.DeleteStaged), declinedA.effects)
        val acceptedB = accept(b, 3)
        assertEquals(State.Accepted, acceptedB.offer!!.state)
        assertTrue(Effect.DeleteStaged !in acceptedB.effects)
    }

    @Test fun `no queued offer starts after its trusted session ends - the ended offer refuses its own session's pull`() {
        val queued = accept(a, 3).offer!!
        val gone = ShareOffer.sessionEnded(queued, "token-A").offer!!
        assertEquals(State.SessionEnded, gone.state)
        val late = pull(gone, "ts-AAAAAAAAAAAAAAAAAAAAAA")
        assertEquals(State.SessionEnded, late.offer!!.state)
        assertEquals("NOT_FOUND", (late.reply as Reply.Error).code)
        assertEquals(emptyList<Effect>(), late.effects)
        val fromNew = pull(gone, "ts-AAAAAAAAAAAAAAAAAAAAAA", session = "token-B")
        assertEquals("NOT_FOUND", (fromNew.reply as Reply.Error).code)
    }

    @Test fun `an older peer - version 2 - never queues, and its accepted offer still ends at the offer TTL`() {
        val v2 = accept(a, 2).offer!!
        assertNull(v2.queueUntilMs)
        assertEquals(State.Expired, ShareOffer.expire(v2, a.expiresAtMs).offer!!.state)
        val v3 = accept(a, 3).offer!!
        assertEquals(State.Accepted, ShareOffer.expire(v3, a.expiresAtMs).offer!!.state)
    }
}
