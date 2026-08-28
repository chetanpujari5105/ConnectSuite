package com.chetan.connectsuite.core.link

import android.content.Context
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.protocol.Link
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What the Mac draws into its pairing QR code. See docs/protocol.md.
 *
 * The QR is the whole trust decision: scanning it is the user saying "this Mac is mine", and the
 * fingerprint inside is what the TLS layer pins from then on. Nothing else in the system can add
 * a trusted peer.
 */
@Serializable
data class PairingQrPayload(
    val host: String,
    val fp: String,
    val token: String,
    val name: String,
) {
    /**
     * Trusted peers are keyed by their certificate fingerprint rather than a self-declared id:
     * the fingerprint is the only field an attacker cannot choose, since it is checked against
     * the certificate presented in the TLS handshake.
     */
    val peerId: String get() = normalizeFingerprint(fp)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): PairingQrPayload? {
            val payload = runCatching { json.decodeFromString(serializer(), text) }.getOrNull()
                ?: return null
            if (payload.fp.isBlank() || payload.token.isBlank()) return null
            // 32 bytes of SHA-256, however the peer chose to punctuate it.
            if (normalizeFingerprint(payload.fp).length != 64) return null
            return payload
        }

        fun normalizeFingerprint(fingerprint: String): String =
            fingerprint.replace(":", "").replace(" ", "").lowercase()
    }
}

/**
 * The set of Macs allowed to open a TLS connection to this phone.
 *
 * Backed by the v1 `trusted_devices` table so there is one trust store on the device rather than
 * two that can disagree about who was forgotten.
 */
class TrustStore(context: Context) {

    private val dao = ConnectSuiteDatabase.get(context).trustedDeviceDao()

    /** Fingerprints are cached because the TLS trust manager runs on the accept thread. */
    @Volatile
    private var cache: Set<String> = emptySet()

    suspend fun reload() {
        cache = dao.getAll()
            .map { PairingQrPayload.normalizeFingerprint(it.fingerprint) }
            .toSet()
    }

    fun isTrusted(fingerprint: String): Boolean =
        PairingQrPayload.normalizeFingerprint(fingerprint) in cache

    fun trustedCount(): Int = cache.size

    suspend fun trust(payload: PairingQrPayload) {
        val now = System.currentTimeMillis()
        dao.upsert(
            TrustedDeviceEntity(
                deviceId = payload.peerId,
                name = payload.name.ifBlank { "Mac" },
                type = DeviceType.DESKTOP,
                // The certificate itself arrives with the TLS handshake; the QR only vouches for
                // its fingerprint, which is all pinning needs.
                certificate = "",
                fingerprint = payload.peerId,
                pairedAtMillis = now,
                lastSeenAtMillis = now,
                lastAddress = payload.host,
                lastPort = Link.PORT_CONTROL,
            ),
        )
        reload()
        LinkLog.i("trust", "Paired with ${payload.name} (${payload.peerId.take(16)}…)")
    }

    suspend fun forget(peerId: String) {
        dao.forget(peerId)
        reload()
        LinkLog.i("trust", "Forgot $peerId")
    }

    suspend fun touch(fingerprint: String, address: String?) {
        dao.touch(
            deviceId = PairingQrPayload.normalizeFingerprint(fingerprint),
            seenAt = System.currentTimeMillis(),
            address = address,
            port = Link.PORT_CONTROL,
        )
    }

    suspend fun nameOf(fingerprint: String): String? =
        dao.find(PairingQrPayload.normalizeFingerprint(fingerprint))?.name
}
