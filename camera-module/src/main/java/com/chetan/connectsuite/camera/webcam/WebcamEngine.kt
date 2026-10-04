package com.chetan.connectsuite.camera.webcam

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import androidx.core.content.getSystemService
import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraNotifications
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.camera.CameraUse
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
 * What the webcam screen does for the engine: the capture is bound to [WebcamActivity], which is what
 * makes the webcam foreground-only. Calls arrive on any thread; the activity posts them to its own.
 */
interface WebcamCaptureHost {
    fun openCapture(sessionId: String, facing: CameraFacing, generation: Int)
    fun switchCapture(sessionId: String, facing: CameraFacing, generation: Int)
    fun closeCapture()
    fun requestKeyframe()
}

/**
 * Executes [WebcamSessionMachine]'s decisions against the link, the webcam screen, the stream socket and
 * the clock. Everything that decides is in the machine, the assembler, the writer and the capture core,
 * and is tested there; this object only carries out.
 *
 * **It shares no mutable state with Camera v1.** Its own machine, timers, socket and screen; the only
 * cross-feature contact is [CameraUse], which holds a lock and two predicates.
 */
object WebcamEngine {

    private val machine = WebcamSessionMachine<ControlSession>()
    private val random = SecureRandom()
    private val timers = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "webcam-timers").apply { isDaemon = true }
    }
    private val armed = mutableListOf<ScheduledFuture<*>>()

    @Volatile private var appContext: Context? = null
    @Volatile private var host: WebcamCaptureHost? = null
    @Volatile private var writer: WebcamStreamWriter? = null

    /** The session [writer] belongs to, so a late close of an old socket cannot end a new session. */
    @Volatile private var writerSessionId: String? = null
    @Volatile private var mirrorBusy: () -> Boolean = { false }

    /** One assembler per (session, generation): a new encoder brings its own SPS and PPS. */
    private var assembler: Triple<String, Int, WebcamAuAssembler>? = null

    /** +1 per AU given a ticket in the current session — the header's `sequence`; a gap is a drop. */
    @Volatile private var sequence = 0L

    /** AUs the encoder produced that the machine would not let out (before the socket, before an IDR, stale). */
    @Volatile private var heldBack = 0L

    /** Encoder buffers the assembler refused (no start code, an IDR before any SPS/PPS). */
    @Volatile private var unassembled = 0L

    @Volatile private var lastTally: Triple<Long, Long, String> = Triple(0L, 0L, "no stream")

    private val _ui = MutableStateFlow(WebcamUi())

    val ui: StateFlow<WebcamUi> = _ui.asStateFlow()

    fun install(context: Context, mirrorBusy: () -> Boolean) {
        appContext = context.applicationContext
        this.mirrorBusy = mirrorBusy
        CameraUse.arbiter.webcamOpen = machine::isOpen
        context.getSystemService<PowerManager>()?.addThermalStatusListener(timers) { status ->
            val effects = machine.thermalChanged(status)
            if (effects.isNotEmpty()) LinkLog.w("webcam", "Thermal status $status: ${describe(effects)}")
            run(effects)
        }
    }

    // ---- control-channel requests -----------------------------------------------------------------

    fun onRequest(session: ControlSession, request: Envelope) {
        val context = appContext ?: return
        val route = CameraRequestRoute.choose(
            screenVisible = AppForeground.visibleActivity() != null,
            notificationsDeliverable = CameraNotifications.deliverable(context),
        )
        val effects = CameraUse.arbiter.admitWebcam(mirrorBusy) { other ->
            machine.request(
                owner = session,
                peerName = session.peerName,
                requestId = request.id,
                facingWire = stringField(request, "facing"),
                triggerWire = stringField(request, "trigger"),
                sessionId = newSessionId(),
                nowMillis = System.currentTimeMillis(),
                hasCamera = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY),
                otherCapture = other,
                route = route,
            )
        }
        LinkLog.i("webcam", "webcam.request from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    fun onStop(session: ControlSession, request: Envelope) {
        val effects = machine.stopFromMac(
            session, request.id, stringField(request, "sessionId"), stringField(request, "cause"), stringField(request, "detail"),
        )
        LinkLog.i("webcam", "webcam.stop from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    fun onSwitch(session: ControlSession, request: Envelope) {
        val effects = machine.switch(session, request.id, stringField(request, "sessionId"), stringField(request, "facing"), ::hasCameraFacing)
        LinkLog.i("webcam", "webcam.switch from ${session.peerName}: ${describe(effects)}")
        run(effects)
    }

    /** A socket on 42502 claimed a webcam session. Accepted only if the machine says so. */
    fun onChannel(channel: AuthenticatedChannel, claim: SideChannelClaim.Webcam) {
        if (!machine.offerChannel(channel.session, claim.sessionId)) {
            LinkLog.w(
                "webcam",
                "Webcam claim for ${claim.sessionId.take(8)}… from ${channel.session.peerName} refused — " +
                    "not this connection's session, not live, or already claimed",
            )
            channel.close()
            return
        }
        val sessionId = claim.sessionId
        sequence = 0
        val fresh = WebcamStreamWriter(
            output = channel.output,
            input = channel.input,
            closeSocket = { channel.close() },
            onClosed = { onStreamClosed(sessionId) },
            onKeyframeNeeded = { host?.requestKeyframe() },
        )
        writer?.close()
        writer = fresh
        writerSessionId = sessionId
        // The encoder has been running since the tap, and its first IDR went nowhere: ask for another.
        host?.requestKeyframe()
        LinkLog.i("webcam", "Webcam stream ${sessionId.take(8)}… attached for ${channel.session.peerName}")
    }

    fun onSessionEnded(session: ControlSession) = run(machine.sessionEnded(session))

    // ---- the phone's owner ------------------------------------------------------------------------

    fun approve(sessionId: String, facing: CameraFacing) {
        val busy = if (mirrorBusy()) OtherCapture.MIRROR else null
        val thermal = appContext?.getSystemService<PowerManager>()?.currentThermalStatus ?: PowerManager.THERMAL_STATUS_NONE
        val effects = machine.approve(sessionId, facing, System.currentTimeMillis(), busy, thermal)
        LinkLog.i("webcam", "Start camera tapped for webcam ${sessionId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    fun decline(sessionId: String) {
        val effects = machine.decline(sessionId)
        if (effects.isNotEmpty()) LinkLog.i("webcam", "Decline tapped for webcam ${sessionId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    fun permissionDenied(sessionId: String) {
        val effects = machine.permissionDenied(sessionId, System.currentTimeMillis())
        LinkLog.i("webcam", "Camera permission answered no for webcam ${sessionId.take(8)}…: ${describe(effects)}")
        run(effects)
    }

    fun requestAwaiting(): Boolean = machine.isAwaiting(System.currentTimeMillis())

    fun isCurrentCapture(sessionId: String, generation: Int): Boolean = machine.isCurrentCapture(sessionId, generation)

    fun stopFromPhone() = run(machine.stopFromPhone())

    fun visibilityLost() = run(machine.visibilityLost())

    fun switchFromPhone() {
        val ui = machine.ui()
        val sessionId = ui.sessionId ?: return
        if (!ui.phase.isLive) return
        val target = ui.facing.other()
        if (!hasCameraFacing(target)) {
            LinkLog.w("webcam", "Phone's Switch for webcam ${sessionId.take(8)}… refused: no ${target.wire} camera")
            return
        }
        run(machine.phoneSwitch(sessionId, target))
    }

    fun attachHost(host: WebcamCaptureHost) {
        this.host = host
        publish()
    }

    fun detachHost(host: WebcamCaptureHost) {
        if (this.host === host) this.host = null
    }

    // ---- the capture --------------------------------------------------------------------------------

    fun captureFailed(sessionId: String, reason: WebcamStopReason) {
        val effects = machine.captureFailed(sessionId, reason)
        if (effects.isNotEmpty()) LinkLog.w("webcam", "Webcam capture failed for ${sessionId.take(8)}…: ${reason.name}")
        run(effects)
    }

    /**
     * One encoder output buffer for [sessionId] at [generation]. Assembled into an AU (SPS and PPS before
     * every IDR), gated by the machine, stamped, and offered to the writer — or dropped and counted. Called
     * on the encoder's callback thread; never blocks.
     */
    fun onEncoded(
        sessionId: String,
        generation: Int,
        isConfig: Boolean,
        flaggedKeyframe: Boolean,
        data: ByteArray,
        ptsMonotonicUs: Long,
        width: Int,
        height: Int,
        rotation: Int,
    ) {
        val asm = assemblerFor(sessionId, generation)
        val unit = when (val r = asm.offer(isConfig, flaggedKeyframe, data)) {
            WebcamAuAssembler.Result.ConfigStored -> return
            is WebcamAuAssembler.Result.Dropped -> {
                unassembled++
                if (unassembled == 1L) LinkLog.w("webcam", "Encoder buffer not usable as an access unit: ${r.why}")
                host?.requestKeyframe()
                return
            }
            is WebcamAuAssembler.Result.Unit -> r
        }
        val (ticket, effects) = machine.accessUnitProduced(sessionId, generation, unit.keyframe, width, height)
        if (effects.isNotEmpty()) run(effects)
        if (ticket == null) {
            heldBack++
            return
        }
        val out = writer
        if (out == null || writerSessionId != sessionId) return
        val header = WebcamAuCodec.Header(
            facing = ticket.facing,
            rotation = rotation,
            // A new generation after a switch or a ladder step: the encoder was reconfigured.
            discontinuity = ticket.firstOfGeneration && generation > 1,
            generation = generation,
            width = width,
            height = height,
            sequence = (++sequence) and 0xFFFF_FFFFL,
        )
        val frame = WebcamAuCodec.encode(header, ptsMonotonicUs, unit.annexB)
        if (frame == null) out.countOversizeAndAwaitKeyframe() else out.offer(frame, unit.keyframe)
    }

    /** The capture rebuilt its encoder inside the session; the generation moves on. */
    fun captureReconfigured(sessionId: String, fromGeneration: Int): Int? = machine.reconfigured(sessionId, fromGeneration)

    private fun assemblerFor(sessionId: String, generation: Int): WebcamAuAssembler = synchronized(this) {
        val current = assembler
        if (current != null && current.first == sessionId && current.second == generation) return current.third
        WebcamAuAssembler().also { assembler = Triple(sessionId, generation, it) }
    }

    // ---- executing the machine ------------------------------------------------------------------------

    private fun run(effects: List<WebcamEffect<ControlSession>>) {
        for (effect in effects) {
            runCatching { perform(effect) }
                .onFailure { LinkLog.w("webcam", "Webcam effect ${effect.javaClass.simpleName} failed: ${it.message}") }
        }
        publish()
    }

    private fun perform(effect: WebcamEffect<ControlSession>) {
        when (effect) {
            is WebcamEffect.Ack -> effect.owner.send(Envelope.ack(effect.requestId) { putAll(effect.payload) })
            is WebcamEffect.Refuse -> effect.owner.sendError(
                requestId = effect.requestId,
                code = effect.code,
                message = effect.message,
                feature = Capability.WEBCAM,
                fixHint = effect.fixHint,
            )
            is WebcamEffect.SendState -> {
                effect.owner.event(MessageType.WEBCAM_STATE) { putAll(effect.payload) }
                if (effect.payload["state"] == WebcamPhase.RUNNING.wire) {
                    LinkLog.i(
                        "webcam",
                        "Webcam session ${(effect.payload["sessionId"] as? String)?.take(8)}… running: generation ${effect.payload["generation"]}, " +
                            "${effect.payload["width"]} × ${effect.payload["height"]} selected against a ${WebcamQuality.TARGET_WIDTH} × " +
                            "${WebcamQuality.TARGET_HEIGHT} target, ${effect.payload["facing"]} camera",
                    )
                }
            }
            is WebcamEffect.ShowRequest -> showRequest(effect)
            WebcamEffect.ClearRequest -> appContext?.let { WebcamNotifications.clear(it) }
            is WebcamEffect.ArmTimer -> arm(effect)
            WebcamEffect.CancelTimers -> cancelTimers()
            is WebcamEffect.OpenCapture -> {
                val h = host
                if (h == null) run(machine.visibilityLost()) else h.openCapture(effect.sessionId, effect.facing, effect.generation)
            }
            is WebcamEffect.SwitchCapture -> host?.switchCapture(effect.sessionId, effect.facing, effect.generation)
            WebcamEffect.CloseCapture -> host?.closeCapture()
            WebcamEffect.CloseStream -> {
                val w = writer
                writer = null
                writerSessionId = null
                w?.close()
                synchronized(this) { assembler = null }
                lastTally = Triple(w?.sent ?: 0L, w?.framesDropped() ?: 0L, w?.summary() ?: "no stream attached")
                LinkLog.i("webcam", "Webcam stream closed: ${lastTally.third}; $heldBack held back before running or stale, $unassembled unusable buffers")
                heldBack = 0
                unassembled = 0
            }
            is WebcamEffect.RequestKeyframe -> host?.requestKeyframe()
            is WebcamEffect.Reattributed -> LinkLog.i(
                "webcam",
                "Webcam session ${effect.sessionId.take(8)}… had already ended as ${effect.from.name} when the Mac's stop arrived; " +
                    "recorded as ${effect.to.name}",
            )
            is WebcamEffect.Stopped -> {
                val (sent, dropped, _) = lastTally
                LinkLog.i(
                    "webcam",
                    "Webcam session ${effect.sessionId.take(8)}… stopped: ${effect.reason.name}" +
                        (effect.detail?.let { " (${it.name})" } ?: "") + " — $sent sent / $dropped dropped",
                )
                WebcamPayloads.stopped(effect.sessionId, effect.requestId, effect.reason, effect.detail, sent, dropped)
                    ?.let { payload -> effect.owner.event(MessageType.WEBCAM_STATE) { putAll(payload) } }
            }
        }
    }

    private fun showRequest(effect: WebcamEffect.ShowRequest) {
        val context = appContext ?: return
        val label = "${effect.sessionId.take(8)}…"
        when (effect.route) {
            CameraRequestRoute.SCREEN -> {
                val visible = AppForeground.visibleActivity()
                if (visible != null) {
                    openRequestScreen(visible)
                    LinkLog.i("webcam", "Webcam request $label awaiting consent: request screen opened over Sidekick")
                } else {
                    LinkLog.w("webcam", "Webcam request $label awaiting consent: Sidekick left the screen first — it reopens when Sidekick next comes to the front")
                }
            }
            CameraRequestRoute.NOTIFICATION -> {
                val posted = WebcamNotifications.askUser(context, effect.peerName, effect.trigger)
                LinkLog.i("webcam", "Webcam request $label awaiting consent: notification ${if (posted) "posted" else "could NOT be posted"}")
            }
            CameraRequestRoute.NONE -> LinkLog.w(
                "webcam",
                "Webcam request $label awaiting consent: NOT delivered — Sidekick's notifications are off; the request screen opens only " +
                    "if Sidekick comes to the front before it expires",
            )
        }
    }

    /** Opens the request screen from a visible Activity — the start Android permits. Never the camera. */
    fun openRequestScreen(from: Activity) {
        from.startActivity(Intent(from, WebcamActivity::class.java))
    }

    private fun arm(effect: WebcamEffect.ArmTimer) {
        val delay = (effect.atMillis - System.currentTimeMillis()).coerceAtLeast(0)
        val future = timers.schedule(
            { run(machine.timerFired(effect.timer, effect.sessionId, System.currentTimeMillis())) },
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

    private fun onStreamClosed(sessionId: String) {
        LinkLog.i("webcam", "Webcam stream ${sessionId.take(8)}… closed by the Mac")
        run(machine.streamClosed(sessionId))
    }

    private fun publish() {
        _ui.value = machine.ui()
    }

    private fun hasCameraFacing(facing: CameraFacing): Boolean {
        val context = appContext ?: return false
        val feature = if (facing == CameraFacing.FRONT) PackageManager.FEATURE_CAMERA_FRONT else PackageManager.FEATURE_CAMERA
        return context.packageManager.hasSystemFeature(feature)
    }

    /** 128 random bits as 32 lowercase hex — the shape the webcam claim accepts and nothing else. */
    private fun newSessionId(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun stringField(request: Envelope, name: String): String? =
        runCatching { request.payload[name]?.jsonPrimitive?.content }.getOrNull()

    private fun describe(effects: List<WebcamEffect<ControlSession>>): String = WebcamLogLines.describe(effects)

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
