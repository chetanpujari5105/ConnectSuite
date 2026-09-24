package com.chetan.connectsuite.sync.v2

import android.content.Context
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * Feature A's offer, on the phone — slice 2 of `docs/phase-7-share-plan.md`, docs/protocol.md →
 * Share. It owns the live offers, answers `share.respond` and `share.cancel`, expires offers nobody
 * answered, and deletes each offer's staged copy when the offer ends, whatever ended it.
 *
 * **In slice 2 nothing in the product calls [offerStaged].** The one caller is the debug-only
 * `ShareOfferProbeActivity`, with a synthetic staged file. An ordinary share still stops at *Ready*
 * with Send disabled; wiring Send to this is a later, separately approved step.
 *
 * ### What it will not do
 *
 * It never offers on a session that did not negotiate `share.file` — an old Mac never receives an
 * event it would drop, and the phone never waits for an answer that cannot come. It keeps at most
 * one live offer per session. It logs the offer id, byte count, reasons and a running tally; never
 * the file's name, a path or a URI.
 */
object ShareFeature {

    sealed interface OfferOutcome {
        data class Offered(val offerId: String, val expiresAtMs: Long) : OfferOutcome
        data object NoSession : OfferOutcome
        data class NotNegotiated(val macName: String) : OfferOutcome
        data object Busy : OfferOutcome
        data class Invalid(val why: String) : OfferOutcome
    }

    private val handledTypes = listOf(MessageType.SHARE_RESPOND, MessageType.SHARE_CANCEL)
    private val lock = Any()
    private val offers = HashMap<String, ShareOffer.Offer>()
    private val sessions = HashMap<String, ControlSession>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var link: LinkServer? = null
    @Volatile private var cacheDir: File? = null
    @Volatile private var installed = false

    private val offered = AtomicInteger()
    private val declined = AtomicInteger()
    private val expired = AtomicInteger()
    private val cancelled = AtomicInteger()
    private val sessionEnded = AtomicInteger()
    private fun tally() = "${offered.get()} offered / ${declined.get()} declined / ${expired.get()} expired / " +
        "${cancelled.get()} cancelled / ${sessionEnded.get()} ended with the session"

    fun install(context: Context, server: LinkServer) {
        if (installed) return
        installed = true
        link = server
        cacheDir = context.applicationContext.cacheDir
        handledTypes.forEach { type -> server.register(type, handlerFor(type)) }
        val previous = server.sessionEndedSink
        server.sessionEndedSink = { session ->
            previous?.invoke(session)
            onSessionEnded(session)
        }
        server.refreshCapabilities()
        LinkLog.i("share", "Share feature installed (${handledTypes.size} verbs); capabilities now: ${server.capabilities.current().sorted()}")
    }

    /**
     * Offer a file that is **already staged** under [offerId] (the staging attempt id is the offer id,
     * so the staged file and the offer cannot be mismatched). The caller keeps ownership of the staged
     * copy when the outcome is not [OfferOutcome.Offered]; after that, this object deletes it.
     */
    fun offerStaged(offerId: String, bytes: Long, sha256: String, name: String, mime: String, ttlMs: Long = ShareOffer.TTL_MS): OfferOutcome {
        val server = link ?: return OfferOutcome.NoSession
        if (!ShareStaging.isAttemptId(offerId)) return OfferOutcome.Invalid("offer id is not an attempt id")
        if (bytes < 0 || !sha256.matches(Regex("^[0-9a-f]{64}$"))) return OfferOutcome.Invalid("size or digest out of rule")
        if (name.isEmpty() || name.toByteArray(Charsets.UTF_8).size > 255) return OfferOutcome.Invalid("name out of rule")
        if (mime.length > 127 || !mime.matches(Regex("^[^/\\s]+/[^/\\s]+$"))) return OfferOutcome.Invalid("mime out of rule")
        require(ttlMs in 1..ShareOffer.TTL_MS) { "an offer lives at most ${ShareOffer.TTL_MS} ms" }

        val session = server.anyLiveSession() ?: return OfferOutcome.NoSession.also {
            LinkLog.i("share", "offer $offerId not made: no Mac connected — ${tally()}")
        }
        if (session.negotiated[Extensions.SHARE_FILE] == null) {
            LinkLog.i("share", "offer $offerId not made: ${session.peerName} did not negotiate ${Extensions.SHARE_FILE} — nothing sent, nothing awaited")
            return OfferOutcome.NotNegotiated(session.peerName)
        }
        val key = session.token ?: return OfferOutcome.NoSession
        val now = System.currentTimeMillis()
        val offer = ShareOffer.Offer(offerId, key, bytes, sha256, now, now + ttlMs)
        synchronized(lock) {
            if (offers.values.any { it.sessionKey == key }) {
                LinkLog.i("share", "offer $offerId not made: another offer is live on this session")
                return OfferOutcome.Busy
            }
            offers[offerId] = offer
            sessions[offerId] = session
        }
        session.event(MessageType.SHARE_OFFER) {
            put("offerId", offerId)
            put("rootId", "share:$offerId")
            put("from", server.identity.deviceName.take(128))
            putJsonObject("item") {
                put("itemId", "0")
                put("name", name)
                put("mime", mime)
                put("size", bytes)
                put("sha256", sha256)
            }
            put("expiresAtMs", offer.expiresAtMs)
        }
        offered.incrementAndGet()
        LinkLog.i("share", "offered $offerId to ${session.peerName}: $bytes bytes, expires in ${ttlMs / 1000}s — ${tally()}")
        scope.launch {
            delay(ttlMs)
            transition(offerId) { ShareOffer.expire(it, System.currentTimeMillis()) }
        }
        return OfferOutcome.Offered(offerId, offer.expiresAtMs)
    }

