package com.chetan.connectsuite.mirror.v2

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
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

        // Now — and only now — is it legal to ask for the projection.
        MirrorEngine.onServiceReady(applicationContext, consent)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        MirrorEngine.stop("mirror service destroyed")
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
