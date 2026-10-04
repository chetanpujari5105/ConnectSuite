package com.chetan.connectsuite.camera.webcam

import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraDevice
import android.os.PowerManager
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.protocol.Capability
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The release gate and its call site, the capability's two halves, the shared vocabulary fixture, the
 * platform mappings, and what this build deliberately does **not** do yet: the app does not install it.
 */
class WebcamReleaseGateTest {

    private fun source(path: String) = File(path).readText()

    @Test
    fun `a release build never installs the webcam, and release activation is off`() {
        assertFalse(WebcamReleaseGate.allows(debuggable = false))
        assertTrue(WebcamReleaseGate.allows(debuggable = true))
        assertFalse(Extensions.WEBCAM_RELEASE)
        assertTrue("the flag is the only other way in", WebcamReleaseGate.allows(debuggable = false, release = true))
    }

    /** A source scan, because `install` needs a `LinkServer` and a `Context` a JVM test cannot build. */
    @Test
    fun `install consults the gate before taking the claim or registering a handler`() {
        val body = source("src/main/java/com/chetan/connectsuite/camera/webcam/WebcamFeature.kt").substringAfter("fun install(")
        val gate = body.indexOf("WebcamReleaseGate.allows(server.debuggable)")
        val sink = body.indexOf("server.webcamChannelSink =")
        val register = body.indexOf("server.register(")
        assertTrue("the gate is not consulted", gate >= 0)
        assertTrue("the claim is taken before the gate", sink > gate)
        assertTrue("a handler is registered before the gate", register > gate)
        assertTrue(body.substring(gate, sink).contains("return false"))
    }

    /**
     * Not wired, on purpose: wiring is a separate approval. This fails the day someone wires it, so the
     * wiring commit has to update this test and say so.
     */
    @Test
    fun `the running app does not install the webcam yet, nor take its claim`() {
        val app = source("../app/src/main/java/com/chetan/connectsuite/ConnectSuiteApp.kt")
        assertFalse("the app installs the webcam — update this test in the approved wiring commit", app.contains("WebcamFeature"))
        assertFalse(app.contains("webcamChannelSink"))
        // Control: the file read is the app's, which does install Camera v1.
        assertTrue(app.contains("CameraFeature.install(this, link"))
    }

    @Test
    fun `the handlers this feature registers are exactly the capability's requests`() {
        val contract = CapabilityContract.contracts.getValue(Capability.WEBCAM)
        assertEquals(contract.requests, WebcamFeature.handledTypes)
        assertTrue(contract.needsWebcamChannel)
        assertFalse("Camera v1's claim is not the webcam's", contract.needsCameraChannel)
    }

