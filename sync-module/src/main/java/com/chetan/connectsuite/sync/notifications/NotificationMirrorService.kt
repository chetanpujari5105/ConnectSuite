package com.chetan.connectsuite.sync.notifications

import android.app.Notification
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import android.util.Log
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.sync.v2.AppLabels
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.transport.ConnectionManager
import com.chetan.connectsuite.sync.v2.NotificationFeature
import com.chetan.connectsuite.sync.v2.NotificationRelay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import java.io.ByteArrayOutputStream

/**
 * Captures this device's notifications and pushes them to paired devices.
 *
 * Filtering happens here rather than on the receiving end, so an excluded app's content never
 * leaves the phone at all. Group summaries and ongoing notifications are dropped too — mirroring
 * a media-player notification that updates every second would flood the link for no benefit.
 *
 * **This service now feeds two transports.** The v1 path below is unchanged and still talks to
 * Android peers over `NetworkPacket`; the v2 path hands the same events to [NotificationRelay],
 * which is what `NotificationFeature` puts on the link to the Mac.
 *
 * One service rather than two, because Android binds the component the user enabled in Settings
 * and a second `NotificationListenerService` would need a second grant from the same screen for
 * the same feature. Asking a user to tick two boxes that mean the same thing is not a design.
 *
 * The two paths deliberately filter differently, which is the one thing to be careful about here.
 * v1 drops group summaries, ongoing notifications and low-priority ones, because it was building a
 * *feed* on another phone. v2 sends everything and marks it — `ongoing` and `groupKey` are fields
 * on the wire — because the Mac is showing a *mirror* of the shade, and a phone that decides what
 * the user may see on their own Mac has stopped being a mirror. See docs/protocol.md.
 */
