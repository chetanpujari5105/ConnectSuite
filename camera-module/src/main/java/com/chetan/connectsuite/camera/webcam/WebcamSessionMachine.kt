package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.core.protocol.ErrorCode

/**
 * Something the engine must do because the machine moved. The machine decides; the engine executes.
 *
 * [S] is the owning control session — `ControlSession` in the app, a plain object in the tests. Owners
 * are compared by **identity**: two connections from the same Mac are two owners, and a session one of
 * them approved must not be steered by the other.
 */
sealed interface WebcamEffect<out S : Any> {
    data class Ack<S : Any>(val owner: S, val requestId: String, val payload: Map<String, Any>) : WebcamEffect<S>

    /** Answer with an `error`, feature `webcam`. */
    data class Refuse<S : Any>(
        val owner: S,
        val requestId: String,
        val code: String,
        val message: String,
        val fixHint: String? = null,
    ) : WebcamEffect<S>

    data class SendState<S : Any>(val owner: S, val payload: Map<String, Any>) : WebcamEffect<S>

    /** Put the request in front of the phone's owner by [route] — the route the ack named, and no other. */
    data class ShowRequest(
        val sessionId: String,
        val peerName: String,
        val trigger: WebcamTrigger,
        val route: CameraRequestRoute,
    ) : WebcamEffect<Nothing>

    data object ClearRequest : WebcamEffect<Nothing>

    data class ArmTimer(val timer: WebcamTimer, val sessionId: String, val atMillis: Long) : WebcamEffect<Nothing>

    data object CancelTimers : WebcamEffect<Nothing>

    /**
     * Open the camera and the encoder for [sessionId] at [generation]. **Emitted by [WebcamSessionMachine.approve]
     * and by nothing else** — so nothing but the owner's tap, on time, for this session, opens either.
     */
    data class OpenCapture(val sessionId: String, val facing: CameraFacing, val generation: Int) : WebcamEffect<Nothing>

    /** Reopen inside the approved session on another camera; AUs of an older [generation] are refused. */
    data class SwitchCapture(val sessionId: String, val facing: CameraFacing, val generation: Int) : WebcamEffect<Nothing>

    data object CloseCapture : WebcamEffect<Nothing>

    data object CloseStream : WebcamEffect<Nothing>

    /** Ask the encoder for an IDR: a generation's first AU on the wire must be one. */
    data class RequestKeyframe(val sessionId: String, val generation: Int) : WebcamEffect<Nothing>

    /** An ending already recorded as [from] is now known to be [to] (the Mac's stop crossed the socket's close). */
    data class Reattributed(val sessionId: String, val from: WebcamStopReason, val to: WebcamStopReason) : WebcamEffect<Nothing>

    /**
     * The session ended. The engine fills in the counts and sends `webcam.state` `stopped` — unless
     * [reason] has no wire value, which is the owner having disconnected.
     */
    data class Stopped<S : Any>(
        val owner: S,
        val sessionId: String,
        val requestId: String,
        val reason: WebcamStopReason,
        val detail: WebcamFailureDetail? = null,
    ) : WebcamEffect<S>
}

/** What the phone's webcam screen draws. */
data class WebcamUi(
    val phase: WebcamPhase = WebcamPhase.IDLE,
    val sessionId: String? = null,
    val peerName: String? = null,
    val trigger: WebcamTrigger? = null,
    val facing: CameraFacing = CameraFacing.FRONT,
    val generation: Int = 0,
    /** The coded size the encoder is producing, once `running` has said so — never the target. */
    val selectedWidth: Int? = null,
    val selectedHeight: Int? = null,
    /** When the current wait ends: the request's expiry, or the start deadline. */
    val deadlineMillis: Long? = null,
    val lastStop: WebcamStopReason? = null,
    val lastDetail: WebcamFailureDetail? = null,
)

/** Whether an access unit may be written, and what to stamp it with. */
data class WebcamAuTicket(
    val sessionId: String,
    val generation: Int,
    val facing: CameraFacing,
    /** The first AU of its generation on the wire: an IDR, and after a switch a discontinuity. */
    val firstOfGeneration: Boolean,
)

