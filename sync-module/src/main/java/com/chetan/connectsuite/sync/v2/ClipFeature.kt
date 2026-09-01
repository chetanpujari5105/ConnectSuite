package com.chetan.connectsuite.sync.v2

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import com.chetan.connectsuite.core.app.AppForeground
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.coroutines.flow.MutableStateFlow
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
 * **An arriving entry is offered, never applied.** A clipboard is a single-slot store with no undo;
 * writing to it destroys what was there and the person finds out when they paste. [onPush] stores
 * and notifies. [apply] is what a deliberate tap calls.
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
     * The last text this side **received**, and the whole of the echo rule.
     *
     * Its concurrency is stated rather than merely its type, because a tagged union does nothing
     * about two callers: this is written by [onPush] on a socket thread and read by
     * [onWindowFocused] on the main thread. `@Volatile` is sufficient — the two never
     * read-modify-write it, they each assign or compare — and the failure it prevents is a phone
     * bouncing the Mac's own entry straight back at it.
     */
    @Volatile
    private var lastReceived: String? = null

    /** The last text this side sent, so a re-focus does not re-send an unchanged clipboard. */
    @Volatile
    private var lastSent: String? = null

    private val sent = AtomicLong(0)
    private val received = AtomicLong(0)
    private val refusedNotFocused = AtomicLong(0)
    private val refusedSensitive = AtomicLong(0)
    private val refusedTooLarge = AtomicLong(0)

    /** What the phone's own Clipboard card draws. Text included: it never leaves the device. */
    data class PhoneState(
        val lastSentPreview: String? = null,
        val lastSentAtMs: Long = 0L,
        val lastReceivedPreview: String? = null,
        val lastReceivedAtMs: Long = 0L,
        val historySize: Int = 0,
        val linkUp: Boolean = false,
    )

    private val _state = MutableStateFlow(PhoneState())
    val state: StateFlow<PhoneState> = _state

    private fun tally(): String =
        "${sent.get()} sent / ${received.get()} received / ${refusedNotFocused.get()} refused-unfocused / " +
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
        lastReceived = null
        lastSent = null
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
        // delivers nothing, so an earlier version of this counted a send, set `lastSent`, and drew
        // "Sent to your Mac" for an entry no Mac ever saw. Observed 2026-09-01: the phone read its
        // clipboard on focus at 18:53:57 and the Mac connected at 18:54:13, sixteen seconds later.
        //
        // Worse than a wrong number: `lastSent` would then suppress the *real* send when a Mac did
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

        if (!ClipboardPayloads.shouldSend(text, lastReceived)) {
            LinkLog.i("clip", "Not sending: identical to the last entry received from the Mac — ${tally()}")
            return
        }
        if (text == lastSent) return

        val payload = ClipboardPayloads.entry(
            kind = ClipboardPayloads.KIND_TEXT,
            text = text,
            atMs = System.currentTimeMillis(),
            source = ClipboardPayloads.SOURCE_PHONE,
            packageName = clip.packageName,
            appName = clip.appName,
        )
        history.add(
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_TEXT,
                text = text,
                atMs = System.currentTimeMillis(),
                source = ClipboardPayloads.SOURCE_PHONE,
                packageName = clip.packageName,
                appName = clip.appName,
            ),
        )
        lastSent = text
        sent.incrementAndGet()
        server.broadcast { session -> session.send(Envelope(type = MessageType.CLIP_PUSH, payload = payload)) }
        _state.value = _state.value.copy(
            lastSentPreview = text,
            lastSentAtMs = System.currentTimeMillis(),
            historySize = history.size,
            linkUp = server.anyLiveSession() != null,
        )
        LinkLog.i(
            "clip",
            "clip.push → Mac: ${ClipboardPayloads.byteLength(text)} bytes from " +
                "${clip.appName ?: "an unnamed app"} — ${tally()}",
        )
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
     * The Mac's clipboard arriving here. **Stored and offered, never applied.**
     *
     * The write itself is legal from the background on this device — that was reading 5 — so the
     * reason this does not simply set the clipboard is a design decision about a single-slot store
     * with no undo, not a platform limit. [apply] is what a deliberate tap calls.
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

        lastReceived = text
        received.incrementAndGet()
        history.add(
            ClipboardPayloads.History.Item(
                kind = ClipboardPayloads.KIND_TEXT,
                text = text,
                atMs = System.currentTimeMillis(),
                source = ClipboardPayloads.SOURCE_MAC,
            ),
        )
        _state.value = _state.value.copy(
            lastReceivedPreview = text,
            lastReceivedAtMs = System.currentTimeMillis(),
            historySize = history.size,
            linkUp = true,
        )
        ClipNotifications.offer(context, text)
        session.ack(request)
        LinkLog.i("clip", "clip.push ← Mac: ${ClipboardPayloads.byteLength(text)} bytes, offered — ${tally()}")
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
     * Writes the phone's clipboard. Called only from a deliberate tap on the offer.
     *
     * Legal from anywhere on this device — the background write landed in reading 5 — so this is
     * safe to call from a notification action with no activity on screen.
     */
    fun apply(context: Context, text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ConnectSuite", text))
        // `lastSent` too: applying the Mac's entry makes it this phone's clipboard, and the next
        // focus must not read it back and send it home again. Belt and braces with the echo rule,
        // because the two guards fail in different ways — this one survives a `lastReceived` reset.
        lastReceived = text
        lastSent = text
        LinkLog.i("clip", "Applied a Mac entry to the phone clipboard: ${ClipboardPayloads.byteLength(text)} bytes — ${tally()}")
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
