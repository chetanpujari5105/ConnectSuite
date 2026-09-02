package com.chetan.connectsuite.core.link

import android.content.Context
import com.chetan.connectsuite.core.crypto.DeviceIdentity
import com.chetan.connectsuite.core.protocol.Link
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

/** A video or bulk socket that has proved it belongs to a live control session. */
class AuthenticatedChannel(
    val socket: SSLSocket,
    val session: ControlSession,
    /**
     * The same stream the token was read from. It must be handed over rather than re-wrapped:
     * the bulk client sends its JSON header immediately behind the token, and those bytes are
     * already sitting in this buffer.
     */
    val input: BufferedInputStream,
) {
    val output: BufferedOutputStream by lazy { BufferedOutputStream(socket.getOutputStream()) }

    fun close() = runCatching { socket.close() }.let { }
}

/** Connection state as the UI and the foreground-service notification see it. */
data class LinkState(
    val running: Boolean = false,
    val clients: List<String> = emptyList(),
    val lastError: String? = null,
    /**
     * When the **current wait** began — not when the server started.
     *
     * The distinction is the whole of defect 67. This was `listeningSinceMillis`, set once when the
     * accept loops came up, and it made the twenty-second hint fire *instantly* on any phone that
     * had been listening for longer than twenty seconds — which is every phone, after the first
     * half minute. Measured on hardware: listening began 13:29:56, the Mac dropped at 13:45:04, and
     * the "check your Wi-Fi" hint was on screen 2 seconds later.
     *
     * So it is reset in two places: when listening starts, and when a session ends. A wait is the
     * time since there was last a Mac here, and after a disconnect that is *now*.
     *
     * Null means listening with no known start — see `LinkWaitStatus.of`, which withholds the
     * network hint rather than guessing at an elapsed time it does not have.
     */
    val waitingSinceMillis: Long? = null,
    /**
     * The last Mac turned away at the TLS handshake, for F5.
     *
     * `LinkTls` has logged this since Phase 1 and nothing on screen has ever heard it, so a user
     * whose Mac was refused saw the same "Listening for your Mac" as a user whose Mac had not
     * dialled at all.
     */
    val lastRefusal: RefusedConnection? = null,
) {
    val isConnected: Boolean get() = clients.isNotEmpty()

    /**
     * The state after the accept loops come up.
     *
     * A fresh listen is a fresh wait, and a refusal from the previous session is not an explanation
     * for this one's silence.
     */
    fun afterListeningStarted(nowMillis: Long): LinkState = copy(
        running = true,
        lastError = null,
        waitingSinceMillis = nowMillis,
        lastRefusal = null,
    )

    /**
     * The state after a control session ends — **defect 67 lives here, not in the rendering.**
     *
     * This is a named function rather than a `copy()` inside `onSessionEnded` because the bug it
     * fixes was invisible to eleven passing tests. Those tests call [LinkWaitStatus.of], which
     * decides what to *say* about a wait; they hand it a `waitingSinceMillis` by hand, and so they
     * are green whether or not anything in the product ever writes that field correctly. The
     * decision was right the whole time. **The transition into the state was wrong**, and a pure
     * function that is never given the product's own inputs cannot see that.
     *
     * That is `CLAUDE.md`'s testable-seam rule arriving from a new direction: the usual failure is a
     * test that restates the rule instead of calling it, and this is a test that calls the rule
     * correctly at a layer the defect does not live in.
     *
     * The clock restarts only when the **last** client leaves. With a second Mac still connected
     * there is no wait to time.
     */
    fun afterSessionEnded(peerName: String, closeReason: String?, nowMillis: Long): LinkState {
        val remaining = clients.filterNot { it == peerName }
        return copy(
            clients = remaining,
            lastError = closeReason,
            waitingSinceMillis = if (remaining.isEmpty()) nowMillis else waitingSinceMillis,
        )
    }
}

/**
 * The phone side of the link: three TLS listeners and everything hanging off them.
 *
 * The phone is the server on purpose. On a Samsung hotspot the Mac's address is a DHCP lease we
 * cannot predict, while the phone is the Mac's default gateway — so the Mac can always find us
 * even when the AP blocks multicast and mDNS is dead.
 */
