package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.crypto.DeviceIdentity
import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * TLS for the v2 link. Every listening socket is built here.
 *
 * There is no CA: the phone accepts a connection only when the client certificate's SHA-256 is in
 * the [TrustStore], which is populated exclusively by scanning a pairing QR. An unpaired Mac fails
 * during the handshake, before it can send a single byte of protocol.
 *
 * Lint objects to any custom trust manager because the usual motive is to switch checking off.
 * This one is strictly stricter than the platform default, which would accept ~150 public CAs and
 * reject every legitimate self-signed peer we have.
 */
object LinkTls {

    /** TLS 1.3 only. docs/protocol.md promises it and both ends are ours, so there is no floor to keep. */
    private val PROTOCOLS = arrayOf("TLSv1.3")

    /**
     * Hands Conscrypt our Keystore-backed identity directly.
     *
     * The default X509KeyManager picks an alias by walking the KeyStore and matching key types
     * and issuers; with an AndroidKeyStore entry that selection quietly comes back empty, and the
     * server then fails the handshake with an opaque read error instead of saying it had no
     * certificate. We have exactly one identity, so there is nothing to select.
     */
    private class IdentityKeyManager(private val identity: DeviceIdentity) : X509ExtendedKeyManager() {

        override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(ALIAS)

        override fun chooseClientAlias(
            keyType: Array<out String>?,
            issuers: Array<out Principal>?,
            socket: Socket?,
        ) = ALIAS

        override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(ALIAS)

        override fun chooseServerAlias(
            keyType: String?,
            issuers: Array<out Principal>?,
            socket: Socket?,
        ) = ALIAS

        override fun chooseEngineServerAlias(
            keyType: String?,
            issuers: Array<out Principal>?,
            engine: SSLEngine?,
        ) = ALIAS

        override fun chooseEngineClientAlias(
            keyType: Array<out String>?,
            issuers: Array<out Principal>?,
            engine: SSLEngine?,
        ) = ALIAS

        override fun getCertificateChain(alias: String?): Array<X509Certificate> =
            arrayOf(identity.certificate)

        override fun getPrivateKey(alias: String?): PrivateKey = identity.privateKeyOrNull()

        private companion object {
            const val ALIAS = "connectsuite"
        }
    }

    @Suppress("CustomX509TrustManager")
    private class TrustStoreTrustManager(
        private val store: TrustStore,
        /** The Mac a v2 pairing is currently armed for, or null — admitted only while the arm lasts. */
        private val pending: () -> String?,
    ) : X509TrustManager {

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val peer = chain?.firstOrNull()
                ?: throw CertificateException("Client presented no certificate")
            val fingerprint = DeviceIdentity.fingerprintOf(peer)
            val armedFor = pending()?.let(PairingQrPayload::normalizeFingerprint)
            // Pairing v2: a scanned Mac is not persisted until it proves the code, so while the arm lasts
            // its fingerprint is admitted here — and admits it to nothing but the pairing exchange, since
            // no session token exists for it until that exchange completes.
            if (!store.isTrusted(fingerprint) && armedFor != PairingQrPayload.normalizeFingerprint(fingerprint)) {
                LinkLog.w("tls", "Rejected unpaired client ${fingerprint.take(23)}…")
                throw CertificateException(
                    "This Mac is not paired with the phone. Scan the pairing QR code first.",
                )
            }
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            // The phone never dials out on the v2 link.
            throw CertificateException("Server mode is not used on this link")
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    fun serverSocket(
        identity: DeviceIdentity,
        store: TrustStore,
        port: Int,
        pending: () -> String?,
        backlog: Int = 8,
    ): SSLServerSocket {
        val keyManagers = arrayOf(IdentityKeyManager(identity))

        val context = SSLContext.getInstance("TLSv1.3").apply {
            init(keyManagers, arrayOf(TrustStoreTrustManager(store, pending)), SecureRandom())
        }

        return (context.serverSocketFactory.createServerSocket(port, backlog) as SSLServerSocket)
            .apply {
                val usable = supportedProtocols.filter { it in PROTOCOLS }
                if (usable.isNotEmpty()) enabledProtocols = usable.toTypedArray()
                // Without client auth the pinning above never runs and anyone on the LAN is in.
                needClientAuth = true
                reuseAddress = true
                LinkLog.i(
                    "tls",
                    "Port $port protocols=${enabledProtocols.joinToString()} " +
                        "ciphers=${enabledCipherSuites.size} keyManagers=${keyManagers.size}",
                )
            }
    }

    /**
     * Completes the handshake and returns the peer fingerprint.
     *
     * The handshake is forced here, on the per-connection thread, so a client that stalls
     * mid-handshake cannot block the accept loop.
     */
    fun handshake(socket: SSLSocket): String {
        socket.startHandshake()
        val peer = socket.session.peerCertificates.firstOrNull() as? X509Certificate
            ?: throw CertificateException("Handshake produced no peer certificate")
        return DeviceIdentity.fingerprintOf(peer)
    }
}
