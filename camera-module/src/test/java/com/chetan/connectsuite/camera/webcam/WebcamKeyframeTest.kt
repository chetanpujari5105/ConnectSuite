package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `webcam.keyframe` (version 2, docs/protocol.md → `webcam.keyframe`) through the production
 * [WebcamSessionMachine] and the real [WebcamCaptureCore] over a **recording stand-in** for MediaCodec.
 * Nothing here touches an encoder: "asked the encoder" means the stand-in backend received the call.
 */
class WebcamKeyframeTest {

    private class Owner(val name: String) {
        override fun toString() = name
    }

    private val mac = Owner("mac")
    private val otherMac = Owner("other-mac")
    private val s1 = "0123456789abcdef0123456789abcdef"
    private val s2 = "fedcba9876543210fedcba9876543210"
    private val t0 = 1_000_000L

    private fun WebcamSessionMachine<Owner>.askAndApprove(owner: Owner = mac, sessionId: String = s1) {
        request(owner, owner.name, "req", null, "consumer", sessionId, t0, true, null, CameraRequestRoute.SCREEN)
        approve(sessionId, CameraFacing.FRONT, t0 + 1_000, null, 0)
    }

    /** Request, approve, attach, and the first IDR: `running` at generation 1. */
    private fun running(): WebcamSessionMachine<Owner> = WebcamSessionMachine<Owner>().apply {
        askAndApprove()
        assertTrue(offerChannel(mac, s1))
        assertNotNull(accessUnitProduced(s1, 1, keyframe = true, width = 1920, height = 1080).first)
    }

    private fun List<WebcamEffect<Owner>>.ack(): Map<String, Any> = filterIsInstance<WebcamEffect.Ack<Owner>>().single().payload
    private fun List<WebcamEffect<Owner>>.refusal(): String = filterIsInstance<WebcamEffect.Refuse<Owner>>().single().code
    private fun List<WebcamEffect<Owner>>.asked(): Boolean = any { it is WebcamEffect.MacKeyframe }
    private fun List<WebcamEffect<Owner>>.capturesOrEnds(): Boolean =
        any { it is WebcamEffect.OpenCapture || it is WebcamEffect.SwitchCapture || it is WebcamEffect.CloseCapture || it is WebcamEffect.Stopped<*> }

    @Test
    fun `accepted for the owner, the running session and its generation — the encoder is asked, and nothing else`() {
        val m = running()
        val e = m.keyframeFromMac(mac, "k1", s1, 1, t0 + 5_000)
        assertEquals(listOf<WebcamEffect<Owner>>(WebcamEffect.MacKeyframe(s1, 1)), e.filterIsInstance<WebcamEffect.MacKeyframe>())
        assertEquals(mapOf("result" to "accepted", "generation" to 1), e.ack())
        assertFalse("no camera opened, switched, closed or ended", e.capturesOrEnds())
        assertEquals("the generation did not change", 1, m.ui().generation)
        assertEquals(WebcamPhase.RUNNING, m.ui().phase)
    }

    @Test
    fun `a malformed request is BAD_REQUEST and asks nothing`() {
        val m = running()
        for ((sid, gen) in listOf(null to 1, "" to 1, "XYZ" to 1, s1.uppercase() to 1, s1 to null, s1 to 0, s1 to 65_536)) {
            val e = m.keyframeFromMac(mac, "k", sid, gen, t0 + 5_000)
            assertEquals("$sid/$gen", ErrorCode.BAD_REQUEST, e.refusal())
            assertFalse(e.asked())
        }
    }

    @Test
    fun `another connection's session is UNAUTHORIZED and changes nothing — not even the rate limit`() {
        val m = running()
        val e = m.keyframeFromMac(otherMac, "k", s1, 1, t0 + 5_000)
        assertEquals(ErrorCode.UNAUTHORIZED, e.refusal())
        assertFalse(e.asked())
        assertTrue("the owner is still accepted at once", m.keyframeFromMac(mac, "k2", s1, 1, t0 + 5_001).asked())
    }

    @Test
    fun `a wrong, never-approved or ended session is NOT_FOUND, and nothing restarts`() {
        val m = running()
        assertEquals(ErrorCode.NOT_FOUND, m.keyframeFromMac(mac, "k", s2, 1, t0 + 5_000).refusal())
        val awaiting = WebcamSessionMachine<Owner>()
        awaiting.request(mac, "mac", "req", null, "consumer", s1, t0, true, null, CameraRequestRoute.SCREEN)
        val before = awaiting.keyframeFromMac(mac, "k", s1, 1, t0 + 5_000)
        assertEquals("no capture before consent", ErrorCode.NOT_FOUND, before.refusal())
        assertFalse(before.capturesOrEnds())
        m.stopFromMac(mac, "stop", s1, "person", null)
        val after = m.keyframeFromMac(mac, "k", s1, 1, t0 + 6_000)
        assertEquals(ErrorCode.NOT_FOUND, after.refusal())
        assertFalse(after.capturesOrEnds())
        assertEquals(WebcamPhase.IDLE, m.ui().phase)
    }

