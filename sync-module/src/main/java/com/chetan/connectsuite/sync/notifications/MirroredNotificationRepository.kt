package com.chetan.connectsuite.sync.notifications

import android.Manifest
import android.app.Notification
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.MirroredNotificationEntity
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.notification.NotificationChannels
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.transport.ConnectionManager
import com.chetan.connectsuite.core.transport.RoutedPacket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * The receiving half of notification mirroring: keeps the feed of notifications that arrived from
 * paired devices, and sends dismissals back so clearing one here clears it on the phone too.
 */
class MirroredNotificationRepository private constructor(private val appContext: Context) {

    private val connections = ConnectionManager.get(appContext)
    private val dao = ConnectSuiteDatabase.get(appContext).notificationDao()
    private val settings = SettingsStore.get(appContext)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var collectJob: Job? = null

    val activeNotifications: Flow<List<MirroredNotificationEntity>> = dao.observeActive()
    val allNotifications: Flow<List<MirroredNotificationEntity>> = dao.observeAll()

    fun start() {
        if (collectJob?.isActive == true) return
        collectJob = scope.launch {
            dao.pruneOlderThan(System.currentTimeMillis() - HISTORY_TTL_MS)
            connections.packets.collect(::onPacket)
        }
    }

    fun stop() {
        collectJob?.cancel()
        collectJob = null
    }

    private suspend fun onPacket(routed: RoutedPacket) {
        when (routed.incoming.packet.type) {
            PacketType.NOTIFICATION_POSTED -> onPosted(routed)
            PacketType.NOTIFICATION_REMOVED -> onRemoved(routed)
            PacketType.SMS_RECEIVED -> onSms(routed)
        }
    }

    private suspend fun onPosted(routed: RoutedPacket) {
        val packet = routed.incoming.packet
        val remoteKey = packet.string("key") ?: return
        val peerDeviceId = routed.connection.deviceId

        val entity = MirroredNotificationEntity(
            id = "$peerDeviceId:$remoteKey",
            peerDeviceId = peerDeviceId,
            remoteKey = remoteKey,
            packageName = packet.string("packageName").orEmpty(),
            appName = packet.string("appName").orEmpty(),
            title = packet.string("title").orEmpty(),
            text = packet.string("text").orEmpty(),
            postedAtMillis = packet.long("postedAt") ?: System.currentTimeMillis(),
            receivedAtMillis = System.currentTimeMillis(),
            isClearable = packet.bool("clearable") ?: true,
            iconBase64 = packet.string("icon"),
        )
        dao.upsert(entity)

        if (settings.snapshot().showReceivedAsNotifications) {
            postLocalNotification(entity, routed.connection.peerIdentity.deviceName)
        }
    }

    private suspend fun onRemoved(routed: RoutedPacket) {
        val remoteKey = routed.incoming.packet.string("key") ?: return
        val id = "${routed.connection.deviceId}:$remoteKey"
        dao.markDismissed(id)
        NotificationManagerCompat.from(appContext).cancel(id.localNotificationId())
    }

    private suspend fun onSms(routed: RoutedPacket) {
        val packet = routed.incoming.packet
        val sender = packet.string("sender").orEmpty()
        val body = packet.string("body").orEmpty()
        val timestamp = packet.long("timestamp") ?: System.currentTimeMillis()
        val peerDeviceId = routed.connection.deviceId

        val entity = MirroredNotificationEntity(
            id = "$peerDeviceId:sms:$timestamp:${sender.hashCode()}",
            peerDeviceId = peerDeviceId,
            remoteKey = "sms:$timestamp",
            packageName = "sms",
            appName = "Messages",
            title = sender.ifBlank { "New message" },
            text = body,
            postedAtMillis = timestamp,
            receivedAtMillis = System.currentTimeMillis(),
            isClearable = true,
        )
        dao.upsert(entity)

        if (settings.snapshot().showReceivedAsNotifications) {
            postLocalNotification(entity, routed.connection.peerIdentity.deviceName)
        }
    }

    /** Dismissing here also clears it on the device it came from. */
    fun dismiss(notification: MirroredNotificationEntity) {
        scope.launch {
            dao.markDismissed(notification.id)
            NotificationManagerCompat.from(appContext)
                .cancel(notification.id.localNotificationId())

            connections.connectionTo(notification.peerDeviceId)?.send(
                NetworkPacket.of(PacketType.NOTIFICATION_ACTION) {
                    put("key", JsonPrimitive(notification.remoteKey))
                    put("action", JsonPrimitive(NotificationMirrorService.ACTION_DISMISS))
                },
            )
        }
    }

    fun clearForPeer(peerDeviceId: String) {
        scope.launch { dao.clearForPeer(peerDeviceId) }
    }

    private fun postLocalNotification(
        entity: MirroredNotificationEntity,
        sourceDeviceName: String,
    ) {
        val icon = entity.iconBase64?.let { encoded ->
            runCatching {
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }.getOrNull()
        }

        val builder = NotificationCompat.Builder(appContext, NotificationChannels.CONNECTION)
            .setSmallIcon(com.chetan.connectsuite.core.R.drawable.ic_connect_status)
            .setContentTitle(entity.title.ifBlank { entity.appName })
            .setContentText(entity.text)
            .setSubText("$sourceDeviceName · ${entity.appName}")
            .setWhen(entity.postedAtMillis)
            .setAutoCancel(true)
            .setStyle(NotificationCompat.BigTextStyle().bigText(entity.text))
        if (icon != null) builder.setLargeIcon(icon)

        NotificationManagerCompat.from(appContext)
            .notifyIfAllowed(entity.id.localNotificationId(), builder.build())
    }

    /**
     * Posts only when POST_NOTIFICATIONS is actually held. The user can revoke it at any point,
     * and `notify` throws rather than no-oping - which would kill the packet collector.
     */
    private fun NotificationManagerCompat.notifyIfAllowed(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                appContext,
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

    private fun String.localNotificationId(): Int = MIRROR_ID_BASE + (hashCode() and 0xFFFF)

    companion object {
        private const val TAG = "MirroredNotifications"
        private const val MIRROR_ID_BASE = 300_000
        private const val HISTORY_TTL_MS = 7L * 24 * 60 * 60 * 1000

        @Volatile
        private var instance: MirroredNotificationRepository? = null

        fun get(context: Context): MirroredNotificationRepository =
            instance ?: synchronized(this) {
                instance ?: MirroredNotificationRepository(context.applicationContext)
                    .also { instance = it }
            }
    }
}
