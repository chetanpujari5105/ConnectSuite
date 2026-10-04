package com.chetan.connectsuite

import com.chetan.connectsuite.camera.CameraEffect
import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraPhase
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.camera.CameraSessionMachine
import com.chetan.connectsuite.camera.CameraUse
import com.chetan.connectsuite.camera.CameraUseArbiter
import com.chetan.connectsuite.camera.webcam.WebcamEffect
import com.chetan.connectsuite.camera.webcam.WebcamPhase
import com.chetan.connectsuite.camera.webcam.WebcamSessionMachine
import com.chetan.connectsuite.camera.webcam.WebcamStopReason
import com.chetan.connectsuite.core.app.CaptureAdmission
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.mirror.v2.MirrorAdmission
import com.chetan.connectsuite.mirror.v2.MirrorAdmissionGate
import com.chetan.connectsuite.mirror.v2.MirrorFailure
import com.chetan.connectsuite.mirror.v2.MirrorPhase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The webcam, Camera v1 and the mirror, admitted against each other **through the app's own wiring**
 * ([CaptureWiring], called by `ConnectSuiteApp` with the singletons) and the production machines and
 * gates. Both directions, and a race. The mirror's running state and phase are **injected** (the mirror
 * engine needs MediaProjection); the webcam and Camera v1 machines are the real ones, registered with the
 * arbiter exactly as their engines' `install` registers them.
 */
class CaptureCoexistenceTest {

    private val s = "0123456789abcdef0123456789abcdef"

    private class Phone {
        val lock = Any()
        val arbiter = CameraUseArbiter(lock)
        val mirror = MirrorAdmissionGate(lock)
        val webcam = WebcamSessionMachine<Any>()
        val v1 = CameraSessionMachine<Any>()
        /** INJECTED: what MirrorEngine would report. */
        var mirrorRunning = false
        var mirrorPhase = MirrorPhase.IDLE
        val mirrorBusy: () -> Boolean

        init {
            CaptureWiring.connect(arbiter, mirror)
            mirrorBusy = CaptureWiring.mirrorBusy(mirror, { mirrorRunning }, { mirrorPhase })
            // As WebcamEngine.install and CameraEngine.install register them.
            arbiter.webcamOpen = webcam::isOpen
            arbiter.cameraV1Open = { v1.ui().phase != CameraPhase.IDLE }
        }

        fun webcamRequest(id: String = "0123456789abcdef0123456789abcdef") = arbiter.admitWebcam(mirrorBusy) { other ->
            webcam.request(Any(), "mac", "w", null, "consumer", id, 0, true, other, CameraRequestRoute.SCREEN)
        }

        fun cameraRequest(id: String = "fedcba9876543210fedcba9876543210") = arbiter.admitCamera { busy ->
            v1.request(Any(), "mac", "c", "back", id, 0, true, mirrorBusy(), CameraRequestRoute.SCREEN, webcamBusy = busy)
        }
    }

    @Test
    fun `a webcam request open - a new mirror start is refused and the webcam is untouched`() {
        val p = Phone()
        p.webcamRequest()
        assertSame(MirrorFailure.CaptureBusy, p.mirror.tryBegin())
        assertEquals(WebcamPhase.AWAITING, p.webcam.ui().phase)
        // Approved and running: still refused, still untouched.
        p.webcam.approve(s, CameraFacing.FRONT, 1, null, 0)
        assertSame(MirrorFailure.CaptureBusy, p.mirror.tryBegin())
        assertEquals(WebcamPhase.STARTING, p.webcam.ui().phase)
        // Once the webcam has ended, the mirror may start.
        p.webcam.stopFromPhone()
        assertNull(p.mirror.tryBegin())
    }

    @Test
    fun `the mirror holding the phone - a webcam request is refused, and the mirror is untouched`() {
        for ((running, phase) in listOf(true to MirrorPhase.RUNNING, false to MirrorPhase.AWAITING_FOREGROUND, false to MirrorPhase.REQUESTING_CONSENT, false to MirrorPhase.STARTING)) {
            val p = Phone()
            p.mirrorRunning = running
            p.mirrorPhase = phase
            val refused = p.webcamRequest().filterIsInstance<WebcamEffect.Refuse<Any>>().single()
            assertEquals("$phase", ErrorCode.CAMERA_BUSY, refused.code)
            assertFalse(p.webcam.isOpen())
        }
    }

