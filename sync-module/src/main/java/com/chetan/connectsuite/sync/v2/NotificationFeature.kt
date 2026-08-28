package com.chetan.connectsuite.sync.v2

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires notifications into the link, and by doing so turns the `notifications` capability on.
 *
 * Modelled on `InputFeature`, and for the same reason: handlers are registered from app start
 * whether or not the listener is bound, so a `notif.reply` arriving with notification access off
 * comes back with "here is how to turn it on" rather than "not implemented on this phone build".
 * Only a registered handler can say the first one. The capability stays un-advertised throughout —
 * `CapabilityDetector` gates it on the grant — so a well-behaved Mac never sends it, and a grant
 * revoked mid-flight is answered rather than dropped.
 *
 * The events go the other way and are pushed, not polled. `NotificationRelay` hands them here and
 * this broadcasts them to every live Mac.
 */
object NotificationFeature {

    /**
     * The three the `notifications` contract requires.
     *
     * `notif.posted` and `notif.removed` are absent on purpose: the phone *sends* those and never
     * handles them, so requiring a handler for one could never be satisfied — see the note at the
     * top of `CapabilityContract`.
     */
    val handledTypes: Set<String> = setOf(
        MessageType.NOTIF_REPLY,
        MessageType.NOTIF_ACTION,
        MessageType.NOTIF_DISMISS,
    )

    @Volatile
    private var installed = false

    @Volatile
    private var server: LinkServer? = null

    @Volatile
    private var appContext: Context? = null

