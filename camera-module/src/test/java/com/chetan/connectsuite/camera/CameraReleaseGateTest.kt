package com.chetan.connectsuite.camera

import androidx.camera.core.CameraState
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The release gate, the capability contract's two halves, and the two platform mappings.
 */
class CameraReleaseGateTest {

    private fun source(path: String) = File(path).readText()

    @Test
    fun `a release build never installs Camera v1`() {
        assertFalse(CameraReleaseGate.allows(debuggable = false))
        assertTrue(CameraReleaseGate.allows(debuggable = true))
    }

    /**
     * The gate is only worth its call site: it must run before anything that would turn the
     * capability on. A source scan, because `install` needs a `LinkServer` and a `Context` that a JVM
     * test cannot build — and it says so rather than pretending to have run it.
     */
    @Test
    fun `install consults the gate before taking the claim or registering a handler`() {
        val feature = source("src/main/java/com/chetan/connectsuite/camera/CameraFeature.kt")
        val body = feature.substringAfter("fun install(")
        val gate = body.indexOf("CameraReleaseGate.allows(server.debuggable)")
        val sink = body.indexOf("server.cameraChannelSink =")
        val register = body.indexOf("server.register(")
        assertTrue("the gate is not consulted", gate >= 0)
        assertTrue("the claim is taken before the gate", sink > gate)
        assertTrue("a handler is registered before the gate", register > gate)
        assertTrue(body.substring(gate, sink).contains("return false"))
    }

    @Test
    fun `the app installs the camera only through the gated install`() {
        val app = source("../app/src/main/java/com/chetan/connectsuite/ConnectSuiteApp.kt")
        assertTrue(app.contains("CameraFeature.install(this, link"))
        assertFalse("the app wires the claim itself", app.contains("cameraChannelSink"))
    }

    @Test
    fun `the handlers this feature registers are exactly the capability's requests`() {
        val contract = CapabilityContract.contracts.getValue(Capability.CAMERA)
        assertEquals(contract.requests, CameraFeature.handledTypes)
        assertTrue(contract.needsCameraChannel)
    }

    @Test
    fun `camera is advertised only with both halves, and never on the permission alone`() {
        fun advertised(registered: Set<String>, cameraServed: Boolean) = Capability.CAMERA in CapabilityContract.advertisable(
            grantedPermissions = setOf("android.permission.CAMERA"),
            specialAccessHeld = emptySet(),
            registeredTypes = registered,
            videoServed = true,
            cameraServed = cameraServed,
            bulkServed = true,
            backgroundRestricted = false,
        )
        assertFalse("permission alone", advertised(emptySet(), cameraServed = false))
        assertFalse("handlers without the claim", advertised(CameraFeature.handledTypes, cameraServed = false))
        assertFalse("the claim without handlers", advertised(emptySet(), cameraServed = true))
        assertTrue(advertised(CameraFeature.handledTypes, cameraServed = true))
    }

    @Test
    fun `the module asks for the camera and never for the microphone`() {
        // Comments stripped first: the manifest's own comment says there is "deliberately no
        // RECORD_AUDIO here", and a text search over it finds the sentence forbidding the thing.
        val manifest = source("src/main/AndroidManifest.xml").replace(Regex("<!--[\\s\\S]*?-->"), "")
        val permissions = Regex("""<uses-permission\s+android:name="([^"]+)"""").findAll(manifest).map { it.groupValues[1] }.toList()
        assertEquals(listOf("android.permission.CAMERA"), permissions)
        assertFalse(permissions.any { it.endsWith("RECORD_AUDIO") })
        assertFalse("the camera screen is exported", Regex("""android:exported="true"""").containsMatchIn(manifest))
    }

    @Test
    fun `orientation maps to CameraX's target rotation`() {
        assertEquals(listOf(0, 3, 2, 1, 0), listOf(0, 90, 180, 270, 359).map(CameraMappings::targetRotationFor))
        assertEquals(0, CameraMappings.targetRotationFor(44))
        assertEquals(3, CameraMappings.targetRotationFor(45))
    }

    @Test
    fun `camera errors end the stream by the right name`() {
        assertEquals(CameraStopReason.CAMERA_IN_USE, CameraMappings.stopReasonFor(CameraState.ERROR_CAMERA_IN_USE))
        assertEquals(CameraStopReason.CAMERA_IN_USE, CameraMappings.stopReasonFor(CameraState.ERROR_MAX_CAMERAS_IN_USE))
        assertEquals(CameraStopReason.CAMERA_IN_USE, CameraMappings.stopReasonFor(CameraState.ERROR_CAMERA_DISABLED))
        assertEquals(CameraStopReason.CAMERA_UNAVAILABLE, CameraMappings.stopReasonFor(CameraState.ERROR_CAMERA_FATAL_ERROR))
        assertEquals(CameraStopReason.CAMERA_UNAVAILABLE, CameraMappings.stopReasonFor(CameraState.ERROR_STREAM_CONFIG))
        assertNull("CameraX recovers this one itself", CameraMappings.stopReasonFor(CameraState.ERROR_OTHER_RECOVERABLE_ERROR))
    }
}
