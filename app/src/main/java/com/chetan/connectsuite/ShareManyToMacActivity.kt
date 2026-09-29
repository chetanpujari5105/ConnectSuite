package com.chetan.connectsuite

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.sync.v2.ShareIntake

/**
 * **Send several files to the Mac, from one Gallery or My Files multi-select.**
 * docs/feature-a-multi-offer-proposal.md rev 4 §3, §11–§15; docs/protocol.md → Share → Version 3.
 *
 * In the main source set. Whether a build lists it in the share sheet is one release-policy decision:
 * the manifest entry's `android:enabled="@bool/share_many_enabled"` (true in debuggable builds; in main,
 * equal to `Extensions.MULTI_FILE_RELEASE`, which is off until the owner approves), and
 * [ShareManyToMacModel.bind] refuses when `Extensions.multiFile` is false. Several files also need a
 * session that negotiated `share.file` 3, which the same rule advertises; a version-2 Mac negotiates 2,
 * and the screen then says to update the Mac. `ShareManyManifestTest` pins the manifest half.
 *
 * - **One file** is the single-file sheet, unchanged, bound in this activity (§15).
 * - **Several:** the review list, then **Send N files**; each file is its own offer with its own Accept
 *   and Decline on the Mac. There is no Accept all.
 *
 * ### Leaving the screen — a fail-closed placeholder, **not** a decision on lifecycle option A (§20.4)
 *
 * `onStop` without a configuration change ends every file not yet offered and finishes — **including
 * when the activity is already finishing** (Back), since `onCleared` can trail `onStop` and the queue
 * would otherwise go on opening URIs in between. That is the one behaviour under which the rule *"a
 * shared URI is read only while the screen is alive"* (§11) cannot be broken. Option A's keep-the-display-on while preparing is
 * **not** built. Offered files are never withdrawn by leaving.
 */
class ShareManyToMacActivity : ComponentActivity() {

    private lateinit var model: ShareManyToMacModel
    private var single: ShareToMacModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this)[ShareManyToMacModel::class.java]
        if (!model.bound) model.bind(intent)
        (model.screen.value as? ShareManyToMacModel.Screen.Single)?.let { s ->
            single = ViewModelProvider(this)[ShareToMacModel::class.java].also { m -> if (!m.bound) m.bind(s.intent) else m.onRecreated() }
        }

        setContent {
            ConnectSuiteTheme {
                val single = single
                if (single != null) {
                    val state by single.state.collectAsStateWithLifecycle()
                    ShareSheet(
                        state = state,
                        onSend = { single.send() },
                        onTryAgain = { single.tryAgain() },
                        onWithdrawOther = { single.withdrawOther()?.let { Toast.makeText(this, ShareToMacCopy.withdrewOther(it), Toast.LENGTH_LONG).show() } },
                        onWithdraw = { single.withdraw(); Toast.makeText(this, ShareToMacCopy.WITHDRAWN, Toast.LENGTH_SHORT).show() },
                        onCancel = { single.discard("cancelled"); finish() },
                        onClose = { single.discard("closed"); finish() },
                    )
                } else {
                    val screen by model.screen.collectAsStateWithLifecycle()
                    Many(screen, onSend = { model.send() }, onCancelRow = { model.withdraw(it) }, onClose = { model.screenClosed(); finish() })
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        val single = single
        when (ShareManyLeave.onStop(isChangingConfigurations, isFinishing, singleFile = single != null)) {
            ShareManyLeave.Action.STAY -> Unit
            // Several files: end the selection here even when finishing (Back). Unlike the single sheet,
            // which opens its one URI once, the queue keeps opening URIs until it is ended — and a finishing
            // activity's onDestroy (hence onCleared) can come well after onStop. Idempotent after Close.
            ShareManyLeave.Action.END_SELECTION -> model.screenClosed()
            ShareManyLeave.Action.END_SELECTION_AND_FINISH -> {
                model.screenClosed()
                finish()
            }
            // One file: exactly the single-file sheet's rule (ShareToMacActivity.onStop).
            ShareManyLeave.Action.SINGLE_FILE_RULE -> {
                if (isFinishing || single == null) return
                if (onLeave(single.state.value) == SheetExit.DISCARD_STAGED) single.discard("left the screen")
                finish()
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun Many(screen: ShareManyToMacModel.Screen, onSend: () -> Unit, onCancelRow: (Int) -> Unit, onClose: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 48.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(ShareToMacCopy.TITLE, style = MaterialTheme.typography.headlineSmall)
            when (screen) {
                ShareManyToMacModel.Screen.Starting, is ShareManyToMacModel.Screen.Single -> Unit
                is ShareManyToMacModel.Screen.Refused ->
                    Text(ShareManyCopy.refusal(screen.reason, screen.count, screen.index, screen.mac, screen.sameAs), style = MaterialTheme.typography.bodyMedium)
                is ShareManyToMacModel.Screen.Review -> {
                    Text(ShareManyCopy.reviewTotal(screen.sizes), style = MaterialTheme.typography.titleMedium)
                    LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemsIndexed(screen.names) { i, name ->
                            Text("$name · ${screen.sizes[i]?.let(ShareToMacCopy::bytes) ?: ShareManyCopy.SIZE_NOT_REPORTED}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Text(ShareToMacCopy.availability(screen.availability), style = MaterialTheme.typography.bodyMedium)
                    screen.notSent?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
                }
                is ShareManyToMacModel.Screen.Running -> {
                    Text(
                        ShareManyCopy.summary(screen.rows, screen.mac), style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        itemsIndexed(screen.rows) { i, row ->
                            Column {
                                Text(row.name, style = MaterialTheme.typography.bodySmall)
                                Text(ShareManyCopy.label(row, screen.mac), style = MaterialTheme.typography.titleSmall)
                                ShareManyCopy.detail(row, screen.mac).takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                                // §7: this file's own Cancel, for its offer only; the single-file sheet's label.
                                if (ShareManyCopy.canCancel(row)) {
                                    val name = ShareManyCopy.cancelRowName(row.name)
                                    OutlinedButton(onClick = { onCancelRow(i) }, modifier = Modifier.semantics { contentDescription = name }) {
                                        Text(ShareManyCopy.CANCEL_ROW_BUTTON)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onClose) { Text(ShareToMacCopy.CLOSE_BUTTON) }
                if (screen is ShareManyToMacModel.Screen.Review) {
                    Button(onClick = onSend, enabled = screen.availability is ShareIntake.Availability.Available) {
                        Text(ShareManyCopy.sendButton(screen.names.size))
                    }
                }
            }
        }
    }
}
