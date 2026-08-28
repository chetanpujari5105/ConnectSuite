package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
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
import kotlinx.coroutines.delay
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires SMS into the link, and by doing so turns the `sms` capability on.
 *
 * The capability needs three permissions together — `READ_SMS`, `RECEIVE_SMS` and `SEND_SMS` —
 * because the contract requires `sms.threads`, `sms.messages` **and** `sms.send`. A read-only
 * grant would advertise a messaging pane with a compose box that always fails, so
 * `CapabilityDetector` refuses to advertise it at all. `SEND_SMS` was declared in no manifest in
 * the repo until Phase 4, which is why this capability could never be granted; see
 * docs/permissions.md for that, and for the Play policy the three of them carry.
 */
object SmsFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.SMS_THREADS,
        MessageType.SMS_MESSAGES,
        MessageType.SMS_SEND,
    )

    @Volatile
    private var installed = false

    @Volatile
    private var server: LinkServer? = null

    @Volatile
    private var appContext: Context? = null

    /** Three looks at 150 ms: about as long as a provider write takes, and bounded. */
    private const val PROVIDER_LOOKS = 3
    private const val PROVIDER_LOOK_DELAY_MS = 150L

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)
    private val received = AtomicLong(0)
    private val dropped = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        appContext = app
        server = link
        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }
        link.refreshCapabilities()
        LinkLog.i(
            "sms",
            "SMS feature installed; permissions ${if (granted(app)) "granted" else "not granted"}" +
                "; telephony ${if (hasTelephony(app)) "present" else "absent"}" +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        server = null
        appContext = null
        link.refreshCapabilities()
    }

    /**
     * Pushes one `sms.received`. Called by `SmsMirrorReceiver` on the broadcast.
     *
     * Counted and logged with the tally beside it. An inbound message that never reaches the Mac
     * is exactly the silent failure this project keeps ruling out, and "0 received" on a phone
     * that got a text reads identically to "0 received" on a phone that did not — unless the
     * number of *delivered replies* is sitting next to it.
     */
    suspend fun onReceived(context: Context, address: String, body: String, dateMs: Long) {
        val link = server ?: return
        if (!granted(context)) return

        // The provider row and the broadcast are a race. We are not the default SMS app, so the
        // platform writes the row and tells us at priority 500, and the two orders are both
        // legal — on most messages the row is already there, on some it lands a moment later.
        //
        // Three short looks rather than one, because the alternative used to be shipping a
        // payload with no thread id and no message id, which is a shape docs/protocol.md does
        // not describe. The Mac dropped every one of those (defect 34).
        var built: kotlinx.serialization.json.JsonObject? = null
        var looks = 0
        while (looks < PROVIDER_LOOKS) {
            looks += 1
            built = runCatching { SmsStore.receivedPayload(context, address, body, dateMs) }
                .onFailure { LinkLog.w("sms", "Could not build sms.received: ${it.message}") }
                .getOrNull()
            if (built != null) break
            if (looks < PROVIDER_LOOKS) delay(PROVIDER_LOOK_DELAY_MS)
        }

        if (built == null) {
            dropped.incrementAndGet()
            // An `e:` line, not a `w:`, and with the denominator beside it. This is a message a
            // person received on their phone that their Mac will never be told about — the exact
            // silent failure this feature exists to rule out — and the count is what separates
            // "one unlucky race" from "the provider lookup is broken".
            LinkLog.e(
                "sms",
                "sms.received NOT pushed: no provider row for $address after $looks lookups — " +
                    "${received.get()} pushed / ${dropped.get()} dropped since start",
            )
            return
        }

        val payload = built
        received.incrementAndGet()
        link.broadcast { session -> session.send(Envelope(type = MessageType.SMS_RECEIVED, payload = payload)) }
        // The success case carries the same denominator as the failure, and the look count, so a
        // build where the retry is doing all the work is visible without a second run.
        LinkLog.i(
            "sms",
            "sms.received pushed after $looks lookup(s) — " +
                "${received.get()} pushed / ${dropped.get()} dropped since start — ${tally()}",
        )
    }

    fun granted(context: Context): Boolean =
        has(context, Manifest.permission.READ_SMS) &&
            has(context, Manifest.permission.RECEIVE_SMS) &&
            has(context, Manifest.permission.SEND_SMS)

    private fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * True when this device has a telephony radio at all.
     *
     * A tablet is not a broken phone, and `NO_TELEPHONY` says so rather than letting `SmsManager`
     * throw something unreadable. `uses-feature android.hardware.telephony required="false"` in the
     * manifest is what allows the app onto such a device in the first place.
     */
    fun hasTelephony(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY) &&
            (context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager)
                ?.simState == TelephonyManager.SIM_STATE_READY

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.SMS_THREADS -> MessageHandler { session, request -> onThreads(session, request, context) }
        MessageType.SMS_MESSAGES -> MessageHandler { session, request -> onMessages(session, request, context) }
        MessageType.SMS_SEND -> MessageHandler { session, request -> onSend(session, request, context) }
        else -> error("SmsFeature.handledTypes lists $type with no handler")
    }

    // ---- handlers -------------------------------------------------------------------------

    private fun onThreads(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, SmsFailure.NotGranted)
        val limit = limitOf(session, request) ?: return

        val (threads, hasMore) = SmsStore.threads(context, limit, request.long("before"))
        deliver(session, request, "${threads.size} threads, hasMore=$hasMore") {
            put("threads", buildJsonArray { threads.forEach { add(it) } })
            put("hasMore", hasMore)
        }
    }

    private fun onMessages(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, SmsFailure.NotGranted)
        val threadId = request.str("threadId")
            ?: return refuse(session, request, SmsFailure.BadRequest("threadId is required"))
        val limit = limitOf(session, request) ?: return
        if (!SmsStore.threadExists(context, threadId)) {
            return refuse(session, request, SmsFailure.NoSuchThread(threadId))
        }

        val (messages, hasMore) = SmsStore.messages(context, threadId, limit, request.long("before"))
        deliver(session, request, "thread $threadId, ${messages.size} messages, hasMore=$hasMore") {
            put("threadId", threadId)
            put("messages", buildJsonArray { messages.forEach { add(it) } })
            put("hasMore", hasMore)
        }
    }

    /**
     * `sms.send`, and the one place in this app where being wrong costs something unrecoverable.
     *
     * The order below is the rule from docs/protocol.md, and every step of it is load-bearing:
     * permissions, radio, body, **recipients named explicitly**, **recipients verified against the
     * thread**, and only then a single byte on the radio. Nothing is sent before the verification
     * — not even to the addresses that did match — because a partial send to a group is exactly
     * the outcome someone would have to explain afterwards.
     */
    private fun onSend(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, SmsFailure.NotGranted)
        if (!hasTelephony(context)) return refuse(session, request, SmsFailure.NoTelephony)

        val body = request.str("body")
            ?: return refuse(session, request, SmsFailure.BadRequest("body is required and must not be empty"))
        val threadId = request.str("threadId")
        val recipients = request.strings("addresses")

        // The rule's first clause: there is no shape of this message where the phone works out the
        // recipient for itself. A send carrying only a threadId used to be accepted and resolved
        // here, which is precisely the inference the rule forbids — it makes the thread the single
        // source of truth, and a single source cannot be checked against anything.
        if (recipients.isEmpty()) {
            return refuse(session, request, SmsFailure.NoRecipients)
        }

        if (threadId != null) {
            if (!SmsStore.threadExists(context, threadId)) {
                return refuse(session, request, SmsFailure.NoSuchThread(threadId))
            }
            // Read at send time, from the provider, on the side that holds the truth. The Mac
            // cannot do this check: its thread list is a copy, and a copy is exactly what goes
            // stale.
            val actual = SmsStore.addressesIn(context, threadId)
            when (val verdict = SmsRecipients.verify(recipients, actual)) {
                is SmsRecipients.Verdict.Agreed -> Unit
                is SmsRecipients.Verdict.Unverifiable ->
                    return refuse(session, request, SmsFailure.Unverifiable(threadId))
                is SmsRecipients.Verdict.Mismatch -> {
                    // Logged at error rather than warning. Every other refusal in this file is a
                    // feature declining to do something; this one is a message that was about to
                    // reach the wrong person, and it should be loud enough to investigate.
                    LinkLog.e(
                        "sms",
                        "REFUSED a send that would have gone to the wrong recipient: " +
                            "thread $threadId holds ${actual.joinToString(",")} but the request " +
                            "named ${recipients.joinToString(",")}",
                        null,
                    )
                    return refuse(session, request, SmsFailure.RecipientMismatch(verdict))
                }
            }
        }

        val manager = runCatching { smsManager(context) }.getOrNull()
            ?: return refuse(session, request, SmsFailure.NoTelephony)

        // Sent one recipient at a time and reported as one message, which is what the Mac asked
        // for. A group thread is several SMS on the wire and one row in the user's head; making
        // them reconcile that is not the Mac's job.
        val failures = mutableListOf<String>()
        recipients.forEach { address ->
            val sent = runCatching {
                // divideMessage, not a raw send: a body over 160 GSM-7 characters is several PDUs,
                // and sendTextMessage on an over-long body fails at the radio rather than
                // splitting. The Mac sends one message and is told about one message.
                val parts = manager.divideMessage(body)
                if (parts.size <= 1) {
                    manager.sendTextMessage(address, null, body, null, null)
                } else {
                    manager.sendMultipartTextMessage(address, null, parts, null, null)
                }
            }
            if (sent.isFailure) {
                failures.add("$address (${sent.exceptionOrNull()?.message ?: "no reason given"})")
            }
        }

        if (failures.isNotEmpty()) {
            return refuse(session, request, SmsFailure.SendRefused(failures.joinToString("; ")))
        }

        // Looked up after the send, because the provider assigns the thread. It can still be null
        // on the first message to a new number — the write is asynchronous — and an absent
        // threadId is honest where a fabricated one would be a token the Mac gets NOT_FOUND for.
        val resolved = threadId ?: SmsStore.threadIdFor(context, recipients.first())
        deliver(session, request, "to ${recipients.size} verified recipient(s)") {
            resolved?.let { put("threadId", it) }
            put("recipients", recipients.size)
        }
    }

    // ---- plumbing -------------------------------------------------------------------------

    @Suppress("DEPRECATION")
    private fun smsManager(context: Context): SmsManager =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }

    /** The shared limit check, so all three list requests refuse the same way. */
    private fun limitOf(session: ControlSession, request: Envelope): Int? {
        val limit = request.int("limit") ?: SmsStore.DEFAULT_LIMIT
        if (limit < 1 || limit > SmsStore.MAX_LIMIT) {
            refuse(session, request, SmsFailure.BadRequest("limit must be between 1 and ${SmsStore.MAX_LIMIT}"))
            return null
        }
        return limit
    }

    private fun deliver(
        session: ControlSession,
        request: Envelope,
        what: String,
        build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
    ) {
        delivered.incrementAndGet()
        LinkLog.i("sms", "${request.type} delivered ($what) — ${tally()}")
        session.ack(request, build)
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: SmsFailure) {
        refused.incrementAndGet()
        LinkLog.w("sms", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.SMS,
            fixHint = failure.fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()

    private fun Envelope.long(key: String): Long? =
        payload[key]?.jsonPrimitive?.content?.toLongOrNull()

    private fun Envelope.strings(key: String): List<String> =
        runCatching {
            payload[key]?.jsonArray?.mapNotNull { it.jsonPrimitive.content.takeIf(String::isNotBlank) }
        }.getOrNull().orEmpty()

}

/** Every way an SMS request can fail, each with the sentence a person reads. */
sealed class SmsFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    object NotGranted : SmsFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "This phone is not sharing its text messages.",
        fixHint = "On the phone: Settings > Apps > ConnectSuite > Permissions > SMS, and choose " +
            "Allow. Reading and sending are one permission group, so both arrive together.",
    )

    /**
     * No radio, or no SIM.
     *
     * A separate code from `PERMISSION_DENIED` because nothing the user does in Settings will fix
     * it, and a fix hint that sends them to a permissions screen they have already granted is
     * worse than no hint at all.
     */
    object NoTelephony : SmsFailure(
        label = "no-telephony",
        code = ErrorCode.NO_TELEPHONY,
        reason = "This device cannot send text messages — it has no mobile network or no SIM.",
    )

    class NoSuchThread(threadId: String) : SmsFailure(
        label = "no-such-thread",
        code = ErrorCode.NOT_FOUND,
        reason = "That conversation is no longer on the phone.",
        fixHint = "It may have been deleted. Refresh the list on this Mac. (thread $threadId)",
    )

    /**
     * A send that did not say who it was for.
     *
     * Its own failure rather than a general [BadRequest] because it is the rule being enforced
     * rather than a field being missing, and the fix hint has to say so: the answer is not "add a
     * field", it is "resolve the recipient from the thread you are sending into".
     */
    object NoRecipients : SmsFailure(
        label = "no-recipients",
        code = ErrorCode.BAD_REQUEST,
        reason = "That message did not say who it was for, so nothing was sent.",
        fixHint = "Every message names its recipients as well as its conversation, so the phone " +
            "can check the two agree before it sends anything.",
    )

    /**
     * A thread the phone cannot read the recipients of, so the pair could not be checked.
     *
     * Refused rather than trusted. "We could not check" must never resolve to "send it anyway" —
     * that is the one substitution this whole rule exists to prevent.
     */
    class Unverifiable(threadId: String) : SmsFailure(
        label = "unverifiable",
        code = ErrorCode.RECIPIENT_MISMATCH,
        reason = "The phone could not confirm who that conversation is with, so it did not send " +
            "the message.",
        fixHint = "Start the message from the conversation on the phone, or send it to the " +
            "number directly. (thread $threadId)",
    )

    /**
     * The named recipients are not the thread's recipients. Nothing was sent to anyone.
     *
     * The only failure in this app that reports a prevented harm rather than a refused
     * convenience. The sentence names the numbers rather than describing the problem abstractly,
     * because the user is the only one who can recognise which of them is the stranger.
     */
    class RecipientMismatch(verdict: SmsRecipients.Verdict.Mismatch) : SmsFailure(
        label = "recipient-mismatch",
        code = ErrorCode.RECIPIENT_MISMATCH,
        reason = "That message was not sent: ${verdict.describe()}.",
        fixHint = "Nothing was sent to anyone. This Mac's conversation list may be out of date — " +
            "refresh it and try again.",
    )

    class BadRequest(detail: String) : SmsFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was sent.",
    )

    /**
     * The radio took it and refused it.
     *
     * Distinct from every permission and shape problem above because it is the only one where the
     * message genuinely might have gone partly out — a multi-recipient send that failed on the
     * third address sent the first two. The detail names which, so the user can see what happened
     * rather than being told "sending failed" about a message two people already have.
     */
    class SendRefused(detail: String) : SmsFailure(
        label = "send-refused",
        code = ErrorCode.SEND_FAILED,
        reason = "The phone's mobile network refused that message: $detail.",
        fixHint = "Check signal on the phone and try again.",
    )
}
