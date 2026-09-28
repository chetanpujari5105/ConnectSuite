package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.v2.ShareManyQueue.NotSentWhy
import com.chetan.connectsuite.sync.v2.ShareManyQueue.Prep
import com.chetan.connectsuite.sync.v2.ShareManyQueue.WaitReason
import com.chetan.connectsuite.sync.v2.ShareSelection.Decision
import com.chetan.connectsuite.sync.v2.ShareSelection.Item
import com.chetan.connectsuite.sync.v2.ShareSelection.Refusal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.rules.Timeout
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.random.Random

/**
 * Stage 2 (development only): several files from one `SEND_MULTIPLE`, prepared one at a time
 * (docs/feature-a-multi-offer-proposal.md rev 4 §11–§15). Synthetic bytes of a few KiB in a JUnit
 * temporary folder; free space, `Σ`, the live-offer count and the §4 readings are numbers the test
 * supplies. **No figure measured on a device appears here.**
 *
 * [FakeEnv] stands in for `ShareFeature`: an offer it takes becomes a live offer whose bytes count in
 * `Σ` until the test ends it — the same accounting `ShareFeature.stagingContext` does.
 */
class ShareManyQueueTest {

    @get:Rule val tmp = TemporaryFolder()
    /** A rule that loops (a second retry, a Busy re-copied at once) must fail here, not hang the suite. */
    @get:Rule val timeout: Timeout = Timeout.seconds(20)

    private val kib = 1024L
    private val gib = 1024L * 1024 * 1024
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private fun bytes(n: Int, seed: Int) = Random(seed).nextBytes(n)

    private inner class FakeEnv(val sources: List<ByteArray>, val dir: File) : ShareManyQueue.Env {
        var version = 3
        var free = 40 * gib
        /** Room for one extra copy, as the §4 budget would measure it: Bq = room − w. Null: no readings. */
        var room: Long? = 1 * gib
        var liveOverride: Int? = null
        val live = LinkedHashMap<String, Long>()
        val offered = mutableListOf<Pair<Int, String>>()
        var answer: (Int) -> ShareFeature.OfferOutcome? = { null }
        var opener: (Int) -> InputStream = { ByteArrayInputStream(sources[it]) }
        var running = 0
        var maxRunning = 0
        val opened = mutableListOf<Int>()

        /** Live offers the Mac has accepted (queued, receiving or checking) — `ShareFeature.inProgress`. */
        val accepted = mutableSetOf<String>()
        /** The monotonic clock the stall clock reads; the test moves it. `nowMs` stays 0 throughout. */
        var mono = 0L

        /** The live session's identity (`ShareFeature.liveSession`); null supplies none, as before. */
        var session: Any? = null
        override fun session() = session
        override fun context() = version to live.values.sum()
        override fun liveOffers() = liveOverride ?: live.size
        override fun inProgress() = live.filterKeys { it in accepted }.let { it.size to it.values.sum() }
        override fun monotonicMs() = mono
        override fun free() = free
        override fun concurrent(): ShareAdmission.Concurrent? = room?.let { r ->
            ShareAdmission.Concurrent(
                // This app's cache is what is really in staging — held copies, markers and the running
                // partial — as the platform's own reading would be. Q is chosen so Bq = room − w exactly.
                read = { h ->
                    val entries = dir.listFiles()!!.toList()
                    val cache = entries.sumOf { it.length() }
                    val markers = entries.filter { it.name.endsWith(".json") }.sumOf { it.length() }
                    ShareConcurrentBudget.Readings(quotaBytes = 2 * (h + r + markers), ownCacheBytes = cache, heldBytes = h,
                        usableBytes = 40 * gib, totalBytes = 100 * gib, readAtMs = 0)
                },
                nowMs = { 0 },
            )
        }
        override fun open(index: Int): InputStream { opened += index; return opener(index) }
        override fun offer(index: Int, attemptId: String, bytes: Long, sha256: String): ShareFeature.OfferOutcome {
            answer(index)?.let { return it }
            assertEquals("the offered digest is the source's", sha(sources[index]), sha256)
            live[attemptId] = bytes
            offered += index to attemptId
            return ShareFeature.OfferOutcome.Offered(attemptId, 0)
        }
        override fun nowMs() = 0L
        val notPrepared = mutableListOf<NotPrepared>()
        override fun notPrepared(index: Int, attemptId: String?, why: NotSentWhy, cause: String?) { notPrepared += NotPrepared(index, attemptId, why, cause) }
        fun accept(index: Int) { accepted += offered.first { it.first == index }.second }
        override fun attempt(attemptId: String, running: Boolean) {
            this.running += if (running) 1 else -1
            maxRunning = maxOf(maxRunning, this.running)
        }
        /** The offer ends: like `ShareFeature`, its staged copy is deleted and it leaves `Σ`. */
        fun endOffer(index: Int) {
            val id = offered.first { it.first == index }.second
            live.remove(id)
            accepted.remove(id)
            ShareStaging.discard(dir, id)
        }
    }

    private data class NotPrepared(val index: Int, val attemptId: String?, val why: NotSentWhy, val cause: String?)

    private fun queue(dir: File, env: FakeEnv, expected: List<Long?> = env.sources.map { it.size.toLong() }) = ShareManyQueue(dir, expected, env)

    /** What is left in staging: exactly the copies of live offers, and never a partial. */
    private fun assertStagingHoldsOnly(dir: File, env: FakeEnv) {
        val names = dir.list()!!.toSet()
        assertTrue("no partial is ever left: $names", names.none { it.endsWith(".part") })
        assertEquals(env.live.keys.flatMap { listOf("$it.bin", "$it.json") }.toSet(), names)
    }

