package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
 * ### Where the number comes from, which is not where it looks like it should
 *
 * `TelephonyCallback.CallStateListener.onCallStateChanged(int)` — the API 31+ path this class
 * registers — has **no number parameter at all**. There is nothing to read there and no permission
 * that adds one. The legacy `PhoneStateListener` overload does take a `String`, but it is
 * deprecated, unused above API 30, and returns empty to third-party apps anyway.
 *
 * The number for an **inbound** call is delivered through the `android.intent.action.PHONE_STATE`
 * broadcast's `EXTRA_INCOMING_NUMBER`, and only to a receiver holding `READ_CALL_LOG` — which this
 * app does, because the `calls` capability gates on all four call permissions together. That
 * broadcast is registered in [start] and torn down in [stop].
 *
 * The number for an **outgoing** call arrives from the other direction entirely: `call.dial` knows
 * the number it just dialled, and hands it here through [expectOutgoing] before it places the
 * call. Android reports no identity for an outgoing call on any path, so the Mac is the only
 * machine that knows, and it is the one that asked.
 *
 * A genuinely withheld number is still possible — a private caller, an OEM that declines to fill
 * the extra — and produces an empty string, which the Mac renders as "Unknown number". The count
 * of episodes with and without a number is logged together so that case stays distinguishable
 * from a broken lookup.
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

    /**
     * True once a `call.reject` has been issued for this episode.
     *
     * Defect 36. Without it a rejected call was reported as `missed`, because the state transition
     * alone cannot tell "the user pressed reject" from "the user let it ring out" — and the fix
     * that was in the tree read the disposition back out of the call log afterwards, which is a
     * race: `call.ended` is emitted from the transition and the provider row may not be written
     * yet. It worked in testing and returned `missed` on hardware, which is exactly the failure
     * mode a racy read has.
     *
     * The watcher knows why the call ended at the moment it ends. This is that fact, recorded
     * where it is known, mirroring the [answered] flag one field up that has always worked.
     */
    @Volatile
    private var rejectRequested = false

    /**
     * The number for the episode in progress, or "" when the platform withheld one.
     *
     * Filled from the PHONE_STATE broadcast for an inbound call and from [expectOutgoing] for a
     * dialled one. See the class comment for why neither is the callback's own argument.
     */
    @Volatile
    private var number: String = ""

    /** The name for [number] when contacts can supply one. Resolved once per episode, not per push. */
    @Volatile
    private var contactName: String? = null

    private var callback: Any? = null

    private var phoneStateReceiver: BroadcastReceiver? = null

    private val episodes = AtomicLong(0)

    /** Episodes that carried a number, beside the ones that did not. A count needs a denominator. */
    private val episodesWithNumber = AtomicLong(0)

    fun currentId(): String? = callId

    fun currentState(): String? = state

    /** The `call.incoming` payload for a call in progress, for replay-on-connect. */
    fun current(): JsonObject? {
        val id = callId ?: return null
        val live = state ?: return null
        return incoming(id, live)
    }

    /**
     * The one place a `call.incoming` payload is built.
     *
     * It was built in three places with `put("number", "")` hardcoded in each, which is how defect
     * 35 stayed invisible: fixing one site would have left the other two blank, and the card the
     * user saw came from whichever fired.
     */
    private fun incoming(id: String, phase: String): JsonObject = buildJsonObject {
        put("callId", id)
        put("number", number)
        contactName?.let { put("contactName", it) }
        put("startedAtMs", startedAt)
        put("state", phase)
    }

    /**
     * Told by `call.dial` what it is about to dial, before it dials it.
     *
     * Before rather than after, because the OFFHOOK transition can beat `placeCall`'s return —
     * [begin] would then mint the episode with nothing to put in it. `CallFeature.onDial` clears
     * this again if the dial throws, so a refused dial does not label the next call.
     */
    fun expectOutgoing(dialled: String) {
        number = dialled
    }

    /** Undoes [expectOutgoing] when the dial never happened. */
    fun forgetOutgoing() {
        if (state == null) number = ""
    }

    /**
     * Told by `call.reject` that the end of this episode is a rejection, before it ends it.
     *
     * Before, for the same reason as [expectOutgoing]: `telecom.endCall()` can drive the call to
     * idle inside the call, so a flag set afterwards would be set after [end] had already read it.
     */
    fun markRejected() {
        rejectRequested = true
    }

    /** Undoes [markRejected] when the reject was refused by telecom and the call is still live. */
    fun forgetRejected() {
        rejectRequested = false
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
        registerPhoneState(context)
        LinkLog.i("calls", "Call watcher started")
    }

    /**
     * The inbound number, which the state callback does not carry — see the class comment.
     *
     * Registered at runtime rather than in the manifest. `ACTION_PHONE_STATE_CHANGED` is an
     * implicit broadcast, so a manifest receiver would be subject to the background restrictions
     * and would wake the app when nothing is watching; this one lives exactly as long as the
     * watcher that reads it. `RECEIVER_NOT_EXPORTED` because the sender is the system.
     *
     * `EXTRA_INCOMING_NUMBER` is filled only for a receiver holding `READ_CALL_LOG`, which the
     * `calls` capability already requires all of, so it is populated whenever the pane is lit.
     */
    private fun registerPhoneState(context: Context) {
        if (phoneStateReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
                @Suppress("DEPRECATION")
                val incoming = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                // Only ever fills a blank. An outgoing call's number came from `call.dial` and
                // this broadcast carries no number for it — an empty extra must not erase it.
                if (!incoming.isNullOrBlank() && number.isBlank()) number = incoming
            }
        }
        val filter = IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
        runCatching {
            ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        }.onSuccess {
            phoneStateReceiver = receiver
            LinkLog.i("calls", "Watching PHONE_STATE for the inbound number")
        }.onFailure {
            // Said out loud rather than swallowed: every inbound card will read "Unknown number"
            // from here on, and that is a specific reason rather than a silent blank.
            LinkLog.w("calls", "Could not watch PHONE_STATE; inbound calls will have no number: ${it.message}")
        }
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
        phoneStateReceiver?.let { held ->
            runCatching { context.unregisterReceiver(held) }
                .onFailure { LinkLog.w("calls", "PHONE_STATE receiver was already gone: ${it.message}") }
        }
        phoneStateReceiver = null
        callback = null
        link = null
        callId = null
        state = null
        number = ""
        contactName = null
        rejectRequested = false
        answered = false
    }

    private fun onState(context: Context, newState: Int) {
        val server = link ?: return
        when (newState) {
            TelephonyManager.CALL_STATE_RINGING -> begin(context, server, "ringing")
            TelephonyManager.CALL_STATE_OFFHOOK ->
                // Off-hook with no prior ringing episode is an outgoing call; off-hook *after*
                // ringing is the user answering. The two produce different `call.ended`
                // dispositions, which is why the distinction is kept rather than collapsed.
                if (state == "ringing") {
                    answered = true
                    state = "active"
                    push(server, MessageType.CALL_INCOMING, incoming(callId.orEmpty(), "active"))
                } else {
                    begin(context, server, "dialing")
                }
            TelephonyManager.CALL_STATE_IDLE -> end(context, server)
        }
    }

    private fun begin(context: Context, server: LinkServer, phase: String) {
        val id = "c${nextId.getAndIncrement()}"
        callId = id
        state = phase
        startedAt = System.currentTimeMillis()
        answered = phase == "dialing"
        rejectRequested = false
        // An inbound call's number came from the PHONE_STATE broadcast, which fires alongside this
        // transition; an outgoing one's came from `call.dial` before it dialled. Either way it is
        // in the field by now, and this is the one moment worth paying a contacts lookup for.
        contactName = number.takeIf { it.isNotBlank() }?.let { ContactsFeature.nameFor(context, it) }
        episodes.incrementAndGet()
        if (number.isNotBlank()) episodesWithNumber.incrementAndGet()

        push(server, MessageType.CALL_INCOMING, incoming(id, phase))

        // The success case and the failure case at the same volume, with the denominator on both.
        // Defect 35 was found in this line reading "from ," — a blank where a number belongs — and
        // a bare episode count could not have said whether that was one private caller or every
        // call on the device.
        val who = when {
            contactName != null -> "from $number ($contactName)"
            number.isNotBlank() -> "from $number, no contact name"
            else -> "number withheld by the platform"
        }
        LinkLog.i(
            "calls",
            "Call $id $phase $who — ${episodesWithNumber.get()} of ${episodes.get()} episodes " +
                "with a number since start",
        )
    }

    private fun end(context: Context, server: LinkServer) {
        val id = callId ?: return
        val duration = if (startedAt > 0) System.currentTimeMillis() - startedAt else 0L
        val wasRinging = state == "ringing"
        val wasAnswered = answered
        val wasRejected = rejectRequested
        callId = null
        state = null

        // The number this episode carried, falling back to the call log only when the platform
        // withheld one live. The log row *is* safe to read here — unlike the disposition, which is
        // not, see dispositionOf — because it is written as the episode ends and this is after.
        val logged = if (number.isBlank() || contactName == null) newestLogged(context) else null
        val endedNumber = number.ifBlank { logged?.first.orEmpty() }
        val endedName = contactName ?: logged?.second

        val disposition = dispositionOf(wasAnswered, wasRejected, wasRinging)

        push(server, MessageType.CALL_ENDED) {
            put("callId", id)
            put("number", endedNumber)
            endedName?.let { put("contactName", it) }
            put("durationMs", duration)
            put("disposition", disposition)
        }
        answered = false
        rejectRequested = false
        number = ""
        contactName = null
        LinkLog.i("calls", "Call $id ended $disposition after ${duration}ms")
    }

    /**
     * How the episode ended, from what this object knew while it was happening.
     *
     * Pure and internal so it can be tested without a phone: the four branches are the whole of
     * defect 36 and they are not otherwise reachable off-device.
     *
     * **Order matters, and `answered` wins.** The Mac's one button says "Reject" while ringing and
     * "Hang up" once the call is active, so a `call.reject` arrives for both. A call that
     * connected and talked for forty seconds is not a rejected call, whatever ended it — so
     * `rejected` only ever wins over `missed`, never over `answered`.
     *
     * **What this deliberately does not do is ask the call log.** That was the shape in the tree
     * until this fix, and it was not a hypothetical wrong answer: it shipped, and it is what
     * reported a call rejected from the Mac as `missed` on hardware. `call.ended` is emitted from
     * the state transition and the provider row may not be written yet, so the read returns the
     * previous call's row, or nothing. It looks authoritative — the platform's own value — and it
     * is a race that passes in testing and fails under load.
     */
    internal fun dispositionOf(answered: Boolean, rejected: Boolean, wasRinging: Boolean): String = when {
        answered -> "answered"
        rejected -> "rejected"
        // Ringing straight to idle with no reject from us: the user let it ring out, or rejected
        // it on the phone itself. The platform does not tell a third-party app which, and
        // `missed` is the honest answer for both.
        wasRinging -> "missed"
        else -> "declined"
    }

    private fun newestLogged(context: Context): Pair<String, String?> {
        val (entries, _) = CallLogStore.entries(context, 1, null)
        val row = entries.firstOrNull() ?: return "" to null
        val number = row["number"]?.let { it.toString().trim('"') }.orEmpty()
        val name = row["contactName"]?.toString()?.trim('"')
        return number to name
    }

    private fun push(
        server: LinkServer,
        type: String,
        build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) = push(server, type, buildJsonObject(build))

    private fun push(server: LinkServer, type: String, payload: JsonObject) {
        server.broadcast { session -> session.send(Envelope(type = type, payload = payload)) }
    }
}
