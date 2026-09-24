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
}
