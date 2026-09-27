package com.chetan.connectsuite.probe

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
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chetan.connectsuite.ShareManyCopy
import com.chetan.connectsuite.ShareSheet
import com.chetan.connectsuite.ShareToMacCopy
import com.chetan.connectsuite.ShareToMacModel
import com.chetan.connectsuite.SheetExit
import com.chetan.connectsuite.core.ui.ConnectSuiteTheme
import com.chetan.connectsuite.onLeave
import com.chetan.connectsuite.sync.v2.ShareIntake

/**
 * **Stage 2 — Send several files to the Mac, from a Gallery or My Files multi-select. DEVELOPMENT ONLY.**
 * docs/feature-a-multi-offer-proposal.md rev 4 §3, §11–§15.
 *
 * Fenced three ways: it is in the **debug source set only** (a release build does not contain it); its
 * manifest entry is **`android:enabled="false"`**, so even a debug install does not list it in any share
 * sheet until someone enables the component by hand; and [ShareManyToMacModel.bind] refuses outside a
 * debuggable build. Several files also need a session that negotiated `share.file` 3, which only the
 * debug version-3 arms advertise. `ShareManyManifestTest` pins the first two.
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
                    Many(screen, onSend = { model.send() }, onClose = { model.screenClosed(); finish() })
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        if (isChangingConfigurations) return
        val single = single
        if (single == null) {
            // Several files: end the selection here even when finishing (Back). Unlike the single sheet,
            // which opens its one URI once, the queue keeps opening URIs until it is ended — and a finishing
            // activity's onDestroy (hence onCleared) can come well after onStop. Idempotent after Close.
            model.screenClosed()
            if (!isFinishing) finish()
            return
        }
        // One file: exactly the single-file sheet's rule (ShareToMacActivity.onStop).
        if (isFinishing) return
        if (onLeave(single.state.value) == SheetExit.DISCARD_STAGED) single.discard("left the screen")
        finish()
    }
}

@androidx.compose.runtime.Composable
private fun Many(screen: ShareManyToMacModel.Screen, onSend: () -> Unit, onClose: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 48.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(ShareToMacCopy.TITLE, style = MaterialTheme.typography.headlineSmall)
            when (screen) {
                ShareManyToMacModel.Screen.Starting, is ShareManyToMacModel.Screen.Single -> Unit
                is ShareManyToMacModel.Screen.Refused ->
                    Text(ShareManyCopy.refusal(screen.reason, screen.count, screen.index, screen.mac), style = MaterialTheme.typography.bodyMedium)
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
                        itemsIndexed(screen.rows) { _, row ->
                            Column {
                                Text(row.name, style = MaterialTheme.typography.bodySmall)
                                Text(ShareManyCopy.label(row, screen.mac), style = MaterialTheme.typography.titleSmall)
                                ShareManyCopy.detail(row, screen.mac).takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
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
