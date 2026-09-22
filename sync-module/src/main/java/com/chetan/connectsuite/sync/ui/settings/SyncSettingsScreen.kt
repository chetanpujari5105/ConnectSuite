package com.chetan.connectsuite.sync.ui.settings

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncSettingsScreen(
    onBack: () -> Unit,
    /** Opens **Set up Sidekick** — the one place every feature's grant is asked for (defect 134). */
    onOpenSetup: (() -> Unit)? = null,
    viewModel: SyncSettingsViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var appFilter by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sync settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (onOpenSetup != null) {
                item {
                    com.chetan.connectsuite.core.ui.components.SidekickCard(
                        padding = 4.dp,
                        onClick = onOpenSetup,
                    ) {
                        com.chetan.connectsuite.core.ui.components.ListRow(
                            title = "Set up Sidekick",
                            subtitle = "Turn on texts, calls, photos, folders and control from " +
                                "your Mac — one at a time, each asking only for what it needs.",
                            showChevron = true,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                }
            }
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = if (state.mirroringEnabled) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.errorContainer
                        },
                    ),
                ) {
                    SettingRow(
                        title = "Mirroring master switch",
                        subtitle = "Off stops all notification and SMS mirroring to every " +
                            "device, immediately, without un-pairing anything.",
                        checked = state.mirroringEnabled,
                        onCheckedChange = viewModel::setMirroringEnabled,
                    )
                }
            }

            item { SectionHeader("What gets mirrored") }
            item {
                SettingCard(
                    title = "Notifications",
                    subtitle = "Send this device's notifications to paired devices.",
                    checked = state.notificationMirroringEnabled,
                    enabled = state.mirroringEnabled,
                    onCheckedChange = viewModel::setNotificationMirroring,
                )
            }
            item {
                SettingCard(
                    title = "Incoming SMS",
                    subtitle = "Android-to-Android and Android-to-PC only. iPhones cannot " +
                        "send or receive mirrored texts — Apple blocks this for all " +
                        "third-party apps.",
                    checked = state.smsMirroringEnabled,
                    enabled = state.mirroringEnabled,
                    onCheckedChange = viewModel::setSmsMirroring,
                )
            }
            item {
                SettingCard(
                    title = "Include silent notifications",
                    subtitle = "Off by default — low-priority notifications are usually noise.",
                    checked = state.includeLowPriority,
                    enabled = state.mirroringEnabled && state.notificationMirroringEnabled,
                    onCheckedChange = viewModel::setIncludeLowPriority,
                )
            }
            item {
                SettingCard(
                    title = "Show received items as notifications",
                    subtitle = "Post notifications that arrive from paired devices to this " +
                        "device's shade, not only the in-app feed.",
                    checked = state.showReceivedAsNotifications,
                    onCheckedChange = viewModel::setShowReceivedAsNotifications,
                )
            }

            if (state.pairedDevices.isNotEmpty()) {
                item { SectionHeader("Per device") }
                items(state.pairedDevices, key = { it.deviceId }) { device ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(vertical = 4.dp)) {
                            Text(
                                device.name,
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.padding(start = 16.dp, top = 10.dp),
                            )
                            SettingRow(
                                title = "Notifications",
                                subtitle = null,
                                checked = device.notificationMirroringEnabled,
                                onCheckedChange = {
                                    viewModel.setDeviceNotificationMirroring(device.deviceId, it)
                                },
                            )
                            HorizontalDivider()
                            SettingRow(
                                title = "SMS",
                                subtitle = null,
                                checked = device.smsMirroringEnabled,
                                onCheckedChange = {
                                    viewModel.setDeviceSmsMirroring(device.deviceId, it)
                                },
                            )
                        }
                    }
                }
            }

            item { SectionHeader("Excluded apps") }
            item {
                Text(
                    "Notifications from these apps never leave this device.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                OutlinedTextField(
                    value = appFilter,
                    onValueChange = { appFilter = it },
                    label = { Text("Search apps") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (state.appsLoading) {
                item {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }
            }

            items(
                state.apps.filter { it.label.contains(appFilter, ignoreCase = true) },
                key = { it.packageName },
            ) { app ->
                Card(Modifier.fillMaxWidth()) {
                    SettingRow(
                        title = app.label,
                        subtitle = app.packageName,
                        checked = app.excluded,
                        onCheckedChange = { viewModel.setAppExcluded(app.packageName, it) },
                    )
                }
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
        modifier = Modifier.padding(top = 12.dp),
    )
}

@Composable
private fun SettingCard(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Card(Modifier.fillMaxWidth()) {
        SettingRow(title, subtitle, checked, onCheckedChange, enabled)
    }
}

@Composable
private fun SettingRow(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}
