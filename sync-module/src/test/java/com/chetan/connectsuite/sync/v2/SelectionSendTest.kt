package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The selection route's decision — Slice 17's `ACTION_PROCESS_TEXT` feature.
 *
 * These reach the real function rather than restating it, and the ordering tests do it by making
 * the later guards *throw*: a guard that runs when it should not takes the test down with it, which
 * a value-based assertion could not distinguish from a coincidentally-equal answer.
 */
class SelectionSendTest {

    private val never: (String) -> Boolean = { false }
    private val send: (String) -> ClipEcho.Decision = { ClipEcho.Decision.Send }
    private val boom: (String) -> Nothing = { error("this guard should not have been reached") }

    @Test
    fun `text with a live session is sent, and the byte count is the trimmed text`() {
        val outcome = SelectionSend.decide("  hello  ", hasLiveSession = true, tooLarge = never, echo = send)
        assertEquals(SelectionSend.Outcome.Sent(5), outcome)
    }

    @Test
    fun `an empty selection is not a link problem`() {
        assertEquals(
            SelectionSend.Outcome.Empty,
            SelectionSend.decide("   ", hasLiveSession = false, tooLarge = boom, echo = boom),
        )
    }

    /**
     * The guard whose position would rot silently. Below the echo check, a disconnected phone would
     * answer *"that already came from your Mac"* — a confident claim about a machine that is not
     * there. The echo function throws, so the only way this passes is if it is never called.
     */
    @Test
    fun `no link is decided before the echo rule is ever consulted`() {
        assertEquals(
            SelectionSend.Outcome.NoLink,
            SelectionSend.decide("anything", hasLiveSession = false, tooLarge = boom, echo = boom),
        )
    }

    @Test
    fun `too large is decided before the echo comparison does work we would throw away`() {
        assertEquals(
            SelectionSend.Outcome.TooLarge,
            SelectionSend.decide("x".repeat(10), hasLiveSession = true, tooLarge = { true }, echo = boom),
        )
    }

    @Test
    fun `text the Mac just sent is refused as an echo, however deliberately it was asked for`() {
        assertEquals(
            SelectionSend.Outcome.SameAsMac,
            SelectionSend.decide("from the mac", hasLiveSession = true, tooLarge = never) {
                ClipEcho.Decision.Echo
            },
        )
    }

    /**
     * A USER trigger skips the *unchanged* rule in `ClipEcho`, so this branch should not arise —
     * but if `maySend` ever changes, the answer must still be a sentence rather than a send.
     */
    @Test
    fun `an unchanged decision still refuses rather than falling through to a send`() {
        assertEquals(
            SelectionSend.Outcome.SameAsMac,
            SelectionSend.decide("same", hasLiveSession = true, tooLarge = never) {
                ClipEcho.Decision.Unchanged
            },
        )
    }

    @Test
    fun `every outcome has a distinct sentence, and none of them is blank`() {
        val outcomes = listOf(
            SelectionSend.Outcome.Sent(1),
            SelectionSend.Outcome.NoLink,
            SelectionSend.Outcome.Empty,
            SelectionSend.Outcome.TooLarge,
            SelectionSend.Outcome.SameAsMac,
        )
        val messages = outcomes.map { SelectionSend.message(it) }
        assertEquals("two outcomes share a sentence", messages.size, messages.toSet().size)
        assertTrue("an outcome draws a blank toast", messages.all { it.length > 10 })
    }

    /**
     * The ordinary failure must not read as a fault — a phone away from its Mac is not broken, and
     * the sentence has to say where the text went, which is nowhere.
     */
    @Test
    fun `the no-link sentence says nothing was sent rather than blaming anything`() {
        val message = SelectionSend.message(SelectionSend.Outcome.NoLink)
        assertTrue(message.contains("nothing was sent"))
        assertTrue("it must not read as an error", !message.contains("failed") && !message.contains("Error"))
    }

    // ---- 2026-10-07: repeated starts and malformed text, through the real interlock and the real cap ----

    private fun realSend(echo: ClipEcho, text: String, live: Boolean = true): SelectionSend.Outcome {
        val outcome = SelectionSend.decide(text, live, ClipboardPayloads::tooLarge) { echo.maySend(it, ClipEcho.Trigger.USER) }
        if (outcome is SelectionSend.Outcome.Sent) echo.sent(text.trim())
        return outcome
    }

    /** A person who taps Send to Mac twice on the same words means it twice; the focus rule must not apply. */
    @Test
    fun `the same selection sent twice on purpose is sent twice`() {
        val echo = ClipEcho()
        assertEquals(SelectionSend.Outcome.Sent(4), realSend(echo, "same"))
        assertEquals(SelectionSend.Outcome.Sent(4), realSend(echo, "same"))
        assertEquals(SelectionSend.Outcome.Sent(4), realSend(echo, "  same  "))
    }

    @Test
    fun `a selection equal to what the Mac just sent is refused however often it is tapped`() {
        val echo = ClipEcho()
        echo.arrived("from mac")
        repeat(3) { assertEquals(SelectionSend.Outcome.SameAsMac, realSend(echo, "from mac")) }
    }

    @Test
    fun `a dropped link between two taps answers NoLink, then sends once it is back`() {
        val echo = ClipEcho()
        assertEquals(SelectionSend.Outcome.NoLink, realSend(echo, "words", live = false))
        assertEquals(SelectionSend.Outcome.Sent(5), realSend(echo, "words"))
    }

    /** The cap is on UTF-8 bytes of the trimmed text: exactly at it goes, one byte over is refused. */
    @Test
    fun `the size boundary is exact, in bytes, after trimming`() {
        val echo = ClipEcho()
        val atCap = "a".repeat(ClipboardPayloads.MAX_TEXT_BYTES)
        assertEquals(SelectionSend.Outcome.Sent(ClipboardPayloads.MAX_TEXT_BYTES), realSend(echo, atCap))
        assertEquals(SelectionSend.Outcome.TooLarge, realSend(echo, atCap + "b"))
        assertEquals("surrounding whitespace is not counted", SelectionSend.Outcome.Sent(ClipboardPayloads.MAX_TEXT_BYTES), realSend(echo, "  $atCap\n"))
        // Three bytes per character: 21,846 of them is 65,538 bytes, over a cap that 21,845 fits under.
        assertEquals(SelectionSend.Outcome.TooLarge, realSend(echo, "\u20AC".repeat(21_846)))
        assertEquals(SelectionSend.Outcome.Sent(65_535), realSend(echo, "\u20AC".repeat(21_845)))
    }

    @Test
    fun `blank and control-only selections are Empty or sent as they are, never crash`() {
        val echo = ClipEcho()
        for (blank in listOf("", " ", "\n\t ", "\u0020\u0009")) assertEquals(blank, SelectionSend.Outcome.Empty, realSend(echo, blank))
        // NUL is not whitespace to String.trim(), so it is text; it is sent, and counted in bytes.
        assertEquals(SelectionSend.Outcome.Sent(2), realSend(echo, "\u0000\u0000"))
        // A lone surrogate does not throw; UTF-8 encoding replaces it, so its byte count is one.
        assertEquals(SelectionSend.Outcome.Sent(1), realSend(echo, "\uD800"))
    }
}
