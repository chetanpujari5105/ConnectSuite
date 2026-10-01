package com.chetan.connectsuite.core.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * The v2 wire protocol, mirroring docs/protocol.md. Its desktop twin is
 * desktop/src/shared/protocol.ts — change docs/protocol.md first, then both files.
 *
 * This replaces the v1 [NetworkPacket] line protocol. NetworkPacket stays until the v1 ADB
 * mirror path is deleted, because sync-module still speaks it.
 */
object Link {
    /** Bumped on any wire-incompatible change. Peers refuse a different major. */
    const val PROTOCOL_MAJOR: Int = 1

    const val PORT_CONTROL: Int = 42501
    const val PORT_VIDEO: Int = 42502
    const val PORT_BULK: Int = 42503

    /** Refuse absurd length prefixes rather than allocating whatever a peer asks for. */
    const val MAX_CONTROL_FRAME: Int = 16 * 1024 * 1024
    const val MAX_FRAME: Int = 8 * 1024 * 1024

    /**
     * The bulk channel's cap, and it is deliberately *smaller* than [MAX_FRAME].
     *
     * The instinct with file transfer is to raise the limit; the opposite is right. The bulk
     * channel moves chunks, and the largest legitimate chunk is `ChunkSizes.MAX` at 256 KB. A
     * frame bigger than a chunk is not a bigger transfer, it is a peer that has lost sync or is
     * lying. [MAX_FRAME]'s 8 MB is sized for a video keyframe; inheriting it here would let a peer
     * allocate 8 MB per frame to move 256 KB of payload, 32x the memory for no capability.
     *
     * 1 MB is 4x the largest chunk, which leaves room for the JSON header and for a future chunk
     * size without leaving room for an attack.
     */
    const val MAX_BULK_FRAME: Int = 1 * 1024 * 1024

    /**
     * The bulk channel's header frame, capped separately and far lower — the same pattern as the
     * 128-byte session-token frame.
     *
     * The header is a small JSON object (`transferId`, `direction`, `path`, `size`, `mtime`,
     * `sha256`, optional `offset`). A path can be long; nothing in it justifies a megabyte. Reading
     * it under [MAX_BULK_FRAME] would let a malformed first frame claim the whole chunk budget on a
     * connection that has proved nothing beyond its token.
     */
    const val MAX_BULK_HEADER_FRAME: Int = 64 * 1024

    /**
     * The camera stream's frame cap — docs/protocol.md → Camera → The camera frame.
     *
     * Deliberately far under [MAX_FRAME], for the reason [MAX_BULK_FRAME] is: one camera frame is one
     * JPEG of a 1280x720 preview, tens of kilobytes. A camera frame claiming megabytes is not a sharper
     * picture, it is a peer that has lost sync — and 8 MB per frame is memory a camera never needs.
     */
    const val CAMERA_MAX_FRAME: Int = 1 * 1024 * 1024

    /** A video or bulk socket must present its session token this fast or it is dropped. */
    const val TOKEN_GRACE_MS: Long = 10_000

    /** The phone hangs up on a control connection that has been silent this long. */
    const val CONTROL_IDLE_TIMEOUT_MS: Long = 30_000

    const val SERVICE_TYPE: String = "_connectsuite._tcp"

    /** A QR pairing token is only good for one scan, and only this long. */
    const val PAIR_TOKEN_TTL_MS: Long = 5 * 60 * 1000
}

object MessageType {
    const val HELLO = "hello"
    const val HELLO_ACK = "hello.ack"

    /**
     * Sent immediately before the phone closes a connection whose hello carried a pairing token it
     * would not accept. Without it the Mac — which is showing a QR the user is looking at — learns
     * only that a socket closed, which is indistinguishable from the network dropping.
     */
    const val PAIR_REJECTED = "pair.rejected"
    const val ACK = "ack"
    const val ERROR = "error"
    const val PING = "ping"
    const val PONG = "pong"
    const val CAPABILITIES_CHANGED = "capabilities.changed"

