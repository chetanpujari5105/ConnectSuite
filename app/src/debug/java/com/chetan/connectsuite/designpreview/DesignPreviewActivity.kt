package com.chetan.connectsuite.designpreview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
import com.chetan.connectsuite.core.data.TransferDirection
import com.chetan.connectsuite.core.data.TransferEntity
import com.chetan.connectsuite.core.data.TransferStatus
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.sync.transfer.TransferProgress
import com.chetan.connectsuite.sync.ui.folders.FolderQuickPicks
import com.chetan.connectsuite.sync.ui.folders.FolderRow
import com.chetan.connectsuite.sync.ui.folders.FoldersSection
import com.chetan.connectsuite.sync.ui.folders.FoldersUiState
import com.chetan.connectsuite.sync.ui.transfers.TransfersSection
import com.chetan.connectsuite.sync.ui.transfers.TransfersUiState
import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.sync.ui.clipboard.ClipboardSection
import com.chetan.connectsuite.sync.v2.ClipboardPayloads
import com.chetan.connectsuite.sync.ui.notifications.NotificationsSection
import com.chetan.connectsuite.sync.ui.notifications.NotificationsUiState
import com.chetan.connectsuite.sync.v2.ClipFeature
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.link.MacLinkView
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.core.link.LinkWaitStatus
import com.chetan.connectsuite.link.MacManagementSection
import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.PairRejectReason
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.link.ConnectMacScreen
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.model.DiscoveryChannel
import com.chetan.connectsuite.core.model.PairState
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.components.NavItem
import com.chetan.connectsuite.core.ui.components.SidekickBottomNav
import com.chetan.connectsuite.sync.ui.devices.ActivityItem
import com.chetan.connectsuite.sync.ui.devices.ActivityKind
import com.chetan.connectsuite.sync.ui.devices.DevicesSection
import com.chetan.connectsuite.sync.ui.devices.DevicesUiState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.ScreenShare
import androidx.compose.material.icons.outlined.SwapVert

/**
 * A screenshot harness for states the emulator cannot reach.
 *
 * ### Why this exists, and why it is not a mockup
 *
 * The acceptance method for this UI pass is *build, run, screenshot, compare against the
 * reference*. Reference `01` is a **connected** phone, and an emulator has no Mac: it cannot pair
 * over the v2 link, because the Mac dials the phone and an AVD's `10.0.2.15` is not reachable from
 * the host without forwarding, and pairing needs a QR code through a camera that does not exist.
 *
 * So the connected state is unobservable on this hardware, and the two honest options are to leave
 * the hero unverified or to render the real composable with stated inputs. This is the second: the
 * **production** `DevicesSection` draws, with the **production** theme, on the **real** device, at
 * the real density. Only the state object is constructed here.
 *
 * ### What a screenshot from this may and may not be quoted for
 *
 * It proves layout, palette, type, spacing, insets and component reuse at a real density. It proves
 * **nothing** about wiring — no ViewModel is attached and every callback below is a no-op, so a
 * screenshot from here can never be evidence that a button does anything. That claim needs the real
 * app, and it is made separately.
 *
 * This is the `@Preview` allowance in the brief, moved onto the device because a desktop preview
 * render is not the thing being verified. Debug source set, `exported="false"`, no launcher icon.
 */
class DesignPreviewActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val screen = intent?.getStringExtra(EXTRA_SCREEN) ?: SCREEN_DEVICES_CONNECTED
        if (screen == SCREEN_MIRROR_REQUEST) {
            // SYNTHETIC — the production notification, posted for a Mac named "Example Mac" so its
            // wording and its action can be seen on a real shade. No mirror.start exists behind it.
            com.chetan.connectsuite.mirror.v2.MirrorNotifications.askUserToStart(this, "Example Mac")
        }
        setContent {
            ConnectSuiteTheme {
                when (screen) {
                    SCREEN_CONNECT_WAITING -> ConnectPreview(ConnectStagePreview.Waiting)
                    SCREEN_CONNECT_CONNECTED -> ConnectPreview(ConnectStagePreview.Connected)
                    SCREEN_CONNECT_EXPIRED -> ConnectPreview(ConnectStagePreview.Expired)
                    SCREEN_CONNECT_REFUSED -> ConnectPreview(ConnectStagePreview.Refused)
                    SCREEN_CONNECT_REJECTED -> ConnectPreview(ConnectStagePreview.Rejected)
                    SCREEN_CONNECT_NO_NETWORK -> ConnectPreview(ConnectStagePreview.NoNetwork)
                    SCREEN_TRANSFERS -> TransfersPreview()
                    SCREEN_FOLDERS -> FoldersPreview()
                    SCREEN_CLIP -> ClipPreview()
                    SCREEN_FEED -> FeedPreview()
                    SCREEN_MAC -> MacManagementPreview()
                    SCREEN_MIRROR_REQUEST -> MirrorRequestPreview()
                    else -> DevicesConnectedPreview()
                }
            }
        }
    }

    companion object {
        const val EXTRA_SCREEN = "screen"
        const val SCREEN_DEVICES_CONNECTED = "devices_connected"
        const val SCREEN_CONNECT_WAITING = "connect_waiting"
        const val SCREEN_CONNECT_CONNECTED = "connect_connected"
        const val SCREEN_CONNECT_EXPIRED = "connect_expired"
        const val SCREEN_CONNECT_REFUSED = "connect_refused"
        const val SCREEN_CONNECT_REJECTED = "connect_rejected"
        const val SCREEN_CONNECT_NO_NETWORK = "connect_no_network"
        const val SCREEN_TRANSFERS = "transfers"
        const val SCREEN_FOLDERS = "folders"
        const val SCREEN_CLIP = "clip"
        const val SCREEN_FEED = "feed"
        const val SCREEN_MAC = "mac"
        const val SCREEN_MIRROR_REQUEST = "mirror_request"
    }
}

/**
 * Sample data, and it is labelled as such here rather than anywhere the product can reach.
 *
 * The names are the ones from the reference image so the screenshots can be laid side by side —
 * `Chetans-MacBook-Pro`, `IMG_3928.MP4`. The timestamps are offsets from *now* rather than fixed
 * instants, so the relative ages render the way they would in the real app.
 */
