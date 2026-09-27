package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.content.pm.ApplicationInfo
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Feature A's offer and transfer, on the phone — docs/protocol.md → Share. It owns the live offers,
 * answers `share.respond`, `share.cancel` and `share.saved`, serves the one pull a `share:` root
 * permits (routed here by `FsFeature` through [ShareRoot]), runs the expiry, verdict and Retry
 * timers, and deletes each offer's staged copy when the offer ends, whatever ended it.
 *
 * ### What is live
 *
 * **The phone advertises `share.file` 2** to every trusted Mac ([Extensions.PRODUCTION_TRANSFER], on
 * since slice 3e passed on hardware). A transfer runs only where the Mac advertises 2 as well. **Two
 * callers make offers**: the debug-only, `DUMP`-gated `ShareOfferProbeActivity` (synthetic bytes,
 * `requireAsk = false`), and the share sheet's `ShareToMacModel` (an ordinary file,
 * `requireAsk = true`), which offers only on a session that also negotiated `share.ask` — a Mac that
 * holds every offer for a person's Accept.
 *
 * ### What it will not do
 *
 * Offer on a session that did not negotiate `share.file`; keep more than one live offer per session;
 * stream anything but the staged private copy; call anything "saved" but a `share.saved {ok:true}`
 * from the Mac; log a file name, a path or a URI.
 */
object ShareFeature {

    sealed interface OfferOutcome {
        data class Offered(val offerId: String, val expiresAtMs: Long) : OfferOutcome
        data object NoSession : OfferOutcome
        data class NotNegotiated(val macName: String) : OfferOutcome
        /**
         * The session already holds its limit of live offers (1 at version 2), so none was made. [other] is that offer as it stands, so
         * the sheet can say *which* file is waiting and offer to withdraw it — never a silent no-op.
         */
        data class Busy(val other: ShareOffer.Offer) : OfferOutcome
        data class Invalid(val why: String) : OfferOutcome
    }

    private val handledTypes = listOf(MessageType.SHARE_RESPOND, MessageType.SHARE_CANCEL, MessageType.SHARE_SAVED)
    private val lock = Any()
    private val offers = HashMap<String, ShareOffer.Offer>()
    private val sessions = HashMap<String, ControlSession>()
    /** Debug only: a corruption byte armed for the next pull of one offer. */
    private val armedCorruption = ConcurrentHashMap<String, Long>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    /** The held-copy check's loop; started with the first live offer, and ends — under [lock] — with the last. */
    private var heldCopyCheck: Job? = null
    private val heldCopiesChecked = AtomicInteger()
    private val heldCopiesLost = AtomicInteger()
    @Volatile private var link: LinkServer? = null
    @Volatile private var cacheDir: File? = null
    @Volatile private var debuggable = false
    @Volatile private var installed = false

    /**
     * The last known form of each recent offer, **including ended ones**, for the share sheet to draw.
     * [liveOffer] forgets an offer the moment it ends, which is right for answer-once and wrong for a
     * screen that has to say how it ended. Memory only, the newest [VIEWS_KEPT].
     */
    private val _views = MutableStateFlow<Map<String, ShareOffer.Offer>>(emptyMap())
    val views: StateFlow<Map<String, ShareOffer.Offer>> = _views.asStateFlow()
    private const val VIEWS_KEPT = 16

    private fun publish(o: ShareOffer.Offer) {
        _views.update { m -> (m - o.offerId + (o.offerId to o)).entries.toList().takeLast(VIEWS_KEPT).associate { it.key to it.value } }
    }

    /** Offers still live, whose staged copies this object owns — the staging sweeps must skip them. */
    fun liveOfferIds(): Set<String> = synchronized(lock) { offers.keys.toSet() }

    /**
     * What the sheet's admission ([ShareAdmission.forCopy]) needs, read together: the `share.file`
     * negotiated on the live session (0 with none), and `Σ`, the bytes of every staged copy this object
     * owns for a live offer. With no session there is no live offer (they end with it), so `Σ` is 0.
     */
    /** The live session, for [offerStaged]'s `onlyOnSession` and a caller's reference comparison — nothing else. */
    fun liveSession(): Any? = link?.anyLiveSession()

    fun stagingContext(): Pair<Int, Long> {
        val version = link?.anyLiveSession()?.negotiated?.get(Extensions.SHARE_FILE) ?: 0
        val held = synchronized(lock) { offers.values.sumOf { it.bytes } }
        return version to held
    }