    const val NOTIF_POSTED = "notif.posted"
    const val NOTIF_REMOVED = "notif.removed"
    const val NOTIF_REPLY = "notif.reply"
    const val NOTIF_ACTION = "notif.action"
    const val NOTIF_DISMISS = "notif.dismiss"

    const val SMS_THREADS = "sms.threads"
    const val SMS_MESSAGES = "sms.messages"
    const val SMS_SEND = "sms.send"
    const val SMS_RECEIVED = "sms.received"

    /**
     * An outgoing message appeared in the provider — from this Mac, another client, or the
     * handset's own keyboard. Same payload shape as [SMS_RECEIVED] with `inbound: false`.
     * Defects 39 and 44.
     */
    const val SMS_SENT = "sms.sent"

    const val CALL_INCOMING = "call.incoming"
    const val CALL_ENDED = "call.ended"
    const val CALL_LOG = "call.log"
    const val CALL_DIAL = "call.dial"
    const val CALL_ANSWER = "call.answer"
    const val CALL_REJECT = "call.reject"

    const val CONTACTS_LIST = "contacts.list"
    const val CONTACTS_GET = "contacts.get"

    const val CLIP_PUSH = "clip.push"
    const val CLIP_REQUEST = "clip.request"
    const val CLIP_HISTORY = "clip.history"

    const val FS_LIST = "fs.list"
    const val FS_STAT = "fs.stat"

    /** Batched thumbnails for `fs.*` ids. Separate from [MEDIA_THUMB]: the id spaces are disjoint. */
    const val FS_THUMB = "fs.thumb"
    const val FS_MKDIR = "fs.mkdir"
    const val FS_DELETE = "fs.delete"
    const val FS_TRANSFER_BEGIN = "fs.transfer.begin"
    const val FS_TRANSFER_PROGRESS = "fs.transfer.progress"
    const val FS_TRANSFER_DONE = "fs.transfer.done"
    const val FS_TRANSFER_CANCEL = "fs.transfer.cancel"
    /** Block digests of a block-verified pull, phone → Mac. Only with `fs.blocks` negotiated. */
    const val FS_TRANSFER_BLOCKS = "fs.transfer.blocks"

    const val MEDIA_BUCKETS = "media.buckets"
    const val MEDIA_LIST = "media.list"
    const val MEDIA_THUMB = "media.thumb"
    const val MEDIA_ORIGINAL = "media.original"

    const val MIRROR_START = "mirror.start"
    const val MIRROR_STOP = "mirror.stop"
    const val MIRROR_CONFIG = "mirror.config"
    const val MIRROR_KEYFRAME = "mirror.keyframe"
    const val MIRROR_STATS = "mirror.stats"

    /**
     * Phase changes for a mirror session, sent as events. `mirror.start` acks with the phase it
     * entered and every later phase arrives here, because consent is a person tapping a phone and
     * a reply held open across that cannot tell "still reaching for it" from "never coming".
     */
    const val MIRROR_STATE = "mirror.state"

    /**
     * The phone turned. Sent as an event, never handled as a request — the Mac cannot rotate a
     * phone, it can only be told. Carries the new capture geometry and the rotation in degrees,
     * and is followed on the video channel by the new encoder's SPS/PPS.
     */
    const val MIRROR_ROTATE = "mirror.rotate"

    /**
     * Not implemented, and here so `MirrorContractTest` can assert it is never registered: turning
     * the phone's display off while mirroring needs a system-signed permission this app cannot
     * hold. See docs/protocol.md.
     */
    const val MIRROR_SCREENOFF = "mirror.screenoff"

    /**
     * Camera v1 (docs/protocol.md → Camera). `camera.request` **asks**: its ack means a request is
     * waiting on the phone's screen, never that the camera is open. The camera opens only after the
     * phone's owner taps Start camera for that request.
     */
    const val CAMERA_REQUEST = "camera.request"
    const val CAMERA_STOP = "camera.stop"