/**
 * One webcam session at a time: request, approval, start, run, switch, and every way it ends.
 *
 * ### The rules it exists to keep (docs/protocol.md → Webcam)
 *
 * 1. **A Mac request never opens the camera.** [request] reaches `awaiting-approval` at most;
 *    [WebcamEffect.OpenCapture] is emitted only by [approve], which the phone's own screen calls after
 *    the owner's tap — and a tap at or after the request's own deadline opens nothing.
 * 2. **Consent is per session and never reused.** Each request carries a fresh `sessionId`; every way
 *    out clears it; a late tap, permission answer, camera callback or encoder buffer naming an ended
 *    session changes nothing.
 * 3. **No access unit before `running`, none after the end.** [accessUnitProduced] answers null unless
 *    the session is live, its socket is attached, and the AU's generation is current; a generation's
 *    first AU on the wire is an IDR, and `running` is announced by that IDR.
 * 4. **Ownership is identity.** Stop and switch from another connection are `UNAUTHORIZED`; a claim from
 *    another connection, for another session, or a second claim, is refused.
 * 5. **Every ending releases everything**, through [stop], in one order: timers, capture, stream,
 *    request, then the stopped event.
 * 6. **Never yields to make room.** A webcam request is refused while Camera v1 or the mirror holds a
 *    capture, and an approval finding one started meanwhile does not start — the other capture stays.
 *
 * Synchronised; the effects are returned so the lock is never held across I/O.
 */
