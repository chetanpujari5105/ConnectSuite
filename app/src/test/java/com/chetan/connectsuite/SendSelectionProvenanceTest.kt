package com.chetan.connectsuite

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * S7 (defect 185): the exported text entry points can never claim the phone's own clipboard as their
 * origin. Any installed app can fire an explicit intent at `SendSelectionActivity` with **any extras**;
 * the only defence that does not depend on the sender is that the activity **reads nothing it could use
 * to say so** and hands the text to the one route that always stamps `selection`.
 *
 * A source guard, because an exported activity cannot be started from a JVM test. Each assertion names
 * the exact thing, so reading one more extra, or passing anything to `sendSelectedText` beyond the
 * text and the platform's referrer, turns this red.
 */
class SendSelectionProvenanceTest {

    private fun source(name: String): String =
        listOf("src/main/java/com/chetan/connectsuite/$name", "app/src/main/java/com/chetan/connectsuite/$name")
            .map(::File).first { it.isFile }.readText()
            .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
            .replace(Regex("//[^\\n]*"), "")

    @Test
    fun `SendSelectionActivity reads only the text, the stream and the read-only flag from its intent`() {
        val code = source("SendSelectionActivity.kt")
        // Any first argument — an identifier OR a string literal. The first version matched identifiers only
        // and passed with `getStringExtra("…ORIGIN")` added: mutation P4, recorded in the evidence.
        val read = Regex("""(?:get\w*Extra|hasExtra)\(\s*(?:it,\s*)?([^,)]+)""")
            .findAll(code).map { it.groupValues[1].trim() }.toSortedSet()
        assertTrue("control: the scan found the extras it reads", read.size >= 3)
        assertEquals(
            sortedSetOf("Intent.EXTRA_PROCESS_TEXT", "Intent.EXTRA_PROCESS_TEXT_READONLY", "Intent.EXTRA_STREAM", "Intent.EXTRA_TEXT"),
            read,
        )
        assertTrue("no bulk read of extras that a caller could fill", !code.contains(".extras") && !code.contains("getExtras"))
    }

    @Test
    fun `the exported entry points never name an origin or the focus route`() {
        for (name in listOf("SendSelectionActivity.kt", "ShareToMacActivity.kt")) {
            val code = source(name)
            for (forbidden in listOf("origin", "ORIGIN_", "ClipRoute", "onWindowFocused")) {
                assertTrue("$name names `$forbidden`", !code.contains(forbidden))
            }
        }
    }

    @Test
    fun `the selection is handed to sendSelectedText with the text and the platform referrer, nothing else`() {
        val code = source("SendSelectionActivity.kt")
        val calls = Regex("""ClipFeature\.sendSelectedText\(([^)]*)\)""").findAll(code).map { it.groupValues[1].replace(Regex("\\s+"), " ").trim() }.toList()
        assertEquals(listOf("applicationContext, text, fromPackage"), calls)
        assertTrue("fromPackage is the platform's referrer, not an extra", code.contains("val fromPackage = referrer?.host"))
    }
}
