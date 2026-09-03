package com.chetan.connectsuite.sync.v2

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 33: a package id may be a machine handle, never the only thing a person reads.
 *
 * ### Why this is a source scan and not an ordinary unit test
 *
 * The bug is never in the failure class — its sentence is fine whatever it is handed. It is at the
 * **call site**, which passes `sbn.packageName` where a resolved label belongs, and no JVM test can
 * see a call site. Defect 28 found *three* copies of this when two were expected, so the rule is to
 * enumerate rather than to fix the one on screen, and enumeration over source is what that means
 * here.
 *
 * This is the same discriminator `scripts/check-apps-verb.mjs` uses: comments are stripped, so the
 * KDoc explaining the rule does not trip the guard that enforces it — a guard forbidding its own
 * explanation has broken the pair it belongs to.
 *
 * **What it does not reach:** any call assembled at runtime, and any file outside the list below.
 * It is a scan, and a scan's bound is the files it reads.
 */
class PackageIdInProseTest {

    /** Constructors whose argument becomes a sentence a person reads. */
    private val proseTakers = listOf("NoReplyAction")

    private val sources = listOf(
        "src/main/java/com/chetan/connectsuite/sync/v2/NotificationFeature.kt",
    )

    private fun strippedSource(path: String): String {
        val file = File(path)
        assertTrue("the scan must actually find $path — an empty scan passes vacuously", file.isFile)
        val text = file.readText()
        // Block comments first, then line comments. A guard that reads its own KDoc would forbid
        // the sentence explaining why it exists.
        return text
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""(?m)^\s*//.*$"""), "")
    }

    @Test
    fun `no prose-taking failure is handed a raw package id`() {
        val offences = mutableListOf<String>()
        sources.forEach { path ->
            val src = strippedSource(path)
            proseTakers.forEach { taker ->
                Regex("""$taker\(([^)]*)\)""").findAll(src).forEach { match ->
                    val arg = match.groupValues[1].trim()
                    // `packageName` in any form — `sbn.packageName`, `packageName`, `pkg` — is a
                    // handle. A resolved label comes through AppLabels and nowhere else.
                    if (arg.contains("packageName") && !arg.contains("AppLabels")) {
                        offences += "$path: $taker($arg)"
                    }
                }
            }
        }
        assertEquals(
            "a package id reached a sentence a person reads — route it through AppLabels.of: $offences",
            emptyList<String>(),
            offences,
        )
    }

    /**
     * The control: the scan can see an offence.
     *
     * Without this the test above passes identically over a file it failed to read, a regex that
     * matches nothing, and a codebase with no defect — three states this project has already
     * confused for one another.
     */
    @Test
    fun `the scan detects the defect it was written for`() {
        val offending = "NoReplyAction(sbn.packageName)"
        val arg = Regex("""NoReplyAction\(([^)]*)\)""").find(offending)!!.groupValues[1]
        assertTrue("the matcher must flag a raw package id", arg.contains("packageName"))
        assertTrue("and must not flag a resolved one", 
            !"AppLabels.of(context, sbn.packageName)".let { it.contains("packageName") && !it.contains("AppLabels") })
    }

    /** The other control: a comment mentioning the forbidden shape must not trip the guard. */
    @Test
    fun `a comment describing the defect is not itself a defect`() {
        val commented = """
            // NoReplyAction(sbn.packageName) is the shape this guard forbids.
            /** NoReplyAction(sbn.packageName) in KDoc, too. */
            val x = 1
        """.trimIndent()
        val stripped = commented
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""(?m)^\s*//.*$"""), "")
        assertTrue(
            "comments must be stripped before matching: $stripped",
            !Regex("""NoReplyAction\(""").containsMatchIn(stripped),
        )
    }
}
