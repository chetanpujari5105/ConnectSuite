package com.chetan.connectsuite

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme

/**
 * **Send to Mac** for one file from any app's share sheet — slice 1 of `docs/phase-7-share-plan.md`.
 *
 * In this slice it **only prepares**: the file is copied privately while this activity holds the
 * share grant, and the sheet says plainly that nothing was sent. There is no offer, no socket and no
 * Mac message. Send is shown disabled with the reason, because a Send button that did something
 * would be a lie until slice 2.
 *
 * Plain-text shares never reach this activity: its filter claims no `text` type at all, and
 * `SendSelectionActivity` keeps `SEND text/plain` → `clip.push` exactly as before
 * (`ShareManifestTest`).
 *
 * ### Leaving the screen discards
 *
 * Home, another app, or the screen switching off (`onStop` without a configuration change) cancels
 * a copy and deletes a prepared one. In slice 1 nothing can happen to a prepared copy, and this
 * activity is excluded from Recents, so a copy kept after leaving could never be reached again.
 * A rotation is not leaving: the copy is held by [ShareToMacModel] across it.
 */
class ShareToMacActivity : ComponentActivity() {

    private lateinit var model: ShareToMacModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this)[ShareToMacModel::class.java]
        if (!model.bound) model.bind(intent) else model.onRecreated()

        setContent {
            ConnectSuiteTheme {
                val state by model.state.collectAsStateWithLifecycle()
                ShareSheet(
                    state = state,
                    onCancel = {
                        model.discard("cancelled")
                        Toast.makeText(this, ShareToMacCopy.CANCELLED, Toast.LENGTH_SHORT).show()
                        finish()
                    },
                    onClose = {
                        model.discard("closed")
                        finish()
                    },
                )
            }
        }
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) {
            val hadWork = model.state.value is ShareSheetState.Preparing || model.state.value is ShareSheetState.Ready
            model.discard("left the screen")
            if (hadWork) Toast.makeText(applicationContext, ShareToMacCopy.DISCARDED, Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}

@Composable
private fun ShareSheet(state: ShareSheetState, onCancel: () -> Unit, onClose: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 48.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(ShareToMacCopy.TITLE, style = MaterialTheme.typography.headlineSmall)
            fileLine(state)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(8.dp))
            Text(ShareToMacCopy.headline(state), style = MaterialTheme.typography.titleMedium)
            ShareToMacCopy.detail(state).takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }

            if (state is ShareSheetState.Preparing) {
                val expected = state.expected
                if (expected != null && expected > 0) {
                    LinearProgressIndicator(
                        progress = { (state.copied.toFloat() / expected).coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
            if (state is ShareSheetState.Ready) {
                Text(ShareToMacCopy.availability(state.availability), style = MaterialTheme.typography.bodyMedium)
            }
            if (state is ShareSheetState.Preparing || state is ShareSheetState.Ready) {
                Text(ShareToMacCopy.LEAVING, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (state is ShareSheetState.Preparing || state is ShareSheetState.Starting) {
                    OutlinedButton(onClick = onCancel) { Text(ShareToMacCopy.CANCEL_BUTTON) }
                } else {
                    OutlinedButton(onClick = onClose) { Text(ShareToMacCopy.CLOSE_BUTTON) }
                }
                if (state is ShareSheetState.Ready) {
                    // Disabled in slice 1, with the reason directly above it. Slice 2 gives it an offer.
                    Button(onClick = {}, enabled = false) { Text(ShareToMacCopy.SEND_BUTTON) }
                }
            }
        }
    }
}

private fun fileLine(state: ShareSheetState): String? = when (state) {
    is ShareSheetState.Preparing -> state.name
    is ShareSheetState.Ready -> "${state.name} · ${state.mime}"
    is ShareSheetState.Failed -> state.name
    else -> null
}
