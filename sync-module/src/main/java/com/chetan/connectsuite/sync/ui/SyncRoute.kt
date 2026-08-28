package com.chetan.connectsuite.sync.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.chetan.connectsuite.core.permissions.SpecialAccess
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.sync.ui.devices.DevicesSection
import com.chetan.connectsuite.sync.ui.devices.DevicesViewModel
import com.chetan.connectsuite.sync.ui.devices.PairingRequestDialog
import com.chetan.connectsuite.sync.ui.transfers.IncomingOfferDialog
import com.chetan.connectsuite.sync.ui.transfers.TransfersSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsViewModel
import com.chetan.connectsuite.sync.ui.transfers.TransfersViewModel

private enum class SyncTab(val label: String) {
    Devices("Devices"),
    Transfers("Transfers"),
    Notifications("Feed"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncRoute(
    devicesViewModel: DevicesViewModel = viewModel(),
    transfersViewModel: TransfersViewModel = viewModel(),
    notificationsViewModel: NotificationsViewModel = viewModel(),
    onOpenSettings: () -> Unit = {},
) {
    val context = LocalContext.current
    val devicesState by devicesViewModel.uiState.collectAsStateWithLifecycle()
    val transfersState by transfersViewModel.uiState.collectAsStateWithLifecycle()
    val deviceMessage by devicesViewModel.message.collectAsStateWithLifecycle()
    val transferMessage by transfersViewModel.message.collectAsStateWithLifecycle()
    val notificationsState by notificationsViewModel.uiState.collectAsStateWithLifecycle()

    // Notification access is granted in system Settings, so re-check whenever we come back.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { notificationsViewModel.refreshListenerState() }

    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    // Which device the pending file-picker result should be sent to.
    var sendTargetDeviceId by remember { mutableStateOf<String?>(null) }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        val target = sendTargetDeviceId
        sendTargetDeviceId = null
        if (target != null && uris.isNotEmpty()) {
            transfersViewModel.sendFiles(target, uris)
            selectedTab = SyncTab.Transfers.ordinal
        }
    }

    LaunchedEffect(deviceMessage) {
        val text = deviceMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        devicesViewModel.consumeMessage()
    }
    LaunchedEffect(transferMessage) {
        val text = transferMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        transfersViewModel.consumeMessage()
    }

    // A device that just reconnected may have transfers waiting to pick up where they stopped.
    LaunchedEffect(devicesState.devices) {
        devicesState.devices.filter { it.isConnected }.forEach {
            transfersViewModel.resumeFor(it.id)
        }
    }

    val startSend: (Device) -> Unit = { device ->
        sendTargetDeviceId = device.id
        filePicker.launch(arrayOf("*/*"))
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sync") },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Sync settings")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                SyncTab.entries.forEachIndexed { index, tab ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(tab.label) },
                    )
                }
            }

            when (SyncTab.entries[selectedTab]) {
                SyncTab.Devices -> DevicesSection(
                    state = devicesState,
                    onRefresh = devicesViewModel::refresh,
                    onPair = devicesViewModel::pair,
                    onConnect = devicesViewModel::connect,
                    onForget = devicesViewModel::forget,
                    onJoinWifiDirect = devicesViewModel::joinWifiDirectGroup,
                    onOpenDevice = startSend,
                )

                SyncTab.Transfers -> TransfersSection(
                    state = transfersState,
                    onCancel = transfersViewModel::cancel,
                )

                SyncTab.Notifications -> NotificationsSection(
                    state = notificationsState,
                    onDismiss = notificationsViewModel::dismiss,
                    onEnableListener = {
                        context.startActivity(SpecialAccess.notificationListenerSettingsIntent())
                    },
                )
            }
        }
    }

    devicesState.pendingRequest?.let { request ->
        PairingRequestDialog(
            request = request,
            onAccept = { devicesViewModel.acceptPairing(request.deviceId) },
            onReject = { devicesViewModel.rejectPairing(request.deviceId) },
        )
    }

    transfersState.pendingOffer?.let { offer ->
        IncomingOfferDialog(
            offer = offer,
            onAccept = { transfersViewModel.acceptOffer(offer.offer.jobId) },
            onDecline = { transfersViewModel.declineOffer(offer.offer.jobId) },
        )
    }
}
