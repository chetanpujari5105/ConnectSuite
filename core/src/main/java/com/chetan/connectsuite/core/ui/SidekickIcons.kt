package com.chetan.connectsuite.core.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathData
import androidx.compose.ui.unit.dp

/**
 * The two marks this product draws itself.
 *
 * Everything else in the app comes from Material Symbols (Outlined, one weight, no exceptions). A
 * custom path is only justified where no stock glyph carries the meaning — which is true exactly
 * twice: the brand mark, and a glyph that has to say *which way* something moved between a phone and
 * a Mac, where the stock vocabulary offers only a generic sync circle.
 */
object SidekickIcons {

    /**
     * The Sidekick mask, vectorised from `LOGOS/head_logo.png`.
     *
     * A vector rather than the PNG because this is drawn at 28dp in a header and at 56dp in
     * onboarding, and the source art is 1800px wide — scaling that down is either a large bitmap in
     * memory or a soft edge on the diagonal, and the mark is nearly all diagonal.
     *
     * **Draw this with `Image`, never `Icon`.** `Icon` applies a `ColorFilter` over the whole
     * painter, which would flatten the eye gradient to a single tint and take the mark with it. It
     * is the one thing in this app allowed to carry a hue that is not in the palette: the eyes run
     * lime to cyan, and that is a brand asset rather than a colour the UI may reach for.
     */
    val Mark: ImageVector by lazy {
        ImageVector.Builder(
            name = "SidekickMark",
            defaultWidth = 48.dp,
            defaultHeight = 24.dp,
            viewportWidth = 48f,
            viewportHeight = 24f,
        ).apply {
            // The mask body — both wings as one path, so the centre notch is a single join.
            addPath(
                pathData = PathData {
                    // Left wing.
                    moveTo(5.6f, 1.5f)
                    curveTo(12.2f, 3.9f, 18.6f, 7.2f, 23.4f, 10.8f)
                    lineTo(23.4f, 15.8f)
                    curveTo(19.4f, 19.1f, 15.1f, 21.5f, 10.7f, 22.6f)
                    curveTo(6.6f, 19.6f, 4.2f, 16.2f, 4.0f, 12.5f)
                    curveTo(3.9f, 8.6f, 4.5f, 4.9f, 5.6f, 1.5f)
                    close()
                    // Right wing — the same curve mirrored about x = 24.
                    moveTo(42.4f, 1.5f)
                    curveTo(35.8f, 3.9f, 29.4f, 7.2f, 24.6f, 10.8f)
                    lineTo(24.6f, 15.8f)
                    curveTo(28.6f, 19.1f, 32.9f, 21.5f, 37.3f, 22.6f)
                    curveTo(41.4f, 19.6f, 43.8f, 16.2f, 44.0f, 12.5f)
                    curveTo(44.1f, 8.6f, 43.5f, 4.9f, 42.4f, 1.5f)
                    close()
                },
                fill = SolidColor(Color(0xFF242424)),
                stroke = SolidColor(Color(0xFF3A3A3A)),
                strokeLineWidth = 0.4f,
                strokeLineJoin = StrokeJoin.Round,
            )

            // Left eye — widest at the outer edge, tapering to a point at the inner corner.
            addPath(
                pathData = PathData {
                    moveTo(7.9f, 8.4f)
                    curveTo(12.4f, 10.0f, 16.8f, 12.6f, 20.4f, 15.5f)
                    curveTo(17.0f, 17.3f, 13.8f, 18.4f, 11.1f, 18.2f)
                    curveTo(9.2f, 15.3f, 8.1f, 11.8f, 7.9f, 8.4f)
                    close()
                },
                fill = Brush.linearGradient(
                    colors = listOf(Color(0xFFD4FF2E), Color(0xFF7CE84F), Color(0xFF0FB8F0)),
                    start = Offset(9f, 8f),
                    end = Offset(19f, 18f),
                ),
            )

            // Right eye.
            addPath(
                pathData = PathData {
                    moveTo(40.1f, 8.4f)
                    curveTo(35.6f, 10.0f, 31.2f, 12.6f, 27.6f, 15.5f)
                    curveTo(31.0f, 17.3f, 34.2f, 18.4f, 36.9f, 18.2f)
                    curveTo(38.8f, 15.3f, 39.9f, 11.8f, 40.1f, 8.4f)
                    close()
                },
                fill = Brush.linearGradient(
                    colors = listOf(Color(0xFFD4FF2E), Color(0xFF7CE84F), Color(0xFF0FB8F0)),
                    start = Offset(39f, 8f),
                    end = Offset(29f, 18f),
                ),
            )
        }.build()
    }

    /**
     * Phone on the left, Mac on the right, an arrow each way between them.
     *
     * Exists because the stock vocabulary has no glyph for *direction between these two specific
     * things*: `SyncAlt` is two arrows and no devices, `Devices` is two devices and no direction, and
     * the clipboard and transfer screens have to say which way a thing went. Stroked at 1.6 so it
     * sits at the same visual weight as Material Symbols Outlined beside it.
     *
     * Unlike [Mark] this is an ordinary UI icon and takes `Icon`'s tint.
     */
    val PhoneToMac: ImageVector by lazy {
        ImageVector.Builder(
            name = "SidekickPhoneToMac",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            val line = SolidColor(Color.White)

            // The phone.
            addPath(
                pathData = PathData {
                    moveTo(2.8f, 6.2f)
                    curveTo(2.8f, 5.3f, 3.5f, 4.6f, 4.4f, 4.6f)
                    lineTo(7.4f, 4.6f)
                    curveTo(8.3f, 4.6f, 9.0f, 5.3f, 9.0f, 6.2f)
                    lineTo(9.0f, 17.8f)
                    curveTo(9.0f, 18.7f, 8.3f, 19.4f, 7.4f, 19.4f)
                    lineTo(4.4f, 19.4f)
                    curveTo(3.5f, 19.4f, 2.8f, 18.7f, 2.8f, 17.8f)
                    close()
                },
                stroke = line,
                strokeLineWidth = 1.6f,
                strokeLineJoin = StrokeJoin.Round,
            )

            // The Mac: lid, then the base it sits on.
            addPath(
                pathData = PathData {
                    moveTo(15.0f, 6.6f)
                    lineTo(22.0f, 6.6f)
                    lineTo(22.0f, 14.2f)
                    lineTo(15.0f, 14.2f)
                    close()
                    moveTo(13.8f, 16.6f)
                    lineTo(23.2f, 16.6f)
                },
                stroke = line,
                strokeLineWidth = 1.6f,
                strokeLineJoin = StrokeJoin.Round,
                strokeLineCap = StrokeCap.Round,
            )

            // Two arrows: out along the top, back along the bottom.
            addPath(
                pathData = PathData {
                    moveTo(10.4f, 9.6f)
                    lineTo(13.6f, 9.6f)
                    moveTo(12.3f, 8.3f)
                    lineTo(13.6f, 9.6f)
                    lineTo(12.3f, 10.9f)

                    moveTo(13.6f, 13.4f)
                    lineTo(10.4f, 13.4f)
                    moveTo(11.7f, 12.1f)
                    lineTo(10.4f, 13.4f)
                    lineTo(11.7f, 14.7f)
                },
                stroke = line,
                strokeLineWidth = 1.6f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }.build()
    }
}
