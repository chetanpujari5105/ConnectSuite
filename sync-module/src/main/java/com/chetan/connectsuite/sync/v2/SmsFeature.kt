package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

    /**
     * The reason string that marks a look we expect to succeed.
     *
     * A provider observer fires for reads, deletes and status changes as well as for writes, so
     * most looks legitimately find nothing new and must not be counted as drops. A look that
     * followed our own send is the one where finding nothing is a real failure — the Mac's thread
     * will be missing the message it just sent — and only that one gets an `e:` line.
     */
    private const val AFTER_SEND = "after our own send"

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)
    private val received = AtomicLong(0)
    private val dropped = AtomicLong(0)
    /**
     * Defect 51. Replaces `sentPushed` + `sentDropped`, which could not represent the thing that
     * actually happens: an after-send look that is early, and an observer that delivers it a moment
     * later. See [SentPushTally].
     */
    private val sentTally = SentPushTally()

    /**
     * The id of the newest outgoing row already pushed, so one write seen three times pushes once.
     *
     * Seeded at install from whatever the provider already holds, because the alternative is
     * replaying the user's entire sent history to the Mac the moment the link comes up.
     */
    @Volatile
    private var lastSentId: String? = null

    private var sentObserver: ContentObserver? = null

    /**
     * One push at a time. The observer can fire on several threads for one write, and `sms.send`
     * kicks a look of its own, so without this two coroutines can both read the same new row
     * before either records it and the Mac gets the message twice.
     */
    private val sentLock = Mutex()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        appContext = app
        server = link
        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }
        watchSentMailbox(app)
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
        appContext?.let { app ->
            sentObserver?.let { runCatching { app.contentResolver.unregisterContentObserver(it) } }
        }
        sentObserver = null
        lastSentId = null
        server = null
        appContext = null
        link.refreshCapabilities()
    }

    /**
     * Watch the sent mailbox, so a message typed on the handset reaches the Mac — defect 44.
     *
     * `sms.received` rides an inbound broadcast; **there is no outgoing equivalent**, and that
     * absence was the whole of defect 44: nothing in this repo observed outgoing rows, so a message
     * typed on the phone was invisible to the Mac until an unrelated refresh happened to redraw the
     * thread. `registerContentObserver` appeared nowhere outside `Capabilities.kt`.
     *
     * Registered on the whole `sms` table rather than on `content://sms/sent`, with `notifyForDescendants`,
     * because the platform notifies on the row's own URI and a message moves *into* the sent box
     * (outbox → sent) rather than being written there. Filtering to `type = sent` happens at read
     * time in [SmsStore.newestSentRow], which is where the truth is anyway.
     *
     * Seeded before registering. A fresh observer with no high-water mark treats the newest row in
     * the user's history as new and pushes it, and a Mac that lights up with last Tuesday's message
     * every time the app restarts is worse than one that misses nothing.
     */
    private fun watchSentMailbox(context: Context) {
        if (!granted(context)) {
            LinkLog.i("sms", "Not watching the sent mailbox: SMS permissions not granted")
            return
        }
        lastSentId = runCatching { SmsStore.newestSentRow(context)?.id }.getOrNull()
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                scope.launch { pushNewestSent(context, "provider change") }
            }
        }
        runCatching {
            context.contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer)
        }.onSuccess {
            sentObserver = observer
            LinkLog.i(
                "sms",
                "Watching the sent mailbox for outgoing messages; newest already-sent row is " +
                    "${lastSentId ?: "none"} and will not be pushed",
            )
        }.onFailure {
            // Named as the user-visible consequence, not as an API failure. "registerContentObserver
            // threw" tells the next reader nothing about what stopped working.
            LinkLog.w(
                "sms",
                "Could not watch the sent mailbox; messages typed on the phone will not reach " +
                    "the Mac until the thread is reopened: ${it.message}",
            )
        }
    }

    /**
     * Push `sms.sent` for the newest outgoing row, if it is one the Mac has not been told about.
     *
     * Defects **39** and **44** in one mechanism, which is why it is an event and not a richer ack:
     * an ack only answers the client that asked, so a message typed on the handset would still
     * never appear, and a Mac that is one of two would silently diverge.
     *
     * The retry is defect 34's, unchanged and deliberately not a new one — three looks at 150 ms.
     * The provider write is asynchronous and `onSend` already documents that; the answer is to look
     * again for a fact, never to sleep and assume. A delay before re-reading is the shape this
     * codebase has rejected four times and it is not being introduced here through a side door.
     */
    private suspend fun pushNewestSent(context: Context, why: String) {
        val link = server ?: return
        if (!granted(context)) return
        sentLock.withLock {
            var found: Pair<kotlinx.serialization.json.JsonObject, String>? = null
            var looks = 0
            while (looks < PROVIDER_LOOKS) {
                looks += 1
                found = runCatching { SmsStore.sentPayload(context, lastSentId) }
                    .onFailure { LinkLog.w("sms", "Could not build sms.sent: ${it.message}") }
                    .getOrNull()
                if (found != null) break
                if (looks < PROVIDER_LOOKS) delay(PROVIDER_LOOK_DELAY_MS)
            }

            val hit = found
            if (hit == null) {
                // Not necessarily a failure: an observer fires for reads, deletes and status
                // changes too, and most of those genuinely have no new outgoing row behind them.
                // Only a look that followed our own send is a miss worth an `e:` line, and the
                // caller says which it was — hence `why` on the line rather than a bare count.
                if (why == AFTER_SEND) {
                    // **Not an error, and not a loss — defect 51.** The provider write is
                    // asynchronous; three looks at 150 ms can simply be early, and the content
                    // observer fires afterwards for that same row and delivers it. Measured 2 of 2
                    // on Mac-origin sends during step 71, both of which arrived.
                    //
                    // `w`, not `e`: an `E` line here said the Mac "will be missing the message",
                    // which was a prediction, and it was wrong both times it was made.
                    sentTally.missedAfterSend()
                    LinkLog.w(
                        "sms",
                        "sms.sent not found after $looks lookups following a send — the provider " +
                            "write is asynchronous, so this is deferred to the content observer " +
                            "rather than lost — ${sentTally.summary()}",
                    )
                }
                return
            }

            val (payload, id) = hit
            lastSentId = id
            val outcome = sentTally.pushedNow()
            link.broadcast { session -> session.send(Envelope(type = MessageType.SMS_SENT, payload = payload)) }
            // A recovery is named. It is the event that proves an earlier deferral was a deferral,
            // and without it the deferred count is a number nobody can interpret.
            val made = if (outcome == SentPushTally.Outcome.RECOVERED) {
                "made good an earlier deferred send"
            } else {
                "pushed"
            }
            LinkLog.i(
                "sms",
                "sms.sent $made after $looks lookup(s) ($why, row $id) — ${sentTally.summary()}",
            )
        }
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
                "sms.received NOT pushed: no provider row for the sender after $looks lookups — " +
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
                        // Counts, not numbers: the log is a file on disk. The person reads the
                        // numbers in the refusal sentence, which is where they are needed.
                        "REFUSED a send that would have gone to the wrong recipient: " +
                            "thread $threadId holds ${actual.size} address(es) and the request " +
                            "named ${recipients.size}, not the same set",
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

        // Defect 39. The ack says "the radio accepted this" and deliberately still says only that
        // — enriching it would make it a statement that can be late or wrong, and it would still
        // only reach the client that asked. The message itself arrives as `sms.sent`, which every
        // attached Mac gets, including one that did not send it.
        //
        // The observer will fire for this write too; the high-water mark means whichever gets
        // there first wins and the other finds nothing. This look exists so the Mac is not waiting
        // on a provider notification that is not guaranteed to be prompt.
        scope.launch { pushNewestSent(context, AFTER_SEND) }
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
