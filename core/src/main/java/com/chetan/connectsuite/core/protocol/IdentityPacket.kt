package com.chetan.connectsuite.core.protocol

import com.chetan.connectsuite.core.model.DeviceType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The first thing either side sends, both as a UDP broadcast (for discovery) and as the opening
 * message of a TCP connection (before the TLS upgrade), so a peer knows who it is talking to
 * before any certificate is pinned.
 */
@Serializable
data class IdentityPacket(
    val deviceId: String,
    val deviceName: String,
    val deviceType: DeviceType,
    val protocolVersion: Int = PROTOCOL_VERSION,
    /** TCP port this device is accepting connections on. */
    val tcpPort: Int,
    /** Feature flags, so a peer does not offer SMS mirroring to a desktop that cannot use it. */
    val capabilities: List<String> = emptyList(),
) {
    fun isCompatibleWith(other: IdentityPacket): Boolean =
        protocolVersion == other.protocolVersion

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        const val CAP_FILE_TRANSFER = "file_transfer"
        const val CAP_NOTIFICATIONS = "notifications"
        const val CAP_SMS = "sms"
        const val CAP_CALL_LOG = "call_log"

        fun encode(packet: IdentityPacket): String = json.encodeToString(serializer(), packet)

        fun decodeOrNull(text: String): IdentityPacket? =
            runCatching { json.decodeFromString(serializer(), text) }.getOrNull()
    }
}
