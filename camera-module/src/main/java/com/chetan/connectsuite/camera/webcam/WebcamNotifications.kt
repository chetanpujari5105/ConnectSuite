package com.chetan.connectsuite.camera.webcam

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.content.getSystemService
import com.chetan.connectsuite.camera.CameraNotifications
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.notification.NotificationChannels

/**
 * The webcam request's notification, when Sidekick is not on screen. **Tapping it opens the request
 * screen, never the camera.** Shaped exactly like Camera v1's — the same channel, a named action, no
 * full-screen intent, gone after the request's 30 seconds — with its own id and its own screen, so the
 * two features' requests can never stand in for each other.
 *
 * The title follows the request's `trigger`: an app on the Mac starting Sidekick Camera is not the Mac's
 * owner asking, and the phone never says it is.
 */
object WebcamNotifications {

    private const val REQUEST_ID = 3105

    fun askUser(context: Context, peerName: String, trigger: WebcamTrigger): Boolean {
        val manager = context.getSystemService<NotificationManager>() ?: return false
        // The deliverability rule is Camera v1's (defect 171): the permission, the app switch, the channel.
        if (!CameraNotifications.deliverable(context)) {
            LinkLog.w("webcam", "Notifications are not deliverable, so the phone cannot show the webcam request")
            return false
        }
        val open = PendingIntent.getActivity(
            context,
            REQUEST_ID,
            Intent(context, WebcamActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, NotificationChannels.CAMERA_REQUEST)
            .setContentTitle(WebcamCopy.requestTitle(peerName, trigger))
            .setContentText("Tap to review. The camera stays off until you tap Start camera.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Review request", open).build())
            .setTimeoutAfter(WebcamSessionMachine.REQUEST_TIMEOUT_MS)
            .build()
        return runCatching { manager.notify(REQUEST_ID, notification) }
            .onFailure { LinkLog.w("webcam", "Could not post the webcam request", it) }
            .isSuccess
    }

    fun clear(context: Context) {
        context.getSystemService<NotificationManager>()?.cancel(REQUEST_ID)
    }
}

/** The webcam's request copy, in one place so a JVM test reads exactly what the phone shows. */
object WebcamCopy {
    fun requestTitle(peerName: String, trigger: WebcamTrigger): String = when (trigger) {
        WebcamTrigger.CONSUMER -> "An app on $peerName wants this phone's camera as its webcam"
        WebcamTrigger.PERSON -> "$peerName is asking to use this phone's camera as a webcam"
    }

    /** What approving means, said before the tap. Names no recording, no sound, and the foreground rule. */
    const val REQUEST_BODY =
        "The camera stays off until you tap Start camera. The picture goes to Sidekick Camera on that Mac, " +
            "only for this session and only while this screen stays open. Opening the camera in a meeting app " +
            "is not the same as allowing it here. Nothing is recorded or saved, and there is no sound."
}
