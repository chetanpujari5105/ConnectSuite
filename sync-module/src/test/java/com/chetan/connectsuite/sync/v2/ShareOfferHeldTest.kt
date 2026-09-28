package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.Offer
import com.chetan.connectsuite.sync.v2.ShareOffer.Result
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **`Σ` release on the phone** (docs/protocol.md → Version 3 rule 4: *"A copy leaves `Σ` when its offer
 * ends, in any state"*). Stage A coverage audit, 2026-09-28.
 *
 * Every transition here is the real `ShareOffer` function `ShareFeature` calls, and every result is stored
 * through the real [ShareOffer.storeLive]; `Σ` is the real [ShareOffer.heldBytes] — both moved verbatim out
 * of `ShareFeature` for this. **Restated here, and so not reached:** `ShareFeature`'s one line of glue —
 * look the offer up in the live map (null once it has left), transition, and store `r.offer` if there is
 * one — plus its lock, `publish`, and `apply`'s `DeleteStaged` file deletion (`ShareHeldCopiesTest` and the
 * version-2 suites cover that).
 *
 * Two offers on the session throughout, so each case also shows the **other** offer's copy stays counted.
 */
class ShareOfferHeldTest {

    private val t0 = 1_000_000L
    private val a = Offer("s-AAAAAAAAAAAAAAAAAAAAAA", "token-A", 100_718, "1".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = "a.png")
    private val b = Offer("s-BBBBBBBBBBBBBBBBBBBBBB", "token-B", 230_778, "2".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = "b.png")

    /** The live map with [a] and [b] held, as `ShareFeature.offerStaged` leaves it. */
    private fun live() = HashMap<String, Offer>().also { m -> listOf(a, b).forEach { ShareOffer.storeLive(m, it) } }

    /** `ShareFeature`'s glue, restated: the current offer is whatever is still live (null once it left). */
    private fun step(live: MutableMap<String, Offer>, id: String, t: (Offer?) -> Result): Result =
        t(live[id]).also { r -> r.offer?.let { ShareOffer.storeLive(live, it) } }

    private fun held(live: Map<String, Offer>) = ShareOffer.heldBytes(live.values)

    private fun accept(o: Offer?, version: Int = 2) = ShareOffer.respond(o, "token-A", a.offerId, "accept", null, t0 + 1, negotiatedVersion = version, stagedIntact = true)
    private fun begin(o: Offer?) = ShareOffer.beginPull(o, "token-A", a.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 262_144)

    /** [a] has ended: its bytes left `Σ`, [b]'s did not, and [b] is untouched. */
    private fun assertOnlyAReleased(live: Map<String, Offer>, why: String) {
        assertNull("$why: A left the live map", live[a.offerId])
        assertEquals("$why: Σ is B's copy alone", b.bytes, held(live))
        assertEquals("$why: B is exactly as it was", b, live[b.offerId])
    }

    @Test fun `control - two live offers hold both copies, and an accepted or sending offer still holds its own`() {
        val live = live()
        assertEquals(a.bytes + b.bytes, held(live))
        step(live, a.offerId) { accept(it) }
        assertEquals(State.Accepted, live[a.offerId]!!.state)
        step(live, a.offerId) { begin(it) }
        assertEquals(State.Sending, live[a.offerId]!!.state)
        assertEquals("accepting and sending release nothing", a.bytes + b.bytes, held(live))
    }

    @Test fun `saved - the Mac's verified verdict releases the copy, once`() {
        val live = live()
        step(live, a.offerId) { accept(it) }
        step(live, a.offerId) { begin(it) }
        val r = step(live, a.offerId) { ShareOffer.saved(it, "token-A", a.offerId, true, a.bytes, true, "a.png", null, t0 + 3) }
        assertTrue(r.offer!!.state is State.Saved)
        assertOnlyAReleased(live, "saved")
        val again = step(live, a.offerId) { ShareOffer.saved(it, "token-A", a.offerId, true, a.bytes, true, "a.png", null, t0 + 4) }
        assertNull("a second verdict finds no live offer, so nothing is stored", again.offer)
        assertOnlyAReleased(live, "saved, then a repeated verdict")
    }

    @Test fun `declined - the Mac's decline releases the copy, once`() {
        val live = live()
        val r = step(live, a.offerId) { ShareOffer.respond(it, "token-A", a.offerId, "decline", "user", t0 + 1, stagedIntact = true) }
        assertTrue(r.offer!!.state is State.Declined)
        assertOnlyAReleased(live, "declined")
        assertNull(step(live, a.offerId) { ShareOffer.respond(it, "token-A", a.offerId, "decline", "user", t0 + 2, stagedIntact = true) }.offer)
        assertOnlyAReleased(live, "declined, then a repeated decline")
    }

