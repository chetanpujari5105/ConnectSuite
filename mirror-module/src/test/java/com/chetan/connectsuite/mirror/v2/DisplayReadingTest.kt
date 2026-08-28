package com.chetan.connectsuite.mirror.v2

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 16, as a test.
 *
 * The bug was not that the phone read the wrong angle — it was that the phone had no way to know
 * it had. `getRealMetrics` said portrait and `getRotation()` said 270°, and nothing in the code
 * could tell that those two statements cannot both be true. This is that check, and it is what
 * makes re-reading worth doing: two reads that merely agree with *each other* would both be wrong,
 * because the bad state persisted for 63ms.
 *
 * The numbers are the ones recorded on hardware on 2026-08-26: a Samsung SM-S938B, 1440x3120
 * portrait, turning back from landscape.
 */
class DisplayReadingTest {

    private val portrait = DisplayReading(widthPixels = 1440, heightPixels = 3120, densityDpi = 600, rotation = 0)
    private val landscape = DisplayReading(widthPixels = 3120, heightPixels = 1440, densityDpi = 600, rotation = 1)

    @Test
    fun `the phone's natural orientation is worked out from a settled reading`() {
        assertTrue("a portrait phone at 0 degrees is naturally portrait", naturalOrientationIsPortrait(portrait))
        assertTrue(
            "the same phone turned 90 degrees is still naturally portrait",
            naturalOrientationIsPortrait(landscape),
        )
    }

    @Test
    fun `a tablet whose natural orientation is landscape is recognised as one`() {
        val tabletAtZero = DisplayReading(widthPixels = 2560, heightPixels = 1600, densityDpi = 320, rotation = 0)
        assertFalse(naturalOrientationIsPortrait(tabletAtZero))
    }

    @Test
    fun `the reading that caused defect 16 is rejected as impossible`() {
        // What the phone actually reported, 63ms before it corrected itself: the new portrait
        // metrics carrying the outgoing landscape angle.
        val duringTheTurn = DisplayReading(
            widthPixels = 1440,
            heightPixels = 3120,
            densityDpi = 600,
            rotation = 3, // 270 degrees
        )
        assertFalse(
            "portrait metrics reported at 270 degrees cannot both be true",
            readingIsConsistent(duringTheTurn, naturalPortrait = true),
        )
    }

    @Test
    fun `every settled orientation is accepted`() {
        for (rotation in 0..3) {
            val quarterTurn = rotation == 1 || rotation == 3
            val reading = if (quarterTurn) landscape.copy(rotation = rotation) else portrait.copy(rotation = rotation)
            assertTrue(
                "rotation $rotation with its own geometry must be consistent",
                readingIsConsistent(reading, naturalPortrait = true),
            )
        }
    }

    @Test
    fun `a square display is never called inconsistent`() {
        // No phone ships one, but the check divides the world into portrait and landscape and a
        // square display is neither. Calling it a contradiction would spin the retry loop for its
        // whole budget on every single display change.
        val square = DisplayReading(widthPixels = 1440, heightPixels = 1440, densityDpi = 600, rotation = 1)
        assertTrue(readingIsConsistent(square, naturalPortrait = true))
        assertTrue(readingIsConsistent(square, naturalPortrait = false))
    }

    @Test
    fun `the check is symmetric for a landscape-natural device`() {
        val tabletPortrait = DisplayReading(widthPixels = 1600, heightPixels = 2560, densityDpi = 320, rotation = 1)
        assertTrue(readingIsConsistent(tabletPortrait, naturalPortrait = false))
        assertFalse(readingIsConsistent(tabletPortrait, naturalPortrait = true))
    }
}
