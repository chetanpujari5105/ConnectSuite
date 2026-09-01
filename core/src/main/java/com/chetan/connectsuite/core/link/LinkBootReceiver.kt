package com.chetan.connectsuite.core.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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
 * ### The decision is not here
 *
 * Whether to start — is anything paired, is the link already up, what happens when the trust store
 * will not answer — lives in [LinkAutoStart.ensureRunning], because the notification-listener
 * rebind (defect 62) needs the identical decision and a rule written twice is two things to get
 * wrong. This file is the two broadcasts and nothing else.
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
            LinkLog.w("autostart", "Ignoring unexpected action ${intent.action}")
            return
        }
        val pending = goAsync()
        LinkAutoStart.ensureRunning(context, reason, onFinished = pending::finish)
    }
}
