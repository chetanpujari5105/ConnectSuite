package com.chetan.connectsuite.core.discovery

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import android.os.Looper
import android.util.Log
import com.chetan.connectsuite.core.protocol.IdentityPacket
import com.chetan.connectsuite.core.protocol.PROTOCOL_VERSION
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** What the Wi-Fi Direct stack is currently doing, surfaced so the UI can explain itself. */
enum class WifiDirectState { UNSUPPORTED, DISABLED, IDLE, DISCOVERING, GROUP_FORMED }

/**
 * Peer discovery over Wi-Fi Direct using DNS-SD service records.
 *
 * Advertising a named service (rather than using plain peer discovery) is what keeps the device
 * list to ConnectSuite installs instead of every Wi-Fi Direct capable TV and printer in range.
 * The TXT record carries the same fields as the UDP identity packet, so a peer found here and a
 * peer found on the LAN are the same object by the time the UI sees them.
 */
class WifiDirectDiscovery(
    private val appContext: Context,
    private val localIdentity: () -> IdentityPacket,
) {
    private val manager: WifiP2pManager? =
        appContext.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
    private var channel: WifiP2pManager.Channel? = null
    private var serviceRequest: WifiP2pDnsSdServiceRequest? = null
    private var receiver: BroadcastReceiver? = null
    private var advertisedInfo: WifiP2pDnsSdServiceInfo? = null

    private val _state = MutableStateFlow(
        if (manager == null) WifiDirectState.UNSUPPORTED else WifiDirectState.IDLE,
    )
    val state: StateFlow<WifiDirectState> = _state.asStateFlow()

    private val _peers = MutableSharedFlow<DiscoveredPeer>(
        replay = 0,
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val peers: SharedFlow<DiscoveredPeer> = _peers.asSharedFlow()

    private val _groupInfo = MutableStateFlow<WifiP2pInfo?>(null)
    val groupInfo: StateFlow<WifiP2pInfo?> = _groupInfo.asStateFlow()

    /** Maps a Wi-Fi P2P MAC to the ConnectSuite identity found in its TXT record. */
    private val identityByAddress = mutableMapOf<String, IdentityPacket>()

    val isSupported: Boolean get() = manager != null

    @SuppressLint("MissingPermission") // Callers gate on PermissionGroup.NEARBY_DEVICES.
    fun start() {
        val manager = manager ?: return
        if (channel != null) return

        channel = manager.initialize(appContext, Looper.getMainLooper()) {
            Log.w(TAG, "Wi-Fi P2P channel disconnected")
            channel = null
            _state.value = WifiDirectState.IDLE
        }
        registerReceiver()
        advertiseService()
        discoverServices()
    }

    fun stop() {
        val manager = manager ?: return
        val channel = channel ?: return
        runCatching {
            advertisedInfo?.let { manager.removeLocalService(channel, it, null) }
            serviceRequest?.let { manager.removeServiceRequest(channel, it, null) }
            manager.stopPeerDiscovery(channel, null)
        }
        receiver?.let { runCatching { appContext.unregisterReceiver(it) } }
        receiver = null
        serviceRequest = null
        advertisedInfo = null
        this.channel = null
        _state.value = WifiDirectState.IDLE
    }

    @SuppressLint("MissingPermission")
    private fun advertiseService() {
        val manager = manager ?: return
        val channel = channel ?: return
        val identity = localIdentity()

        val record = mapOf(
            TXT_DEVICE_ID to identity.deviceId,
            TXT_DEVICE_NAME to identity.deviceName,
            TXT_DEVICE_TYPE to identity.deviceType.name,
            TXT_PORT to identity.tcpPort.toString(),
            TXT_PROTOCOL to PROTOCOL_VERSION.toString(),
        )

        val info = WifiP2pDnsSdServiceInfo.newInstance(SERVICE_INSTANCE, SERVICE_TYPE, record)
        advertisedInfo = info
        manager.addLocalService(channel, info, actionListener("addLocalService"))
    }

    @SuppressLint("MissingPermission")
    private fun discoverServices() {
        val manager = manager ?: return
        val channel = channel ?: return

        manager.setDnsSdResponseListeners(
            channel,
            { instanceName, registrationType, device ->
                Log.d(TAG, "Service found: $instanceName / $registrationType from ${device.deviceAddress}")
            },
            { _, record, device -> onTxtRecord(record, device) },
        )

        val request = WifiP2pDnsSdServiceRequest.newInstance(SERVICE_INSTANCE, SERVICE_TYPE)
        serviceRequest = request
        manager.addServiceRequest(
            channel,
            request,
            actionListener("addServiceRequest") {
                manager.discoverServices(channel, actionListener("discoverServices") {
                    _state.value = WifiDirectState.DISCOVERING
                })
            },
        )
    }

    private fun onTxtRecord(record: Map<String, String>, device: WifiP2pDevice) {
        val deviceId = record[TXT_DEVICE_ID] ?: return
        if (deviceId == localIdentity().deviceId) return

        val identity = IdentityPacket(
            deviceId = deviceId,
            deviceName = record[TXT_DEVICE_NAME] ?: device.deviceName ?: "Unknown device",
            deviceType = runCatching {
                com.chetan.connectsuite.core.model.DeviceType.valueOf(
                    record[TXT_DEVICE_TYPE] ?: "UNKNOWN",
                )
            }.getOrDefault(com.chetan.connectsuite.core.model.DeviceType.UNKNOWN),
            protocolVersion = record[TXT_PROTOCOL]?.toIntOrNull() ?: 0,
            tcpPort = record[TXT_PORT]?.toIntOrNull() ?: 0,
        )
        identityByAddress[device.deviceAddress] = identity

        // No IP address exists until a P2P group is formed, so the peer is reported without one;
        // connecting to it goes through [connectTo] first.
        _peers.tryEmit(
            DiscoveredPeer(
                identity = identity,
                address = "",
                wifiDirectAddress = device.deviceAddress,
            ),
        )
    }

    /**
     * Forms a Wi-Fi Direct group with [deviceAddress]. The socket connection is made afterwards,
     * once [groupInfo] reports the group owner's address.
     */
    @SuppressLint("MissingPermission")
    fun connectTo(deviceAddress: String, onResult: (Boolean) -> Unit = {}) {
        val manager = manager ?: return onResult(false)
        val channel = channel ?: return onResult(false)

        val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
            // Bias towards this device becoming the group owner so the peer dials a known address.
            groupOwnerIntent = 0
        }
        manager.connect(
            channel,
            config,
            object : WifiP2pManager.ActionListener {
                override fun onSuccess() = onResult(true)
                override fun onFailure(reason: Int) {
                    Log.w(TAG, "connect() failed: ${reasonName(reason)}")
                    onResult(false)
                }
            },
        )
    }

    @SuppressLint("MissingPermission")
    fun removeGroup() {
        val manager = manager ?: return
        val channel = channel ?: return
        manager.removeGroup(channel, actionListener("removeGroup"))
    }

    fun identityFor(deviceAddress: String): IdentityPacket? = identityByAddress[deviceAddress]

    private fun registerReceiver() {
        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
        }
        val receiver = object : BroadcastReceiver() {
            @SuppressLint("MissingPermission")
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                        val enabled = intent.getIntExtra(
                            WifiP2pManager.EXTRA_WIFI_STATE,
                            WifiP2pManager.WIFI_P2P_STATE_DISABLED,
                        ) == WifiP2pManager.WIFI_P2P_STATE_ENABLED
                        _state.update {
                            when {
                                !enabled -> WifiDirectState.DISABLED
                                it == WifiDirectState.DISABLED -> WifiDirectState.IDLE
                                else -> it
                            }
                        }
                    }

                    WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                        val channel = this@WifiDirectDiscovery.channel ?: return
                        manager?.requestConnectionInfo(channel) { info ->
                            _groupInfo.value = info
                            _state.value = if (info?.groupFormed == true) {
                                WifiDirectState.GROUP_FORMED
                            } else {
                                WifiDirectState.DISCOVERING
                            }
                        }
                    }
                }
            }
        }
        this.receiver = receiver
        androidx.core.content.ContextCompat.registerReceiver(
            appContext,
            receiver,
            filter,
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    private fun actionListener(what: String, onSuccess: () -> Unit = {}) =
        object : WifiP2pManager.ActionListener {
            override fun onSuccess() = onSuccess()
            override fun onFailure(reason: Int) {
                Log.w(TAG, "$what failed: ${reasonName(reason)}")
            }
        }

    private fun reasonName(reason: Int) = when (reason) {
        WifiP2pManager.P2P_UNSUPPORTED -> "P2P unsupported on this device"
        WifiP2pManager.BUSY -> "framework busy"
        WifiP2pManager.NO_SERVICE_REQUESTS -> "no service requests"
        else -> "error $reason"
    }

    companion object {
        private const val TAG = "WifiDirectDiscovery"

        /** DNS-SD service type; only instances of this show up in our peer list. */
        const val SERVICE_TYPE = "_connectsuite._tcp"
        const val SERVICE_INSTANCE = "connectsuite"

        private const val TXT_DEVICE_ID = "id"
        private const val TXT_DEVICE_NAME = "name"
        private const val TXT_DEVICE_TYPE = "type"
        private const val TXT_PORT = "port"
        private const val TXT_PROTOCOL = "proto"
    }
}
