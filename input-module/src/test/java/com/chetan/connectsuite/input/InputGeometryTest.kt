package com.chetan.connectsuite.input

import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.screen.ScreenGeometryRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The arithmetic that decides where a finger lands, and the checks that stop it landing anywhere
 * the user did not click.
 *
 * This is the code the phase brief called out as the thing v1 got wrong twice. It is pure so that
 * it can be wrong here, in a test, rather than on a phone where the only symptom is a tap in the
 * wrong place with nothing on either screen saying so.
 */
class InputGeometryTest {

    /** A 1440x3120 panel captured at the 1080 cap — the reference device from Phase 2. */
    private val portrait = ScreenGeometryRegistry.Stamp(
        id = 7,
        width = 1080,
        height = 2340,
        rotation = 0,
        displayWidth = 1440,
        displayHeight = 3120,
    )

    // ---- the stamp check ---------------------------------------------------------------------

    @Test
    fun `a matching stamp is accepted`() {
        assertNull(InputGeometry.verify(portrait, GeometryStamp(7, 1080, 2340)))
    }

    @Test
    fun `a stale id is refused, not scaled`() {
        val failure = InputGeometry.verify(portrait, GeometryStamp(6, 1080, 2340))
        assertNotNull("a tap from before the turn must be refused", failure)
        assertEquals(ErrorCode.GEOMETRY_STALE, failure!!.code)
        // The user has to be able to act on it, and the action is "click again".
        assertTrue(failure.fixHint!!.contains("Click again"))
    }

    @Test
    fun `the right id with the wrong dimensions is refused too`() {
        // Belt to the id's braces: a Mac that quotes the correct stamp while having mapped against
        // different numbers is a bug a counter alone cannot see.
        val failure = InputGeometry.verify(portrait, GeometryStamp(7, 2340, 1080))
        assertEquals(ErrorCode.GEOMETRY_STALE, failure?.code)
    }

    @Test
    fun `coordinates with no capture session are refused as unavailable, not as stale`() {
        // A different answer on purpose: nothing is stale, there is simply no screen. "Start
        // mirroring" is the fix, and "click again" would be useless advice.
        val failure = InputGeometry.verify(null, GeometryStamp(7, 1080, 2340))
        assertEquals(ErrorCode.FEATURE_UNAVAILABLE, failure?.code)
    }

    // ---- the mapping -------------------------------------------------------------------------

    @Test
    fun `the centre of the frame is the centre of the display`() {
        val mapped = InputGeometry.toDisplay(portrait, FramePoint(540f, 1170f))!!
        assertEquals(720f, mapped.x, 0.5f)
        assertEquals(1560f, mapped.y, 0.5f)
    }

    @Test
    fun `the origin maps to the origin`() {
        val mapped = InputGeometry.toDisplay(portrait, FramePoint(0f, 0f))!!
        assertEquals(0f, mapped.x, 0.01f)
        assertEquals(0f, mapped.y, 0.01f)
    }

    @Test
    fun `the far corner stays on the display`() {
        // Clicking the last pixel of the picture must not dispatch at x == displayWidth, which is
        // one past the end and is rejected by the platform.
        val mapped = InputGeometry.toDisplay(portrait, FramePoint(1080f, 2340f))!!
        assertEquals(1439f, mapped.x, 0.01f)
        assertEquals(3119f, mapped.y, 0.01f)
    }

    @Test
    fun `a point outside the frame is refused rather than clamped`() {
        assertNull(InputGeometry.toDisplay(portrait, FramePoint(1081f, 100f)))
        assertNull(InputGeometry.toDisplay(portrait, FramePoint(-1f, 100f)))
        assertNull(InputGeometry.toDisplay(portrait, FramePoint(100f, 2341f)))
    }

    @Test
    fun `a capture at native resolution maps one to one`() {
        val native = portrait.copy(width = 1440, height = 3120)
        val mapped = InputGeometry.toDisplay(native, FramePoint(123f, 456f))!!
        assertEquals(123f, mapped.x, 0.01f)
        assertEquals(456f, mapped.y, 0.01f)
    }

