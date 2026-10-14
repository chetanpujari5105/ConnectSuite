package com.chetan.connectsuite.camera

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The camera socket writer against a Mac that stops reading, hangs up, or writes where it must not.
 * Isolated fake streams only — no socket, no network.
 *
 * **No sleeps, no polls, no speed assumptions.** Every wait is on an event the stream causes: a
 * flush the fake output observed, the producer thread finishing its offers, or both stream threads
 * ending ([CameraStream.awaitThreadsEnded]). Every count is read after the threads have ended, so it
 * is final. The only number left is [HANG_GUARD_S], which a correct stream never reaches at any speed
 * — it exists so a broken stream fails instead of hanging the build.
 *
 * History, because both versions passed for a while: the first polled `isOpen` and then counted, and
 * `isOpen` flips before `onClosed` runs (a 150 ms delay in `shutdown()` turned two tests red). The
 * second, 2026-10-06, still polled `framesSent()` every 5 ms against a 3 s wall clock: a writer slowed
 * to 1.2 s per frame — correct, only slow — turned *a slow Mac costs the oldest frames* red
 * (2026-10-15). Neither failure was in the stream.
 */
class CameraStreamTest {

    /**
     * An output that blocks every write until [release] — a Mac that has stopped reading. The gate has
     * **no timeout**: only the test opens it, so "the writer was still stuck" cannot be true by luck.
     */
    private class GatedOutput : OutputStream() {
        val release = CountDownLatch(1)
        val firstWriteStarted = CountDownLatch(1)
        val firstWriteReturned = CountDownLatch(1)
        /** One permit per completed frame (the stream flushes once per frame). */
        val flushes = Semaphore(0)
        val written = mutableListOf<ByteArray>()
        private val pending = ByteArrayOutputStream()

        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
        override fun write(b: ByteArray, off: Int, len: Int) {
            firstWriteStarted.countDown()
            release.await()
            pending.write(b, off, len)
            firstWriteReturned.countDown()
        }
        override fun flush() {
            synchronized(written) { written += pending.toByteArray() }
            pending.reset()
            flushes.release()
        }
    }

    /** A Mac that keeps up: records every byte and signals each flush. */
    private class SignallingOutput : OutputStream() {
        val bytes = ByteArrayOutputStream()
        val flushes = Semaphore(0)
        override fun write(b: Int) = synchronized(bytes) { bytes.write(b) }
        override fun write(b: ByteArray, off: Int, len: Int) = synchronized(bytes) { bytes.write(b, off, len) }
        override fun flush() = flushes.release()
        fun snapshot(): ByteArray = synchronized(bytes) { bytes.toByteArray() }
    }

    /** An input that never ends unless closed — a Mac that is connected and silent. */
    private class Silent : InputStream() {
        val closed = CountDownLatch(1)
        override fun read(): Int {
            closed.await()
            return -1
        }
        override fun close() = closed.countDown()
    }

    private fun frame(n: Int) = byteArrayOf(n.toByte())

    private fun ended(stream: CameraStream) = stream.awaitThreadsEnded(HANG_GUARD_S * 1_000)

    @Test
    fun `a slow Mac costs the oldest frames, never the newest, and never blocks the producer`() {
        val out = GatedOutput()
        val input = Silent()
        val stream = CameraStream(out, input, closeSocket = { input.close() }, onClosed = {})

        stream.offer(frame(0))
        assertTrue(out.firstWriteStarted.await(HANG_GUARD_S, TimeUnit.SECONDS)) // frame 0 is in flight, stuck

        // The producer runs on its own thread so that an offer which waited on the writer would never
        // return (the gate only opens below) — a hang the guard turns into a failure, not a lucky pass.
        val accepted = AtomicInteger()
        val offersDone = CountDownLatch(1)
        Thread({
            for (n in 1..10) if (stream.offer(frame(n))) accepted.incrementAndGet()
            offersDone.countDown()
        }, "test-producer").apply { isDaemon = true; start() }
        assertTrue("the ten offers returned while the writer was held", offersDone.await(HANG_GUARD_S, TimeUnit.SECONDS))
        assertEquals(10, accepted.get())
        assertEquals("the writer was still stuck when the offers returned", 1L, out.firstWriteReturned.count)

        out.release.countDown()
        // Frame 0 was already in flight; of 1..10 only the two newest survive the two-deep queue.
        assertTrue("three frames reached the socket", out.flushes.tryAcquire(3, HANG_GUARD_S, TimeUnit.SECONDS))
        stream.close()
        assertTrue(ended(stream))
        // Counted after both threads ended, so final: nothing else was ever queued, no fourth write.
        assertEquals(0, out.flushes.availablePermits())
        assertEquals(listOf(0, 9, 10), synchronized(out.written) { out.written.map { it.single().toInt() } })
        assertEquals(3L, stream.framesSent())
        assertEquals(8L, stream.framesDropped())
        assertTrue(stream.summary().startsWith("3 sent / 8 dropped (8 evicted"))
    }

