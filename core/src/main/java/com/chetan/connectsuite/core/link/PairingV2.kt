package com.chetan.connectsuite.core.link

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Pairing v2's proofs — `docs/protocol.md` → *Pairing (version 2)*; audit S1, defect 182.
 *
 * Reviewed primitives only: HMAC-SHA256, `SecureRandom`, `MessageDigest.isEqual`. The transcript is a
 * fixed-layout byte string — `"sidekick/pair/v2" 0x00 role 0x00 Fm Fp Nm Np` — so the phone, the Mac
 * (`desktop/src/shared/pairingV2.ts`) and the independent generator of
 * `docs/fixtures/pairing-v2-vectors.json` cannot disagree about it. Pure: no Android, so the JVM tests
 * call exactly this.
 */
object PairingV2 {
    const val VERSION = 2
    const val LABEL = "sidekick/pair/v2"
    const val ROLE_PHONE = "phone"
    const val ROLE_MAC = "mac"

    private val HEX64 = Regex("^[0-9a-f]{64}$")
    private val random = SecureRandom()

    fun newNonceHex(): String = ByteArray(32).also(random::nextBytes).toHex()

    fun isHex64(value: String?): Boolean = value != null && HEX64.matches(value)

    /** 32 raw bytes from any punctuation of 64 hex digits, or null. */
    fun fingerprintBytes(fingerprint: String): ByteArray? {
        val hex = fingerprint.replace(":", "").replace(" ", "").lowercase()
        return if (HEX64.matches(hex)) hex.hexToBytes() else null
    }

    /** The transcript. Throws [IllegalArgumentException] on a malformed input — a failed proof, never repaired. */
    fun transcript(role: String, macFp: String, phoneFp: String, macNonce: String, phoneNonce: String): ByteArray {
        require(role == ROLE_PHONE || role == ROLE_MAC) { "unknown role" }
        val fm = requireNotNull(fingerprintBytes(macFp)) { "mac fingerprint is not 32 bytes" }
        val fp = requireNotNull(fingerprintBytes(phoneFp)) { "phone fingerprint is not 32 bytes" }
        require(isHex64(macNonce) && isHex64(phoneNonce)) { "a nonce is not 64 lowercase hex" }
        return LABEL.toByteArray(Charsets.US_ASCII) + byteArrayOf(0) + role.toByteArray(Charsets.US_ASCII) +
            byteArrayOf(0) + fm + fp + macNonce.hexToBytes() + phoneNonce.hexToBytes()
    }

