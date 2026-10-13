package com.chetan.connectsuite.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Google Play wants the privacy policy linked inside the app. A constant nobody draws satisfies
 * nothing, so this checks both: what the link points at, and that the Setup screen actually renders
 * a button opening it.
 *
 * What it cannot reach: whether the page is still online. That was checked live on 2026-10-13
 * (HTTP 200, the policy's effective date present, the site homepage's title absent).
 */
class PrivacyPolicyLinkTest {

    @Test
    fun `the link points at the published policy over https`() {
        assertEquals(
            "https://chetan-website-delta.vercel.app/sidekick/privacy",
            SetupPlan.PRIVACY_POLICY_URL,
        )
    }

    @Test
    fun `the label is part of the screen's copy, so the copy guard reads it`() {
        assertTrue(SetupPlan.allText.contains(SetupPlan.PRIVACY_POLICY_LABEL))
        assertEquals("Privacy policy", SetupPlan.PRIVACY_POLICY_LABEL)
    }

    private val screen: File = listOf(
        File("src/main/java/com/chetan/connectsuite/setup/SetupScreen.kt"),
        File("app/src/main/java/com/chetan/connectsuite/setup/SetupScreen.kt"),
    ).firstOrNull { it.isFile } ?: error("SetupScreen.kt not found from ${File(".").canonicalPath}")

    /** Source without comments, so a comment mentioning the link does not count as drawing it. */
    private fun code(): String = screen.readText()
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .joinToString("\n") { it.replace(Regex("""(^|\s)//.*$"""), "") }

    @Test
    fun `the Setup screen draws a button that opens the policy`() {
        val source = code()
        // Control: the scanner reads the real screen.
        assertTrue(source.contains("fun SetupScreen("))
        assertTrue("no ACTION_VIEW of the policy URL", source.contains("Intent(Intent.ACTION_VIEW, Uri.parse(SetupPlan.PRIVACY_POLICY_URL))"))
        assertTrue("the label is not drawn", source.contains("Text(SetupPlan.PRIVACY_POLICY_LABEL"))
    }
}
