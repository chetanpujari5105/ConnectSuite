package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules that decide what leaves this phone, and what it keeps.
 *
 * Every test here names the thing it would let through if it were deleted. The two that matter most
 * are the sensitive refusal and the byte-length cap: one is the difference between a password
 * staying on the phone and crossing a network, and the other is the difference between an entry
 * being refused and a paste being silently half a paragraph.
 */
class ClipboardPayloadsTest {

    // --- the sensitive flag, which is the highest-value line in the feature -----------------------

    @Test
    fun `a sensitive item is never stored in the history`() {
        val history = ClipboardPayloads.History()
        val stored = history.add(
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_SENSITIVE,
                text = "hunter2",
                atMs = 1L,
                source = ClipboardPayloads.SOURCE_PHONE,
            ),
        )
        assertFalse("a sensitive entry must not be remembered", stored)
        assertEquals(0, history.size)
    }

    @Test
    fun `a sensitive payload carries no text, even when a caller passes one`() {
        // The shape refuses it rather than trusting every call site to omit it. A password manager
        // sets EXTRA_IS_SENSITIVE; a payload builder that relied on remembering would leak the
        // first time somebody added a second call site.
        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_SENSITIVE,
            text = "hunter2",
            atMs = 1L,
            source = ClipboardPayloads.SOURCE_PHONE,
        )
        assertNull(payload["text"])
        assertEquals("sensitive", payload["kind"]?.jsonPrimitive?.content)
    }

    // --- the cap is on bytes, not characters ------------------------------------------------------

    @Test
    fun `the cap counts UTF-8 bytes, so an emoji string cannot slip past a length check`() {
        // The first version of this test asserted `emoji.length == 20_000` and went red at 40_000 —
        // and the red was the test being wrong, which is the useful half. `String.length` counts
        // **UTF-16 code units**, so an emoji outside the BMP is 2 there and 4 on the wire. It is
        // neither characters nor bytes, and a cap written against it is wrong by a factor that
        // depends on what the person copied.
        val emoji = "😀".repeat(20_000)
        assertEquals("20,000 emoji are 40,000 UTF-16 units…", 40_000, emoji.length)
        assertEquals("…and 80,000 bytes on the socket", 80_000, ClipboardPayloads.byteLength(emoji))
        assertTrue("80 KB of emoji is over the 64 KB cap", ClipboardPayloads.tooLarge(emoji))
    }

    @Test
    fun `a string exactly at the cap is allowed and one byte over is not`() {
        val atCap = "a".repeat(ClipboardPayloads.MAX_TEXT_BYTES)
        val overCap = "a".repeat(ClipboardPayloads.MAX_TEXT_BYTES + 1)
        assertFalse(ClipboardPayloads.tooLarge(atCap))
        assertTrue(ClipboardPayloads.tooLarge(overCap))
    }

    // --- the echo rule ----------------------------------------------------------------------------

    @Test
    fun `a side does not send back the entry it just received`() {
        assertFalse(ClipboardPayloads.shouldSend("from the mac", lastReceived = "from the mac"))
    }

    @Test
    fun `a side does send an entry that differs from the last received one`() {
        assertTrue(ClipboardPayloads.shouldSend("something else", lastReceived = "from the mac"))
        assertTrue(ClipboardPayloads.shouldSend("anything", lastReceived = null))
    }

    // --- the history ------------------------------------------------------------------------------

    @Test
    fun `duplicates collapse to the most recent occurrence rather than filling the list`() {
        val history = ClipboardPayloads.History()
        history.add(item("one", 1L))
        history.add(item("two", 2L))
        history.add(item("one", 3L))

        val entries = history.newestFirst()
        assertEquals(2, entries.size)
        assertEquals("one", entries[0].text)
        assertEquals("the collapsed entry keeps the NEW timestamp, not the old one", 3L, entries[0].atMs)
        assertEquals("two", entries[1].text)
    }

    @Test
    fun `the history is bounded and drops the oldest`() {
        val history = ClipboardPayloads.History(max = 3)
        (1..5).forEach { history.add(item("entry $it", it.toLong())) }

        val entries = history.newestFirst()
        assertEquals(3, entries.size)
        assertEquals(listOf("entry 5", "entry 4", "entry 3"), entries.map { it.text })
    }

    @Test
    fun `clear reports how much it removed, so an empty history and a cleared one are countable`() {
        val history = ClipboardPayloads.History()
        history.add(item("one", 1L))
        history.add(item("two", 2L))
        assertEquals(2, history.clear())
        assertEquals(0, history.size)
        assertEquals("clearing an empty history removes nothing and says so", 0, history.clear())
    }

    // --- the package-id rule ----------------------------------------------------------------------

    @Test
    fun `a package never appears on the wire without a label beside it`() {
        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_TEXT,
            text = "hello",
            atMs = 1L,
            source = ClipboardPayloads.SOURCE_PHONE,
            packageName = "com.android.chrome",
            appName = null,
        )
        assertEquals("com.android.chrome", payload["package"]?.jsonPrimitive?.content)
        assertEquals(
            "an unresolved label falls back to the package id, which is honest — but the field is present",
            "com.android.chrome",
            payload["appName"]?.jsonPrimitive?.content,
        )
    }

    @Test
    fun `an unknown owner means the fields are absent, never the string unknown`() {
        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_TEXT,
            text = "hello",
            atMs = 1L,
            source = ClipboardPayloads.SOURCE_PHONE,
        )
        assertNull(payload["package"])
        assertNull(payload["appName"])
    }

    private fun item(text: String, atMs: Long) = ClipboardPayloads.History.Item(
        kind = ClipboardPayloads.KIND_TEXT,
        text = text,
        atMs = atMs,
        source = ClipboardPayloads.SOURCE_PHONE,
    )
}
