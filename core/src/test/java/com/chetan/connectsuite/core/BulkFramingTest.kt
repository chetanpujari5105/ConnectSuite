package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.BulkFraming
import com.chetan.connectsuite.core.link.Framing
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.ProtocolException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Bug 6 — the bulk channel's frame caps, read side and write side.
 *
 * Written before anything serves the bulk channel, which is the only cheap moment: after `fs.*`
 * ships, changing a cap changes what an already-shipped sender emits, and a cap that turns out to
 * be too small then presents as a transfer bug for large files.
 */
class BulkFramingTest {

    private fun lengthPrefix(length: Int): ByteArray = byteArrayOf(
        (length ushr 24).toByte(),
        (length ushr 16).toByte(),
        (length ushr 8).toByte(),
        length.toByte(),
    )

    private fun framing(
        input: InputStream = ByteArrayInputStream(ByteArray(0)),
        output: OutputStream = ByteArrayOutputStream(),
        violations: MutableList<String> = mutableListOf(),
    ) = BulkFraming(input, output, { violations += it })

    // ---- the decision itself -------------------------------------------------------------

    @Test
    fun `the bulk cap is smaller than the general frame cap, not larger`() {
        // The whole argument for 1 MB. If someone later "fixes" a large-file transfer by raising
        // this above MAX_FRAME, that is the mistake this line exists to make visible.
        assertEquals(1 * 1024 * 1024, Link.MAX_BULK_FRAME)
        assertEquals(64 * 1024, Link.MAX_BULK_HEADER_FRAME)
        assertTrue(
            "the bulk channel moves 256 KB chunks; a frame past that is desync, not a bigger file",
            Link.MAX_BULK_FRAME < Link.MAX_FRAME,
        )
        assertTrue(Link.MAX_BULK_HEADER_FRAME < Link.MAX_BULK_FRAME)
    }

    // ---- read side -----------------------------------------------------------------------

    @Test
    fun `a chunk length prefix past the bulk cap is refused, named and closed`() {
        val violations = mutableListOf<String>()
        val hostile = ByteArrayInputStream(lengthPrefix(3 * 1024 * 1024))
        val bulk = framing(input = hostile, violations = violations)

        val e = assertThrows(ProtocolException::class.java) { bulk.readChunk() }

        val message = e.message!!
        assertTrue("names the offending length: $message", message.contains("3145728"))
        assertTrue("names the cap it broke: $message", message.contains("${Link.MAX_BULK_FRAME}"))
        assertTrue("names which frame: $message", message.contains("Bulk chunk"))
        assertEquals("the socket owner is told exactly once", 1, violations.size)
        assertEquals(message, violations.single())
    }

    @Test
    fun `a header frame is judged by the header cap, not the chunk cap`() {
        // The discrimination case: 100 KB is a legal chunk and an illegal header. A single cap for
        // the whole channel cannot tell these apart, and would let a malformed first frame claim
        // the entire chunk budget on a connection that has proved nothing beyond its token.
        val hundredKb = ByteArray(100 * 1024) { 'h'.code.toByte() }
        val encoded = ByteArrayOutputStream().also {
            Framing.writeFrame(it, hundredKb, Link.MAX_BULK_FRAME)
        }.toByteArray()

        val asHeader = framing(input = ByteArrayInputStream(encoded))
        val e = assertThrows(ProtocolException::class.java) { asHeader.readHeader() }
        assertTrue(e.message!!.contains("Bulk header"))
        assertTrue(e.message!!.contains("${Link.MAX_BULK_HEADER_FRAME}"))

        val asChunk = framing(input = ByteArrayInputStream(encoded))
        assertEquals(hundredKb.size, asChunk.readChunk()!!.size)
    }

    // ---- write side ------------------------------------------------------------------------

