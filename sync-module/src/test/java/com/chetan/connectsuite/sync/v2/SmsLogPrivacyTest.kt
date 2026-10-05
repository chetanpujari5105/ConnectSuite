package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No `LinkLog` line in the SMS feature carries an address or a message body. The phone's log is a
 * rotating file on disk, and `docs/protocol.md`'s call-data rule — never a number on disk — holds
 * for texts as much as for calls. `sms.received NOT pushed: no provider row for $address` broke it
 * on the one path where a message is lost.
 *
 * A comment-stripped scan of the `LinkLog` calls, the same instrument as [CallLogPrivacyTest]. It
 * sees a named variable in a template, not a number smuggled through a renamed one; the fixture
 * below proves it can see the shape it is for.
 */
class SmsLogPrivacyTest {

    /** A named address or body in a template — but a count of them (`.size`, `.length`) is fine. */
    private val forbidden =
        Regex("""\$\{?(address|addresses|actual|recipients|body|sender|number|text)\b(?!\.(size|length|isEmpty|isNotEmpty)\b)""")

    private fun logCalls(name: String): List<String> {
        val source = SourceTree.kotlinFiles().single { it.name == name }.readText()
            .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
            .lines().joinToString("\n") { line -> line.indexOf("//").let { if (it < 0) line else line.substring(0, it) } }
        return Regex("LinkLog\\.[iwe]\\(").findAll(source).map { match ->
            var depth = 1
            var i = match.range.last + 1
            while (i < source.length && depth > 0) {
                when (source[i]) { '(' -> depth++; ')' -> depth-- }
                i++
            }
            source.substring(match.range.first, i)
        }.toList()
    }

    @Test
    fun `the scan sees the shape it is for`() {
        assertTrue(forbidden.containsMatchIn("""LinkLog.e("sms", "no provider row for ${'$'}address after")"""))
        assertTrue(!forbidden.containsMatchIn("""LinkLog.e("sms", "no provider row for the sender after ${'$'}looks")"""))
        assertTrue(forbidden.containsMatchIn("""LinkLog.e("sms", "named ${'$'}{recipients.joinToString(",")}")"""))
        assertTrue(!forbidden.containsMatchIn("""LinkLog.e("sms", "named ${'$'}{recipients.size}, not the same set")"""))
    }

    @Test
    fun `no SMS log line names an address or a body`() {
        // The minimums are the control: the scan found the calls it is checking.
        for ((name, atLeast) in listOf("SmsFeature.kt" to 5, "SmsStore.kt" to 1)) {
            val calls = logCalls(name)
            assertTrue("control: $name logs (${calls.size} calls)", calls.size >= atLeast)
            val leaking = calls.filter { forbidden.containsMatchIn(it) }
            assertTrue("$name logs an address or a body: $leaking", leaking.isEmpty())
        }
    }
}
