package com.chetan.connectsuite.probe

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.TileService
import android.util.Log
import androidx.activity.ComponentActivity

/**
 * **Is there a cheaper trigger than opening the app?** — the instrument, debug-only, written
 * before any feature and measuring each candidate route rather than deducing it from Slice 11.
 *
 * ### Why this is not just arithmetic on Slice 11's answer
 *
 * Slice 11 established the discriminator: **focus**, not the accessibility grant, not foreground-
 * service importance. From that one could *deduce* every answer below — a broadcast has no focus,
 * so it is refused; an activity has focus, so it is not. That deduction is probably right and it
 * is **not a measurement**, and this project has been wrong before about exactly this shape: the
 * documented accessibility exception was inherited for four phases and turned out not to operate
 * here at all. So each route is run, and each reports `focused=` and `importance=` beside its
 * result so the answer can be attributed rather than assumed.
 *
 * ### The four routes, and the one that changes the question
 *
 * | # | Route | Reads the clipboard? |
 * |---|---|---|
 * | 1 | notification action → **broadcast** | yes — needs the wall to not apply |
 * | 2 | quick-settings **tile** `onClick` | yes — same |
 * | 3 | notification action → **transparent activity** | yes, and it should be allowed to |
 * | 4 | **`ACTION_PROCESS_TEXT`** / `ACTION_SEND` | **no** — the text arrives in the Intent |
 *
 * Route 4 is the one worth measuring carefully, because it is not a way *around* the wall — it
 * never asks the clipboard anything. The user selects text and taps our name in the selection
 * toolbar instead of tapping Copy. Whether that is a *product* is a separate question from whether
 * it is *permitted*, and only the second is measured here.
 *
 * ### What it reports about itself
 *
 * Every route logs `focused=` and `importance=` on the read line, the same two facts that made
 * Slice 11 attributable. A route that never ran logs that it never ran: an absent line from route
 * 2 means the tile was never added to the shade, not that the tile was refused — which is the
 * "registration line is not an execution line" rule, and the reason `ARMED` is logged separately
 * from `READ`.
 *
 * ```
 * adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ClipTriggerProbeActivity
 * adb logcat -s ClipTrigger:V
 * ```
 */
private const val TAG = "ClipTrigger"
private const val CHANNEL = "clip-trigger-probe"

/** The one read, in one place, so four routes cannot drift into four different questions. */
internal fun readClipboard(context: Context, route: String, focused: Boolean?) {
    val importance = importanceOf(context)
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = runCatching { clipboard.primaryClip }
    // The exception's type reaches the log intact. `getOrNull()` here would discard the platform's
    // own diagnosis, which is defect 57's whole lesson.
    val failure = clip.exceptionOrNull()
    val data = clip.getOrNull()
    val text = data?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
    Log.i(
        TAG,
        "READ route=$route focused=$focused importance=$importance " +
            "returned=${data != null} items=${data?.itemCount ?: 0} " +
            "length=${text?.length ?: 0} threw=${failure?.javaClass?.simpleName ?: "no"}",
    )
}

internal fun importanceOf(context: Context): Int {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance
}

/**
 * Route 1's landing point. A notification action's `PendingIntent.getBroadcast` runs here with no
 * activity and no focus — the cheapest possible trigger if it is permitted.
 */
class ClipTriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "ARMED route=notification-broadcast fired")
        readClipboard(context, "notification-broadcast", focused = false)
    }
}

/**
 * Route 2. `onClick` runs while the shade is open and this process is not focused.
 *
 * `onStartListening` is logged separately because a tile the user never added to their shade
 * produces no lines at all, and that silence must not be read as a refusal.
 */
class ClipTriggerTile : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        Log.i(TAG, "ARMED route=qs-tile listening — the tile IS in the shade")
    }

    override fun onClick() {
        super.onClick()
        Log.i(TAG, "ARMED route=qs-tile clicked")
        readClipboard(this, "qs-tile", focused = false)
    }
}

/**
 * Route 3, and route 4's landing point.
 *
 * As route 3 it is the transparent activity a notification action opens: it takes focus, reads, and
 * finishes. As route 4 it receives `ACTION_PROCESS_TEXT` or `ACTION_SEND`, where **the text is in
 * the Intent** and the clipboard is never consulted — so it logs what arrived and reads the
 * clipboard anyway, beside it, to show the two are independent.
 */
class ClipTriggerSinkActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val action = intent?.action
        val fromIntent = when (action) {
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        }
        Log.i(
            TAG,
            "ARMED route=sink action=$action textArrivedInIntent=${fromIntent != null} " +
                "intentTextLength=${fromIntent?.length ?: 0}",
        )
    }

    /** Focus is the platform's criterion, so the read is taken where the platform says it holds. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        val route = when (intent?.action) {
            Intent.ACTION_PROCESS_TEXT -> "process-text"
            Intent.ACTION_SEND -> "share-sheet"
            else -> "notification-activity"
        }
        readClipboard(this, route, focused = true)
        finish()
    }
}

/** Arms routes 1-3 and says what it armed, so a silent route can be told from a refused one. */
class ClipTriggerProbeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "--- clip trigger probe: arming routes 1-3 ---")
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Clip trigger probe", NotificationManager.IMPORTANCE_HIGH),
        )
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val toBroadcast = PendingIntent.getBroadcast(
            this, 1, Intent(this, ClipTriggerReceiver::class.java).setPackage(packageName), flags,
        )
        val toActivity = PendingIntent.getActivity(
            this, 2, Intent(this, ClipTriggerSinkActivity::class.java), flags,
        )
        nm.notify(
            4242,
            Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_send)
                .setContentTitle("Clip trigger probe")
                .setContentText("Two actions: one broadcast, one activity")
                .addAction(Notification.Action.Builder(null, "Broadcast read", toBroadcast).build())
                .addAction(Notification.Action.Builder(null, "Activity read", toActivity).build())
                .setOngoing(true)
                .build(),
        )
        Log.i(TAG, "ARMED route=notification posted id=4242 with 2 actions")
        Log.i(TAG, "ARMED route=qs-tile declared — it must be ADDED to the shade by hand to fire")
        Log.i(TAG, "sdk=${Build.VERSION.SDK_INT} — tap each action, then read the READ lines")
        finish()
    }
}
