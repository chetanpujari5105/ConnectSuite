package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
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
 * ### What this slice deliberately does not do
 *
 * `media.original` is **not** here. It resolves a `MediaStore` id to a transfer that runs on the
 * bulk channel, and nothing serves that channel yet, so it belongs to slice 3 alongside the Mac's
 * first bulk client.
 *
 * The consequence is that **the `photos` capability stays unavailable through this slice, and that
 * is the expected outcome rather than an unfinished job.** `CapabilityContract.isImplemented`
 * requires *all* of a capability's requests to have handlers, and photos' contract names four. The
 * Mac's Photos pane therefore stays grey and says why.
 *
 * The tempting fix is to loosen that `containsAll` to a subset check so the chip goes green with
 * three verbs live. That check is the one mechanism preventing a capability being advertised over
 * dead verbs, and it exists because `calls` was once advertised on two of the four permissions its
 * own messages needed. `slice 2 leaves photos unavailable` in `CapabilityPermissionTest` is that
 * decision written as a test, so nobody has to rediscover the argument.
 */
object MediaFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.MEDIA_BUCKETS,
        MessageType.MEDIA_LIST,
        MessageType.MEDIA_THUMB,
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
        link.refreshCapabilities()
        LinkLog.i(
            "media",
            "Media feature installed with ${handledTypes.size} of photos' 4 verbs " +
                "(media.original is slice 3); read permission " +
                (if (granted(app)) "granted" else "not granted") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        link.refreshCapabilities()
    }

    /**
     * True when the OS would let us read images **and** videos.
     *
     * Both, on API 33+, because `media.list` returns them through one list: a build that accepted
     * images alone would serve a browser with every video missing and nothing saying so. This
     * mirrors `CapabilityContract`'s photos alternatives, and the two agree by construction —
     * `Capabilities` derives the advertised answer from the contract, and this is the same question
     * asked locally at request time.
     */
    fun granted(context: Context): Boolean {
        val required = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return required.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.MEDIA_BUCKETS -> MessageHandler { session, request -> onBuckets(session, request, context) }
        MessageType.MEDIA_LIST -> MessageHandler { session, request -> onList(session, request, context) }
        MessageType.MEDIA_THUMB -> MessageHandler { session, request -> onThumb(session, request, context) }
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

    class BadRequest(detail: String) : MediaFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was read.",
    )
}
