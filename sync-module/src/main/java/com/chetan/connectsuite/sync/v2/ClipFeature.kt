package com.chetan.connectsuite.sync.v2

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.data.SettingsStore
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * The clipboard's three verbs, built to what the platform actually permits on this device.
 *
 * ### The measurement this is shaped by
 *
 * `docs/testing.md` → **Slice 11**, 2026-09-01. `ClipboardManager.getPrimaryClip` is refused unless
 * the calling app is **focused** — 90 of 90 samples refused with our AccessibilityService bound, 60
 * of 60 with it disabled, over clips proven readable with focus half a second earlier, and every
 * refusal carrying the platform's own line: *"application is not in focus nor is it a system
 * service"*. `OnPrimaryClipChangedListener` never fires backgrounded either. **Writes are
 * unrestricted.**
 *
 * So this feature is asymmetric because the device is:
 *
 *  - **Mac → phone** works whenever the link is up. [onPush] never needs the app on screen.
 *  - **Phone → Mac** happens only in the moment the app is focused, which is [onWindowFocused] —
 *    somebody copies in another app and comes back here. There is no observer and no background
 *    read, and `clip.request` from a backgrounded phone answers [ErrorCode.PHONE_NOT_FOREGROUND]
 *    rather than pretending the clipboard is empty.
 *
 * The documented AccessibilityService exception does **not** operate here, which is why nothing in
 * this file consults it.
 *
 * ### Two rules that are not obvious from the payloads
 *
 * **An arriving entry is offered by default, and applied only if the person asked for that.**
 * `SettingsStore.clipboardAutoApply` decides, and it is **off** — not out of caution but because of
 * the same measurement this file is built on. The Mac applies what arrives and can afford to: it
 * reads its own clipboard first, keeps what it is about to overwrite, and offers Restore. **This
 * phone cannot**, because it may not read its clipboard while unfocused — so it cannot see what it
 * would destroy, cannot put it back, and what it destroys is often not in the history either (a
 * clip copied while this app was backgrounded was never read). Auto-apply here is the one write in
 * the feature with no undo and no witness. Some people will want it anyway; nobody should get it
 * without asking.
 *
 * **Nothing here logs clipboard text, at any level.** `LinkLog` writes to a rotating file on disk,
 * so a handler written the way every other handler in this repo is written would put people's
 * passwords there while the history was scrupulously in memory. Lengths, kinds, the sensitive flag
 * and the counters — never the content.
 */
object ClipFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.CLIP_PUSH,
        MessageType.CLIP_REQUEST,
        MessageType.CLIP_HISTORY,
    )

    /** A fourth kind, and it is a success rather than an error — see [readClip]. */
    const val KIND_TOO_LARGE = "too_large"

    @Volatile
    private var installed = false

    @Volatile
    private var link: LinkServer? = null

    private val history = ClipboardPayloads.History()

    /**
     * The echo interlock, and the whole of what stops two clipboards writing each other in a
     * circle. One home — see [ClipEcho] — so `ClipEchoTest` can drive the rule against an
     * adversarial peer rather than model it, and so this file holds no clipboard text of its own to
     * compare against.
     *
     * It became load-bearing when auto-apply landed. Before that a person was the rate limiter on
     * both ends, and a loop that needs a human to press a button once per hop is not a loop.
     */
    private val echo = ClipEcho()

    private val sent = AtomicLong(0)
    private val received = AtomicLong(0)

    /**
     * Applied beside received, because a count with no denominator is not evidence.
     *
     * With auto-apply off these differ by every entry nobody tapped, which is the number that says
     * whether the offer is being used or ignored — and with it on they should track, so a gap is
     * the setting not taking effect. Neither reading exists without both numbers.
     */
    private val applied = AtomicLong(0)
    private val refusedNotFocused = AtomicLong(0)
    private val refusedSensitive = AtomicLong(0)
    private val refusedTooLarge = AtomicLong(0)

    /** What the phone's own Clipboard card draws. Text included: it never leaves the device. */
    data class PhoneState(
        val lastSentPreview: String? = null,
        val lastSentAtMs: Long = 0L,
        val lastReceivedPreview: String? = null,
        val lastReceivedAtMs: Long = 0L,
        /** Whether the last arriving entry reached the clipboard, so the card names what happened. */
        val lastReceivedApplied: Boolean = false,
        val historySize: Int = 0,
        val linkUp: Boolean = false,
    )

    private val _state = MutableStateFlow(PhoneState())
    val state: StateFlow<PhoneState> = _state

    private fun tally(): String =
        "${sent.get()} sent / ${received.get()} received / ${applied.get()} of ${received.get()} applied / " +
            "${refusedNotFocused.get()} refused-unfocused / " +
            "${refusedSensitive.get()} refused-sensitive / ${refusedTooLarge.get()} refused-too-large since start"

    fun install(context: Context, server: LinkServer) {
        if (installed) return
        installed = true
        link = server
        val app = context.applicationContext
        handledTypes.forEach { type -> server.register(type, handlerFor(type, app)) }

        // Chained rather than assigned: MediaFeature already owns this sink for the bulk channel,
        // and a second feature overwriting it would silently take the first one's teardown with it.
        // The history is cleared only when the *last* Mac goes, because two Macs are structurally
        // possible even if nobody has run two.
        val previous = server.sessionEndedSink
        server.sessionEndedSink = { session ->
            previous?.invoke(session)
            if (server.anyLiveSession() == null) onLinkDropped()
        }
        server.refreshCapabilities()
        LinkLog.i(
            "clip",
            "Clipboard feature installed with all ${handledTypes.size} verbs; phone reads are " +
                "focus-gated on this platform, writes are not; capabilities now: " +
                "${server.capabilities.current().sorted()}",
        )
    }

    fun uninstall(server: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(server::unregister)
        link = null
        server.refreshCapabilities()
    }

    /**
     * Cleared on disconnect, the rule the contact and thumbnail caches already follow.
     *
     * An entry held against a Mac that has gone is a claim this phone cannot still stand behind,
     * and the count is logged because a clear that removed nothing and a clear that removed twenty
     * things are different events.
     */
    fun onLinkDropped() {
        val had = history.clear()
        // The interlock is **not** fully cleared with the history, and that distinction is the fix
        // for a bounce nobody had seen: `linkDropped` drops what this side last sent and keeps what
        // it last received. Clearing both would let the next focus read back a clip the Mac gave
        // this phone and send it home, where a Mac that auto-applies writes it over whatever the
        // person copied in the meantime. One hop, terminating, silently destroying live work. See
        // `ClipEcho` and `ClipEchoTest`'s last case.
        echo.linkDropped()
        _state.value = PhoneState()
        LinkLog.i("clip", "Link dropped; cleared $had clipboard entries — ${tally()}")
    }

    // --- phone → Mac, and the only moment it is legal ---------------------------------------------

    /**
     * Called from `MainActivity.onWindowFocusChanged(true)` — the one moment this app may look at
     * the clipboard.
     *
     * This is the whole phone-to-Mac path. There is no observer to hook and no background read to
     * take; a person copies something in another app, comes back to ConnectSuite, and this runs.
     */
    fun onWindowFocused(context: Context) {
        val server = link ?: return
        val clip = readClip(context.applicationContext) ?: return
        val text = clip.text ?: return

        // **Report the effect, not the stimulus** — this repo's own probe rule, and it belongs in
        // product code for the same reason. `broadcast` over zero sessions returns normally and
        // delivers nothing, so an earlier version of this counted a send, armed the interlock, and drew
        // "Sent to your Mac" for an entry no Mac ever saw. Observed 2026-09-01: the phone read its
        // clipboard on focus at 18:53:57 and the Mac connected at 18:54:13, sixteen seconds later.
        //
        // Worse than a wrong number: the interlock would then suppress the *real* send when a Mac did
        // arrive, because the text had not changed. The feature would look broken exactly once,
        // for the person whose phone was open before their Mac was.
        if (server.anyLiveSession() == null) {
            _state.value = _state.value.copy(historySize = history.size, linkUp = false)
            LinkLog.i(
                "clip",
                "Clipboard read on focus and not sent: no Mac is connected. Nothing was counted as " +
                    "sent and nothing was remembered as sent, so it will go the moment one is — ${tally()}",
            )
            return
        }

        // Focus is an *automatic* trigger, so both rules apply: the echo rule (never send back what
        // we received) and the unchanged rule (do not re-send the same clipboard every time
        // somebody opens the app). Named refusals rather than a boolean, because the first is
        // logged and the second is the ordinary case — and collapsing them would hide which one is
        // doing the work, which is exactly how the Mac's twin test passed over a deleted echo rule.
        when (echo.maySend(text, ClipEcho.Trigger.AUTOMATIC)) {
            ClipEcho.Decision.Echo -> {
                LinkLog.i("clip", "Not sending: identical to the last entry received from the Mac — ${tally()}")
                return
            }
            ClipEcho.Decision.Unchanged -> return
            ClipEcho.Decision.Send -> Unit
        }

        deliver(server, text, clip.packageName, clip.appName, "focus")
    }

    /**
     * The send half, shared by every route that has text to give the Mac.
     *
     * Extracted when [sendSelectedText] arrived. It is **one function rather than two similar ones**
     * for the reason this repo keeps writing down: a second expression of a rule is a second thing
     * to get wrong, and the parts most likely to drift are exactly the ones that matter — arming the
     * echo interlock, counting the send, and adding to history in the same shape the Mac expects.
     */
    private fun deliver(
        server: LinkServer,
        text: String,
        packageName: String?,
        appName: String?,
        route: String,
    ) {
        val now = System.currentTimeMillis()
        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_TEXT,
            text = text,
            atMs = now,
            source = ClipboardPayloads.SOURCE_PHONE,
            packageName = packageName,
            appName = appName,
        )
        history.add(
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_TEXT,
                text = text,
                atMs = now,
                source = ClipboardPayloads.SOURCE_PHONE,
                packageName = packageName,
                appName = appName,
            ),
        )
        echo.sent(text)
        sent.incrementAndGet()
        server.broadcast { session -> session.send(Envelope(type = MessageType.CLIP_PUSH, payload = payload)) }
        _state.value = _state.value.copy(
            lastSentPreview = text,
            lastSentAtMs = now,
            historySize = history.size,
            linkUp = server.anyLiveSession() != null,
        )
        // The route is on the line because there are now two of them, and a single "clip.push → Mac"
        // could not say which. Defect 60's corollary: when two mechanisms satisfy one guarantee, the
        // log must name the one that did.
        LinkLog.i(
            "clip",
            "clip.push → Mac via $route: ${ClipboardPayloads.byteLength(text)} bytes from " +
                "${appName ?: "an unnamed app"} — ${tally()}",
        )
    }

    /**
     * Text the user selected and handed us from another app's selection toolbar — `ACTION_PROCESS_TEXT`.
     *
     * **This route never touches the clipboard, which is the whole point.** Android refuses a
     * background clipboard read to every app (Slice 11, and Slice 17 re-measured it against three
     * more entry points), so the phone can only *read* while ConnectSuite is focused. Here there is
     * nothing to read: the text arrives in the Intent, so the platform rule does not apply — it is
     * not circumvented, it is not engaged.
     *
     * The trigger is [ClipEcho.Trigger.USER] because a person tapped a menu item. That skips the
     * *unchanged* refusal — sending the same selection twice on purpose must work — and keeps the
     * *echo* refusal, which is not about intent: bouncing back the text the Mac just sent would be
     * wrong however deliberately it was asked for.
     *
     * Returns what to tell the user, because this is called from an activity with no UI of its own
     * and a route that silently does nothing is worse than an absent one.
     */
    fun sendSelectedText(context: Context, text: String, fromPackage: String?): SelectionSend.Outcome {
        val server = link
        val outcome = SelectionSend.decide(
            text = text,
            hasLiveSession = server?.anyLiveSession() != null,
            tooLarge = ClipboardPayloads::tooLarge,
            // `USER`, because a person tapped a menu item. That skips the *unchanged* refusal —
            // sending the same selection twice on purpose must work — and keeps the *echo* refusal,
            // which is not about intent: bouncing back what the Mac just sent is wrong however
            // deliberately it is asked for.
            echo = { echo.maySend(it, ClipEcho.Trigger.USER) },
        )
        if (outcome is SelectionSend.Outcome.Sent && server != null) {
            // Through `AppLabels`, always — including when it falls back to the package name, so the
            // fallback is counted rather than a raw id being interpolated somewhere that never asks.
            // Defects 28 and 33.
            val label = fromPackage?.let { AppLabels.of(context, it) }
            deliver(server, text.trim(), fromPackage, label, "selection")
        } else {
            LinkLog.i("clip", "selection not sent: ${outcome.javaClass.simpleName} — ${tally()}")
        }
        return outcome
    }


    // --- the three handlers -----------------------------------------------------------------------

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.CLIP_REQUEST -> MessageHandler { session, request -> onRequest(session, request, context) }
        MessageType.CLIP_PUSH -> MessageHandler { session, request -> onPush(session, request, context) }
        MessageType.CLIP_HISTORY -> MessageHandler { session, request -> onHistory(session, request) }
        else -> error("ClipFeature.handledTypes lists $type with no handler")
    }

    private fun onRequest(session: ControlSession, request: Envelope, context: Context) {
        val clip = readClip(context)
        if (clip == null) {
            refusedNotFocused.incrementAndGet()
            LinkLog.w(
                "clip",
                "clip.request refused: this phone is not the focused app, so the platform will not " +
                    "let it read its own clipboard — ${tally()}",
            )
            return session.sendError(
                requestId = request.id,
                code = ErrorCode.PHONE_NOT_FOREGROUND,
                message = "The phone can only read its clipboard while ConnectSuite is open on screen.",
                feature = Capability.CLIPBOARD,
                fixHint = "Open ConnectSuite on the phone, then ask again.",
            )
        }
        session.ack(request) {
            put("kind", clip.kind)
            if (clip.kind == ClipboardPayloads.KIND_TEXT && clip.text != null) put("text", clip.text)
            if (clip.kind == KIND_TOO_LARGE) put("bytes", clip.bytes)
            put("atMs", System.currentTimeMillis())
            put("source", ClipboardPayloads.SOURCE_PHONE)
            if (clip.packageName != null) {
                put("package", clip.packageName)
                put("appName", clip.appName ?: clip.packageName)
            }
        }
        LinkLog.i("clip", "clip.request → kind=${clip.kind}, ${clip.bytes} bytes — ${tally()}")
    }

    /**
     * The Mac's clipboard arriving here. **Stored, then applied or offered per the setting.**
     *
     * The write is legal from the background on this device — that was reading 5 — so which of the
     * two happens is a decision rather than a limit, and it is the user's decision:
     * `SettingsStore.clipboardAutoApply`, off by default for the reason in the class comment.
     *
     * The setting is read here, at the moment of acting, rather than cached at install: a toggle
     * flipped while the phone is in a pocket has to take effect on the next arrival, and a value
     * read once at startup would leave somebody's *off* being honoured by a field nobody updated.
     */
    private fun onPush(session: ControlSession, request: Envelope, context: Context) {
        val kind = request.payload["kind"]?.jsonPrimitive?.content ?: ClipboardPayloads.KIND_TEXT
        val text = request.payload["text"]?.jsonPrimitive?.content
        if (kind != ClipboardPayloads.KIND_TEXT || text == null) {
            return session.sendError(
                requestId = request.id,
                code = ErrorCode.BAD_REQUEST,
                message = "That clipboard entry had no text to offer.",
                feature = Capability.CLIPBOARD,
            )
        }
        if (ClipboardPayloads.tooLarge(text)) {
            refusedTooLarge.incrementAndGet()
            return session.sendError(
                requestId = request.id,
                code = ErrorCode.BAD_REQUEST,
                message = "That clipboard entry is ${ClipboardPayloads.byteLength(text)} bytes; " +
                    "the limit is ${ClipboardPayloads.MAX_TEXT_BYTES}. Nothing was truncated.",
                feature = Capability.CLIPBOARD,
            )
        }

        // Armed **before** any write. A write that lands first leaves a window in which a focus
        // event could read this phone's own new clipboard and push it straight back to the Mac.
        echo.arrived(text)
        received.incrementAndGet()
        history.add(
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_TEXT,
                text = text,
                atMs = System.currentTimeMillis(),
                source = ClipboardPayloads.SOURCE_MAC,
            ),
        )

        val autoApply = runCatching {
            runBlocking { SettingsStore.get(context).clipboardAutoApply.first() }
        }.getOrElse { failure ->
            // Fails **closed**, to the confirmation. A settings read that throws must not be the
            // route by which somebody's clipboard gets replaced without them having asked, and the
            // cost of the wrong guess in this direction is one extra tap.
            LinkLog.w("clip", "Could not read the auto-apply setting; holding for a tap instead", failure)
            false
        }

        // Deliverability is a **precondition of the write**, not a check made after it. See
        // [ClipArrival]: this phone does not replace a clipboard it cannot tell you it replaced,
        // because unlike the Mac it has no undo to offer afterwards.
        val undeliverable = NotificationDelivery.reasonCannotPost(context)
        val arrival = ClipArrival.of(autoApply = autoApply, canNotify = undeliverable == null)

        if (arrival.writesClipboard) {
            applyToClipboard(context, text)
            applied.incrementAndGet()
        }

        _state.value = _state.value.copy(
            lastReceivedPreview = text,
            lastReceivedAtMs = System.currentTimeMillis(),
            lastReceivedApplied = arrival.writesClipboard,
            historySize = history.size,
            linkUp = true,
        )
        if (arrival != ClipArrival.KEEP_ONLY) {
            ClipNotifications.post(context, text, applied = arrival.writesClipboard)
        }

        // The ack says which of the three happened. The Mac is the only screen this phone can still
        // reach when its own notifications are off, so the refusal is reported there or nowhere.
        session.ack(request) {
            put("applied", kotlinx.serialization.json.JsonPrimitive(arrival.writesClipboard))
            put("arrival", kotlinx.serialization.json.JsonPrimitive(arrival.name))
            if (undeliverable != null) {
                put("reason", kotlinx.serialization.json.JsonPrimitive(undeliverable))
            }
        }

        val what = when (arrival) {
            ClipArrival.APPLY -> "applied to this phone's clipboard"
            ClipArrival.OFFER -> "held for a tap"
            // Success beside failure: this line carries what was kept as well as what was refused,
            // so "12 refused" can be told from "12 of 12 refused".
            ClipArrival.KEEP_ONLY ->
                "NOT applied and NOT offered — $undeliverable; kept in history only"
        }
        val line = "clip.push ← Mac: ${ClipboardPayloads.byteLength(text)} bytes, $what — ${tally()}"
        if (arrival == ClipArrival.KEEP_ONLY) LinkLog.w("clip", line) else LinkLog.i("clip", line)
    }

    private fun onHistory(session: ControlSession, request: Envelope) {
        val limit = request.payload["limit"]?.jsonPrimitive?.content?.toIntOrNull()
            ?: ClipboardPayloads.HISTORY_MAX
        if (limit < 1 || limit > ClipboardPayloads.HISTORY_MAX) {
            return session.sendError(
                requestId = request.id,
                code = ErrorCode.BAD_REQUEST,
                message = "limit must be between 1 and ${ClipboardPayloads.HISTORY_MAX}.",
                feature = Capability.CLIPBOARD,
            )
        }
        val items = history.newestFirst(limit)
        session.ack(request) {
            put(
                "entries",
                buildJsonArray {
                    items.forEach { item ->
                        add(
                            ClipboardPayloads.entry(
                                kind = item.kind,
                                text = item.text,
                                atMs = item.atMs,
                                source = item.source,
                                packageName = item.packageName,
                                appName = item.appName,
                            ),
                        )
                    }
                } as JsonArray,
            )
            put("hasMore", history.size > items.size)
        }
        LinkLog.i("clip", "clip.history → ${items.size} of ${history.size} held — ${tally()}")
    }

    /**
     * Writes the phone's clipboard from a **deliberate tap** — the notification action or the card.
     *
     * Legal from anywhere on this device (the background write landed in reading 5), so it is safe
     * to call from a broadcast receiver with no activity on screen.
     */
    fun apply(context: Context, text: String) {
        applyToClipboard(context, text)
        applied.incrementAndGet()
        _state.value = _state.value.copy(lastReceivedApplied = true)
        LinkLog.i(
            "clip",
            "Applied a Mac entry to the phone clipboard on a tap: " +
                "${ClipboardPayloads.byteLength(text)} bytes — ${tally()}",
        )
    }

    /**
     * The one place that writes this phone's clipboard, reached from a tap and from auto-apply.
     *
     * [ClipEcho.wroteLocally] runs whichever route got here: the Mac's entry is now this phone's
     * clipboard, and the next focus must not read it back and send it home. It arms the *unchanged*
     * rule; the echo rule was already armed by [ClipEcho.arrived] when the push landed, before any
     * write, and that one survives a link drop — which is what `ClipEchoTest`'s last case checks.
     */
    private fun applyToClipboard(context: Context, text: String) {
        echo.wroteLocally(text)
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ConnectSuite", text))
    }

    // --- the one place that touches ClipboardManager for reading ----------------------------------

    /** What a read produced, or null when the platform refused because we are not focused. */
    private data class Clip(
        val kind: String,
        val text: String?,
        val bytes: Int,
        val packageName: String? = null,
        val appName: String? = null,
    )

    /**
     * Reads the clipboard, or returns null when the platform will not allow it.
     *
     * **The focus check gates the action rather than describing it**, and it is re-tested *after*
     * the read rather than only before: `getPrimaryClip` returns null both for an empty clipboard
     * and for a refusal, so a check taken only beforehand turns a refusal that arrived in the
     * intervening millisecond into `kind: "empty"` — a Mac telling somebody their clipboard is empty
     * when it is not. Losing focus between the two is exactly the window a system dialog opens.
     */
    private fun readClip(context: Context): Clip? {
        if (!AppForeground.isFocused) return null
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = runCatching { clipboard.primaryClip }.getOrNull()
        if (!AppForeground.isFocused) return null
        if (clip == null) return Clip(ClipboardPayloads.KIND_EMPTY, null, 0)

        val description = clip.description
        if (isSensitive(description)) {
            refusedSensitive.incrementAndGet()
            LinkLog.i(
                "clip",
                "The clipboard holds an entry an app flagged sensitive; it was not read into a " +
                    "payload and not stored — ${tally()}",
            )
            return Clip(ClipboardPayloads.KIND_SENSITIVE, null, 0)
        }

        val text = clip.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()
            ?: return Clip(ClipboardPayloads.KIND_EMPTY, null, 0)
        val bytes = ClipboardPayloads.byteLength(text)
        if (ClipboardPayloads.tooLarge(text)) {
            refusedTooLarge.incrementAndGet()
            LinkLog.w(
                "clip",
                "The clipboard holds $bytes bytes, over the ${ClipboardPayloads.MAX_TEXT_BYTES} " +
                    "byte cap; refused rather than truncated — ${tally()}",
            )
            return Clip(KIND_TOO_LARGE, null, bytes)
        }

        val owner = ownerOf(clip)
        return Clip(
            kind = ClipboardPayloads.KIND_TEXT,
            text = text,
            bytes = bytes,
            packageName = owner,
            appName = owner?.let { AppLabels.of(context, it) },
        )
    }

    /**
     * `EXTRA_IS_SENSITIVE`, honoured absolutely, and read by its string name below API 33.
     *
     * The constant is `@RequiresApi(33)` but the extra has been honoured by password managers for
     * longer, and the key is a stable public string. A build that only checked it on 33+ would
     * carry passwords on any older device, which is the wrong way for this particular check to
     * degrade.
     */
    private fun isSensitive(description: ClipDescription?): Boolean {
        val extras = description?.extras ?: return false
        return extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false) ||
            extras.getBoolean("android.content.extra.IS_SENSITIVE", false)
    }

    /** The package that put this on the clipboard, when the platform says. */
    private fun ownerOf(clip: ClipData): String? =
        clip.description?.extras?.getString("android.content.extra.ORIGINAL_PACKAGE")
}
