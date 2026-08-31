package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.ProtocolException
import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream

/**
 * The one framing implementation for every channel: 4-byte big-endian length, then payload.
 *
 * Everything on the wire goes through here so a length prefix is validated in exactly one place;
 * a peer that claims a 3 GB frame gets its socket closed rather than an OutOfMemoryError.
 *
 * The cap is a parameter, never a constant read inside a feature. A second check written into
 * `fs.*` or `media.*` would be a second answer to the same question, free to drift from this one.
 */
object Framing {

    /**
     * Reads one frame, or returns null at a clean end of stream.
     *
     * [kind] names the frame in a refusal ("Bulk header", "Bulk chunk"), because a channel that
     * carries two frame shapes under two caps must say which one it refused.
     */
    fun readFrame(
        input: InputStream,
        maxLength: Int = Link.MAX_FRAME,
        tally: FrameTally? = null,
        kind: String = "Frame",
    ): ByteArray? {
        val data = DataInputStream(input)
        val length = try {
            data.readInt()
        } catch (_: EOFException) {
            return null
        }
        if (length < 0 || length > maxLength) {
            throw ProtocolException(refusal(tally, kind, length.toLong(), maxLength))
        }
        val payload = ByteArray(length)
        data.readFully(payload)
        tally?.accept(length)
        return payload
    }

    /**
     * Writes one frame, refusing to emit a payload past [maxLength].
     *
     * The write side matters as much as the read side and catches a different bug: the read side
     * catches a peer that has lost sync, the write side catches *us* — an adaptive chunk size that
     * ran away, a header that grew a field nobody sized. `VideoChannel.writeFrame` has refused
     * over-size frames since Phase 2 for exactly this reason, and the comment there is the whole
     * argument: refusing here keeps the far side from ever seeing a length it must reject.
     */
    fun writeFrame(
        output: OutputStream,
        payload: ByteArray,
        maxLength: Int = Link.MAX_FRAME,
        tally: FrameTally? = null,
        kind: String = "Frame",
    ) {
        if (payload.size > maxLength) {
            throw ProtocolException(refusal(tally, kind, payload.size.toLong(), maxLength))
        }
        val header = ByteArray(4)
        header[0] = (payload.size ushr 24).toByte()
        header[1] = (payload.size ushr 16).toByte()
        header[2] = (payload.size ushr 8).toByte()
        header[3] = payload.size.toByte()
        // One flush per frame, and the header and body written back to back, so a reader never
        // sees a length prefix without its payload behind it.
        synchronized(output) {
            output.write(header)
            output.write(payload)
            output.flush()
        }
        tally?.accept(payload.size)
    }

    private fun refusal(tally: FrameTally?, kind: String, length: Long, cap: Int): String =
        tally?.reject(kind, length, cap)
            ?: "$kind length $length out of range (max $cap)"
}

/**
 * The bulk channel's two caps, at the call site, over one shared [FrameTally].
 *
 * It holds no comparison of its own — every length is judged inside [Framing]. All this decides is
 * *which* cap applies to the frame being read or written, which is the thing a feature legitimately
 * knows and the framing layer cannot: a bulk socket carries a small JSON header followed by chunks,
 * and reading the header under the chunk cap would let a malformed first frame allocate the whole
 * payload budget on a connection that has proved nothing beyond its token.
 *
 * [onViolation] is how a refusal reaches the socket. Nothing here owns the socket, so `fs.*` wires
 * it — `{ message -> LinkLog.e("bulk", message); channel.close() }` — and the exception is rethrown
 * afterwards so the read loop unwinds rather than continuing on a stream known to be desynchronised.
 * A length prefix is either right or the stream is lost; there is no third case worth resyncing to.
 */
class BulkFraming(
    private val input: InputStream,
    private val output: OutputStream,
    private val onViolation: (String) -> Unit,
    val tally: FrameTally = FrameTally("bulk"),
) {

    fun readHeader(): ByteArray? =
        guarded { Framing.readFrame(input, Link.MAX_BULK_HEADER_FRAME, tally, HEADER) }

    fun readChunk(): ByteArray? =
        guarded { Framing.readFrame(input, Link.MAX_BULK_FRAME, tally, CHUNK) }

    fun writeHeader(payload: ByteArray) =
        guarded { Framing.writeFrame(output, payload, Link.MAX_BULK_HEADER_FRAME, tally, HEADER) }

    fun writeChunk(payload: ByteArray) =
        guarded { Framing.writeFrame(output, payload, Link.MAX_BULK_FRAME, tally, CHUNK) }

    private fun <T> guarded(body: () -> T): T =
        try {
            body()
        } catch (e: ProtocolException) {
            onViolation(e.message ?: "bulk frame refused; ${tally.summary()}")
            throw e
        }

    private companion object {
        const val HEADER = "Bulk header"
        const val CHUNK = "Bulk chunk"
    }
}
