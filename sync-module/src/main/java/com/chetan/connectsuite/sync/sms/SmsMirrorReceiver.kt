package com.chetan.connectsuite.sync.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.transport.ConnectionManager
import com.chetan.connectsuite.sync.v2.SmsFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * Mirrors incoming SMS to paired devices.
 *
 * Android-to-Android and Android-to-desktop only. There is no iOS path here and there cannot be
 * one: Apple's sandbox gives third-party apps no access to Messages on either end, so an iPhone
 * can neither send its texts to this app nor display texts this app sends. That is an OS-level
 * restriction, not a gap in this implementation.
 *
 * **This receiver now feeds two transports.** The v1 path is unchanged and still gated on the v1
 * per-device settings; the v2 path hands the same message to [SmsFeature], which puts `sms.received`
 * on the link to the Mac. The two are ordered v2-first and are independent: v2 must not inherit
 * v1's settings gate, because those toggles belong to the Android-to-Android mirror and say
 * nothing about whether the user wants messages on their Mac.
 */
class SmsMirrorReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }
            .getOrNull()
            ?.filterNotNull()
            ?: return
        if (messages.isEmpty()) return

        // Multipart messages arrive as several parts of one logical message.
        val sender = messages.first().displayOriginatingAddress.orEmpty()
        val timestamp = messages.first().timestampMillis
        val body = messages.joinToString("") { it.displayMessageBody.orEmpty() }
        if (body.isBlank()) return

        val appContext = context.applicationContext
        val pendingResult = goAsync()

        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                // v2 first, and guarded on its own: a failure putting this on the link must not
                // stop the v1 mirror, and vice versa. Its own permission check lives inside.
                //
                // It suspends: the provider row for an inbound message is written by the platform
                // and may land after this broadcast, so `onReceived` looks for it up to three
                // times. `goAsync()` above is what buys the time — without it the receiver would
                // be torn down mid-wait.
                runCatching { SmsFeature.onReceived(appContext, sender, body, timestamp) }
                    .onFailure { Log.w(TAG, "Could not put SMS on the link", it) }

                val settings = SettingsStore.get(appContext).snapshot()
                if (!settings.mirroringEnabled || !settings.smsMirroringEnabled) return@launch

                val packet = NetworkPacket.of(PacketType.SMS_RECEIVED) {
                    put("sender", JsonPrimitive(sender))
                    put("body", JsonPrimitive(body))
                    put("timestamp", JsonPrimitive(timestamp))
                }

                val connections = ConnectionManager.get(appContext)
                val trustedDao = ConnectSuiteDatabase.get(appContext).trustedDeviceDao()

                connections.connectedDevices.value.forEach { deviceId ->
                    val trusted = trustedDao.find(deviceId) ?: return@forEach
                    // SMS is opt-in per device on top of the global toggle.
                    if (!trusted.smsMirroringEnabled) return@forEach
                    connections.connectionTo(deviceId)?.send(packet)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not mirror SMS", e)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private companion object {
        const val TAG = "SmsMirrorReceiver"
    }
}
