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
import com.chetan.connectsuite.sync.ui.clipboard.ClipboardSection
import com.chetan.connectsuite.sync.ui.folders.FoldersSection
import com.chetan.connectsuite.sync.ui.folders.FoldersViewModel
import com.chetan.connectsuite.sync.ui.transfers.IncomingOfferDialog
import com.chetan.connectsuite.sync.ui.transfers.TransfersSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsViewModel
import com.chetan.connectsuite.sync.ui.transfers.TransfersViewModel
import com.chetan.connectsuite.sync.v2.ClipFeature

private enum class SyncTab(val label: String) {
    Devices("Devices"),
    Transfers("Transfers"),
    Folders("Folders"),
    Clipboard("Clip"),
    Notifications("Feed"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncRoute(
    devicesViewModel: DevicesViewModel = viewModel(),
    transfersViewModel: TransfersViewModel = viewModel(),
    notificationsViewModel: NotificationsViewModel = viewModel(),
    foldersViewModel: FoldersViewModel = viewModel(),
    onOpenSettings: () -> Unit = {},
) {
    val context = LocalContext.current
    val devicesState by devicesViewModel.uiState.collectAsStateWithLifecycle()
    val transfersState by transfersViewModel.uiState.collectAsStateWithLifecycle()
    val deviceMessage by devicesViewModel.message.collectAsStateWithLifecycle()
    val transferMessage by transfersViewModel.message.collectAsStateWithLifecycle()
    val notificationsState by notificationsViewModel.uiState.collectAsStateWithLifecycle()
    val foldersState by foldersViewModel.uiState.collectAsStateWithLifecycle()
    val foldersMessage by foldersViewModel.message.collectAsStateWithLifecycle()
    val clipboardState by ClipFeature.state.collectAsStateWithLifecycle()

    // Notification access is granted in system Settings, so re-check whenever we come back.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { notificationsViewModel.refreshListenerState() }

    // A folder grant can be taken away in system Settings, and the picker is another activity, so
    // the list is re-read on every return rather than cached. `FsRoots` is the only holder.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { foldersViewModel.refresh() }

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

    // `StartActivityForResult` rather than the `OpenDocumentTree` contract, so that the intent —
    // including its persistable-grant flags — is built in exactly one place, `FsRoots.pickerIntent`.
    //
    // A cancel and a refusal both land here as a null uri. That is not a gap in this code: Android
    // refuses a folder by disabling the confirm button inside the picker and returns nothing either
    // way. `FoldersViewModel.onPicked` says why nothing may be reported from it.
    val folderPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        foldersViewModel.onPicked(result.data?.data)
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
    LaunchedEffect(foldersMessage) {
        val text = foldersMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        foldersViewModel.consumeMessage()
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

                SyncTab.Folders -> FoldersSection(
                    state = foldersState,
                    // Unaimed. Browse… promises nothing about where it opens, which is the only
                    // promise this app could make before EXTRA_INITIAL_URI was measured.
                    onAddFolder = { folderPicker.launch(foldersViewModel.pickerIntent()) },
                    // Aimed. A chip *is* a promise about where the picker opens, and it is one the
                    // handset now honours — FolderQuickPicks carries the readings.
                    quickPicks = foldersViewModel.quickPicks(),
                    onQuickPick = { folderPicker.launch(foldersViewModel.pickerIntent(it)) },
                    onRemove = foldersViewModel::remove,
                )

                // The state is read from the feature rather than through a ViewModel: it is
                // process-scoped by design (in memory, cleared on disconnect) and a ViewModel would
                // add a second home for a value that must have exactly one.
                SyncTab.Clipboard -> ClipboardSection(
                    state = clipboardState,
                    onApplyFromMac = { ClipFeature.apply(context, it) },
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
