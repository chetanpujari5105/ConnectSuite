package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one-live-offer rule, [ShareOffer.busyWith] — the function `ShareFeature.offerStaged` calls, so
 * this is the rule that answered seven Send taps `Busy` on 2026-09-25 (docs/testing.md → the silent
 * Send). Two synthetic offers on one session; the first must come back **unchanged**, because a second
 * Send may never alter, replace or discard it.
 */
class ShareOfferBusyTest {

    private val t0 = 1_000_000L
    private val first = ShareOffer.Offer("s-AAAAAAAAAAAAAAAAAAAAAA", "token-A", 230_778, "1".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = "synthetic-1.png")

    @Test fun `a second offer on the same session is blocked by the first, which comes back unchanged`() {
        val held = listOf(first)
        val blocker = ShareOffer.busyWith(held, "token-A")
        assertSame(first, blocker)
        assertEquals(State.Offered, blocker!!.state)
        assertTrue(ShareOffer.awaitingAnswer(blocker.state))
    }

    @Test fun `another session is not blocked, and nothing held blocks nothing`() {
        assertNull(ShareOffer.busyWith(listOf(first), "token-B"))
        assertNull(ShareOffer.busyWith(emptyList(), "token-A"))
    }

    @Test fun `every live state blocks and no ended state does`() {
        val accepted = ShareOffer.respond(first, "token-A", first.offerId, "accept", null, t0 + 1, negotiatedVersion = 2).offer!!
        val sending = ShareOffer.beginPull(accepted, "token-A", first.offerId, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 262144).offer!!
        for (o in listOf(first, accepted, sending)) assertSame(o.state.toString(), o, ShareOffer.busyWith(listOf(o), "token-A"))
        // Only Offered is withdrawable without stopping something mid-flight.
        assertFalse(ShareOffer.awaitingAnswer(accepted.state))
        assertFalse(ShareOffer.awaitingAnswer(sending.state))
        val declined = ShareOffer.respond(first, "token-A", first.offerId, "decline", "user", t0 + 1, negotiatedVersion = 2).offer!!
        val cancelled = ShareOffer.cancelFromPhone(first, "user").offer!!
        for (o in listOf(declined, cancelled)) assertNull(o.state.toString(), ShareOffer.busyWith(listOf(o), "token-A"))
    }

    // ---- Version 3 foundation (PROPOSED, not advertised): the live limit is a parameter ------------

    private fun offerN(n: Int, session: String = "token-A") =
        ShareOffer.Offer("s-" + n.toString().padStart(22, 'Q'), session, 100_718, "1".repeat(64), t0 + n, t0 + n + ShareOffer.TTL_MS, name = "synthetic-$n.png")

    @Test fun `with a limit of 10, nine live offers leave room and ten block with the oldest named`() {
        val nine = (1..9).map { offerN(it) }
        assertNull(ShareOffer.busyWith(nine, "token-A", maxLive = 10))
        val ten = (1..10).map { offerN(it) }
        assertSame(ten.first(), ShareOffer.busyWith(ten.shuffled(), "token-A", maxLive = 10))
    }

    @Test fun `the limit counts only this session's live offers`() {
        val mixed = (1..9).map { offerN(it) } + (10..20).map { offerN(it, "token-B") }
        assertNull(ShareOffer.busyWith(mixed, "token-A", maxLive = 10))
        val cancelled = ShareOffer.cancelFromPhone(offerN(21), "user").offer!!
        assertNull(ShareOffer.busyWith((1..9).map { offerN(it) } + cancelled, "token-A", maxLive = 10))
    }

    @Test fun `no limit given is the version-2 contract, and a limit below 1 is refused`() {
        assertSame(first, ShareOffer.busyWith(listOf(first), "token-A", maxLive = 1))
        for (bad in listOf(0, -1)) {
            try {
                ShareOffer.busyWith(listOf(first), "token-A", maxLive = bad)
                throw AssertionError("maxLive=$bad was accepted")
            } catch (expected: IllegalArgumentException) {
            }
        }
    }
}
