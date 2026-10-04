package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.link.SideChannelClaim
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The production [WebcamFeature.wire] against a **recording stand-in for `LinkServer`**, and what the
 * link would then advertise — computed by the production `CapabilityContract.advertisable` and
 * `Extensions.handshake` from exactly what was recorded, with `webcamInstalled` read the way
 * `ControlSession` reads it (`webcamChannelSink != null`).
 */
class WebcamFeatureWiringTest {

    private class RecordingLink(override val debuggable: Boolean) : WebcamLinkTarget {
        var sink: ((AuthenticatedChannel, SideChannelClaim.Webcam) -> Unit)? = null
        val handlers = linkedMapOf<String, MessageHandler>()
        val order = mutableListOf<String>()
        var sessionListeners = 0
        override fun setWebcamSink(sink: (AuthenticatedChannel, SideChannelClaim.Webcam) -> Unit) {
            this.sink = sink
            order += "sink"
        }
        override fun addSessionEndedListener(listener: (ControlSession) -> Unit) {
            sessionListeners++
            order += "session-ended"
        }
        override fun register(type: String, handler: MessageHandler) {
            handlers[type] = handler
            order += "register $type"
        }
        override fun refreshCapabilities() {
            order += "refresh"
        }

        /** What `hello.ack` would carry, from what was recorded. */
        fun advertisesWebcam(): Boolean = Capability.WEBCAM in CapabilityContract.advertisable(
            grantedPermissions = emptySet(), specialAccessHeld = emptySet(), registeredTypes = handlers.keys,
            videoServed = true, cameraServed = true, webcamServed = sink != null, bulkServed = true, backgroundRestricted = false,
        )

        fun extWebcam(macExt: Map<String, Int> = mapOf("webcam" to 1)): Int? =
            Extensions.handshake(debuggable, devV2Armed = false, macExt = macExt, webcamInstalled = sink != null).negotiated["webcam"]
    }

    @Test
    fun `a release build wires nothing, advertises nothing and starts no engine`() {
        val link = RecordingLink(debuggable = false)
        var engine = 0
        assertFalse(WebcamFeature.wire(link) { engine++ })
        assertEquals(0, engine)
        assertTrue(link.order.isEmpty())
        assertFalse(link.advertisesWebcam())
        assertNull(link.extWebcam())
    }

    @Test
    fun `a debuggable build - engine first, then the claim, then exactly the contract's handlers - and both halves advertise`() {
        val link = RecordingLink(debuggable = true)
        var engine = 0
        assertTrue(WebcamFeature.wire(link) { engine++; link.order += "engine" })
        assertEquals(1, engine)
        assertEquals("engine", link.order.first())
        assertEquals("sink", link.order[1])
        assertEquals("refresh", link.order.last())
        assertEquals(CapabilityContract.contracts.getValue(Capability.WEBCAM).requests, link.handlers.keys)
        assertEquals(1, link.sessionListeners)
        assertTrue(link.advertisesWebcam())
        assertEquals(1, link.extWebcam())
        // An older Mac negotiates nothing, so it is sent no webcam.*.
        assertNull(link.extWebcam(macExt = emptyMap()))
    }

    @Test
    fun `half a contract never advertises - a missing handler, or a missing sink`() {
        val noHandler = RecordingLink(debuggable = true)
        WebcamFeature.wire(noHandler) {}
        noHandler.handlers.remove(com.chetan.connectsuite.core.protocol.MessageType.WEBCAM_SWITCH)
        assertFalse(noHandler.advertisesWebcam())

        val noSink = RecordingLink(debuggable = true)
        WebcamFeature.wire(noSink) {}
        noSink.sink = null
        assertFalse(noSink.advertisesWebcam())
        assertNull("ext follows the sink", noSink.extWebcam())
    }

    @Test
    fun `the release flag is the only way a release build would install, and it is off`() {
        assertFalse(Extensions.WEBCAM_RELEASE)
        val link = RecordingLink(debuggable = false)
        assertTrue("INJECTED release = true, to show what flipping it would do", WebcamFeature.wire(link, release = true) {})
        assertTrue(link.advertisesWebcam())
        assertNull("…and ext still waits for the flag itself, not passed here", link.extWebcam())
    }
}
