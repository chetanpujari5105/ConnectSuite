package com.chetan.connectsuite.sync.ui.folders

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOff
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.DestructiveButton
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill

/**
 * Folders — reference `12_android_folders.png`.
 *
 * ### The reference draws a catalogue this app does not have, and one row it must never have
 *
 * The image lists **Downloads** as a folder you can Add. Android refuses `Download` to every app,
 * measured on this handset and written into `docs/protocol.md`: the picker lists it normally and
 * **disables** the confirm button. Offering it would produce a tap that leads to a wall with no
 * error — and the same image carries a card at the bottom explaining that the wall exists. A row
 * that contradicts the card two inches below it is the status island's defect in a list.
 *
 * The rest of the catalogue — Documents, Pictures, Videos, each with a file count and a size — is
 * not this screen's model either. What exists is **grants the user has made** (`FolderRow`), and
 * counting the files inside a SAF tree means enumerating it: `fs.list` over one 16,377-entry
 * directory took **490 seconds** before the snapshot fix, and that is per folder, on this screen,
 * on every open. Those numbers are not available and are not drawn.
 *
 * Six folder colours — green, blue, purple, orange, cyan, pink — are the category-hue system the
 * brief rules out by name. One accent, and it means *shared*.
 *
 * ### The quick picks are two, by decision
 *
 * `FolderQuickPicks.ALL` offered four. Camera and Screenshots are what this screen shows, per an
 * explicit product decision. Documents and Pictures were **not removed because they were broken** —
 * both are safe targets that `EXTRA_INITIAL_URI` honours on this handset. Restoring them is adding
 * two lines back to that list.
 *
 * ### Four states, and none of them is a failure
 *
 * `FoldersUiState` has two variants and this screen draws no "couldn't load" card, because the
 * read is `contentResolver.persistedUriPermissions` — in-process, synchronous, no provider that can
 * answer a bound argument with an empty cursor. **It cannot fail to load**, so a failure state here
 * would be unfalsifiable forever. `docs/phase-5-files-onboarding-proposal.md` §3.
 */
@Composable
fun FoldersSection(
    state: FoldersUiState,
    onAddFolder: () -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
    quickPicks: List<FolderQuickPicks.Pick> = emptyList(),
    onQuickPick: (FolderQuickPicks.Pick) -> Unit = {},
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(
            start = Space.lg,
            end = Space.lg,
            bottom = Space.xl,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item {
            Text(
                "Choose what your Mac can open. Nothing outside these folders is visible to it.",
                style = SidekickType.body,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(bottom = Space.md),
            )
        }

        when (state) {
            is FoldersUiState.NoFolders -> item {
                SidekickCard(
                    padding = Space.xs,
                    modifier = Modifier.semantics { contentDescription = "No folders yet" },
                ) {
                    StateBlock(
                        kind = StateKind.Empty,
                        icon = Icons.Outlined.Folder,
                        headline = "No folders yet",
                        // The counter-rule from CLAUDE.md, in copy: a limit with no working case
                        // beside it reads as the feature being broken. Receiving already works and
                        // needs nothing here.
                        // **No action on this block.** `AddFolderRow` is directly beneath it and
                        // is the persistent control in every state; an "Add folder" button here
                        // as well put two identically-labelled controls on one screen, which a UI
                        // dump could not disambiguate and a person has to think about. The empty
                        // state explains; the row acts.
                        body = "Add one and the Mac can open it. Files sent *to* this phone need " +
                            "no folder at all — they arrive in Download › ConnectSuite.",
                    )
                }
            }

            is FoldersUiState.Folders -> items(state.rows, key = { it.rootId }) { row ->
                FolderCard(row = row, onRemove = { onRemove(row.rootId) })
            }
        }

        if (quickPicks.isNotEmpty()) {
            item {
                Text(
                    "Common folders",
                    style = SidekickType.section,
                    color = SidekickColors.textPrimary,
                    modifier = Modifier.padding(top = Space.md, bottom = Space.xs),
                )
            }
            items(quickPicks, key = { it.documentId }) { pick ->
                QuickPickRow(pick = pick, onClick = { onQuickPick(pick) })
            }
        }

        item { AddFolderRow(onAddFolder) }

        item { DownloadWallCard() }
    }
}

