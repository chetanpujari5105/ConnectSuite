package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * The phone's access-unit writer against the cross-language golden fixture, the MediaCodec-buffer
 * assembler, and the header's clock, rotation and size rules. Pure; no Android, no encoder — the
 * Annex B here is the fixture's 3-byte NAL stand-ins and hand-built buffers, **not** encoder output.
 * Real H.264 is `WebcamPhoneStreamFixtureTest`'s.
 */
class WebcamAuTest {

    companion object {
        fun hexFixture(name: String): ByteArray {
            val text = listOf("../docs/fixtures/$name", "docs/fixtures/$name").map(::File).first { it.isFile }.readLines()
                .filterNot { it.startsWith("#") }
                .joinToString("")
                .filter { it.isLetterOrDigit() }
            return ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        }

        val SPS = byteArrayOf(0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1f)
        val PPS = byteArrayOf(0, 0, 0, 1, 0x68, 0xce.toByte(), 0x3c, 0x80.toByte())
        val IDR = byteArrayOf(0, 0, 0, 1, 0x65, 0x88.toByte(), 0x84.toByte(), 0x00)
        val P = byteArrayOf(0, 0, 0, 1, 0x41, 0x9a.toByte(), 0x02, 0x03)
    }

    private val goldenHeader = WebcamAuCodec.Header(
        facing = CameraFacing.FRONT, rotation = 3, discontinuity = false, generation = 7,
        width = 1920, height = 1080, sequence = 0x01020304,
    )

    @Test
    fun `the writer produces the golden access unit byte for byte`() {
        val golden = hexFixture("webcam-au-v1.hex")
        assertEquals("the fixture is what its comment says", 13 + 40, golden.size)
        val written = WebcamAuCodec.encode(goldenHeader, 0x0102030405060708L, SPS + PPS + IDR)
        assertArrayEquals(golden, written)
    }

    @Test
    fun `the frame flags come from the NAL units, never from the caller`() {
        val p = WebcamAuCodec.encode(goldenHeader, 1, P)!!
        assertEquals(0, p[0].toInt())
        val idrOnly = WebcamAuCodec.encode(goldenHeader, 1, IDR)!!
        assertEquals(WebcamAuCodec.FLAG_IDR, idrOnly[0].toInt())
        val full = WebcamAuCodec.encode(goldenHeader, 1, SPS + PPS + IDR)!!
        assertEquals(WebcamAuCodec.FLAG_IDR or WebcamAuCodec.FLAG_CONFIG, full[0].toInt())
    }

    @Test
    fun `discontinuity is one bit in the webcam header, and nothing else moves`() {
        val plain = WebcamAuCodec.encode(goldenHeader, 1, P)!!
        val marked = plain.copyOf().also(WebcamAuCodec::markDiscontinuity)
        assertEquals(1, marked[13 + 4].toInt())
        assertArrayEquals(WebcamAuCodec.encode(goldenHeader.copy(discontinuity = true), 1, P), marked)
        assertEquals(plain.size, marked.size)
        assertEquals(1, (0 until plain.size).count { plain[it] != marked[it] })
    }

    @Test
    fun `values the contract forbids are refused - and an oversized AU is a counted null, not a frame`() {
        val bad = listOf(
            goldenHeader.copy(width = 1921), goldenHeader.copy(height = 14), goldenHeader.copy(width = 3842),
            goldenHeader.copy(generation = 0), goldenHeader.copy(generation = 65536), goldenHeader.copy(rotation = 4),
        )
        for (h in bad) {
            try {
                WebcamAuCodec.encode(h, 1, P)
                fail("accepted $h")
            } catch (_: IllegalArgumentException) {
            }
        }
        try {
            WebcamAuCodec.encode(goldenHeader, 1, byteArrayOf(1, 2, 3, 4, 5))
            fail("accepted an AU without a start code")
        } catch (_: IllegalArgumentException) {
        }
        val atCap = ByteArray(WebcamAuCodec.MAX_PAYLOAD - WebcamAuCodec.WEBCAM_HEADER_BYTES).also { System.arraycopy(P, 0, it, 0, P.size) }
        assertEquals(13 + WebcamAuCodec.MAX_PAYLOAD, WebcamAuCodec.encode(goldenHeader, 1, atCap)!!.size)
        assertNull(WebcamAuCodec.encode(goldenHeader, 1, atCap + byteArrayOf(0)))
    }

    // ---- the assembler ------------------------------------------------------------------------

    @Test
    fun `MediaCodec's separate configuration is prepended to every IDR, and P-frames pass untouched`() {
        val a = WebcamAuAssembler()
        assertEquals(WebcamAuAssembler.Result.ConfigStored, a.offer(isConfig = true, flaggedKeyframe = false, data = SPS + PPS))
        val first = a.offer(false, true, IDR) as WebcamAuAssembler.Result.Unit
        assertArrayEquals(SPS + PPS + IDR, first.annexB)
        assertTrue(first.keyframe)
        val p = a.offer(false, false, P) as WebcamAuAssembler.Result.Unit
        assertArrayEquals(P, p.annexB)
        // The periodic IDR, which MediaCodec sends without SPS/PPS: they are prepended again.
        val periodic = a.offer(false, true, IDR) as WebcamAuAssembler.Result.Unit
        assertArrayEquals(SPS + PPS + IDR, periodic.annexB)
        assertEquals(listOf(7, 8, 5), WebcamAuCodec.nalTypes(periodic.annexB))
        // An encoder that already prepends them is not given a second copy.
        val inline = a.offer(false, true, SPS + PPS + IDR) as WebcamAuAssembler.Result.Unit
        assertArrayEquals(SPS + PPS + IDR, inline.annexB)
        assertEquals(1L, a.configs)
        assertEquals(4L, a.units)
        assertEquals(3L, a.keyframes)
    }

