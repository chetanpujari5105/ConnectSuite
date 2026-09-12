package com.chetan.connectsuite.mirror.v2

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.chetan.connectsuite.core.link.LinkLog
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/** One encoded access unit on its way to the Mac. */
class VideoFrame(
    val keyframe: Boolean,
    val config: Boolean,
    val ptsUs: Long,
    val data: ByteArray,
)

/**
 * What the VirtualDisplay is actually created at. Resolved on the phone, never sent by the Mac.
 *
 * Separate from [MirrorConfig] because the two are different kinds of thing: the config is a
 * request, and this is the answer. Only the phone knows its own panel, so a Mac that picked
 * width and height itself would be guessing at an aspect ratio — and a wrong guess is exactly
 * how a mirror ends up stretched.
 */
data class CaptureGeometry(val width: Int, val height: Int, val dpi: Int)

/** What a reading of the phone's display tells a live mirror session to do. */
enum class DisplayChange {
    /** Nothing that matters to a mirror changed. */
    NOTHING,

    /** The Mac needs telling, but the captured pixels are the same shape. A 180° flip is this. */
    ANNOUNCE,

    /** The capture geometry itself changed, so the display and the encoder must follow it. */
    RESIZE,
}

/**
 * Decides what a `DisplayListener` callback is worth.
 *
 * `onDisplayChanged` fires for brightness, refresh rate, HDR state and wallpaper as well as for
 * rotation, and a resize costs a fresh encoder and an IDR — perhaps 100ms of the mirror standing
 * still. Acting on every callback would stutter the picture for reasons that have nothing to do
 * with what is on screen, so the decision is made here, on numbers, and is testable without a
 * phone.
 *
 * [current] is null before capture is running, when there is nothing to compare against and
 * nothing to swap.
 */
fun displayChangeFor(
    current: CaptureGeometry?,
    currentRotation: Int,
    next: CaptureGeometry,
    nextRotation: Int,
): DisplayChange = when {
    current == null -> DisplayChange.NOTHING
    current.width != next.width || current.height != next.height -> DisplayChange.RESIZE
    currentRotation != nextRotation -> DisplayChange.ANNOUNCE
    else -> DisplayChange.NOTHING
}

/**
 * One reading of the phone's display: its real pixel size, its density, and the angle it reports.
 *
 * The three are read together and kept together on purpose. Reading the metrics and the rotation
 * as two separate questions is what produced defect 16 — `getRealMetrics` came back with the new
 * landscape-to-portrait shape while `Display.getRotation()` still answered with the outgoing
 * angle, and the pair was announced to the Mac 63ms before a second callback corrected it.
 */
data class DisplayReading(
    val widthPixels: Int,
    val heightPixels: Int,
    val densityDpi: Int,
    /** [android.view.Surface.ROTATION_0]..`ROTATION_270`, i.e. 0..3, not degrees. */
    val rotation: Int,
)

/**
 * Whether a reading is internally consistent: does the angle it reports match the shape it
 * reports?
 *
 * A phone whose natural orientation is portrait is portrait at 0° and 180° and landscape at 90°
 * and 270°; a tablet with a landscape natural orientation is the other way round. So given which
 * one the device is, the rotation and the metrics can only agree one way, and a reading where
 * they disagree is one taken mid-turn, with one half updated and the other not.
 *
 * This is the discriminator that makes a retry worth doing. Simply reading twice and waiting for
 * two identical answers would not work: the inconsistent state on this hardware *persists* for
 * ~63ms, so two reads inside that window agree with each other and are both wrong.
 *
 * A square display cannot disagree with anything and is always consistent.
 */
fun readingIsConsistent(reading: DisplayReading, naturalPortrait: Boolean): Boolean {
    if (reading.widthPixels == reading.heightPixels) return true
    val portraitNow = reading.heightPixels > reading.widthPixels
    val quarterTurn = reading.rotation == 1 || reading.rotation == 3
    return portraitNow == (naturalPortrait != quarterTurn)
}

