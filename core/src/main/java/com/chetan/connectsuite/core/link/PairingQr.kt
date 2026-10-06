package com.chetan.connectsuite.core.link

import android.content.Context
import com.chetan.connectsuite.core.data.ConnectSuiteDatabase
import com.chetan.connectsuite.core.data.TrustedDeviceEntity
import com.chetan.connectsuite.core.model.DeviceType
import com.chetan.connectsuite.core.protocol.Link
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What the Mac draws into its pairing QR code — `docs/protocol.md` → *Pairing (version 2)*.
 *
 * Scanning it is the user saying "this Mac is mine". Since pairing v2 (audit S1, 2026-10-06) the scan
 * **arms** a pairing and trusts nothing by itself: the Mac's fingerprint is admitted at TLS only while
 * the arm lasts, and is persisted only after the Mac proves it holds [secret] ([PhonePairing]).
 *
 * [secret] is the pairing secret `K`. It must never reach a log line: [toString] redacts it, because a
 * data class prints every field and one stray `"$payload"` would put `K` on disk.
 */
@Serializable
data class PairingQrPayload(
    val v: Int? = null,
    val host: String,
    val fp: String,
    val secret: String? = null,
    /** v1's field. Read only to recognise a v1 Mac's code and refuse it with the right sentence. */
    val token: String? = null,
    val name: String,
) {
    val peerId: String get() = normalizeFingerprint(fp)

    override fun toString(): String = "PairingQrPayload(v=$v, host=$host, fp=${peerId.take(16)}…, secret=<redacted>, name=$name)"

    /** What a scanned code is. */
    sealed interface Scan {
        data class V2(val payload: PairingQrPayload) : Scan

        /** A v1 Mac's code: `token`, no `v`. Never paired with — the Mac must be updated. */
        data object LegacyMac : Scan

        data object Invalid : Scan
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        const val LEGACY_MAC_MESSAGE =
            "This Mac's Sidekick is too old to pair securely. Update it on the Mac, then scan a fresh code."

        fun classify(text: String): Scan {
            val payload = runCatching { json.decodeFromString(serializer(), text) }.getOrNull()
                ?: return Scan.Invalid
            // 32 bytes of SHA-256, however the peer chose to punctuate it.
            if (payload.fp.isBlank() || normalizeFingerprint(payload.fp).length != 64) return Scan.Invalid
            if (payload.v == null && !payload.token.isNullOrBlank()) return Scan.LegacyMac
            if (payload.v == PairingV2.VERSION && PairingV2.isHex64(payload.secret)) return Scan.V2(payload)
            return Scan.Invalid
        }

        /** A v2 code, or null for anything else. */
        fun parse(text: String): PairingQrPayload? = (classify(text) as? Scan.V2)?.payload

        fun normalizeFingerprint(fingerprint: String): String =
            fingerprint.replace(":", "").replace(" ", "").lowercase()
    }
}

class TrustStore(context: Context) {

    private val dao = ConnectSuiteDatabase.get(context).trustedDeviceDao()

    /**
     * Which trusted Macs were paired **by pairing v2** — `docs/protocol.md` → *Existing pairings*.
     *
     * Kept beside the Room table rather than in it: a column would be a schema migration on the table
     * the v1 Sync feature also uses, and an existing record must be left exactly as it is. A fingerprint
     * in the table and not here is a **legacy** pairing — never upgraded by an app update, only by a new
     * v2 pairing. Holds fingerprints only, never a secret.
     */
    private val v2 = context.applicationContext.getSharedPreferences(V2_PREFS, Context.MODE_PRIVATE)

    @Volatile
    private var cache: Set<String> = emptySet()

    suspend fun reload() {
        cache = dao.getAll()
            .map { PairingQrPayload.normalizeFingerprint(it.fingerprint) }
            .toSet()
    }

    fun isTrusted(fingerprint: String): Boolean =
        PairingQrPayload.normalizeFingerprint(fingerprint) in cache

    /** Whether this Mac was paired by v2. False for a legacy record, and for an unknown one. */
    fun isPairedV2(fingerprint: String): Boolean =
        PairingQrPayload.normalizeFingerprint(fingerprint) in (v2.getStringSet(V2_KEY, emptySet()) ?: emptySet())

    fun trustedCount(): Int = cache.size

    /**
     * Persists a Mac **after** pairing v2 verified its proof — the only writer of a v1-path-free trust
     * record. The row first, then the v2 mark: a crash between the two leaves a record that reads as
     * legacy, which is the safe direction.
     */
    suspend fun trustAuthenticated(paired: PhonePairing.Paired) {
        val now = System.currentTimeMillis()
        val peerId = PairingQrPayload.normalizeFingerprint(paired.macFingerprint)
        dao.upsert(
            TrustedDeviceEntity(
                deviceId = peerId,
                name = paired.name.ifBlank { "Mac" },
                type = DeviceType.DESKTOP,
                // The certificate itself arrives with the TLS handshake; the QR only vouches for
                // its fingerprint, which is all pinning needs.
                certificate = "",
                fingerprint = peerId,
                pairedAtMillis = now,
                lastSeenAtMillis = now,
                lastAddress = paired.host,
                lastPort = Link.PORT_CONTROL,
            ),
        )
        val marked = (v2.getStringSet(V2_KEY, emptySet()) ?: emptySet()) + peerId
        v2.edit().putStringSet(V2_KEY, marked).commit()
        reload()
        LinkLog.i("trust", "Paired with ${paired.name} (${peerId.take(16)}…) — pairing v2, both sides proved the code")
    }

    suspend fun forget(peerId: String) {
        val normalized = PairingQrPayload.normalizeFingerprint(peerId)
        dao.forget(peerId)
        val remaining = (v2.getStringSet(V2_KEY, emptySet()) ?: emptySet()) - normalized
        v2.edit().putStringSet(V2_KEY, remaining).commit()
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

    private companion object {
        const val V2_PREFS = "link_pairing_v2"
        const val V2_KEY = "authenticated_fingerprints"
    }
}
