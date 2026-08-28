package com.chetan.connectsuite.core.crypto

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.Calendar
import java.util.UUID
import javax.security.auth.x500.X500Principal

/**
 * This device's stable identity: a random device id plus a hardware-backed EC key pair whose
 * self-signed certificate is what peers pin.
 *
 * The private key never leaves the Android Keystore — it is used for the TLS handshake through a
 * [javax.net.ssl.KeyManager] but cannot be read out of the process, so a compromised backup or a
 * rooted-device file dump does not yield a usable identity.
 */
class DeviceIdentity private constructor(
    val deviceId: String,
    val deviceName: String,
    private val privateKey: PrivateKey,
    val certificate: X509Certificate,
) {

    /** SHA-256 of the DER-encoded certificate, as colon-separated uppercase hex. */
    val fingerprint: String by lazy { fingerprintOf(certificate) }

    /** Base64 DER of our certificate, as sent in the pairing handshake. */
    val certificateBase64: String by lazy {
        Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)
    }

    /** The keystore-backed [KeyStore] used to build the TLS key manager. */
    fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun privateKeyOrNull(): PrivateKey = privateKey

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        /**
         * v2 regenerates the identity: the v1 key was authorised for SHA-256/384/512 only, and
         * Conscrypt signs the TLS transcript with NONEwithECDSA, so the Keystore refused every
         * handshake signature. A key that cannot sign a handshake is not an identity worth
         * keeping, and the fingerprint changes anyway, so devices have to re-pair once.
         */
        const val KEY_ALIAS = "connectsuite_identity_v2"
        private const val PREFS = "connectsuite_identity"
        private const val KEY_DEVICE_ID = "device_id"

        @Volatile
        private var instance: DeviceIdentity? = null

        fun get(context: Context): DeviceIdentity =
            instance ?: synchronized(this) { instance ?: load(context).also { instance = it } }

        private fun load(context: Context): DeviceIdentity {
            val prefs = context.applicationContext.getSharedPreferences(
                PREFS,
                Context.MODE_PRIVATE,
            )
            val deviceId = prefs.getString(KEY_DEVICE_ID, null)
                ?: UUID.randomUUID().toString().also { generated ->
                    prefs.edit { putString(KEY_DEVICE_ID, generated) }
                }

            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                generateKeyPair(deviceId)
            }

            val entry = keyStore.getEntry(KEY_ALIAS, null) as KeyStore.PrivateKeyEntry
            return DeviceIdentity(
                deviceId = deviceId,
                deviceName = defaultDeviceName(),
                privateKey = entry.privateKey,
                certificate = entry.certificate as X509Certificate,
            )
        }

        /**
         * Generates the EC P-256 identity key. The Keystore mints the self-signed certificate for
         * us from the [KeyGenParameterSpec] certificate fields, which avoids pulling in a full
         * X.509 builder just to sign one certificate.
         */
        private fun generateKeyPair(deviceId: String) {
            val notBefore = Calendar.getInstance()
            val notAfter = Calendar.getInstance().apply { add(Calendar.YEAR, 20) }

            val spec = KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(
                    // NONE is what TLS actually uses: the stack hashes the transcript itself and
                    // hands the Keystore a raw digest to sign. Without it the handshake fails
                    // with an opaque "I/O error during system call" from Conscrypt.
                    KeyProperties.DIGEST_NONE,
                    KeyProperties.DIGEST_SHA256,
                    KeyProperties.DIGEST_SHA384,
                    KeyProperties.DIGEST_SHA512,
                )
                .setCertificateSubject(X500Principal("CN=$deviceId, O=ConnectSuite"))
                .setCertificateSerialNumber(BigInteger(64, java.security.SecureRandom()).abs())
                .setCertificateNotBefore(notBefore.time)
                .setCertificateNotAfter(notAfter.time)
                // The identity must be usable while the screen is locked so background
                // notification mirroring keeps working.
                .setUserAuthenticationRequired(false)
                .build()

            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
                .apply { initialize(spec) }
                .generateKeyPair()
        }

        private fun defaultDeviceName(): String {
            val manufacturer = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
            val model = Build.MODEL.orEmpty()
            return when {
                model.startsWith(manufacturer, ignoreCase = true) -> model
                manufacturer.isBlank() -> model.ifBlank { "Android device" }
                else -> "$manufacturer $model"
            }.take(48)
        }

        /** SHA-256 of a certificate's DER encoding, as colon-separated uppercase hex. */
        fun fingerprintOf(certificate: X509Certificate): String =
            MessageDigest.getInstance("SHA-256")
                .digest(certificate.encoded)
                .joinToString(":") { "%02X".format(it) }

        /** Short form used in pairing dialogs, where 32 hex pairs is unreadable. */
        fun shortFingerprint(fingerprint: String): String =
            fingerprint.split(":").take(8).joinToString(":")
    }
}
