package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.FsCorruptionProbe.Candidate
import com.chetan.connectsuite.sync.v2.FsCorruptionProbe.Session
import com.chetan.connectsuite.sync.v2.FsCorruptionProbe.State
import com.chetan.connectsuite.sync.v2.FsCorruptionProbe.T4A
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * L1/L2 T4-A, the phone's half: one byte, one block pull, one session — and the real sender's digests
 * left true. The rules run on [FsCorruptionArm], the code [FsCorruptionProbe] delegates to (its own log
 * goes through `android.util.Log`, which this module cannot call); the corruption runs through the real
 * [BlockPullSender] at the real geometry. What no JVM test reaches — `FsFeature`'s claim site and
 * `BulkTransfers`' socket glue — the last tests hold, by source, to these calls and only these.
 */
class FsCorruptionProbeTest {

    private val logs = mutableListOf<Pair<Char, String>>()
    private val arm = FsCorruptionArm { level, message -> logs += level to message }

    private val doc = "1000308768"
    private val sessionA = Session("token-A", "AA:BB:CC:DD:mac-A")
    private val t0 = 1_000_000L
    private val blockSize = FsBlocks.blockSizeFor(T4A.SIZE)

    private fun candidate(
        rootId: String = T4A.ROOT_ID,
        documentId: String = doc,
        name: String = T4A.NAME,
        size: Long = T4A.SIZE,
        session: String? = "token-A",
        block: Int = blockSize,
        resumeAsked: Boolean = false,
    ) = Candidate(rootId, documentId, name, size, session, block, resumeAsked)

    private fun armed(ttlMs: Long = FsCorruptionProbe.DEFAULT_TTL_MS) =
        arm.arm(true, doc, listOf(sessionA), t0, ttlMs).also { assertTrue("control: the arm took", it is FsCorruptionProbe.ArmResult.Armed) }

    // ---- the geometry the plan's numbers depend on ---------------------------------------------------

    @Test
    fun `the fixed byte is 64 KiB into zero-based block 800 of 1,600 at the rule's block size`() {
        assertEquals(131_072, blockSize)
        assertEquals(1_600L, FsBlocks.blockCountFor(T4A.SIZE, blockSize))
        assertEquals(T4A.BLOCK, T4A.AT_BYTE / blockSize)
        assertEquals(65_536L, T4A.AT_BYTE % blockSize)
        assertTrue("above the 64 MiB pre-hash ceiling, so it takes the block path", T4A.SIZE > 64L * 1024 * 1024)
    }

    // ---- targeting ----------------------------------------------------------------------------------

    @Test
    fun `the armed document's fresh block pull on the armed session gets the byte, once`() {
        armed()
        assertEquals(T4A.AT_BYTE, arm.claim(candidate(), debuggable = true, nowMs = t0 + 1))
        assertEquals("one-shot: consumed by that transfer", State.Disarmed, arm.state())
        assertNull("the same pull asked again is not bound a second time", arm.claim(candidate(), true, t0 + 2))
        assertTrue("arming writes an E line", logs.any { it.first == 'E' && it.second.contains("PROBE ARMED") })
    }

    @Test
    fun `an unrelated pull is untouched and leaves the arm for the one it names`() {
        armed()
        val unrelated = listOf(
            candidate(documentId = "1000308769", name = "sidekick-pass-stop-200mb (2).bin"),
            candidate(rootId = "saf:primary%3ADownload"),
            candidate(rootId = FsPaths.APP_ROOT_ID),
            candidate(documentId = "1000312207", name = "sidekick-rc-96m-checksum.bin", size = 100_663_296L),
        )
        unrelated.forEach { assertNull("$it", arm.claim(it, true, t0 + 1)) }
        assertTrue("still armed after ${unrelated.size} unrelated pulls", arm.state() is State.Armed)
        assertEquals("control: the named pull still binds afterwards", T4A.AT_BYTE, arm.claim(candidate(), true, t0 + 2))
    }

    @Test
    fun `the approved document asked for in any other way clears the arm instead of binding`() {
        val nearMisses = mapOf(
            "another session" to candidate(session = "token-B"),
            "no session token" to candidate(session = null),
            "another size" to candidate(size = T4A.SIZE - 1),
            "another name" to candidate(name = "renamed.bin"),
            "a resume" to candidate(resumeAsked = true),
            "another block size" to candidate(block = 262_144),
        )
        for ((label, c) in nearMisses) {
            armed()
            assertNull(label, arm.claim(c, true, t0 + 1))
            assertEquals("$label: cleared", State.Disarmed, arm.state())
            assertNull("$label: and the right pull after it is not bound either", arm.claim(candidate(), true, t0 + 2))
        }
    }

