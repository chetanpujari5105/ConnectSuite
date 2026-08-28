package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Watches the phone's call state and turns it into `call.incoming` and `call.ended` events.
 *
 * Android reports call state as three values — idle, ringing, off-hook — and **no identity**: the
 * callbacks say the state changed and nothing about which call it is. So the identity is minted
 * here, one id per episode, and the id is what the Mac hands back on `call.answer`/`call.reject`.
 * That is not decoration: it is the only thing standing between a stale card on the Mac and the
 * user rejecting the *next* person who rings.
 *
 * The number is only delivered on some paths. `onCallStateChanged`'s number argument was removed
 * for third-party apps in Android 10 and comes back empty; the number the Mac sees is therefore
 * looked up from the call log once the episode ends, and an in-progress call may show as an
 * unknown number until then. That is a platform limit, not a gap here — the alternative is being
 * the default dialler.
 */
object CallWatcher {

    /**
     * Ids are a counter, not a UUID, because they only have to be unique within one run of the
     * process and a short id is far easier to read in a log line next to the event it names.
     */
    private val nextId = AtomicLong(1)

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "call-watcher").apply { isDaemon = true }
    }

    @Volatile
    private var link: LinkServer? = null

    @Volatile
    private var callId: String? = null

    /** "ringing", "active", "dialing", or null when nothing is in progress. */
    @Volatile
    private var state: String? = null

    @Volatile
    private var startedAt = 0L

    /** True once the episode was answered, so `call.ended` can say answered rather than missed. */
    @Volatile
    private var answered = false

    private var callback: Any? = null

    private val episodes = AtomicLong(0)

    fun currentId(): String? = callId

    fun currentState(): String? = state

    /** The `call.incoming` payload for a call in progress, for replay-on-connect. */
    fun current(): JsonObject? {
        val id = callId ?: return null
        val live = state ?: return null
        return buildJsonObject {
            put("callId", id)
            put("number", "")
            put("startedAtMs", startedAt)
            put("state", live)
        }
    }

    fun start(context: Context, server: LinkServer) {
        if (callback != null) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            // Not an error and not retried on a timer: the grant arriving is what restarts this,
            // through CapabilityDetector's refresh path. Registering without the permission throws
            // on some OEMs and silently never fires on others, which is worse than not registering.
            LinkLog.i("calls", "Call watcher idle: READ_PHONE_STATE not granted")
            return
        }
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
        link = server

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val modern = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(newState: Int) = onState(context, newState)
            }
            callback = modern
            runCatching { telephony.registerTelephonyCallback(executor, modern) }
                .onFailure { LinkLog.w("calls", "Call watcher could not register: ${it.message}") }
        } else {
            @Suppress("DEPRECATION")
            val legacy = object : PhoneStateListener() {
                override fun onCallStateChanged(newState: Int, phoneNumber: String?) =
                    onState(context, newState)
            }
            callback = legacy
            @Suppress("DEPRECATION")
            runCatching { telephony.listen(legacy, PhoneStateListener.LISTEN_CALL_STATE) }
                .onFailure { LinkLog.w("calls", "Call watcher could not register: ${it.message}") }
        }
        LinkLog.i("calls", "Call watcher started")
    }

    fun stop(context: Context) {
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        when (val held = callback) {
            is TelephonyCallback ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    runCatching { telephony?.unregisterTelephonyCallback(held) }
                }
            is PhoneStateListener -> {
                @Suppress("DEPRECATION")
                runCatching { telephony?.listen(held, PhoneStateListener.LISTEN_NONE) }
            }
        }
        callback = null
        link = null
        callId = null
        state = null
    }

    private fun onState(context: Context, newState: Int) {
        val server = link ?: return
        when (newState) {
            TelephonyManager.CALL_STATE_RINGING -> begin(server, "ringing")
            TelephonyManager.CALL_STATE_OFFHOOK ->
                // Off-hook with no prior ringing episode is an outgoing call; off-hook *after*
                // ringing is the user answering. The two produce different `call.ended`
                // dispositions, which is why the distinction is kept rather than collapsed.
                if (state == "ringing") {
                    answered = true
                    state = "active"
                    push(server, MessageType.CALL_INCOMING) {
                        put("callId", callId.orEmpty())
                        put("number", "")
                        put("startedAtMs", startedAt)
                        put("state", "active")
                    }
                } else {
                    begin(server, "dialing")
                }
            TelephonyManager.CALL_STATE_IDLE -> end(context, server)
        }
    }

    private fun begin(server: LinkServer, phase: String) {
        val id = "c${nextId.getAndIncrement()}"
        callId = id
        state = phase
        startedAt = System.currentTimeMillis()
        answered = phase == "dialing"
        episodes.incrementAndGet()
        push(server, MessageType.CALL_INCOMING) {
            put("callId", id)
            put("number", "")
            put("startedAtMs", startedAt)
            put("state", phase)
        }
        LinkLog.i("calls", "Call $id $phase (${episodes.get()} episodes since start)")
    }

    private fun end(context: Context, server: LinkServer) {
        val id = callId ?: return
        val duration = if (startedAt > 0) System.currentTimeMillis() - startedAt else 0L
        val wasRinging = state == "ringing"
        callId = null
        state = null

        // The number is looked up here rather than carried through, because the callbacks do not
        // supply one — see the class comment. The newest call-log row is this call by construction:
        // the platform writes it as the episode ends.
        val (number, name) = newestLogged(context)

        push(server, MessageType.CALL_ENDED) {
            put("callId", id)
            put("number", number)
            name?.let { put("contactName", it) }
            put("durationMs", duration)
            put(
                "disposition",
                when {
                    answered -> "answered"
                    // Ringing straight to idle without ever going off-hook. Whether the user
                    // pressed reject or simply did not pick up is not something the platform tells
                    // a third-party app, so the call log is the only source that knows.
                    wasRinging -> loggedDisposition(context)
                    else -> "declined"
                },
            )
        }
        answered = false
        LinkLog.i("calls", "Call $id ended after ${duration}ms")
    }

    private fun newestLogged(context: Context): Pair<String, String?> {
        val (entries, _) = CallLogStore.entries(context, 1, null)
        val row = entries.firstOrNull() ?: return "" to null
        val number = row["number"]?.let { it.toString().trim('"') }.orEmpty()
        val name = row["contactName"]?.toString()?.trim('"')
        return number to name
    }

    private fun loggedDisposition(context: Context): String {
        val (entries, _) = CallLogStore.entries(context, 1, null)
        return when (entries.firstOrNull()?.get("type")?.toString()?.trim('"')) {
            "rejected" -> "rejected"
            "missed" -> "missed"
            else -> "missed"
        }
    }

    private fun push(
        server: LinkServer,
        type: String,
        build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        val payload = buildJsonObject(build)
        server.broadcast { session -> session.send(Envelope(type = type, payload = payload)) }
    }
}
