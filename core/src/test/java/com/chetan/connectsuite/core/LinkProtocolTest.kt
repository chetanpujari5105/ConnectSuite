package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.Framing
import com.chetan.connectsuite.core.link.PairingQrPayload
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.core.protocol.ProtocolException
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class LinkProtocolTest {

    @Test
    fun `frames round trip in order`() {
        val output = ByteArrayOutputStream()
        Framing.writeFrame(output, "first".toByteArray())
        Framing.writeFrame(output, ByteArray(0))
        Framing.writeFrame(output, "third".toByteArray())

        val input = ByteArrayInputStream(output.toByteArray())
        assertEquals("first", String(Framing.readFrame(input)!!))
        assertEquals(0, Framing.readFrame(input)!!.size)
        assertEquals("third", String(Framing.readFrame(input)!!))
        assertNull("clean end of stream reads as null", Framing.readFrame(input))
    }

    @Test
    fun `an oversized length prefix is refused rather than allocated`() {
        val hostile = ByteArrayOutputStream().apply {
            write(byteArrayOf(0x7F, 0x00, 0x00, 0x00)) // ~2 GB
        }
        assertThrows(ProtocolException::class.java) {
            Framing.readFrame(ByteArrayInputStream(hostile.toByteArray()))
        }
    }

    @Test
    fun `envelope encodes the fields the desktop reads back`() {
        val envelope = Envelope.of(MessageType.MIRROR_CONFIG) { put("bitrate", 6_000_000) }
        val decoded = Envelope.decode(Envelope.encode(envelope))

        assertEquals(Link.PROTOCOL_MAJOR, decoded.v)
        assertEquals(MessageType.MIRROR_CONFIG, decoded.type)
        assertEquals(envelope.id, decoded.id)
        assertEquals("6000000", decoded.payload["bitrate"]?.jsonPrimitive?.content)
    }

    @Test
    fun `errors carry a code and a fix hint`() {
        val decoded = Envelope.decode(
            Envelope.encode(
                Envelope.error(
                    requestId = "req-1",
                    code = ErrorCode.PERMISSION_DENIED,
                    feature = "sms",
                    message = "SMS permission not granted",
                    fixHint = "Settings > Apps > ConnectSuite > Permissions",
                ),
            ),
        )
        assertEquals(MessageType.ERROR, decoded.type)
        assertEquals("req-1", decoded.id)
        assertEquals(ErrorCode.PERMISSION_DENIED, decoded.payload["code"]?.jsonPrimitive?.content)
        assertEquals("sms", decoded.payload["feature"]?.jsonPrimitive?.content)
    }

    @Test
    fun `a valid pairing QR parses and normalises its fingerprint`() {
        val fingerprint = (1..32).joinToString(":") { "%02X".format(it) }
        val payload = PairingQrPayload.parse(
            """{"host":"192.168.1.5","fp":"$fingerprint","token":"abc123","name":"Chetan's MacBook"}""",
        )!!

        assertEquals("192.168.1.5", payload.host)
        assertEquals(64, payload.peerId.length)
        assertTrue(payload.peerId.all { it.isDigit() || it in 'a'..'f' })
    }

    @Test
    fun `codes that are not ours are rejected instead of half-accepted`() {
        assertNull(PairingQrPayload.parse("https://example.com"))
        assertNull(PairingQrPayload.parse("""{"host":"1.2.3.4","fp":"short","token":"t","name":"x"}"""))
        assertNull(PairingQrPayload.parse("""{"host":"1.2.3.4","fp":"${"AA".repeat(32)}","token":"","name":"x"}"""))
    }
}
