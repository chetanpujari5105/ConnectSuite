package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * `fs.blocks` — the block rule, held to `docs/fixtures/fs-blocks.json`, which an independent Python
 * implementation generated so this file and the Mac's `fsBlocks.test.ts` cannot share a mistake.
 */
class FsBlocksTest {

    private val fixture: JsonObject = Json.parseToJsonElement(
        listOf("../docs/fixtures/fs-blocks.json", "docs/fixtures/fs-blocks.json").map { File(it) }.first { it.isFile }.readText(),
    ).jsonObject

    private val content = fixture["content"]!!.jsonObject
    private val bytes = ByteArray(content["length"]!!.jsonPrimitive.int) { (it % 251).toByte() }
    private val expectedBlocks = content["blocks"]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun `block size and count agree with the fixture on both sides of 2000 blocks`() {
        val cases = fixture["blockSize"]!!.jsonArray
        assertTrue("control: the fixture has its cases", cases.size >= 8)
        cases.forEach { c ->
            val o = c.jsonObject
            val size = o["size"]!!.jsonPrimitive.long
            val label = o["label"]!!.jsonPrimitive.content
            assertEquals(label, o["blockSize"]!!.jsonPrimitive.int, FsBlocks.blockSizeFor(size))
            assertEquals(label, o["blockCount"]!!.jsonPrimitive.long, FsBlocks.blockCountFor(size, o["blockSize"]!!.jsonPrimitive.int))
        }
    }

    @Test
    fun `digests and roots match the fixture whatever the read size`() {
        val bs = content["blockSize"]!!.jsonPrimitive.int
        for (chunk in listOf(1, 4096, 100_000, 131_072, 262_144, bytes.size)) {
            val seen = mutableListOf<Long>()
            val h = FsBlocks.Hasher(bs) { i, _ -> seen.add(i) }
            var at = 0
            while (at < bytes.size) {
                val n = minOf(chunk, bytes.size - at)
                h.update(bytes, at, n)
                at += n
            }
            assertEquals("chunk $chunk", expectedBlocks, h.finish().map(FsBlocks::hex))
            assertEquals("blocks reported in order, chunk $chunk", (0L until expectedBlocks.size).toList(), seen)
        }
        val digests = expectedBlocks.map { hex -> ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }
        assertEquals(content["manifestRoot"]!!.jsonPrimitive.content, FsBlocks.hex(FsBlocks.rootOf(digests)))
        val prefix = content["prefixRoots"]!!.jsonObject
        assertEquals(prefix["1"]!!.jsonPrimitive.content, FsBlocks.hex(FsBlocks.rootOf(digests, 1)))
        assertEquals(prefix["2"]!!.jsonPrimitive.content, FsBlocks.hex(FsBlocks.rootOf(digests, 2)))
    }

    @Test
    fun `a resumed hasher numbers its blocks from where it starts`() {
        val seen = mutableListOf<Long>()
        val h = FsBlocks.Hasher(131_072, 512L) { i, _ -> seen.add(i) }
        h.update(bytes)
        h.finish()
        assertEquals(listOf(512L, 513L, 514L), seen)
    }
}