class WebcamSessionMachine<S : Any>(
    private val requestTimeoutMs: Long = REQUEST_TIMEOUT_MS,
    private val startTimeoutMs: Long = START_TIMEOUT_MS,
) {
    private data class Live<S : Any>(
        val owner: S,
        val peerName: String,
        val requestId: String,
        val sessionId: String,
        val trigger: WebcamTrigger,
        val phase: WebcamPhase,
        val facing: CameraFacing,
        val deadlineMillis: Long,
        val generation: Int = 1,
        val channelAttached: Boolean = false,
        /** An AU of the current generation has come out of the encoder. */
        val producing: Boolean = false,
        /** `running` has been sent for the current generation. */
        val announced: Boolean = false,
        /** An IDR has been asked for the current generation and not yet seen. */
        val keyframeRequested: Boolean = false,
        val width: Int? = null,
        val height: Int? = null,
    )

    private data class Ended<S : Any>(val owner: S, val sessionId: String, val reason: WebcamStopReason)

    private var live: Live<S>? = null
    private var lastStop: WebcamStopReason? = null
    private var lastDetail: WebcamFailureDetail? = null
    private var lastEnded: Ended<S>? = null

    @Synchronized
    fun ui(): WebcamUi {
        val l = live ?: return WebcamUi(lastStop = lastStop, lastDetail = lastDetail)
        return WebcamUi(
            phase = l.phase,
            sessionId = l.sessionId,
            peerName = l.peerName,
            trigger = l.trigger,
            facing = l.facing,
            generation = l.generation,
            selectedWidth = l.width,
            selectedHeight = l.height,
            deadlineMillis = l.deadlineMillis.takeIf { l.phase != WebcamPhase.RUNNING },
        )
    }

    /** A request or session is open — what Camera v1 and the mirror's exclusion ask. */
    @Synchronized
    fun isOpen(): Boolean = live != null

    /** Whether a capture opened for [sessionId] at [generation] is still wanted — asked under the lock. */
    @Synchronized
    fun isCurrentCapture(sessionId: String, generation: Int): Boolean {
        val l = live ?: return false
        return l.sessionId == sessionId && l.phase.isLive && l.generation == generation
    }

    /** A request is waiting and its own clock has not run out. */
    @Synchronized
    fun isAwaiting(nowMillis: Long): Boolean {
        val l = live ?: return false
        return l.phase == WebcamPhase.AWAITING && nowMillis < l.deadlineMillis
    }

    // ---- the Mac's requests ---------------------------------------------------------------------

    /**
     * `webcam.request`. Reaches `awaiting-approval` at most — never opens a camera or an encoder.
     *
     * @param otherCapture what else on this phone holds a capture right now, read by the engine under the
     *   camera-use lock so it and this call are one decision; non-null is `CAMERA_BUSY`.
     */
    @Synchronized
    fun request(
        owner: S,
        peerName: String,
        requestId: String,
        facingWire: String?,
        triggerWire: String?,
        sessionId: String,
        nowMillis: Long,
        hasCamera: Boolean,
        otherCapture: OtherCapture?,
        route: CameraRequestRoute,
    ): List<WebcamEffect<S>> {
        // A webcam faces its user: front unless the Mac says otherwise.
        val facing = if (facingWire == null) CameraFacing.FRONT else CameraFacing.fromWire(facingWire)
        val trigger = WebcamTrigger.fromWire(triggerWire)
        if (facing == null || trigger == null) {
            return listOf(
                WebcamEffect.Refuse(
                    owner, requestId, ErrorCode.BAD_REQUEST,
                    "webcam.request needs trigger \"consumer\" or \"person\", and facing \"front\" or \"back\" if given.",
                ),
            )
        }
        if (!hasCamera) {
            return listOf(WebcamEffect.Refuse(owner, requestId, ErrorCode.CAMERA_UNAVAILABLE, "This phone has no camera Sidekick can use."))
        }
        val existing = live
        if (existing != null) {
            val mine = existing.owner === owner
            return listOf(
                WebcamEffect.Refuse(
                    owner, requestId, ErrorCode.CAMERA_BUSY,
                    if (mine) "This Mac already has a webcam request or session open on the phone."
                    else "Another Mac has a webcam request or session open on the phone.",
                    if (mine) "Stop it first, then ask again." else null,
                ),
            )
        }
        when (otherCapture) {
            OtherCapture.CAMERA_V1 -> return listOf(
                WebcamEffect.Refuse(
                    owner, requestId, ErrorCode.CAMERA_BUSY,
                    "The phone's camera is in use by Sidekick's Camera pane, so it is not offered as a webcam.",
                    "Stop the camera in the Camera pane first, then ask again.",
                ),
            )
            OtherCapture.MIRROR -> return listOf(
                WebcamEffect.Refuse(
                    owner, requestId, ErrorCode.CAMERA_BUSY,
                    "The phone is mirroring its screen, so the webcam is not offered.",
                    "Stop mirroring first, then ask again.",
                ),
            )
            null -> Unit
        }
        val deadline = nowMillis + requestTimeoutMs
        live = Live(owner, peerName, requestId, sessionId, trigger, WebcamPhase.AWAITING, facing, deadline)
        lastStop = null
        lastDetail = null
        lastEnded = null
        return listOf(
            WebcamEffect.Ack(owner, requestId, WebcamPayloads.awaiting(sessionId, facing, requestTimeoutMs, route)),
            WebcamEffect.ShowRequest(sessionId, peerName, trigger, route),
            WebcamEffect.ArmTimer(WebcamTimer.REQUEST, sessionId, deadline),
        )
    }

    /**
     * `webcam.stop`. Idempotent for its owner; `UNAUTHORIZED` for anyone else.
     *
     * An unknown or missing `cause` is `BAD_REQUEST` **and the session still stops**: a malformed stop
     * never leaves a camera running. A `failure` carries a [WebcamFailureDetail] chosen from the closed
     * set; any other `cause` ignores `detail`.
     *
     * When the socket's close won the race, the session already ended as `stream-closed`; a stop from the
     * same owner for that exact session, with no newer request begun, re-attributes it to this stop's
     * reason. The ack stays `stopped: false`: this stop ended nothing.
     */
    @Synchronized
    fun stopFromMac(owner: S, requestId: String, sessionId: String?, causeWire: String?, detailWire: String?): List<WebcamEffect<S>> {
        if (sessionId.isNullOrBlank()) {
            return listOf(WebcamEffect.Refuse(owner, requestId, ErrorCode.BAD_REQUEST, "webcam.stop needs the sessionId."))
        }
        val cause = WebcamStopCause.fromWire(causeWire)
        val detail = if (cause == WebcamStopCause.FAILURE) WebcamFailureDetail.fromWire(detailWire) else null
        val badCause = WebcamEffect.Refuse(
            owner, requestId, ErrorCode.BAD_REQUEST,
            "webcam.stop needs a cause of \"person\", \"no-consumers\", \"shutdown\" or \"failure\".",
        )
        val l = live
        if (l == null || l.sessionId != sessionId) {
            if (cause == null) return listOf(badCause)
            val ended = lastEnded
            if (l == null && ended != null && ended.sessionId == sessionId && ended.owner === owner &&
                ended.reason == WebcamStopReason.STREAM_CLOSED
            ) {
                lastEnded = ended.copy(reason = cause.reason)
                lastStop = cause.reason
                lastDetail = detail
                return listOf(
                    WebcamEffect.Reattributed(sessionId, WebcamStopReason.STREAM_CLOSED, cause.reason),
                    WebcamEffect.Ack(owner, requestId, mapOf("stopped" to false)),
                )
            }
            return listOf(WebcamEffect.Ack(owner, requestId, mapOf("stopped" to false)))
        }
        if (l.owner !== owner) {
            return listOf(WebcamEffect.Refuse(owner, requestId, ErrorCode.UNAUTHORIZED, "That webcam session belongs to a different connection."))
        }
        if (cause == null) return stop(WebcamStopReason.STOPPED_BY_MAC) + badCause
        return stop(cause.reason, detail) + WebcamEffect.Ack(owner, requestId, mapOf("stopped" to true))
    }

    /** `webcam.switch`: inside the approved session only — no new session, socket or approval. */
    @Synchronized
    fun switch(
        owner: S,
        requestId: String,
        sessionId: String?,
        facingWire: String?,
        facingAvailable: (CameraFacing) -> Boolean,
    ): List<WebcamEffect<S>> {
        val facing = CameraFacing.fromWire(facingWire)
        if (sessionId.isNullOrBlank() || facing == null) {
            return listOf(
                WebcamEffect.Refuse(owner, requestId, ErrorCode.BAD_REQUEST, "webcam.switch needs the sessionId and a facing of \"front\" or \"back\"."),
            )
        }
        val l = live
        if (l == null || l.sessionId != sessionId || !l.phase.isLive) {
            return listOf(WebcamEffect.Refuse(owner, requestId, ErrorCode.NOT_FOUND, "No live webcam session has that id."))
        }
        if (l.owner !== owner) {
            return listOf(WebcamEffect.Refuse(owner, requestId, ErrorCode.UNAUTHORIZED, "That webcam session belongs to a different connection."))
        }
        if (facing == l.facing) return listOf(WebcamEffect.Ack(owner, requestId, mapOf("facing" to facing.wire)))
        if (!facingAvailable(facing)) {
            return listOf(
                WebcamEffect.Refuse(
                    owner, requestId, ErrorCode.CAMERA_UNAVAILABLE,
                    "This phone has no ${facing.wire} camera Sidekick can use; the ${l.facing.wire} camera stays on.",
                ),
            )
        }
        val next = nextGeneration(l) ?: return listOf(
            WebcamEffect.Refuse(owner, requestId, ErrorCode.CAMERA_UNAVAILABLE, "This session has switched too many times; stop it and ask again."),
        )
        live = next.copy(facing = facing)
        return listOf(
            WebcamEffect.Ack(owner, requestId, mapOf("facing" to facing.wire)),
            WebcamEffect.SwitchCapture(sessionId, facing, next.generation),
        )
    }

    /** The phone's own Switch button: the same rebind as [switch], with no request to answer. */
    @Synchronized
    fun phoneSwitch(sessionId: String, facing: CameraFacing): List<WebcamEffect<S>> {
        val l = live
        if (l == null || l.sessionId != sessionId || !l.phase.isLive || facing == l.facing) return emptyList()
        val next = nextGeneration(l) ?: return emptyList()
        live = next.copy(facing = facing)
        return listOf(WebcamEffect.SwitchCapture(sessionId, facing, next.generation))
    }

    // ---- the phone's owner ----------------------------------------------------------------------

    /**
     * The owner tapped **Start camera** for [sessionId], and `CAMERA` is granted. The only route to
     * [WebcamEffect.OpenCapture].
     *
     * - A tap naming a session that is not awaiting does nothing: answered, expired, stopped or replaced.
     * - A tap at or after the request's own deadline ends it `expired` and opens nothing, whether or not
     *   the expiry timer has run yet. The same holds for a permission dialog answering late.
     * - A tap finding another capture started meanwhile ([busyNow], the mirror) does not start: that
     *   capture is preserved and this one ends `camera-in-use`.
     * - A tap while the phone is already at critical thermal status ends `too-hot`.
     */
    @Synchronized
    fun approve(sessionId: String, facing: CameraFacing, nowMillis: Long, busyNow: OtherCapture?, thermalStatus: Int): List<WebcamEffect<S>> {
        val l = live
        if (l == null || l.sessionId != sessionId || l.phase != WebcamPhase.AWAITING) return emptyList()
        if (nowMillis >= l.deadlineMillis) return stop(WebcamStopReason.EXPIRED)
        if (busyNow != null) return stop(WebcamStopReason.CAPTURE_BUSY)
        if (WebcamThermal.mustStop(thermalStatus)) return stop(WebcamStopReason.TOO_HOT)
        val deadline = nowMillis + startTimeoutMs
        live = l.copy(phase = WebcamPhase.STARTING, facing = facing, deadlineMillis = deadline)
        return listOf(
            WebcamEffect.CancelTimers,
            WebcamEffect.ClearRequest,
            WebcamEffect.SendState(l.owner, WebcamPayloads.starting(sessionId, l.requestId, facing)),
            WebcamEffect.OpenCapture(sessionId, facing, l.generation),
            WebcamEffect.ArmTimer(WebcamTimer.START, sessionId, deadline),
        )
    }

    @Synchronized
    fun decline(sessionId: String): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.sessionId != sessionId || l.phase != WebcamPhase.AWAITING) return emptyList()
        return stop(WebcamStopReason.DECLINED)
    }

    /** Android's permission dialog said no. After the deadline, the request had already run out. */
    @Synchronized
    fun permissionDenied(sessionId: String, nowMillis: Long): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.sessionId != sessionId || l.phase != WebcamPhase.AWAITING) return emptyList()
        return stop(if (nowMillis >= l.deadlineMillis) WebcamStopReason.EXPIRED else WebcamStopReason.PERMISSION_DENIED)
    }

    /** The phone's Stop. Before approval it is a decline. */
    @Synchronized
    fun stopFromPhone(): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        return stop(if (l.phase == WebcamPhase.AWAITING) WebcamStopReason.DECLINED else WebcamStopReason.STOPPED_ON_PHONE)
    }

    /** The webcam screen stopped being visible. Foreground-only: a live session ends; a waiting request stays. */
    @Synchronized
    fun visibilityLost(): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (!l.phase.isLive) return emptyList()
        return stop(WebcamStopReason.LEFT_SCREEN)
    }

    // ---- the link, the capture and the clock ------------------------------------------------------

    /** The control session [owner] ended: its session ends at once, and nothing is sent to anyone. */
    @Synchronized
    fun sessionEnded(owner: S): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.owner !== owner) return emptyList()
        return stop(WebcamStopReason.MAC_DISCONNECTED)
    }

    /** A socket claimed [sessionId] from [owner]. All five claim conditions, and claimed once. */
    @Synchronized
    fun offerChannel(owner: S, sessionId: String): Boolean {
        val l = live
        if (l == null || l.owner !== owner || l.sessionId != sessionId || !l.phase.isLive || l.channelAttached) return false
        live = l.copy(channelAttached = true)
        return true
    }

    /** The attached socket closed. */
    @Synchronized
    fun streamClosed(sessionId: String): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.sessionId != sessionId || !l.phase.isLive || !l.channelAttached) return emptyList()
        return stop(WebcamStopReason.STREAM_CLOSED)
    }

    /**
     * The encoder produced an access unit for [sessionId] at [generation], [width] × [height] coded.
     * Returns the ticket to write it with, or null — before the socket is attached, for an ended session
     * or an older generation, and for every AU of a generation before its first IDR (an IDR is asked for
     * once). The first IDR of a generation announces `running`.
     */
    @Synchronized
    fun accessUnitProduced(sessionId: String, generation: Int, keyframe: Boolean, width: Int, height: Int): Pair<WebcamAuTicket?, List<WebcamEffect<S>>> {
        val l = live
        if (l == null || l.sessionId != sessionId || !l.phase.isLive || l.generation != generation) return null to emptyList()
        var next = l.copy(producing = true)
        if (!next.channelAttached) {
            live = next
            return null to emptyList()
        }
        val effects = mutableListOf<WebcamEffect<S>>()
        var first = false
        if (!next.announced) {
            if (!keyframe) {
                if (!next.keyframeRequested) effects += WebcamEffect.RequestKeyframe(sessionId, generation)
                live = next.copy(keyframeRequested = true)
                return null to effects
            }
            val switched = next.phase == WebcamPhase.RUNNING
            if (next.phase == WebcamPhase.STARTING) effects += WebcamEffect.CancelTimers
            next = next.copy(phase = WebcamPhase.RUNNING, announced = true, keyframeRequested = false, width = width, height = height)
            effects += WebcamEffect.SendState(
                l.owner,
                WebcamPayloads.running(sessionId, l.requestId, l.facing, width, height, generation, switched),
            )
            first = true
        }
        live = next
        return WebcamAuTicket(sessionId, generation, next.facing, first) to effects
    }

    /**
     * The encoder had to be rebuilt inside the session — a size change on the quality ladder. The
     * generation moves on exactly as for a switch; returns the new one, or null if the session moved on.
     */
    @Synchronized
    fun reconfigured(sessionId: String, fromGeneration: Int): Int? {
        val l = live ?: return null
        if (l.sessionId != sessionId || !l.phase.isLive || l.generation != fromGeneration) return null
        val next = nextGeneration(l) ?: return null
        live = next
        return next.generation
    }

    /** The camera or the encoder failed for [sessionId]. A failure naming an ended session changes nothing. */
    @Synchronized
    fun captureFailed(sessionId: String, reason: WebcamStopReason): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.sessionId != sessionId || !l.phase.isLive) return emptyList()
        return stop(reason)
    }

    /** The phone's `PowerManager` thermal status changed. Critical ends a live session `too-hot`. */
    @Synchronized
    fun thermalChanged(status: Int): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (!l.phase.isLive || !WebcamThermal.mustStop(status)) return emptyList()
        return stop(WebcamStopReason.TOO_HOT)
    }

    /** A deadline armed for [sessionId] has passed. A deadline for a session that has moved on does nothing. */
    @Synchronized
    fun timerFired(timer: WebcamTimer, sessionId: String, nowMillis: Long): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        if (l.sessionId != sessionId || nowMillis < l.deadlineMillis) return emptyList()
        return when (timer) {
            WebcamTimer.REQUEST -> if (l.phase == WebcamPhase.AWAITING) stop(WebcamStopReason.EXPIRED) else emptyList()
            WebcamTimer.START -> when {
                l.phase != WebcamPhase.STARTING -> emptyList()
                !l.channelAttached -> stop(WebcamStopReason.STREAM_NOT_OPENED)
                else -> stop(WebcamStopReason.CAMERA_NOT_STARTED)
            }
        }
    }

    // ---- the single exit ------------------------------------------------------------------------

    /** Every way out. The state is cleared **first**, so an AU arriving while the effects run is refused. */
    private fun stop(reason: WebcamStopReason, detail: WebcamFailureDetail? = null): List<WebcamEffect<S>> {
        val l = live ?: return emptyList()
        live = null
        lastStop = reason
        lastDetail = detail
        lastEnded = Ended(l.owner, l.sessionId, reason)
        return listOf(
            WebcamEffect.CancelTimers,
            WebcamEffect.CloseCapture,
            WebcamEffect.CloseStream,
            WebcamEffect.ClearRequest,
            WebcamEffect.Stopped(l.owner, l.sessionId, l.requestId, reason, detail),
        )
    }

    private fun nextGeneration(l: Live<S>): Live<S>? {
        if (l.generation >= MAX_GENERATION) return null
        return l.copy(generation = l.generation + 1, producing = false, announced = false, keyframeRequested = false)
    }

    companion object {
        /** docs/protocol.md → `webcam.request`: an unanswered request expires after this, on its own clock. */
        const val REQUEST_TIMEOUT_MS = 30_000L

        /** After approval, the Mac's socket and the first IDR must both arrive within this. */
        const val START_TIMEOUT_MS = 10_000L

        /** The header's generation is a u16, ≥ 1. */
        const val MAX_GENERATION = 0xFFFF
    }
}

