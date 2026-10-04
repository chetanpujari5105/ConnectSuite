package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import java.io.ByteArrayOutputStream

/**
 * The webcam access unit — docs/protocol.md → The webcam access unit. Pure, and held to the golden
 * fixture `docs/fixtures/webcam-au-v1.hex` (the bytes the Mac's Swift reader and Electron main's
 * reader are tested against) and to `docs/fixtures/webcam-phone-stream-v1.hex`, which this writer
 * produced from real H.264 and the Swift bridge decodes.
 *
 * ```
 * frame header (13): flags (bit 0 IDR, bit 1 SPS+PPS) · PTS µs u64 · payload length u32
 * webcam header (16): version 1 · codec 1 · facing · rotation · flags (bit 0 discontinuity) · 0 ·
 *                     generation u16 · width u16 · height u16 · sequence u32
 * then the AU, H.264 Annex B
 * ```
 */
object WebcamAuCodec {
    const val FRAME_HEADER_BYTES = 13
    const val WEBCAM_HEADER_BYTES = 16

    /** `WEBCAM_MAX_AU`: the payload (webcam header plus Annex B), not counting the frame header. */
    const val MAX_PAYLOAD = 2 * 1024 * 1024

    /** The header, a 4-byte start code and one NAL header byte. */
    const val MIN_PAYLOAD = WEBCAM_HEADER_BYTES + 5
    const val VERSION = 1
    const val CODEC_H264_ANNEX_B = 1
    const val FLAG_IDR = 0x01
    const val FLAG_CONFIG = 0x02
    const val MIN_DIMENSION = 16
    const val MAX_DIMENSION = 3840

    /** Where the webcam header's flags byte sits in a whole frame. */
    const val DISCONTINUITY_OFFSET = FRAME_HEADER_BYTES + 4

    const val NAL_IDR = 5
    const val NAL_SPS = 7
    const val NAL_PPS = 8

    data class Header(
        val facing: CameraFacing,
        /** Quarter turns clockwise that make the picture upright, 0..3. */
        val rotation: Int,
        val discontinuity: Boolean,
        val generation: Int,
        /** Coded size, before rotation. */
        val width: Int,
        val height: Int,
        val sequence: Long,
    )

    /**
     * One whole frame, or null when the payload would exceed [MAX_PAYLOAD] — counted by the caller as
     * oversize and never sent. The frame-header flags are **derived from the NAL units**, so nothing
     * built on this can claim an IDR or SPS/PPS it does not carry.
     *
     * Throws for values the contract does not allow (odd or out-of-range dimensions, a generation of 0,
     * a rotation outside 0..3, an AU without a start code): those are bugs in the caller, not inputs.
     */
    fun encode(header: Header, ptsMicros: Long, annexB: ByteArray): ByteArray? {
        require(header.rotation in 0..3) { "rotation ${header.rotation}" }
        require(header.generation in 1..0xFFFF) { "generation ${header.generation}" }
        require(validDimension(header.width) && validDimension(header.height)) { "size ${header.width}x${header.height}" }
        require(header.sequence in 0..0xFFFF_FFFFL) { "sequence ${header.sequence}" }
        val types = nalTypes(annexB) ?: throw IllegalArgumentException("the AU does not begin with a start code")
        val payload = WEBCAM_HEADER_BYTES + annexB.size
        if (payload > MAX_PAYLOAD) return null
        var flags = 0
        if (NAL_IDR in types) flags = flags or FLAG_IDR
        if (NAL_SPS in types && NAL_PPS in types) flags = flags or FLAG_CONFIG
        val out = ByteArray(FRAME_HEADER_BYTES + payload)
        var i = 0
        out[i++] = flags.toByte()
        for (shift in 56 downTo 0 step 8) out[i++] = (ptsMicros ushr shift).toByte()
        for (shift in 24 downTo 0 step 8) out[i++] = (payload ushr shift).toByte()
        out[i++] = VERSION.toByte()
        out[i++] = CODEC_H264_ANNEX_B.toByte()
        out[i++] = header.facing.headerByte.toByte()
        out[i++] = header.rotation.toByte()
        out[i++] = (if (header.discontinuity) 0x01 else 0x00).toByte()
        out[i++] = 0
        out[i++] = (header.generation ushr 8).toByte(); out[i++] = header.generation.toByte()
        out[i++] = (header.width ushr 8).toByte(); out[i++] = header.width.toByte()
        out[i++] = (header.height ushr 8).toByte(); out[i++] = header.height.toByte()
        for (shift in 24 downTo 0 step 8) out[i++] = (header.sequence ushr shift).toByte()
        System.arraycopy(annexB, 0, out, i, annexB.size)
        return out
    }

