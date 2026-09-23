package com.chetan.connectsuite.mirror.v2.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import com.chetan.connectsuite.core.ui.Motion

/**
 * The Mac's mirror request card arriving on the Mirror tab and resolving — motion item 4.
 *
 * - **Arrival** (the phase becomes `AWAITING_FOREGROUND`): fade in and rise 8 dp at `--dur-arrive`
 *   on `--ease`. It is a new thing arriving, which is what that pair is for.
 * - **Resolution** (Continue, Decline, the timeout, the Mac cancelling): a crossfade at
 *   `--dur-state` to the state card — which draws the phase the engine *reported*. Nothing here
 *   chooses what comes next, so the card can never fade toward a "Mirroring" or "Connected" look
 *   the phone has not reported.
 * - The size **snaps**: the content changes height, and an animated resize would slide the buttons
 *   underneath a finger.
 *
 * Nothing waits for any of it. The engine is called in the tap itself ([OneTap]); if Android's
 * consent prompt comes up, it simply covers a transition that is already running and ends on its
 * own. Compose scales every duration by Android's animator scale, so *Remove animations* swaps the
 * two states in a frame.
 */
object RequestCardMotion {
    const val ARRIVE_MS = Motion.ARRIVE_MS
    const val RESOLVE_MS = Motion.STATE_MS
    const val RISE_DP = 8

    fun AnimatedContentTransitionScope<Boolean>.transition(risePx: Int): ContentTransform {
        val arriving = targetState
        val change = if (arriving) {
            (fadeIn(tween(ARRIVE_MS, easing = Motion.ease)) +
                slideInVertically(tween(ARRIVE_MS, easing = Motion.ease)) { risePx }) togetherWith
                fadeOut(tween(RESOLVE_MS, easing = Motion.ease))
        } else {
            fadeIn(tween(RESOLVE_MS, easing = Motion.ease)) togetherWith
                fadeOut(tween(RESOLVE_MS, easing = Motion.ease))
        }
        return change using SizeTransform(clip = false) { _, _ -> snap() }
    }
}

/**
 * One answer per request. Taken synchronously in the tap, before any recomposition, so two taps in
 * one frame still produce one call — the guard does not depend on a button having redrawn as
 * disabled, and so not on any animation either.
 */
class OneTap {
    private var taken = false

    fun take(): Boolean {
        if (taken) return false
        taken = true
        return true
    }
}