/**
 * Which way up the device is when it reports 0°, worked out from a reading taken while nothing is
 * turning.
 *
 * Established once per session, from the reading taken at capture start, and then used to judge
 * every later one. It cannot be derived per-reading, because a reading taken mid-turn would
 * "prove" whatever inconsistent thing it happens to say.
 */
fun naturalOrientationIsPortrait(reading: DisplayReading): Boolean {
    val portraitNow = reading.heightPixels >= reading.widthPixels
    val quarterTurn = reading.rotation == 1 || reading.rotation == 3
    return portraitNow != quarterTurn
}

/** Encoder settings, as the Mac asks for them in `mirror.start`/`mirror.config`. */
data class MirrorConfig(
    /**
     * Cap on the **short edge** in pixels — not a resolution to capture at. See [geometryFor].
     *
     * The default is deliberately below every modern flagship's native panel. A 1440p phone
     * mirrored at native resolution produces a bitrate a phone hotspot cannot carry, and the
     * failure mode is not a clean error: it is frames shed in [VideoChannel] until the picture
     * is a slideshow. Under-requesting and letting the user raise it is the honest default.
     */
    val maxResolution: Int = DEFAULT_MAX_RESOLUTION,
    val bitrate: Int = 8_000_000,
    val frameRate: Int = 60,
    /** Key frame interval in seconds. The Mac cannot start decoding until one arrives. */
    val keyframeIntervalS: Int = 2,
) {
    /**
     * Scales the phone's real display down to fit [maxResolution] on its short edge.
     *
     * Aspect ratio is preserved, so a 1440x3120 panel capped at 1080 captures 1080x2340 and a
     * phone already at or below the cap is left alone. Both edges are rounded to even numbers:
     * H.264 encoders on Qualcomm and Exynos reject odd dimensions, and the half-pixel that
     * rounding costs is invisible against a 2340-pixel edge.
     *
     * The density is scaled with the geometry. Leaving it at the panel's own dpi would tell the
     * captured display it is a 1080-wide screen at 600dpi, and apps laying out against that
     * report far fewer dp than they have pixels — which is how a mirror ends up showing a phone
     * UI at tablet scale.
     */
    fun geometryFor(displayWidth: Int, displayHeight: Int, densityDpi: Int): CaptureGeometry {
        val shortEdge = minOf(displayWidth, displayHeight)
        val cap = maxResolution.coerceIn(MIN_RESOLUTION, MAX_RESOLUTION)
        val scale = if (shortEdge <= cap) 1.0 else cap.toDouble() / shortEdge
        return CaptureGeometry(
            width = even(displayWidth * scale),
            height = even(displayHeight * scale),
            dpi = (densityDpi * scale).toInt().coerceAtLeast(1),
        )
    }

    private fun even(value: Double): Int = (Math.round(value).toInt() / 2 * 2).coerceAtLeast(2)

    companion object {
        /** 1080p short edge. Raise it from the Mac once the link is known to hold. */
        const val DEFAULT_MAX_RESOLUTION = 1080

        /** Below this there is nothing to look at; above it, no phone panel to capture. */
        const val MIN_RESOLUTION = 240
        const val MAX_RESOLUTION = 2160
    }
}

/**
 * MediaProjection to H.264, with every failure named.
 *
 * The pipeline is: MediaProjection gives a VirtualDisplay, the VirtualDisplay renders into the
 * encoder's input Surface, and MediaCodec hands back Annex B access units on its callback
 * thread. No pixels are ever copied in this process — the Surface is the encoder's own, which is
 * what keeps a 60fps 1080p mirror off the CPU.
 *
 * The VirtualDisplay is **not** owned here. [MirrorEngine] creates exactly one for the session and
 * points it at whichever encoder is current, because both a resolution change and a rotation
 * replace the encoder while the display — and the MediaProjection behind it — stay put. That is
 * why starting is two steps rather than one: [prepare] configures the codec and hands back the
 * Surface the display should render into, and [begin] starts it once the display has been pointed
 * at that Surface. Doing it in one step would need the display to exist first, which is exactly
 * the ordering that cannot work for a swap.
 *
 * Two failure paths are deliberately separated. [MirrorFailure.EncoderInitFailed] means the codec
 * never started, which is a configuration problem the user can fix by asking for less.
 * [MirrorFailure.EncoderDied] means it ran and then threw, which usually means thermal throttling
 * or another app taking the encoder, and re-trying is the right advice. Collapsing them into one
 * "encoder failed" is exactly the unactionable message this class exists to avoid.
 */