/** `PowerManager`'s thermal statuses, as the machine reads them. Injected in tests as plain ints. */
object WebcamThermal {
    /** `PowerManager.THERMAL_STATUS_CRITICAL`, held to the platform's constant by a test. */
    const val CRITICAL = 4

    /** docs/protocol.md → `webcam.state` `too-hot`: the session ends at critical, and only there. */
    fun mustStop(status: Int): Boolean = status >= CRITICAL
}

/**
 * The `webcam.*` payloads, built in one place so a test asserts the map the wire carries. `message` is
 * for a person; the Mac switches on `state` and `reason`.
 */
object WebcamPayloads {
    fun awaiting(sessionId: String, facing: CameraFacing, expiresInMs: Long, route: CameraRequestRoute): Map<String, Any> = mapOf(
        "state" to WebcamPhase.AWAITING.wire,
        "sessionId" to sessionId,
        "facing" to facing.wire,
        "expiresInMs" to expiresInMs,
        "message" to route.message,
        "fixHint" to route.fixHint,
    )

    fun starting(sessionId: String, requestId: String, facing: CameraFacing): Map<String, Any> = mapOf(
        "state" to WebcamPhase.STARTING.wire,
        "sessionId" to sessionId,
        "requestId" to requestId,
        "facing" to facing.wire,
        "message" to "Allowed on the phone. The camera is starting.",
    )

