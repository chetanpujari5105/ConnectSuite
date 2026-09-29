package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.permissions.MediaAccess
import android.content.Context
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * The photo and video browser's three read verbs — Phase 5 slice 2.
 *
 * ### All four verbs, as of slice 3
 *
 * Slice 2 shipped three of them and left `photos` deliberately unadvertised, because
 * `CapabilityContract.isImplemented` requires *every* request in a contract to have a handler and
 * `media.original` had none. Slice 3 adds the fourth **and** serves the bulk channel it runs on, so
 * the capability turns on — both halves in one moment, which is what the contract was written to
 * enforce.
 *
 * That the chip stayed grey for a slice was the mechanism working, not a defect in it. The tempting
 * fix at the time was to loosen `containsAll` to a subset check; doing so would have advertised a
 * capability over a dead verb, which is what `calls` once did across two of its four permissions.
 *
 * ### `media.original` is not a fifth transfer mechanism
 *
 * It resolves a `MediaStore` id to a `transferId` and hands it back. The bytes then move on the bulk
 * channel exactly as `fs.transfer.begin`'s will, reported by `fs.transfer.progress` and
 * `fs.transfer.done`. The only thing it does that `fs.*` cannot is address a `MediaStore` id, which
 * is the whole reason it exists as its own type rather than as a second addressing mode on `begin`.
 */
object MediaFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.MEDIA_BUCKETS,
        MessageType.MEDIA_LIST,
        MessageType.MEDIA_THUMB,
        MessageType.MEDIA_ORIGINAL,
    )

    @Volatile
    private var installed = false

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }

        // Serving the bulk channel is the other half of what turns `photos` on: the contract
        // requires every verb to have a handler **and** this socket to have a consumer, because
        // `media.original` hands back a transferId that is worthless without it. Assigning the sink
        // and registering the fourth verb in the same install is what makes the chip and the
        // feature arrive together.
        link.bulkChannelSink = { channel -> BulkTransfers.serve(channel) }
        val previousSessionEnded = link.sessionEndedSink
        link.sessionEndedSink = { session ->
            previousSessionEnded?.invoke(session)
            session.token?.let { BulkTransfers.forgetSession(it) }
        }

        link.refreshCapabilities()
        LinkLog.i(
            "media",
            "Media feature installed with all ${handledTypes.size} photos verbs and the bulk " +
                "channel served; read permission " +
                (if (granted(app)) "granted" else "not granted") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        link.bulkChannelSink = null
        link.refreshCapabilities()
    }

    /**
     * Full, selected-only, or none — read from the OS through `MediaAccess`, the one home the
     * `photos` capability and Set up Sidekick also read (defect 139).
     */
    fun access(context: Context): MediaAccess = MediaAccess.current(context)

    /**
     * True when the verbs may answer: full access, or the photos the person selected on Android 14+.
     *
     * Full still means images **and** videos, because `media.list` returns them through one list and
     * an images-only grant would be a browser with every video missing. Selected-only answers too —
     * `MediaStore` then returns exactly the chosen items — and the Mac is told it is partial through
     * the capability's `limited` reason rather than by this returning false.
     */
    fun granted(context: Context): Boolean = access(context) != MediaAccess.DENIED

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.MEDIA_BUCKETS -> MessageHandler { session, request -> onBuckets(session, request, context) }
        MessageType.MEDIA_LIST -> MessageHandler { session, request -> onList(session, request, context) }
        MessageType.MEDIA_THUMB -> MessageHandler { session, request -> onThumb(session, request, context) }
        MessageType.MEDIA_ORIGINAL -> MessageHandler { session, request -> onOriginal(session, request, context) }
        else -> error("MediaFeature.handledTypes lists $type with no handler")
    }

    private fun onBuckets(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, MediaFailure.NotGranted)
        val buckets = MediaStoreReader.buckets(context)
        delivered.incrementAndGet()
        LinkLog.i(
            "media",
            "media.buckets → ${buckets.size} buckets, " +
                "${buckets.sumOf { it["count"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0 }} items " +
                "in total — ${tally()}",
        )
        session.ack(request) {
            put("buckets", buildJsonArray { buckets.forEach { add(it) } } as JsonArray)
        }
    }

    private fun onList(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, MediaFailure.NotGranted)
        val limit = request.int("limit") ?: MediaPayloads.DEFAULT_LIMIT
        if (limit < 1 || limit > MediaPayloads.MAX_LIMIT) {
            return refuse(
                session,
                request,
                MediaFailure.BadRequest("limit must be between 1 and ${MediaPayloads.MAX_LIMIT}"),
            )
        }

        val bucketId = request.str("bucketId")
        val page = MediaStoreReader.list(
            context = context,
            bucketId = bucketId,
            limit = limit,
            beforeMs = request.long("before"),
            beforeId = request.long("beforeId"),
        )
        delivered.incrementAndGet()
        LinkLog.i(
            "media",
            "media.list bucket=${bucketId ?: "all"} → ${page.items.size} items of ${page.scanned} " +
                "scanned, hasMore=${page.hasMore}, before=${request.long("before")} " +
                "beforeId=${request.long("beforeId")} — ${tally()}",
        )
        session.ack(request) {
            if (bucketId != null) put("bucketId", bucketId)
            put("hasMore", page.hasMore)
            put("items", buildJsonArray { page.items.forEach { add(it) } } as JsonArray)
        }
    }

    private fun onThumb(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, MediaFailure.NotGranted)
        val ids = request.payload["ids"]?.let { element ->
            runCatching { element.jsonArray.map { it.jsonPrimitive.content } }.getOrNull()
        } ?: return refuse(session, request, MediaFailure.BadRequest("ids must be an array"))

        if (ids.isEmpty() || ids.size > MediaPayloads.MAX_THUMB_IDS) {
            return refuse(
                session,
                request,
                MediaFailure.BadRequest("ids must hold 1 to ${MediaPayloads.MAX_THUMB_IDS} entries"),
            )
        }
        val maxEdge = request.int("maxEdge") ?: 256
        if (maxEdge < 32 || maxEdge > MediaPayloads.MAX_THUMB_EDGE) {
            return refuse(
                session,
                request,
                MediaFailure.BadRequest("maxEdge must be between 32 and ${MediaPayloads.MAX_THUMB_EDGE}"),
            )
        }

        val thumbs = MediaStoreReader.thumbs(context, ids, maxEdge)
        delivered.incrementAndGet()
        session.ack(request) {
            put("thumbs", buildJsonArray { thumbs.forEach { add(it) } } as JsonArray)
        }
    }

    /**
     * Resolves a media id to a transfer the Mac then claims on the bulk channel.
     *
     * `sha256` is **null** here and that is deliberate rather than unfinished: hashing before
     * sending means reading the file twice, and a 4 GB video would stall this ack for the length of
     * a full read with no progress reporting. The phone digests as it streams and reports the result
     * on `fs.transfer.done`, where `verified: false` says plainly that nothing compared it against a
     * digest agreed in advance. A success nobody checked must not look like a success that was.
     */
    private fun onOriginal(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, MediaFailure.NotGranted)
        val id = request.str("id")?.toLongOrNull()
            ?: return refuse(session, request, MediaFailure.BadRequest("id is required"))

        val sessionId = session.token
            ?: return refuse(session, request, MediaFailure.BadRequest("this session has no token"))
        val pending = BulkTransfers.registerMediaPull(context, id, sessionId)
            ?: return refuse(session, request, MediaFailure.NoSuchItem(id.toString()))

        delivered.incrementAndGet()
        LinkLog.i(
            "media",
            "media.original $id → ${pending.transferId}, ${pending.size} bytes — ${tally()}",
        )
        session.ack(request) {
            put("transferId", pending.transferId)
            put("size", pending.size)
            put("mime", pending.mime)
            put("name", pending.name)
            // The digest agreed in advance at or below the pre-hash ceiling; null above it.
            put("sha256", pending.sha256)
            put("chunkMax", BulkTransfers.chunkMax())
        }
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: MediaFailure) {
        refused.incrementAndGet()
        LinkLog.w("media", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.PHOTOS,
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

/** Every way a media request can fail, each with the sentence a person reads. */
sealed class MediaFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    /**
     * Names the switch rather than the permission, and names it as one thing.
     *
     * Android 13 splits this into two grants and shows the user a single "Photos and videos"
     * toggle, so telling them to grant `READ_MEDIA_VIDEO` describes a screen that does not exist.
     */
    object NotGranted : MediaFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "This phone is not sharing its photos and videos.",
        fixHint = "On the phone: Settings > Apps > ConnectSuite > Permissions > Photos and videos, " +
            "and choose Allow.",
    )

    class NoSuchItem(what: String) : MediaFailure(
        label = "no-such-item",
        code = ErrorCode.NOT_FOUND,
        reason = "That photo is no longer on the phone.",
    )

    class BadRequest(detail: String) : MediaFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was read.",
    )
}
