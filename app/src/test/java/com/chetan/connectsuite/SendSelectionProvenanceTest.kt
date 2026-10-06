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
        assertEquals(listOf("applicationContext, read.text, fromPackage"), calls)
        assertTrue("fromPackage is the platform's referrer, not an extra", code.contains("val fromPackage = referrer?.host"))
    }

    /**
     * 2026-10-07: `EXTRA_TEXT` was read with `getStringExtra`, which is `BaseBundle.getString` — a cast that
     * answers a `Spanned` value with null. A share carrying styled text was told "Nothing was selected".
     * Red against the activity as it stood at `286e2b0`.
     */
    @Test
    fun `the selection path reads text extras as CharSequence, never as String`() {
        val code = source("SendSelectionActivity.kt")
        assertTrue("getStringExtra on the selection path", !code.contains("getStringExtra"))
        assertTrue("control: the CharSequence reads are there", Regex("getCharSequenceExtra\\(Intent\\.EXTRA_TEXT\\)").containsMatchIn(code))
        assertTrue(Regex("getCharSequenceExtra\\(Intent\\.EXTRA_PROCESS_TEXT\\)").containsMatchIn(code))
    }

    /** No sender identity and no text in the activity's log lines — only the route, a count and the outcome. */
    @Test
    fun `the activity's log lines carry neither the referrer nor the text`() {
        val code = source("SendSelectionActivity.kt")
        val logCalls = Regex("""LinkLog\.\w\(([\s\S]*?)\)\n""").findAll(code).map { it.groupValues[1] }.toList()
        assertTrue("control: the scan found the log calls (${logCalls.size})", logCalls.size >= 3)
        for (call in logCalls) {
            assertTrue("a log line interpolates the referrer: $call", !Regex("\\$\\{?fromPackage\\}?(?!\\s*!=)").containsMatchIn(call))
            assertTrue("a log line interpolates the text: $call", !call.contains("\${read.text}") && !Regex("\\$\\{?text\\b").containsMatchIn(call))
        }
    }

    /** One tap is one send: a restored instance must not hand the same intent to the send route again. */
    @Test
    fun `a restored instance finishes before reading or sending anything`() {
        val code = source("SendSelectionActivity.kt")
        val guard = code.indexOf("if (savedInstanceState != null)")
        assertTrue("control: the guard exists", guard >= 0)
        assertTrue("the guard comes before the first extra is read", guard < code.indexOf("getCharSequenceExtra"))
        assertTrue("the guard comes before the send", guard < code.indexOf("ClipFeature.sendSelectedText"))
    }
}
