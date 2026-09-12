package com.chetan.connectsuite.mirror.v2

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.view.Display
import android.view.Surface
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.BackgroundRestrictionReading
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkController
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.core.screen.ScreenGeometryRegistry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.put
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Owns one mirror session at a time: consent, encoder, video socket, and every way it can end.
 *
 * A singleton for the same reason [com.chetan.connectsuite.core.link.LinkController] is one — the
 * video socket, the control handlers, the foreground service and the Mirror tab all need to reach
 * the same live session and none of them share a lifecycle. The project uses hand-rolled
 * singletons rather than DI (see CLAUDE.md), so this follows that rather than half-introducing
 * Hilt.
 *
 * The invariant worth stating: **no path out of here is silent, and no path out of here is slow.**
 * Every request acks within [ACK_BUDGET_MS] with the phase it entered, every phase change is an
 * event, and every way it can end sends either frames or a named [MirrorFailure]. Consent is
 * bounded by [CONSENT_TIMEOUT_MS] rather than by whatever the Mac's request timeout happens to be.
 *
 * ### Why consent is routed rather than simply asked for
 *
 * On Android 16 a backgrounded app cannot start an Activity at all. `startActivity` does not throw
 * when that happens — the system drops the start, logs `Background activity launch blocked!` and
 * returns normally — so the older code, which asked for consent straight out of the socket handler
 * and waited for a callback, waited for a callback that could never fire. A foreground service is
 * not an exemption: the link's service is `connectedDevice|dataSync` and the block was observed
 * with the process already in `FOREGROUND_SERVICE` state.
 *
 * So the phone decides *before* asking: with a visible Activity it asks now; without one it tells
 * the Mac to send the user to the phone ([MirrorPhase.AWAITING_FOREGROUND]) and posts a
 * notification that lands them on the Mirror tab, where their own tap supplies the foreground.
 */
object MirrorEngine {

    /** `mirror.start` must answer inside this, whatever else is going on. */
    private const val ACK_BUDGET_MS = 2_000L

    /** How long a consent request may stay unanswered before it is called a failure by name. */
    private const val CONSENT_TIMEOUT_MS = 30_000L

    private const val STATS_INTERVAL_MS = 2_000L

    /**
     * How long a display reading gets to become self-consistent before it is used anyway.
     *
     * The observed inconsistency on hardware lasted 63ms, so this is a little over twice that:
     * long enough to cover it with room to spare, short enough that a phone whose rotation never
     * settles still gets its picture resized rather than stalling on a turn.
     */
    private const val SETTLE_BUDGET_MS = 150L

    /** Gap between re-reads while waiting for the angle and the metrics to agree. */
    private const val SETTLE_POLL_MS = 8L

    private val videoChannel = AtomicReference<VideoChannel?>(null)
    private val encoder = AtomicReference<ScreenEncoder?>(null)
    private val projection = AtomicReference<MediaProjection?>(null)

    /**
     * The session's one and only VirtualDisplay.
     *
     * Owned here rather than by [ScreenEncoder] because it outlives every encoder: a resolution
     * change and a rotation both build a new encoder and point *this* display at it. One
     * MediaProjection backs exactly one virtual display on Android 14+, so there is never a second
     * one to hold.
     */
    private val display = AtomicReference<VirtualDisplay?>(null)

    /**
     * Which encoder's frames count. Bumped the moment a swap commits.
     *
     * The old encoder keeps producing for the few milliseconds between the surface swap and its
     * stop(), and those frames are the *previous* size. The Mac has by then been sent the new
     * parameter sets, so letting one through is how a decoder ends up feeding an old-geometry
     * frame to a decoder configured for the new one.
     */
    private val generation = AtomicLong(0)

    /** The phone's rotation as of the last reading, so a brightness change is not read as a turn. */
    @Volatile
    private var lastRotation: Int = -1

    /**
     * Which way up this device is when it reports 0°, established once per session.
     *
     * Judging a reading needs a baseline taken while nothing was turning — see
     * [naturalOrientationIsPortrait]. Null between sessions, and set from the reading that starts
     * capture, which is the quietest moment available.
     */
    @Volatile
    private var naturalPortrait: Boolean? = null

    /**
     * True while the encoder is producing blanked frames because Android is refusing to capture
     * what is on screen.
     *
     * Read by input: a tap the user cannot see the target of is not a tap they meant, so input
     * refuses with the same code and the same sentence the mirror is already showing them. Kept
     * as a flag rather than inferred from [_status] because the status message is prose that
     * other paths overwrite, and this has to be a fact.
     */
    @Volatile
    private var contentBlocked: Boolean = false

    /**
     * The last geometry line written, so a stationary phone stops repeating it.
     *
     * [resolveGeometry] runs on every DisplayListener callback, and those fire for brightness and
     * refresh-rate changes as well as for turns — several times a minute on an untouched phone.
     * Logging each one buries the lines that matter in link.log. Cleared per session by
     * [stopWatchingForRotation] so the next session states its geometry once.
     */
    @Volatile
    private var lastGeometryLine: String? = null

    /**
     * Encoder counters as of the previous stats tick, so the log can carry a *rate* rather than a
     * running total nobody can subtract in their head.
     *
     * Reset to -1 at session start, and treated as a fresh baseline whenever the counter goes
     * backwards: a rotation builds a new [ScreenEncoder] whose counters start at zero, and without
     * that guard the first tick after every turn would report a negative delta.
     */
    @Volatile
    private var lastStatsFrames = -1L

    @Volatile
    private var lastStatsBytes = 0L

    /** Serialises swaps: rotation can fire again while one is half-done. */
    private val swapping = java.util.concurrent.atomic.AtomicBoolean(false)

    @Volatile
    private var displayThread: HandlerThread? = null

    @Volatile
    private var displayListenerRegistered = false

    /** The session that asked for mirroring, and therefore the one told how it goes. */
    @Volatile
    private var owner: ControlSession? = null

    /**
     * The id of the outstanding `mirror.start`, or null for a session the phone started itself.
     *
     * It is only used to correlate events; the reply it once belonged to has already been sent.
     */
    @Volatile
    private var requestId: String? = null