    /** Sets the discontinuity bit of a whole frame [encode] produced: AUs were dropped before this one. */
    fun markDiscontinuity(frame: ByteArray) {
        frame[DISCONTINUITY_OFFSET] = (frame[DISCONTINUITY_OFFSET].toInt() or 0x01).toByte()
    }

    fun validDimension(v: Int): Boolean = v in MIN_DIMENSION..MAX_DIMENSION && v % 2 == 0

    /** The NAL unit types of an Annex B buffer, in order, or null when it does not begin with a start code. */
    fun nalTypes(annexB: ByteArray): List<Int>? = nalUnits(annexB)?.mapNotNull { (start, end) ->
        if (start < end) annexB[start].toInt() and 0x1F else null
    }

    /** The NAL units' `[start, end)` ranges, start codes excluded; null without a leading start code. */
    fun nalUnits(b: ByteArray): List<Pair<Int, Int>>? {
        if (startCodeLength(b, 0) == 0) return null
        val units = mutableListOf<Pair<Int, Int>>()
        var i = 0
        var start = -1
        while (i < b.size) {
            val sc = startCodeLength(b, i)
            if (sc > 0) {
                if (start >= 0) units += start to i
                i += sc
                start = i
            } else {
                i++
            }
        }
        if (start in 0 until b.size) units += start to b.size
        return units.filter { (s, e) -> s < e }
    }

    private fun startCodeLength(b: ByteArray, i: Int): Int = when {
        i + 3 < b.size && b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 0 && b[i + 3].toInt() == 1 -> 4
        i + 2 < b.size && b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1 -> 3
        else -> 0
    }
}

/**
 * MediaCodec's output buffers, turned into access units the contract allows.
 *
 * An Android H.264 encoder hands its SPS and PPS **once**, in a buffer flagged `BUFFER_FLAG_CODEC_CONFIG`,
 * and its IDRs without them — while the contract requires SPS and PPS in every AU that carries an IDR,
 * because the Mac may join, or recover from a drop, at any IDR. So the configuration is held here (a few
 * dozen bytes, the one thing this holds across buffers) and prepended to every IDR that lacks it. A new
 * configuration — a new encoder after a switch or a ladder step — replaces it.
 *
 * Decided by the NAL units, never by `BUFFER_FLAG_KEY_FRAME` alone: a flag disagreeing with the bytes is
 * counted ([flagMismatches]) and the bytes win. An IDR arriving with no configuration ever seen cannot be
 * made valid and is dropped, counted ([idrWithoutConfig]); the caller asks for another.
 */
class WebcamAuAssembler {
    sealed interface Result {
        /** A configuration buffer was stored; nothing to send. */
        data object ConfigStored : Result

        data class Unit(val annexB: ByteArray, val keyframe: Boolean) : Result

        /** Dropped, with why: no start code, an empty buffer, a bad configuration, or an IDR without one. */
        data class Dropped(val why: String) : Result
    }

    private var config: ByteArray? = null

    var configs = 0L
        private set
    var units = 0L
        private set
    var keyframes = 0L
        private set
    var idrWithoutConfig = 0L
        private set
    var flagMismatches = 0L
        private set
    var dropped = 0L
        private set

    /** Forgets the stored configuration: a new encoder brings its own. */
    fun reset() {
        config = null
    }

    fun offer(isConfig: Boolean, flaggedKeyframe: Boolean, data: ByteArray): Result {
        val types = WebcamAuCodec.nalTypes(data)
        if (data.isEmpty() || types == null || types.isEmpty()) {
            dropped++
            return Result.Dropped(if (data.isEmpty()) "empty buffer" else "no Annex B start code")
        }
        val hasSps = WebcamAuCodec.NAL_SPS in types
        val hasPps = WebcamAuCodec.NAL_PPS in types
        if (isConfig) {
            if (!hasSps || !hasPps) {
                dropped++
                return Result.Dropped("a configuration buffer without both SPS and PPS")
            }
            config = data.copyOf()
            configs++
            return Result.ConfigStored
        }
        val idr = WebcamAuCodec.NAL_IDR in types
        if (idr != flaggedKeyframe) flagMismatches++
        val annexB = if (idr && !(hasSps && hasPps)) {
            val c = config ?: run {
                idrWithoutConfig++
                dropped++
                return Result.Dropped("an IDR with no SPS and PPS seen yet")
            }
            ByteArrayOutputStream(c.size + data.size).apply { write(c); write(data) }.toByteArray()
        } else {
            data
        }
        units++
        if (idr) keyframes++
        return Result.Unit(annexB, keyframe = idr)
    }
}

