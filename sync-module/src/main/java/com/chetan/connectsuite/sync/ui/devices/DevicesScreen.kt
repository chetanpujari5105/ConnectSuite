package com.chetan.connectsuite.sync.ui.devices

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.DeviceUnknown
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.TabletAndroid
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.discovery.WifiDirectState
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.model.DiscoveryChannel
import com.chetan.connectsuite.core.model.PairState
import com.chetan.connectsuite.core.pairing.IncomingPairRequest

@Composable
fun DevicesSection(
    state: DevicesUiState,
    onRefresh: () -> Unit,
    onPair: (Device) -> Unit,
    onConnect: (Device) -> Unit,
    onForget: (Device) -> Unit,
    onJoinWifiDirect: (Device) -> Unit,
    onOpenDevice: (Device) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            ThisDeviceCard(
                name = state.thisDeviceName,
                fingerprint = state.thisDeviceFingerprint,
                isScanning = state.isScanning,
                onRefresh = onRefresh,
            )
        }

        if (state.wifiDirectState == WifiDirectState.UNSUPPORTED) {
            item {
                InfoCard(
                    "This device has no Wi-Fi Direct radio. Devices on the same Wi-Fi network " +
                        "will still be found, and transfers work normally over the local network.",
                )
            }
        } else if (state.wifiDirectState == WifiDirectState.DISABLED) {
            item { InfoCard("Turn Wi-Fi on to discover devices over Wi-Fi Direct.") }
        }

        if (state.devices.isEmpty()) {
            item { EmptyDevicesCard(isScanning = state.isScanning) }
        }

        items(state.devices, key = { it.id }) { device ->
            DeviceRow(
                device = device,
                isRequestPending = device.id in state.outgoingRequests,
                onPair = { onPair(device) },
                onConnect = { onConnect(device) },
                onForget = { onForget(device) },
                onJoinWifiDirect = { onJoinWifiDirect(device) },
                onOpen = { onOpenDevice(device) },
            )
        }
    }
}

@Composable
private fun ThisDeviceCard(
    name: String,
    fingerprint: String,
    isScanning: Boolean,
    onRefresh: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("This device", style = MaterialTheme.typography.labelMedium)
                Text(name, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Key $fingerprint",
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (isScanning) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, contentDescription = "Scan again")
            }
        }
    }
}

@Composable
private fun DeviceRow(
    device: Device,
    isRequestPending: Boolean,
    onPair: () -> Unit,
    onConnect: () -> Unit,
    onForget: () -> Unit,
    onJoinWifiDirect: () -> Unit,
    onOpen: () -> Unit,
) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (device.isConnected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(device.type.icon(), contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        device.name,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        device.statusLine(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = { Text(device.channel.label()) },
                    colors = AssistChipDefaults.assistChipColors(),
                )
            }

            Spacer(Modifier.height(10.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    // A Mac is not something this phone dials. It opens the connection to us on
                    // the v2 link, and its live state is shown on the Mac tab — so the only
                    // action this card can honestly offer is forgetting it.
                    device.type == DeviceType.DESKTOP -> {
                        OutlinedButton(onClick = onForget) { Text("Forget") }
                    }

                    device.pairState == PairState.PAIRED && device.isConnected -> {
                        Button(onClick = onOpen) { Text("Send files") }
                        OutlinedButton(onClick = onForget) { Text("Forget") }
                    }

                    device.pairState == PairState.PAIRED -> {
                        Button(onClick = onConnect, enabled = device.isReachable) {
                            Text("Connect")
                        }
                        OutlinedButton(onClick = onForget) { Text("Forget") }
                    }

                    isRequestPending -> {
                        OutlinedButton(onClick = {}, enabled = false) { Text("Waiting…") }
                    }

                    device.channel == DiscoveryChannel.WIFI_DIRECT && !device.isReachable -> {
                        Button(onClick = onJoinWifiDirect) { Text("Join group") }
                    }

                    else -> {
                        Button(onClick = onPair, enabled = device.isReachable) { Text("Pair") }
                    }
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
        title = { Text("Pair with ${request.deviceName}?") },
        text = {
            Column {
                Text(
                    "Only accept if you started this on the other device, and the key below " +
                        "matches the one it is showing.",
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    request.displayFingerprint,
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "Once paired, this device can receive files and notifications from " +
                        "${request.deviceName} until you forget it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button(onClick = onAccept) { Text("Accept") } },
        dismissButton = { TextButton(onClick = onReject) { Text("Reject") } },
    )
}

@Composable
private fun EmptyDevicesCard(isScanning: Boolean) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp)) {
            Text(
                if (isScanning) "Looking for devices…" else "No devices found",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Open ConnectSuite on the other device and make sure both are on the same " +
                    "Wi-Fi network, or use Wi-Fi Direct if there is no shared network.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun InfoCard(text: String) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
        ),
    ) {
        Text(text, Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
    }
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
    // "available" would be a lie for a Mac: this card cannot reach it and never tries. Whether
    // the link is actually up is shown on the Mac tab, which owns the v2 connection.
    type == DeviceType.DESKTOP -> "Paired · your Mac connects on its own"
    pairState == PairState.PAIRED && isReachable -> "Paired · available"
    pairState == PairState.PAIRED -> "Paired · not reachable"
    pairState == PairState.REQUESTED_BY_PEER -> "Wants to pair"
    pairState == PairState.REQUESTED_BY_US -> "Pairing request sent"
    channel == DiscoveryChannel.WIFI_DIRECT && !isReachable -> "Nearby over Wi-Fi Direct"
    else -> "Not paired · ${address ?: "unknown address"}"
}