class ScreenEncoder(
    private var config: MirrorConfig,
    /** Already resolved against the phone's display by [MirrorConfig.geometryFor]. */
    private val geometry: CaptureGeometry,
    private val onFrame: (VideoFrame) -> Unit,
    private val onFailure: (MirrorFailure) -> Unit,
    /**
     * Real content is back after [MirrorFailure.SecureSurface] was reported.
     *
     * A secure surface is the one failure that does not end the session, so it is the one failure
     * that needs an "and now it is over" as well. Without this the user leaves the banking app,
     * frames resume, and both screens keep showing the sentence about why there are none.
     */
    private val onResumed: () -> Unit = {},
) {

    private var codec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var thread: HandlerThread? = null

    private val started = AtomicBoolean(false)
    private val blackFrames = BlackFrameDetector()

    /** Set once the first frame with real content arrives; stops secure-surface false positives. */
    @Volatile
    private var sawContent = false

    /** True between reporting a secure surface and content coming back, so each is said once. */
    @Volatile
    private var reportedSecure = false

    /** Decides when to go and *take* a keyframe measurement rather than wait for one. */
    private val blankProbe = BlankProbe()

    // Probe outcomes, published together so neither reads as the whole story. A count of probes
    // with no split between "found a blanked screen" and "found a still one" cannot say whether
    // the probe is earning its keyframes — and "found a still one" is the case that costs a real
    // keyframe, so it is the half that has to be visible.
    @Volatile
    private var probesRequested = 0L
    @Volatile
    private var probesFoundBlank = 0L
    @Volatile
    private var probesFoundContent = 0L

    /** True between asking for a sync frame and the keyframe that answers, so outcomes are counted once. */
    @Volatile
    private var probeAwaitingKeyframe = false

    // ---- counters, for `mirror.stats` -------------------------------------------------------
    // The Mac cannot measure any of this for itself: it never sees a frame that was dropped on
    // the phone, and a PTS from another machine's clock means nothing without a reading of that
    // clock to anchor it.

    @Volatile
    private var encodedFrames = 0L
    @Volatile
    private var lastKeyframeBytes = 0

    @Volatile
    private var encodedBytes = 0L

    /** PTS of the most recent frame, paired with the monotonic clock reading taken alongside it. */
    @Volatile
    private var lastPtsUs = 0L

    @Volatile
    private var lastMonoUs = 0L

    /**
     * Step one: configure the codec and hand back the Surface a VirtualDisplay should render into.
     *
     * Nothing is encoded yet — `createInputSurface` is legal only between `configure` and `start`,
     * so the Surface exists before there is anything consuming it, which is precisely what lets
     * the caller point an already-running display at it before [begin]. Returns null when the
     * codec refused, having already named the failure.
     */
    fun prepare(): Surface? {
        if (!started.compareAndSet(false, true)) return inputSurface
        val cfg = config

        val handlerThread = HandlerThread("mirror-encoder").apply { start() }
        thread = handlerThread
        val handler = Handler(handlerThread.looper)

        codec = try {
            createCodec(cfg, geometry, handler)
        } catch (e: Exception) {
            // Init failure: nothing has produced a frame, so this is a configuration problem.
            LinkLog.e("mirror", "Encoder init failed", e)
            stop()
            onFailure(MirrorFailure.EncoderInitFailed(e.message ?: e.javaClass.simpleName))
            return null
        }
        return inputSurface
    }

    /**
     * Step two: start encoding whatever the Surface from [prepare] is now being fed.
     *
     * The first thing out is the parameter sets for *this* encoder. A caller that swapped a live
     * display onto this Surface must get them to the Mac before any frame at the new size — see
     * [MirrorEngine.swapEncoder].
     */
    fun begin(): Boolean {
        val encoder = codec ?: return false
        try {
            encoder.start()
        } catch (e: Exception) {
            LinkLog.e("mirror", "Encoder would not start", e)
            stop()
            onFailure(MirrorFailure.EncoderInitFailed(e.message ?: e.javaClass.simpleName))
            return false
        }
        val cfg = config
        LinkLog.i(
            "mirror",
            "Encoding ${geometry.width}x${geometry.height} @${geometry.dpi}dpi " +
                "${cfg.frameRate}fps ${cfg.bitrate / 1_000_000}Mbps (cap ${cfg.maxResolution}p)",
        )
        return true
    }

    private fun createCodec(cfg: MirrorConfig, size: CaptureGeometry, handler: Handler): MediaCodec {
        val format = MediaFormat.createVideoFormat(MIME, size.width, size.height).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
            )
            setInteger(MediaFormat.KEY_BIT_RATE, cfg.bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, cfg.frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, cfg.keyframeIntervalS)
            // Without this the encoder may sit on frames waiting for a full GOP, which shows up
            // on the Mac as mirroring that starts seconds late.
            setInteger(MediaFormat.KEY_LATENCY, 1)
            setInteger(MediaFormat.KEY_PRIORITY, 0)
        }

        val encoder = MediaCodec.createEncoderByType(MIME)
        encoder.setCallback(callback, handler)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        // Between configure and start, and nowhere else: this is the only window in which a
        // MediaCodec will hand out its input Surface.
        inputSurface = encoder.createInputSurface()
        return encoder
    }

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
            // Surface input: the encoder pulls frames itself, so there is nothing to feed.
        }

        override fun onOutputBufferAvailable(
            codec: MediaCodec,
            index: Int,
            info: MediaCodec.BufferInfo,
        ) {
            try {
                val buffer: ByteBuffer = codec.getOutputBuffer(index) ?: run {
                    codec.releaseOutputBuffer(index, false)
                    return
                }
                if (info.size > 0) {
                    buffer.position(info.offset)
                    buffer.limit(info.offset + info.size)
                    val data = ByteArray(info.size)
                    buffer.get(data)

                    val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    val isKey = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0

                    if (!isConfig) {
                        evaluateForSecureSurface(data, isKey)
                        encodedFrames++
                        encodedBytes += info.size
                        // Kept for the log only. A secure surface is judged on keyframe size, so
                        // the size that was judged is the one worth being able to read back.
                        if (isKey) lastKeyframeBytes = info.size
                        // Read together so the pair is a real correspondence rather than two
                        // readings a scheduler gap apart.
                        lastPtsUs = info.presentationTimeUs
                        lastMonoUs = System.nanoTime() / 1_000
                    }

                    if (isKey && !isConfig) noteKeyframeEmitted()
                    onFrame(VideoFrame(keyframe = isKey, config = isConfig, ptsUs = info.presentationTimeUs, data = data))
                }
                codec.releaseOutputBuffer(index, false)
            } catch (e: IllegalStateException) {
                // Released underneath us during stop(); not a failure worth reporting.
                LinkLog.w("mirror", "Output buffer after release: ${e.message}")
            }
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
            // Ran and then threw. Distinct from init failure on purpose — see the class comment.
            LinkLog.e("mirror", "Encoder died mid-stream", e)
            onFailure(
                MirrorFailure.EncoderDied(
                    if (e.isTransient) "transient" else if (e.isRecoverable) "recoverable" else "fatal",
                ),
            )
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
            LinkLog.i("mirror", "Encoder output format: $format")
        }
    }

    /**
     * FLAG_SECURE gives no callback, so a blanked screen has to be inferred.
     *
     * Android renders secure content as solid black into the captured buffer, and an H.264
     * encoder compresses a solid frame to almost nothing. A run of keyframes that are all tiny
     * is therefore a very strong signal — a real screen, even a dark one, carries noise and never
     * compresses that hard repeatedly.
     */
    private fun evaluateForSecureSurface(data: ByteArray, isKey: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (!isKey) {
            // Defect 23's second half: a blanked screen is a still one, so it starves the very
            // detector that judges blankness. [BlankProbe] decides when to ask for the keyframe
            // that would settle it instead of waiting for the encoder's own schedule.
            if (started.get() && blankProbe.offerDelta(data.size, now)) {
                probesRequested++
                probeAwaitingKeyframe = true
                requestKeyframe()
            }
            return
        }
        val blank = blackFrames.offer(data.size)
        blankProbe.onKeyframe(data.size, now)
        if (probeAwaitingKeyframe) {
            probeAwaitingKeyframe = false
            if (blank) probesFoundBlank++ else probesFoundContent++
        }
        if (blank && sawContent) {
            sawContent = false
            reportedSecure = true
            val lagMs = blankProbe.blankSinceMs(now)
            // The measurement defect 23 asked for, on the line that reports the thing measured:
            // how long the user sat in front of an unexplained black rectangle, and how many of
            // the probes that shortened it were spent. Without the lag beside it, a working
            // detector and one that takes a minute produce identical logs — which is how the
            // minute went unnoticed until a Mac was watched in real time.
            LinkLog.w(
                "mirror",
                "Secure surface after ${lagMs}ms of blank output (keyframe ${data.size}B); " +
                    "probes $probesRequested → $probesFoundBlank blank, $probesFoundContent content",
            )
            onFailure(MirrorFailure.SecureSurface)
        } else if (!blank) {
            sawContent = true
            // Frames were never interrupted — only their content was — so the end of a secure
            // surface has no other signal. Said once per episode, not once per keyframe.
            if (reportedSecure) {
                reportedSecure = false
                blackFrames.reset()
                LinkLog.i(
                    "mirror",
                    "Secure surface over: keyframe back to ${data.size}B; " +
                        "probes $probesRequested → $probesFoundBlank blank, $probesFoundContent content",
                )
                onResumed()
            }
        }
    }

    /** `mirror.config`: change bitrate without tearing the session down. */
    fun updateBitrate(bitrate: Int) {
        config = config.copy(bitrate = bitrate)
        runCatching {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, bitrate) })
        }.onFailure { LinkLog.w("mirror", "Bitrate change refused: ${it.message}") }
    }

    /**
     * `mirror.keyframe`: the Mac lost sync and needs a fresh IDR to resume decoding.
     *
     * **This used to log only its failure.** `CLAUDE.md`'s rule is that the success path gets a line
     * at the same volume, because a count with no denominator reads as whichever story the reader
     * already believes — and here there was no count at all on either side. The consequence was
     * exact: **no evidence exists in this repo that a single `mirror.keyframe` has ever produced an
     * IDR**, over a feature that could fail through a whole demo in silence.
     *
     * Three things are now readable, which is what the request was missing: that it arrived, that
     * the codec accepted it, and — from [noteKeyframeEmitted] — whether a keyframe actually followed
     * and how long it took.
     */
    fun requestKeyframe() {
        val asked = keyframesRequested.incrementAndGet()
        val live = codec
        if (live == null) {
            // The silent no-op. `MirrorEngine.requestKeyframe()` is `encoder.get()?.requestKeyframe()`
            // and a null encoder swallowed the whole request without a word.
            LinkLog.w("mirror", "Keyframe requested with no codec — nothing asked for ($asked asked / ${keyframesEmitted.get()} emitted)")
            return
        }
        keyframeAskedAtMs.set(System.currentTimeMillis())
        runCatching {
            live.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        }.onSuccess {
            LinkLog.i("mirror", "Keyframe requested of the codec ($asked asked / ${keyframesEmitted.get()} emitted)")
        }.onFailure {
            LinkLog.w("mirror", "Keyframe request refused: ${it.message} ($asked asked / ${keyframesEmitted.get()} emitted)")
        }

    }

    /**
     * A keyframe left the encoder. Logged **only when one was asked for**, because the periodic IDRs
     * of an idle stream are not evidence that a request worked — counting those would make the
     * answered figure say yes forever.
     */
    private fun noteKeyframeEmitted() {
        val emitted = keyframesEmitted.incrementAndGet()
        val askedAt = keyframeAskedAtMs.getAndSet(0L)
        if (askedAt == 0L) return
        LinkLog.i(
            "mirror",
            "Keyframe EMITTED ${System.currentTimeMillis() - askedAt}ms after it was asked for " +
                "(${keyframesRequested.get()} asked / $emitted emitted)",
        )
    }

    /** Asked for, emitted, and when the outstanding request went out. The denominators. */
    private val keyframesRequested = java.util.concurrent.atomic.AtomicLong(0)
    private val keyframesEmitted = java.util.concurrent.atomic.AtomicLong(0)
    private val keyframeAskedAtMs = java.util.concurrent.atomic.AtomicLong(0)

    fun currentConfig(): MirrorConfig = config

    fun currentGeometry(): CaptureGeometry = geometry

    /**
     * A snapshot for `mirror.stats`.
     *
     * [EncoderStats.ptsUs] and [EncoderStats.monoUs] describe the same frame, which is the whole
     * point: the Mac subtracts them to place every other frame's PTS on its own clock.
     */
    fun stats(): EncoderStats = EncoderStats(
        encodedFrames = encodedFrames,
        encodedBytes = encodedBytes,
        ptsUs = lastPtsUs,
        monoUs = lastMonoUs,
        lastKeyframeBytes = lastKeyframeBytes,
    )

    fun stop() {
        started.set(false)
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        codec = null
        runCatching { inputSurface?.release() }
        inputSurface = null
        thread?.quitSafely()
        thread = null
    }

    private companion object {
        const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
    }
}

