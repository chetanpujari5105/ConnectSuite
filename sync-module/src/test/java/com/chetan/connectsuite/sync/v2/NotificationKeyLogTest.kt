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
        val log = NotificationKeyOrdinals()
        val odd = log.of("+15551234567")
        assertTrue(odd, Regex("key#\\d+").matches(odd))
        assertFalse(odd.contains("5551234567"))
        assertEquals("the same malformed key correlates within a run", odd, log.of("+15551234567"))
        assertTrue("six parts is not the shape", Regex("key#\\d+").matches(log.of("a|b|c|d|e|f")))
    }

    /**
     * Audit S6, the exact defect: the previous redaction was salted 32-bit FNV-1a, and one known tag in
     * the log gave the salt (every FNV step is invertible), then a dictionary gave every other tag. This
     * runs that attack on what [NotificationKeyLog] prints. Red against the FNV version on 2026-10-06.
     */
    @Test
    fun `S6 - knowing one tag in the log does not reveal another`() {
        val known = jid(1_234_567)
        val secret = jid(4_242)
        // Control: the attack recovers the secret from salted FNV digests made here.
        val seeded = OFFSET xor kotlin.random.Random.nextInt()
        assertEquals("control: the attack must work on FNV", secret, attack(known, fnv(seeded, known), fnv(seeded, secret)))

        val shownKnown = tagOf(NotificationKeyLog.of(key(known)))
        val shownSecret = tagOf(NotificationKeyLog.of(key(secret)))
        val recovered = attack(known, digestOf(shownKnown), digestOf(shownSecret))
        assertEquals("the hidden tag was recovered from the log", null, recovered)
    }

    @Test
    fun `S6 - the shown id depends only on order, never on content, and restarts at 1`() {
        val runA = NotificationKeyOrdinals()
        val runB = NotificationKeyOrdinals()
        val a = listOf("111@s.whatsapp.net", "222@s.whatsapp.net", "111@s.whatsapp.net").map { runA.of(key(it)) }
        val b = listOf("999@s.whatsapp.net", "888@s.whatsapp.net", "999@s.whatsapp.net").map { runB.of(key(it)) }
        assertEquals(a, b)
        assertEquals("tag#1", tagOf(a[0]))
        assertNotEquals("control: two tags are told apart", a[0], a[1])
        assertEquals("control: one tag correlates", a[0], a[2])
    }

    @Test
    fun `S6 - retained state is bounded and holds no raw tag`() {
        val log = NotificationKeyOrdinals(maxTracked = 16)
        val tags = (0 until 40).map { "91980000${it.toString().padStart(4, '0')}@s.whatsapp.net" }
        tags.forEach { log.of(key(it)) }
        assertEquals(16, log.tracked())
        log.heldKeysForTest().forEach { held ->
            assertTrue("a raw tag is held: $held", tags.none { held.contains(it.take(12)) })
        }
        assertEquals("an evicted tag is seen as new, never merged", "tag#41", tagOf(log.of(key(tags[0]))))
    }

    private fun key(tag: String) = "0|com.whatsapp|1|$tag|10123"
    private fun tagOf(line: String) = line.split('|')[3]
    private fun jid(n: Int) = "1555${n.toString().padStart(7, '0')}@s.whatsapp.net"
    private fun digestOf(shown: String): Int? =
        if (Regex("tag#[0-9a-f]{8}").matches(shown)) shown.substring(4).toLong(16).toInt() else null

    private fun fnv(start: Int, text: String): Int {
        var h = start
        for (ch in text) { h = h xor ch.code; h *= PRIME }
        return h
    }

    private fun back(end: Int, text: String): Int {
        var h = end
        for (i in text.indices.reversed()) { h *= INVERSE; h = h xor text[i].code }
        return h
    }

    private fun attack(known: String, hKnown: Int?, hSecret: Int?): String? {
        if (hKnown == null || hSecret == null) return null
        val start = back(hKnown, known)
        return (0 until 10_000).map(::jid).firstOrNull { fnv(start, it) == hSecret }
    }

    private companion object {
        const val PRIME = 0x01000193
        val OFFSET = 0x811c9dc5.toInt()
        /** PRIME's inverse modulo 2^32, by Newton's iteration. */
        val INVERSE: Int = run {
            var inv = PRIME
            repeat(5) { inv *= 2 - PRIME * inv }
            inv
        }
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
