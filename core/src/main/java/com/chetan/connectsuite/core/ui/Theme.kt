package com.chetan.connectsuite.core.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ripple
import androidx.compose.foundation.LocalIndication

/**
 * The one theme. Dark, fixed, and not the platform's.
 *
 * ### Two things this used to do and deliberately no longer does
 *
 * **`dynamicColor = true`.** On Android 12+ that handed the whole palette to the OEM's wallpaper
 * extraction, which meant the schemes declared in this file had never once been drawn on the phone
 * under test. An app whose design is one accent on near-black cannot let the wallpaper pick the
 * accent — the lime *is* the product, in the same way the Mac's is.
 *
 * **`isSystemInDarkTheme()`.** There is no light Sidekick. Following the system implied a light
 * design existed and would have shipped the one state nobody had drawn — which is exactly the
 * unreachable-state failure `CLAUDE.md` records against the phone's Folders screen. One canvas,
 * always, and `values/themes.xml` now agrees so the launch window does not flash white first.
 *
 * ### Why a `ColorScheme` still exists underneath
 *
 * App code reads [SidekickColors] by name. This scheme is for Material's own components — the
 * `AlertDialog` behind a pairing request, a `Snackbar`, the text cursor — so that anything not yet
 * restyled inherits the right ground instead of Material's purple defaults.
 */
private val SidekickScheme = darkColorScheme(
    primary = SidekickColors.accent,
    onPrimary = SidekickColors.onAccent,
    primaryContainer = SidekickColors.accentTint,
    onPrimaryContainer = SidekickColors.accentText,

    // There is no second hue in this product. Secondary and tertiary are mapped to the neutral
    // ramp on purpose: a Material component reaching for one gets a grey, never a new colour.
    secondary = SidekickColors.onControl,
    onSecondary = SidekickColors.canvas,
    secondaryContainer = SidekickColors.cardRaised,
    onSecondaryContainer = SidekickColors.textPrimary,
    tertiary = SidekickColors.onControl,
    onTertiary = SidekickColors.canvas,
    tertiaryContainer = SidekickColors.cardRaised,
    onTertiaryContainer = SidekickColors.textPrimary,

    background = SidekickColors.canvas,
    onBackground = SidekickColors.textPrimary,
    surface = SidekickColors.card,
    onSurface = SidekickColors.textPrimary,
    surfaceVariant = SidekickColors.cardRaised,
    onSurfaceVariant = SidekickColors.textBody,
    surfaceContainer = SidekickColors.card,
    surfaceContainerHigh = SidekickColors.cardRaised,
    surfaceContainerHighest = SidekickColors.cardPressed,
    surfaceContainerLow = SidekickColors.card,
    surfaceContainerLowest = SidekickColors.canvas,

    error = SidekickColors.destructive,
    onError = SidekickColors.canvas,
    errorContainer = SidekickColors.destructiveTint,
    onErrorContainer = SidekickColors.destructive,

    outline = SidekickColors.borderStrong,
    outlineVariant = SidekickColors.border,
    scrim = SidekickColors.canvas,
)

private val SidekickShapes = Shapes(
    extraSmall = Radius.controlShape,
    small = Radius.controlShape,
    medium = Radius.cardShape,
    large = Radius.cardShape,
    extraLarge = Radius.heroShape,
)

@Composable
fun ConnectSuiteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SidekickScheme,
        typography = SidekickType.material,
        shapes = SidekickShapes,
    ) {
        // Material's default ripple is tinted from `onSurface`, which on this canvas is an
        // off-white flash. Android's touch feedback is a convention worth keeping — the brief's
        // `apple-design` note says adapt to Material norms rather than copy macOS — so the ripple
        // stays and is tinted lime, at a low enough alpha to read as feedback and not as a fill.
        CompositionLocalProvider(
            LocalContentColor provides SidekickColors.textPrimary,
            LocalIndication provides ripple(color = SidekickColors.accent),
            content = content,
        )
    }
}
