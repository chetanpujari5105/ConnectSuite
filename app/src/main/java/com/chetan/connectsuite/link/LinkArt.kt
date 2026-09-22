package com.chetan.connectsuite.link

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The tone the art carries. It follows the stage; a caller never picks a colour directly.
 *
 * [Brand] is the one that is **not** a state, and it is worth naming rather than reusing [Live].
 * The entry screen has no link to report — it is the screen you are on *because* there is no Mac —
 * so its art is aspirational: it shows what the two machines are about to be. Lime there is the
 * product's colour, not a claim, and the screen carries no status pill for it to contradict.
 *
 * The devices themselves stay unlit under [Brand]. Only [Live] lights their screens, so "these two
 * are actually talking" keeps a picture of its own that nothing else borrows.
 */
enum class LinkArtTone { Brand, Idle, Live, Warning, Offline }

private val LinkArtTone.colour: Color
    get() = when (this) {
        LinkArtTone.Brand -> SidekickColors.accent
        LinkArtTone.Idle -> SidekickColors.textMeta
        LinkArtTone.Live -> SidekickColors.accent
        LinkArtTone.Warning -> SidekickColors.warning
        LinkArtTone.Offline -> SidekickColors.textMeta
    }

/**
 * A phone, a Mac, and what is happening between them.
 *
 * ### Why it is drawn rather than shipped as artwork
 *
 * Every reference in the Connect-a-Mac flow opens with a rendered photograph of a Samsung handset
 * and a MacBook. Shipping a photograph of one manufacturer's phone inside an app that runs on all
 * of them is wrong on a Pixel, and the same picture would have to exist four times — neutral,
 * lime, amber and offline — as four large bitmaps. Drawn, it is one composable, it takes the
 * palette, and the tone is a parameter rather than an asset.
 *
 * ### The tone is not decoration
 *
 * [LinkArtTone] is the stage's tone, passed down. The status island's defect in `CLAUDE.md` is
 * exactly this shape — a surface whose picture and whose words answered to different sources — so
 * the art has no state of its own and cannot disagree with the sentence under it.
 *
 * Nothing here loops. There is no pulsing halo and no travelling dot, because motion has not had
 * its pass yet and a decorative animation is the one thing the brief rules out by name.
 */
@Composable
fun LinkArt(
    tone: LinkArtTone,
    modifier: Modifier = Modifier,
    centreIcon: ImageVector? = null,
    /**
     * Whether the Mac's screen is lit.
     *
     * Separate from [tone] because the wait state is [LinkArtTone.Live] — the phone really is
     * listening — while the Mac has not arrived yet. Lighting both would draw two machines
     * talking over a caption that says one of them is still waiting for the other, which is the
     * status island's two-writers defect rendered as an illustration.
     */
    macLit: Boolean = false,
) {
    val colour = tone.colour
    Box(
        modifier
            .fillMaxWidth()
            .height(190.dp)
            .background(
                Brush.radialGradient(
                    colors = listOf(
                        colour.copy(
                            alpha = when (tone) {
                                LinkArtTone.Live, LinkArtTone.Brand -> 0.13f
                                else -> 0.06f
                            },
                        ),
                        Color.Transparent,
                    ),
                    center = Offset(540f, 280f),
                    radius = 520f,
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            DeviceOutline(width = 74.dp, height = 140.dp, radius = 14.dp, lit = tone == LinkArtTone.Live)

            Box(
                Modifier.width(96.dp).height(48.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (centreIcon != null) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(colour.copy(alpha = 0.12f))
                            .border(BorderStroke(Size.hairline, colour.copy(alpha = 0.34f)), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            centreIcon,
                            contentDescription = null,
                            tint = colour,
                            modifier = Modifier.size(Size.icon),
                        )
                    }
                } else {
                    // A run of dots that grows towards the Mac: the direction the connection is
                    // made in (decision #2 — the Mac dials the phone) drawn as a gradient of size
                    // rather than as an arrow, which would need a head and a claim about when.
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        listOf(3.dp, 4.dp, 5.dp, 6.dp, 7.dp).forEachIndexed { i, d ->
                            Box(
                                Modifier
                                    .size(d)
                                    .clip(CircleShape)
                                    .background(colour.copy(alpha = 0.45f + i * 0.11f)),
                            )
                        }
                    }
                }
            }

            LaptopOutline(lit = macLit)
        }
    }
}

@Composable
private fun DeviceOutline(
    width: androidx.compose.ui.unit.Dp,
    height: androidx.compose.ui.unit.Dp,
    radius: androidx.compose.ui.unit.Dp,
    lit: Boolean,
) {
    Box(
        Modifier
            .width(width)
            .height(height)
            .clip(RoundedCornerShape(radius))
            .background(SidekickColors.cardRaised)
            .border(BorderStroke(1.5.dp, SidekickColors.artEdge), RoundedCornerShape(radius))
            .padding(4.dp),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(radius - 3.dp))
                .background(
                    if (lit) {
                        Brush.linearGradient(
                            listOf(
                                SidekickColors.accent.copy(alpha = 0.22f),
                                SidekickColors.canvas,
                            ),
                        )
                    } else {
                        Brush.linearGradient(listOf(SidekickColors.canvas, SidekickColors.canvas))
                    },
                ),
            contentAlignment = Alignment.TopCenter,
        ) {
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .width(18.dp)
                    .height(3.dp)
                    .clip(CircleShape)
                    .background(SidekickColors.borderStrong),
            )
        }
    }
}

@Composable
private fun LaptopOutline(lit: Boolean) {
    androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .width(132.dp)
                .height(86.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(SidekickColors.cardRaised)
                .border(BorderStroke(1.5.dp, SidekickColors.artEdge), RoundedCornerShape(8.dp))
                .padding(4.dp),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(5.dp))
                    .background(
                        if (lit) {
                            Brush.linearGradient(
                                listOf(
                                    SidekickColors.accent.copy(alpha = 0.18f),
                                    SidekickColors.canvas,
                                ),
                            )
                        } else {
                            Brush.linearGradient(listOf(SidekickColors.canvas, SidekickColors.canvas))
                        },
                    ),
            )
        }
        Box(
            Modifier
                .width(150.dp)
                .height(6.dp)
                .clip(RoundedCornerShape(bottomStartPercent = 60, bottomEndPercent = 60))
                .background(SidekickColors.borderStrong),
        )
    }
}