    // ---- lifetime -----------------------------------------------------------------------------------

    @Test
    fun `an arm expires at its deadline, and a pull at the deadline is not bound`() {
        armed(ttlMs = 60_000)
        assertNull(arm.claim(candidate(), true, t0 + 60_000))
        assertEquals(State.Disarmed, arm.state())
        armed(ttlMs = 60_000)
        assertEquals("control: one millisecond before the deadline it binds", T4A.AT_BYTE, arm.claim(candidate(), true, t0 + 59_999))
    }

    @Test
    fun `the lifetime is bounded, and an out-of-range one is refused rather than clamped`() {
        for (ttl in listOf(0L, FsCorruptionProbe.MIN_TTL_MS - 1, FsCorruptionProbe.MAX_TTL_MS + 1, -1000L)) {
            assertTrue("$ttl", arm.arm(true, doc, listOf(sessionA), t0, ttl) is FsCorruptionProbe.ArmResult.Refused)
        }
        assertTrue(arm.arm(true, doc, listOf(sessionA), t0, FsCorruptionProbe.MAX_TTL_MS) is FsCorruptionProbe.ArmResult.Armed)
    }

    @Test
    fun `an explicit disarm clears it and says whether there was one`() {
        armed()
        assertTrue(arm.disarm("test"))
        assertNull(arm.claim(candidate(), true, t0 + 1))
        assertFalse("nothing to disarm the second time", arm.disarm("test"))
    }

    @Test
    fun `the armed session ending clears it, another session ending does not, and the replacement is never bound`() {
        armed()
        arm.sessionEnded("token-other")
        assertTrue("another session ending leaves it", arm.state() is State.Armed)
        arm.sessionEnded("token-A")
        assertEquals(State.Disarmed, arm.state())
        assertNull("the reconnect's pull of the same file", arm.claim(candidate(session = "token-B"), true, t0 + 1))
    }

    // ---- fail-closed arming -------------------------------------------------------------------------

    @Test
    fun `arming refuses without one identifiable session, a document id, or a debuggable build, and a refusal clears an earlier arm`() {
        val refusals = mapOf(
            "not debuggable" to { arm.arm(false, doc, listOf(sessionA), t0, 60_000) },
            "no session" to { arm.arm(true, doc, emptyList(), t0, 60_000) },
            "two sessions" to { arm.arm(true, doc, listOf(sessionA, Session("token-B", "BB")), t0, 60_000) },
            "a session with no token" to { arm.arm(true, doc, listOf(Session(null, "AA")), t0, 60_000) },
            "no document id" to { arm.arm(true, null, listOf(sessionA), t0, 60_000) },
            "a blank document id" to { arm.arm(true, " ", listOf(sessionA), t0, 60_000) },
            "a path, not an id" to { arm.arm(true, "Download/ConnectSuite/${T4A.NAME}", listOf(sessionA), t0, 60_000) },
            "a non-positive id" to { arm.arm(true, "0", listOf(sessionA), t0, 60_000) },
        )
        for ((label, attempt) in refusals) {
            armed()
            assertTrue(label, attempt() is FsCorruptionProbe.ArmResult.Refused)
            assertEquals("$label: the earlier arm is cleared", State.Disarmed, arm.state())
            assertNull(label, arm.claim(candidate(), true, t0 + 1))
        }
    }

    @Test
    fun `a claim in a non-debuggable build binds nothing, even if an arm were somehow standing`() {
        armed()
        assertNull(arm.claim(candidate(), debuggable = false, nowMs = t0 + 1))
        assertEquals(State.Disarmed, arm.state())
    }

    // ---- the flip, through the real sender ----------------------------------------------------------

    @Test
    fun `flip changes exactly the one byte, by XOR 0xFF, only when it is in the chunk`() {
        val chunk = ByteArray(16) { it.toByte() }
        assertNull(FsCorruptionProbe.flip(chunk, 100, 99))
        assertNull(FsCorruptionProbe.flip(chunk, 100, 116))
        assertEquals((0 until 16).map { it.toByte() }, chunk.toList())
        assertEquals(5.toByte(), FsCorruptionProbe.flip(chunk, 100, 105))
        assertEquals((5 xor 0xFF).toByte(), chunk[5])
        assertEquals("every other byte untouched", (0 until 16).filter { it != 5 }.map { it.toByte() }, chunk.toList().filterIndexed { i, _ -> i != 5 })
    }