    private fun offered(p: Prep) = p is Prep.Offered

    // ---- the selection as a whole (§15, C6) ---------------------------------------------------------

    @Test fun `0, 1, 2, 10 and 11 files`() {
        val send = ShareSelection.ACTION_SEND_MULTIPLE
        fun items(n: Int) = List(n) { Item("content", "image/jpeg") }
        assertEquals(Decision.Refuse(Refusal.NO_FILES), ShareSelection.decide(send, items(0), false))
        for (n in listOf(1, 2, 10)) assertEquals(Decision.Take(n), ShareSelection.decide(send, items(n), false))
        assertEquals("never truncated", Decision.Refuse(Refusal.TOO_MANY), ShareSelection.decide(send, items(11), false))
    }

    @Test fun `the streams - EXTRA_STREAM when it has any, else ClipData, and a missing item refuses at its index, never shrinks the list`() {
        val send = ShareSelection.ACTION_SEND_MULTIPLE
        assertEquals(listOf("a", "b"), ShareSelection.streams(listOf("a", "b"), listOf("x")))
        assertEquals("an empty EXTRA_STREAM does not hide the ClipData", listOf("x", "y"), ShareSelection.streams(emptyList(), listOf("x", "y")))
        assertEquals(listOf("x"), ShareSelection.streams<String>(null, listOf("x")))
        assertEquals(emptyList<String?>(), ShareSelection.streams<String>(null, null))
        // A ClipData of three whose second item is text, not a URI: three items, and the second is refused.
        val three = ShareSelection.streams(null, listOf("content://p/1", null, "content://p/3"))
        assertEquals(3, three.size)
        val items = three.map { Item(it?.substringBefore(':'), "image/jpeg") }
        assertEquals(Decision.Refuse(Refusal.NOT_CONTENT, 2), ShareSelection.decide(send, items, false))
    }

    @Test fun `several files need version 3 - one file never does - no Mac is not a refusal`() {
        assertEquals(Refusal.NEEDS_VERSION_3, ShareSelection.atSend(2, 2))
        assertEquals(Refusal.NEEDS_VERSION_3, ShareSelection.atSend(10, 1))
        assertNull(ShareSelection.atSend(2, 3))
        assertNull(ShareSelection.atSend(10, 3))
        assertNull("one file is a single-file share at version 2", ShareSelection.atSend(1, 2))
        assertNull("no Mac: Send stays disabled, not refused", ShareSelection.atSend(2, 0))
    }

    // ---- one at a time, each offered when ready ---------------------------------------------------

