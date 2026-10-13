package com.chetan.connectsuite.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Google Play's Prominent Disclosure Requirement for the SMS and Call Log permissions: the in-app
 * disclosure has to come **before** Android's prompt, every time, from every place that can ask.
 *
 * The copy is tested in [TextsCallsDisclosureTest]. This file tests the gate, and the gate is
 * structural: a disclosure protects nobody if one screen can reach the prompt without it. So it
 * scans every main Kotlin file in the repository, the way `InputDisclosureTest` does for
 * Accessibility settings.
 *
 * **What it does not reach:** a request assembled at runtime from strings, and the dialog drawing
 * on a device. It reads source; its bound is the files it reads, and it says how many it read.
 */
class TextsCallsGateTest {

    /** The repository root, resolved rather than assumed. Gradle runs this from `app/`. */
    private val root: File = listOf(File(".."), File("."))
        .map { it.canonicalFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("Cannot find the repository root from ${File(".").canonicalPath}")

    private fun mainKotlin(): List<File> = root.walkTopDown()
        .onEnter { it.name != "build" && it.name != "node_modules" && !it.name.startsWith(".") }
        .filter { it.isFile && it.extension == "kt" && it.path.contains("/src/main/") }
        .toList()

    /** Code with comments removed, so KDoc explaining the gate does not count as a use. */
    private fun code(file: File): String = file.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .joinToString("\n") { it.replace(Regex("""(^|\s)//.*$"""), "") }

    private val setupScreen = "app/src/main/java/com/chetan/connectsuite/setup/SetupScreen.kt"

    /** The three groups behind the disclosure, as the code names them. */
    private val disclosedGroups = Regex("""PermissionGroup\.(SMS|CALLS|CONTACTS)\b""")

    /** Every manifest permission in those groups. A request naming one directly is a second door. */
    private val disclosedManifest = Regex(
        """Manifest\.permission\.(READ_SMS|RECEIVE_SMS|SEND_SMS|READ_CALL_LOG|READ_PHONE_STATE|CALL_PHONE|ANSWER_PHONE_CALLS|READ_CONTACTS)\b""",
    )

    /** The ways an Android app asks for a runtime permission. */
    private val requestApi = Regex("""RequestMultiplePermissions|RequestPermission\(\)|requestPermissions\(""")

    @Test
    fun `the scan can see the one place that asks today`() {
        // Control: an empty result below must mean "no other door", never "read nothing".
        assertTrue("scanned too few files: ${mainKotlin().size}", mainKotlin().size > 100)
        val askers = mainKotlin().filter { requestApi.containsMatchIn(code(it)) }.map { it.relativeTo(root).path }
        assertTrue("the Setup screen must be among the files that ask: $askers", setupScreen in askers)
    }

    @Test
    fun `no file but the Setup screen can ask for texts, calls or contacts`() {
        val offences = mainKotlin()
            .filter { it.relativeTo(root).path != setupScreen }
            .filter { val c = code(it); requestApi.containsMatchIn(c) && (disclosedGroups.containsMatchIn(c) || disclosedManifest.containsMatchIn(c)) }
            .map { it.relativeTo(root).path }
        assertEquals("a second file can ask for a disclosed permission", emptyList<String>(), offences)

        val shortcut = Regex("""rememberPermissionState\(\s*PermissionGroup\.(SMS|CALLS|CONTACTS)""")
        val shortcuts = mainKotlin().filter { shortcut.containsMatchIn(code(it)) }.map { it.relativeTo(root).path }
        assertEquals("rememberPermissionState asks without the disclosure", emptyList<String>(), shortcuts)
    }

    @Test
    fun `the Setup screen asks only after the disclosure`() {
        val src = code(File(root, setupScreen))
        assertTrue("the disclosure dialog is not drawn by the Setup screen", src.contains("TextsCallsDisclosureDialog("))
        assertEquals(
            "Android's prompt must be launched from exactly one place, perform()",
            1,
            Regex("""launcher\.launch\(""").findAll(src).count(),
        )
        val performBody = src.substringAfter("fun perform(", missingDelimiterValue = "")
            .substringBefore("\n    }\n")
        assertTrue("launcher.launch must sit inside perform()", performBody.contains("launcher.launch("))
        // perform() has exactly two callers: act() for a row with no disclosure, and Agree.
        val callers = Regex("""(?<!fun )perform\(""").findAll(src).count()
        assertEquals("perform() must have exactly two callers", 2, callers)
        val actBody = src.substringAfter("fun act(", missingDelimiterValue = "").substringBefore("\n    }\n")
        assertTrue("act() must stop at the disclosure", actBody.contains("Route.Disclose"))
        assertTrue("Agree must be the only caller that passes agreed = true", src.contains("agreed = true"))
    }

    @Test
    fun `Not now leaves the permissions and the row exactly as they were`() {
        // No request, no "Not now" bookkeeping, no prefs write: the row keeps its Allow button.
        val src = code(File(root, setupScreen))
        assertTrue(
            "the disclosure's Not now must only close the dialog",
            Regex("""onNotNow\s*=\s*\{\s*disclosing\s*=\s*null\s*}""").containsMatchIn(src),
        )
    }

    @Test
    fun `the rows say where texts, calls and contacts go`() {
        listOf(SetupPlan.TEXTS, SetupPlan.CALLS, SetupPlan.CONTACTS).forEach { id ->
            val why = SetupPlan.items.single { it.id == id }.why
            assertTrue("the $id row must say the data goes to the paired Mac: \"$why\"", why.contains("paired Mac"))
        }
    }
}
