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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.SouthWest
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.sync.transfer.PendingIncomingOffer
import com.chetan.connectsuite.core.ui.RelativeTime
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.FilterSegment
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SegmentedFilter
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.SidekickProgress
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind

/**
 * Transfers — reference `11_android_transfers.png`.
 *
 * ### What the reference draws that this app cannot do
 *
 * - **A pause button on every live row.** There is no user-initiated pause. `TransferStatus.PAUSED`
 *   is written by `TransferManager` and `BulkTransfers` when the **connection drops** — the error
 *   string on those rows is literally `"Connection lost"`. Pausing is something that happens *to* a
 *   transfer here, not something a person does, and a ⏸ that does nothing is worse than no ⏸.
 *   The one real action on a live row is **Cancel**, and that is what is drawn.
 * - **"Failed — retry" as a button.** `resumePausedTransfers` resumes `PAUSED` work and nothing
 *   resumes `FAILED` work. A failed row shows its real `errorMessage` instead of an affordance that
 *   would not fire.
 * - **A search field and a header overflow.** Neither has anything behind it.
 * - **Per-file-type colour** — blue images, red PDFs, purple video, orange archives. That is the
 *   category-hue system the brief rules out by name. The *glyph* still varies by type, because that
 *   carries information; the colour does not, because it does not.
 *
 * ### What is real and is drawn
 *
 * The bar, the percentage, the byte total, the direction, the relative time — and the ETA, which
 * comes from `TransferProgress.etaSeconds` and is **already written to return null** when there is
 * not enough throughput data to say. So "2 min left" appears exactly when it is known and is absent
 * otherwise, rather than being a guess that is always present.
 */
@Composable
fun TransfersSection(
    state: TransfersUiState,
    onCancel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var filter by rememberSaveable { mutableStateOf(TransferFilter.All) }
    val counts = TransferFeed.counts(state.active, state.history)
    val rows = TransferFeed.rows(state.active, state.history, filter)

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
                "Files sent between this phone and your Mac.",
                style = SidekickType.body,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(bottom = Space.md),
            )
        }

        item {
            SegmentedFilter(
                segments = TransferFilter.entries.map {
                    FilterSegment(it.label(), counts[it] ?: 0)
                },
                selectedIndex = TransferFilter.entries.indexOf(filter),
                onSelect = { filter = TransferFilter.entries[it] },
                modifier = Modifier.padding(bottom = Space.sm),
            )
        }

        if (rows.isEmpty()) {
            item {
                SidekickCard(padding = Space.xs) {
                    StateBlock(
                        kind = StateKind.Empty,
                        headline = when (filter) {
                            TransferFilter.All -> "Nothing has moved yet"
                            TransferFilter.Sending -> "Nothing sent yet"
                            TransferFilter.Received -> "Nothing received yet"
                        },
                        body = "Send something from the Devices screen, or drop a file onto this " +
                            "phone from Sidekick on your Mac. Anything the Mac sends arrives in " +
                            "Download › ConnectSuite and needs no folder permission.",
                    )
                }
            }
        }

        items(rows, key = { it.id }) { row ->
            TransferCard(row = row, onCancel = { onCancel(row.jobId) })
        }
    }
}

@Composable
private fun TransferCard(row: TransferRowModel, onCancel: () -> Unit) {
    SidekickCard(padding = Space.md) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(icon = row.glyph(), tint = SidekickColors.textBody)

            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.fileName,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    row.subtitle(),
                    style = SidekickType.caption,
                    color = if (row.status == TransferStatus.FAILED) {
                        SidekickColors.destructive
                    } else {
                        SidekickColors.textBody
                    },
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            TrailingState(row = row, onCancel = onCancel)
        }

        if (row.fraction != null) {
            Spacer(Modifier.height(Space.md))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                SidekickProgress(
                    progress = row.fraction,
                    tone = row.tone(),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${(row.fraction * 100).toInt()}%",
                    style = SidekickType.meta,
                    color = SidekickColors.textMeta,
                )
            }
        }
    }
}

/**
 * The right-hand end of a row: one control if there is a real one, otherwise one state glyph.
 *
 * Cancel is a labelled control rather than a bare ✕ because it ends somebody's file transfer and
 * the reference's circular icon buttons give no clue which of them is destructive.
 */
@Composable
private fun TrailingState(row: TransferRowModel, onCancel: () -> Unit) {
    if (row.canCancel) {
        SecondaryButton(
            text = "Cancel",
            onClick = onCancel,
            icon = Icons.Outlined.Close,
        )
        return
    }
    val (icon, tint) = when (row.status) {
        TransferStatus.COMPLETED -> Icons.Outlined.Check to SidekickColors.accent
        TransferStatus.FAILED -> Icons.Outlined.ErrorOutline to SidekickColors.destructive
        TransferStatus.PAUSED -> Icons.Outlined.PauseCircle to SidekickColors.warning
        TransferStatus.CANCELLED -> Icons.Outlined.Close to SidekickColors.textMeta
        else -> Icons.Outlined.InsertDriveFile to SidekickColors.textMeta
    }
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(Size.iconLarge))
}

private fun TransferFilter.label(): String = when (this) {
    TransferFilter.All -> "All"
    TransferFilter.Sending -> "Sending"
    TransferFilter.Received -> "Received"
}

