package com.chetan.connectsuite.probe

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.ShareDevGate

/**
 * **The only writer of [ShareDevGate.v3]** — arms (or disarms) `share.file: 3` for the phone's next
 * trusted handshake. Feature A version 3, Stage 1 (`docs/feature-a-multi-offer-proposal.md` §18).
 *
 * The twin of [ShareDevV2Activity], and fenced the same way: debug source set only (never merged into
 * a release manifest), exported without an intent filter, gated by `android.permission.DUMP`, and
 * refused unless the build is debuggable. It shows nothing and finishes at once.
 *
 * ```
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez on true
 * ```
 *
 * The arm lives in memory and is consumed by the next trusted `hello`: a process restart, or any
 * handshake after that one, is back at the version-2 advertisement. `--ez on false` (or no extra)
 * disarms.
 */
class ShareDevV3Activity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val on = intent.getBooleanExtra(EXTRA_ON, false) && debuggable
        if (on) ShareDevGate.v3.arm() else ShareDevGate.v3.disarm()
        val line = if (on) {
            "debug share.file 3 ARMED for the next trusted handshake only (debuggable build: $debuggable) — reconnect the Mac for it to take effect"
        } else {
            "debug share.file 3 disarmed (debuggable build: $debuggable); the phone advertises its normal share.file"
        }
        Log.i(TAG, line)
        LinkLog.i("share", line)
        finish()
    }

    companion object {
        const val TAG = "ShareDevV3"
        const val EXTRA_ON = "on"
    }
}
