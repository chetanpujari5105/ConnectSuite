package com.chetan.connectsuite.camera.webcam

import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Range
import android.view.Surface
import androidx.core.content.getSystemService
import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.core.link.LinkLog
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Platform failures, mapped to the contract's reasons. Pure: the platform constants are compile-time
 * ints, so `WebcamCaptureMappingsTest` holds the mapping on the JVM.
 */
object WebcamCaptureMappings {
    /** `CameraDevice.StateCallback.onError`'s `error`. */
    fun forDeviceError(error: Int): WebcamStopReason = when (error) {
        CameraDevice.StateCallback.ERROR_CAMERA_IN_USE,
        CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE,
        CameraDevice.StateCallback.ERROR_CAMERA_DISABLED,
        -> WebcamStopReason.CAMERA_IN_USE
        else -> WebcamStopReason.CAMERA_UNAVAILABLE
    }

    /** `CameraAccessException.reason`. */
    fun forAccessException(reason: Int): WebcamStopReason = when (reason) {
        CameraAccessException.CAMERA_DISABLED,
        CameraAccessException.CAMERA_DISCONNECTED,
        CameraAccessException.CAMERA_IN_USE,
        CameraAccessException.MAX_CAMERAS_IN_USE,
        -> WebcamStopReason.CAMERA_IN_USE
        else -> WebcamStopReason.CAMERA_UNAVAILABLE
    }

    /** The encoder settings for one ladder rung — the mirror's justified keys (proposal §8.1). */
    fun encoderFormatValues(rung: WebcamQuality.Rung): Map<String, Int> = mapOf(
        MediaFormat.KEY_BIT_RATE to rung.bitrate,
        MediaFormat.KEY_FRAME_RATE to rung.fps,
        MediaFormat.KEY_I_FRAME_INTERVAL to WebcamQuality.IDR_INTERVAL_S,
        // Without this the encoder may hold frames for a GOP: a webcam that starts seconds late.
        MediaFormat.KEY_LATENCY to 1,
        MediaFormat.KEY_PRIORITY to 0,
        MediaFormat.KEY_COLOR_FORMAT to MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
    )

    /** The AE frame-rate range closest to [fps] that the camera offers, preferring a fixed one. */
    fun fpsRange(available: List<Pair<Int, Int>>, fps: Int): Pair<Int, Int>? =
        available.filter { it.second >= fps }.minWithOrNull(compareBy({ it.second - it.first }, { it.second - fps }))
            ?: available.maxByOrNull { it.second }
}

/**
 * Camera2 straight into MediaCodec — the proposal's **P1** (§8.2): one `CameraCaptureSession` with two
 * outputs, the on-screen preview and the encoder's `createInputSurface()`, which `PRIV PREVIEW + PRIV
 * RECORD` guarantees on every camera device. Zero copies; the CPU never touches a pixel.
 *
 * **Unmeasured.** Nothing here has run on a phone: whether this device holds 1080p/30 on both cameras,
 * the encoder's real output rate, its heat and the preview's aspect are spike S1's readings (a supervised
 * sitting). Every number is a target from [WebcamQuality], and `running` reports the size actually chosen.
 *
 * Threads: Camera2 and the encoder run on their own [HandlerThread]; [open]'s answer is posted to the
 * main thread, where [WebcamCaptureCore] decides whether it is still wanted.
 */
