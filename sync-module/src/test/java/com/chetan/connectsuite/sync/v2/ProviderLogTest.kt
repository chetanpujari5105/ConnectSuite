package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A failed contact lookup must not write the number it looked up to the log. */
class ProviderLogTest {

    private val lookup = "content://com.android.contacts/phone_lookup/%2B15551234567"

    @Test
    fun `a failed lookup keeps the reason and loses the number, in the URI and in the message`() {
        val error = SecurityException("Permission Denial: opening provider uri $lookup from pid=1 requires android.permission.READ_CONTACTS")
        val line = ProviderLog.queryFailed(lookup, error)
        assertFalse("the number reached the line: $line", line.contains("5551234567"))
        assertEquals(
            "Query on content://com.android.contacts/phone_lookup/… failed: SecurityException: " +
                "Permission Denial: opening provider uri content://com.android.contacts/phone_lookup/… " +
                "from pid=1 requires android.permission.READ_CONTACTS",
            line,
        )
    }

    @Test
    fun `a query string is cut too, and a one-segment URI is kept whole`() {
        assertEquals("content://mms-sms/threadID/…", ProviderLog.redact("content://mms-sms/threadID?recipient=%2B15551234567"))
        assertEquals("content://sms", ProviderLog.redact("content://sms"))
        assertEquals("content://mms-sms/conversations", ProviderLog.redact("content://mms-sms/conversations"))
        assertEquals("a message id is kept; what follows it is not", "content://mms/42/…", ProviderLog.redact("content://mms/42/addr"))
    }

    @Test
    fun `both stores log a failed query only through the formatter`() {
        for (name in listOf("ContactsStore.kt", "SmsStore.kt")) {
            val source = SourceTree.kotlinFiles().single { it.name == name }.readText()
            val logLines = source.lines().filter { it.contains("LinkLog.") && it.contains("Query") || it.contains("ProviderLog.queryFailed") }
            assertTrue("control: $name logs a failed query", logLines.any { it.contains("ProviderLog.queryFailed") })
            assertFalse("$name interpolates a raw uri into a log line: $logLines", logLines.any { Regex("""\$\{?uri\b""").containsMatchIn(it) })
        }
    }
}
