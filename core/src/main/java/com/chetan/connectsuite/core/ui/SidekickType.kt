package com.chetan.connectsuite.core.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The Sidekick type scale — seven styles, and a screen may not invent an eighth.
 *
 * Sizes follow the Mac's `--text-*` tokens, nudged up where Android's density and touch distance
 * ask for it (the Mac reads `13.5px` body at arm's length on a desk; a phone is held closer but
 * glanced at, and 14sp is the floor Android's own guidance puts on running text).
 *
 * Roboto throughout — [FontFamily.Default] on Android. The Mac uses the system UI face for the same
 * reason: a product that ships one accent should not also ship an opinion about a typeface.
 */
object SidekickType {

    /** Large numerals and the one screen title that is a display. `--text-page-title`, 31/36. */
    val display = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 38.sp,
        letterSpacing = (-0.01).em,
    )

    /** A card's own title — the device name in the hero. `--text-card-title`, 21/26. */
    val title = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.SemiBold,
        fontSize = 21.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.005).em,
    )

    /** "Quick actions", "Recent activity". `--text-section`, 15/20. */
    val section = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
    )

    /** Running text, and a list row's title. `--text-body-size`, 13.5/20. */
    val body = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    )

    /** A button or chip label. `--text-control`, 13/14. Medium, because it sits on a fill. */
    val control = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 16.sp,
    )

    /** A subtitle, a preview line, a timestamp. Always [SidekickColors.textBody] or dimmer. */
    val caption = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    )

    /** The smallest thing that may carry meaning. `--text-meta-size`, 11/12. */
    val meta = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
    )

    /**
     * The uppercase label above a card's title — "CONNECTED DEVICE", "YOUR MAC".
     *
     * The tracking is the whole point: uppercase at 11sp without it is a wall. Callers uppercase the
     * string themselves rather than relying on a text transform, so the value that reaches
     * TalkBack is the one on screen.
     */
    val overline = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.12.em,
    )

    /**
     * Material's own components read this, so they inherit the scale instead of the M3 defaults.
     * App code should name a style above directly — this map exists for `Button`, `AlertDialog`
     * and the handful of places Material draws text we do not pass a style to.
     */
    val material = Typography(
        displaySmall = display,
        headlineMedium = display,
        headlineSmall = title,
        titleLarge = title,
        titleMedium = section,
        titleSmall = section,
        bodyLarge = body,
        bodyMedium = body,
        bodySmall = caption,
        labelLarge = control,
        labelMedium = control,
        labelSmall = meta,
    )
}

/** Centre-aligned variant used by [com.chetan.connectsuite.core.ui.components.StateBlock]. */
internal fun TextStyle.centred(): TextStyle = copy(textAlign = TextAlign.Center)
