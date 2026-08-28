package com.chetan.connectsuite.core.transport

import android.content.Context
import android.util.Log
import com.chetan.connectsuite.core.crypto.CertificateUtils
import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.protocol.IdentityPacket
import com.chetan.connectsuite.core.protocol.PROTOCOL_VERSION
import com.chetan.connectsuite.core.protocol.PacketType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

/** A packet together with the connection it arrived on. */
data class RoutedPacket(val connection: DeviceConnection, val incoming: IncomingPacket)

/**
 * Owns the listening socket and every live [DeviceConnection].
 *
 * Trust is enforced here, once, so no feature above this layer has to remember to check it: an
 * unpaired peer may complete a TLS handshake (it has to, in order to show us the certificate the
 * user is being asked to confirm) but only [PacketType.PAIR] packets are ever routed onward until
 * the trust store has a matching fingerprint.
 */
class ConnectionManager private constructor(
    private val appContext: Context,
) {
    private val identity = DeviceIdentity.get(appContext)
    private val trustedDevices = ConnectSuiteDatabase.get(appContext).trustedDeviceDao()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val connections = ConcurrentHashMap<String, DeviceConnection>()

    private var serverSocket: ServerSocket? = null
    private var acceptJob: Job? = null

    private val _connectedDevices = MutableStateFlow<Set<String>>(emptySet())
    val connectedDevices: StateFlow<Set<String>> = _connectedDevices.asStateFlow()

    private val _packets = MutableSharedFlow<RoutedPacket>(
        replay = 0,
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val packets: SharedFlow<RoutedPacket> = _packets.asSharedFlow()

    /** The port we ended up binding, advertised in every identity broadcast. */
    @Volatile
    var listenPort: Int = 0
        private set

    val capabilities: List<String> = listOf(
        IdentityPacket.CAP_FILE_TRANSFER,
        IdentityPacket.CAP_NOTIFICATIONS,
        IdentityPacket.CAP_SMS,
        IdentityPacket.CAP_CALL_LOG,
    )

    fun localIdentity(): IdentityPacket = IdentityPacket(
        deviceId = identity.deviceId,
        deviceName = identity.deviceName,
        deviceType = com.chetan.connectsuite.core.model.DeviceType.PHONE,
        protocolVersion = PROTOCOL_VERSION,
        tcpPort = listenPort,
        capabilities = capabilities,
    )

    fun start() {
        if (acceptJob?.isActive == true) return
        acceptJob = scope.launch { acceptLoop() }
    }

    fun stop() {
        acceptJob?.cancel()
        acceptJob = null
        runCatching { serverSocket?.close() }
        serverSocket = null
        connections.values.toList().forEach { it.close() }
        connections.clear()
        _connectedDevices.value = emptySet()
    }

    private suspend fun acceptLoop() {
        val server = bindServerSocket() ?: run {
            Log.e(TAG, "Could not bind any port in $PORT_RANGE_START..$PORT_RANGE_END")
            return
        }
        serverSocket = server
        listenPort = server.localPort
        Log.i(TAG, "Listening on port $listenPort")

        while (scope.isActive()) {
            val socket = try {
                server.accept()
            } catch (e: IOException) {
                if (scope.isActive()) Log.w(TAG, "Accept failed", e)
                break
            }
            scope.launch { handleInbound(socket) }
        }
    }

    private fun CoroutineScope.isActive(): Boolean = coroutineContext[Job]?.isActive != false

    private fun bindServerSocket(): ServerSocket? {
        for (port in PORT_RANGE_START..PORT_RANGE_END) {
            runCatching { return ServerSocket(port) }
        }
        return null
    }

    /** Inbound: peer dialled us, so they speak first with a plaintext identity line. */
    private suspend fun handleInbound(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            socket.soTimeout = HANDSHAKE_TIMEOUT_MS

            val identityLine = socket.getInputStream().readIdentityLine()
            val peerIdentity = IdentityPacket.decodeOrNull(identityLine)
                ?: throw IOException("Peer sent no usable identity packet")

            // Answer with our own identity so the peer can name us in its pairing dialog.
            socket.getOutputStream().apply {
                write((IdentityPacket.encode(localIdentity()) + "\n").toByteArray())
                flush()
            }

            finishHandshake(socket, peerIdentity, clientMode = false)
        } catch (e: Exception) {
            Log.d(TAG, "Inbound connection rejected: ${e.message}")
            runCatching { socket.close() }
        }
    }

    /** Outbound: we dial, we speak first, then we become the TLS client. */
    suspend fun connect(address: String, port: Int): Result<DeviceConnection> =
        withContext(Dispatchers.IO) {
            runCatching {
                val socket = Socket().apply {
                    tcpNoDelay = true
                    soTimeout = HANDSHAKE_TIMEOUT_MS
                    connect(InetSocketAddress(address, port), CONNECT_TIMEOUT_MS)
                }
                try {
                    socket.getOutputStream().apply {
                        write((IdentityPacket.encode(localIdentity()) + "\n").toByteArray())
                        flush()
                    }
                    val peerIdentity =
                        IdentityPacket.decodeOrNull(socket.getInputStream().readIdentityLine())
                            ?: throw IOException("Peer sent no usable identity packet")

                    finishHandshake(socket, peerIdentity, clientMode = true)
                        ?: throw IOException("Handshake rejected")
                } catch (e: Exception) {
                    runCatching { socket.close() }
                    throw e
                }
            }
        }

    private suspend fun finishHandshake(
        socket: Socket,
        peerIdentity: IdentityPacket,
        clientMode: Boolean,
    ): DeviceConnection? {
        if (peerIdentity.deviceId == identity.deviceId) {
            // Our own broadcast came back to us.
            runCatching { socket.close() }
            return null
        }
        if (peerIdentity.protocolVersion != PROTOCOL_VERSION) {
            Log.w(
                TAG,
                "Refusing ${peerIdentity.deviceName}: protocol v${peerIdentity.protocolVersion}, " +
                    "we speak v$PROTOCOL_VERSION",
            )
            runCatching { socket.close() }
            return null
        }

        val known = trustedDevices.find(peerIdentity.deviceId)
        val tls = TlsFactory.upgrade(
            socket = socket,
            identity = identity,
            clientMode = clientMode,
            expectedFingerprint = known?.fingerprint,
            allowUnknown = known == null,
        )

        // A peer must present a certificate whose CN matches the device id it announced,
        // otherwise any paired device could impersonate any other by lying in the identity line.
        val certDeviceId = CertificateUtils.deviceIdFrom(tls.peerCertificate)
        if (certDeviceId != peerIdentity.deviceId) {
            Log.w(TAG, "Certificate CN '$certDeviceId' does not match announced device id")
            runCatching { tls.socket.close() }
            return null
        }

        // Handshake done: switch to blocking reads with no timeout for the long-lived session.
        tls.socket.soTimeout = 0

        connections.remove(peerIdentity.deviceId)?.close()

        val connection = DeviceConnection(
            socket = tls.socket,
            peerIdentity = peerIdentity,
            peerCertificate = tls.peerCertificate,
            peerFingerprint = tls.peerFingerprint,
            onClosed = ::onConnectionClosed,
        )
        connections[peerIdentity.deviceId] = connection
        _connectedDevices.update { it + peerIdentity.deviceId }

        scope.launch {
            connection.packets.collect { incoming ->
                if (isAllowed(connection, incoming)) {
                    _packets.emit(RoutedPacket(connection, incoming))
                }
            }
        }
        connection.start()

        trustedDevices.touch(
            deviceId = peerIdentity.deviceId,
            seenAt = System.currentTimeMillis(),
            address = connection.remoteAddress,
            port = peerIdentity.tcpPort,
        )

        Log.i(TAG, "Connected to ${peerIdentity.deviceName} (paired=${known != null})")
        return connection
    }

    /** Everything except pairing is gated on a stored fingerprint that matches this connection. */
    private suspend fun isAllowed(connection: DeviceConnection, incoming: IncomingPacket): Boolean {
        if (incoming.packet.type == PacketType.PAIR) return true
        val pinned = trustedDevices.fingerprintOf(connection.deviceId) ?: return false
        return pinned.equals(connection.peerFingerprint, ignoreCase = true)
    }

    private fun onConnectionClosed(connection: DeviceConnection) {
        connections.remove(connection.deviceId, connection)
        _connectedDevices.update { it - connection.deviceId }
    }

    fun connectionTo(deviceId: String): DeviceConnection? =
        connections[deviceId]?.takeIf { it.isOpen }

    fun isConnected(deviceId: String): Boolean = connectionTo(deviceId) != null

    fun disconnect(deviceId: String) {
        connections[deviceId]?.close()
    }

    private fun java.io.InputStream.readIdentityLine(): String {
        val buffer = StringBuilder(512)
        while (true) {
            val b = read()
            when {
                b == -1 -> return buffer.toString()
                b == '\n'.code -> return buffer.toString()
                b == '\r'.code -> Unit
                else -> {
                    if (buffer.length > MAX_IDENTITY_CHARS) {
                        throw IOException("Identity line too long")
                    }
                    buffer.append(b.toChar())
                }
            }
        }
    }

    companion object {
        private const val TAG = "ConnectionManager"

        /** Same spirit as KDE Connect's fixed port, offset to avoid clashing with it. */
        const val PORT_RANGE_START = 1764
        const val PORT_RANGE_END = 1774

        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val HANDSHAKE_TIMEOUT_MS = 10_000
        private const val MAX_IDENTITY_CHARS = 8 * 1024

        @Volatile
        private var instance: ConnectionManager? = null

        fun get(context: Context): ConnectionManager =
            instance ?: synchronized(this) {
                instance ?: ConnectionManager(context.applicationContext).also { instance = it }
            }
    }
}
