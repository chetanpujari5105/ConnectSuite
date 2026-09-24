package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.util.Base64
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * The file browser's read verbs — `fs.list`, `fs.stat`, `fs.mkdir`.
 *
 * ### `files` stays un-advertised while this is partial, and that is the mechanism working
 *
 * `CapabilityContract` requires **six** handlers for `files` — these three plus `fs.delete`,
 * `fs.transfer.begin` and `fs.transfer.cancel` — and a served bulk channel. Installing three of them
 * leaves the capability off and the Mac's Files pane grey. That is the four-state model's *partly
 * offering* state, exactly as `photos` sat through slice 2, and the tempting fix is the same one
 * that was refused then: loosening `containsAll` to a subset check would advertise a capability over
 * dead verbs. Do not.
 *
 * ### There is no permission here
 *
 * `Capability.FILES`'s contract names none, and that is right rather than an omission. A SAF grant
 * is not a runtime permission — there is no dialog, nothing under Settings › Permissions, and
 * nothing `checkSelfPermission` can answer. With no folders added the feature still works: it
 * returns the app-private root and a `grantHint`, which is a different sentence from
 * `PERMISSION_DENIED` and needs to stay one.
 */
object FsFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.FS_LIST,
        MessageType.FS_STAT,
        MessageType.FS_THUMB,
        MessageType.FS_MKDIR,
        MessageType.FS_DELETE,
        MessageType.FS_TRANSFER_BEGIN,
        MessageType.FS_TRANSFER_CANCEL,
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

        // Assigned here as well as in MediaFeature, and idempotently — it is the same function.
        // `files` requires a served bulk channel, and inheriting that from whichever feature
        // happened to install first is a dependency on install order that nothing states and
        // nothing checks. A capability must not be advertised because of what another feature did.
        link.bulkChannelSink = { channel -> BulkTransfers.serve(channel) }
        val previousSessionEnded = link.sessionEndedSink
        link.sessionEndedSink = { session ->
            previousSessionEnded?.invoke(session)
            session.token?.let { BulkTransfers.forgetSession(it) }
        }
        link.refreshCapabilities()

        val roots = FsRoots.all(app)
        LinkLog.i(
            "fs",
            "Files feature installed with ${handledTypes.size} of " +
                "${com.chetan.connectsuite.core.link.CapabilityContract
                    .contracts[Capability.FILES]?.requests?.size ?: 0} verbs; " +
                "${roots.size} root(s): ${roots.joinToString { it.rootId }}; " +
                "capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        link.refreshCapabilities()
    }

    /**
     * Every `fs.*` handler is wrapped by the share-root intercept, so no verb can reach Files code with
     * a `share:` root — including one added later. `FsRoots` never learns a share root exists. The rule
     * is [ShareRoot.route]; this is the one place it is applied. Non-share requests are untouched.
     */
    private fun handlerFor(type: String, context: Context): MessageHandler {
        val files = filesHandlerFor(type, context)
        return MessageHandler { session, request ->
            if (type == MessageType.FS_TRANSFER_CANCEL && ShareRoot.isShareTransfer(request.str("transferId"))) {
                ShareFeature.onPullCancel(session, request)
                return@MessageHandler
            }
            when (val route = ShareRoot.route(type, request.str("rootId"), request.str("direction"))) {
                ShareRoot.Route.NotShare -> files.handle(session, request)
                is ShareRoot.Route.SharePull -> ShareFeature.onBeginPull(session, request, route.offerId)
                ShareRoot.Route.Refuse -> {
                    LinkLog.w("fs", "${request.type} on a share root refused — a share root permits one pull only")
                    session.sendError(request.id, com.chetan.connectsuite.core.protocol.ErrorCode.NOT_FOUND,
                        "Nothing here: a shared file can only be fetched once, by the Mac it was offered to.",
                        feature = Capability.SHARE)
                }
            }
        }
    }

    private fun filesHandlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.FS_LIST -> MessageHandler { session, request -> onList(session, request, context) }
        MessageType.FS_STAT -> MessageHandler { session, request -> onStat(session, request, context) }
        MessageType.FS_THUMB -> MessageHandler { session, request -> onThumb(session, request, context) }
        MessageType.FS_MKDIR -> MessageHandler { session, request -> onMkdir(session, request, context) }
        MessageType.FS_DELETE -> MessageHandler { session, request -> onDelete(session, request, context) }
        MessageType.FS_TRANSFER_BEGIN -> MessageHandler { session, request -> onBegin(session, request, context) }
        MessageType.FS_TRANSFER_CANCEL -> MessageHandler { session, request -> onCancel(session, request) }
        else -> error("FsFeature.handledTypes lists $type with no handler")
    }

    // ---- fs.list --------------------------------------------------------------------------------

    /**
     * With no `rootId` this enumerates the roots; with one it lists a directory inside that root.
     *
     * One type, two shapes, deliberately: there is no `fs.roots`, because the inventory is fixed at
     * twelve names and adding a thirteenth to answer a question the existing one already answers is
     * how a namespace bloats.
     */
    private fun onList(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
        if (rootId == null) return onRoots(session, request, context)

        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))

        val segments = when (val path = FsPaths.splitPath(request.str("path"))) {
            is FsPaths.PathResult.Rejected -> return refuse(session, request, FsFailure.BadRequest(path.why))
            is FsPaths.PathResult.Ok -> path.segments
        }

        val limit = request.int("limit") ?: FsPaths.DEFAULT_LIMIT
        if (limit < 1 || limit > FsPaths.MAX_LIMIT) {
            return refuse(
                session,
                request,
                FsFailure.BadRequest("limit must be between 1 and ${FsPaths.MAX_LIMIT}"),
            )
        }

        val children = store.listChildren(segments)
            ?: return refuse(session, request, FsFailure.NoSuchPath(FsPaths.joinPath(segments)))

        val page = FsPaths.pageOf(
            all = children,
            cursor = FsPaths.cursorOf(request.str("afterName"), request.str("afterId")),
            limit = limit,
        )

        delivered.incrementAndGet()
        // The count beside its denominator, and the instrument's own bound beside both: `limit`
        // bounds the frame, never the work — the whole directory is read and sorted on every page,
        // because DocumentsProvider honours neither a sort order nor a limit.
        LinkLog.i(
            "fs",
            "fs.list $rootId/${FsPaths.joinPath(segments)} → ${page.entries.size} of ${page.total} " +
                "entries, hasMore=${page.hasMore}, cursor=${page.resolution} — ${tally()}",
        )
        if (page.resolution == FsPaths.CursorResolution.APPROXIMATE) {
            LinkLog.w(
                "fs",
                "fs.list cursor (${request.str("afterName")}, ${request.str("afterId")}) no longer " +
                    "exists in $rootId/${FsPaths.joinPath(segments)} — the page starts at the first " +
                    "entry after it and may repeat entries the Mac already has. It cannot skip any.",
            )
        }

        session.ack(request) {
            put("rootId", rootId)
            put("path", FsPaths.joinPath(segments))
            put("hasMore", page.hasMore)
            put(
                "entries",
                buildJsonArray {
                    page.entries.forEach { add(labelled(context, it)) }
                } as JsonArray,
            )
        }
    }

    private fun onRoots(session: ControlSession, request: Envelope, context: Context) {
        val roots = FsRoots.all(context)
        delivered.incrementAndGet()
        val granted = roots.count { it.kind == FsPaths.KIND_TREE }
        LinkLog.i(
            "fs",
            "fs.list (roots) → ${roots.size} root(s): 1 app-private and $granted granted folder(s) " +
                "— ${tally()}",
        )
        session.ack(request) {
            put(
                "roots",
                buildJsonArray {
                    roots.forEach {
                        add(FsPaths.root(it.rootId, it.label, it.kind, it.writable, it.freeBytes()))
                    }
                } as JsonArray,
            )
            // Whether this phone will receive files. It lives here rather than in the capability
            // list because `files` is one capability with two directions and the Mac draws a
            // different pane for each. A Mac that does not see this field must read it as false,
            // which is what every phone built before push shipped actually means.
            put("push", true)
            // Present only when more could be granted — which under SAF is always, because there is
            // always another folder that has not been picked.
            put("grantHint", FsRoots.GRANT_HINT)
        }
    }

    /**
     * Adds the package-id pair to an entry, but only when an app by that name is really installed.
     *
     * The discrimination is the *difference*: `AppLabels.of` returns the package id as its honest
     * fallback, so a label that comes back equal to the name means nothing resolved and this is
     * simply a folder with dots in it. Emitting `displayName` for that would be the package-id rule
     * producing exactly the sentence it exists to prevent — inventing an app where there is none.
     *
     * A fallback here is counted in `AppLabels`' own tally, which is honest: it is a lookup that
     * fell back. It is rarer than it looks, because the common app-owned directories live under
     * `Android/media`, which no app can reach.
     */
    private fun labelled(context: Context, entry: FsPaths.Entry) =
        if (!entry.dir || !FsPaths.looksLikePackageId(entry.name)) {
            FsPaths.entry(entry)
        } else {
            val label = AppLabels.of(context, entry.name)
            if (label == entry.name) FsPaths.entry(entry)
            else FsPaths.entry(entry, packageName = entry.name, displayName = label)
        }

    // ---- fs.stat --------------------------------------------------------------------------------

    private fun onStat(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val id = request.str("id")
            ?: return refuse(session, request, FsFailure.BadRequest("id is required"))
        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))

        val entry = store.statById(id) ?: return refuse(session, request, FsFailure.NoSuchEntry)
        delivered.incrementAndGet()
        LinkLog.i("fs", "fs.stat $rootId/${entry.name} → ${entry.size} bytes — ${tally()}")
        // sha256 is null and is never computed here. Digesting a 4 GB video to answer a stat would
        // block the control channel for a minute with nothing to report progress on.
        session.ack(request) { FsPaths.stat(entry).forEach { (k, v) -> put(k, v) } }
    }

    // ---- fs.thumb -------------------------------------------------------------------------------

    /**
     * Batched thumbnails for `fs.*` ids.
     *
     * **A per-item `error`, never a failed ack.** One unreadable file in a batch of 32 must not lose
     * the other 31, and the commonest per-item answer is not a failure at all: most files are not
     * images, so `NO_THUMBNAIL` is what a `.txt`, an `.apk` and a directory get. It is kept distinct
     * from `NOT_FOUND` (the id is gone) because those want two different sentences on screen.
     *
     * The whole request is refused only for things that make the batch meaningless: a missing
     * `rootId`, a root whose grant is gone, or more ids than the protocol's cap.
     */
    private fun onThumb(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val ids = request.payload["ids"]?.let { element ->
            runCatching { element.jsonArray.map { it.jsonPrimitive.content } }.getOrNull()
        } ?: return refuse(session, request, FsFailure.BadRequest("ids must be an array"))

        if (ids.isEmpty() || ids.size > FsThumbs.MAX_IDS) {
            // Refused rather than truncated. Silently serving the first 32 of 40 would hand back a
            // short list the Mac cannot tell from eight files that have no thumbnail.
            return refuse(
                session,
                request,
                FsFailure.BadRequest("ids must hold 1 to ${FsThumbs.MAX_IDS} entries"),
            )
        }
        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))

        val maxEdge = FsThumbs.edgeOf(request.int("maxEdge"))
        val startedAt = System.currentTimeMillis()
        var made = 0
        var none = 0
        var missing = 0

        val thumbs = ids.map { id ->
            val entry = store.statById(id)
            if (entry == null) {
                missing++
                return@map buildJsonObject {
                    put("id", id)
                    put("error", "NOT_FOUND")
                }
            }
            val thumb =
                if (entry.dir) null
                else runCatching { store.thumbnail(id, maxEdge) }.getOrElse {
                    LinkLog.w("fs", "fs.thumb $rootId/${entry.name} could not be decoded", it)
                    null
                }
            if (thumb == null) {
                none++
                // Not an error. Most files are not images, and a directory never will be — a pane
                // that greyed itself out over a folder of documents would be reporting the ordinary
                // case as a fault. Kept distinct from NOT_FOUND, which is a different sentence.
                return@map buildJsonObject {
                    put("id", id)
                    put("error", "NO_THUMBNAIL")
                }
            }
            made++
            buildJsonObject {
                put("id", id)
                put("mime", "image/jpeg")
                put("width", thumb.width)
                put("height", thumb.height)
                put("data", Base64.encodeToString(thumb.bytes, Base64.NO_WRAP))
            }
        }

        delivered.incrementAndGet()
        // The success count beside both ways of having none, and the elapsed time beside the counts:
        // a batch of 32 that produced 0 thumbnails in 40 ms and one that produced 0 in 9 s are
        // different problems, and a bare "0 thumbs" cannot tell them apart.
        LinkLog.i(
            "fs",
            "fs.thumb $rootId → $made made / $none without one / $missing gone, " +
                "maxEdge=$maxEdge, ${System.currentTimeMillis() - startedAt} ms — ${tally()}",
        )
        session.ack(request) {
            put("thumbs", buildJsonArray { thumbs.forEach { add(it) } } as JsonArray)
        }
    }

    // ---- fs.mkdir -------------------------------------------------------------------------------

    private fun onMkdir(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val name = request.str("name")
        FsPaths.rejectionForName(name)?.let {
            return refuse(session, request, FsFailure.BadRequest(it))
        }
        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))
        if (!store.writable) {
            return refuse(session, request, FsFailure.NotWritable(store.label))
        }
        // A specific reason rather than a path error. Refusing here with `NoSuchPath` would send the
        // user looking for a folder problem that does not exist — the folder is fine and the *root*
        // cannot hold folders. The store declares this; this handler does not infer it.
        if (!store.supportsDirectories) {
            return refuse(
                session,
                request,
                FsFailure.BadRequest(
                    "\"${store.label}\" cannot hold folders — Android's media store has no empty " +
                        "directories, so a folder there exists only while a file is in it. Send " +
                        "the file itself, or use a folder shared from the phone.",
                ),
            )
        }

        val segments = when (val path = FsPaths.splitPath(request.str("path"))) {
            is FsPaths.PathResult.Rejected -> return refuse(session, request, FsFailure.BadRequest(path.why))
            is FsPaths.PathResult.Ok -> path.segments
        }

        val made = store.mkdir(segments, name!!)
            ?: return refuse(session, request, FsFailure.NoSuchPath(FsPaths.joinPath(segments)))

        delivered.incrementAndGet()
        val fullPath = FsPaths.joinPath(segments + made.name)
        LinkLog.i("fs", "fs.mkdir $rootId/$fullPath → ${made.id} — ${tally()}")
        session.ack(request) {
            put("id", made.id)
            put("path", fullPath)
        }
    }

    // ---- fs.delete ------------------------------------------------------------------------------

    /**
     * Compare-and-delete. Both facts are required, the phone holds the truth, and it re-checks.
     *
     * ### Why this verb is shaped differently from the other three
     *
     * It is the only thing in this phase that destroys data, so it gets the treatment `sms.send`
     * got: **both facts named by the caller, verified on the side that holds the truth, nothing done
     * on a mismatch.** `docs/protocol.md` calls that the one guard in this project against an
     * unrecoverable error, and a delete issued from a Mac list that re-rendered under the pointer is
     * exactly the class of action it was written for.
     *
     * `expectSize` and `expectMtimeMs` are **required**, not optional-with-a-default. A default
     * would be a way for a caller to ask for an unconditional delete, and the whole point is that no
     * such request exists — there is no `delete(id)` on [FsStore] either, so the guard cannot be
     * routed around by a future caller reaching for a simpler function.
     *
     * ### The reported code is `TARGET_STALE`, and the payload spec says `STALE_TARGET`
     *
     * **A deliberate deviation, recorded rather than silently taken.** `ErrorCode.TARGET_STALE` has
     * existed since Phase 4 and its documented meaning is this one, word for word — *"the thing the
     * Mac aimed at is not the thing that is there now… retryable after a refresh"*. Shipping
     * `STALE_TARGET` beside it would put two codes whose names are anagrams of each other, and whose
     * meanings are identical, into one protocol: a Mac switching on one would silently miss the
     * other, and nothing would ever fail loudly. The protocol's own bar for a new code is *the Mac
     * reacts differently*, and here it does not.
     *
     * Nothing on the Mac reads either code for `fs.*` yet, so the cost of this now is zero and the
     * cost of the twin later is permanent. It is one constant if the decision goes the other way.
     */
    private fun onDelete(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val id = request.str("id")
            ?: return refuse(session, request, FsFailure.BadRequest("id is required"))
        val expectSize = request.long("expectSize")
            ?: return refuse(
                session,
                request,
                FsFailure.BadRequest("expectSize is required — this phone will not delete a file the Mac has not just seen"),
            )
        val expectMtimeMs = request.long("expectMtimeMs")
            ?: return refuse(
                session,
                request,
                FsFailure.BadRequest("expectMtimeMs is required — this phone will not delete a file the Mac has not just seen"),
            )

        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))
        if (!store.writable) return refuse(session, request, FsFailure.NotWritable(store.label))

        when (val outcome = store.deleteIfUnchanged(id, expectSize, expectMtimeMs)) {
            is DeleteOutcome.Deleted -> {
                delivered.incrementAndGet()
                // Logged at the same volume as the refusals below, per CLAUDE.md: a refusal count
                // with no success count beside it cannot tell "the guard is working" from "the
                // guard refuses everything".
                LinkLog.i(
                    "fs",
                    "fs.delete $rootId/$id → deleted, $expectSize bytes at $expectMtimeMs " +
                        "matched — ${tally()}",
                )
                session.ack(request) { put("deleted", 1) }
            }
            is DeleteOutcome.NotFound -> refuse(session, request, FsFailure.NoSuchEntry)
            is DeleteOutcome.Stale -> refuse(
                session,
                request,
                FsFailure.Stale(expectSize, expectMtimeMs, outcome.actualSize, outcome.actualMtimeMs),
            )
            is DeleteOutcome.Refused -> refuse(session, request, FsFailure.DeleteRefused(outcome.why))
        }
    }

    // ---- fs.transfer.begin / cancel --------------------------------------------------------------

    /**
     * Agrees one transfer and hands back the id a bulk socket will claim.
     *
     * ### `sha256` is non-null here, and that is what this verb adds
     *
     * `media.original` acks `sha256: null` because hashing before sending reads the file twice, so
     * **nothing in this project has ever compared a transfer against a digest agreed in advance** —
     * every `fs.transfer.done` so far has reported `verified: false`, and the `CHECKSUM_MISMATCH`
     * branch on both sides has never once run. This verb pre-hashes below a size ceiling, which
     * makes `verified: true` reachable for the first time and makes the mismatch branch reachable
     * at all. Above the ceiling it still acks null and reports `verified: false`, which is the same
     * honest answer rather than a silent downgrade.
     *
     * ### `offset` is 0 on a pull, and that is not a stub
     *
     * The receiver decides the resume point, because it is the side that knows what it already
     * holds. On a pull that is the Mac, and it sends the offset it wants in the **bulk header**;
     * this ack has nothing to say about it. On a push the phone is the receiver and the offset it
     * already has belongs here — which is the direction this build does not yet serve.
     */
    private fun onBegin(session: ControlSession, request: Envelope, context: Context) {
        val direction = request.str("direction") ?: "pull"
        if (direction == "push") return onBeginPush(session, request, context)
        if (direction != "pull") {
            return refuse(
                session,
                request,
                FsFailure.BadRequest("direction must be \"pull\" or \"push\", not \"$direction\""),
            )
        }
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val id = request.str("id")
            ?: return refuse(session, request, FsFailure.BadRequest("id is required for a pull"))
        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))
        val sessionId = session.token
            ?: return refuse(session, request, FsFailure.BadRequest("this session has no token"))

        // Read now, not from anything the Mac cached: the file is the phone's truth, and one
        // deleted between listing and fetching must be a NOT_FOUND here rather than a transfer that
        // streams a wrong length.
        val entry = store.statById(id) ?: return refuse(session, request, FsFailure.NoSuchEntry)
        if (entry.dir) {
            return refuse(session, request, FsFailure.BadRequest("that is a directory, not a file"))
        }

        val pendingTransfer = BulkTransfers.registerFsPull(store, entry, sessionId)
            ?: return refuse(session, request, FsFailure.NoSuchEntry)

        delivered.incrementAndGet()
        LinkLog.i(
            "fs",
            "fs.transfer.begin pull $rootId/${entry.name} → ${pendingTransfer.transferId}, " +
                "${entry.size} bytes, " +
                (if (pendingTransfer.sha256 != null) "digest agreed in advance" else "no digest agreed") +
                " — ${tally()}",
        )
        session.ack(request) {
            put("transferId", pendingTransfer.transferId)
            put("direction", "pull")
            put("size", entry.size)
            put("mtimeMs", entry.mtimeMs)
            put("name", entry.name)
            put("mime", entry.mime)
            put("sha256", pendingTransfer.sha256)
            put("offset", 0L)
            put("chunkMax", BulkTransfers.chunkMax())
        }
    }

    /**
     * Agrees an incoming file — the phone as receiver.
     *
     * ### The offset is decided here, and this is the field that was `0` for two slices
     *
     * The receiver decides the resume point because it is the side that knows what it already
     * holds. On a pull that is the Mac and this ack has nothing to say. On a push it is the phone,
     * and the number it returns is what stops an interrupted 2 GB file starting again from zero.
     *
     * ### Everything refused here is refused *before* a socket opens
     *
     * A read-only tree, a full disk, a `..` in the path: each is a control-channel refusal with a
     * code the Mac reacts to differently. Discovering them after the bulk socket is up would mean
     * failing a transfer that has already moved bytes, and `NO_SPACE` in particular is one only the
     * user can fix — it must not look like something a retry would cure.
     */
    private fun onBeginPush(session: ControlSession, request: Envelope, context: Context) {
        val rootId = request.str("rootId")
            ?: return refuse(session, request, FsFailure.BadRequest("rootId is required"))
        val name = request.str("name")
            ?: return refuse(session, request, FsFailure.BadRequest("name is required for a push"))
        if (name.contains('/') || name == "." || name == "..") {
            return refuse(session, request, FsFailure.BadRequest("name may not contain a path"))
        }
        val size = request.long("size")
            ?: return refuse(session, request, FsFailure.BadRequest("size is required for a push"))
        if (size < 0) return refuse(session, request, FsFailure.BadRequest("size may not be negative"))

        val store = FsRoots.find(context, rootId)
            ?: return refuse(session, request, FsFailure.RootNotGranted(rootId))
        if (!store.writable) return refuse(session, request, FsFailure.NotWritable(store.label))

        val segments = when (val path = FsPaths.splitPath(request.str("path") ?: "")) {
            is FsPaths.PathResult.Ok -> path.segments
            is FsPaths.PathResult.Rejected -> {
                return refuse(session, request, FsFailure.BadRequest(path.why))
            }
        }

        // Checked before a byte moves, and it is its own code because only the user can fix it —
        // retrying a NO_SPACE is the one retry that is certain to fail again.
        val free = store.freeBytes()
        if (free in 1 until size) {
            return refuse(session, request, FsFailure.NoSpace(store.label, size, free))
        }

        // **Overwrite is decided here, on the control channel, before a byte moves.** The store's
        // `commit()` will replace a file at the destination name, and the only thing standing
        // between that and a user losing data is this check — which is why it is a refusal with a
        // code rather than a flag threaded through the transfer. `FsDeleteGuardTest` caught the
        // version of this code that had no check at all.
        val overwrite = FsPartials.overwriteRequested(request.raw("overwrite"))
        if (!overwrite) {
            val existing = store.listChildren(segments)?.firstOrNull { it.name == name && !it.dir }
            if (existing != null) {
                return refuse(
                    session,
                    request,
                    FsFailure.AlreadyThere(name, existing.size, existing.mtimeMs),
                )
            }
        }

        val sessionId = session.token
            ?: return refuse(session, request, FsFailure.BadRequest("this session has no token"))

        val arriving = BulkTransfers.registerFsPush(
            context = context,
            store = store,
            segments = segments,
            name = name,
            size = size,
            // The Mac's digest, agreed before anything moves. Null is allowed and is reported
            // honestly as `verified: false` rather than as a failure.
            sha256 = request.str("sha256"),
            sessionId = sessionId,
        ) ?: return refuse(session, request, FsFailure.NoSuchEntry)

        delivered.incrementAndGet()
        LinkLog.i(
            "fs",
            "fs.transfer.begin push $rootId/${FsPaths.joinPath(segments)}/$name → " +
                "${arriving.transferId}, $size bytes, starting at ${arriving.offset}, " +
                (if (arriving.sha256 != null) "digest agreed in advance" else "no digest agreed") +
                " — ${tally()}",
        )
        session.ack(request) {
            put("transferId", arriving.transferId)
            put("direction", "push")
            put("size", size)
            put("name", name)
            put("sha256", arriving.sha256)
            // The field that finally carries a number. Everything above exists to compute it.
            put("offset", arriving.offset)
            put("chunkMax", BulkTransfers.chunkMax())
        }
    }

    private fun onCancel(session: ControlSession, request: Envelope) {
        val transferId = request.str("transferId")
            ?: return refuse(session, request, FsFailure.BadRequest("transferId is required"))
        val reason = request.str("reason") ?: "unspecified"
        val stopped = BulkTransfers.cancel(transferId, reason)
        delivered.incrementAndGet()
        LinkLog.i("fs", "fs.transfer.cancel $transferId (reason=$reason) — ${tally()}")
        session.ack(request) {
            put("transferId", transferId)
            put("stopped", stopped)
        }
    }

    // ---- plumbing -------------------------------------------------------------------------------

    private fun refuse(session: ControlSession, request: Envelope, failure: FsFailure) {
        refused.incrementAndGet()
        LinkLog.w("fs", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.FILES,
            fixHint = failure.fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() && it != "null" }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()

    private fun Envelope.long(key: String): Long? =
        payload[key]?.jsonPrimitive?.content?.toLongOrNull()

    /**
     * The raw payload value, uninterpreted.
     *
     * Used only by `overwrite`, whose reading is a decision rather than a parse and therefore lives
     * in [FsPartials.overwriteRequested] where a test can reach it. A `bool()` helper here would put
     * "absent means do not destroy anything" inside the JSON reader, which is the last place anyone
     * looks for it.
     */
    private fun Envelope.raw(key: String): String? = payload[key]?.jsonPrimitive?.content
}