    @Test fun `two files are copied one at a time and offered in selection order`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(5000, 1), bytes(7000, 2)))
        assertEquals(2, queue(dir, env).evaluate())
        assertEquals(listOf(0, 1), env.offered.map { it.first })
        assertEquals(1, env.maxRunning)
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `ten files - every one offered, never two copies at once`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = List(10) { bytes(1000 + it * 100, it) })
        val q = queue(dir, env)
        q.evaluate()
        assertEquals((0 until 10).toList(), env.offered.map { it.first })
        assertEquals(1, env.maxRunning)
        assertTrue(q.states().all(::offered))
        assertFalse(q.unfinished())
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `a version-2 session takes nothing from a selection of several`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { version = 2 }
        val q = queue(dir, env)
        assertEquals(0, q.evaluate())
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.MacCannotReceive) }, q.states())
        assertTrue(env.opened.isEmpty())
        assertTrue(dir.list()!!.isEmpty())
    }

    // ---- waiting for room (§12) -------------------------------------------------------------------

    @Test fun `an extra copy the budget refuses waits with the measured limit, and goes when the offer ends`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(9000, 2))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.Waiting(WaitReason.NoRoom(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, 5000)), q.states()[1])
        assertEquals("nothing of the waiting file was read", listOf(0), env.opened)
        env.endOffer(0) // Σ = 0: the single-file rule decides, and it fits
        q.evaluate()
        assertTrue(offered(q.states()[1]))
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `a missing reading makes an extra copy wait, never fail`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { room = null }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.NoRoom(null, null)), q.states()[1])
    }

    @Test fun `a never-tried file may go ahead of a waiting one - a waiting file is never overtaken by another`() {
        val dir = tmp.newFolder()
        // A is offered (4 KB held); B (9 KB) waits; C (1 KB) was never tried, fits, and goes ahead of B.
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(9000, 2), bytes(1000, 3), bytes(6000, 4))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertTrue(q.states()[1] is Prep.Waiting)
        assertTrue("never tried, so it may go ahead", offered(q.states()[2]))
        assertTrue(q.states()[3] is Prep.Waiting)
        // Room for D (6 KB) but not for B (9 KB): D must not overtake B.
        env.room = 7000
        q.evaluate()
        assertTrue(q.states()[1] is Prep.Waiting)
        assertTrue("a waiting file is never overtaken by another waiting file", q.states()[3] is Prep.Waiting)
        env.room = 10_000
        q.evaluate()
        assertTrue(offered(q.states()[1]))
        assertTrue(offered(q.states()[3]))
        assertEquals(listOf(0, 2, 1, 3), env.offered.map { it.first })
    }

    @Test fun `ten live offers make a file wait, and it goes when one ends`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { liveOverride = 10 }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(List(2) { Prep.Waiting(WaitReason.LiveLimit) }, q.states())
        env.liveOverride = null
        q.evaluate()
        assertTrue(q.states().all(::offered))
    }

    @Test fun `a busy answer deletes the copy, sends the file back to waiting, and does not loop`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2)))
        val other = ShareOffer.Offer("s-" + "A".repeat(22), "k", 1, "0".repeat(64), 0, 1, name = "x", mime = "a/b")
        env.answer = { ShareFeature.OfferOutcome.Busy(other) }
        val q = queue(dir, env)
        assertEquals(1, q.evaluate())
        assertEquals(Prep.Waiting(WaitReason.LiveLimit), q.states()[0])
        assertEquals(Prep.NotStarted, q.states()[1])
        assertTrue(dir.list()!!.isEmpty())
        env.answer = { null }
        q.evaluate()
        assertTrue(q.states().all(::offered))
    }

    @Test fun `a file too large even with every held copy released fails at once, and the rest go on`() {
        val dir = tmp.newFolder()
        val mib = 1024L * 1024
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { free = 300 * mib }
        // Item 1 claims 60 MiB: 60 + 256 > 300 + Σ.
        val q = queue(dir, env, expected = listOf(100L, 60 * mib))
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.NotSent(NotSentWhy.NoSpace(60 * mib + ShareStaging.margin(60 * mib), 300 * mib)), q.states()[1])
        assertEquals("never opened", listOf(0), env.opened)
    }

    // ---- unknown sizes (§14) ----------------------------------------------------------------------

    @Test fun `an unknown size alone past the single-file limit fails, with no retry`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(8000, 1))).apply { free = ShareStaging.FLOOR_BYTES + 4096 }
        val q = queue(dir, env, expected = listOf(null))
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.TooLarge(4096)), q.states()[0])
        q.evaluate()
        assertEquals("no retry", listOf(0), env.opened)
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `unknown size beside a held copy - bound, verified deletion, one retry alone`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 4096 }
        val q = queue(dir, env, expected = listOf(3000L, null))
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone), q.states()[1])
        assertEquals(listOf(0, 1), env.opened)
        assertStagingHoldsOnly(dir, env)
        // Σ > 0 still: the retry waits; nothing is read.
        q.evaluate()
        assertEquals(listOf(0, 1), env.opened)
        env.endOffer(0)
        q.evaluate()
        assertTrue(offered(q.states()[1]))
        assertEquals("attempt 2 ran once", listOf(0, 1, 1), env.opened)
    }

    @Test fun `the retry past the single-file limit fails - there is no attempt 3`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 4096 }
        val q = queue(dir, env, expected = listOf(3000L, null))
        q.evaluate()
        env.endOffer(0)
        env.free = ShareStaging.FLOOR_BYTES + 5000
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.TooLarge(5000)), q.states()[1])
        q.evaluate()
        assertEquals(listOf(0, 1, 1), env.opened)
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `a known size the provider under-reported takes the same path`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 4096 }
        val q = queue(dir, env, expected = listOf(3000L, 1000L))
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone), q.states()[1])
    }

    /**
     * §14 (2), the branch no other test reaches: attempt 1 of an extra copy stops at its bound and
     * `ShareStaging.copy`'s own delete of the partial **fails**. Produced for real, not modelled: the
     * staging directory is made read-only (`r-x`) at the source's first read, after the `.part` exists, so
     * the delete inside `copy` is refused by the file system; the stream's `close()` — which `copy` runs
     * after its delete — restores it. Then the queue must fail closed: no retry, no offer, no delete of
     * anything it cannot name, and a per-file reason naming the attempt.
     */
    @Test fun `a partial that cannot be confirmed deleted - no retry, no offer, nothing else deleted, one per-file reason`() {
        val dir = tmp.newFolder()
        // Things in staging this queue did not make: a well-formed attempt name that is not ours, and a stranger.
        val foreignId = ShareStaging.newAttemptId()
        val foreign = File(dir, "$foreignId.part").apply { writeBytes(bytes(8, 90)) }
        val stranger = File(dir, "notes.txt").apply { writeBytes(bytes(8, 91)) }
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2), bytes(100, 3))).apply { room = 4096 }
        var locked = 0
        env.opener = { i ->
            if (i != 1) ByteArrayInputStream(env.sources[i]) else object : InputStream() {
                val src = ByteArrayInputStream(env.sources[1])
                override fun read(): Int = src.read()
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (locked == 0) { assertTrue("control: the directory was made read-only", dir.setWritable(false)); locked++ }
                    return src.read(b, off, minOf(len, 1024))
                }
                override fun close() { dir.setWritable(true) }
            }
        }
        try {
            val q = queue(dir, env, expected = listOf(3000L, null, 100L))
            q.evaluate()
            assertTrue(offered(q.states()[0]))
            assertEquals(Prep.NotSent(NotSentWhy.CleanupUnverified), q.states()[1])

            // Identified by the attempt the queue reports, and only that attempt: its partial is still there, untouched.
            val (index, id, why) = env.notPrepared.single().let { Triple(it.index, it.attemptId!!, it.why) }
            assertEquals(1, index)
            assertEquals(NotSentWhy.CleanupUnverified, why)
            val left = File(dir, "$id.part")
            assertTrue("the partial is still there: the delete in copy failed, and the queue did not delete it either", left.isFile)
            assertTrue("control: the copy stopped past its first buffer", left.length() >= 1024)
            assertTrue("the partial is exactly what was read — nothing rewrote it", env.sources[1].copyOfRange(0, left.length().toInt()).contentEquals(left.readBytes()))

            // Σ = 0 now, the state in which a retry would run: it must not. The third file goes on.
            env.endOffer(0)
            q.evaluate()
            q.evaluate()
            assertEquals(Prep.NotSent(NotSentWhy.CleanupUnverified), q.states()[1])
            assertTrue("the rest go on", offered(q.states()[2]))
            assertEquals("no retry: opened once", 1, env.opened.count { it == 1 })
            assertFalse("never offered", env.offered.any { it.first == 1 })
            assertFalse(q.anyWaiting())

            // Leaving ends nothing more and deletes nothing it cannot name.
            assertEquals("nothing deleted on leaving", 0, q.end(NotSentWhy.ScreenClosed))
            assertEquals(Prep.NotSent(NotSentWhy.CleanupUnverified), q.states()[1])
            assertTrue(left.isFile)
            assertTrue("a well-formed attempt that is not ours is left", foreign.isFile)
            assertTrue("a stranger is left", stranger.isFile)
            assertEquals("exactly: the unverified partial, the two strangers, and the live offer's copy",
                setOf("$id.part", foreign.name, stranger.name) + env.live.keys.flatMap { listOf("$it.bin", "$it.json") },
                dir.list()!!.toSet())
            assertEquals("one per-file reason, for that file only", listOf(1), env.notPrepared.map { it.index })
        } finally {
            dir.setWritable(true)
        }
    }

    @Test fun `leftBehind sees a link where a partial was, without following it`() {
        val dir = tmp.newFolder()
        val id = ShareStaging.newAttemptId()
        assertFalse(ShareManyQueue.leftBehind(dir, id))
        Files.createSymbolicLink(File(dir, "$id.part").toPath(), File(dir, "nowhere").toPath())
        assertTrue("a dangling link is something left behind", ShareManyQueue.leftBehind(dir, id))
    }

    // ---- one file's failure, and the rest (§15) ---------------------------------------------------

    @Test fun `one file failing beside successes ends only that file`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(9000, 2), bytes(100, 3), bytes(100, 4)))
        env.opener = { i ->
            when (i) {
                1 -> object : InputStream() { // reads part-way, then access ends
                    var n = 0
                    override fun read(): Int = if (n++ < 4000) 1 else throw IOException("gone")
                    override fun read(b: ByteArray, off: Int, len: Int): Int = if (n < 4000) { n += len; len } else throw IOException("gone")
                }
                2 -> throw SecurityException("no grant")
                else -> ByteArrayInputStream(env.sources[i])
            }
        }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.NotSent(NotSentWhy.ReadFailed), q.states()[1])
        assertEquals(Prep.NotSent(NotSentWhy.OpenFailed), q.states()[2])
        assertTrue(offered(q.states()[3]))
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `the screen closing mid-copy deletes the partial, ends the rest, and never touches an offered file`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(200_000, 2), bytes(100, 3)))
        lateinit var q: ShareManyQueue
        env.opener = { i ->
            if (i != 1) ByteArrayInputStream(env.sources[i]) else object : InputStream() {
                val src = ByteArrayInputStream(env.sources[1])
                var read = 0
                override fun read(): Int = src.read()
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (read > 0) q.end(NotSentWhy.ScreenClosed) // the second buffer: the screen closes
                    return src.read(b, off, minOf(len, 65_536)).also { read += it }
                }
            }
        }
        q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.NotSent(NotSentWhy.ScreenClosed), q.states()[1])
        assertEquals(Prep.NotSent(NotSentWhy.ScreenClosed), q.states()[2])
        assertEquals("only the first was offered", listOf(0), env.offered.map { it.first })
        assertStagingHoldsOnly(dir, env)
        assertEquals("nothing further is read", listOf(0, 1), env.opened)
    }

    @Test fun `the session ending ends every file not yet offered and nothing more is read`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(9000, 2))).apply { room = 10 }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(q.states()[1] is Prep.Waiting)
        env.version = 0
        env.live.clear()
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.NotSent(NotSentWhy.Disconnected), q.states()[1])
        assertEquals(listOf(0), env.opened)
    }

    @Test fun `a reconnect between evaluations is a different session - the rest is not offered there`() {
        val dir = tmp.newFolder()
        val a = Any()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(9000, 2))).apply { room = 10; session = a }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertTrue("control: the second file waits on the first", q.states()[1] is Prep.Waiting)
        // The link drops and comes back before the next trigger: still version 3, and the first offer ended.
        env.endOffer(0)
        env.session = Any()
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.Disconnected), q.states()[1])
        assertEquals("nothing was opened for the new session", listOf(0), env.opened)
        assertEquals("nothing was offered on it", 1, env.offered.size)
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `a reconnect while a file is copying - that copy is deleted, never offered on the new session`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { session = Any() }
        val sources = env.sources
        env.opener = { i -> if (i == 1) env.session = Any(); ByteArrayInputStream(sources[i]) }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]))
        assertEquals(Prep.NotSent(NotSentWhy.Disconnected), q.states()[1])
        assertEquals(listOf(0), env.offered.map { it.first })
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `one session throughout - every file is offered (control for the two above)`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2), bytes(100, 3))).apply { session = Any() }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(q.states().all { offered(it) })
    }

    @Test fun `no session at offer time ends the selection and deletes the copy`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { answer = { ShareFeature.OfferOutcome.NoSession } }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.Disconnected) }, q.states())
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `a copy the offer refuses as out of rule is deleted and ends that file only`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { answer = { if (it == 0) ShareFeature.OfferOutcome.Invalid("name") else null } }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.OutOfRule), q.states()[0])
        assertTrue(offered(q.states()[1]))
        assertStagingHoldsOnly(dir, env)
    }

    // ---- closing versus opening (§11): no shared URI is opened once the end has taken effect -------

    /**
     * The window the pre-hardware review found: `run()` checked `ended`, released the lock, then opened.
     * An end landing between the two let one more URI be opened after the screen had closed. Driven
     * with latches and thread states, never a sleep: the open parks inside [ShareManyQueue.Env.open],
     * the end is started on a second thread, and the test waits until that thread has either finished or
     * parked — then asserts which.
     */
    /** A provider whose open blocks until the test releases it — the slow provider of finding F1. */
    private inner class SlowOpen(private val env: FakeEnv, private val slowIndex: Int, private val failAfter: Boolean = false) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        @Volatile var readFromIt = 0
        @Volatile var closedIt = false
        val opener: (Int) -> InputStream = { i ->
            if (i != slowIndex) ByteArrayInputStream(env.sources[i]) else {
                entered.countDown()
                assertTrue("the test released the provider", release.await(15, TimeUnit.SECONDS))
                if (failAfter) throw SecurityException("the grant ended while the provider was opening")
                object : InputStream() {
                    override fun read(): Int { readFromIt++; return 0 }
                    override fun read(b: ByteArray, off: Int, len: Int): Int { readFromIt += len; return len }
                    override fun close() { closedIt = true }
                }
            }
        }
    }

    /** Runs [end] on its own thread and returns whether it finished while the provider was still held. */
    private fun endWhileProviderHeld(q: ShareManyQueue, slow: SlowOpen): Boolean {
        val closer = thread { q.end(NotSentWhy.ScreenClosed) }
        closer.join(5_000)
        val returnedWhileHeld = !closer.isAlive && slow.release.count == 1L
        slow.release.countDown()
        closer.join(10_000)
        return returnedWhileHeld
    }

    @Test fun `F1 - closing during a slow provider open returns without waiting, and that stream is closed unread`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(5000, 1), bytes(5000, 2)))
        val slow = SlowOpen(env, slowIndex = 0)
        env.opener = slow.opener
        val q = queue(dir, env)
        val copier = thread { q.evaluate() }
        assertTrue("control: the open is inside the provider", slow.entered.await(10, TimeUnit.SECONDS))
        assertTrue("end() returned while the provider still held the open", endWhileProviderHeld(q, slow))
        copier.join(10_000)
        assertFalse(copier.isAlive)
        assertTrue("the stream whose open was admitted before the end is closed", slow.closedIt)
        assertEquals("and not one byte of it is read", 0, slow.readFromIt)
        assertEquals("no copy attempt was started from it", 0, env.maxRunning)
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
        assertEquals("the second item is never opened", listOf(0), env.opened)
        assertTrue(env.offered.isEmpty())
        assertTrue(dir.list()!!.isEmpty())
        q.evaluate()
        assertEquals("after the end, a trigger opens nothing", listOf(0), env.opened)
        assertTrue("the end is not reported as an open failure", env.notPrepared.isEmpty())
    }

    @Test fun `F1 - an already-offered file and its copy are untouched when the next file's slow open is cut off`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(3000, 2), bytes(3000, 3)))
        val slow = SlowOpen(env, slowIndex = 1)
        env.opener = slow.opener
        val q = queue(dir, env)
        val copier = thread { q.evaluate() }
        assertTrue(slow.entered.await(10, TimeUnit.SECONDS))
        assertTrue("control: the first file was offered before the slow open", offered(q.states()[0]))
        val firstCopy = env.offered.single().second
        assertTrue(endWhileProviderHeld(q, slow))
        copier.join(10_000)
        assertTrue("the offered file stays offered", offered(q.states()[0]))
        assertEquals(listOf(Prep.NotSent(NotSentWhy.ScreenClosed), Prep.NotSent(NotSentWhy.ScreenClosed)), q.states().drop(1))
        assertTrue("its private copy is still there, for its offer", File(dir, "$firstCopy.bin").isFile)
        assertStagingHoldsOnly(dir, env)
        assertEquals(listOf(0, 1), env.opened)
        assertEquals(1, env.offered.size)
        assertTrue(slow.closedIt)
        assertEquals(0, slow.readFromIt)
    }

    @Test fun `F1 - a slow open that fails after the end is not reported as a failure of that file`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2)))
        val slow = SlowOpen(env, slowIndex = 0, failAfter = true)
        env.opener = slow.opener
        val q = queue(dir, env)
        val copier = thread { q.evaluate() }
        assertTrue(slow.entered.await(10, TimeUnit.SECONDS))
        assertTrue(endWhileProviderHeld(q, slow))
        copier.join(10_000)
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
        assertTrue(env.notPrepared.isEmpty())
        assertEquals(listOf(0), env.opened)
    }

    @Test fun `F1 - an end landing inside the provider call, on the same thread, neither deadlocks nor reads`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2)))
        var read = 0
        var closed = false
        lateinit var q: ShareManyQueue
        env.opener = { i ->
            if (i == 0) q.end(NotSentWhy.ScreenClosed)
            object : InputStream() {
                override fun read(): Int { read++; return -1 }
                override fun read(b: ByteArray, off: Int, len: Int): Int { read += len; return -1 }
                override fun close() { closed = true }
            }
        }
        q = queue(dir, env)
        val copier = thread { q.evaluate() }
        copier.join(5_000)
        assertFalse("no deadlock", copier.isAlive)
        assertTrue(closed)
        assertEquals(0, read)
        assertEquals(listOf(0), env.opened)
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `F1 - an end landing after a file is chosen and before its open admits no open`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2))).apply { liveOverride = ShareOffer.MAX_LIVE_OFFERS_V3 }
        lateinit var q: ShareManyQueue
        var calls = 0
        var armed = false
        val base = env
        // The monotonic clock is read once at the evaluation's tick and once more as a waiting file is
        // chosen (its stall clock leaves waiting) — after the choice, before the open. The end lands there.
        val hooked = object : ShareManyQueue.Env by base {
            override fun monotonicMs(): Long {
                if (armed && ++calls == 2) q.end(NotSentWhy.ScreenClosed)
                return base.monotonicMs()
            }
        }
        q = ShareManyQueue(dir, env.sources.map { it.size.toLong() }, hooked)
        q.evaluate()
        assertTrue("control: both wait on the live-offer limit", q.states().all { it is Prep.Waiting })
        env.liveOverride = null
        armed = true
        q.evaluate()
        assertEquals("control: the end landed at the second clock read", 2, calls)
        assertEquals("nothing was opened after the end", emptyList<Int>(), env.opened)
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
        assertTrue(env.offered.isEmpty())
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test fun `F1 - an end landing as the copy registers reads nothing and leaves nothing`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(5000, 1), bytes(100, 2)))
        var read = 0
        env.opener = { i ->
            val src = ByteArrayInputStream(env.sources[i])
            object : InputStream() {
                override fun read(): Int { read++; return src.read() }
                override fun read(b: ByteArray, off: Int, len: Int): Int = src.read(b, off, len).also { if (it > 0) read += it }
            }
        }
        lateinit var q: ShareManyQueue
        val base = env
        val hooked = object : ShareManyQueue.Env by base {
            override fun attempt(attemptId: String, running: Boolean) {
                base.attempt(attemptId, running)
                if (running) q.end(NotSentWhy.ScreenClosed)
            }
        }
        q = ShareManyQueue(dir, env.sources.map { it.size.toLong() }, hooked)
        q.evaluate()
        assertEquals("not one byte read after the end", 0, read)
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
        assertTrue("the partial was deleted", dir.list()!!.isEmpty())
        assertEquals(listOf(0), env.opened)
        assertTrue(env.offered.isEmpty())
    }

    @Test fun `once the end has returned nothing is opened, whatever triggers arrive`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2)))
        val q = queue(dir, env)
        assertEquals(0, q.end(NotSentWhy.ScreenClosed))
        repeat(3) { q.evaluate() }
        assertTrue(env.opened.isEmpty())
        assertEquals(List(2) { Prep.NotSent(NotSentWhy.ScreenClosed) }, q.states())
    }

    @Test fun `an open the provider refuses is reported per file - reason type and exception class only, no name, no URI`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(100, 1), bytes(100, 2)))
        val uri = "content://com.sec.android.app.myfiles.FileProvider/device_storage/0/DCIM/IMG_20260927_secret.jpg"
        env.opener = { i -> if (i == 0) throw SecurityException("Permission Denial: reading $uri") else ByteArrayInputStream(env.sources[i]) }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.OpenFailed), q.states()[0])
        assertTrue("the rest go on", offered(q.states()[1]))
        assertEquals(listOf(NotPrepared(0, null, NotSentWhy.OpenFailed, "java.lang.SecurityException")), env.notPrepared)
        val line = ShareManyQueue.notPreparedLine(0, 2, null, NotSentWhy.OpenFailed, env.notPrepared.single().cause)
        assertEquals("selection item 1/2 (no copy attempted) not sent: OpenFailed (java.lang.SecurityException)", line)
        for (leak in listOf("content:", "IMG_", "secret", "DCIM", "FileProvider", "Denial")) assertFalse("the line carries no '$leak': $line", leak in line)
        assertStagingHoldsOnly(dir, env)
    }

    // ---- the §12 stall clock (PROPOSED, development only) ------------------------------------------

    private val min = 60_000L

    /** One §12 trigger every 5 s — the tick — until the monotonic clock reaches [untilMs]. */
    private fun tickUntil(q: ShareManyQueue, env: FakeEnv, untilMs: Long) {
        while (env.mono < untilMs) { env.mono += 5_000; q.evaluate() }
    }

    @Test fun `stall clock - running time counts, paused time does not, a resume continues, and its own copy is not a stall`() {
        val c = ShareManyQueue.StallClock(enteredMs = 1_000)
        c.advance(1_000 + 4 * min)
        assertEquals("it starts running on entry", 4 * min, c.runningMs)
        c.set(paused = true); c.advance(1_000 + 24 * min)
        assertEquals("paused time is not counted", 4 * min, c.runningMs)
        assertTrue(c.paused)
        c.set(paused = false); c.advance(1_000 + 29 * min)
        assertEquals("a resume continues from the time already counted", 9 * min, c.runningMs)
        c.leave(1_000 + 29 * min + 30_000)
        c.advance(1_000 + 40 * min)
        assertEquals("its own copy attempt is not waiting", 9 * min + 30_000, c.runningMs)
        c.resume(1_000 + 40 * min)
        c.advance(1_000 + 40 * min + 29_999)
        assertNull("never reset: one millisecond short", c.expiry(1_000 + 40 * min + 29_999))
        c.advance(1_000 + 40 * min + 30_000)
        assertEquals(NotSentWhy.WaitedTooLong(byCeiling = false), c.expiry(1_000 + 40 * min + 30_000))
    }

    @Test fun `stall clock - the ceiling counts from entry, paused or not, and a clock that steps back credits nothing`() {
        val c = ShareManyQueue.StallClock(enteredMs = 0)
        c.set(paused = true)
        c.advance(60 * min - 1)
        assertNull(c.expiry(60 * min - 1))
        assertEquals(0L, c.runningMs)
        c.advance(60 * min)
        assertEquals(NotSentWhy.WaitedTooLong(byCeiling = true), c.expiry(60 * min))

        val d = ShareManyQueue.StallClock(enteredMs = 10 * min)
        d.advance(5 * min)
        assertEquals("an instant before the last one credits nothing", 0L, d.runningMs)
        d.advance(10 * min + 1_000)
        assertEquals(1_000L, d.runningMs)
    }

    @Test fun `behind an offer nobody has answered the clock runs, and at 10 minutes only that file ends - nothing staged, nothing offered`() {
        val dir = tmp.newFolder()
        // A is offered and unanswered; B (9 KB) waits for room; C (1 KB) was never tried and goes ahead of B.
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(9000, 2), bytes(1000, 3))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.NoRoom(ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET, 5000), paused = false), q.states()[1])
        tickUntil(q, env, 10 * min - 5_000)
        assertTrue("one tick short of 10 minutes it still waits", q.states()[1] is Prep.Waiting)
        tickUntil(q, env, 10 * min)
        assertEquals(Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = false)), q.states()[1])
        assertTrue("A is untouched", offered(q.states()[0]))
        assertTrue("C is untouched", offered(q.states()[2]))
        assertEquals("B was never read and never offered", listOf(0, 2), env.opened)
        assertEquals(listOf(0, 2), env.offered.map { it.first })
        assertEquals(listOf(NotPrepared(1, null, NotSentWhy.WaitedTooLong(byCeiling = false), null)), env.notPrepared)
        assertStagingHoldsOnly(dir, env)
        assertFalse(q.anyWaiting())
        assertFalse(q.unfinished())
        env.endOffer(0)
        q.evaluate()
        assertEquals("a file that timed out does not come back", listOf(0, 2), env.opened)
    }

    @Test fun `behind an accepted offer the clock pauses, the row says so, and the 60-minute ceiling still ends it`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(9000, 2))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        env.accept(0) // the Mac accepted A: queued, receiving or checking
        tickUntil(q, env, 60 * min - 5_000)
        val w = q.states()[1] as Prep.Waiting
        assertTrue("paused: it waits only on work already under way", w.paused)
        tickUntil(q, env, 60 * min)
        assertEquals(Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = true)), q.states()[1])
        assertEquals(listOf(0), env.opened)
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `the clock pauses only when every offer still blocking is accepted`() {
        val dir = tmp.newFolder()
        // A and B are offered; C (9 KB) waits. The Mac accepts A, then B.
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(1000, 2), bytes(9000, 3))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        assertTrue(offered(q.states()[0]) && offered(q.states()[1]))
        env.accept(0)
        tickUntil(q, env, 5 * min)
        assertFalse("B is unanswered: that is a stall", (q.states()[2] as Prep.Waiting).paused)
        env.accept(1)
        tickUntil(q, env, 9 * min)
        assertTrue("both accepted: paused", (q.states()[2] as Prep.Waiting).paused)
        tickUntil(q, env, 20 * min)
        assertTrue("5 minutes running + pause: still waiting at 20 minutes", q.states()[2] is Prep.Waiting)
    }

    @Test fun `a retry waiting alone pauses behind an accepted offer, and runs behind an unanswered one`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 4096 }
        val q = queue(dir, env, expected = listOf(3000L, null))
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone, paused = false), q.states()[1])
        env.accept(0)
        env.mono += 5_000
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone, paused = true), q.states()[1])
    }

    @Test fun `the clock is never reset between an unknown-size attempt and its retry`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 0 }
        val q = queue(dir, env, expected = listOf(3000L, null))
        q.evaluate()
        assertTrue("B waits for room first", q.states()[1] is Prep.Waiting)
        tickUntil(q, env, 4 * min)
        env.room = 4096 // attempt 1 is admitted, stops at its bound, and B waits again for the retry
        tickUntil(q, env, 4 * min + 5_000)
        assertEquals(Prep.Waiting(WaitReason.RetryAlone), q.states()[1])
        assertEquals(listOf(0, 1), env.opened)
        tickUntil(q, env, 10 * min - 5_000)
        assertTrue("running time carried over: not yet 10 minutes", q.states()[1] is Prep.Waiting)
        tickUntil(q, env, 10 * min)
        assertEquals("10 minutes counted across both waits, not from the retry", Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = false)), q.states()[1])
        assertStagingHoldsOnly(dir, env)
    }

    // The case the first build expired at 10 minutes (owner, 2026-09-28): the file's only obstacle is the
    // space an accepted offer's copy occupies. s + M(s) = 300 MiB + 2,000 B; 300 MiB free; A holds 4,000 B.
    private val mib = 1024L * 1024
    private val claimed = 44 * mib + 2000

    @Test fun `waiting only on the space an accepted copy occupies pauses past 10 minutes, and goes once that space is really free`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(100, 2))).apply { free = 300 * mib }
        val q = queue(dir, env, expected = listOf(4000L, claimed))
        q.evaluate()
        assertTrue("control: it waits rather than failing at once", q.states()[1] is Prep.Waiting)
        env.accept(0)
        tickUntil(q, env, 15 * min)
        val w = q.states()[1] as Prep.Waiting
        assertTrue("paused: releasing A's copy would make room", w.paused)
        assertEquals("the credit is hypothetical — nothing was copied while A holds the space", listOf(0), env.opened)
        // A ends: its copy is deleted, and the space it held is really free.
        env.endOffer(0)
        env.free += 4000
        env.mono += 5_000
        q.evaluate()
        assertTrue("admitted on the measured numbers", offered(q.states()[1]))
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `if free space falls so that even the release would not make room, the clock runs again and ends at 10 minutes running`() {
        val dir = tmp.newFolder()
        // A (accepted) and B (unanswered, small) are offered; C waits on the space A occupies.
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(3000, 2), bytes(100, 3))).apply { free = 300 * mib }
        val q = queue(dir, env, expected = listOf(4000L, 3000L, claimed))
        q.evaluate()
        assertTrue(offered(q.states()[0]) && offered(q.states()[1]))
        env.accept(0)
        tickUntil(q, env, 20 * min)
        assertTrue("paused: B is small enough that only A's space is in the way", (q.states()[2] as Prep.Waiting).paused)
        // Something outside this app takes 3,000 B: free + A's 4,000 B no longer reaches s + M(s), though
        // free + Σ (A and B) still does — so it neither pauses nor fails at once.
        env.free = 300 * mib - 3000
        tickUntil(q, env, 20 * min + 5_000)
        assertFalse("running again", (q.states()[2] as Prep.Waiting).paused)
        tickUntil(q, env, 30 * min - 5_000)
        assertTrue("5 s running before the pause + 9 min 50 s since resuming: one tick short", q.states()[2] is Prep.Waiting)
        tickUntil(q, env, 30 * min)
        assertEquals(Prep.NotSent(NotSentWhy.WaitedTooLong(byCeiling = false)), q.states()[2])
        assertEquals(listOf(0, 1), env.opened)
        assertStagingHoldsOnly(dir, env)
    }

    @Test fun `if free space falls so that even every held copy released would not make room, it fails at once as no space`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(100, 2))).apply { free = 300 * mib }
        val q = queue(dir, env, expected = listOf(4000L, claimed))
        q.evaluate()
        env.accept(0)
        tickUntil(q, env, 5 * min)
        assertTrue((q.states()[1] as Prep.Waiting).paused)
        env.free = 200 * mib
        env.mono += 5_000
        q.evaluate()
        assertEquals(Prep.NotSent(NotSentWhy.NoSpace(claimed + ShareStaging.margin(claimed), 200 * mib)), q.states()[1])
        assertEquals(listOf(0), env.opened)
    }

    @Test fun `a retry waiting alone is credited too - it pauses when only the accepted copy's space stands between it and the floor`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(3000, 1), bytes(8000, 2))).apply { room = 4096 }
        val q = queue(dir, env, expected = listOf(3000L, null))
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone), q.states()[1])
        // An unknown size alone needs free above the floor; A's 3,000 B are what keeps it at or below.
        env.free = ShareStaging.FLOOR_BYTES - 1000
        env.accept(0)
        env.mono += 5_000
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone, paused = true), q.states()[1])
        env.free = ShareStaging.FLOOR_BYTES - 5000 // even with A released: at or below the floor
        env.mono += 5_000
        q.evaluate()
        assertEquals(Prep.Waiting(WaitReason.RetryAlone, paused = false), q.states()[1])
    }

    @Test fun `the hypothetical numbers - credited both ways, and null on any reading that cannot be true or cannot be added`() {
        assertEquals(ShareManyQueue.Hypothetical(live = 1, held = 3000, free = 300 * mib + 4000),
            ShareManyQueue.hypothetical(live = 2, held = 7000, free = 300 * mib, n = 1, bytes = 4000))
        assertEquals(ShareManyQueue.Hypothetical(0, 0, 4000), ShareManyQueue.hypothetical(1, 4000, 0, 1, 4000))
        assertNull("nothing in progress", ShareManyQueue.hypothetical(2, 7000, 100, 0, 0))
        assertNull("more in progress than live", ShareManyQueue.hypothetical(1, 7000, 100, 2, 10))
        assertNull("more bytes than held", ShareManyQueue.hypothetical(2, 3000, 100, 1, 4000))
        assertNull("negative free", ShareManyQueue.hypothetical(2, 7000, -1, 1, 10))
        assertNull("negative bytes", ShareManyQueue.hypothetical(2, 7000, 100, 1, -1))
        assertNull("free + b overflows", ShareManyQueue.hypothetical(2, Long.MAX_VALUE, Long.MAX_VALUE - 10, 1, 11))
        assertEquals("the largest sum that fits", Long.MAX_VALUE,
            ShareManyQueue.hypothetical(2, Long.MAX_VALUE, Long.MAX_VALUE - 10, 1, 10)!!.free)
    }

    @Test fun `an inconsistent in-progress reading keeps the clock running`() {
        val dir = tmp.newFolder()
        val env = FakeEnv(dir = dir, sources = listOf(bytes(4000, 1), bytes(9000, 2))).apply { room = 5000 }
        val q = queue(dir, env)
        q.evaluate()
        env.accept(0)
        env.liveOverride = 0 // more accepted than live: a reading that cannot be true
        env.mono += 5_000
        q.evaluate()
        assertFalse((q.states()[1] as Prep.Waiting).paused)
    }
}
