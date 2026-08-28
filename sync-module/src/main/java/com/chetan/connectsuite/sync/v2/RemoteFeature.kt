package com.chetan.connectsuite.sync.v2

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.sync.notifications.NotificationMirrorService
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires the media remote into the link, and by doing so turns the `remote` capability on.
 *
 * ### Why this is in the same phase as notifications
 *
 * `MediaSessionManager.getActiveSessions` requires a `NotificationListenerService` component to
 * name itself with — it is gated on the notification-listener grant and on nothing else. That is
 * the entire reason `CLAUDE.md` groups the media remote with notifications rather than with the
 * mirror: one grant, two features, asked for once. Splitting them across phases would mean asking
 * the user for the same permission twice for two different reasons.
 *
 * It also means this feature has no permission of its own to check. [available] is the notification
 * listener being bound, which is exactly what `CapabilityDetector` gates `remote` on.
 */
object RemoteFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.REMOTE_STATE,
        MessageType.REMOTE_COMMAND,
    )

    @Volatile
    private var installed = false

    @Volatile
    private var server: LinkServer? = null

    @Volatile
    private var appContext: Context? = null

    /** The session we are following, so a state callback can be removed when it changes. */
    @Volatile
    private var watched: MediaController? = null

    /**
     * The manager listener, held so it can be removed — and so attaching twice is a no-op.
     *
     * Defect 31. This used to be an anonymous lambda created inside [attachSessionListener], which
     * ran only from [install] and returned early when the notification listener was not yet bound.
     * It was never retried, so on any run where the app started before notification access was
     * granted — which is what every reinstall produces — the entire unsolicited-push path was
     * absent for the life of the process.
     *
     * The feature looked completely healthy from the Mac: every `remote.state` the Mac ever saw
     * came from the explicit `pushState` at the end of `onCommand`, so the card followed the Mac's
     * own buttons perfectly and was simply never told about anything the *phone* did. A capability
     * chip honest about the grant and silent about the wiring behind it.
     */
    @Volatile
    private var sessionsListener: MediaSessionManager.OnActiveSessionsChangedListener? = null

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)
    private val pushes = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        appContext = app
        server = link

        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }
        link.addSessionReadyListener(::replayTo)
        attachSessionListener(app)
        link.refreshCapabilities()
        LinkLog.i(
            "remote",
            "Media remote installed; listener " +
                (if (available(app)) "is bound" else "is not bound") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        onListenerUnbound()
        installed = false
        link.removeSessionReadyListener(::replayTo)
        handledTypes.forEach(link::unregister)
        server = null
        appContext = null
        link.refreshCapabilities()
    }

    /** The notification-listener grant, which is this feature's only gate. */
    fun available(context: Context): Boolean = NotificationRelay.isListening()

    private fun replayTo(session: ControlSession) {
        val context = appContext ?: return
        session.send(Envelope(type = MessageType.REMOTE_STATE, payload = stateOf(context)))
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.REMOTE_STATE -> MessageHandler { session, request ->
            if (!available(context)) {
                refuse(session, request, RemoteFailure.NotGranted)
            } else {
                delivered.incrementAndGet()
                LinkLog.i("remote", "remote.state delivered — ${tally()}")
                session.ack(request) { stateOf(context).forEach { (k, v) -> put(k, v) } }
            }
        }
        MessageType.REMOTE_COMMAND -> MessageHandler { session, request -> onCommand(session, request, context) }
        else -> error("RemoteFeature.handledTypes lists $type with no handler")
    }

    // ---- state ------------------------------------------------------------------------------

    /**
     * The controller of the session that is actually playing, or the most recent one, or null.
     *
     * "Most recent" is `getActiveSessions`' own ordering — the platform puts the session with
     * priority first — but a playing session is preferred over that, because a paused podcast that
     * happens to sort first is not what the user has in mind when they reach for a play button.
     */
    private fun activeController(context: Context): MediaController? {
        if (!available(context)) return null
        val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager
            ?: return null
        val component = ComponentName(context, NotificationMirrorService::class.java)
        val sessions = runCatching { manager.getActiveSessions(component) }
            .onFailure { LinkLog.w("remote", "Could not read media sessions: ${it.message}") }
            .getOrNull()
            ?: return null
        if (sessions.isEmpty()) return null
        return sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: sessions.first()
    }

    fun stateOf(context: Context): JsonObject {
        val controller = activeController(context) ?: return buildJsonObject { put("active", false) }
        val playback = controller.playbackState
        val metadata = controller.metadata
        val actions = playback?.actions ?: 0L

        return buildJsonObject {
            put("active", true)
            put("package", controller.packageName)
            put("appName", AppLabels.of(context, controller.packageName))
            put("playing", playback?.state == PlaybackState.STATE_PLAYING)
            metadata?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)?.let { put("title", it) }
            metadata?.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST)?.let { put("artist", it) }
            metadata?.getString(android.media.MediaMetadata.METADATA_KEY_ALBUM)?.let { put("album", it) }
            metadata?.getLong(android.media.MediaMetadata.METADATA_KEY_DURATION)
                ?.takeIf { it > 0 }
                ?.let { put("durationMs", it) }
            playback?.position?.let { put("positionMs", it) }
            // Paired with the position, for the reason docs/protocol.md gives: a position with no
            // timestamp is stale the moment it is sent, and a Mac drawing a progress bar from it
            // would have to guess how stale. With the pair it can run the bar itself.
            if (playback != null) put("positionAtMs", System.currentTimeMillis())
            put("canSeek", actions and PlaybackState.ACTION_SEEK_TO != 0L)
            put("canSkipNext", actions and PlaybackState.ACTION_SKIP_TO_NEXT != 0L)
            put("canSkipPrevious", actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L)
            controller.playbackInfo?.let {
                put("volume", it.currentVolume)
                put("volumeMax", it.maxVolume)
            }
        }
    }

    // ---- commands ---------------------------------------------------------------------------

    private fun onCommand(session: ControlSession, request: Envelope, context: Context) {
        if (!available(context)) return refuse(session, request, RemoteFailure.NotGranted)
        val action = request.str("action")
            ?: return refuse(session, request, RemoteFailure.BadRequest("action is required"))
        val controller = activeController(context)
            ?: return refuse(session, request, RemoteFailure.NoSession)

        val transport = controller.transportControls
        val actions = controller.playbackState?.actions ?: 0L
        val playing = controller.playbackState?.state == PlaybackState.STATE_PLAYING

        val outcome = when (action) {
            "play" -> run { transport.play(); null }
            "pause" -> run { transport.pause(); null }
            "play_pause" -> run { if (playing) transport.pause() else transport.play(); null }
            "stop" -> run { transport.stop(); null }
            // Refused rather than dropped into a session that will ignore it. A remote that
            // silently does nothing is the failure this project keeps ruling out, and the session
            // has already told us it cannot do this.
            "next" ->
                if (actions and PlaybackState.ACTION_SKIP_TO_NEXT == 0L) {
                    RemoteFailure.Unsupported("skip to the next track", controller.packageName)
                } else {
                    transport.skipToNext(); null
                }
            "previous" ->
                if (actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS == 0L) {
                    RemoteFailure.Unsupported("skip to the previous track", controller.packageName)
                } else {
                    transport.skipToPrevious(); null
                }
            "seek" -> {
                val position = request.long("positionMs")
                when {
                    position == null -> RemoteFailure.BadRequest("seek needs positionMs")
                    actions and PlaybackState.ACTION_SEEK_TO == 0L ->
                        RemoteFailure.Unsupported("seek", controller.packageName)
                    else -> { transport.seekTo(position); null }
                }
            }
            "volume_up" -> run { controller.adjustVolume(android.media.AudioManager.ADJUST_RAISE, 0); null }
            "volume_down" -> run { controller.adjustVolume(android.media.AudioManager.ADJUST_LOWER, 0); null }
            "volume_set" -> {
                val volume = request.int("volume")
                val max = controller.playbackInfo?.maxVolume ?: 0
                if (volume == null || volume < 0 || volume > max) {
                    RemoteFailure.BadRequest("volume must be between 0 and $max")
                } else {
                    controller.setVolumeTo(volume, 0); null
                }
            }
            else -> RemoteFailure.BadRequest("\"$action\" is not one of the actions this phone accepts")
        }

        if (outcome != null) return refuse(session, request, outcome)
        delivered.incrementAndGet()
        LinkLog.i("remote", "remote.command $action delivered to ${controller.packageName} — ${tally()}")
        session.ack(request)
        // Pushed straight after, because a transport control is exactly when the Mac's card is
        // about to be wrong: the state it is drawing is the state from before the command.
        pushState(context)
    }

    // ---- pushing ------------------------------------------------------------------------------

    private val controllerCallback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) {
            appContext?.let { pushState(it) }
        }

        override fun onMetadataChanged(metadata: android.media.MediaMetadata?) {
            appContext?.let { pushState(it) }
        }

        override fun onSessionDestroyed() {
            watched = null
            appContext?.let { pushState(it) }
        }
    }

    /**
     * Follows whichever session is current, re-pointing when the platform's list changes.
     *
     * A single listener on the manager plus one callback on the current controller, rather than a
     * callback per session: the Mac only ever shows one card, and registering on every session an
     * OEM keeps alive means a push per background app whenever any of them ticks.
     */
    private fun attachSessionListener(context: Context) {
        if (sessionsListener != null) return
        if (!available(context)) {
            // Not an error and not the end of it: [onListenerBound] runs this again the moment the
            // notification listener binds. Said out loud so a log read afterwards can tell "not
            // yet" from "never", which is the distinction defect 31 turned on.
            LinkLog.i("remote", "Media session listener not attached yet: notification listener is not bound")
            return
        }
        val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return
        val component = ComponentName(context, NotificationMirrorService::class.java)
        val listener = MediaSessionManager.OnActiveSessionsChangedListener { repoint(context) }
        runCatching {
            manager.addOnActiveSessionsChangedListener(listener, component)
            sessionsListener = listener
            repoint(context)
        }.onFailure { LinkLog.w("remote", "Could not follow media sessions: ${it.message}") }
        if (sessionsListener != null) {
            // The success case, at the same volume as the failure above it, with the push count
            // beside it. That counter is the only thing that distinguishes a live push path from a
            // dead one, and its absence is precisely what let this defect hide behind a step-64
            // pass where every push came from the command handler instead.
            LinkLog.i(
                "remote",
                "Media session listener attached; phone-side changes will now reach the Mac " +
                    "(${pushes.get()} unsolicited pushes since start)",
            )
        }
    }

    /**
     * Called by [NotificationMirrorService] the moment the listener binds.
     *
     * This is the fix for defect 31. `NotificationFeature.refreshCapabilities` is invoked from the
     * same line of the same callback — so the wiring behind the capability and the chip announcing
     * it now turn on together, rather than the chip lighting over a half-dead feature.
     */
    fun onListenerBound(context: Context) {
        if (!installed) return
        attachSessionListener(context.applicationContext)
    }

    /**
     * Called when notification access goes away, so a revoke-and-regrant re-attaches cleanly.
     *
     * Without this, [attachSessionListener]'s `sessionsListener != null` guard would refuse to
     * re-attach after the platform had already dropped the registration with the service — the
     * feature would look attached and be dead, which is the shape of the defect this pair fixes.
     */
    fun onListenerUnbound() {
        val context = appContext ?: return
        sessionsListener?.let { held ->
            val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager
            runCatching { manager?.removeOnActiveSessionsChangedListener(held) }
        }
        sessionsListener = null
        watched?.unregisterCallback(controllerCallback)
        watched = null
        LinkLog.i("remote", "Media session listener detached: notification access went away")
    }

    private fun repoint(context: Context) {
        val next = activeController(context)
        val current = watched
        if (current?.sessionToken == next?.sessionToken) return
        current?.unregisterCallback(controllerCallback)
        watched = next
        next?.registerCallback(controllerCallback)
        pushState(context)
    }

    private fun pushState(context: Context) {
        val link = server ?: return
        val payload = runCatching { stateOf(context) }.getOrNull() ?: return
        pushes.incrementAndGet()
        link.broadcast { session ->
            session.send(Envelope(type = MessageType.REMOTE_STATE, payload = payload))
        }
    }

    // ---- plumbing -----------------------------------------------------------------------------

    private fun refuse(session: ControlSession, request: Envelope, failure: RemoteFailure) {
        refused.incrementAndGet()
        LinkLog.w("remote", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.REMOTE,
            fixHint = failure.fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()

    private fun Envelope.long(key: String): Long? =
        payload[key]?.jsonPrimitive?.content?.toLongOrNull()
}

/** Every way a media-remote request can fail, each with the sentence a person reads. */
sealed class RemoteFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    /**
     * Same grant as notifications, and the sentence says so.
     *
     * A user told "the media remote needs a permission" would go looking for a media permission
     * and not find one. Naming the notification setting is the only actionable form of this.
     */
    object NotGranted : RemoteFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "The media remote needs the same notification access as notification mirroring, " +
            "and this phone has not granted it.",
        fixHint = "On the phone: Settings > Notifications > Device & app notifications, and " +
            "allow ConnectSuite.",
    )

    object NoSession : RemoteFailure(
        label = "no-session",
        code = ErrorCode.NO_MEDIA_SESSION,
        reason = "Nothing is playing on the phone, so there is nothing to control.",
    )

    class Unsupported(what: String, packageName: String) : RemoteFailure(
        label = "unsupported",
        code = ErrorCode.FEATURE_UNAVAILABLE,
        reason = "$packageName does not let anything $what from outside the app.",
    )

    class BadRequest(detail: String) : RemoteFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was sent.",
    )
}
