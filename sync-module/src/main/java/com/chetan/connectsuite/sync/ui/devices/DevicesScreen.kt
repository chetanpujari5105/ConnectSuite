package com.chetan.connectsuite.sync.ui.devices

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.DeviceUnknown
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SouthWest
import androidx.compose.material.icons.outlined.TabletAndroid
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chetan.connectsuite.core.discovery.WifiDirectState
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.model.DiscoveryChannel
import com.chetan.connectsuite.core.model.PairState
import com.chetan.connectsuite.core.pairing.IncomingPairRequest
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.RelativeTime
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickIcons
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.DestructiveButton
import com.chetan.connectsuite.core.ui.components.HeaderIconButton
import com.chetan.connectsuite.core.ui.components.HeroCard
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.ListRow
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import com.chetan.connectsuite.core.ui.components.RowDivider
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.SidekickHeader
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill

/** The four shortcuts on the overview. Each one is a destination that already exists. */
enum class QuickAction { Mirror, Files, Clip, Feed }

/**
 * The Devices overview — reference `01_android_devices_overview.png`.
 *
 * ### What is drawn, and what each number actually is
 *
 * Everything on this screen is read from something real:
 *
 *  - the hero's device name is [DevicesUiState.thisDeviceName];
 *  - the address chip is the connected Mac's `address`, not a latency figure. **The reference shows
 *    "8 ms" and this app cannot honestly draw that**: RTT is measured on the Mac's HUD, and the
 *    phone has no ping of its own — `MessageType.PING`/`PONG` exist in the protocol and nothing on
 *    this side times them. A hardcoded "8 ms" is exactly the decorative number the brief rules out,
 *    so the chip carries a fact the phone owns instead;
 *  - "TLS 1.3" and "Local network" are architectural facts (locked decisions #3 and #2), not state;
 *  - Recent activity is [RecentActivity], a projection over the transfer history, the mirrored
 *    notifications and the clipboard's own timestamps.
 *
 * ### Why the nearby-devices list is still here
 *
 * It is not in the reference, and removing it would delete the whole v1 Android-to-Android pairing
 * flow — pair, connect, forget, join a Wi-Fi Direct group. The reference is a drawing of the Mac
 * relationship; the product also has this one, and a visual pass does not get to drop a feature it
 * was not drawn. It sits below the overview, in the same list vocabulary as every other screen.
 */
