package com.chetan.connectsuite.link

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.ui.Radius
import com.chetan.connectsuite.core.ui.RelativeTime
import com.chetan.connectsuite.core.ui.Size
import com.chetan.connectsuite.core.ui.Space
import com.chetan.connectsuite.core.ui.components.DestructiveButton
import com.chetan.connectsuite.core.ui.components.IconBadge
import com.chetan.connectsuite.core.ui.components.SecondaryButton
import com.chetan.connectsuite.core.ui.components.SidekickCard
import com.chetan.connectsuite.core.ui.components.StateBlock
import com.chetan.connectsuite.core.ui.components.StateKind
import com.chetan.connectsuite.core.ui.components.StatusKind
import com.chetan.connectsuite.core.ui.components.StatusPill
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.link.CapabilityStatus
import com.chetan.connectsuite.core.link.BackgroundRestriction
import com.chetan.connectsuite.core.link.heldBackSummary
import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.MacLinkView
import com.chetan.connectsuite.core.link.PhoneAddress
import com.chetan.connectsuite.core.link.ScannedPairing
import com.chetan.connectsuite.core.link.LinkService
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.core.link.LinkWaitStatus
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.ui.SidekickColors
import com.chetan.connectsuite.core.ui.SidekickType
import com.chetan.connectsuite.core.ui.components.PrimaryButton
import androidx.compose.ui.text.font.FontFamily
import com.chetan.connectsuite.core.protocol.Link
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The phone-side view of the v2 link — F2 of `docs/phase-7-pairing-flow.md`.
 *
 * ### What changed, and why the diagnostics did not go away
 *
 * This was a good diagnostics screen doing a first screen's job. It led with
 * *"Ports 42501, 42502, 42503 · protocol v1"* and *"Not offered yet: … 3 not built"*, and put the
 * button a new user actually needs — **Scan pairing code** — underneath both. Someone who has just
 * been told by their Mac to come here met a wall of numbers first.
 *
 * The order is now state, then action, then the paired list, then **Advanced**, collapsed. Nothing
 * is deleted: the ports line has earned its place a dozen times in this project's own testing, and
 * every capability diagnostic is still one tap away. It simply stops being the first thing a
 * stranger reads.
 *
 * ### The wait states are not decided here
 *
 * What the status card says lives in [LinkWaitStatus], in `core/`, where a test can call it. The
 * `showsState` failure in `CLAUDE.md` is the reason: a condition expressed only in a composable was
 * got wrong twice in two slices because nothing could reach it.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun LinkRoute(onDone: () -> Unit = {}, onOpenSetup: (() -> Unit)? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val server = remember { LinkController.get(context) }
    val state by server.state.collectAsStateWithLifecycle()
    val capabilities by server.capabilities.capabilities.collectAsStateWithLifecycle()
    val capStatuses = remember(capabilities) { server.capabilities.diagnostics() }
    val pairedMacs by remember {
        ConnectSuiteDatabase.get(context).trustedDeviceDao().observeAll()
            .map { devices -> devices.filter { it.type == DeviceType.DESKTOP } }
    }.collectAsStateWithLifecycle(initialValue = emptyList())

    var scanning by rememberSaveable { mutableStateOf(false) }
    var lastPaired by remember { mutableStateOf<String?>(null) }
    var advancedOpen by rememberSaveable { mutableStateOf(false) }

    // The status depends on elapsed time, so something has to re-read the clock — a StateFlow that
    // only changes when the link changes would leave "Listening" frozen past its own threshold.
    // One second is far finer than the twenty-second rule needs and costs nothing while this
    // screen is the one on top; it stops when the composable leaves.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val status = remember(state, now) { LinkWaitStatus.of(state, now) }

    // What this phone has scanned and is now expecting, if anything. `rememberSaveable` because a
    // rotation mid-wait must not silently drop the pairing attempt — the token is still armed in
    // `LinkServer` either way, and a screen that forgot about it would show Entry over a live
    // pairing.
    var scanned by rememberSaveable(stateSaver = ScannedPairingSaver) {
        mutableStateOf<ScannedPairing?>(null)
    }
    var showAddress by remember { mutableStateOf(false) }

    // Read once per tick rather than once per composition: the answer changes when Wi-Fi does, and
    // the `now` ticker above is already running at exactly the cadence this needs.
    val localEndpoint = remember(now) { PhoneAddress.controlEndpoint(context) }
    val localAddress = remember(now) { PhoneAddress.localIpv4(context) }

    val stage = remember(state, scanned, localAddress, now) {
        ConnectStage.of(state, scanned, localAddress, now)
    }

    if (scanning) {
        QrScanScreen(
            onScanned = { payload ->
                scope.launch {
                    server.completePairing(payload)
                    LinkService.start(context)
                    lastPaired = payload.name
                    // The wait begins now. `completePairing` armed the token with the same TTL, so
                    // the countdown on screen and the deadline the server enforces come from one
                    // constant — see `ScannedPairing`.
                    scanned = ScannedPairing(payload.name, System.currentTimeMillis())
                    scanning = false
                }
            },
            onCancel = { scanning = false },
        )
        return
    }

    // The Connect-a-Mac flow owns the screen while there is nothing paired, or while a pairing
    // attempt is in flight. Once a Mac is paired and the attempt is finished, this is the Mac
    // management screen below — which still has its own design pass owing.
    if (pairedMacs.isEmpty() || scanned != null) {
        if (showAddress && localEndpoint != null) {
            PhoneAddressDialog(endpoint = localEndpoint, onDismiss = { showAddress = false })
        }
        ConnectMacScreen(
            stage = stage,
            nowMillis = now,
            localEndpoint = localEndpoint,
            onScan = { scanning = true },
            onShowAddress = { showAddress = true },
            // Cancel drops the pairing secret and the TLS admission, not only the screen state.
            onCancel = { server.cancelPairing(); scanned = null },
            onRetry = { scanned = null; scanning = true },
            onOpenWifiSettings = {
                context.startActivity(
                    Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            },
            onOpenDevices = { scanned = null; onDone() },
            onOpenSetup = onOpenSetup,
        )
        return
    }

    MacManagementSection(
        status = status,
        state = state,
        macLink = MacLinkView.of(state, pairedMacs),
        pairedMacs = pairedMacs,
        capabilities = capabilities,
        capStatuses = capStatuses,
        lastPaired = lastPaired,
        ownFingerprint = server.identity.fingerprint,
        nowMillis = now,
        advancedOpen = advancedOpen,
        onAdvancedToggle = { advancedOpen = !advancedOpen },
        onScan = { scanning = true },
        onForget = { deviceId -> scope.launch { server.forgetAndDisconnect(deviceId) } },
        onRestartListening = { LinkService.start(context) },
        onOpenAppInfo = {
            context.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", context.packageName, null),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        },
        onOpenSetup = onOpenSetup,
    )
}

/**
 * The Mac management screen, as a function of its inputs.
 *
 * Parameterised for the reason every other section in this app is: a composable that reaches into
 * `LinkController`, the Room database and `DeviceIdentity` itself can be rendered in exactly one
 * situation — the one the device happens to be in — and this screen's interesting states all
 * require a paired Mac. Same shape as `DevicesSection`, `TransfersSection` and the rest.
 */
@Composable
fun MacManagementSection(
    status: LinkWaitStatus,
    state: LinkState,
    /** The same projection Devices reads (defect 145), so the two screens cannot disagree. */
    macLink: MacLinkView,
    pairedMacs: List<TrustedDeviceEntity>,
    capabilities: Set<String>,
    capStatuses: List<CapabilityStatus>,
    lastPaired: String?,
    ownFingerprint: String,
    nowMillis: Long,
    advancedOpen: Boolean,
    onAdvancedToggle: () -> Unit,
    onScan: () -> Unit,
    onForget: (String) -> Unit,
    onRestartListening: () -> Unit,
    onOpenAppInfo: () -> Unit,
    /** Set up Sidekick (defect 140): the way back to every feature's switch after first run. */
    onOpenSetup: (() -> Unit)? = null,
) {
    // ── Mac management ────────────────────────────────────────────────────────────────────────
    //
    // No reference image; built to the density the other five screens established. Two things it
    // deliberately does **not** do:
    //
    //  - **It does not use `HeroCard`.** There is exactly one gradient surface in this product and
    //    it is the Devices overview's connection card. The brief calls this screen's top card a
    //    "hero card", meaning prominent — so it is a `SidekickCard` with a 64dp badge and the
    //    display type, which is prominence bought with size and space rather than with the one
    //    treatment that is supposed to mean *this is the thing*.
    //  - **It offers no per-Mac Disconnect.** There is no such action. `forgetAndDisconnect`
    //    forgets *and* drops; `LinkServer.stop` stops the whole server; nothing ends one session
    //    and leaves the pairing and the listener alone. A "Disconnect" button here would have to be
    //    one of those two wearing the wrong label.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(vertical = Space.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "This Mac",
                style = SidekickType.display,
                color = SidekickColors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            StatusPill(
                text = if (macLink.connected) "Connected" else "Waiting",
                kind = if (macLink.connected) StatusKind.Connected else StatusKind.Neutral,
            )
        }

        // 1. The prominent card: who is connected, or who we are waiting for.
        SidekickCard {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.lg),
            ) {
                IconBadge(
                    icon = Icons.Outlined.Laptop,
                    size = 64.dp,
                    tint = if (macLink.connected) SidekickColors.accent else SidekickColors.textBody,
                    container = if (macLink.connected) SidekickColors.accentTint else SidekickColors.cardRaised,
                    border = if (macLink.connected) SidekickColors.accentBorder else SidekickColors.border,
                )
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(Space.xs),
                ) {
                    Text(
                        macLink.name ?: "No Mac paired",
                        style = SidekickType.title,
                        color = SidekickColors.textPrimary,
                    )
                    // What `LinkWaitStatus` chose, unchanged — the decision lives in `core/`
                    // where a test can call it, and this screen renders whatever it says.
                    //
                    // **Except when it would say the name twice.** `Connected`'s headline is
                    // "Connected to <names>", and this card's title is already that name, so the
                    // connected state read "Chetans-MacBook-Pro / Connected to
                    // Chetans-MacBook-Pro". The pill at the top of the screen carries the state in
                    // that case; the sentence is for the states where the name is not the answer.
                    if (status !is LinkWaitStatus.Connected) {
                        Text(
                            status.headline,
                            style = SidekickType.caption,
                            color = SidekickColors.textBody,
                        )
                    }
                }
            }

            status.detail?.let {
                Spacer(Modifier.height(Space.md))
                Text(it, style = SidekickType.caption, color = SidekickColors.textBody)
            }

            // Real facts only. There is no latency here and there is no ping on this side to
            // produce one — the same omission as the Devices hero, for the same reason.
            Spacer(Modifier.height(Space.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                macLink.address?.let { FactChip(Icons.Outlined.Wifi, it) }
                FactChip(Icons.Outlined.Lock, "TLS 1.3")
            }
        }

        lastPaired?.let {
            SidekickCard(padding = Space.md, container = SidekickColors.accentTint, border = SidekickColors.accentBorder) {
                Text("Paired with $it.", style = SidekickType.body, color = SidekickColors.textPrimary)
            }
        }

        // 2. The wall the phone put up on its own, and the only one here that nobody chose.
        //
        // At rest, above Advanced, and not in the "Not offered yet" line — defect 85's rule:
        // a card carrying a *state* has to be visible where the person is, because somebody
        // asking "why did mirroring not start" does not open Advanced to find out whether an
        // answer exists. It draws only while the restriction is set, so the common phone shows
        // nothing at all.
        if (capStatuses.any { it.backgroundRestricted }) {
            SidekickCard(
                container = SidekickColors.warningTint,
                border = SidekickColors.warningBorder,
            ) {
                Text(
                    BackgroundRestriction.HEADLINE,
                    style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                    color = SidekickColors.textPrimary,
                )
                Spacer(Modifier.height(Space.sm))
                Text(BackgroundRestriction.BODY, style = SidekickType.caption, color = SidekickColors.textBody)
                Spacer(Modifier.height(Space.xs))
                Text(BackgroundRestriction.STEPS, style = SidekickType.caption, color = SidekickColors.textBody)
                Spacer(Modifier.height(Space.xs))
                Text(
                    BackgroundRestriction.NOT_THE_SAME_SWITCH,
                    style = SidekickType.meta,
                    color = SidekickColors.textMeta,
                )
                Spacer(Modifier.height(Space.md))
                // Opens App info and stops there. There is no public action for the
                // Battery page inside it, so the two remaining taps are named above
                // rather than promised by a button that cannot make them.
                SecondaryButton(
                    text = BackgroundRestriction.ACTION_LABEL,
                    onClick = onOpenAppInfo,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // 2b. The way back to every feature's switch. Above the paired list, because a person here
        //     asking "why doesn't my Mac show my texts" is asking a question about this phone.
        if (onOpenSetup != null) com.chetan.connectsuite.setup.SetupEntryCard(onClick = onOpenSetup)

        // 3. The paired list.
        Text(
            "Paired Macs",
            style = SidekickType.section,
            color = SidekickColors.textPrimary,
            modifier = Modifier.padding(top = Space.md, bottom = Space.xs),
        )

        // A Column rather than a LazyColumn: this list is the number of Macs a person owns, and a
        // lazy list nested in a scrolling parent has no bounded height.
        pairedMacs.forEach { mac ->
            SidekickCard(padding = Space.md) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.md),
                ) {
                    IconBadge(Icons.Outlined.Laptop)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            mac.name,
                            style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                            color = SidekickColors.textPrimary,
                        )
                        Text(
                            "Paired ${RelativeTime.of(mac.pairedAtMillis, nowMillis)}",
                            style = SidekickType.caption,
                            color = SidekickColors.textBody,
                        )
                    }
                    // Not `trustStore.forget` — that revokes the row and leaves the session it
                    // authorised running. See LinkServer.forgetAndDisconnect.
                    DestructiveButton(
                        text = "Forget",
                        onClick = { onForget(mac.deviceId) },
                    )
                }
            }
        }

        if (pairedMacs.isEmpty()) {
            SidekickCard(padding = Space.xs) {
                StateBlock(
                    kind = StateKind.Empty,
                    icon = Icons.Outlined.Laptop,
                    headline = "No Macs paired",
                    body = "Scan the code Sidekick shows on your Mac and this phone will remember " +
                        "it. Pairing is once per Mac.",
                )
            }
        }

        SecondaryButton(
            text = if (pairedMacs.isEmpty()) "Scan pairing code" else "Pair another Mac",
            onClick = { onScan() },
            icon = Icons.Outlined.QrCodeScanner,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        )

        // 4. Advanced — everything that used to be first.
        Spacer(Modifier.height(Space.sm))
        Row(
            Modifier
                .fillMaxWidth()
                .clip(Radius.cardShape)
                .clickable(onClick = onAdvancedToggle)
                .padding(vertical = Space.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Advanced",
                style = SidekickType.section,
                color = SidekickColors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            Icon(
                if (advancedOpen) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                contentDescription = if (advancedOpen) "Hide advanced" else "Show advanced",
                tint = SidekickColors.textBody,
                modifier = Modifier.size(Size.iconLarge),
            )
        }
        AnimatedVisibility(visible = advancedOpen) {
            SidekickCard(padding = Space.md) {
                // **The fingerprint lives here and only here.** It is not a status, and a screen
                // that shows it at rest teaches people to ignore it — which is the one thing a
                // fingerprint must not be. It is the number you compare when something looks
                // wrong, so it is one deliberate tap away.
                AdvancedRow("This phone's key", DeviceIdentity.shortFingerprint(ownFingerprint))
                pairedMacs.forEach { mac ->
                    AdvancedRow("${mac.name}'s key", DeviceIdentity.shortFingerprint(mac.fingerprint))
                }
                AdvancedRow(
                    "Ports",
                    "${Link.PORT_CONTROL}, ${Link.PORT_VIDEO}, ${Link.PORT_BULK} · protocol v${Link.PROTOCOL_MAJOR}",
                )
                AdvancedRow(
                    "Available to the Mac",
                    if (capabilities.isEmpty()) "nothing yet" else capabilities.sorted().joinToString(", "),
                )
                // A capability is only advertised once its handlers exist, so this list is what
                // the Mac will actually grey out — and saying why beats a blank line.
                //
                // The sentence is built in `core/` by `heldBackSummary`, not here.
                heldBackSummary(capStatuses)?.let {
                    Spacer(Modifier.height(Space.sm))
                    Text(it, style = SidekickType.caption, color = SidekickColors.textMeta)
                }
                state.lastError?.let {
                    Spacer(Modifier.height(Space.sm))
                    Text(
                        "Last disconnect: $it",
                        style = SidekickType.caption,
                        color = SidekickColors.destructive,
                    )
                }
                Spacer(Modifier.height(Space.md))
                SecondaryButton(
                    text = if (state.running) "Restart listening" else "Start listening",
                    onClick = onRestartListening,
                    icon = Icons.Outlined.Refresh,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // 5. The security explainer.
        Spacer(Modifier.height(Space.sm))
        SidekickCard(padding = Space.md, container = SidekickColors.canvas) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                IconBadge(Icons.Outlined.Lock, tint = SidekickColors.textMeta)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                    Text(
                        "How this connection is secured",
                        style = SidekickType.body.copy(fontWeight = FontWeight.Medium),
                        color = SidekickColors.textPrimary,
                    )
                    Text(
                        "Both ends hold their own key and pinned the other's when you scanned the " +
                            "code. Every connection after that is checked against the pinned key, " +
                            "over TLS 1.3, on your local network — there is no account, no server " +
                            "in the middle and no plaintext fallback. A Mac whose key has changed " +
                            "is refused and told so.",
                        style = SidekickType.caption,
                        color = SidekickColors.textBody,
                    )
                }
            }
        }

        Spacer(Modifier.height(Space.xl))
    }
}

