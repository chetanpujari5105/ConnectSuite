package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The one gradient surface in Sidekick.
 *
 * ### Used on the Devices overview connection card and nowhere else
 *
 * That is a product rule, not a styling preference, and it is the single thing keeping this app from
 * reading as generated. A hero treatment says *this is the thing* — applied to four cards it says
 * nothing at all, and the screen becomes a gradient sampler. Every other surface in the app is
 * [SidekickCard]: flat `#161616` with an 8% hairline.
 *
 * If a second screen ever seems to want this, the answer is that the screen wants hierarchy, and
 * hierarchy is type size and spacing — both of which are free and neither of which is this.
 *
 * ### How the bloom is built
 *
 * Three layers, in order: the flat card ground, a radial bloom at the top-right, and a weaker one at
 * the bottom-left. Radial rather than a single linear sweep because a linear gradient across a card
 * this wide bands visibly on an OLED near-black, and because the reference art has light entering
 * from a corner rather than an edge.
 *
 * There is deliberately no drop shadow and no glow outside the bounds — the brief forbids both, and
 * on `#0A0A0A` an outer glow is the difference between "lit" and "neon".
 *
 * Grain is **not** implemented. The reference shows a faint noise over the bloom; doing it properly
 * means a tiling noise bitmap or an AGSL shader (`RuntimeShader`, API 33+), and on this canvas the
 * banding it would hide is not visible at 8-bit on the device under test. Recorded here rather than
 * silently dropped.
 *
 * @param live when false the bloom is drawn in the neutral ramp instead of lime. A hero card on a
 *   disconnected phone that still glows green is the status island's two-writers defect with a
 *   gradient instead of a dot: the picture and the words would disagree.
 */
@Composable
fun HeroCard(
    modifier: Modifier = Modifier,
    live: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val bloom = if (live) SidekickColors.accent else SidekickColors.textBody

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(Radius.heroShape)
            .background(SidekickColors.card)
            // Two blooms, both weak. The first pass used 0.55 at radius 900 and washed two thirds
            // of the card olive — on the emulator it read as a tinted panel rather than as light
            // entering a dark one, which is the difference between the reference art and a
            // gradient. The reference is mostly `#161616`; the glow is an accent on it, not a fill.
            .background(
                Brush.radialGradient(
                    colors = listOf(bloom.copy(alpha = if (live) 0.20f else 0.05f), Color.Transparent),
                    center = Offset(980f, -200f),
                    radius = 620f,
                ),
            )
            .background(
                Brush.radialGradient(
                    colors = listOf(bloom.copy(alpha = if (live) 0.14f else 0.03f), Color.Transparent),
                    center = Offset(-40f, 700f),
                    radius = 560f,
                ),
            )
            .border(
                BorderStroke(
                    Size.hairline,
                    if (live) SidekickColors.accent.copy(alpha = 0.18f) else SidekickColors.border,
                ),
                Radius.heroShape,
            )
            .padding(Space.lg),
        content = content,
    )
}
