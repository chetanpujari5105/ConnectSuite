package com.chetan.connectsuite.core.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * The spacing step. Six values, and a screen may not use a seventh.
 *
 * Written as an object rather than loose constants so that a one-off `padding(13.dp)` is visibly a
 * departure at the call site rather than something that blends in.
 */
object Space {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
}

/** Corner radii, ported from the Mac's `--radius-*`. */
object Radius {
    /** Controls and chips. `--radius-control`. */
    val control = 10.dp
    /** Thumbnails and media stills. `--radius-media`. */
    val media = 12.dp
    /** Every standard card, and tiles inside one. `--radius-panel` / `--radius-tile`. */
    val card = 14.dp
    /** The one hero card. `--radius-hero`. */
    val hero = 20.dp

    val controlShape = RoundedCornerShape(control)
    val mediaShape = RoundedCornerShape(media)
    val cardShape = RoundedCornerShape(card)
    val heroShape = RoundedCornerShape(hero)
    /** Buttons and status pills. `--radius-pill`. */
    val pillShape = RoundedCornerShape(percent = 50)
}

/** Sizes that recur often enough that two screens disagreeing about them would be visible. */
object Size {
    /** The hairline on a card. One physical-ish line, not a border that reads as a frame. */
    val hairline = 1.dp
    /** An icon inside a badge or a list row. */
    val icon = 20.dp
    /** An icon that is the whole control — a top-bar action, a nav item. */
    val iconLarge = 24.dp
    /** The circular/squircle badge leading a list row, and the monogram avatar. */
    val badge = 40.dp
    /** Android's minimum touch target. Nothing tappable may be smaller. */
    val touchTarget = 48.dp
    /** A top-bar icon button's tappable box. */
    val iconButton = 40.dp
    /** The thin linear progress bar. There are no rings in this product. */
    val progressHeight = 6.dp
}

/**
 * Motion, ported from the Mac's `--dur-*` and `--ease-*`.
 *
 * The Mac's note on which easing to use survives the port intact: [ease] is a strong ease-out and is
 * right for anything *arriving*; [easeInOut] is for something that is changing in place and wants
 * symmetric acceleration. Nothing here overshoots, and nothing loops.
 */
object Motion {
    /** `--ease` — arrival. */
    val ease: Easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    /** `--ease-in-out` — a value changing in place. */
    val easeInOut: Easing = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)

    /** `--dur-press` — a finger landing. */
    const val PRESS_MS = 100
    /** `--dur-release` — the finger leaving. Slower than the press, deliberately. */
    const val RELEASE_MS = 160
    /** `--dur-state` — a colour or a label changing because a state changed. */
    const val STATE_MS = 180
    /** `--dur-pill` — a pill or chip selection moving. */
    const val PILL_MS = 200
    /** `--dur-arrive` — one new row entering a list. */
    const val ARRIVE_MS = 220
    /** `--dur-route` — a screen change. */
    const val ROUTE_MS = 260
}
