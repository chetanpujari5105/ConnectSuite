package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget
import com.chetan.connectsuite.sync.v2.ShareManyQueue.NotSentWhy
import com.chetan.connectsuite.sync.v2.ShareManyQueue.Prep
import com.chetan.connectsuite.sync.v2.ShareManyQueue.WaitReason
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareSelection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Stage 2 wording (docs/feature-a-multi-offer-proposal.md rev 4 §13, §15). Each claim is about one
 * row's own state, never a comparison between rows:
 *
 * - a row says **Saved** only when its offer is `ShareOffer.State.Saved` — the Mac's verified verdict;
 * - a row's label says **Sent** only when every byte has left the phone (`AwaitingVerdict`);
 * - the summary says **all saved** only when every row is saved;
 * - a row after an offer is the single-file sheet's sentence, word for word, except where §13.1 differs.
 */
class ShareManyCopyTest {

    private val mac = "Mac"

    private val everyOfferState: List<ShareOffer.State> = listOf(
        ShareOffer.State.Offered, ShareOffer.State.Accepted, ShareOffer.State.Sending, ShareOffer.State.AwaitingVerdict,
        ShareOffer.State.Failed("checksum"), ShareOffer.State.Failed(ShareOffer.UNCONFIRMED), ShareOffer.State.Saved("a.jpg"),
        ShareOffer.State.Declined("user"), ShareOffer.State.Declined("busy"), ShareOffer.State.Expired,
        ShareOffer.State.Cancelled(ShareOffer.Side.PHONE, "user"), ShareOffer.State.Cancelled(ShareOffer.Side.PHONE, "staging-lost"),
        ShareOffer.State.Cancelled(ShareOffer.Side.MAC, "user"), ShareOffer.State.SessionEnded,
    )

