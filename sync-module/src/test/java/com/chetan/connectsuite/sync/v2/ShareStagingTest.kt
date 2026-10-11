package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareStaging.Outcome
import com.chetan.connectsuite.sync.v2.ShareStaging.Preflight
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.attribute.FileTime
import java.security.MessageDigest
import kotlin.random.Random

/**
 * The staging rules in `docs/phase-7-share-proposal.md` rev 2 §5, reached through [ShareStaging]
 * itself against a real temporary directory — the copy, the outcome, what is left on disk, and the
 * sweep, never a hand-built state.
 */
class ShareStagingTest {

    @get:Rule val tmp = TemporaryFolder()

    private val mib = 1024L * 1024L
    private val plenty = { 10_000L * mib }
    private val never = { false }

    private fun dir(): File = tmp.newFolder("share-staging")
    private fun sha(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun names(d: File): Set<String> = d.list()!!.toSet()

    /** Records whether it was closed — "streams are closed on every outcome" is asserted, not hoped. */
    private class Tracked(input: InputStream) : FilterInputStream(input) {
        var closed = false
        override fun close() { closed = true; super.close() }
    }

    private class FailAfter(input: InputStream, private val after: Int) : FilterInputStream(input) {
        private var delivered = 0
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (delivered >= after) throw IOException("injected")
            val n = super.read(b, off, minOf(len, after - delivered))
            if (n > 0) delivered += n
            return n
        }
    }

    private fun copy(
        d: File, bytes: ByteArray, id: String = ShareStaging.newAttemptId(),
        source: InputStream = ByteArrayInputStream(bytes), limit: Long = Long.MAX_VALUE,
        available: () -> Long = plenty, cancelled: () -> Boolean = never, bufferSize: Int = 4096,
        recheckEvery: Long = ShareStaging.RECHECK_EVERY_BYTES,
    ): Outcome = ShareStaging.copy(source, d, id, limit, available, cancelled, nowMs = 1_000L,
        bufferSize = bufferSize, recheckEvery = recheckEvery)

    // ---- sizes ---------------------------------------------------------------------------------

    @Test fun `margin is the 256 MiB floor until a tenth of the file is larger`() {
        assertEquals(256 * mib, ShareStaging.margin(0))
        assertEquals(256 * mib, ShareStaging.margin(2560 * mib))
        assertEquals(300 * mib, ShareStaging.margin(3000 * mib))
        assertEquals(1L, ShareStaging.margin(3000 * mib + 1) - 300 * mib) // the ceiling
    }

    @Test fun `limit meets both branches of the proposal's formula`() {
        assertEquals(0L, ShareStaging.limit(256 * mib))
        assertEquals(768 * mib, ShareStaging.limit(1024 * mib))
        assertEquals(2560 * mib, ShareStaging.limit(2816 * mib)) // where the branches meet
        assertEquals(10_000 * mib, ShareStaging.limit(11_000 * mib))
    }

    @Test fun `limit is the largest size that fits and one more byte does not`() {
        for (a in listOf(256 * mib + 1, 700 * mib, 2816 * mib - 1, 2816 * mib + 1, 5_000 * mib + 7, 64_000 * mib)) {
            val s = ShareStaging.limit(a)
            assertTrue("fits at A=$a", s + ShareStaging.margin(s) <= a)
            assertTrue("one more does not at A=$a", s + 1 + ShareStaging.margin(s + 1) > a)
        }
    }

    @Test fun `preflight proceeds exactly at S + M(S) and refuses one byte short`() {
        val s = 139_457L
        val need = s + 256 * mib
        assertTrue(ShareStaging.preflight(s, need) is Preflight.Go)
        val refused = ShareStaging.preflight(s, need - 1)
        assertTrue(refused is Preflight.NoSpace)
        assertEquals(need, (refused as Preflight.NoSpace).needed)
    }

    @Test fun `unknown size proceeds only above the floor, bounded by the limit`() {
        assertTrue(ShareStaging.preflight(null, 256 * mib) is Preflight.NoSpace)
        assertEquals(Preflight.Go(ShareStaging.limit(1024 * mib)), ShareStaging.preflight(null, 1024 * mib))
    }

    // ---- copy: success -------------------------------------------------------------------------