    @Test
    fun `ignored while starting, for an older or a newer generation, and inside the second — each saying why`() {
        val starting = WebcamSessionMachine<Owner>().apply { askAndApprove() }
        val e0 = starting.keyframeFromMac(mac, "k", s1, 1, t0 + 2_000)
        assertEquals("not-running", e0.ack()["reason"])
        assertFalse(e0.asked())

        val m = running()
        assertEquals("unknown-generation", m.keyframeFromMac(mac, "k", s1, 2, t0 + 5_000).ack()["reason"])
        assertTrue(m.keyframeFromMac(mac, "k", s1, 1, t0 + 5_000).asked())
        val limited = m.keyframeFromMac(mac, "k", s1, 1, t0 + 5_999)
        assertEquals("rate-limited", limited.ack()["reason"])
        assertEquals(1, limited.ack()["generation"])
        assertTrue("one second later it is accepted", m.keyframeFromMac(mac, "k", s1, 1, t0 + 6_000).asked())

        // A switch: generation 2 has not sent its first IDR, and generation 1 is history.
        m.switch(mac, "sw", s1, "back") { true }
        val stale = m.keyframeFromMac(mac, "k", s1, 1, t0 + 9_000)
        assertEquals("stale-generation", stale.ack()["reason"])
        assertEquals("the phone's current generation", 2, stale.ack()["generation"])
        assertEquals("not-running", m.keyframeFromMac(mac, "k", s1, 2, t0 + 9_000).ack()["reason"])
        assertNotNull(m.accessUnitProduced(s1, 2, keyframe = true, width = 1920, height = 1080).first)
        assertTrue(m.keyframeFromMac(mac, "k", s1, 2, t0 + 9_000).asked())
    }

    // ---- the encoder call: exactly the bound encoder, or nothing ---------------------------------------

    private class RecordingBackend : WebcamCaptureBackend {
        val pending = mutableListOf<(WebcamCaptureBackend.Outcome) -> Unit>()
        val keyframes = mutableListOf<Any>()
        override fun open(sessionId: String, facing: CameraFacing, generation: Int, done: (WebcamCaptureBackend.Outcome) -> Unit) {
            pending += done
        }
        override fun release(handle: Any) = Unit
        override fun requestKeyframe(handle: Any) {
            keyframes += handle
        }
    }

    @Test
    fun `the accepted request reaches the bound encoder of exactly that session and generation`() {
        val m = running()
        val backend = RecordingBackend()
        val log = mutableListOf<String>()
        val core = WebcamCaptureCore(backend, m::isCurrentCapture, { _, _ -> }, { log += it })
        core.open(s1, CameraFacing.FRONT, 1)
        backend.pending[0](WebcamCaptureBackend.Outcome.Opened("enc-1", 1920, 1080))
        assertTrue(core.requestKeyframe(s1, 1))
        assertEquals(listOf<Any>("enc-1"), backend.keyframes)
        assertFalse("another session's", core.requestKeyframe(s2, 1))
        assertFalse("another generation's", core.requestKeyframe(s1, 2))
        assertEquals(listOf<Any>("enc-1"), backend.keyframes)
        assertTrue(log.last(), log.last().contains("2 not asked / 1 asked"))
    }

    @Test
    fun `a switch or a Stop between the decision and the call leaves nothing asked — never the replacement`() {
        val m = running()
        val backend = RecordingBackend()
        val core = WebcamCaptureCore(backend, m::isCurrentCapture, { _, _ -> }, { })
        core.open(s1, CameraFacing.FRONT, 1)
        backend.pending[0](WebcamCaptureBackend.Outcome.Opened("enc-1", 1920, 1080))
        // Accepted for generation 1 …
        assertTrue(m.keyframeFromMac(mac, "k", s1, 1, t0 + 5_000).asked())
        // … then a switch lands first and generation 2's encoder is bound.
        m.switch(mac, "sw", s1, "back") { true }
        core.open(s1, CameraFacing.BACK, 2)
        backend.pending[1](WebcamCaptureBackend.Outcome.Opened("enc-2", 1920, 1080))
        assertFalse(core.requestKeyframe(s1, 1))
        // A Stop: nothing is bound, and nothing is asked.
        m.stopFromMac(mac, "stop", s1, "person", null)
        core.close()
        assertFalse(core.requestKeyframe(s1, 2))
        assertTrue("neither encoder was asked", backend.keyframes.isEmpty())
        assertEquals(0 to 2, core.macKeyframesAsked to core.macKeyframesNotAsked)
    }
}
