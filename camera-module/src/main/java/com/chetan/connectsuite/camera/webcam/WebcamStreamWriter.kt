package com.chetan.connectsuite.camera.webcam

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The claimed 42502 socket for one webcam session: one writer thread, one watcher thread, and the
 * contract's bound — **two access units in flight** (docs/protocol.md → Bounded buffering).
 *
 * ### Dropped by the keyframe rule, never by age
 *
 * Camera v1's stream evicts the oldest frame, which is right for JPEGs and wrong here: an H.264 P-frame
 * refers to the frames before it, so skipping one corrupts every frame until the next IDR. When the two
 * slots are full:
 *
 * - an AU that is not an IDR is dropped, and **so is every non-IDR after it** until an IDR arrives;
 *   the encoder is asked for one at once ([onKeyframeNeeded], once per episode);
 * - an IDR replaces everything still waiting (all of it predates the IDR and is useless now);
 * - the first AU written after any drop carries the header's **discontinuity** bit.
 *
 * Counted `droppedBackpressure`, beside `sent`. The encoder's thread offers and returns at once; it never
 * waits on the network, because a stalled encoder backs up into the camera.
 *
 * ### The watcher
 *
 * The Mac only reads after its claim. End of stream, an error, or **any byte at all** from it ends the
 * stream, and [onClosed] says so once. Android-free, so the JVM test drives it with a gated stream.
 */
class WebcamStreamWriter(
    private val output: OutputStream,
    private val input: InputStream?,
    private val closeSocket: () -> Unit,
    /** Called once when the socket ends by any route other than [close]. */
    private val onClosed: () -> Unit,
    /** The encoder must produce an IDR: called once per drop episode, outside the lock. */
    private val onKeyframeNeeded: () -> Unit,
    private val inFlight: Int = IN_FLIGHT,
) {
    private class Pending(val frame: ByteArray, val keyframe: Boolean)

    private val queue = ArrayDeque<Pending>(inFlight)
    private val lock = Object()
    private val open = AtomicBoolean(true)
    private val closedLocally = AtomicBoolean(false)
    private var writing = false
    private var awaitingKeyframe = false
    private var markNext = false

    @Volatile
    var sent = 0L
        private set

    @Volatile
    var bytesSent = 0L
        private set

    @Volatile
    var droppedBackpressure = 0L
        private set

    @Volatile
    var oversize = 0L
        private set

    @Volatile
    var keyframeRequests = 0L
        private set

    @Volatile
    var discontinuities = 0L
        private set


    /** The most AUs ever held here and being written at once — the bound's own reading. */
    @Volatile
    var maxInFlight = 0
        private set

    init {
        require(inFlight >= 1)
    }

    private val writer = Thread({ pump() }, "webcam-stream-writer").apply {
        isDaemon = true
        start()
    }

    private val watcher = input?.let { stream ->
        Thread({ watch(stream) }, "webcam-stream-watcher").apply {
            isDaemon = true
            start()
        }
    }

    /**
     * Offers one whole frame ([WebcamAuCodec.encode]'s output). Never blocks. True when it was taken —
     * false when the stream is closed or the keyframe rule dropped it.
     */
    fun offer(frame: ByteArray, keyframe: Boolean): Boolean {
        var askForKeyframe = false
        val taken = synchronized(lock) {
            if (!open.get()) return false
            var free = inFlight - queue.size - (if (writing) 1 else 0)
            val took = if (keyframe) {
                if (free <= 0) {
                    // Everything waiting predates this IDR and is useless now.
                    droppedBackpressure += queue.size
                    if (queue.isNotEmpty()) markNext = true
                    queue.clear()
                    free = inFlight - (if (writing) 1 else 0)
                }
                if (free <= 0) {
                    // Every slot is being written: the IDR itself is the drop.
                    droppedBackpressure++
                    markNext = true
                    if (!awaitingKeyframe) askForKeyframe = true
                    awaitingKeyframe = true
                    false
                } else {
                    awaitingKeyframe = false
                    queue.addLast(Pending(frame, true))
                    true
                }
            } else if (awaitingKeyframe || free <= 0) {
                droppedBackpressure++
                markNext = true
                if (!awaitingKeyframe) askForKeyframe = true
                awaitingKeyframe = true
                false
            } else {
                queue.addLast(Pending(frame, false))
                true
            }
            maxInFlight = maxOf(maxInFlight, queue.size + if (writing) 1 else 0)
            lock.notifyAll()
            took
        }
        if (askForKeyframe) requestKeyframe()
        return taken
    }

    /**
     * An AU too large for the wire, never sent. Like a drop, it breaks the reference chain, so the rule is
     * the same: nothing but an IDR until one comes.
     */
    fun countOversizeAndAwaitKeyframe() {
        var ask = false
        synchronized(lock) {
            oversize++
            markNext = true
            if (!awaitingKeyframe) ask = true
            awaitingKeyframe = true
        }
        if (ask) requestKeyframe()
    }

    /** Every AU offered that did not reach the socket. */
    fun framesDropped(): Long = droppedBackpressure + oversize

    /** `120 sent / 4 dropped (4 backpressure, 0 oversize), 1 IDR requested, 1 discontinuity, at most 2 in flight` */
    fun summary(): String =
        "$sent sent / ${framesDropped()} dropped ($droppedBackpressure backpressure, $oversize oversize), " +
            "$keyframeRequests IDR requested, $discontinuities discontinuity marked, $bytesSent bytes, " +
            "at most $maxInFlight of $inFlight in flight"

    val isOpen: Boolean get() = open.get()

    /** Closes from this side. [onClosed] is not called — the caller already knows. */
    fun close() {
        closedLocally.set(true)
        shutdown()
    }

    private fun requestKeyframe() {
        keyframeRequests++
        runCatching { onKeyframeNeeded() }
    }

    private fun pump() {
        try {
            while (open.get()) {
                val next = synchronized(lock) {
                    while (open.get() && queue.isEmpty()) lock.wait(500)
                    val p = queue.pollFirst() ?: return@synchronized null
                    writing = true
                    val mark = markNext
                    markNext = false
                    p to mark
                } ?: continue
                val (pending, mark) = next
                if (mark) {
                    WebcamAuCodec.markDiscontinuity(pending.frame)
                    discontinuities++
                }
                try {
                    output.write(pending.frame)
                    output.flush()
                    sent++
                    bytesSent += pending.frame.size
                } finally {
                    synchronized(lock) { writing = false }
                }
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
        /** docs/protocol.md → Bounded buffering: phone encoder → socket, 2 AUs in flight. */
        const val IN_FLIGHT = 2
    }
}
