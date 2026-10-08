package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Defect 157, the phone's half: a control session ending must stop the live bulk streams **it**
 * agreed, before their next chunk, and nothing else.
 *
 * Found on hardware (L1/L2 T3, 2026-09-30 15:34): after the Mac's Disconnect at 40% of a 200 MiB block
 * pull, this phone sent the remaining 125,829,120 bytes, dropped every block digest and the `done`
 * ("Dropped fs.transfer.blocks: the session is closing"), and counted the transfer **completed**.
 *
 * The streams here are the real [BlockPullSender]; the stop flags are the real [LiveStops] the
 * production loops poll; the decision is the real [BulkStops.sessionEndPlan] `forgetSession` applies.
 * What no JVM test reaches is `BulkTransfers`' socket glue — the last test holds it, by source, to
 * calling these and only these.
 */
class BulkStopsTest {

    private val chunk = 4096
    private val blockSize = 4096
    private val mtime = 1_759_140_000_000L
    private val source = ByteArray(64 * chunk).also { java.util.Random(0x157).nextBytes(it) }

    /** A sink that counts what was handed to the socket, and runs [onChunk] after each chunk. */
    private class Counting(val onChunk: (chunks: Int, sent: Long) -> Unit = { _, _ -> }) : BlockPullSender.Sink {
        var chunks = 0
        var sent = 0L
        override fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long) {
            chunks += 1
            sent += length
            onChunk(chunks, sent)
        }
        override fun blocks(first: Long, digests: List<String>) = Unit
        override fun progress(phase: String, bytes: Long) = Unit
    }

    private fun sender() = BlockPullSender(source.size.toLong(), mtime, blockSize, null, chunk = chunk, flushEvery = 4, clock = { 0L })
    private val stable: () -> Pair<Long, Long>? = { source.size.toLong() to mtime }

    /** The same `forgetSession` does, over plain maps: plan, then flag the live ones. */
    private fun endSession(stops: LiveStops, owners: Map<String, String>, token: String): BulkStops.SessionEndPlan {
        val plan = BulkStops.sessionEndPlan(emptyMap(), emptyMap(), owners, token)
        plan.stopLive.forEach { stops.flagIfAbsent(it, BulkStops.SESSION_ENDED) }
        return plan
    }

    @Test
    fun `a session ending mid-transfer stops its own live stream within one chunk, and says why`() {
        val stops = LiveStops()
        val owners = mapOf("tf-old" to "session-A")
        var sentAtTeardown = -1L
        var why: String? = null
        val sink = Counting { chunks, sent ->
            if (chunks == 20) { // ~31% of the file: the session ends while bytes are moving
                sentAtTeardown = sent
                endSession(stops, owners, "session-A")
            }
        }
        val out = sender().run(ByteArrayInputStream(source), stable, { stops.take("tf-old")?.also { why = it } != null }, sink)

        assertTrue("a live stream the ended session agreed is stopped, not sent to the end: $out", out is BlockPullSender.Outcome.Cancelled)
        assertEquals("the reason is the session ending, not a request from the Mac", BulkStops.SESSION_ENDED, why)
        println("defect 157 stop bound: ${sink.sent - sentAtTeardown} bytes handed to the socket after the teardown (bound one chunk = $chunk; production chunk is 256 KiB)")
        assertTrue("bytes sent after the teardown: ${sink.sent - sentAtTeardown}, bound one chunk ($chunk)", sink.sent - sentAtTeardown <= chunk)
        assertTrue("control: the file was far from finished when the session ended", sentAtTeardown < source.size / 2)
    }

    @Test
    fun `a replacement session's stream is not stopped by the old session ending, and runs to the end`() {
        val stops = LiveStops()
        // The old session (A) had one live stream; its replacement (B) started another before A's teardown ran.
        val owners = mapOf("tf-old" to "session-A", "tf-new" to "session-B")
        val sink = Counting { chunks, _ -> if (chunks == 5) endSession(stops, owners, "session-A") }
        val out = sender().run(ByteArrayInputStream(source), stable, { stops.take("tf-new") != null }, sink)

        assertTrue("the replacement session's stream finished: $out", out is BlockPullSender.Outcome.Sent)
        assertEquals(source.size.toLong(), sink.sent)
        assertTrue("control: the old session's stream WAS flagged in the same teardown", stops.isFlagged("tf-old"))
    }

    @Test
    fun `the plan stops only live streams the ended session agreed - never pending, never another session's`() {
        val plan = BulkStops.sessionEndPlan(
            pendingOwners = mapOf("p-A" to "A", "p-B" to "B"),
            incomingOwners = mapOf("in-A" to "A"),
            owners = mapOf("p-A" to "A", "p-B" to "B", "in-A" to "A", "live-A" to "A", "live-B" to "B", "live-A2" to "A"),
            endedToken = "A",
        )
        assertEquals(setOf("p-A"), plan.dropPending)
        assertEquals(setOf("in-A"), plan.abandonPushes)
        assertEquals("live streams of the ended session, and only those", setOf("live-A", "live-A2"), plan.stopLive)
    }

    @Test
    fun `a stop the Mac already asked for keeps its reason when the session then ends`() {
        val stops = LiveStops()
        stops.flag("tf-1", "pause")
        endSession(stops, mapOf("tf-1" to "A"), "A")
        assertEquals("a Pause the Mac asked for is not relabelled", "pause", stops.take("tf-1"))
        assertNull("taken once", stops.take("tf-1"))
    }

    @Test
    fun `the log names a session ending as that, and a Mac's cancel as the Mac's`() {
        val ended = BulkStops.describe(BulkStops.SESSION_ENDED)
        assertFalse("a session ending is not worded as the Mac cancelling: $ended", ended.contains("by the Mac"))
        assertTrue(ended, ended.contains("session"))
        assertTrue(BulkStops.describe("pause").contains("cancelled by the Mac (reason=pause)"))
    }

    @Test
    fun `a pull whose verdict could not be queued is not counted as sent in full`() {
        assertFalse("every byte out, verdict dropped with the session: not sent in full", BulkStops.sentInFull(allBytesSent = true, verdictQueued = false))
        assertTrue(BulkStops.sentInFull(allBytesSent = true, verdictQueued = true))
        assertFalse(BulkStops.sentInFull(allBytesSent = false, verdictQueued = true))
    }

    @Test
    fun `BulkTransfers applies these rules - teardown, the three stream loops, the count, and the cleanup`() {
        val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "sync-module").isDirectory }
        val bulk = File(root, "sync-module/src/main/java/com/chetan/connectsuite/sync/v2/BulkTransfers.kt").readText()
        val session = File(root, "core/src/main/java/com/chetan/connectsuite/core/link/ControlSession.kt").readText()
        assertTrue("the stop flags are a LiveStops", bulk.contains("private val cancelled = LiveStops()"))
        assertTrue("forgetSession applies the plan", bulk.contains("BulkStops.sessionEndPlan("))
        assertTrue("forgetSession stops the live streams", bulk.contains("plan.stopLive.forEach { cancelled.flagIfAbsent(it, BulkStops.SESSION_ENDED) }"))
        assertEquals("push, pull and block-pull loops all take their stop from LiveStops", 3, Regex("""cancelled\.take\(entry\.transferId\)""").findAll(bulk).count())
        assertFalse("no loop reads a bare set any more", bulk.contains("in cancelled"))
        assertTrue("the block pull counts through sentInFull", bulk.contains("BulkStops.sentInFull(outcome is BlockPullSender.Outcome.Sent, verdictQueued)"))
        assertEquals("both finished-socket paths forget a left-over stop", 2, Regex("""cancelled\.forget\(""").findAll(bulk).count())
        assertTrue("send says whether the frame was queued", session.contains("fun send(envelope: Envelope): Boolean"))
    }

    // ---- defect 161: one session end is acted on once, however many features hear it -----------------

    @Test
    fun `161 - a session's end is acted on the first time only`() {
        val ended = EndedSessions()
        assertTrue("the Files feature's call acts", ended.firstEnd("tok-A"))
        assertFalse("the Photos feature's call for the same session is a repeat", ended.firstEnd("tok-A"))
        assertTrue("another session's end still acts", ended.firstEnd("tok-B"))
        assertFalse(ended.firstEnd("tok-B"))
    }

    @Test
    fun `161 - the memory of ended sessions is bounded and forgets the oldest first`() {
        val ended = EndedSessions(capacity = 3)
        for (t in listOf("a", "b", "c", "d")) assertTrue(t, ended.firstEnd(t))
        assertTrue("the oldest fell out", ended.firstEnd("a"))
        assertFalse("a recent one is still remembered", ended.firstEnd("d"))
    }

    // ---- 2026-10-09: a stop the person caused was logged at E as a failure (release run, stage 4 T3) ----

    @Test
    fun `a stream the Mac closed is an expected stop, worded as one`() {
        val reset = BulkStops.classifyFailure(null, java.net.SocketException("Connection reset"))
        assertTrue("a Mac-side close logged as a failure", reset.expected)
        assertTrue(reset.words, reset.words.startsWith("stopped: the Mac closed the stream"))
        val ended = BulkStops.classifyFailure(BulkStops.SESSION_ENDED, java.net.SocketException("Broken pipe"))
        assertTrue(ended.expected)
        assertEquals(BulkStops.describe(BulkStops.SESSION_ENDED), ended.words)
        assertTrue(BulkStops.classifyFailure("user", java.io.EOFException()).expected)
    }

    @Test
    fun `control - a fault that is not a stop stays a failure`() {
        val bug = BulkStops.classifyFailure(null, IllegalStateException("boom"))
        assertFalse(bug.expected)
        assertTrue(bug.words, bug.words.startsWith("failed"))
    }
}
