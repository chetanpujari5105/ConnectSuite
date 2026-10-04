package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraEffect
import com.chetan.connectsuite.camera.CameraFacing
import com.chetan.connectsuite.camera.CameraPhase
import com.chetan.connectsuite.camera.CameraRequestRoute
import com.chetan.connectsuite.camera.CameraSessionMachine
import com.chetan.connectsuite.camera.CameraUseArbiter
import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Camera v1 and the webcam share one physical camera — docs/protocol.md → `webcam.request`. Each
 * refuses `CAMERA_BUSY` while the other holds it, neither stops the other, and the two requests'
 * busy checks are one decision ([CameraUseArbiter]). Both **production** machines, wired to the arbiter
 * exactly as their engines wire them; the mirror's busy state is an injected boolean, as the app's
 * lambda supplies it.
 */
class CameraCoexistenceTest {

    private val mac = Any()
    private val s = "0123456789abcdef0123456789abcdef"

    private class Pair2 {
        val arbiter = CameraUseArbiter()
        val v1 = CameraSessionMachine<Any>()
        val webcam = WebcamSessionMachine<Any>()
        var mirrorBusy = false

        init {
            // As CameraEngine.install and WebcamEngine.install register them.
            arbiter.cameraV1Open = { v1.ui().phase != CameraPhase.IDLE }
            arbiter.webcamOpen = webcam::isOpen
        }

        /** Through the arbiter's own decision, the one `CameraEngine.onRequest` calls. */
        fun cameraRequest(owner: Any, id: String) = arbiter.admitCamera { webcamBusy ->
            v1.request(owner, "mac", "c-$id", "back", id, 0, true, mirrorBusy, CameraRequestRoute.SCREEN, webcamBusy = webcamBusy)
        }

        /** Through the arbiter's own decision, the one `WebcamEngine.onRequest` calls. */
        fun webcamRequest(owner: Any, id: String) = arbiter.admitWebcam({ mirrorBusy }) { other ->
            webcam.request(owner, "mac", "w-$id", null, "consumer", id, 0, true, other, CameraRequestRoute.SCREEN)
        }
    }

    @Test
    fun `a webcam session refuses Camera v1 and is left running`() {
        val p = Pair2()
        p.webcamRequest(mac, s)
        p.webcam.approve(s, CameraFacing.FRONT, 1, null, 0)
        val refused = p.cameraRequest(mac, "fedcba9876543210fedcba9876543210")
        val r = refused.filterIsInstance<CameraEffect.Refuse<Any>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, r.code)
        assertTrue(r.message, r.message.contains("webcam"))
        assertEquals(WebcamPhase.STARTING, p.webcam.ui().phase)
        assertEquals(CameraPhase.IDLE, p.v1.ui().phase)
    }

    @Test
    fun `a Camera v1 stream refuses the webcam and is left running`() {
        val p = Pair2()
        p.cameraRequest(mac, s)
        p.v1.approve(s, CameraFacing.BACK, 1)
        val refused = p.webcamRequest(mac, "fedcba9876543210fedcba9876543210")
        assertEquals(ErrorCode.CAMERA_BUSY, refused.filterIsInstance<WebcamEffect.Refuse<Any>>().single().code)
        assertEquals(CameraPhase.STARTING, p.v1.ui().phase)
        assertEquals(WebcamPhase.IDLE, p.webcam.ui().phase)
    }

    @Test
    fun `the mirror refuses the webcam, and neither touches the other`() {
        val p = Pair2()
        p.mirrorBusy = true
        val r = p.webcamRequest(mac, s).filterIsInstance<WebcamEffect.Refuse<Any>>().single()
        assertEquals(ErrorCode.CAMERA_BUSY, r.code)
        assertTrue(r.message.contains("mirroring"))
    }

    /**
     * What no JVM test can reach: each engine is an Android singleton, so the line that passes the
     * arbiter's answer into the machine is checked by reading the source. The decision itself is the
     * arbiter's and is exercised above; this only holds the plumbing to it.
     */
    @Test
    fun `both engines take their busy answer from the arbiter and pass it through`() {
        val camera = java.io.File("src/main/java/com/chetan/connectsuite/camera/CameraEngine.kt").readText()
        assertTrue(camera.contains("CameraUse.arbiter.admitCamera { webcamBusy ->"))
        assertTrue(camera.contains("webcamBusy = webcamBusy,"))
        val webcam = java.io.File("src/main/java/com/chetan/connectsuite/camera/webcam/WebcamEngine.kt").readText()
        assertTrue(webcam.contains("CameraUse.arbiter.admitWebcam(mirrorBusy) { other ->"))
        assertTrue(webcam.contains("otherCapture = other,"))
        assertTrue(webcam.contains("CameraUse.arbiter.webcamOpen = machine::isOpen"))
        assertTrue(camera.contains("CameraUse.arbiter.cameraV1Open = { machine.ui().phase != CameraPhase.IDLE }"))
    }

    @Test
    fun `the arbiter's own answers - what each feature is told, Camera v1 named before the mirror`() {
        val idle = Pair2()
        assertEquals(false, idle.arbiter.admitCamera { it })
        assertEquals(null, idle.arbiter.admitWebcam({ false }) { it })
        assertEquals(OtherCapture.MIRROR, idle.arbiter.admitWebcam({ true }) { it })

        val v1Open = Pair2()
        v1Open.cameraRequest(mac, s)
        assertEquals(OtherCapture.CAMERA_V1, v1Open.arbiter.admitWebcam({ true }) { it })

        val webcamOpen = Pair2()
        webcamOpen.webcamRequest(mac, s)
        assertEquals(true, webcamOpen.arbiter.admitCamera { it })
    }

    @Test
    fun `with the webcam not installed, Camera v1 behaves exactly as before`() {
        val arbiter = CameraUseArbiter() // webcamOpen is its default { false }
        val v1 = CameraSessionMachine<Any>()
        val effects = arbiter.admit {
            v1.request(mac, "mac", "c", "back", s, 0, true, false, CameraRequestRoute.SCREEN, webcamBusy = arbiter.webcamOpen())
        }
        assertEquals(CameraPhase.AWAITING, v1.ui().phase)
        assertEquals(effects, CameraSessionMachine<Any>().request(mac, "mac", "c", "back", s, 0, true, false, CameraRequestRoute.SCREEN))
    }

    @Test
    fun `two requests arriving together on two connections - exactly one is put up, every time`() {
        val pool = Executors.newFixedThreadPool(2)
        try {
            repeat(300) { round ->
                val p = Pair2()
                val barrier = CyclicBarrier(2)
                val done = CountDownLatch(2)
                var camera: List<CameraEffect<Any>> = emptyList()
                var webcam: List<WebcamEffect<Any>> = emptyList()
                pool.execute { barrier.await(); camera = p.cameraRequest(Any(), s); done.countDown() }
                pool.execute { barrier.await(); webcam = p.webcamRequest(Any(), s); done.countDown() }
                assertTrue(done.await(5, TimeUnit.SECONDS))
                val cameraUp = camera.any { it is CameraEffect.Ack<*> }
                val webcamUp = webcam.any { it is WebcamEffect.Ack<*> }
                assertTrue("round $round: camera $cameraUp, webcam $webcamUp", cameraUp xor webcamUp)
                assertEquals(1, listOf(p.v1.ui().phase != CameraPhase.IDLE, p.webcam.isOpen()).count { it })
            }
        } finally {
            pool.shutdownNow()
        }
    }
}
