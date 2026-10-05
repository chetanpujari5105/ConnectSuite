package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's own logs carry no numbers and no contact names (`docs/protocol.md` → Calls → *What a
 * Mac may keep about a call*). `CallWatcher` broke that on every call — `from +15551234567 (Ada
 * Lovelace)`, and again in the late-number correction — `call.dial` logged `dialled +15551234567`,
 * and `contacts.get` logged the number it was asked for.
 *
 * Two halves, and what each reaches:
 *
 *  - **The sentences**, called through the production formatters (`CallLogLines`,
 *    `CallAckWording.DIAL_DELIVERED`, `contactsGetFoundLine`). Every value is asserted exactly, which
 *    is also the positive control: each transition is still logged, with its call id and state.
 *  - **The call sites**, by a comment-stripped scan of the three production files: no `LinkLog` call
 *    interpolates a caller's number or name, and every call line goes through the formatter.
 *
 * **What neither reaches:** `LinkLog.write` itself (it calls `android.util.Log` and writes a file),
 * and therefore the bytes on disk. The scan is a heuristic over source text — it sees a template or a
 * concatenation of a named variable, not a number smuggled through a renamed one — and the fixtures
 * below say which shapes it does and does not catch. The structural guard is the formatters'
 * signatures, which take Booleans and counts and cannot be handed a number at all.
 */
class CallLogPrivacyTest {

    // ---- The sentences --------------------------------------------------------------------------

    @Test
    fun `an episode's first line names the call, its state and which of three cases it was`() {
        assertEquals(
            "Call c3 ringing: number present, contact name found — 4 of 5 episodes with a number since start",
            CallLogLines.began("c3", "ringing", hasNumber = true, hasContactName = true, episodesWithNumber = 4, episodes = 5),
        )
        assertEquals(
            "Call c3 dialing: number present, no contact name — 4 of 5 episodes with a number since start",
            CallLogLines.began("c3", "dialing", hasNumber = true, hasContactName = false, episodesWithNumber = 4, episodes = 5),
        )
        assertEquals(
            "Call c4 ringing: number withheld by the platform — 4 of 6 episodes with a number since start",
            CallLogLines.began("c4", "ringing", hasNumber = false, hasContactName = false, episodesWithNumber = 4, episodes = 6),
        )
    }

    @Test
    fun `the correction line keeps the phrase step70-watch waits for, and loses the caller`() {
        val line = CallLogLines.cardCorrected(
            "c14", "ringing", hasContactName = true, arrivedAfterMs = 112, episodesCorrected = 1, episodes = 14,
        )
        assertEquals(
            "Call c14 card corrected in place: number arrived 112ms into the ringing, contact name found — " +
                "1 of 14 episodes corrected since start",
            line,
        )
        assertTrue("scripts/step70-watch.mjs waits for this phrase", line.contains("card corrected in place"))
    }

    @Test
    fun `an episode's last line names the call, its disposition and its duration`() {
        assertEquals("Call c3 ended answered after 42000ms", CallLogLines.ended("c3", "answered", 42_000))
    }

    @Test
    fun `the dial line says it dialled and carries no number`() {
        val line = CallAckWording.DIAL_DELIVERED
        assertTrue("control: the line still says what was done — $line", line.startsWith("dialled"))
        assertFalse("a dialled number is a run of digits: $line", Regex("\\d{3,}").containsMatchIn(line))
    }

    @Test
    fun `the contacts get line says how it was asked, never what for`() {
        assertEquals("contacts.get by number → found, photo=true", contactsGetFoundLine(byId = false, withPhoto = true, sentPhoto = true))
        assertEquals("contacts.get by id → found, photo not asked for", contactsGetFoundLine(byId = true, withPhoto = false, sentPhoto = false))
    }

    // ---- The call sites -------------------------------------------------------------------------

    private val scanned = listOf("CallWatcher.kt", "CallFeature.kt", "ContactsFeature.kt")

    /** Identifiers that hold a caller's number or name in these three files. */
    private val personal = listOf("number", "contactName", "endedNumber", "endedName", "incoming", "who")

    /** Same heuristic as `FsRootsSingleSourceTest`: `//` after `:` is a URL, not a comment. */
    private fun withoutComments(source: String): String {
        val noBlocks = source.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        return noBlocks.lines().joinToString("\n") { line ->
            var at = line.indexOf("//")
            while (at > 0 && line[at - 1] == ':') at = line.indexOf("//", at + 1)
            if (at < 0) line else line.substring(0, at)
        }
    }

