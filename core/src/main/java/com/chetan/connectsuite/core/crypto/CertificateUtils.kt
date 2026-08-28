package com.chetan.connectsuite.core.crypto

import android.util.Base64
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

object CertificateUtils {

    fun decode(base64Der: String): X509Certificate {
        val der = Base64.decode(base64Der, Base64.NO_WRAP)
        return CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(der)) as X509Certificate
    }

    fun encode(certificate: X509Certificate): String =
        Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)

    /**
     * Pulls the device id out of the certificate subject (`CN=<deviceId>, O=ConnectSuite`).
     * A peer whose certificate CN does not match the device id it announced is rejected, so a
     * device cannot claim someone else's identity with its own key.
     */
    fun deviceIdFrom(certificate: X509Certificate): String? =
        Regex("CN=([^,]+)").find(certificate.subjectX500Principal.name)?.groupValues?.getOrNull(1)
}
