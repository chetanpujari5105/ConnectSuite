package com.chetan.connectsuite.sync.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.chetan.connectsuite.core.permissions.SpecialAccess
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.sync.ui.devices.DevicesSection
import com.chetan.connectsuite.sync.ui.devices.DevicesViewModel
import com.chetan.connectsuite.sync.ui.devices.PairingRequestDialog
import com.chetan.connectsuite.sync.ui.devices.QuickAction
import com.chetan.connectsuite.sync.ui.devices.RecentActivity
import com.chetan.connectsuite.sync.ui.clipboard.ClipboardSection
import com.chetan.connectsuite.sync.ui.folders.FoldersSection
import com.chetan.connectsuite.sync.ui.folders.FoldersViewModel
import com.chetan.connectsuite.sync.ui.transfers.IncomingOfferDialog
import com.chetan.connectsuite.sync.ui.transfers.TransfersSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsViewModel
import com.chetan.connectsuite.sync.ui.transfers.TransfersViewModel
import com.chetan.connectsuite.sync.v2.ClipFeature
import kotlinx.coroutines.launch

/**
 * Which section of the Sync host is on screen.
 *
 * Four of these are bottom-nav destinations; [Folders] is not — it is a drill-down reached from
 * the Transfers header, and the Transfers tab stays lit while it is open. That is why this is an
 * enum the host owns rather than an index into the nav bar: the two lists are deliberately not the
 * same length, and collapsing them would make Folders unreachable or invent a sixth tab.
 */
