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
    /**
     * The last `hello` turned away for a **pairing** reason, for the phone's own screen.
     *
     * Distinct from [lastRefusal] and not a substitute for it: a refusal happens *at the TLS
     * handshake*, when the certificate is not pinned; this happens **after** TLS succeeded, to a
     * Mac this phone trusts or is armed for, because its pairing was expired, unproven or absent
     * ([PhonePairing]). The two are different failures and neither substitutes for the other, and
     * that stays true of the two fields.
     *
     * It existed only as a `pair.rejected` message to the Mac and a log line. The phone showed the
     * user a plain wait, and at best a locally-derived timeout guess, while the server knew exactly
     * which of three things had gone wrong and already had the sentence written.
     */
    val lastPairReject: PairRejection? = null,
) {
    val isConnected: Boolean get() = clients.isNotEmpty()

    /**
     * The state after a `hello` was turned away over its pairing token.
     *
     * Extracted onto the state rather than written inline in `LinkServer`, for the reason defect 67
     * is in `CLAUDE.md`: `LinkServer` needs a `Context` and an Android Keystore, so **no JVM test
     * can reach a write that happens inside it**. A suite can then prove the decision perfectly and
     * be entirely silent about whether the field is ever set — which is how a feature ships having
     * never once worked. With the transition here, `PairRejectStageTest` calls exactly what the
     * server calls, and what is left unreached is a single line at the call site.
     */
    fun afterPairRejected(reason: PairRejectReason, nowMillis: Long): LinkState =
        copy(lastPairReject = PairRejection(reason, nowMillis))

    /**
     * The state after the accept loops come up.
     *
     * A fresh listen is a fresh wait, and a refusal from the previous session is not an explanation
     * for this one's silence.
     */
    fun afterListeningStarted(nowMillis: Long): LinkState = copy(
        running = true,
        lastError = null,
        // A fresh listen is a fresh wait, so a pairing rejected before it is not an explanation
        // for this one's silence — the same reasoning `lastRefusal` is cleared under.
        lastPairReject = null,
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
    /**
     * A Mac's control session is up. Named, like [afterSessionEnded], so the connect edge is a call
     * a JVM test can make rather than a `copy()` inside [LinkServer] no test can reach — defect 145's
     * projection is checked across connect, drop and reconnect through these two, not by hand.
     */
    fun afterSessionReady(peerName: String): LinkState = copy(clients = clients + peerName)

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

    /**
     * Whether this is a debuggable build. One of the two fences on advertising `share.file` 2
     * ([Extensions.advertised]); a release build is never debuggable.
     */
    val debuggable: Boolean =
        (appContext.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    val identity: DeviceIdentity = DeviceIdentity.get(appContext)
    val trustStore = TrustStore(appContext)
    val sessions = SessionRegistry<ControlSession>()

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
        cameraChannelServed = { cameraChannelSink != null },
        webcamChannelServed = { webcamChannelSink != null },
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

    // Pairing has its own pair of counters for the same reason: "3 pairings refused" says nothing
    // until you know whether any has ever succeeded.
    private val pairRejected = java.util.concurrent.atomic.AtomicInteger()
    private val pairAccepted = java.util.concurrent.atomic.AtomicInteger()

    fun countPairRejected(): Int = pairRejected.incrementAndGet()
    fun pairAcceptedCount(): Int = pairAccepted.get()

    private val _state = MutableStateFlow(LinkState())
    val state: StateFlow<LinkState> = _state.asStateFlow()

    /** Set by mirror-module in phase 2; until then a video socket is refused with a reason. */
    @Volatile
    var videoChannelSink: ((AuthenticatedChannel) -> Unit)? = null

    /**
     * Set by camera-module: the consumer of a **camera claim** on the video port
     * (docs/protocol.md → The stream claim on 42502). A separate slot from [videoChannelSink] on
     * purpose — a token-only socket is the mirror's and must never reach the camera, and a camera
     * claim must never reach [MirrorEngine]'s `attachVideoChannel`, which replaces whatever video
     * socket it already holds.
     */
    @Volatile
    var cameraChannelSink: ((AuthenticatedChannel, SideChannelClaim.Camera) -> Unit)? = null

    /**
     * Set by camera-module's webcam feature: the consumer of a **webcam claim** on the video port
     * (docs/protocol.md → The webcam stream claim on 42502). Its own slot, for [cameraChannelSink]'s
     * reason: a webcam claim must never reach Camera v1, nor a camera claim the webcam. Null unless the
     * gated install ran — so `webcam` is not advertised and a webcam claim is refused here.
     */
    @Volatile
    var webcamChannelSink: ((AuthenticatedChannel, SideChannelClaim.Webcam) -> Unit)? = null

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
     * Further session-ended consumers — **the list the comment above asks for**, added for Camera v1
     * rather than taking the mirror's slot. A camera stream exists to feed one Mac, exactly as a
     * capture does, so it has the same need: when the owning session ends, nothing may keep the
     * camera open. [sessionEndedSink] stays as it is so the mirror's wiring is untouched.
     */
    private val sessionEndedListeners = java.util.concurrent.CopyOnWriteArrayList<(ControlSession) -> Unit>()

    fun addSessionEndedListener(listener: (ControlSession) -> Unit) {
        sessionEndedListeners.add(listener)
    }

    fun removeSessionEndedListener(listener: (ControlSession) -> Unit) {
        sessionEndedListeners.remove(listener)
    }

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

    /**
     * Pairing v2 (`docs/protocol.md` → *Pairing (version 2)*; audit S1). The armed pairing, its secret,
     * its lifetime and its failure limit live here, in memory only; the control session asks it for
     * the two decisions. Nothing is trusted until [PhonePairing.onConfirm] accepts.
     */
    val pairing = PhonePairing()

    /** Called by the QR scanner once the user has scanned a Mac's pairing code. */
    /**
     * Told the fingerprint this phone is currently expecting, or null when it is expecting nobody.
     *
     * `LinkService` points this at the mDNS advertiser. It is a sink rather than a direct call
     * because `LinkServer` has no business knowing that mDNS exists, and because the advertiser
     * outlives individual pairings.
     */
    var pairIntentSink: ((String?) -> Unit)? = null

    /**
     * Arms a pairing for a scanned **v2** code. Trusts nothing: the Mac's fingerprint is admitted at
     * TLS while the arm lasts and is persisted only after it proves the code ([persistPairing]).
     */
    fun completePairing(payload: PairingQrPayload) {
        val secret = requireNotNull(payload.secret) { "not a v2 pairing code" }
        pairing.arm(payload.peerId, secret, payload.name, payload.host)
        LinkLog.i("trust", "Pairing armed for ${payload.name} (${payload.peerId.take(16)}…) — waiting for it to prove the code")
        // F6: from here until the Mac connects or the arm ends, the discovery record says which Mac
        // this phone is waiting for. It decides nothing: an impostor advertising it still cannot prove
        // the code.
        runCatching { pairIntentSink?.invoke(payload.peerId) }
    }

    /** Cancel on the phone's pairing screen: the secret is dropped and the TLS admission ends. */
    fun cancelPairing() {
        pairing.cancel()
        clearPairIntent()
        LinkLog.i("trust", "Pairing cancelled on this phone")
    }

    /**
     * Persists a Mac whose `pair.confirm` verified. Called by the control session **before** it sends
     * `hello.ack`, so a Mac is never served data it has not been trusted for.
     */
    suspend fun persistPairing(paired: PhonePairing.Paired) {
        trustStore.trustAuthenticated(paired)
        clearPairIntent()
        pairAccepted.incrementAndGet()
    }

    /** Whether [fingerprint]'s trust came from pairing v2; false for a legacy record. */
    fun isPairedV2(fingerprint: String): Boolean = trustStore.isPairedV2(fingerprint)

    /**
     * Forget a peer **and end any session it is currently holding**.
     *
     * `trustStore.forget` alone deletes the row and reloads the cache, and does nothing about the
     * connection that trust already authorised. Measured on hardware 2026-09-03: after a `Forget`
     * tap the control session stayed `ESTABLISHED` for over a minute, with the Mac still able to
     * read notifications, texts, files and the clipboard. The refusal only takes effect on the
     * *next* handshake, which may be never while the link stays up.
     *
     * Revoking access has to revoke the access, so this is the entry point the UI calls and
     * `TrustStore.forget` becomes the storage half of it rather than the whole operation.
     */
    suspend fun forgetAndDisconnect(deviceId: String) {
        trustStore.forget(deviceId)
        val target = PairingQrPayload.normalizeFingerprint(deviceId)
        val dropped = liveSessions.keys.filter {
            PairingQrPayload.normalizeFingerprint(it.peerFingerprint) == target
        }
        dropped.forEach { it.close("pairing removed on this phone") }
        LinkLog.i(
            "trust",
            "Forgot ${deviceId.take(16)}… and closed ${dropped.size} live session(s) — " +
                "${liveSessions.size - dropped.size} other session(s) left alone",
        )
    }

    /** Clears the advertised intent once the pairing is resolved, either way. */
    private fun clearPairIntent() {
        runCatching { pairIntentSink?.invoke(null) }
    }

    /**
     * Publish a pairing rejection. **One writer**, deliberately.
     *
     * Every refusal path in `ControlSession.refusePairing` comes through here, so the decision stays in
     * [PhonePairing] and the *write* happens once — a new reason cannot forget to publish itself.
     */
    fun publishPairRejected(reason: PairRejectReason) {
        if (reason == PairRejectReason.TOKEN_EXPIRED || reason == PairRejectReason.TOO_MANY_ATTEMPTS) clearPairIntent()
        _state.update { it.afterPairRejected(reason, System.currentTimeMillis()) }
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
            controlSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_CONTROL, pairing::pendingFingerprint)
            videoSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_VIDEO, pairing::pendingFingerprint)
            bulkSocket = LinkTls.serverSocket(identity, trustStore, Link.PORT_BULK, pairing::pendingFingerprint)
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
                // Set once the frame is known to be a camera claim, so a refusal is reported to the
                // camera and never, through sideChannelRejected, to the mirror's owner as an
                // unauthorised video socket — a sentence about the wrong feature.
                var cameraClaim = false
                try {
                    val channelPeer = LinkTls.handshake(socket)
                    socket.tcpNoDelay = true
                    socket.soTimeout = Link.TOKEN_GRACE_MS.toInt()
                    val input = BufferedInputStream(socket.getInputStream())
                    val tokenFrame = Framing.readFrame(input, 128)
                        ?: throw IOException("no token frame")
                    val frameText = String(tokenFrame, Charsets.UTF_8)
                    cameraClaim = frameText.trim().contains(' ')
                    val claim = SideChannelClaim.parse(frameText)
                        ?: throw IOException("malformed channel claim")
                    // S2b: the token must belong to a live session **of this Mac** — a token is bound to its
                    // session's peer, so another trusted Mac holding it authorises nothing.
                    val session = when (val verdict = SideChannelAuth.authorize(claim.token, channelPeer, sessions::resolve) { it.peerFingerprint }) {
                        is SideChannelAuth.Verdict.Authorized -> verdict.session
                        is SideChannelAuth.Verdict.Refused -> throw IOException(verdict.reason)
                    }
                    socket.soTimeout = 0

                    if (claim is SideChannelClaim.Webcam) {
                        // docs/protocol.md → The webcam stream claim on 42502: the video port only.
                        if (label != "video") throw IOException("a webcam claim on the $label port")
                        val webcam = webcamChannelSink
                        if (webcam == null) {
                            LinkLog.w("server", "webcam claim refused: nothing is serving it in this build")
                            runCatching { socket.close() }
                            return@launch
                        }
                        // As for the camera: ownership, the session id and its phase are the webcam's
                        // to judge; this layer has proved only that the token is a live session's.
                        LinkLog.i("server", "webcam claim for session ${claim.sessionId.take(8)}… from ${session.peerName}")
                        webcam(AuthenticatedChannel(socket, session, input), claim)
                        return@launch
                    }

                    if (claim is SideChannelClaim.Camera) {
                        // docs/protocol.md → The stream claim on 42502: the video port only. A camera
                        // claim on the bulk port is not a camera socket and not a transfer either.
                        if (label != "video") throw IOException("a camera claim on the $label port")
                        val camera = cameraChannelSink
                        if (camera == null) {
                            LinkLog.w("server", "camera claim refused: nothing is serving it in this build")
                            runCatching { socket.close() }
                            return@launch
                        }
                        // Ownership, the stream id and the stream's phase are the camera's to judge;
                        // this layer has proved only that the token belongs to a live session.
                        LinkLog.i("server", "camera claim for stream ${claim.streamId.take(8)}… from ${session.peerName}")
                        camera(AuthenticatedChannel(socket, session, input), claim)
                        return@launch
                    }

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
                    // A refused camera claim is the camera's business: its owner, if any, learns of it
                    // through the stream that never attaches (`stream-closed`), never as a mirror error.
                    if (cameraClaim) return@launch
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
        _state.update { it.afterSessionReady(session.peerName) }
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
        // Each guarded on its own, like the session-ready listeners: one feature failing to tear
        // down must not leave another feature's camera or capture running.
        sessionEndedListeners.forEach { listener ->
            runCatching { listener(session) }
                .onFailure { LinkLog.w("server", "Session-ended listener failed: ${it.message}") }
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
