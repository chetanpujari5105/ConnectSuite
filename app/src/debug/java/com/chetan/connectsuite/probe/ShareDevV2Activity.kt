package com.chetan.connectsuite.probe

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.ShareDevGate

/**
 * **The only writer of [ShareDevGate]** — arms (or disarms) `share.file: 2` for the phone's next
 * trusted handshake. Feature A slice 3e, `docs/phase-7-share-3e-runbook.md` §1.
 *
 * Debug source set only (never merged into a release manifest), exported without an intent filter,
 * and gated by `android.permission.DUMP` — held by the shell user `adb shell am start` runs as and by
 * no ordinary installed app. It shows nothing and finishes at once.
 *
 * ```
 * scripts/adb-pinned.sh samsung shell am start -n \
 *   com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV2Activity --ez on true
 * ```
 *
 * The arm lives in memory and is consumed by the next trusted `hello`: a restart, or any handshake
 * after that one, is back at `share.file: 1`. `--ez on false` (or no extra) disarms.
 */
class ShareDevV2Activity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val on = intent.getBooleanExtra(EXTRA_ON, false) && debuggable
        if (on) ShareDevGate.process.arm() else ShareDevGate.process.disarm()
        val line = if (on) {
            "debug share.file 2 ARMED for the next trusted handshake only (debuggable build: $debuggable) — reconnect the Mac for it to take effect"
        } else {
            "debug share.file 2 disarmed (debuggable build: $debuggable); the phone advertises share.file 1"
        }
        Log.i(TAG, line)
        LinkLog.i("share", line)
        finish()
    }

    companion object {
        const val TAG = "ShareDevV2"
        const val EXTRA_ON = "on"
    }
}