    /** The argument text of every `LinkLog.x(…)` call, parentheses balanced. */
    private fun logCalls(source: String): List<String> =
        Regex("LinkLog\\.[iwe]\\(").findAll(source).map { match ->
            var depth = 1
            var at = match.range.last + 1
            while (at < source.length && depth > 0) {
                when (source[at]) { '(' -> depth++; ')' -> depth-- }
                at++
            }
            source.substring(match.range.last + 1, at - 1)
        }.toList()

    /**
     * A personal identifier interpolated (`$number`, `${contactName}`), used inside a template
     * expression (`${id ?: number}`), or concatenated (`+ number`). A Boolean asked of one —
     * `number.isNotBlank()`, `contactName != null` — is not the value and is not flagged.
     */
    private fun leaks(arguments: String): List<String> = personal.filter { name ->
        Regex("\\$\\{?\\s*$name\\b(?!\\s*(\\.is|!=|==))").containsMatchIn(arguments) ||
            Regex("\\$\\{[^}]*\\b$name\\b(?!\\s*(\\.is|!=|==|\\?\\.))").containsMatchIn(arguments) ||
            Regex("\\+\\s*$name\\b(?!\\s*(\\.is|!=|==))").containsMatchIn(arguments)
    }

    /** The argument of every `deliver(session, request, …)` — the dial route reaches the log through it. */
    private fun delivered(source: String): List<String> =
        Regex("deliver\\(session, request, ([^)\\n]*)\\)").findAll(source).map { it.groupValues[1] }.toList()

    private fun source(name: String): String =
        withoutComments(SourceTree.kotlinFiles().single { it.name == name }.readText())

    @Test
    fun `the scan sees the log calls it is about`() {
        // Control: a scan that found nothing would pass every assertion below.
        for (file in scanned) {
            val calls = logCalls(source(file))
            assertTrue("$file: found ${calls.size} LinkLog calls; expected several", calls.size >= 3)
        }
    }

    @Test
    fun `the scan catches the verbatim lines that leaked, and passes the ones that replaced them`() {
        // Red against the defect it is named for — each line exactly as it shipped.
        val shipped = listOf(
            """LinkLog.i("calls", "Call ${'$'}id ${'$'}phase ${'$'}who — ${'$'}{episodesWithNumber.get()} of …")""",
            """LinkLog.i("calls", "Call ${'$'}id card corrected in place: number ${'$'}number" + (contactName?.let { " (${'$'}it)" } ?: ""))""",
            """LinkLog.i("contacts", "contacts.get → ${'$'}{id ?: number} found")""",
        )
        for (line in shipped) {
            assertTrue("the scan must flag: $line", logCalls(line).flatMap(::leaks).isNotEmpty())
        }
        val shippedDial = """deliver(session, request, CallAckWording.DIAL_DELIVERED_PREFIX + number)"""
        assertTrue("the scan must flag: $shippedDial", delivered(shippedDial).flatMap(::leaks).isNotEmpty())
        // And it is not merely flagging every mention: a Boolean about the number is not the number.
        val replacement = """LinkLog.i("calls", CallLogLines.began(callId = id, phase = phase, hasNumber = number.isNotBlank(), hasContactName = contactName != null, episodesWithNumber = 1, episodes = 2))"""
        assertEquals("control: the replacement line is clean", 1, logCalls(replacement).size)
        assertEquals(emptyList<String>(), logCalls(replacement).flatMap(::leaks))
    }

    @Test
    fun `no LinkLog call in the call and contacts features interpolates a caller`() {
        for (file in scanned) {
            for (call in logCalls(source(file))) {
                assertEquals("$file logs a caller: LinkLog($call)", emptyList<String>(), leaks(call))
            }
        }
        val delivers = delivered(source("CallFeature.kt"))
        assertTrue("control: the scan found the deliver calls (${delivers.size})", delivers.size >= 3)
        for (what in delivers) {
            assertEquals("a call.* delivered line carries a caller: $what", emptyList<String>(), leaks(what))
        }
    }

    @Test
    fun `every call episode line goes through the formatter`() {
        val watcher = source("CallWatcher.kt")
        for (use in listOf("CallLogLines.began(", "CallLogLines.cardCorrected(", "CallLogLines.ended(")) {
            assertTrue("CallWatcher must log through $use", watcher.contains(use))
        }
        assertTrue(
            "ContactsFeature must log contacts.get through contactsGetFoundLine",
            source("ContactsFeature.kt").contains("contactsGetFoundLine(byId ="),
        )
    }
}