enum class SyncSection { Devices, Transfers, Folders, Clipboard, Notifications }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncRoute(
    section: SyncSection,
    onSelectSection: (SyncSection) -> Unit,
    mirroringAvailable: Boolean,
    onStartMirroring: () -> Unit,
    onOpenMirror: () -> Unit,
    onOpenMac: () -> Unit,
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
    // Collected rather than snapshotted: the switch has to redraw when the value changes, and
    // `ClipFeature` reads the same flow at the moment an entry arrives, so the screen and the
    // handler cannot disagree about what the setting says.
    val clipboardAutoApply by SettingsStore.get(context).clipboardAutoApply
        .collectAsStateWithLifecycle(initialValue = false)
    val scope = rememberCoroutineScope()

    // Notification access is granted in system Settings, so re-check whenever we come back.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { notificationsViewModel.refreshListenerState() }

    // A folder grant can be taken away in system Settings, and the picker is another activity, so
    // the list is re-read on every return rather than cached. `FsRoots` is the only holder.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { foldersViewModel.refresh() }

    val snackbarHostState = remember { SnackbarHostState() }

    // Recent activity renders ages ("2 min ago"), so something has to re-read the clock — a row
    // whose timestamp froze at first composition would quietly claim everything happened just now.
    // Thirty seconds is finer than the smallest unit `RelativeTime` prints, and the effect stops
    // when the composable leaves. This is `LinkRoute`'s ticker, for the same reason.
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMillis = System.currentTimeMillis()
            kotlinx.coroutines.delay(30_000)
        }
    }

    // Which device the pending file-picker result should be sent to.
    var sendTargetDeviceId by remember { mutableStateOf<String?>(null) }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        val target = sendTargetDeviceId
        sendTargetDeviceId = null
        if (target != null && uris.isNotEmpty()) {
            transfersViewModel.sendFiles(target, uris)
            onSelectSection(SyncSection.Transfers)
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
        // No top app bar. Each section draws its own header, because the Devices overview leads
        // with the brand lockup and a status pill rather than a title — and a `TopAppBar` above
        // that would be a second, emptier header stacked on the real one.
        containerColor = SidekickColors.canvas,
        // Zero, because each section applies the status-bar inset itself. Scaffold's default is
        // `systemBars`, and with no top app bar it hands that inset straight to the content — so
        // every section that also called `statusBarsPadding()` was indented by the status bar
        // *twice*. Measured on the emulator before this line existed: ~74dp of empty canvas above
        // the brand lockup, which reads as a layout that forgot its own header.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (section) {
                SyncSection.Devices -> DevicesSection(
                    state = devicesState,
                    recent = RecentActivity.of(
                        transfers = transfersState.history,
                        notifications = notificationsState.notifications,
                        clip = clipboardState,
                    ),
                    mirroringAvailable = mirroringAvailable,
                    nowMillis = nowMillis,
                    onRefresh = devicesViewModel::refresh,
                    onPair = devicesViewModel::pair,
                    onConnect = devicesViewModel::connect,
                    onForget = devicesViewModel::forget,
                    onJoinWifiDirect = devicesViewModel::joinWifiDirectGroup,
                    onOpenDevice = startSend,
                    onStartMirroring = onStartMirroring,
                    onOpenMac = onOpenMac,
                    onQuickAction = { action ->
                        when (action) {
                            // The tile opens the Mirror screen; the hero's button starts a
                            // session. They are different promises and the copy on each says which.
                            QuickAction.Mirror -> onOpenMirror()
                            QuickAction.Files -> onSelectSection(SyncSection.Folders)
                            QuickAction.Clip -> onSelectSection(SyncSection.Clipboard)
                            QuickAction.Feed -> onSelectSection(SyncSection.Notifications)
                        }
                    },
                )

                SyncSection.Transfers -> Column(Modifier.fillMaxSize()) {
                    SectionHeaderBar(
                        title = "Transfers",
                        actionIcon = Icons.Outlined.FolderOpen,
                        actionLabel = "Manage folders",
                        onAction = { onSelectSection(SyncSection.Folders) },
                    )
                    TransfersSection(
                        state = transfersState,
                        onCancel = transfersViewModel::cancel,
                    )
                }

                SyncSection.Folders -> Column(Modifier.fillMaxSize()) {
                    // A drill-down, so it gets a back affordance rather than a nav tab of its own.
                    // The bar still shows Transfers lit — see `AppNavigation`.
                    SectionHeaderBar(
                        title = "Folders",
                        onBack = { onSelectSection(SyncSection.Transfers) },
                        actionIcon = Icons.Outlined.Settings,
                        actionLabel = "Sync settings",
                        onAction = onOpenSettings,
                    )
                    FoldersSection(
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
                }

                // The state is read from the feature rather than through a ViewModel: it is
                // process-scoped by design (in memory, cleared on disconnect) and a ViewModel would
                // add a second home for a value that must have exactly one.
                SyncSection.Clipboard -> Column(Modifier.fillMaxSize()) {
                    SectionHeaderBar(title = "Clip")
                    ClipboardSection(
                        state = clipboardState,
                        autoApply = clipboardAutoApply,
                        onSetAutoApply = { enabled ->
                            scope.launch { SettingsStore.get(context).setClipboardAutoApply(enabled) }
                        },
                        onApplyFromMac = { ClipFeature.apply(context, it) },
                    )
                }

                SyncSection.Notifications -> Column(Modifier.fillMaxSize()) {
                    SectionHeaderBar(title = "Feed")
                    NotificationsSection(
                        state = notificationsState,
                        onDismiss = notificationsViewModel::dismiss,
                        onEnableListener = {
                            context.startActivity(SpecialAccess.notificationListenerSettingsIntent())
                        },
                    )
                }
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

/**
 * The plain header the four non-overview sections carry.
 *
 * Deliberately minimal: those screens have not had their own design pass yet, and this exists so
 * that removing the shared `TopAppBar` does not leave them untitled in the meantime. Each one
 * replaces this with its own header when its reference image is built.
 */
@Composable
private fun SectionHeaderBar(
    title: String,
    onBack: (() -> Unit)? = null,
    actionIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = Space.lg, vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        if (onBack != null) {
            Icon(
                Icons.Outlined.ArrowBack,
                contentDescription = "Back to Transfers",
                tint = SidekickColors.textBody,
                modifier = Modifier
                    .size(Size.iconButton)
                    .clip(Radius.pillShape)
                    .clickable(onClick = onBack)
                    .padding(Space.sm),
            )
        }
        Text(
            title,
            style = SidekickType.title,
            color = SidekickColors.textPrimary,
            modifier = Modifier.weight(1f),
        )
        if (actionIcon != null && onAction != null) {
            Icon(
                actionIcon,
                contentDescription = actionLabel,
                tint = SidekickColors.textBody,
                modifier = Modifier
                    .size(Size.iconButton)
                    .clip(Radius.pillShape)
                    .clickable(onClick = onAction)
                    .padding(Space.sm),
            )
        }
    }
}