    @Test fun `cancelled - by the Mac while queued at version 3, by the Mac's pull cancel, and by the phone`() {
        val byMac = live()
        step(byMac, a.offerId) { accept(it, version = 3) }
        assertTrue("control: queued at 3", ShareOffer.isQueued(byMac[a.offerId]!!))
        assertEquals(a.bytes + b.bytes, held(byMac))
        step(byMac, a.offerId) { ShareOffer.cancelFromMac(it, "token-A", a.offerId, "user", t0 + 5) }
        assertOnlyAReleased(byMac, "cancelled by the Mac while queued")
        assertNull(step(byMac, a.offerId) { ShareOffer.cancelFromMac(it, "token-A", a.offerId, "user", t0 + 6) }.offer)
        assertOnlyAReleased(byMac, "a repeated Mac cancel")

        val byPull = live()
        step(byPull, a.offerId) { accept(it) }
        step(byPull, a.offerId) { begin(it) }
        step(byPull, a.offerId) { ShareOffer.cancelPull(it, "token-A", "ts-AAAAAAAAAAAAAAAAAAAAAA") }
        assertOnlyAReleased(byPull, "the Mac cancelled the running pull")

        val byPhone = live()
        val ended = step(byPhone, a.offerId) { ShareOffer.cancelFromPhone(it!!, "user") }.offer!!
        assertTrue(ended.state is State.Cancelled)
        assertOnlyAReleased(byPhone, "withdrawn on the phone")
        ShareOffer.storeLive(byPhone, ShareOffer.cancelFromPhone(ended, "user").offer!!)
        assertOnlyAReleased(byPhone, "the same ended offer stored again")
    }

    @Test fun `expired - a waiting offer at its TTL, and a queued offer at the backstop`() {
        val waiting = live()
        val notYet = step(waiting, a.offerId) { ShareOffer.expire(it!!, a.expiresAtMs - 1) }
        assertEquals("control: before its moment nothing ends", State.Offered, notYet.offer!!.state)
        assertEquals(a.bytes + b.bytes, held(waiting))
        val ended = step(waiting, a.offerId) { ShareOffer.expire(it!!, a.expiresAtMs) }.offer!!
        assertEquals(State.Expired, ended.state)
        assertOnlyAReleased(waiting, "expired while waiting")
        ShareOffer.storeLive(waiting, ShareOffer.expire(ended, a.expiresAtMs + 1).offer!!)
        assertOnlyAReleased(waiting, "the expiry timer firing again on the ended offer")

        val queued = live()
        step(queued, a.offerId) { accept(it, version = 3) }
        val bound = queued[a.offerId]!!.queueUntilMs!!
        step(queued, a.offerId) { ShareOffer.expire(it!!, a.expiresAtMs + 1) }
        assertEquals("control: the offer TTL does not end a queued offer", a.bytes + b.bytes, held(queued))
        step(queued, a.offerId) { ShareOffer.expire(it!!, bound) }
        assertOnlyAReleased(queued, "the backstop ended the queued offer")
    }

    @Test fun `session ended - its own session's offers leave, another session's offer stays`() {
        val live = live()
        step(live, b.offerId) { ShareOffer.sessionEnded(it!!, "token-A") }
        assertEquals("control: token-A ending does not touch token-B's offer", a.bytes + b.bytes, held(live))
        val ended = step(live, a.offerId) { ShareOffer.sessionEnded(it!!, "token-A") }.offer!!
        assertEquals(State.SessionEnded, ended.state)
        assertOnlyAReleased(live, "its session ended")
        ShareOffer.storeLive(live, ShareOffer.sessionEnded(ended, "token-A").offer!!)
        assertOnlyAReleased(live, "the session-ended sweep reaching it twice")
    }

    @Test fun `failed - the copy is KEPT for the Retry window, and released when the window closes`() {
        val live = live()
        step(live, a.offerId) { accept(it) }
        step(live, a.offerId) { begin(it) }
        val failed = step(live, a.offerId) { ShareOffer.saved(it, "token-A", a.offerId, false, null, null, null, "checksum", t0 + 3) }.offer!!
        assertTrue(failed.state is State.Failed)
        assertEquals("a failed attempt keeps its copy for a Retry", a.bytes + b.bytes, held(live))
        step(live, a.offerId) { ShareOffer.retryWindowClosed(it!!, failed.retryUntilMs!!) }
        assertOnlyAReleased(live, "the Retry window closed")
    }
}
