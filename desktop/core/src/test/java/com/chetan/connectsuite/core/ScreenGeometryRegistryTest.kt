package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.screen.ScreenGeometryRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * The stamp that stops a tap landing in the wrong place.
 *
 * The property under test is narrow and load-bearing: the id must change whenever *anything a
 * coordinate depends on* changes, and must not change when nothing does. Too eager and every
 * re-announcement rejects taps that were perfectly good; too lazy and a turn goes unnoticed and
 * the taps land somewhere else.
 */
class ScreenGeometryRegistryTest {

    @Before
    fun clearBefore() = ScreenGeometryRegistry.clear()

    @After
    fun clearAfter() = ScreenGeometryRegistry.clear()

    @Test
    fun `nothing captured means no coordinate space`() {
        assertNull(ScreenGeometryRegistry.current())
    }

    @Test
    fun `republishing the same geometry keeps the same id`() {
        val first = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)
        val again = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)

        // `mirror.state: running` is re-sent when a secure surface clears. That must not invalidate
        // coordinates the Mac computed a moment earlier and which are still perfectly correct.
        assertEquals(first.id, again.id)
        assertEquals(first, ScreenGeometryRegistry.current())
    }

    @Test
    fun `a 180 degree turn mints a new id even though nothing resizes`() {
        val portrait = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)
        val upsideDown = ScreenGeometryRegistry.publish(1080, 2340, 180, 1440, 3120)

        // This is the case a dimensions-only check cannot see. The frame is the same shape and
        // every coordinate computed before the turn now maps to the point-reflected place, so the
        // id has to move or those coordinates would be accepted and delivered upside down.
        assertEquals(portrait.width, upsideDown.width)
        assertEquals(portrait.height, upsideDown.height)
        assertNotEquals(portrait.id, upsideDown.id)
    }

    @Test
    fun `a resize mints a new id`() {
        val portrait = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)
        val landscape = ScreenGeometryRegistry.publish(2340, 1080, 90, 3120, 1440)
        assertNotEquals(portrait.id, landscape.id)
        assertEquals(landscape, ScreenGeometryRegistry.current())
    }

    @Test
    fun `a display resolution change mints a new id even at the same capture size`() {
        // The user switched the phone from QHD+ to FHD+ in Settings. The capture cap means the
        // captured frame is the same size, but the scale onto the real display is not — so a
        // coordinate mapped with the old factor would land short.
        val qhd = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)
        val fhd = ScreenGeometryRegistry.publish(1080, 2340, 0, 1080, 2340)
        assertNotEquals(qhd.id, fhd.id)
    }

    @Test
    fun `ids are never reused across sessions`() {
        val first = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)
        ScreenGeometryRegistry.clear()
        val second = ScreenGeometryRegistry.publish(1080, 2340, 0, 1440, 3120)

        // Identical geometry, new session. If clear() reset the counter these would collide and a
        // message stamped for the previous session would be accepted by this one.
        assertNotEquals(first.id, second.id)
    }
}
