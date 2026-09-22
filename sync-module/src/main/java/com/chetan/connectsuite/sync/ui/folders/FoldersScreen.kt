package com.chetan.connectsuite.sync.ui.folders

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
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * The Folders screen: the only place in a release build where a folder can be shared with the Mac.
 *
 * ### The wall card is furniture, not an error state
 *
 * It is drawn in every state, including when folders exist. Android refuses the storage root and
 * `Download` by **disabling the confirm button inside its own picker** — there is no error to catch
 * and no result to explain afterwards, because a refusal and a cancellation arrive as the same
 * `null` (`FoldersViewModel.onPicked`). The only moment this app can say what cannot be shared is
 * *before* the user goes looking, so the card is permanent copy rather than a message.
 *
 * ### There is no "couldn't load" state and there must not be one
 *
 * See [FoldersUiState]. This screen reads the platform's own list synchronously; it cannot fail. A
 * failure state here would be unreachable, and an unreachable state drawn beside a reachable one is
 * indistinguishable from a bug in the reachable one.
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
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Column {
                Text("Folders", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    "The Mac can open the folders you add here, and nothing else on this phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // The quick picks, drawn in every state — a phone with two folders shared still has a
        // third worth adding, and hiding the shortcuts once the list is non-empty would make them
        // an onboarding decoration rather than a control.
        //
        // Empty is a legitimate state and draws nothing: every chip already granted is every chip
        // hidden, and an empty rail with a heading over it would be a label for nothing.
        if (quickPicks.isNotEmpty()) {
            item { QuickPickRow(quickPicks, onQuickPick) }
        }

        when (state) {
            FoldersUiState.NoFolders -> item { NoFoldersCard(onAddFolder) }

            is FoldersUiState.Folders -> {
                item {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(onClick = onAddFolder) { Text("Add folder") }
                    }
                }
                items(state.rows, key = { it.rootId }) { row ->
                    FolderCard(row, onRemove = { onRemove(row.rootId) })
                }
            }
        }

        item { WallCard() }
    }
}

/**
 * The chips: one tap into a folder the picker will actually open in.
 *
 * **What makes these honest is a hardware reading, not a hope** — `EXTRA_INITIAL_URI` is honoured on
 * this handset, and a chip aimed at a folder that does not exist lands in its parent rather than in
 * `Download`'s refusal. [FolderQuickPicks] holds both readings and the constraint that falls out of
 * them. Neither is re-argued here.
 *
 * Each chip carries its own accessibility label rather than relying on the text, because the label
 * a driver presses is the one thing about this row that must not move.
 */
@Composable
private fun QuickPickRow(
    picks: List<FolderQuickPicks.Pick>,
    onQuickPick: (FolderQuickPicks.Pick) -> Unit,
) {
    Column {
        Text(
            "Quick picks",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            picks.forEach { pick ->
                AssistChip(
                    onClick = { onQuickPick(pick) },
                    label = { Text(pick.label) },
                    modifier = Modifier.semantics {
                        contentDescription = "Share the ${pick.label} folder"
                    },
                )
            }
        }
    }
}

@Composable
private fun NoFoldersCard(onAddFolder: () -> Unit) {
    Card(Modifier.fillMaxWidth().semantics { contentDescription = "No folders yet" }) {
        Column(Modifier.padding(20.dp)) {
            Text("No folders yet", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                "Add a folder and the Mac can open it. Until you do, the Mac sees only " +
                    "Sidekick's own folder.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            // The counter-rule from CLAUDE.md, in copy: a limit with no working case beside it
            // reads as the feature being broken. Receiving already works and needs nothing here.
            Text(
                "Files sent to this phone need no folder at all — they arrive in " +
                    "Download › ConnectSuite.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(onClick = onAddFolder) { Text("Add folder") }
            }
        }
    }
}

@Composable
private fun FolderCard(row: FolderRow, onRemove: () -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        colors = if (row.resolves) {
            CardDefaults.cardColors()
        } else {
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        },
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                row.label,
                style = MaterialTheme.typography.titleMedium,
                color = if (row.resolves) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (row.resolves) row.access else "This folder is gone from the phone",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Removing it takes away the Mac's access. Nothing on the phone is deleted.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(
                    onClick = onRemove,
                    modifier = Modifier.semantics {
                        contentDescription = "Remove ${row.label}"
                    },
                ) { Text("Remove") }
            }
        }
    }
}

@Composable
private fun WallCard() {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "Two folders Android will not give any app",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Download itself can never be added — Android refuses it. Folders inside it are " +
                    "fine, so Download › ConnectSuite works. But a file your browser or " +
                    "WhatsApp saves straight into Download cannot be reached from the Mac at all. " +
                    "Move it into a folder you have added and it appears.",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Android › data and Android › obb are closed to every app on this phone, " +
                    "including this one.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
