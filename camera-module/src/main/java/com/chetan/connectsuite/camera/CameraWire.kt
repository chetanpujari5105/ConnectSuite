package com.chetan.connectsuite.camera

/**
 * The closed vocabularies of Camera v1 — docs/protocol.md → Camera.
 *
 * Pure Kotlin, no Android, so the session machine and its tests share these with the engine rather
 * than each holding a copy.
 */

/** Which camera. `headerByte` is the frame header's `facing` byte. */
enum class CameraFacing(val wire: String, val headerByte: Int) {
    BACK("back", 0),
    FRONT("front", 1),
    ;

    /** The other one — what the phone's Switch button and the Mac's switch control turn to. */
    fun other(): CameraFacing = if (this == BACK) FRONT else BACK

    companion object {
        /** Null for anything that is not exactly `back` or `front`; the caller answers BAD_REQUEST. */
        fun fromWire(value: String?): CameraFacing? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * Why a camera stream ended. **The wire value is a closed set the Mac switches on**; `message` and
 * `fixHint` are for a person, on the phone's screen and in the `camera.state` payload.
 *
 * [MAC_DISCONNECTED] has no wire value on purpose: the owning session is gone, so there is nobody to
 * send it to. It exists for the phone's own screen and log, and the engine never sends it.
 *
 * [STREAM_NOT_OPENED] and [CAMERA_NOT_STARTED] share a wire value with a sibling and keep their own
 * sentence: the Mac's switch only needs to know *which kind* of ending it was, and the person reading
 * the phone deserves the precise one.
 */
enum class CameraStopReason(val wire: String?, val message: String, val fixHint: String?) {
    DECLINED(
        "declined",
        "You declined the camera request on this phone.",
        null,
    ),
    EXPIRED(
        "expired",
        "Nobody answered the camera request within 30 seconds.",
        "Ask again from the Mac and tap Start camera on the phone.",
    ),
    PERMISSION_DENIED(
        "permission-denied",
        "Android's camera permission was not allowed for Sidekick.",
        "Allow Camera for Sidekick when the phone asks, or in the phone's Settings → Apps → Sidekick → Permissions.",
    ),
    CAMERA_UNAVAILABLE(
        "camera-unavailable",
        "The phone's camera could not be opened.",
        "Try the other camera, or restart the phone if the camera is not working in other apps.",
    ),
    CAMERA_NOT_STARTED(
        "camera-unavailable",
        "The phone's camera did not start within 10 seconds.",
        "Close other camera apps on the phone, then ask again.",
    ),
    CAMERA_IN_USE(
        "camera-in-use",
        "Another app is using the phone's camera, or the camera is turned off by a setting.",
        "Close the other camera app, or check the phone's camera access setting, then ask again.",
    ),
    STOPPED_BY_MAC(
        "stopped-by-mac",
        "The Mac stopped the camera.",
        null,
    ),
    STOPPED_ON_PHONE(
        "stopped-on-phone",
        "The camera was stopped on the phone.",
        null,
    ),
    LEFT_SCREEN(
        "left-screen",
        "The camera stopped because Sidekick's camera screen left the phone's display.",
        "Camera v1 only runs while the camera screen is open on the phone. Ask again and keep it open.",
    ),
    /**
     * The attached socket closed and nothing said why. The phone cannot tell a Mac that hung up from a
     * network that dropped, so the sentence names neither (defect 167). A `camera.stop` that crossed
     * the close re-attributes it to [STOPPED_BY_MAC] — [CameraSessionMachine.stopFromMac].
     */
    STREAM_CLOSED(
        "stream-closed",
        "The camera stream to the Mac ended.",
        "Ask again from the Mac.",
    ),
    STREAM_NOT_OPENED(
        "stream-closed",
        "The Mac did not open the camera picture connection within 10 seconds.",
        "Check that the Mac and phone are on the same network, then ask again.",
    ),
    CAPTURE_FAILED(
        "capture-failed",
        "The phone could not produce camera frames.",
        "Ask again. If it keeps happening, restart the phone.",
    ),
    /**
     * The owning control session ended. The phone cannot tell a Mac that disconnected from a network
     * that dropped, so the sentence names neither (defect 174); the Mac's own screen says which when it
     * knows — its Disconnect is its own.
     */
    MAC_DISCONNECTED(
        null,
        "The connection to the Mac ended, so the camera stopped.",
        null,
    ),
}

/**
 * How a camera request reaches the phone's owner — decided **before** the ack, so the sentence the Mac
 * shows names the route that was actually taken (defect 171).
 *
 * The route is a claim about what the phone could check at that moment, and no more: [NOTIFICATION]
 * means Android says Sidekick may post to the camera-request channel, not that a person has seen it.
 * [NONE] is the honest third answer the first version did not have — notifications are off for
 * Sidekick, so nothing is posted, and the request waits for Sidekick to come to the front by some other
 * route (`CameraFeature`'s resume hook) until it expires.
 */
enum class CameraRequestRoute(val message: String, val fixHint: String) {
    SCREEN(
        "The camera request is on your phone's screen. The camera stays off until you allow it there.",
        "Tap Start camera on your phone.",
    ),
    NOTIFICATION(
        "Your phone has a notification asking to allow the camera. The camera stays off until you allow it.",
        "Open the notification on your phone and tap Start camera.",
    ),
    NONE(
        "Your phone cannot show the camera request: Sidekick's notifications are turned off there. " +
            "The camera stays off unless you open Sidekick on the phone and allow it within 30 seconds.",
        "Open Sidekick on your phone, then tap Start camera.",
    ),
    ;

    companion object {
        /** Sidekick on screen wins; otherwise a notification, but only if one can actually be posted. */
        fun choose(screenVisible: Boolean, notificationsDeliverable: Boolean): CameraRequestRoute = when {
            screenVisible -> SCREEN
            notificationsDeliverable -> NOTIFICATION
            else -> NONE
        }
    }
}

/** The two deadlines a stream can be waiting on. */
enum class CameraTimer {
    /** `awaiting-approval` → `expired` after [CameraSessionMachine.REQUEST_TIMEOUT_MS]. */
    REQUEST,

    /** `starting` → `stream-closed` or `camera-unavailable` after [CameraSessionMachine.START_TIMEOUT_MS]. */
    START,
}

/** The phase a stream is in, as the phone's screen and `camera.state` see it. */
enum class CameraPhase(val wire: String) {
    IDLE("idle"),
    AWAITING("awaiting-approval"),
    STARTING("starting"),
    RUNNING("running"),
    ;

    /** True when the camera may be open: approved, and not yet ended. */
    val isLive: Boolean get() = this == STARTING || this == RUNNING
}

/**
 * The decision inside `CameraNotifications.deliverable`, without Android, so a JVM test holds it.
 * `channelImportance` is `NotificationManager.IMPORTANCE_*`: 0 is `IMPORTANCE_NONE` (blocked), and null
 * is a channel that was never created — nothing would be shown in either case.
 */
object CameraRequestDelivery {
    private const val IMPORTANCE_NONE = 0

    fun deliverable(permitted: Boolean, appEnabled: Boolean, channelImportance: Int?): Boolean =
        permitted && appEnabled && channelImportance != null && channelImportance != IMPORTANCE_NONE
}