    private val everyPrep: List<Prep> = listOf(
        Prep.NotStarted, Prep.Preparing(4096), Prep.Waiting(WaitReason.LiveLimit), Prep.Waiting(WaitReason.RetryAlone),
        Prep.Waiting(WaitReason.NoRoom(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, 89_000)), Prep.Waiting(WaitReason.NoRoom(null, null)),
        Prep.Offered("s-x", 100_000),
        Prep.NotSent(NotSentWhy.OpenFailed), Prep.NotSent(NotSentWhy.ReadFailed), Prep.NotSent(NotSentWhy.NoSpace(300, 200)),
        Prep.NotSent(NotSentWhy.TooLarge(4096)), Prep.NotSent(NotSentWhy.WriteFailed), Prep.NotSent(NotSentWhy.CleanupUnverified),
        Prep.NotSent(NotSentWhy.OutOfRule), Prep.NotSent(NotSentWhy.MacCannotReceive), Prep.NotSent(NotSentWhy.ScreenClosed),
        Prep.NotSent(NotSentWhy.Disconnected), Prep.Waiting(WaitReason.RetryAlone, paused = true),
        Prep.Waiting(WaitReason.NoRoom(null, null), paused = true), Prep.Waiting(WaitReason.LiveLimit, paused = true),
        Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = false)), Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = true)),
    )

    private fun after(s: ShareOffer.State, prev: ShareSheetState? = null) =
        ShareManyCopy.after("a.jpg", 100_000, mac, prev?.let { ShareManyRow.After("a.jpg", it, queued = false) }, s)!!
    private fun everyRow(): List<ShareManyRow> = everyPrep.map { ShareManyRow.Before("a.jpg", it, 100_000) } + everyOfferState.map { after(it) }

    @Test fun `a row says Saved only when its offer is Saved`() {
        for (row in everyRow()) {
            val saved = row is ShareManyRow.After && row.state is ShareSheetState.Saved
            val text = ShareManyCopy.label(row, mac) + " " + ShareManyCopy.detail(row, mac)
            assertEquals("$row: $text", saved, ShareManyCopy.label(row, mac).startsWith("Saved"))
            if (!saved) assertFalse("$row: $text", Regex("\\bsaved it\\b|Saved on").containsMatchIn(text))
        }
        assertEquals("Saved on Mac", ShareManyCopy.label(after(ShareOffer.State.Saved("a.jpg")), mac))
    }

    @Test fun `a row's label says Sent only once every byte has left the phone`() {
        for (row in everyRow()) {
            val allSent = row is ShareManyRow.After && row.state is ShareSheetState.Sending && (row.state as ShareSheetState.Sending).allSent
            assertEquals("$row", allSent, ShareManyCopy.label(row, mac).startsWith("Sent"))
        }
    }

    @Test fun `an accepted file waiting its turn is not called sending, and nothing of it is on the Mac`() {
        val row = after(ShareOffer.State.Accepted)
        assertEquals("Accepted on Mac — waiting its turn", ShareManyCopy.label(row, mac))
        assertTrue(ShareManyCopy.detail(row, mac).contains("Nothing of it is on your Mac yet"))
        assertEquals("1 accepted, waiting its turn", ShareManyCopy.summary(listOf(row), mac))
    }

    @Test fun `after an offer, a row is the single-file sheet's sentence word for word`() {
        for (s in listOf(ShareOffer.State.Offered, ShareOffer.State.Sending, ShareOffer.State.AwaitingVerdict, ShareOffer.State.Saved("a.jpg"),
            ShareOffer.State.Failed("checksum"), ShareOffer.State.Failed(ShareOffer.UNCONFIRMED))) {
            val row = after(s)
            assertEquals(ShareToMacCopy.headline(row.state), ShareManyCopy.label(row, mac))
            assertEquals(ShareToMacCopy.detail(row.state), ShareManyCopy.detail(row, mac))
        }
        // An offer that ended with nothing saved: "Not sent", with the single-file reason.
        val declined = after(ShareOffer.State.Declined("user"))
        assertEquals(ShareManyCopy.NOT_SENT, ShareManyCopy.label(declined, mac))
        assertEquals(ShareToMacCopy.detail(declined.state), ShareManyCopy.detail(declined, mac))
    }

    @Test fun `a session ending after every byte was sent is not confirmed, never not sent`() {
        val allSent = after(ShareOffer.State.AwaitingVerdict).state
        val row = after(ShareOffer.State.SessionEnded, prev = allSent)
        assertEquals("Not confirmed by Mac", ShareManyCopy.label(row, mac))
        assertEquals("1 not confirmed", ShareManyCopy.summary(listOf(row), mac))
    }

    @Test fun `every row before an offer has a label, and every not-sent reason a sentence`() {
        for (p in everyPrep) {
            val row = ShareManyRow.Before("a.jpg", p, 100_000)
            assertTrue("$p", ShareManyCopy.label(row, mac).isNotBlank())
            if (p is Prep.NotSent) {
                assertEquals(ShareManyCopy.NOT_SENT, ShareManyCopy.label(row, mac))
                assertTrue("$p", ShareManyCopy.detail(row, mac).isNotBlank())
            }
        }
        assertEquals(
            ShareToMacCopy.detail(ShareSheetState.Preparing("a.jpg", 4096, 100_000)),
            ShareManyCopy.detail(ShareManyRow.Before("a.jpg", Prep.Preparing(4096), 100_000), mac),
        )
    }

    @Test fun `a partial not confirmed deleted - Not sent, the proposal's sentence, no retry, nothing on the Mac, only its own row`() {
        val row = ShareManyRow.Before("b.pdf", Prep.NotSent(NotSentWhy.CleanupUnverified), null)
        assertEquals(ShareManyCopy.NOT_SENT, ShareManyCopy.label(row, "Studio Mac"))
        assertEquals(
            "Couldn’t clean up the partial copy on this phone. " +
                "Sidekick won’t try this file again from this screen, and nothing of it reached Studio Mac.",
            ShareManyCopy.detail(row, "Studio Mac"),
        )
        val other = after(ShareOffer.State.Offered)
        assertEquals("1 waiting for you to accept · 1 not sent", ShareManyCopy.summary(listOf(other, row), mac))
        assertEquals("the other file's row is its own", ShareToMacCopy.detail(other.state), ShareManyCopy.detail(other, mac))
    }

    @Test fun `the summary counts facts in order, omits zeros, and says all saved only when all are`() {
        val saved = after(ShareOffer.State.Saved("a.jpg"))
        val rows = listOf(saved, saved, saved, after(ShareOffer.State.SessionEnded, prev = after(ShareOffer.State.AwaitingVerdict).state),
            after(ShareOffer.State.Sending), after(ShareOffer.State.Accepted), after(ShareOffer.State.Offered), after(ShareOffer.State.Offered),
            ShareManyRow.Before("b", Prep.Waiting(WaitReason.LiveLimit), 1), ShareManyRow.Before("c", Prep.NotSent(NotSentWhy.ReadFailed), 1))
        assertEquals(
            "3 saved on Mac · 1 not confirmed · 1 sending · 1 accepted, waiting its turn · 2 waiting for you to accept · 1 waiting for room · 1 not sent",
            ShareManyCopy.summary(rows, mac),
        )
        assertEquals("All 3 saved on Mac", ShareManyCopy.summary(listOf(saved, saved, saved), mac))
        assertFalse(ShareManyCopy.summary(listOf(saved, saved, after(ShareOffer.State.AwaitingVerdict)), mac).startsWith("All"))
    }

    @Test fun `whole-selection refusals name the limit, the item and the Mac`() {
        assertEquals("Sidekick sends up to 10 files at a time — you selected 14.", ShareManyCopy.refusal(ShareSelection.Refusal.TOO_MANY, 14, null, "Mac"))
        assertEquals("Item 3 can’t be sent (a folder).", ShareManyCopy.refusal(ShareSelection.Refusal.FOLDER, 5, 3, "Mac"))
        assertEquals(
            "Mac can receive one file at a time from this phone. Update Sidekick on your Mac to send several at once.",
            ShareManyCopy.refusal(ShareSelection.Refusal.NEEDS_VERSION_3, 2, null, "Mac"),
        )
        for (r in ShareSelection.Refusal.values()) assertTrue("$r", ShareManyCopy.refusal(r, 2, 1, "Mac").isNotBlank())
    }

    @Test fun `the review line counts files and totals only the sizes reported`() {
        assertEquals("3 files · 3,072 bytes (3.0 KB) (1 with the size not reported)", ShareManyCopy.reviewTotal(listOf(1024, null, 2048)))
        assertEquals("Send 3 files", ShareManyCopy.sendButton(3))
    }

    /**
     * `ShareFeature.views` keeps only the newest 16 offers. Before this fix a row whose offer had aged
     * out was drawn from its pre-offer state again — *"Waiting for you to accept on Mac"* over a file the
     * Mac had saved.
     */
    @Test fun `an offer no longer in the recent views keeps its last row - a saved file never reverts to waiting`() {
        val saved = after(ShareOffer.State.Saved("a.jpg"))
        assertEquals(saved, ShareManyCopy.after("a.jpg", 100_000, mac, saved, null))
        val queued = after(ShareOffer.State.Accepted)
        assertEquals("queued stays queued, not Sending", queued, ShareManyCopy.after("a.jpg", 100_000, mac, queued, null))
        assertEquals("never seen: the caller draws the offer's first state", null, ShareManyCopy.after("a.jpg", 100_000, mac, null, null))
    }

    @Test fun `waiting says paused only when the clock is, reason (b) names its limit either way, and no line counts down`() {
        fun line(r: WaitReason, paused: Boolean) = ShareManyCopy.detail(ShareManyRow.Before("a.jpg", Prep.Waiting(r, paused), 1), "Studio Mac")
        val noRoom = WaitReason.NoRoom(null, null)
        assertEquals("Waiting for Studio Mac to finish an earlier file. Keep this screen open.", line(noRoom, true))
        assertEquals("Waiting for Studio Mac to finish an earlier file. Keep this screen open.", line(WaitReason.RetryAlone, true))
        assertEquals("Prepared when an earlier file finishes. Keep this screen open.", line(noRoom, false))
        assertEquals("Prepared when an earlier file finishes. Keep this screen open.", line(WaitReason.RetryAlone, false))
        for (p in listOf(true, false)) assertEquals("Studio Mac already has 10 files from this phone in progress.", line(WaitReason.LiveLimit, p))
        val countdown = Regex("\\d+\\s*(s|sec|min|minute)")
        assertTrue("control: the pattern sees a countdown", countdown.containsMatchIn("Prepared in 9 min"))
        for (p in everyPrep.filterIsInstance<Prep.Waiting>()) {
            val text = ShareManyCopy.detail(ShareManyRow.Before("a.jpg", p, 1), mac)
            assertFalse("no countdown: $text", countdown.containsMatchIn(text))
        }
    }

    @Test fun `a file that waited too long is Not sent, was never offered, and never called sent`() {
        for (c in listOf(false, true)) {
            val row = ShareManyRow.Before("a.jpg", Prep.NotSent(NotSentWhy.WaitedTooLong(c)), 1)
            assertEquals(ShareManyCopy.NOT_SENT, ShareManyCopy.label(row, "Studio Mac"))
            assertEquals("It waited too long for room on this phone and was never offered to Studio Mac.", ShareManyCopy.detail(row, "Studio Mac"))
            assertEquals("1 not sent", ShareManyCopy.summary(listOf(row), "Studio Mac"))
        }
    }

    @Test fun `several files - a queued file whose connection ends is not sent, before any transfer, never a dropped one`() {
        val queued = after(ShareOffer.State.Accepted)
        val ended = ShareManyCopy.after("a.jpg", 100_000, mac, queued, ShareOffer.State.SessionEnded)!!
        assertEquals(ShareManyCopy.NOT_SENT, ShareManyCopy.label(ended, mac))
        assertEquals("The connection to Mac ended while it was waiting its turn. Nothing was sent.", ShareManyCopy.detail(ended, mac))
        assertEquals("1 not sent", ShareManyCopy.summary(listOf(ended), mac))
        val pulling = ShareManyCopy.after("a.jpg", 100_000, mac, queued, ShareOffer.State.Sending)!!
        val dropped = ShareManyCopy.after("a.jpg", 100_000, mac, pulling, ShareOffer.State.SessionEnded)!!
        assertTrue("a pull under way still ends as dropped", ShareManyCopy.detail(dropped, mac).contains("during the transfer"))
    }
}
