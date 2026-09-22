package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/** One destination in the bar. [label] is one word — the bar never wraps to two lines. */
data class NavItem(val label: String, val icon: ImageVector)

/**
 * The five-tab bar: Devices, Transfers, Clip, Feed, Mirror.
 *
 * Material's own `NavigationBar` is not used, and the reason is the active indicator: M3 draws a
 * wide filled pill behind the icon in `secondaryContainer`, which in a one-accent product is either
 * a grey lozenge or — if the accent is mapped into that slot — a lime slab under a lime icon. The
 * design's active state is quieter than either: a tinted squircle, a lime icon, a lime label, and a
 * 4dp dot under it.
 *
 * The dot is the part worth keeping. On a five-tab bar at phone width the label is small and the
 * tint is subtle, and the dot is what reads as *selected* from across a room.
 */
@Composable
fun SidekickBottomNav(
    items: List<NavItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(SidekickColors.canvas),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(Size.hairline)
                .background(SidekickColors.border),
        )
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = Space.sm, vertical = Space.sm),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEachIndexed { index, item ->
                NavCell(
                    item = item,
                    selected = index == selectedIndex,
                    onClick = { onSelect(index) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun NavCell(
    item: NavItem,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tone = if (selected) SidekickColors.accent else SidekickColors.textBody
    Column(
        modifier = modifier
            .clip(Radius.cardShape)
            // `selectable`, not `clickable`: it publishes the selected state to accessibility, so
            // TalkBack announces "selected" instead of leaving the lime as the only signal — the
            // state would otherwise exist purely as a colour, which is exactly what a screen reader
            // cannot see. It is also what makes "Folders keeps Transfers lit" checkable from a UI
            // dump rather than by eye.
            .selectable(
                selected = selected,
                interactionSource = remember { MutableInteractionSource() },
                indication = ripple(color = SidekickColors.accent),
                role = Role.Tab,
                onClick = onClick,
            )
            .padding(vertical = Space.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.xs),
    ) {
        Box(
            Modifier
                .width(52.dp)
                .height(30.dp)
                .clip(Radius.controlShape)
                .background(if (selected) SidekickColors.accentTint else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                item.icon,
                contentDescription = item.label,
                tint = tone,
                modifier = Modifier.size(Size.iconLarge),
            )
        }
        Text(
            item.label,
            style = SidekickType.meta,
            color = tone,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Box(
            Modifier
                .size(4.dp)
                .clip(CircleShape)
                .background(
                    if (selected) SidekickColors.accent else androidx.compose.ui.graphics.Color.Transparent,
                ),
        )
    }
}
