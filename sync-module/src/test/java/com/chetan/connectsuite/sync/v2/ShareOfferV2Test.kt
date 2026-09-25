package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.sync.v2.ShareOffer.Effect
import com.chetan.connectsuite.sync.v2.ShareOffer.PullEnd
import com.chetan.connectsuite.sync.v2.ShareOffer.Reply
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Version 2 of the offer (docs/protocol.md → Share → Version 2), through the transitions
 * `ShareFeature` calls. The rule above all the others: **only `saved {ok:true}` reaches Saved.**
 */
class ShareOfferV2Test {

    private val id = "s-Q3v9aP0kT7mR2xW8yB4nZc"
    private val a = "token-A"
    private val b = "token-B"
    private val t0 = 1_000_000L
    private val size = 100_000L
    private val sha = "a".repeat(64)
    private val tx = "ts-AAAAAAAAAAAAAAAAAAAAAA"
    private val offered = ShareOffer.Offer(id, a, size, sha, t0, t0 + ShareOffer.TTL_MS, name = "x.bin")

    private fun code(r: ShareOffer.Result) = (r.reply as Reply.Error).code
    private fun accepted() = ShareOffer.respond(offered, a, id, "accept", null, t0 + 1, negotiatedVersion = 2).offer!!
    private fun sending() = ShareOffer.beginPull(accepted(), a, id, "0", tx, t0 + 2, 262144).offer!!
    private fun awaiting() = ShareOffer.pullEnded(sending(), tx, PullEnd.SENT, t0 + 3).offer!!
    private fun saved(o: ShareOffer.Offer?, from: String = a, ok: Boolean? = true, bytes: Long? = size, verified: Boolean? = true,
                      savedAs: String? = "x.bin", reason: String? = null, now: Long = t0 + 4) =
        ShareOffer.saved(o, from, id, ok, bytes, verified, savedAs, reason, now)

    // ---- negotiation ----------------------------------------------------------------------------

    @Test fun `the live pairing is version 1 — the phone advertises 1, so accept is refused and nothing is pulled`() {
        val live = Extensions.negotiate(Extensions.PHONE, mapOf(Extensions.SHARE_FILE to 2), Extensions.SHARE_FILE)
        assertEquals("a v2 Mac against this phone negotiates 1", 1, live)
        val r = ShareOffer.respond(offered, a, id, "accept", null, t0 + 1, negotiatedVersion = live!!)
        assertEquals("BAD_REQUEST", code(r))
        assertEquals(State.Offered, r.offer!!.state)
        assertEquals("NOT_FOUND", code(ShareOffer.beginPull(r.offer, a, id, "0", tx, t0 + 2, 1)))
    }

    /**
     * Runbook §1: every handshake the phone's gate leaves below 2 is a version-1 session, where the
     * phone refuses `accept` and authorises no pull. Driven through the real [Extensions.handshake],
     * not a hand-written version number, so the session fact is the one the gate produced.
     */
    @Test fun `every fail-closed handshake is a v1 session — accept refused, offer still live, no pull`() {
        val macs = listOf(emptyMap(), mapOf(Extensions.SHARE_FILE to 1), mapOf(Extensions.SHARE_FILE to 2))
        var checked = 0
        for (debuggable in listOf(false, true)) for (armed in listOf(false, true)) for (mac in macs) {
            if (debuggable && armed && mac == mapOf(Extensions.SHARE_FILE to 2)) continue
            val version = Extensions.handshake(debuggable, armed, mac, productionTransfer = false).negotiated[Extensions.SHARE_FILE] ?: 0
            assertTrue("debuggable=$debuggable armed=$armed mac=$mac", version < ShareOffer.TRANSFER_VERSION)
            val r = ShareOffer.respond(offered, a, id, "accept", null, t0 + 1, negotiatedVersion = version)
            assertEquals("BAD_REQUEST", code(r))
            assertEquals(State.Offered, r.offer!!.state)
            assertEquals("NOT_FOUND", code(ShareOffer.beginPull(r.offer, a, id, "0", tx, t0 + 2, 1)))
            checked += 1
        }
        assertEquals("all eleven fail-closed combinations were exercised", 11, checked)
        // The control: the one combination that negotiates 2 does accept.
        val v2 = Extensions.handshake(true, true, mapOf(Extensions.SHARE_FILE to 2)).negotiated[Extensions.SHARE_FILE]!!
        assertEquals(State.Accepted, ShareOffer.respond(offered, a, id, "accept", null, t0 + 1, negotiatedVersion = v2).offer!!.state)
    }