@Composable
private fun DevicesConnectedPreview() {
    val now = remember { System.currentTimeMillis() }
    val minute = 60_000L

    val mac = Device(
        id = "mac-1",
        name = "Chetans-MacBook-Pro",
        type = DeviceType.DESKTOP,
        pairState = PairState.PAIRED,
        channel = DiscoveryChannel.LAN,
        address = "10.36.14.60",
        port = 42501,
        isConnected = true,
    )

    val state = DevicesUiState(
        devices = listOf(mac),
        thisDeviceName = "Samsung SM-S938B",
        thisDeviceFingerprint = "3030 C8EB CDDC D0FB",
    )

    val recent = listOf(
        ActivityItem(
            "a", ActivityKind.ClipSent, "Sent to your Mac",
            "“https://openai.com”", now - 2 * minute,
        ),
        ActivityItem(
            "b", ActivityKind.Notifications, "2 notifications mirrored",
            "WhatsApp · LinkedIn", now - 12 * minute,
        ),
        ActivityItem(
            "c", ActivityKind.TransferOut, "Sent to your Mac",
            "IMG_3928.MP4 · 12.4 MB", now - 18 * minute,
        ),
        ActivityItem(
            "d", ActivityKind.TransferIn, "Received from your Mac",
            "Q3-report.pdf · 1.8 MB", now - 64 * minute,
        ),
    )

    var tab by remember { mutableStateOf(0) }

    Scaffold(
        containerColor = SidekickColors.canvas,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = {
            SidekickBottomNav(
                items = listOf(
                    NavItem("Devices", Icons.Outlined.Devices),
                    NavItem("Transfers", Icons.Outlined.SwapVert),
                    NavItem("Clip", Icons.Outlined.ContentCopy),
                    NavItem("Feed", Icons.Outlined.Notifications),
                    NavItem("Mirror", Icons.Outlined.ScreenShare),
                ),
                selectedIndex = tab,
                onSelect = { tab = it },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            DevicesSection(
                state = state,
                // Through the production projection, from a live link — not a v1 `Device` marked
                // connected, which is a state the real Mac never produces (defect 145).
                macLink = MacLinkView.of(
                    LinkState(running = true, clients = listOf("Chetans-MacBook-Pro")),
                    listOf(
                        TrustedDeviceEntity(
                            deviceId = "mac-1", name = "Chetans-MacBook-Pro", type = DeviceType.DESKTOP,
                            certificate = "", fingerprint = "", pairedAtMillis = now, lastSeenAtMillis = now,
                            lastAddress = "10.36.14.60",
                        ),
                    ),
                ),
                recent = recent,
                mirroringAvailable = true,
                nowMillis = now,
                onRefresh = {},
                onPair = {},
                onConnect = {},
                onForget = {},
                onJoinWifiDirect = {},
                onOpenDevice = {},
                onStartMirroring = {},
                onOpenMac = {},
                onQuickAction = {},
            )
        }
    }
}


private enum class ConnectStagePreview { Waiting, Connected, Expired, Refused, Rejected, NoNetwork }

/**
 * The Connect-a-Mac stages that the emulator cannot produce.
 *
 * **Entry, QR scan and No network are NOT here** — all three are reachable in the real app on this
 * emulator and were screenshotted there instead. What is left is the set that needs a Mac: a wait
 * with an armed token, a live session, an expired token, and a refused handshake. Building a
 * harness entry for a state the real app can show would be the worse evidence of the two.
 *
 * `NoNetwork` is included anyway, as a **control**: the real app's version of it was captured with
 * Wi-Fi actually off, and having both lets the two be compared. If they differ, the harness is
 * lying about something.
 */
@Composable
private fun ConnectPreview(which: ConnectStagePreview) {
    val now = remember { System.currentTimeMillis() }
    val mac = "Chetans-MacBook-Pro"
    val stage = when (which) {
        ConnectStagePreview.Waiting -> ConnectStage.Waiting(
            macName = mac,
            scannedAtMillis = now - 42_000,
            expiresAtMillis = now - 42_000 + Link.PAIR_TOKEN_TTL_MS,
        )
        ConnectStagePreview.Connected -> ConnectStage.Connected(mac)
        ConnectStagePreview.Expired -> ConnectStage.Expired(mac)
        ConnectStagePreview.Refused -> ConnectStage.Refused("a91f4c2e8b07d5", "10.36.14.77")
        ConnectStagePreview.Rejected -> ConnectStage.Rejected(PairRejectReason.TOKEN_MISMATCH, mac)
        ConnectStagePreview.NoNetwork -> ConnectStage.NoNetwork
    }

    Scaffold(
        containerColor = SidekickColors.canvas,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = { PreviewNav(selected = -1) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            ConnectMacScreen(
                stage = stage,
                nowMillis = now,
                localEndpoint = if (which == ConnectStagePreview.NoNetwork) null else "10.36.14.60:42501",
                onScan = {},
                onShowAddress = {},
                onCancel = {},
                onRetry = {},
                onOpenWifiSettings = {},
                onOpenDevices = {},
            )
        }
    }
}

/**
 * @param selected -1 for the Connect-a-Mac previews.
 *
 * The real flow lives on the `mac` route, where **no tab is lit** — that is the decision recorded
 * for Mac management. The first harness run defaulted to 0 and drew Devices lime, which is a
 * screenshot of a nav state the product never produces. An inaccurate harness is worse than no
 * harness: it is evidence pointing at something that does not exist.
 */
@Composable
private fun PreviewNav(selected: Int = 0) {
    SidekickBottomNav(
        items = listOf(
            NavItem("Devices", Icons.Outlined.Devices),
            NavItem("Transfers", Icons.Outlined.SwapVert),
            NavItem("Clip", Icons.Outlined.ContentCopy),
            NavItem("Feed", Icons.Outlined.Notifications),
            NavItem("Mirror", Icons.Outlined.ScreenShare),
        ),
        selectedIndex = selected,
        onSelect = {},
    )
}


/**
 * Transfers with work in it. The emulator has no Mac, so it has no transfers — every row here is
 * constructed, and the **production** `TransfersSection` renders them.
 *
 * The set is chosen to put every status on one screen at once: a running send with a real rate, a
 * running receive, a paused one carrying `TransferManager`'s own "Connection lost", a failure, a
 * cancellation and two completions. That is what a screenshot is for — states that never co-occur
 * naturally still have to look right beside each other.
 */
@Composable
private fun TransfersPreview() {
    val now = remember { System.currentTimeMillis() }
    val minute = 60_000L

    fun live(
        id: String, name: String, dir: TransferDirection, total: Long, done: Long, rate: Long,
    ) = TransferProgress(
        transferId = id, jobId = "job-$id", peerDeviceId = "mac-1", fileName = name,
        direction = dir, totalBytes = total, bytesTransferred = done,
        status = TransferStatus.RUNNING, bytesPerSecond = rate,
    )

    fun past(
        id: String, name: String, dir: TransferDirection, total: Long, done: Long,
        status: TransferStatus, agoMinutes: Long, error: String? = null,
    ) = TransferEntity(
        transferId = id, jobId = "job-$id", peerDeviceId = "mac-1", direction = dir,
        fileName = name, relativePath = name, mimeType = "application/octet-stream",
        totalBytes = total, bytesTransferred = done, status = status, checksum = null,
        localUri = null, startedAtMillis = now - agoMinutes * minute - minute,
        updatedAtMillis = now - agoMinutes * minute, errorMessage = error,
    )

    val state = TransfersUiState(
        active = listOf(
            live("t1", "IMG_2481.jpg", TransferDirection.OUTGOING, 4_200_000, 2_856_000, 1_400_000),
            live("t2", "Screen Recording.mov", TransferDirection.OUTGOING, 232_000_000, 201_840_000, 3_100_000),
        ),
        history = listOf(
            past("t3", "Design Assets.zip", TransferDirection.OUTGOING, 486_000_000, 141_000_000,
                TransferStatus.PAUSED, 3, "Connection lost"),
            past("t4", "Wallpaper.png", TransferDirection.OUTGOING, 2_400_000, 0,
                TransferStatus.FAILED, 8, "The Mac closed the connection"),
            past("t5", "Notes.txt", TransferDirection.INCOMING, 12_000, 12_000, TransferStatus.COMPLETED, 12),
            past("t6", "Demo.mp4", TransferDirection.INCOMING, 78_000_000, 78_000_000, TransferStatus.COMPLETED, 64),
            past("t7", "Q3-report.pdf", TransferDirection.OUTGOING, 1_800_000, 400_000, TransferStatus.CANCELLED, 130),
        ),
    )

    PreviewShell(title = "Transfers", selected = 1) {
        TransfersSection(state = state, onCancel = {})
    }
}

/** Folders with two grants, one of which has outlived its folder. */
@Composable
private fun FoldersPreview() {
    val state = FoldersUiState.Folders(
        rows = listOf(
            FolderRow(rootId = "saf:primary%3ADCIM%2FCamera", label = "DCIM › Camera", writable = true, resolves = true),
            FolderRow(rootId = "saf:primary%3ASnaps", label = "Snaps", writable = false, resolves = false),
        ),
    )
    PreviewShell(title = "Folders", selected = 1) {
        FoldersSection(
            state = state,
            onAddFolder = {},
            onRemove = {},
            quickPicks = FolderQuickPicks.offered(setOf("saf:primary%3ADCIM%2FCamera")),
            onQuickPick = {},
        )
    }
}

/** The header and bar the Sync host puts around a section, so a preview is framed like the app. */
@Composable
private fun PreviewShell(title: String, selected: Int, content: @Composable () -> Unit) {
    Scaffold(
        containerColor = SidekickColors.canvas,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = { PreviewNav(selected = selected) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(title, style = SidekickType.title, color = SidekickColors.textPrimary)
            }
            content()
        }
    }
}