class NotificationMirrorService : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var settings: SettingsStore
    private lateinit var connections: ConnectionManager
    private var commandJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        settings = SettingsStore.get(this)
        connections = ConnectionManager.get(this)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "Notification access granted")
        // The v2 half: the relay is the only thing the link can reach a bound listener through,
        // and refreshing capabilities is what turns the Mac's notifications pane on without
        // waiting for a reconnect — the same live behaviour `input` has.
        NotificationRelay.attach(this)
        NotificationFeature.refreshCapabilities()
        // A paired device can ask us to dismiss a notification it is showing in its mirror feed.
        commandJob = scope.launch {
            connections.packets.collect { routed ->
                if (routed.incoming.packet.type != PacketType.NOTIFICATION_ACTION) return@collect
                val key = routed.incoming.packet.string("key") ?: return@collect
                when (routed.incoming.packet.string("action")) {
                    ACTION_DISMISS -> runCatching { cancelNotification(key) }
                        .onFailure { Log.w(TAG, "Could not dismiss $key", it) }
                }
            }
        }
    }

    override fun onListenerDisconnected() {
        commandJob?.cancel()
        commandJob = null
        // Access revoked in Settings, or the system unbinding us. Either way the capability has to
        // go off on the Mac *now* rather than at the next handshake, or the pane stays lit over a
        // feature that has stopped working.
        NotificationRelay.detach()
        NotificationFeature.refreshCapabilities()
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // v2 first and unconditionally: it has its own filtering rules (none) and must not inherit
        // v1's settings gate, which belongs to the Android-to-Android mirror and not to the Mac.
        scope.launch { toLink(sbn) }
        scope.launch { mirror(sbn) }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        scope.launch { runCatching { NotificationRelay.onRemoved?.invoke(sbn.key) } }
        scope.launch {
            val snapshot = settings.snapshot()
            if (!snapshot.mirroringEnabled || !snapshot.notificationMirroringEnabled) return@launch

            broadcast(
                NetworkPacket.of(PacketType.NOTIFICATION_REMOVED) {
                    put("key", JsonPrimitive(sbn.key))
                },
            )
        }
    }

    /**
     * The v2 path: one notification, translated once, handed to the relay.
     *
     * Guarded because a notification with a malformed extras bundle must not take the listener
     * down — losing the service loses the capability for every Mac until Android rebinds it, which
     * is a far worse outcome than dropping one row.
     */
    private fun toLink(sbn: StatusBarNotification) {
        val sink = NotificationRelay.onPosted ?: return
        // Never mirror ourselves. A ConnectSuite notification about ConnectSuite arriving on the
        // Mac is noise at best, and our own foreground-service notice is permanent.
        if (sbn.packageName == packageName) return
        runCatching { sink(NotificationRelay.payloadFor(this, sbn)) }
            .onFailure { Log.w(TAG, "Could not put ${sbn.key} on the link", it) }
    }

    private suspend fun mirror(sbn: StatusBarNotification) {
        val snapshot = settings.snapshot()
        if (!snapshot.mirroringEnabled || !snapshot.notificationMirroringEnabled) return
        if (!shouldMirror(sbn, snapshot.excludedPackages, snapshot.includeLowPriority)) return

        val extras = sbn.notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (
            extras.getCharSequence(Notification.EXTRA_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            )?.toString().orEmpty()

        if (title.isBlank() && text.isBlank()) return

        val packet = NetworkPacket.of(PacketType.NOTIFICATION_POSTED) {
            put("key", JsonPrimitive(sbn.key))
            put("packageName", JsonPrimitive(sbn.packageName))
            put("appName", JsonPrimitive(AppLabels.of(this@NotificationMirrorService, sbn.packageName)))
            put("title", JsonPrimitive(title))
            put("text", JsonPrimitive(text))
            put("postedAt", JsonPrimitive(sbn.postTime))
            put("clearable", JsonPrimitive(sbn.isClearable.toString()))
            encodeIcon(sbn)?.let { put("icon", JsonPrimitive(it)) }
        }
        broadcast(packet)
    }

    private fun shouldMirror(
        sbn: StatusBarNotification,
        excludedPackages: Set<String>,
        includeLowPriority: Boolean,
    ): Boolean {
        // Never mirror ourselves — a mirrored notification arriving back would loop forever.
        if (sbn.packageName == packageName) return false
        if (sbn.packageName in excludedPackages) return false

        val notification = sbn.notification
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return false
        if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return false
        if (!includeLowPriority && notification.priority < Notification.PRIORITY_DEFAULT) {
            return false
        }
        return true
    }

    /** Small icon as a downscaled PNG; a full-size icon per notification is not worth the bytes. */
    private fun encodeIcon(sbn: StatusBarNotification): String? = runCatching {
        val drawable: Drawable = sbn.notification.smallIcon?.loadDrawable(this) ?: return null
        val bitmap = drawable.toBitmap(ICON_SIZE_PX, ICON_SIZE_PX)
        ByteArrayOutputStream().use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
        }
    }.getOrNull()

    private fun Drawable.toBitmap(width: Int, height: Int): Bitmap {
        if (this is BitmapDrawable && bitmap != null) {
            return bitmap.scale(width, height)
        }
        val bitmap = createBitmap(width, height)
        val canvas = Canvas(bitmap)
        setBounds(0, 0, canvas.width, canvas.height)
        draw(canvas)
        return bitmap
    }

    /** Sends to every connected device that has notification mirroring enabled for this pairing. */
    private suspend fun broadcast(packet: NetworkPacket) {
        val trustedDao = ConnectSuiteDatabase.get(this).trustedDeviceDao()
        connections.connectedDevices.value.forEach { deviceId ->
            val trusted = trustedDao.find(deviceId) ?: return@forEach
            if (!trusted.notificationMirroringEnabled) return@forEach
            connections.connectionTo(deviceId)?.send(packet)
        }
    }

    companion object {
        private const val TAG = "NotificationMirror"
        private const val ICON_SIZE_PX = 64

        const val ACTION_DISMISS = "dismiss"
    }
}
