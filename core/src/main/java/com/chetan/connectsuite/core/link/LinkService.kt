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
import kotlinx.coroutines.delay
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
    /**
     * Whether this service has **ever** reached the foreground. Defect 103.
     *
     * It is deliberately not "are we foreground now". That field existed, was assigned `true` in one
     * place and cleared in none, and the guard it fed then skipped the re-claim for the life of the
     * process — so a service the platform had demoted never asked to be foreground again. Observed
     * as `isForeground=false types=0x00000000` on a ServiceRecord alive twelve hours with
     * `startForegroundCount=1`. Defect 97's shape on the phone: one writer, no reader of the
     * platform's actual state.
     *
     * **The platform is the source of truth and it is not readable**, so nothing tries to mirror it.
     * `startForeground` is now called on every start command, exactly as `MirrorService` does — which
     * is why `MirrorService` recovered by itself on 2026-09-12 while this one stayed demoted.
     *
     * This flag is write-once and decides one thing only: whether a refusal is fatal. Failing to
     * reach the foreground the **first** time means there is nothing to protect, so stopping is
     * honest. Failing on a **later** re-claim means live sockets exist, and killing them because one
     * re-claim was refused would be worse than the demotion — defect 102 is the concrete reason, a
     * restriction the phone can apply and lift while the app is running.
     */
    private var everForeground = false

    /**
     * Published together so a lapse count is never read without the denominators beside it.
     *
     * ### Refresh, do not repair — the correction the overnight run forced
     *
     * The first version of defect 61's fix re-acquired only when the lock was **not held**, which
     * repairs a lapse instead of preventing one. With a 60-minute timeout and a 20-minute ticker
     * whose phase is unrelated to the acquire, the worst case is a tick at T+59 finding it held, the
     * platform dropping it at T+60, and the next tick at T+79 — **nineteen minutes with no wake
     * lock**, on a link that believes it is holding one.
     *
     * `scripts/link-night-watch.sh` found the shape of it before it bit: a **59m49s** continuous
     * hold at 07:26:45, eleven seconds short of the timeout. What kept it from mattering is the same
     * thing that hid the original defect — the link drops often enough that `releaseLocks` resets
     * the cycle first, which is precisely the hiding place Phase 6 exists to remove.
     *
     * So a tick on a held lock now calls `acquire` again, which on a non-reference-counted lock
     * re-arms its timeout. [wakeLockRearms] counts the lapses that got through anyway, and it should
     * stay at zero: it is an alarm, not a success, which is why it logs at `W`.
     */
    private var wakeLockAcquires = 0
    private var wakeLockRefreshes = 0
    private var wakeLockRearms = 0

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.createAll(this)
        LinkLog.init(this)

        server = LinkController.get(this, versionName())

        lifecycleScope.launch { server.start() }

        advertiser = NsdAdvertiser(this, server.identity.deviceName, server.identity.deviceId)
            .also { it.start() }
        // F6: a scan republishes the discovery record with the fingerprint of the Mac this phone is
        // now expecting, so a Mac holding a QR can tell it was scanned.
        server.pairIntentSink = { fingerprint: String? -> advertiser?.setPairIntent(fingerprint) }

        // Defect 61: the lock's own timeout is the backstop against a missed release path, and a
        // backstop that is never re-armed is just a leak with a deadline. This is the only thing in
        // the service that ticks while nothing is happening, which is the state the bug lives in.
        lifecycleScope.launch { rearmTicker() }

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
        // Unconditionally, on every start command. There is no "already foreground" guard, because
        // the platform can demote this service and tell us nothing, and a guard over our own
        // bookkeeping then skips the re-claim forever. Re-calling `startForeground` on a service
        // that is already foreground updates its notification and is otherwise a no-op.
        startReason = LinkStartReason.fromExtra(
            intent?.getStringExtra(LinkStartReason.EXTRA),
        )
        if (!startForegroundWithStatus(getString(R.string.link_service_starting))) {
            if (!everForeground) {
                // Never reached the foreground, so there are no sockets to protect. A
                // started-but-not-foreground service is killed within seconds and would take them
                // down in a way nothing logs; stopping is the only honest move.
                LinkLog.w("service", "Foreground refused on the first start — stopping rather than running demoted")
                stopSelf()
                return START_NOT_STICKY
            }
            // A later re-claim was refused while a link is up. Killing it here would turn a
            // recoverable demotion into a dropped connection, and defect 102 is a live example of a
            // restriction that comes and goes under a running app. Logged loudly and kept.
            LinkLog.w(
                "service",
                "Foreground RE-CLAIM refused (reason=$startReason) — the service is demoted and the " +
                    "link is still up; it will be re-attempted on the next start command",
            )
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

    /**
     * Defect 61. The guard here used to be `if (wakeLock == null)`, and the field's comment claimed
     * the lock was *"re-armed on every state change"*. It was not: after the platform timed the
     * lock out, `isHeld` went false, the field stayed non-null, and nothing re-acquired it for the
     * rest of the connection.
     *
     * The guard is `isHeld` now, and — the half that matters more — a state change is no longer
     * what drives it. A quietly healthy connection emits no state changes for hours, which is
     * exactly the case that broke; [rearmTicker] is what actually keeps the lock alive.
     */
    private fun acquireLocks() {
        val existing = wakeLock
        when {
            existing == null -> {
                wakeLockAcquires++
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ConnectSuite:link")
                    .apply {
                        setReferenceCounted(false)
                        acquire(LinkLockPolicy.TIMEOUT_MS)
                    }
            }
            // Held: **extend** it. This is the half the first version of the fix got wrong, and the
            // overnight run is what found it — see the `refresh, do not repair` note above the class.
            // `setReferenceCounted(false)` makes a second `acquire` a re-arm of the timeout rather
            // than a second lock, so this is the whole of the refresh.
            existing.isHeld -> {
                wakeLockRefreshes++
                existing.acquire(LinkLockPolicy.TIMEOUT_MS)
            }
            // Not held. The timeout beat the ticker, which means the margin is wrong or a tick was
            // dropped — so this is an alarm rather than routine, and it is published with the
            // denominator that makes it readable.
            else -> {
                wakeLockRearms++
                LinkLog.w(
                    "service",
                    "Wake lock had lapsed before the ticker reached it — $wakeLockRearms lapse(s) / " +
                        "$wakeLockRefreshes refresh(es) / $wakeLockAcquires first-acquire(s) since start",
                )
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ConnectSuite:link")
                    .apply {
                        setReferenceCounted(false)
                        acquire(LinkLockPolicy.TIMEOUT_MS)
                    }
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

    private suspend fun rearmTicker() {
        while (true) {
            delay(LinkLockPolicy.REARM_INTERVAL_MS)
            if (server.state.value.isConnected) acquireLocks() else releaseLocks()
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
            val first = !everForeground
            everForeground = true
            // Logged on every claim, not only the first: a re-claim after a demotion is the event
            // defect 103 exists for, and a line that only appears once cannot show it happening.
            LinkLog.i(
                "service",
                "Foreground ${if (first) "claimed" else "RE-claimed"} as $startReason, types=0x${types.toString(16)}",
            )
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