/** Clip with a seven-entry history both ways, the toggle off, and a link up. */
@Composable
private fun ClipPreview() {
    val now = remember { System.currentTimeMillis() }
    var autoApply by remember { mutableStateOf(false) }
    // Newest first, the order `ClipboardPayloads.History` hands out — the preview supplies the list
    // rather than a count, because the count is derived from it now and a preview that set one
    // would be describing a state the product cannot produce.
    val history = remember {
        fun entry(text: String, minutesAgo: Long, fromMac: Boolean) =
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_TEXT,
                text = text,
                atMs = now - minutesAgo * 60_000,
                source = if (fromMac) ClipboardPayloads.SOURCE_MAC else ClipboardPayloads.SOURCE_PHONE,
            )
        listOf(
            entry(
                "https://developer.android.com/studio — Android Studio is the official IDE for " +
                    "Android development, providing the fastest tools for building apps on every " +
                    "kind of Android device.",
                2, fromMac = true,
            ),
            entry("git rebase -i origin/main", 14, fromMac = false),
            entry("RZCY12330DT", 31, fromMac = false),
            entry("./gradlew :app:assembleDebug", 48, fromMac = true),
            entry("42501 control, 42502 video, 42503 bulk", 63, fromMac = true),
            entry("docs/phase-7-state.md", 95, fromMac = false),
            entry("_connectsuite._tcp", 140, fromMac = true),
        )
    }
    PreviewShell(title = "Clip", selected = 2) {
        ClipboardSection(
            state = ClipFeature.PhoneState(
                lastSentPreview = "git rebase -i origin/main",
                lastSentAtMs = now - 14 * 60_000,
                lastReceivedPreview = history.first().text,
                lastReceivedAtMs = now - 2 * 60_000,
                lastReceivedApplied = false,
                history = history,
                linkUp = true,
            ),
            autoApply = autoApply,
            onSetAutoApply = { autoApply = it },
            onApplyFromMac = {},
        )
    }
}

