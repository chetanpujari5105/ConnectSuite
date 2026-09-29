package com.chetan.connectsuite.sync.v2

import java.io.InputStream
import java.security.MessageDigest

/**
 * The phone's half of a block-verified pull (docs/protocol.md → Block-verified, resumable pulls), with
 * no Android and no socket in it: [BulkTransfers] hands it the source, a way to re-stat the source,
 * and a [Sink] for chunks, block digests and progress. Kept pure so a JVM test runs **this** code
 * through interruption, a changed source and a resumed prefix, rather than a model of it.
 *
 * Order is the contract's: a block's digest is handed to [Sink.blocks] only **after** the chunk
 * carrying its last byte went to [Sink.chunk]. The whole-file digest and the block digests take the
 * true bytes before the sink sees them, so a byte flipped on the way out (the debug corruption probe)
 * leaves the phone's digests right and the Mac's wrong — which is the disagreement being tested for.
 */
class BlockPullSender(
    private val size: Long,
    private val mtimeMs: Long,
    private val blockSize: Int,
    private val resume: FsBlocks.Resume?,
    private val chunk: Int = 256 * 1024,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Flush digests when this many are waiting, or when [flushMs] has passed since the last flush. */
    private val flushEvery: Int = 16,
    private val flushMs: Long = 250,
    private val progressMs: Long = 250,
) {
    interface Sink {
        fun chunk(buffer: ByteArray, length: Int, absoluteStart: Long)
        fun blocks(first: Long, digests: List<String>)
        fun progress(phase: String, bytes: Long)
    }

    sealed interface Outcome {
        val bytesSent: Long
        data class Sent(override val bytesSent: Long, val sha256: String, val manifestRoot: String, val blockCount: Long) : Outcome
        /** `why` is the contract's: `source-changed` or `prefix-mismatch`. */
        data class SourceChanged(override val bytesSent: Long, val why: String, val detail: String) : Outcome
        data class Cancelled(override val bytesSent: Long) : Outcome
    }

    /**
     * @param stat the source's current `(size, lastModifiedMs)`, or null when it cannot be read.
     * @param cancelled polled between chunks.
     */
    fun run(input: InputStream, stat: () -> Pair<Long, Long>?, cancelled: () -> Boolean, sink: Sink): Outcome {
        val agreed = size to mtimeMs
        stat().let { if (it != agreed) return Outcome.SourceChanged(0, "source-changed", "before the first byte: agreed $agreed, now $it") }

        val whole = MessageDigest.getInstance("SHA-256")
        val first = resume?.verifiedBlocks ?: 0L
        val from = first * blockSize
        val waiting = mutableListOf<String>()
        var waitingFrom = first
        val hasher = FsBlocks.Hasher(blockSize, 0L) { index, digest ->
            if (index >= first) waiting.add(FsBlocks.hex(digest))
        }
        val buffer = ByteArray(chunk)
        var lastProgress = 0L

        // D1: the prefix the Mac already holds is re-read and re-hashed here, never trusted.
        if (from > 0) {
            var read = 0L
            while (read < from) {
                val n = input.read(buffer, 0, minOf(buffer.size.toLong(), from - read).toInt())
                if (n <= 0) return Outcome.SourceChanged(0, "source-changed", "the source ended at $read, inside the $from-byte prefix")
                whole.update(buffer, 0, n)
                hasher.update(buffer, 0, n)
                read += n
                val now = clock()
                if (now - lastProgress >= progressMs) { lastProgress = now; sink.progress("verifying", read) }
                if (cancelled()) return Outcome.Cancelled(0)
            }
            val prefix = FsBlocks.hex(FsBlocks.rootOf(hasher.digests, first.toInt()))
            if (prefix != resume!!.prefixRoot) {
                return Outcome.SourceChanged(0, "prefix-mismatch", "the first $first blocks no longer hash to the Mac's record")
            }
            sink.progress("verifying", from)
        }

        var sent = 0L
        var lastFlush = clock()
        fun flush() {
            while (waiting.isNotEmpty()) {
                val batch = waiting.take(FsBlocks.MAX_DIGESTS_PER_EVENT)
                sink.blocks(waitingFrom, batch)
                waitingFrom += batch.size
                repeat(batch.size) { waiting.removeAt(0) }
            }
            lastFlush = clock()
        }
        while (true) {
            if (cancelled()) return Outcome.Cancelled(sent)
            val n = input.read(buffer)
            if (n <= 0) break
            if (from + sent + n > size) {
                return Outcome.SourceChanged(sent, "source-changed", "the source is longer than the agreed $size bytes")
            }
            whole.update(buffer, 0, n)
            hasher.update(buffer, 0, n)
            sink.chunk(buffer, n, from + sent)
            sent += n
            val now = clock()
            if (waiting.size >= flushEvery || (waiting.isNotEmpty() && now - lastFlush >= flushMs)) flush()
            if (now - lastProgress >= progressMs) { lastProgress = now; sink.progress("sending", from + sent) }
        }
        // Length first: a source that ended early must not have its unfinished last block closed and
        // its digest sent — the Mac would be told a block exists that the phone never read in full.
        if (from + sent != size) {
            return Outcome.SourceChanged(sent, "source-changed", "the source ended at ${from + sent} of the agreed $size bytes")
        }
        hasher.finish()
        flush()
        stat().let { if (it != agreed) return Outcome.SourceChanged(sent, "source-changed", "after the last byte: agreed $agreed, now $it") }
        sink.progress("sending", size)
        return Outcome.Sent(
            bytesSent = sent,
            sha256 = FsBlocks.hex(whole.digest()),
            manifestRoot = FsBlocks.hex(FsBlocks.rootOf(hasher.digests)),
            blockCount = hasher.digests.size.toLong(),
        )
    }
}