/** One label-and-value line in Advanced. The value is monospace where it is a number to compare. */
@Composable
private fun AdvancedRow(label: String, value: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = Space.xs),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = SidekickType.meta, color = SidekickColors.textMeta)
        Text(
            value,
            style = SidekickType.caption.copy(fontFamily = FontFamily.Monospace),
            color = SidekickColors.onControl,
        )
    }
}

@Composable
private fun FactChip(icon: ImageVector, label: String) {
    Row(
        Modifier
            .clip(Radius.pillShape)
            .background(SidekickColors.cardRaised)
            .padding(horizontal = Space.md, vertical = Space.sm),
        horizontalArrangement = Arrangement.spacedBy(Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = SidekickColors.textBody, modifier = Modifier.size(16.dp))
        Text(label, style = SidekickType.meta, color = SidekickColors.onControl)
    }
}

/** Called from the activity so permission changes reach connected Macs without a reconnect. */
fun refreshLinkCapabilities(context: Context) = LinkService.refreshCapabilities(context)


/**
 * `ScannedPairing` across a rotation.
 *
 * A two-element list rather than `Serializable`: the type is a plain pair of a name and a
 * timestamp, and a hand-written saver keeps it that way. It is here rather than in `core/` because
 * saving is a UI concern and `core` should not gain a Compose dependency for it.
 */
