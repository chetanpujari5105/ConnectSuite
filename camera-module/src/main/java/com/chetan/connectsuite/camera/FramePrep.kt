package com.chetan.connectsuite.camera

import java.nio.ByteBuffer

/**
 * CameraX's `YUV_420_888` planes as one NV21 buffer, for `YuvImage.compressToJpeg`.
 *
 * Pure and Android-free: it takes the three planes as [ByteBuffer]s with their strides, which is
 * exactly what `ImageProxy.PlaneProxy` hands over, so the JVM test feeds it synthetic planes with
 * the awkward strides real devices use (row padding, interleaved chroma) and checks every byte.
 *
 * NV21 is the full-resolution Y plane followed by **V then U**, interleaved, at quarter resolution —
 * the one layout `YuvImage` takes for JPEG that every Android device supports.
 */
object Nv21 {

    /** One plane as CameraX describes it. The buffer is read by absolute index and never moved. */
    data class Plane(val buffer: ByteBuffer, val rowStride: Int, val pixelStride: Int)

    fun sizeFor(width: Int, height: Int): Int = width * height + 2 * ((width / 2) * (height / 2))

    /**
     * Converts into [out] when it is the right size (the analyzer reuses one buffer per stream), or
     * into a new array. Width and height must be even: a 4:2:0 camera stream always is.
     */
    fun fromYuv420(width: Int, height: Int, y: Plane, u: Plane, v: Plane, out: ByteArray? = null): ByteArray {
        require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0) { "size ${width}x$height" }
        val size = sizeFor(width, height)
        val dst = if (out != null && out.size == size) out else ByteArray(size)

        // Luma: row by row, a bulk copy when the pixels are packed — which they almost always are.
        var o = 0
        val yBuf = y.buffer.duplicate()
        for (row in 0 until height) {
            val rowStart = row * y.rowStride
            if (y.pixelStride == 1) {
                yBuf.position(rowStart)
                yBuf.get(dst, o, width)
                o += width
            } else {
                for (col in 0 until width) dst[o++] = y.buffer.get(rowStart + col * y.pixelStride)
            }
        }

        // Chroma: V then U for each 2x2 block.
        val chromaHeight = height / 2
        val chromaWidth = width / 2
        for (row in 0 until chromaHeight) {
            val vRow = row * v.rowStride
            val uRow = row * u.rowStride
            for (col in 0 until chromaWidth) {
                dst[o++] = v.buffer.get(vRow + col * v.pixelStride)
                dst[o++] = u.buffer.get(uRow + col * u.pixelStride)
            }
        }
        return dst
    }
}

/**
 * The 15 fps cap — docs/protocol.md → *Frames are dropped, never queued*.
 *
 * CameraX analysis runs at the camera's own rate, typically 30 fps. Admitting a frame when at least
 * 90% of the target interval has passed rather than 100% is deliberate: frames arrive with jitter,
 * and a strict `>=` against 66.7 ms from a 30 fps source rejects the frame at 66.4 ms and admits the
 * next at 100 ms — 10 fps from a cap of 15. The tolerance takes every other frame of a 30 fps source,
 * which is the rate the cap names.
 *
 * Pure: the clock is an argument, so the test drives it with a 30 fps sequence and counts.
 */
class FramePacer(maxFps: Int) {
    private val minIntervalNanos: Long = (1_000_000_000L / maxFps) * 9 / 10
    private var lastAdmittedNanos: Long = Long.MIN_VALUE

    /** True when the frame stamped [nowNanos] should be encoded and offered. */
    fun admit(nowNanos: Long): Boolean {
        if (lastAdmittedNanos != Long.MIN_VALUE && nowNanos - lastAdmittedNanos < minIntervalNanos) return false
        lastAdmittedNanos = nowNanos
        return true
    }
}
