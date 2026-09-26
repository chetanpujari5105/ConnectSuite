package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareOffer.Effect
import com.chetan.connectsuite.sync.v2.ShareOffer.PullEnd
import com.chetan.connectsuite.sync.v2.ShareOffer.Reply
import com.chetan.connectsuite.sync.v2.ShareOffer.Side
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A staged copy the platform removed (Android may clear this app's cache at any time): **a missing or
 * changed staged file never reaches Saved**, an Accept for it is never acknowledged as `accepted`, and
 * a waiting offer whose copy is gone ends as `staging-lost` — the Mac told — instead of waiting on.
 * Every state is reached through the transitions `ShareFeature` calls, never built by hand past the offer.
 */
class ShareOfferStagingLostTest {

    private val id = "s-Q3v9aP0kT7mR2xW8yB4nZc"
    private val a = "token-A"
    private val t0 = 1_000_000L
    private val size = 100_000L
    private val sha = "a".repeat(64)
    private val tx = "ts-AAAAAAAAAAAAAAAAAAAAAA"
    private val offered = ShareOffer.Offer(id, a, size, sha, t0, t0 + ShareOffer.TTL_MS, name = "x.bin")
    private val lost = State.Cancelled(Side.PHONE, "staging-lost")

    private fun accept(o: ShareOffer.Offer, intact: Boolean, version: Int = 2) =
        ShareOffer.respond(o, a, id, "accept", null, t0 + 1, negotiatedVersion = version, stagedIntact = intact)
    private fun sending() = ShareOffer.beginPull(accept(offered, true).offer!!, a, id, "0", tx, t0 + 2, 262144).offer!!
    private fun failedWithRetry() = ShareOffer.saved(
        ShareOffer.pullEnded(sending(), tx, PullEnd.SENT, t0 + 3).offer!!, a, id, false, 0, false, null, "interrupted", t0 + 4,
    ).offer!!
    private fun savedOk(o: ShareOffer.Offer) = ShareOffer.saved(o, a, id, true, size, true, "x.bin", null, t0 + 9)

    // ---- at Accept ---------------------------------------------------------------------------------

    @Test fun `an Accept for a copy that is gone is not acknowledged — the offer ends staging-lost and the Mac is told`() {
        val r = accept(offered, intact = false)
        assertEquals(lost, r.offer!!.state)
        assertEquals(Reply.Error("NOT_FOUND", ShareOffer.STAGING_LOST_MESSAGE), r.reply)
        assertTrue(Effect.SendCancel("staging-lost") in r.effects)
        assertTrue(Effect.DeleteStaged in r.effects)
        // Control: the same Accept with the copy intact is acknowledged.
        assertEquals(Reply.Ack(mapOf("offerId" to id, "state" to "accepted")), accept(offered, intact = true).reply)
    }

    @Test fun `at version 3 too, a lost copy is never queued`() {
        val r = accept(offered, intact = false, version = 3)
        assertEquals(lost, r.offer!!.state)
        assertFalse(r.effects.any { it is Effect.ScheduleQueueEnd })
    }

    @Test fun `a Decline is the person's answer and stands even when the copy is gone`() {
        val r = ShareOffer.respond(offered, a, id, "decline", "user", t0 + 1, negotiatedVersion = 2, stagedIntact = false)
        assertEquals(State.Declined("user"), r.offer!!.state)
    }

    // ---- while waiting ----------------------------------------------------------------------------

    @Test fun `a waiting offer whose copy is gone ends staging-lost — offered, accepted, or failed with a Retry open`() {
        listOf(offered, accept(offered, true).offer!!, accept(offered, true, version = 3).offer!!, failedWithRetry()).forEach { o ->
            val r = ShareOffer.stagingCheck(o, stagedIntact = false)
            assertEquals("from ${o.state}", lost, r.offer!!.state)
            assertEquals("from ${o.state}", listOf(Effect.SendCancel("staging-lost"), Effect.DeleteStaged), r.effects)
            assertNull("an event, not a reply", r.reply)
        }
    }

    @Test fun `an intact copy changes nothing, and a pull in flight is judged by its stream, not by this check`() {
        listOf(offered, accept(offered, true).offer!!, failedWithRetry()).forEach { o ->
            val r = ShareOffer.stagingCheck(o, stagedIntact = true)
            assertEquals(o, r.offer)
            assertTrue(r.effects.isEmpty())
        }
        val s = sending()
        assertEquals(s, ShareOffer.stagingCheck(s, stagedIntact = false).offer)
    }

    // ---- never Saved ------------------------------------------------------------------------------

    @Test fun `once staging-lost, nothing can pull it and no verdict can save it`() {
        val ended = ShareOffer.stagingCheck(accept(offered, true).offer!!, stagedIntact = false).offer!!
        assertEquals("NOT_FOUND", (ShareOffer.beginPull(ended, a, id, "0", tx, t0 + 5, 262144).reply as Reply.Error).code)
        val v = savedOk(ended)
        assertEquals("NOT_FOUND", (v.reply as Reply.Error).code)
        assertFalse(ShareOffer.reportsSaved(v.offer!!.state))
    }

    @Test fun `a copy that changed under the read ends staging-lost and cannot then be saved`() {
        val changed = ShareOffer.pullEnded(sending(), tx, PullEnd.SOURCE_CHANGED, t0 + 3)
        assertEquals(lost, changed.offer!!.state)
        assertTrue(Effect.SendCancel("staging-lost") in changed.effects)
        assertFalse(ShareOffer.reportsSaved(savedOk(changed.offer!!).offer!!.state))
        // Control: the same verdict after a clean send does save.
        val clean = ShareOffer.pullEnded(sending(), tx, PullEnd.SENT, t0 + 3).offer!!
        assertTrue(ShareOffer.reportsSaved(savedOk(clean).offer!!.state))
    }
}