/**
 * Decides whether a run of keyframes is blank enough to mean FLAG_SECURE.
 *
 * Kept separate from [ScreenEncoder] so the threshold is testable without a codec: the whole
 * judgement is "were the last N keyframes all under M bytes".
 */
class BlackFrameDetector(
    private val run: Int = 3,
    /**
     * Twin of `BLANK_KEYFRAME_BYTES` in desktop/src/renderer/mirror.ts, which has to stay equal to
     * it: this decides whether the phone *says* the surface is secure, and that decides whether
     * the Mac may take the sentence explaining it off the canvas.
     */
    private val maxBytes: Int = 2_000,
) {
    private val recent = ArrayDeque<Int>()

    /** @return true when the last [run] keyframes were all blank-sized. */
    fun offer(keyframeSize: Int): Boolean {
        recent.addLast(keyframeSize)
        while (recent.size > run) recent.removeFirst()
        return recent.size == run && recent.all { it < maxBytes }
    }

    fun reset() = recent.clear()
}

/**
 * Decides when to ask the encoder for a keyframe because its output has collapsed to nothing.
 *
 * Defect 23's second half, and the reason it is a class rather than three fields on
 * [ScreenEncoder]: the whole thing is a decision about sizes and elapsed time, and it is worth
 * being able to test it without a codec — the same argument that separated [BlackFrameDetector].
 *
 * **The problem.** [BlackFrameDetector] judges keyframes, because only a keyframe can tell a
 * blanked screen from a still one: both produce delta frames of almost nothing, and only an intra
 * frame carries the whole picture and therefore its emptiness. But a blanked screen is *also* a
 * still screen — Android draws nothing into the VirtualDisplay, so the encoder is fed almost no
 * buffers and emits almost no output, keyframes included. On the hardware run the three keyframes
 * the detector needs took roughly **60 seconds** against a configured interval of
 * [MirrorConfig.keyframeIntervalS] = 2. The blank screen starved the detector that judges
 * blankness, and the user got a black rectangle and no explanation for a minute.
 *
 * **The answer.** A run of blank-sized *delta* frames is not evidence of anything — a still screen
 * with content on it looks identical — but it is a cheap cue to go and take the measurement that
 * is evidence. So this asks for a sync frame, and [BlackFrameDetector] judges the keyframe that
 * comes back, exactly as before.
 *
 * **The cost, bounded on the case where the probe is wasted.** On a still screen with real content
 * the first probe returns a large keyframe and [onKeyframe] then holds the next one off for
 * [backoffMs] — five seconds, longer than the configured keyframe interval, so a still screen
 * costs strictly fewer keyframes than a moving one. On a genuinely blanked screen every probe
 * comes back as a few hundred bytes, so the three the detector needs cost less than one ordinary
 * frame of real video.
 *
 * Every number here is a starting point measured against the 60 seconds, not a tuned one. The log
 * line in [ScreenEncoder.evaluateForSecureSurface] reports the lag actually achieved and the split
 * of probes that found blank against probes that found content, which is what the next choice
 * should be made on.
 */
