package com.chetan.connectsuite.core.discovery

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import com.chetan.connectsuite.core.protocol.IdentityPacket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface

/** A peer seen announcing itself on the local network. */
data class DiscoveredPeer(
    val identity: IdentityPacket,
    val address: String,
    val seenAtMillis: Long = System.currentTimeMillis(),
    /** Wi-Fi P2P MAC, present only for peers found over Wi-Fi Direct. */
    val wifiDirectAddress: String? = null,
)

/**
 * Presence over plain UDP broadcast — the path used when both devices share an access point, and
 * the only path a desktop can use, since desktops do not join Wi-Fi Direct groups the way phones
 * do.
 *
 * The broadcast carries only the identity packet (id, name, type, TCP port). Nothing sensitive
 * goes out unencrypted; everything else happens over the TLS connection that follows.
 */
class UdpDiscovery(
    private val appContext: Context,
    private val localIdentity: () -> IdentityPacket,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listenJob: Job? = null
    private var announceJob: Job? = null
    private var socket: DatagramSocket? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    private val _peers = MutableSharedFlow<DiscoveredPeer>(
        replay = 0,
        extraBufferCapacity = 64,
    )
    val peers: SharedFlow<DiscoveredPeer> = _peers.asSharedFlow()

    fun start() {
        if (listenJob?.isActive == true) return
        acquireMulticastLock()
        listenJob = scope.launch { listenLoop() }
        announceJob = scope.launch { announceLoop() }
    }

    fun stop() {
        listenJob?.cancel()
        announceJob?.cancel()
        listenJob = null
        announceJob = null
        runCatching { socket?.close() }
        socket = null
        releaseMulticastLock()
    }

    /** Sends one identity broadcast immediately, e.g. when the user pulls to refresh. */
    fun announceNow() {
        scope.launch { broadcastIdentity() }
    }

    private suspend fun listenLoop() {
        val bound = try {
            DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress(DISCOVERY_PORT))
            }
        } catch (e: IOException) {
            Log.e(TAG, "Could not bind UDP $DISCOVERY_PORT — LAN discovery disabled", e)
            return
        }
        socket = bound

        val buffer = ByteArray(BUFFER_SIZE)
        while (scope.isActive) {
            try {
                val datagram = DatagramPacket(buffer, buffer.size)
                bound.receive(datagram)
                val text = String(datagram.data, 0, datagram.length, Charsets.UTF_8)
                val identity = IdentityPacket.decodeOrNull(text) ?: continue
                if (identity.deviceId == localIdentity().deviceId) continue

                _peers.emit(
                    DiscoveredPeer(
                        identity = identity,
                        address = datagram.address.hostAddress ?: continue,
                    ),
                )
            } catch (e: IOException) {
                if (scope.isActive) Log.d(TAG, "UDP receive ended: ${e.message}")
                break
            }
        }
    }

    private suspend fun announceLoop() {
        while (scope.isActive) {
            broadcastIdentity()
            delay(ANNOUNCE_INTERVAL_MS)
        }
    }

    private suspend fun broadcastIdentity() {
        val identity = localIdentity()
        if (identity.tcpPort == 0) return // Not listening yet; a broadcast now would be useless.

        val payload = IdentityPacket.encode(identity).toByteArray(Charsets.UTF_8)
        val targets = broadcastAddresses()

        withSocket { sender ->
            targets.forEach { address ->
                runCatching {
                    sender.send(DatagramPacket(payload, payload.size, address, DISCOVERY_PORT))
                }.onFailure { Log.d(TAG, "Broadcast to $address failed: ${it.message}") }
            }
        }
    }

    private inline fun withSocket(block: (DatagramSocket) -> Unit) {
        val existing = socket
        if (existing != null && !existing.isClosed) {
            block(existing)
            return
        }
        // Listener not up yet — use a throwaway sender so the first announce is not delayed.
        runCatching { DatagramSocket().apply { broadcast = true } }
            .onSuccess { temp -> try { block(temp) } finally { temp.close() } }
    }

    /**
     * Enumerates per-interface broadcast addresses rather than relying on 255.255.255.255, which
     * several OEM builds silently drop.
     */
    private fun broadcastAddresses(): List<InetAddress> = buildList {
        runCatching {
            NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { it.isUp && !it.isLoopback }
                .forEach { networkInterface ->
                    networkInterface.interfaceAddresses.forEach { interfaceAddress ->
                        interfaceAddress.broadcast?.let(::add)
                    }
                }
        }
        runCatching { add(InetAddress.getByName("255.255.255.255")) }
    }.distinct()

    /** Some devices drop broadcast frames to sleeping Wi-Fi unless a multicast lock is held. */
    private fun acquireMulticastLock() {
        runCatching {
            val wifi = appContext.applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("connectsuite-discovery").apply {
                setReferenceCounted(true)
                acquire()
            }
        }
    }

    private fun releaseMulticastLock() {
        runCatching { multicastLock?.takeIf { it.isHeld }?.release() }
        multicastLock = null
    }

    private companion object {
        const val TAG = "UdpDiscovery"
        const val DISCOVERY_PORT = 1763
        const val BUFFER_SIZE = 4096
        const val ANNOUNCE_INTERVAL_MS = 8_000L
    }
}