class LinkServer(
    context: Context,
    val appVersion: String,
) {
    private val appContext = context.applicationContext
    val identity: DeviceIdentity = DeviceIdentity.get(appContext)
    val trustStore = TrustStore(appContext)
    val sessions = SessionRegistry()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val handlers = ConcurrentHashMap<String, MessageHandler>()

    /**
     * Capabilities are gated on what is actually wired up here, not on permissions alone — so a
     * feature module registering its handlers is what turns its capability on. Declared after
     * [handlers] because it reads it; the detector starts empty and is filled by refresh().
     */
    val capabilities = CapabilityDetector(
        context = appContext,
        registeredTypes = { handlers.keys.toSet() },
        videoChannelServed = { videoChannelSink != null },
        bulkChannelServed = { bulkChannelSink != null },
    )
    private val liveSessions = ConcurrentHashMap<ControlSession, Unit>()

    private var controlSocket: SSLServerSocket? = null
    private var videoSocket: SSLServerSocket? = null
    private var bulkSocket: SSLServerSocket? = null
    private val acceptJobs = mutableListOf<Job>()

    /**
     * Refusals and acceptances, published together.
     *
     * `CLAUDE.md`'s denominator rule: "187 refusals" was indistinguishable from a user misclicking
     * until the success count turned out to be zero. A phone refusing every Mac and a phone
     * refusing one stranger look identical on the refusal line alone.
     */
    private val refusedCount = java.util.concurrent.atomic.AtomicInteger()
    private val acceptedCount = java.util.concurrent.atomic.AtomicInteger()

    private val _state = MutableStateFlow(LinkState())
    val state: StateFlow<LinkState> = _state.asStateFlow()

    /** Set by mirror-module in phase 2; until then a video socket is refused with a reason. */
    @Volatile
    var videoChannelSink: ((AuthenticatedChannel) -> Unit)? = null

    /** Set by the transfer code in phase 5. */
    @Volatile
    var bulkChannelSink: ((AuthenticatedChannel) -> Unit)? = null

    /**
     * Called as a control session ends, with the session that ended.
     *
     * Exists because a feature holding per-session state has no other way to learn its peer is
     * gone: a handler only ever runs when a message arrives, and a dead session sends none. Phase 2
     * shipped without this and the mirror kept a live MediaProjection running for as long as
     * nothing else happened to restart it — capture with no consumer, which is a privacy defect and
     * not merely a leak.
     *
     * One slot, like the channel sinks above, because there is one feature that needs it today. A
     * second consumer means turning this into a list, not quietly stealing the slot.
     */
    @Volatile
    var sessionEndedSink: ((ControlSession) -> Unit)? = null

    /**
     * Called with (label, reason) when a video or bulk socket could not be authorised.
     *
     * Unlike the sinks above this is not part of any capability contract — it carries no
     * capability, it only makes sure a refusal reaches a user instead of stopping at the log.
     */
    @Volatile
    var sideChannelRejected: ((String, String) -> Unit)? = null

    /**
     * Run when a control session finishes its handshake, once per session, per listener.
     *
     * A **list**, unlike the single-slot sinks above, and deliberately so: the comment on
     * [sessionEndedSink] says a second consumer means turning it into a list rather than quietly
     * stealing the slot, and Phase 4 is where the second, third and fourth consumers arrive.
     *
     * What they need it for is the same thing in each case. A Mac that connects has missed every
     * event since the phone booted, so `docs/protocol.md` makes replay-on-connect part of the
     * contract: every active notification is re-sent as a `notif.posted`, a ringing call as a
     * `call.incoming`, the current playback as a `remote.state`. Without this hook the Mac's lists
     * would be empty until something new happened, which on a quiet phone can be hours — and an
     * empty list is indistinguishable from a broken feature.
     */
    private val sessionReadyListeners = java.util.concurrent.CopyOnWriteArrayList<(ControlSession) -> Unit>()

    /** Registers a replay-on-connect listener. Safe to call before or after sessions exist. */
    fun addSessionReadyListener(listener: (ControlSession) -> Unit) {
        sessionReadyListeners.add(listener)
    }

    fun removeSessionReadyListener(listener: (ControlSession) -> Unit) {
        sessionReadyListeners.remove(listener)
    }

    /**
     * Watch the two Settings toggles for the life of the **process**, not the life of the server.
     *
     * ### Defect 37: this used to be the last line of `start()`, and that was the whole bug
     *
     * `CapabilityDetector.startWatching` calls itself the belt to the lifecycle callbacks' braces,
     * and it is — but a belt registered by `LinkServer.start()` is only worn while the server is
     * up. A user toggling a grant in Settings is, if anything, *more* likely to be doing it while
     * the link is down: that is when a feature looks broken and someone goes looking for a switch.
     *
     * It cost exactly that. In the process that found the defect the observer had fired 15 times
     * across the log and **not once in that process** — last at 14:01:44, process started 17:05:40
     * — because `Listening on 42501/42502/42503` never appeared and the ports were never bound.
     * A millisecond-scale stale read of the settings provider therefore became a permanent wrong
     * answer, with no backstop to correct it.
     *
     * The same scoping was seen again from the other side on 2026-08-28: the platform rebound
     * `NotificationMirrorService`, which started the process, which installed every feature — and
     * `LinkService` never ran, so the phone sat for five hours fully granted and serverless. Both
     * are `LinkServer.start()` being load-bearing for things that are not the server.
     *
     * Registered from `init` so it is tied to the one `LinkServer` the process builds
     * (`LinkController.get`). It costs two URIs and no polling, and `refresh()` already returns
     * false when the computed set has not moved, so a spurious `onChange` broadcasts nothing.
     * There is no matching `stopWatching` call anywhere: the observer is meant to outlive every
     * connection, and the process ending is what removes it.
     */
    init {
        capabilities.startWatching(::refreshCapabilities)
    }

    // ---- pairing ------------------------------------------------------------------------

    private data class ArmedPairing(val fingerprint: String, val token: String, val expiresAt: Long)

    @Volatile
    private var armedPairing: ArmedPairing? = null

    /** Called by the QR scanner once the user has scanned a Mac's pairing code. */
    suspend fun completePairing(payload: PairingQrPayload) {
        trustStore.trust(payload)
        armedPairing = ArmedPairing(
            fingerprint = payload.peerId,
            token = payload.token,
            expiresAt = System.currentTimeMillis() + Link.PAIR_TOKEN_TTL_MS,
        )
    }

    /**
     * True when this hello may proceed. An armed pairing is consumed by the first matching
     * connection; a peer that was trusted in an earlier session needs no token at all.
     */
    fun acceptPairToken(peerFingerprint: String, pairToken: String?): Boolean {
        val armed = armedPairing ?: return true
        val normalized = PairingQrPayload.normalizeFingerprint(peerFingerprint)
        if (armed.fingerprint != normalized) return true
        if (System.currentTimeMillis() > armed.expiresAt) {
            armedPairing = null
            return false
        }
        if (pairToken != armed.token) return false
        armedPairing = null
        return true
    }

    // ---- lifecycle ----------------------------------------------------------------------

    suspend fun start() {
        if (_state.value.running) return
        LinkLog.init(appContext)
        trustStore.reload()
        capabilities.refresh()
        // The Settings observer is *not* installed here. It is installed in this class's `init`,
        // because its lifetime is the process and not the server's. See defect 37 below.

        try {
            controlSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_CONTROL)
            videoSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_VIDEO)
            bulkSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_BULK)
        } catch (e: IOException) {
            // Almost always "address already in use" from a previous process that has not died
            // yet. Say so instead of silently running with no listener.
            LinkLog.e("server", "Could not bind listeners", e)
            _state.update { it.copy(running = false, lastError = "Could not open ports: ${e.message}") }
            stop()
            return
        }

        acceptJobs += scope.launch { acceptControl(controlSocket!!) }
        acceptJobs += scope.launch { acceptSideChannel(videoSocket!!, "video") { videoChannelSink } }
        acceptJobs += scope.launch { acceptSideChannel(bulkSocket!!, "bulk") { bulkChannelSink } }

        _state.update { it.afterListeningStarted(System.currentTimeMillis()) }
        LinkLog.i(
            "server",
            "Listening on ${Link.PORT_CONTROL}/${Link.PORT_VIDEO}/${Link.PORT_BULK}, " +
                "${trustStore.trustedCount()} paired device(s)",
        )
    }

    fun stop() {
        // The Settings observer deliberately survives stop(): see the `init` block. Stopping the
        // server does not stop the user from changing grants, and it is that window the observer
        // exists for.
        acceptJobs.forEach(Job::cancel)
        acceptJobs.clear()
        liveSessions.keys.forEach { it.close("service stopping") }
        liveSessions.clear()
        listOf(controlSocket, videoSocket, bulkSocket).forEach { socket ->
            runCatching { socket?.close() }
        }
        controlSocket = null
        videoSocket = null
        bulkSocket = null
        _state.update { LinkState(running = false, lastError = it.lastError) }
        LinkLog.i("server", "Listeners closed")
    }

    // ---- accept loops -------------------------------------------------------------------

    private fun acceptControl(server: SSLServerSocket) {
        while (!server.isClosed) {
            val socket = try {
                server.accept() as SSLSocket
            } catch (e: SocketException) {
                return // closed by stop()
            } catch (e: IOException) {
                LinkLog.w("server", "Control accept failed", e)
                continue
            }
            // The handshake runs on the connection's own thread: an unpaired Mac failing
            // certificate checks must not stall the next legitimate client.
            scope.launch {
                val fingerprint = try {
                    LinkTls.handshake(socket)
                } catch (e: Exception) {
                    val address = socket.inetAddress?.hostAddress
                    // F5: the refusal reaches the screen as well as the log. The fingerprint is
                    // read from the socket rather than from the exception — the peer presented a
                    // certificate, it simply was not one we trust, and naming the key is what lets
                    // a user tell "a stranger on the network" from "my Mac, reinstalled".
                    val prefix = runCatching {
                        DeviceIdentity.fingerprintOf(
                            socket.session.peerCertificates.first() as java.security.cert.X509Certificate,
                        ).take(23)
                    }.getOrNull()
                    LinkLog.w(
                        "server",
                        "Refused $address" + (prefix?.let { ", key $it…" } ?: ", no usable certificate") +
                            " — ${refusedCount.incrementAndGet()} refused / " +
                            "${acceptedCount.get()} accepted since start",
                        e,
                    )
                    if (prefix != null) {
                        _state.update {
                            it.copy(
                                lastRefusal = RefusedConnection(
                                    fingerprintPrefix = prefix,
                                    address = address,
                                    atMillis = System.currentTimeMillis(),
                                ),
                            )
                        }
                    }
                    runCatching { socket.close() }
                    return@launch
                }
                acceptedCount.incrementAndGet()
                socket.tcpNoDelay = true
                socket.keepAlive = true
                val session = ControlSession(socket, fingerprint, this@LinkServer)
                liveSessions[session] = Unit
                trustStore.touch(fingerprint, socket.inetAddress?.hostAddress)
                session.run()
            }
        }
    }

    private fun acceptSideChannel(
        server: SSLServerSocket,
        label: String,
        sink: () -> ((AuthenticatedChannel) -> Unit)?,
    ) {
        while (!server.isClosed) {
            val socket = try {
                server.accept() as SSLSocket
            } catch (e: SocketException) {
                return
            } catch (e: IOException) {
                LinkLog.w("server", "$label accept failed", e)
                continue
            }
            scope.launch {
                try {
                    LinkTls.handshake(socket)
                    socket.tcpNoDelay = true
                    socket.soTimeout = Link.TOKEN_GRACE_MS.toInt()
                    val input = BufferedInputStream(socket.getInputStream())
                    val tokenFrame = Framing.readFrame(input, 128)
                        ?: throw IOException("no token frame")
                    val token = String(tokenFrame, Charsets.UTF_8).trim()
                    val session = sessions.resolve(token)
                        ?: throw IOException("unknown session token")
                    socket.soTimeout = 0

                    val consumer = sink()
                    if (consumer == null) {
                        LinkLog.w("server", "$label socket refused: nothing is serving it yet")
                        session.sendError(
                            requestId = java.util.UUID.randomUUID().toString(),
                            code = com.chetan.connectsuite.core.protocol.ErrorCode.FEATURE_UNAVAILABLE,
                            message = "The $label channel is not available in this build yet",
                            feature = label,
                        )
                        runCatching { socket.close() }
                        return@launch
                    }
                    LinkLog.i("server", "$label channel authorised for ${session.peerName}")
                    consumer(AuthenticatedChannel(socket, session, input))
                } catch (e: Exception) {
                    LinkLog.w("server", "$label channel rejected: ${e.message}")
                    runCatching { socket.close() }
                    // The token did not resolve, so this socket's owner is unknown and cannot be
                    // answered on its own connection. A Mac waiting for a picture still deserves
                    // the reason rather than an idle canvas, so the feature serving this channel
                    // is told and decides which live session to tell.
                    runCatching { sideChannelRejected?.invoke(label, e.message ?: "unauthorised") }
                }
            }
        }
    }

    // ---- session bookkeeping ------------------------------------------------------------

    fun handlerFor(type: String): MessageHandler? = handlers[type]

    /**
     * Feature modules register their message types here as they start.
     *
     * Registering can complete a capability's contract, so the advertised set is recomputed and
     * pushed to every live Mac — otherwise a module that starts after the handshake would work
     * while the Mac still showed its pane greyed out.
     */
    fun register(type: String, handler: MessageHandler) {
        handlers[type] = handler
        refreshCapabilities()
    }

    fun unregister(type: String) {
        if (handlers.remove(type) != null) refreshCapabilities()
    }

    fun onSessionReady(session: ControlSession) {
        _state.update { it.copy(clients = it.clients + session.peerName) }
        // Each listener is guarded on its own: a feature that throws while replaying its state
        // must not stop the next feature from replaying its own, and must not take down a
        // session that is otherwise perfectly good.
        sessionReadyListeners.forEach { listener ->
            runCatching { listener(session) }
                .onFailure { LinkLog.w("server", "Session-ready listener failed: ${it.message}") }
        }
    }

    fun onSessionEnded(session: ControlSession) {
        liveSessions.remove(session)
        _state.update { current ->
            val remaining = current.clients.toMutableList()
            remaining.remove(session.peerName)
            current.afterSessionEnded(
                peerName = session.peerName,
                closeReason = session.closeReason,
                nowMillis = System.currentTimeMillis(),
            )
        }
        // After the bookkeeping, so a feature tearing down here sees a server that already agrees
        // the session is gone. Guarded because a throwing feature must not stop the session from
        // being cleaned up.
        sessionEndedSink?.let { sink ->
            runCatching { sink(session) }
                .onFailure { LinkLog.w("server", "Session-ended handler failed: ${it.message}") }
        }
    }

    /**
     * Any live, handshaken control session, or null.
     *
     * Exists for the reverse direction: something started on the *phone* — the user tapping Start
     * mirroring — needs a Mac to report itself to, and unlike a request handler it has no session
     * handed to it. There is one Mac in practice; taking the first is honest about that rather
     * than pretending to pick.
     */
    fun anyLiveSession(): ControlSession? =
        liveSessions.keys.firstOrNull { it.isHandshakeComplete }

    fun broadcast(build: (ControlSession) -> Unit) {
        liveSessions.keys.forEach { session ->
            if (session.isHandshakeComplete) build(session)
        }
    }

    /** Re-checks permissions and tells every connected Mac if anything changed. */
    fun refreshCapabilities() {
        if (capabilities.refresh()) broadcast { it.sendCapabilities() }
    }
}
