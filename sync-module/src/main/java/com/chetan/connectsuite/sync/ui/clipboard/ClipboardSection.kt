package com.chetan.connectsuite.sync.ui.clipboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.sync.v2.ClipFeature

/**
 * The phone's clipboard screen — and it is mostly one sentence of standing copy.
 *
 * ### Why the wall is furniture here too
 *
 * The same shape as the Folders screen's `Download` card, for the same reason and from a different
 * platform rule. Android will not let this app read the clipboard unless it is the focused app
 * (measured — `docs/testing.md` → Slice 11), so **the phone-to-Mac direction only happens in the
 * moment somebody opens this app.** That is not a failure to report afterwards; it is the shape of
 * the feature, and the only place to say it is before they wonder why nothing arrived.
 *
 * A person who copies something in another app and comes back here will find it already sent —
 * `MainActivity.onWindowFocusChanged` is what does it — so the card reports what *was* sent rather
 * than offering a button that repeats it. The button exists for the other direction only.
 *
 * ### The other direction is offered, never applied
 *
 * An entry from the Mac lands in the history and waits. A clipboard is a single-slot store with no
 * undo, and applying one silently would destroy whatever the person was about to paste. Writing is
 * permitted from anywhere on this device — that was measured too — so the confirmation is a choice,
 * not a limit.
 */
@Composable
fun ClipboardSection(
    state: ClipFeature.PhoneState,
    onApplyFromMac: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("How this works", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Android only lets ConnectSuite read your clipboard while it is on screen. " +
                            "So copy something in another app, come back here, and it goes to your " +
                            "Mac the moment this screen appears.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        "Text copied on your Mac arrives any time — it waits here until you tap " +
                            "Copy, because putting it on your clipboard would replace what is " +
                            "already there.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }

        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Sent to your Mac", style = MaterialTheme.typography.titleMedium)
                    val sent = state.lastSentPreview
                    if (sent == null) {
                        Text(
                            if (state.linkUp) {
                                "Nothing yet. Copy something in another app and open this screen."
                            } else {
                                "Not connected to a Mac."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        Text(sent, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }

        item {
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                ),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("From your Mac", style = MaterialTheme.typography.titleMedium)
                    val received = state.lastReceivedPreview
                    if (received == null) {
                        Text("Nothing yet.", style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text(received, maxLines = 6, overflow = TextOverflow.Ellipsis)
                        Button(onClick = { onApplyFromMac(received) }) {
                            Text("Copy to this phone")
                        }
                    }
                }
            }
        }

        item {
            Text(
                "${state.historySize} of ${com.chetan.connectsuite.sync.v2.ClipboardPayloads.HISTORY_MAX} " +
                    "entries held, in memory only. They are cleared when the Mac disconnects and " +
                    "are never written to storage. Anything an app marks as sensitive — a password " +
                    "manager's copy — is never sent and never kept.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
