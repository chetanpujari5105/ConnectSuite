package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.Effect
import com.chetan.connectsuite.sync.v2.ShareOffer.Reply
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The offer's transitions, called exactly as `ShareFeature` calls them. Every end must carry
 * [Effect.DeleteStaged]; expiry must never read as a decline; an answer from another session, or a
 * second answer, must be `NOT_FOUND`.
 */
class ShareOfferTest {

    private val id = "s-Q3v9aP0kT7mR2xW8yB4nZc"
    private val session = "token-A"
    private val t0 = 1_000_000L
    private val live = ShareOffer.Offer(id, session, 100_000, "a".repeat(64), t0, t0 + ShareOffer.TTL_MS)

    private fun respond(offer: ShareOffer.Offer? = live, from: String = session, offerId: String? = id,
                        decision: String? = "decline", reason: String? = "not-available", now: Long = t0 + 1) =
        ShareOffer.respond(offer, from, offerId, decision, reason, now)

    private fun errorCode(r: ShareOffer.Result) = (r.reply as Reply.Error).code

    @Test fun `a decline ends the offer, acks declined and deletes the staged copy`() {
        val r = respond()
        assertEquals(State.Declined("not-available"), r.offer!!.state)
        assertEquals(Reply.Ack(mapOf("offerId" to id, "state" to "declined")), r.reply)
        assertEquals(listOf(Effect.DeleteStaged), r.effects)
    }

    @Test fun `every decline reason in the contract is accepted`() {
        ShareOffer.DECLINE_REASONS.forEach { reason -> assertEquals(reason, State.Declined(reason), respond(reason = reason).offer!!.state) }
    }

    @Test fun `an answer is given once — the second finds nothing`() {
        val first = respond()
        val second = respond(offer = first.offer)
        assertEquals("NOT_FOUND", errorCode(second))
        assertTrue(second.effects.isEmpty())
    }

    @Test fun `an answer from another session is NOT_FOUND and changes nothing`() {
        val r = respond(from = "token-B")
        assertEquals("NOT_FOUND", errorCode(r))
        assertEquals(State.Offered, r.offer!!.state)
        assertTrue(r.effects.isEmpty())
    }

    @Test fun `an unknown offer id is NOT_FOUND, the same answer as another session's`() {
        assertEquals("NOT_FOUND", errorCode(respond(offer = null)))
        assertEquals("NOT_FOUND", errorCode(respond(offerId = "s-AAAAAAAAAAAAAAAAAAAAAA")))
    }

    @Test fun `malformed fields are BAD_REQUEST before any lookup`() {
        assertEquals("BAD_REQUEST", errorCode(respond(offerId = null)))
        assertEquals("BAD_REQUEST", errorCode(respond(offerId = "share:$id")))
        assertEquals("BAD_REQUEST", errorCode(respond(decision = "maybe")))
        assertEquals("BAD_REQUEST", errorCode(respond(decision = null)))
        assertEquals("BAD_REQUEST", errorCode(respond(reason = null)))
        assertEquals("BAD_REQUEST", errorCode(respond(reason = "expired"))) // expiry is never a decline
        assertEquals("BAD_REQUEST", errorCode(respond(reason = "because")))
    }

    @Test fun `accept is refused in this revision and the offer stays live`() {
        val r = respond(decision = "accept", reason = null)
        assertEquals("BAD_REQUEST", errorCode(r))
        assertEquals(State.Offered, r.offer!!.state)
        assertTrue(r.effects.isEmpty())
        // Control: the same offer can still be declined afterwards.
        assertEquals(State.Declined("user"), respond(offer = r.offer, reason = "user").offer!!.state)
    }

    @Test fun `an offer past its time expires — told to the Mac, never called declined`() {
        val r = ShareOffer.expire(live, live.expiresAtMs)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("expired"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `an early expiry tick changes nothing`() {
        val r = ShareOffer.expire(live, live.expiresAtMs - 1)
        assertEquals(State.Offered, r.offer!!.state)
        assertTrue(r.effects.isEmpty())
    }

    @Test fun `a late answer to an offer past its time expires it instead`() {
        val r = respond(now = live.expiresAtMs + 5)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals("NOT_FOUND", errorCode(r))
        assertEquals(listOf(Effect.SendCancel("expired"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `the Mac can cancel, with user only, and the phone acks stopped`() {
        val r = ShareOffer.cancelFromMac(live, session, id, "user", t0 + 1)
        assertEquals(State.Cancelled(ShareOffer.Side.MAC, "user"), r.offer!!.state)
        assertEquals(Reply.Ack(mapOf("offerId" to id, "stopped" to true)), r.reply)
        assertEquals(listOf(Effect.DeleteStaged), r.effects)
        assertEquals("BAD_REQUEST", errorCode(ShareOffer.cancelFromMac(live, session, id, "expired", t0 + 1)))
        assertEquals("NOT_FOUND", errorCode(ShareOffer.cancelFromMac(live, "token-B", id, "user", t0 + 1)))
    }

    @Test fun `the phone can cancel, and tells the Mac why`() {
        val r = ShareOffer.cancelFromPhone(live, "staging-lost")
        assertEquals(State.Cancelled(ShareOffer.Side.PHONE, "staging-lost"), r.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("staging-lost"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `the session ending ends its offer silently and deletes the copy, and another session's end does not`() {
        val r = ShareOffer.sessionEnded(live, session)
        assertEquals(State.SessionEnded, r.offer!!.state)
        assertEquals(listOf(Effect.DeleteStaged), r.effects)
        assertTrue(ShareOffer.sessionEnded(live, "token-B").effects.isEmpty())
    }

    @Test fun `every transition out of Offered deletes the staged copy`() {
        val ends = listOf(
            respond(),
            ShareOffer.expire(live, live.expiresAtMs),
            ShareOffer.cancelFromMac(live, session, id, "user", t0 + 1),
            ShareOffer.cancelFromPhone(live, "user"),
            ShareOffer.sessionEnded(live, session),
        )
        ends.forEach { r ->
            assertTrue(r.offer!!.state != State.Offered)
            assertEquals("${r.offer!!.state} deletes last", Effect.DeleteStaged, r.effects.last())
        }
    }

    @Test fun `an ended offer takes no further transition`() {
        val declined = respond().offer!!
        assertTrue(ShareOffer.expire(declined, Long.MAX_VALUE).effects.isEmpty())
        assertTrue(ShareOffer.sessionEnded(declined, session).effects.isEmpty())
        assertTrue(ShareOffer.cancelFromPhone(declined, "user").effects.isEmpty())
        assertNull(ShareOffer.cancelFromPhone(declined, "user").reply)
    }
}
