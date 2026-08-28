package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.protocol.IdentityPacket
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.core.protocol.PROTOCOL_VERSION
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.protocol.TransferFileMeta
import com.chetan.connectsuite.core.protocol.TransferOffer
import com.chetan.connectsuite.core.protocol.TransferProtocol
import com.chetan.connectsuite.core.protocol.TransferResponse
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {

    @Test
    fun `packet survives an encode-decode round trip`() {
        val original = NetworkPacket.of(PacketType.NOTIFICATION_POSTED, payloadSize = 0) {
            put("key", JsonPrimitive("abc|1|com.example"))
            put("title", JsonPrimitive("Hello"))
            put("postedAt", JsonPrimitive(1_700_000_000_000L))
        }

        val decoded = NetworkPacket.decode(NetworkPacket.encode(original))

        assertEquals(original.type, decoded.type)
        assertEquals("abc|1|com.example", decoded.string("key"))
        assertEquals("Hello", decoded.string("title"))
        assertEquals(1_700_000_000_000L, decoded.long("postedAt"))
    }

    @Test
    fun `encoded packet is a single line so framing stays intact`() {
        // The transport reads one line then exactly payloadSize raw bytes; a newline inside the
        // header would desynchronise every packet after it.
        val packet = NetworkPacket.of(PacketType.TRANSFER_CHUNK, payloadSize = 4096) {
            put("fileName", JsonPrimitive("multi\nline\nname.txt"))
        }

        val encoded = NetworkPacket.encode(packet)

        assertFalse(encoded.contains('\n'))
        assertEquals("multi\nline\nname.txt", NetworkPacket.decode(encoded).string("fileName"))
    }

    @Test
    fun `payload size round trips`() {
        val packet = NetworkPacket.of(PacketType.TRANSFER_CHUNK, payloadSize = 131_072) {
            put("offset", JsonPrimitive(0L))
        }

        assertEquals(131_072, NetworkPacket.decode(NetworkPacket.encode(packet)).payloadSize)
    }

    @Test
    fun `missing fields read back as null rather than throwing`() {
        val packet = NetworkPacket.of(PacketType.PING)

        assertNull(packet.string("nothing"))
        assertNull(packet.long("nothing"))
        assertNull(packet.bool("nothing"))
    }

    @Test
    fun `boolean fields survive the round trip`() {
        val packet = NetworkPacket.of(PacketType.PAIR) {
            put("request", JsonPrimitive("true"))
            put("accepted", JsonPrimitive("false"))
        }

        val decoded = NetworkPacket.decode(NetworkPacket.encode(packet))

        assertTrue(decoded.bool("request") == true)
        assertTrue(decoded.bool("accepted") == false)
    }

    @Test
    fun `identity packet round trips and unknown fields are tolerated`() {
        val identity = IdentityPacket(
            deviceId = "d5b1f1c8-0000-4000-8000-000000000001",
            deviceName = "Pixel 9",
            deviceType = DeviceType.PHONE,
            tcpPort = 1764,
            capabilities = listOf(IdentityPacket.CAP_FILE_TRANSFER),
        )

        val decoded = IdentityPacket.decodeOrNull(IdentityPacket.encode(identity))

        assertEquals(identity, decoded)

        // A future version adding a field must not break an older peer's parser.
        val withExtra = IdentityPacket.encode(identity)
            .replace("{", "{\"somethingNew\":123,")
        assertEquals(identity, IdentityPacket.decodeOrNull(withExtra))
    }

    @Test
    fun `identity packet rejects garbage instead of throwing`() {
        assertNull(IdentityPacket.decodeOrNull("not json at all"))
        assertNull(IdentityPacket.decodeOrNull(""))
    }

    @Test
    fun `protocol version mismatch is detected`() {
        val ours = IdentityPacket("a", "A", DeviceType.PHONE, PROTOCOL_VERSION, 1764)
        val theirs = ours.copy(deviceId = "b", protocolVersion = PROTOCOL_VERSION + 1)

        assertFalse(ours.isCompatibleWith(theirs))
        assertTrue(ours.isCompatibleWith(ours.copy(deviceId = "c")))
    }

    @Test
    fun `transfer offer and response round trip through packet bodies`() {
        val offer = TransferOffer(
            jobId = "job-1",
            files = listOf(
                TransferFileMeta(
                    transferId = "t-1",
                    name = "holiday.mp4",
                    relativePath = "2026/summer",
                    size = 734_003_200,
                    mimeType = "video/mp4",
                ),
            ),
            totalBytes = 734_003_200,
            senderName = "Pixel 9",
        )

        val parsed = TransferProtocol.parseOffer(TransferProtocol.offerPacket(offer))
        assertEquals(offer, parsed)

        val response = TransferResponse(
            jobId = "job-1",
            accepted = true,
            resumeOffsets = mapOf("t-1" to 268_435_456L),
        )
        val parsedResponse =
            TransferProtocol.parseResponse(TransferProtocol.responsePacket(response))
        assertEquals(response, parsedResponse)
        assertEquals(268_435_456L, parsedResponse?.resumeOffsets?.get("t-1"))
    }
}
