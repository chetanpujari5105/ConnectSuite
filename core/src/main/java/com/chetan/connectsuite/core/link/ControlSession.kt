package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.FeatureOf
import com.chetan.connectsuite.core.protocol.Link
import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.core.protocol.ProtocolException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket

/** A feature module's handler for one message type. Registered on [LinkServer]. */
fun interface MessageHandler {
    suspend fun handle(session: ControlSession, request: Envelope)
}

/**
 * One authenticated control connection, from the TLS handshake to the socket closing.
 *
 * The session owns the session token that the video and bulk sockets have to present, so when
 * this connection dies those channels lose their authorisation with it.
 */
class ControlSession(
    private val socket: SSLSocket,
    val peerFingerprint: String,
    private val server: LinkServer,
) {
    private val input = BufferedInputStream(socket.getInputStream())
    private val output = BufferedOutputStream(socket.getOutputStream())
    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * The one thread allowed to write to this socket.
     *
     * [send] used to write on whatever thread called it, which was fine while every caller was a
     * message handler on [Dispatchers.IO] and fatal the moment one was not: the Mirror tab's
     * buttons call into the engine from a Compose click, the engine reports its phase, and the
     * write landed on the main thread as a `NetworkOnMainThreadException` that killed the process.
     * Moving the write here fixes that for every caller at once rather than asking each one to
     * remember which thread it is on.
     *
     * Single-threaded, so frames keep the order they were sent in — an ack must not overtake the
     * event that follows it. The queue is unbounded, which is safe only because control frames are
     * small and rare and a peer that stops reading is disconnected by the heartbeat within ~15s.
     */
    private val sender = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "control-tx-${socket.inetAddress?.hostAddress ?: "?"}").apply {
            isDaemon = true
        }
    }

    var token: String? = null
        private set
    var peerName: String = "Mac"
        private set
    var isHandshakeComplete: Boolean = false
        private set

    /**
     * Extensions negotiated for this session (docs/protocol.md → Extensions): name → version, for
     * every extension both sides advertised. Fixed at `hello`; rule 5 says nothing renegotiates it.
     * Empty for an old Mac that sends no `ext`, which is how the phone knows not to offer.
     */
    @Volatile var negotiated: Map<String, Int> = emptyMap()
        private set

    val remoteAddress: String? get() = socket.inetAddress?.hostAddress

    /**
     * Set when the peer stops answering; surfaced to the user as the disconnect reason.
     *
     * Volatile because the sender thread can now be the one that discovers the socket is dead,
     * and the read loop is what reports this.
     */
    @Volatile
    var closeReason: String = DEFAULT_CLOSE_REASON
        private set

    /**
     * Queues one frame for the peer. Never blocks the caller on the socket, and never throws.
     *
     * Safe to call from any thread, including the main one — that is the whole point of it.
     */
    /**
     * Returns whether the frame was **queued** — `false` when the session is already shutting down and
     * the frame was dropped. Queued is not delivered: a frame queued just before the socket fails can
     * still be lost. Callers that must not overclaim (defect 157: a pull's verdict) read it.
     */
    fun send(envelope: Envelope): Boolean {
        // Encoding stays on the caller's thread: it is pure CPU, and it keeps a payload stamped at
        // the moment of the call rather than whenever the queue happens to drain. The pong's
        // monotonic clock reading is the one that would go wrong if this moved.
        val frame = Envelope.encode(envelope)
        val type = envelope.type
        try {
            sender.execute {
                try {
                    // The cap is named here rather than defaulted: this channel reads at
                    // MAX_CONTROL_FRAME, and a write side silently defaulting to MAX_FRAME would
                    // refuse frames the far end would happily have accepted. A write cap that
                    // disagrees with its own read cap is the bug the write side is meant to catch.
                    Framing.writeFrame(output, frame, Link.MAX_CONTROL_FRAME)
                } catch (e: IOException) {
                    LinkLog.w("control", "Send failed for $type", e)
                    // Not close(): this *is* the sender, the write has already failed, and there
                    // is nothing left to drain. Closing the socket unblocks the read loop, which
                    // reports the reason set here.
                    //
                    // Only when nothing better has been said already: a send that fails *because*
                    // someone closed the session would otherwise replace "service stopping" with
                    // "send failed: Socket closed", which names the symptom instead of the cause.
                    if (closeReason == DEFAULT_CLOSE_REASON) {
                        closeReason = "send failed: ${e.message}"
                    }
                    runCatching { socket.close() }
                }
            }
            return true
        } catch (e: RejectedExecutionException) {
            // The session is already shutting down. Saying so beats a frame vanishing quietly.
            LinkLog.w("control", "Dropped $type: the session is closing")
            return false
        }
    }

    fun sendError(
        requestId: String,
        code: String,
        message: String,
        feature: String? = null,
        fixHint: String? = null,
    ) {
        send(Envelope.error(requestId, code, feature, message, fixHint))
    }

    /** Blocking read loop. Returns when the peer disconnects or violates the protocol. */
    fun run() {
        socket.soTimeout = Link.CONTROL_IDLE_TIMEOUT_MS.toInt()
        try {
            while (true) {
                val frame = Framing.readFrame(input, Link.MAX_CONTROL_FRAME) ?: break
                val envelope = try {
                    Envelope.decode(frame)
                } catch (e: Exception) {
                    throw ProtocolException("Undecodable control frame: ${e.message}")
                }
                dispatch(envelope)
            }
            closeReason = "peer closed the connection"
        } catch (e: java.net.SocketTimeoutException) {
            closeReason = "no traffic for ${Link.CONTROL_IDLE_TIMEOUT_MS / 1000}s"
            LinkLog.w("control", "$peerName idle timeout")
        } catch (e: ProtocolException) {
            closeReason = "protocol error: ${e.message}"
            LinkLog.e("control", "Protocol error from $peerName", e)
        } catch (e: IOException) {
            closeReason = "socket error: ${e.message}"
            LinkLog.w("control", "$peerName socket dropped", e)
        } catch (e: Exception) {
            // Without this, anything unchecked thrown out of dispatch() left closeReason at its
            // "closed" default — the exact symptom docs/testing.md calls out as a path that has
            // forgotten to name its cause, surfaced to the user as "Last disconnect: closed".
            closeReason = "unexpected ${e.javaClass.simpleName}: ${e.message ?: "no detail"}"
            LinkLog.e("control", "Unexpected failure in session with $peerName", e)
        } finally {
            server.sessions.revoke(token)
            flushAndStopSender()
            runCatching { socket.close() }
            server.onSessionEnded(this)
            LinkLog.i("control", "Session with $peerName ended: $closeReason")
        }
    }

    /**
     * Lets whatever is already queued reach the wire, then stops the sender thread.
     *
     * The protocol-mismatch and pre-hello paths send their error frame and throw in the same
     * breath, so closing the socket the instant the read loop unwinds would take the reason with
     * it and leave the Mac with a bare disconnect — the unnamed failure this project keeps ruling
     * out. Bounded, because a peer that has stopped reading must not hold the session open.
     */
    private fun flushAndStopSender() {
        sender.shutdown()
        val drained = runCatching {
            sender.awaitTermination(SENDER_DRAIN_MS, TimeUnit.MILLISECONDS)
        }.getOrDefault(false)
        if (!drained) {
            LinkLog.w("control", "Unsent frames dropped: sender did not drain in ${SENDER_DRAIN_MS}ms")
            sender.shutdownNow()
        }
    }

    private fun dispatch(envelope: Envelope) {
        if (envelope.v != Link.PROTOCOL_MAJOR) {
            sendError(
                envelope.id,
                ErrorCode.PROTOCOL_MISMATCH,
                "This phone speaks protocol v${Link.PROTOCOL_MAJOR}, the Mac sent v${envelope.v}. " +
                    "Update whichever app is older.",
            )
            throw ProtocolException("Protocol major mismatch: ${envelope.v}")
        }

        when (envelope.type) {
            MessageType.HELLO -> onHello(envelope)
            // The pong carries the phone's monotonic clock — the same clock that stamps video
            // frame PTS — so the Mac can work out the offset between the two machines and read a
            // frame's PTS as a latency rather than as a number from somewhere else.
            MessageType.PING -> send(
                Envelope.of(MessageType.PONG, envelope.id) {
                    put("monoUs", System.nanoTime() / 1_000)
                },
            )
            else -> {
                if (!isHandshakeComplete) {
                    sendError(
                        envelope.id,
                        ErrorCode.UNAUTHORIZED,
                        "Send hello before ${envelope.type}",
                    )
                    throw ProtocolException("${envelope.type} before hello")
                }
                val handler = server.handlerFor(envelope.type)
                if (handler == null) {
                    // Unimplemented rather than unknown: later phases fill these in, and the Mac
                    // needs a definite answer either way instead of a silent drop.
                    sendError(
                        envelope.id,
                        ErrorCode.FEATURE_UNAVAILABLE,
                        "${envelope.type} is not implemented on this phone build yet",
                        feature = FeatureOf.of(envelope.type),
                    )
                    return
                }
                scope.launch {
                    try {
                        handler.handle(this@ControlSession, envelope)
                    } catch (e: Exception) {
                        LinkLog.e("control", "Handler for ${envelope.type} threw", e)
                        sendError(
                            envelope.id,
                            ErrorCode.FEATURE_UNAVAILABLE,
                            e.message ?: "Handler failed",
                            feature = FeatureOf.of(envelope.type),
                        )
                    }
                }
            }
        }
    }

    private fun onHello(envelope: Envelope) {
        val payload = envelope.payload
        peerName = payload["deviceName"]?.jsonPrimitive?.content ?: "Mac"

        // A QR scan arms a one-time token; the first Mac to connect after it must present it.
        // Fingerprint pinning already proved the certificate, so this only closes the window
        // where a QR photographed off someone's screen could be replayed by a third machine.
        val pairToken = payload["pairToken"]?.jsonPrimitive?.content
        when (val verdict = server.acceptPairToken(peerFingerprint, pairToken)) {
            is PairTokenVerdict.Accepted -> Unit
            is PairTokenVerdict.Rejected -> {
                // F7. The `error` goes first so an older Mac, which knows nothing of
                // `pair.rejected`, still sees exactly what it saw before — the new message is
                // additive and a Mac that ignores it is no worse off than yesterday.
                sendError(envelope.id, ErrorCode.UNAUTHORIZED, verdict.reason.message)
                send(
                    Envelope.of(MessageType.PAIR_REJECTED, envelope.id) {
                        put("reason", verdict.reason.name)
                        put("fingerprint", peerFingerprint)
                        put("message", verdict.reason.message)
                    },
                )
                LinkLog.w(
                    "control",
                    "Pairing refused for ${peerFingerprint.take(23)}…: ${verdict.reason} — " +
                        "${server.countPairRejected()} refused / ${server.pairAcceptedCount()} " +
                        "paired since start",
                )
                throw ProtocolException("bad pair token: ${verdict.reason}")
            }
        }

        val sessionToken = server.sessions.issue(this)
        token = sessionToken
        // Rules 1-4, after the version and pairing checks above (rule 6). An absent `ext` is `{}`.
        // The development arm is consumed HERE — after the Mac was accepted, so a refused Mac neither
        // gets share.file 2 nor uses the arm up — and read once, so negotiation and hello.ack below
        // are one decision (ShareDevGate, Extensions.handshake).
        val macExt = Extensions.parse(payload["ext"])
        val handshake = Extensions.handshake(
            server.debuggable, ShareDevGate.process.consumeForHandshake(), macExt,
            holdV2 = ShareDevGate.holdV2.consumeForHandshake(),
        )
        negotiated = handshake.negotiated
        LinkLog.i("control", handshake.logLine)
        LinkLog.i("control", handshake.askLine)
        LinkLog.i("control", handshake.v3Line)
        LinkLog.i("control", handshake.filesLine)
        isHandshakeComplete = true

        send(
            Envelope.of(MessageType.HELLO_ACK, envelope.id) {
                put("protocolVersion", Link.PROTOCOL_MAJOR)
                put("appVersion", server.appVersion)
                put("deviceName", server.identity.deviceName)
                put("deviceId", server.identity.deviceId)
                put("fingerprint", server.identity.fingerprint)
                put("sessionToken", sessionToken)
                put("capabilities", capabilitiesJson())
                put("unavailable", unavailableJson())
                put("limited", limitedJson())
                // Optional: an old Mac reads hello.ack fields by key and never sees it.
                put("ext", Extensions.toJson(handshake.advertised))
            },
        )
        server.onSessionReady(this)
        LinkLog.i("control", "Handshake complete with $peerName at $remoteAddress")
    }

    /** Pushed whenever a permission flips, so the Mac's greyed-out panes update live. */
    fun sendCapabilities() {
        if (!isHandshakeComplete) return
        send(
            Envelope.of(MessageType.CAPABILITIES_CHANGED) {
                put("capabilities", capabilitiesJson())
                put("unavailable", unavailableJson())
                put("limited", limitedJson())
            },
        )
    }

    private fun capabilitiesJson() =
        JsonArray(server.capabilities.current().sorted().map { JsonPrimitive(it) })

    /**
     * The capabilities that are *not* on offer, each with the sentence saying why.
     *
     * The reason has always been computed — [CapabilityStatus.reason] is what the phone's own
     * diagnostics screen renders — and until now it stopped at the phone's edge, so the Mac could
     * name what was missing and never say why (defect 24). This is the success case's denominator
     * in wire form: `capabilities` alone is a count without one.
     */
    /**
     * Capabilities that are on offer but work only in part, each with the phone's sentence (defect
     * 139): today, `photos` on selected-only access. Same shape as `unavailable` and optional on the
     * wire in the same way — see docs/protocol.md, "`limited`".
     */
    private fun limitedJson() = JsonArray(
        server.capabilities.limited().entries
            .sortedBy { it.key }
            .map { (name, reason) ->
                buildJsonObject {
                    put("name", JsonPrimitive(name))
                    put("reason", JsonPrimitive(reason))
                }
            },
    )

    private fun unavailableJson() = JsonArray(
        server.capabilities.unavailable().entries
            .sortedBy { it.key }
            .map { (name, reason) ->
                buildJsonObject {
                    put("name", JsonPrimitive(name))
                    put("reason", JsonPrimitive(reason))
                }
            },
    )

    fun close(reason: String) {
        closeReason = reason
        runCatching { socket.close() }
    }

    /** Convenience for handlers that just need to answer "done". */
    fun ack(request: Envelope, build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}) =
        send(Envelope.ack(request.id, build))

    fun event(type: String, build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}) =
        send(Envelope(type = type, payload = buildJsonObject(build)))

    private companion object {
        /** How long a closing session waits for already-queued frames to reach the wire. */
        const val SENDER_DRAIN_MS = 1_000L

        /** The stand-in that means "nothing has named this disconnect yet". */
        const val DEFAULT_CLOSE_REASON = "closed"
    }
}
