package com.chetan.connectsuite.mirror.v2

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels

/**
 * The "your Mac is waiting" notification, and the deep link that gets the user to the Mirror tab.
 *
 * This is the second half of the Android 16 consent route. The Mac is told to ask the user to open
 * the app; this is what makes that one tap instead of a hunt through the launcher. It is a
 * convenience, not the mechanism: the Mac is told either way, so a phone with notifications turned
 * off still gets a Mac that says exactly what to do rather than a blank canvas.
 */
object MirrorNotifications {

    private const val REQUEST_ID = 3002

    /**
     * Extra on the launcher Intent asking the app to open a specific tab.
     *
     * A string extra on the plain launch Intent rather than a navigation deep link because
     * :mirror-module cannot see the app's Activity or its nav graph, and the launch Intent is the
     * one thing every module can build.
     */
    const val EXTRA_OPEN_TAB = "com.chetan.connectsuite.OPEN_TAB"
    const val TAB_MIRROR = "mirror"

    /** Posts the prompt. Safe to call repeatedly; it replaces rather than stacks. */
    fun askUserToStart(context: Context, peerName: String) {
        val manager = context.getSystemService<NotificationManager>() ?: return
        if (!canPost(context)) {
            // Not fatal, and not silent: the Mac has already been told the same thing.
            LinkLog.w(
                "mirror",
                "Notifications are not permitted, so the phone cannot prompt for mirroring; " +
                    "the Mac has the instruction instead",
            )
            return
        }

        val notification = Notification.Builder(context, NotificationChannels.MIRROR_REQUEST)
            .setContentTitle("$peerName wants to mirror your screen")
            .setContentText("Tap to open ConnectSuite and start mirroring.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openMirrorTab(context))
            .build()

        runCatching { manager.notify(REQUEST_ID, notification) }
            .onFailure { LinkLog.w("mirror", "Could not post the mirroring prompt", it) }
    }

    /** Once the request is answered — however it ends — the prompt is stale. */
    fun clear(context: Context) {
        context.getSystemService<NotificationManager>()?.cancel(REQUEST_ID)
    }

    /**
     * A PendingIntent onto the app's own launcher Activity, carrying the tab to open.
     *
     * Tapping a notification is a user gesture, so the Activity start it performs is exempt from
     * the background-activity block that stops [MirrorConsentActivity] being launched directly.
     * That is the whole point: the user's tap supplies the foreground the app cannot give itself.
     */
    private fun openMirrorTab(context: Context): PendingIntent? {
        val launch = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.putExtra(EXTRA_OPEN_TAB, TAB_MIRROR)
            ?.addFlags(
                // SINGLE_TOP|CLEAR_TOP so a running app gets this through onNewIntent rather than
                // just being brought forward with the extra thrown away.
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
            ?: return null
        return PendingIntent.getActivity(
            context,
            REQUEST_ID,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun canPost(context: Context): Boolean =
        android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
}