    @Volatile
    private var config: MirrorConfig = MirrorConfig()

    /** Held so `mirror.config` can rebuild the encoder without going back for consent. */
    @Volatile
    private var appContext: Context? = null

    private val ticker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "mirror-stats").apply { isDaemon = true }
    }

    @Volatile
    private var statsTask: ScheduledFuture<*>? = null

    private val consentDeadline = AtomicReference<ScheduledFuture<*>?>(null)

    private val _status = MutableStateFlow(MirrorStatus())

    /** What the Mirror tab draws. The same phases the Mac is sent, from the same place. */
    val status: StateFlow<MirrorStatus> = _status.asStateFlow()

    /**
     * The session's SPS/PPS, held here rather than on the socket.
     *
     * A decoder that never sees the parameter sets produces nothing at all, and the encoder only
     * emits them once at the start of a session. A video socket that reconnects mid-session would
     * otherwise wait for the next one that never comes, so every new channel is primed with this.
     */
    @Volatile
    private var lastConfigFrame: VideoFrame? = null

    val isRunning: Boolean get() = encoder.get() != null

    /**
     * True while capture is running but Android is blanking the frames — a banking app, DRM video,
     * or the keyguard.
     *
     * Exists for `input-module`, which must not dispatch a gesture at a screen the user is being
     * shown as black. `MirrorFeature` hands this to `InputFeature` at install time rather than the
     * two modules depending on each other.
     */
    val isContentBlocked: Boolean get() = isRunning && contentBlocked

    // ---- video socket ---------------------------------------------------------------------

    /**
     * Called by [LinkServer][com.chetan.connectsuite.core.link.LinkServer] when a video socket has
     * presented a valid session token. Assigning this sink is one half of the mirror capability
     * contract; the handlers registered in [MirrorFeature] are the other.
     */
    fun attachVideoChannel(channel: AuthenticatedChannel) {
        val existing = videoChannel.getAndSet(null)
        existing?.close()

        val fresh = VideoChannel(channel) { drops ->
            // **Defect 52.** The old line was `Dropped N frames; the Mac is behind` — a cause the
            // counter never decided. It guessed right for an evicted stale frame, understated a
            // shed newcomer, and was flatly wrong for an oversize frame, where the Mac is not
            // behind and never saw it. `headline()` reports the worst thing that is TRUE, and the
            // summary carries the denominator so a run of 120 means something.
            //
            // An oversize frame reports immediately rather than waiting for a multiple of 60: it is
            // a correctness fault and there may only ever be one of them.
            val total = drops.total()
            if (drops.oversizeCount() > 0 || total % 60 == 0) {
                LinkLog.w(
                    "mirror",
                    "${drops.headline()} — ${drops.summary()}",
                )
            }
        }
        videoChannel.set(fresh)
        LinkLog.i("mirror", "Video channel attached for ${channel.session.peerName}")
        // A socket that arrives mid-session must not wait a whole GOP to show anything: send the
        // parameter sets it missed, then ask the encoder for an IDR it can actually start on.
        lastConfigFrame?.let { fresh.offer(it) }
        if (isRunning) encoder.get()?.requestKeyframe()
    }

    /**
     * A video socket that could not be authorised. The token is unknown, so the *video* peer
     * cannot be told — but if a control session is live it is the one waiting for a picture, and
     * it gets the reason instead of an idle canvas.
     */
    fun reportUnauthorisedVideoChannel(session: ControlSession?) {
        val failure = MirrorFailure.VideoChannelUnauthorised
        LinkLog.w("mirror", "Video channel refused: ${failure.label}")
        (session ?: owner)?.let { emit(it, failure) }
    }

    // ---- lifecycle ------------------------------------------------------------------------

    /**
     * `mirror.start`.
     *
     * Acks first and asks second. The ack carries the phase the request entered, so the Mac can
     * draw "asking on the phone" or "go tap your phone" immediately instead of holding a request
     * open across a human being.
     */
    fun start(context: Context, session: ControlSession, request: Envelope, wanted: MirrorConfig) {
        val startedAt = System.currentTimeMillis()
        if (isRunning) {
            LinkLog.i("mirror", "mirror.start while already running; restarting")
            stop(MirrorStopReason.RestartedByMac)
        }
        owner = session
        requestId = request.id
        config = wanted
        appContext = context.applicationContext

        LinkLog.i(
            "mirror",
            "mirror.start from ${session.peerName}; app is " +
                if (AppForeground.isForeground) "foreground" else "backgrounded",
        )

        // The lock is decided here, ahead of the foreground branch, because a locked phone has no
        // visible Activity and would otherwise be reported as merely backgrounded. The two need
        // different instructions — unlock the phone versus open the app — and the second is
        // useless advice to someone looking at a lock screen. MirrorConsentActivity keeps its own
        // keyguard check, but that class only runs on the foreground branch, which a locked phone
        // never reaches; it is the backstop for the phone locking mid-request, not the gate.
        if (isPhoneLocked(context)) {
            LinkLog.w("mirror", "mirror.start from ${session.peerName} while the phone is locked")
            val locked = MirrorFailure.PhoneLocked
            // Acked before it is failed, so the Mac's request never hangs and the ack invariant
            // holds on this path too. The reason then arrives as an ordinary mirror error, which
            // is the same route consent-denied takes to the canvas.
            session.ack(request) {
                put("state", MirrorPhase.STOPPED.wire)
                put("message", locked.reason)
                locked.fixHint?.let { put("fixHint", it) }
            }
            fail(locked)
            return
        }

        val activity = AppForeground.visibleActivity()
        val phase = if (activity != null) {
            MirrorPhase.REQUESTING_CONSENT
        } else {
            MirrorPhase.AWAITING_FOREGROUND
        }
        val status = statusFor(phase, session.peerName)

        // The ack goes out before anything that can block, so this budget is a statement about
        // what is allowed between here and there rather than a hope.
        session.ack(request) {
            put("state", status.phase.wire)
            status.message?.let { put("message", it) }
            status.fixHint?.let { put("fixHint", it) }
        }
        publish(status)
        armConsentTimeout()

        val elapsed = System.currentTimeMillis() - startedAt
        if (elapsed > ACK_BUDGET_MS) {
            LinkLog.w("mirror", "mirror.start took ${elapsed}ms to ack, over the ${ACK_BUDGET_MS}ms budget")
        }

        if (activity != null) {
            requestConsent(activity)
        } else {
            MirrorNotifications.askUserToStart(context.applicationContext, session.peerName)
        }
    }

    /**
     * Whether the keyguard is up.
     *
     * `isKeyguardLocked` rather than `isDeviceLocked`: the question is whether a lock screen
     * stands between the user and the consent prompt, which is true for a swipe-only keyguard as
     * well as a secured one. `isDeviceLocked` is false for swipe-only and would let those phones
     * back onto the misleading branch.
     */
    private fun isPhoneLocked(context: Context): Boolean {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return keyguard?.isKeyguardLocked == true
    }

    /**
     * Start mirroring from the phone's own Mirror tab.
     *
     * This is the primary consent path on Android 16, not a fallback: it is the one route where a
     * visible Activity is guaranteed, because the user is looking at it. It completes an
     * outstanding `mirror.start` if there is one, and otherwise starts a session the connected Mac
     * learns about through the same `mirror.state` events.
     */
    fun startFromPhone(context: Context) {
        appContext = context.applicationContext
        MirrorNotifications.clear(context.applicationContext)

        val activity = AppForeground.visibleActivity()
        if (activity == null) {
            // Only reachable if the tab is torn down between the tap and this line.
            LinkLog.w("mirror", "startFromPhone with no visible Activity; ignoring")
            return
        }

        val session = owner ?: LinkController.peek()?.anyLiveSession()
        if (session == null) {
            publish(
                MirrorStatus(
                    phase = MirrorPhase.STOPPED,
                    message = "No Mac is connected, so there is nowhere to send the screen.",
                    fixHint = "Connect your Mac on the Mac tab, then start mirroring again.",
                    lastError = "No Mac is connected.",
                ),
                toMac = false,
            )
            return
        }

        owner = session
        if (isRunning) {
            LinkLog.i("mirror", "Start tapped while already running; restarting")
            stop(MirrorStopReason.RestartedFromPhone)
            owner = session
        }
        LinkLog.i("mirror", "Mirroring started from the phone for ${session.peerName}")
        publish(statusFor(MirrorPhase.REQUESTING_CONSENT, session.peerName))
        armConsentTimeout()
        requestConsent(activity)
    }

    /**
     * The control session that owns this capture has ended.
     *
     * Capture exists to feed one Mac. When that Mac is gone there is nobody to send frames to, and
     * continuing is not a harmless leak — it is a phone recording its own screen with no consumer,
     * holding a MediaProjection and a "your screen is being recorded" notification that no longer
     * describes anything real. Before this existed the session ran until something else happened to
     * restart it; measured at 36 seconds in test 9 only because the Mac came back.
     *
     * Scoped to the owning session on purpose: another Mac's session ending is not this session's
     * business, and killing a live capture because an unrelated peer dropped would be its own bug.
     */
    fun onSessionEnded(session: ControlSession) {
        if (owner !== session) return
        val wasLive = isRunning || _status.value.phase.isPending()
        owner = null
        if (!wasLive) return
        LinkLog.i("mirror", "Control session with ${session.peerName} ended; stopping capture")
        stop(MirrorStopReason.MacDisconnected)
        // stop() releases the projection and the encoder but not the foreground service that hosts
        // them — that is stopFromPhone's pairing too, and without it the recording notification
        // outlives the capture it announces.
        appContext?.let { MirrorService.stop(it) }
    }

    /** `mirror.stop` from the phone's Mirror tab. */
    fun stopFromPhone(context: Context) {
        stop(MirrorStopReason.StoppedFromPhone)
        MirrorService.stop(context.applicationContext)
    }

    /**
     * Shows the system prompt from a visible Activity.
     *
     * The Activity, not the Application context, is what makes this legal on Android 16 — see the
     * class comment. Everything that can come back from the prompt is a named outcome.
     */
    private fun requestConsent(activity: Activity) {
        MirrorConsentActivity.request(activity) { data, failure ->
            cancelConsentTimeout()
            appContext?.let { MirrorNotifications.clear(it) }
            when {
                failure != null -> fail(failure)
                data == null -> fail(MirrorFailure.ConsentDismissed)
                else -> {
                    publish(statusFor(MirrorPhase.STARTING, owner?.peerName))
                    val context = appContext
                    if (context == null) {
                        fail(MirrorFailure.EncoderInitFailed("no application context"))
                    } else {
                        MirrorService.startWithConsent(context, data)
                    }
                }
            }
        }
    }

    /**
     * Called by [MirrorService] once it is in the foreground with the mediaProjection type, which
     * Android 14+ requires before a projection may be obtained at all.
     */
    fun onServiceReady(context: Context, consent: Intent) {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val live = try {
            manager.getMediaProjection(android.app.Activity.RESULT_OK, consent)
        } catch (e: Exception) {
            fail(MirrorFailure.EncoderInitFailed("projection refused: ${e.message}"))
            return
        }
        if (live == null) {
            fail(MirrorFailure.ConsentDismissed)
            return
        }
        projection.set(live)

        // Android 14 requires a callback registered before createVirtualDisplay, and it is also
        // how we learn the user revoked capture from the status bar.
        live.registerCallback(
            object : MediaProjection.Callback() {
                override fun onStop() {
                    // The callback carries no reason at any SDK level this app compiles against,
                    // so the reason is derived from the one question the app can answer right
                    // now. Read here rather than reused from the last capability refresh: One UI
                    // can set the restriction while the app is backgrounded, which is exactly the
                    // window no refresh covers, and this is the moment it costs something.
                    val restricted = BackgroundRestrictionReading.isSet(context) { failure ->
                        LinkLog.w(
                            "mirror",
                            "Projection revoked and isBackgroundRestricted could not be read " +
                                "(${failure.javaClass.simpleName}: ${failure.message}); the stop " +
                                "sentence will not name the restriction",
                        )
                    }
                    val reason = MirrorStopReason.revoked(restricted)
                    LinkLog.i(
                        "mirror",
                        "Projection stopped by Android: ${reason.label} " +
                            "(backgroundRestricted=$restricted)",
                    )
                    stop(reason)
                }
            },
            null,
        )

        val fresh = startEncoder(context, live) ?: return

        announceRunning(fresh)
        watchForRotation(context)
        startStatsTicker()
        LinkLog.i("mirror", "Mirror session started")
    }

    /**
     * `mirror.state: running` — the first moment the capture geometry is actually known, and the
     * Mac's cue to open the video socket.
     *
     * This used to be the `mirror.start` ack. It is an event now because the phone can also start
     * a session on its own, and because an ack that waits for this is an ack that waits for a
     * person to pick up their phone.
     */
    private fun announceRunning(live: ScreenEncoder) {
        val size = live.currentGeometry()
        val settings = live.currentConfig()
        // Whatever was last published for this session. It is never null on this path — capture is
        // running, so startEncoder or swapEncoder has published — but a `running` with no stamp
        // would be a coordinate space the Mac cannot name, so the fallback says so rather than
        // inventing an id.
        val stamp = ScreenGeometryRegistry.current()
        _status.update {
            it.copy(
                phase = MirrorPhase.RUNNING,
                message = "Mirroring to ${owner?.peerName ?: "your Mac"}.",
                fixHint = null,
                awaitingTap = false,
                geometry = size,
                lastError = null,
            )
        }
        owner?.event(MessageType.MIRROR_STATE) {
            put("state", MirrorPhase.RUNNING.wire)
            requestId?.let { put("requestId", it) }
            put("message", "Mirroring.")
            put("width", size.width)
            put("height", size.height)
            put("dpi", size.dpi)
            put("bitrate", settings.bitrate)
            put("frameRate", settings.frameRate)
            put("maxResolution", settings.maxResolution)
            stamp?.let {
                put("rotation", it.rotation)
                put("geometryId", it.id)
            }
        }
    }

    /**
     * Builds the encoder at whatever [config] currently asks for, sized against the phone's own
     * display.
     *
     * The geometry is resolved here rather than taken from the Mac because the phone is the only
     * side that knows its panel — see [MirrorConfig.geometryFor]. Returns null when the encoder
     * refused to start, having already reported which failure it was.
     */
    private fun startEncoder(context: Context, live: MediaProjection): ScreenEncoder? {
        val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        // The session's baseline. Capture starts from a user tapping a consent dialog, which is
        // the quietest the display gets — nothing is turning — so this is where the natural
        // orientation is decided, and every later reading is judged against it.
        val reading = readDisplay(displayManager)
        naturalPortrait = naturalOrientationIsPortrait(reading)
        val geometry = resolveGeometry(reading, config)

        val epoch = generation.get() + 1
        val fresh = newEncoder(geometry, epoch)
        val surface = fresh.prepare() ?: return null // prepare() named the failure already
        generation.set(epoch)
        encoder.set(fresh)

        val virtual = try {
            live.createVirtualDisplay(
                "ConnectSuite",
                geometry.width,
                geometry.height,
                geometry.dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                surface,
                null,
                null,
            )
        } catch (e: Exception) {
            LinkLog.e("mirror", "Virtual display failed", e)
            encoder.getAndSet(null)?.stop()
            fail(MirrorFailure.EncoderInitFailed("virtual display: ${e.message}"))
            return null
        }
        if (virtual == null) {
            encoder.getAndSet(null)?.stop()
            fail(MirrorFailure.EncoderInitFailed("virtual display: refused without a reason"))
            return null
        }
        display.set(virtual)

        if (!fresh.begin()) {
            encoder.set(null)
            return null
        }
        lastRotation = reading.rotation
        publishGeometry(geometry, reading)
        return fresh
    }

    /**
     * One encoder, wired to this session and to nothing else.
     *
     * The [epoch] gate is what makes a swap safe: an encoder that is no longer current is not
     * merely stopped later, it stops counting immediately. Its remaining frames and any failure it
     * reports on the way down belong to a session geometry the Mac has already been told to
     * forget.
     */
    private fun newEncoder(geometry: CaptureGeometry, epoch: Long): ScreenEncoder = ScreenEncoder(
        config = config,
        geometry = geometry,
        onFrame = { frame ->
            if (generation.get() == epoch) {
                if (frame.config) lastConfigFrame = frame
                videoChannel.get()?.offer(frame)
            }
        },
        onFailure = { failure -> if (generation.get() == epoch) fail(failure) },
        onResumed = { if (generation.get() == epoch) onContentResumed() },
    )

    /**
     * Replaces the encoder under a running display, at a new geometry, without touching the
     * MediaProjection.
     *
     * The order is the whole thing, and every step of it is load-bearing:
     *
     *  1. build the new encoder and take its input Surface — `createInputSurface` is legal only
     *     before `start()`, so the Surface has to exist while nothing is consuming it;
     *  2. commit the generation, so the outgoing encoder's frames stop reaching the Mac *before*
     *     it is told about the new size;
     *  3. `VirtualDisplay.resize` — the display now renders at the new geometry;
     *  4. `VirtualDisplay.setSurface` — those pixels now go to the new encoder;
     *  5. start the new encoder, which emits its own SPS/PPS as its first output, so the config
     *     frame reaches the Mac ahead of any frame at the new size;
     *  6. ask for a sync frame, so the Mac has an IDR to restart decoding on rather than waiting
     *     out a keyframe interval;
     *  7. only now stop and release the old encoder.
     *
     * Steps 3 and 4 are both public API on VirtualDisplay and neither calls back into
     * MediaProjection, which is why this never meets the Android 14+ rule that one projection may
     * create exactly one virtual display — and why it costs the user no second consent tap.
     */
    private fun swapEncoder(
        geometry: CaptureGeometry,
        reading: DisplayReading,
        reason: String,
    ): ScreenEncoder? {
        val virtual = display.get()
        if (virtual == null) {
            LinkLog.w("mirror", "Encoder swap ($reason) with no virtual display; ignoring")
            return null
        }
        if (!swapping.compareAndSet(false, true)) {
            LinkLog.w("mirror", "Encoder swap ($reason) while one is in flight; ignoring")
            return null
        }
        try {
            val old = encoder.get()
            val epoch = generation.get() + 1
            val fresh = newEncoder(geometry, epoch)
            val surface = fresh.prepare() ?: return null // prepare() named the failure already

            generation.set(epoch)
            encoder.set(fresh)
            // The parameter sets in hand describe a stream of the previous size. A video socket
            // that reconnects between here and the new encoder's first output must be primed with
            // nothing rather than with a lie.
            lastConfigFrame = null

            virtual.resize(geometry.width, geometry.height, geometry.dpi)
            virtual.setSurface(surface)

            if (!fresh.begin()) {
                encoder.set(null)
                old?.stop()
                return null
            }
            fresh.requestKeyframe()
            old?.stop()

            _status.update { it.copy(geometry = geometry) }
            publishGeometry(geometry, reading)
            LinkLog.i(
                "mirror",
                "Encoder swapped ($reason): now ${geometry.width}x${geometry.height} @${geometry.dpi}dpi",
            )
            return fresh
        } finally {
            swapping.set(false)
        }
    }

    /**
     * The phone's real display size and density, scaled to the requested cap.
     *
     * `getRealMetrics` is deprecated in favour of `WindowMetrics`, and is still what this uses:
     * `getCurrentWindowMetrics` wants a window context and there is none here — capture is driven
     * from a service, not an Activity — and `getRealMetrics` returns size and density together,
     * which is exactly the pair needed. It also reports the display's *current* resolution, so a
     * phone switched to FHD+ in Settings is capped against what it is actually running at.
     */
    private fun resolveGeometry(reading: DisplayReading, wanted: MirrorConfig): CaptureGeometry {
        val geometry = wanted.geometryFor(reading.widthPixels, reading.heightPixels, reading.densityDpi)
        val line = "Display ${reading.widthPixels}x${reading.heightPixels} @${reading.densityDpi}dpi " +
            "-> capture ${geometry.width}x${geometry.height} @${geometry.dpi}dpi " +
            "(cap ${wanted.maxResolution})"
        if (line != lastGeometryLine) {
            lastGeometryLine = line
            LinkLog.i("mirror", line)
        }
        return geometry
    }

    /**
     * One reading of the display: size, density and angle, taken together.
     *
     * `getRealMetrics` is deprecated in favour of `WindowMetrics` and is still what this uses:
     * `getCurrentWindowMetrics` wants a window context and there is none here — capture is driven
     * from a service, not an Activity — and `getRealMetrics` returns size and density together.
     * It also reports the display's *current* resolution, so a phone switched to FHD+ in Settings
     * is capped against what it is actually running at.
     *
     * The `Display` is fetched once and both questions are asked of that one object, which is the
     * closest thing to an atomic reading the platform offers. It is not close enough on its own —
     * see [settledReading].
     */
    @Suppress("DEPRECATION")
    private fun readDisplay(displayManager: DisplayManager): DisplayReading {
        val display = displayManager.getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = android.util.DisplayMetrics()
        display.getRealMetrics(metrics)
        return DisplayReading(
            widthPixels = metrics.widthPixels,
            heightPixels = metrics.heightPixels,
            densityDpi = metrics.densityDpi,
            rotation = display?.rotation ?: Surface.ROTATION_0,
        )
    }

    /**
     * A reading whose angle and shape agree — defect 16's fix.
     *
     * On a Samsung SM-S938B, coming back from landscape to portrait, `getRealMetrics` returns the
     * new portrait size while `getRotation()` still answers 270°, and it stays that way for ~63ms
     * before a second `DisplayListener` callback corrects it. Announcing the first reading told
     * the Mac "you are at 270° and 1440x3120", which is impossible, and any coordinate mapped
     * against it during that window would have landed in the wrong place.
     *
     * So a reading is checked against the session's natural orientation and re-taken until it
     * makes sense, for up to [SETTLE_BUDGET_MS]. Re-reading is safe here: this runs on the
     * mirror's own display thread, never the main looper.
     *
     * If it never settles the last reading is returned anyway, with a warning — refusing to
     * announce a rotation at all would freeze the Mac's picture at the old shape, which is worse
     * than an angle that is briefly wrong. That residual case is exactly what the geometry stamp
     * on every input message covers: the picture may be misdescribed for a moment, but a tap
     * computed against a misdescription is refused rather than delivered somewhere else.
     */
    private fun settledReading(displayManager: DisplayManager): DisplayReading {
        val baseline = naturalPortrait
        var reading = readDisplay(displayManager)
        if (baseline == null) return reading

        val deadline = System.nanoTime() + SETTLE_BUDGET_MS * 1_000_000
        var attempts = 1
        while (!readingIsConsistent(reading, baseline)) {
            if (System.nanoTime() >= deadline) {
                LinkLog.w(
                    "mirror",
                    "Display reading never settled after ${attempts} tries: " +
                        "${reading.widthPixels}x${reading.heightPixels} reported at " +
                        "${reading.rotation * 90}°, which cannot both be true. Announcing it " +
                        "anyway; input stamped against it will be refused.",
                )
                return reading
            }
            Thread.sleep(SETTLE_POLL_MS)
            reading = readDisplay(displayManager)
            attempts += 1
        }
        if (attempts > 1) {
            LinkLog.i("mirror", "Display reading settled after $attempts tries")
        }
        return reading
    }

    /**
     * Tells everything that maps a coordinate what shape the screen is, and returns the stamp
     * that names it.
     *
     * Published before the matching event goes on the wire, so an `input.tap` quoting the id the
     * Mac has just been given is never rejected for naming a stamp the phone has not minted yet.
     */
    private fun publishGeometry(geometry: CaptureGeometry, reading: DisplayReading): ScreenGeometryRegistry.Stamp =
        ScreenGeometryRegistry.publish(
            width = geometry.width,
            height = geometry.height,
            rotation = reading.rotation * 90,
            displayWidth = reading.widthPixels,
            displayHeight = reading.heightPixels,
        )

    /**
     * `mirror.stop`, and every internal teardown.
     *
     * Takes a [MirrorStopReason] rather than a `String`, which is defect 104: eight call sites
     * each wrote their own sentence and two of them ended up three words apart, one meaning *you
     * did this* and the other meaning *Android took it away*.
     */
    fun stop(reason: MirrorStopReason) {
        val hadSession = isRunning
        // Nothing from the outgoing encoder counts from here: a codec being torn down can still
        // report an error, and that error belongs to a session that is already over.
        generation.incrementAndGet()
        cancelConsentTimeout()
        appContext?.let { MirrorNotifications.clear(it) }
        MirrorConsentActivity.cancelPending()
        statsTask?.cancel(false)
        statsTask = null
        stopWatchingForRotation()
        encoder.getAndSet(null)?.stop()
        // The display is released before the projection that created it, which is the only order
        // the framework accepts without logging a leak.
        display.getAndSet(null)?.let { runCatching { it.release() } }
        projection.getAndSet(null)?.let { runCatching { it.stop() } }
        videoChannel.getAndSet(null)?.close()
        // There is no capture frame any more, so there is no coordinate space either. Input asks
        // this registry, so clearing it is what turns a tap arriving after a stop into
        // "start mirroring first" rather than a gesture mapped against a dead session's geometry.
        ScreenGeometryRegistry.clear()
        naturalPortrait = null
        contentBlocked = false
        if (hadSession) LinkLog.i("mirror", "Mirror stopped: ${reason.label} — ${reason.sentence}")

        // Announced only when there was something to end. Publishing "stopped" over an idle engine
        // would overwrite the failure the Mirror tab is showing with a line about nothing.
        if (hadSession || _status.value.phase.isPending()) {
            _status.update {
                it.copy(
                    phase = MirrorPhase.STOPPED,
                    message = reason.sentence,
                    // Carried now rather than always null. The revoke reasons are the only stops
                    // with anything for the user to do, and before this they had nowhere to put
                    // it — which is half of why eight sessions died without advice.
                    fixHint = reason.fixHint,
                    awaitingTap = false,
                    geometry = null,
                )
            }
            owner?.event(MessageType.MIRROR_STATE) {
                put("state", MirrorPhase.STOPPED.wire)
                requestId?.let { put("requestId", it) }
                put("message", reason.sentence)
                reason.fixHint?.let { put("fixHint", it) }
            }
        }

        // The next session's encoder emits its own parameter sets; keeping these would prime a
        // new decoder with a description of a stream that no longer exists.
        lastConfigFrame = null
        owner = null
        requestId = null
    }

    /**
     * `mirror.config`. Bitrate changes on the live encoder; a resolution change swaps the surface
     * underneath the display.
     *
     * MediaCodec still cannot be resized in place, so a new [MirrorConfig.maxResolution] does need
     * a new encoder — but it does **not** need a new VirtualDisplay, and that distinction is the
     * whole of the fix. `VirtualDisplay.resize` and `VirtualDisplay.setSurface` are public API and
     * neither goes back to the [MediaProjection], so **the projection backs exactly one virtual
     * display for the life of the session — which is why this resizes rather than recreates.**
     * The Android 14+ rule that one projection permits exactly one `createVirtualDisplay` is
     * therefore never approached, and the user is never asked for consent a second time.
     *
     * (An earlier version of this comment claimed a projection could back several displays and
     * rebuilt the display on every change. That was false on Android 14+ and ended the session
     * with `EncoderInitFailed`; see the Phase 2a recorded run in `docs/testing.md`.)
     */
    fun reconfigure(bitrate: Int?, maxResolution: Int?) {
        val previous = config
        config = previous.copy(
            bitrate = bitrate ?: previous.bitrate,
            maxResolution = maxResolution ?: previous.maxResolution,
        )
        if (!isRunning) return

        // Bitrate is applied whether or not the resolution moved: a swap builds its encoder from
        // `config`, so setting it on the outgoing one as well would be pointless, but a
        // bitrate-only change must still land.
        if (config.maxResolution == previous.maxResolution) {
            bitrate?.let { encoder.get()?.updateBitrate(it) }
            return
        }

        val context = appContext
        if (context == null) {
            LinkLog.w("mirror", "Resolution change with no application context; ignoring")
            return
        }
        val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val reading = settledReading(displayManager)
        val geometry = resolveGeometry(reading, config)

        LinkLog.i(
            "mirror",
            "Resolution cap ${previous.maxResolution} -> ${config.maxResolution}",
        )
        // `running` is re-sent because it is what carries the capture geometry, and the Mac's HUD
        // and window are both drawn from it.
        swapEncoder(geometry, reading, "resolution cap ${config.maxResolution}")
            ?.let { announceRunning(it) }
    }

    // ---- rotation ---------------------------------------------------------------------------

    /**
     * Follows the phone's own display so the mirror does.
     *
     * Without this a phone turned to landscape keeps rendering into a portrait VirtualDisplay and
     * the Mac receives landscape content letterboxed inside a portrait frame — the picture is not
     * wrong so much as small, which is why it reads as a quality problem rather than a missing
     * feature.
     *
     * The listener is registered on a thread of our own: `onDisplayChanged` would otherwise arrive
     * on the main looper, and a swap configures a MediaCodec, which is not work for the thread
     * drawing the phone's UI.
     */
    private fun watchForRotation(context: Context) {
        if (displayListenerRegistered) return
        val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val thread = HandlerThread("mirror-display").apply { start() }
        displayThread = thread
        displayManager.registerDisplayListener(displayListener, Handler(thread.looper))
        displayListenerRegistered = true
    }

    private fun stopWatchingForRotation() {
        val context = appContext
        if (displayListenerRegistered && context != null) {
            val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            runCatching { displayManager.unregisterDisplayListener(displayListener) }
        }
        displayListenerRegistered = false
        displayThread?.quitSafely()
        displayThread = null
        lastRotation = -1
        lastGeometryLine = null
    }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit

        override fun onDisplayRemoved(displayId: Int) = Unit

        override fun onDisplayChanged(displayId: Int) {
            // Our own VirtualDisplay changes too — every resize we make reports here — and acting
            // on that would be a swap that triggers a swap.
            if (displayId != Display.DEFAULT_DISPLAY) return
            runCatching { onDisplayGeometryChanged() }
                .onFailure { LinkLog.w("mirror", "Rotation handling failed: ${it.message}") }
        }
    }

    /**
     * `mirror.rotate`, and the resize behind it.
     *
     * The event goes out *before* the surface swap on purpose: it is what tells the Mac to expect
     * a differently shaped picture, and it arrives on the control channel while the new parameter
     * sets are still being produced on the video one. A Mac that sized its window on the first
     * frame of the new geometry instead would show one frame of the wrong shape first.
     */
    private fun onDisplayGeometryChanged() {
        if (!isRunning) return
        val context = appContext ?: return
        val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        // Settled, not raw: the angle and the shape announced together must agree, because a
        // coordinate is about to be mapped against them. See [settledReading].
        val reading = settledReading(displayManager)
        val next = resolveGeometry(reading, config)
        val current = encoder.get()?.currentGeometry()

        when (displayChangeFor(current, lastRotation, next, reading.rotation)) {
            DisplayChange.NOTHING -> return

            // A 180° turn: same pixels, different way up. No encoder swap — an IDR for a picture
            // of the same shape is not worth it — but it is emphatically not a no-op. The Mac's
            // HUD would say 90 with the phone at 270, and, since 2026-08-26, every coordinate the
            // Mac computed before the turn now maps to the point-reflected place. So it is
            // announced *and* it mints a new geometry stamp, which is what makes those
            // coordinates get refused instead of delivered upside down.
            DisplayChange.ANNOUNCE -> {
                lastRotation = reading.rotation
                announceRotation(current ?: next, reading)
            }

            DisplayChange.RESIZE -> {
                lastRotation = reading.rotation
                announceRotation(next, reading)
                swapEncoder(next, reading, "rotation to ${reading.rotation * 90}°")
            }
        }
    }

    private fun announceRotation(geometry: CaptureGeometry, reading: DisplayReading) {
        val stamp = publishGeometry(geometry, reading)
        LinkLog.i(
            "mirror",
            "Display rotated to ${reading.rotation * 90}°: capture " +
                "${geometry.width}x${geometry.height} (geometry #${stamp.id})",
        )
        owner?.event(MessageType.MIRROR_ROTATE) {
            put("width", geometry.width)
            put("height", geometry.height)
            put("dpi", geometry.dpi)
            put("rotation", stamp.rotation)
            put("geometryId", stamp.id)
        }
    }

    /**
     * `mirror.keyframe`.
     *
     * The `?.` used to be the whole of it, so a request arriving with no encoder was swallowed
     * without a word — the request path's third silence, after the handler's and the encoder's.
     * Returns whether anything was actually asked, so the handler can say so too.
     */
    fun requestKeyframe(): Boolean {
        val live = encoder.get()
        if (live == null) {
            LinkLog.w("mirror", "mirror.keyframe arrived with no encoder — there is no session to ask")
            return false
        }
        live.requestKeyframe()
        return true
    }

    /**
     * The banking app is gone and there are pixels again.
     *
     * [MirrorFailure.SecureSurface] is the one failure that leaves the session running, so it is
     * the one that needs an end as well as a beginning: without this both screens keep showing the
     * sentence about blocked content over a picture that has been back for a minute. `running` is
     * re-sent rather than invented as a new phase — it is exactly what it means, frames are
     * flowing — and the Mac treats a second one as a no-op beyond taking the message down.
     */
    private fun onContentResumed() {
        if (!isRunning) return
        contentBlocked = false
        LinkLog.i("mirror", "Capturable content is back; the secure surface is gone")
        encoder.get()?.let { live ->
            _status.update {
                it.copy(message = "Mirroring to ${owner?.peerName ?: "your Mac"}.", fixHint = null, lastError = null)
            }
            announceRunning(live)
        }
    }

    // ---- consent deadline -------------------------------------------------------------------

    /**
     * The timer that makes "nobody answered" a named failure instead of a hang.
     *
     * It is the only thing that can speak when the prompt was never shown at all — the case that
     * left the Mac's canvas blank for a minute — because every other consent outcome is reported
     * from inside [MirrorConsentActivity], which in that case never ran.
     */
    private fun armConsentTimeout() {
        cancelConsentTimeout()
        consentDeadline.set(
            ticker.schedule(
                { runCatching { onConsentTimeout() } },
                CONSENT_TIMEOUT_MS,
                TimeUnit.MILLISECONDS,
            ),
        )
    }

    private fun cancelConsentTimeout() {
        consentDeadline.getAndSet(null)?.cancel(false)
    }

    private fun onConsentTimeout() {
        if (!_status.value.phase.isPending()) return
        LinkLog.w("mirror", "Consent unanswered after ${CONSENT_TIMEOUT_MS}ms")
        appContext?.let { MirrorNotifications.clear(it) }
        MirrorConsentActivity.cancelPending()
        fail(MirrorFailure.ConsentTimeout)
    }

    // ---- state ------------------------------------------------------------------------------

    /** The prose for a phase, in one place, so the Mac and the phone say the same thing. */
    private fun statusFor(phase: MirrorPhase, peerName: String?): MirrorStatus = when (phase) {
        MirrorPhase.AWAITING_FOREGROUND -> MirrorStatus(
            phase = phase,
            message = "${peerName ?: "Your Mac"} asked to mirror the screen, but ConnectSuite is " +
                "in the background on the phone and Android will not let it show the screen " +
                "capture prompt from there.",
            fixHint = "Open ConnectSuite on the phone, go to the Mirror tab and tap Start mirroring.",
            peerName = peerName,
            awaitingTap = true,
        )

        MirrorPhase.REQUESTING_CONSENT -> MirrorStatus(
            phase = phase,
            message = "Asking for screen capture permission on the phone.",
            fixHint = "Tap \"Start now\" on the phone.",
            peerName = peerName,
        )

        MirrorPhase.STARTING -> MirrorStatus(
            phase = phase,
            message = "Permission granted; starting capture.",
            peerName = peerName,
        )

        else -> MirrorStatus(phase = phase, peerName = peerName)
    }

    /**
     * One place that both moves the phone's UI and tells the Mac, so the two cannot drift.
     *
     * [toMac] is false only for states that are about this phone alone — a Start tapped with no
     * Mac connected has nobody to tell.
     */
    private fun publish(status: MirrorStatus, toMac: Boolean = true) {
        _status.value = status
        if (!toMac) return
        owner?.event(MessageType.MIRROR_STATE) {
            put("state", status.phase.wire)
            requestId?.let { put("requestId", it) }
            status.message?.let { put("message", it) }
            status.fixHint?.let { put("fixHint", it) }
        }
    }

    /** Phases where something has been asked for and no answer has arrived. */
    private fun MirrorPhase.isPending(): Boolean =
        this == MirrorPhase.AWAITING_FOREGROUND || this == MirrorPhase.REQUESTING_CONSENT

    // ---- failure --------------------------------------------------------------------------

    /**
     * The single exit for everything that goes wrong. Sends the reason to the Mac, shows it on the
     * phone, tears the session down, and leaves nothing half-running.
     */
    fun fail(failure: MirrorFailure) {
        LinkLog.w("mirror", "Mirror failed: ${failure.label} — ${failure.reason}")
        cancelConsentTimeout()
        owner?.let { emit(it, failure) }
        // A secure surface is transient: the user walks out of the banking app and it works again.
        // Everything else has genuinely ended the session. The phase reflects that — capture is
        // still running through a secure surface, and a Mirror tab that said "stopped" over a live
        // session would be describing something that did not happen.
        val transient = failure is MirrorFailure.SecureSurface
        // Input reads this: while the screen the user is looking at is blanked, a gesture would be
        // aimed at something they cannot see.
        if (transient) contentBlocked = true
        _status.update {
            it.copy(
                phase = if (transient) it.phase else MirrorPhase.STOPPED,
                message = failure.reason,
                fixHint = failure.fixHint,
                awaitingTap = false,
                lastError = failure.reason,
            )
        }
        if (!transient) {
            // The failure's own sentence travels *into* stop() as the reason. It used to be
            // stringified here, overwritten by stop()'s mechanical wording, and then restored on
            // top afterwards — three writes to one field to end up where one would do, and the
            // shape `CLAUDE.md` calls two writers on one surface.
            stop(MirrorStopReason.Failed(failure))
            _status.update { it.copy(lastError = failure.reason) }
        }
    }

    private fun emit(session: ControlSession, failure: MirrorFailure) {
        session.sendError(
            requestId = requestId ?: java.util.UUID.randomUUID().toString(),
            code = failure.code,
            message = failure.reason,
            feature = failure.feature,
            fixHint = failure.fixHint,
        )
    }

    /**
     * Used by the handlers to read what the Mac asked for, with sane defaults.
     *
     * `width`/`height` are not read. The Mac does not choose the capture geometry — it sends a
     * cap and the phone resolves it against its own panel (see [MirrorConfig.geometryFor]).
     */
    fun configFrom(request: Envelope): MirrorConfig {
        val defaults = MirrorConfig()
        return MirrorConfig(
            maxResolution = intFrom(request, "maxResolution", defaults.maxResolution),
            bitrate = intFrom(request, "bitrate", defaults.bitrate),
            frameRate = intFrom(request, "frameRate", defaults.frameRate),
            keyframeIntervalS = intFrom(request, "keyframeInterval", defaults.keyframeIntervalS),
        )
    }

    /** Null when the Mac did not mention the field, which `mirror.config` reads as "leave it". */
    fun optionalIntFrom(request: Envelope, key: String): Int? =
        (request.payload[key] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull()

    private fun intFrom(request: Envelope, key: String, fallback: Int): Int =
        optionalIntFrom(request, key) ?: fallback

    // ---- stats ------------------------------------------------------------------------------

    /**
     * Sends `mirror.stats` every 2 seconds for as long as the session lives.
     *
     * It exists because two of the numbers the Mac's HUD needs cannot be observed from the Mac at
     * all: frames dropped on the phone were never sent, and a frame's PTS is a reading of the
     * phone's clock that means nothing on its own. Both come from here.
     */
    private fun startStatsTicker() {
        statsTask?.cancel(false)
        lastStatsFrames = -1L
        lastStatsBytes = 0L
        statsTask = ticker.scheduleWithFixedDelay(
            { runCatching { emitStats() } },
            STATS_INTERVAL_MS,
            STATS_INTERVAL_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    /**
     * One line per stats tick while capture is live: how many frames the encoder actually produced
     * since the last one, and how big the last keyframe was.
     *
     * This exists because neither log recorded either number, and without them "the picture went
     * black" cannot be told apart from "the frames stopped" after the fact — the two need
     * different handling and only one of them is something [BlackFrameDetector] can ever see.
     * Written only while a session is live, so an idle phone stays silent.
     */
    private fun logEncodeRate(counters: EncoderStats) {
        val frames = counters.encodedFrames
        val bytes = counters.encodedBytes
        val fresh = lastStatsFrames < 0 || frames < lastStatsFrames
        val deltaFrames = if (fresh) frames else frames - lastStatsFrames
        val deltaBytes = if (fresh) bytes else bytes - lastStatsBytes
        lastStatsFrames = frames
        lastStatsBytes = bytes

        val fps = deltaFrames * 1000.0 / STATS_INTERVAL_MS
        LinkLog.i(
            "mirror",
            "Encoded +$deltaFrames frames (${"%.1f".format(fps)}/s, +$deltaBytes B) " +
                "last keyframe ${counters.lastKeyframeBytes}B" +
                if (fresh) " [new encoder]" else "",
        )
    }

    private fun emitStats() {
        val live = encoder.get() ?: return
        val session = owner ?: return
        val counters = live.stats()
        val size = live.currentGeometry()
        logEncodeRate(counters)
        session.send(
            Envelope.of(MessageType.MIRROR_STATS) {
                put("encodedFrames", counters.encodedFrames)
                put("encodedBytes", counters.encodedBytes)
                put("droppedFrames", videoChannel.get()?.droppedCount() ?: 0)
                put("ptsUs", counters.ptsUs)
                put("monoUs", counters.monoUs)
                put("width", size.width)
                put("height", size.height)
                put("bitrate", live.currentConfig().bitrate)
                put("frameRate", live.currentConfig().frameRate)
            },
        )
    }
}
