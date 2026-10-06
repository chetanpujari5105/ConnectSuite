package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.FocusSync.Read
import com.chetan.connectsuite.sync.v2.FocusSync.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The focus sync's decision (2026-10-07). Every focus event ends in exactly one named reason; before
 * this, four of them returned silently and stage D's A4 could not be diagnosed from either log.
 *
 * Ordering is proven with throwing doubles: a guard consulted when it should not be takes the test
 * down, which a value comparison could not tell apart from a coincidentally equal answer.
 */
class FocusSyncTest {

    private val boom: () -> Nothing = { error("this guard should not have been reached") }
    private fun reads(r: Read): () -> Read = { r }
    private val live = { true }
    private val send = { ClipEcho.Decision.Send }

    @Test fun `not installed is decided before the clipboard is read`() {
        assertEquals(Reason.NOT_INSTALLED, FocusSync.decide(false, boom, boom, boom))
    }

    @Test fun `a refused read is NOT_FOCUSED, never EMPTY, and the link is not asked`() {
        assertEquals(Reason.NOT_FOCUSED, FocusSync.decide(true, reads(Read.REFUSED), boom, boom))
    }

    @Test fun `each thing the read can hold names itself before the link is asked`() {
        assertEquals(Reason.EMPTY, FocusSync.decide(true, reads(Read.EMPTY), boom, boom))
        assertEquals(Reason.NON_TEXT, FocusSync.decide(true, reads(Read.NON_TEXT), boom, boom))
        assertEquals(Reason.SENSITIVE, FocusSync.decide(true, reads(Read.SENSITIVE), boom, boom))
        assertEquals(Reason.TOO_LARGE, FocusSync.decide(true, reads(Read.TOO_LARGE), boom, boom))
    }

    @Test fun `text with no Mac is NO_LINK and the echo history is not consulted`() {
        assertEquals(Reason.NO_LINK, FocusSync.decide(true, reads(Read.TEXT), { false }, boom))
    }

    @Test fun `with a Mac, the echo decision names the outcome`() {
        assertEquals(Reason.SENT, FocusSync.decide(true, reads(Read.TEXT), live, send))
        assertEquals(Reason.ECHO, FocusSync.decide(true, reads(Read.TEXT), live) { ClipEcho.Decision.Echo })
        assertEquals(Reason.UNCHANGED, FocusSync.decide(true, reads(Read.TEXT), live) { ClipEcho.Decision.Unchanged })
    }

    /** The read happens once per event — a second read could see a different clipboard than the first. */
    @Test fun `the clipboard is read exactly once per focus`() {
        var n = 0
        FocusSync.decide(true, { n++; Read.TEXT }, live, send)
        assertEquals(1, n)
    }

    /** With a real interlock: focus twice on the same text sends once, then names UNCHANGED. */
    @Test fun `repeated focus over an unchanged clipboard sends once and then says why it did not`() {
        val echo = ClipEcho()
        fun focus(text: String): Reason {
            val r = FocusSync.decide(true, reads(Read.TEXT), live) { echo.maySend(text, ClipEcho.Trigger.AUTOMATIC) }
            if (r == Reason.SENT) echo.sent(text)
            return r
        }
        assertEquals(Reason.SENT, focus("one"))
        assertEquals(Reason.UNCHANGED, focus("one"))
        assertEquals(Reason.SENT, focus("two"))
        echo.arrived("from mac")
        assertEquals(Reason.ECHO, focus("from mac"))
        // After a link drop the last send is forgotten, so the same text goes again — but the echo stays.
        echo.linkDropped()
        assertEquals(Reason.SENT, focus("two"))
        assertEquals(Reason.ECHO, focus("from mac"))
    }

    @Test fun `every reason has its own non-blank log sentence that names no content`() {
        val sentences = Reason.entries.map(FocusSync::logSentence)
        assertEquals(Reason.entries.size, sentences.toSet().size)
        assertTrue(sentences.all { it.isNotBlank() })
    }

    @Test fun `the tally prints every reason, zeros included, in declaration order`() {
        val tally = ReasonTally(Reason.entries)
        tally.record(Reason.SENT)
        tally.record(Reason.SENT)
        tally.record(Reason.NOT_FOCUSED)
        val line = tally.line()
        assertEquals(
            "NOT_INSTALLED=0 NOT_FOCUSED=1 EMPTY=0 NON_TEXT=0 SENSITIVE=0 TOO_LARGE=0 NO_LINK=0 ECHO=0 UNCHANGED=0 SENT=2 (total 3)",
            line,
        )
        assertEquals(2L, tally.count(Reason.SENT))
        assertEquals(3L, tally.total())
    }

    @Test fun `the selection tally covers starts that carried no text`() {
        val tally = ReasonTally(SelectionSend.Counted.entries)
        tally.record(SelectionSend.counted(SelectionSend.Outcome.Sent(3)))
        tally.record(SelectionSend.Counted.NO_TEXT_EXTRA)
        assertTrue(tally.line(), tally.line().startsWith("SENT=1 NO_LINK=0 EMPTY=0 TOO_LARGE=0 SAME_AS_MAC=0 NO_TEXT_EXTRA=1 UNSUPPORTED_ACTION=0"))
        assertEquals(
            listOf(SelectionSend.Counted.SENT, SelectionSend.Counted.NO_LINK, SelectionSend.Counted.EMPTY, SelectionSend.Counted.TOO_LARGE, SelectionSend.Counted.SAME_AS_MAC),
            listOf(
                SelectionSend.Outcome.Sent(1), SelectionSend.Outcome.NoLink, SelectionSend.Outcome.Empty,
                SelectionSend.Outcome.TooLarge, SelectionSend.Outcome.SameAsMac,
            ).map(SelectionSend::counted),
        )
    }
}