    /** Changes the camera inside an approved stream; mints no new stream and asks no new approval. */
    const val CAMERA_SWITCH = "camera.switch"

    /** Event, phone → Mac, on every phase change of a camera stream. */
    const val CAMERA_STATE = "camera.state"

    const val INPUT_TAP = "input.tap"
    const val INPUT_SWIPE = "input.swipe"
    const val INPUT_SCROLL = "input.scroll"
    const val INPUT_KEY = "input.key"
    const val INPUT_TEXT = "input.text"
    const val INPUT_GLOBAL = "input.global"

    const val APPS_LIST = "apps.list"
    const val APPS_ICON = "apps.icon"

    /**
     * *Ask* the phone to open an app. Never *launch* it, and the name is the whole point.
     *
     * Measured on this handset 2026-09-03 (`docs/phase-7-apps-proposal.md` §2.4): a backgrounded
     * `startActivity` for a third-party package **returns normally, throws nothing, logs nothing,
     * and does not bring the app to the front.** That is the proposal's fourth row — the outcome
     * every automated check calls a pass — so the remote-control verb it was reserved for cannot
     * exist, and the constant that would carry it is deliberately **absent from this object**
     * rather than sitting here unregistered.
     *
     * Absent, not commented out: an unused `const val APPS_LAUNCH` is one autocomplete away from a
     * handler, and the ack of a verb called *launch* would mean *asked* to everybody who read the
     * name instead of the contract. The prohibition has an enforcement point rather than a
     * sentence — `scripts/check-apps-verb.mjs`, wired to `PreToolUse` on `git commit`.
     *
     * The ack is `{ asked: true }` and carries **no** field saying whether the app opened, because
     * this phone does not know and will not learn: what opens it is a person tapping a
     * notification, in their own time, or not at all.
     */
    const val APPS_OPEN_ASK = "apps.open.ask"

    const val REMOTE_STATE = "remote.state"
    const val REMOTE_COMMAND = "remote.command"

    /**
     * The current track's album art, fetched by the key `remote.state` carries.
     *
     * A separate type rather than a field on the state, for the reason `media.thumb` is separate
     * from `media.list`: `remote.state` is pushed on every play, pause and position jump, and an
     * inline 33 KB base64 image on each of those is exactly the head-of-line blocking on the
     * channel that also carries `ping` that `media.thumb`'s batch cap exists to bound. The key is
     * cheap and travels with every push; the bytes are asked for once per track.
     */
    const val REMOTE_ARTWORK = "remote.artwork"

    const val BATTERY_STATE = "battery.state"
    const val NET_STATE = "net.state"

    /** Phone to Mac, unsolicited: shared-volume free and total bytes. See docs/protocol.md. */
    const val STORAGE_STATE = "storage.state"

    /**
     * Feature A (docs/protocol.md → Share). Event, phone → Mac: one staged file on offer. Sent
     * only when `share.file` is negotiated through `ext`, and at most one live per session.
     */
    const val SHARE_OFFER = "share.offer"

    /** Request, Mac → phone: the Mac's answer to an offer. In this revision always a decline. */
    const val SHARE_RESPOND = "share.respond"

    /** Event phone → Mac (`user`/`expired`/`staging-lost`), or request Mac → phone (`user`). */
    const val SHARE_CANCEL = "share.cancel"

    /**
     * Request, Mac → phone, version 2: the receiver's verdict on a pull — the only thing that makes the
     * phone say "Saved". Handled by the phone from slice 3c; the Mac sends it from slice 3d.
     */
    const val SHARE_SAVED = "share.saved"
}

object ErrorCode {
    const val PERMISSION_DENIED = "PERMISSION_DENIED"
    const val FEATURE_UNAVAILABLE = "FEATURE_UNAVAILABLE"
    const val SECURE_SURFACE = "SECURE_SURFACE"
    const val ENCODER_FAILED = "ENCODER_FAILED"
    const val DEVICE_LOCKED = "DEVICE_LOCKED"

