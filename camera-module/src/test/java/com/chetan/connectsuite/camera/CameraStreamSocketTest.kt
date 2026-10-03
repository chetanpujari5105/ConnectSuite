package com.chetan.connectsuite.camera

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.DataInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The phone's camera socket writer over **real loopback TCP sockets** — the close, reset and stop races
 * that a fake stream cannot produce: an orderly FIN from the Mac, an RST, a byte the Mac must not send,
 * and this side's own close racing all of them.
 *
 * What this does not reach, and says so: TLS. The phone's TLS layer is the Android Keystore's identity
 * under `LinkServer`, which a JVM test cannot construct, so `CameraStream` is given the plain socket's
 * streams exactly as `CameraEngine.onChannel` gives it the authenticated channel's. The Mac's TLS half is
 * `desktop/src/main/cameraTransport.test.ts`; the two have only ever met on hardware.
 */
class CameraStreamSocketTest {

    private val opened = mutableListOf<java.io.Closeable>()

    @After
    fun closeEverything() {
        opened.forEach { runCatching { it.close() } }
    }

    /** A connected pair: [phone] is the side `CameraStream` writes on, [mac] the side the test plays. */
    private fun pair(): Pair<Socket, Socket> {
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).also { opened += it }
        val mac = Socket(InetAddress.getLoopbackAddress(), server.localPort).also { opened += it }
        val phone = server.accept().also { opened += it }
        mac.soTimeout = 5_000
        return phone to mac
    }

    private class Ended {
        val count = AtomicInteger()
        val latch = CountDownLatch(1)
        fun call() {
            count.incrementAndGet()
            latch.countDown()
        }
    }

    private fun stream(phone: Socket, ended: Ended) = CameraStream(
        output = phone.getOutputStream(),
        input = phone.getInputStream(),
        closeSocket = { phone.close() },
        onClosed = ended::call,
    )

    @Test
    fun `frames cross a real socket whole and in order`() {
        val (phone, mac) = pair()
        val s = stream(phone, Ended())
        val frames = (1..20).map { i -> ByteArray(1_000 + i) { (it + i).toByte() } }
        val reader = DataInputStream(mac.getInputStream())
        // Offer one at a time so the two-deep queue never has to evict: this is about bytes, not shedding.
        for (frame in frames) {
            assertTrue(s.offer(frame))
            val back = ByteArray(frame.size)
            reader.readFully(back)
            assertArrayEquals(frame, back)
        }
        assertEquals(20L, s.framesSent())
        s.close()
    }

    @Test
    fun `the Mac hanging up with a FIN ends the stream once, with no frames flowing`() {
        val (phone, mac) = pair()
        val ended = Ended()
        stream(phone, ended)
        mac.shutdownOutput()
        mac.close()
        assertTrue("no end was reported", ended.latch.await(5, TimeUnit.SECONDS))
        Thread.sleep(100)
        assertEquals(1, ended.count.get())
    }

    @Test
    fun `a reset from the Mac ends the stream once, even mid-write`() {
        val (phone, mac) = pair()
        val ended = Ended()
        val s = stream(phone, ended)
        mac.setSoLinger(true, 0) // close sends RST
        mac.close()
        // Keep writing into the reset socket: the writer and the watcher both see it, and only one reports.
        repeat(50) { s.offer(ByteArray(64 * 1024)) }
        assertTrue(ended.latch.await(5, TimeUnit.SECONDS))
        Thread.sleep(100)
        assertEquals(1, ended.count.get())
        assertFalse(s.isOpen)
    }

    @Test
    fun `a byte from the Mac is a protocol violation and ends the stream once`() {
        val (phone, mac) = pair()
        val ended = Ended()
        stream(phone, ended)
        mac.getOutputStream().apply { write(0x41); flush() }
        assertTrue(ended.latch.await(5, TimeUnit.SECONDS))
        Thread.sleep(100)
        assertEquals(1, ended.count.get())
        // The phone closed its socket: the Mac reads end of stream.
        assertEquals(-1, mac.getInputStream().read())
    }

    @Test
    fun `this side's close is never reported as the Mac hanging up, and stops frames at once`() {
        val (phone, mac) = pair()
        val ended = Ended()
        val s = stream(phone, ended)
        s.close()
        assertFalse("a frame was accepted after close", s.offer(ByteArray(10)))
        assertEquals(-1, mac.getInputStream().read())
        Thread.sleep(150)
        assertEquals("a local close was reported as the Mac's", 0, ended.count.get())
    }

    /** The stop race, many times: this side closing while the Mac hangs up. Exactly one of them wins. */
    @Test
    fun `a local close racing the Mac's hang-up reports at most once, 200 times over`() {
        var reported = 0
        repeat(200) {
            val (phone, mac) = pair()
            val ended = Ended()
            val s = stream(phone, ended)
            val macGone = Thread { runCatching { mac.close() } }
            macGone.start()
            s.close()
            macGone.join(2_000)
            Thread.sleep(5)
            assertTrue("reported ${ended.count.get()} times", ended.count.get() <= 1)
            reported += ended.count.get()
            phone.close()
        }
        // Not asserted either way: which side wins is the scheduler's. Printed so the run says what it saw.
        println("camera stream close race: the Mac's hang-up was reported in $reported of 200 runs")
    }
}
