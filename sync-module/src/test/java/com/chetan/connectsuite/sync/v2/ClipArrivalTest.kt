package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The invariant: **this phone does not replace a clipboard it cannot tell you it replaced.**
 *
 * ### What this test reaches, and what it does not — stated rather than implied
 *
 * It reaches the **decision**. `ClipArrival.of` is the single expression of the rule and
 * `ClipFeature.onPush` calls it; there is no second copy for the two to drift apart.
 *
 * It does **not** reach the **write**. `onPush` needs a `Context`, a `ControlSession` and a live
 * `ClipboardManager`, none of which a JVM test can build, so nothing here can prove that
 * `applyToClipboard` is actually behind `arrival.writesClipboard`. That is defect 67's shape and it
 * is named here instead of being papered over: the fields these tests supply are supplied by hand,
 * and the question *does anything real ever produce this* is answered by
 * `docs/testing.md` -> Phase 6 Slice 4, on hardware, not by this file.
 *
 * What makes the residual risk small is structural rather than test coverage: the decision returns
 * an enum whose only clipboard-writing member is `APPLY`, and `writesClipboard` is the one accessor
 * the caller uses. A caller that ignored it would have to write `if (autoApply)` again, which is the
 * expression this type exists to delete.
 */
class ClipArrivalTest {

    // --- the defect this file is named for --------------------------------------------------------

    @Test
    fun `auto-apply does not write the clipboard when nothing can be reported`() {
        // The seven-times-on-a-real-phone case: the setting is on, and the phone has no way to say
        // what it did. Before the fix this was APPLY and the clipboard was silently replaced.
        val arrival = ClipArrival.of(autoApply = true, canNotify = false)

        assertEquals(ClipArrival.KEEP_ONLY, arrival)
        assertFalse(
            "a phone that cannot report an overwrite must not perform one",
            arrival.writesClipboard,
        )
    }

    @Test
    fun `an offer that cannot be delivered is not recorded as an offer`() {
        // "Offered" would be the ack meaning *asked* while the caller reads *shown*. Nobody is being
        // offered anything if the notification cannot be posted.
        assertEquals(ClipArrival.KEEP_ONLY, ClipArrival.of(autoApply = false, canNotify = false))
    }

    // --- the two states that must keep working ----------------------------------------------------

    @Test
    fun `auto-apply writes the clipboard when the result can be reported`() {
        val arrival = ClipArrival.of(autoApply = true, canNotify = true)
        assertEquals(ClipArrival.APPLY, arrival)
        assertTrue(arrival.writesClipboard)
    }

    @Test
    fun `without auto-apply the entry is offered and nothing is written`() {
        val arrival = ClipArrival.of(autoApply = false, canNotify = true)
        assertEquals(ClipArrival.OFFER, arrival)
        assertFalse("an offer must not pre-empt the tap it is asking for", arrival.writesClipboard)
    }

    // --- the whole table, so a new branch cannot be added without meeting this ---------------------

    @Test
    fun `only one of the four inputs writes the clipboard`() {
        val writing = listOf(true, false).flatMap { auto ->
            listOf(true, false).map { notify -> Triple(auto, notify, ClipArrival.of(auto, notify)) }
        }.filter { it.third.writesClipboard }

        assertEquals(
            "exactly one combination may write the clipboard: auto-apply on AND reportable",
            listOf(Triple(true, true, ClipArrival.APPLY)),
            writing,
        )
    }

    @Test
    fun `canNotify false forces KEEP_ONLY whatever the setting says`() {
        // canNotify gates BOTH branches, so the setting cannot route around it.
        listOf(true, false).forEach { auto ->
            assertEquals(
                "autoApply=$auto must not matter when nothing can be delivered",
                ClipArrival.KEEP_ONLY,
                ClipArrival.of(autoApply = auto, canNotify = false),
            )
        }
    }
}
