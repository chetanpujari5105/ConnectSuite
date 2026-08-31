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
    const val FS_MKDIR = "fs.mkdir"
    const val FS_DELETE = "fs.delete"
    const val FS_TRANSFER_BEGIN = "fs.transfer.begin"
    const val FS_TRANSFER_PROGRESS = "fs.transfer.progress"
    const val FS_TRANSFER_DONE = "fs.transfer.done"
    const val FS_TRANSFER_CANCEL = "fs.transfer.cancel"

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

    const val INPUT_TAP = "input.tap"
    const val INPUT_SWIPE = "input.swipe"
    const val INPUT_SCROLL = "input.scroll"
    const val INPUT_KEY = "input.key"
    const val INPUT_TEXT = "input.text"
    const val INPUT_GLOBAL = "input.global"

    const val APPS_LIST = "apps.list"
    const val APPS_LAUNCH = "apps.launch"
    const val APPS_ICON = "apps.icon"

    const val REMOTE_STATE = "remote.state"
    const val REMOTE_COMMAND = "remote.command"

    const val BATTERY_STATE = "battery.state"
    const val NET_STATE = "net.state"
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

    /**
     * Every capability name, in one place, so nothing has to hand-maintain a second list.
     *
     * Used by [FeatureOf] to tell a message prefix that *is* a capability name from one that only
     * looks like it, and by the tests that check the two stay in step.
     */
    val all: Set<String> = setOf(
        MIRROR, INPUT, NOTIFICATIONS, SMS, CALLS, CONTACTS,
        FILES, PHOTOS, CLIPBOARD, REMOTE, APPS, MIC,
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
