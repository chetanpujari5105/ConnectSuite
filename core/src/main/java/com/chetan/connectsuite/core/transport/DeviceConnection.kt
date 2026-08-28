package com.chetan.connectsuite.core.transport

import android.util.Log
import com.chetan.connectsuite.core.protocol.IdentityPacket
import com.chetan.connectsuite.core.protocol.NetworkPacket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.Socket
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicBoolean

/** A packet plus the raw bytes that followed it, if any. */
data class IncomingPacket(val packet: NetworkPacket, val payload: ByteArray?) {
    override fun equals(other: Any?): Boolean =
        this === other || (other is IncomingPacket && packet == other.packet)

    override fun hashCode(): Int = packet.hashCode()
}

/**
 * A live, authenticated link to one peer.
 *
 * Framing is a UTF-8 JSON line per packet; when a packet declares a payload, exactly that many
 * raw bytes follow the newline. A single reader coroutine owns the input stream and a mutex
 * serialises writes, so callers can send from anywhere without interleaving two payloads.
 */
class DeviceConnection(
    private val socket: Socket,
    val peerIdentity: IdentityPacket,
    val peerCertificate: X509Certificate,
    val peerFingerprint: String,
    private val onClosed: (DeviceConnection) -> Unit,
) {
    val deviceId: String get() = peerIdentity.deviceId

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val writeMutex = Mutex()
    private val closed = AtomicBoolean(false)
    private var readerJob: Job? = null

    private val input = DataInputStream(BufferedInputStream(socket.getInputStream(), BUFFER_SIZE))
    private val output: OutputStream = socket.getOutputStream()

    private val _packets = MutableSharedFlow<IncomingPacket>(
        replay = 0,
        extraBufferCapacity = 128,
    )
    val packets: SharedFlow<IncomingPacket> = _packets.asSharedFlow()

    val isOpen: Boolean get() = !closed.get() && !socket.isClosed

    val remoteAddress: String? get() = socket.inetAddress?.hostAddress

    fun start() {
        readerJob = scope.launch { readLoop() }
    }

    private suspend fun readLoop() {
        try {
            while (isOpen) {
                val line = readLine() ?: break
                if (line.isBlank()) continue

                val packet = runCatching { NetworkPacket.decode(line) }.getOrElse {
                    Log.w(TAG, "Dropping malformed packet from $deviceId", it)
                    continue
                }

                val payload = when {
                    packet.payloadSize <= 0 -> null
                    packet.payloadSize > MAX_PAYLOAD_BYTES -> {
                        Log.w(TAG, "Peer declared oversized payload ${packet.payloadSize}")
                        break // A peer this far out of spec is not one we keep talking to.
                    }
                    else -> ByteArray(packet.payloadSize).also(input::readFully)
                }

                _packets.emit(IncomingPacket(packet, payload))
            }
        } catch (e: IOException) {
            Log.d(TAG, "Connection to $deviceId ended: ${e.message}")
        } finally {
            close()
        }
    }

    /** Reads one `\n`-terminated line without buffering past it, so payload bytes stay intact. */
    private fun readLine(): String? {
        val buffer = StringBuilder(256)
        while (true) {
            val b = input.read()
            when {
                b == -1 -> return if (buffer.isEmpty()) null else buffer.toString()
                b == '\n'.code -> return buffer.toString()
                b == '\r'.code -> Unit
                else -> {
                    if (buffer.length > MAX_LINE_CHARS) throw IOException("Header line too long")
                    buffer.append(b.toChar())
                }
            }
        }
    }

    suspend fun send(packet: NetworkPacket, payload: ByteArray? = null): Boolean {
        if (!isOpen) return false
        return withContext(Dispatchers.IO) {
            writeMutex.withLock {
                try {
                    val header = (NetworkPacket.encode(packet) + "\n").toByteArray(Charsets.UTF_8)
                    output.write(header)
                    if (payload != null && payload.isNotEmpty()) output.write(payload)
                    output.flush()
                    true
                } catch (e: IOException) {
                    Log.d(TAG, "Send to $deviceId failed: ${e.message}")
                    close()
                    false
                }
            }
        }
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { socket.close() }
        readerJob?.cancel()
        scope.cancel()
        onClosed(this)
    }

    companion object {
        private const val TAG = "DeviceConnection"
        private const val BUFFER_SIZE = 64 * 1024

        /** Ceiling on a single framed payload; chunk size is well under this. */
        const val MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

        private const val MAX_LINE_CHARS = 512 * 1024
    }
}
