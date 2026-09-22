package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The one row shape, used by Transfers, Folders, Clip, Feed and Recent activity.
 *
 * Leading slot, title, optional subtitle, optional trailing metadata, optional chevron. The brief's
 * rule that two list screens must not read as two design languages is enforced by there being one
 * row and no per-screen variant of it — a screen that needs something this cannot express should
 * change this, so every sibling changes with it.
 *
 * The leading slot is a composable rather than an `ImageVector` because Feed leads with an app icon,
 * Clip leads with a kind glyph and a contact row leads with [AvatarBadge]. All three are 40dp, which
 * is the part that has to be consistent.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailingText: String? = null,
    showChevron: Boolean = false,
    titleColor: androidx.compose.ui.graphics.Color = SidekickColors.textPrimary,
    subtitleColor: androidx.compose.ui.graphics.Color = SidekickColors.textBody,
    onClick: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .defaultMinSize(minHeight = 64.dp)
            .padding(vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        if (leading != null) leading()

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = SidekickType.body.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                color = titleColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = SidekickType.caption,
                    color = subtitleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (trailingText != null) {
            Text(trailingText, style = SidekickType.meta, color = SidekickColors.textMeta)
        }
        if (trailing != null) trailing()
        if (showChevron) {
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = SidekickColors.textMeta,
                modifier = Modifier.size(Size.icon),
            )
        }
    }
}

/**
 * The hairline between two rows inside one card.
 *
 * Inset by the width of a 40dp leading slot plus its gap, so the divider starts under the text and
 * the badges read as a column. A full-bleed divider makes a list look like a table.
 */
@Composable
fun RowDivider(modifier: Modifier = Modifier, inset: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(start = if (inset) Size.badge + Space.md else 0.dp)
            .height(Size.hairline)
            .background(SidekickColors.divider),
    )
}
