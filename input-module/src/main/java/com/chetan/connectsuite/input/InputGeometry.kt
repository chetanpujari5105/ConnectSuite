package com.chetan.connectsuite.input

import com.chetan.connectsuite.core.screen.ScreenGeometryRegistry

/** A point in capture-frame pixels — the space the Mac computes in. See docs/protocol.md. */
data class FramePoint(val x: Float, val y: Float)

/** A point in the phone's real display pixels — the space a gesture is dispatched in. */
data class DisplayPoint(val x: Float, val y: Float)

/**
 * The geometry a message claims it was computed against.
 *
 * All three fields are checked, not just the id. The id alone would be enough if the Mac were
 * always right; carrying the dimensions as well means a Mac that quotes the correct id while
 * having mapped against the wrong numbers is caught too, which is the failure mode a single
 * counter cannot see.
 */
data class GeometryStamp(val id: Long, val width: Int, val height: Int)

/**
 * Turning what the Mac sent into somewhere on this phone's screen — or refusing to.
 *
 * Pure, and separate from the service on purpose: this is the arithmetic that decides where a
 * finger lands, it is the thing v1 got wrong twice, and it has to be testable without a phone.
 *
 * The rule throughout is that a disagreement is refused rather than resolved. There is always a
 * plausible-looking way to carry on — clamp the point, scale against the current geometry, ignore
 * the id — and every one of them ends with a tap landing somewhere the user did not click, with
 * nothing on either screen saying so.
 */
object InputGeometry {

    /**
     * Checks a message's stamp against what is being captured now.
     *
     * Returns null when they agree, or the failure to send back when they do not.
     */
    fun verify(
        current: ScreenGeometryRegistry.Stamp?,
        claimed: GeometryStamp,
    ): InputFailure? {
        if (current == null) return InputFailure.NoCaptureSession
        if (current.id != claimed.id) {
            return InputFailure.GeometryStale(
                "the Mac used screen #${claimed.id}, the phone is on #${current.id}",
            )
        }
        if (current.width != claimed.width || current.height != claimed.height) {
            // Same id, different numbers. Either the Mac's arithmetic drifted or two different
            // geometries were given the same id, and both are worth refusing loudly.
            return InputFailure.GeometryStale(
                "screen #${claimed.id} is ${current.width}x${current.height} here, " +
                    "not ${claimed.width}x${claimed.height}",
            )
        }
        return null
    }

    /**
     * Scales one capture-frame point onto the real display.
     *
     * A single scale factor per axis is all this needs: the capture is the panel scaled to fit a
     * cap with the aspect ratio preserved (see `MirrorConfig.geometryFor`), so the two rectangles
     * are similar and nothing has to be letterboxed here. The Mac's canvas letterboxing is the
     * Mac's problem and is dealt with before the message is sent.
     *
     * Returns null when the point is outside the frame it was stamped for, which is the same
     * class of mistake as a stale stamp and is reported as one.
     */
    fun toDisplay(stamp: ScreenGeometryRegistry.Stamp, point: FramePoint): DisplayPoint? {
        if (point.x < 0f || point.y < 0f || point.x > stamp.width || point.y > stamp.height) return null
        if (stamp.width <= 0 || stamp.height <= 0) return null
        val scaleX = stamp.displayWidth.toFloat() / stamp.width
        val scaleY = stamp.displayHeight.toFloat() / stamp.height
        // The last row and column of pixels are inside the display; `width` itself is not, so a
        // click on the extreme edge is pulled back by one rather than dispatched off-screen.
        return DisplayPoint(
            x = (point.x * scaleX).coerceIn(0f, (stamp.displayWidth - 1).toFloat()),
            y = (point.y * scaleY).coerceIn(0f, (stamp.displayHeight - 1).toFloat()),
        )
    }

    /**
     * Maps a whole path, refusing the lot if any point is outside the frame.
     *
     * All-or-nothing because a drag with its middle silently dropped is not the drag the user
     * made: it would arrive as a stroke straight through whatever was skipped.
     */
    fun toDisplay(
        stamp: ScreenGeometryRegistry.Stamp,
        points: List<FramePoint>,
    ): List<DisplayPoint>? {
        val mapped = ArrayList<DisplayPoint>(points.size)
        for (point in points) mapped.add(toDisplay(stamp, point) ?: return null)
        return mapped
    }

    /**
     * Where a scroll's stroke ends.
     *
     * `dx`/`dy` describe how far the *content* should move, so the finger travels the other way —
     * a wheel scroll down (negative `dy`) is a finger moving up the screen. Clamped to the frame,
     * because a scroll near an edge would otherwise leave it and be refused as out of bounds when
     * what the user meant is perfectly clear.
     */
    fun scrollEnd(
        stamp: ScreenGeometryRegistry.Stamp,
        from: FramePoint,
        dx: Float,
        dy: Float,
    ): FramePoint = FramePoint(
        // Defect 21: **plus**, not minus. `dx`/`dy` are the distance the *content* should move, and
        // a finger drags content with it — so the finger's displacement is the content's, not its
        // negation. The old `-` made every wheel scroll go the wrong way: on hardware, a list at
        // the top scrolled *down* when the wheel was turned up. docs/protocol.md carried the same
        // inverted formula one line under the sentence that contradicts it, which is why neither
        // side caught it.
        x = (from.x + dx).coerceIn(0f, stamp.width.toFloat()),
        y = (from.y + dy).coerceIn(0f, stamp.height.toFloat()),
    )
}
