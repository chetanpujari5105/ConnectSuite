package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService

/**
 * Whether a notification this app posts can actually reach the person holding the phone.
 *
 * ### One home, because there were two and they disagreed
 *
 * `AppsNotifications.canPost` asked **two** questions and its comment said why. `ClipNotifications`
 * asked **one** — the runtime grant only — and was therefore willing to call a notification
 * deliverable to a shade that will drop it. Same rule, two expressions, and the weaker copy sat on
 * the path that writes somebody's clipboard.
 *
 * `CLAUDE.md`'s rule is about tests restating the thing they check; this is the production form of
 * it, and it fails the same way: the two drift, and the one that drifts is the one nobody was
 * looking at.
 *
 * ### The two questions
 *
 * - **`POST_NOTIFICATIONS`** is the runtime grant, and on API 33+ the owner can revoke it at any
 *   moment, including while this process is running.
 * - **`areNotificationsEnabled`** is the switch in Settings, which a person can turn off without
 *   ever seeing a permission dialog — on this OEM it is one long-press away from any notification.
 *
 * Either one false means nothing is delivered. A check reading only the first is a check that does
 * not gate the action, one layer down.
 */
object NotificationDelivery {

    fun canPost(context: Context): Boolean {
        val app = context.applicationContext
        val granted = ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val enabled = app.getSystemService<NotificationManager>()?.areNotificationsEnabled() ?: false
        return granted && enabled
    }

    /**
     * Why a notification could not be delivered, for a message a person on the other end reads.
     *
     * Returns null when it can. The two causes get **different sentences** because they have
     * different fixes, and "notifications are off" over a revoked runtime grant sends somebody to
     * the wrong screen.
     */
    fun reasonCannotPost(context: Context): String? {
        val app = context.applicationContext
        val granted = ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            return "the phone has not been given permission to show notifications, " +
                "so it cannot tell its owner what arrived"
        }
        val enabled = app.getSystemService<NotificationManager>()?.areNotificationsEnabled() ?: false
        if (!enabled) {
            return "notifications for ConnectSuite are switched off on the phone, " +
                "so it cannot tell its owner what arrived"
        }
        return null
    }
}
