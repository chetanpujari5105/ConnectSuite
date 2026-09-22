package com.chetan.connectsuite.core.ui

import androidx.compose.ui.graphics.Color

/**
 * The Sidekick palette.
 *
 * ### Where these values come from
 *
 * They are **not** a fresh interpretation of the design. Every value below is ported, digit for
 * digit, from the Mac app's `desktop/src/renderer/tokens.css`, which is already shipped and already
 * contrast-audited (58 token pairs per theme, 0 failing — see `CLAUDE.md`'s Phase 7 row). Two
 * surfaces that are supposed to belong to one product family should not be two people's readings of
 * the same hex; they should be one list, copied.
 *
 * A value marked `DERIVED` has no counterpart on the Mac and is computed here, with the reason
 * stated. Anything else can be diffed against `tokens.css` by eye.
 *
 * ### Why this is an object rather than a `ColorScheme`
 *
 * Material 3's scheme has slots for a product with a primary, a secondary and a tertiary hue. This
 * product has **one** accent and a neutral ramp, and forcing that into `primaryContainer` /
 * `tertiaryContainer` is how a lime app ends up drawing a lavender card. [ConnectSuiteTheme] still
 * publishes a `ColorScheme` so Material's own components inherit sane values, but app code reads
 * these names directly, because these are the names the design uses.
 */
object SidekickColors {

    // ── Ground ────────────────────────────────────────────────────────────────────────────────
    /** The screen behind everything. `--canvas`. */
    val canvas = Color(0xFF0A0A0A)
    /** The standard card. `--card` / `--elev-2`. */
    val card = Color(0xFF161616)
    /** A card on a card. Used sparingly — a third level reads as noise. `--card-raised`. */
    val cardRaised = Color(0xFF1C1C1C)
    /** DERIVED — one step up from [cardRaised] for pressed list rows. Neutral, no blue cast. */
    val cardPressed = Color(0xFF222222)
    /** The unfilled half of a progress bar. DERIVED from `--surface-contact` neighbours. */
    val track = Color(0xFF2A2A2A)

    // ── Accent ────────────────────────────────────────────────────────────────────────────────
    /** The one accent in the product. `--accent`. */
    val accent = Color(0xFFC6FF33)
    /**
     * DERIVED — the press state.
     *
     * The Mac's `--accent-hover` *lightens* to `#D4FF4A`, which is right for a cursor arriving and
     * wrong for a finger landing: Android has no hover, and a touch that brightens reads as a
     * highlight rather than a press. This darkens the same hue ~10% instead.
     */
    val accentPressed = Color(0xFFB2E62E)
    /** Accent used as *text or an icon*, lightened for contrast on dark. `--accent-text`. */
    val accentText = Color(0xFFD8FF70)
    /** 12% accent — status pill fill, selected tile ground. `--accent-tint`. */
    val accentTint = Color(0x1FC6FF33)
    /** 30% accent — the hairline around a selected surface. `--accent-border`. */
    val accentBorder = Color(0x4DC6FF33)
    /** Text and icons sitting *on* a lime fill. `--accent-on-fill`. */
    val onAccent = Color(0xFF0B1002)

    // ── Real states, and only real states ─────────────────────────────────────────────────────
    /** Degraded, limited, low, declined. Never an error. `--warning`. */
    val warning = Color(0xFFFFB547)
    val warningTint = Color(0x1FFFB547)
    val warningBorder = Color(0x4DFFB547)
    /** Text on an amber fill. `--text-on-warning`. */
    val onWarning = Color(0xFF1A1206)

    /** Disconnected, failed, destructive. `--destructive`. */
    val destructive = Color(0xFFFF5C5C)
    val destructiveTint = Color(0x24FF5C5C)
    val destructiveBorder = Color(0x57FF5C5C)

    // ── Text ──────────────────────────────────────────────────────────────────────────────────
    /** Titles and values. Off-white, never `#FFFFFF`. `--text-primary`. */
    val textPrimary = Color(0xFFF2F3F5)
    /** Body copy. `--text-body`. */
    val textBody = Color(0xFF9A9CA8)
    /** Labels, timestamps, captions. `--text-meta`. */
    val textMeta = Color(0xFF6B6E7A)
    /**
     * DERIVED — a disabled control's label.
     *
     * Deliberately below the 4.5:1 body bar: a disabled control is *supposed* to read as
     * unavailable, and the thing that explains why is copy beside it, never the contrast.
     */
    val textDisabled = Color(0xFF4A4C55)
    /** Labels on neutral controls and list rows. `--text-on-control`. */
    val onControl = Color(0xFFE6E7EA)

    // ── Hairlines ─────────────────────────────────────────────────────────────────────────────
    /** The 1px edge on every card. 8% white. `--hairline`. */
    val border = Color(0x14FFFFFF)
    /** 12% white — a raised surface, or a divider that has to carry a little more. `--hairline-primary`. */
    val borderStrong = Color(0x1FFFFFFF)
    /** DERIVED — the divider between rows inside one card. Lighter than [border] by design. */
    val divider = Color(0x0FFFFFFF)

    // ── Neutral fills ─────────────────────────────────────────────────────────────────────────
    /** A neutral (non-state) badge or chip ground. */
    val neutralTint = Color(0x14FFFFFF)

    /**
     * DERIVED — the outline of a drawn device in the Connect-a-Mac art.
     *
     * Brighter than [borderStrong] on purpose: a hairline that reads correctly as the edge of a
     * *card* disappears when it is the only thing describing a shape on the bare canvas. Measured
     * on the emulator — at 12% white the phone and the Mac were barely present, and the screen read
     * as though its illustration had failed to load.
     */
    val artEdge = Color(0x3DFFFFFF)
}
