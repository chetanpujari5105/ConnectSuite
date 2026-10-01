package com.chetan.connectsuite.probe

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.sync.v2.FsCorruptionProbe

/**
 * **The only writer of [FsCorruptionProbe.arm]** — L1/L2 T4-A, one byte corrupted in transit on one
 * Files block pull. **Debug-only.**
 *
 * Until 2026-10-01 this armed a global "flip byte N of the next pull of any kind" switch, and it was
 * declared in no manifest (`docs/testing.md` → slice 3c records why it was left that way). It is
 * declared again only because it can no longer do that. It names a document id and nothing else; the
 * root (`downloads:connectsuite`), the name, the size and the byte (104,923,136, block 800, XOR `0xFF`)
 * are fixed in [FsCorruptionProbe.T4A]. The arm binds the one live, handshaken session and refuses when
 * there is none or more than one.
 *
 * Fenced like [ShareDevV3Activity]: debug source set only (never merged into a release manifest),
 * exported without an intent filter, gated by `android.permission.DUMP`, refused unless the build is
 * debuggable. It shows nothing and finishes at once.
 *
 * ```
 * # arm (one pull, the session that is live now, expires after ttlSec — default 300, at most 600)
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.FsProbeActivity --es docId 1000308768 --el ttlSec 300
 * # disarm
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.FsProbeActivity --ez disarm true
 * ```
 *
 * Read: `adb logcat -s FsProbe:V`, and `[fs]` / `[bulk]` in `link.log`. Anything other than a well-formed
 * arm — no `docId`, the old `at` extra, `disarm` — leaves the probe disarmed.
 */
class FsProbeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val line = when {
            intent.getBooleanExtra(EXTRA_DISARM, false) -> {
                FsCorruptionProbe.disarm("explicit disarm (FsProbeActivity)")
                "DISARMED"
            }
            intent.hasExtra(EXTRA_LEGACY_AT) -> {
                FsCorruptionProbe.disarm("FsProbeActivity was given the old `at` extra; the offset is fixed now")
                "REFUSED: `at` is not accepted — the byte is fixed at ${FsCorruptionProbe.T4A.AT_BYTE}. Disarmed."
            }
            else -> arm()
        }
        Log.i(TAG, line)
        LinkLog.i("fs", "FsProbeActivity: $line")
        finish()
    }

    private fun arm(): String {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val ttlMs = if (intent.hasExtra(EXTRA_TTL_SEC)) intent.getLongExtra(EXTRA_TTL_SEC, -1L) * 1000 else FsCorruptionProbe.DEFAULT_TTL_MS
        // peek(), never get(): a probe must not create the link server it is asking about.
        val sessions = mutableListOf<FsCorruptionProbe.Session>()
        LinkController.peek()?.broadcast { sessions += FsCorruptionProbe.Session(it.token, it.peerFingerprint) }
        return when (val r = FsCorruptionProbe.arm(debuggable, intent.getStringExtra(EXTRA_DOC_ID), sessions, System.currentTimeMillis(), ttlMs)) {
            is FsCorruptionProbe.ArmResult.Armed ->
                "ARMED (T4-A): ${FsCorruptionProbe.T4A.ROOT_ID}/${r.state.documentId}, byte ${FsCorruptionProbe.T4A.AT_BYTE}, " +
                    "one pull, expires in ${ttlMs / 1000}s"
            is FsCorruptionProbe.ArmResult.Refused -> "REFUSED: ${r.why}. Disarmed."
        }
    }

    companion object {
        const val TAG = "FsProbe"
        const val EXTRA_DOC_ID = "docId"
        const val EXTRA_TTL_SEC = "ttlSec"
        const val EXTRA_DISARM = "disarm"
        /** The global switch's extra. Refused, so an old command line cannot arm anything. */
        const val EXTRA_LEGACY_AT = "at"
    }
}
