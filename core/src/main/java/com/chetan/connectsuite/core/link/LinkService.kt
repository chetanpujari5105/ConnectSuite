package com.chetan.connectsuite.core.link

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.chetan.connectsuite.core.R
import com.chetan.connectsuite.core.notification.NotificationChannels
import kotlinx.coroutines.launch

/**
 * The always-on half of ConnectSuite: it holds the three listening sockets, the mDNS
 * advertisement, and the locks that keep them usable while the screen is off.
 *
 * It has to be a foreground service. Android will not let a background process keep a server
 * socket open, and a link that dies when the user leaves the app is not worth having.
 */
class LinkService : LifecycleService() {

    private lateinit var server: LinkServer
    private var advertiser: NsdAdvertiser? = null

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.createAll(this)
        LinkLog.init(this)

        server = LinkController.get(this, versionName())
        startForegroundWithStatus(getString(R.string.link_service_starting))

        lifecycleScope.launch { server.start() }

        advertiser = NsdAdvertiser(this, server.identity.deviceName, server.identity.deviceId)
            .also { it.start() }

        lifecycleScope.launch {
            server.state.collect { state ->
                updateStatus(statusText(state))
                // Locks are held only while someone is actually connected. Holding them idle is
                // what turns a background service into an overnight battery complaint.
                if (state.isConnected) acquireLocks() else releaseLocks()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_REFRESH_CAPABILITIES -> server.refreshCapabilities()
        }
        // Samsung's task killer will take us down; come back when it does.
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    override fun onDestroy() {
        advertiser?.stop()
        server.stop()
        releaseLocks()
        super.onDestroy()
    }

    private fun statusText(state: LinkState): String = when {
        !state.running -> state.lastError ?: getString(R.string.link_service_stopped)
        state.clients.size == 1 -> getString(R.string.link_service_connected, state.clients.first())
        state.clients.size > 1 -> resources.getQuantityString(
            R.plurals.link_service_connected_many,
            state.clients.size,
            state.clients.size,
        )
        else -> getString(R.string.link_service_waiting)
    }

    private fun acquireLocks() {
        if (wakeLock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ConnectSuite:link")
                .apply {
                    setReferenceCounted(false)
                    acquire(WAKE_LOCK_TIMEOUT_MS)
                }
        }
        if (wifiLock == null) {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            } else {
                @Suppress("DEPRECATION")
                WifiManager.WIFI_MODE_FULL
            }
            wifiLock = wifi.createWifiLock(mode, "ConnectSuite:link").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
    }

    private fun releaseLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
    }

    private fun startForegroundWithStatus(status: String) {
        val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(status), types)
    }

    private fun updateStatus(status: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        runCatching {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification(status))
        }
    }

    private fun notification(status: String): Notification =
        NotificationCompat.Builder(this, NotificationChannels.CONNECTION)
            .setSmallIcon(R.drawable.ic_connect_status)
            .setContentTitle(getString(R.string.app_display_name))
            .setContentText(status)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(
                packageManager.getLaunchIntentForPackage(packageName)?.let {
                    PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
                },
            )
            .addAction(
                0,
                getString(R.string.action_stop),
                PendingIntent.getService(
                    this,
                    1,
                    Intent(this, LinkService::class.java).setAction(ACTION_STOP),
                    PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    private fun versionName(): String =
        runCatching { packageManager.getPackageInfo(packageName, 0).versionName }
            .getOrNull() ?: "2.0.0"

    companion object {
        private const val NOTIFICATION_ID = 2001

        /** Re-armed on every state change; a phone that sleeps for a day never holds it stale. */
        private const val WAKE_LOCK_TIMEOUT_MS = 12L * 60 * 60 * 1000

        const val ACTION_STOP = "com.chetan.connectsuite.link.STOP"
        const val ACTION_REFRESH_CAPABILITIES = "com.chetan.connectsuite.link.REFRESH_CAPS"

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, LinkService::class.java),
            )
        }

        fun refreshCapabilities(context: Context) {
            runCatching {
                context.startService(
                    Intent(context, LinkService::class.java)
                        .setAction(ACTION_REFRESH_CAPABILITIES),
                )
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LinkService::class.java))
        }
    }
}
