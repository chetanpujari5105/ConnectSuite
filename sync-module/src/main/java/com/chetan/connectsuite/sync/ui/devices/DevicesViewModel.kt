package com.chetan.connectsuite.sync.ui.devices

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.discovery.WifiDirectState
import com.chetan.connectsuite.core.model.Device
import com.chetan.connectsuite.core.pairing.IncomingPairRequest
import com.chetan.connectsuite.core.pairing.PairingEvent
import com.chetan.connectsuite.core.pairing.PairingManager
import com.chetan.connectsuite.core.repository.DeviceRepository
import com.chetan.connectsuite.core.service.ConnectionService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DevicesUiState(
    val devices: List<Device> = emptyList(),
    val pendingRequest: IncomingPairRequest? = null,
    val outgoingRequests: Set<String> = emptySet(),
    val wifiDirectState: WifiDirectState = WifiDirectState.IDLE,
    val isScanning: Boolean = false,
    val thisDeviceName: String = "",
    val thisDeviceFingerprint: String = "",
)

class DevicesViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = DeviceRepository.get(application)
    private val pairing = PairingManager.get(application)
    private val identity = DeviceIdentity.get(application)

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    val uiState: StateFlow<DevicesUiState> = combine(
        repository.devices,
        pairing.incomingRequests,
        pairing.outgoingRequests,
        repository.wifiDirectState,
        repository.isScanning,
    ) { devices, incoming, outgoing, wifiDirect, scanning ->
        DevicesUiState(
            devices = devices,
            // One dialog at a time; the rest stay queued in the manager.
            pendingRequest = incoming.values.minByOrNull { it.requestedAtMillis },
            outgoingRequests = outgoing,
            wifiDirectState = wifiDirect,
            isScanning = scanning,
            thisDeviceName = identity.deviceName,
            thisDeviceFingerprint = DeviceIdentity.shortFingerprint(identity.fingerprint),
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        DevicesUiState(
            thisDeviceName = identity.deviceName,
            thisDeviceFingerprint = DeviceIdentity.shortFingerprint(identity.fingerprint),
        ),
    )

    init {
        ConnectionService.start(application)
        viewModelScope.launch {
            pairing.events.collect { event ->
                _message.value = when (event) {
                    is PairingEvent.Accepted -> "Paired with ${event.deviceName}"
                    is PairingEvent.Rejected -> "${event.deviceName} declined pairing"
                    is PairingEvent.TimedOut -> "Pairing request timed out"
                    is PairingEvent.Forgotten -> "Device forgotten"
                    is PairingEvent.RequestReceived -> null
                }
            }
        }
    }

    fun refresh() = repository.refresh()

    fun consumeMessage() { _message.value = null }

    fun connect(device: Device) {
        viewModelScope.launch {
            repository.connectTo(device)
                .onFailure { _message.value = it.message ?: "Could not connect to ${device.name}" }
        }
    }

    fun pair(device: Device) {
        viewModelScope.launch {
            // A pairing request needs a live connection to travel over.
            if (!device.isConnected) {
                repository.connectTo(device).onFailure {
                    _message.value = it.message ?: "Could not reach ${device.name}"
                    return@launch
                }
            }
            if (!pairing.requestPairing(device.id)) {
                _message.value = "Could not send the pairing request to ${device.name}"
            } else {
                _message.value = "Pairing request sent to ${device.name}"
            }
        }
    }

    fun acceptPairing(deviceId: String) {
        viewModelScope.launch { pairing.acceptPairing(deviceId) }
    }

    fun rejectPairing(deviceId: String) {
        viewModelScope.launch { pairing.rejectPairing(deviceId) }
    }

    fun forget(device: Device) {
        viewModelScope.launch { pairing.forget(device.id) }
    }

    /** Invites a Wi-Fi Direct peer to form a group; it gets a routable address once it joins. */
    fun joinWifiDirectGroup(device: Device) {
        val p2pAddress = device.wifiDirectAddress
        if (p2pAddress == null) {
            _message.value = "${device.name} is no longer visible over Wi-Fi Direct"
            return
        }
        repository.wifiDirectDiscovery.connectTo(p2pAddress) { started ->
            _message.value = if (started) {
                "Invitation sent — accept it on ${device.name}"
            } else {
                "Wi-Fi Direct could not start a group with ${device.name}"
            }
        }
    }
}
