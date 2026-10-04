package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraRequestRoute
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Real H.264 through the phone's production path — the machine's gate, the assembler and the AU writer,
 * exactly as `WebcamEngine.onEncoded` chains them — and the result held to a golden the Mac decodes.
 *
 * **What is real and what stands in.** The bitstream is real: VideoToolbox on a Mac produced it, and the
 * generator cut it into the buffers an Android MediaCodec hands out (`docs/fixtures/
 * webcam-mediacodec-sample-v1.txt`). The encoder is therefore **a Mac encoder standing in for the
 * phone's**: this test proves the phone wraps a genuine stream correctly and the Swift bridge decodes what
 * it wrote (`WebcamCoreTests.PhoneStream`). It says nothing about this phone's MediaCodec, its rate or
 * its heat — that is spike S1, on hardware.
 */
class WebcamPhoneStreamFixtureTest {

    private class Buffer(val kind: String, val data: ByteArray)
    private class Generation(val number: Int, val facing: CameraFacing, val width: Int, val height: Int, val rotation: Int, val buffers: List<Buffer>)

    private fun fixture(name: String): File = listOf("../docs/fixtures/$name", "docs/fixtures/$name").map(::File).first { it.isFile }

    private fun sample(): List<Generation> {
        val out = mutableListOf<Generation>()
        var header: List<String>? = null
        var buffers = mutableListOf<Buffer>()
        fun flush() {
            val h = header ?: return
            out += Generation(h[1].toInt(), CameraFacing.fromWire(h[2])!!, h[3].toInt(), h[4].toInt(), h[5].toInt(), buffers)
            buffers = mutableListOf()
        }
        for (line in fixture("webcam-mediacodec-sample-v1.txt").readLines()) {
            if (line.isBlank() || line.startsWith("#")) continue
            val parts = line.trim().split(" ")
            if (parts[0] == "generation") {
                flush()
                header = parts
            } else {
                buffers += Buffer(parts[0], ByteArray(parts[1].length / 2) { parts[1].substring(it * 2, it * 2 + 2).toInt(16).toByte() })
            }
        }
        flush()
        return out
    }

    /** The phone's path, as the engine runs it: approve, claim, then per buffer assemble → gate → stamp. */
    private fun phoneStream(): ByteArray {
        val owner = Any()
        val session = "5ed15e5510000000000000000000c0de"
        val machine = WebcamSessionMachine<Any>()
        machine.request(owner, "mac", "r", "front", "consumer", session, 0, true, null, CameraRequestRoute.SCREEN)
        machine.approve(session, CameraFacing.FRONT, 1, null, 0)
        check(machine.offerChannel(owner, session))
        val out = ByteArrayOutputStream()
        var sequence = 0L
        for (g in sample()) {
            if (g.number > 1) assertEquals(g.number, machine.phoneSwitch(session, g.facing).filterIsInstance<WebcamEffect.SwitchCapture>().single().generation)
            val assembler = WebcamAuAssembler()
            for (b in g.buffers) {
                val unit = when (val r = assembler.offer(b.kind == "config", b.kind == "key", b.data)) {
                    WebcamAuAssembler.Result.ConfigStored -> continue
                    is WebcamAuAssembler.Result.Dropped -> throw AssertionError("a real buffer was refused: ${r.why}")
                    is WebcamAuAssembler.Result.Unit -> r
                }
                val ticket = machine.accessUnitProduced(session, g.number, unit.keyframe, g.width, g.height).first
                    ?: throw AssertionError("the gate refused AU ${sequence + 1}, generation ${g.number}")
                sequence++
                val header = WebcamAuCodec.Header(
                    facing = g.facing, rotation = g.rotation, discontinuity = ticket.firstOfGeneration && g.number > 1,
                    generation = g.number, width = g.width, height = g.height, sequence = sequence,
                )
                out.write(WebcamAuCodec.encode(header, 1_000_000L + sequence * 33_333L, unit.annexB)!!)
            }
            assertEquals("every IDR carried SPS and PPS", 0L, assembler.idrWithoutConfig)
        }
        return out.toByteArray()
    }

    @Test
    fun `the sample is what its header says - real MediaCodec-shaped buffers, IDRs without SPS and PPS`() {
        val gens = sample()
        assertEquals(listOf(1, 2), gens.map { it.number })
        for (g in gens) {
            assertEquals("config", g.buffers.first().kind)
            assertEquals(listOf(7, 8), WebcamAuCodec.nalTypes(g.buffers.first().data))
            for (b in g.buffers.filter { it.kind == "key" }) {
                val types = WebcamAuCodec.nalTypes(b.data)!!
                assertTrue("an IDR in the sample: $types", 5 in types && 7 !in types && 8 !in types)
            }
        }
        assertEquals(9, gens.sumOf { g -> g.buffers.count { it.kind != "config" } })
    }

    @Test
    fun `the phone's writer reproduces the golden stream the Mac decodes, byte for byte`() {
        val produced = phoneStream()
        val built = File("build/webcam-phone-stream-v1.bin").also { it.parentFile.mkdirs(); it.writeBytes(produced) }
        val golden = fixture("webcam-phone-stream-v1.hex").readLines().filterNot { it.startsWith("#") }.joinToString("").filter { it.isLetterOrDigit() }
        val goldenBytes = ByteArray(golden.length / 2) { golden.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        assertArrayEquals("produced at ${built.absolutePath}", goldenBytes, produced)
    }

    @Test
    fun `the stream's structure - IDR with SPS and PPS first in each generation, discontinuity only at the switch`() {
        val bytes = phoneStream()
        var i = 0
        val frames = mutableListOf<ByteArray>()
        while (i < bytes.size) {
            val length = ((bytes[i + 9].toInt() and 0xFF) shl 24) or ((bytes[i + 10].toInt() and 0xFF) shl 16) or
                ((bytes[i + 11].toInt() and 0xFF) shl 8) or (bytes[i + 12].toInt() and 0xFF)
            frames += bytes.copyOfRange(i, i + 13 + length)
            i += 13 + length
        }
        assertEquals(9, frames.size)
        val gen = frames.map { ((it[19].toInt() and 0xFF) shl 8) or (it[20].toInt() and 0xFF) }
        assertEquals(listOf(1, 1, 1, 1, 1, 1, 2, 2, 2), gen)
        val flags = frames.map { it[0].toInt() }
        assertEquals(listOf(3, 0, 0, 0, 3, 0, 3, 0, 0), flags)
        val discontinuity = frames.map { it[WebcamAuCodec.DISCONTINUITY_OFFSET].toInt() and 1 }
        assertEquals(listOf(0, 0, 0, 0, 0, 0, 1, 0, 0), discontinuity)
        val facing = frames.map { it[15].toInt() }
        assertEquals(listOf(1, 1, 1, 1, 1, 1, 0, 0, 0), facing)
    }
}
