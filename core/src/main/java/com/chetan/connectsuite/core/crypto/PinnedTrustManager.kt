package com.chetan.connectsuite.core.crypto

import android.util.Log
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

/**
 * Trust-on-first-use certificate pinning, modelled on KDE Connect's trust store.
 *
 * There is no CA anywhere in this system: a peer is trusted if and only if the SHA-256 of the
 * certificate it presents matches the one recorded when the user confirmed the pairing. During
 * the pairing handshake itself [allowUnknown] is set, and the certificate that was actually seen
 * is captured in [observedCertificate] so the UI can show its fingerprint for confirmation.
 *
 * Lint flags every custom trust manager because the usual reason to write one is to disable
 * validation. This one does the opposite: it is strictly stricter than the platform default,
 * which would happily accept any certificate signed by any of the ~150 public CAs. Peers here are
 * self-signed and pinned, so delegating to the default implementation would reject every valid
 * peer and accept nothing useful.
 */
@Suppress("CustomX509TrustManager")
class PinnedTrustManager(
    /** Fingerprint we expect, or null while pairing. */
    private val expectedFingerprint: String?,
    /** True only for the one connection that carries a pairing request. */
    private val allowUnknown: Boolean,
) : X509TrustManager {

    @Volatile
    var observedCertificate: X509Certificate? = null
        private set

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        check(chain)

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        check(chain)

    private fun check(chain: Array<out X509Certificate>?) {
        val peer = chain?.firstOrNull()
            ?: throw CertificateException("Peer presented no certificate")
        observedCertificate = peer

        val actual = DeviceIdentity.fingerprintOf(peer)
        when {
            expectedFingerprint != null -> {
                if (!actual.equals(expectedFingerprint, ignoreCase = true)) {
                    Log.w(TAG, "Rejected peer: fingerprint mismatch")
                    throw CertificateException(
                        "Certificate does not match the paired device. " +
                            "Either this is a different device or the connection is being " +
                            "intercepted — forget and re-pair the device if it was reinstalled.",
                    )
                }
            }

            allowUnknown -> Unit // Pairing handshake: the user vouches for this fingerprint.

            else -> throw CertificateException("Unpaired device rejected")
        }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

    private companion object {
        const val TAG = "PinnedTrustManager"
    }
}
