package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareOffer.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The sheet after Send: [reduce] from the phone's own offer states, [onLeave] for who owns the staged
 * copy, and [canWithdraw]. The inputs are the real `ShareOffer` transitions wherever a sequence matters
 * — the states here come out of `ShareOffer`'s functions, not out of the test's hands (CLAUDE.md,
 * the third variety: *what writes this field, and is that code in the test's reach?*).
 */
class ShareToMacFlowTest {

    private val name = "IMG_1.jpg"
    private val bytes = 4096L
    private val mac = "Chetan’s MacBook Pro"
    private val key = "session-A"
    private val id = "s-AAAAAAAAAAAAAAAAAAAAAA"
    private val t0 = 1_000_000L

    /** Drives the sheet through a list of offer states, from the moment of the offer. */
    private fun sheet(vararg s: State): ShareSheetState =
        s.fold<State, ShareSheetState>(ShareSheetState.WaitingForMac(name, bytes, mac)) { prev, st -> reduce(prev, name, bytes, mac, st) }

    private fun offer() = ShareOffer.Offer(id, key, bytes, "a".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = name)

    /** The real transitions: offered → accepted → sending → all sent. Returns every state visited. */
    private fun throughAllSent(): List<State> {
        val o0 = offer()
        val o1 = ShareOffer.respond(o0, key, id, "accept", null, t0 + 1, negotiatedVersion = 2, stagedIntact = true).offer!!
        val o2 = ShareOffer.beginPull(o1, key, id, "0", "ts-AAAAAAAAAAAAAAAAAAAAAA", t0 + 2, 65536).offer!!
        val o3 = ShareOffer.pullEnded(o2, "ts-AAAAAAAAAAAAAAAAAAAAAA", ShareOffer.PullEnd.SENT, t0 + 3).offer!!
        return listOf(o0.state, o1.state, o2.state, o3.state)
    }

    // ---- Saved only after the Mac's verified verdict --------------------------------------------

    @Test fun `every offer state maps to Saved exactly when it is the Mac's saved verdict`() {
        val every = listOf(
            State.Offered, State.Accepted, State.Sending, State.AwaitingVerdict, State.Failed("checksum"),
            State.Failed(ShareOffer.UNCONFIRMED), State.Saved("x"), State.Declined("user"), State.Expired,
            State.Cancelled(ShareOffer.Side.MAC, "user"), State.Cancelled(ShareOffer.Side.PHONE, "user"), State.SessionEnded,
        )
        val prevs = listOf<ShareSheetState>(
            ShareSheetState.WaitingForMac(name, bytes, mac),
            ShareSheetState.Sending(name, bytes, mac, allSent = false),
            ShareSheetState.Sending(name, bytes, mac, allSent = true),
            ShareSheetState.Unconfirmed(name, mac),
        )
        for (p in prevs) for (s in every) {
            assertEquals("$p + $s", ShareOffer.reportsSaved(s), reduce(p, name, bytes, mac, s) is ShareSheetState.Saved)
        }
    }

    @Test fun `the phone finishing its send is Sending-all-sent, never Saved`() {
        val visited = throughAllSent()
        assertEquals(State.AwaitingVerdict, visited.last())
        val s = sheet(*visited.toTypedArray())
        assertEquals(ShareSheetState.Sending(name, bytes, mac, allSent = true), s)
        assertFalse(canWithdraw(s))
    }

    @Test fun `the verified verdict from the Mac is what makes it Saved, under the Mac's name`() {
        val sent = throughAllSent()
        val o3 = ShareOffer.Offer(id, key, bytes, "a".repeat(64), t0, t0 + ShareOffer.TTL_MS, state = State.AwaitingVerdict, name = name,
            transferId = "ts-AAAAAAAAAAAAAAAAAAAAAA", verdictDueMs = t0 + 60_000)
        val saved = ShareOffer.saved(o3, key, id, ok = true, bytes = bytes, verified = true, savedAs = "IMG_1 (2).jpg", reason = null, nowMs = t0 + 4)
        val s = sheet(*(sent + saved.offer!!.state).toTypedArray())
        assertEquals(ShareSheetState.Saved(name, mac, "IMG_1 (2).jpg"), s)
    }

    // ---- lost confirmation -----------------------------------------------------------------------

    @Test fun `no verdict in time is Unconfirmed, and the Retry window closing does not turn it into nothing-saved`() {
        val o = ShareOffer.Offer(id, key, bytes, "a".repeat(64), t0, t0 + ShareOffer.TTL_MS, state = State.AwaitingVerdict, name = name,
            verdictDueMs = t0 + 60_000)
        val unconfirmed = ShareOffer.verdictDeadline(o, t0 + 60_000).offer!!
        assertEquals(State.Failed(ShareOffer.UNCONFIRMED), unconfirmed.state)
        val closed = ShareOffer.retryWindowClosed(unconfirmed, unconfirmed.retryUntilMs!!).offer!!
        assertEquals("control: the state machine calls the end Expired", State.Expired, closed.state)
        val s = sheet(State.Accepted, State.Sending, State.AwaitingVerdict, unconfirmed.state, closed.state)
        assertEquals(ShareSheetState.Unconfirmed(name, mac), s)
    }

    @Test fun `the session ending after every byte was sent is Unconfirmed, not a plain disconnect`() {
        assertEquals(ShareSheetState.Unconfirmed(name, mac), sheet(State.Accepted, State.Sending, State.AwaitingVerdict, State.SessionEnded))
    }

    @Test fun `a Mac Retry that then saves turns Unconfirmed into Saved`() {
        val s = sheet(State.AwaitingVerdict, State.Failed(ShareOffer.UNCONFIRMED), State.Sending, State.AwaitingVerdict, State.Saved("IMG_1.jpg"))
        assertEquals(ShareSheetState.Saved(name, mac, "IMG_1.jpg"), s)
    }

    // ---- disconnected Mac ------------------------------------------------------------------------

    @Test fun `a disconnect while waiting says nothing was sent, and mid-transfer says it was not confirmed`() {
        assertEquals(ShareSheetState.Stopped(name, mac, ShareSheetState.StopReason.DISCONNECTED), sheet(State.SessionEnded))
        assertEquals(
            ShareSheetState.Stopped(name, mac, ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER),
            sheet(State.Accepted, State.Sending, State.SessionEnded),
        )
    }

    // ---- expiry, decline, cancel, space ----------------------------------------------------------

    @Test fun `an offer nobody answered expires - never declined`() {
        val expired = ShareOffer.expire(offer(), t0 + ShareOffer.TTL_MS).offer!!.state
        assertEquals(ShareSheetState.Stopped(name, mac, ShareSheetState.StopReason.EXPIRED), sheet(expired))
    }

    @Test fun `each Mac decline reason has its own stop reason, and only user is a person's`() {
        val got = ShareOffer.DECLINE_REASONS.associateWith { r ->
            (sheet(ShareOffer.respond(offer(), key, id, "decline", r, t0 + 1, stagedIntact = true).offer!!.state) as ShareSheetState.Stopped).why
        }
        assertEquals(ShareSheetState.StopReason.DECLINED_BY_PERSON, got["user"])
        assertEquals(ShareSheetState.StopReason.DECLINED_NO_SPACE_ON_MAC, got["insufficient-space"])
        assertEquals(ShareSheetState.StopReason.DECLINED_NOT_AVAILABLE, got["not-available"])
        assertEquals(listOf("user"), got.filterValues { it.byPerson }.keys.toList())
    }

    @Test fun `withdrawing here and stopping on the Mac are told apart`() {
        val here = ShareOffer.cancelFromPhone(offer(), "user").offer!!.state
        val there = ShareOffer.cancelFromMac(offer(), key, id, "user", t0 + 1).offer!!.state
        assertEquals(ShareSheetState.StopReason.CANCELLED_HERE, (sheet(here) as ShareSheetState.Stopped).why)
        assertEquals(ShareSheetState.StopReason.CANCELLED_ON_MAC, (sheet(there) as ShareSheetState.Stopped).why)
    }

    @Test fun `a failed save on the Mac keeps the offer open for a Mac Retry`() {
        val s = sheet(State.Accepted, State.Sending, State.Failed("insufficient-space"))
        assertEquals(ShareSheetState.SendFailed(name, mac, "insufficient-space"), s)
        assertEquals(SheetExit.LEAVE_TO_OFFER, onLeave(s))
    }

    // ---- staging cleanup: who owns the copy ------------------------------------------------------

    @Test fun `before an offer leaving deletes the copy - after it the offer owns it - at an end there is nothing left`() {
        for (s in ShareToMacCopy.everyState()) {
            val expected = when (s) {
                ShareSheetState.Starting, is ShareSheetState.Preparing, is ShareSheetState.Ready -> SheetExit.DISCARD_STAGED
                is ShareSheetState.WaitingForMac, is ShareSheetState.Sending, is ShareSheetState.SendFailed -> SheetExit.LEAVE_TO_OFFER
                else -> SheetExit.NOTHING
            }
            assertEquals("$s", expected, onLeave(s))
        }
    }

    @Test fun `LEAVE_TO_OFFER is safe only because every end of the offer deletes the copy - checked against the state machine`() {
        // The claim onLeave rests on, asserted where it lives: each way an offered copy can end carries
        // DeleteStaged. If a new end ever forgets it, leaving an offered sheet would leak the copy.
        val o = offer()
        val ends = listOf(
            ShareOffer.respond(o, key, id, "decline", "user", t0 + 1, stagedIntact = true),
            ShareOffer.expire(o, t0 + ShareOffer.TTL_MS),
            ShareOffer.cancelFromPhone(o, "user"),
            ShareOffer.cancelFromMac(o, key, id, "user", t0 + 1),
            ShareOffer.sessionEnded(o, key),
        )
        for (r in ends) {
            assertFalse("${r.offer?.state}", ShareOffer.isLive(r.offer!!.state))
            assertTrue("${r.offer?.state}", ShareOffer.Effect.DeleteStaged in r.effects)
        }
    }

    @Test fun `Cancel withdraws only while nothing may have reached the Mac`() {
        assertTrue(canWithdraw(ShareSheetState.WaitingForMac(name, bytes, mac)))
        assertTrue(canWithdraw(ShareSheetState.Sending(name, bytes, mac, allSent = false)))
        assertFalse(canWithdraw(ShareSheetState.Sending(name, bytes, mac, allSent = true)))
        assertFalse(canWithdraw(ShareSheetState.Unconfirmed(name, mac)))
        assertFalse(canWithdraw(ShareSheetState.Ready(name, "b/c", bytes, Availability.Available(mac))))
    }
}

/**
 * The silent Send (2026-09-25): a second file's Send while the first waits on the Mac. Two synthetic
 * files; the second sheet's transitions are driven from the **real** `ShareOffer` states of the first,
 * and the rule deciding Busy is `ShareOffer.busyWith`, which `ShareFeature` calls.
 */
class ShareToMacBusyTest {

    private val t0 = 1_000_000L
    private val firstOffer = ShareOffer.Offer("s-AAAAAAAAAAAAAAAAAAAAAA", "token-A", 230_778, "1".repeat(64), t0, t0 + ShareOffer.TTL_MS, name = "synthetic-1.png")
    private val second = ShareSheetState.Ready("synthetic-2.png", "image/png", 100_718, Availability.Available("Chetan’s MacBook Pro"))

    private fun busy(): ShareSheetState.Ready = onBusy(second, ShareOffer.busyWith(listOf(firstOffer), "token-A")!!)

    @Test fun `a busy Send is never silent - the headline changes and names the waiting file`() {
        val s = busy()
        assertEquals("Another file is waiting for approval on your Mac", ShareToMacCopy.headline(s))
        val words = ShareToMacCopy.busy(s.waitingOther)
        assertTrue(words, words.contains("“synthetic-1.png” is waiting for approval"))
        assertTrue(words, words.contains("still prepared here and was not sent"))
        assertTrue(ShareToMacCopy.headline(second) != ShareToMacCopy.headline(s))
    }

    @Test fun `busy - Send is disabled rather than a dead tap, and the other file can be withdrawn`() {
        assertTrue("control: the ready sheet can send", canSend(second))
        val s = busy()
        assertFalse(canSend(s))
        assertTrue(canWithdrawOther(s))
    }

    @Test fun `neither file is discarded - this one stays the sheet's, the first stays as it was`() {
        val s = busy()
        assertEquals(SheetExit.DISCARD_STAGED, onLeave(s)) // still this sheet's prepared copy, not given away
        assertEquals(100_718L, s.bytes)
        assertEquals("synthetic-2.png", s.name)
        assertEquals(State.Offered, firstOffer.state)
    }

    @Test fun `when the first is declined, cancelled, expired or saved, the note clears and Send works again`() {
        val ended = listOf(
            ShareOffer.respond(firstOffer, "token-A", firstOffer.offerId, "decline", "user", t0 + 1, negotiatedVersion = 2, stagedIntact = true).offer!!.state,
            ShareOffer.cancelFromPhone(firstOffer, "user").offer!!.state,
            State.Expired,
            State.Saved("synthetic-1.png"),
            null, // no longer held at all
        )
        for (st in ended) {
            val after = afterOtherChanged(busy(), st)
            assertTrue("$st", canSend(after))
            assertEquals("$st", "Ready on this phone", ShareToMacCopy.headline(after))
        }
    }

    @Test fun `once the first is accepted it cannot be withdrawn from here, and the sheet says it is being sent`() {
        val accepted = ShareOffer.respond(firstOffer, "token-A", firstOffer.offerId, "accept", null, t0 + 1, negotiatedVersion = 2, stagedIntact = true).offer!!
        val after = afterOtherChanged(busy(), accepted.state)
        assertFalse(canWithdrawOther(after))
        assertFalse(canSend(after))
        assertEquals("Another file is being sent to your Mac", ShareToMacCopy.headline(after))
    }

    @Test fun `a sheet that is not busy is not touched by the other offer's changes`() {
        assertSame(second, afterOtherChanged(second, State.Expired))
    }
}