class BlankProbe(
    /**
     * Consecutive blank-sized non-keyframes that count as "nothing is being drawn".
     *
     * Eight: about 130ms of a 60fps stream, and a good deal longer on the starved one this exists
     * for. Low enough to fire while the user is still looking at the black rectangle; high enough
     * that a couple of still frames between two touches never trigger it.
     */
    private val afterTinyFrames: Int = 8,

    /**
     * Shortest gap between two sync-frame requests. 700ms puts the three keyframes
     * [BlackFrameDetector] needs inside about 2.1 seconds, against the ~60s measured on hardware.
     */
    private val intervalMs: Long = 700,

    /** How long to stop probing after a probe found real content. See the class comment. */
    private val backoffMs: Long = 5_000,

    /** [BlackFrameDetector]'s own threshold, applied to delta frames as a pre-check. */
    private val maxBytes: Int = 2_000,
) {
    private var tinyRun = 0
    private var blankSince = 0L
    private var quietUntil = 0L

    /**
     * One non-keyframe.
     *
     * @return true when a sync frame should be requested now.
     */
    fun offerDelta(size: Int, nowMs: Long): Boolean {
        if (size >= maxBytes) {
            reset()
            return false
        }
        if (tinyRun == 0) blankSince = nowMs
        tinyRun++
        if (tinyRun < afterTinyFrames || nowMs < quietUntil) return false
        quietUntil = nowMs + intervalMs
        return true
    }

    /**
     * One keyframe, whatever asked for it.
     *
     * A large one settles the question the probe was asking — the screen is still, not blanked —
     * so the next probe waits out [backoffMs] rather than firing again in [intervalMs].
     */
    fun onKeyframe(size: Int, nowMs: Long) {
        if (size < maxBytes) return
        reset()
        quietUntil = nowMs + backoffMs
    }

    /**
     * How long the output has been blank-sized, in milliseconds, or -1 when it is not.
     *
     * The denominator for the detection lag: a "secure surface detected" line that does not say
     * how long the user waited for it reads the same whether the wait was 2 seconds or 60.
     */
    fun blankSinceMs(nowMs: Long): Long = if (tinyRun == 0) -1 else nowMs - blankSince

    fun reset() {
        tinyRun = 0
        blankSince = 0L
    }
}

/** One reading of the encoder's counters plus the clock pair that makes PTS meaningful. */
data class EncoderStats(
    val encodedFrames: Long,
    val encodedBytes: Long,
    val ptsUs: Long,
    val monoUs: Long,

    /**
     * Size of the most recent keyframe, in bytes. Not sent on the wire — it exists so the phone's
     * log can show what [BlackFrameDetector] was judging when it did or did not fire.
     */
    val lastKeyframeBytes: Int = 0,
)