    /** Consent was asked for and nothing answered it in time. Distinct from a refusal. */
    const val CONSENT_TIMEOUT = "CONSENT_TIMEOUT"

    /**
     * A coordinate was stamped with a screen shape the phone has left, or falls outside it.
     *
     * Retryable immediately: the Mac has already been told the new geometry, so recomputing and
     * resending works. Distinct from [FEATURE_UNAVAILABLE] for exactly that reason.
     */
    const val GEOMETRY_STALE = "GEOMETRY_STALE"

    /** `dispatchGesture` refused the gesture, or the system cancelled it part-way. */
    const val GESTURE_FAILED = "GESTURE_FAILED"

    /** Text was sent but nothing editable has input focus. The user must tap a field first. */
    const val NO_EDITABLE_FOCUS = "NO_EDITABLE_FOCUS"

    /**
     * A key or global action that cannot exist for an AccessibilityService.
     *
     * Never worth retrying — see docs/protocol.md, "What input cannot do, permanently".
     */
    const val UNSUPPORTED_KEY = "UNSUPPORTED_KEY"

    const val TRANSFER_FAILED = "TRANSFER_FAILED"
    const val PROTOCOL_MISMATCH = "PROTOCOL_MISMATCH"
    const val UNAUTHORIZED = "UNAUTHORIZED"

    // ---- Phase 4 ------------------------------------------------------------------------------

    /**
     * The request was malformed: a required field missing, or a value out of range.
     *
     * This is a **Mac-side** fault and is worth telling apart from [FEATURE_UNAVAILABLE], which is
     * a phone-side one. The Mac can retry a FEATURE_UNAVAILABLE after a permission changes; there
     * is nothing useful it can do with a BAD_REQUEST except fix its own code.
     *
     * Input's malformed-request path (`InputFailure.BadRequest`) still reports
     * [FEATURE_UNAVAILABLE] and is deliberately left alone: it predates this code and its wording
     * is quoted in the Phase 3 acceptance evidence.
     */
    const val BAD_REQUEST = "BAD_REQUEST"

    /**
     * The phone may not read its own clipboard because it is not the focused app.
     *
     * **Not `PERMISSION_DENIED`, and the difference is sharper here than anywhere else in this
     * protocol: there is no permission to grant.** `PERMISSION_DENIED` greys the pane and points a
     * `fixHint` at a Settings screen, which would send somebody hunting for a switch that does not
     * exist — the platform's rule is window focus and nothing else. Measured 2026-09-01: reads are
     * refused from the background with our AccessibilityService bound *and* with it disabled, and
     * a foreground service does not help either.
     *
     * The Mac's response is one sentence — open ConnectSuite on the phone — and a retry that
     * becomes meaningful the moment the person does.
     */
    const val PHONE_NOT_FOREGROUND = "PHONE_NOT_FOREGROUND"

    /**
     * The thing the request named is gone: a dismissed notification, a deleted thread, a contact
     * that no longer exists, a call that has already ended.
     *
     * Never retryable with the same argument, and specifically *not* [FEATURE_UNAVAILABLE] — the
     * feature works, the item does not exist. A Mac showing a stale list needs to refresh, which
     * is a different response from greying out a pane.
     */
    const val NOT_FOUND = "NOT_FOUND"

    /** The notification exists but carries no inline reply action. Most do not. */
    const val NO_REPLY_ACTION = "NO_REPLY_ACTION"

    /** This device has no telephony radio, or no SIM. A tablet is not a broken phone. */
    const val NO_TELEPHONY = "NO_TELEPHONY"

    /** The message reached the radio and the radio refused it. Distinct from a permission problem. */
    const val SEND_FAILED = "SEND_FAILED"

    /** `call.answer` or `call.reject` with nothing ringing. */
    const val NO_ACTIVE_CALL = "NO_ACTIVE_CALL"

