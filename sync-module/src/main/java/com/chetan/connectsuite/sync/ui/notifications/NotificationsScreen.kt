package com.chetan.connectsuite.sync.ui.notifications

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.RelativeTime
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.AvatarBadge
import com.chetan.connectsuite.core.ui.components.HeaderIconButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind

/**
 * Feed — reference `14_android_feed.png`.
 *
 * ### The reference has the direction backwards, and that changes the screen
 *
 * Its subtitle is *"Notifications from your phone."* These are not this phone's notifications.
 * `MirroredNotificationEntity` is keyed `"<peerDeviceId>:<remoteKey>"` and is written by
 * `MirroredNotificationRepository.onPosted` from a packet **another paired device sent**. This is
 * the v1 Android-to-Android feature: somebody else's phone, shown here. Getting that backwards
 * would have made every sentence on the screen wrong in the same direction.
 *
 * ### Three things in the reference that do not exist
 *
 * - **Reply buttons.** Reply is a **Mac → phone** verb: `notif.reply` arrives, `NotificationFeature`
 *   fires the originating app's own `PendingIntent`. This phone *executes* replies; it has no reply
 *   path for a notification mirrored *to* it, and `MirroredNotificationEntity` carries no reply
 *   action, no `canReply` and no `RemoteInput` — those live on the outgoing side in
 *   `NotificationRelay`. A reply box here would have nothing to fire.
 * - **The "Can reply" filter**, for the same reason: the field it would filter on is not in this
 *   table.
 * - **A Sound toggle.** There is no such setting anywhere in `SettingsStore`.
 *
 * ### What is real and is drawn
 *
 * The app icon. `MirroredNotificationEntity.iconBase64` is the sender's own small icon, downscaled
 * before it went over the wire — so these are genuine icons rather than a palette of brand circles,
 * and [AvatarBadge] is the fallback when an app sent none. Also: the app name, title, text,
 * `postedAtMillis`, and **dismiss**, which clears the notification on the other device too.
 */
@Composable
fun NotificationsSection(
    state: NotificationsUiState,
    onDismiss: (MirroredNotificationEntity) -> Unit,
    onEnableListener: () -> Unit,
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
                "Notifications mirrored here from your paired devices.",
                style = SidekickType.body,
                color = SidekickColors.textBody,
                modifier = Modifier.padding(bottom = Space.md),
            )
        }

        if (!state.listenerEnabled) {
            item {
                SidekickCard(padding = Space.xs) {
                    StateBlock(
                        kind = StateKind.Permission,
                        headline = "Notification access is off",
                        body = "This phone can still receive notifications from a paired device " +
                            "and show them here. It cannot send its own until you turn Sidekick " +
                            "on in Android's notification access settings — Android grants that " +
                            "nowhere else, and it cannot be done from inside the app.",
                        actionLabel = "Open notification access",
                        onAction = onEnableListener,
                    )
                }
            }
        }

        if (!state.mirroringEnabled || !state.notificationMirroringEnabled) {
            item {
                SidekickCard(
                    padding = Space.md,
                    container = SidekickColors.warningTint,
                    border = SidekickColors.warningBorder,
                ) {
                    Text(
                        if (!state.mirroringEnabled) {
                            "All mirroring is turned off. Turn it back on in Sync settings."
                        } else {
                            "Notification mirroring is turned off in Sync settings."
                        },
                        style = SidekickType.body,
                        color = SidekickColors.textPrimary,
                    )
                }
            }
        }

        if (state.notifications.isEmpty()) {
            item {
                SidekickCard(padding = Space.xs) {
                    StateBlock(
                        kind = StateKind.Empty,
                        icon = Icons.Outlined.NotificationsOff,
                        headline = "Nothing here yet",
                        body = "Notifications from a paired device appear here as they arrive. " +
                            "Dismissing one here also clears it on that device.",
                    )
                }
            }
        }

        items(state.notifications, key = { it.id }) { notification ->
            NotificationCard(
                notification = notification,
                nowMillis = nowMillis,
                onDismiss = { onDismiss(notification) },
            )
        }
    }
}

@Composable
private fun NotificationCard(
    notification: MirroredNotificationEntity,
    nowMillis: Long,
    onDismiss: () -> Unit,
) {
    SidekickCard(padding = Space.md) {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            AppIcon(notification)

            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.sm),
                ) {
                    Text(
                        notification.appName,
                        style = SidekickType.meta,
                        color = SidekickColors.textMeta,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(
                        RelativeTime.of(notification.postedAtMillis, nowMillis),
                        style = SidekickType.meta,
                        color = SidekickColors.textMeta,
                    )
                }
                if (notification.title.isNotBlank()) {
                    Text(
                        notification.title,
                        style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                        color = SidekickColors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (notification.text.isNotBlank()) {
                    Text(
                        notification.text,
                        style = SidekickType.caption,
                        color = SidekickColors.textBody,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // The only action. `isClearable` is the posting app's own flag — an ongoing
            // notification (a call, a download) cannot be dismissed on the device that posted it,
            // so offering it here would be a button whose failure happens somewhere nobody is
            // looking.
            if (notification.isClearable) {
                HeaderIconButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = "Dismiss ${notification.appName} notification",
                    onClick = onDismiss,
                )
            }
        }
    }
}

/**
 * The sender's own icon, or a monogram.
 *
 * The bitmap is decoded inside `remember` keyed on the string, so scrolling a long feed does not
 * re-decode a PNG per frame. A decode that fails returns null rather than throwing, and the
 * monogram takes over — an icon that did not arrive is not an error worth a red card.
 */
@Composable
private fun AppIcon(notification: MirroredNotificationEntity) {
    val bitmap: ImageBitmap? = remember(notification.iconBase64) {
        notification.iconBase64?.let { encoded ->
            runCatching {
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
    }

    if (bitmap == null) {
        AvatarBadge(name = notification.appName)
        return
    }
    Box(
        Modifier
            .size(Size.badge)
            .clip(Radius.mediaShape)
            .padding(2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap = bitmap,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
