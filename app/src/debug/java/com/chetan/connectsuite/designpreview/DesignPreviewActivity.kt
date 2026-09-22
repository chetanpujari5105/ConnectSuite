package com.chetan.connectsuite.designpreview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.chetan.connectsuite.core.link.ConnectStage
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
        setContent {
            ConnectSuiteTheme {
                when (screen) {
                    SCREEN_CONNECT_WAITING -> ConnectPreview(ConnectStagePreview.Waiting)
                    SCREEN_CONNECT_CONNECTED -> ConnectPreview(ConnectStagePreview.Connected)
                    SCREEN_CONNECT_EXPIRED -> ConnectPreview(ConnectStagePreview.Expired)
                    SCREEN_CONNECT_REFUSED -> ConnectPreview(ConnectStagePreview.Refused)
                    SCREEN_CONNECT_NO_NETWORK -> ConnectPreview(ConnectStagePreview.NoNetwork)
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
        const val SCREEN_CONNECT_NO_NETWORK = "connect_no_network"
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


private enum class ConnectStagePreview { Waiting, Connected, Expired, Refused, NoNetwork }

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
