package com.chetan.connectsuite.sync.ui.clipboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The clipboard screen's copy, enumerated.
 *
 * The point of testing prose is not spell-checking. It is that this module had **no test source set
 * for its user-facing strings** until defect 65, and a sentence nothing can reach is a sentence that
 * goes on being wrong. These assert the properties that made defect 86 worth writing copy for.
 */
class ClipboardCopyTest {

    @Test
    fun `the steps are in walking order and start where the user actually is`() {
        val steps = ClipboardCopy.SEND_TO_MAC_STEPS
        assertEquals(4, steps.size)
        // Step 1 must be the selection itself. The switch is reachable ONLY from inside the
        // toolbar, so a list that opened with "go to Settings" would send people somewhere the
        // destination does not exist.
        assertTrue(steps[0].contains("Select some text"))
        assertTrue(steps[1].contains("three dots"))
        assertTrue(steps[2].contains("Manage apps"))
        assertTrue(steps[3].contains("Send to Mac"))
    }

    @Test
    fun `the label in the copy is the label the manifest ships`() {
        // Measured on hardware: the row reads "Send to Mac". If the manifest label ever changes,
        // these steps send the user hunting for a row that is not there.
        assertTrue(ClipboardCopy.SEND_TO_MAC_STEPS.last().contains("Send to Mac"))
        assertTrue(ClipboardCopy.SEND_TO_MAC_WHERE.contains("Send to Mac"))
    }

    @Test
    fun `it sets the expectation that the entry lands in the overflow, not beside Copy`() {
        // Without this the setup reads as having failed: the user flips the switch, looks at the
        // first row, and sees nothing. Measured — seven built-ins fill that row on this device.
        assertTrue(ClipboardCopy.SEND_TO_MAC_WHERE.contains("not appear next to Copy"))
        assertTrue(ClipboardCopy.SEND_TO_MAC_WHERE.contains("three-dot menu"))
    }

    @Test
    fun `off-by-default is attributed to the phone rather than left as our fault`() {
        val why = ClipboardCopy.SEND_TO_MAC_WHY_OFF
        assertTrue(why.contains("Your phone"))
        // "for every app that offers it" is the load-bearing half: it says the absence was not ours.
        assertTrue(why.contains("every app"))
    }

    @Test
    fun `no banned mechanism appears anywhere in the block`() {
        // The enumeration, never a grep over the APK — a search for a banned phrase matches the
        // sentence banning it, which has bitten this repo three times.
        for ((phrase, why) in ClipboardCopy.forbiddenMechanisms) {
            for (line in ClipboardCopy.sendToMacBlock) {
                assertFalse("$phrase must not appear in clipboard copy: $why", line.contains(phrase))
            }
        }
    }

    @Test
    fun `the copy does not claim this is how Android behaves`() {
        // This screen is Samsung's. Asserting it as Android's would be a single-device reading
        // dressed as a platform fact — and the sentence one card up genuinely is a platform fact,
        // which is what makes the distinction worth guarding.
        val text = ClipboardCopy.sendToMacBlock.joinToString(" ")
        assertFalse(text.contains("Android puts"))
        assertFalse(text.contains("On Android,"))
    }

    @Test
    fun `every line says something — a blank would draw an empty row`() {
        assertTrue(ClipboardCopy.sendToMacBlock.all { it.trim().length > 15 })
    }
}