/**
 * Feed with notifications mirrored from a paired device.
 *
 * `iconBase64` is null on every row here, which is deliberate: the harness has no real peer icons
 * to hand, and inventing PNGs would make the screenshot prettier than the code. The rows therefore
 * show the [AvatarBadge] fallback — which is the path worth seeing, because it is the one that runs
 * whenever an app sent no icon.
 */
@Composable
private fun FeedPreview() {
    val now = remember { System.currentTimeMillis() }
    val minute = 60_000L
    fun n(id: String, app: String, title: String, text: String, ago: Long, clearable: Boolean = true) =
        MirroredNotificationEntity(
            id = id, peerDeviceId = "peer-1", remoteKey = id,
            packageName = "com.example.${app.lowercase()}", appName = app,
            title = title, text = text,
            postedAtMillis = now - ago * minute, receivedAtMillis = now - ago * minute,
            isClearable = clearable,
        )
    PreviewShell(title = "Feed", selected = 3) {
        NotificationsSection(
            state = NotificationsUiState(
                notifications = listOf(
                    n("1", "WhatsApp", "Payal", "Hey! Are we still on for dinner tonight?", 2),
                    n("2", "Gmail", "Udemy", "New sale! You earned $12.99 from your course", 12),
                    n("3", "Slack", "Team Update", "Standup in 10 minutes. Please be ready.", 28),
                    n("4", "Phone", "Ongoing call", "Mom · 04:12", 31, clearable = false),
                    n("5", "LinkedIn", "New connection", "Mangesh Raut sent you a connection request", 124),
                ),
                listenerEnabled = true,
            ),
            onDismiss = {},
            onEnableListener = {},
        )
    }
}


