package com.chetan.connectsuite.input.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Google Play's prominent-disclosure rule for an AccessibilityService that is not an accessibility
 * tool, held as facts about one sentence each rather than as likenesses between sentences.
 *
 * The second half is structural: the disclosure only protects anyone if nothing can reach
 * Accessibility settings without it, so the source guard counts every call site in the app.
 */
class InputDisclosureTest {

    private fun lower(s: String) = s.lowercase()

    // ---- the copy ------------------------------------------------------------------------------

    @Test
    fun `it names both things the service reads`() {
        // ConnectSuiteInputService reads the focused editable field (setText append, backspace)
        // and the package in front (foregroundPackage). A disclosure naming one is incomplete.
        val reads = lower(InputDisclosure.READS)
        assertTrue("must name the selected text field", reads.contains("text field"))
        assertTrue("must name the app in front", reads.contains("name of the app"))
    }

    @Test
    fun `it says the service never acts on its own`() {
        // Play prohibits autonomous accessibility use; the disclosure states the opposite fact.
        assertTrue(lower(InputDisclosure.WHAT).contains("never on its own"))
    }

    @Test
    fun `it says nothing it reads is sent, not even to the paired Mac — and the refusal keeps that true`() {
        val where = lower(InputDisclosure.WHERE)
        assertTrue(where.contains("not even to your paired mac"))
        assertTrue("it must say what the Mac is told instead", where.contains("a different app came to the front"))
        assertFalse("the old route is gone; the sentence must not describe it", where.contains("app's name"))
        // The sentence is a claim about InputFailure.ForegroundChanged, the one refusal built from
        // what the service reads (defect 223). Check the claim against the thing it describes.
        val refusal = com.chetan.connectsuite.input.InputFailure.ForegroundChanged()
        listOfNotNull(refusal.reason, refusal.fixHint).forEach { sent ->
            assertFalse("'$sent' carries a package id", Regex("""\b[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}\b""").containsMatchIn(sent))
        }
    }

    @Test
    fun `it says how to turn it off`() {
        assertTrue(lower(InputDisclosure.OFF).contains("turn it off"))
    }

    @Test
    fun `consent is an explicit choice between two different buttons`() {
        assertEquals("Agree", InputDisclosure.AGREE)
        assertNotEquals(InputDisclosure.AGREE, InputDisclosure.NOT_NOW)
    }

    @Test
    fun `it is a separate disclosure, about the accessibility service alone`() {
        // "Cannot be included with other disclosures pertaining to personal or sensitive data
        // collection." Each word below is another feature's disclosure.
        val others = listOf("message", "sms", "call", "contact", "photo", "notification", "clipboard")
        InputDisclosure.allText.forEach { line ->
            others.forEach { word ->
                assertFalse("'$line' mentions '$word', another feature's disclosure", lower(line).contains(word))
            }
        }
    }

    @Test
    fun `every line is present`() {
        assertEquals(8, InputDisclosure.allText.size)
        InputDisclosure.allText.forEach { assertTrue("blank line in the disclosure", it.isNotBlank()) }
    }

    // ---- the gate ------------------------------------------------------------------------------

    /** The repository root, resolved rather than assumed. Gradle runs this from `input-module/`. */
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

    private fun sitesOf(token: String): List<String> = mainKotlin().flatMap { file ->
        Regex(Regex.escape(token)).findAll(code(file)).map { file.relativeTo(root).path }.toList()
    }

    @Test
    fun `the scanner can see a known call site`() {
        // Control for the guard below: an empty scan must mean "no other caller", never "read
        // nothing". The notification-listener deep link is known to exist exactly once.
        assertTrue("scanned too few files: ${mainKotlin().size}", mainKotlin().size > 100)
        assertEquals(
            listOf("core/src/main/java/com/chetan/connectsuite/core/permissions/AppPermissions.kt"),
            sitesOf("Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"),
        )
    }

    @Test
    fun `Accessibility settings are opened from one place, behind the disclosure`() {
        val card = "input-module/src/main/java/com/chetan/connectsuite/input/ui/InputOnboardingCard.kt"
        assertEquals(
            "ACTION_ACCESSIBILITY_SETTINGS must appear only in the private intent builder",
            listOf(card),
            sitesOf("ACTION_ACCESSIBILITY_SETTINGS"),
        )
        val source = code(File(root, card))
        assertTrue(
            "the intent builder must stay private, so no other file can skip the disclosure",
            source.contains("private fun accessibilitySettings()"),
        )
    }

    @Test
    fun `the phone's own log names no app either — the disclosure says nothing is stored`() {
        // Defect 223's second half: link.log is a file on the phone that the owner may be asked to
        // send, so a log line interpolating the compared packages would make WHERE untrue.
        val read = Regex("""\$\{?(aimedAt|nowInFront|foregroundPackage)""")
        val logs = mainKotlin().filter { it.path.contains("/input-module/") }.flatMap { file ->
            Regex("""LinkLog\.[iwe]\(([\s\S]*?)\)\s*\n""").findAll(code(file))
                .filter { read.containsMatchIn(it.groupValues[1]) }
                .map { "${file.name}: ${it.value.trim().take(120)}" }.toList()
        }
        assertEquals("a log line records what the service read", emptyList<String>(), logs)
    }

    @Test
    fun `the service does not claim to be an accessibility tool`() {
        val config = File(root, "input-module/src/main/res/xml/accessibility_service_config.xml")
        assertTrue("config not found at ${config.path}", config.isFile)
        assertTrue(config.readText().contains("<accessibility-service"))
        assertFalse(config.readText().contains("isAccessibilityTool=\"true\""))
    }
}
