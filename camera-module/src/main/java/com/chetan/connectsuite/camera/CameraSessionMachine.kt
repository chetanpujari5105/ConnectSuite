package com.chetan.connectsuite.camera

import com.chetan.connectsuite.core.protocol.ErrorCode

/**
 * Something the engine must do because the machine moved. The machine decides; the engine executes.
 *
 * [S] is the owning control session — `ControlSession` in the app, a plain token in the tests. The
 * machine compares owners by **identity** and nothing else, because a session is a connection, and two
 * connections from the same Mac are two owners: a stream approved for one must not be steered by the
 * next.
 */
sealed interface CameraEffect<out S : Any> {
    /** Answer the request with an ack carrying [payload]. */
    data class Ack<S : Any>(val owner: S, val requestId: String, val payload: Map<String, Any>) : CameraEffect<S>

    /** Answer the request with an `error`, feature `camera`. Nothing changed. */
    data class Refuse<S : Any>(
        val owner: S,
        val requestId: String,
        val code: String,
        val message: String,
        val fixHint: String? = null,
    ) : CameraEffect<S>

    /** Send a `camera.state` event to [owner]. */
    data class SendState<S : Any>(val owner: S, val payload: Map<String, Any>) : CameraEffect<S>

    /**
     * Put the request in front of the owner by [route] — the route the ack has just told the Mac about,
     * so the engine carries out exactly that one and never a different one it picks later.
     */
    data class ShowRequest(val streamId: String, val peerName: String, val route: CameraRequestRoute) : CameraEffect<Nothing>

    /** The request is answered or gone; its notification must not outlive it. */
    data object ClearRequest : CameraEffect<Nothing>

    data class ArmTimer(val timer: CameraTimer, val streamId: String, val atMillis: Long) : CameraEffect<Nothing>

    data object CancelTimers : CameraEffect<Nothing>

    /** Open the camera — only ever after the owner's tap. [epoch] stamps the frames it produces. */
    data class OpenCamera(val streamId: String, val facing: CameraFacing, val epoch: Int) : CameraEffect<Nothing>

    /** Rebind to the other camera inside the same stream. Frames from the old [epoch] are refused. */
    data class SwitchCamera(val streamId: String, val facing: CameraFacing, val epoch: Int) : CameraEffect<Nothing>

    data object CloseCamera : CameraEffect<Nothing>

    data object CloseStream : CameraEffect<Nothing>

    /**
     * A stream that had already ended as [from] is now known to have ended as [to] — the owner's
     * `camera.stop` arrived just after its socket closed (defect 167). Nothing is released, because
     * everything already was; the phone's own screen and log say the truer reason.
     */
    data class Reattributed(val streamId: String, val from: CameraStopReason, val to: CameraStopReason) : CameraEffect<Nothing>

    /**
     * The stream ended. The engine fills in `framesSent`/`framesDropped` from the socket's tally and
     * sends `camera.state: stopped` — **unless [reason] has no wire value**, which is the owner
     * having disconnected, when there is nobody to send it to.
     */
    data class Stopped<S : Any>(
        val owner: S,
        val streamId: String,
        val requestId: String,
        val reason: CameraStopReason,
    ) : CameraEffect<S>
}

/** What the phone's camera screen draws. One description, from the same place the Mac's comes from. */
data class CameraUi(
    val phase: CameraPhase = CameraPhase.IDLE,
    val streamId: String? = null,
    val peerName: String? = null,
    val facing: CameraFacing = CameraFacing.BACK,
    /** When the current wait ends — the request's expiry, or the start deadline. */
    val deadlineMillis: Long? = null,
    /** How the last stream ended, kept so the screen can still say so after it has. */
    val lastStop: CameraStopReason? = null,
)

/** Whether a produced frame may be sent, and what to stamp it with. */
data class FrameTicket(val facing: CameraFacing, val epoch: Int)

