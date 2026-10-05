package com.chetan.connectsuite.camera

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * The Mac's camera socket: one writer thread, one watcher thread, and a two-deep queue.
 *
 * ### Dropped, never queued
 *
 * The analysis thread offers a frame and returns at once; it never waits on the network, because a
 * stalled analyzer backs up into CameraX and then into the phone's own preview. When the Mac is slow
 * the queue holds the **two newest** frames and evicts the oldest. Unlike the mirror's
 * `VideoChannel`, there is no keyframe to protect — every camera frame is a whole JPEG — so the oldest
 * is always the right one to lose, and a slow Mac costs at most two frames of latency rather than an
 * ever-growing backlog.
 *
 * ### The watcher
 *
 * The Mac only reads after its claim, so the writer alone would notice a closed socket only on its
 * next write — and a stream in `starting`, with no frames yet, writes nothing. The watcher blocks on
 * the input side: end of stream, an error, or **any byte at all** (the Mac must not write here) means
 * the stream is over, and [onClosed] says so once.
 *
 * Android-free: it takes the two streams and a close function, so the JVM test drives it with a
 * gated output stream that plays a Mac that has stopped reading.
 */
class CameraStream(
    private val output: OutputStream,
    private val input: InputStream?,
    private val closeSocket: () -> Unit,
    /** Called once when the socket ends by any route other than [close]. */
    private val onClosed: () -> Unit,
    private val depth: Int = QUEUE_DEPTH,
) {
    private val queue = ArrayDeque<ByteArray>(depth)
    private val lock = Object()
    private val open = AtomicBoolean(true)
    private val closedLocally = AtomicBoolean(false)
    private val sent = AtomicLong(0)
    private val evicted = AtomicLong(0)
    private val oversize = AtomicLong(0)
    private val encodeFailures = AtomicLong(0)

    private val writer = Thread({ pump() }, "camera-stream-writer").apply {
        isDaemon = true
        start()
    }

    private val watcher = input?.let { stream ->
        Thread({ watch(stream) }, "camera-stream-watcher").apply {
            isDaemon = true
            start()
        }
    }

    /** Offers one encoded frame. Never blocks. False when the stream is already closed. */
    fun offer(frame: ByteArray): Boolean {
        if (!open.get()) return false
        synchronized(lock) {
            if (queue.size >= depth) {
                queue.pollFirst()
                evicted.incrementAndGet()
            }
            queue.addLast(frame)
            lock.notifyAll()
        }
        return true
    }

    /** A frame that would have exceeded the wire's cap, counted and never sent. */
    fun countOversize() {
        oversize.incrementAndGet()
    }

    /** A frame the phone could not encode. Counted so `framesDropped` includes it. */
    fun countEncodeFailure() {
        encodeFailures.incrementAndGet()
    }

    /** Frames written to the socket. */
    fun framesSent(): Long = sent.get()

    /** Every produced frame that did not reach the socket — evicted, oversize, or not encoded. */
    fun framesDropped(): Long = evicted.get() + oversize.get() + encodeFailures.get()

    /** `12 sent / 3 dropped (2 evicted, 1 oversize, 0 unencoded)` — the denominator rule. */
    fun summary(): String =
        "${framesSent()} sent / ${framesDropped()} dropped " +
            "(${evicted.get()} evicted, ${oversize.get()} oversize, ${encodeFailures.get()} unencoded)"

    val isOpen: Boolean get() = open.get()

    /** Closes from this side. [onClosed] is not called — the caller already knows. */
    fun close() {
        closedLocally.set(true)
        shutdown()
    }

    /**
     * Waits for the writer and the watcher to finish. Once this returns true, no route that could
     * call [onClosed] is still running, so a count of its calls is final.
     *
     * The test seam for the race [isOpen] cannot close: `open` flips at the start of [shutdown],
     * before [closeSocket] and [onClosed] run, so polling [isOpen] and then counting calls reads a
     * stream that is closing, not one that has closed. A 150 ms delay inside [shutdown] turned two of
     * the six JVM tests red while the stream itself stayed correct.
     */
    internal fun awaitThreadsEnded(timeoutMs: Long): Boolean {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        for (thread in listOfNotNull(writer, watcher)) {
            val leftMs = (deadline - System.nanoTime()) / 1_000_000
            if (leftMs <= 0) return false
            thread.join(leftMs)
            if (thread.isAlive) return false
        }
        return true
    }

    private fun pump() {
        try {
            while (open.get()) {
                val frame = synchronized(lock) {
                    while (open.get() && queue.isEmpty()) lock.wait(500)
                    queue.pollFirst()
                } ?: continue
                output.write(frame)
                output.flush()
                sent.incrementAndGet()
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: IOException) {
            // The Mac hung up mid-write.
        } finally {
            remoteEnded()
        }
    }

    private fun watch(stream: InputStream) {
        try {
            // Any byte is a protocol violation, end of stream is a hang-up; both end the stream.
            stream.read()
        } catch (_: IOException) {
        } finally {
            remoteEnded()
        }
    }

    private fun remoteEnded() {
        if (shutdown() && !closedLocally.get()) onClosed()
    }

    /** True for the one caller that actually closed it. */
    private fun shutdown(): Boolean {
        if (!open.compareAndSet(true, false)) return false
        synchronized(lock) {
            queue.clear()
            lock.notifyAll()
        }
        runCatching { closeSocket() }
        return true
    }

    companion object {
        /** Two frames: at 15 fps a Mac that stops reading costs ~133 ms before frames are shed. */
        const val QUEUE_DEPTH = 2
    }
}
