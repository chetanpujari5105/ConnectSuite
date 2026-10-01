package com.chetan.connectsuite.camera

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

/**
 * The NV21 converter and the frame pacer, with generated input only — no camera, no personal media.
 */
class FramePrepTest {

    /** A 4x4 frame whose every sample is distinct, so a misplaced byte is a visible wrong value. */
    private val width = 4
    private val height = 4
    private fun y(row: Int, col: Int) = (10 + row * 4 + col).toByte()
    private fun u(row: Int, col: Int) = (100 + row * 2 + col).toByte()
    private fun v(row: Int, col: Int) = (200 + row * 2 + col).toByte()

    /** What NV21 must be: all of Y, then V,U per 2x2 block. Written from the definition, not the code. */
    private fun expected(): ByteArray {
        val out = mutableListOf<Byte>()
        for (r in 0 until height) for (c in 0 until width) out += y(r, c)
        for (r in 0 until height / 2) for (c in 0 until width / 2) {
            out += v(r, c)
            out += u(r, c)
        }
        return out.toByteArray()
    }

    /** A plane with [rowStride] (padding after each row) and [pixelStride] (gaps between samples). */
    private fun plane(rows: Int, cols: Int, rowStride: Int, pixelStride: Int, value: (Int, Int) -> Byte): Nv21.Plane {
        val buffer = ByteArray(rowStride * rows) { 0x7F }
        for (r in 0 until rows) for (c in 0 until cols) buffer[r * rowStride + c * pixelStride] = value(r, c)
        return Nv21.Plane(ByteBuffer.wrap(buffer), rowStride, pixelStride)
    }

    @Test
    fun `packed planar input converts exactly`() {
        val out = Nv21.fromYuv420(
            width, height,
            y = plane(4, 4, 4, 1, ::y),
            u = plane(2, 2, 2, 1, ::u),
            v = plane(2, 2, 2, 1, ::v),
        )
        assertArrayEquals(expected(), out)
    }

    @Test
    fun `padded rows and interleaved chroma, the way real devices hand them over, convert exactly`() {
        val out = Nv21.fromYuv420(
            width, height,
            y = plane(4, 4, rowStride = 8, pixelStride = 1, value = ::y),
            u = plane(2, 2, rowStride = 8, pixelStride = 2, value = ::u),
            v = plane(2, 2, rowStride = 8, pixelStride = 2, value = ::v),
        )
        assertArrayEquals(expected(), out)
        // The padding byte 0x7F must never leak into the output.
        assertTrue(out.none { it == 0x7F.toByte() })
    }

    @Test
    fun `a luma plane with a pixel stride converts exactly`() {
        val out = Nv21.fromYuv420(
            width, height,
            y = plane(4, 4, rowStride = 8, pixelStride = 2, value = ::y),
            u = plane(2, 2, 2, 1, ::u),
            v = plane(2, 2, 2, 1, ::v),
        )
        assertArrayEquals(expected(), out)
    }

    @Test
    fun `a right-sized buffer is reused rather than reallocated per frame`() {
        val reuse = ByteArray(Nv21.sizeFor(width, height))
        val out = Nv21.fromYuv420(width, height, plane(4, 4, 4, 1, ::y), plane(2, 2, 2, 1, ::u), plane(2, 2, 2, 1, ::v), reuse)
        assertSame(reuse, out)
        assertEquals(24, Nv21.sizeFor(4, 4))
    }

    @Test
    fun `the pacer takes every other frame of a 30 fps source — 15 a second`() {
        val pacer = FramePacer(15)
        val frameNanos = 1_000_000_000L / 30
        // Two seconds of 30 fps with ±2 ms of jitter on every other frame.
        val admitted = (0 until 60).count { i ->
            val jitter = if (i % 2 == 0) 0L else 2_000_000L * (if (i % 4 == 1) 1 else -1)
            pacer.admit(i * frameNanos + jitter)
        }
        assertEquals(30, admitted)
    }

    @Test
    fun `the pacer caps a 60 fps source at 15`() {
        val pacer = FramePacer(15)
        val admitted = (0 until 120).count { pacer.admit(it * (1_000_000_000L / 60)) }
        assertEquals(30, admitted)
    }

    @Test
    fun `the pacer admits a slow source untouched`() {
        val pacer = FramePacer(15)
        assertEquals(10, (0 until 10).count { pacer.admit(it * 200_000_000L) })
    }
}