    @Test fun `accept at version 2 acks accepted and moves nothing yet`() {
        val r = ShareOffer.respond(offered, a, id, "accept", null, t0 + 1, negotiatedVersion = 2)
        assertEquals(State.Accepted, r.offer!!.state)
        assertEquals(Reply.Ack(mapOf("offerId" to id, "state" to "accepted")), r.reply)
        assertTrue(r.effects.isEmpty())
    }

    @Test fun `accept is answered once — a second accept or a decline after it finds nothing`() {
        assertEquals("NOT_FOUND", code(ShareOffer.respond(accepted(), a, id, "accept", null, t0 + 2, 2)))
        assertEquals("NOT_FOUND", code(ShareOffer.respond(accepted(), a, id, "decline", "user", t0 + 2, 2)))
    }

    // ---- the one pull ---------------------------------------------------------------------------

    @Test fun `the authorised pull — item 0, own session, after accept — acks offset 0 and registers the pull`() {
        val r = ShareOffer.beginPull(accepted(), a, id, "0", tx, t0 + 2, 262144)
        assertEquals(State.Sending, r.offer!!.state)
        val ack = (r.reply as Reply.Ack).fields
        assertEquals(0L, ack["offset"])
        assertEquals(tx, ack["transferId"])
        assertEquals(size, ack["size"])
        assertEquals(sha, ack["sha256"])
        assertEquals(listOf(Effect.RegisterPull(tx)), r.effects)
    }

    @Test fun `a pull is refused for any item but 0`() {
        listOf("1", "", null, "../0").forEach { assertEquals("item $it", "NOT_FOUND", code(ShareOffer.beginPull(accepted(), a, id, it, tx, t0 + 2, 1))) }
    }

    @Test fun `a pull from another session is refused and changes nothing`() {
        val r = ShareOffer.beginPull(accepted(), b, id, "0", tx, t0 + 2, 1)
        assertEquals("NOT_FOUND", code(r))
        assertEquals(State.Accepted, r.offer!!.state)
        assertTrue(r.effects.isEmpty())
    }

    @Test fun `a pull before accept, while one is live, or after the offer ended is refused`() {
        assertEquals("before accept", "NOT_FOUND", code(ShareOffer.beginPull(offered, a, id, "0", tx, t0 + 2, 1)))
        assertEquals("second while sending", "NOT_FOUND", code(ShareOffer.beginPull(sending(), a, id, "0", "ts-BBBBBBBBBBBBBBBBBBBBBB", t0 + 3, 1)))
        val declined = ShareOffer.respond(offered, a, id, "decline", "user", t0 + 1, 2).offer!!
        assertEquals("after decline", "NOT_FOUND", code(ShareOffer.beginPull(declined, a, id, "0", tx, t0 + 2, 1)))
    }