@Composable
fun DevicesSection(
    state: DevicesUiState,
    recent: List<ActivityItem>,
    mirroringAvailable: Boolean,
    nowMillis: Long,
    onRefresh: () -> Unit,
    onPair: (Device) -> Unit,
    onConnect: (Device) -> Unit,
    onForget: (Device) -> Unit,
    onJoinWifiDirect: (Device) -> Unit,
    onOpenDevice: (Device) -> Unit,
    onStartMirroring: () -> Unit,
    onOpenMac: () -> Unit,
    onQuickAction: (QuickAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val mac = state.devices.firstOrNull { it.type == DeviceType.DESKTOP && it.isConnected }
        ?: state.devices.firstOrNull { it.type == DeviceType.DESKTOP }
    val connected = mac?.isConnected == true
    val others = state.devices.filterNot { it.type == DeviceType.DESKTOP }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = Space.lg,
            end = Space.lg,
            top = Space.sm,
            bottom = Space.xl,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        item {
            SidekickHeader {
                StatusPill(
                    text = if (connected) "Connected" else "Offline",
                    kind = if (connected) StatusKind.Connected else StatusKind.Neutral,
                )
                HeaderIconButton(Icons.Outlined.Settings, "Mac settings", onOpenMac)
            }
        }

        item {
            ConnectionHero(
                deviceName = state.thisDeviceName,
                mac = mac,
                connected = connected,
                mirroringAvailable = mirroringAvailable,
                onStartMirroring = onStartMirroring,
                onSendFiles = { mac?.let(onOpenDevice) },
                onOpenMac = onOpenMac,
            )
        }

        if (mac != null) {
            item { YourMacCard(mac = mac, onClick = onOpenMac) }
        }

        item { SectionHeader("Quick actions") }
        item {
            QuickActionRow(
                mirroringAvailable = mirroringAvailable,
                onQuickAction = onQuickAction,
            )
        }

        item { SectionHeader("Recent activity") }
        item {
            SidekickCard(padding = Space.xs) {
                if (recent.isEmpty()) {
                    StateBlock(
                        kind = StateKind.Empty,
                        headline = "Nothing has moved yet",
                        body = "Files, clipboard entries and mirrored notifications show up here " +
                            "as they cross. Clipboard history is kept in memory only, so it " +
                            "starts empty every time the app restarts.",
                    )
                } else {
                    recent.forEachIndexed { index, item ->
                        if (index > 0) RowDivider()
                        ActivityRow(item = item, nowMillis = nowMillis)
                    }
                }
            }
        }

        if (state.wifiDirectState == WifiDirectState.UNSUPPORTED ||
            state.wifiDirectState == WifiDirectState.DISABLED
        ) {
            item {
                SidekickCard(container = SidekickColors.cardRaised) {
                    Text(
                        if (state.wifiDirectState == WifiDirectState.UNSUPPORTED) {
                            "This phone has no Wi-Fi Direct radio. Devices on the same Wi-Fi " +
                                "network are still found, and transfers work normally."
                        } else {
                            "Turn Wi-Fi on to discover devices over Wi-Fi Direct."
                        },
                        style = SidekickType.caption,
                        color = SidekickColors.textBody,
                    )
                }
            }
        }

        item {
            SectionHeader(
                title = "Nearby devices",
                actionLabel = if (state.isScanning) "Scanning…" else "Scan again",
                actionIcon = Icons.Outlined.Refresh,
                onAction = onRefresh,
            )
        }

        if (others.isEmpty()) {
            item {
                SidekickCard(padding = Space.xs) {
                    StateBlock(
                        kind = if (state.isScanning) StateKind.Loading else StateKind.Empty,
                        headline = if (state.isScanning) {
                            "Looking for devices"
                        } else {
                            "No other devices found"
                        },
                        body = "Open Sidekick on the other phone and put both on the same Wi-Fi " +
                            "network, or use Wi-Fi Direct if there is no shared network.",
                    )
                }
            }
        }

        items(others, key = { it.id }) { device ->
            NearbyDeviceCard(
                device = device,
                isRequestPending = device.id in state.outgoingRequests,
                onPair = { onPair(device) },
                onConnect = { onConnect(device) },
                onForget = { onForget(device) },
                onJoinWifiDirect = { onJoinWifiDirect(device) },
                onSend = { onOpenDevice(device) },
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hero — the one gradient surface in the app
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ConnectionHero(
    deviceName: String,
    mac: Device?,
    connected: Boolean,
    mirroringAvailable: Boolean,
    onStartMirroring: () -> Unit,
    onSendFiles: () -> Unit,
    onOpenMac: () -> Unit,
) {
    HeroCard(live = connected) {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.lg)) {
            PhoneGlyph(live = connected)

            Column(
                Modifier.weight(1f).padding(top = Space.xs),
                verticalArrangement = Arrangement.spacedBy(Space.sm),
            ) {
                Text(
                    "THIS PHONE",
                    style = SidekickType.overline,
                    color = SidekickColors.textMeta,
                )
                Text(
                    deviceName.ifBlank { "This phone" },
                    style = SidekickType.display.copy(fontSize = 28.sp),
                    color = SidekickColors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        connected && mac != null -> "Connected to ${mac.name}"
                        mac != null -> "Paired with ${mac.name} · waiting for it to connect"
                        else -> "No Mac paired yet"
                    },
                    style = SidekickType.body,
                    color = SidekickColors.textBody,
                )
            }
        }

        Spacer(Modifier.height(Space.md))

        // Three facts the phone actually owns. See the KDoc above on why none of them is a latency.
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            if (connected && mac?.address != null) {
                FactChip(Icons.Outlined.Wifi, mac.address!!, Modifier.weight(1f, fill = false))
            }
            FactChip(Icons.Outlined.Lock, "TLS 1.3")
            FactChip(Icons.Outlined.Hub, "Local network")
        }

        Spacer(Modifier.height(Space.lg))

        PrimaryButton(
            text = "Start mirroring",
            onClick = onStartMirroring,
            icon = Icons.Outlined.Cast,
            trailingIcon = Icons.Outlined.ChevronRight,
            enabled = mirroringAvailable,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        )

        Spacer(Modifier.height(Space.sm))

        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            SecondaryButton(
                text = "Send files",
                onClick = onSendFiles,
                icon = Icons.Outlined.Upload,
                enabled = connected,
                modifier = Modifier.weight(1f),
            )
            SecondaryButton(
                text = "Device info",
                onClick = onOpenMac,
                icon = SidekickIcons.PhoneToMac,
                modifier = Modifier.weight(1f),
            )
        }

        // A disabled control with no reason beside it is the thing this project keeps ruling out.
        if (!mirroringAvailable) {
            Spacer(Modifier.height(Space.sm))
            Text(
                "Mirroring needs a connected Mac — it has to have somewhere to send the screen.",
                style = SidekickType.caption,
                color = SidekickColors.textMeta,
            )
        }
    }
}