    @Test
    fun `our own oversized chunk fails on our side and nothing is emitted`() {
        // The half that catches us rather than a hostile peer: an adaptive chunk size that ran
        // away should fail here with a clear line, not become a frame the far end silently closes
        // the socket over.
        val output = ByteArrayOutputStream()
        val violations = mutableListOf<String>()
        val bulk = framing(output = output, violations = violations)

        val e = assertThrows(ProtocolException::class.java) {
            bulk.writeChunk(ByteArray(3 * 1024 * 1024))
        }

        assertTrue(e.message!!.contains("3145728"))
        assertTrue(e.message!!.contains("Bulk chunk"))
        assertEquals("a refused frame puts no bytes on the wire", 0, output.size())
        assertEquals(1, violations.size)
    }

    @Test
    fun `our own oversized header fails on our side too`() {
        val output = ByteArrayOutputStream()
        val bulk = framing(output = output)

        val e = assertThrows(ProtocolException::class.java) {
            bulk.writeHeader(ByteArray(Link.MAX_BULK_HEADER_FRAME + 1))
        }

        assertTrue(e.message!!.contains("Bulk header"))
        assertTrue(e.message!!.contains("${Link.MAX_BULK_HEADER_FRAME}"))
        assertEquals(0, output.size())
    }

    // ---- the denominator ---------------------------------------------------------------------

    @Test
    fun `the refusal carries what the channel had already accepted`() {
        // Per CLAUDE.md: a refusal count with no denominator is not evidence. The first over-size
        // frame in a 10,000-frame transfer must not read the same as a channel that was broken
        // from its first byte.
        val output = ByteArrayOutputStream()
        val bulk = framing(output = output)

        bulk.writeHeader(ByteArray(512))
        repeat(3) { bulk.writeChunk(ByteArray(1000)) }

        val e = assertThrows(ProtocolException::class.java) {
            bulk.writeChunk(ByteArray(2 * 1024 * 1024))
        }

        val message = e.message!!
        assertTrue("frames accepted: $message", message.contains("4 frames"))
        assertTrue("bytes moved: $message", message.contains("3512 bytes"))
        assertTrue("refusals: $message", message.contains("1 rejected"))
        assertEquals(4L, bulk.tally.accepted)
        assertEquals(3512L, bulk.tally.bytesAccepted)
        assertEquals(1L, bulk.tally.rejected)
    }

    @Test
    fun `a tally counts reads as well as writes, so a receiver has a denominator too`() {
        val wire = ByteArrayOutputStream()
        val sender = framing(output = wire)
        sender.writeHeader("""{"transferId":"t1"}""".toByteArray())
        sender.writeChunk(ByteArray(2048))

        val receiver = framing(input = ByteArrayInputStream(wire.toByteArray()))
        assertNotNull(receiver.readHeader())
        assertNotNull(receiver.readChunk())

        assertEquals(2L, receiver.tally.accepted)
        assertEquals(2067L, receiver.tally.bytesAccepted)
        assertTrue(receiver.tally.summary().contains("2 frames / 2067 bytes accepted, 0 rejected"))
    }

    // ---- the control that proves the checks above can see a legal frame ----------------------

    @Test
    fun `frames at exactly the cap are accepted, both sides`() {
        // The positive control. Every assertion above is an absence — "this was refused" — and an
        // absence is only evidence beside a known positive. If an off-by-one made the caps refuse
        // everything, all five refusal tests would still pass and this is the one that would not.
        val wire = ByteArrayOutputStream()
        val sender = framing(output = wire)
        sender.writeHeader(ByteArray(Link.MAX_BULK_HEADER_FRAME))
        sender.writeChunk(ByteArray(Link.MAX_BULK_FRAME))

        val receiver = framing(input = ByteArrayInputStream(wire.toByteArray()))
        assertEquals(Link.MAX_BULK_HEADER_FRAME, receiver.readHeader()!!.size)
        assertEquals(Link.MAX_BULK_FRAME, receiver.readChunk()!!.size)
        assertEquals(0L, receiver.tally.rejected)
    }

    @Test
    fun `a clean end of stream is still null, not a violation`() {
        val violations = mutableListOf<String>()
        val bulk = framing(violations = violations)
        assertEquals(null, bulk.readChunk())
        assertTrue(violations.isEmpty())
    }
}
