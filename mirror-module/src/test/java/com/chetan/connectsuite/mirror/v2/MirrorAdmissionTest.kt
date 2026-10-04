package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.app.CaptureAdmission
import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The mirror's start gate — docs/protocol.md → Mirror coexistence. The webcam's open state is an
 * injected boolean here; `CaptureCoexistenceTest` in `:app` drives it with the production webcam machine
 * through the app's own wiring.
 */
class MirrorAdmissionTest {

    @Test
    fun `a start is refused while a webcam is open, and nothing is recorded as starting`() {
        val gate = MirrorAdmissionGate()
        gate.webcamOpen = { true }
        assertSame(MirrorFailure.CaptureBusy, gate.tryBegin())
        assertFalse(gate.isStarting)
        gate.webcamOpen = { false }
        assertNull(gate.tryBegin())
        assertTrue(gate.isStarting)
        gate.end()
        assertFalse(gate.isStarting)
        gate.end()
        assertFalse("an extra end never goes negative", gate.isStarting)
    }

    @Test
    fun `the refusal is the camera-busy code with a sentence naming the webcam, and asks for no stop`() {
        val f = MirrorFailure.CaptureBusy
        assertEquals(ErrorCode.CAMERA_BUSY, f.code)
        assertTrue(f.reason, f.reason.contains("webcam"))
        assertEquals("capture-busy", f.label)
        assertEquals("Stop the webcam first, then start mirroring again.", f.fixHint)
    }

    @Test
    fun `busy - running, waiting for consent, coming up, or being admitted - and never when idle or stopped`() {
        val gate = MirrorAdmissionGate()
        for (phase in MirrorPhase.entries) {
            val expected = phase in setOf(MirrorPhase.AWAITING_FOREGROUND, MirrorPhase.REQUESTING_CONSENT, MirrorPhase.STARTING)
            assertEquals(phase.name, expected, gate.busy(running = false, phase = phase))
        }
        assertTrue(gate.busy(running = true, phase = MirrorPhase.IDLE))
        gate.tryBegin()
        assertTrue("between admission and the first published phase", gate.busy(running = false, phase = MirrorPhase.IDLE))
    }

    @Test
    fun `the app's gate admits under the shared capture lock`() {
        assertSame(CaptureAdmission.lock, MirrorAdmission.gate.lock)
    }

    /** `MirrorEngine` needs a `Context` and a `ControlSession`; the order of its first lines is read instead. */
    @Test
    fun `both start routes ask the gate before touching any session state, and release it after`() {
        val engine = File("src/main/java/com/chetan/connectsuite/mirror/v2/MirrorEngine.kt").readText()
        for ((route, admitted) in listOf("fun start(" to "startAdmitted(", "fun startFromPhone(" to "startFromPhoneAdmitted(")) {
            val body = engine.substringAfter(route).substringBefore("\n    }\n")
            val gate = body.indexOf("MirrorAdmission.gate.tryBegin()")
            assertTrue("$route does not ask the gate", gate >= 0)
            assertTrue("$route touches state before the gate", body.indexOf("owner =").let { it < 0 || it > gate })
            assertTrue("$route does not end what it began", body.contains("finally {\n            MirrorAdmission.gate.end()"))
            assertTrue(body.indexOf(admitted) > gate)
        }
    }
}