    @Test
    fun `the module asks for the camera and never for the microphone, and no screen is exported`() {
        val manifest = source("src/main/AndroidManifest.xml").replace(Regex("<!--[\\s\\S]*?-->"), "")
        val permissions = Regex("""<uses-permission\s+android:name="([^"]+)"""").findAll(manifest).map { it.groupValues[1] }.toList()
        assertEquals(listOf("android.permission.CAMERA"), permissions)
        assertTrue("control: the webcam screen is declared", manifest.contains(".webcam.WebcamActivity"))
        assertFalse(Regex("""android:exported="true"""").containsMatchIn(manifest))
    }

    @Test
    fun `no foreground service, no background start, no audio, no recording - the webcam package names none of them`() {
        val dir = File("src/main/java/com/chetan/connectsuite/camera/webcam")
        val files = dir.listFiles { f -> f.name.endsWith(".kt") }!!.toList()
        assertTrue("control: the package was read", files.size >= 8)
        // Comments stripped first: the KDoc says what is absent, and a search over it finds the sentence.
        val code = files.joinToString("\n") { f ->
            f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")
        }
        for (forbidden in listOf("startForeground", "ForegroundService", "AudioRecord", "MediaRecorder", "RECORD_AUDIO", "MediaMuxer", "ImageReader", "takePicture")) {
            assertFalse("the webcam code uses $forbidden", code.contains(forbidden))
        }
        assertTrue("control: the code is real", code.contains("MediaCodec") && code.contains("openCamera"))
    }

    @Test
    fun `the closed vocabularies are the shared fixture's`() {
        val fixture = Json.parseToJsonElement(
            listOf("../docs/fixtures/webcam-vocabulary-v1.json", "docs/fixtures/webcam-vocabulary-v1.json").map(::File).first { it.isFile }.readText(),
        ).jsonObject
        val causes = fixture["stopCauses"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
        assertEquals(causes, WebcamStopCause.entries.associate { it.wire to it.reason.wire })
        val details = fixture["failureDetails"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(details, WebcamFailureDetail.entries.mapNotNull { it.wire })
        val reasons = fixture["stoppedReasons"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
        assertEquals(reasons, WebcamStopReason.entries.mapNotNull { it.wire }.toSet())
    }

    @Test
    fun `the thermal boundary is the platform's own constant`() {
        assertEquals(PowerManager.THERMAL_STATUS_CRITICAL, WebcamThermal.CRITICAL)
        assertFalse(WebcamThermal.mustStop(PowerManager.THERMAL_STATUS_SEVERE))
        assertTrue(WebcamThermal.mustStop(PowerManager.THERMAL_STATUS_EMERGENCY))
        assertTrue(WebcamThermal.mustStop(PowerManager.THERMAL_STATUS_SHUTDOWN))
    }

    @Test
    fun `camera failures end the session by the right name`() {
        assertEquals(WebcamStopReason.CAMERA_IN_USE, WebcamCaptureMappings.forDeviceError(CameraDevice.StateCallback.ERROR_CAMERA_IN_USE))
        assertEquals(WebcamStopReason.CAMERA_IN_USE, WebcamCaptureMappings.forDeviceError(CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE))
        assertEquals(WebcamStopReason.CAMERA_IN_USE, WebcamCaptureMappings.forDeviceError(CameraDevice.StateCallback.ERROR_CAMERA_DISABLED))
        assertEquals(WebcamStopReason.CAMERA_UNAVAILABLE, WebcamCaptureMappings.forDeviceError(CameraDevice.StateCallback.ERROR_CAMERA_DEVICE))
        assertEquals(WebcamStopReason.CAMERA_UNAVAILABLE, WebcamCaptureMappings.forDeviceError(CameraDevice.StateCallback.ERROR_CAMERA_SERVICE))
        assertEquals(WebcamStopReason.CAMERA_IN_USE, WebcamCaptureMappings.forAccessException(CameraAccessException.CAMERA_IN_USE))
        assertEquals(WebcamStopReason.CAMERA_UNAVAILABLE, WebcamCaptureMappings.forAccessException(CameraAccessException.CAMERA_ERROR))
    }

    @Test
    fun `the AE range closest to the target is chosen, preferring a fixed one`() {
        assertEquals(30 to 30, WebcamCaptureMappings.fpsRange(listOf(15 to 30, 30 to 30, 7 to 30, 24 to 24), 30))
        assertEquals(15 to 30, WebcamCaptureMappings.fpsRange(listOf(15 to 30, 7 to 30), 30))
        assertEquals(24 to 24, WebcamCaptureMappings.fpsRange(listOf(15 to 15, 24 to 24), 30))
    }

    @Test
    fun `the request copy says who asked - an app is never worded as the Mac's owner`() {
        assertTrue(WebcamCopy.requestTitle("MacBook", WebcamTrigger.CONSUMER).startsWith("An app on MacBook"))
        assertTrue(WebcamCopy.requestTitle("MacBook", WebcamTrigger.PERSON).startsWith("MacBook is asking"))
        assertTrue(WebcamCopy.REQUEST_BODY.contains("is not the same as allowing it here"))
        assertTrue(WebcamCopy.REQUEST_BODY.contains("no sound"))
    }
}
