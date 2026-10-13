package com.chetan.connectsuite.setup

import com.chetan.connectsuite.onboarding.OnboardingCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Play build: no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and nothing fires the one-tap request.
 *
 * Google Play allows that permission only for listed use cases, and the nearest one (a companion
 * that keeps a persistent connection to give a peripheral internet access) does not describe
 * Sidekick. The app opens the battery-optimisation list instead. This reads the manifest and the
 * sources from disk, which is the only place the decision lives.
 *
 * What it cannot see: a library's manifest merging the permission back in. Only the merged release
 * manifest shows that, so the AAB audit reads it there.
 */
class BatteryExemptionPolicyTest {

    private val root: File = listOf(File(".."), File("."))
        .map { it.canonicalFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("Cannot find the repository root from ${File(".").canonicalPath}")

    private val manifest = File(root, "app/src/main/AndroidManifest.xml")

    /** Manifest without XML comments, so the comment explaining the absence is not read as a use. */
    private fun manifestCode() = manifest.readText().replace(Regex("""<!--[\s\S]*?-->"""), "")

    @Test
    fun `the manifest is readable and declares permissions at all`() {
        // Control: an absence below only means something if this file is the real manifest.
        assertTrue(manifest.isFile)
        assertTrue(manifestCode().contains("android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE"))
    }

    @Test
    fun `the manifest does not declare the battery-exemption permission`() {
        assertTrue(
            "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is back in the app manifest",
            !manifestCode().contains("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"),
        )
    }

    @Test
    fun `no source fires the one-tap exemption request`() {
        val files = root.walkTopDown()
            .onEnter { it.name != "build" && it.name != "node_modules" && !it.name.startsWith(".") }
            .filter { it.isFile && it.extension == "kt" && it.path.contains("/src/main/") }
            .toList()
        assertTrue("scanned too few files: ${files.size}", files.size > 100)
        val uses = files.filter { file ->
            file.readText()
                .replace(Regex("""/\*[\s\S]*?\*/"""), "")
                .lines()
                .any { line ->
                    line.replace(Regex("""(^|\s)//.*$"""), "")
                        .contains("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS")
                }
        }.map { it.relativeTo(root).path }
        assertEquals(emptyList<String>(), uses)
    }

    @Test
    fun `onboarding's battery button names where it goes`() {
        val label = OnboardingCopy.reliability.body[5]
        assertEquals("Open battery settings", label)
        assertNotEquals(OnboardingCopy.ALLOW, label)
        assertTrue(OnboardingCopy.reliability.body[1].contains(SetupPlan.BATTERY_STEPS))
    }
}