    @Test
    fun `landscape maps against the turned display, not the portrait one`() {
        val landscape = ScreenGeometryRegistry.Stamp(
            id = 8,
            width = 2340,
            height = 1080,
            rotation = 90,
            displayWidth = 3120,
            displayHeight = 1440,
        )
        val mapped = InputGeometry.toDisplay(landscape, FramePoint(1170f, 540f))!!
        assertEquals(1560f, mapped.x, 0.5f)
        assertEquals(720f, mapped.y, 0.5f)
    }

    // ---- paths -------------------------------------------------------------------------------

    @Test
    fun `a whole drag is refused if any single point is outside the frame`() {
        val path = listOf(FramePoint(100f, 100f), FramePoint(1200f, 100f), FramePoint(200f, 200f))
        // Not "drop the bad point": a drag with its middle removed is a stroke straight through
        // somewhere the user never dragged.
        assertNull(InputGeometry.toDisplay(portrait, path))
    }

    @Test
    fun `a good drag keeps its shape and its point count`() {
        val path = listOf(FramePoint(540f, 1800f), FramePoint(540f, 1400f), FramePoint(540f, 900f))
        val mapped = InputGeometry.toDisplay(portrait, path)!!
        assertEquals(3, mapped.size)
        assertEquals(720f, mapped[0].x, 0.5f)
        assertTrue("the drag must still run upwards", mapped[0].y > mapped[2].y)
    }

    // ---- scroll ------------------------------------------------------------------------------

    @Test
    fun `a scroll moves the finger with the content, not against it`() {
        // Replaced 2026-08-27. This test used to assert `end.y == 1770f` — the finger moving *down*
        // for a negative dy — and its own comment contradicted itself in the same breath ("a finger
        // travelling down; the end point is therefore above the start"). It was defect 21, pinned
        // by a test that agreed with it, which is why nothing caught the inversion until a list at
        // the top scrolled downwards on hardware when the wheel was turned up.
        //
        // A finger drags content with it. Content up, finger up.
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 1170f), dx = 0f, dy = -600f)
        assertEquals(540f, end.x, 0.01f)
        assertEquals(570f, end.y, 0.01f)
    }

    @Test
    fun `a scroll near the edge is clamped rather than refused`() {
        // Unlike a tap, a scroll's end point is computed by us, not clicked by the user. Refusing
        // it for leaving the frame would refuse a gesture whose intent is perfectly clear.
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 100f), dx = 0f, dy = -600f)
        assertEquals(0f, end.y, 0.01f)
        assertNotNull(InputGeometry.toDisplay(portrait, end))
    }

    // ---- defect 21: which way a scroll actually goes -----------------------------------------

    @Test
    fun `a downward wheel drags the finger up, so the list scrolls down`() {
        // The Mac sends dy as the distance the CONTENT should move. A downward wheel means the
        // user wants to see what is further down, so the content moves up: dy is negative. The
        // finger has to move up with it. Until 2026-08-27 this returned a point *below* the start,
        // and every scroll went the wrong way on hardware.
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 1200f), dx = 0f, dy = -600f)

        assertEquals(540f, end.x, 0.01f)
        assertTrue("the finger must move up for a downward wheel, got y=${end.y}", end.y < 1200f)
        assertEquals(600f, end.y, 0.01f)
    }

    @Test
    fun `an upward wheel drags the finger down, so the list scrolls up`() {
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 1200f), dx = 0f, dy = 600f)

        assertTrue("the finger must move down for an upward wheel, got y=${end.y}", end.y > 1200f)
        assertEquals(1800f, end.y, 0.01f)
    }

    @Test
    fun `horizontal scroll carries the same sign as vertical`() {
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 1200f), dx = -200f, dy = 0f)

        assertEquals(340f, end.x, 0.01f)
    }

    @Test
    fun `a scroll that would leave the frame is clamped, not wrapped`() {
        val end = InputGeometry.scrollEnd(portrait, FramePoint(540f, 100f), dx = 0f, dy = -9000f)

        assertEquals(0f, end.y, 0.01f)
    }

}
