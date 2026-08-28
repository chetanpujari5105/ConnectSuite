package com.chetan.connectsuite.core.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** Protocol revision. Bumped on any wire-incompatible change; peers refuse mismatched majors. */
const val PROTOCOL_VERSION: Int = 1

object PacketType {
    const val IDENTITY = "connectsuite.identity"
    const val PAIR = "connectsuite.pair"
    const val PING = "connectsuite.ping"
    const val PONG = "connectsuite.pong"

    const val NOTIFICATION_POSTED = "connectsuite.notification.posted"
    const val NOTIFICATION_REMOVED = "connectsuite.notification.removed"
    const val NOTIFICATION_ACTION = "connectsuite.notification.action"

    const val SMS_RECEIVED = "connectsuite.sms.received"
    const val CALL_LOG = "connectsuite.calllog"

    const val TRANSFER_OFFER = "connectsuite.transfer.offer"
    const val TRANSFER_RESPONSE = "connectsuite.transfer.response"
    const val TRANSFER_CHUNK = "connectsuite.transfer.chunk"
    const val TRANSFER_FILE_DONE = "connectsuite.transfer.filedone"
    const val TRANSFER_JOB_DONE = "connectsuite.transfer.jobdone"
    const val TRANSFER_CANCEL = "connectsuite.transfer.cancel"
    const val TRANSFER_ERROR = "connectsuite.transfer.error"
}

/**
 * One protocol message. Encoded as a single UTF-8 JSON line terminated by `\n`; when
 * [payloadSize] is greater than zero exactly that many raw bytes follow the newline on the same
 * stream, which is how file chunks avoid a base64 round trip.
 */
@Serializable
data class NetworkPacket(
    val id: Long = System.currentTimeMillis(),
    val type: String,
    val body: JsonObject = JsonObject(emptyMap()),
    @SerialName("payloadSize") val payloadSize: Int = 0,
) {
    fun string(key: String): String? = body[key]?.jsonPrimitive?.contentOrNull()
    fun long(key: String): Long? = body[key]?.jsonPrimitive?.longOrNull
    fun int(key: String): Int? = long(key)?.toInt()
    fun bool(key: String): Boolean? = body[key]?.jsonPrimitive?.contentOrNull()?.toBooleanStrictOrNull()

    private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? =
        if (this is kotlinx.serialization.json.JsonNull) null else content

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            isLenient = true
        }

        fun of(
            type: String,
            payloadSize: Int = 0,
            builder: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {},
        ): NetworkPacket = NetworkPacket(
            type = type,
            body = buildJsonObject(builder),
            payloadSize = payloadSize,
        )

        fun encode(packet: NetworkPacket): String = json.encodeToString(packet)

        fun decode(line: String): NetworkPacket = json.decodeFromString(line)

        fun bodyOf(vararg pairs: Pair<String, JsonElement>): JsonObject = JsonObject(pairs.toMap())
    }
}
