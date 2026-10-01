package com.chetan.connectsuite.camera

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
 * "Your Mac wants to see this phone's camera" — the route to the request screen when Sidekick is not
 * on screen. **Tapping it opens the request screen, never the camera.**
 *
 * Shaped like `MirrorNotifications.askUserToStart` and for the same reasons: a heads-up with a named
 * action, not a full-screen intent (a window thrown over whatever the person is doing, asking about a
 * camera, is what a spoofed prompt looks like), and gone when the request is — after the same 30
 * seconds the request lives.
 */
object CameraNotifications {

    private const val REQUEST_ID = 3104

    fun askUser(context: Context, peerName: String) {
        val manager = context.getSystemService<NotificationManager>() ?: return
        if (!canPost(context)) {
            // Not silent: the Mac's sentence already says to open the phone. Without notifications
            // the request screen also opens the next time Sidekick comes to the front within 30 s.
            LinkLog.w("camera", "Notifications are not permitted, so the phone cannot show the camera request")
            return
        }
        val open = PendingIntent.getActivity(
            context,
            REQUEST_ID,
            Intent(context, CameraActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, NotificationChannels.CAMERA_REQUEST)
            .setContentTitle("$peerName wants to see this phone's camera")
            .setContentText("Tap to review. The camera stays off until you tap Start camera.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Review request", open).build())
            .setTimeoutAfter(CameraSessionMachine.REQUEST_TIMEOUT_MS)
            .build()
        runCatching { manager.notify(REQUEST_ID, notification) }
            .onFailure { LinkLog.w("camera", "Could not post the camera request", it) }
    }

    fun clear(context: Context) {
        context.getSystemService<NotificationManager>()?.cancel(REQUEST_ID)
    }

    private fun canPost(context: Context): Boolean =
        android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
}
