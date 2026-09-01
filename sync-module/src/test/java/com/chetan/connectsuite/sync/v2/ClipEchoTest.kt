package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The cycle proof, phone side. This is what the phone's auto-apply setting was gated on.
 *
 * ### The peer is adversarial, and that is the whole design
 *
 * Wiring a phone [ClipEcho] to a Mac one and watching them settle proves that two copies of one
 * rule agree, which they will, being copies — the `MediaPayloadsTest` mistake with a socket in the
 * middle. So the peer here echoes back everything it receives, immediately, forever. If one real
 * [ClipEcho] cannot be driven into a cycle by a peer that does nothing but echo, it cannot be driven
 * into one by the Mac either — whatever the Mac does now and whatever it is changed into later.
 *
 * ### The instrument reports its own bound
 *
 * [exchange] stops at [HOP_CAP] and says which. A run that ended at the cap has proven nothing about
 * convergence, so [Run.reportable] is false for it and the assertion reads the reason rather than
 * the count. `CLAUDE.md`, the 200-page probe that reported its own ending as the pager's.
 *
 * ### The refusals are recorded, and that is not decoration
 *
 * The first version of the Mac's twin recorded only the pushes, and the mutation run meant to prove
 * it could see the defect **stayed green with the echo rule deleted**: [ClipEcho.wroteLocally]
 * arms the unchanged rule too, so that rule caught every echo and the run still converged to one
 * push. Two guards both stopping the cycle is a good property; a test that cannot say *which one
 * ran* is not evidence for either. Asserting the refusal reason is what separates them.
 */
class ClipEchoTest {

    private companion object {
        const val HOP_CAP = 50
    }

    private data class Run(
        val pushes: List<String>,
        val refusals: List<ClipEcho.Decision>,
        val hops: Int,
        val stopped: String,
        val reportable: Boolean,
    )

    /**
     * One side against a peer that echoes everything, run until it settles or hits the cap.
     *
     * The trigger fires after **every** clipboard write, which is the worst case rather than the
     * real one: the phone's real trigger is window focus, which does not fire on a write we made
     * ourselves. Proving it against a change-driven trigger proves it against focus.
     */
    private fun exchange(
        seed: String,
        autoApply: Boolean,
        trigger: ClipEcho.Trigger = ClipEcho.Trigger.AUTOMATIC,
    ): Run {
        val echo = ClipEcho()
        var clipboard = seed
        val pushes = mutableListOf<String>()
        val refusals = mutableListOf<ClipEcho.Decision>()
        var hops = 0
        var inFlight: String? = null
        var pending = true

        while (hops < HOP_CAP) {
            if (pending) {
                pending = false
                when (val decision = echo.maySend(clipboard, trigger)) {
                    ClipEcho.Decision.Send -> {
                        pushes += clipboard
                        echo.sent(clipboard)
                        inFlight = clipboard
                    }
                    else -> refusals += decision
                }
            }
            val arriving = inFlight ?: return Run(pushes, refusals, hops, "converged", true)
            inFlight = null
            hops += 1

            echo.arrived(arriving)
            if (autoApply) {
                clipboard = arriving
                echo.wroteLocally(arriving)
                pending = true
            }
        }
        return Run(pushes, refusals, hops, "hop cap", false)
    }

    @Test
    fun `a phone that auto-applies does not cycle against a peer that echoes forever`() {
        val run = exchange("https://example.com/a-thing", autoApply = true)

        assertEquals("run ended at ${run.stopped} after ${run.hops} hops", "converged", run.stopped)
        assertEquals(true, run.reportable)
        assertEquals(listOf("https://example.com/a-thing"), run.pushes)
        // The echo rule, specifically. Without this the test passes with the echo rule deleted.
        assertEquals(listOf(ClipEcho.Decision.Echo), run.refusals)
    }

    @Test
    fun `a phone that holds for a tap does not cycle either, and applies nothing`() {
        // The default shape: nothing is written to this phone's clipboard, so the send path never
        // sees the Mac's text at all. Recorded because the two settings are two different products
        // and only one of them has ever needed the interlock.
        val run = exchange("token-abc", autoApply = false)

        assertEquals("converged", run.stopped)
        assertEquals(listOf("token-abc"), run.pushes)
        assertEquals(emptyList<ClipEcho.Decision>(), run.refusals)
    }

    @Test
    fun `a user-triggered send does not cycle, and the echo rule alone carries it`() {
        val run = exchange("a line of text", autoApply = true, trigger = ClipEcho.Trigger.USER)

        assertEquals("converged", run.stopped)
        assertEquals(listOf("a line of text"), run.pushes)
        assertEquals(listOf(ClipEcho.Decision.Echo), run.refusals)
    }

    @Test
    fun `a genuine second copy still sends — the interlock discriminates rather than merely refusing`() {
        // The control, and it matters more than the three above: a guard that refused every send
        // would pass all of them perfectly, and this file would be evidence of nothing in the way an
        // empty accessibility tree is evidence of nothing.
        val echo = ClipEcho()

        assertEquals(ClipEcho.Decision.Send, echo.maySend("one", ClipEcho.Trigger.AUTOMATIC))
        echo.sent("one")

        echo.arrived("two")
        echo.wroteLocally("two")
        assertEquals(ClipEcho.Decision.Echo, echo.maySend("two", ClipEcho.Trigger.AUTOMATIC))

        assertEquals(ClipEcho.Decision.Send, echo.maySend("three", ClipEcho.Trigger.AUTOMATIC))
        echo.sent("three")
        assertEquals(ClipEcho.Decision.Unchanged, echo.maySend("three", ClipEcho.Trigger.AUTOMATIC))
        assertEquals(ClipEcho.Decision.Send, echo.maySend("three", ClipEcho.Trigger.USER))
    }

    @Test
    fun `a link drop does not disarm the echo interlock, which is what stops the reconnect bounce`() {
        // The bounce in full: the Mac applies X here; the link drops; focus returns and reads X off
        // this phone's own clipboard; with the interlock cleared it sends X home; a Mac that
        // auto-applies writes X over whatever was copied in the meantime. One hop, terminating, and
        // it destroys live work — the exact harm auto-apply is on probation for, by the one route
        // the no-cycle proof above does not cover.
        val echo = ClipEcho()
        echo.arrived("X")
        echo.wroteLocally("X")

        echo.linkDropped()

        assertEquals(ClipEcho.Decision.Echo, echo.maySend("X", ClipEcho.Trigger.AUTOMATIC))
        // `lastSent` did clear: a reconnect may be a different Mac and should get what this phone
        // holds. Visible here as the refusal being Echo rather than Unchanged.
        assertEquals(ClipEcho.Decision.Send, echo.maySend("Y", ClipEcho.Trigger.AUTOMATIC))
    }
}