/**
 * One camera stream at a time: request, approval, start, run, switch and every way it ends.
 *
 * ### The rules it exists to keep (docs/protocol.md → Camera)
 *
 * 1. **A Mac request never opens the camera.** [request] can only reach `awaiting-approval`;
 *    [CameraEffect.OpenCamera] is emitted by [approve] and by nothing else, and [approve] is called by
 *    the phone's own screen after the owner's tap.
 * 2. **Consent is per stream.** Every stream has its own `streamId`, every way out clears it, and a
 *    late tap naming a stream that has ended does nothing.
 * 3. **No frame before approval, none after the end.** [frameProduced] answers null unless the
 *    stream is live, the socket is attached, and the frame's epoch is the current camera's.
 * 4. **Ownership is identity.** Stop and switch from any other session are refused; a socket claim
 *    from any other session, or for any other stream, or a second claim, is refused.
 * 5. **Every end releases everything.** [stop] is the single exit and always emits cancel-timers,
 *    close-camera, close-stream and clear-request before the stopped event.
 *
 * Synchronised: socket handlers, the camera's analysis thread, timers and the UI all call in. The
 * effects are returned rather than performed so the lock is never held across I/O.
 */
class CameraSessionMachine<S : Any>(
    private val requestTimeoutMs: Long = REQUEST_TIMEOUT_MS,
    private val startTimeoutMs: Long = START_TIMEOUT_MS,
    private val frameRateCap: Int = FRAME_RATE_CAP,
) {
    private data class Live<S : Any>(
        val owner: S,
        val peerName: String,
        val requestId: String,
        val streamId: String,
        val phase: CameraPhase,
        val facing: CameraFacing,
        val deadlineMillis: Long,
        val epoch: Int = 0,
        val channelAttached: Boolean = false,
        /** A frame has been produced by the current epoch's camera. */
        val cameraProducing: Boolean = false,
        /** `running` has been sent for the current epoch. */
        val announced: Boolean = false,
    )

    /** The stream that ended last: whose it was, which it was, and why — for [stopFromMac] only. */
    private data class Ended<S : Any>(val owner: S, val streamId: String, val reason: CameraStopReason)

    private var live: Live<S>? = null
    private var lastStop: CameraStopReason? = null
    private var lastEnded: Ended<S>? = null

    @Synchronized
    fun ui(): CameraUi {
        val l = live ?: return CameraUi(lastStop = lastStop)
        return CameraUi(
            phase = l.phase,
            streamId = l.streamId,
            peerName = l.peerName,
            facing = l.facing,
            deadlineMillis = l.deadlineMillis.takeIf { l.phase != CameraPhase.RUNNING },
            lastStop = null,
        )
    }

    /** The stream id the camera may currently be open for, or null. */
    @Synchronized
    fun liveStreamId(): String? = live?.takeIf { it.phase.isLive }?.streamId

    /**
     * Whether a camera opened for [streamId] at [epoch] is still wanted — asked by the camera screen when
     * CameraX finally comes up, which can be long after it was asked to open. Asked of the machine, under
     * its lock, rather than of the published screen state, which trails the machine (defect 169).
     */
    @Synchronized
    fun isCurrentCamera(streamId: String, epoch: Int): Boolean {
        val l = live ?: return false
        return l.streamId == streamId && l.phase.isLive && l.epoch == epoch
    }

    /**
     * A request is waiting **and its own clock has not run out** — the question Sidekick coming to the
     * front asks before it puts the request screen up. The expiry timer can be late; the deadline is not.
     */
    @Synchronized
    fun isAwaiting(nowMillis: Long): Boolean {
        val l = live ?: return false
        return l.phase == CameraPhase.AWAITING && nowMillis < l.deadlineMillis
    }

    // ---- the Mac's requests ---------------------------------------------------------------------

    /**
     * `camera.request`. Reaches `awaiting-approval` at most — never opens the camera.
     *
     * @param route how the request will reach the owner — decided by the engine before this call, from
     *   what it could check, and carried by both the ack's sentence and [CameraEffect.ShowRequest] so the
     *   Mac is never told about a route that is not the one taken (defect 171).
     */
    @Synchronized
    fun request(
        owner: S,
        peerName: String,
        requestId: String,
        facingWire: String?,
        streamId: String,
        nowMillis: Long,
        hasCamera: Boolean,
        mirrorBusy: Boolean,
        route: CameraRequestRoute,
    ): List<CameraEffect<S>> {
        val facing = if (facingWire == null) CameraFacing.BACK else CameraFacing.fromWire(facingWire)
        if (facing == null) {
            return listOf(CameraEffect.Refuse(owner, requestId, ErrorCode.BAD_REQUEST, "facing must be \"back\" or \"front\"."))
        }
        if (!hasCamera) {
            return listOf(
                CameraEffect.Refuse(owner, requestId, ErrorCode.CAMERA_UNAVAILABLE, "This phone has no camera Sidekick can use."),
            )
        }
        if (mirrorBusy) {
            return listOf(
                CameraEffect.Refuse(
                    owner,
                    requestId,
                    ErrorCode.CAMERA_BUSY,
                    "The phone is mirroring its screen, so the camera is not offered.",
                    "Stop mirroring first, then ask for the camera again.",
                ),
            )
        }
        val existing = live
        if (existing != null) {
            val mine = existing.owner === owner
            return listOf(
                CameraEffect.Refuse(
                    owner,
                    requestId,
                    ErrorCode.CAMERA_BUSY,
                    if (mine) "This Mac already has a camera request or stream open on the phone."
                    else "Another Mac has a camera request or stream open on the phone.",
                    if (mine) "Stop it first, then ask again." else null,
                ),
            )
        }

        val deadline = nowMillis + requestTimeoutMs
        live = Live(owner, peerName, requestId, streamId, CameraPhase.AWAITING, facing, deadline)
        lastStop = null
        lastEnded = null
        return listOf(
            CameraEffect.Ack(owner, requestId, CameraPayloads.awaiting(streamId, facing, requestTimeoutMs, route)),
            CameraEffect.ShowRequest(streamId, peerName, route),
            CameraEffect.ArmTimer(CameraTimer.REQUEST, streamId, deadline),
        )
    }

    /**
     * `camera.stop`. Idempotent for its owner; refused for anyone else.
     *
     * The Mac stops its picture at once and sends this on the control channel, so it and the stream
     * socket's close race on two connections. When the close wins, the stream has already ended as
     * [CameraStopReason.STREAM_CLOSED] — a reason that only means *nobody said why*. A stop that then
     * arrives from the **same owner**, for **that exact stream**, with **no newer stream begun**, says
     * why, and the ending is re-attributed to [CameraStopReason.STOPPED_BY_MAC] (defect 167). Any other
     * ending is a reason somebody did state, and is left alone. The ack stays `stopped: false`: this
     * stop ended nothing.
     */
    @Synchronized
    fun stopFromMac(owner: S, requestId: String, streamId: String?): List<CameraEffect<S>> {
        if (streamId.isNullOrBlank()) {
            return listOf(CameraEffect.Refuse(owner, requestId, ErrorCode.BAD_REQUEST, "camera.stop needs the streamId."))
        }
        val l = live
        if (l == null || l.streamId != streamId) {
            val ended = lastEnded
            if (l == null && ended != null && ended.streamId == streamId && ended.owner === owner &&
                ended.reason == CameraStopReason.STREAM_CLOSED
            ) {
                lastEnded = ended.copy(reason = CameraStopReason.STOPPED_BY_MAC)
                lastStop = CameraStopReason.STOPPED_BY_MAC
                return listOf(
                    CameraEffect.Reattributed(streamId, CameraStopReason.STREAM_CLOSED, CameraStopReason.STOPPED_BY_MAC),
                    CameraEffect.Ack(owner, requestId, mapOf("stopped" to false)),
                )
            }
            return listOf(CameraEffect.Ack(owner, requestId, mapOf("stopped" to false)))
        }
        if (l.owner !== owner) {
            return listOf(
                CameraEffect.Refuse(owner, requestId, ErrorCode.UNAUTHORIZED, "That camera stream belongs to a different connection."),
            )
        }
        return stop(CameraStopReason.STOPPED_BY_MAC) + CameraEffect.Ack(owner, requestId, mapOf("stopped" to true))
    }

    /** `camera.switch`. Inside the approved stream only: no new stream, no new approval. */
    @Synchronized
    fun switch(
        owner: S,
        requestId: String,
        streamId: String?,
        facingWire: String?,
        facingAvailable: (CameraFacing) -> Boolean,
    ): List<CameraEffect<S>> {
        val facing = CameraFacing.fromWire(facingWire)
        if (streamId.isNullOrBlank() || facing == null) {
            return listOf(
                CameraEffect.Refuse(owner, requestId, ErrorCode.BAD_REQUEST, "camera.switch needs the streamId and a facing of \"back\" or \"front\"."),
            )
        }
        val l = live
        if (l == null || l.streamId != streamId || !l.phase.isLive) {
            return listOf(CameraEffect.Refuse(owner, requestId, ErrorCode.NOT_FOUND, "No live camera stream has that id."))
        }
        if (l.owner !== owner) {
            return listOf(
                CameraEffect.Refuse(owner, requestId, ErrorCode.UNAUTHORIZED, "That camera stream belongs to a different connection."),
            )
        }
        if (facing == l.facing) return listOf(CameraEffect.Ack(owner, requestId, mapOf("facing" to facing.wire)))
        if (!facingAvailable(facing)) {
            return listOf(
                CameraEffect.Refuse(
                    owner,
                    requestId,
                    ErrorCode.CAMERA_UNAVAILABLE,
                    "This phone has no ${facing.wire} camera Sidekick can use; the ${l.facing.wire} camera stays on.",
                ),
            )
        }
        val epoch = (l.epoch + 1) % 256
        live = l.copy(facing = facing, epoch = epoch, cameraProducing = false, announced = false)
        return listOf(
            CameraEffect.Ack(owner, requestId, mapOf("facing" to facing.wire)),
            CameraEffect.SwitchCamera(streamId, facing, epoch),
        )
    }

    /**
     * The phone's own Switch button. The same rebind as [switch], inside the same stream; there is no
     * request to answer, and the Mac learns of it from the `running` (`switched`) that follows.
     */
    @Synchronized
    fun phoneSwitch(streamId: String, facing: CameraFacing): List<CameraEffect<S>> {
        val l = live
        if (l == null || l.streamId != streamId || !l.phase.isLive || facing == l.facing) return emptyList()
        val epoch = (l.epoch + 1) % 256
        live = l.copy(facing = facing, epoch = epoch, cameraProducing = false, announced = false)
        return listOf(CameraEffect.SwitchCamera(streamId, facing, epoch))
    }

    // ---- the phone's owner ----------------------------------------------------------------------

    /**
     * The owner tapped **Start camera** for [streamId], and `CAMERA` is granted. The one route to
     * [CameraEffect.OpenCamera]. A tap naming a stream that is not awaiting does nothing: it was
     * answered, expired, or replaced while the screen was up.
     *
     * **A tap at or after the request's own deadline ends it as `expired` and opens nothing**, whether or
     * not the expiry timer has run yet (defect 170). The timer is a thread that can be late; the Mac's
     * backstop is not waiting for it, and consent given to a request that has run out is not consent to
     * anything the Mac still holds open. The same holds for Android's permission dialog answering late.
     */
    @Synchronized
    fun approve(streamId: String, facing: CameraFacing, nowMillis: Long): List<CameraEffect<S>> {
        val l = live
        if (l == null || l.streamId != streamId || l.phase != CameraPhase.AWAITING) return emptyList()
        if (nowMillis >= l.deadlineMillis) return stop(CameraStopReason.EXPIRED)
        val deadline = nowMillis + startTimeoutMs
        live = l.copy(phase = CameraPhase.STARTING, facing = facing, deadlineMillis = deadline)
        return listOf(
            CameraEffect.CancelTimers,
            CameraEffect.ClearRequest,
            CameraEffect.SendState(l.owner, CameraPayloads.starting(streamId, l.requestId, facing)),
            CameraEffect.OpenCamera(streamId, facing, l.epoch),
            CameraEffect.ArmTimer(CameraTimer.START, streamId, deadline),
        )
    }

    /** The owner tapped Decline, or backed out of the request screen. */
    @Synchronized
    fun decline(streamId: String): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.streamId != streamId || l.phase != CameraPhase.AWAITING) return emptyList()
        return stop(CameraStopReason.DECLINED)
    }

    /**
     * The owner tapped Start camera and refused Android's camera permission. An answer that arrives after
     * the request's deadline ends it as `expired`: the request ran out first, and the Mac has been told so
     * or is about to be.
     */
    @Synchronized
    fun permissionDenied(streamId: String, nowMillis: Long): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.streamId != streamId || l.phase != CameraPhase.AWAITING) return emptyList()
        return stop(if (nowMillis >= l.deadlineMillis) CameraStopReason.EXPIRED else CameraStopReason.PERMISSION_DENIED)
    }

    /** The phone's Stop. Before approval it is a decline; after it, a stop. */
    @Synchronized
    fun stopFromPhone(): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        return stop(if (l.phase == CameraPhase.AWAITING) CameraStopReason.DECLINED else CameraStopReason.STOPPED_ON_PHONE)
    }

    /**
     * The camera screen stopped being visible. Ends a live stream — v1 is foreground-only — and leaves
     * a waiting request alone: its notification still offers the screen until it expires.
     */
    @Synchronized
    fun visibilityLost(): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (!l.phase.isLive) return emptyList()
        return stop(CameraStopReason.LEFT_SCREEN)
    }

    // ---- the link, the camera and the clock ------------------------------------------------------

    /** The control session [owner] ended. Its stream ends at once, and nothing is sent to anyone. */
    @Synchronized
    fun sessionEnded(owner: S): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.owner !== owner) return emptyList()
        return stop(CameraStopReason.MAC_DISCONNECTED)
    }

    /**
     * A socket claimed [streamId] from [owner]. Accepted only when every condition in
     * docs/protocol.md → The stream claim on 42502 holds; the caller closes a refused socket.
     */
    @Synchronized
    fun offerChannel(owner: S, streamId: String): Boolean {
        val l = live
        if (l == null || l.owner !== owner || l.streamId != streamId || !l.phase.isLive || l.channelAttached) {
            return false
        }
        live = l.copy(channelAttached = true)
        return true
    }

    /** The attached socket closed — the Mac hung up, or wrote where it must only read. */
    @Synchronized
    fun streamClosed(streamId: String): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.streamId != streamId || !l.phase.isLive || !l.channelAttached) return emptyList()
        return stop(CameraStopReason.STREAM_CLOSED)
    }

    /**
     * The camera produced a frame for [streamId] from the camera of [epoch]. Returns what to stamp it
     * with when it may be sent, or null — before approval, after the end, before the socket is
     * attached, or from a camera a switch has already replaced. The first frame that may be sent in an
     * epoch moves the stream to `running` and announces it.
     */
    @Synchronized
    fun frameProduced(streamId: String, epoch: Int, width: Int, height: Int): Pair<FrameTicket?, List<CameraEffect<S>>> {
        val l = live
        if (l == null || l.streamId != streamId || !l.phase.isLive || l.epoch != epoch) return null to emptyList()
        val producing = l.copy(cameraProducing = true)
        if (!producing.channelAttached) {
            live = producing
            return null to emptyList()
        }
        val effects = mutableListOf<CameraEffect<S>>()
        var next = producing
        if (!producing.announced) {
            val switched = producing.phase == CameraPhase.RUNNING
            if (producing.phase == CameraPhase.STARTING) effects += CameraEffect.CancelTimers
            next = producing.copy(phase = CameraPhase.RUNNING, announced = true)
            effects += CameraEffect.SendState(
                l.owner,
                CameraPayloads.running(streamId, l.requestId, l.facing, width, height, frameRateCap, switched),
            )
        }
        live = next
        return FrameTicket(next.facing, next.epoch) to effects
    }

    /** The camera failed for [streamId]: in use, unavailable, or unable to produce frames. */
    @Synchronized
    fun cameraFailed(streamId: String, reason: CameraStopReason): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.streamId != streamId || !l.phase.isLive) return emptyList()
        return stop(reason)
    }

    /** A deadline armed for [streamId] has passed. A deadline for a stream that has moved on does nothing. */
    @Synchronized
    fun timerFired(timer: CameraTimer, streamId: String, nowMillis: Long): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        if (l.streamId != streamId || nowMillis < l.deadlineMillis) return emptyList()
        return when (timer) {
            CameraTimer.REQUEST ->
                if (l.phase == CameraPhase.AWAITING) stop(CameraStopReason.EXPIRED) else emptyList()
            CameraTimer.START -> when {
                l.phase != CameraPhase.STARTING -> emptyList()
                !l.channelAttached -> stop(CameraStopReason.STREAM_NOT_OPENED)
                !l.cameraProducing -> stop(CameraStopReason.CAMERA_NOT_STARTED)
                else -> emptyList()
            }
        }
    }

    // ---- the single exit ------------------------------------------------------------------------

    /**
     * Every way out, in the order docs/protocol.md → Lifecycle gives. The state is cleared **first**,
     * so a frame arriving while the effects run is refused by [frameProduced] before the camera has
     * even been unbound — the gate closes before the hardware does.
     */
    private fun stop(reason: CameraStopReason): List<CameraEffect<S>> {
        val l = live ?: return emptyList()
        live = null
        lastStop = reason
        lastEnded = Ended(l.owner, l.streamId, reason)
        return listOf(
            CameraEffect.CancelTimers,
            CameraEffect.CloseCamera,
            CameraEffect.CloseStream,
            CameraEffect.ClearRequest,
            CameraEffect.Stopped(l.owner, l.streamId, l.requestId, reason),
        )
    }

    companion object {
        /** docs/protocol.md → `camera.request`: an unanswered request expires after this. */
        const val REQUEST_TIMEOUT_MS = 30_000L

        /** After approval, the Mac's socket and the first frame must both arrive within this. */
        const val START_TIMEOUT_MS = 10_000L

        /** The phone's cap, reported in `running` as a cap and never as a measurement. */
        const val FRAME_RATE_CAP = 15
    }
}