    @Test fun `zero bytes stage as an empty file with the empty-input digest`() {
        val d = dir()
        val out = copy(d, ByteArray(0))
        assertTrue(out is Outcome.Staged)
        out as Outcome.Staged
        assertEquals(0L, out.bytes)
        assertEquals(ShareStaging.EMPTY_SHA256, out.sha256)
        assertEquals(setOf("${out.attemptId}.bin", "${out.attemptId}.json"), names(d))
        assertEquals(0L to ShareStaging.EMPTY_SHA256, ShareStaging.readBack(d, out.attemptId))
    }

    @Test fun `a normal file stages byte-exact, with the digest computed independently`() {
        for (size in listOf(1024, 100_000, 139_457)) {
            val d = tmp.newFolder("n$size")
            val bytes = Random(size).nextBytes(size)
            val source = Tracked(ByteArrayInputStream(bytes))
            val out = copy(d, bytes, source = source) as Outcome.Staged
            assertEquals(size.toLong(), out.bytes)
            assertEquals(sha(bytes), out.sha256)
            assertArrayEquals(bytes, File(d, "${out.attemptId}.bin").readBytes())
            assertTrue(source.closed)
            val marker = File(d, "${out.attemptId}.json").readText()
            assertTrue(marker.contains("\"owner\":\"${ShareStaging.OWNER}\""))
            assertFalse("the marker carries no name or path", marker.contains("/") )
        }
    }

    @Test fun `a staged copy reports where its time went, with the buffer it used`() {
        // A source that takes time to read, so the split is measured rather than all zeros.
        val bytes = Random(7).nextBytes(64 * 1024)
        val slow = object : FilterInputStream(ByteArrayInputStream(bytes)) {
            override fun read(b: ByteArray, off: Int, len: Int): Int { Thread.sleep(5); return super.read(b, off, len) }
        }
        val out = copy(tmp.newFolder("timed"), bytes, source = slow, bufferSize = 16 * 1024) as Outcome.Staged
        val t = out.timing!!
        assertEquals(16 * 1024, t.bufferSize)
        assertTrue("read time includes the 4 slow reads plus the EOF read: $t", t.readMs >= 20)
        assertTrue("the total covers its parts: $t", t.totalMs >= t.readMs + t.hashMs + t.writeMs)
        assertTrue(t.line(out.bytes).contains("16 KiB buffers"))
    }

    @Test fun `attempt ids are 128-bit, well-formed and not repeated`() {
        val ids = List(2_000) { ShareStaging.newAttemptId() }
        assertEquals(ids.size, ids.toSet().size)
        assertTrue(ids.all { ShareStaging.isAttemptId(it) && it.length == 24 })
    }

    // ---- copy: every failure leaves nothing of this attempt --------------------------------------

    @Test fun `a source-read failure closes the stream and deletes the partial`() {
        val d = dir()
        val bytes = Random(1).nextBytes(100_000)
        val source = Tracked(FailAfter(ByteArrayInputStream(bytes), 32 * 1024))
        val out = copy(d, bytes, source = source)
        assertTrue(out is Outcome.SourceReadFailed)
        assertEquals(32L * 1024, (out as Outcome.SourceReadFailed).bytesWritten)
        assertEquals("java.io.IOException", out.exceptionClass)
        assertTrue(source.closed)
        assertEquals(emptySet<String>(), names(d))
    }

    @Test fun `too little space at the start of the copy writes nothing`() {
        val d = dir()
        val out = copy(d, ByteArray(10), available = { ShareStaging.FLOOR_BYTES - 1 })
        assertTrue(out is Outcome.NoSpace)
        assertEquals(emptySet<String>(), names(d))
    }

    @Test fun `space falling below the floor mid-copy stops it and deletes the partial`() {
        val d = dir()
        var calls = 0
        val bytes = Random(2).nextBytes(100_000)
        val source = Tracked(ByteArrayInputStream(bytes))
        val out = copy(d, bytes, source = source, recheckEvery = 16 * 1024,
            available = { if (calls++ == 0) 10_000 * mib else ShareStaging.FLOOR_BYTES - 1 })
        assertTrue(out is Outcome.NoSpace)
        assertTrue((out as Outcome.NoSpace).bytesWritten in 1 until 100_000)
        assertTrue(source.closed)
        assertEquals(emptySet<String>(), names(d))
        // Control: the same bytes with space that stays put stage fine.
        assertTrue(copy(d, bytes) is Outcome.Staged)
    }

    // ---- budgetStop: the version-3 budget re-check (Stage 1) -----------------------------------------

    /** A re-check's answer; the copy must carry it unchanged, whatever it says. */
    private val stop = ShareAdmission.Stop(ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET, held = 1_234, limit = 5_678)

