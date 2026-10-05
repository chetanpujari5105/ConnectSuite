package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A notification key's tag is the posting app's free text — WhatsApp puts the contact's number in
 * it — so no `LinkLog` line may carry a raw key. The function, and the one call site that logs a key.
 */
class NotificationKeyLogTest {

    private val whatsapp = "0|com.whatsapp|1|919876543210@s.whatsapp.net|10123"

    @Test
    fun `a tag carrying a phone number never reaches the line`() {
        val shown = NotificationKeyLog.of(whatsapp)
        assertTrue("control: package and id are kept — $shown", shown.startsWith("0|com.whatsapp|1|tag#"))
        assertTrue("control: uid is kept", shown.endsWith("|10123"))
        assertFalse("the number survived: $shown", shown.contains("9876543210"))
    }

    @Test
    fun `one key reads the same twice in a run, two keys differently`() {
        assertEquals(NotificationKeyLog.of(whatsapp), NotificationKeyLog.of(whatsapp))
        assertNotEquals(NotificationKeyLog.of(whatsapp), NotificationKeyLog.of("0|com.whatsapp|1|919800000001@s.whatsapp.net|10123"))
    }

    @Test
    fun `no tag is shown as it is, and an unexpected shape is replaced whole`() {
        assertEquals("0|com.slack|1234|null|10123", NotificationKeyLog.of("0|com.slack|1234|null|10123"))
        val odd = NotificationKeyLog.of("+15551234567")
        assertTrue(odd, Regex("key#[0-9a-f]{8}").matches(odd))
    }

    @Test
    fun `the relay logs a key only through the redactor`() {
        val source = withoutComments(SourceTree.kotlinFiles().single { it.name == "NotificationRelay.kt" }.readText())
        val logLines = source.lines().filter { it.contains("LinkLog.") }
        assertTrue("control: the relay logs at all", logLines.size >= 3)
        val raw = logLines.filter { Regex("""\$\{?key\b""").containsMatchIn(it) }
        assertTrue("a LinkLog line interpolates a raw notification key: $raw", raw.isEmpty())
        assertTrue("control: the dismiss failure is still logged", logLines.any { it.contains("NotificationKeyLog.of(key)") })
    }

    private fun withoutComments(source: String): String {
        val noBlocks = source.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        return noBlocks.lines().joinToString("\n") { line ->
            val at = line.indexOf("//")
            if (at < 0) line else line.substring(0, at)
        }
    }
}
