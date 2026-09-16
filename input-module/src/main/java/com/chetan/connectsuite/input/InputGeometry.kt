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

    /**
     * A scroll stroke with room for Android's touch slop, and what it cost.
     *
     * Returned as a record rather than a pair of points so the caller can log the *shortfall* when
     * the display ran out before the headroom was satisfied. A stroke that silently travels less
     * than it was asked to is the under-scroll half of defect 111, and a number with nothing beside
     * it to give it scale is the failure `CLAUDE.md` opens with.
     */
    data class ScrollStroke(
        val from: DisplayPoint,
        val to: DisplayPoint,
        /** What the Mac asked the content to move, in display pixels. */
        val requestedPx: Float,
        /** Extra travel added in front of the request so the slop does not eat it. */
        val headroomPx: Float,
        /** The slop the headroom is aimed at, so the log line carries its own denominator. */
        val slopPx: Int,
    ) {
        /** Total travel the platform will see. Under `slopPx` it cannot be a scroll at all. */
        val travelPx: Float get() = requestedPx + headroomPx

        /** Display pixels of the request the slop will still eat. Zero when the headroom is whole. */
        val shortfallPx: Float get() = (slopPx - headroomPx).coerceAtLeast(0f)
    }

    /**
     * Lengthens a scroll stroke by the platform's touch slop, in the direction it already travels.
     *
     * ### Why a scroll has to be longer than it looks — defect 111
     *
     * `View` does not begin dragging until a stroke has travelled `ViewConfiguration`'s
     * `scaledTouchSlop`; the pixels before that are how Android tells a press apart from a drag.
     * Two consequences, and both were live on hardware:
     *
     *  - **A stroke shorter than the slop is a tap.** Press and release in one place is exactly
     *    what it is, so it clicks whatever is under it. Measured on this handset (slop **30** display
     *    px at 600dpi): **35 of 138** real `input.scroll` messages in the Mac's own log travelled
     *    less than 30px — a quarter of every scroll ever sent was a click, which is why a mouse
     *    wheel opened videos on a YouTube feed.
     *  - **Every other scroll under-travelled by one slop.** The median real scroll asked for 77px
     *    and moved the content 47. Nobody noticed, because scrolling a little less than you meant
     *    to feels like a scroll.
     *
     * So the request is the travel the user wants the *content* to make, and the stroke has to be
     * that plus the slop. The extension goes on the **front** of the gesture — the start point moves
     * backwards — so the finger passes through the point the Mac aimed at on its way, rather than
     * overshooting past it.
     *
     * The display is finite, so the headroom may not fit. Whatever the start cannot take, the end
     * takes instead; whatever neither can take is reported as [ScrollStroke.shortfallPx] rather than
     * quietly dropped. A gesture at the very bottom of a full-height scroll has nowhere to go, and
     * saying so beats pretending.
     */
    fun withSlopHeadroom(
        from: DisplayPoint,
        to: DisplayPoint,
        slopPx: Int,
        displayWidth: Int,
        displayHeight: Int,
    ): ScrollStroke {
        val maxX = (displayWidth - 1).coerceAtLeast(0).toFloat()
        val maxY = (displayHeight - 1).coerceAtLeast(0).toFloat()
        val vx = to.x - from.x
        val vy = to.y - from.y
        val requested = kotlin.math.hypot(vx, vy)
        val slop = slopPx.coerceAtLeast(0).toFloat()
        // A zero-length request has no direction to extend along. The caller refuses those before
        // reaching here; returning the stroke unchanged is the honest answer if one ever arrives.
        if (requested <= 0f || slop <= 0f) {
            return ScrollStroke(from, to, requested, 0f, slopPx.coerceAtLeast(0))
        }
        val ux = vx / requested
        val uy = vy / requested

        // Backwards from the start, as far as the display allows.
        val back = travelAvailable(from, -ux, -uy, maxX, maxY).coerceAtMost(slop)
        val newFrom = DisplayPoint(
            (from.x - ux * back).coerceIn(0f, maxX),
            (from.y - uy * back).coerceIn(0f, maxY),
        )
        // Whatever the start could not take, the end takes — forwards, by the same rule.
        val forward = travelAvailable(to, ux, uy, maxX, maxY).coerceAtMost(slop - back)
        val newTo = DisplayPoint(
            (to.x + ux * forward).coerceIn(0f, maxX),
            (to.y + uy * forward).coerceIn(0f, maxY),
        )
        return ScrollStroke(newFrom, newTo, requested, back + forward, slopPx.coerceAtLeast(0))
    }

    /** How far a point may travel along a unit vector before it leaves the display. */
    private fun travelAvailable(
        point: DisplayPoint,
        ux: Float,
        uy: Float,
        maxX: Float,
        maxY: Float,
    ): Float {
        var limit = Float.MAX_VALUE
        if (ux > 0f) limit = minOf(limit, (maxX - point.x) / ux)
        if (ux < 0f) limit = minOf(limit, (0f - point.x) / ux)
        if (uy > 0f) limit = minOf(limit, (maxY - point.y) / uy)
        if (uy < 0f) limit = minOf(limit, (0f - point.y) / uy)
        return limit.coerceAtLeast(0f)
    }

}