    /** The source, generated: never stored, never written. Byte i is a pure function of i. */
    private fun byteAt(i: Long): Byte = ((i * 31) xor (i ushr 13) xor (i ushr 27)).toByte()

    private inner class Synthetic(private val size: Long) : InputStream() {
        private var pos = 0L
        override fun read(): Int = if (pos >= size) -1 else byteAt(pos++).toInt() and 0xFF
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos >= size) return -1
            val n = minOf(len.toLong(), size - pos).toInt()
            for (k in 0 until n) b[off + k] = byteAt(pos + k)
            pos += n
            return n
        }
    }

    private fun sha(bytes: ByteArray, from: Int = 0, len: Int = bytes.size) =
        FsBlocks.hex(MessageDigest.getInstance("SHA-256").apply { update(bytes, from, len) }.digest())

    @Test
    fun `T4-A through the real BlockPullSender - one byte differs on the wire, every reported digest is of the true bytes, so block 800 is the one that fails`() {
        val mtime = 1_759_140_000_000L
        val at = T4A.AT_BYTE
        val reported = mutableListOf<String>()
        val wire = FsBlocks.Hasher(blockSize)
        val differing = mutableListOf<Long>()
        val sink = object : BlockPullSender.Sink {
            override fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long) {
                // Exactly what BulkTransfers' block sink does: copy only a short chunk, flip, then write.
                val out = if (length == buffer.size) buffer else buffer.copyOf(length)
                FsCorruptionProbe.flip(out, absoluteStart, at)
                for (k in out.indices) if (out[k] != byteAt(absoluteStart + k)) differing += absoluteStart + k
                wire.update(out)
            }
            override fun blocks(first: Long, digests: List<String>) {
                assertEquals("digests arrive in order, without gaps", reported.size.toLong(), first)
                reported += digests
            }
            override fun progress(phase: String, bytes: Long) = Unit
        }
        val outcome = BlockPullSender(T4A.SIZE, mtime, blockSize, null, chunk = 256 * 1024).run(
            Synthetic(T4A.SIZE), { T4A.SIZE to mtime }, { false }, sink,
        )

        assertTrue("$outcome", outcome is BlockPullSender.Outcome.Sent)
        outcome as BlockPullSender.Outcome.Sent
        assertEquals(T4A.SIZE, outcome.bytesSent)
        assertEquals(1_600L, outcome.blockCount)
        assertEquals("exactly one byte left the phone changed, and it is the fixed one", listOf(at), differing)

        val onWire = wire.finish().map { FsBlocks.hex(it) }
        assertEquals(1_600, reported.size)
        val mismatched = reported.indices.filter { reported[it] != onWire[it] }
        assertEquals("the receiver's block check fails at block 800 and only there", listOf(800), mismatched)

        // The reported digest of block 800 is the TRUE block's, read again from a fresh source.
        val trueBlock = ByteArray(blockSize).also { b -> Synthetic(T4A.SIZE).apply { skipExactly(800L * blockSize) }.readNBytesCompat(b) }
        assertEquals(sha(trueBlock), reported[800])
        assertNotEquals(sha(trueBlock), onWire[800])
        assertEquals("the manifest is over the true digests", FsBlocks.hex(FsBlocks.rootOf(reported.map { hexBytes(it) })), outcome.manifestRoot)
        val trueWhole = MessageDigest.getInstance("SHA-256")
        Synthetic(T4A.SIZE).use { s -> val b = ByteArray(1 shl 20); while (true) { val n = s.read(b); if (n <= 0) break; trueWhole.update(b, 0, n) } }
        assertEquals("the whole-file digest is the true file's", FsBlocks.hex(trueWhole.digest()), outcome.sha256)
    }

    private fun InputStream.skipExactly(n: Long) {
        val b = ByteArray(1 shl 20)
        var left = n
        while (left > 0) { val r = read(b, 0, minOf(left, b.size.toLong()).toInt()); check(r > 0); left -= r }
    }

    private fun InputStream.readNBytesCompat(into: ByteArray) {
        var at = 0
        while (at < into.size) { val r = read(into, at, into.size - at); check(r > 0); at += r }
    }

    private fun hexBytes(hex: String) = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    // ---- the glue no JVM test can run, held by source -----------------------------------------------

    private val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "sync-module").isDirectory }
    private val v2 = "sync-module/src/main/java/com/chetan/connectsuite/sync/v2"

    /** Code only: KDoc and comments name the calls these rules forbid. */
    private fun code(f: File): String =
        f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    private fun body(src: String, signature: String): String {
        val start = src.indexOf(signature).also { assertTrue("control: found `$signature`", it >= 0) }
        val next = Regex("\\n    (private |internal )?fun ").find(src, start + signature.length)?.range?.first ?: src.length
        return src.substring(start, next)
    }

    private fun mainKotlin(): List<File> =
        root.listFiles()!!.filter { File(it, "src/main").isDirectory }
            .flatMap { File(it, "src/main").walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }

    @Test
    fun `the claim has one call site - the block-pull begin - so Photos, Share, pushes and small pulls never ask`() {
        val sources = mainKotlin()
        assertTrue("control: main sources were read", sources.any { it.name == "FsFeature.kt" })
        val callers = sources.filter { it.name != "FsCorruptionProbe.kt" && code(it).contains("FsCorruptionProbe.claim(") }.map { it.name }
        assertEquals(listOf("FsFeature.kt"), callers)
        val fs = code(File(root, "$v2/FsFeature.kt"))
        assertEquals(1, Regex("FsCorruptionProbe\\.claim\\(").findAll(fs).count())
        val blockBegin = body(fs, "private fun onBeginBlockPull(")
        assertTrue("the claim is in onBeginBlockPull", blockBegin.contains("FsCorruptionProbe.claim("))
        assertTrue("its byte goes to that transfer's registration", blockBegin.contains("registerBlockPull(store, entry, sessionId, blockSize, resume, debugCorruptAtByte = corruptAt)"))
        assertFalse("the small-pull path never asks", body(fs, "private fun onBegin(").contains("FsCorruptionProbe.claim("))
        val arms = sources.filter { it.name != "FsCorruptionProbe.kt" && (code(it).contains("FsCorruptionProbe.arm(") || code(it).contains("FsCorruptionArm(")) }
        assertEquals("no main source arms it", emptyList<File>(), arms)
    }

    @Test
    fun `BulkTransfers has no global switch - a byte is flipped only for the entry that carries one`() {
        val bulk = code(File(root, "$v2/BulkTransfers.kt"))
        assertFalse("the global hook is gone", Regex("var\\s+debugCorruptAtByte").containsMatchIn(bulk))
        val corrupt = body(bulk, "private fun corruptIfArmed(")
        assertTrue(corrupt.contains("val at = entry.debugCorruptAtByte ?: return"))
        assertTrue(corrupt.contains("FsCorruptionProbe.flip(chunk, absoluteStart, at)"))
        assertEquals("called from the pull and the block-pull loops only, never the push", 2, Regex("corruptIfArmed\\(entry,").findAll(bulk).count())
        assertFalse("the push path never corrupts", body(bulk, "private fun receiveFrom(").contains("corruptIfArmed"))
        for (register in listOf("fun registerMediaPull(", "fun registerFsPull(")) {
            assertFalse("$register carries no corruption byte", body(bulk, register).contains("debugCorruptAtByte"))
        }
        assertTrue(body(bulk, "fun registerBlockPull(").contains("debugCorruptAtByte = debugCorruptAtByte,"))
        assertTrue("a session ending clears an arm bound to it", body(bulk, "fun forgetSession(").contains("FsCorruptionProbe.sessionEnded(sessionId)"))
    }

    @Test
    fun `FsCorruptionProbe decides nothing itself - every rule is FsCorruptionArm's`() {
        val probe = code(File(root, "$v2/FsCorruptionProbe.kt"))
        val obj = probe.substring(probe.indexOf("object FsCorruptionProbe"), probe.indexOf("class FsCorruptionArm"))
        for (fn in listOf("state()", "arm(debuggable, documentId, sessions, nowMs, ttlMs)", "disarm(why)", "sessionEnded(token)", "claim(candidate, debuggable, nowMs)")) {
            assertTrue("delegates $fn", obj.contains("instance.$fn"))
        }
        assertFalse("no state of its own", Regex("var\\s+state").containsMatchIn(obj))
    }
}
