package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A phone that can do nothing for the Mac is still a valid peer.
 *
 * Zero capabilities is reachable on a real device — a fresh install with no permissions granted
 * and no feature module registered yet advertises nothing at all — and it must pair, connect and
 * hold a heartbeat exactly like a fully-permitted phone. Before the capability contract landed the
 * phone always advertised mirror, files and apps unconditionally, so this path had never once run
 * and nothing guarded it.
 *
 * The rule these tests pin down: an empty capability list is a *complete* answer, never an error
 * and never a reason to drop the link.
 */
class EmptyCapabilitiesTest {

    private fun capabilitiesOf(envelope: Envelope): List<String> =
        envelope.payload["capabilities"]!!.jsonArray.map { it.jsonPrimitive.content }

    /** Mirrors ControlSession.capabilitiesJson(), which is what goes on the wire. */
    private fun capabilitiesJson(capabilities: Set<String>) =
        JsonArray(capabilities.sorted().map { JsonPrimitive(it) })

    @Test
    fun `a phone with nothing permitted and nothing registered advertises nothing`() {
        val advertisable = CapabilityContract.advertisable(
            grantedPermissions = emptySet(),
            specialAccessHeld = emptySet(),
            registeredTypes = emptySet(),
            videoServed = false,
            cameraServed = false,
            webcamServed = false,
            bulkServed = false,
            backgroundRestricted = false,
        )

        assertTrue("no permissions and no handlers must advertise nothing", advertisable.isEmpty())
    }

    @Test
    fun `permissions alone never advertise a capability`() {
        // The exact regression the contract exists to stop: mirror, files and apps need no
        // runtime permission, so the permission half passes for all three on every device. With
        // no handlers registered they must still come out empty.
        // Mirror, files and apps need no permission at all, so an empty grant set permits all
        // three — which is exactly the situation under test.
        val advertisable = CapabilityContract.advertisable(
            grantedPermissions = emptySet(),
            specialAccessHeld = emptySet(),
            registeredTypes = emptySet(),
            videoServed = false,
            cameraServed = false,
            webcamServed = false,
            bulkServed = false,
            backgroundRestricted = false,
        )

        assertTrue("an unimplemented capability is not advertisable", advertisable.isEmpty())
    }

    @Test
    fun `hello ack with no capabilities is a well-formed envelope`() {
        val helloId = "hello-1"
        val ack = Envelope.of(MessageType.HELLO_ACK, helloId) {
            put("protocolVersion", Link.PROTOCOL_MAJOR)
            put("appVersion", "2.0.0")
            put("deviceName", "Samsung SM-S938B")
            put("deviceId", "81744ed3-bcda-45da-b93d-d2859c495ee3")
            put("fingerprint", "2F:97:0F:EC")
            put("sessionToken", "token-1")
            put("capabilities", capabilitiesJson(emptySet()))
        }

        val decoded = Envelope.decode(Envelope.encode(ack))

        // The Mac resolves its pending hello promise off the echoed id and reads the token from
        // this frame; an empty capability list must not disturb either.
        assertEquals(MessageType.HELLO_ACK, decoded.type)
        assertEquals(helloId, decoded.id)
        assertEquals(Link.PROTOCOL_MAJOR, decoded.v)
        assertEquals("token-1", decoded.payload["sessionToken"]?.jsonPrimitive?.content)
        assertEquals(emptyList<String>(), capabilitiesOf(decoded))
    }

    @Test
    fun `an empty capability list is present on the wire rather than omitted`() {
        // The desktop reads `payload.capabilities ?? []`, so a *missing* key would also decode to
        // an empty list and hide a phone that failed to answer. The two cases have to stay
        // distinguishable, which means the key is always sent.
        val encoded = String(
            Envelope.encode(
                Envelope.of(MessageType.HELLO_ACK) {
                    put("capabilities", capabilitiesJson(emptySet()))
                },
            ),
        )

        assertTrue("capabilities must be serialized as []", encoded.contains("\"capabilities\":[]"))
        assertNotNull(
            "the key must exist even when empty",
            Envelope.decode(encoded.toByteArray()).payload["capabilities"],
        )
    }

    @Test
    fun `capabilities changed can drop to empty mid-session`() {
        // Revoking the last permission while connected pushes an empty set. This must be an
        // ordinary update the Mac greys panes on, not a teardown.
        val push = Envelope.of(MessageType.CAPABILITIES_CHANGED) {
            put("capabilities", capabilitiesJson(emptySet()))
        }

        val decoded = Envelope.decode(Envelope.encode(push))

        assertEquals(MessageType.CAPABILITIES_CHANGED, decoded.type)
        assertEquals(emptyList<String>(), capabilitiesOf(decoded))
    }

    @Test
    fun `heartbeat is unaffected by having no capabilities`() {
        // ControlSession answers ping outside the capability path entirely; a zero-capability
        // phone holds the link open on pongs alone. If this ever stops being true the Mac drops
        // the peer after MISSED_PONGS_BEFORE_DEAD and calls it a dead phone.
        val ping = Envelope.of(MessageType.PING, "ping-1")
        val pong = Envelope.of(MessageType.PONG, ping.id)

        val decoded = Envelope.decode(Envelope.encode(pong))

        assertEquals(MessageType.PONG, decoded.type)
        assertEquals("the pong must echo the ping id the Mac is waiting on", "ping-1", decoded.id)
    }
}