private val ScannedPairingSaver: Saver<ScannedPairing?, Any> = Saver(
    save = { it?.let { p -> listOf(p.macName, p.scannedAtMillis) } ?: emptyList<Any>() },
    restore = {
        @Suppress("UNCHECKED_CAST")
        val list = it as List<Any>
        if (list.isEmpty()) null else ScannedPairing(list[0] as String, list[1] as Long)
    },
)

/**
 * The phone's own address, for typing into the Mac.
 *
 * This is the honest other half of reference 02's "Enter address manually": the Mac dials out, so
 * the number a person needs is this one, on this screen, to read across to the other machine.
 */
@Composable
private fun PhoneAddressDialog(endpoint: String, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SidekickColors.card,
        titleContentColor = SidekickColors.textPrimary,
        textContentColor = SidekickColors.textBody,
        title = { Text("This phone's address", style = SidekickType.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "In Sidekick on your Mac, choose to enter an address by hand and type this:",
                    style = SidekickType.body,
                )
                Text(
                    endpoint,
                    style = SidekickType.title.copy(fontFamily = FontFamily.Monospace),
                    color = SidekickColors.accentText,
                )
                Text(
                    "It changes when this phone joins a different network, so it is worth " +
                        "checking here rather than remembering it.",
                    style = SidekickType.caption,
                    color = SidekickColors.textMeta,
                )
            }
        },
        confirmButton = { PrimaryButton("Done", onDismiss) },
    )
}