    @Test
    fun `a mirror being admitted counts as busy before its first phase is published`() {
        val p = Phone()
        assertNull(p.mirror.tryBegin())
        assertEquals(ErrorCode.CAMERA_BUSY, p.webcamRequest().filterIsInstance<WebcamEffect.Refuse<Any>>().single().code)
        p.mirror.end()
        assertTrue(p.webcamRequest().any { it is WebcamEffect.Ack<*> })
    }

    @Test
    fun `a mirror started between the webcam request and the tap - the tap opens nothing and the mirror stays`() {
        val p = Phone()
        p.webcamRequest()
        // The mirror's own start is refused while the request is open, so this can only be a mirror the
        // phone's owner started some other way; the webcam's tap re-reads the same predicate.
        p.mirrorPhase = MirrorPhase.REQUESTING_CONSENT
        val tap = p.webcam.approve(s, CameraFacing.FRONT, 1, if (p.mirrorBusy()) com.chetan.connectsuite.camera.webcam.OtherCapture.MIRROR else null, 0)
        assertFalse(tap.any { it is WebcamEffect.OpenCapture })
        assertEquals(WebcamStopReason.CAPTURE_BUSY, tap.filterIsInstance<WebcamEffect.Stopped<Any>>().single().reason)
    }

    @Test
    fun `Camera v1's unrelated behaviour is preserved - it still does not refuse the mirror, and still yields to it`() {
        val p = Phone()
        p.cameraRequest()
        assertEquals(CameraPhase.AWAITING, p.v1.ui().phase)
        assertNull("a Camera v1 stream does not block the mirror (unchanged)", p.mirror.tryBegin())
        p.mirror.end()
        val q = Phone()
        q.mirrorRunning = true
        assertEquals(ErrorCode.CAMERA_BUSY, q.cameraRequest().filterIsInstance<CameraEffect.Refuse<Any>>().single().code)
        // And Camera v1 and the webcam still exclude each other.
        val r = Phone()
        r.webcamRequest()
        assertEquals(ErrorCode.CAMERA_BUSY, r.cameraRequest().filterIsInstance<CameraEffect.Refuse<Any>>().single().code)
    }

    @Test
    fun `a webcam request and a mirror start arriving together - exactly one is admitted, every time`() {
        val pool = Executors.newFixedThreadPool(2)
        try {
            repeat(300) { round ->
                val p = Phone()
                val barrier = CyclicBarrier(2)
                val done = CountDownLatch(2)
                var webcamUp = false
                var mirrorUp = false
                pool.execute { barrier.await(); webcamUp = p.webcamRequest().any { it is WebcamEffect.Ack<*> }; done.countDown() }
                pool.execute { barrier.await(); mirrorUp = p.mirror.tryBegin() == null; done.countDown() }
                assertTrue(done.await(5, TimeUnit.SECONDS))
                assertTrue("round $round: webcam $webcamUp, mirror $mirrorUp", webcamUp xor mirrorUp)
            }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `the app's singletons share the one capture lock, and the wiring refuses two locks`() {
        assertSame(CaptureAdmission.lock, CameraUse.arbiter.lock)
        assertSame(CaptureAdmission.lock, MirrorAdmission.gate.lock)
        try {
            CaptureWiring.connect(CameraUseArbiter(Any()), MirrorAdmissionGate(Any()))
            fail("two locks were accepted")
        } catch (_: IllegalStateException) {
        }
    }

    @Test
    fun `ConnectSuiteApp runs this wiring and installs the webcam through its gated install`() {
        val app = listOf("src/main/java/com/chetan/connectsuite/ConnectSuiteApp.kt", "app/src/main/java/com/chetan/connectsuite/ConnectSuiteApp.kt")
            .map(::File).first { it.isFile }.readText()
            // The code, not the prose: the comments above these calls name them.
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")
        assertTrue(app.contains("CaptureWiring.connect(CameraUse.arbiter, MirrorAdmission.gate)"))
        assertTrue(app.contains("CaptureWiring.mirrorBusy(MirrorAdmission.gate, { MirrorEngine.isRunning }, { MirrorEngine.status.value.phase })"))
        assertTrue(app.contains("CameraFeature.install(this, link, mirrorBusy = mirrorBusy)"))
        assertTrue(app.contains("WebcamFeature.install(this, link, mirrorBusy = mirrorBusy)"))
        assertFalse("the app takes the claim itself", app.contains("webcamChannelSink"))
        assertTrue("wiring before either install", app.indexOf("CaptureWiring.connect") < app.indexOf("CameraFeature.install"))
    }
}
