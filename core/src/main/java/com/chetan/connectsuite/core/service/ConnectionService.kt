package com.chetan.connectsuite.core.service

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.chetan.connectsuite.core.R
import com.chetan.connectsuite.core.notification.NotificationChannels
import com.chetan.connectsuite.core.pairing.PairingEvent
import com.chetan.connectsuite.core.pairing.PairingManager
import com.chetan.connectsuite.core.repository.DeviceRepository
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * Keeps discovery, the listening socket, and every paired connection alive while the app is in
 * the background.
 *
 * This has to be a foreground service: notification mirroring is worthless if the link dies the
 * moment the user leaves the app, and Android will not keep a background socket open otherwise.
 */
class ConnectionService : LifecycleService() {

    private lateinit var repository: DeviceRepository
    private lateinit var pairing: PairingManager

    override fun onCreate() {
        super.onCreate()
        repository = DeviceRepository.get(this)
        pairing = PairingManager.get(this)

        startForegroundWithStatus(getString(R.string.connection_service_starting))
        repository.start()

        lifecycleScope.launch {
            combine(
                repository.devices,
                repository.isScanning,
            ) { devices, scanning ->
                val connected = devices.count { it.isConnected }
                when {
                    connected == 1 -> {
                        val name = devices.first { it.isConnected }.name
                        getString(R.string.connection_service_connected_one, name)
                    }
                    connected > 1 -> resources.getQuantityString(
                        R.plurals.connection_service_connected_many,
                        connected,
                        connected,
                    )
                    scanning -> getString(R.string.connection_service_scanning)
                    else -> getString(R.string.connection_service_idle)
                }
            }
                // **Defect 101.** `combine` emits whenever *either* upstream does, and
                // `UdpDiscovery.ANNOUNCE_INTERVAL_MS` is 8 seconds — so the discovery heartbeat
                // re-emitted the same device list every 8 seconds, the same status string was
                // rendered, and the same notification was posted again. Twice a tick, forever:
                // two `notification_enqueue` records and four `power_partial_wake_state`
                // transitions for a notification whose text had not changed.
                //
                // It cost more than battery. The churn rotated the platform's `events` buffer past
                // the failure under investigation **twice in one day**, destroying the
                // `am_foreground_service_*` records defect 100 needed — an instrument destroyed by
                // our own noise.
                //
                // The notification follows the **rendered text**, not the heartbeat. A status that
                // has not changed is not news.
                //
                // Deliberately not a throttle: a fixed interval would make a genuine change late as
                // well as making the churn quieter, and the fault is redundant posts rather than
                // frequent ones. And deliberately not upstream — the 8-second announce is correct
                // and is how this phone advertises itself; what was wrong was a notification
                // treating a heartbeat as an event.
                .distinctUntilChanged()
                .collect(::updateStatus)
        }

        lifecycleScope.launch {
            pairing.events.collect(::onPairingEvent)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Restart if the OEM's task killer takes us down.
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    override fun onDestroy() {
        repository.stop()
        super.onDestroy()
    }

    private fun startForegroundWithStatus(status: String) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildStatusNotification(status), type)
    }

    private fun updateStatus(status: String) {
        NotificationManagerCompat.from(this)
            .notifyIfAllowed(NOTIFICATION_ID, buildStatusNotification(status))
    }

    /**
     * Posts only when the notification permission is actually held.
     *
     * On API 33+ the user can revoke POST_NOTIFICATIONS at any moment, including while this
     * service is running - and `notify` throws rather than quietly doing nothing, which would
     * take the whole connection service down with it.
     */
    private fun NotificationManagerCompat.notifyIfAllowed(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this@ConnectionService,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        if (!areNotificationsEnabled()) return

        try {
            notify(id, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification refused by the system", e)
        }
    }

    private fun buildStatusNotification(status: String): Notification =
        NotificationCompat.Builder(this, NotificationChannels.CONNECTION)
            .setSmallIcon(R.drawable.ic_connect_status)
            .setContentTitle(getString(R.string.app_display_name))
            .setContentText(status)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(launchAppIntent())
            .addAction(
                0,
                getString(R.string.action_stop),
                PendingIntent.getService(
                    this,
                    1,
                    Intent(this, ConnectionService::class.java).setAction(ACTION_STOP),
                    PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    private fun onPairingEvent(event: PairingEvent) {
        val manager = NotificationManagerCompat.from(this)

        when (event) {
            is PairingEvent.RequestReceived -> {
                val notification =
                    NotificationCompat.Builder(this, NotificationChannels.PAIRING)
                        .setSmallIcon(R.drawable.ic_connect_status)
                        .setContentTitle(
                            getString(R.string.pairing_request_title, event.request.deviceName),
                        )
                        .setContentText(
                            getString(
                                R.string.pairing_request_text,
                                event.request.displayFingerprint,
                            ),
                        )
                        .setStyle(
                            NotificationCompat.BigTextStyle().bigText(
                                getString(
                                    R.string.pairing_request_big_text,
                                    event.request.deviceName,
                                    event.request.displayFingerprint,
                                ),
                            ),
                        )
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setAutoCancel(true)
                        .setContentIntent(launchAppIntent())
                        .build()
                manager.notifyIfAllowed(
                    event.request.deviceId.pairingNotificationId(),
                    notification,
                )
            }

            is PairingEvent.Accepted -> {
                manager.cancel(event.deviceId.pairingNotificationId())
                Log.i(TAG, "Paired with ${event.deviceName}")
            }

            is PairingEvent.Rejected -> manager.cancel(event.deviceId.pairingNotificationId())
            is PairingEvent.TimedOut -> manager.cancel(event.deviceId.pairingNotificationId())
            is PairingEvent.Forgotten -> manager.cancel(event.deviceId.pairingNotificationId())
        }
    }

    private fun launchAppIntent(): PendingIntent? {
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        return PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun String.pairingNotificationId(): Int = PAIRING_ID_BASE + hashCode() % 1000

    companion object {
        private const val TAG = "ConnectionService"
        private const val NOTIFICATION_ID = 1001
        private const val PAIRING_ID_BASE = 2000

        const val ACTION_STOP = "com.chetan.connectsuite.action.STOP_CONNECTION_SERVICE"

        fun start(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, ConnectionService::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
