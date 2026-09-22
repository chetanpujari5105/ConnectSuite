package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size

/**
 * The leading element of a list row: a small icon in a squircle.
 *
 * [tint] defaults to the muted grey, and a caller passes a colour **only when the icon is reporting
 * a state** — the design system's rule that colour on an icon is never decoration. The lime battery
 * badge on the Devices screen is a state; a folder glyph is not.
 */
@Composable
fun IconBadge(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    tint: Color = SidekickColors.textBody,
    container: Color = SidekickColors.cardRaised,
    border: Color = SidekickColors.border,
    size: Dp = Size.badge,
    shape: Shape = Radius.mediaShape,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(container)
            .border(BorderStroke(Size.hairline, border), shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(Size.icon))
    }
}

/**
 * A circular two-letter monogram, for a person rather than a thing.
 *
 * The initials are derived here rather than passed in, so every list that shows a contact derives
 * them the same way — one home for the rule, which is the same reason `AppLabels.of` exists on the
 * phone rather than each caller prettifying a package name.
 */
@Composable
fun AvatarBadge(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = Size.badge,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(SidekickColors.cardRaised)
            .border(BorderStroke(Size.hairline, SidekickColors.border), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initialsOf(name), style = SidekickType.control, color = SidekickColors.onControl)
    }
}

/**
 * Up to two initials from a display name.
 *
 * Internal and pure so a test can reach it: a name with one word, an empty name and a name that is
 * an address all have to produce *something*, and a monogram that renders blank is the empty-versus-
 * failed confusion at 40dp.
 */
internal fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("[\\s._-]+")).filter { it.isNotBlank() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}