    @Test fun `budgetStop is asked at each recheck boundary and once after the last byte, with the bytes written`() {
        val d = dir()
        val asked = mutableListOf<Long>()
        val bytes = Random(7).nextBytes(100_000)
        val out = ShareStaging.copy(ByteArrayInputStream(bytes), d, ShareStaging.newAttemptId(), Long.MAX_VALUE, plenty, never,
            nowMs = 1_000L, bufferSize = 4096, recheckEvery = 32 * 1024, budgetStop = { asked += it; null })
        assertTrue(out is Outcome.Staged)
        assertEquals("the last question is the whole file", 100_000L, asked.last())
        assertTrue("asked mid-copy too: $asked", asked.size >= 3 && asked.dropLast(1).all { it in 1 until 100_000 })
    }

    @Test fun `a stop mid-copy is BudgetStopped carrying the re-check's own answer, and leaves nothing`() {
        val d = dir()
        val bytes = Random(8).nextBytes(100_000)
        val source = Tracked(ByteArrayInputStream(bytes))
        val out = ShareStaging.copy(source, d, ShareStaging.newAttemptId(), Long.MAX_VALUE, plenty, never,
            nowMs = 1_000L, bufferSize = 4096, recheckEvery = 16 * 1024, budgetStop = { if (it < 40_000) null else stop })
        assertTrue("$out", out is Outcome.BudgetStopped)
        out as Outcome.BudgetStopped
        assertTrue(out.bytesWritten in 40_000 until 100_000)
        assertSame("the answer is carried, not rebuilt", stop, out.stop)
        assertTrue(source.closed)
        assertEquals(emptySet<String>(), names(d))
    }

    @Test fun `a stop only at the finish still keeps nothing - no bin, no marker, no partial`() {
        val d = dir()
        val bytes = Random(9).nextBytes(10_000)
        val out = ShareStaging.copy(ByteArrayInputStream(bytes), d, ShareStaging.newAttemptId(), Long.MAX_VALUE, plenty, never,
            nowMs = 1_000L, bufferSize = 4096, recheckEvery = ShareStaging.RECHECK_EVERY_BYTES, budgetStop = { if (it < 10_000) null else stop })
        assertEquals(10_000L, (out as Outcome.BudgetStopped).bytesWritten)
        assertSame(stop, out.stop)
        assertEquals(emptySet<String>(), names(d))
        // Control: the default budgetStop stages the same bytes — a version-2 copy is unchanged.
        assertTrue(copy(d, bytes) is Outcome.Staged)
    }

    @Test fun `a stopped concurrent copy deletes only its own partial - the copy already held for another offer is untouched`() {
        val d = dir()
        val heldBytes = Random(10).nextBytes(50_000)
        val heldId = ShareStaging.newAttemptId()
        val held = copy(d, heldBytes, id = heldId) as Outcome.Staged
        val before = names(d)
        assertEquals("control: the held copy exists as .bin and marker", setOf("$heldId.bin", "$heldId.json"), before)
        val out = ShareStaging.copy(ByteArrayInputStream(Random(11).nextBytes(100_000)), d, ShareStaging.newAttemptId(), Long.MAX_VALUE,
            plenty, never, nowMs = 1_000L, bufferSize = 4096, recheckEvery = 16 * 1024, budgetStop = { if (it < 30_000) null else stop })
        assertTrue("$out", out is Outcome.BudgetStopped)
        assertEquals("only the held copy remains", before, names(d))
        assertEquals(heldBytes.size.toLong() to held.sha256, ShareStaging.readBack(d, heldId))
    }

    @Test fun `a source larger than the limit is stopped at the limit and deleted`() {
        val d = dir()
        val out = copy(d, ByteArray(10_000), limit = 5_000)
        assertEquals(Outcome.OverLimit::class, out::class)
        assertEquals(emptySet<String>(), names(d))
        // Control: exactly at the limit is allowed.
        assertTrue(copy(d, ByteArray(5_000), limit = 5_000) is Outcome.Staged)
    }

