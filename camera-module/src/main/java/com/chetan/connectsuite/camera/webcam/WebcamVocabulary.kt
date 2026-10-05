package com.chetan.connectsuite.camera.webcam

/**
 * The closed vocabularies of Camera v2 — docs/protocol.md → Webcam. Pure Kotlin, held to
 * `docs/fixtures/webcam-vocabulary-v1.json`, which Electron main and the Swift bridge read too.
 *
 * Nothing here is shared with Camera v1's state. [com.chetan.connectsuite.camera.CameraFacing] and
 * [com.chetan.connectsuite.camera.CameraRequestRoute] are reused because they are immutable value
 * types naming the same physical things; v1's machine, engine, socket and screen are not.
 */

/** `webcam.request`'s `trigger`. Changes only the phone's sentence, never what may happen. */
enum class WebcamTrigger(val wire: String) {
    /** An app on the Mac started streaming from Sidekick Camera, so the Mac asked. */
    CONSUMER("consumer"),

    /** The Mac's owner clicked Ask phone. */
    PERSON("person"),
    ;

    companion object {
        fun fromWire(value: String?): WebcamTrigger? = entries.firstOrNull { it.wire == value }
    }
}

/** The phase a webcam session is in, as the phone's screen and `webcam.state` see it. */
enum class WebcamPhase(val wire: String) {
    IDLE("idle"),
    AWAITING("awaiting-approval"),
    STARTING("starting"),
    RUNNING("running"),
    ;

    /** Approved and not yet ended: the camera and the encoder may be open. */
    val isLive: Boolean get() = this == STARTING || this == RUNNING
}

/**
 * Why a `webcam.keyframe` was **ignored** (version 2, docs/protocol.md → `webcam.keyframe`): the session is
 * the caller's, and there was nothing useful to do. Held to the fixture's `keyframeIgnoredReasons`.
 */
enum class WebcamKeyframeIgnored(val wire: String) {
    /** The session is `starting`, or its current generation has not sent its first IDR yet. */
    NOT_RUNNING("not-running"),

    /** A switch or reconfiguration moved on; its first AU is an IDR anyway. */
    STALE_GENERATION("stale-generation"),

    /** The Mac named a generation the phone has not reached. */
    UNKNOWN_GENERATION("unknown-generation"),

    /** One was accepted for this session less than a second ago. */
    RATE_LIMITED("rate-limited"),
}

/** The two deadlines a session can be waiting on. */
enum class WebcamTimer { REQUEST, START }

/**
 * What failed on the Mac, when `webcam.stop` says `failure`. **The phone never displays the wire
 * string**: each detail it knows maps to a sentence written here, and anything else — a newer Mac's
 * detail, or none — is [UNSPECIFIED], with the generic sentence.
 */
enum class WebcamFailureDetail(val wire: String?, val message: String) {
    STREAM_MALFORMED("stream-malformed", "Your Mac ended the webcam because the picture it received could not be read."),
    STREAM_UNAVAILABLE("stream-unavailable", "Your Mac ended the webcam because it could not open the picture connection."),
    BRIDGE_FAILED("bridge-failed", "Your Mac ended the webcam because its camera helper stopped working."),
    PRODUCER_REFUSED("producer-refused", "Your Mac ended the webcam because Sidekick Camera there refused this copy of Sidekick."),
    DEVICE_UNAVAILABLE("device-unavailable", "Your Mac ended the webcam because Sidekick Camera is no longer available on it."),
    NO_ANSWER("no-answer", "Your Mac stopped waiting for an answer to the webcam request."),
    UNSPECIFIED(null, "Your Mac ended the webcam because something failed there."),
    ;

    companion object {
        /** Never null: an unknown or missing detail is [UNSPECIFIED], because the stop must still stop. */
        fun fromWire(value: String?): WebcamFailureDetail =
            entries.firstOrNull { it.wire != null && it.wire == value } ?: UNSPECIFIED
    }
}

/**
 * Why a webcam session ended. **The wire value is the closed set the Mac switches on**; `message` and
 * `fixHint` are for a person, on the phone's screen and in the `webcam.state` payload.
 *
 * Several reasons share a wire value and keep their own sentence, as in Camera v1: the Mac needs only
 * the kind of ending, the person reading the phone deserves the precise one. [MAC_DISCONNECTED] has no
 * wire value: the owning session is gone, so there is nobody to send it to.
 */
