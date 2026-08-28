package com.chetan.connectsuite.core.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement

/** One file inside a transfer job. */
@Serializable
data class TransferFileMeta(
    val transferId: String,
    val name: String,
    /** Path relative to the job root, so folder structure survives the trip. */
    val relativePath: String,
    val size: Long,
    val mimeType: String,
    /** SHA-256 of the whole file, hex. Empty when the sender chose not to pre-hash. */
    val sha256: String = "",
)

/** Sent first; the receiver decides whether to accept the whole job. */
@Serializable
data class TransferOffer(
    val jobId: String,
    val files: List<TransferFileMeta>,
    val totalBytes: Long,
    val senderName: String,
)

@Serializable
data class TransferResponse(
    val jobId: String,
    val accepted: Boolean,
    /**
     * Byte offset to start each file from. A non-zero entry means the receiver still holds a
     * partial file from an interrupted run and wants the remainder, not the whole thing.
     */
    val resumeOffsets: Map<String, Long> = emptyMap(),
    val reason: String = "",
)

/** Chunk size bounds. The sender scales within this range based on observed throughput. */
object ChunkSizes {
    const val MIN = 64 * 1024
    const val MAX = 256 * 1024
    const val DEFAULT = 128 * 1024
}

object TransferProtocol {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun offerPacket(offer: TransferOffer): NetworkPacket = NetworkPacket(
        type = PacketType.TRANSFER_OFFER,
        body = json.encodeToJsonElement(offer) as JsonObject,
    )

    fun responsePacket(response: TransferResponse): NetworkPacket = NetworkPacket(
        type = PacketType.TRANSFER_RESPONSE,
        body = json.encodeToJsonElement(response) as JsonObject,
    )

    fun parseOffer(packet: NetworkPacket): TransferOffer? =
        runCatching { json.decodeFromJsonElement(TransferOffer.serializer(), packet.body) }
            .getOrNull()

    fun parseResponse(packet: NetworkPacket): TransferResponse? =
        runCatching { json.decodeFromJsonElement(TransferResponse.serializer(), packet.body) }
            .getOrNull()
}
