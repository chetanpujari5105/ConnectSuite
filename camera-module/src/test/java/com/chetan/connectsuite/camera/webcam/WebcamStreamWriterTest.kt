package com.chetan.connectsuite.camera.webcam

import com.chetan.connectsuite.camera.CameraFacing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The webcam socket writer against a Mac that stops reading, hangs up, or writes where it must not.
 * **Stand-in streams only** — no socket, no network, no encoder; the AUs are built by the real
 * [WebcamAuCodec] from hand-made NAL units.
 */
class WebcamStreamWriterTest {

    /** STAND-IN: an output that blocks every write until [release] — a Mac that has stopped reading. */
    private class GatedOutput : OutputStream() {
        val release = CountDownLatch(1)
        val firstWriteStarted = CountDownLatch(1)
        val frames = mutableListOf<ByteArray>()
        private val pending = ByteArrayOutputStream()
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
        override fun write(b: ByteArray, off: Int, len: Int) {
            firstWriteStarted.countDown()
            release.await(5, TimeUnit.SECONDS)
            pending.write(b, off, len)
        }
        override fun flush() {
            synchronized(frames) { frames += pending.toByteArray() }
            pending.reset()
        }
    }

    private var seq = 0L

    private fun au(keyframe: Boolean): ByteArray = WebcamAuCodec.encode(
        WebcamAuCodec.Header(CameraFacing.FRONT, 0, false, 1, 1280, 720, ++seq),
        seq * 33_333,
        if (keyframe) WebcamAuTest.SPS + WebcamAuTest.PPS + WebcamAuTest.IDR else WebcamAuTest.P,
    )!!

    private fun ByteArray.sequence(): Long =
        ((this[25].toLong() and 0xFF) shl 24) or ((this[26].toLong() and 0xFF) shl 16) or ((this[27].toLong() and 0xFF) shl 8) or (this[28].toLong() and 0xFF)

    private fun ByteArray.discontinuity(): Boolean = this[WebcamAuCodec.DISCONTINUITY_OFFSET].toInt() and 1 == 1

    private fun waitFor(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 5_000_000_000L
        while (!condition()) {
            if (System.nanoTime() > deadline) throw AssertionError("timed out waiting for $what")
            Thread.sleep(5)
        }
    }

    @Test
    fun `a stalled Mac - non-IDRs dropped until the next IDR, one IDR requested, then the IDR goes out marked`() {
        val out = GatedOutput()
        val asked = AtomicInteger()
        val w = WebcamStreamWriter(out, null, {}, {}, { asked.incrementAndGet() })
        assertTrue(w.offer(au(true), true))               // seq 1 — taken by the writer, blocked mid-write
        assertTrue(out.firstWriteStarted.await(2, TimeUnit.SECONDS))
        assertTrue(w.offer(au(false), false))             // seq 2 — the second slot
        assertFalse(w.offer(au(false), false))            // seq 3 — full: dropped, IDR requested
        assertFalse(w.offer(au(false), false))            // seq 4 — still waiting for an IDR: dropped
        assertEquals(1, asked.get())
        assertEquals(2, w.maxInFlight)
        val idr = au(true)                                // seq 5 — replaces what waits (seq 2)
        assertTrue(w.offer(idr, true))
        out.release.countDown()
        waitFor("the IDR written") { w.sent == 2L }
        assertTrue(w.offer(au(false), false))             // seq 6 — the chain resumes after the IDR
        waitFor("three frames written") { w.sent == 3L }
        val written = synchronized(out.frames) { out.frames.toList() }
        assertEquals(listOf(1L, 5L, 6L), written.map { it.sequence() })
        assertEquals(listOf(false, true, false), written.map { it.discontinuity() })
        assertEquals(3L, w.droppedBackpressure)           // 2 (replaced), 3, 4
        assertEquals(1L, w.keyframeRequests)
        assertEquals(1L, w.discontinuities)
        assertEquals(2, w.maxInFlight)
        assertTrue(w.summary(), w.summary().startsWith("3 sent / 3 dropped"))
        w.close()
    }

    @Test
    fun `with one slot being written an IDR itself can be the drop, and the next IDR recovers`() {
        val out = GatedOutput()
        val asked = AtomicInteger()
        val w = WebcamStreamWriter(out, null, {}, {}, { asked.incrementAndGet() }, inFlight = 1)
        assertTrue(w.offer(au(true), true))
        assertTrue(out.firstWriteStarted.await(2, TimeUnit.SECONDS))
        assertFalse(w.offer(au(true), true))
        assertFalse(w.offer(au(false), false))
        assertEquals(1, asked.get())
        out.release.countDown()
        waitFor("the first frame written") { w.sent == 1L }
        assertTrue(w.offer(au(true), true))
        waitFor("the recovery IDR") { w.sent == 2L }
        assertTrue(synchronized(out.frames) { out.frames.last() }.discontinuity())
        w.close()
    }

    @Test
    fun `an oversize AU breaks the chain like a drop - nothing but an IDR until one comes`() {
        val out = ByteArrayOutputStream()
        val asked = AtomicInteger()
        val w = WebcamStreamWriter(out, null, {}, {}, { asked.incrementAndGet() })
        w.countOversizeAndAwaitKeyframe()
        assertFalse(w.offer(au(false), false))
        assertTrue(w.offer(au(true), true))
        waitFor("the IDR written") { w.sent == 1L }
        assertEquals(1L, w.oversize)
        assertEquals(2L, w.framesDropped())
        assertEquals(1, asked.get())
        w.close()
    }

    @Test
    fun `the Mac hanging up or writing anything ends the stream once, and nothing is taken after`() {
        val toPhone = PipedOutputStream()
        val fromMac = PipedInputStream(toPhone)
        val closed = AtomicInteger()
        val socketClosed = AtomicInteger()
        val w = WebcamStreamWriter(ByteArrayOutputStream(), fromMac, { socketClosed.incrementAndGet() }, { closed.incrementAndGet() }, {})
        toPhone.write(1) // the Mac must only read
        // Both clocks: `open` flips before onClosed runs, so settling on `isOpen` alone reads mid-transition.
        waitFor("the stream to end and say so") { !w.isOpen && closed.get() == 1 }
        assertEquals(1, closed.get())
        assertEquals(1, socketClosed.get())
        assertFalse(w.offer(au(true), true))
        w.close()
        assertEquals("closing again closes nothing", 1, socketClosed.get())
    }

    @Test
    fun `closing from this side does not report a remote close`() {
        val closed = AtomicInteger()
        val w = WebcamStreamWriter(ByteArrayOutputStream(), PipedInputStream(PipedOutputStream()), {}, { closed.incrementAndGet() }, {})
        w.close()
        Thread.sleep(50)
        assertEquals(0, closed.get())
        assertFalse(w.isOpen)
    }
}
