package com.chetan.connectsuite.sync.ui.devices

import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.sync.v2.ClipFeature

/** What kind of thing happened. The icon and any tint follow from this, never from the caller. */
enum class ActivityKind { ClipSent, ClipReceived, TransferIn, TransferOut, Notifications }

/** One line of the Recent activity card. [atMillis] is the real event time, not the render time. */
data class ActivityItem(
    val id: String,
    val kind: ActivityKind,
    val title: String,
    val subtitle: String?,
    val atMillis: Long,
)

/**
 * Recent activity, merged from the three stores that already hold it.
 *
 * ### This invents nothing
 *
 * There is no activity log on the phone — the Mac has an Activity pane, the phone has never had
 * one. Rather than add a fourth store for a card, this is a **projection** over state the Sync
 * screen already collects: the transfer history (Room, real `updatedAtMillis`), the mirrored
 * notifications (Room, real `postedAtMillis`), and the clipboard's last-sent/last-received
 * timestamps (in memory, by design — `docs/phase-5-clipboard-proposal.md` §6).
 *
 * The consequence is stated on screen rather than hidden: the clipboard half is memory-only, so
 * after a restart it is genuinely absent, and the card's empty state says so instead of drawing a
 * blank list.
 *
 * ### Newest first, and there is a test for that specific sentence
 *
 * `CLAUDE.md` records Overview's *Recent activity* on the Mac drawing the five **oldest** events —
 * a defect nothing in the build could have noticed, because a list of plausible rows in the wrong
 * order looks exactly like a list of plausible rows. The sort is descending and
 * `RecentActivityTest` fails if it is reversed.
 */
object RecentActivity {

    const val DEFAULT_LIMIT = 4

    fun of(
        transfers: List<TransferEntity>,
        notifications: List<MirroredNotificationEntity>,
        clip: ClipFeature.PhoneState,
        limit: Int = DEFAULT_LIMIT,
    ): List<ActivityItem> {
        val items = mutableListOf<ActivityItem>()

        transfers.forEach { t ->
            items += ActivityItem(
                id = "transfer:${t.transferId}",
                kind = if (t.direction == TransferDirection.INCOMING) {
                    ActivityKind.TransferIn
                } else {
                    ActivityKind.TransferOut
                },
                title = if (t.direction == TransferDirection.INCOMING) {
                    "Received from your Mac"
                } else {
                    "Sent to your Mac"
                },
                subtitle = "${t.fileName} · ${formatBytes(t.totalBytes)}",
                atMillis = t.updatedAtMillis,
            )
        }

        // One row for the batch rather than one per notification: four rows all reading
        // "notification mirrored" would crowd out the other two kinds entirely on a busy phone,
        // and the count is the part that carries information.
        if (notifications.isNotEmpty()) {
            val newest = notifications.maxOf { it.postedAtMillis }
            val apps = notifications.map { it.appName }.distinct()
            items += ActivityItem(
                id = "notifications:$newest",
                kind = ActivityKind.Notifications,
                title = if (notifications.size == 1) {
                    "1 notification mirrored"
                } else {
                    "${notifications.size} notifications mirrored"
                },
                subtitle = apps.take(3).joinToString(" · "),
                atMillis = newest,
            )
        }

        if (clip.lastSentAtMs > 0L) {
            items += ActivityItem(
                id = "clip-sent:${clip.lastSentAtMs}",
                kind = ActivityKind.ClipSent,
                title = "Sent to your Mac",
                subtitle = clip.lastSentPreview?.let { "“$it”" },
                atMillis = clip.lastSentAtMs,
            )
        }
        if (clip.lastReceivedAtMs > 0L) {
            items += ActivityItem(
                id = "clip-received:${clip.lastReceivedAtMs}",
                kind = ActivityKind.ClipReceived,
                title = if (clip.lastReceivedApplied) "Copied from your Mac" else "Ready from your Mac",
                subtitle = clip.lastReceivedPreview?.let { "“$it”" },
                atMillis = clip.lastReceivedAtMs,
            )
        }

        return items.sortedByDescending { it.atMillis }.take(limit)
    }

    /**
     * Bytes in the unit a person reads, which is not the unit the transfer layer counts in.
     *
     * Decimal (1000) rather than binary (1024): this number sits beside a file name the user chose
     * in a file manager, and every file manager on both platforms shows decimal.
     */
    internal fun formatBytes(bytes: Long): String = when {
        bytes < 1_000 -> "$bytes B"
        bytes < 1_000_000 -> String.format("%.1f KB", bytes / 1_000.0)
        bytes < 1_000_000_000 -> String.format("%.1f MB", bytes / 1_000_000.0)
        else -> String.format("%.2f GB", bytes / 1_000_000_000.0)
    }
}