    @Test fun `cancelling during the copy stops it and deletes the partial`() {
        val d = dir()
        var buffers = 0
        val bytes = Random(3).nextBytes(100_000)
        val source = Tracked(ByteArrayInputStream(bytes))
        val out = ShareStaging.copy(source, d, ShareStaging.newAttemptId(), Long.MAX_VALUE, plenty,
            cancelled = { buffers >= 3 }, nowMs = 0, bufferSize = 4096, afterBuffer = { buffers++ })
        assertTrue(out is Outcome.Cancelled)
        assertEquals(3L * 4096, (out as Outcome.Cancelled).bytesWritten)
        assertTrue(source.closed)
        assertEquals(emptySet<String>(), names(d))
    }

    // ---- never overwrite ------------------------------------------------------------------------

    @Test fun `an existing file at any of the attempt's three names is never touched`() {
        for (ext in listOf("part", "bin", "json")) {
            val d = tmp.newFolder("collide-$ext")
            val id = ShareStaging.newAttemptId()
            val theirs = File(d, "$id.$ext").apply { writeText("someone else's") }
            val out = copy(d, ByteArray(100) { 7 }, id = id)
            assertTrue("$ext collision fails", out is Outcome.WriteFailed)
            assertEquals("$ext survives", "someone else's", theirs.readText())
            assertEquals("only theirs remains ($ext)", setOf(theirs.name), names(d))
        }
    }

    // ---- sweep ----------------------------------------------------------------------------------

    private fun staged(d: File): String = (copy(d, Random.nextBytes(64)) as Outcome.Staged).attemptId

    @Test fun `after a process death the startup sweep removes every owned entry`() {
        val d = dir()
        val a = staged(d)
        val b = staged(d)
        val orphanPart = ShareStaging.newAttemptId().also { File(d, "$it.part").writeBytes(ByteArray(10)) }
        val lonelyMarker = ShareStaging.newAttemptId().also {
            File(d, "$it.json").writeText(ShareStaging.markerText(it, 0, 0, ShareStaging.EMPTY_SHA256))
        }
        assertEquals(6, names(d).size) // control: the listing sees what the sweep is about to judge

        val r = ShareStaging.sweep(d, live = emptySet(), nowMs = 0, minAgeMs = 0)
        assertEquals(6, r.deleted)
        assertEquals(0, r.leftUnrecognised)
        assertEquals(emptySet<String>(), names(d))
        listOf(a, b, orphanPart, lonelyMarker).forEach { assertTrue(ShareStaging.isAttemptId(it)) }
    }

    @Test fun `ten copies held for ten live offers survive the backstop, and a process death's startup sweep removes all ten`() {
        val d = dir()
        val ids = (1..10).map { staged(d) }
        for (id in ids) for (ext in listOf("bin", "json")) Files.setLastModifiedTime(File(d, "$id.$ext").toPath(), FileTime.fromMillis(0))
        val during = ShareStaging.sweep(d, live = ids.toSet(), nowMs = 100_000_000L, minAgeMs = ShareStaging.BACKSTOP_AGE_MS)
        assertEquals("the backstop never reaches a live offer's copy, however old", 0, during.deleted)
        assertEquals(20, names(d).size)
        val afterDeath = ShareStaging.sweep(d, live = emptySet(), nowMs = 100_000_000L, minAgeMs = 0)
        assertEquals(20, afterDeath.deleted)
        assertEquals(emptySet<String>(), names(d))
    }

    @Test fun `the sweep leaves anything it cannot prove is ours`() {
        val d = dir()
        val ours = staged(d)
        val noMarker = ShareStaging.newAttemptId().also { File(d, "$it.bin").writeText("x") }
        val wrongOwner = ShareStaging.newAttemptId().also {
            File(d, "$it.bin").writeText("x")
            File(d, "$it.json").writeText("""{"owner":"someone-else","offerId":"$it"}""")
        }
        val mismatched = ShareStaging.newAttemptId().also {
            File(d, "$it.json").writeText(ShareStaging.markerText(ShareStaging.newAttemptId(), 0, 0, "0"))
        }
        File(d, "notes.txt").writeText("x")
        File(d, "s-short.part").writeText("x")
        File(d, "${ShareStaging.newAttemptId()}.part").mkdir() // a directory with a valid name

        val r = ShareStaging.sweep(d, emptySet(), 0, 0)
        assertEquals(2, r.deleted) // exactly our .bin and .json
        assertFalse(File(d, "$ours.bin").exists())
        assertTrue(File(d, "$noMarker.bin").exists())
        assertTrue(File(d, "$wrongOwner.bin").exists() && File(d, "$wrongOwner.json").exists())
        assertTrue(File(d, "$mismatched.json").exists())
        assertTrue(File(d, "notes.txt").exists() && File(d, "s-short.part").exists())
        assertEquals(7, r.leftUnrecognised)
    }

