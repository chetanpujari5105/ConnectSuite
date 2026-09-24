package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The share name and type rules. The sanitiser cases live in `docs/fixtures/share-names.json`, not
 * here, so the Mac's test (slice 4) reads the same cases rather than a second copy of them.
 */
class ShareNamesTest {

    private val fixture: File = listOf("../docs/fixtures/share-names.json", "docs/fixtures/share-names.json")
        .map(::File).first { it.isFile }

    @Test fun `every fixture case sanitises to its expected name`() {
        val cases = Json.parseToJsonElement(fixture.readText()).jsonObject["cases"]!!.jsonArray
        assertTrue("the fixture was read (control)", cases.size >= 10)
        cases.forEach { c ->
            val o = c.jsonObject
            assertEquals(o["why"]!!.jsonPrimitive.content, o["out"]!!.jsonPrimitive.content, ShareNames.sanitize(o["in"]!!.jsonPrimitive.content))
        }
    }

    @Test fun `a long name is capped at 255 UTF-8 bytes and keeps its extension`() {
        val out = ShareNames.sanitize("a".repeat(400) + ".jpeg")
        assertEquals(255, out.toByteArray().size)
        assertTrue(out.endsWith(".jpeg"))
    }

    @Test fun `the cap never splits a multi-byte character`() {
        val out = ShareNames.sanitize("é".repeat(200) + ".txt") // 2 bytes each
        assertTrue(out.toByteArray().size <= 255)
        assertTrue(out.endsWith(".txt"))
        assertEquals(out, String(out.toByteArray(), Charsets.UTF_8))
        assertFalse(out.contains('�'))
    }

    @Test fun `display name prefers the provider, then the path segment, then a timestamp`() {
        val ext = { m: String -> if (m == "image/png") "png" else null }
        assertEquals("shot.png", ShareNames.displayName("shot.png", "1000309270", "image/png", "2026-09-24 101500", ext))
        assertEquals("1000309270.png", ShareNames.displayName(null, "1000309270", "image/png", "2026-09-24 101500", ext))
        assertEquals("Shared file 2026-09-24 101500.png", ShareNames.displayName(" ", null, "image/png", "2026-09-24 101500", ext))
        assertEquals("Shared file 2026-09-24 101500", ShareNames.displayName(null, null, "application/x-unknown", "2026-09-24 101500", ext))
    }

    @Test fun `an extension is added only when the name has none`() {
        val ext = { _: String -> "png" }
        assertEquals("already.jpg", ShareNames.displayName("already.jpg", null, "image/png", "t", ext))
        assertEquals("trailingdot..png", ShareNames.displayName("trailingdot.", null, "image/png", "t", ext))
    }

    @Test fun `the provider's name is sanitised too`() {
        assertEquals("a-b.txt", ShareNames.displayName("a/b.txt", null, "text/plain", "t") { null })
    }

    @Test fun `mime prefers the resolver, then a concrete intent type, then octet-stream`() {
        assertEquals("image/png", ShareNames.mimeOf("image/png", "image/*"))
        assertEquals("image/jpeg", ShareNames.mimeOf(null, "IMAGE/JPEG"))
        assertEquals(ShareNames.OCTET_STREAM, ShareNames.mimeOf(null, "image/*"))
        assertEquals(ShareNames.OCTET_STREAM, ShareNames.mimeOf("", "*/*"))
        assertEquals(ShareNames.OCTET_STREAM, ShareNames.mimeOf("nonsense", null))
    }

    @Test fun `folder types are recognised`() {
        assertTrue(ShareNames.isDirectory("vnd.android.document/directory"))
        assertTrue(ShareNames.isDirectory("inode/directory"))
        assertFalse(ShareNames.isDirectory("application/octet-stream"))
    }
}
