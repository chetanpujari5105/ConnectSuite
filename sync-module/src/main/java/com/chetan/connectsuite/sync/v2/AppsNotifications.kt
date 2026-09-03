package com.chetan.connectsuite.sync.v2

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
 * The whole of `apps.open.ask`'s user-facing half: one notification, and the tap that opens the app.
 *
 * ### This is not a fallback. It is the feature.
 *
 * `docs/phase-7-apps-proposal.md` §2.4: a backgrounded `startActivity` for a third-party package on
 * this platform **throws nothing, logs nothing, and does not bring the app to the front.** So there
 * is no version of this feature where a click on the Mac opens an app by itself, and the honest
 * response is to build the one that works rather than the one that returns success.
 *
 * **The tap is where the launch happens, and that is what makes it legal.** A person pressing a
 * notification is a foreground interaction; the `PendingIntent` fires with the user's own privilege
 * rather than ours, which is the same mechanism `MIRROR_REQUEST` already relies on for the capture
 * prompt. Nothing in this file calls `startActivity` itself.
 *
 * ### Why the notification is high importance
 *
 * It is a question with a person waiting on the other end of it — somebody at a Mac who has just
 * clicked a tile and is watching their phone. A quiet notification would make the feature look
 * broken for exactly as long as it took them to notice the shade, and *"I clicked and nothing
 * happened"* is the report this whole design exists to avoid. The clipboard's channel is
 * `IMPORTANCE_DEFAULT` for the opposite reason: an arriving clip is an offer nobody is waiting on.
 *
 * ### One notification at a time, replaced rather than stacked
 *
 * A fixed [NOTIFICATION_ID], so clicking three tiles in a row leaves one question rather than three.
 * The last one asked is the one the person meant; a queue of stale *Open Instagram?* cards is a
 * shade full of questions whose answers have expired. The `PendingIntent` request code is fixed too
 * and `FLAG_UPDATE_CURRENT` rewrites the extras — without it the second ask would reuse the first
 * one's intent and open the wrong app, which is the quietest possible way for this feature to lie.
 */
object AppsNotifications {

    private const val NOTIFICATION_ID = 3201
    private const val REQUEST_ID = 3202

    /**
     * Posts *Open Instagram?*, or returns false when the phone has nowhere to put the question.
     *
     * @param label the app's resolved name. Never a package id — `AppsStore` resolves through
     *   `AppLabels.of`, and where that falls back the caller has already decided how to say so.
     * @param askedBy the Mac's own name, so the question says who is asking. A phone buzzing with
     *   *Open Instagram?* and no attribution is a phone that appears to be doing it by itself.
     * @return false when notifications are not permitted — the one case that must **not** be
     *   answered with `{ asked: true }`, because nothing was asked.
     */
    fun ask(context: Context, packageName: String, label: String, intent: Intent, askedBy: String?): Boolean {
        val app = context.applicationContext
        val manager = app.getSystemService<NotificationManager>() ?: return false
        if (!canPost(app)) {
            LinkLog.w(
                "apps",
                "apps.open.ask for $packageName could not be delivered: notifications are turned " +
                    "off for this app, so there is nowhere to put the question. Refused rather " +
                    "than acked — an ask nobody can see is the success-that-did-not-happen this " +
                    "namespace exists to avoid.",
            )
            return false
        }

        // FLAG_ACTIVITY_NEW_TASK because this starts from a notification rather than from an
        // activity of ours: there is no task to attach to, and the app opens in its own, which is
        // what the launcher itself does.
        val launch = Intent(intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pending = PendingIntent.getActivity(
            app,
            REQUEST_ID,
            launch,
            // UPDATE_CURRENT so a second ask rewrites the target rather than reusing the first
            // one's. IMMUTABLE because nothing may rewrite which app this opens after it is posted.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val from = askedBy?.takeIf { it.isNotBlank() }
        val builder = Notification.Builder(app, NotificationChannels.APP_OPEN_REQUEST)
            .setContentTitle("Open $label?")
            .setContentText(
                if (from != null) "$from asked. Tap to open it." else "Your Mac asked. Tap to open it.",
            )
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setCategory(Notification.CATEGORY_RECOMMENDATION)
            .setContentIntent(pending)
            .setAutoCancel(true)
            // The body and the action do the same thing on purpose. The body is the target most
            // people hit, and an action button is the one that survives a collapsed shade on One UI.
            .addAction(Notification.Action.Builder(null, "Open", pending).build())

        return runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
            .onFailure { LinkLog.w("apps", "Could not post the open request for $packageName", it) }
            .isSuccess
    }

    fun dismiss(context: Context) {
        context.applicationContext.getSystemService<NotificationManager>()?.cancel(NOTIFICATION_ID)
    }

    /**
     * Whether the question can be delivered at all.
     *
     * Two checks, not one. `POST_NOTIFICATIONS` is the runtime grant; `areNotificationsEnabled` is
     * the switch in Settings that a person can turn off without ever seeing a permission dialog,
     * and on this OEM it is one long-press away from any notification. A check that read only the
     * permission would report the question deliverable to a shade that will silently drop it —
     * which is a check that does not gate the action, one layer down.
     */
    fun canPost(context: Context): Boolean = NotificationDelivery.canPost(context)
}
