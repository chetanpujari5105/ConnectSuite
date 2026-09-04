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
}