enum class WebcamStopReason(val wire: String?, val message: String, val fixHint: String?) {
    DECLINED("declined", "You declined the webcam request on this phone.", null),
    EXPIRED(
        "expired",
        "Nobody answered the webcam request within 30 seconds.",
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
        "The phone's camera or encoder did not start within 10 seconds.",
        "Close other camera apps on the phone, then ask again.",
    ),
    CAMERA_IN_USE(
        "camera-in-use",
        "Another app is using the phone's camera, or the camera is turned off by a setting.",
        "Close the other camera app, or check the phone's camera access setting, then ask again.",
    ),
    /**
     * Between the request and the tap, something else on this phone began a capture — the mirror, which
     * does not refuse for a waiting webcam request. That capture is preserved; this one does not start.
     */
    CAPTURE_BUSY(
        "camera-in-use",
        "Sidekick started mirroring this phone's screen before you allowed the webcam, so the webcam did not start.",
        "Stop mirroring first, then ask again from the Mac.",
    ),
    STOPPED_BY_MAC("stopped-by-mac", "The Mac stopped the webcam.", null),
    /** `webcam.stop` `failure`: the Mac could not continue. Never worded as anyone pressing Stop. */
    MAC_FAILED("mac-failed", WebcamFailureDetail.UNSPECIFIED.message, "Nobody pressed Stop. Ask again from the Mac."),
    NO_CONSUMERS(
        "no-consumers",
        "No app on the Mac is using Sidekick Camera any more, so the webcam stopped.",
        null,
    ),
    STOPPED_ON_PHONE("stopped-on-phone", "The webcam was stopped on the phone.", null),
    LEFT_SCREEN(
        "left-screen",
        "The webcam stopped because Sidekick's webcam screen left the phone's display.",
        "The webcam only runs while that screen is open on the phone. Ask again and keep it open.",
    ),
    /** The attached socket closed and nothing said why; a `webcam.stop` that crossed it re-attributes it. */
    STREAM_CLOSED("stream-closed", "The webcam picture connection to the Mac ended.", "Ask again from the Mac."),
    STREAM_NOT_OPENED(
        "stream-closed",
        "The Mac did not open the webcam picture connection within 10 seconds.",
        "Check that the Mac and phone are on the same network, then ask again.",
    ),
    CAPTURE_FAILED(
        "capture-failed",
        "The phone's camera or video encoder failed.",
        "Ask again. If it keeps happening, restart the phone.",
    ),
    TOO_HOT(
        "too-hot",
        "The phone got too hot, so the webcam stopped.",
        "Let the phone cool down before asking again.",
    ),
    MAC_DISCONNECTED(null, "The connection to the Mac ended, so the webcam stopped.", null),
    ;

    /** The sentence for this ending, with a Mac failure's [detail] chosen from the closed set. */
    fun messageFor(detail: WebcamFailureDetail?): String =
        if (this == MAC_FAILED && detail != null) detail.message else message
}

/**
 * `webcam.stop`'s `cause` and the reason each one produces. An unknown or missing cause is null here;
 * the machine still stops the session and answers `BAD_REQUEST`.
 */
enum class WebcamStopCause(val wire: String, val reason: WebcamStopReason) {
    PERSON("person", WebcamStopReason.STOPPED_BY_MAC),
    NO_CONSUMERS("no-consumers", WebcamStopReason.NO_CONSUMERS),
    SHUTDOWN("shutdown", WebcamStopReason.STOPPED_BY_MAC),
    FAILURE("failure", WebcamStopReason.MAC_FAILED),
    ;

    companion object {
        fun fromWire(value: String?): WebcamStopCause? = entries.firstOrNull { it.wire == value }
    }
}

/** Which other capture on this phone made a webcam request busy. */
enum class OtherCapture {
    /** A Camera v1 request or stream (the Mac's Camera pane). */
    CAMERA_V1,

    /** A mirror session running or waiting for consent. */
    MIRROR,
}
