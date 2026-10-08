package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The phone says *"No cloud, no account, nothing leaves your network"* (`ConnectMacScreen`). It was
 * untrue while the QR scanner was Google ML Kit (usage metrics; `datatransport`'s CCT backend in the
 * APK). This keeps the pieces that made it untrue out of every build file.
 *
 * **What it cannot see:** a library that pulls them in transitively. The release dependency graph and
 * merged manifest are read at release time (`docs/release-candidate-2026-10-09.md`); this is the cheap
 * half that fails on the commit that adds one directly.
 */
class NoGoogleTelemetryTest {

    private fun file(path: String): File = listOf(File(path), File("../$path")).first { it.isFile }

    private val banned = Regex("""com\.google\.(mlkit|android\.gms|android\.datatransport|firebase)|play-services|mlkit""")

    @Test
    fun `no build file declares ML Kit, Play services, Firebase or datatransport`() {
        val files = listOf("gradle/libs.versions.toml", "app/build.gradle.kts", "core/build.gradle.kts",
            "sync-module/build.gradle.kts", "mirror-module/build.gradle.kts", "input-module/build.gradle.kts",
            "camera-module/build.gradle.kts", "build.gradle.kts")
        val hits = files.flatMap { path ->
            file(path).readLines().withIndex()
                .filter { (_, line) -> !line.trimStart().startsWith("//") && !line.trimStart().startsWith("#") && banned.containsMatchIn(line) }
                .map { (i, line) -> "$path:${i + 1}: ${line.trim()}" }
        }
        assertEquals(emptyList<String>(), hits)
    }

    @Test
    fun `control - the scanner's replacement is declared, so the files above were really read`() {
        assertTrue(file("gradle/libs.versions.toml").readText().contains("com.google.zxing"))
        assertTrue(banned.containsMatchIn("""mlkit-barcode-scanning = { group = "com.google.mlkit" }"""))
    }
}
