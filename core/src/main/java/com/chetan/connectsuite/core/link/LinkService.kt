package com.chetan.connectsuite.core.link

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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

    /**
     * Why this service was started, which decides the foreground types it may claim.
     *
     * Read in [onStartCommand] rather than [onCreate] because the intent only exists there, and
     * `startForeground` therefore moved with it. That is a real change to a working service, so
     * the reason it is safe is written down: every route into this service goes through
     * `startForegroundService`/`startService`, `onBind` returns null, and `onStartCommand` runs on
     * the main thread immediately after `onCreate` — so the five-second deadline is met by the
     * same tick it was met by before. See [LinkAutoStart].
     */
    private var startReason: LinkStartReason = LinkStartReason.UNKNOWN
    private var isForeground = false

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.createAll(this)
        LinkLog.init(this)

        server = LinkController.get(this, versionName())

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
        if (!isForeground) {
            startReason = LinkStartReason.fromExtra(
                intent?.getStringExtra(LinkStartReason.EXTRA),
            )
            if (!startForegroundWithStatus(getString(R.string.link_service_starting))) {
                // The platform refused the types we asked for. Stopping is the only honest move:
                // a started-but-not-foreground service is killed by the system within seconds and
                // would take the sockets down with it in a way nothing logs.
                stopSelf()
                return START_NOT_STICKY
            }
        }
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

    /**
     * Goes foreground, and returns whether it worked.
     *
     * The failure it catches is `ForegroundServiceStartNotAllowedException`, which on Android 15+
     * is how the platform refuses a type that may not be claimed for the start reason in play.
     * Catching it turns a crash on the user's first boot after installing an update into one log
     * line and a clean stop — and, unlike the crash, it says which reason and which types were
     * refused, which is the only thing that would let anyone fix it.
     */
    private fun startForegroundWithStatus(status: String): Boolean {
        val types = LinkAutoStart.foregroundTypesFor(startReason)
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(status), types)
            isForeground = true
            LinkLog.i("service", "Foreground as $startReason, types=0x${types.toString(16)}")
            true
        } catch (e: Exception) {
            // The class is named rather than referenced: ForegroundServiceStartNotAllowedException
            // is API 31 and this module's minSdk is 29, so an `is` check would put an unresolvable
            // type in a method that runs on every start. The name in the log is the same evidence
            // and costs nothing.
            LinkLog.e(
                "service",
                "startForeground refused for $startReason with types=0x${types.toString(16)}: " +
                    "${e.javaClass.simpleName} — the link will not come back on this path",
                e,
            )
            false
        }
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

        @JvmStatic
        @JvmOverloads
        fun start(context: Context, reason: LinkStartReason = LinkStartReason.USER) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, LinkService::class.java)
                    .putExtra(LinkStartReason.EXTRA, reason.name),
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
