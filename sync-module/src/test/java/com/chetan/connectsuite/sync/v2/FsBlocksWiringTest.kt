package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.Extensions
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.sync.v2.BulkClaim.Decision
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's `fs.blocks` wiring, through the functions the live handlers call: which pulls take the
 * block path, what the ack says about a resume, which bulk claims are accepted, and what
 * `fs.transfer.done` carries for each way the sender can end.
 */
class FsBlocksWiringTest {

    private val mib = 1024L * 1024
    private val on = mapOf(Extensions.FS_BLOCKS to 1)

    @Test
    fun `only a negotiated session and a file above 64 MiB take the block path - an older Mac keeps the old one`() {
        assertTrue(FsBlocks.appliesTo(on, 64 * mib + 1))
        assertFalse("exactly 64 MiB is still pre-hashed", FsBlocks.appliesTo(on, 64 * mib))
        assertFalse("an older Mac (no fs.blocks) keeps the old path", FsBlocks.appliesTo(emptyMap(), 10_000 * mib))
        assertFalse("share keys alone are not fs.blocks", FsBlocks.appliesTo(mapOf(Extensions.SHARE_FILE to 3), 10_000 * mib))
    }

    @Test
    fun `fs blocks is advertised by a debuggable build or once released, and negotiated only when the Mac advertises it too`() {
        assertEquals(mapOf(Extensions.FS_BLOCKS to 1), Extensions.filesAdvertised(debuggable = true))
        assertEquals(emptyMap<String, Int>(), Extensions.filesAdvertised(debuggable = false))
        assertEquals(mapOf(Extensions.FS_BLOCKS to 1), Extensions.filesAdvertised(debuggable = false, release = true))
        assertFalse("the release switch is off", Extensions.FS_BLOCKS_RELEASE)

        val withMac = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = on)
        assertEquals(1, withMac.negotiated[Extensions.FS_BLOCKS])
        assertTrue(withMac.filesLine, withMac.filesLine.contains("negotiated 1") && withMac.filesLine.contains("block-verified"))
        val oldMac = Extensions.handshake(debuggable = true, devV2Armed = false, macExt = emptyMap())
        assertNull(oldMac.negotiated[Extensions.FS_BLOCKS])
        assertTrue(oldMac.filesLine, oldMac.filesLine.contains("negotiated none") && oldMac.filesLine.contains("unverified"))
        val release = Extensions.handshake(debuggable = false, devV2Armed = false, macExt = on)
        assertNull("a release build does not advertise it", release.negotiated[Extensions.FS_BLOCKS])
    }

    @Test
    fun `parseResume reads a well-typed object and refuses coercion`() {
        val size = 1L shl 30
        val mtime = 1_759_140_000_000L
        val root = "b".repeat(64)
        fun parse(json: String) = FsBlocks.parseResume(Json.parseToJsonElement(json), size, mtime)
        assertNull(FsBlocks.parseResume(null, size, mtime))
        assertNull(FsBlocks.parseResume(JsonNull, size, mtime))
        assertEquals(
            FsBlocks.ResumeAnswer.Accepted(FsBlocks.Resume(512, root)),
            parse("""{"size":$size,"mtimeMs":$mtime,"blockSize":1048576,"verifiedBlocks":512,"prefixRoot":"$root"}"""),
        )
        listOf(
            "\"a string\"",
            """{"size":"$size","mtimeMs":$mtime,"blockSize":1048576,"verifiedBlocks":512,"prefixRoot":"$root"}""",
            """{"size":$size,"mtimeMs":$mtime,"blockSize":1048576,"verifiedBlocks":"512","prefixRoot":"$root"}""",
            """{"size":$size,"mtimeMs":$mtime,"blockSize":1048576,"verifiedBlocks":512,"prefixRoot":7}""",
            """{"size":$size,"mtimeMs":$mtime,"blockSize":1048576,"verifiedBlocks":512.5,"prefixRoot":"$root"}""",
        ).forEach { assertEquals(it, "bad-request", (parse(it) as FsBlocks.ResumeAnswer.Refused).why) }
    }

    @Test
    fun `the ack's resume answer says where sending starts, or why not`() {
        val bs = 1 shl 20
        assertNull(FsBlocks.resumeAck(null, bs))
        val ok = FsBlocks.resumeAck(FsBlocks.ResumeAnswer.Accepted(FsBlocks.Resume(512, "c".repeat(64))), bs)!!
        assertTrue(ok["accepted"]!!.jsonPrimitive.boolean)
        assertEquals(512L * bs, ok["from"]!!.jsonPrimitive.long)
        val no = FsBlocks.resumeAck(FsBlocks.ResumeAnswer.Refused("source-changed", "x"), bs)!!
        assertFalse(no["accepted"]!!.jsonPrimitive.boolean)
        assertEquals("source-changed", no["why"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a block pull is claimable only at exactly the offset its ack agreed`() {
        val bs = 1 shl 20
        val fresh = FsBlocks.requiredOffset(null, bs)
        assertEquals(Decision.Claim, BulkClaim.decide(true, "A", false, "A", 0, fresh))
        assertEquals(Decision.WrongOffset, BulkClaim.decide(true, "A", false, "A", 1, fresh))
        val resumed = FsBlocks.requiredOffset(FsBlocks.Resume(3, "d".repeat(64)), bs)
        assertEquals(3L * bs, resumed)
        assertEquals(Decision.Claim, BulkClaim.decide(true, "A", false, "A", 3L * bs, resumed))
        assertEquals(Decision.WrongOffset, BulkClaim.decide(true, "A", false, "A", 0, resumed))
        assertEquals(Decision.WrongOffset, BulkClaim.decide(true, "A", false, "A", 3L * bs + 1, resumed))
        assertEquals("the session check still comes first", Decision.WrongSession, BulkClaim.decide(true, "A", false, "B", 3L * bs, resumed))
        assertEquals("control: a Files pull without blocks takes any offset, as before", Decision.Claim, BulkClaim.decide(true, "A", false, "A", 4096, null))
    }

    @Test
    fun `done carries the manifest on success, SOURCE_CHANGED with its why, and the position reached`() {
        val bs = 1 shl 20
        val resume = FsBlocks.Resume(3, "e".repeat(64))
        val sent = FsBlocks.donePayload("t-1", "clip.mov", BlockPullSender.Outcome.Sent(7L * bs, "f".repeat(64), "a".repeat(64), 10), 10L * bs, bs, resume, 99)
        assertTrue(sent["ok"]!!.jsonPrimitive.boolean)
        assertEquals("whole size, resumed prefix included", 10L * bs, sent["bytes"]!!.jsonPrimitive.long)
        assertEquals("a".repeat(64), sent["manifestRoot"]!!.jsonPrimitive.content)
        assertEquals(10L, sent["blockCount"]!!.jsonPrimitive.long)
        assertEquals(bs.toLong(), sent["blockSize"]!!.jsonPrimitive.long)

        val changed = FsBlocks.donePayload("t-1", "clip.mov", BlockPullSender.Outcome.SourceChanged(0, "prefix-mismatch", "d"), 10L * bs, bs, resume, 5)
        assertFalse(changed["ok"]!!.jsonPrimitive.boolean)
        assertEquals(ErrorCode.SOURCE_CHANGED, changed["code"]!!.jsonPrimitive.content)
        assertEquals("prefix-mismatch", changed["why"]!!.jsonPrimitive.content)
        assertFalse(changed["verified"]!!.jsonPrimitive.boolean)

        val stopped = FsBlocks.donePayload("t-1", "clip.mov", BlockPullSender.Outcome.Cancelled(bs.toLong()), 10L * bs, bs, null, 5)
        assertEquals(ErrorCode.TRANSFER_FAILED, stopped["code"]!!.jsonPrimitive.content)
        assertEquals(bs.toLong(), stopped["bytes"]!!.jsonPrimitive.long)
    }

    @Test
    fun `a blocks payload carries its first index and digests in order`() {
        val p = FsBlocks.blocksPayload("t-9", 256, listOf("1".repeat(64), "2".repeat(64)))
        assertEquals(256L, p["first"]!!.jsonPrimitive.long)
        assertEquals(listOf("1".repeat(64), "2".repeat(64)), p["sha256"]!!.jsonArray.map { (it as JsonPrimitive).content })
    }
}
