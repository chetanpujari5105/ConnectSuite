package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The sheet's sentences, read from the one enumeration the sheet draws from. Each claim is about a
 * **state's type**, not about two sentences being unlike each other (CLAUDE.md, the fourth variety):
 * the Saved wording appears exactly on [ShareSheetState.Saved], the declined wording exactly on a
 * stop reason whose `byPerson` is true, and so on.
 */
class ShareToMacCopyTest {

    private val states = ShareToMacCopy.everyState()
    private val all = ShareToMacCopy.everySentence().filter { it.isNotBlank() }

    @Test fun `the enumeration reaches every state (control)`() {
        assertTrue(all.size >= 60)
        // One of each class, so a new state that is never enumerated fails here rather than going unread.
        val kinds = states.map { it::class }.toSet()
        assertEquals(11, kinds.size)
    }

    @Test fun `Ready says the file is prepared on this phone and not sent`() {
        val ready = ShareToMacCopy.detail(ShareSheetState.Ready("a.bin", "application/octet-stream", 100_000, Availability.NotConnected))
        assertTrue(ready, ready.contains("Prepared privately on this phone"))
        assertTrue(ready, ready.contains("has not been sent"))
        assertEquals("Ready on this phone", ShareToMacCopy.headline(ShareSheetState.Ready("a", "b/c", 0, Availability.NotConnected)))
    }

    @Test fun `the Saved wording appears on the Saved state and on no other`() {
        for (s in states) {
            val saidSaved = ShareToMacCopy.headline(s).startsWith("Saved") || ShareToMacCopy.detail(s).contains("saved it as")
            assertEquals("$s", s is ShareSheetState.Saved, saidSaved)
        }
    }