/**
 * The `camera.*` payloads, built in one place so a test asserts the map the wire carries.
 *
 * `message` is a sentence for a person; the Mac switches on `state` and `reason`.
 */
object CameraPayloads {
    fun awaiting(streamId: String, facing: CameraFacing, expiresInMs: Long, route: CameraRequestRoute): Map<String, Any> = mapOf(
        "state" to CameraPhase.AWAITING.wire,
        "streamId" to streamId,
        "facing" to facing.wire,
        "expiresInMs" to expiresInMs,
        "message" to route.message,
        "fixHint" to route.fixHint,
    )

    fun starting(streamId: String, requestId: String, facing: CameraFacing): Map<String, Any> = mapOf(
        "state" to CameraPhase.STARTING.wire,
        "streamId" to streamId,
        "requestId" to requestId,
        "facing" to facing.wire,
        "message" to "Allowed on the phone. The camera is starting.",
    )

    fun running(
        streamId: String,
        requestId: String,
        facing: CameraFacing,
        width: Int,
        height: Int,
        frameRateCap: Int,
        switched: Boolean,
    ): Map<String, Any> = buildMap {
        put("state", CameraPhase.RUNNING.wire)
        put("streamId", streamId)
        put("requestId", requestId)
        put("facing", facing.wire)
        put("width", width)
        put("height", height)
        put("frameRate", frameRateCap)
        put("message", "Live from the phone's ${facing.wire} camera.")
        if (switched) put("switched", true)
    }

