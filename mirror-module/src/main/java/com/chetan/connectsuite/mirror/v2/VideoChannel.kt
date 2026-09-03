package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.link.AuthenticatedChannel
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.protocol.Link
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Mac's video socket: one writer thread and a bounded queue.
 *
 * The queue is the whole design. The encoder produces on its own callback thread at 60fps and
 * must never block — a stalled callback backs up into MediaCodec and then into SurfaceFlinger,
 * which janks the phone's own UI. So frames go into a fixed queue and, when the Mac cannot keep
 * up, they are *dropped here* rather than buffered without limit. Dropping is correct for a live
 * mirror: a late frame has no value, and an unbounded queue would trade a brief stutter for
 * growing latency that never recovers.
 *
 * Non-keyframes are dropped first. Dropping a keyframe strands the decoder until the next one,
 * so a full queue evicts P-frames and only sheds a keyframe when there is nothing else to give.
 * Config frames are treated like keyframes here: they carry the SPS/PPS for everything that
 * follows, and a mid-session resolution change or rotation sends a new set that the Mac's decoder
 * cannot be reconfigured without. Shedding one because the link was briefly behind would leave
 * the decoder describing a stream that no longer exists.
 */
class VideoChannel(
    private val channel: AuthenticatedChannel,
    /** Called after any drop, with the running tally so the caller can name the reason (defect 52). */
    private val onDropped: (VideoDropTally) -> Unit = {},
) {
    private val queue = ArrayBlockingQueue<VideoFrame>(QUEUE_DEPTH)
    private val running = AtomicBoolean(true)
    private val drops = VideoDropTally()

    private val writer = Thread({ pump(channel.output) }, "mirror-video-writer").apply {
        isDaemon = true
        start()
    }

    /**
     * Offers a frame to the Mac. Never blocks.
     *
     * Config frames are not retained here. A socket only lives as long as one connection, so a
     * per-socket copy would always be null for the reconnect it was meant to serve; [MirrorEngine]
     * holds the config for the session and primes each new channel with it.
     */
    fun offer(frame: VideoFrame) {
        if (!running.get()) return

        if (queue.offer(frame)) {
            drops.acceptedNow()
            return
        }

        // Full. Evict the oldest non-keyframe to make room; a stale P-frame is the cheapest thing
        // in the queue to lose.
        val evicted = queue.poll()
        if (evicted != null && !evicted.keyframe && !evicted.config) {
            drops.staleEvicted()
            onDropped(drops)
        } else if (evicted != null) {
            // Only keyframes and parameter sets left: the link is badly behind. Put it back and
            // drop the newcomer, because stranding the decoder is worse than being one frame stale.
            queue.offer(evicted)
            drops.newestShed()
            onDropped(drops)
            return
        }
        if (queue.offer(frame)) drops.acceptedNow()
    }

    private fun pump(output: OutputStream) {
        try {
            while (running.get()) {
                val frame = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                writeFrame(output, frame)
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (e: IOException) {
            LinkLog.i("mirror", "Video socket closed by the Mac: ${e.message}")
        } finally {
            close()
        }
    }

    /**
     * Wire format, from docs/protocol.md:
     *   1 byte  flags   bit0 keyframe, bit1 config
     *   8 bytes PTS microseconds, big endian
     *   4 bytes payload length, big endian
     *   n bytes H.264 Annex B
     */
    private fun writeFrame(output: OutputStream, frame: VideoFrame) {
        val size = frame.data.size
        if (size > Link.MAX_FRAME) {
            // Refusing here keeps the Mac's reader from ever seeing a length it must reject.
            //
            // **Counted since defect 52.** This is the only channel-level correctness fault the
            // mirror has, and it used to increment nothing — so it appeared in neither
            // `droppedCount()` nor the `droppedFrames` field on the wire, which is the one place a
            // Mac could have seen it.
            drops.oversize()
            LinkLog.w(
                "mirror",
                "Dropping oversized frame: $size bytes, over Link.MAX_FRAME — the ENCODER produced " +
                    "something the wire cannot carry; this is not congestion — ${drops.headline()}",
            )
            onDropped(drops)
            return
        }
        val header = ByteArray(HEADER_BYTES)
        var flags = 0
        if (frame.keyframe) flags = flags or FLAG_KEYFRAME
        if (frame.config) flags = flags or FLAG_CONFIG
        header[0] = flags.toByte()
        var pts = frame.ptsUs
        for (i in 8 downTo 1) {
            header[i] = (pts and 0xFF).toByte()
            pts = pts ushr 8
        }
        header[9] = (size ushr 24 and 0xFF).toByte()
        header[10] = (size ushr 16 and 0xFF).toByte()
        header[11] = (size ushr 8 and 0xFF).toByte()
        header[12] = (size and 0xFF).toByte()

        output.write(header)
        output.write(frame.data)
        output.flush()
    }

    /** Every frame that did not reach the Mac, oversize included — see [VideoDropTally.total]. */
    fun droppedCount(): Int = drops.total()

    /** The three reasons, for a caller that wants to say which. */
    fun drops(): VideoDropTally = drops

    fun close() {
        if (running.compareAndSet(true, false)) {
            queue.clear()
            channel.close()
        }
    }

    companion object {
        const val HEADER_BYTES = 13
        const val FLAG_KEYFRAME = 0x01
        const val FLAG_CONFIG = 0x02

        /**
         * Two frames at 60fps. Deep enough to ride out a scheduling hiccup, shallow enough that a
         * Mac which stops reading costs ~33ms of latency before frames start being shed.
         */
        const val QUEUE_DEPTH = 4
    }
}