/** The header's PTS clock. */
object WebcamClock {
    /**
     * The header carries CLOCK_MONOTONIC µs — the `pong` `monoUs` clock (`System.nanoTime`). A Camera2
     * surface stamps buffers with the sensor timestamp, which is CLOCK_MONOTONIC when
     * `SENSOR_INFO_TIMESTAMP_SOURCE` is `UNKNOWN` and CLOCK_BOOTTIME when it is `REALTIME`; the encoder
     * passes it through as `presentationTimeUs`. [bootMinusMonoUs] is
     * `(SystemClock.elapsedRealtimeNanos() - System.nanoTime()) / 1000`, read once per session.
     */
    fun monotonicMicros(presentationTimeUs: Long, sourceIsRealtime: Boolean, bootMinusMonoUs: Long): Long =
        if (sourceIsRealtime) presentationTimeUs - bootMinusMonoUs else presentationTimeUs
}

/** The header's rotation byte. */
object WebcamOrientation {
    /**
     * Quarter turns clockwise that make the camera's picture upright, from the sensor's mounting
     * ([sensorOrientation], `CameraCharacteristics.SENSOR_ORIENTATION`) and how the phone is held
     * ([deviceDegrees], an `OrientationEventListener` reading, or `ORIENTATION_UNKNOWN` = -1, read as 0).
     *
     * The JPEG-orientation formula, because it is defined on the **unmirrored** sensor image, which is
     * what the webcam sends (docs/protocol.md: the front camera is sent unmirrored):
     * back `(sensor − device) mod 360`, front `(sensor + device) mod 360`.
     */
    fun quarterTurns(sensorOrientation: Int, deviceDegrees: Int, facing: CameraFacing): Int {
        val device = if (deviceDegrees < 0) 0 else ((deviceDegrees + 45) / 90 * 90) % 360
        val degrees = when (facing) {
            CameraFacing.BACK -> (sensorOrientation - device + 360) % 360
            CameraFacing.FRONT -> (sensorOrientation + device) % 360
        }
        return degrees / 90
    }
}

/**
 * The quality ladder (proposal §8.3) and the size chooser. **Every value here is a target**: nothing has
 * measured what this phone's encoder holds, and `running` reports the size actually chosen beside it.
 */
object WebcamQuality {
    const val TARGET_WIDTH = 1920
    const val TARGET_HEIGHT = 1080
    const val TARGET_FPS = 30

    /** The periodic IDR interval the contract names as a target: a Mac-side drop recovers at the next one. */
    const val IDR_INTERVAL_S = 2

    data class Size(val width: Int, val height: Int) {
        val area: Int get() = width * height
        val is16by9: Boolean get() = width * 9 == height * 16
        override fun toString(): String = "${width}x$height"
    }

    data class Rung(val size: Size, val fps: Int, val bitrate: Int)

    val LADDER: List<Rung> = listOf(
        Rung(Size(1920, 1080), 30, 8_000_000),
        Rung(Size(1280, 720), 30, 4_000_000),
        Rung(Size(1280, 720), 24, 3_000_000),
        Rung(Size(960, 540), 15, 1_500_000),
    )

    /**
     * The size to capture and encode for [rung], from what the camera can deliver to an encoder
     * ([supported], landscape sizes as `StreamConfigurationMap.getOutputSizes(MediaCodec::class.java)`
     * lists them). The largest 16:9 size no larger than the rung; failing that, the largest size of any
     * aspect no larger than it; never an odd or out-of-range dimension. Null when nothing fits.
     */
    fun choose(rung: Rung, supported: List<Size>): Size? {
        val usable = supported.filter {
            WebcamAuCodec.validDimension(it.width) && WebcamAuCodec.validDimension(it.height) &&
                it.width <= rung.size.width && it.height <= rung.size.height
        }
        return usable.filter { it.is16by9 }.maxByOrNull { it.area } ?: usable.maxByOrNull { it.area }
    }
}
