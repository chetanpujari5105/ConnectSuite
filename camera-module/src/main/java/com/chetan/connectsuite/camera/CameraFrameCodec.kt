package com.chetan.connectsuite.camera

import com.chetan.connectsuite.core.protocol.Link

/**
 * One camera frame on the wire — docs/protocol.md → The camera frame.
 *
 * ```
 * 13-byte frame header   flags (bit 0 keyframe, always set) · PTS µs u64 BE · length u32 BE
 * 16-byte camera header  version · format · facing · rotation · flags · epoch ·
 *                        width u16 · height u16 · sequence u32 · reserved u16
 * JPEG                   starts FF D8
 * ```
 *
 * Pure and Android-free. The cross-language golden vector in `docs/fixtures/camera-frame-v1.hex` is
 * asserted against [encode] here and against the Mac's parser in `cameraFrame.test.ts`, so the two
 * ends are held to one byte sequence rather than to two readings of a table.
 */
object CameraFrameCodec {
    const val FRAME_HEADER_BYTES = 13
    const val CAMERA_HEADER_BYTES = 16
    const val VERSION = 1
    const val FORMAT_JPEG = 1
    const val FLAG_KEYFRAME = 0x01
    const val FLAG_MIRROR = 0x01

    /** The largest edge the Mac accepts. A 720p target never approaches it. */
    const val MAX_EDGE = 4096

    /** Everything the camera header says about one frame. */
    data class Meta(
        val facing: CameraFacing,
        /** Quarter turns clockwise that make the picture upright, 0..3. */
        val rotationQuarterTurns: Int,
        /** Mirror the upright picture left-to-right for display — the front-camera convention. */
        val mirrored: Boolean,
        /** Increments with every switch, wraps at 256. */
        val epoch: Int,
        val width: Int,
        val height: Int,
        /** +1 for every frame produced in this stream; a gap on the Mac is a dropped frame. */
        val sequence: Long,
    )

    /**
     * The whole frame as written to the socket, or **null when it would exceed
     * [Link.CAMERA_MAX_FRAME]** — an oversize frame is counted and dropped by the caller, never sent,
     * so the Mac's reader never sees a length it must reject.
     *
     * Everything else is a programming error on the phone and throws: a rotation of 5 or a JPEG that
     * does not start `FF D8` is not a frame to send with a flag on it.
     */
    fun encode(meta: Meta, ptsUs: Long, jpeg: ByteArray): ByteArray? {
        require(meta.rotationQuarterTurns in 0..3) { "rotation ${meta.rotationQuarterTurns} is not 0..3" }
        require(meta.width in 1..MAX_EDGE && meta.height in 1..MAX_EDGE) { "size ${meta.width}x${meta.height}" }
        require(meta.epoch in 0..255) { "epoch ${meta.epoch} is not a byte" }
        require(meta.sequence in 0..0xFFFF_FFFFL) { "sequence ${meta.sequence} is not a u32" }
        require(ptsUs >= 0) { "negative PTS" }
        require(jpeg.size >= 2 && jpeg[0] == 0xFF.toByte() && jpeg[1] == 0xD8.toByte()) { "not a JPEG" }

        val payloadLength = CAMERA_HEADER_BYTES + jpeg.size
        if (payloadLength > Link.CAMERA_MAX_FRAME) return null

        val out = ByteArray(FRAME_HEADER_BYTES + payloadLength)
        out[0] = FLAG_KEYFRAME.toByte()
        putLong(out, 1, ptsUs)
        putInt(out, 9, payloadLength)

        val h = FRAME_HEADER_BYTES
        out[h + 0] = VERSION.toByte()
        out[h + 1] = FORMAT_JPEG.toByte()
        out[h + 2] = meta.facing.headerByte.toByte()
        out[h + 3] = meta.rotationQuarterTurns.toByte()
        out[h + 4] = (if (meta.mirrored) FLAG_MIRROR else 0).toByte()
        out[h + 5] = meta.epoch.toByte()
        putShort(out, h + 6, meta.width)
        putShort(out, h + 8, meta.height)
        putInt(out, h + 10, meta.sequence.toInt())
        // h + 14, h + 15: reserved, zero.
        System.arraycopy(jpeg, 0, out, h + CAMERA_HEADER_BYTES, jpeg.size)
        return out
    }

    /** CameraX's `rotationDegrees` (0, 90, 180, 270) as the header's quarter turns. */
    fun quarterTurns(rotationDegrees: Int): Int = (((rotationDegrees % 360) + 360) % 360) / 90

    private fun putLong(out: ByteArray, at: Int, value: Long) {
        var v = value
        for (i in 7 downTo 0) {
            out[at + i] = (v and 0xFF).toByte()
            v = v ushr 8
        }
    }

    private fun putInt(out: ByteArray, at: Int, value: Int) {
        out[at] = (value ushr 24).toByte()
        out[at + 1] = (value ushr 16).toByte()
        out[at + 2] = (value ushr 8).toByte()
        out[at + 3] = value.toByte()
    }

    private fun putShort(out: ByteArray, at: Int, value: Int) {
        out[at] = (value ushr 8).toByte()
        out[at + 1] = value.toByte()
    }
}
