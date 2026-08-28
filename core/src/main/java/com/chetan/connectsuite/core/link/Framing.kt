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
 */
object Framing {

    /** Reads one frame, or returns null at a clean end of stream. */
    fun readFrame(input: InputStream, maxLength: Int = Link.MAX_FRAME): ByteArray? {
        val data = DataInputStream(input)
        val length = try {
            data.readInt()
        } catch (_: EOFException) {
            return null
        }
        if (length < 0 || length > maxLength) {
            throw ProtocolException("Frame length $length out of range (max $maxLength)")
        }
        val payload = ByteArray(length)
        data.readFully(payload)
        return payload
    }

    fun writeFrame(output: OutputStream, payload: ByteArray) {
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
    }
}