    @Test
    fun `an IDR before any configuration is dropped and counted - it could never satisfy the contract`() {
        val a = WebcamAuAssembler()
        assertTrue(a.offer(false, true, IDR) is WebcamAuAssembler.Result.Dropped)
        assertEquals(1L, a.idrWithoutConfig)
        assertTrue(a.offer(true, false, SPS) is WebcamAuAssembler.Result.Dropped) // no PPS
        assertTrue(a.offer(false, false, byteArrayOf(9, 9, 9)) is WebcamAuAssembler.Result.Dropped)
        assertTrue(a.offer(false, false, ByteArray(0)) is WebcamAuAssembler.Result.Dropped)
        assertEquals(4L, a.dropped)
        a.offer(true, false, SPS + PPS)
        a.reset()
        assertTrue("a new encoder brings its own", a.offer(false, true, IDR) is WebcamAuAssembler.Result.Dropped)
    }

    @Test
    fun `the NAL units decide, and a flag that disagrees is counted`() {
        val a = WebcamAuAssembler()
        a.offer(true, false, SPS + PPS)
        val unflaggedIdr = a.offer(false, flaggedKeyframe = false, data = IDR) as WebcamAuAssembler.Result.Unit
        assertTrue(unflaggedIdr.keyframe)
        val flaggedP = a.offer(false, flaggedKeyframe = true, data = P) as WebcamAuAssembler.Result.Unit
        assertTrue(!flaggedP.keyframe)
        assertEquals(2L, a.flagMismatches)
    }

    @Test
    fun `NAL scanning takes 3- and 4-byte start codes`() {
        assertEquals(listOf(7, 8, 5), WebcamAuCodec.nalTypes(byteArrayOf(0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 1, 0x65, 3)))
        assertNull(WebcamAuCodec.nalTypes(byteArrayOf(1, 0, 0, 1, 0x65)))
    }

    // ---- clock, rotation, size ----------------------------------------------------------------

    @Test
    fun `the PTS is CLOCK_MONOTONIC - a boottime sensor clock is converted, a monotonic one is not`() {
        assertEquals(5_000_000L, WebcamClock.monotonicMicros(5_000_000L, sourceIsRealtime = false, bootMinusMonoUs = 777))
        assertEquals(4_999_223L, WebcamClock.monotonicMicros(5_000_000L, sourceIsRealtime = true, bootMinusMonoUs = 777))
    }

    @Test
    fun `rotation - the quarter turns that make the unmirrored picture upright, for both cameras`() {
        // A typical phone: back sensor mounted at 90, front at 270.
        assertEquals(1, WebcamOrientation.quarterTurns(90, 0, CameraFacing.BACK))
        assertEquals(0, WebcamOrientation.quarterTurns(90, 90, CameraFacing.BACK))
        assertEquals(2, WebcamOrientation.quarterTurns(90, 270, CameraFacing.BACK))
        assertEquals(3, WebcamOrientation.quarterTurns(270, 0, CameraFacing.FRONT))
        assertEquals(0, WebcamOrientation.quarterTurns(270, 90, CameraFacing.FRONT))
        // Rounded to the nearest quarter, and an unknown reading is upright.
        assertEquals(0, WebcamOrientation.quarterTurns(90, 80, CameraFacing.BACK))
        assertEquals(1, WebcamOrientation.quarterTurns(90, -1, CameraFacing.BACK))
        assertEquals(1, WebcamOrientation.quarterTurns(90, 350, CameraFacing.BACK))
        for (s in listOf(0, 90, 180, 270)) for (d in 0..359 step 15) for (f in CameraFacing.entries) {
            assertTrue(WebcamOrientation.quarterTurns(s, d, f) in 0..3)
        }
    }

    @Test
    fun `the selected size is what the camera offers under the rung, never the target by assumption`() {
        val s = { w: Int, h: Int -> WebcamQuality.Size(w, h) }
        val rung0 = WebcamQuality.LADDER[0]
        assertEquals(s(1920, 1080), WebcamQuality.choose(rung0, listOf(s(4000, 3000), s(1920, 1080), s(1280, 720))))
        // No 1080p offered: the largest 16:9 under it, reported as such.
        assertEquals(s(1280, 720), WebcamQuality.choose(rung0, listOf(s(4000, 3000), s(1440, 1080), s(1280, 720))))
        // No 16:9 at all: the largest that fits.
        assertEquals(s(1440, 1080), WebcamQuality.choose(rung0, listOf(s(4000, 3000), s(1440, 1080), s(640, 480))))
        // Odd dimensions are never chosen.
        assertEquals(s(1280, 720), WebcamQuality.choose(rung0, listOf(s(1919, 1079), s(1280, 720))))
        assertNull(WebcamQuality.choose(WebcamQuality.LADDER.last(), listOf(s(4000, 3000))))
        assertEquals(listOf(1920 to 1080, 1280 to 720, 1280 to 720, 960 to 540), WebcamQuality.LADDER.map { it.size.width to it.size.height })
        assertEquals(30, WebcamQuality.TARGET_FPS)
        assertEquals(2, WebcamQuality.IDR_INTERVAL_S)
    }
}