    /** HMAC-SHA256(K, T(role)) as 64 lowercase hex. */
    fun proof(secretHex: String, role: String, macFp: String, phoneFp: String, macNonce: String, phoneNonce: String): String {
        require(isHex64(secretHex)) { "the pairing secret is not 64 lowercase hex" }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secretHex.hexToBytes(), "HmacSHA256"))
        return mac.doFinal(transcript(role, macFp, phoneFp, macNonce, phoneNonce)).toHex()
    }

    /** Constant time in the proof's bytes; any malformed input is simply `false`. */
    fun verify(
        secretHex: String,
        role: String,
        macFp: String,
        phoneFp: String,
        macNonce: String,
        phoneNonce: String,
        candidate: String?,
    ): Boolean {
        if (!isHex64(candidate)) return false
        val expected = runCatching { proof(secretHex, role, macFp, phoneFp, macNonce, phoneNonce) }.getOrNull()
            ?: return false
        return MessageDigest.isEqual(expected.hexToBytes(), candidate!!.hexToBytes())
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
    private fun String.hexToBytes(): ByteArray = ByteArray(length / 2) { substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}

/**
 * The phone's side of a v2 pairing: one armed pairing at a time, its lifetime, its failure limit, and
 * the two decisions the control session asks for. Pure and synchronized, with the clock and the nonce
 * source injectable, so the JVM tests reach every branch through this class rather than a copy of it.
 *
 * The secret lives here, in memory, from the scan until the earliest of expiry, [cancel], a completed
 * pairing, or [maxFailures] failed Mac proofs. It is never logged and never persisted.
 */
class PhonePairing(
    private val now: () -> Long = System::currentTimeMillis,
    private val nonce: () -> String = PairingV2::newNonceHex,
    private val ttlMs: Long = com.chetan.connectsuite.core.protocol.Link.PAIR_TOKEN_TTL_MS,
    private val maxFailures: Int = MAX_FAILURES,
) {
    /** What a completed pairing persists. No secret. */
    data class Paired(val macFingerprint: String, val name: String, val host: String)

    /** One connection's exchange. Bound to the arm it started under, so a re-armed pairing cannot finish it. */
    data class Exchange(
        val armSerial: Long,
        val macFingerprint: String,
        val phoneFingerprint: String,
        val macNonce: String,
        val phoneNonce: String,
    )

    sealed interface HelloDecision {
        /** Nothing to do with pairing: a trusted Mac reconnecting. */
        data object NotPairing : HelloDecision

        data class SendProof(val exchange: Exchange, val proof: String) : HelloDecision

        data class Reject(val reason: PairRejectReason) : HelloDecision
    }

    sealed interface ConfirmDecision {
        data class Accepted(val paired: Paired) : ConfirmDecision
        data class Reject(val reason: PairRejectReason) : ConfirmDecision
    }

    private class Arm(
        val serial: Long,
        val macFingerprint: String,
        val secretHex: String,
        val name: String,
        val host: String,
        val expiresAt: Long,
    ) {
        var failures = 0
    }

    private var arm: Arm? = null
    private var serials = 0L

    /** Arms a pairing for a scanned v2 code, replacing any earlier one. */
    @Synchronized
    fun arm(macFingerprint: String, secretHex: String, name: String, host: String) {
        require(PairingV2.isHex64(secretHex)) { "not a v2 pairing secret" }
        arm = Arm(++serials, normalize(macFingerprint), secretHex, name, host, now() + ttlMs)
    }

    @Synchronized
    fun cancel() {
        arm = null
    }

    /** The Mac fingerprint the TLS layer may admit while a pairing is armed and unexpired, or null. */
    @Synchronized
    fun pendingFingerprint(): String? = arm?.takeIf { now() <= it.expiresAt }?.macFingerprint

    @Synchronized
    fun isArmed(): Boolean = pendingFingerprint() != null

    /**
     * The decision on a `hello` from [macFingerprint] (as TLS observed it). [pair] is the hello's `pair`
     * object, [hasLegacyToken] whether it carried a v1 `pairToken`. [phoneFingerprint] is this phone's.
     */
    @Synchronized
    fun onHello(macFingerprint: String, phoneFingerprint: String, pair: JsonObject?, hasLegacyToken: Boolean): HelloDecision {
        // No fallback, whatever else is true: a v1 token is never accepted.
        if (hasLegacyToken) return HelloDecision.Reject(PairRejectReason.UPGRADE_REQUIRED)
        val current = arm
        val armedForPeer = current != null && current.macFingerprint == normalize(macFingerprint)
        if (!armedForPeer) {
            return if (pair != null) HelloDecision.Reject(PairRejectReason.NOT_ARMED) else HelloDecision.NotPairing
        }
        current!!
        if (now() > current.expiresAt) {
            arm = null
            return HelloDecision.Reject(PairRejectReason.TOKEN_EXPIRED)
        }
        if (pair == null) return HelloDecision.Reject(PairRejectReason.TOKEN_MISSING)
        val version = runCatching { pair["v"]?.jsonPrimitive?.intOrNull }.getOrNull()
        val macNonce = runCatching { pair["nonce"]?.jsonPrimitive?.content }.getOrNull()
        if (version != PairingV2.VERSION || !PairingV2.isHex64(macNonce)) return failed(current)
        val exchange = Exchange(current.serial, current.macFingerprint, phoneFingerprint, macNonce!!, nonce())
        val proof = runCatching {
            PairingV2.proof(current.secretHex, PairingV2.ROLE_PHONE, current.macFingerprint, phoneFingerprint, macNonce, exchange.phoneNonce)
        }.getOrNull() ?: return failed(current)
        return HelloDecision.SendProof(exchange, proof)
    }

    /** The decision on a `pair.confirm`'s proof for [exchange]. */
    @Synchronized
    fun onConfirm(exchange: Exchange, candidate: String?): ConfirmDecision {
        val current = arm
        if (current == null || current.serial != exchange.armSerial) return ConfirmDecision.Reject(PairRejectReason.NOT_ARMED)
        if (now() > current.expiresAt) {
            arm = null
            return ConfirmDecision.Reject(PairRejectReason.TOKEN_EXPIRED)
        }
        val ok = PairingV2.verify(
            current.secretHex, PairingV2.ROLE_MAC,
            exchange.macFingerprint, exchange.phoneFingerprint, exchange.macNonce, exchange.phoneNonce,
            candidate,
        )
        if (!ok) return when (val r = failed(current)) {
            is HelloDecision.Reject -> ConfirmDecision.Reject(r.reason)
            else -> ConfirmDecision.Reject(PairRejectReason.PROOF_INVALID)
        }
        arm = null
        return ConfirmDecision.Accepted(Paired(current.macFingerprint, current.name, current.host))
    }

    private fun failed(current: Arm): HelloDecision.Reject {
        current.failures += 1
        if (current.failures >= maxFailures) {
            arm = null
            return HelloDecision.Reject(PairRejectReason.TOO_MANY_ATTEMPTS)
        }
        return HelloDecision.Reject(PairRejectReason.PROOF_INVALID)
    }

    companion object {
        const val MAX_FAILURES = 5

        fun normalize(fingerprint: String): String = PairingQrPayload.normalizeFingerprint(fingerprint)
    }
}
