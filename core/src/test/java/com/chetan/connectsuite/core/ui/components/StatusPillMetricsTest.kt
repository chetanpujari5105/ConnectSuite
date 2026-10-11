package com.chetan.connectsuite.core.ui.components

import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Space
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A pill drawn without its pill has no padding to keep (2026-10-11). The "Your Mac" card's tile sat
 * 4.13 dp below its three lines of text on the SM-S938B, because the last line is a background-less
 * `StatusPill` that still carried the pill's 8 dp of vertical padding — empty box under "Connected"
 * that the row's `CenterVertically` centred the tile against. The drawn result was measured on the
 * device (`docs/testing.md`); this pins the decision and that the composable reads it.
 */
class StatusPillMetricsTest {

    @Test
    fun `a drawn pill keeps its padding`() {
        val p = StatusPillMetrics.padding(showBackground = true)
        assertEquals(Space.md, p.horizontal)
        assertEquals(Space.sm, p.vertical)
    }

    @Test
    fun `a pill drawn without its pill has no padding at all`() {
        val p = StatusPillMetrics.padding(showBackground = false)
        assertEquals(0.dp, p.horizontal)
        assertEquals("vertical padding is empty box under the text when nothing is drawn", 0.dp, p.vertical)
    }

    @Test
    fun `the composable takes its padding from the metrics`() {
        val body = File("src/main/java/com/chetan/connectsuite/core/ui/components/StatusPill.kt")
            .readText().substringAfter("fun StatusPill(")
        assertTrue(body.contains("StatusPillMetrics.padding(showBackground)"))
        assertTrue("no second expression of the padding rule", !body.contains("vertical = Space.sm"))
    }
}
