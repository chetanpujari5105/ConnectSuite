package com.chetan.connectsuite.core.repository

import android.content.Context
import android.util.Log
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.discovery.DiscoveredPeer
import com.chetan.connectsuite.core.discovery.UdpDiscovery
import com.chetan.connectsuite.core.discovery.WifiDirectDiscovery
import com.chetan.connectsuite.core.discovery.WifiDirectState
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.model.DiscoveryChannel
import com.chetan.connectsuite.core.model.PairState
import com.chetan.connectsuite.core.pairing.PairingManager
import com.chetan.connectsuite.core.transport.ConnectionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The single source of truth for "what devices exist right now".
 *
 * Merges three inputs — the trust store, live discovery, and open connections — into one list, so
 * a device the user paired last week and a stranger broadcasting on the Wi-Fi are the same kind of
 * object in the UI, distinguished only by [Device.pairState].
 */
class DeviceRepository private constructor(private val appContext: Context) {

    private val database = ConnectSuiteDatabase.get(appContext)
    private val trustedDao = database.trustedDeviceDao()
    private val connections = ConnectionManager.get(appContext)
    private val pairing = PairingManager.get(appContext)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dialMutex = Mutex()

    val udpDiscovery = UdpDiscovery(appContext) { connections.localIdentity() }
    val wifiDirectDiscovery = WifiDirectDiscovery(appContext) { connections.localIdentity() }

    /** Peers seen on the network in the last [PEER_TTL_MS], keyed by device id. */
    private val _visiblePeers = MutableStateFlow<Map<String, VisiblePeer>>(emptyMap())

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning

    val wifiDirectState: StateFlow<WifiDirectState> get() = wifiDirectDiscovery.state

    private var collectJobs = mutableListOf<Job>()