class Camera2WebcamBackend(
    context: Context,
    /** The visible preview's surface, or null when it is not ready — the encoder alone is then the output. */
    private val previewSurface: () -> Surface?,
    /** How the phone is held, from an `OrientationEventListener` (−1 when unknown). */
    private val deviceDegrees: () -> Int,
) : WebcamCaptureBackend {

    private val manager: CameraManager? = context.getSystemService()
    private val thread = HandlerThread("webcam-capture").apply { start() }
    private val handler = Handler(thread.looper)
    private val executor = Executor { handler.post(it) }
    private val main = Handler(Looper.getMainLooper())

    private class Handle(
        val sessionId: String,
        val generation: Int,
        val facing: CameraFacing,
        val width: Int,
        val height: Int,
        val sensorOrientation: Int,
        val timestampsAreBoottime: Boolean,
        val bootMinusMonoUs: Long,
        val codec: MediaCodec,
        val inputSurface: Surface,
    ) {
        val released = AtomicBoolean(false)
        val answered = AtomicBoolean(false)
        @Volatile var device: CameraDevice? = null
        @Volatile var session: CameraCaptureSession? = null
        @Volatile var running = false
    }

    override fun open(sessionId: String, facing: CameraFacing, generation: Int, done: (WebcamCaptureBackend.Outcome) -> Unit) {
        handler.post { openOnCaptureThread(sessionId, facing, generation, done) }
    }

    private fun openOnCaptureThread(sessionId: String, facing: CameraFacing, generation: Int, done: (WebcamCaptureBackend.Outcome) -> Unit) {
        val cameras = manager ?: return main.post {
            done(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_UNAVAILABLE, "no CameraManager"))
        }.let { }
        val (id, chars) = try {
            cameras.cameraIdList.asSequence()
                .map { it to cameras.getCameraCharacteristics(it) }
                .firstOrNull { (_, c) -> c[CameraCharacteristics.LENS_FACING] == lensFacing(facing) }
        } catch (e: CameraAccessException) {
            null
        } ?: return main.post {
            done(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_UNAVAILABLE, "no ${facing.wire} camera"))
        }.let { }

        val map = chars[CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP]
        val sizes = map?.getOutputSizes(MediaCodec::class.java)?.map { WebcamQuality.Size(it.width, it.height) }.orEmpty()
        val ranges = chars[CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES]?.map { it.lower to it.upper }.orEmpty()

        // The ladder at start: the first rung whose size the camera offers AND the encoder configures.
        var chosen: Triple<WebcamQuality.Rung, WebcamQuality.Size, MediaCodec>? = null
        for (rung in WebcamQuality.LADDER) {
            val size = WebcamQuality.choose(rung, sizes) ?: continue
            val codec = try {
                MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).also { c ->
                    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, size.width, size.height)
                    WebcamCaptureMappings.encoderFormatValues(rung).forEach { (k, v) -> format.setInteger(k, v) }
                    c.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                }
            } catch (e: Exception) {
                LinkLog.w("webcam", "Encoder would not configure at ${size} @${rung.fps} (${e.javaClass.simpleName}); next rung")
                null
            } ?: continue
            chosen = Triple(rung, size, codec)
            break
        }
        val (rung, size, codec) = chosen ?: return main.post {
            done(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAPTURE_FAILED, "no ladder rung configured (${sizes.size} camera sizes)"))
        }.let { }
        val inputSurface = codec.createInputSurface()
        val handle = Handle(
            sessionId, generation, facing, size.width, size.height,
            sensorOrientation = chars[CameraCharacteristics.SENSOR_ORIENTATION] ?: 0,
            timestampsAreBoottime = chars[CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE] ==
                CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME,
            bootMinusMonoUs = (SystemClock.elapsedRealtimeNanos() - System.nanoTime()) / 1_000,
            codec = codec,
            inputSurface = inputSurface,
        )
        val answer = { outcome: WebcamCaptureBackend.Outcome ->
            if (handle.answered.compareAndSet(false, true)) main.post { done(outcome) }
        }
        codec.setCallback(encoderCallback(handle), handler)
        // Which encoder and which AE range this phone actually gave us — the encoder spike's reading of
        // the selected configuration against the target (docs/camera-v2-encoder-spike.md). Names only.
        val aeRange = WebcamCaptureMappings.fpsRange(ranges, rung.fps)
        LinkLog.i(
            "webcam",
            "Webcam capture ${sessionId.take(8)}… generation $generation: ${facing.wire} camera $id, $size @${rung.fps} target, " +
                "${rung.bitrate / 1_000_000.0} Mbit/s — the target ${WebcamQuality.TARGET_WIDTH}x${WebcamQuality.TARGET_HEIGHT}@" +
                "${WebcamQuality.TARGET_FPS} is a target, not a measurement; encoder ${codec.name} " +
                "(hardware ${codec.codecInfo.isHardwareAccelerated}), AE range ${aeRange?.let { "${it.first}-${it.second}" } ?: "none offered"}, " +
                "${sizes.size} encoder-capable sizes",
        )
        try {
            cameras.openCamera(id, executor, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    handle.device = device
                    if (handle.released.get()) {
                        device.close()
                        return
                    }
                    val outputs = listOfNotNull(inputSurface, previewSurface())
                    val config = SessionConfiguration(
                        SessionConfiguration.SESSION_REGULAR,
                        outputs.map(::OutputConfiguration),
                        executor,
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                handle.session = session
                                if (handle.released.get()) {
                                    session.close()
                                    return
                                }
                                try {
                                    val request = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                        outputs.forEach(::addTarget)
                                        WebcamCaptureMappings.fpsRange(ranges, rung.fps)?.let { (lo, hi) ->
                                            set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(lo, hi))
                                        }
                                    }.build()
                                    session.setRepeatingRequest(request, null, handler)
                                    codec.start()
                                    handle.running = true
                                    answer(WebcamCaptureBackend.Outcome.Opened(handle, size.width, size.height))
                                } catch (e: Exception) {
                                    release(handle)
                                    answer(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAPTURE_FAILED, "start: ${e.javaClass.simpleName}"))
                                }
                            }

                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                release(handle)
                                answer(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_UNAVAILABLE, "capture session would not configure"))
                            }
                        },
                    )
                    try {
                        device.createCaptureSession(config)
                    } catch (e: Exception) {
                        release(handle)
                        answer(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_UNAVAILABLE, "createCaptureSession: ${e.javaClass.simpleName}"))
                    }
                }

                override fun onDisconnected(device: CameraDevice) {
                    // Another app took the camera, or a policy closed it.
                    lost(handle, WebcamStopReason.CAMERA_IN_USE, "camera disconnected")
                    device.close()
                }

                override fun onError(device: CameraDevice, error: Int) {
                    lost(handle, WebcamCaptureMappings.forDeviceError(error), "camera error $error")
                    device.close()
                }

                private fun lost(h: Handle, reason: WebcamStopReason, why: String) {
                    if (!h.answered.get()) {
                        release(h)
                        answer(WebcamCaptureBackend.Outcome.Failed(reason, why))
                    } else if (!h.released.get()) {
                        LinkLog.w("webcam", "Webcam capture ${h.sessionId.take(8)}… lost: $why")
                        WebcamEngine.captureFailed(h.sessionId, reason)
                    }
                }
            })
        } catch (e: CameraAccessException) {
            release(handle)
            answer(WebcamCaptureBackend.Outcome.Failed(WebcamCaptureMappings.forAccessException(e.reason), "openCamera: reason ${e.reason}"))
        } catch (e: SecurityException) {
            // Permission revoked between the tap and here: the camera did not open.
            release(handle)
            answer(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.PERMISSION_DENIED, "openCamera: no CAMERA permission"))
        } catch (e: Exception) {
            release(handle)
            answer(WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_UNAVAILABLE, "openCamera: ${e.javaClass.simpleName}"))
        }
    }

    private fun encoderCallback(h: Handle) = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = Unit // Surface input.

        override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            try {
                if (!h.released.get() && info.size > 0) {
                    val buffer = codec.getOutputBuffer(index)
                    if (buffer != null) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        val data = ByteArray(info.size).also(buffer::get)
                        WebcamEngine.onEncoded(
                            sessionId = h.sessionId,
                            generation = h.generation,
                            isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0,
                            flaggedKeyframe = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0,
                            data = data,
                            ptsMonotonicUs = WebcamClock.monotonicMicros(info.presentationTimeUs, h.timestampsAreBoottime, h.bootMinusMonoUs),
                            width = h.width,
                            height = h.height,
                            rotation = WebcamOrientation.quarterTurns(h.sensorOrientation, deviceDegrees(), h.facing),
                        )
                    }
                }
                codec.releaseOutputBuffer(index, false)
            } catch (e: IllegalStateException) {
                // Released underneath us during release(); not a failure worth reporting.
            }
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
            if (h.released.get()) return
            LinkLog.w("webcam", "Webcam encoder failed (${if (e.isTransient) "transient" else if (e.isRecoverable) "recoverable" else "fatal"})")
            WebcamEngine.captureFailed(h.sessionId, WebcamStopReason.CAPTURE_FAILED)
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
            LinkLog.i("webcam", "Webcam encoder output format for ${h.sessionId.take(8)}…: $format")
        }
    }

    /** Releases everything [open] made for [handle], once, in order: capture, camera, encoder, surface. */
    override fun release(handle: Any) {
        val h = handle as? Handle ?: return
        if (!h.released.compareAndSet(false, true)) return
        handler.post {
            runCatching { h.session?.stopRepeating() }
            runCatching { h.session?.close() }
            runCatching { h.device?.close() }
            runCatching { if (h.running) h.codec.stop() }
            runCatching { h.codec.release() }
            runCatching { h.inputSurface.release() }
        }
    }

    override fun requestKeyframe(handle: Any) {
        val h = handle as? Handle ?: return
        if (h.released.get()) return
        handler.post {
            runCatching { h.codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) }
        }
    }

    /** Ends the capture thread. Called when the screen goes away, after every handle is released. */
    fun shutdown() {
        handler.post { thread.quitSafely() }
    }

    private fun lensFacing(facing: CameraFacing): Int = when (facing) {
        CameraFacing.FRONT -> CameraCharacteristics.LENS_FACING_FRONT
        CameraFacing.BACK -> CameraCharacteristics.LENS_FACING_BACK
    }
}
