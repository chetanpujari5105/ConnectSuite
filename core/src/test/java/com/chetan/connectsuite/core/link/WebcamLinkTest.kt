package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.FeatureOf
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Camera v2's three seams in `core` — docs/protocol.md → Webcam: the claim grammar, the `ext`
 * advertisement with its release gate, and the capability contract's two halves.
 */
class WebcamLinkTest {

    private val token = "a".repeat(64)
    private val session = "0123456789abcdef0123456789abcdef"

    // ---- the claim ------------------------------------------------------------------------------

    @Test
    fun `a webcam claim names its session and is a different claim from a camera claim`() {
        val frame = SideChannelClaim.webcamFrame(token, session)
        assertEquals("$token webcam $session", frame)
        assertEquals(104, frame.toByteArray().size)
        assertEquals(SideChannelClaim.Webcam(token, session), SideChannelClaim.parse(frame))
        // The same id under the other word is the other feature's claim — never this one's.
        assertEquals(SideChannelClaim.Camera(token, session), SideChannelClaim.parse(SideChannelClaim.cameraFrame(token, session)))
    }

    @Test
    fun `nearly a webcam claim is no claim`() {
        val refused = listOf(
            "$token Webcam $session",
            "$token webcams $session",
            "$token webcam ${session.uppercase()}",
            "$token webcam ${session.dropLast(1)}",
            "$token webcam $session ",
            "$token  webcam $session",
            "$token webcam $session extra",
            "XYZ webcam $session",
        )
        for (frame in refused) assertNull(frame, SideChannelClaim.parse(frame))
        // Control: the grammar is not refusing everything.
        assertTrue(SideChannelClaim.parse("$token webcam $session") is SideChannelClaim.Webcam)
    }

    @Test
    fun `the mirror's token-only frame is untouched by the new word`() {
        assertEquals(SideChannelClaim.TokenOnly(token), SideChannelClaim.parse(token))
    }

    // ---- ext ------------------------------------------------------------------------------------

    @Test
    fun `ext webcam is advertised only when installed and the build is debuggable or released`() {
        // Version 2 since 2026-10-05 (webcam.keyframe); the gates are unchanged.
        assertEquals(mapOf("webcam" to 2), Extensions.webcamAdvertised(installed = true, debuggable = true))
        assertEquals(emptyMap<String, Int>(), Extensions.webcamAdvertised(installed = false, debuggable = true))
        assertEquals(emptyMap<String, Int>(), Extensions.webcamAdvertised(installed = true, debuggable = false))
        assertEquals(mapOf("webcam" to 2), Extensions.webcamAdvertised(installed = true, debuggable = false, release = true))
        // A release flag alone, with nothing installed, still promises nothing.
        assertEquals(emptyMap<String, Int>(), Extensions.webcamAdvertised(installed = false, debuggable = false, release = true))
    }

    @Test
    fun `release activation stays off in this build`() {
        assertFalse(Extensions.WEBCAM_RELEASE)
        assertEquals(Extensions.WEBCAM, Capability.WEBCAM)
    }

    @Test
    fun `an older Mac negotiates no webcam, and nor does a phone without the feature`() {
        // A version-1 Mac with this version-2 phone: negotiated 1 — the whole of version 1, and no keyframe.
        val installed = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = mapOf("webcam" to 1), webcamInstalled = true)
        assertEquals(1, installed.negotiated["webcam"])
        assertTrue(installed.webcamLine, installed.webcamLine.contains("may send webcam.*"))

        val olderMac = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = emptyMap(), webcamInstalled = true)
        assertEquals(2, olderMac.advertised["webcam"])
        assertNull(olderMac.negotiated["webcam"])
        assertTrue(olderMac.webcamLine.contains("sends no webcam.*"))

        val notInstalled = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = mapOf("webcam" to 1))
        assertNull("the default is not installed", notInstalled.advertised["webcam"])
        assertNull(notInstalled.negotiated["webcam"])

        val release = Extensions.handshake(debuggable = false, devV2Armed = false, macExt = mapOf("webcam" to 1), webcamInstalled = true)
        assertNull(release.advertised["webcam"])
        // The other keys are not disturbed by the new one.
        assertEquals(installed.advertised - "webcam", notInstalled.advertised)
    }

    @Test
    fun `a version-2 Mac negotiates 2, and a future Mac negotiates down to the phone's 2`() {
        val v2 = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = mapOf("webcam" to 2), webcamInstalled = true)
        assertEquals(2, v2.negotiated["webcam"])
        val h = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = mapOf("webcam" to 4), webcamInstalled = true)
        assertEquals(2, h.negotiated["webcam"])
    }

    // ---- the capability contract ----------------------------------------------------------------

    private val requests = setOf(MessageType.WEBCAM_REQUEST, MessageType.WEBCAM_STOP, MessageType.WEBCAM_SWITCH, MessageType.WEBCAM_KEYFRAME)

    private fun advertised(registered: Set<String>, webcamServed: Boolean, cameraServed: Boolean = true) =
        Capability.WEBCAM in CapabilityContract.advertisable(
            grantedPermissions = setOf("android.permission.CAMERA"),
            specialAccessHeld = emptySet(),
            registeredTypes = registered,
            videoServed = true,
            cameraServed = cameraServed,
            webcamServed = webcamServed,
            bulkServed = true,
            backgroundRestricted = false,
        )

    @Test
    fun `webcam is advertised only with both halves, never on the permission or Camera v1's claim`() {
        assertFalse("permission alone", advertised(emptySet(), webcamServed = false))
        assertFalse("handlers without the claim", advertised(requests, webcamServed = false))
        assertFalse("the claim without handlers", advertised(emptySet(), webcamServed = true))
        assertFalse("Camera v1's claim is not the webcam's", advertised(requests, webcamServed = false, cameraServed = true))
        assertTrue(advertised(requests, webcamServed = true))
        assertEquals(
            listOf("webcam channel unserved"),
            CapabilityContract.missingFor(Capability.WEBCAM, requests, true, true, true, false),
        )
    }

    @Test
    fun `the state event is the phone's own, and every webcam message maps to the capability`() {
        val contract = CapabilityContract.contracts.getValue(Capability.WEBCAM)
        assertEquals(requests, contract.requests)
        assertFalse(MessageType.WEBCAM_STATE in contract.requests)
        for (type in requests + MessageType.WEBCAM_STATE) assertEquals(Capability.WEBCAM, FeatureOf.of(type))
        // No permission in the contract: CAMERA is asked after the tap, for one session.
        assertTrue(contract.permissions.isEmpty() && contract.permissionAlternatives.isEmpty())
    }
}