    /**
     * The live offers accepted on the Mac and not yet ended — queued, receiving or checking
     * ([ShareOffer.inProgress]) — and the bytes of their staged copies, read together. Only the
     * several-files stall clock (development only) reads it.
     */
    fun inProgress(): Pair<Int, Long> = synchronized(lock) {
        val accepted = offers.values.filter { ShareOffer.inProgress(it.state) }
        accepted.size to accepted.sumOf { it.bytes }
    }

    private val offered = AtomicInteger()
    private val declined = AtomicInteger()
    private val saved = AtomicInteger()
    private val failed = AtomicInteger()
    private val expired = AtomicInteger()
    private val cancelled = AtomicInteger()
    private val sessionEnded = AtomicInteger()
    private fun tally() = "${offered.get()} offered / ${saved.get()} saved / ${declined.get()} declined / " +
        "${failed.get()} failed attempts / ${expired.get()} expired / ${cancelled.get()} cancelled / " +
        "${sessionEnded.get()} ended with the session"

    fun install(context: Context, server: LinkServer) {
        if (installed) return
        installed = true
        link = server
        cacheDir = context.applicationContext.cacheDir
        debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        handledTypes.forEach { type -> server.register(type, handlerFor(type)) }
        val previous = server.sessionEndedSink
        server.sessionEndedSink = { session ->
            previous?.invoke(session)
            onSessionEnded(session)
        }
        server.refreshCapabilities()
        LinkLog.i("share", "Share feature installed (${handledTypes.size} verbs, advertising share.file " +
            "${Extensions.advertised(debuggable, devV2Armed = false)[Extensions.SHARE_FILE]} unarmed, production transfer " +
            "${Extensions.PRODUCTION_TRANSFER}); capabilities now: ${server.capabilities.current().sorted()}")
    }

    // ---- making an offer (debug probe only in this slice) -------------------------------------------