    /** `remote.command` with no app currently holding a media session. */
    const val NO_MEDIA_SESSION = "NO_MEDIA_SESSION"

    /**
     * `remote.artwork` for a session that carries no album art, or for a key that has gone stale.
     *
     * Its own code rather than [NOT_FOUND], because it is **not a failed lookup**. A podcast app, a
     * browser tab and a game all hold perfectly good media sessions with no artwork in them, and
     * that is the normal condition of those sessions rather than something that went wrong. The
     * Mac draws its own fallback and says nothing; a NOT_FOUND would invite it to apologise.
     */
    const val NO_ARTWORK = "NO_ARTWORK"

    /**
     * An `sms.send` whose `addresses` do not match the thread its `threadId` names.
     *
     * Its own code rather than a [BAD_REQUEST] because the two mean opposite things to whoever
     * reads the log afterwards. BAD_REQUEST is a malformed message; this is a **well-formed
     * message that would have gone to the wrong person**, and it is the only error in this
     * protocol that reports a prevented harm rather than a refused convenience.
     *
     * See "The send rule" in docs/protocol.md. Any occurrence is worth investigating on the Mac.
     */
    const val RECIPIENT_MISMATCH = "RECIPIENT_MISMATCH"

    /**
     * The thing the Mac aimed at is not the thing that is there now.
     *
     * The same shape as [GEOMETRY_STALE], one layer up: a coordinate stamped with a screen the
     * phone has left is refused rather than scaled against the current one, and an action aimed at
     * a notification the app has replaced is refused rather than fired at whatever now sits at
     * that key. In both cases the Mac's copy has drifted and acting on it would do something the
     * user did not ask for, somewhere they were not looking.
     *
     * Retryable after a refresh, like GEOMETRY_STALE — the Mac has been told the new state.
     */
    const val TARGET_STALE = "TARGET_STALE"

    // ---- Phase 5, files -------------------------------------------------------------------------

    /**
     * The root the Mac named is not one this phone has been granted.
     *
     * **Not [PERMISSION_DENIED]**, and the difference is what the Mac draws. `PERMISSION_DENIED`
     * greys out the pane, which is right when a capability has no grant at all and wrong here: the
     * feature works, the user has added two folders, and the Mac asked about a third. The response
     * is an "add this folder on the phone" affordance, not a dead pane.
     */
    const val ROOT_NOT_GRANTED = "ROOT_NOT_GRANTED"

    /**
     * The receiving side has no room for the file.
     *
     * Its own code rather than [TRANSFER_FAILED] because retrying fixes a TRANSFER_FAILED and
     * cannot fix this one. Only the user can, and they need to be told *which side* is full.
     */
    const val NO_SPACE = "NO_SPACE"

    /**
     * The bytes moved and were wrong. The partial has been deleted; a retry starts from zero.
     *
     * Also not [TRANSFER_FAILED], for the opposite reason to [NO_SPACE]: retrying *is* worth it, and
     * it says something a generic failure does not — bytes arrived and were corrupt, which is a
     * different fault from bytes that never arrived.
     */
    const val CHECKSUM_MISMATCH = "CHECKSUM_MISMATCH"

    /**
     * A block pull's source changed size or last-modified while it was read, or a resumed prefix no
     * longer hashes to the Mac's record (`fs.blocks` only). Treated like [CHECKSUM_MISMATCH]: the
     * partial is deleted, because a torn file is worse than none.
     */
    const val SOURCE_CHANGED = "SOURCE_CHANGED"

    // ---- Phase 7, apps ---------------------------------------------------------------------------

