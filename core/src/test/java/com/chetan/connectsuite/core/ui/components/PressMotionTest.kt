package com.chetan.connectsuite.core.ui.components

import com.chetan.connectsuite.core.ui.Motion
import org.junit.Assert.assertEquals
import org.junit.Test

/** The primary button's press. The drawn frames were checked on a device (`docs/testing.md`). */
class PressMotionTest {

    @Test
    fun `an enabled button takes the press scale, and lets it go`() {
        assertEquals(0.97f, PressMotion.scale(pressed = true, enabled = true))
        assertEquals(1f, PressMotion.scale(pressed = false, enabled = true))
    }

    @Test
    fun `a disabled button never looks pressable`() {
        assertEquals(1f, PressMotion.scale(pressed = true, enabled = false))
    }

    @Test
    fun `in at the press duration, out at the slower release, from the shared tokens`() {
        assertEquals(Motion.PRESS_MS, PressMotion.durationMs(pressed = true))
        assertEquals(Motion.RELEASE_MS, PressMotion.durationMs(pressed = false))
        assertEquals(100, Motion.PRESS_MS)
        assertEquals(160, Motion.RELEASE_MS)
    }

    @Test
    fun `the primary button draws the press and hands the click straight through`() {
        val src = java.io.File("src/main/java/com/chetan/connectsuite/core/ui/components/Buttons.kt").readText()
        val primary = src.substringAfter("fun PrimaryButton(").substringBefore("fun SecondaryButton(")
        org.junit.Assert.assertTrue(primary.contains("PressMotion.scale(pressed, enabled)"))
        org.junit.Assert.assertTrue(primary.contains("graphicsLayer"))
        // The callback is the caller's, unwrapped — no animation stands between the tap and it.
        org.junit.Assert.assertTrue(primary.contains("onClick = onClick,"))
    }
}
