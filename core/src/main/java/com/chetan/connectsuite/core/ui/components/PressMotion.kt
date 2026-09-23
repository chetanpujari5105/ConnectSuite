package com.chetan.connectsuite.core.ui.components

import com.chetan.connectsuite.core.ui.Motion

/**
 * A primary button under a finger — the Mac's `button:active` ported: `--press-scale` in at
 * `--dur-press`, back out at `--dur-release`, on `--ease`. Pure, so `PressMotionTest` calls it.
 *
 * Only what is drawn moves. The click is `clickable`'s, fired on release as before, and nothing
 * here waits for an animation; the scale is a `graphicsLayer`, so the touch target does not shrink.
 * A **disabled** button never takes the press — it must not look pressable.
 */
object PressMotion {

    fun scale(pressed: Boolean, enabled: Boolean): Float =
        if (pressed && enabled) Motion.PRESS_SCALE else 1f

    /** Into the press quickly; out of it more slowly — the Mac's asymmetry. */
    fun durationMs(pressed: Boolean): Int = if (pressed) Motion.PRESS_MS else Motion.RELEASE_MS
}
