package com.chetan.connectsuite.probe

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import com.chetan.connectsuite.sync.v2.BulkTransfers

/**
 * Arms the one-byte corruption hook on the next outgoing bulk transfer. **Debug-only.**
 *
 * It lives in `app/src/debug/`, which AGP merges into debug variants only — the same arrangement as
 * `SafProbeActivity`, `DownloadsProbeActivity` and `MediaProbeActivity`, and checked the same way:
 * the activity must appear in all three debug merged manifests and **zero** times in the release
 * ones. The count is expected to move as probes come and go; what must not move is the zero.
 *
 * ### What it is for
 *
 * The `CHECKSUM_MISMATCH` branch has never run in this project. `media.original` acks
 * `sha256: null`, so nothing was ever compared, so neither end's mismatch path could be reached —
 * the `.failed` sidecar's *text* is unit-tested on the Mac and the code that writes it has never
 * once executed. `fs.transfer.begin` pre-hashes, which makes the comparison real; this makes it
 * fail on purpose.
 *
 * The byte is flipped **after** the sender's digest has taken the true value, because that is what a
 * corrupt link does: the sender's digest stays right, the receiver's goes wrong, and the
 * disagreement is the finding. Flipping before the digest would make both ends agree on corrupt
 * bytes and prove nothing.
 *
 * Arm: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.FsProbeActivity --el at 4096`
 * Disarm: the same with `--el at -1`, and it disarms itself after one flip.
 * Read: `adb logcat -s FsProbe:V`, and the flip itself writes an `E` to `link.log`.
 */
class FsProbeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val at = intent.getLongExtra("at", -1L)
        if (at < 0) {
            BulkTransfers.debugCorruptAtByte = null
            Log.i(TAG, "DISARMED: no byte will be corrupted")
        } else {
            BulkTransfers.debugCorruptAtByte = at
            Log.w(
                TAG,
                "ARMED: the next bulk transfer covering byte $at will have that byte flipped after " +
                    "the sender's digest has taken the true value. It disarms itself after one flip.",
            )
        }
        finish()
    }

    private companion object {
        const val TAG = "FsProbe"
    }
}
