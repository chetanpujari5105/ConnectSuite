package com.chetan.connectsuite.probe

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * A one-purpose probe for §1 of `docs/phase-5-fs-media-proposal.md`, and **debug-only on purpose**:
 * it lives in `src/debug/` so it cannot reach a release build.
 *
 * It exists because the claim it settles cannot be settled by `adb shell am start`. The Android 11
 * restriction on `ACTION_OPEN_DOCUMENT_TREE` is applied by DocumentsUI against the **calling
 * package's** target SDK, and a shell-launched intent has no calling package at all — so the shell
 * probe and the app are two different clients issuing what looks like the same request, which is
 * exactly the shape of defect 50. This activity makes our own package the caller, at our own
 * `targetSdk 36`, which is the only client whose answer is about the product.
 *
 * Nothing here is `fs.*`. It takes no persistable permission it does not immediately report, writes
 * no state, and reads no file — it asks the picker one question and logs the answer.
 *
 * Run: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.SafProbeActivity`
 * Read: `adb logcat -s SafProbe:V`
 */
class SafProbeActivity : ComponentActivity() {

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        report(uri)
        finish()
    }

    /**
     * Optionally **aims** the picker, which is the whole of §8.3's open question.
     *
     * `EXTRA_INITIAL_URI` is unset in the product. Whether it should be depends on what the picker
     * does with it, and that has three possible answers with three different decisions — it opens
     * inside the named folder (aiming is safe), it opens in the folder's **parent** (aiming walks
     * the user into `Download`'s refusal, so it stays unset forever), or it is ignored and the
     * picker restores its own last location (aiming buys nothing).
     *
     * The reading needs the folder to exist, which is why it belongs to push's sitting rather than
     * onboarding's. Pass it as an extra so the probe can be run both ways in one session and the
     * unaimed run is the control:
     *
     * ```
     * adb shell am start -n …/…SafProbeActivity \
     *   --es initial 'content://com.android.externalstorage.documents/document/primary%3ADownload%2FConnectSuite'
     * ```
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initial = intent?.getStringExtra("initial")?.takeIf { it.isNotBlank() }
        Log.i(
            TAG,
            "--- probe run start; targetSdk=${applicationInfo.targetSdkVersion}; " +
                "initialUri=${initial ?: "(unset — the control)"} ---",
        )
        picker.launch(initial?.let { Uri.parse(it) })
    }

    /**
     * Reports the whole outcome, not just the happy half.
     *
     * A null uri means the user backed out **or** the picker refused — those are different answers
     * and the log says which is indistinguishable from here, so the run is only evidence alongside
     * what the picker was showing at the time. The success case is logged at the same volume as the
     * failure case, per the counter rule: "no grant" with nothing beside it reads as whichever story
     * the reader already believes.
     */
    private fun report(uri: Uri?) {
        if (uri == null) {
            Log.w(TAG, "RESULT: no tree granted (cancelled, or the picker refused the selection)")
            return
        }
        Log.i(TAG, "RESULT: granted uri=$uri")
        Log.i(TAG, "RESULT: treeDocumentId=${runCatching { android.provider.DocumentsContract.getTreeDocumentId(uri) }.getOrNull()}")
        val took = runCatching {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        Log.i(TAG, "RESULT: persistable permission taken=${took.isSuccess} ${took.exceptionOrNull()?.message ?: ""}")
        Log.i(
            TAG,
            "RESULT: persisted grants now = " +
                contentResolver.persistedUriPermissions.joinToString { it.uri.toString() },
        )
    }

    private companion object {
        const val TAG = "SafProbe"
    }
}