    /**
     * `running`. `width`/`height` are the size the encoder **actually** produces, read from the AU that
     * announced it; `targetWidth`/`targetHeight`/`frameRate` are the targets, never measurements.
     */
    fun running(
        sessionId: String,
        requestId: String,
        facing: CameraFacing,
        width: Int,
        height: Int,
        generation: Int,
        switched: Boolean,
    ): Map<String, Any> = buildMap {
        put("state", WebcamPhase.RUNNING.wire)
        put("sessionId", sessionId)
        put("requestId", requestId)
        put("facing", facing.wire)
        put("width", width)
        put("height", height)
        put("targetWidth", WebcamQuality.TARGET_WIDTH)
        put("targetHeight", WebcamQuality.TARGET_HEIGHT)
        put("frameRate", WebcamQuality.TARGET_FPS)
        put("codec", "h264")
        put("generation", generation)
        put("message", "Live from the phone's ${facing.wire} camera as Sidekick Camera.")
        if (switched) put("switched", true)
    }

    /** Null for a reason with no wire value: the engine sends nothing for those. */
    fun stopped(
        sessionId: String,
        requestId: String,
        reason: WebcamStopReason,
        detail: WebcamFailureDetail?,
        framesSent: Long,
        framesDropped: Long,
    ): Map<String, Any>? {
        val wire = reason.wire ?: return null
        return buildMap {
            put("state", "stopped")
            put("sessionId", sessionId)
            put("requestId", requestId)
            put("reason", wire)
            put("message", reason.messageFor(detail))
            reason.fixHint?.let { put("fixHint", it) }
            put("framesSent", framesSent)
            put("framesDropped", framesDropped)
        }
    }
}

/** The `[webcam]` log phrases about the machine's effects. Never a token, never more than 8 id characters. */
object WebcamLogLines {
    fun describe(effects: List<WebcamEffect<*>>): String =
        effects.joinToString(", ") {
            when (it) {
                is WebcamEffect.Refuse<*> -> "refused ${it.code}"
                is WebcamEffect.Stopped<*> -> "stopped ${it.reason.name}${it.detail?.let { d -> " (${d.name})" } ?: ""}"
                is WebcamEffect.Reattributed -> "re-attributed ${it.from.name} → ${it.to.name}"
                is WebcamEffect.SendState<*> -> "state ${it.payload["state"]}"
                is WebcamEffect.ShowRequest -> "ShowRequest(${it.route.name.lowercase()}, ${it.trigger.wire})"
                is WebcamEffect.OpenCapture -> "OpenCapture(${it.facing.wire}, generation ${it.generation})"
                is WebcamEffect.SwitchCapture -> "SwitchCapture(${it.facing.wire}, generation ${it.generation})"
                is WebcamEffect.RequestKeyframe -> "RequestKeyframe(generation ${it.generation})"
                else -> it.javaClass.simpleName
            }
        }.ifEmpty { "no change" }
}
