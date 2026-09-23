package com.chetan.connectsuite.core.ui.components

import com.chetan.connectsuite.core.ui.Motion
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The bottom nav's selection: colour only, at `--dur-pill`, with the selected state itself never
 * delayed. Reads the composable's source for the wiring; the drawn frames were checked on a device.
 */
class NavMotionTest {

    private val cell = File("src/main/java/com/chetan/connectsuite/core/ui/components/SidekickBottomNav.kt")
        .readText().substringAfter("private fun NavCell(").substringBefore("object NavMotion")

    @Test
    fun `the timing is the shared pill token`() {
        assertEquals(Motion.PILL_MS, NavMotion.DURATION_MS)
        assertEquals(200, NavMotion.DURATION_MS)
    }

    @Test
    fun `accessibility and the route take the raw selection, not an animated value`() {
        assertTrue(cell.contains("selected = selected,"))
        assertTrue(cell.contains("onClick = onClick,"))
    }

    @Test
    fun `the cell animates colour and nothing else`() {
        assertTrue(cell.contains("animateColorAsState"))
        for (motion in listOf("graphicsLayer", "animateFloatAsState", "animateDpAsState", "offset(", "scale(")) {
            assertFalse(motion, cell.contains(motion))
        }
    }
}
