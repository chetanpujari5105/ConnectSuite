package com.chetan.connectsuite.mirror.v2.ui

import com.chetan.connectsuite.core.ui.Motion
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Motion item 4. The gate and the timings are called directly; the screen's wiring is read from
 * source. The drawn transition and the four real resolutions were checked on the SM-S938B.
 */
class RequestCardMotionTest {

    @Test
    fun `one answer per request - the second tap does nothing`() {
        val gate = OneTap()
        assertTrue(gate.take())
        assertFalse(gate.take())
        assertFalse(gate.take())
        // A new request gets a new gate.
        assertTrue(OneTap().take())
    }

    @Test
    fun `arrival and resolution use the shared tokens`() {
        assertEquals(Motion.ARRIVE_MS, RequestCardMotion.ARRIVE_MS)
        assertEquals(Motion.STATE_MS, RequestCardMotion.RESOLVE_MS)
        assertEquals(8, RequestCardMotion.RISE_DP)
    }

    private val screen = File("src/main/java/com/chetan/connectsuite/mirror/v2/ui/MirrorScreen.kt").readText()

    @Test
    fun `continue and decline pass through the gate, and are turned off by the tap itself`() {
        val card = screen.substringAfter("fun MirrorRequestCard(")
        assertTrue(card.contains("onClick = { if (gate.take()) { answered = true; onContinue() } }"))
        assertTrue(card.contains("onClick = { if (gate.take()) { answered = true; onDecline() } }"))
        assertEquals(2, Regex("""enabled = !answered""").findAll(card).count())
    }

    @Test
    fun `the card resolves into the state card, which draws the reported phase`() {
        val swap = screen.substringAfter("AnimatedContent(").substringBefore("/** The live phase")
        assertTrue(swap.contains("targetState = status.phase == MirrorPhase.AWAITING_FOREGROUND"))
        assertTrue(swap.contains("StateCard(status = status, link = link)"))
    }
}
