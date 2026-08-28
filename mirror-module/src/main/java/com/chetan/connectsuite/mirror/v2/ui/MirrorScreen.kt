package com.chetan.connectsuite.mirror.v2.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkState
import com.chetan.connectsuite.mirror.v2.MirrorEngine
import com.chetan.connectsuite.mirror.v2.MirrorPhase
import com.chetan.connectsuite.mirror.v2.MirrorStatus

/**
 * The Mirror tab: the phone's own control over mirroring, and the **primary consent path**.
 *
 * Android 16 blocks background activity starts, so a `mirror.start` arriving while the app is
 * backgrounded cannot raise the system capture prompt by itself. The phone tells the Mac to send
 * the user here and posts a notification that lands on this screen; the Start button below is then
 * the tap that supplies the foreground Android insists on. That makes this screen load-bearing
 * rather than decorative, which is why it shows the live phase and the last failure rather than
 * only a button.
 */
/**
 * [extraCards] is drawn under the state card. It exists for the input feature's onboarding card:
 * turning on the accessibility service belongs on this screen, next to the picture it makes
 * clickable, but `mirror-module` must not depend on `input-module` to say so. `:app` is the one
 * place that can see both, so it passes the card in.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MirrorScreen(extraCards: @Composable () -> Unit = {}) {
    val context = LocalContext.current
    val status by MirrorEngine.status.collectAsStateWithLifecycle()
    // get() rather than peek(): the tab can be composed before anything else has touched the
    // link, and a null here would silently disable the Start button forever.
    val link by remember(context) { LinkController.get(context).state }.collectAsStateWithLifecycle()

    Scaffold(topBar = { TopAppBar(title = { Text("Mirror") }) }) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StateCard(status = status, link = link)

            extraCards()

            if (status.phase == MirrorPhase.RUNNING) {
                OutlinedButton(
                    onClick = { MirrorEngine.stopFromPhone(context) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.StopCircle, contentDescription = null)
                    Text("Stop mirroring", modifier = Modifier.padding(start = 8.dp))
                }
            } else {
                Button(
                    onClick = { MirrorEngine.startFromPhone(context) },
                    enabled = link.isConnected,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.Cast, contentDescription = null)
                    Text("Start mirroring", modifier = Modifier.padding(start = 8.dp))
                }
            }

            // A disabled button with no explanation is the silent failure this project keeps
            // ruling out, so the one reason it can be disabled is written next to it.
            if (!link.isConnected && status.phase != MirrorPhase.RUNNING) {
                Text(
                    "No Mac is connected. Connect one on the Mac tab first — mirroring needs " +
                        "somewhere to send the screen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text(
                "Android asks for screen capture permission every time a session starts. That is " +
                    "enforced by the system and cannot be remembered, so this prompt is not a bug.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The live phase, its explanation, and the last failure if the session ended in one. */
@Composable
private fun StateCard(status: MirrorStatus, link: LinkState) {
    val headline = when (status.phase) {
        MirrorPhase.IDLE -> if (link.isConnected) "Ready to mirror" else "Not mirroring"
        MirrorPhase.AWAITING_FOREGROUND -> "${status.peerName ?: "Your Mac"} is waiting for you"
        MirrorPhase.REQUESTING_CONSENT -> "Asking for permission"
        MirrorPhase.STARTING -> "Starting capture"
        MirrorPhase.RUNNING -> "Mirroring to ${status.peerName ?: "your Mac"}"
        MirrorPhase.STOPPED -> "Mirroring stopped"
    }

    // The waiting state is the one the user has been sent here to act on, so it is the one that
    // does not look like every other line on the screen.
    val container = if (status.phase == MirrorPhase.AWAITING_FOREGROUND) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(headline, style = MaterialTheme.typography.titleMedium)

            status.message?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            status.fixHint?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            status.geometry?.let {
                Text(
                    "Capturing ${it.width}x${it.height} at ${it.dpi}dpi.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Kept after the session ends: "it stopped" without "because consent timed out" is
            // exactly the answer this screen exists to stop giving.
            if (status.phase != MirrorPhase.RUNNING && status.lastError != null &&
                status.lastError != status.message
            ) {
                Text(
                    "Last error: ${status.lastError}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
