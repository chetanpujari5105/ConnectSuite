package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires calls into the link, and by doing so turns the `calls` capability on.
 *
 * ### Call audio never leaves the phone
 *
 * This is the first thing to know about this file, because it is the first thing anyone asks of
 * it. `CAPTURE_AUDIO_OUTPUT` is system-only and recording a call through an AccessibilityService
 * violates Play policy, so answering from the Mac answers the call **on the phone** and the user
 * talks through the phone or through a Bluetooth headset. It is a platform wall, it is in
 * `CLAUDE.md`, and no message here will ever carry audio. The feature is a remote control for the
 * phone's dialler, not a softphone.
 *
 * ### Four permissions, one capability
 *
 * The contract requires `call.log`, `call.dial`, `call.answer` and `call.reject`, and those need
 * `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE` and `ANSWER_PHONE_CALLS` between them.
 * `CapabilityDetector` gates on all four together. It used to gate on the first two, which would
 * have turned the Mac's pane green with three of the four verbs unable to work — the capability
 * contract checks that a *handler* is registered, not that the permission behind it exists, so
 * nothing else would have caught it.
 */
object CallFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.CALL_LOG,
        MessageType.CALL_DIAL,
        MessageType.CALL_ANSWER,
        MessageType.CALL_REJECT,
    )

    @Volatile
    private var installed = false

    @Volatile
    private var server: LinkServer? = null

    @Volatile
    private var appContext: Context? = null

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        appContext = app
        server = link

        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }

        // A ringing call is state, not history, so a Mac that connects mid-call is told about it —
        // the replay-on-connect rule from docs/protocol.md. Without it the Mac shows nothing while
        // the phone is audibly ringing, which is the worst possible moment to look broken.
        link.addSessionReadyListener(::replayTo)

        CallWatcher.start(app, link)
        link.refreshCapabilities()
        LinkLog.i(
            "calls",
            "Calls feature installed; permissions ${if (granted(app)) "granted" else "not granted"}" +
                "; telephony ${if (hasTelephony(app)) "present" else "absent"}" +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        appContext?.let { CallWatcher.stop(it) }
        link.removeSessionReadyListener(::replayTo)
        handledTypes.forEach(link::unregister)
        server = null
        appContext = null
        link.refreshCapabilities()
    }

    fun granted(context: Context): Boolean =
        has(context, Manifest.permission.READ_CALL_LOG) &&
            has(context, Manifest.permission.READ_PHONE_STATE) &&
            has(context, Manifest.permission.CALL_PHONE) &&
            has(context, Manifest.permission.ANSWER_PHONE_CALLS)

    private fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun hasTelephony(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)

    private fun replayTo(session: ControlSession) {
        val context = appContext ?: return
        if (!granted(context)) return
        val live = CallWatcher.current() ?: return
        session.send(Envelope(type = MessageType.CALL_INCOMING, payload = live))
        LinkLog.i("calls", "Replayed a call in progress to ${session.peerName}")
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.CALL_LOG -> MessageHandler { session, request -> onLog(session, request, context) }
        MessageType.CALL_DIAL -> MessageHandler { session, request -> onDial(session, request, context) }
        MessageType.CALL_ANSWER -> MessageHandler { session, request -> onAnswer(session, request, context) }
        MessageType.CALL_REJECT -> MessageHandler { session, request -> onReject(session, request, context) }
        else -> error("CallFeature.handledTypes lists $type with no handler")
    }

    // ---- handlers -------------------------------------------------------------------------

    private fun onLog(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, CallFailure.NotGranted)
        val limit = request.int("limit") ?: CallLogStore.DEFAULT_LIMIT
        if (limit < 1 || limit > CallLogStore.MAX_LIMIT) {
            return refuse(
                session,
                request,
                CallFailure.BadRequest("limit must be between 1 and ${CallLogStore.MAX_LIMIT}"),
            )
        }

        val (entries, hasMore) = CallLogStore.entries(context, limit, request.long("before"))
        delivered.incrementAndGet()
        LinkLog.i("calls", "call.log → ${entries.size} entries, hasMore=$hasMore — ${tally()}")
        session.ack(request) {
            put("entries", buildJsonArray { entries.forEach { add(it) } })
            put("hasMore", hasMore)
        }
    }

    private fun onDial(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, CallFailure.NotGranted)
        if (!hasTelephony(context)) return refuse(session, request, CallFailure.NoTelephony)
        val number = request.str("number")
            ?: return refuse(session, request, CallFailure.BadRequest("number is required"))

        val telecom = telecom(context)
            ?: return refuse(session, request, CallFailure.NoTelephony)

        // Defect 35. Android reports no identity at all for an outgoing call — not through the
        // callback, not through PHONE_STATE — so the card was labelled with nothing. This Mac
        // asked for this number a millisecond ago and is the one machine that certainly knows it,
        // so it is handed to the watcher rather than looked for somewhere it will never be.
        //
        // Before placeCall, not after: the OFFHOOK transition can land inside the call, and an
        // episode minted before this line would carry the blank all over again.
        CallWatcher.expectOutgoing(number)

        // placeCall, not ACTION_DIAL. The protocol says this places the call rather than opening
        // the dialler with the number typed in, and the Mac is required to confirm before sending
        // it — there is no second chance on the phone, and a mis-click that rings someone is not
        // something an "are you sure" on the phone could catch, because nobody is holding it.
        val placed = runCatching {
            telecom.placeCall(Uri.fromParts("tel", number, null), null)
        }
        if (placed.isFailure) {
            // Nothing was dialled, so nothing should be labelled with it. Without this, a refused
            // dial would put its number on whichever call rang next.
            CallWatcher.forgetOutgoing()
            return refuse(
                session,
                request,
                CallFailure.TelecomRefused("dial", placed.exceptionOrNull()?.message ?: "no reason given"),
            )
        }
        deliver(session, request, "dialled $number")
    }

    private fun onAnswer(session: ControlSession, request: Envelope, context: Context) {
        val telecom = ready(session, request, context) ?: return
        if (CallWatcher.currentState() != "ringing") {
            return refuse(session, request, CallFailure.NothingRinging("answer"))
        }
        if (!matchesRequestedCall(session, request)) return

        val answered = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                telecom.acceptRingingCall()
            } else {
                // minSdk is 29, so this branch is unreachable. It is here because the API's own
                // documentation ties it to O and leaving the version gate off would be a claim
                // this code does not get to make.
                throw UnsupportedOperationException("acceptRingingCall needs Android 8")
            }
        }
        if (answered.isFailure) {
            return refuse(
                session,
                request,
                CallFailure.TelecomRefused("answer", answered.exceptionOrNull()?.message ?: "no reason given"),
            )
        }
        deliver(session, request, "answered — audio stays on the phone")
    }

    private fun onReject(session: ControlSession, request: Envelope, context: Context) {
        val telecom = ready(session, request, context) ?: return
        if (CallWatcher.currentState() == null) {
            return refuse(session, request, CallFailure.NothingRinging("reject"))
        }
        if (!matchesRequestedCall(session, request)) return

        // Defect 36. The watcher derives the disposition from the state transition, which cannot
        // tell a reject from a call left to ring out — so it reported `rejected` as `missed` and
        // the call log the user read afterwards disagreed with what they had just done.
        //
        // Set before endCall, because endCall can drive the call to idle before it returns and
        // `end()` would then read the flag before it was written. This mirrors the `answered`
        // flag, which has always been set at the moment it becomes true and has always been right.
        CallWatcher.markRejected()

        val ended = runCatching {
            @Suppress("DEPRECATION")
            telecom.endCall()
        }
        if (ended.isFailure) {
            // The call is still live and was not rejected. Leaving the flag set would mislabel
            // however it does end.
            CallWatcher.forgetRejected()
            return refuse(
                session,
                request,
                CallFailure.TelecomRefused("reject", ended.exceptionOrNull()?.message ?: "no reason given"),
            )
        }
        deliver(session, request, "rejected — the episode is flagged, so call.ended will say rejected")
    }

    // ---- plumbing -------------------------------------------------------------------------

    private fun ready(session: ControlSession, request: Envelope, context: Context): TelecomManager? {
        if (!granted(context)) {
            refuse(session, request, CallFailure.NotGranted)
            return null
        }
        if (!hasTelephony(context)) {
            refuse(session, request, CallFailure.NoTelephony)
            return null
        }
        val telecom = telecom(context)
        if (telecom == null) {
            refuse(session, request, CallFailure.NoTelephony)
            return null
        }
        return telecom
    }

    /**
     * Checks a supplied `callId` against the call that is actually in progress.
     *
     * `callId` is optional and means "whichever one is ringing" when absent. When it is supplied
     * and does not match, the request is **refused rather than applied to whatever is ringing
     * now** — docs/protocol.md says so, and the reason is the worst case: a Mac showing a stale
     * incoming-call card, the user clicking Reject on a call that already ended, and the phone
     * rejecting the *next* call instead. Silently retargeting an action to a different person is
     * the call-feature equivalent of a tap landing in the wrong app.
     */
    private fun matchesRequestedCall(session: ControlSession, request: Envelope): Boolean {
        val wanted = request.str("callId") ?: return true
        val live = CallWatcher.currentId()
        if (live != null && live == wanted) return true
        refuse(session, request, CallFailure.DifferentCall)
        return false
    }

    private fun telecom(context: Context): TelecomManager? =
        context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager

    private fun deliver(session: ControlSession, request: Envelope, what: String) {
        delivered.incrementAndGet()
        LinkLog.i("calls", "${request.type} delivered ($what) — ${tally()}")
        session.ack(request) {
            CallWatcher.currentId()?.let { put("callId", it) }
        }
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: CallFailure) {
        refused.incrementAndGet()
        LinkLog.w("calls", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.CALLS,
            fixHint = failure.fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()

    private fun Envelope.long(key: String): Long? =
        payload[key]?.jsonPrimitive?.content?.toLongOrNull()
}

/** Every way a call request can fail, each with the sentence a person reads. */
sealed class CallFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    object NotGranted : CallFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "This phone is not sharing its calls.",
        fixHint = "On the phone: Settings > Apps > ConnectSuite > Permissions, and allow Phone " +
            "and Call logs. Calls need both, plus permission to answer.",
    )

    object NoTelephony : CallFailure(
        label = "no-telephony",
        code = ErrorCode.NO_TELEPHONY,
        reason = "This device cannot make or answer calls — it has no mobile network.",
    )

    class NothingRinging(verb: String) : CallFailure(
        label = "nothing-ringing",
        code = ErrorCode.NO_ACTIVE_CALL,
        reason = "There is no call to $verb — the phone is not ringing and no call is in progress.",
        fixHint = "The call may have ended while this Mac was still showing it.",
    )

    /**
     * The Mac named a call that is not the one in progress.
     *
     * Its own failure rather than folding into [NothingRinging], because the two need different
     * words: "nothing is ringing" is confusing to read while the phone *is* ringing, and that is
     * exactly the situation this covers — a stale card on the Mac, a different call on the phone.
     */
    object DifferentCall : CallFailure(
        label = "different-call",
        code = ErrorCode.NO_ACTIVE_CALL,
        reason = "That was aimed at a call the phone has already finished, so it was not applied " +
            "to the one happening now.",
        fixHint = "This Mac was showing an older call. It has been updated — try again.",
    )

    class BadRequest(detail: String) : CallFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was sent.",
    )

    class TelecomRefused(verb: String, detail: String) : CallFailure(
        label = "telecom-refused",
        code = ErrorCode.FEATURE_UNAVAILABLE,
        reason = "The phone's dialler refused to $verb that call ($detail).",
    )
}