    @Test fun `a state before any offer never places anything on the Mac`() {
        val before = states.filter {
            it is ShareSheetState.Starting || it is ShareSheetState.Refused || it is ShareSheetState.Preparing ||
                it is ShareSheetState.Ready || it is ShareSheetState.Failed
        }
        assertTrue("control: the pre-offer states were found", before.size >= 15)
        for (s in before) {
            val text = ShareToMacCopy.headline(s) + " " + ShareToMacCopy.detail(s)
            assertFalse(text, Regex("\\b(saved|accepted|offered)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text))
        }
    }

    @Test fun `only a decline or cancel a person made is worded as one - not-available never is`() {
        for (why in ShareSheetState.StopReason.values()) {
            val text = ShareToMacCopy.detail(ShareSheetState.Stopped("a.bin", "Mac", why))
            val saysPerson = Regex("\\b(declined it|Someone)\\b").containsMatchIn(text) || text.startsWith("Withdrawn") ||
                text.contains("stopped on")
            assertEquals("$why: $text", why.byPerson, saysPerson)
        }
    }

    @Test fun `an expiry is never called a decline`() {
        val s = ShareSheetState.Stopped("a.bin", "Mac", ShareSheetState.StopReason.EXPIRED)
        assertEquals("Expired", ShareToMacCopy.headline(s))
        assertFalse(ShareToMacCopy.detail(s).contains("declin", ignoreCase = true))
    }

    @Test fun `unconfirmed says the Mac may have it, and never that it was saved or not saved`() {
        val s = ShareSheetState.Unconfirmed("a.bin", "Mac")
        val text = ShareToMacCopy.headline(s) + " " + ShareToMacCopy.detail(s)
        assertTrue(text, text.contains("may or may not be there"))
        assertFalse(text, text.contains("Nothing was saved"))
        assertFalse(text, text.contains("Nothing was sent"))
    }

    @Test fun `a Mac that ran out of space is named as the cause, distinct from the phone's own space failure`() {
        val mac = ShareToMacCopy.detail(ShareSheetState.Stopped("a.bin", "Mac", ShareSheetState.StopReason.DECLINED_NO_SPACE_ON_MAC))
        val phone = ShareToMacCopy.detail(ShareSheetState.Failed("a.bin", ShareSheetState.Failure.NoSpace(10, 1)))
        assertTrue(mac, mac.startsWith("Mac doesn’t have enough free space"))
        assertTrue(phone, phone.startsWith("Not enough space on this phone"))
    }

    @Test fun `a duplicate saved under another name reports the Mac's name for it`() {
        val s = ShareSheetState.Saved("IMG_1.jpg", "Mac", "IMG_1 (2).jpg")
        val text = ShareToMacCopy.detail(s)
        assertTrue(text, text.contains("“IMG_1 (2).jpg”"))
        assertFalse("does not guess why the name differs", text.contains("because"))
    }

    @Test fun `no Mac, an old or synthetic-only Mac, and a Mac that asks each get their own sentence`() {
        val off = ShareToMacCopy.availability(Availability.NotConnected)
        val old = ShareToMacCopy.availability(Availability.NotSupported("Chetan’s MacBook Pro"))
        val ok = ShareToMacCopy.availability(Availability.Available("Chetan’s MacBook Pro"))
        assertTrue(off, off.contains("isn’t connected"))
        assertTrue(old, old.contains("Chetan’s MacBook Pro") && old.contains("can’t receive files"))
        assertTrue(ok, ok.contains("will ask you to accept it"))
    }

    @Test fun `no sentence carries a package id`() {
        val pkg = Regex("\\b[a-z][a-z0-9_]*(\\.[a-z0-9_]+){2,}\\b")
        all.forEach { assertFalse(it, pkg.containsMatchIn(it)) }
    }

    @Test fun `sizes show the exact count and then a human form`() {
        assertEquals("0 bytes", ShareToMacCopy.bytes(0))
        assertEquals("100,000 bytes (97.7 KB)", ShareToMacCopy.bytes(100_000))
        assertEquals("230,778 bytes (225 KB)", ShareToMacCopy.bytes(230_778))
    }

    /**
     * Version 3: a file the Mac accepted but has not started pulling — it waits behind another — is not
     * called sending. Version 2's Accepted (the moment before its pull) is unchanged.
     */
    @Test fun `a queued version-3 file says waiting its turn, not sending - version 2 is unchanged`() {
        val offered = ShareSheetState.WaitingForMac("a.jpg", 230_778, "Mac")
        val queued = reduce(offered, "a.jpg", 230_778, "Mac", com.chetan.connectsuite.sync.v2.ShareOffer.State.Accepted, queued = true)
        assertEquals("Accepted on Mac — waiting its turn", ShareToMacCopy.headline(queued))
        assertEquals("It starts on its own when the file ahead of it finishes. Nothing of it is on your Mac yet.", ShareToMacCopy.detail(queued))
        assertFalse(ShareToMacCopy.headline(queued).startsWith("Send"))
        val v2 = reduce(offered, "a.jpg", 230_778, "Mac", com.chetan.connectsuite.sync.v2.ShareOffer.State.Accepted)
        assertEquals("version 2 unchanged", "Sending to Mac…", ShareToMacCopy.headline(v2))
        val pulling = reduce(queued, "a.jpg", 230_778, "Mac", com.chetan.connectsuite.sync.v2.ShareOffer.State.Sending)
        assertEquals("its turn came", "Sending to Mac…", ShareToMacCopy.headline(pulling))
        assertEquals("the several-files row says the same", ShareManyCopy.detail(
            ShareManyRow.After("a.jpg", queued, queued = true), "Mac"), ShareToMacCopy.detail(queued))
    }

    private val v3 = com.chetan.connectsuite.sync.v2.ShareOffer.State.Accepted
    private val pulling = com.chetan.connectsuite.sync.v2.ShareOffer.State.Sending
    private val ended = com.chetan.connectsuite.sync.v2.ShareOffer.State.SessionEnded
    private val offered = ShareSheetState.WaitingForMac("a.jpg", 230_778, "Mac")
    private fun queued() = reduce(offered, "a.jpg", 230_778, "Mac", v3, queued = true)

    @Test fun `a queued file draws no transfer bar - a pull under way and a verdict awaited still do`() {
        assertFalse("queued: nothing is moving", showsTransferProgress(queued()))
        assertTrue("pulling", showsTransferProgress(ShareSheetState.Sending("a.jpg", 230_778, "Mac", allSent = false)))
        assertTrue("every byte left, verdict awaited (unchanged)", showsTransferProgress(ShareSheetState.Sending("a.jpg", 230_778, "Mac", allSent = true)))
        assertTrue("version 2 Accepted (unchanged)", showsTransferProgress(reduce(offered, "a.jpg", 230_778, "Mac", v3)))
        assertFalse("not offered to anyone yet", showsTransferProgress(offered))
    }

    @Test fun `queued then its turn comes - it becomes an ordinary transfer, bar and wording`() {
        val s = reduce(queued(), "a.jpg", 230_778, "Mac", pulling)
        assertEquals(ShareSheetState.Sending("a.jpg", 230_778, "Mac", allSent = false), s)
        assertTrue(showsTransferProgress(s))
        assertEquals("Sending to Mac…", ShareToMacCopy.headline(s))
    }

    @Test fun `queued then the connection ends - a before-transfer reason, never a dropped transfer`() {
        val s = reduce(queued(), "a.jpg", 230_778, "Mac", ended)
        assertEquals(ShareSheetState.Stopped("a.jpg", "Mac", ShareSheetState.StopReason.DISCONNECTED_BEFORE_TRANSFER), s)
        assertEquals("Mac disconnected", ShareToMacCopy.headline(s))
        assertEquals("The connection to Mac ended while it was waiting its turn. Nothing was sent.", ShareToMacCopy.detail(s))
        assertFalse("never a transfer that dropped", ShareToMacCopy.detail(s).contains("during the transfer"))
        assertFalse(showsTransferProgress(s))
    }

    @Test fun `a transfer under way, and version 2's Accepted, still end as a dropped transfer - unchanged`() {
        val underWay = reduce(reduce(queued(), "a.jpg", 230_778, "Mac", pulling), "a.jpg", 230_778, "Mac", ended)
        assertEquals(ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER, (underWay as ShareSheetState.Stopped).why)
        val v2 = reduce(reduce(offered, "a.jpg", 230_778, "Mac", v3), "a.jpg", 230_778, "Mac", ended)
        assertEquals(ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER, (v2 as ShareSheetState.Stopped).why)
        val allSent = reduce(ShareSheetState.Sending("a.jpg", 230_778, "Mac", allSent = true), "a.jpg", 230_778, "Mac", ended)
        assertEquals("every byte left: not confirmed, as before", ShareSheetState.Unconfirmed("a.jpg", "Mac"), allSent)
    }

    @Test fun `Saved rules are untouched by queueing - only the Mac's verdict says saved`() {
        val saved = reduce(queued(), "a.jpg", 230_778, "Mac", com.chetan.connectsuite.sync.v2.ShareOffer.State.Saved("a.jpg"))
        assertEquals(ShareSheetState.Saved("a.jpg", "Mac", "a.jpg"), saved)
        assertFalse(ShareToMacCopy.headline(queued()).contains("Saved") || ShareToMacCopy.detail(queued()).contains("saved"))
    }

    /** The sheet draws its bar only through [showsTransferProgress]; the rule above is the one on screen. */
    @Test fun `the sheet's bar for an offered file is gated by showsTransferProgress`() {
        val src = java.io.File("src/main/java/com/chetan/connectsuite/ShareToMacActivity.kt").readText()
        assertTrue("control: the activity source was read", src.contains("LinearProgressIndicator"))
        assertTrue(src.contains("if (showsTransferProgress(state))"))
        assertFalse("no ungated Sending check left", src.contains("if (state is ShareSheetState.Sending)"))
    }
}
