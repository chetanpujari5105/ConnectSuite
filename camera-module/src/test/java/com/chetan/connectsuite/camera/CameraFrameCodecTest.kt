package com.chetan.connectsuite.camera

import com.chetan.connectsuite.core.protocol.Link
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File

/**
 * The camera frame encoder against the cross-language golden vector, `docs/fixtures/camera-frame-v1.hex`.
 *
 * The Mac's `cameraFrame.test.ts` parses the same file. One byte sequence, two ends — so a disagreement
 * between the encoder and the parser fails one of the two suites rather than surfacing on hardware.
 */
class CameraFrameCodecTest {

    private fun golden(): ByteArray {
        val text = File("../docs/fixtures/camera-frame-v1.hex").readLines()
            .filterNot { it.startsWith("#") }
            .joinToString("")
            .filterNot { it.isWhitespace() }
        return ByteArray(text.length / 2) { i -> text.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    private val goldenMeta = CameraFrameCodec.Meta(
        facing = CameraFacing.FRONT,
        rotationQuarterTurns = 3,
        mirrored = true,
        epoch = 7,
        width = 1280,
        height = 720,
        sequence = 0x01020304,
    )
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())

    @Test
    fun `the encoder produces the golden vector byte for byte`() {
        val encoded = CameraFrameCodec.encode(goldenMeta, 0x0102030405060708L, jpeg)
        assertArrayEquals(golden(), encoded)
    }

    @Test
    fun `the golden vector is the shape the contract names`() {
        val bytes = golden()
        assertEquals(13 + 16 + 4, bytes.size)
        assertEquals(1, bytes[0].toInt()) // keyframe, always
        assertEquals(20, bytes[12].toInt()) // payload length = 16 + 4
    }

    @Test
    fun `a frame over the cap is null, never sent`() {
        val huge = ByteArray(Link.CAMERA_MAX_FRAME - CameraFrameCodec.CAMERA_HEADER_BYTES + 1).also {
            it[0] = 0xFF.toByte()
            it[1] = 0xD8.toByte()
        }
        assertNull(CameraFrameCodec.encode(goldenMeta, 1, huge))
        // Control: one byte smaller fits exactly.
        val fits = huge.copyOf(huge.size - 1)
        assertEquals(13 + Link.CAMERA_MAX_FRAME, CameraFrameCodec.encode(goldenMeta, 1, fits)!!.size)
    }

    @Test
    fun `a frame the phone should never build is a programming error`() {
        assertThrows(IllegalArgumentException::class.java) { CameraFrameCodec.encode(goldenMeta.copy(rotationQuarterTurns = 4), 1, jpeg) }
        assertThrows(IllegalArgumentException::class.java) { CameraFrameCodec.encode(goldenMeta.copy(width = 0), 1, jpeg) }
        assertThrows(IllegalArgumentException::class.java) { CameraFrameCodec.encode(goldenMeta.copy(height = 4097), 1, jpeg) }
        assertThrows(IllegalArgumentException::class.java) { CameraFrameCodec.encode(goldenMeta, 1, byteArrayOf(0x89.toByte(), 0x50)) }
        assertThrows(IllegalArgumentException::class.java) { CameraFrameCodec.encode(goldenMeta.copy(sequence = 0x1_0000_0000L), 1, jpeg) }
    }

    @Test
    fun `rotation degrees become quarter turns`() {
        assertEquals(listOf(0, 1, 2, 3, 0, 3), listOf(0, 90, 180, 270, 360, -90).map(CameraFrameCodec::quarterTurns))
    }
}
