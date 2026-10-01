package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.SourceStability.ById
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * Defect 166 — a block pull's size and last-modified came from the index, and the index can be stale.
 *
 * Hardware, 2026-10-01 23:15 (SM-S938B): after the shell's `dd conv=notrunc` changed block 100 of a paused
 * pull's source, the file's own mtime read 1790876712 and MediaStore's `DATE_MODIFIED` still read
 * 1790864966 (M0) 140 s later — so the resume was accepted on metadata and stopped only by the prefix
 * re-hash. These run the real [SourceStability.read], the real [FsBlocks.parseResume] and the real
 * [BlockPullSender]; the Android half ([LiveStat], `fstat` on a provider's descriptor) is not reachable
 * from a JVM test, and that is said rather than doubled.
 */
class SourceStabilityTest {

    private val size = 209_715_200L
    private val m0 = 1_790_864_966_000L          // the index's value, which never moved
    private val l0 = 1_790_864_966_412L          // the file's own mtime at the pause
    private val l1 = 1_790_876_712_903L          // the file's own mtime after the write

    private fun stamp(size: Long = this.size, mtime: Long = l0, ino: Long = 836_493L) = SourceStamp(size, mtime, dev = 66_306L, ino = ino)

    /** The resume the Mac would send for a record holding [recSize] @ [recMtime] and [n] verified blocks. */
    private fun resume(recSize: Long, recMtime: Long, n: Long = 768) = Json.parseToJsonElement(
        """{"size":$recSize,"mtimeMs":$recMtime,"blockSize":${FsBlocks.blockSizeFor(recSize)},"verifiedBlocks":$n,"prefixRoot":"${"ab".repeat(32)}"}""",
    )

    private fun decide(reading: SourceStability.Reading, recSize: Long, recMtime: Long) =
        FsBlocks.parseResume(resume(recSize, recMtime), reading.stamp!!.first, reading.stamp.second)

    // ---- the metadata decision ------------------------------------------------------------------------

    @Test
    fun `166 - the measured case - index unchanged, the file's own mtime moved - the resume is refused as source-changed`() {
        val atPause = SourceStability.read(size to m0, handle = null, byId = ById.Stamp(stamp(mtime = l0)))
        assertEquals("the ack and the Mac's record carry the file's own time", size to l0, atPause.stamp)
        val afterWrite = SourceStability.read(size to m0, handle = null, byId = ById.Stamp(stamp(mtime = l1)))
        val answer = decide(afterWrite, size, atPause.stamp!!.second)
        assertTrue("refused: $answer", answer is FsBlocks.ResumeAnswer.Refused)
        assertEquals("source-changed", (answer as FsBlocks.ResumeAnswer.Refused).why)
    }

    @Test
    fun `166 - control - with only the index, the same write is invisible and the resume is accepted (the hardware result)`() {
        val atPause = SourceStability.read(size to m0, handle = null, byId = ById.Unavailable)
        val afterWrite = SourceStability.read(size to m0, handle = null, byId = ById.Unavailable)
        assertEquals(SourceStability.Basis.INDEXED, afterWrite.basis)
        assertTrue("the reading says how weak it is: ${afterWrite.why}", afterWrite.why.contains("index only"))
        assertTrue(decide(afterWrite, size, atPause.stamp!!.second) is FsBlocks.ResumeAnswer.Accepted)
    }

    @Test
    fun `166 - a size change the index has not seen is refused`() {
        val now = SourceStability.read(size to m0, handle = null, byId = ById.Stamp(stamp(size = size + 4096, mtime = l0)))
        val answer = decide(now, size, l0)
        assertEquals("source-changed", (answer as FsBlocks.ResumeAnswer.Refused).why)
    }

    @Test
    fun `166 - an unchanged file reads the same twice, so an honest resume is still accepted`() {
        val a = SourceStability.read(size to m0, handle = null, byId = ById.Stamp(stamp()))
        val b = SourceStability.read(size to m0, handle = null, byId = ById.Stamp(stamp()))
        assertTrue(decide(b, size, a.stamp!!.second) is FsBlocks.ResumeAnswer.Accepted)
    }

    @Test
    fun `166 - a source that no longer opens by its id has no stamp, whatever the index still says`() {
        val r = SourceStability.read(size to m0, handle = null, byId = ById.Gone)
        assertNull(r.stamp)
    }

    @Test
    fun `166 - the descriptor being read outranks a fresh look, and a different file behind the id is a replacement`() {
        val same = SourceStability.read(size to m0, handle = stamp(mtime = l1), byId = ById.Stamp(stamp(mtime = l1)))
        assertEquals(SourceStability.Basis.LIVE_HANDLE, same.basis)
        assertEquals(size to l1, same.stamp)
        val replaced = SourceStability.read(size to m0, handle = stamp(ino = 836_493L), byId = ById.Stamp(stamp(ino = 900_001L)))
        assertNull("replaced: ${replaced.why}", replaced.stamp)
        assertTrue(replaced.why.contains("replaced"))
    }

    // ---- through the real sender ------------------------------------------------------------------------

    private val bs = 4096
    private val agreed = 1_759_140_000_000L
    private fun bytes(n: Int) = ByteArray(n).also { java.util.Random(0x166).nextBytes(it) }
    private val source = bytes(10 * bs + 123)
    private fun sha(b: ByteArray, from: Int = 0, to: Int = b.size) = MessageDigest.getInstance("SHA-256").apply { update(b, from, to - from) }.digest()
    private fun blocksOf(b: ByteArray) = (0 until FsBlocks.blockCountFor(b.size.toLong(), bs).toInt()).map { i -> sha(b, i * bs, minOf(b.size, (i + 1) * bs)) }

    private class Sink : BlockPullSender.Sink {
        val out = ByteArrayOutputStream()
        override fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long) { out.write(buffer, 0, length) }
        override fun blocks(first: Long, digests: List<String>) = Unit
        override fun progress(phase: String, bytes: Long) = Unit
    }

    private fun sender(src: ByteArray, resume: FsBlocks.Resume? = null) =
        BlockPullSender(src.size.toLong(), agreed, bs, resume, chunk = 1000, clock = { 0L })

    /** The sender's check, built the way `BulkTransfers` builds it: one [SourceStability.read] per call. */
    private fun check(handles: List<SourceStamp?>, byIds: List<ById>, indexed: Pair<Long, Long>?): () -> Pair<Long, Long>? {
        var i = 0
        return { SourceStability.read(indexed, handles[minOf(i, handles.size - 1)], byIds[minOf(i, byIds.size - 1)]).stamp.also { i += 1 } }
    }

    private fun live(src: ByteArray, mtime: Long = agreed, ino: Long = 7) = SourceStamp(src.size.toLong(), mtime, 1, ino)

    @Test
    fun `166 - a write to the file between the ack and the first byte sends nothing`() {
        val sink = Sink()
        val out = sender(source).run(ByteArrayInputStream(source), check(listOf(live(source, mtime = agreed + 1)), listOf(ById.Stamp(live(source, mtime = agreed + 1))), source.size.toLong() to agreed), { false }, sink)
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals(0, sink.out.size())
    }

    @Test
    fun `166 - an in-place write to the file being read, with the index unchanged, ends the pull as source-changed`() {
        val handles = listOf(live(source), live(source, mtime = agreed + 7))
        val out = sender(source).run(ByteArrayInputStream(source), check(handles, listOf(ById.Stamp(live(source)), ById.Stamp(live(source, mtime = agreed + 7))), source.size.toLong() to agreed), { false }, Sink())
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertTrue(out.detail, out.detail.contains("after the last byte"))
    }

    @Test
    fun `166 - the file replaced under the id while it is read ends the pull, though size and time match`() {
        val byIds = listOf<ById>(ById.Stamp(live(source)), ById.Stamp(live(source, ino = 8)))
        val out = sender(source).run(ByteArrayInputStream(source), check(listOf(live(source)), byIds, source.size.toLong() to agreed), { false }, Sink())
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
    }

    @Test
    fun `166 - a provider with no file metadata falls back to its index - a change it never indexed is not seen by metadata`() {
        val changed = source.copyOf().also { it[5 * bs + 10] = (it[5 * bs + 10] + 1).toByte() }
        val out = sender(changed).run(ByteArrayInputStream(changed), check(listOf(null), listOf(ById.Unavailable), changed.size.toLong() to agreed), { false }, Sink())
        assertTrue("the honest limit: metadata alone cannot see it", out is BlockPullSender.Outcome.Sent)
        // What the Mac receives is still one consistent file — the one the phone read, with its digests.
        assertTrue(FsBlocks.hex(sha(changed)) == (out as BlockPullSender.Outcome.Sent).sha256)
    }

    @Test
    fun `166 - metadata preserved, a change inside the retained prefix is still caught by the prefix re-hash`() {
        val blocks = blocksOf(source)
        val resume = FsBlocks.Resume(6, FsBlocks.hex(FsBlocks.rootOf(blocks, 6)))
        val changed = source.copyOf().also { it[2 * bs + 1] = (it[2 * bs + 1] + 1).toByte() }  // block 2: inside
        val out = sender(changed, resume).run(ByteArrayInputStream(changed), check(listOf(live(changed)), listOf(ById.Stamp(live(changed))), changed.size.toLong() to agreed), { false }, Sink())
        assertEquals("prefix-mismatch", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals("nothing past the prefix was sent", 0L, out.bytesSent)
    }

    @Test
    fun `166 - metadata preserved, a change outside the retained prefix is fetched - the result is the current file, whole`() {
        val blocks = blocksOf(source)
        val resume = FsBlocks.Resume(6, FsBlocks.hex(FsBlocks.rootOf(blocks, 6)))
        val changed = source.copyOf().also { it[8 * bs + 1] = (it[8 * bs + 1] + 1).toByte() }  // block 8: outside
        val sink = Sink()
        val out = sender(changed, resume).run(ByteArrayInputStream(changed), check(listOf(live(changed)), listOf(ById.Stamp(live(changed))), changed.size.toLong() to agreed), { false }, sink)
        out as BlockPullSender.Outcome.Sent
        assertEquals("the whole-file digest is the changed file's", FsBlocks.hex(sha(changed)), out.sha256)
        assertTrue("the suffix sent is the changed file's", sink.out.toByteArray().contentEquals(changed.copyOfRange(6 * bs, changed.size)))
    }

    // ---- the wiring the begin path and the sender call ----------------------------------------------------

    /**
     * A provider double: an index that answers [statById] and a file that answers [liveStamp]. It stands in
     * for MediaStore or a DocumentsProvider — the boundary — and supplies nothing of the rule under test.
     */
    private class Provider(var indexed: FsPaths.Entry?, var live: ById) : FsStore {
        override val rootId = "downloads:connectsuite"
        override val label = "Received files"
        override val kind = "downloads"
        override val writable = true
        override fun freeBytes() = 0L
        override fun listChildren(segments: List<String>) = listOfNotNull(indexed)
        override fun statById(id: String) = indexed?.takeIf { it.id == id }
        override fun mkdir(segments: List<String>, name: String): FsPaths.Entry? = null
        override fun deleteIfUnchanged(id: String, expectSize: Long, expectMtimeMs: Long) = DeleteOutcome.Refused("not here")
        override fun openStream(id: String) = null
        override fun liveStamp(id: String) = if (statById(id) == null) ById.Gone else live
        override fun openPartial(segments: List<String>, name: String): FsPartial? = null
    }

    private fun entry(mtime: Long = m0) = FsPaths.Entry(id = "1000313356", name = "sidekick-t5-source-change-200mb.bin", dir = false, size = size, mtimeMs = mtime, mime = "application/octet-stream")

    @Test
    fun `166 - the begin path agrees the file's own time, so the ack and the Mac's record carry it`() {
        val store = Provider(entry(), ById.Stamp(stamp(mtime = l0)))
        val (agreed, reading) = SourceStability.atBegin(store, store.indexed!!)
        assertEquals(l0, agreed!!.mtimeMs)
        assertEquals("the rest of the entry is the index's", "sidekick-t5-source-change-200mb.bin", agreed.name)
        assertEquals(SourceStability.Basis.LIVE_BY_ID, reading.basis)
        // After the measured write: the index is unchanged, the file moved, and the resume is refused.
        store.live = ById.Stamp(stamp(mtime = l1))
        val (now, _) = SourceStability.atBegin(store, store.indexed!!)
        val answer = FsBlocks.parseResume(resume(size, agreed.mtimeMs), now!!.size, now.mtimeMs)
        assertEquals("source-changed", (answer as FsBlocks.ResumeAnswer.Refused).why)
    }

    @Test
    fun `166 - the begin path keeps the index, and says so, for a provider with no file metadata`() {
        val store = Provider(entry(), ById.Unavailable)
        val (agreed, reading) = SourceStability.atBegin(store, store.indexed!!)
        assertEquals(m0, agreed!!.mtimeMs)
        assertEquals(SourceStability.Basis.INDEXED, reading.basis)
    }

    @Test
    fun `166 - the sender's recheck reads the store by id and the handle it is given`() {
        val store = Provider(entry(), ById.Stamp(stamp(mtime = l0)))
        assertEquals(size to l0, SourceStability.recheck(store, "1000313356", handle = null))
        assertEquals("the handle being read wins", size to l1, SourceStability.recheck(store, "1000313356", handle = stamp(mtime = l1)))
        assertNull("replaced under the handle", SourceStability.recheck(store, "1000313356", handle = stamp(ino = 1L)))
        store.indexed = null
        assertNull("gone by id", SourceStability.recheck(store, "1000313356", handle = stamp()))
    }

    @Test
    fun `166 - the begin path and the sender call these, not a second copy of the rule`() {
        val root = generateSequence(java.io.File("").absoluteFile) { it.parentFile }.first { java.io.File(it, "sync-module").isDirectory }
        val dir = java.io.File(root, "sync-module/src/main/java/com/chetan/connectsuite/sync/v2")
        fun code(name: String) = java.io.File(dir, name).readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//.*"), "")
        assertTrue("control: the sources were read", code("FsFeature.kt").contains("fun onBeginBlockPull"))
        assertTrue("FsFeature agrees the stamped entry", code("FsFeature.kt").contains("SourceStability.atBegin(store, indexed)"))
        assertTrue("and uses it, not the index", code("FsFeature.kt").contains("val entry = agreed ?: return refuse("))
        assertTrue("the sender re-checks the descriptor it reads", code("BulkTransfers.kt").contains("SourceStability.recheck(store, entry.id, LiveStat.ofStream(handle))"))
        assertTrue("the sender is handed the stream it reads", code("BulkTransfers.kt").contains("{ plan.stat(input) }"))
    }
}