@Composable
private fun FolderCard(row: FolderRow, onRemove: () -> Unit) {
    SidekickCard(padding = Space.md) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                icon = if (row.resolves) Icons.Outlined.Folder else Icons.Outlined.FolderOff,
                tint = if (row.resolves) SidekickColors.accent else SidekickColors.warning,
                container = if (row.resolves) SidekickColors.accentTint else SidekickColors.warningTint,
                border = if (row.resolves) SidekickColors.accentBorder else SidekickColors.warningBorder,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.label,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        !row.resolves -> "This folder is gone — the grant outlived it"
                        row.writable -> "The Mac can read and write here"
                        else -> "The Mac can read here"
                    },
                    style = SidekickType.caption,
                    color = if (row.resolves) SidekickColors.textBody else SidekickColors.warning,
                )
            }
            StatusPill(
                text = if (row.resolves) "Shared" else "Missing",
                kind = if (row.resolves) StatusKind.Connected else StatusKind.Warning,
            )
        }

        Row(
            Modifier.fillMaxWidth().padding(top = Space.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            // Kept on a missing folder too: a grant the user cannot see is one they cannot remove,
            // and this row is the only place they can. `FsRoots.all` keeps it for the same reason.
            DestructiveButton("Remove", onRemove)
        }
    }
}

@Composable
private fun QuickPickRow(pick: FolderQuickPicks.Pick, onClick: () -> Unit) {
    SidekickCard(
        padding = Space.md,
        onClick = onClick,
        modifier = Modifier.semantics {
            contentDescription = "Share the ${pick.label} folder"
        },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(Icons.Outlined.Folder)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    pick.label,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Opens the picker at this folder",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
            }
            // Muted, not lime. The rule is that colour on an icon reports a state; "this row adds
            // something" is an affordance, and the row's own label already says it.
            Icon(
                Icons.Outlined.Add,
                contentDescription = null,
                tint = SidekickColors.textBody,
                modifier = Modifier.size(Size.iconLarge),
            )
        }
    }
}

/** The dashed row from the reference. A real control, so it gets a real target size. */
@Composable
private fun AddFolderRow(onAddFolder: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = Space.sm)
            .clip(Radius.cardShape)
            .background(SidekickColors.canvas)
            .border(BorderStroke(Size.hairline, SidekickColors.borderStrong), Radius.cardShape)
            .clickable(onClick = onAddFolder)
            .padding(Space.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        IconBadge(Icons.Outlined.Add, container = SidekickColors.card)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "Add folder",
                style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                color = SidekickColors.textPrimary,
            )
            Text(
                "Choose any folder to share",
                style = SidekickType.caption,
                color = SidekickColors.textBody,
            )
        }
    }
}

/**
 * The wall, as permanent copy.
 *
 * It is on screen in **every** state, and that is the rule rather than a layout choice. Android
 * refuses a folder by disabling a button inside its own picker; a cancel and a refusal both come
 * back as `null`, so nothing may be said *afterwards* — there is no afterwards. The explanation has
 * to have arrived before the tap. `FoldersViewModel.onPicked` carries the full reasoning.
 */
@Composable
private fun DownloadWallCard() {
    SidekickCard(
        modifier = Modifier.padding(top = Space.md),
        container = SidekickColors.warningTint,
        border = SidekickColors.warningBorder,
    ) {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                Icons.Outlined.Info,
                tint = SidekickColors.warning,
                container = SidekickColors.warningTint,
                border = SidekickColors.warningBorder,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                Text(
                    "Two folders Android will not give any app",
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    "Download itself can never be added — Android refuses it. Folders inside it " +
                        "are fine, so Download › ConnectSuite works. But a file your browser or " +
                        "WhatsApp saves straight into Download cannot be reached from the Mac at " +
                        "all. Move it into a folder you have added and it appears.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
                Text(
                    "Android › data and Android › obb are closed to every app on this phone, " +
                        "including this one.",
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
            }
        }
    }
}