private fun TransferRowModel.tone(): Color = when (status) {
    TransferStatus.PAUSED -> SidekickColors.warning
    TransferStatus.FAILED -> SidekickColors.destructive
    else -> SidekickColors.accent
}

/**
 * The glyph varies by file type; the colour does not.
 *
 * Mime-derived, so it says something true about the file. The brief forbids a category *hue*
 * system, not a category *glyph* — a shape carries the information without spending the one accent
 * this product has on a distinction that is not a state.
 */
private fun TransferRowModel.glyph(): ImageVector {
    val name = fileName.substringAfterLast('.', "").lowercase()
    return when {
        name in setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "bmp") -> Icons.Outlined.Image
        name in setOf("mp4", "mov", "mkv", "avi", "webm", "m4v") -> Icons.Outlined.Videocam
        name in setOf("mp3", "wav", "flac", "m4a", "aac", "ogg") -> Icons.Outlined.MusicNote
        name == "pdf" -> Icons.Outlined.PictureAsPdf
        name in setOf("zip", "tar", "gz", "rar", "7z") -> Icons.Outlined.FolderZip
        name in setOf("txt", "md", "rtf", "doc", "docx", "csv") -> Icons.Outlined.Article
        else -> Icons.Outlined.InsertDriveFile
    }
}

/** Size, then what is happening, then when — in that order, because that is what is asked first. */
private fun TransferRowModel.subtitle(): String {
    val size = formatBytes(totalBytes)
    // "to Mac" / "from Mac" rather than "Sending to Mac" / "Receiving": the row is already in a
    // list called Transfers, under a chip that says Sending or Received, and the long form is what
    // made the live rows wrap.
    val way = if (direction == TransferDirection.OUTGOING) "to Mac" else "from Mac"
    return when (status) {
        TransferStatus.RUNNING, TransferStatus.PENDING -> {
            // `etaSeconds` is an integer division, so a transfer with less than one second of data
            // left computes to **0** — and "0 sec left" sat on screen next to a bar at 68%, which
            // is both wrong and unsettling. Zero here means "under a second", and the bar and the
            // percentage already say that better than a number can.
            //
            // The rate is deliberately not shown as well. It is real, but the ETA is derived from
            // it, so printing both spends a second line on one fact — and on the emulator that
            // second line is exactly what pushed these rows to double height.
            val eta = etaSeconds?.takeIf { it > 0 }?.let { " · ${formatEta(it)} left" }.orEmpty()
            "$size · $way$eta"
        }
        // The real reason, from the transfer layer. `TransferManager` writes "Connection lost"
        // here, which is a better sentence than anything this screen could invent.
        TransferStatus.PAUSED -> "$size · Paused${error?.let { " — $it" }.orEmpty()} · resumes when the Mac is back"
        TransferStatus.FAILED -> "$size · ${error ?: "Transfer failed"}"
        TransferStatus.CANCELLED -> "$size · Cancelled"
        TransferStatus.COMPLETED -> {
            val where = if (direction == TransferDirection.OUTGOING) {
                "Sent to Mac"
            } else {
                "Saved to Download › ConnectSuite"
            }
            "$size · $where"
        }
    }
}

/** `2 min`, `45 sec`, `1 hr 5 min`. Never `0 min`. */
internal fun formatEta(seconds: Long): String = when {
    seconds < 60 -> "$seconds sec"
    seconds < 3_600 -> "${seconds / 60} min"
    else -> "${seconds / 3600} hr ${(seconds % 3600) / 60} min"
}

/** Decimal, to match every file manager on both platforms. */
internal fun formatBytes(bytes: Long): String = when {
    bytes < 1_000 -> "$bytes B"
    bytes < 1_000_000 -> String.format("%.1f KB", bytes / 1_000.0)
    bytes < 1_000_000_000 -> String.format("%.1f MB", bytes / 1_000_000.0)
    else -> String.format("%.2f GB", bytes / 1_000_000_000.0)
}

/**
 * The incoming-offer confirmation. Behaviour unchanged; the chrome is the design system's.
 *
 * It stays a dialog rather than a row, because accepting writes files to this phone and that is a
 * decision the person has to make rather than one they can scroll past.
 */
@Composable
fun IncomingOfferDialog(
    offer: PendingIncomingOffer,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    val files = offer.offer.files
    val total = files.sumOf { it.size }
    AlertDialog(
        onDismissRequest = onDecline,
        containerColor = SidekickColors.card,
        titleContentColor = SidekickColors.textPrimary,
        textContentColor = SidekickColors.textBody,
        title = { Text("Receive from ${offer.peerName}?", style = SidekickType.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                Text(
                    if (files.size == 1) files.first().name else "${files.size} files",
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Text(
                    formatBytes(total),
                    style = SidekickType.caption,
                    color = SidekickColors.textBody,
                )
                Text(
                    "Saved to Download › ConnectSuite.",
                    style = SidekickType.caption,
                    color = SidekickColors.textMeta,
                )
            }
        },
        confirmButton = { PrimaryButton("Accept", onAccept) },
        dismissButton = {
            TextButton(onClick = onDecline) {
                Text("Decline", style = SidekickType.control, color = SidekickColors.textBody)
            }
        },
    )
}