/**
 * Mac management with a Mac paired and connected.
 *
 * The emulator can pair with nothing, so the management half of `LinkRoute` is unreachable there —
 * it only renders once `pairedMacs` is non-empty. `MacManagementSection` was extracted for exactly
 * this reason, the same way every other section in the app takes its state as a parameter.
 *
 * **No bottom bar.** Mac management is not one of the five destinations, and the real screen shows
 * the bar with nothing lit — which `PreviewNav(selected = -1)` reproduces.
 */
@Composable
private fun MacManagementPreview() {
    val now = remember { System.currentTimeMillis() }
    var advancedOpen by remember { mutableStateOf(false) }
    val mac = TrustedDeviceEntity(
        deviceId = "3030c8ebcddcd0fb",
        name = "Chetans-MacBook-Pro",
        type = DeviceType.DESKTOP,
        certificate = "",
        fingerprint = "30:30:C8:EB:CD:DC:D0:FB:A9:1F:4C:2E:8B:07:D5:51:3A:7F:91:C2:04:BE:D5:51:AA:BB:CC:DD:EE:FF:00:11",
        pairedAtMillis = now - 3L * 24 * 60 * 60 * 1000,
        lastSeenAtMillis = now - 60_000,
        lastAddress = "10.36.14.60",
        lastPort = 42501,
    )
    Scaffold(
        containerColor = SidekickColors.canvas,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = { PreviewNav(selected = -1) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            MacManagementSection(
                status = LinkWaitStatus.Connected(listOf("Chetans-MacBook-Pro")),
                state = LinkState(running = true, clients = listOf("Chetans-MacBook-Pro")),
                macLink = MacLinkView.of(LinkState(running = true, clients = listOf("Chetans-MacBook-Pro")), listOf(mac)),
                pairedMacs = listOf(mac),
                capabilities = setOf("mirror", "clipboard", "files", "apps", "notifications", "remote"),
                capStatuses = emptyList(),
                lastPaired = null,
                ownFingerprint = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90",
                nowMillis = now,
                advancedOpen = advancedOpen,
                onAdvancedToggle = { advancedOpen = !advancedOpen },
                onScan = {},
                onForget = {},
                onRestartListening = {},
                onOpenAppInfo = {},
            )
        }
    }
}

/**
 * SYNTHETIC — Feature F's request card as the Mirror tab draws it while a Mac's `mirror.start` is
 * waiting, with a peer named "Example Mac" and a request made now. The production composable; the
 * buttons are no-ops here, so this proves layout and copy and nothing about wiring.
 */
@androidx.compose.runtime.Composable
private fun MirrorRequestPreview() {
    androidx.compose.foundation.layout.Column(
        androidx.compose.ui.Modifier
            .fillMaxSize()
            .background(com.chetan.connectsuite.core.ui.SidekickColors.canvas)
            .statusBarsPadding()
            .padding(horizontal = com.chetan.connectsuite.core.ui.Space.lg),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(com.chetan.connectsuite.core.ui.Space.sm),
    ) {
        androidx.compose.material3.Text(
            "Mirror",
            style = com.chetan.connectsuite.core.ui.SidekickType.display,
            color = com.chetan.connectsuite.core.ui.SidekickColors.textPrimary,
            modifier = androidx.compose.ui.Modifier.padding(vertical = com.chetan.connectsuite.core.ui.Space.md),
        )
        com.chetan.connectsuite.mirror.v2.ui.MirrorRequestCard(
            status = com.chetan.connectsuite.mirror.v2.MirrorStatus(
                phase = com.chetan.connectsuite.mirror.v2.MirrorPhase.AWAITING_FOREGROUND,
                peerName = "Example Mac",
                awaitingTap = true,
                askedAtMillis = System.currentTimeMillis(),
            ),
            onContinue = {},
            onDecline = {},
        )
    }
}
