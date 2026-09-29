package com.chetan.connectsuite.probe

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.ShareDevGate

/**
 * **The only writer of [ShareDevGate.holdV2]** — holds this debuggable phone at `share.file: 2` for its
 * next trusted handshake, so a **version-2 phone** can be reproduced for a skew test. A debuggable build
 * advertises `share.file: 3` by default (`Extensions.multiFile`); this can only lower that, never raise it.
 *
 * Fenced like [ShareDevV2Activity]: debug source set only (never merged into a release manifest),
 * exported without an intent filter, gated by `android.permission.DUMP`, and refused unless the build is
 * debuggable. It shows nothing and finishes at once.
 *
 * ```
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez hold true
 * ```
 *
 * The hold lives in memory and is consumed by the next trusted `hello`: a process restart, or any
 * handshake after that one, is back at version 3. `--ez hold false` (or no extra) clears it.
 */
class ShareDevV3Activity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val hold = intent.getBooleanExtra(EXTRA_HOLD, false) && debuggable
        if (hold) ShareDevGate.holdV2.arm() else ShareDevGate.holdV2.disarm()
        val line = if (hold) {
            "debug share.file HELD AT 2 for the next trusted handshake only (debuggable build: $debuggable) — reconnect the Mac for it to take effect"
        } else {
            "debug share.file hold cleared (debuggable build: $debuggable); the phone advertises its normal share.file"
        }
        Log.i(TAG, line)
        LinkLog.i("share", line)
        finish()
    }

    companion object {
        const val TAG = "ShareDevV3"
        const val EXTRA_HOLD = "hold"
    }
}
