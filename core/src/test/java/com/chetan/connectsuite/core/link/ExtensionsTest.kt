package com.chetan.connectsuite.core.link

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * docs/protocol.md → Extensions, rules 1–4, from `docs/fixtures/ext-negotiation.json` — the file the
 * Mac's `extensions.test.ts` reads too, so the two parsers are held to one set of cases.
 */
class ExtensionsTest {

    private val fixture = Json.parseToJsonElement(
        listOf("../docs/fixtures/ext-negotiation.json", "docs/fixtures/ext-negotiation.json").map(::File).first { it.isFile }.readText(),
    ).jsonObject

    private fun map(e: JsonElement): Map<String, Int> = e.jsonObject.mapValues { it.value.jsonPrimitive.int }

    @Test fun `every parse case from the shared fixture`() {
        val cases = fixture["parse"]!!.jsonArray
        assertTrue("fixture read (control)", cases.size >= 10)
        cases.forEach { c ->
            val o = c.jsonObject
            val raw = o["raw"]!!
            // `{"absent": true}` models the key being missing entirely.
            val input: JsonElement? = if (raw is JsonObject && raw["absent"] != null && raw.size == 1) null else raw
            assertEquals(o["why"]!!.jsonPrimitive.content, map(o["out"]!!), Extensions.parse(input))
        }
    }

    @Test fun `every negotiate case from the shared fixture`() {
        val cases = fixture["negotiate"]!!.jsonArray
        assertTrue(cases.size >= 4)
        cases.forEach { c ->
            val o = c.jsonObject
            val expected = o["out"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }
            assertEquals(o["why"]!!.jsonPrimitive.content, expected,
                Extensions.negotiate(map(o["mine"]!!), map(o["theirs"]!!), Extensions.SHARE_FILE))
        }
    }

    @Test fun `this phone advertises share file version 1, and hello ack carries it as an object`() {
        assertEquals(mapOf(Extensions.SHARE_FILE to 1), Extensions.PHONE)
        assertEquals("""{"share.file":1}""", Extensions.toJson(Extensions.PHONE).toString())
    }
}
