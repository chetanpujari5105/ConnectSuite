package com.chetan.connectsuite.link

import com.chetan.connectsuite.core.link.PairingQrPayload
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The phone's QR decode path, as the camera analyzer calls it: a luminance plane with a row stride, no
 * rotation applied (QR finder patterns are rotation-invariant).
 *
 * **The input comes from outside the instrument.** The fixture was drawn by the Mac's own encoder —
 * the `qrcode` package with the app's `QR_OPTIONS` (`errorCorrectionLevel: 'M', margin: 1, width: 320`)
 * — so this is a reading of ZXing against the code a person actually points the phone at, not ZXing's
 * writer agreeing with ZXing's reader. **Not reached:** a real camera frame (blur, glare, a screen's
 * moiré); that is the hardware scan in `docs/testing.md`.
 */
class QrFrameDecoderTest {

    private fun resource(name: String): File =
        listOf("src/test/resources/qr/$name", "app/src/test/resources/qr/$name").map(::File).first { it.isFile }

    private val expected = resource("mac-pairing-qr.txt").readText()

    /**
     * The fixture placed in a larger grey frame, as Y bytes with padding at the end of each row.
     * `mac-pairing-qr.luma` is the PNG's pixels as 320 × 320 luminance bytes (Rec. 601 weights),
     * converted with `pngjs` — `javax.imageio` is not on the Android unit-test classpath.
     */
    private fun frame(rotateQuarterTurns: Int = 0, width: Int = 640, height: Int = 480, stride: Int = 704): ByteArray {
        val side = 320
        val src = resource("mac-pairing-qr.luma").readBytes()
        check(src.size == side * side) { "fixture is ${src.size} bytes" }
        val out = ByteArray(stride * height) { 0x80.toByte() }
        val ox = (width - side) / 2
        val oy = (height - side) / 2
        for (y in 0 until side) for (x in 0 until side) {
            val sx: Int
            val sy: Int
            when (rotateQuarterTurns % 4) {
                1 -> { sx = y; sy = side - 1 - x }
                2 -> { sx = side - 1 - x; sy = side - 1 - y }
                3 -> { sx = side - 1 - y; sy = x }
                else -> { sx = x; sy = y }
            }
            out[(oy + y) * stride + ox + x] = src[sy * side + sx]
        }
        return out
    }

    @Test
    fun `the Mac's pairing code decodes from a padded luminance frame`() {
        assertEquals(expected, QrFrameDecoder.decode(frame(), rowStride = 704, width = 640, height = 480))
    }

    @Test
    fun `it decodes whichever way the phone is held`() {
        for (turns in 1..3) {
            assertEquals("rotated $turns quarter turn(s)", expected, QrFrameDecoder.decode(frame(turns), 704, 640, 480))
        }
    }

    @Test
    fun `a frame with no code is null, not an exception`() {
        assertNull(QrFrameDecoder.decode(ByteArray(704 * 480) { 0x80.toByte() }, 704, 640, 480))
    }

    @Test
    fun `a malformed frame is null, not an exception`() {
        assertNull(QrFrameDecoder.decode(ByteArray(10), 704, 640, 480))
    }

    @Test
    fun `the decoded text is a pairing payload the screen accepts`() {
        val text = QrFrameDecoder.decode(frame(), 704, 640, 480)!!
        val payload = PairingQrPayload.parse(text)
        assertEquals("192.168.1.5", payload?.host)
    }
}
