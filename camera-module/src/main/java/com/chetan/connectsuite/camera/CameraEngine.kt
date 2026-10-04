package com.chetan.connectsuite.camera

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.SideChannelClaim
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * What the camera screen does for the engine: open, switch and close the camera. Implemented by
 * [CameraActivity], whose lifecycle the camera is bound to — which is what makes v1 foreground-only.
 */
interface CameraHost {
    fun openCamera(streamId: String, facing: CameraFacing, epoch: Int)
    fun switchCamera(streamId: String, facing: CameraFacing, epoch: Int)
    fun closeCamera()
}

/**
 * Executes [CameraSessionMachine]'s decisions against the link, the camera screen and the clock.
 *
 * Everything that decides is in the machine and is tested there. This object only carries out: it
 * sends what the machine says to send, opens what it says to open, and arms what it says to arm. A
 * singleton for the reason `MirrorEngine` is one — socket handlers, the camera screen, timers and the
 * notification all need the same live stream and share no lifecycle.
 */
object CameraEngine {

    private val machine = CameraSessionMachine<ControlSession>()
    private val random = SecureRandom()
    private val timers = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "camera-timers").apply { isDaemon = true }
    }
    private val armed = mutableListOf<ScheduledFuture<*>>()

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var host: CameraHost? = null

    @Volatile
    private var stream: CameraStream? = null

    /** The stream [stream] belongs to, so a late close of an old socket cannot end a new stream. */
    @Volatile
    private var streamOwnerId: String? = null

    /** +1 per encoded frame in the current stream — the header's `sequence`. */
    @Volatile
    private var sequence = 0L

    @Volatile
    private var mirrorBusy: () -> Boolean = { false }

    private val _ui = MutableStateFlow(CameraUi())

    /** What the camera screen draws. */
    val ui: StateFlow<CameraUi> = _ui.asStateFlow()

    fun install(context: Context, mirrorBusy: () -> Boolean) {
        appContext = context.applicationContext
        this.mirrorBusy = mirrorBusy
        // What the webcam asks before it puts a request up: is a Camera v1 request or stream open?
        CameraUse.arbiter.cameraV1Open = { machine.ui().phase != CameraPhase.IDLE }
    }

    // ---- control-channel requests -----------------------------------------------------------------

    fun onRequest(session: ControlSession, request: Envelope) {
        val context = appContext ?: return
        val visible = AppForeground.visibleActivity()
        // Decided before the ack, from what can be checked now, and then carried out as decided: the Mac
        // is never told "a notification is on your phone" when Android would drop it (defect 171).
        val route = CameraRequestRoute.choose(
            screenVisible = visible != null,
            notificationsDeliverable = CameraNotifications.deliverable(context),
        )
        // The webcam's busy check and this request are one decision (CameraUse): two requests arriving
        // together on two connections cannot each see the other idle.
        val effects = CameraUse.arbiter.admitCamera { webcamBusy ->
            machine.request(
                owner = session,
                peerName = session.peerName,
                requestId = request.id,
                facingWire = stringField(request, "facing"),
                streamId = newStreamId(),
                nowMillis = System.currentTimeMillis(),
                hasCamera = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY),
                mirrorBusy = mirrorBusy(),
                route = route,
                webcamBusy = webcamBusy,
            )
        }
        LinkLog.i("camera", "camera.request from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    fun onStop(session: ControlSession, request: Envelope) {
        val effects = machine.stopFromMac(session, request.id, stringField(request, "streamId"))
        LinkLog.i("camera", "camera.stop from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    fun onSwitch(session: ControlSession, request: Envelope) {
        val effects = machine.switch(
            owner = session,
            requestId = request.id,
            streamId = stringField(request, "streamId"),
            facingWire = stringField(request, "facing"),
            facingAvailable = ::hasCameraFacing,
        )
        LinkLog.i("camera", "camera.switch from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    /** A socket on 42502 claimed a camera stream. Accepted only if the machine says so. */
    fun onChannel(channel: AuthenticatedChannel, claim: SideChannelClaim.Camera) {
        if (!machine.offerChannel(channel.session, claim.streamId)) {
            LinkLog.w(
                "camera",
                "Camera claim for ${claim.streamId.take(8)}… from ${channel.session.peerName} refused — " +
                    "not this session's stream, not live, or already claimed",
            )
            channel.close()
            return
        }
        val streamId = claim.streamId
        sequence = 0
        val fresh = CameraStream(
            output = channel.output,
            input = channel.input,
            closeSocket = { channel.close() },
            onClosed = { onStreamClosed(streamId) },
        )
        stream?.close()
        stream = fresh
        streamOwnerId = streamId
        LinkLog.i("camera", "Camera stream ${streamId.take(8)}… attached for ${channel.session.peerName}")
    }

    fun onSessionEnded(session: ControlSession) = run(machine.sessionEnded(session))

    // ---- the phone's owner ------------------------------------------------------------------------

    fun approve(streamId: String, facing: CameraFacing) {
        val effects = machine.approve(streamId, facing, System.currentTimeMillis())
        LinkLog.i("camera", "Start camera tapped for ${streamId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    fun decline(streamId: String) {
        val effects = machine.decline(streamId)
        if (effects.isNotEmpty()) LinkLog.i("camera", "Decline tapped for ${streamId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    fun permissionDenied(streamId: String) {
        val effects = machine.permissionDenied(streamId, System.currentTimeMillis())
        LinkLog.i("camera", "Camera permission answered no for ${streamId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    /** Whether a camera opened for [streamId] at [epoch] is still wanted — the machine's answer, under its lock. */
    fun isCurrentCamera(streamId: String, epoch: Int): Boolean = machine.isCurrentCamera(streamId, epoch)

    /** A request is waiting and has not run out by its own clock — what bringing Sidekick to the front asks. */
    fun requestAwaiting(): Boolean = machine.isAwaiting(System.currentTimeMillis())

    fun stopFromPhone() = run(machine.stopFromPhone())

    fun visibilityLost() = run(machine.visibilityLost())

    fun attachHost(host: CameraHost) {
        this.host = host
        publish()
    }

    fun detachHost(host: CameraHost) {
        if (this.host === host) this.host = null
    }

    /** The other camera, from the phone's own Switch button — the same path as the Mac's switch. */
    fun switchFromPhone() {
        val ui = machine.ui()
        val streamId = ui.streamId ?: return
        if (!ui.phase.isLive) return
        val target = ui.facing.other()
        if (!hasCameraFacing(target)) {
            LinkLog.w("camera", "Phone's Switch for ${streamId.take(8)}… refused: no ${target.wire} camera")
            return
        }
        val effects = machine.phoneSwitch(streamId, target)
        LinkLog.i("camera", "Phone's Switch for ${streamId.take(8)}… to ${target.wire}: ${describe(effects)}")
        run(effects)
    }

    // ---- the camera ---------------------------------------------------------------------------------

    /**
     * Called by the analyzer for every paced frame. Returns the stamp to encode with, or null when the
     * frame must not be sent — the machine's gate, evaluated per frame.
     */
    fun frameProduced(streamId: String, epoch: Int, width: Int, height: Int): FrameTicket? {
        val (ticket, effects) = machine.frameProduced(streamId, epoch, width, height)
        if (effects.isNotEmpty()) {
            // The first frame of the stream, or of the camera a switch turned to: the one line each gets.
            effects.mapNotNull { CameraLogLines.milestone(streamId, it) }.forEach { LinkLog.i("camera", "$it, epoch $epoch") }
            run(effects)
        }
        return ticket
    }

    fun nextSequence(): Long = sequence++

    /** An encoded frame for [streamId]. Dropped if the stream has moved on. */
    fun offerFrame(streamId: String, frame: ByteArray) {
        if (streamOwnerId != streamId) return
        stream?.offer(frame)
    }

    fun countOversize() = stream?.countOversize()

    fun countEncodeFailure() = stream?.countEncodeFailure()

    fun cameraFailed(streamId: String, reason: CameraStopReason) {
        LinkLog.w("camera", "Camera failed for ${streamId.take(8)}…: ${reason.name}")
        run(machine.cameraFailed(streamId, reason))
    }

    // ---- executing the machine ------------------------------------------------------------------------

    private fun run(effects: List<CameraEffect<ControlSession>>) {
        for (effect in effects) {
            runCatching { perform(effect) }
                .onFailure { LinkLog.w("camera", "Camera effect ${effect.javaClass.simpleName} failed: ${it.message}") }
        }
        publish()
    }

    private fun perform(effect: CameraEffect<ControlSession>) {
        when (effect) {
            is CameraEffect.Ack -> effect.owner.sendAck(effect.requestId, effect.payload)
            is CameraEffect.Refuse -> effect.owner.sendError(
                requestId = effect.requestId,
                code = effect.code,
                message = effect.message,
                feature = Capability.CAMERA,
                fixHint = effect.fixHint,
            )
            is CameraEffect.SendState -> effect.owner.event(MessageType.CAMERA_STATE) { putAll(effect.payload) }
            is CameraEffect.ShowRequest -> showRequest(effect.streamId, effect.peerName, effect.route)
            CameraEffect.ClearRequest -> appContext?.let { CameraNotifications.clear(it) }
            is CameraEffect.ArmTimer -> arm(effect)
            CameraEffect.CancelTimers -> cancelTimers()
            is CameraEffect.OpenCamera -> {
                val h = host
                if (h == null) {
                    // The screen that tapped Start camera is gone before the camera could open.
                    run(machine.visibilityLost())
                } else {
                    h.openCamera(effect.streamId, effect.facing, effect.epoch)
                }
            }
            is CameraEffect.SwitchCamera -> host?.switchCamera(effect.streamId, effect.facing, effect.epoch)
            CameraEffect.CloseCamera -> host?.closeCamera()
            CameraEffect.CloseStream -> {
                val s = stream
                stream = null
                streamOwnerId = null
                s?.close()
                lastTally = s?.let { it.framesSent() to it.framesDropped() } ?: (0L to 0L)
                s?.let { LinkLog.i("camera", "Camera stream closed: ${it.summary()}") }
            }
            is CameraEffect.Reattributed -> LinkLog.i(
                "camera",
                "Camera stream ${effect.streamId.take(8)}… had already ended as ${effect.from.name} when the Mac's stop " +
                    "arrived; recorded as ${effect.to.name}",
            )
            is CameraEffect.Stopped -> {
                val (sent, dropped) = lastTally
                LinkLog.i(
                    "camera",
                    "Camera stream ${effect.streamId.take(8)}… stopped: ${effect.reason.name} — $sent sent / $dropped dropped",
                )
                CameraPayloads.stopped(effect.streamId, effect.requestId, effect.reason, sent, dropped)
                    ?.let { payload -> effect.owner.event(MessageType.CAMERA_STATE) { putAll(payload) } }
            }
        }
    }

    /** The tally of the stream [CameraEffect.CloseStream] just closed, read by the stopped event after it. */
    @Volatile
    private var lastTally: Pair<Long, Long> = 0L to 0L

    /**
     * Carries out the route the ack named — and logs what actually happened, which is the only place a
     * difference between the two can show (the screen gone in the moment between the check and here,
     * or Android refusing the post). Either way it is a screen asking, never the camera.
     */
    private fun showRequest(streamId: String, peerName: String, route: CameraRequestRoute) {
        val context = appContext ?: return
        val label = "${streamId.take(8)}…"
        when (route) {
            CameraRequestRoute.SCREEN -> {
                val visible = AppForeground.visibleActivity()
                if (visible != null) {
                    openRequestScreen(visible)
                    LinkLog.i("camera", "Camera request $label awaiting consent: request screen opened over Sidekick")
                } else {
                    LinkLog.w(
                        "camera",
                        "Camera request $label awaiting consent: the Mac was told the request is on screen, but Sidekick " +
                            "left the screen first — it reopens when Sidekick next comes to the front",
                    )
                }
            }
            CameraRequestRoute.NOTIFICATION -> {
                val posted = CameraNotifications.askUser(context, peerName)
                if (posted) {
                    LinkLog.i("camera", "Camera request $label awaiting consent: notification posted")
                } else {
                    LinkLog.w("camera", "Camera request $label awaiting consent: the notification could NOT be posted")
                }
            }
            CameraRequestRoute.NONE -> LinkLog.w(
                "camera",
                "Camera request $label awaiting consent: NOT delivered — Sidekick's notifications are off; " +
                    "the request screen opens only if Sidekick comes to the front before it expires",
            )
        }
    }

    /** Opens the request screen from a visible Activity — the start Android permits. */
    fun openRequestScreen(from: Activity) {
        from.startActivity(Intent(from, CameraActivity::class.java))
    }

    private fun arm(effect: CameraEffect.ArmTimer) {
        val delay = (effect.atMillis - System.currentTimeMillis()).coerceAtLeast(0)
        val future = timers.schedule(
            { run(machine.timerFired(effect.timer, effect.streamId, System.currentTimeMillis())) },
            delay,
            TimeUnit.MILLISECONDS,
        )
        synchronized(armed) { armed += future }
    }

    private fun cancelTimers() {
        synchronized(armed) {
            armed.forEach { it.cancel(false) }
            armed.clear()
        }
    }

    private fun onStreamClosed(streamId: String) {
        LinkLog.i("camera", "Camera stream ${streamId.take(8)}… closed by the Mac")
        run(machine.streamClosed(streamId))
    }

    private fun publish() {
        _ui.value = machine.ui()
    }

    private fun hasCameraFacing(facing: CameraFacing): Boolean {
        val context = appContext ?: return false
        val feature = if (facing == CameraFacing.FRONT) PackageManager.FEATURE_CAMERA_FRONT else PackageManager.FEATURE_CAMERA
        return context.packageManager.hasSystemFeature(feature)
    }

    /** 128 random bits as 32 lowercase hex — the shape `SideChannelClaim` accepts and nothing else. */
    private fun newStreamId(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun stringField(request: Envelope, name: String): String? =
        runCatching { request.payload[name]?.jsonPrimitive?.content }.getOrNull()

    private fun describe(effects: List<CameraEffect<ControlSession>>): String = CameraLogLines.describe(effects)

    private fun ControlSession.sendAck(requestId: String, payload: Map<String, Any>) {
        send(Envelope.ack(requestId) { putAll(payload) })
    }

    private fun JsonObjectBuilder.putAll(payload: Map<String, Any>) {
        for ((key, value) in payload) {
            when (value) {
                is String -> put(key, value)
                is Int -> put(key, value)
                is Long -> put(key, value)
                is Boolean -> put(key, value)
                else -> put(key, value.toString())
            }
        }
    }
}
