package com.chetan.connectsuite.core.pairing

import android.content.Context
import android.util.Log
import com.chetan.connectsuite.core.crypto.CertificateUtils
import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.protocol.NetworkPacket
import com.chetan.connectsuite.core.protocol.PacketType
import com.chetan.connectsuite.core.transport.ConnectionManager
import com.chetan.connectsuite.core.transport.DeviceConnection
import com.chetan.connectsuite.core.transport.RoutedPacket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.ConcurrentHashMap

/** A pairing request from a peer, waiting on the user's answer. */
data class IncomingPairRequest(
    val deviceId: String,
    val deviceName: String,
    val fingerprint: String,
    val certificateBase64: String,
    val requestedAtMillis: Long = System.currentTimeMillis(),
) {
    /** The short form both users compare out loud before accepting. */
    val displayFingerprint: String get() = DeviceIdentity.shortFingerprint(fingerprint)
}

sealed interface PairingEvent {
    data class RequestReceived(val request: IncomingPairRequest) : PairingEvent
    data class Accepted(val deviceId: String, val deviceName: String) : PairingEvent
    data class Rejected(val deviceId: String, val deviceName: String) : PairingEvent
    data class TimedOut(val deviceId: String) : PairingEvent
    data class Forgotten(val deviceId: String) : PairingEvent
}

/**
 * Trust-on-first-use pairing.
 *
 * Nothing here trusts a device implicitly. A pairing only completes when a human confirms it on
 * the receiving end, and what gets stored is the exact certificate seen on that confirmed
 * connection — so a later connection presenting a different key is rejected by
 * [com.chetan.connectsuite.core.crypto.PinnedTrustManager] even if it claims the same device id.
 */
