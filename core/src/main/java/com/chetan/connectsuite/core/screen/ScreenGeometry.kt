package com.chetan.connectsuite.core.screen

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * The screen shape the Mac is currently looking at, and the stamp that names it.
 *
 * This exists because two features that must agree about it live in two modules that cannot see
 * each other: `mirror-module` decides the capture geometry, and `input-module` maps touch
 * coordinates against it. Putting it in `:core` is what lets the second one be certain it is
 * talking about the same screen as the first, without either depending on the other.
 *
 * The stamp is the whole point. A tap is computed on the Mac against the geometry it was last
 * told about, travels for a few milliseconds, and arrives at a phone that may have turned in the
 * meantime. Scaling it against whatever is current then puts a finger somewhere the user did not
 * point — silently, with no error and no way to tell it happened. So every coordinate carries the
 * [Stamp.id] it was computed for and a mismatch is refused. See docs/protocol.md, "Input".
 */
object ScreenGeometryRegistry {

    /**
     * One published screen shape.
     *
     * [width]/[height] are the **capture frame** — the numbers the Mac was given and the space its
     * coordinates are in. [displayWidth]/[displayHeight] are the phone's real panel, which is what
     * a gesture has to be dispatched in. The capture is a scaled copy of the panel, so the two
     * pairs share an aspect ratio and the mapping between them is a single scale factor.
     */
    data class Stamp(
        val id: Long,
        val width: Int,
        val height: Int,
        /** Degrees clockwise, 0/90/180/270, as the phone's display reports it. */
        val rotation: Int,
        val displayWidth: Int,
        val displayHeight: Int,
    )

    private val currentStamp = AtomicReference<Stamp?>(null)
    private val ids = AtomicLong(0)

    /**
     * Publishes what is being captured now, minting a new [Stamp.id] when anything a coordinate
     * depends on has changed.
     *
     * **Rotation counts as a change even when the pixel dimensions do not.** A 180° turn resizes
     * nothing — the frame is the same shape — but every coordinate computed before it now maps to
     * the point-reflected place, so it has to invalidate the Mac's arithmetic like any other turn.
     *
     * Republishing an unchanged geometry keeps the existing id, so the `mirror.state: running`
     * that goes out again when a secure surface clears does not needlessly reject taps that were
     * already in flight and are still correct.
     */
    fun publish(
        width: Int,
        height: Int,
        rotation: Int,
        displayWidth: Int,
        displayHeight: Int,
    ): Stamp {
        while (true) {
            val existing = currentStamp.get()
            if (existing != null &&
                existing.width == width &&
                existing.height == height &&
                existing.rotation == rotation &&
                existing.displayWidth == displayWidth &&
                existing.displayHeight == displayHeight
            ) {
                return existing
            }
            val fresh = Stamp(
                id = ids.incrementAndGet(),
                width = width,
                height = height,
                rotation = rotation,
                displayWidth = displayWidth,
                displayHeight = displayHeight,
            )
            if (currentStamp.compareAndSet(existing, fresh)) return fresh
        }
    }

    /** Null when nothing is being captured, which is also "there is no coordinate space". */
    fun current(): Stamp? = currentStamp.get()

    /**
     * Capture ended. Deliberately does *not* reset the id counter: ids must never be reused, or a
     * message stamped for one session could be accepted by the next one.
     */
    fun clear() {
        currentStamp.set(null)
    }
}
