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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.sync.v2.ShareIntake

/**
 * **Send to Mac** for one file from any app's share sheet — slice 1 of `docs/phase-7-share-plan.md`.
 *
 * The file is copied privately while this activity holds the share grant. **Send is enabled only
 * against a Mac that negotiated `share.file` 2 and `share.ask`** — one that promised to ask a person —
 * and no Mac build makes that promise yet, so in every live pairing Send is shown disabled with the
 * reason. After an offer the sheet follows it to its end: waiting, sending, and *Saved* only on the
 * Mac's verified verdict (`ShareToMacModel`, `reduce`).
 *
 * Plain-text shares never reach this activity: its filter claims no `text` type at all, and
 * `SendSelectionActivity` keeps `SEND text/plain` → `clip.push` exactly as before
 * (`ShareManifestTest`).
 *
 * ### Leaving the screen ([onLeave])
 *
 * Home, another app, or the screen switching off (`onStop` without a configuration change) cancels
 * a copy and deletes a prepared one **that has not been offered** — this activity is excluded from
 * Recents, so a copy kept after leaving could never be reached again. **An offered one is not
 * touched**: `ShareFeature` owns it and deletes it at the offer's own end, and the offer is not
 * withdrawn — a person walking to the Mac to press Accept will often let the phone's screen switch
 * off first. A rotation is not leaving: the model holds everything across it.
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
                    onSend = { model.send() },
                    onWithdrawOther = {
                        model.withdrawOther()?.let { Toast.makeText(this, ShareToMacCopy.withdrewOther(it), Toast.LENGTH_LONG).show() }
                    },
                    onWithdraw = {
                        model.withdraw()
                        Toast.makeText(this, ShareToMacCopy.WITHDRAWN, Toast.LENGTH_SHORT).show()
                    },
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
            val state = model.state.value
            // After an offer, discard() deletes nothing (the model gave the copy away), so calling it
            // is harmless; the toast is what must not claim a discard that did not happen.
            if (onLeave(state) == SheetExit.DISCARD_STAGED) {
                val hadWork = state is ShareSheetState.Preparing || state is ShareSheetState.Ready
                model.discard("left the screen")
                if (hadWork) Toast.makeText(applicationContext, ShareToMacCopy.DISCARDED, Toast.LENGTH_SHORT).show()
            }
            finish()
        }
    }
}

@Composable
private fun ShareSheet(
    state: ShareSheetState,
    onSend: () -> Unit,
    onWithdrawOther: () -> Unit,
    onWithdraw: () -> Unit,
    onCancel: () -> Unit,
    onClose: () -> Unit,
) {
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
            if (state is ShareSheetState.Sending) {
                // No byte count on the phone side: the sheet does not claim a progress it cannot read.
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            if (state is ShareSheetState.Ready) {
                Text(ShareToMacCopy.availability(state.availability), style = MaterialTheme.typography.bodyMedium)
                when (val n = state.notOffered) {
                    null -> Unit
                    // Busy is a state of its own, not a footnote: the headline above already changed, and
                    // this says which file is in the way and what happened to both. Announced politely.
                    ShareSheetState.NotOffered.MAC_BUSY -> Text(
                        ShareToMacCopy.busy(state.waitingOther),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    else -> Text(ShareToMacCopy.notOffered(n), style = MaterialTheme.typography.bodyMedium)
                }
            }
            when (onLeave(state)) {
                SheetExit.DISCARD_STAGED -> if (state !is ShareSheetState.Starting) Text(ShareToMacCopy.LEAVING, style = MaterialTheme.typography.bodySmall)
                SheetExit.LEAVE_TO_OFFER -> offeredMac(state)?.let { Text(ShareToMacCopy.leavingOffered(it), style = MaterialTheme.typography.bodySmall) }
                SheetExit.NOTHING -> Unit
            }

            Spacer(Modifier.height(8.dp))
            // Its own line: an explicit, separate tap that ends the *other* file's offer, never this one's.
            if (canWithdrawOther(state)) {
                OutlinedButton(onClick = onWithdrawOther) { Text(ShareToMacCopy.WITHDRAW_OTHER_BUTTON) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    state is ShareSheetState.Preparing || state is ShareSheetState.Starting ->
                        OutlinedButton(onClick = onCancel) { Text(ShareToMacCopy.CANCEL_BUTTON) }
                    canWithdraw(state) -> OutlinedButton(onClick = onWithdraw) { Text(ShareToMacCopy.CANCEL_BUTTON) }
                    else -> OutlinedButton(onClick = onClose) { Text(ShareToMacCopy.CLOSE_BUTTON) }
                }
                if (state is ShareSheetState.Ready) {
                    // Enabled only when a tap can make an offer (canSend): a Mac that negotiated share.file 2
                    // and share.ask, and no other file in the way. The reason is directly above it otherwise.
                    Button(onClick = onSend, enabled = canSend(state)) {
                        Text(ShareToMacCopy.SEND_BUTTON)
                    }
                }
            }
        }
    }
}

private fun fileLine(state: ShareSheetState): String? = when (state) {
    is ShareSheetState.Preparing -> state.name
    is ShareSheetState.Ready -> "${state.name} · ${state.mime}"
    is ShareSheetState.Failed -> state.name
    is ShareSheetState.WaitingForMac -> state.name
    is ShareSheetState.Sending -> state.name
    is ShareSheetState.Saved -> state.name
    is ShareSheetState.Unconfirmed -> state.name
    is ShareSheetState.SendFailed -> state.name
    is ShareSheetState.Stopped -> state.name
    else -> null
}

private fun offeredMac(state: ShareSheetState): String? = when (state) {
    is ShareSheetState.WaitingForMac -> state.mac
    is ShareSheetState.Sending -> state.mac
    is ShareSheetState.SendFailed -> state.mac
    else -> null
}
