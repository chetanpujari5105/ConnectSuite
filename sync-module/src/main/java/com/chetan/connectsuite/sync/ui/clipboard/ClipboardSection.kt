package com.chetan.connectsuite.sync.ui.clipboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.RelativeTime
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill
import com.chetan.connectsuite.sync.v2.ClipFeature

/**
 * Clip — reference `13_android_clipboard.png`.
 *
 * ### The toggle in the reference is the one thing this phone cannot do
 *
 * It reads **"Send what I copy automatically"**, switched on. There is no such setting and there
 * cannot be: `ClipboardManager.getPrimaryClip` is refused unless the app is **focused** — measured
 * on this handset, 90 of 90 samples refused with the AccessibilityService bound and 60 of 60 with
 * it disabled, each carrying the platform's own *"application is not in focus nor is it a system
 * service"*. `OnPrimaryClipChangedListener` never fires backgrounded either. Phone → Mac happens in
 * `onWindowFocused` and nowhere else.
 *
 * The real setting is `SettingsStore.clipboardAutoApply`, and it points the **other way**: whether
 * an entry arriving *from* the Mac is written to this clipboard without being tapped. So the row is
 * *"Apply what arrives automatically"*, and its sub-line says why it is off by default — this phone
 * cannot read its clipboard while unfocused, so an auto-apply cannot see what it is about to
 * destroy and cannot offer it back. The Mac's half can, and does.
 *
 * ### The direction chips have nothing to filter yet
 *
 * `ClipboardPayloads.History` really does hold 20 entries with their kind, text, time and source —
 * and it is **private to `ClipFeature`**, exposed on the wire as `clip.history` for the Mac and to
 * this screen only as a `historySize` count. So the reference's filtered list is not drawable
 * today. What *is* exposed is the most recent entry each way, which is what this screen shows, with
 * the count of what is held behind it. Wiring the list is a small, scoped change to `ClipFeature`
 * and is flagged rather than taken.
 *
 * ### The footer is accurate, and was checked rather than repeated
 *
 * Memory only, cleared on disconnect: `onSessionEnded` calls `history.clear()` and resets
 * `PhoneState()`, and the history is an `ArrayDeque` that no code writes to Room or to a file.
 */
@Composable
fun ClipboardSection(
    state: ClipFeature.PhoneState,
    autoApply: Boolean,
    onSetAutoApply: (Boolean) -> Unit,
    onApplyFromMac: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val nowMillis = System.currentTimeMillis()

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = Space.lg,
            end = Space.lg,
            bottom = Space.xl,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item {
            Text(
                "Copy on either device, paste on the other.",
                style = SidekickType.body,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(bottom = Space.md),
            )
        }

        item { AutoApplyRow(autoApply = autoApply, onSetAutoApply = onSetAutoApply) }

        val hasSent = state.lastSentAtMs > 0L
        val hasReceived = state.lastReceivedAtMs > 0L

        if (!hasSent && !hasReceived) {
            item {
                SidekickCard(padding = Space.xs) {
                    StateBlock(
                        kind = StateKind.Empty,
                        icon = Icons.Outlined.ContentCopy,
                        headline = if (state.linkUp) "Nothing copied yet" else "No Mac connected",
                        body = if (state.linkUp) {
                            "Copy something on your Mac and it appears here. Copy something on " +
                                "this phone and it goes the next time you open Sidekick."
                        } else {
                            "The clipboard is shared only while a Mac is connected, and what was " +
                                "shared is forgotten when it disconnects."
                        },
                    )
                }
            }
        } else {
            item {
                Text(
                    "Most recent",
                    style = SidekickType.section,
                    color = SidekickColors.textPrimary,
                    modifier = Modifier.padding(top = Space.sm, bottom = Space.xs),
                )
            }
            if (hasReceived) {
                item {
                    ClipEntryCard(
                        fromMac = true,
                        preview = state.lastReceivedPreview,
                        atMs = state.lastReceivedAtMs,
                        nowMillis = nowMillis,
                        applied = state.lastReceivedApplied,
                        onApply = { state.lastReceivedPreview?.let(onApplyFromMac) },
                    )
                }
            }
            if (hasSent) {
                item {
                    ClipEntryCard(
                        fromMac = false,
                        preview = state.lastSentPreview,
                        atMs = state.lastSentAtMs,
                        nowMillis = nowMillis,
                        applied = true,
                        onApply = null,
                    )
                }
            }
        }

        // Both pieces of standing copy sit together at the foot. Stacked above the entries they
        // were a wall of prose before any content — measured on the emulator at **two full cards,
        // seven lines**, before a single clipboard entry. Neither is an error and neither is
        // urgent; they are the things a person reads once, and they are reachable at rest.
        item { FocusWallCard() }

        item { MemoryOnlyFooter(historySize = state.historySize) }
    }
}

/**
 * The one setting on this screen.
 *
 * **The whole row is the control, not just the switch.** Two reasons, and the second is the one
 * that was measured: a 56dp switch at the end of a full-width row is a small target beside a large
 * label that looks tappable and was not — tapping the words did nothing on the emulator. And in the
 * UI dump the switch was a bare `checkable` node with **no content description**, so a screen
 * reader would have announced a toggle with no idea what it toggles. `toggleable` with
 * `mergeDescendants` gives the row one node carrying the label, the state and the action.
 */
