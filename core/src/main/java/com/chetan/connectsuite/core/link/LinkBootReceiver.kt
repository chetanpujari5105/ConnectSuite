package com.chetan.connectsuite.core.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Brings the link back after the two events that silently take it away.
 *
 * ### What was actually broken
 *
 * `RECEIVE_BOOT_COMPLETED` has been declared in `app/src/main/AndroidManifest.xml` since Phase 1
 * and **nothing received it**. The control for that claim is an enumeration rather than a grep for
 * an absence: before this file there were exactly two `<receiver>` elements in the whole project,
 * both in `sync-module` (`ClipApplyReceiver`, `SmsMirrorReceiver`), and neither carried a
 * `BOOT_COMPLETED` filter. So a phone that rebooted overnight came back with every permission
 * granted, every secure-settings binding intact — and no listening socket, until somebody opened
 * the app by hand.
 *
 * `MY_PACKAGE_REPLACED` is the same hole reached by a second route, and `CLAUDE.md` already
 * documents that route without naming this as its fix: `adb install -r` preserves all eleven
 * runtime grants and both secure-settings bindings, and leaves the app *serverless*, because the
 * process comes back through the notification-listener rebind with no port bound. Handling it here
 * closes both with one receiver.
 *
 * ### Why the paired-device check is here rather than in the service
 *
 * A foreground service means a permanent notification. Posting one on a phone that has never been
 * paired with anything is a notification about nothing, and the user did not ask for it — they
 * installed an app and never finished setting it up. So the receiver reads the trust store first
 * and starts nothing when it is empty.
 *
 * It **fails open**: a trust-store read that throws or takes longer than [TRUST_READ_TIMEOUT_MS]
 * starts the service anyway. An error is not evidence of an unpaired phone, and the cost of the
 * two mistakes is not symmetric — a spurious notification is a nuisance, a link that does not come
 * back is the defect this file exists for.
 *
 * ### What this does not fix, and it should be said out loud
 *
 * On a device with file-based encryption and a secure lock screen — which is this one —
 * `ACTION_BOOT_COMPLETED` is not delivered at boot. It is delivered after the **first unlock**,
 * because everything this app owns (the Room trust store, the credential-encrypted identity) lives
 * behind that unlock. So the honest sentence is *"the link returns when you first unlock the phone
 * after a restart"*, not *"the link survives a restart"*. Making it literally survive a restart
 * would mean a direct-boot-aware receiver over device-encrypted storage, which would need the
 * trust store moved out from behind the lock screen. That is a security trade this phase is not
 * making.
 *
 * An app in the **stopped** state receives neither broadcast at all — a force-stop, or an install
 * that has never been launched. That is Android's rule and not something to design around; it is
 * also the reason `scripts/hooks/no-force-stop.sh` exists.
 */
class LinkBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val reason = LinkAutoStart.reasonFor(intent.action) ?: run {
            LinkLog.w("boot", "Ignoring unexpected action ${intent.action}")
            return
        }

        val appContext = context.applicationContext
        LinkLog.init(appContext)

        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val paired = withTimeoutOrNull(TRUST_READ_TIMEOUT_MS) {
                    TrustStore(appContext).let { store ->
                        store.reload()
                        store.trustedCount()
                    }
                }
                when {
                    paired == null -> {
                        // Fails open, and says which of the two branches it took, because
                        // "started after boot" with no denominator cannot be told from
                        // "started after boot despite knowing nothing".
                        LinkLog.w(
                            "boot",
                            "$reason: trust store did not answer in ${TRUST_READ_TIMEOUT_MS}ms — " +
                                "starting anyway (fail-open)",
                        )
                        start(appContext, reason)
                    }
                    paired == 0 -> LinkLog.i(
                        "boot",
                        "$reason: 0 paired device(s) — not starting; " +
                            "nothing would connect and the notification would be about nothing",
                    )
                    else -> {
                        LinkLog.i("boot", "$reason: $paired paired device(s) — starting LinkService")
                        start(appContext, reason)
                    }
                }
            } catch (e: Exception) {
                LinkLog.w("boot", "$reason: trust store read failed — starting anyway", e)
                start(appContext, reason)
            } finally {
                pending.finish()
            }
        }
    }

    private fun start(context: Context, reason: LinkStartReason) {
        runCatching { LinkService.start(context, reason) }
            .onFailure {
                // Android 12+ can refuse a background foreground-service start outright. On this
                // handset it will not, because the app is battery-optimisation exempt — which is
                // exactly why the refusal has to be logged rather than assumed impossible: the
                // device that proves this code is not the device that will break it.
                LinkLog.e("boot", "$reason: LinkService.start was refused", it)
            }
    }

    private companion object {
        const val TRUST_READ_TIMEOUT_MS = 3_000L
    }
}
