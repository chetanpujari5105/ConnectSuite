package com.chetan.connectsuite.mirror.v2

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import com.chetan.connectsuite.core.link.LinkLog

/**
 * Foreground service whose only job is to be in the foreground while capture runs.
 *
 * From Android 14 a MediaProjection may only be obtained while a service with the
 * `mediaProjection` foreground type is already running — the projection is handed out *to* that
 * service, not to the process. So consent is collected first, this service is started, and only
 * once it reports ready does [MirrorEngine] ask for the projection. Getting that order wrong
 * throws SecurityException at `getMediaProjection`, which is the single most common way a
 * mirroring implementation fails on modern Android.
 *
 * It is deliberately separate from `LinkService`: that one is `connectedDevice|dataSync` and runs
 * for the life of the link, whereas this one exists only while pixels are being captured, and the
 * user is entitled to see a distinct "your screen is being recorded" notification for it.
 */
class MirrorService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val consent = intent?.getParcelableExtra<Intent>(EXTRA_CONSENT)
        if (consent == null) {
            LinkLog.w("mirror", "MirrorService started with no consent Intent; stopping")
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification(), foregroundType())
        traceForegroundImportance()

        // Now — and only now — is it legal to ask for the projection.
        MirrorEngine.onServiceReady(applicationContext, consent)
        return START_NOT_STICKY
    }

    /**
     * **Instrument for defect 100. Not a fix, and deliberately alone in its build.**
     *
     * The instrument this replaces could not be built: `Service.stopForeground` is **final**, so the
     * call our own event log attributes to us cannot be intercepted from inside the service. That is
     * itself worth knowing — it means the question *"does our process call stopForeground?"* has no
     * direct answer available to us, and the reading has to come at it sideways.
     *
     * So it comes at it through **process importance**, which is the one thing an app can observe
     * about its own foreground-service state. `IMPORTANCE_FOREGROUND_SERVICE` (125) is what this
     * process holds while any of its foreground services is foreground; the moment the last one is
     * demoted it drops to `IMPORTANCE_FOREGROUND` (100, an activity is visible) or worse. Sampling
     * it every few milliseconds across the window puts the demotion on the same clock as our own
     * steps, and **what our code is doing at that instant is the discriminator**:
     *
     *  - a demotion that lands *while our code is mid-step* points back at us;
     *  - a demotion that lands in a gap where this process is provably idle — no log line of ours
     *    between the previous step and the drop — says nothing of ours asked for it.
     *
     * Neither is proof. Both are better than another hour of grep over a codebase that contains no
     * `stopForeground` call at all, and both are pre-registered in `docs/testing.md` → Slice 38.
     *
     * 5 ms for 600 ms is 120 samples over a window measured at 107 ms, so the transition cannot fall
     * between two samples the way the 263 ms publish did. Only the *changes* are logged, so a
     * healthy session costs two lines, not a hundred and twenty.
     */
    private fun traceForegroundImportance() {
        val started = SystemClock.elapsedRealtime()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        LinkLog.w(
            "mirror",
            "INSTRUMENT (defect 100): FGS begins. notificationsEnabled=" +
                "${manager.areNotificationsEnabled()} channel=${manager.getNotificationChannel(CHANNEL_ID)?.importance}",
        )
        Thread({
            val state = ActivityManager.RunningAppProcessInfo()
            var last = Int.MIN_VALUE
            while (SystemClock.elapsedRealtime() - started < TRACE_MS) {
                ActivityManager.getMyMemoryState(state)
                if (state.importance != last) {
                    LinkLog.w(
                        "mirror",
                        "INSTRUMENT (defect 100): +${SystemClock.elapsedRealtime() - started}ms " +
                            "process importance ${last.takeIf { it != Int.MIN_VALUE } ?: "?"} -> ${state.importance}" +
                            (if (state.importance == 125) "  (FOREGROUND_SERVICE)" else ""),
                    )
                    last = state.importance
                }
                try {
                    Thread.sleep(5)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return@Thread
                }
            }
            LinkLog.w("mirror", "INSTRUMENT (defect 100): trace ended at +${TRACE_MS}ms, last importance $last")
        }, "fgs-importance-trace").apply { isDaemon = true }.start()
    }

    override fun onDestroy() {
        // Same instrument, second half: a destroy would be recorded by AOSP as STOP_SERVICE rather
        // than STOP_FOREGROUND, so its absence here is as informative as the line above's presence.
        LinkLog.w("mirror", "INSTRUMENT (defect 100): MirrorService.onDestroy")
        super.onDestroy()
        MirrorEngine.stop(MirrorStopReason.ServiceDestroyed)
    }

    private fun foregroundType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            0
        }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Screen mirroring",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "Shown while your screen is being mirrored to your Mac." },
            )
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Mirroring to your Mac")
            .setContentText("Your screen is being captured.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val EXTRA_CONSENT = "consent"
        private const val CHANNEL_ID = "mirror_capture"
        private const val NOTIFICATION_ID = 3001

        /** How long the defect-100 importance trace runs. Six times the observed 107 ms window. */
        private const val TRACE_MS = 600L

        fun startWithConsent(context: Context, consent: Intent) {
            val intent = Intent(context, MirrorService::class.java).putExtra(EXTRA_CONSENT, consent)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MirrorService::class.java))
        }
    }
}