@Composable
private fun AutoApplyRow(autoApply: Boolean, onSetAutoApply: (Boolean) -> Unit) {
    // One string, two uses: the label people read and the label a screen reader announces. A
    // second literal here would be the same rule with two homes, and they drift.
    val label = "Apply what arrives automatically"
    SidekickCard(
        padding = Space.md,
        // **Order matters and was measured.** With `.semantics {}` *after* `.toggleable`, the dump
        // showed two overlapping nodes at identical bounds — one checkable with an empty
        // `content-desc`, one carrying the description and not checkable. `semantics` after
        // `toggleable` is a second layer, not an addition to the first. Declared before it, the
        // description and the toggle are one node.
        modifier = Modifier
            .semantics(mergeDescendants = true) { contentDescription = label }
            .toggleable(
                value = autoApply,
                onValueChange = onSetAutoApply,
                role = Role.Switch,
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                Icons.Outlined.ContentCopy,
                tint = if (autoApply) SidekickColors.accent else SidekickColors.textBody,
                container = if (autoApply) SidekickColors.accentTint else SidekickColors.cardRaised,
                border = if (autoApply) SidekickColors.accentBorder else SidekickColors.border,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    label,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Writes an arriving entry straight to this phone's clipboard.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
            }
            Switch(
                checked = autoApply,
                // Null: the row above owns the click, so the switch must not be a second target
                // with its own semantics node.
                onCheckedChange = null,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = SidekickColors.onAccent,
                    checkedTrackColor = SidekickColors.accent,
                    checkedBorderColor = SidekickColors.accent,
                    uncheckedThumbColor = SidekickColors.textBody,
                    uncheckedTrackColor = SidekickColors.cardRaised,
                    uncheckedBorderColor = SidekickColors.borderStrong,
                ),
            )
        }
    }
}

/**
 * One clipboard entry, in the direction it travelled.
 *
 * [onApply] is null for anything this phone sent — writing your own clip back to your own clipboard
 * is a control with no effect, and a control with no effect is the thing this project keeps
 * deleting.
 */
@Composable
private fun ClipEntryCard(
    fromMac: Boolean,
    preview: String?,
    atMs: Long,
    nowMillis: Long,
    applied: Boolean,
    onApply: (() -> Unit)?,
) {
    SidekickCard(padding = Space.md) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.sm),
        ) {
            DirectionPill(fromMac = fromMac)
            Spacer(Modifier.weight(1f))
            Text(
                RelativeTime.of(atMs, nowMillis),
                style = SidekickType.meta,
                color = SidekickColors.textMeta,
            )
        }

        Spacer(Modifier.height(Space.sm))

        Text(
            preview ?: "(not text)",
            style = SidekickType.body,
            color = if (preview != null) SidekickColors.textPrimary else SidekickColors.textMeta,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )

        if (fromMac) {
            Spacer(Modifier.height(Space.md))
            if (applied) {
                StatusPill("On your clipboard", StatusKind.Connected)
            } else if (onApply != null && preview != null) {
                PrimaryButton(
                    text = "Copy to this phone",
                    onClick = onApply,
                    icon = Icons.Outlined.ContentCopy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun DirectionPill(fromMac: Boolean) {
    val icon: ImageVector = if (fromMac) Icons.Outlined.Laptop else Icons.Outlined.PhoneAndroid
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        IconBadge(icon, size = 28.dp, tint = SidekickColors.textBody)
        Text(
            if (fromMac) "From your Mac" else "From this phone",
            style = SidekickType.meta,
            color = SidekickColors.onControl,
        )
    }
}

/**
 * Why phone → Mac is not automatic, standing on the screen rather than appearing after a failure.
 *
 * One result for two intents again: a clip that was never read and a clip that was read and not
 * sent look identical from here, so nothing may be reported afterwards. The explanation has to
 * arrive first.
 */
@Composable
private fun FocusWallCard() {
    SidekickCard(padding = Space.md) {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(Icons.Outlined.Info, tint = SidekickColors.textBody)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                Text(
                    "Copying on this phone sends when you open Sidekick",
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Android forbids every app from reading the clipboard in the background — not " +
                        "just this one, and no permission changes it. Copy in another app, come " +
                        "back here, and it goes the moment this screen appears. From the Mac it " +
                        "arrives straight away.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
            }
        }
    }
}

@Composable
private fun MemoryOnlyFooter(historySize: Int) {
    SidekickCard(
        modifier = Modifier.padding(top = Space.md),
        padding = Space.md,
        container = SidekickColors.canvas,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(Icons.Outlined.Info, tint = SidekickColors.textMeta)
            Text(
                if (historySize > 0) {
                    "$historySize entries are held in memory only, and are cleared when the Mac " +
                        "disconnects. Nothing is written to storage and nothing is logged."
                } else {
                    "Entries are held in memory only, and are cleared when the Mac disconnects. " +
                        "Nothing is written to storage and nothing is logged."
                },
                style = SidekickType.caption,
                color = SidekickColors.textMeta,
                modifier = Modifier.weight(1f),
            )
        }
    }
}
