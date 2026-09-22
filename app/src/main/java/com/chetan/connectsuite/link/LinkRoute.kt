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
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.link.BackgroundRestriction
import com.chetan.connectsuite.core.link.heldBackSummary
import com.chetan.connectsuite.core.link.ConnectStage
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.PhoneAddress
import com.chetan.connectsuite.core.link.ScannedPairing
import com.chetan.connectsuite.core.link.LinkService
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
fun LinkRoute(onDone: () -> Unit = {}) {
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
    val localEndpoint = remember(now) { PhoneAddress.controlEndpoint() }
    val localAddress = remember(now) { PhoneAddress.localIpv4() }

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
            onCancel = { scanned = null },
            onRetry = { scanned = null; scanning = true },
            onOpenWifiSettings = {
                context.startActivity(
                    Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            },
            onOpenDevices = { scanned = null; onDone() },
        )
        return
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Mac") }) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 1. What is true right now, in the words `LinkWaitStatus` chose.
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = when (status) {
                        is LinkWaitStatus.Refused -> MaterialTheme.colorScheme.errorContainer
                        is LinkWaitStatus.Connected -> MaterialTheme.colorScheme.secondaryContainer
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    },
                ),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(status.headline, style = MaterialTheme.typography.titleMedium)
                    status.detail?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (pairedMacs.isEmpty()) {
                        Text(
                            "Pairing lets your Mac see this phone's notifications, texts, calls, " +
                                "photos and files — and send things back.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            lastPaired?.let { Text("Paired with $it.") }

            // 1b. The wall the phone put up on its own, and the only one here that nobody chose.
            //
            // At rest, above Advanced, and not in the "Not offered yet" line — defect 85's rule:
            // a card carrying a *state* has to be visible where the person is, because somebody
            // asking "why did mirroring not start" does not open Advanced to find out whether an
            // answer exists. It draws only while the restriction is set, so the common phone shows
            // nothing at all.
            if (capStatuses.any { it.backgroundRestricted }) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                    ),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            BackgroundRestriction.HEADLINE,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(BackgroundRestriction.BODY, style = MaterialTheme.typography.bodyMedium)
                        Text(BackgroundRestriction.STEPS, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            BackgroundRestriction.NOT_THE_SAME_SWITCH,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        // Opens App info and stops there. There is no public action for the
                        // Battery page inside it, so the two remaining taps are named above
                        // rather than promised by a button that cannot make them.
                        OutlinedButton(onClick = {
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", context.packageName, null),
                                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }) { Text(BackgroundRestriction.ACTION_LABEL) }
                    }
                }
            }

            // 2. The action. Primary while nothing is paired; secondary once something is.
            if (pairedMacs.isEmpty()) {
                Button(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("Scan pairing code")
                }
            } else {
                OutlinedButton(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("Pair another Mac")
                }
            }

            // 3. The paired list.
            Text("Paired Macs", style = MaterialTheme.typography.titleSmall)
            if (pairedMacs.isEmpty()) {
                Text("None yet.", style = MaterialTheme.typography.bodySmall)
            } else {
                // A Column rather than a LazyColumn: this list is the number of Macs a person
                // owns, and a lazy list nested in a scrolling parent has no bounded height.
                pairedMacs.forEach { mac ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(mac.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Key ${mac.fingerprint.take(16)}…",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            OutlinedButton(onClick = {
                                // Not `trustStore.forget` — that revokes the row and leaves the
                                // session it authorised running. See LinkServer.forgetAndDisconnect.
                                scope.launch { server.forgetAndDisconnect(mac.deviceId) }
                            }) { Text("Forget") }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))

            // 4. Advanced — everything that used to be first.
            TextButton(onClick = { advancedOpen = !advancedOpen }) {
                Text("Advanced")
                Spacer(Modifier.height(0.dp))
                Icon(
                    if (advancedOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = if (advancedOpen) "Hide advanced" else "Show advanced",
                )
            }
            AnimatedVisibility(visible = advancedOpen) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            "Ports ${Link.PORT_CONTROL}, ${Link.PORT_VIDEO}, ${Link.PORT_BULK} · " +
                                "protocol v${Link.PROTOCOL_MAJOR}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        state.lastError?.let {
                            Text(
                                "Last disconnect: $it",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        Text(
                            if (capabilities.isEmpty()) {
                                "Available to the Mac: nothing yet"
                            } else {
                                "Available to the Mac: " + capabilities.sorted().joinToString(", ")
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                        // A capability is only advertised once its handlers exist, so this list is
                        // what the Mac will actually grey out — and saying why beats a blank line.
                        //
                        // The sentence is built in `core/` by `heldBackSummary`, not here. It used
                        // to be assembled inline out of two counts that could not add up to the
                        // list they annotated, and a rule written only inside a @Composable is one
                        // nothing in the build can check — the `showsState` lesson, twice.
                        heldBackSummary(capStatuses)?.let { summary ->
                            Text(
                                summary,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedButton(onClick = { LinkService.start(context) }) {
                                Text(if (state.running) "Restart listening" else "Start listening")
                            }
                        }
                    }
                }
            }
        }
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