/**
 * A stylised phone, not a product render.
 *
 * The reference art uses a photographed Galaxy. Shipping a photograph of one manufacturer's handset
 * inside an app that runs on all of them would be wrong on a Pixel, so this is a drawn device whose
 * screen picks up the accent when the link is live and goes flat when it is not — the same rule the
 * hero bloom follows, for the same reason.
 */
@Composable
private fun PhoneGlyph(live: Boolean) {
    Box(
        Modifier
            .width(84.dp)
            .height(164.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(SidekickColors.cardRaised)
            .border(BorderStroke(Size.hairline, SidekickColors.borderStrong), RoundedCornerShape(16.dp))
            .padding(5.dp),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (live) {
                        // Dark green, not lit lime. The reference phone is a dark wallpaper with
                        // a little colour in it; a bright screen here competes with the primary
                        // button two inches below, which is the one thing on the card that should
                        // be the brightest.
                        Brush.linearGradient(
                            listOf(
                                SidekickColors.accent.copy(alpha = 0.26f),
                                SidekickColors.accent.copy(alpha = 0.06f),
                                SidekickColors.canvas,
                            ),
                        )
                    } else {
                        Brush.linearGradient(
                            listOf(SidekickColors.cardPressed, SidekickColors.canvas),
                        )
                    },
                ),
            contentAlignment = Alignment.TopCenter,
        ) {
            // An earpiece slit. Without it the disconnected state is a plain rounded rectangle,
            // which on the emulator read as a card that had failed to load rather than as a phone.
            // One 3dp bar is the whole difference, and it costs nothing when the screen is lit.
            Box(
                Modifier
                    .padding(top = Space.sm)
                    .width(22.dp)
                    .height(3.dp)
                    .clip(Radius.pillShape)
                    .background(SidekickColors.canvas.copy(alpha = 0.55f)),
            )
        }
    }
}