    @Test fun `an accepted offer past its expiry expires on the pull instead of streaming`() {
        val r = ShareOffer.beginPull(accepted(), a, id, "0", tx, offered.expiresAtMs, 1)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("expired"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `a Files-style transfer id cannot be used for a share pull`() {
        try {
            ShareOffer.beginPull(accepted(), a, id, "0", "t-7-12345", t0 + 2, 1); throw AssertionError("accepted a predictable id")
        } catch (_: IllegalArgumentException) { }
    }

    // ---- the phone's own send is not a save -----------------------------------------------------

    @Test fun `the phone finishing its send awaits a verdict — it is never Saved`() {
        val r = ShareOffer.pullEnded(sending(), tx, PullEnd.SENT, t0 + 3)
        assertEquals(State.AwaitingVerdict, r.offer!!.state)
        assertEquals(listOf(Effect.ScheduleVerdictDeadline(t0 + 3 + ShareOffer.VERDICT_DEADLINE_MS)), r.effects)
        assertFalse(r.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `a failed stream also awaits the Mac's verdict, bounded by the deadline`() {
        assertEquals(State.AwaitingVerdict, ShareOffer.pullEnded(sending(), tx, PullEnd.FAILED, t0 + 3).offer!!.state)
    }

    @Test fun `staged-file loss during the stream ends the offer as staging-lost`() {
        val r = ShareOffer.pullEnded(sending(), tx, PullEnd.SOURCE_CHANGED, t0 + 3)
        assertEquals(State.Cancelled(ShareOffer.Side.PHONE, "staging-lost"), r.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("staging-lost"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `staged-file loss before the pull (the caller's check) ends it as staging-lost`() {
        val r = ShareOffer.cancelFromPhone(accepted(), "staging-lost")
        assertEquals(State.Cancelled(ShareOffer.Side.PHONE, "staging-lost"), r.offer!!.state)
        assertEquals(Effect.DeleteStaged, r.effects.last())
    }

    @Test fun `an end for a different transfer id changes nothing`() {
        assertTrue(ShareOffer.pullEnded(sending(), "ts-ZZZZZZZZZZZZZZZZZZZZZZ", PullEnd.SENT, t0 + 3).effects.isEmpty())
    }

    // ---- share.saved ----------------------------------------------------------------------------

    @Test fun `only a verified, full-size saved from the Mac reaches Saved, and it deletes the staged copy`() {
        val r = saved(awaiting())
        assertEquals(State.Saved("x.bin"), r.offer!!.state)
        assertEquals(Reply.Ack(mapOf("offerId" to id, "state" to "saved")), r.reply)
        assertEquals(listOf(Effect.DeleteStaged), r.effects)
    }

    @Test fun `a saved that races ahead of the phone's own end is still honoured`() {
        assertEquals(State.Saved("x.bin"), saved(sending()).offer!!.state)
    }

    @Test fun `a saved that is unverified or of the wrong size is a Mac fault and changes nothing`() {
        listOf(saved(awaiting(), verified = false), saved(awaiting(), bytes = size - 1), saved(awaiting(), verified = null)).forEach { r ->
            assertEquals("BAD_REQUEST", code(r))
            assertEquals(State.AwaitingVerdict, r.offer!!.state)
        }
    }

    @Test fun `savedAs must be a file name, never a path`() {
        assertEquals("BAD_REQUEST", code(saved(awaiting(), savedAs = "/Users/me/Downloads/x.bin")))
        assertEquals("BAD_REQUEST", code(saved(awaiting(), savedAs = "")))
    }

    @Test fun `a verdict from another session, before any pull, or a duplicate verdict finds nothing`() {
        assertEquals("other session", "NOT_FOUND", code(saved(awaiting(), from = b)))
        assertEquals("before any pull", "NOT_FOUND", code(saved(accepted())))
        val first = saved(awaiting())
        assertEquals("duplicate", "NOT_FOUND", code(saved(first.offer)))
        assertTrue(saved(first.offer).effects.isEmpty())
    }

    @Test fun `a failed save opens the Retry window and keeps the staged copy`() {
        val r = saved(awaiting(), ok = false, reason = "checksum")
        assertEquals(State.Failed("checksum"), r.offer!!.state)
        assertEquals(Reply.Ack(mapOf("offerId" to id, "state" to "failed")), r.reply)
        val until = t0 + 4 + ShareOffer.RETRY_WINDOW_MS
        assertEquals(until, r.offer!!.retryUntilMs)
        assertEquals(listOf(Effect.ScheduleRetryClose(until)), r.effects)
        assertFalse(r.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `a failed save while still sending stops the live pull`() {
        val r = saved(sending(), ok = false, reason = "interrupted")
        assertEquals(listOf(Effect.CancelPull(tx), Effect.ScheduleRetryClose(t0 + 4 + ShareOffer.RETRY_WINDOW_MS)), r.effects)
    }

    @Test fun `an unknown failure reason is refused`() {
        assertEquals("BAD_REQUEST", code(saved(awaiting(), ok = false, reason = "gremlins")))
        assertEquals("BAD_REQUEST", code(saved(awaiting(), ok = null)))
    }

    // ---- no verdict, retry, deadlines -----------------------------------------------------------

    @Test fun `no verdict in time is failed (unconfirmed) — never saved`() {
        val due = awaiting().verdictDueMs!!
        assertTrue(ShareOffer.verdictDeadline(awaiting(), due - 1).effects.isEmpty())
        val r = ShareOffer.verdictDeadline(awaiting(), due)
        assertEquals(State.Failed("unconfirmed"), r.offer!!.state)
        assertFalse(r.offer!!.state is State.Saved)
    }

    // ---- saved on the Mac, verdict lost (Task B) --------------------------------------------------

    /**
     * The Mac published and its `share.saved` never arrived. The phone's state is a fact about what
     * it was told, not what happened: it must not say saved, and its sentence must say the file
     * *may* be on the Mac rather than that sending failed.
     */
    @Test fun `unconfirmed does not report saved, and says the Mac may have kept it`() {
        val state = ShareOffer.verdictDeadline(awaiting(), awaiting().verdictDueMs!!).offer!!.state
        assertEquals(State.Failed(ShareOffer.UNCONFIRMED), state)
        assertFalse(ShareOffer.reportsSaved(state))
        val words = ShareOffer.describe(state)
        assertFalse("must not read as saved: $words", words.startsWith("saved"))
        assertTrue("must say it may be on the Mac: $words", words.contains("may"))
        assertFalse("must not read as a plain failure: $words", words.startsWith("failed"))
    }

    @Test fun `a verdict arriving after the deadline is NOT_FOUND and leaves the offer unconfirmed, never saved late`() {
        val unconfirmed = ShareOffer.verdictDeadline(awaiting(), awaiting().verdictDueMs!!).offer!!
        val late = saved(unconfirmed)
        assertEquals("NOT_FOUND", code(late))
        assertEquals(State.Failed(ShareOffer.UNCONFIRMED), late.offer!!.state)
        assertFalse(late.effects.contains(Effect.DeleteStaged))
    }

    @Test fun `only the Saved state reports saved — every other state says no`() {
        val all = listOf(
            State.Offered, State.Accepted, State.Sending, State.AwaitingVerdict,
            State.Failed(ShareOffer.UNCONFIRMED), State.Failed("checksum"), State.Declined("user"),
            State.Expired, State.Cancelled(ShareOffer.Side.MAC, "user"), State.SessionEnded,
        )
        for (st in all) assertFalse("$st", ShareOffer.reportsSaved(st))
        assertTrue(ShareOffer.reportsSaved(State.Saved("x.bin")))
        // The control: Saved is reachable, and only through the Mac's verdict.
        assertEquals(State.Saved("x.bin"), saved(awaiting()).offer!!.state)
    }

    @Test fun `a retry within the window pulls again from byte 0 with a fresh id`() {
        val failed = saved(awaiting(), ok = false, reason = "checksum").offer!!
        val tx2 = "ts-CCCCCCCCCCCCCCCCCCCCCC"
        val r = ShareOffer.beginPull(failed, a, id, "0", tx2, t0 + 10, 1)
        assertEquals(State.Sending, r.offer!!.state)
        assertEquals(0L, (r.reply as Reply.Ack).fields["offset"])
        assertEquals(tx2, r.offer!!.transferId)
    }

    @Test fun `a retry after the window closed expires instead`() {
        val failed = saved(awaiting(), ok = false, reason = "checksum").offer!!
        val r = ShareOffer.beginPull(failed, a, id, "0", "ts-CCCCCCCCCCCCCCCCCCCCCC", failed.retryUntilMs!!, 1)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals(Effect.DeleteStaged, r.effects.last())
    }

    @Test fun `the Retry window closing expires the offer, tells the Mac, and deletes the copy`() {
        val failed = saved(awaiting(), ok = false, reason = "checksum").offer!!
        assertTrue(ShareOffer.retryWindowClosed(failed, failed.retryUntilMs!! - 1).effects.isEmpty())
        val r = ShareOffer.retryWindowClosed(failed, failed.retryUntilMs!!)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals(listOf(Effect.SendCancel("expired"), Effect.DeleteStaged), r.effects)
    }

    @Test fun `the Retry window never runs past the offer's own expiry`() {
        val late = t0 + ShareOffer.TTL_MS - 1000
        val r = saved(awaiting(), ok = false, reason = "checksum", now = late)
        assertEquals(offered.expiresAtMs, r.offer!!.retryUntilMs)
    }

    @Test fun `a failure at or past the offer's expiry ends it at once`() {
        val r = saved(awaiting(), ok = false, reason = "checksum", now = offered.expiresAtMs)
        assertEquals(State.Expired, r.offer!!.state)
        assertEquals(Effect.DeleteStaged, r.effects.last())
    }

    @Test fun `the offer-expiry timer does not cut a pull in progress or awaiting its verdict`() {
        assertTrue(ShareOffer.expire(sending(), Long.MAX_VALUE).effects.isEmpty())
        assertTrue(ShareOffer.expire(awaiting(), Long.MAX_VALUE).effects.isEmpty())
        assertEquals(State.Expired, ShareOffer.expire(accepted(), offered.expiresAtMs).offer!!.state)
    }

    // ---- cancel and session during a pull -------------------------------------------------------

    @Test fun `cancel from the Mac during a pull stops it and deletes the copy`() {
        val r = ShareOffer.cancelFromMac(sending(), a, id, "user", t0 + 3)
        assertEquals(listOf(Effect.CancelPull(tx), Effect.DeleteStaged), r.effects)
    }

    @Test fun `fs transfer cancel of a share pull works only from its own session`() {
        assertEquals("NOT_FOUND", code(ShareOffer.cancelPull(sending(), b, tx)))
        assertTrue(ShareOffer.cancelPull(sending(), b, tx).effects.isEmpty())
        val own = ShareOffer.cancelPull(sending(), a, tx)
        assertEquals(Reply.Ack(mapOf("transferId" to tx, "stopped" to true)), own.reply)
        assertEquals(listOf(Effect.CancelPull(tx), Effect.DeleteStaged), own.effects)
        assertEquals("NOT_FOUND", code(ShareOffer.cancelPull(sending(), a, "ts-ZZZZZZZZZZZZZZZZZZZZZZ")))
    }

    @Test fun `the session ending mid-pull stops the pull and deletes the copy`() {
        assertEquals(listOf(Effect.CancelPull(tx), Effect.DeleteStaged), ShareOffer.sessionEnded(sending(), a).effects)
        assertEquals(listOf(Effect.DeleteStaged), ShareOffer.sessionEnded(awaiting(), a).effects)
    }

    @Test fun `every version-2 end deletes the staged copy last`() {
        val failed = saved(awaiting(), ok = false, reason = "checksum").offer!!
        val ends = listOf(
            saved(awaiting()),
            ShareOffer.pullEnded(sending(), tx, PullEnd.SOURCE_CHANGED, t0 + 3),
            ShareOffer.cancelFromMac(sending(), a, id, "user", t0 + 3),
            ShareOffer.cancelPull(sending(), a, tx),
            ShareOffer.sessionEnded(awaiting(), a),
            ShareOffer.retryWindowClosed(failed, failed.retryUntilMs!!),
            ShareOffer.beginPull(accepted(), a, id, "0", tx, offered.expiresAtMs, 1),
        )
        ends.forEach { r ->
            assertFalse(ShareOffer.isLive(r.offer!!.state))
            assertEquals("${r.offer!!.state}", Effect.DeleteStaged, r.effects.last())
        }
    }
}