    // The denominator, per CLAUDE.md. A refusal count with no delivery count beside it reads as
    // whichever story the reader already believes — which is exactly how defect 18 survived 187
    // refusals with a success count of zero.
    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)
    private val posted = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        appContext = app
        server = link

        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }

        // The third gate. The notification-listener *grant* survives a reinstall; the bound
        // service does not, and Android does not rebind it — so without this the capability is
        // advertised forever with nothing behind it. Only this module can answer the question,
        // because only it holds the service reference.
        link.capabilities.requireRunning(CapabilityContract.SpecialAccess.NOTIFICATION_LISTENER) {
            NotificationRelay.isListening()
        }

        // Push, not poll. The relay is the only thing that knows a notification arrived.
        NotificationRelay.onPosted = { payload -> broadcast(MessageType.NOTIF_POSTED, payload) }
        NotificationRelay.onRemoved = { key ->
            link.broadcast { session -> session.event(MessageType.NOTIF_REMOVED) { put("key", key) } }
        }

        // Replay on connect — part of the contract in docs/protocol.md. Without it a Mac that
        // connects to a quiet phone shows an empty list, which is indistinguishable from a broken
        // feature until something happens to arrive.
        link.addSessionReadyListener(::replayTo)

        link.refreshCapabilities()
        LinkLog.i(
            "notif",
            "Notification feature installed; listener " +
                (if (NotificationRelay.isListening()) "is bound" else "is not bound") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        NotificationRelay.onPosted = null
        NotificationRelay.onRemoved = null
        link.removeSessionReadyListener(::replayTo)
        handledTypes.forEach(link::unregister)
        server = null
        appContext = null
        link.refreshCapabilities()
    }

    /** Re-checks the grant and tells every Mac. Called by the listener service when it binds. */
    fun refreshCapabilities() {
        server?.refreshCapabilities()
    }

    private fun broadcast(type: String, payload: JsonObject) {
        val link = server ?: return
        posted.incrementAndGet()
        link.broadcast { session -> session.send(Envelope(type = type, payload = payload)) }
    }

    /**
     * Sends every notification currently on the shade to one Mac that has just connected.
     *
     * Counted and logged with its size, because "replayed" with no number is the same missing
     * denominator: a replay of zero on a phone with a full shade and a replay of zero on an empty
     * one produce the same line, and only one of them is a bug.
     */
    private fun replayTo(session: ControlSession) {
        val context = appContext ?: return
        if (!NotificationRelay.isListening()) {
            LinkLog.i("notif", "No replay for ${session.peerName}: notification access is off")
            return
        }
        val active = NotificationRelay.active(context)
        active.forEach { payload ->
            session.send(Envelope(type = MessageType.NOTIF_POSTED, payload = payload))
        }
        // Summaries are counted out loud because the Mac hides them: without this, "Replayed 7"
        // against a shade a person counts as six rows reads as a bug in a feature that is working.
        val summaries = active.count { it["isGroupSummary"]?.jsonPrimitive?.booleanOrNull == true }
        val summaryWord = if (summaries == 1) "summary" else "summaries"
        LinkLog.i(
            "notif",
            "Replayed ${active.size} active ($summaries $summaryWord) to ${session.peerName}",
        )
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.NOTIF_REPLY -> MessageHandler { session, request -> onReply(session, request, context) }
        MessageType.NOTIF_ACTION -> MessageHandler { session, request -> onAction(session, request, context) }
        MessageType.NOTIF_DISMISS -> MessageHandler { session, request -> onDismiss(session, request) }
        // Unreachable unless handledTypes gains an entry with no handler, which is exactly the
        // drift that would advertise a capability with nothing behind it.
        else -> error("NotificationFeature.handledTypes lists $type with no handler")
    }

    // ---- handlers -------------------------------------------------------------------------

    private fun onReply(session: ControlSession, request: Envelope, context: Context) {
        val key = request.str("key") ?: return refuse(session, request, NotificationFailure.MissingKey)
        val text = request.str("text")
            ?: return refuse(session, request, NotificationFailure.BadRequest("text is required"))

        val sbn = ready(session, request, key) ?: return
        if (!targetStillMatches(session, request, sbn)) return
        val (action, _) = NotificationRelay.replyActionOf(sbn.notification)
            ?: return refuse(session, request, NotificationFailure.NoReplyAction(sbn.packageName))

        val inputs = NotificationRelay.freeFormInputs(action)
        if (inputs.isEmpty()) {
            return refuse(session, request, NotificationFailure.NoReplyAction(sbn.packageName))
        }

        // The reply is delivered by firing the app's own PendingIntent with the text attached, so
        // it reaches the app exactly as a reply typed on the phone would — same intent, same
        // result key, same code path inside the app. Anything else would be a simulation of a
        // reply rather than a reply.
        val fill = Intent()
        val results = android.os.Bundle().apply {
            inputs.forEach { input -> putCharSequence(input.resultKey, text) }
        }
        android.app.RemoteInput.addResultsToIntent(inputs.toTypedArray(), fill, results)

        val sent = runCatching { action.actionIntent.send(context, 0, fill) }
        if (sent.isFailure) {
            val cause = sent.exceptionOrNull()
            val detail = if (cause is PendingIntent.CanceledException) {
                "the app cancelled it"
            } else {
                cause?.message ?: "no reason given"
            }
            return refuse(session, request, NotificationFailure.IntentRefused(sbn.packageName, detail))
        }
        deliver(session, request, "reply to ${sbn.packageName}")
    }

    private fun onAction(session: ControlSession, request: Envelope, context: Context) {
        val key = request.str("key") ?: return refuse(session, request, NotificationFailure.MissingKey)
        val index = request.int("index")
            ?: return refuse(session, request, NotificationFailure.BadRequest("index is required"))

        val sbn = ready(session, request, key) ?: return
        if (!targetStillMatches(session, request, sbn)) return
        val actions: Array<Notification.Action> = sbn.notification.actions
            ?: return refuse(session, request, NotificationFailure.NoSuchAction(index, 0))
        if (index !in actions.indices) {
            return refuse(session, request, NotificationFailure.NoSuchAction(index, actions.size))
        }

        val action = actions[index]
        // An action with a free-form input is a reply in disguise. Firing it with no text produces
        // an empty reply in the user's conversation, which is worse than refusing: it is visible
        // to someone else and cannot be taken back.
        if (NotificationRelay.freeFormInputs(action).isNotEmpty()) {
            return refuse(session, request, NotificationFailure.ActionNeedsText(action.title?.toString().orEmpty()))
        }

        val sent = runCatching { action.actionIntent.send(context, 0, null) }
        if (sent.isFailure) {
            val detail = sent.exceptionOrNull()?.message ?: "no reason given"
            return refuse(session, request, NotificationFailure.IntentRefused(sbn.packageName, detail))
        }
        deliver(session, request, "action $index on ${sbn.packageName}")
    }

    private fun onDismiss(session: ControlSession, request: Envelope) {
        val key = request.str("key") ?: return refuse(session, request, NotificationFailure.MissingKey)
        if (!NotificationRelay.isListening()) {
            return refuse(session, request, unavailable(appContext))
        }
        // Deliberately *not* gated on find(key). Dismissing something already gone is the outcome
        // the user asked for, and refusing a dismiss because the notification vanished half a
        // second earlier would be a refusal the user cannot act on and does not want.
        if (!NotificationRelay.dismiss(key)) {
            return refuse(session, request, NotificationFailure.IntentRefused("the shade", "cancel was refused"))
        }
        deliver(session, request, "dismiss")
    }

    // ---- plumbing -------------------------------------------------------------------------

    /**
     * Checks the notification the Mac was looking at against the one that is there now.
     *
     * The target rule from docs/protocol.md. A notification key is not a stable handle on a
     * *conversation*: an app that reuses one notification id for whatever arrived most recently
     * keeps the same key while the conversation behind it changes. When that happens the Mac's row
     * says Ada, the notification at that key is now Grace, and firing its `RemoteInput` puts the
     * user's reply in Grace's conversation.
     *
     * Nothing in the `PendingIntent` path can catch that. The intent is always correctly bound to
     * whatever notification currently holds it — which is exactly the problem. So the Mac names
     * what it saw and this compares.
     *
     * **Title, not post time.** Post time changes on every update including a new message in the
     * *same* conversation, which is the single most likely thing to happen while somebody is
     * typing a reply. Refusing there would break the common case to guard the rare one.
     *
     * Absent on either side means there is nothing to disagree about, and it is allowed through:
     * an older Mac that does not send the field, and notifications that genuinely have no title,
     * both still work. That is a deliberate limit rather than an oversight — this closes a
     * mechanical failure, not an adversarial one.
     */
    private fun targetStillMatches(
        session: ControlSession,
        request: Envelope,
        sbn: android.service.notification.StatusBarNotification,
    ): Boolean {
        val seen = request.str("seenTitle") ?: return true
        val now = sbn.notification.extras
            .getCharSequence(Notification.EXTRA_TITLE)?.toString()?.takeIf { it.isNotBlank() }
            ?: return true
        if (seen == now) return true
        // Error, not warning: like the SMS recipient check, this is a prevented harm rather than a
        // feature declining. It should be rare enough that any occurrence is worth chasing.
        LinkLog.e(
            "notif",
            "REFUSED ${request.type} aimed at the wrong conversation: the Mac was showing " +
                "\"$seen\" but ${sbn.packageName} now has \"$now\" at that key",
            null,
        )
        refuse(session, request, NotificationFailure.TargetStale(seen, now))
        return false
    }

    /** The two gates every keyed request passes, each with its own sentence. */
    private fun ready(
        session: ControlSession,
        request: Envelope,
        key: String,
        context: Context? = appContext,
    ): android.service.notification.StatusBarNotification? {
        if (!NotificationRelay.isListening()) {
            refuse(session, request, unavailable(context))
            return null
        }
        val sbn = NotificationRelay.find(key)
        if (sbn == null) {
            refuse(session, request, NotificationFailure.Gone)
            return null
        }
        return sbn
    }

    /**
     * Which "we cannot reach notifications" this is: never granted, or granted and not running.
     *
     * The distinction costs one Settings read and saves someone twenty minutes looking for a
     * switch that is already on.
     */
    private fun unavailable(context: Context?): NotificationFailure {
        val granted = context != null && runCatching {
            android.provider.Settings.Secure
                .getString(context.contentResolver, "enabled_notification_listeners")
                ?.split(':')
                ?.any { it.startsWith(context.packageName + "/") } == true
        }.getOrDefault(false)
        return if (granted) NotificationFailure.ListenerNotRunning else NotificationFailure.NotGranted
    }

    private fun deliver(session: ControlSession, request: Envelope, what: String) {
        delivered.incrementAndGet()
        LinkLog.i("notif", "${request.type} delivered ($what) — ${tally()}")
        session.ack(request)
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: NotificationFailure) {
        refused.incrementAndGet()
        LinkLog.w("notif", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.NOTIFICATIONS,
            fixHint = failure.fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()
}

/**
 * Every way a notification request can fail, each with the sentence a person reads.
 *
 * The same shape as `InputFailure` and `MirrorFailure`, and for the same reason: locked decision 6
 * says every feature degrades to "unavailable, here is why", and the only way that survives
 * contact with a dozen call sites is if the sentence lives with the failure rather than at the
 * place that noticed it.
 */
sealed class NotificationFailure(
    /** For the log. Never shown. */
    val label: String,
    /** Wire error code from docs/protocol.md. */
    val code: String,
    /** Shown by the Mac verbatim. A full sentence, never a code. */
    val reason: String,
    val fixHint: String? = null,
) {
    object NotGranted : NotificationFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "This phone is not sharing its notifications yet.",
        fixHint = "On the phone: Settings > Notifications > Device & app notifications, and " +
            "allow ConnectSuite.",
    )

    /**
     * The grant is there and the service is not running.
     *
     * Separate from [NotGranted] because the obvious advice is *wrong* here, and wrong advice is
     * worse than none: the switch is already on, so telling someone to turn it on sends them in a
     * circle looking for a setting they have already set. Reinstalling the app is what does this —
     * Android tears the bound service down and does not rebind it, while
     * `enabled_notification_listeners` goes on naming the component.
     *
     * Should be unreachable now that the capability itself is gated on the service running, so a
     * Mac never sends here. It is kept because "unreachable" and "unreachable on the build the
     * Mac happens to be running" are different things, and a wrong sentence is what made this
     * expensive to diagnose the first time.
     */
    object ListenerNotRunning : NotificationFailure(
        label = "listener-not-running",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "Notification access is switched on, but Android has not started the service, " +
            "so the phone cannot reach your notifications.",
        fixHint = "This happens after the app is reinstalled. On the phone: Settings > " +
            "Notifications > Device & app notifications > ConnectSuite, and turn it off and on " +
            "again.",
    )

    /**
     * The notification is gone — dismissed on the phone, or replaced by an update.
     *
     * `NOT_FOUND` rather than `FEATURE_UNAVAILABLE` because the two ask for different things from
     * the Mac. This one means "your list is stale, refresh it"; the other means "grey the pane
     * out". Greying out notifications because the user swiped one away half a second before
     * clicking it would be a spectacular over-reaction to normal use.
     */
    object Gone : NotificationFailure(
        label = "gone",
        code = ErrorCode.NOT_FOUND,
        reason = "That notification is no longer on the phone, so nothing was sent.",
        fixHint = "It was dismissed or replaced. The list on this Mac has been updated.",
    )

    object MissingKey : NotificationFailure(
        label = "missing-key",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request did not say which notification it meant, so nothing was sent.",
    )

    class BadRequest(detail: String) : NotificationFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was sent.",
    )

    /**
     * The notification has no inline reply, which is the app's decision and not a missing feature.
     *
     * Named with the package on purpose: "Slack does not offer a reply here" is actionable and
     * "reply is unavailable" is not, and the difference is the one thing the user can check.
     */
    class NoReplyAction(packageName: String) : NotificationFailure(
        label = "no-reply-action",
        code = ErrorCode.NO_REPLY_ACTION,
        reason = "That notification from $packageName does not offer a reply, so there is " +
            "nothing for the phone to type into.",
        fixHint = "Only notifications whose app builds in a reply box can be replied to. Open " +
            "the app on the phone to answer this one.",
    )

    class NoSuchAction(index: Int, available: Int) : NotificationFailure(
        label = "no-such-action",
        code = ErrorCode.BAD_REQUEST,
        reason = if (available == 0) {
            "That notification has no buttons, so button $index could not be pressed."
        } else {
            "That notification has $available buttons, so button $index could not be pressed."
        },
    )

    class ActionNeedsText(title: String) : NotificationFailure(
        label = "action-needs-text",
        code = ErrorCode.NO_REPLY_ACTION,
        reason = "\"$title\" is a reply box rather than a button, so pressing it with no text " +
            "would have sent an empty message.",
        fixHint = "Type a reply and send it instead.",
    )

    /**
     * The key still resolves, but to a different conversation than the Mac was showing.
     *
     * Its own code rather than [Gone]'s `NOT_FOUND`, because the two ask different things of the
     * Mac and say different things to the user. "It was dismissed" is routine. "The reply you were
     * about to send would have gone to someone else" is not, and the sentence names both people so
     * the user can see what nearly happened.
     */
    class TargetStale(seen: String, now: String) : NotificationFailure(
        label = "target-stale",
        code = ErrorCode.TARGET_STALE,
        reason = "That was not sent: the notification from \"$seen\" has been replaced by one " +
            "from \"$now\", so it would have gone to the wrong conversation.",
        fixHint = "Nothing was sent. This Mac's list has been updated — check it and try again.",
    )

    class IntentRefused(target: String, detail: String) : NotificationFailure(
        label = "intent-refused",
        code = ErrorCode.FEATURE_UNAVAILABLE,
        reason = "The phone passed that to $target and it was refused ($detail).",
    )
}
