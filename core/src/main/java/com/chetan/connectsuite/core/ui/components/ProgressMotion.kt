package com.chetan.connectsuite.core.ui.components

/**
 * What a progress fill does when a new reading arrives. Pure, so `ProgressMotionTest` calls the
 * rule the bar runs rather than a copy of it.
 *
 * The bar may only move **between two real readings** — the Mac's send bar's rule, ported: the fill
 * eases to each byte count the phone reported, and nothing else puts it anywhere.
 *
 * - **Unknown** stays neutral: no fill, and nothing animates in from zero.
 * - The **first** known reading is drawn at once. Easing up from empty would show a stretch of
 *   progress nobody measured.
 * - A **lower** reading (a resume from an earlier offset, a restart) is drawn at once: easing
 *   backwards is motion with nothing to say.
 * - A reading of **1** is drawn at once, never eased into. The fill must not glide to full as if
 *   something had finished; the full bar appears only as the reading itself, and whether the
 *   transfer is *complete* is the row's status, not the bar — a finished row carries no bar at all
 *   (`TransferRowModel.fraction`).
 * - Otherwise it **eases** to the new reading.
 */
object ProgressMotion {

    sealed interface Step {
        /** No reading: draw no fill. */
        data object Hide : Step
        /** Draw [to] now. */
        data class Snap(val to: Float) : Step
        /** Ease from where the fill is to [to]. */
        data class Ease(val to: Float) : Step
    }

    fun step(previous: Float?, reading: Float?): Step {
        val to = reading?.coerceIn(0f, 1f) ?: return Step.Hide
        val from = previous?.coerceIn(0f, 1f) ?: return Step.Snap(to)
        return when {
            to >= 1f -> Step.Snap(to)
            to <= from -> Step.Snap(to)
            else -> Step.Ease(to)
        }
    }
}