/** Every way an `fs.*` request can fail, each with the sentence a person reads. */
sealed class FsFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    /**
     * The Mac named a root this phone has not been granted.
     *
     * Deliberately **not** `PERMISSION_DENIED`: the feature works and other folders are readable, so
     * the Mac must draw an "add this folder" affordance rather than greying the pane out.
     */
    class RootNotGranted(rootId: String) : FsFailure(
        label = "root-not-granted",
        code = ErrorCode.ROOT_NOT_GRANTED,
        reason = "This phone has not shared that folder.",
        fixHint = "On the phone: ConnectSuite › Sync › Folders › Add folder.",
    )

    class NoSuchPath(path: String) : FsFailure(
        label = "no-such-path",
        code = ErrorCode.NOT_FOUND,
        reason = "There is no folder at that path on the phone any more.",
    )

    object NoSuchEntry : FsFailure(
        label = "no-such-entry",
        code = ErrorCode.NOT_FOUND,
        reason = "That file is no longer on the phone.",
    )

    class NotWritable(label: String) : FsFailure(
        label = "not-writable",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "The folder \"$label\" was shared read-only.",
        fixHint = "On the phone: remove the folder under Sync › Folders and add it again.",
    )

    /**
     * The file is there; it is not the file the Mac was looking at. Nothing was deleted.
     *
     * **The only error in this namespace that reports a prevented harm** rather than a refused
     * convenience — the standing `RECIPIENT_MISMATCH` has in SMS. It should be rare enough that any
     * occurrence is worth investigating on the Mac, and the message carries both readings so the
     * investigation does not need a second round trip.
     */
    class Stale(
        expectedSize: Long,
        expectedMtimeMs: Long,
        actualSize: Long,
        actualMtimeMs: Long,
    ) : FsFailure(
        label = "stale-target",
        code = ErrorCode.TARGET_STALE,
        reason = "Nothing was deleted: that file has changed since the Mac last saw it. " +
            "It now holds $actualSize bytes, modified at $actualMtimeMs; the Mac asked about " +
            "$expectedSize bytes at $expectedMtimeMs.",
        fixHint = "Refresh the folder and try again.",
    )

    class DeleteRefused(why: String) : FsFailure(
        label = "delete-refused",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "The phone would not delete that: $why.",
    )

    /**
     * The receiver has no room, and it is its own code because only the user can fix it.
     *
     * Retrying a `TRANSFER_FAILED` is worth it and retrying this one is certain to fail again. The
     * message names **which side** is full, because "not enough space" on a two-device transfer is
     * a sentence that sends people to the wrong machine.
     */
    class NoSpace(label: String, needed: Long, free: Long) : FsFailure(
        label = "no-space",
        code = ErrorCode.NO_SPACE,
        reason = "The phone does not have room for that: \"$label\" has $free bytes free and the " +
            "file needs $needed.",
        fixHint = "Free some space on the phone, or send to a different folder.",
    )

    /**
     * Something is already at that name and the Mac did not ask to replace it.
     *
     * `TARGET_STALE` rather than a new code, on the protocol's own bar — *the Mac reacts
     * differently* — and here it does not: the response is refresh, look at what is there, and ask
     * again with `overwrite: true` or a different name. That is the same move `fs.delete`'s refusal
     * asks for, which is why it is the same code.
     *
     * The size and modified time are on the line for the same reason they are on the delete
     * refusal: the Mac's next move needs them, and a refusal that says only "no" costs a round trip.
     */
    class AlreadyThere(name: String, size: Long, mtimeMs: Long) : FsFailure(
        label = "already-there",
        code = ErrorCode.TARGET_STALE,
        reason = "Nothing was written: \"$name\" is already in that folder on the phone, holding " +
            "$size bytes and last modified at $mtimeMs, and the Mac did not ask to replace it.",
        fixHint = "Send it again with overwrite, or choose a different name.",
    )

    class BadRequest(detail: String) : FsFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was done.",
    )
}