@Composable
private fun FactChip(icon: ImageVector, label: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(Radius.pillShape)
            .background(SidekickColors.canvas.copy(alpha = 0.55f))
            .border(BorderStroke(Size.hairline, SidekickColors.border), Radius.pillShape)
            .padding(horizontal = Space.md, vertical = Space.sm),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = SidekickColors.textBody, modifier = Modifier.size(16.dp))
        Text(
            label,
            style = SidekickType.meta,
            color = SidekickColors.onControl,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Your Mac
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun YourMacCard(mac: Device, onClick: () -> Unit) {
    SidekickCard(onClick = onClick) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            IconBadge(
                icon = Icons.Outlined.Laptop,
                size = 56.dp,
                tint = if (mac.isConnected) SidekickColors.accent else SidekickColors.textBody,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                Text("YOUR MAC", style = SidekickType.overline, color = SidekickColors.textMeta)
                Text(
                    mac.name,
                    style = SidekickType.title,
                    color = SidekickColors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                StatusPill(
                    text = if (mac.isConnected) "Connected" else "Not connected",
                    kind = if (mac.isConnected) StatusKind.Connected else StatusKind.Neutral,
                    showBackground = false,
                )
            }
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = SidekickColors.textMeta,
                modifier = Modifier.size(Size.iconLarge),
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Quick actions
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun QuickActionRow(mirroringAvailable: Boolean, onQuickAction: (QuickAction) -> Unit) {
    // `IntrinsicSize.Min` measures the tallest tile and gives every tile that height. Without it
    // the four tiles are as tall as their own copy, so a two-line description and a one-line one
    // produce a ragged bottom edge — visible on the first emulator run and the kind of thing that
    // reads as carelessness rather than as a bug.
    Row(
        Modifier.height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        QuickActionTile(
            icon = Icons.Outlined.Cast,
            title = "Mirror",
            body = "Screen on your Mac",
            // The lime is a state, not a decoration: this tile is accented exactly when mirroring
            // is actually possible, which is the one thing the user cannot tell by looking.
            accented = mirroringAvailable,
            onClick = { onQuickAction(QuickAction.Mirror) },
            modifier = Modifier.weight(1f),
        )
        QuickActionTile(
            icon = Icons.Outlined.Folder,
            title = "Files",
            body = "Browse & send",
            accented = false,
            onClick = { onQuickAction(QuickAction.Files) },
            modifier = Modifier.weight(1f),
        )
        QuickActionTile(
            icon = Icons.Outlined.ContentCopy,
            title = "Clip",
            body = "Shared clipboard",
            accented = false,
            onClick = { onQuickAction(QuickAction.Clip) },
            modifier = Modifier.weight(1f),
        )
        QuickActionTile(
            icon = Icons.Outlined.Notifications,
            title = "Feed",
            body = "Mirrored alerts",
            accented = false,
            onClick = { onQuickAction(QuickAction.Feed) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun QuickActionTile(
    icon: ImageVector,
    title: String,
    body: String,
    accented: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxHeight()
            .clip(Radius.cardShape)
            .background(if (accented) SidekickColors.accentTint else SidekickColors.card)
            .border(
                BorderStroke(
                    Size.hairline,
                    if (accented) SidekickColors.accentBorder else SidekickColors.border,
                ),
                Radius.cardShape,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = Space.sm, vertical = Space.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (accented) SidekickColors.accent else SidekickColors.textBody,
            modifier = Modifier.size(Size.iconLarge),
        )
        Text(
            title,
            style = SidekickType.caption.copy(fontWeight = FontWeight.Medium),
            color = SidekickColors.textPrimary,
            maxLines = 1,
        )
        Text(
            body,
            style = SidekickType.meta,
            color = SidekickColors.textMeta,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Recent activity
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ActivityRow(item: ActivityItem, nowMillis: Long) {
    ListRow(
        title = item.title,
        subtitle = item.subtitle,
        trailingText = RelativeTime.of(item.atMillis, nowMillis),
        modifier = Modifier.padding(horizontal = Space.md),
        leading = {
            IconBadge(
                icon = when (item.kind) {
                    ActivityKind.ClipSent -> Icons.Outlined.ContentCopy
                    ActivityKind.ClipReceived -> Icons.Outlined.ContentCopy
                    ActivityKind.TransferIn -> Icons.Outlined.SouthWest
                    ActivityKind.TransferOut -> Icons.Outlined.NorthEast
                    ActivityKind.Notifications -> Icons.Outlined.Notifications
                },
            )
        },
    )
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Nearby devices — the v1 pairing surface, restyled and otherwise untouched
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun NearbyDeviceCard(
    device: Device,
    isRequestPending: Boolean,
    onPair: () -> Unit,
    onConnect: () -> Unit,
    onForget: () -> Unit,
    onJoinWifiDirect: () -> Unit,
    onSend: () -> Unit,
) {
    SidekickCard(padding = Space.md) {
        ListRow(
            title = device.name,
            subtitle = device.statusLine(),
            leading = { IconBadge(icon = device.type.icon()) },
            trailing = {
                Text(
                    device.channel.label(),
                    style = SidekickType.meta,
                    color = SidekickColors.textMeta,
                )
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            when {
                device.pairState == PairState.PAIRED && device.isConnected -> {
                    PrimaryButton("Send files", onSend, Modifier.weight(1f))
                    DestructiveButton("Forget", onForget)
                }

                device.pairState == PairState.PAIRED -> {
                    PrimaryButton(
                        "Connect",
                        onConnect,
                        Modifier.weight(1f),
                        enabled = device.isReachable,
                    )
                    DestructiveButton("Forget", onForget)
                }

                isRequestPending -> {
                    SecondaryButton("Waiting…", {}, Modifier.weight(1f), enabled = false)
                }

                device.channel == DiscoveryChannel.WIFI_DIRECT && !device.isReachable -> {
                    PrimaryButton("Join group", onJoinWifiDirect, Modifier.weight(1f))
                }

                else -> {
                    PrimaryButton(
                        "Pair",
                        onPair,
                        Modifier.weight(1f),
                        enabled = device.isReachable,
                    )
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SectionHeader(
    title: String,
    actionLabel: String? = null,
    actionIcon: ImageVector? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = SidekickType.section,
            color = SidekickColors.textPrimary,
            modifier = Modifier.weight(1f),
        )
        if (actionLabel != null && onAction != null) {
            Row(
                Modifier.clip(Radius.pillShape).clickable(onClick = onAction)
                    .padding(horizontal = Space.sm, vertical = Space.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.xs),
            ) {
                Text(actionLabel, style = SidekickType.meta, color = SidekickColors.accentText)
                if (actionIcon != null) {
                    Icon(
                        actionIcon,
                        contentDescription = null,
                        tint = SidekickColors.accentText,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

/** The trust-on-first-use confirmation. Both users must compare the same key before accepting. */
@Composable
fun PairingRequestDialog(
    request: IncomingPairRequest,
    onAccept: () -> Unit,
    onReject: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onReject,
        containerColor = SidekickColors.card,
        titleContentColor = SidekickColors.textPrimary,
        textContentColor = SidekickColors.textBody,
        title = { Text("Pair with ${request.deviceName}?", style = SidekickType.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.md)) {
                Text(
                    "Only accept if you started this on the other device, and the key below " +
                        "matches the one it is showing.",
                    style = SidekickType.body,
                )
                Text(
                    request.displayFingerprint,
                    style = SidekickType.body.copy(fontFamily = FontFamily.Monospace),
                    color = SidekickColors.accentText,
                )
                Text(
                    "Once paired, this device can receive files and notifications from " +
                        "${request.deviceName} until you forget it.",
                    style = SidekickType.caption,
                    color = SidekickColors.textMeta,
                )
            }
        },
        confirmButton = { PrimaryButton("Accept", onAccept) },
        dismissButton = {
            TextButton(onClick = onReject) {
                Text("Reject", style = SidekickType.control, color = SidekickColors.textBody)
            }
        },
    )
}

private fun DeviceType.icon(): ImageVector = when (this) {
    DeviceType.PHONE -> Icons.Outlined.PhoneAndroid
    DeviceType.TABLET -> Icons.Outlined.TabletAndroid
    DeviceType.DESKTOP -> Icons.Outlined.Computer
    DeviceType.UNKNOWN -> Icons.Outlined.DeviceUnknown
}

private fun DiscoveryChannel.label(): String = when (this) {
    DiscoveryChannel.LAN -> "Wi-Fi"
    DiscoveryChannel.WIFI_DIRECT -> "Direct"
    DiscoveryChannel.REMEMBERED -> "Saved"
}

private fun Device.statusLine(): String = when {
    isConnected -> "Connected · ${address ?: "—"}"
    pairState == PairState.PAIRED && isReachable -> "Paired · available"
    pairState == PairState.PAIRED -> "Paired · not reachable"
    pairState == PairState.REQUESTED_BY_PEER -> "Wants to pair"
    pairState == PairState.REQUESTED_BY_US -> "Pairing request sent"
    channel == DiscoveryChannel.WIFI_DIRECT && !isReachable -> "Nearby over Wi-Fi Direct"
    else -> "Not paired · ${address ?: "unknown address"}"
}
