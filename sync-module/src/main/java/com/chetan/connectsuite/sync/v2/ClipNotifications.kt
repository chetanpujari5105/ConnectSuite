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
 * The phone's surface for an entry from the Mac, in the two shapes the setting produces.
 *
 * **Offered** (`SettingsStore.clipboardAutoApply` off, the default): *the Mac copied this — tap to
 * put it on your clipboard.* **Applied** (the setting on): *this is on your clipboard now*, with no
 * action, because there is nothing left to do.
 *
 * ### The two are different notifications and not one with a reworded title
 *
 * A notification that says *Copied on your Mac* over an entry already applied, still carrying a
 * *Copy to this phone* button, is a claim about the device's state that is false in both halves —
 * and pressing that button would do nothing visible, which is the shape of bug people report as
 * "the clipboard is broken". [post] takes `applied` and builds the right one; there is no default,
 * so a third caller has to decide which it means.
 *
 * The write itself is permitted from the background on this device (`docs/testing.md` → Slice 11,
 * reading 5), so **which of the two happens was never a platform question**. It is a decision about
 * a single-slot store with no undo — and on this side, unlike the Mac's, the undo cannot be built,
 * because the phone may not read the clipboard it is about to overwrite.
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

    /**
     * @param applied whether the text is already on this phone's clipboard. Not defaulted: the two
     *   notifications make opposite claims about the device, and a caller that has not decided
     *   which one it means should not be able to post either.
     */
    fun post(context: Context, text: String, applied: Boolean) {
        val app = context.applicationContext
        val manager = app.getSystemService<NotificationManager>() ?: return
        if (!canPost(app)) {
            // **The reasoning that used to be here was wrong, and it is worth keeping the
            // correction visible.** It read: *with auto-apply on the clipboard was written and only
            // the telling failed, which is a materially smaller problem than an offer nobody can
            // reach.* That is backwards. An offer nobody can reach changes nothing on the device;
            // an unreportable apply destroys a clip the phone cannot read back, cannot keep and
            // cannot restore — the exact asymmetry `docs/protocol.md` builds this namespace on. It
            // happened seven times on the author's own phone before anyone looked.
            //
            // `ClipFeature` now decides deliverability **before** writing (see [ClipArrival]), so
            // reaching this line with `applied = true` means somebody added a caller that skipped
            // that decision. It is logged as the louder case for exactly that reason.
            LinkLog.w(
                "clip",
                if (applied) {
                    "BUG: a clipboard entry was applied on a phone that cannot report it. The " +
                        "apply must be gated on NotificationDelivery.canPost — see ClipArrival."
                } else {
                    "Notifications are not permitted, so the arriving clipboard entry could not be " +
                        "offered; it is in the history and can be applied from the app"
                },
            )
            return
        }

        val preview = text.take(PREVIEW_CHARS).replace('\n', ' ')
        val builder = Notification.Builder(app, NotificationChannels.CLIPBOARD)
            .setContentTitle(if (applied) "On your clipboard" else "Copied on your Mac")
            .setContentText(preview)
            .setStyle(Notification.BigTextStyle().bigText(preview))
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)

        if (!applied) {
            // The action exists only where there is something to do. An applied entry carrying a
            // "Copy to this phone" button would invite a tap that changes nothing.
            builder.addAction(
                Notification.Action.Builder(
                    null,
                    "Copy to this phone",
                    PendingIntent.getBroadcast(
                        app,
                        REQUEST_ID,
                        Intent(app, ClipApplyReceiver::class.java)
                            .setAction(ACTION_APPLY)
                            .putExtra(EXTRA_TEXT, text),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                ).build(),
            )
        }

        runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
            .onFailure { LinkLog.w("clip", "Could not post the clipboard notification", it) }
    }

    fun dismiss(context: Context) {
        context.applicationContext.getSystemService<NotificationManager>()?.cancel(NOTIFICATION_ID)
    }

    // One home for this rule: [NotificationDelivery]. This file used to ask only about the runtime
    // grant and so called a notification deliverable to a shade that will drop it — the same rule
    // AppsNotifications already asked correctly, two expressions, and the weaker one was on the path
    // that writes somebody's clipboard.
    private fun canPost(context: Context): Boolean = NotificationDelivery.canPost(context)
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
