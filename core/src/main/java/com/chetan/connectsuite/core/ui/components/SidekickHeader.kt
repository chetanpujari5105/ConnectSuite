package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickIcons
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The brand lockup every top-level screen leads with: mark, wordmark, tagline, then whatever that
 * screen puts on the right.
 *
 * Extracted from the Devices overview the moment a second screen needed it. It is one component
 * rather than two copies because the alternative is two headers that drift — and the mark's size
 * relative to the wordmark is the sort of thing nobody notices is wrong until both are on screen in
 * the same week.
 */
@Composable
fun SidekickHeader(
    modifier: Modifier = Modifier,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        // `Image`, not `Icon`: the mark carries its own gradient and a tint would flatten it.
        Image(
            imageVector = SidekickIcons.Mark,
            contentDescription = null,
            modifier = Modifier.width(52.dp).height(26.dp),
        )
        Column(Modifier.weight(1f)) {
            Text("Sidekick", style = SidekickType.title, color = SidekickColors.textPrimary)
            Text(
                "Your phone. More possible.",
                style = SidekickType.caption,
                color = SidekickColors.textBody,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        trailing()
    }
}

/** A bare, tappable icon in a header's trailing slot. 40dp box so the target is not the glyph. */
@Composable
fun HeaderIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(Size.iconButton)
            .clip(Radius.pillShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = SidekickColors.textBody,
            modifier = Modifier.size(Size.iconLarge),
        )
    }
}
