package com.chetan.connectsuite.probe

import android.app.Activity
import android.os.Bundle
import android.util.Log
import com.chetan.connectsuite.core.link.PhoneAddress
import com.chetan.connectsuite.core.link.PhoneAddressRules

/**
 * Prints which address [PhoneAddress] would offer a Mac, and every address it passed over.
 *
 * **Debug-only**, in `src/debug/`, so it cannot reach a release build — the same containment as
 * `ClipProbeActivity` and `DesignPreviewActivity`.
 *
 * ### Why it has to exist
 *
 * The bug it verifies had **no surface on a working phone**. `ConnectMacScreen` draws the address
 * only while `pairedMacs.isEmpty()`, and nothing logs it — `Listening on 42501/42502/42503` names
 * the ports and not the interface. So on the handset where the answer was wrong, there was no way
 * to look at the answer without destroying the pairing to see it. That is the defect's whole
 * survival mechanism, and a fix verified by reasoning alone would inherit it.
 *
 * ### It prints the losers
 *
 * A probe that reported only the winner would say `10.36.14.60` on a phone with one interface and
 * on a phone where the rule had been deleted, identically. The table is the reading; the chosen
 * line is a consequence of it. `CLAUDE.md` — every bound and every alternative the instrument
 * considered must appear in what it reports, or a result shaped by them gets read as a result about
 * the thing measured.
 *
 *     adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.PhoneAddressProbe
 *     adb logcat -d -s PhoneAddressProbe
 */
class PhoneAddressProbe : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val candidates = PhoneAddress.candidates(this)
        val chosen = PhoneAddressRules.choose(candidates)

        Log.i(TAG, "── candidates, in the order NetworkInterface returned them ──")
        if (candidates.isEmpty()) {
            Log.w(TAG, "  (none) — no non-loopback, non-link-local IPv4 on any interface that is up")
        }
        candidates.forEach { candidate ->
            val mark = if (candidate == chosen) "  <== CHOSEN" else ""
            Log.i(TAG, "  %-14s %-16s %s%s".format(
                candidate.interfaceName, candidate.address, candidate.reach, mark,
            ))
        }
        // Success beside failure: the count of what was considered is what gives the verdict scale,
        // and "chose 10.36.14.60" out of one candidate is a different statement from out of three.
        Log.i(
            TAG,
            "localIpv4 = ${PhoneAddress.localIpv4(this)} " +
                "(${candidates.size} candidate(s): " +
                PhoneAddressRules.Reach.entries.joinToString(", ") { reach ->
                    "${candidates.count { it.reach == reach }} ${reach.name.lowercase()}"
                } + ")",
        )
        Log.i(TAG, "controlEndpoint = ${PhoneAddress.controlEndpoint(this)}")
        finish()
    }

    private companion object {
        const val TAG = "PhoneAddressProbe"
    }
}