    @Test
    fun `the Mac hanging up ends the stream once, even with no frames flowing`() {
        val toPhone = PipedOutputStream()
        val fromMac = PipedInputStream(toPhone)
        val closedCalls = AtomicInteger()
        val stream = CameraStream(ByteArrayOutputStream(), fromMac, closeSocket = { fromMac.close() }, onClosed = { closedCalls.incrementAndGet() })

        toPhone.close() // end of stream from the Mac
        assertTrue(ended(stream))
        assertFalse(stream.isOpen)
        assertEquals(1, closedCalls.get())
        assertFalse(stream.offer(frame(1)))
    }

    @Test
    fun `a byte from the Mac is a protocol violation and ends the stream`() {
        val toPhone = PipedOutputStream()
        val fromMac = PipedInputStream(toPhone)
        val closedCalls = AtomicInteger()
        val stream = CameraStream(ByteArrayOutputStream(), fromMac, closeSocket = { fromMac.close() }, onClosed = { closedCalls.incrementAndGet() })

        toPhone.write(0x42)
        toPhone.flush()
        assertTrue(ended(stream))
        assertFalse(stream.isOpen)
        assertEquals(1, closedCalls.get())
    }

    @Test
    fun `closing from this side does not report a hang-up`() {
        val input = Silent()
        val closedCalls = AtomicInteger()
        val socketClosed = AtomicInteger()
        val stream = CameraStream(
            ByteArrayOutputStream(),
            input,
            closeSocket = { socketClosed.incrementAndGet(); input.close() },
            onClosed = { closedCalls.incrementAndGet() },
        )
        stream.close()
        stream.close()
        assertTrue(ended(stream))
        assertEquals(0, closedCalls.get())
        assertEquals("the socket is closed exactly once", 1, socketClosed.get())
    }

    @Test
    fun `frames reach the socket whole and in order when the Mac keeps up`() {
        val out = SignallingOutput()
        val input = Silent()
        val stream = CameraStream(out, input, closeSocket = { input.close() }, onClosed = {})
        for (n in 1..3) {
            assertTrue(stream.offer(byteArrayOf(n.toByte(), n.toByte())))
            // The next frame is offered only once this one is flushed, so the queue never holds two.
            assertTrue("frame $n reached the socket", out.flushes.tryAcquire(HANG_GUARD_S, TimeUnit.SECONDS))
        }
        stream.close()
        assertTrue(ended(stream))
        assertArrayEquals(byteArrayOf(1, 1, 2, 2, 3, 3), out.snapshot())
        assertEquals(3L, stream.framesSent())
        assertEquals(0L, stream.framesDropped())
    }

    @Test
    fun `oversize and unencoded frames count as dropped`() {
        val input = Silent()
        val stream = CameraStream(ByteArrayOutputStream(), input, closeSocket = { input.close() }, onClosed = {})
        stream.countOversize()
        stream.countEncodeFailure()
        assertEquals(2L, stream.framesDropped())
        stream.close()
        assertTrue(ended(stream))
    }

    private companion object {
        /**
         * A deadlock guard, not a timing assumption: every wait above returns the moment its event
         * happens, so a correct stream finishes in milliseconds at any machine speed. Only a stream that
         * never produces the event — a blocking offer, a lost frame, a thread that never ends — reaches it.
         */
        const val HANG_GUARD_S = 30L
    }
}
