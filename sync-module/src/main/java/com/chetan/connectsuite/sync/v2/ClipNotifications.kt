package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels

/**
 * The phone's offer surface: *the Mac copied this — tap to put it on your clipboard.*
 *
 * **The offer exists because of a design decision, not a platform limit.** Writing the clipboard
 * from the background is permitted on this device (`docs/testing.md` → Slice 11, reading 5), so
 * ConnectSuite could simply apply what arrives. It does not: a clipboard is a single-slot store
 * with no undo, and silently replacing what somebody was about to paste — on a device they are not
 * looking at — is the one failure this feature could cause that they cannot walk back.
 *
 * So the entry is held and this notification offers it. One tap applies it.
 *
 * The preview is truncated for the notification and **the full text never leaves memory**: the
 * action carries it in the PendingIntent extra rather than through any store, and nothing here is
 * logged.
 */
object ClipNotifications {

    private const val NOTIFICATION_ID = 3101
    private const val REQUEST_ID = 3102
    private const val PREVIEW_CHARS = 120

    const val ACTION_APPLY = "com.chetan.connectsuite.CLIP_APPLY"
    const val EXTRA_TEXT = "com.chetan.connectsuite.CLIP_TEXT"

    fun offer(context: Context, text: String) {
        val app = context.applicationContext
        val manager = app.getSystemService<NotificationManager>() ?: return
        if (!canPost(app)) {
            // Not fatal and not silent. The entry is in the history either way; what is lost is the
            // one-tap route to it, and saying so beats a person wondering why nothing happened.
            LinkLog.w(
                "clip",
                "Notifications are not permitted, so the arriving clipboard entry could not be " +
                    "offered; it is in the history and can be applied from the app",
            )
            return
        }

        val preview = text.take(PREVIEW_CHARS).replace('\n', ' ')
        val apply = PendingIntent.getBroadcast(
            app,
            REQUEST_ID,
            Intent(app, ClipApplyReceiver::class.java)
                .setAction(ACTION_APPLY)
                .putExtra(EXTRA_TEXT, text),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = Notification.Builder(app, NotificationChannels.CLIPBOARD)
            .setContentTitle("Copied on your Mac")
            .setContentText(preview)
            .setStyle(Notification.BigTextStyle().bigText(preview))
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)
            .addAction(
                Notification.Action.Builder(null, "Copy to this phone", apply).build(),
            )
            .build()

        runCatching { manager.notify(NOTIFICATION_ID, notification) }
            .onFailure { LinkLog.w("clip", "Could not post the clipboard offer", it) }
    }

    fun dismiss(context: Context) {
        context.applicationContext.getSystemService<NotificationManager>()?.cancel(NOTIFICATION_ID)
    }

    private fun canPost(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
}

/**
 * The tap that applies an offered entry.
 *
 * Registered `exported="false"`: the extra carries the user's clipboard text, and an exported
 * receiver taking arbitrary text from any app on the device would be a way to write somebody's
 * clipboard from outside. The only sender is our own immutable PendingIntent.
 */
class ClipApplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ClipNotifications.ACTION_APPLY) return
        val text = intent.getStringExtra(ClipNotifications.EXTRA_TEXT) ?: return
        ClipFeature.apply(context.applicationContext, text)
        ClipNotifications.dismiss(context)
    }
}
