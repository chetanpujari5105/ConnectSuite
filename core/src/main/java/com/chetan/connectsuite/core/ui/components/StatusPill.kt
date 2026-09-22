package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * What a status pill is allowed to mean.
 *
 * A closed set rather than a colour parameter, and that is the point: `CLAUDE.md`'s rule about the
 * status island is that a surface reporting a state must not let a caller pick the tone separately
 * from the words. A caller here picks a *kind*; the colour follows from it, and a pill cannot end up
 * green while the sentence beside it says the link is down.
 */
enum class StatusKind { Connected, Warning, Error, Neutral }

private val StatusKind.tone: Color
    get() = when (this) {
        StatusKind.Connected -> SidekickColors.accent
        StatusKind.Warning -> SidekickColors.warning
        StatusKind.Error -> SidekickColors.destructive
        StatusKind.Neutral -> SidekickColors.textBody
    }

private val StatusKind.fill: Color
    get() = when (this) {
        StatusKind.Connected -> SidekickColors.accentTint
        StatusKind.Warning -> SidekickColors.warningTint
        StatusKind.Error -> SidekickColors.destructiveTint
        StatusKind.Neutral -> SidekickColors.neutralTint
    }

private val StatusKind.edge: Color
    get() = when (this) {
        StatusKind.Connected -> SidekickColors.accentBorder
        StatusKind.Warning -> SidekickColors.warningBorder
        StatusKind.Error -> SidekickColors.destructiveBorder
        StatusKind.Neutral -> SidekickColors.border
    }

/** A dot and a word: the smallest honest statement of a state. */
@Composable
fun StatusPill(
    text: String,
    kind: StatusKind,
    modifier: Modifier = Modifier,
    showBackground: Boolean = true,
) {
    val tone = kind.tone
    Row(
        modifier = modifier
            .clip(Radius.pillShape)
            .then(if (showBackground) Modifier.background(kind.fill) else Modifier)
            .then(
                if (showBackground) {
                    Modifier.border(BorderStroke(Size.hairline, kind.edge), Radius.pillShape)
                } else {
                    Modifier
                },
            )
            .padding(horizontal = if (showBackground) Space.md else 0.dp, vertical = Space.sm),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Box(
            Modifier.size(8.dp).clip(CircleShape).background(tone),
        )
        Text(text, style = SidekickType.meta, color = tone)
    }
}