    /** Null for a reason with no wire value — the engine sends nothing for those. */
    fun stopped(
        streamId: String,
        requestId: String,
        reason: CameraStopReason,
        framesSent: Long,
        framesDropped: Long,
    ): Map<String, Any>? {
        val wire = reason.wire ?: return null
        return buildMap {
            put("state", "stopped")
            put("streamId", streamId)
            put("requestId", requestId)
            put("reason", wire)
            put("message", reason.message)
            reason.fixHint?.let { put("fixHint", it) }
            put("framesSent", framesSent)
            put("framesDropped", framesDropped)
        }
    }
}

/**
 * The phone's `[camera]` lines that are about the machine's effects, built here so a test asserts the
 * exact text and the hardware driver's parser can be checked against it (defect 176: the
 * phone wrote no line when a stream went live or a switch took effect).
 *
 * Milestones only — the first frame of a stream and the first frame after a switch. Never per frame,
 * never a token, never more than the stream id's first 8 characters.
 */
object CameraLogLines {
    /** `Camera stream 01234567… running: first frame 960 × 720 from the back camera, epoch 0`, or null. */
    fun milestone(streamId: String, effect: CameraEffect<*>): String? {
        if (effect !is CameraEffect.SendState<*>) return null
        val p = effect.payload
        if (p["state"] != CameraPhase.RUNNING.wire) return null
        val what = if (p["switched"] == true) "switch confirmed" else "running"
        return "Camera stream ${streamId.take(8)}… $what: first frame ${p["width"]} × ${p["height"]} from the ${p["facing"]} camera"
    }

    /** One effect list as a short phrase: what was refused or stopped and why, and which state was sent. */
    fun describe(effects: List<CameraEffect<*>>): String =
        effects.joinToString(", ") {
            when (it) {
                is CameraEffect.Refuse<*> -> "refused ${it.code}"
                is CameraEffect.Stopped<*> -> "stopped ${it.reason.name}"
                is CameraEffect.Reattributed -> "re-attributed ${it.from.name} → ${it.to.name}"
                is CameraEffect.SendState<*> -> "state ${it.payload["state"]}"
                is CameraEffect.ShowRequest -> "ShowRequest(${it.route.name.lowercase()})"
                is CameraEffect.SwitchCamera -> "SwitchCamera(${it.facing.wire}, epoch ${it.epoch})"
                is CameraEffect.OpenCamera -> "OpenCamera(${it.facing.wire}, epoch ${it.epoch})"
                else -> it.javaClass.simpleName
            }
        }.ifEmpty { "no change" }
}
