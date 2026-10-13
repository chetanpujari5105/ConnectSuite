package com.chetan.connectsuite.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Which hardware Google Play may require before it shows Sidekick to a device.
 *
 * Play treats a permission as a hardware requirement unless the manifest says otherwise:
 * `CAMERA` implies a back camera, `ACCESS_*_LOCATION` imply location hardware. Each implied
 * requirement hides the app from every device without that hardware, so each one is a decision,
 * and this test holds both:
 *
 *  - **Location is optional.** Nothing reads a location. The permissions exist (API <= 32 only)
 *    because Wi-Fi Direct discovery needs them, and that needs the permission, not the hardware.
 *  - **The back camera stays required.** `QrScanScreen` binds `DEFAULT_BACK_CAMERA`, and pairing
 *    has no other path on the phone. A device without one could install Sidekick and never pair.
 */
class ManifestFeaturesTest {

    private val root: File = listOf(File(".."), File("."))
        .map { it.canonicalFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("Cannot find the repository root from ${File(".").canonicalPath}")

    private val manifest =
        File(root, "app/src/main/AndroidManifest.xml").readText().replace(Regex("""<!--[\s\S]*?-->"""), "")

    private fun optional(feature: String) = Regex(
        """<uses-feature\s+android:name="${Regex.escape(feature)}"\s+android:required="false"\s*/>""",
    ).containsMatchIn(manifest)

    private fun mainKotlin(): List<File> = root.walkTopDown()
        .onEnter { it.name != "build" && it.name != "node_modules" && !it.name.startsWith(".") }
        .filter { it.isFile && it.extension == "kt" && it.path.contains("/src/main/") }
        .toList()

    private fun code(file: File): String = file.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .joinToString("\n") { it.replace(Regex("""(^|\s)//.*$"""), "") }

    @Test
    fun `the manifest declares location hardware optional`() {
        // Control: the reader sees declarations it already knows about.
        assertTrue(optional("android.hardware.camera.any"))
        listOf("android.hardware.location", "android.hardware.location.gps", "android.hardware.location.network")
            .forEach { assertTrue("$it must be declared required=false", optional(it)) }
    }

    @Test
    fun `nothing in the app reads a location, so optional location hardware is honest`() {
        val files = mainKotlin()
        assertTrue("scanned too few files: ${files.size}", files.size > 100)
        val apis = listOf("LocationManager", "FusedLocationProvider", "getLastKnownLocation",
            "requestLocationUpdates", "import android.location.")
        val uses = files.flatMap { f -> apis.filter { code(f).contains(it) }.map { "${f.relativeTo(root)}: $it" } }
        assertEquals(emptyList<String>(), uses)
    }

    @Test
    fun `the back camera stays required, because pairing scans with it and has no other path`() {
        val scanner = File(root, "app/src/main/java/com/chetan/connectsuite/link/QrScanScreen.kt")
        assertTrue(code(scanner).contains("CameraSelector.DEFAULT_BACK_CAMERA"))
        assertFalse(
            "android.hardware.camera is required for pairing; marking it optional would list Sidekick " +
                "on devices that can never pair",
            optional("android.hardware.camera"),
        )
    }
}
