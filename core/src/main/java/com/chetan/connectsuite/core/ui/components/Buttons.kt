package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space

/**
 * The three buttons this product has. There is no fourth, and a screen does not hand-roll one.
 *
 * All three are pills, all three are at least [Size.touchTarget] tall, and all three take an
 * optional leading icon and an optional trailing icon so the hero's
 * *"[monitor] Start mirroring  ›"* needs no bespoke row.
 *
 * Press feedback is a colour step rather than Material's ripple, because a lime fill with a
 * white-ish ripple over it reads as a flash. The neutral and destructive variants keep the ripple —
 * they are dark enough for it to look like Android.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val fill = when {
        !enabled -> SidekickColors.cardRaised
        pressed -> SidekickColors.accentPressed
        else -> SidekickColors.accent
    }
    val content = if (enabled) SidekickColors.onAccent else SidekickColors.textDisabled

    ButtonShell(
        text = text,
        onClick = onClick,
        modifier = modifier,
        icon = icon,
        trailingIcon = trailingIcon,
        enabled = enabled,
        container = fill,
        contentColor = content,
        border = null,
        interaction = interaction,
        rippleEnabled = false,
    )
}

/** Dark-filled neutral pill — "Send files", "Device info", "Pair another Mac". */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    ButtonShell(
        text = text,
        onClick = onClick,
        modifier = modifier,
        icon = icon,
        trailingIcon = trailingIcon,
        enabled = enabled,
        container = if (pressed) SidekickColors.cardPressed else SidekickColors.cardRaised,
        contentColor = if (enabled) SidekickColors.onControl else SidekickColors.textDisabled,
        border = SidekickColors.border,
        interaction = interaction,
        rippleEnabled = true,
    )
}

/**
 * Reserved for an action that removes something — Disconnect, Forget.
 *
 * Muted: red text on a transparent ground with a red hairline, never a red fill. A filled red
 * button is louder than the consequence of most of these, and the one place this product uses solid
 * red is a state that has already gone wrong.
 */
@Composable
fun DestructiveButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    ButtonShell(
        text = text,
        onClick = onClick,
        modifier = modifier,
        icon = icon,
        trailingIcon = null,
        enabled = enabled,
        container = if (pressed) SidekickColors.destructiveTint else Color.Transparent,
        contentColor = if (enabled) SidekickColors.destructive else SidekickColors.textDisabled,
        border = SidekickColors.destructiveBorder,
        interaction = interaction,
        rippleEnabled = true,
    )
}

@Composable
private fun ButtonShell(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier,
    icon: ImageVector?,
    trailingIcon: ImageVector?,
    enabled: Boolean,
    container: Color,
    contentColor: Color,
    border: Color?,
    interaction: MutableInteractionSource,
    rippleEnabled: Boolean,
) {
    val shell = modifier
        .defaultMinSize(minHeight = Size.touchTarget)
        .clip(Radius.pillShape)
        .background(container)
        .then(
            if (border != null) {
                Modifier.border(BorderStroke(Size.hairline, border), Radius.pillShape)
            } else {
                Modifier
            },
        )
        .clickable(
            interactionSource = interaction,
            indication = if (rippleEnabled) androidx.compose.material3.ripple() else null,
            enabled = enabled,
            onClick = onClick,
        )
        .padding(PaddingValues(horizontal = Space.lg, vertical = Space.md))

    val label: @Composable () -> Unit = {
        Row(
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = contentColor,
                    modifier = Modifier.size(Size.icon),
                )
                Spacer(Modifier.size(Space.sm))
            }
            Text(
                text = text,
                style = SidekickType.control,
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (trailingIcon == null) {
        Row(shell, Arrangement.Center, Alignment.CenterVertically) { label() }
        return
    }

    // With a trailing affordance the label stays optically centred and the chevron goes to the
    // edge, which is how the reference draws the hero's primary. Putting the chevron immediately
    // after the label — the obvious `Row` — leaves it floating mid-button with a hand's width of
    // empty pill beyond it.
    Box(shell, contentAlignment = Alignment.Center) {
        label()
        Icon(
            trailingIcon,
            contentDescription = null,
            tint = contentColor,
            modifier = Modifier.align(Alignment.CenterEnd).size(Size.icon),
        )
    }
}
