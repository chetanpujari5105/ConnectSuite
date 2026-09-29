package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * The phone's block-pull sender ([BlockPullSender]), run for real over in-memory sources. Every
 * expectation is computed here independently from the source bytes — never read back from the sender.
 */
class BlockPullSenderTest {

    private val bs = 4096
    private val mtime = 1_759_140_000_000L

    /**
     * Seeded random bytes. Not `i % 256`-style: with a period that divides the block size every full
     * block hashes alike, and a sender that reordered or repeated blocks would pass (it did, first run).
     */
    private fun bytes(n: Int) = ByteArray(n).also { java.util.Random(0x5EED).nextBytes(it) }
    private val source = bytes(10 * bs + 123)

    private fun sha(b: ByteArray, from: Int = 0, to: Int = b.size): ByteArray =
        MessageDigest.getInstance("SHA-256").apply { update(b, from, to - from) }.digest()

    private fun blocksOf(b: ByteArray, blockSize: Int = bs): List<ByteArray> =
        (0 until FsBlocks.blockCountFor(b.size.toLong(), blockSize).toInt())
            .map { i -> sha(b, i * blockSize, minOf(b.size, (i + 1) * blockSize)) }

    private val blocks = blocksOf(source)

    private class Recording : BlockPullSender.Sink {
        val out = ByteArrayOutputStream()
        val events = mutableListOf<Pair<Long, List<String>>>()
        /** For each blocks event, how many bytes had been handed to [chunk] at that moment. */
        val bytesAtEvent = mutableListOf<Long>()
        val phases = mutableListOf<String>()
        var firstChunkAt: Long? = null
        override fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long) {
            if (firstChunkAt == null) firstChunkAt = absoluteStart
            out.write(buffer, 0, length)
        }
        override fun blocks(first: Long, digests: List<String>) { events.add(first to digests); bytesAtEvent.add(out.size().toLong()) }
        override fun progress(phase: String, bytes: Long) { phases.add(phase) }
        val digests get() = events.flatMap { it.second }
    }

    private fun sender(src: ByteArray = source, resume: FsBlocks.Resume? = null, flushEvery: Int = 3, chunk: Int = 1000, blockSize: Int = bs) =
        BlockPullSender(src.size.toLong(), mtime, blockSize, resume, chunk = chunk, flushEvery = flushEvery, clock = { 0L })

    private fun stableFor(src: ByteArray): () -> Pair<Long, Long>? = { src.size.toLong() to mtime }
    private val stable = stableFor(source)

    private fun assertSent(src: ByteArray, sink: Recording, out: BlockPullSender.Outcome, blockSize: Int = bs) {
        out as BlockPullSender.Outcome.Sent
        val expected = blocksOf(src, blockSize)
        assertTrue("the bytes received are the source", sink.out.toByteArray().contentEquals(src))
        assertEquals(expected.map(FsBlocks::hex), sink.digests)
        var next = 0L
        sink.events.forEach { (first, d) -> assertEquals("no gap, no repeat", next, first); next += d.size }
        assertEquals(FsBlocks.hex(sha(src)), out.sha256)
        assertEquals(FsBlocks.hex(FsBlocks.rootOf(expected)), out.manifestRoot)
        assertEquals(expected.size.toLong(), out.blockCount)
    }

    // ---- whole sends and their boundaries ------------------------------------------------------------

    @Test
    fun `a whole send with a short final block delivers every byte, every digest in order, and the right roots`() {
        val sink = Recording()
        assertSent(source, sink, sender().run(ByteArrayInputStream(source), stable, { false }, sink))
        assertEquals("11 blocks, the last one 123 bytes", 11, blocks.size)
        assertEquals("control: every block of the test source hashes differently", 11, blocks.map(FsBlocks::hex).toSet().size)
    }

    @Test
    fun `a size that is an exact multiple has no short block and no empty block`() {
        val src = bytes(8 * bs)
        val sink = Recording()
        assertSent(src, sink, sender(src).run(ByteArrayInputStream(src), stableFor(src), { false }, sink))
        assertEquals(8, sink.digests.size)
    }

    @Test
    fun `a file smaller than one block is one short block`() {
        val src = bytes(100)
        val sink = Recording()
        assertSent(src, sink, sender(src).run(ByteArrayInputStream(src), stableFor(src), { false }, sink))
        assertEquals(1, sink.digests.size)
    }

    @Test
    fun `chunks smaller than, equal to and larger than a block give the same digests`() {
        for (chunk in listOf(1, 999, bs, bs + 1, 3 * bs + 5, source.size)) {
            val sink = Recording()
            assertSent(source, sink, sender(chunk = chunk).run(ByteArrayInputStream(source), stable, { false }, sink))
        }
    }

    @Test
    fun `a block's digest is sent only after the bytes of that block`() {
        val sink = Recording()
        sender(flushEvery = 1, chunk = 777).run(ByteArrayInputStream(source), stable, { false }, sink)
        assertTrue("control: events were sent", sink.events.size >= 10)
        sink.events.forEachIndexed { i, (first, d) ->
            val needed = minOf(source.size.toLong(), (first + d.size) * bs)
            assertTrue("event $i sent with ${sink.bytesAtEvent[i]} bytes out, needed $needed", sink.bytesAtEvent[i] >= needed)
        }
    }

    @Test
    fun `batches carry at most 256 digests - 256 is one event, 257 is two, 300 is 256 plus 44`() {
        for ((n, expected) in listOf(256 to listOf(256), 257 to listOf(256, 1), 300 to listOf(256, 44))) {
            val src = ByteArray(n * 16) { it.toByte() }
            val sink = Recording()
            BlockPullSender(src.size.toLong(), mtime, 16, null, chunk = 100_000, flushEvery = 100_000, clock = { 0L })
                .run(ByteArrayInputStream(src), stableFor(src), { false }, sink)
            assertEquals("$n blocks", expected, sink.events.map { it.second.size })
            assertEquals(expected.runningFold(0L) { a, b -> a + b }.dropLast(1), sink.events.map { it.first })
        }
    }

    // ---- a changed or interrupted source ---------------------------------------------------------------

    @Test
    fun `a source changed before the first byte sends nothing`() {
        val sink = Recording()
        val out = sender().run(ByteArrayInputStream(source), { source.size.toLong() to mtime + 1 }, { false }, sink)
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals(0, sink.out.size())
        assertTrue(sink.events.isEmpty())
    }

    @Test
    fun `a source that cannot be re-read is treated as changed`() {
        val out = sender().run(ByteArrayInputStream(source), { null }, { false }, Recording())
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
    }

    @Test
    fun `a source whose last-modified moves during the read ends as source-changed, not sent`() {
        var calls = 0
        val out = sender().run(
            ByteArrayInputStream(source),
            { calls += 1; source.size.toLong() to (if (calls == 1) mtime else mtime + 5) },
            { false },
            Recording(),
        )
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals("stat before the first byte and after the last", 2, calls)
    }

    @Test
    fun `an interrupted source (ends early) is source-changed and never sends a digest for the block it did not finish`() {
        val short = source.copyOf(source.size - 10)
        val sink = Recording()
        val out = sender().run(ByteArrayInputStream(short), stable, { false }, sink)
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        // Blocks 0-9 were complete; block 10 was cut short. Whatever digests went out are the true ones
        // for complete blocks, in order — and none is for block 10.
        assertTrue("control: some digests were sent before the end", sink.digests.isNotEmpty())
        assertTrue("a digest for the unfinished block 10 went out", sink.digests.size <= 10)
        assertEquals(blocks.take(sink.digests.size).map(FsBlocks::hex), sink.digests)
    }

    @Test
    fun `a source longer than agreed is source-changed before the extra bytes are sent`() {
        val sink = Recording()
        val out = sender().run(ByteArrayInputStream(source + ByteArray(5)), stable, { false }, sink)
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertTrue("no byte past the agreed size", sink.out.size() <= source.size)
    }

    // ---- resume ---------------------------------------------------------------------------------------

    @Test
    fun `a verified resume re-hashes the prefix, sends from the block boundary, and reports whole-file digests`() {
        val resume = FsBlocks.Resume(3, FsBlocks.hex(FsBlocks.rootOf(blocks, 3)))
        val sink = Recording()
        val out = sender(resume = resume).run(ByteArrayInputStream(source), stable, { false }, sink) as BlockPullSender.Outcome.Sent
        assertEquals(3L * bs, sink.firstChunkAt)
        assertTrue(sink.out.toByteArray().contentEquals(source.copyOfRange(3 * bs, source.size)))
        assertEquals("the prefix's digests are the Mac's, not re-sent", 3L, sink.events.first().first)
        assertEquals(blocks.drop(3).map(FsBlocks::hex), sink.digests)
        assertEquals(FsBlocks.hex(sha(source)), out.sha256)
        assertEquals(FsBlocks.hex(FsBlocks.rootOf(blocks)), out.manifestRoot)
        assertEquals((source.size - 3 * bs).toLong(), out.bytesSent)
        assertEquals("it said it was verifying first", "verifying", sink.phases.first())
    }

    @Test
    fun `a resume at the last block sends only the short final block`() {
        val last = blocks.size - 1L
        val sink = Recording()
        val out = sender(resume = FsBlocks.Resume(last, FsBlocks.hex(FsBlocks.rootOf(blocks, last.toInt()))))
            .run(ByteArrayInputStream(source), stable, { false }, sink) as BlockPullSender.Outcome.Sent
        assertEquals(123L, out.bytesSent)
        assertEquals(listOf(last to listOf(FsBlocks.hex(blocks.last()))), sink.events)
    }

    @Test
    fun `a resume whose source changed inside the prefix sends nothing`() {
        val changed = source.copyOf().also { it[5] = (it[5] + 1).toByte() }
        val sink = Recording()
        val out = sender(resume = FsBlocks.Resume(3, FsBlocks.hex(FsBlocks.rootOf(blocks, 3))))
            .run(ByteArrayInputStream(changed), stable, { false }, sink)
        assertEquals("prefix-mismatch", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals(0, sink.out.size())
        assertTrue(sink.events.isEmpty())
    }

    @Test
    fun `a resume claimed from a changed partial on the Mac is refused the same way`() {
        // The Mac's partial was altered while paused and its prefix root no longer describes the source.
        val alteredPartial = source.copyOfRange(0, 3 * bs).also { it[bs + 1] = (it[bs + 1] + 1).toByte() }
        val claimed = FsBlocks.hex(FsBlocks.rootOf(blocksOf(alteredPartial), 3))
        val sink = Recording()
        val out = sender(resume = FsBlocks.Resume(3, claimed)).run(ByteArrayInputStream(source), stable, { false }, sink)
        assertEquals("prefix-mismatch", (out as BlockPullSender.Outcome.SourceChanged).why)
        assertEquals(0, sink.out.size())
    }

    @Test
    fun `a source that ends inside the prefix is source-changed`() {
        val out = sender(resume = FsBlocks.Resume(3, FsBlocks.hex(FsBlocks.rootOf(blocks, 3))))
            .run(ByteArrayInputStream(source.copyOf(2 * bs)), stable, { false }, Recording())
        assertEquals("source-changed", (out as BlockPullSender.Outcome.SourceChanged).why)
    }

    // ---- cancellation -------------------------------------------------------------------------------

    @Test
    fun `cancel stops between chunks and reports what was sent`() {
        val sink = Recording()
        var chunks = 0
        val counting = object : BlockPullSender.Sink by sink {
            override fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long) { chunks += 1; sink.chunk(buffer, length, absoluteStart) }
        }
        val out = sender().run(ByteArrayInputStream(source), stable, { chunks >= 2 }, counting)
        assertEquals(BlockPullSender.Outcome.Cancelled(2000), out)
        assertEquals(2, chunks)
    }

    @Test
    fun `cancel during prefix verification sends nothing`() {
        val sink = Recording()
        val out = sender(resume = FsBlocks.Resume(3, FsBlocks.hex(FsBlocks.rootOf(blocks, 3))))
            .run(ByteArrayInputStream(source), stable, { true }, sink)
        assertEquals(BlockPullSender.Outcome.Cancelled(0), out)
        assertEquals(0, sink.out.size())
    }

    // ---- the resume decision -----------------------------------------------------------------------

    @Test
    fun `the resume decision refuses a changed source and every malformed request, and accepts both ends of the range`() {
        val size = 1L shl 30
        val bsz = FsBlocks.blockSizeFor(size).toLong()
        val root = "a".repeat(64)
        fun d(s: Long? = size, m: Long? = mtime, b: Long? = bsz, v: Long? = 512, r: String? = root) =
            FsBlocks.decideResume(s, m, b, v, r, size, mtime)
        assertEquals(FsBlocks.ResumeAnswer.Accepted(FsBlocks.Resume(512, root)), d())
        assertEquals(FsBlocks.ResumeAnswer.Accepted(FsBlocks.Resume(1, root)), d(v = 1))
        assertEquals(FsBlocks.ResumeAnswer.Accepted(FsBlocks.Resume(1023, root)), d(v = 1023))
        assertEquals("source-changed", (d(m = mtime + 1) as FsBlocks.ResumeAnswer.Refused).why)
        assertEquals("source-changed", (d(s = size - 1) as FsBlocks.ResumeAnswer.Refused).why)
        listOf(d(b = bsz / 2), d(b = bsz * 2), d(v = 0), d(v = 1024), d(v = -1), d(r = "A".repeat(64)), d(r = "a".repeat(63)),
            d(s = null), d(m = null), d(b = null), d(v = null), d(r = null)).forEach {
            assertEquals("bad-request", (it as FsBlocks.ResumeAnswer.Refused).why)
        }
    }
}