    /** The phone ends its own live offer (`user` or `staging-lost`). */
    fun cancel(offerId: String, reason: String) {
        transition(offerId) { ShareOffer.cancelFromPhone(it, reason) }
    }

    /** For the debug probe and tests: the state of an offer this object still holds, or null once ended. */
    fun liveOffer(offerId: String): ShareOffer.Offer? = synchronized(lock) { offers[offerId] }

    private fun handlerFor(type: String) = MessageHandler { session, request -> handle(type, session, request) }

    private fun handle(type: String, session: ControlSession, request: Envelope) {
        val p = request.payload
        fun str(k: String) = (p[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val offerId = str("offerId")
        val key = session.token ?: ""
        val now = System.currentTimeMillis()
        val result = synchronized(lock) {
            val current = offerId?.let { offers[it] }
            val r = when (type) {
                MessageType.SHARE_RESPOND -> ShareOffer.respond(current, key, offerId, str("decision"), str("reason"), now)
                else -> ShareOffer.cancelFromMac(current, key, offerId, str("reason"), now)
            }
            store(r)
            r
        }
        when (val reply = result.reply) {
            is ShareOffer.Reply.Ack -> session.ack(request) {
                reply.fields.forEach { (k, v) ->
                    when (v) {
                        is String -> put(k, v)
                        is Boolean -> put(k, v)
                        else -> put(k, v.toString())
                    }
                }
            }
            is ShareOffer.Reply.Error -> session.sendError(request.id, reply.code, reply.message, feature = Capability.SHARE)
            null -> Unit
        }
        LinkLog.i("share", "$type ${offerId ?: "(no id)"} from ${session.peerName}: " +
            when (val r = result.reply) {
                is ShareOffer.Reply.Ack -> "ack ${r.fields}"
                is ShareOffer.Reply.Error -> "${r.code} — ${r.message}"
                null -> "no reply"
            })
        apply(result)
    }

    private fun onSessionEnded(session: ControlSession) {
        val key = session.token ?: return
        val ids = synchronized(lock) { offers.values.filter { it.sessionKey == key }.map { it.offerId } }
        ids.forEach { id -> transition(id) { ShareOffer.sessionEnded(it, key) } }
    }

    private fun transition(offerId: String, step: (ShareOffer.Offer) -> ShareOffer.Result) {
        val result = synchronized(lock) {
            val current = offers[offerId] ?: return
            step(current).also { store(it) }
        }
        apply(result)
    }

    /** Under [lock]: a live offer stays in the map; an ended one leaves it (answer-once). */
    private fun store(r: ShareOffer.Result) {
        val o = r.offer ?: return
        if (o.state == ShareOffer.State.Offered) offers[o.offerId] = o else offers.remove(o.offerId)
    }

    /** Outside the lock: the effects of an ending, in the order the protocol names them. */
    private fun apply(r: ShareOffer.Result) {
        val o = r.offer ?: return
        if (r.effects.isEmpty()) return
        val session = synchronized(lock) { if (o.state == ShareOffer.State.Offered) sessions[o.offerId] else sessions.remove(o.offerId) }
        r.effects.forEach { effect ->
            when (effect) {
                is ShareOffer.Effect.SendCancel -> session?.event(MessageType.SHARE_CANCEL) {
                    put("offerId", o.offerId)
                    put("reason", effect.reason)
                }
                ShareOffer.Effect.DeleteStaged -> {
                    val dir = cacheDir?.let { ShareStaging.stagingDir(it) }
                    val removed = if (dir != null) ShareStaging.discard(dir, o.offerId) else 0
                    LinkLog.i("share", "offer ${o.offerId} ended (${describe(o.state)}): staged copy deleted, $removed file(s)")
                }
            }
        }
        when (o.state) {
            is ShareOffer.State.Declined -> declined.incrementAndGet()
            ShareOffer.State.Expired -> expired.incrementAndGet()
            is ShareOffer.State.Cancelled -> cancelled.incrementAndGet()
            ShareOffer.State.SessionEnded -> sessionEnded.incrementAndGet()
            ShareOffer.State.Offered -> Unit
        }
        if (o.state != ShareOffer.State.Offered) LinkLog.i("share", "offer ${o.offerId} is ${describe(o.state)} — ${tally()}")
    }

    fun describe(state: ShareOffer.State): String = when (state) {
        ShareOffer.State.Offered -> "offered"
        is ShareOffer.State.Declined -> "declined (${state.reason})"
        ShareOffer.State.Expired -> "expired"
        is ShareOffer.State.Cancelled -> "cancelled by the ${state.by.name.lowercase()} (${state.reason})"
        ShareOffer.State.SessionEnded -> "ended with the session"
    }
}
