package com.chetan.connectsuite.link

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkService
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.protocol.Link
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The phone-side view of the v2 link: whether we are listening, who is connected, which Macs are
 * paired, and the button that starts a pairing scan.
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
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        when {
                            state.isConnected -> "Connected to ${state.clients.joinToString()}"
                            state.running -> "Listening for your Mac"
                            else -> "Not listening"
                        },
                        style = MaterialTheme.typography.titleMedium,
                    )
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
                }
            }

            lastPaired?.let { Text("Paired with $it.") }

            Button(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Scan pairing code on Mac")
            }
            OutlinedButton(
                onClick = { LinkService.start(context) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.running) "Restart listening" else "Start listening")
            }

            Text("Paired Macs", style = MaterialTheme.typography.titleSmall)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(pairedMacs, key = { it.deviceId }) { mac ->
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
                if (pairedMacs.isEmpty()) {
                    item { Text("None yet.", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

/** Called from the activity so permission changes reach connected Macs without a reconnect. */
fun refreshLinkCapabilities(context: Context) = LinkService.refreshCapabilities(context)
