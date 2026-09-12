package com.chetan.connectsuite.mirror.v2

import android.content.Context
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.MessageType

/**
 * Wires mirroring into the link, and by doing so turns the `mirror` capability on.
 *
 * Both halves of the contract are satisfied here and nowhere else:
 *
 *  1. the handlers in [handledTypes] are registered — which covers the contract's required
 *     `mirror.start` and `mirror.stop`;
 *  2. `videoChannelSink` is assigned — the video socket now has something serving it.
 *
 * [CapabilityContract][com.chetan.connectsuite.core.link.CapabilityContract] requires both for
 * `mirror` (`needsVideoChannel = true`), so the capability flips to advertised as a *consequence*
 * of [install] running, never by being asserted anywhere. Deleting either half must take the
 * capability back off the Mac's list — that is the property `MirrorContractTest` pins down.
 *
 * `mirror.screenoff` is deliberately absent. Turning the phone's display off while mirroring needs
 * a system-signed permission this app cannot hold, so there is no honest handler to register and
 * advertising it would be the exact lie the contract exists to prevent.
 */
object MirrorFeature {

    /**
     * Every control message this feature answers.
     *
     * Single source of truth: [install] registers exactly these and [handlerFor] fails loudly on
     * anything it does not know, so the set can never drift away from what is actually wired up.
     * `MirrorContractTest` checks it against the capability contract's requirements.
     */
    val handledTypes: Set<String> = setOf(
        MessageType.MIRROR_START,
        MessageType.MIRROR_STOP,
        MessageType.MIRROR_CONFIG,
        MessageType.MIRROR_KEYFRAME,
    )

    @Volatile
    private var installed = false

    fun install(context: Context, server: LinkServer) {
        if (installed) return
        installed = true
        val appContext = context.applicationContext

        // ---- half 2 first: the video channel sink ---------------------------------------
        // Assigning the sink is a plain field write with no notification behind it, whereas
        // register() recomputes the advertised set. Doing the sink first means the last
        // register() below sees both halves in place; doing it the other way round left mirror
        // un-advertised until some unrelated refresh happened to run.
        server.videoChannelSink = { channel -> MirrorEngine.attachVideoChannel(channel) }

        // Not part of the contract: this only makes sure a refused video socket reaches the Mac
        // as a sentence instead of stopping at the phone's log.
        server.sideChannelRejected = { label, _ ->
            if (label == "video") MirrorEngine.reportUnauthorisedVideoChannel(null)
        }

        // Also not part of the capability contract, and the thing whose absence let a capture
        // outlive the Mac it was for. A handler cannot notice this: a dead session sends no
        // messages, so the only way to hear about it is to be told.
        server.sessionEndedSink = { session -> MirrorEngine.onSessionEnded(session) }

        // ---- half 1: the handlers -------------------------------------------------------
        handledTypes.forEach { type -> server.register(type, handlerFor(type, appContext)) }

        // Belt and braces: ordering above is what makes this a no-op, but the capability must not
        // depend on which line came last.
        server.refreshCapabilities()

        LinkLog.i(
            "mirror",
            "Mirror feature installed; capabilities now: ${server.capabilities.current().sorted()}",
        )
    }

    private fun handlerFor(type: String, appContext: Context): MessageHandler = when (type) {
        MessageType.MIRROR_START -> MessageHandler { session, request ->
            MirrorEngine.start(appContext, session, request, MirrorEngine.configFrom(request))
        }

        MessageType.MIRROR_STOP -> MessageHandler { session, request ->
            MirrorEngine.stop(MirrorStopReason.StoppedByMac)
            MirrorService.stop(appContext)
            session.ack(request)
        }

        MessageType.MIRROR_CONFIG -> MessageHandler { session, request ->
            // Absent means "leave it alone", which is why these are nullable rather than defaulted:
            // a `mirror.config` carrying only a bitrate must not reset the resolution cap.
            MirrorEngine.reconfigure(
                bitrate = MirrorEngine.optionalIntFrom(request, "bitrate"),
                maxResolution = MirrorEngine.optionalIntFrom(request, "maxResolution"),
            )
            session.ack(request)
        }

        MessageType.MIRROR_KEYFRAME -> MessageHandler { session, request ->
            // The ack is sent either way and that is deliberate — the Mac asked a well-formed
            // question and got an answer. What the ack does NOT mean is that a frame is coming, and
            // the log is where that distinction lives: `KeyframeTrace` on the Mac counts acks and
            // IDRs separately for exactly this reason.
            val asked = MirrorEngine.requestKeyframe()
            LinkLog.i("mirror", "mirror.keyframe from ${session.peerName}: ${if (asked) "passed to the encoder" else "no encoder, nothing asked"}")
            session.ack(request)
        }

        // Unreachable unless handledTypes gains an entry without a handler, which is precisely
        // the drift that would advertise a capability with nothing behind it.
        else -> error("MirrorFeature.handledTypes lists $type with no handler")
    }

    /**
     * Removes both halves. Exposed for tests and for the legacy-flag path: with the ADB mirror
     * enabled the v2 mirror must not also claim the capability.
     */
    fun uninstall(server: LinkServer) {
        if (!installed) return
        installed = false
        MirrorEngine.stop(MirrorStopReason.FeatureUninstalled)
        server.videoChannelSink = null
        server.sideChannelRejected = null
        server.sessionEndedSink = null
        handledTypes.forEach(server::unregister)
        server.refreshCapabilities()
    }
}