    val devices: StateFlow<List<Device>> = combine(
        trustedDao.observeAll(),
        _visiblePeers,
        connections.connectedDevices,
        pairing.incomingRequests,
        pairing.outgoingRequests,
    ) { trusted, visible, connected, incoming, outgoing ->
        mergeDevices(trusted, visible, connected, incoming.keys, outgoing)
    }.stateIn(scope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun start() {
        if (collectJobs.isNotEmpty()) return
        connections.start()
        pairing.start()
        udpDiscovery.start()
        wifiDirectDiscovery.start()

        collectJobs += scope.launch {
            udpDiscovery.peers.collect { onPeerSeen(it, DiscoveryChannel.LAN) }
        }
        collectJobs += scope.launch {
            wifiDirectDiscovery.peers.collect { onPeerSeen(it, DiscoveryChannel.WIFI_DIRECT) }
        }
        collectJobs += scope.launch { expirePeersLoop() }
        collectJobs += scope.launch { reconnectLoop() }
        _isScanning.value = true
    }

    fun stop() {
        collectJobs.forEach(Job::cancel)
        collectJobs.clear()
        udpDiscovery.stop()
        wifiDirectDiscovery.stop()
        pairing.stop()
        connections.stop()
        _visiblePeers.value = emptyMap()
        _isScanning.value = false
    }

    fun refresh() {
        udpDiscovery.announceNow()
    }

    private suspend fun onPeerSeen(peer: DiscoveredPeer, channel: DiscoveryChannel) {
        _visiblePeers.update { current ->
            current + (peer.identity.deviceId to VisiblePeer(peer, channel))
        }

        // Trusted and reachable: bring the link up without waiting for the user to tap anything.
        // Desktops are excluded — see [isDialable].
        if (peer.address.isNotEmpty() &&
            peer.identity.tcpPort != 0 &&
            peer.identity.deviceType != DeviceType.DESKTOP &&
            !connections.isConnected(peer.identity.deviceId) &&
            trustedDao.find(peer.identity.deviceId) != null
        ) {
            dial(peer.address, peer.identity.tcpPort)
        }
    }

    /** Opens a connection to a device the user tapped, whether or not it is paired yet. */
    suspend fun connectTo(device: Device): Result<Unit> {
        if (device.type == DeviceType.DESKTOP) {
            // Belt and braces: the UI no longer offers this, but pair() routes through here too.
            return Result.failure(
                IllegalStateException(
                    "${device.name} is a Mac. Macs connect to the phone, not the other way " +
                        "round — open Sidekick on the Mac instead.",
                ),
            )
        }
        val address = device.address
        val port = device.port
        if (address.isNullOrEmpty() || port == 0) {
            return Result.failure(
                IllegalStateException(
                    "No address for ${device.name}. For a Wi-Fi Direct peer, join the group first.",
                ),
            )
        }
        return dial(address, port).map { }
    }

    private suspend fun dial(address: String, port: Int) = dialMutex.withLock {
        connections.connect(address, port)
            .onFailure { Log.d(TAG, "Dial $address:$port failed: ${it.message}") }
    }

    /**
     * True for peers this phone is allowed to dial.
     *
     * A Mac is never one of them. On the v2 link the phone is the server and the Mac connects out
     * (CLAUDE.md, locked decision 2), and QR pairing stores the Mac in this same trust table with
     * `lastPort` set to the v2 *control* port. Dialling such a row opens a plaintext v1 identity
     * handshake against a port the Mac does not listen on — it can only ever fail, and before this
     * guard existed it failed once every [RECONNECT_INTERVAL_MS] for the life of the process,
     * waking the radio each time.
     */
    private fun TrustedDeviceEntity.isDialable(): Boolean = type != DeviceType.DESKTOP

    /** Re-dials paired devices whose last known address is still valid after a drop. */
    private suspend fun reconnectLoop() {
        while (scope.isActive) {
            delay(RECONNECT_INTERVAL_MS)
            val visible = _visiblePeers.value
            trustedDao.getAll().forEach { trusted ->
                if (!trusted.isDialable()) return@forEach
                if (connections.isConnected(trusted.deviceId)) return@forEach

                val peer = visible[trusted.deviceId]?.peer
                val address = peer?.address?.takeIf { it.isNotEmpty() } ?: trusted.lastAddress
                val port = peer?.identity?.tcpPort?.takeIf { it != 0 } ?: trusted.lastPort
                if (!address.isNullOrEmpty() && port != 0) dial(address, port)
            }
        }
    }

    private suspend fun expirePeersLoop() {
        while (scope.isActive) {
            delay(PEER_SWEEP_INTERVAL_MS)
            val cutoff = System.currentTimeMillis() - PEER_TTL_MS
            _visiblePeers.update { current ->
                current.filterValues { it.peer.seenAtMillis >= cutoff }
            }
        }
    }

    private fun mergeDevices(
        trusted: List<TrustedDeviceEntity>,
        visible: Map<String, VisiblePeer>,
        connected: Set<String>,
        incomingRequests: Set<String>,
        outgoingRequests: Set<String>,
    ): List<Device> {
        val trustedById = trusted.associateBy { it.deviceId }
        val ids = trustedById.keys + visible.keys

        return ids.map { id ->
            val entity = trustedById[id]
            val seen = visible[id]
            val pairState = when {
                entity != null -> PairState.PAIRED
                id in incomingRequests -> PairState.REQUESTED_BY_PEER
                id in outgoingRequests -> PairState.REQUESTED_BY_US
                else -> PairState.NOT_PAIRED
            }

            Device(
                id = id,
                name = seen?.peer?.identity?.deviceName ?: entity?.name ?: id.take(8),
                type = seen?.peer?.identity?.deviceType
                    ?: entity?.type
                    ?: com.chetan.connectsuite.core.model.DeviceType.UNKNOWN,
                pairState = pairState,
                channel = seen?.channel ?: DiscoveryChannel.REMEMBERED,
                address = seen?.peer?.address?.takeIf { it.isNotEmpty() } ?: entity?.lastAddress,
                port = seen?.peer?.identity?.tcpPort?.takeIf { it != 0 } ?: entity?.lastPort ?: 0,
                certificateFingerprint = entity?.fingerprint,
                isConnected = id in connected,
                lastSeenAtMillis = seen?.peer?.seenAtMillis ?: entity?.lastSeenAtMillis ?: 0L,
                protocolVersion = seen?.peer?.identity?.protocolVersion ?: 0,
                wifiDirectAddress = seen?.peer?.wifiDirectAddress,
            )
        }.sortedWith(
            compareByDescending<Device> { it.isConnected }
                .thenByDescending { it.pairState == PairState.PAIRED }
                .thenByDescending { it.isReachable }
                .thenBy { it.name.lowercase() },
        )
    }

    private data class VisiblePeer(val peer: DiscoveredPeer, val channel: DiscoveryChannel)

    companion object {
        private const val TAG = "DeviceRepository"
        private const val PEER_TTL_MS = 30_000L
        private const val PEER_SWEEP_INTERVAL_MS = 5_000L
        private const val RECONNECT_INTERVAL_MS = 15_000L

        @Volatile
        private var instance: DeviceRepository? = null

        fun get(context: Context): DeviceRepository =
            instance ?: synchronized(this) {
                instance ?: DeviceRepository(context.applicationContext).also { instance = it }
            }
    }
}
