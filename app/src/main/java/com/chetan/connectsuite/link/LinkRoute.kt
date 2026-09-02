package com.chetan.connectsuite.link

import android.content.Context
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkService
import com.chetan.connectsuite.core.link.LinkWaitStatus
import com.chetan.connectsuite.core.model.DeviceType
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
fun LinkRoute() {
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

    if (scanning) {
        QrScanScreen(
            onScanned = { payload ->
                scope.launch {
                    server.completePairing(payload)
                    LinkService.start(context)
                    lastPaired = payload.name
                    scanning = false
                }
            },
            onCancel = { scanning = false },
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
                                scope.launch { server.trustStore.forget(mac.deviceId) }
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
                        val heldBack = capStatuses.filterNot { it.advertised }
                        if (heldBack.isNotEmpty()) {
                            Text(
                                "Not offered yet: " + heldBack.joinToString(", ") { it.name } +
                                    " — " + heldBack.count { !it.implemented } + " not built, " +
                                    heldBack.count { it.implemented && !it.permitted } +
                                    " awaiting a permission.",
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