    /**
     * `apps.open.ask` had nowhere to put the question, because notifications are turned off.
     *
     * **Not [PERMISSION_DENIED]**, for the reason [ROOT_NOT_GRANTED] is not: the feature works —
     * the grid is drawn, the labels and icons are real — and exactly one verb of three cannot be
     * delivered. `PERMISSION_DENIED` greys the whole pane, which would hide a working list because
     * the thing it opens has no doorbell.
     *
     * It is also the one refusal in this namespace that must never be silent. The alternative is
     * posting nothing and answering `{ asked: true }`, which is the fourth row of the proposal's
     * decision table reintroduced by the Mac's own copy: a success that did not happen.
     */
    const val NOTIFICATIONS_BLOCKED = "NOTIFICATIONS_BLOCKED"

    /**
     * A camera request or stream is already open, or a mirror session is running or waiting for
     * consent. The phone never stops one to make room for another; the message says which it was.
     */
    const val CAMERA_BUSY = "CAMERA_BUSY"

    /** The phone has no camera, or none facing the way asked. Not a permission problem. */
    const val CAMERA_UNAVAILABLE = "CAMERA_UNAVAILABLE"
}

/**
 * What the phone can actually do right now. Derived from granted permissions, not from what the
 * app was built with, so the Mac can grey out a pane and say why instead of failing on use.
 */
object Capability {
    const val MIRROR = "mirror"
    const val INPUT = "input"
    const val NOTIFICATIONS = "notifications"
    const val SMS = "sms"
    const val CALLS = "calls"
    const val CONTACTS = "contacts"
    const val FILES = "files"
    const val PHOTOS = "photos"
    const val CLIPBOARD = "clipboard"
    const val REMOTE = "remote"
    const val APPS = "apps"
    const val MIC = "mic"

    /** Feature A: the phone can make and answer for one-file share offers (docs/protocol.md → Share). */
    const val SHARE = "share"

    /** Camera v1: a live preview of the phone's camera in the Mac's Camera pane (docs/protocol.md → Camera). */
    const val CAMERA = "camera"

    /**
     * Every capability name, in one place, so nothing has to hand-maintain a second list.
     *
     * Used by [FeatureOf] to tell a message prefix that *is* a capability name from one that only
     * looks like it, and by the tests that check the two stay in step.
     */
    val all: Set<String> = setOf(
        MIRROR, INPUT, NOTIFICATIONS, SMS, CALLS, CONTACTS,
        FILES, PHOTOS, CLIPBOARD, REMOTE, APPS, MIC, SHARE, CAMERA,
    )
}

/** One control-channel message. */
@Serializable
data class Envelope(
    val v: Int = Link.PROTOCOL_MAJOR,
    val id: String = UUID.randomUUID().toString(),
    val type: String,
    val ts: Long = System.currentTimeMillis(),
    val payload: JsonObject = JsonObject(emptyMap()),
) {
    companion object {
        val json: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = false
        }

        fun of(
            type: String,
            id: String = UUID.randomUUID().toString(),
            build: JsonObjectBuilder.() -> Unit = {},
        ): Envelope = Envelope(type = type, id = id, payload = buildJsonObject(build))

        /** An `ack` echoing the request id, which is how the Mac resolves its pending promise. */
        fun ack(requestId: String, build: JsonObjectBuilder.() -> Unit = {}): Envelope =
            of(MessageType.ACK, requestId, build)

        fun error(
            requestId: String = UUID.randomUUID().toString(),
            code: String,
            feature: String? = null,
            message: String,
            fixHint: String? = null,
        ): Envelope = of(MessageType.ERROR, requestId) {
            put("code", code)
            if (feature != null) put("feature", feature)
            put("message", message)
            if (fixHint != null) put("fixHint", fixHint)
        }

        fun encode(envelope: Envelope): ByteArray =
            json.encodeToString(serializer(), envelope).toByteArray(Charsets.UTF_8)

        fun decode(bytes: ByteArray): Envelope =
            json.decodeFromString(serializer(), String(bytes, Charsets.UTF_8))
    }
}

/** Thrown for anything the peer did that violates docs/protocol.md; always closes the socket. */
class ProtocolException(message: String) : java.io.IOException(message)
