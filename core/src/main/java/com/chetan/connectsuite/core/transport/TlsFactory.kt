package com.chetan.connectsuite.core.transport

import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.crypto.PinnedTrustManager
import java.net.Socket
import java.security.SecureRandom
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/**
 * Builds the mutually-authenticated TLS sockets every ConnectSuite connection runs over.
 *
 * Both ends present their identity certificate and both ends verify the other against a pinned
 * fingerprint, so there is no asymmetry between "client" and "server" in terms of trust — only in
 * who dialled.
 */
object TlsFactory {

    /** TLS 1.2 is the floor; 1.3 is used whenever both ends support it. */
    private val ENABLED_PROTOCOLS = arrayOf("TLSv1.3", "TLSv1.2")

    private fun contextFor(
        identity: DeviceIdentity,
        expectedFingerprint: String?,
        allowUnknown: Boolean,
    ): Pair<SSLContext, PinnedTrustManager> {
        val keyManagerFactory = KeyManagerFactory
            .getInstance(KeyManagerFactory.getDefaultAlgorithm())
            .apply { init(identity.keyStore(), null) }

        val trustManager = PinnedTrustManager(expectedFingerprint, allowUnknown)

        val context = SSLContext.getInstance("TLS").apply {
            init(keyManagerFactory.keyManagers, arrayOf(trustManager), SecureRandom())
        }
        return context to trustManager
    }

    /**
     * Upgrades an already-connected plain socket to TLS.
     *
     * @param clientMode true for the side that dialled out.
     * @param expectedFingerprint pinned fingerprint, or null when this connection is carrying a
     *   pairing request and the user has not vouched for a fingerprint yet.
     */
    fun upgrade(
        socket: Socket,
        identity: DeviceIdentity,
        clientMode: Boolean,
        expectedFingerprint: String?,
        allowUnknown: Boolean,
    ): TlsResult {
        val (context, trustManager) = contextFor(identity, expectedFingerprint, allowUnknown)

        val sslSocket = context.socketFactory.createSocket(
            socket,
            socket.inetAddress.hostAddress,
            socket.port,
            /* autoClose = */ true,
        ) as SSLSocket

        sslSocket.enabledProtocols = sslSocket.supportedProtocols
            .filter { it in ENABLED_PROTOCOLS }
            .toTypedArray()
        sslSocket.useClientMode = clientMode
        if (!clientMode) {
            // Without this the peer never sends its certificate and pinning is meaningless.
            sslSocket.needClientAuth = true
        }
        sslSocket.startHandshake()

        val peerCertificate = trustManager.observedCertificate
            ?: throw javax.net.ssl.SSLPeerUnverifiedException("Handshake produced no peer certificate")

        return TlsResult(
            socket = sslSocket,
            peerCertificate = peerCertificate,
            peerFingerprint = DeviceIdentity.fingerprintOf(peerCertificate),
        )
    }
}

class TlsResult(
    val socket: SSLSocket,
    val peerCertificate: java.security.cert.X509Certificate,
    val peerFingerprint: String,
)
