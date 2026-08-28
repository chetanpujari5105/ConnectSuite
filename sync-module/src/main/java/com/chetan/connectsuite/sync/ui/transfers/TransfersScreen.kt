package com.chetan.connectsuite.sync.ui.transfers

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.transfer.PendingIncomingOffer
import com.chetan.connectsuite.sync.transfer.TransferProgress
import java.util.Locale
import kotlin.math.abs

@Composable
fun TransfersSection(
    state: TransfersUiState,
    onCancel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (state.active.isEmpty() && state.history.isEmpty()) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp)) {
                        Text("No transfers yet", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Pick a connected device on the Devices tab and tap Send files. " +
                                "Received files are saved to Downloads/ConnectSuite.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        if (state.active.isNotEmpty()) {
            item { SectionHeader("In progress") }
            items(state.active, key = { it.transferId }) { progress ->
                ActiveTransferCard(progress, onCancel = { onCancel(progress.jobId) })
            }
        }

        if (state.history.isNotEmpty()) {
            item { SectionHeader("History") }
            items(state.history, key = { it.transferId }) { entity ->
                HistoryRow(entity)
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun ActiveTransferCard(progress: TransferProgress, onCancel: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (progress.direction == TransferDirection.OUTGOING) {
                        Icons.Outlined.ArrowUpward
                    } else {
                        Icons.Outlined.ArrowDownward
                    },
                    contentDescription = null,
                )
                Spacer(Modifier.fillMaxWidth(0.03f))
                Text(
                    progress.fileName,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onCancel) { Text("Cancel") }
            }

            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress.fraction },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                buildString {
                    append(formatBytes(progress.bytesTransferred))
                    append(" of ")
                    append(formatBytes(progress.totalBytes))
                    if (progress.bytesPerSecond > 0) {
                        append(" · ")
                        append(formatBytes(progress.bytesPerSecond))
                        append("/s")
                    }
                    progress.etaSeconds?.let {
                        append(" · ")
                        append(formatDuration(it))
                        append(" left")
                    }
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun HistoryRow(entity: TransferEntity) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = when (entity.status) {
                TransferStatus.FAILED -> MaterialTheme.colorScheme.errorContainer
                TransferStatus.PAUSED -> MaterialTheme.colorScheme.tertiaryContainer
                else -> MaterialTheme.colorScheme.surfaceVariant
            },
        ),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (entity.direction == TransferDirection.OUTGOING) {
                    Icons.Outlined.ArrowUpward
                } else {
                    Icons.Outlined.ArrowDownward
                },
                contentDescription = null,
            )
            Spacer(Modifier.fillMaxWidth(0.03f))
            Column(Modifier.weight(1f)) {
                Text(
                    entity.fileName,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    entity.statusLine(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Asks the user before a single byte of an incoming job is written. */
@Composable
fun IncomingOfferDialog(
    offer: PendingIncomingOffer,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    val fileCount = offer.offer.files.size
    AlertDialog(
        onDismissRequest = onDecline,
        title = { Text("Receive from ${offer.peerName}?") },
        text = {
            Column {
                Text(
                    if (fileCount == 1) {
                        offer.offer.files.first().name
                    } else {
                        "$fileCount files"
                    },
                    style = MaterialTheme.typography.titleSmall,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "${formatBytes(offer.offer.totalBytes)} · saved to Downloads/ConnectSuite",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button(onClick = onAccept) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDecline) { Text("Decline") } },
    )
}

private fun TransferEntity.statusLine(): String = when (status) {
    TransferStatus.COMPLETED -> "${formatBytes(totalBytes)} · done"
    TransferStatus.FAILED -> errorMessage ?: "Failed"
    TransferStatus.PAUSED ->
        "Paused at ${formatBytes(bytesTransferred)} — resumes when the device reconnects"
    TransferStatus.CANCELLED -> "Cancelled"
    TransferStatus.PENDING -> "Waiting for the other device"
    TransferStatus.RUNNING -> "${formatBytes(bytesTransferred)} of ${formatBytes(totalBytes)}"
}

internal fun formatBytes(bytes: Long): String {
    val absolute = abs(bytes)
    return when {
        absolute < 1024 -> "$bytes B"
        absolute < 1024 * 1024 -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
        absolute < 1024L * 1024 * 1024 ->
            String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024))
        else -> String.format(Locale.US, "%.2f GB", bytes / (1024.0 * 1024 * 1024))
    }
}

internal fun formatDuration(seconds: Long): String = when {
    seconds < 60 -> "${seconds}s"
    seconds < 3600 -> "${seconds / 60}m ${seconds % 60}s"
    else -> "${seconds / 3600}h ${(seconds % 3600) / 60}m"
}