class PairingManager private constructor(
    private val appContext: Context,
) {
    private val identity = DeviceIdentity.get(appContext)
    private val connections = ConnectionManager.get(appContext)
    private val trustedDevices = ConnectSuiteDatabase.get(appContext).trustedDeviceDao()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val timeoutJobs = ConcurrentHashMap<String, Job>()

    private val _incomingRequests = MutableStateFlow<Map<String, IncomingPairRequest>>(emptyMap())
    val incomingRequests: StateFlow<Map<String, IncomingPairRequest>> =
        _incomingRequests.asStateFlow()

    private val _outgoingRequests = MutableStateFlow<Set<String>>(emptySet())
    val outgoingRequests: StateFlow<Set<String>> = _outgoingRequests.asStateFlow()

    private val _events = MutableSharedFlow<PairingEvent>(replay = 0, extraBufferCapacity = 16)
    val events: SharedFlow<PairingEvent> = _events.asSharedFlow()

    private var collectJob: Job? = null

    fun start() {
        if (collectJob?.isActive == true) return
        collectJob = scope.launch {
            connections.packets.collect { routed ->
                if (routed.incoming.packet.type == PacketType.PAIR) handlePairPacket(routed)
            }
        }
    }

    fun stop() {
        collectJob?.cancel()
        collectJob = null
        timeoutJobs.values.forEach(Job::cancel)
        timeoutJobs.clear()
    }

    /** Sends a pairing request to an already-connected peer. */
    suspend fun requestPairing(deviceId: String): Boolean {
        val connection = connections.connectionTo(deviceId) ?: return false
        val sent = connection.send(pairPacket(request = true))
        if (sent) {
            _outgoingRequests.update { it + deviceId }
            scheduleTimeout(deviceId)
        }
        return sent
    }

    /** The user tapped Accept on an incoming request. */
    suspend fun acceptPairing(deviceId: String): Boolean {
        val request = _incomingRequests.value[deviceId] ?: return false
        val connection = connections.connectionTo(deviceId)

        // Pin the certificate from the live connection when we have it — that is the key the
        // peer actually authenticated with, not merely one it claimed in the request body.
        val certificateBase64 = connection
            ?.let { CertificateUtils.encode(it.peerCertificate) }
            ?: request.certificateBase64
        val fingerprint = connection?.peerFingerprint ?: request.fingerprint

        if (!fingerprint.equals(request.fingerprint, ignoreCase = true)) {
            Log.w(TAG, "Fingerprint changed between request and accept — refusing")
            rejectPairing(deviceId)
            return false
        }

        trustedDevices.upsert(
            TrustedDeviceEntity(
                deviceId = deviceId,
                name = request.deviceName,
                type = connection?.peerIdentity?.deviceType ?: DeviceType.UNKNOWN,
                certificate = certificateBase64,
                fingerprint = fingerprint,
                pairedAtMillis = System.currentTimeMillis(),
                lastSeenAtMillis = System.currentTimeMillis(),
                lastAddress = connection?.remoteAddress,
                lastPort = connection?.peerIdentity?.tcpPort ?: 0,
            ),
        )

        clearPending(deviceId)
        connection?.send(pairPacket(request = false, accepted = true))
        _events.emit(PairingEvent.Accepted(deviceId, request.deviceName))
        Log.i(TAG, "Paired with ${request.deviceName}")
        return true
    }

    /** The user tapped Reject, or the request timed out. */
    suspend fun rejectPairing(deviceId: String): Boolean {
        val request = _incomingRequests.value[deviceId]
        clearPending(deviceId)
        connections.connectionTo(deviceId)?.send(pairPacket(request = false, accepted = false))
        _events.emit(PairingEvent.Rejected(deviceId, request?.deviceName ?: deviceId))
        return true
    }

    /** Drops the stored certificate; the peer becomes an ordinary untrusted device again. */
    suspend fun forget(deviceId: String) {
        trustedDevices.forget(deviceId)
        clearPending(deviceId)
        connections.connectionTo(deviceId)?.send(pairPacket(request = false, accepted = false))
        connections.disconnect(deviceId)
        _events.emit(PairingEvent.Forgotten(deviceId))
    }

    suspend fun isPaired(deviceId: String): Boolean = trustedDevices.find(deviceId) != null

    private suspend fun handlePairPacket(routed: RoutedPacket) {
        val connection = routed.connection
        val packet = routed.incoming.packet
        val deviceId = connection.deviceId
        val isRequest = packet.bool("request") ?: false

        if (isRequest) {
            onPairRequest(connection, packet)
            return
        }

        // A response to something we asked for.
        val accepted = packet.bool("accepted") ?: false
        if (deviceId !in _outgoingRequests.value) {
            // Unsolicited response, or one that arrived after our timeout. Also covers the case
            // where the peer un-paired us: drop our stored trust so the two ends stay in sync.
            if (!accepted && trustedDevices.find(deviceId) != null) {
                trustedDevices.forget(deviceId)
                _events.emit(PairingEvent.Forgotten(deviceId))
            }
            return
        }

        _outgoingRequests.update { it - deviceId }
        timeoutJobs.remove(deviceId)?.cancel()

        if (!accepted) {
            _events.emit(PairingEvent.Rejected(deviceId, connection.peerIdentity.deviceName))
            return
        }

        trustedDevices.upsert(
            TrustedDeviceEntity(
                deviceId = deviceId,
                name = connection.peerIdentity.deviceName,
                type = connection.peerIdentity.deviceType,
                certificate = CertificateUtils.encode(connection.peerCertificate),
                fingerprint = connection.peerFingerprint,
                pairedAtMillis = System.currentTimeMillis(),
                lastSeenAtMillis = System.currentTimeMillis(),
                lastAddress = connection.remoteAddress,
                lastPort = connection.peerIdentity.tcpPort,
            ),
        )
        _events.emit(PairingEvent.Accepted(deviceId, connection.peerIdentity.deviceName))
        Log.i(TAG, "Pairing accepted by ${connection.peerIdentity.deviceName}")
    }

    private suspend fun onPairRequest(connection: DeviceConnection, packet: NetworkPacket) {
        val deviceId = connection.deviceId

        // Already trusted: re-confirm rather than bother the user again.
        if (trustedDevices.find(deviceId) != null) {
            connection.send(pairPacket(request = false, accepted = true))
            return
        }

        // If we had a request out to the same device, the two crossed on the wire. Auto-accept
        // so both users don't have to tap twice.
        if (deviceId in _outgoingRequests.value) {
            _outgoingRequests.update { it - deviceId }
            timeoutJobs.remove(deviceId)?.cancel()
            trustedDevices.upsert(
                TrustedDeviceEntity(
                    deviceId = deviceId,
                    name = connection.peerIdentity.deviceName,
                    type = connection.peerIdentity.deviceType,
                    certificate = CertificateUtils.encode(connection.peerCertificate),
                    fingerprint = connection.peerFingerprint,
                    pairedAtMillis = System.currentTimeMillis(),
                    lastSeenAtMillis = System.currentTimeMillis(),
                    lastAddress = connection.remoteAddress,
                    lastPort = connection.peerIdentity.tcpPort,
                ),
            )
            connection.send(pairPacket(request = false, accepted = true))
            _events.emit(PairingEvent.Accepted(deviceId, connection.peerIdentity.deviceName))
            return
        }

        val request = IncomingPairRequest(
            deviceId = deviceId,
            deviceName = packet.string("deviceName") ?: connection.peerIdentity.deviceName,
            fingerprint = connection.peerFingerprint,
            certificateBase64 = CertificateUtils.encode(connection.peerCertificate),
        )
        _incomingRequests.update { it + (deviceId to request) }
        scheduleTimeout(deviceId)
        _events.emit(PairingEvent.RequestReceived(request))
    }

    private fun scheduleTimeout(deviceId: String) {
        timeoutJobs.remove(deviceId)?.cancel()
        timeoutJobs[deviceId] = scope.launch {
            delay(REQUEST_TIMEOUT_MS)
            if (_incomingRequests.value.containsKey(deviceId) ||
                deviceId in _outgoingRequests.value
            ) {
                clearPending(deviceId)
                _events.emit(PairingEvent.TimedOut(deviceId))
            }
        }
    }

    private fun clearPending(deviceId: String) {
        _incomingRequests.update { it - deviceId }
        _outgoingRequests.update { it - deviceId }
        timeoutJobs.remove(deviceId)?.cancel()
    }

    private fun pairPacket(request: Boolean, accepted: Boolean = false) =
        NetworkPacket.of(PacketType.PAIR) {
            put("request", JsonPrimitive(request.toString()))
            put("accepted", JsonPrimitive(accepted.toString()))
            put("deviceName", JsonPrimitive(identity.deviceName))
            put("certificate", JsonPrimitive(identity.certificateBase64))
        }

    companion object {
        private const val TAG = "PairingManager"

        /** How long a pairing dialog stays actionable before it is dropped. */
        const val REQUEST_TIMEOUT_MS = 45_000L

        @Volatile
        private var instance: PairingManager? = null

        fun get(context: Context): PairingManager =
            instance ?: synchronized(this) {
                instance ?: PairingManager(context.applicationContext).also { instance = it }
            }
    }
}