    /**
     * Offer a file that is **already staged** under [offerId] (the staging attempt id is the offer id,
     * so the staged file and the offer cannot be mismatched). The caller keeps ownership of the staged
     * copy when the outcome is not [OfferOutcome.Offered]; after that, this object deletes it.
     */
    fun offerStaged(
        offerId: String, bytes: Long, sha256: String, name: String, mime: String, ttlMs: Long = ShareOffer.TTL_MS,
        /**
         * An **ordinary** share — one a person chose in the share sheet — must be offered only where
         * [Extensions.ordinarySend] holds (`share.file` ≥ 2 and `share.ask`). The debug synthetic probe
         * passes false: it is not an ordinary share, and it exists to reach the synthetic-only Mac.
         */
        requireAsk: Boolean = false,
        /**
         * Offer only on this session (compared by reference, from [liveSession]); on any other — a
         * reconnect since the file was prepared — nothing is offered and the outcome is `NoSession`.
         * Null (every caller before the several-files screen) offers on whichever session is live.
         */
        onlyOnSession: Any? = null,
    ): OfferOutcome {
        val server = link ?: return OfferOutcome.NoSession
        if (!ShareStaging.isAttemptId(offerId)) return OfferOutcome.Invalid("offer id is not an attempt id")
        if (bytes < 0 || !sha256.matches(Regex("^[0-9a-f]{64}$"))) return OfferOutcome.Invalid("size or digest out of rule")
        if (name.isEmpty() || name.toByteArray(Charsets.UTF_8).size > 255) return OfferOutcome.Invalid("name out of rule")
        if (mime.length > 127 || !mime.matches(Regex("^[^/\\s]+/[^/\\s]+$"))) return OfferOutcome.Invalid("mime out of rule")
        require(ttlMs in 1..ShareOffer.TTL_MS) { "an offer lives at most ${ShareOffer.TTL_MS} ms" }

        val session = server.anyLiveSession() ?: return OfferOutcome.NoSession.also {
            LinkLog.i("share", "offer $offerId not made: no Mac connected — ${tally()}")
        }
        if (onlyOnSession != null && session !== onlyOnSession) {
            LinkLog.i("share", "offer $offerId not made: the session it was prepared for has ended and a later one is live — nothing sent")
            return OfferOutcome.NoSession
        }
        if (session.negotiated[Extensions.SHARE_FILE] == null) {
            LinkLog.i("share", "offer $offerId not made: ${session.peerName} did not negotiate ${Extensions.SHARE_FILE} — nothing sent, nothing awaited")
            return OfferOutcome.NotNegotiated(session.peerName)
        }
        if (requireAsk && !Extensions.ordinarySend(session.negotiated)) {
            LinkLog.i("share", "offer $offerId not made: an ordinary share needs share.file 2 and share.ask, and " +
                "${session.peerName} negotiated ${session.negotiated} — nothing sent, nothing awaited")
            return OfferOutcome.NotNegotiated(session.peerName)
        }
        val key = session.token ?: return OfferOutcome.NoSession
        val now = System.currentTimeMillis()
        val offer = ShareOffer.Offer(offerId, key, bytes, sha256, now, now + ttlMs, name = name, mime = mime)
        synchronized(lock) {
            val maxLive = if ((session.negotiated[Extensions.SHARE_FILE] ?: 0) >= ShareOffer.QUEUE_VERSION) ShareOffer.MAX_LIVE_OFFERS_V3 else 1
            ShareOffer.busyWith(offers.values, key, maxLive)?.let { other ->
                LinkLog.i("share", "offer $offerId not made: this session holds its limit of $maxLive live offer(s) " +
                    "(the oldest ${other.offerId}, ${ShareOffer.describe(other.state)}); this file stays prepared and the sheet says so")
                return OfferOutcome.Busy(other)
            }
            offers[offerId] = offer
            sessions[offerId] = session
            publish(offer)
        }
        session.event(MessageType.SHARE_OFFER) {
            put("offerId", offerId)
            put("rootId", ShareRoot.PREFIX + offerId)
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
        ensureHeldCopyCheck()
        LinkLog.i("share", "offered $offerId to ${session.peerName}: $bytes bytes, expires in ${ttlMs / 1000}s, " +
            "negotiated share.file ${session.negotiated[Extensions.SHARE_FILE]} — ${tally()}")
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

    /**
     * **Debug builds only.** Flip byte [atByte] of the next pull of [offerId], after the phone's digest
     * has taken the true value, so the Mac's checksum branch can be reached with synthetic bytes. It
     * refuses in a non-debuggable build, applies to that one offer's next pull only, and writes an `E`
     * line whenever it is armed. Its one caller is the `DUMP`-gated debug `ShareOfferProbeActivity`.
     */
    fun debugArmCorruption(offerId: String, atByte: Long): Boolean {
        if (!debuggable) {
            LinkLog.w("share", "debug corruption refused for $offerId: this build is not debuggable")
            return false
        }
        if (atByte < 0) {
            armedCorruption.remove(offerId)
            return false
        }
        armedCorruption[offerId] = atByte
        LinkLog.e("share", "PROBE: byte $atByte of the next pull of $offerId will be flipped AFTER the phone's digest " +
            "takes it. The Mac must report checksum and publish nothing. Debug build only.")
        return true
    }

    /** For the probe and tests: an offer this object still holds, or null once it has ended. */
    fun liveOffer(offerId: String): ShareOffer.Offer? = synchronized(lock) { offers[offerId] }

    // ---- requests ------------------------------------------------------------------------------

    private fun handlerFor(type: String) = MessageHandler { session, request -> handle(type, session, request) }

    private fun handle(type: String, session: ControlSession, request: Envelope) {
        val p = request.payload
        fun str(k: String) = (p[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun bool(k: String) = (p[k] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
        fun long(k: String) = (p[k] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
        val offerId = str("offerId")
        val key = session.token ?: ""
        val now = System.currentTimeMillis()
        val version = session.negotiated[Extensions.SHARE_FILE] ?: 0
        val result = synchronized(lock) {
            val current = offerId?.let { offers[it] }
            val r = when (type) {
                MessageType.SHARE_RESPOND -> ShareOffer.respond(
                    current, key, offerId, str("decision"), str("reason"), now, version,
                    stagedIntact = str("decision") != "accept" || (current != null && stagedIntact(current)),
                )
                MessageType.SHARE_SAVED -> ShareOffer.saved(current, key, offerId, bool("ok"), long("bytes"), bool("verified"), str("savedAs"), str("reason"), now)
                else -> ShareOffer.cancelFromMac(current, key, offerId, str("reason"), now)
            }
            store(r)
            r
        }
        reply(session, request, result.reply)
        LinkLog.i("share", "$type ${offerId ?: "(no id)"} from ${session.peerName}: ${describeReply(result.reply)}")
        apply(result)
    }

    /**
     * `fs.transfer.begin` on a share root, handed over by `FsFeature` after [ShareRoot.route]. The
     * staged copy is checked first: gone or the wrong length means the offer ends as `staging-lost`.
     */
    fun onBeginPull(session: ControlSession, request: Envelope, offerId: String) {
        val itemId = (request.payload["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val key = session.token ?: ""
        val now = System.currentTimeMillis()
        val transferId = ShareRoot.newTransferId()
        val result = synchronized(lock) {
            val current = offers[offerId]
            val candidate = current?.takeIf { it.sessionKey == key && it.offerId == offerId }
            val other = ShareOffer.pullInFlight(offers.values, key, offerId)
            val r = if (other != null) {
                // Version 3 rule 2: one share pull per session at a time. Unreachable at version 2.
                ShareOffer.Result(current, ShareOffer.Reply.Error(ErrorCode.BAD_REQUEST, "Another share pull is live on this session"), emptyList())
            } else if (candidate != null && ShareOffer.isLive(candidate.state) && !stagedIntact(candidate)) {
                ShareOffer.cancelFromPhone(candidate, "staging-lost").copy(
                    reply = ShareOffer.Reply.Error(ErrorCode.NOT_FOUND, ShareOffer.STAGING_LOST_MESSAGE),
                )
            } else {
                ShareOffer.beginPull(current, key, offerId, itemId, transferId, now, BulkTransfers.chunkMax())
            }
            store(r)
            r
        }
        reply(session, request, result.reply)
        LinkLog.i("share", "fs.transfer.begin share:$offerId item=${itemId ?: "(none)"} from ${session.peerName}: ${describeReply(result.reply)}")
        apply(result)
    }

    /** `fs.transfer.cancel` naming a share transfer (`ts-…`): only its own session may stop it. */
    fun onPullCancel(session: ControlSession, request: Envelope) {
        val transferId = (request.payload["transferId"] as? JsonPrimitive)?.content ?: ""
        val key = session.token ?: ""
        val result = synchronized(lock) {
            val current = offers.values.firstOrNull { it.transferId == transferId }
            ShareOffer.cancelPull(current, key, transferId).also { store(it) }
        }
        reply(session, request, result.reply)
        LinkLog.i("share", "fs.transfer.cancel $transferId from ${session.peerName}: ${describeReply(result.reply)}")
        apply(result)
    }

    private fun reply(session: ControlSession, request: Envelope, reply: ShareOffer.Reply?) {
        when (reply) {
            is ShareOffer.Reply.Ack -> session.ack(request) {
                reply.fields.forEach { (k, v) ->
                    when (v) {
                        null -> put(k, JsonNull)
                        is String -> put(k, v)
                        is Boolean -> put(k, v)
                        is Int -> put(k, v)
                        is Long -> put(k, v)
                        else -> put(k, v.toString())
                    }
                }
            }
            is ShareOffer.Reply.Error -> session.sendError(request.id, reply.code, reply.message, feature = Capability.SHARE)
            null -> Unit
        }
    }

    private fun describeReply(r: ShareOffer.Reply?) = when (r) {
        is ShareOffer.Reply.Ack -> "ack ${r.fields.filterKeys { it != "name" }}"
        is ShareOffer.Reply.Error -> "${r.code} — ${r.message}"
        null -> "no reply"
    }

    // ---- transitions and their effects --------------------------------------------------------

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
        publish(o)
        if (ShareOffer.isLive(o.state)) offers[o.offerId] = o else offers.remove(o.offerId)
    }

    /** Outside the lock: the effects, in the order the transition names them. */
    private fun apply(r: ShareOffer.Result) {
        val o = r.offer ?: return
        if (r.effects.isEmpty()) return
        val session = synchronized(lock) { if (ShareOffer.isLive(o.state)) sessions[o.offerId] else sessions.remove(o.offerId) }
        r.effects.forEach { effect ->
            when (effect) {
                is ShareOffer.Effect.SendCancel -> session?.event(MessageType.SHARE_CANCEL) {
                    put("offerId", o.offerId)
                    put("reason", effect.reason)
                }
                is ShareOffer.Effect.CancelPull -> BulkTransfers.cancel(effect.transferId, "share offer ended")
                is ShareOffer.Effect.RegisterPull -> registerPull(o, effect.transferId)
                is ShareOffer.Effect.ScheduleVerdictDeadline -> schedule(o.offerId, effect.atMs) { ShareOffer.verdictDeadline(it, System.currentTimeMillis()) }
                is ShareOffer.Effect.ScheduleRetryClose -> schedule(o.offerId, effect.atMs) { ShareOffer.retryWindowClosed(it, System.currentTimeMillis()) }
                is ShareOffer.Effect.ScheduleQueueEnd -> schedule(o.offerId, effect.atMs) { ShareOffer.expire(it, System.currentTimeMillis()) }
                ShareOffer.Effect.DeleteStaged -> {
                    armedCorruption.remove(o.offerId)
                    val dir = cacheDir?.let { ShareStaging.stagingDir(it) }
                    val removed = if (dir != null) ShareStaging.discard(dir, o.offerId) else 0
                    LinkLog.i("share", "offer ${o.offerId} ended (${describe(o.state)}): staged copy deleted, $removed file(s)")
                }
            }
        }
        when (o.state) {
            is ShareOffer.State.Declined -> declined.incrementAndGet()
            is ShareOffer.State.Saved -> saved.incrementAndGet()
            is ShareOffer.State.Failed -> failed.incrementAndGet()
            ShareOffer.State.Expired -> expired.incrementAndGet()
            is ShareOffer.State.Cancelled -> cancelled.incrementAndGet()
            ShareOffer.State.SessionEnded -> sessionEnded.incrementAndGet()
            else -> Unit
        }
        LinkLog.i("share", "offer ${o.offerId} is ${describe(o.state)} — ${tally()}")
    }

    private fun registerPull(o: ShareOffer.Offer, transferId: String) {
        val dir = cacheDir?.let { ShareStaging.stagingDir(it) } ?: return
        val staged = File(dir, "${o.offerId}.bin")
        BulkTransfers.registerSharePull(
            transferId = transferId, name = o.name, mime = o.mime, size = o.bytes, sha256 = o.sha256,
            sessionToken = o.sessionKey, open = { FileInputStream(staged) },
            debugCorruptAtByte = armedCorruption.remove(o.offerId),
            onEnded = { end -> transition(o.offerId) { ShareOffer.pullEnded(it, transferId, end, System.currentTimeMillis()) } },
        )
    }

    private fun schedule(offerId: String, atMs: Long, step: (ShareOffer.Offer) -> ShareOffer.Result) {
        scope.launch {
            delay((atMs - System.currentTimeMillis()).coerceAtLeast(0))
            transition(offerId, step)
        }
    }

    /** The staged copy is still there and still the offered length (the digest is checked while streaming). */
    private fun stagedIntact(o: ShareOffer.Offer): Boolean =
        // Looked at, never created: a missing staging folder means the copy is gone (ShareHeldCopies).
        ShareHeldCopies.intact(cacheDir?.let { File(it, ShareStaging.DIR_NAME) }, o)

    /**
     * **The held-copy check** ([ShareOffer.stagingCheck]): every [HELD_COPY_CHECK_MS] while any offer is
     * live, each waiting offer's staged copy is looked at; one that is gone or the wrong length ends its
     * offer as `staging-lost` at once, and the Mac is told — instead of both sides showing a file as
     * waiting until a pull finds it missing. Android may clear this app's cache at any time; this is how
     * that becomes visible. Starting and stopping are decided under [lock], with the offer map, so a new
     * offer cannot slip past a loop that is just ending.
     */
    private fun ensureHeldCopyCheck() {
        synchronized(lock) {
            if (heldCopyCheck != null) return
            heldCopyCheck = scope.launch {
                while (true) {
                    delay(HELD_COPY_CHECK_MS)
                    val ids = synchronized(lock) {
                        if (offers.isEmpty()) { heldCopyCheck = null; null } else offers.keys.toList()
                    } ?: break
                    ids.forEach { id ->
                        transition(id) { o ->
                            val r = ShareHeldCopies.check(cacheDir?.let { File(it, ShareStaging.DIR_NAME) }, o)
                            heldCopiesChecked.incrementAndGet()
                            if (r.offer?.state != o.state) {
                                LinkLog.w("share", "held-copy check: offer $id's staged copy is gone or not ${o.bytes} bytes — ending it as staging-lost " +
                                    "(${heldCopiesLost.incrementAndGet()} lost of ${heldCopiesChecked.get()} checked this run)")
                            }
                            r
                        }
                    }
                }
            }
        }
    }

    fun describe(state: ShareOffer.State): String = ShareOffer.describe(state)

    /** How often a waiting offer's staged copy is looked at. Not a storage value: a detection interval. */
    private const val HELD_COPY_CHECK_MS = 30_000L
}
