package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraRequestRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Open, switch and close against a **recording stand-in** for Camera2 and MediaCodec, with the real
 * [WebcamSessionMachine] deciding what is still wanted — so "a late camera or codec callback cannot
 * reopen an ended session" is tested through the same question the activity asks, under the same lock.
 */
class WebcamCaptureCoreTest {

    /** STAND-IN for Camera2 + MediaCodec: holds each open's answer until the test delivers it. */
    private class RecordingBackend : WebcamCaptureBackend {
        val pending = mutableListOf<Pair<String, (WebcamCaptureBackend.Outcome) -> Unit>>()
        val released = mutableListOf<Any>()
        val keyframes = mutableListOf<Any>()
        override fun open(sessionId: String, facing: CameraFacing, generation: Int, done: (WebcamCaptureBackend.Outcome) -> Unit) {
            pending += "$sessionId/${facing.wire}/$generation" to done
        }
        override fun release(handle: Any) {
            released += handle
        }
        override fun requestKeyframe(handle: Any) {
            keyframes += handle
        }
        fun answer(i: Int, outcome: WebcamCaptureBackend.Outcome) = pending[i].second(outcome)
    }

    private val owner = Any()
    private val s1 = "0123456789abcdef0123456789abcdef"
    private val s2 = "fedcba9876543210fedcba9876543210"

    private class Rig {
        val machine = WebcamSessionMachine<Any>()
        val backend = RecordingBackend()
        val failures = mutableListOf<Pair<String, WebcamStopReason>>()
        val log = mutableListOf<String>()
        val core = WebcamCaptureCore(backend, machine::isCurrentCapture, { s, r -> failures += s to r }, { log += it })
    }

    private fun Rig.approved(sessionId: String = s1) {
        machine.request(owner, "mac", "r", null, "consumer", sessionId, 0, true, null, CameraRequestRoute.SCREEN)
        machine.approve(sessionId, CameraFacing.FRONT, 1, null, 0)
    }

    private fun opened(handle: String) = WebcamCaptureBackend.Outcome.Opened(handle, 1920, 1080)

    @Test
    fun `an open answered in time is bound, and released exactly once`() {
        val r = Rig()
        r.approved()
        r.core.open(s1, CameraFacing.FRONT, 1)
        r.backend.answer(0, opened("cam-1"))
        assertTrue(r.core.isBound)
        r.core.requestKeyframe()
        assertEquals(listOf<Any>("cam-1"), r.backend.keyframes)
        assertTrue(r.core.close())
        assertFalse(r.core.close())
        assertEquals(listOf<Any>("cam-1"), r.backend.released)
        assertEquals(1, r.core.opened)
        assertEquals(1, r.core.released)
    }

    @Test
    fun `a capture that comes up after its session ended is released unused - it cannot reopen the session`() {
        val r = Rig()
        r.approved()
        r.core.open(s1, CameraFacing.FRONT, 1)
        // The owner taps Stop while Camera2 is still opening.
        r.machine.stopFromPhone()
        r.backend.answer(0, opened("late"))
        assertFalse(r.core.isBound)
        assertEquals(listOf<Any>("late"), r.backend.released)
        assertEquals(1, r.core.lateReleases)
        assertEquals(0, r.core.opened)
        r.core.requestKeyframe()
        assertTrue("nothing bound, nothing asked", r.backend.keyframes.isEmpty())
    }

    @Test
    fun `the machine is asked, not the ticket alone - an end whose close was not yet posted still blocks the bind`() {
        val r = Rig()
        r.approved()
        r.core.open(s1, CameraFacing.FRONT, 1)
        // The session ends and a new one is approved, but the activity's close() has not run yet.
        r.machine.stopFromMac(owner, "x", s1, "person", null)
        r.approved(s2)
        r.backend.answer(0, opened("for-s1"))
        assertFalse(r.core.isBound)
        assertEquals(listOf<Any>("for-s1"), r.backend.released)
    }

    @Test
    fun `a switch replaces the bound capture - the old one released once, a stale generation's late open released unused`() {
        val r = Rig()
        r.approved()
        r.machine.offerChannel(owner, s1)
        r.core.open(s1, CameraFacing.FRONT, 1)
        r.backend.answer(0, opened("front"))
        r.machine.switch(owner, "sw", s1, "back") { true }
        r.core.open(s1, CameraFacing.BACK, 2)
        r.backend.answer(1, opened("back"))
        assertEquals(listOf<Any>("front"), r.backend.released)
        // A second switch races ahead of a slow open: the slow one is released unused.
        r.machine.switch(owner, "sw2", s1, "front") { true }
        r.core.open(s1, CameraFacing.FRONT, 3)
        r.machine.switch(owner, "sw3", s1, "back") { true }
        r.core.open(s1, CameraFacing.BACK, 4)
        r.backend.answer(2, opened("slow-front"))
        r.backend.answer(3, opened("back-again"))
        assertEquals(listOf<Any>("front", "slow-front", "back"), r.backend.released)
        assertEquals(1, r.core.lateReleases)
        assertTrue(r.core.close())
        assertEquals(listOf<Any>("front", "slow-front", "back", "back-again"), r.backend.released)
        // Every capture that came up was released exactly once.
        assertEquals(r.core.opened + r.core.lateReleases, r.backend.released.size)
        assertEquals(r.backend.released.size, r.backend.released.toSet().size)
    }

    @Test
    fun `a failure ends a wanted session by its reason, and a failure for an unwanted one ends nothing`() {
        val r = Rig()
        r.approved()
        r.core.open(s1, CameraFacing.FRONT, 1)
        r.backend.answer(0, WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_IN_USE, "in use"))
        assertEquals(listOf(s1 to WebcamStopReason.CAMERA_IN_USE), r.failures)
        val q = Rig()
        q.approved()
        q.core.open(s1, CameraFacing.FRONT, 1)
        q.core.close()
        q.backend.answer(0, WebcamCaptureBackend.Outcome.Failed(WebcamStopReason.CAMERA_IN_USE, "in use"))
        assertTrue(q.failures.isEmpty())
    }
}
