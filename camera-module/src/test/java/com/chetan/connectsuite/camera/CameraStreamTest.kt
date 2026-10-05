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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The camera socket writer against a Mac that stops reading, hangs up, or writes where it must not.
 * Isolated fake streams only — no socket, no network.
 *
 * **No fixed sleeps and no wall-clock bounds** (the one poll waits on a condition, with a
 * deadline). Every "exactly once" is counted after [CameraStream.awaitThreadsEnded] — both threads
 * finished, so nothing can still call `onClosed` — and "never blocks the producer" is shown by the
 * writer still being stuck when the offers return.
 * The earlier version polled `isOpen` and then counted, and `isOpen` flips before `onClosed` runs:
 * a 150 ms delay inside `shutdown()` turned two of these tests red over a correct stream.
 */
class CameraStreamTest {

    /** An output that blocks every write until [release] — a Mac that has stopped reading. */
    private class GatedOutput : OutputStream() {
        val release = CountDownLatch(1)
        val firstWriteStarted = CountDownLatch(1)
        val firstWriteReturned = CountDownLatch(1)
        val written = mutableListOf<ByteArray>()
        private val pending = ByteArrayOutputStream()

        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
        override fun write(b: ByteArray, off: Int, len: Int) {
            firstWriteStarted.countDown()
            release.await(5, TimeUnit.SECONDS)
            pending.write(b, off, len)
            firstWriteReturned.countDown()
        }
        override fun flush() {
            synchronized(written) { written += pending.toByteArray() }
            pending.reset()
        }
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

    private fun waitFor(timeoutMs: Long = 3_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            check(System.currentTimeMillis() < deadline) { "timed out" }
            Thread.sleep(5)
        }
    }

    @Test
    fun `a slow Mac costs the oldest frames, never the newest, and never blocks the producer`() {
        val out = GatedOutput()
        val input = Silent()
        val stream = CameraStream(out, input, closeSocket = { input.close() }, onClosed = {})

        stream.offer(frame(0))
        assertTrue(out.firstWriteStarted.await(2, TimeUnit.SECONDS)) // frame 0 is in flight, stuck
        for (n in 1..10) assertTrue(stream.offer(frame(n)))
        // All ten offers returned while the writer is still inside its first write. An offer that
        // waited on the writer could only have returned after the gate's 5 s timeout let it go.
        assertEquals("the writer was still stuck when the offers returned", 1L, out.firstWriteReturned.count)

        out.release.countDown()
        waitFor { stream.framesSent() == 3L }
        // Frame 0 was already in flight; of 1..10 only the two newest survive the two-deep queue,
        // and nothing else was ever queued, so a third write cannot follow.
        assertEquals(listOf(0, 9, 10), synchronized(out.written) { out.written.map { it.single().toInt() } })
        assertEquals(3L, stream.framesSent())
        assertEquals(8L, stream.framesDropped())
        assertTrue(stream.summary().startsWith("3 sent / 8 dropped (8 evicted"))
        stream.close()
        assertTrue(stream.awaitThreadsEnded(3_000))
        assertEquals(3L, stream.framesSent())
    }

    @Test
    fun `the Mac hanging up ends the stream once, even with no frames flowing`() {
        val toPhone = PipedOutputStream()
        val fromMac = PipedInputStream(toPhone)
        val closedCalls = AtomicInteger()
        val stream = CameraStream(ByteArrayOutputStream(), fromMac, closeSocket = { fromMac.close() }, onClosed = { closedCalls.incrementAndGet() })

        toPhone.close() // end of stream from the Mac
        assertTrue(stream.awaitThreadsEnded(3_000))
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
        assertTrue(stream.awaitThreadsEnded(3_000))
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
        assertTrue(stream.awaitThreadsEnded(3_000))
        assertEquals(0, closedCalls.get())
        assertEquals("the socket is closed exactly once", 1, socketClosed.get())
    }

    @Test
    fun `frames reach the socket whole and in order when the Mac keeps up`() {
        val out = ByteArrayOutputStream()
        val input = Silent()
        val stream = CameraStream(out, input, closeSocket = { input.close() }, onClosed = {})
        for (n in 1..3) {
            stream.offer(byteArrayOf(n.toByte(), n.toByte()))
            waitFor { stream.framesSent() == n.toLong() }
        }
        assertArrayEquals(byteArrayOf(1, 1, 2, 2, 3, 3), out.toByteArray())
        assertEquals(0L, stream.framesDropped())
        stream.close()
        assertTrue(stream.awaitThreadsEnded(3_000))
    }

    @Test
    fun `oversize and unencoded frames count as dropped`() {
        val input = Silent()
        val stream = CameraStream(ByteArrayOutputStream(), input, closeSocket = { input.close() }, onClosed = {})
        stream.countOversize()
        stream.countEncodeFailure()
        assertEquals(2L, stream.framesDropped())
        stream.close()
    }
}