    @Test fun `a symlink named like an entry is neither followed nor deleted`() {
        val d = dir()
        val outside = tmp.newFile("outside.bin").apply { writeText("must survive") }
        val id = ShareStaging.newAttemptId()
        Files.createSymbolicLink(File(d, "$id.part").toPath(), outside.toPath())
        val binLinkId = ShareStaging.newAttemptId()
        Files.createSymbolicLink(File(d, "$binLinkId.bin").toPath(), outside.toPath())
        File(d, "$binLinkId.json").writeText(ShareStaging.markerText(binLinkId, 0, 0, "0"))

        val r = ShareStaging.sweep(d, emptySet(), 0, 0)
        assertEquals("must survive", outside.readText())
        assertTrue(Files.isSymbolicLink(File(d, "$id.part").toPath()))
        assertTrue(Files.isSymbolicLink(File(d, "$binLinkId.bin").toPath()))
        assertEquals(1, r.deleted) // the regular marker only
        assertEquals(2, r.leftUnrecognised)
    }

    @Test fun `a staging directory that is itself a symlink is refused whole`() {
        val real = tmp.newFolder("elsewhere")
        val id = ShareStaging.newAttemptId()
        File(real, "$id.part").writeText("not ours to judge")
        val link = File(tmp.root, "linked-staging")
        Files.createSymbolicLink(link.toPath(), real.toPath())

        val r = ShareStaging.sweep(link, emptySet(), 0, 0)
        assertTrue(r.refusedDir)
        assertEquals(0, r.deleted)
        assertTrue(File(real, "$id.part").exists())
    }

    @Test fun `the backstop sweep keeps live and young entries`() {
        val d = dir()
        val live = staged(d)
        val young = staged(d)
        val old = staged(d)
        val now = 100_000_000L
        for (ext in listOf("bin", "json")) {
            Files.setLastModifiedTime(File(d, "$live.$ext").toPath(), FileTime.fromMillis(0))
            Files.setLastModifiedTime(File(d, "$young.$ext").toPath(), FileTime.fromMillis(now - 60_000))
            Files.setLastModifiedTime(File(d, "$old.$ext").toPath(), FileTime.fromMillis(0))
        }
        val r = ShareStaging.sweep(d, live = setOf(live), nowMs = now, minAgeMs = ShareStaging.BACKSTOP_AGE_MS)
        assertEquals(2, r.deleted)
        assertEquals(2, r.keptLive)
        assertEquals(2, r.keptYoung)
        assertFalse(File(d, "$old.bin").exists())
        assertTrue(File(d, "$live.bin").exists() && File(d, "$young.bin").exists())
    }

    @Test fun `a missing staging directory is an empty sweep, not an error`() {
        val r = ShareStaging.sweep(File(tmp.root, "never-made"), emptySet(), 0, 0)
        assertEquals(ShareStaging.SweepResult(0, 0, 0, 0, 0), r)
    }

    @Test fun `discard removes one attempt's regular files and nothing else`() {
        val d = dir()
        val a = staged(d)
        val b = staged(d)
        assertEquals(2, ShareStaging.discard(d, a))
        assertEquals(setOf("$b.bin", "$b.json"), names(d))
    }

    @Test fun `the staging directory is made under cache, and a symlink in its place is refused`() {
        val cache = tmp.newFolder("cache")
        assertEquals(File(cache, ShareStaging.DIR_NAME), ShareStaging.stagingDir(cache))
        assertTrue(File(cache, ShareStaging.DIR_NAME).isDirectory)

        val linked = tmp.newFolder("cache2")
        val elsewhere = tmp.newFolder("elsewhere-dir")
        Files.createSymbolicLink(File(linked, ShareStaging.DIR_NAME).toPath(), elsewhere.toPath())
        assertEquals(null, ShareStaging.stagingDir(linked))

        val plainFile = tmp.newFolder("cache3")
        File(plainFile, ShareStaging.DIR_NAME).writeText("a file, not a directory")
        assertEquals(null, ShareStaging.stagingDir(plainFile))
    }

    @Test fun `the sweep line carries counts only`() {
        val line = ShareStaging.sweepLine(ShareStaging.SweepResult(3, 99, 1, 0, 2))
        assertEquals("sweep deleted=3 bytes=99 keptLive=1 keptYoung=0 leftUnrecognised=2", line)
    }
}
