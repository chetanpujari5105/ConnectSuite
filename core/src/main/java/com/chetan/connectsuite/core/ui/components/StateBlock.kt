package com.chetan.connectsuite.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.NotInterested
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.centred

/**
 * Why a screen has nothing to show.
 *
 * ### The reason this is one component and not five layouts
 *
 * `docs/phase-5-files-onboarding-proposal.md` §3 exists because **a pane showing zero things and a
 * pane that failed to load are the same picture**. The fix recorded there is to separate them in
 * several independent ways at once, and a component is the only way to guarantee every screen
 * separates them the *same* several ways: icon, tone, headline verb, and whether an action exists.
 * Five hand-rolled empty states drift into two of them looking identical, and then nobody can tell a
 * bug from an empty folder.
 *
 * ### [Wall] is not [Error]
 *
 * A wall is something the platform will not do — no amount of tapping fixes it, so it carries **no
 * action**, and it is drawn neutral rather than red because nothing has gone wrong. Locked decision
 * #6 says every feature degrades to "unavailable, here is why"; this is the "here is why", and a
 * retry button on it would be a lie.
 */
enum class StateKind { Empty, Loading, Permission, Error, Wall }

private val StateKind.defaultIcon: ImageVector
    get() = when (this) {
        StateKind.Empty -> Icons.Outlined.Inbox
        StateKind.Loading -> Icons.Outlined.Sync
        StateKind.Permission -> Icons.Outlined.Lock
        StateKind.Error -> Icons.Outlined.ErrorOutline
        StateKind.Wall -> Icons.Outlined.NotInterested
    }

private val StateKind.tone: Color
    get() = when (this) {
        StateKind.Permission -> SidekickColors.warning
        StateKind.Error -> SidekickColors.destructive
        else -> SidekickColors.textBody
    }

/**
 * @param headline what is true, as a verb phrase. Never "Nothing here".
 * @param body why, specifically. This is the honest half and it is not optional.
 * @param actionLabel omitted for [StateKind.Wall] and for [StateKind.Loading] — a control the user
 *   cannot usefully press is worse than no control, because it implies the state is their fault.
 */
@Composable
fun StateBlock(
    kind: StateKind,
    headline: String,
    body: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = Space.xl, vertical = Space.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        IconBadge(
            icon = icon ?: kind.defaultIcon,
            tint = kind.tone,
            size = 56.dp,
            container = SidekickColors.cardRaised,
        )

        Text(
            headline,
            style = SidekickType.section.centred(),
            color = SidekickColors.textPrimary,
        )
        Text(
            body,
            style = SidekickType.caption.centred(),
            color = SidekickColors.textBody,
        )

        if (kind == StateKind.Loading) {
            SidekickProgressIndeterminate(
                Modifier.padding(top = Space.sm).width(160.dp),
                tone = SidekickColors.accent,
            )
        }

        if (kind != StateKind.Wall && kind != StateKind.Loading && actionLabel != null && onAction != null) {
            SecondaryButton(
                text = actionLabel,
                onClick = onAction,
                modifier = Modifier.padding(top = Space.sm),
            )
        }
    }
}
