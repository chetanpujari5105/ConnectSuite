package com.chetan.connectsuite.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class DeviceType {
    @SerialName("phone") PHONE,
    @SerialName("tablet") TABLET,
    @SerialName("desktop") DESKTOP,
    @SerialName("unknown") UNKNOWN,
}

/** How a device was found, which determines how we open a socket to it. */
enum class DiscoveryChannel {
    /** Found via UDP identity broadcast on the local network (both peers on the same Wi-Fi). */
    LAN,

    /** Found via Wi-Fi P2P DNS-SD service discovery (no shared access point needed). */
    WIFI_DIRECT,

    /** Loaded from the trust store; not currently visible. */
    REMEMBERED,
}

enum class PairState {
    /** Never paired, or the pairing was forgotten. */
    NOT_PAIRED,

    /** We sent a pair request and are waiting for the other side to accept. */
    REQUESTED_BY_US,

    /** The other side asked to pair and the user has not answered yet. */
    REQUESTED_BY_PEER,

    /** Certificate stored on both ends; connections auto-verify from here on. */
    PAIRED,
}

/**
 * A device as currently known to the app — the merge of what discovery sees on the network and
 * what the trust store remembers.
 */
data class Device(
    val id: String,
    val name: String,
    val type: DeviceType,
    val pairState: PairState,
    val channel: DiscoveryChannel,
    /** Last known address; null for a remembered device that is not visible right now. */
    val address: String? = null,
    val port: Int = 0,
    /** SHA-256 of the peer certificate, formatted for display. Null until we've seen a cert. */
    val certificateFingerprint: String? = null,
    val isConnected: Boolean = false,
    val lastSeenAtMillis: Long = 0L,
    val protocolVersion: Int = 0,
    /** Wi-Fi P2P MAC, set only while this device is visible over Wi-Fi Direct. */
    val wifiDirectAddress: String? = null,
) {
    val isReachable: Boolean get() = address != null && port != 0
}
