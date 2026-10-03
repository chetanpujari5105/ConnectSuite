package com.chetan.connectsuite.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The camera screen's open / switch / close (defect 169), driven against the **real** session machine:
 * `isCurrent` is `CameraSessionMachine.isCurrentCamera`, so "the stream had ended" is the machine's own
 * answer and not a flag the test sets.
 *
 * What this cannot reach: CameraX itself, the main-thread `Handler`, and `runOnUiThread`. The backend is
 * a recorder whose `whenReady` callbacks are released by hand, in the orders the main thread can produce.
 * That the activity routes every open and close through [CameraHostCore] is held by a source scan below.
 */
class CameraHostCoreTest {

    private class Owner

    private val mac = Owner()
    private val streamA = "0123456789abcdef0123456789abcdef"
    private val streamB = "fedcba9876543210fedcba9876543210"
    private val t0 = 1_000_000L

    private class RecordingBackend : CameraBackend {
        val pending = ArrayDeque<(Boolean) -> Unit>()
        val bound = mutableListOf<Triple<String, CameraFacing, Int>>()
        var unbinds = 0
        var cameras = setOf(CameraFacing.BACK, CameraFacing.FRONT)
        var bindThrows = false

        override fun whenReady(then: (ready: Boolean) -> Unit) {
            pending.addLast(then)
        }

        override fun hasCamera(facing: CameraFacing) = facing in cameras

        override fun bind(streamId: String, facing: CameraFacing, epoch: Int) {
            if (bindThrows) throw IllegalStateException("bind refused")
            bound += Triple(streamId, facing, epoch)
        }

        override fun unbind() {
            unbinds++
        }

        /** The provider comes up: run the oldest waiting callback, as the main thread would. */
        fun ready(ok: Boolean = true) = pending.removeFirst()(ok)
    }

    private class Rig {
        val machine = CameraSessionMachine<Owner>()
        val backend = RecordingBackend()
        val failures = mutableListOf<Pair<String, CameraStopReason>>()
        val lines = mutableListOf<String>()
        val core = CameraHostCore(
            backend = backend,
            isCurrent = machine::isCurrentCamera,
            failed = { id, reason -> failures += id to reason },
            log = { lines += it },
        )
    }

    /** A stream the owner has approved: `starting`, epoch 0, camera asked to open. */
    private fun Rig.approved(streamId: String = streamA): Rig {
        machine.request(mac, "mac", "req", "back", streamId, t0, hasCamera = true, mirrorBusy = false, route = CameraRequestRoute.SCREEN)
        val open = machine.approve(streamId, CameraFacing.BACK, t0 + 1_000).filterIsInstance<CameraEffect.OpenCamera>().single()
        core.open(open.streamId, open.facing, open.epoch)
        return this
    }

    @Test
    fun `an approved stream binds its camera once the provider is up`() {
        val rig = Rig().approved()
        assertTrue("nothing binds before the provider is up", rig.backend.bound.isEmpty())
        rig.backend.ready()
        assertEquals(listOf(Triple(streamA, CameraFacing.BACK, 0)), rig.backend.bound)
        assertTrue(rig.lines.contains("Camera bound: back, epoch 0"))
    }

    /**
     * Defect 169 itself: the stream ends **in the machine**, and the provider comes up before the close
     * reaches the main thread. The first version read the published state here, which still said live.
     */
    @Test
    fun `a provider that comes up after the stream ended, before its close arrives, binds nothing`() {
        val rig = Rig().approved()
        rig.machine.stopFromMac(mac, "stop", streamA) // the close for this is still on its way
        rig.backend.ready()
        assertTrue("the camera was bound for an ended stream: ${rig.backend.bound}", rig.backend.bound.isEmpty())
        assertTrue(rig.lines.any { it.contains("not bound: the stream had ended") })
        // And when the close does arrive, there is nothing to release.
        assertFalse(rig.core.close())
        assertEquals(0, rig.core.releases)
    }

    @Test
    fun `a close that reaches the main thread before the provider invalidates the open`() {
        val rig = Rig().approved()
        rig.machine.stopFromMac(mac, "stop", streamA)
        rig.core.close()
        rig.backend.ready()
        assertTrue(rig.backend.bound.isEmpty())
        assertTrue(rig.lines.any { it.contains("not bound: superseded") })
    }

    @Test
    fun `a start deadline or a session end while the camera is coming up binds nothing either`() {
        val timedOut = Rig().approved()
        timedOut.machine.timerFired(CameraTimer.START, streamA, t0 + 1_000 + CameraSessionMachine.START_TIMEOUT_MS)
        timedOut.backend.ready()
        assertTrue(timedOut.backend.bound.isEmpty())

        val disconnected = Rig().approved()
        disconnected.machine.sessionEnded(mac)
        disconnected.backend.ready()
        assertTrue(disconnected.backend.bound.isEmpty())
    }

    @Test
    fun `a switch while the first open is still pending binds only the new camera`() {
        val rig = Rig().approved()
        val switch = rig.machine.switch(mac, "sw", streamA, "front") { true }
            .filterIsInstance<CameraEffect.SwitchCamera>().single()
        rig.core.open(switch.streamId, switch.facing, switch.epoch)
        rig.backend.ready() // the epoch-0 open, superseded
        rig.backend.ready() // the epoch-1 open
        assertEquals(listOf(Triple(streamA, CameraFacing.FRONT, 1)), rig.backend.bound)
    }

