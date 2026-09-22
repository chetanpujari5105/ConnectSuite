package com.chetan.connectsuite.mirror.v2

/**
 * The phase a mirror session is in, as seen by both the Mac and the phone's Mirror tab.
 *
 * These are the wire values of `mirror.state` in docs/protocol.md. They exist because
 * `mirror.start` no longer holds a reply open across consent: the request acks with the phase it
 * entered and every later phase arrives as an event, so neither side ever has to infer progress
 * from the passage of time.
 */
enum class MirrorPhase(val wire: String) {

    /** Nothing running and nothing asked for. */
    IDLE("idle"),

    /**
     * A Mac asked, but ConnectSuite is backgrounded and Android 16 will not let a backgrounded app
     * show the capture prompt. The user must bring the app forward and tap Start mirroring.
     */
    AWAITING_FOREGROUND("awaiting-foreground"),

    /** The system prompt is on screen now. */
    REQUESTING_CONSENT("requesting-consent"),

    /** Consent granted; capture service and encoder coming up. */
    STARTING("starting"),

    /** Frames are flowing. */
    RUNNING("running"),

    /** Ended, with a reason. Terminal. */
    STOPPED("stopped"),
}

/**
 * Everything the Mirror tab draws and everything `mirror.state` carries.
 *
 * [message] and [fixHint] are written to be shown verbatim on either side — the same two lines
 * that go to the Mac's canvas go on the phone's screen, so there is one description of what is
 * happening rather than two that can disagree.
 */
data class MirrorStatus(
    val phase: MirrorPhase = MirrorPhase.IDLE,
    val message: String? = null,
    val fixHint: String? = null,

    /** Which Mac is waiting, for the phone's UI. Null when the phone started it itself. */
    val peerName: String? = null,

    /**
     * True while a `mirror.start` is outstanding and only a tap on this phone can complete it.
     * The Mirror tab's Start button is the primary consent path, so it needs to know.
     */
    val awaitingTap: Boolean = false,

    /**
     * When the Mac's request arrived on this phone, for the request screen's countdown. The consent
     * timer is armed in the same breath, so `askedAtMillis + CONSENT_TIMEOUT_MS` is when it ends —
     * a countdown computed from anything else would be a guess drawn as a fact.
     */
    val askedAtMillis: Long? = null,

    /** Set once capture is live. */
    val geometry: CaptureGeometry? = null,

    /** The last failure, kept after the session ends so the Mirror tab can still show it. */
    val lastError: String? = null,
)