    @Test
    fun `a stream that ends while switching binds nothing new and releases the old camera once`() {
        val rig = Rig().approved()
        rig.backend.ready()
        val switch = rig.machine.switch(mac, "sw", streamA, "front") { true }
            .filterIsInstance<CameraEffect.SwitchCamera>().single()
        rig.core.open(switch.streamId, switch.facing, switch.epoch)
        rig.machine.stopFromMac(mac, "stop", streamA)
        rig.backend.ready() // the switch's provider callback lands before the close
        assertEquals("only the first camera was ever bound", 1, rig.backend.bound.size)
        assertTrue(rig.core.close())
        assertFalse(rig.core.close())
        assertEquals(1, rig.core.releases)
        assertEquals(1, rig.backend.unbinds)
    }

    @Test
    fun `a switch releases the replaced camera once, and the end releases the new one once`() {
        val rig = Rig().approved()
        rig.backend.ready()
        val switch = rig.machine.switch(mac, "sw", streamA, "front") { true }
            .filterIsInstance<CameraEffect.SwitchCamera>().single()
        rig.core.open(switch.streamId, switch.facing, switch.epoch)
        rig.backend.ready()
        assertEquals(2, rig.core.binds)
        assertEquals("the replaced camera", 1, rig.core.releases)
        rig.core.close() // the stream's end
        rig.core.close() // the screen's destroy
        assertEquals(2, rig.core.releases)
        assertEquals(rig.core.binds, rig.core.releases)
        assertTrue(rig.lines.any { it.contains("released (replaced by a switch)") })
        assertEquals(1, rig.lines.count { it.contains("released (closed)") })
    }

    @Test
    fun `a bind that throws ends the stream as unavailable and leaves nothing bound`() {
        val rig = Rig().approved()
        rig.backend.bindThrows = true
        rig.backend.ready()
        assertEquals(listOf(streamA to CameraStopReason.CAMERA_UNAVAILABLE), rig.failures)
        assertEquals(1, rig.backend.unbinds)
        assertFalse("nothing is bound to release", rig.core.close())
    }

    @Test
    fun `no camera of that facing, or no provider, ends the stream as unavailable`() {
        val noBack = Rig()
        noBack.backend.cameras = setOf(CameraFacing.FRONT)
        noBack.approved()
        noBack.backend.ready()
        assertEquals(listOf(streamA to CameraStopReason.CAMERA_UNAVAILABLE), noBack.failures)

        val noProvider = Rig().approved()
        noProvider.backend.ready(ok = false)
        assertEquals(listOf(streamA to CameraStopReason.CAMERA_UNAVAILABLE), noProvider.failures)
        assertTrue(noProvider.backend.bound.isEmpty())
    }

    @Test
    fun `after a close nothing reopens by itself — a late callback and a returning screen bind nothing`() {
        val rig = Rig().approved()
        rig.backend.ready()
        rig.machine.visibilityLost() // Home
        rig.core.close()
        // A new request for a new stream is a new consent; until it is approved nothing is current.
        rig.machine.request(mac, "mac", "req2", "back", streamB, t0 + 60_000, hasCamera = true, mirrorBusy = false, route = CameraRequestRoute.SCREEN)
        assertFalse(rig.machine.isCurrentCamera(streamA, 0))
        assertFalse(rig.machine.isCurrentCamera(streamB, 0))
        assertTrue(rig.backend.pending.isEmpty())
        assertEquals(1, rig.backend.bound.size)
    }

    // ---- the activity's wiring, which a JVM test cannot run ------------------------------------------

    private val activity = File("src/main/java/com/chetan/connectsuite/camera/CameraActivity.kt").readText()

    @Test
    fun `the activity opens, switches and closes the camera only through the core`() {
        assertTrue(activity.contains("override fun openCamera(streamId: String, facing: CameraFacing, epoch: Int) = runOnUiThread { host.open(streamId, facing, epoch) }"))
        assertTrue(activity.contains("override fun switchCamera(streamId: String, facing: CameraFacing, epoch: Int) = runOnUiThread { host.open(streamId, facing, epoch) }"))
        assertTrue(activity.contains("override fun closeCamera() = runOnUiThread { host.close() }"))
        assertTrue(activity.contains("isCurrent = CameraEngine::isCurrentCamera"))
        assertEquals("one bindToLifecycle, inside the backend", 1, Regex("bindToLifecycle\\(").findAll(activity).count())
    }

    @Test
    fun `the backend never decides currency from the published screen state`() {
        val backend = activity.substringAfter("private inner class CameraXBackend").substringBefore("\n    }\n\n")
        assertNotNull(backend)
        assertFalse("the backend reads ui.value again", backend.contains("ui.value"))
    }

    @Test
    fun `the screen being destroyed releases through the core and invalidates pending opens`() {
        val destroy = activity.substringAfter("override fun onDestroy()").substringBefore("\n    }\n")
        assertTrue(destroy.contains("host.close()"))
        assertFalse(destroy.contains("unbind()"))
    }

    /** No automatic capture restart after returning to the app: the lifecycle callbacks open nothing. */
    @Test
    fun `returning to the camera screen opens no camera and approves nothing`() {
        for (callback in listOf("override fun onStart()", "override fun onResume()", "override fun onRestart()")) {
            if (!activity.contains(callback)) continue
            val body = activity.substringAfter(callback).substringBefore("\n    }\n")
            for (forbidden in listOf("host.open", "approve(", "openCamera(", "bindToLifecycle")) {
                assertFalse("$callback calls $forbidden", body.contains(forbidden))
            }
        }
        val approvals = Regex("CameraEngine\\.approve\\(").findAll(activity).count()
        assertEquals("approve is reached only from Start camera and the permission answer to it", 2, approvals)
        assertTrue(activity.substringAfter("private fun startTapped(").contains("CameraEngine.approve(streamId, facing)"))
    }
}
