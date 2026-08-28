package com.chetan.connectsuite.input

import android.content.Context
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.MessageType
import com.chetan.connectsuite.core.screen.ScreenGeometryRegistry
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Wires input into the link, and by doing so turns the `input` capability on.
 *
 * Modelled on `MirrorFeature`, with one deliberate difference: input has **no side channel**, so
 * [install] only registers handlers. That is the whole of its half of the contract, and the other
 * half — the accessibility grant — is not this object's to give. `ConnectSuiteInputService` calls
 * `refreshCapabilities` when the user enables or disables it, which is what makes the Mac's chip
 * change mid-session.
 *
 * Handlers are registered from app start regardless of whether the service is enabled. That is on
 * purpose: an `input.tap` arriving with the service off must come back with "here is how to turn
 * it on" rather than "not implemented on this phone build", and only a registered handler can say
 * the first one. The capability stays un-advertised throughout, so a well-behaved Mac never sends
 * it, and a grant revoked mid-flight is answered rather than dropped.
 */
object InputFeature {

    /**
     * Every control message this feature answers — all six, which is exactly what the `input`
     * contract in `CapabilityContract` requires.
     *
     * `input.key` and `input.global` are in this set even though most of what their names suggest
     * is impossible. They are honoured for the subset that can exist and refused **by name, with
     * a reason** for the rest, which is a promise the phone can keep. Registering nothing for them
     * would take the whole capability off instead.
     */
    val handledTypes: Set<String> = setOf(
        MessageType.INPUT_TAP,
        MessageType.INPUT_SWIPE,
        MessageType.INPUT_SCROLL,
        MessageType.INPUT_KEY,
        MessageType.INPUT_TEXT,
        MessageType.INPUT_GLOBAL,
    )

    /** Default tap length. Long enough to register everywhere, short enough not to be a long press. */
    private const val DEFAULT_TAP_MS = 60L
    private const val DEFAULT_SWIPE_MS = 200L
    private const val DEFAULT_SCROLL_MS = 100L
    private const val MAX_DURATION_MS = 5_000L
    private const val MAX_PATH_POINTS = 100
    private const val MAX_TEXT_LENGTH = 4_096

    @Volatile
    private var installed = false

    /**
     * Whether the mirror is currently being handed blank frames.
     *
     * Supplied by the caller rather than read from `mirror-module`, so the two feature modules
     * stay unaware of each other; `:app` is the one place that can see both. Defaults to "not
     * blocked" so that input still works for anyone who wires it up without a mirror.
     */
    @Volatile
    private var contentBlocked: () -> Boolean = { false }

    fun install(
        context: Context,
        server: LinkServer,
        contentBlocked: () -> Boolean = { false },
    ) {
        if (installed) return
        installed = true
        val appContext = context.applicationContext
        this.contentBlocked = contentBlocked

        handledTypes.forEach { type -> server.register(type, handlerFor(type, appContext)) }

        // The third gate, and input has exactly the shape notifications does: the accessibility
        // *grant* in `enabled_accessibility_services` survives a reinstall, the bound service does
        // not, and Android does not rebind it. Verified on hardware 2026-08-27 — the setting named
        // this service while `dumpsys` showed no process attached and this module's own install
        // line said "accessibility service is off", with `input` advertised anyway.
        server.capabilities.requireRunning(CapabilityContract.SpecialAccess.ACCESSIBILITY_SERVICE) {
            ConnectSuiteInputService.isConnected()
        }
        server.refreshCapabilities()

        LinkLog.i(
            "input",
            "Input feature installed; accessibility service " +
                (if (ConnectSuiteInputService.isConnected()) "is on" else "is off") +
                "; capabilities now: ${server.capabilities.current().sorted()}",
        )
    }

    /** Removes the handlers, which takes `input` straight back off the Mac's list. */
    fun uninstall(server: LinkServer) {
        if (!installed) return
        installed = false
        contentBlocked = { false }
        handledTypes.forEach(server::unregister)
        server.refreshCapabilities()
    }

    private fun handlerFor(type: String, appContext: Context): MessageHandler = when (type) {
        MessageType.INPUT_TAP -> MessageHandler { session, request -> onTap(session, request, appContext) }
        MessageType.INPUT_SWIPE -> MessageHandler { session, request -> onSwipe(session, request, appContext) }
        MessageType.INPUT_SCROLL -> MessageHandler { session, request -> onScroll(session, request, appContext) }
        MessageType.INPUT_KEY -> MessageHandler { session, request -> onKey(session, request, appContext) }
        MessageType.INPUT_TEXT -> MessageHandler { session, request -> onText(session, request, appContext) }
        MessageType.INPUT_GLOBAL -> MessageHandler { session, request -> onGlobal(session, request, appContext) }
        // Unreachable unless handledTypes gains an entry with no handler, which is exactly the
        // drift that would advertise a capability with nothing behind it.
        else -> error("InputFeature.handledTypes lists $type with no handler")
    }

    // ---- handlers ---------------------------------------------------------------------------

    private suspend fun onTap(session: ControlSession, request: Envelope, context: Context) {
        val service = ready(session, request, context, needsScreen = true) ?: return
        val stamp = verifiedStamp(session, request) ?: return
        val point = request.framePoint("x", "y")
            ?: return refuse(session, request, InputFailure.BadRequest("x and y are required"))
        val target = InputGeometry.toDisplay(stamp, point)
            ?: return refuse(session, request, outOfFrame(point, stamp))

        val duration = request.duration(DEFAULT_TAP_MS)
        answer(session, request, service.stroke(listOf(target), duration, service.foregroundPackage()))
    }

    private suspend fun onSwipe(session: ControlSession, request: Envelope, context: Context) {
        val service = ready(session, request, context, needsScreen = true) ?: return
        val stamp = verifiedStamp(session, request) ?: return
        val points = request.framePath()
            ?: return refuse(
                session,
                request,
                InputFailure.BadRequest("points must be an array of 2 to $MAX_PATH_POINTS {x,y} objects"),
            )
        val path = InputGeometry.toDisplay(stamp, points)
            ?: return refuse(
                session,
                request,
                InputFailure.GeometryStale(
                    "part of that drag is outside the ${stamp.width}x${stamp.height} screen it was drawn on",
                ),
            )
        answer(
            session,
            request,
            service.stroke(path, request.duration(DEFAULT_SWIPE_MS), service.foregroundPackage()),
        )
    }

    private suspend fun onScroll(session: ControlSession, request: Envelope, context: Context) {
        val service = ready(session, request, context, needsScreen = true) ?: return
        val stamp = verifiedStamp(session, request) ?: return
        val from = request.framePoint("x", "y")
            ?: return refuse(session, request, InputFailure.BadRequest("x and y are required"))
        val dx = request.float("dx") ?: 0f
        val dy = request.float("dy") ?: 0f
        if (dx == 0f && dy == 0f) {
            return refuse(session, request, InputFailure.BadRequest("a scroll of zero distance"))
        }
        val to = InputGeometry.scrollEnd(stamp, from, dx, dy)
        val path = InputGeometry.toDisplay(stamp, listOf(from, to))
            ?: return refuse(session, request, outOfFrame(from, stamp))
        answer(
            session,
            request,
            service.stroke(path, request.duration(DEFAULT_SCROLL_MS), service.foregroundPackage()),
        )
    }

    private suspend fun onKey(session: ControlSession, request: Envelope, context: Context) {
        // No screen needed: these are keyboard actions, and none of them carries a coordinate.
        val service = ready(session, request, context, needsScreen = false) ?: return
        val key = request.string("key")
            ?: return refuse(session, request, InputFailure.BadRequest("key is required"))

        val failure = when (val action = InputKeys.forWire(key)) {
            null -> InputFailure.UnsupportedKey(key, InputKeys.refusalFor(key))
            KeyAction.Backspace -> service.backspace()
            KeyAction.ImeEnter -> service.imeEnter()
            is KeyAction.Global -> service.global(action.action)
        }
        answer(session, request, failure)
    }

    private suspend fun onText(session: ControlSession, request: Envelope, context: Context) {
        val service = ready(session, request, context, needsScreen = false) ?: return
        val text = request.string("text")
            ?: return refuse(session, request, InputFailure.BadRequest("text is required"))
        if (text.length > MAX_TEXT_LENGTH) {
            return refuse(
                session,
                request,
                InputFailure.BadRequest("text is longer than $MAX_TEXT_LENGTH characters"),
            )
        }
        val mode = request.string("mode") ?: "replace"
        if (mode != "replace" && mode != "append") {
            return refuse(session, request, InputFailure.BadRequest("mode must be replace or append"))
        }
        answer(session, request, service.setText(text, append = mode == "append"))
    }

    private suspend fun onGlobal(session: ControlSession, request: Envelope, context: Context) {
        val service = ready(session, request, context, needsScreen = false) ?: return
        val name = request.string("action")
            ?: return refuse(session, request, InputFailure.BadRequest("action is required"))

        val action = GlobalAction.forWire(name)
            ?: return refuse(
                session,
                request,
                InputFailure.UnsupportedKey(name, InputKeys.refusalFor(name)),
            )
        answer(session, request, service.global(action))
    }

    // ---- preflight --------------------------------------------------------------------------

    /**
     * The checks every input message shares, in the order a user would want them answered.
     *
     * [needsScreen] separates the two kinds of message. Anything with a coordinate is meaningless
     * without a picture, and is refused when the screen is blanked — a tap the user cannot see the
     * target of is not one they meant. Back, home and typing are *not* refused for a blanked
     * screen, and that is deliberate: pressing Back is exactly how a user leaves the banking app
     * that blanked it, and refusing the way out would be a trap.
     */
    private fun ready(
        session: ControlSession,
        request: Envelope,
        context: Context,
        needsScreen: Boolean,
    ): ConnectSuiteInputService? {
        val service = ConnectSuiteInputService.peek()
        if (service == null) {
            refuse(session, request, InputFailure.ServiceDisabled)
            return null
        }
        if (ConnectSuiteInputService.isPhoneLocked(context)) {
            refuse(session, request, InputFailure.PhoneLocked)
            return null
        }
        if (needsScreen && contentBlocked()) {
            refuse(session, request, InputFailure.SecureSurface)
            return null
        }
        return service
    }

    /** The stamp check from docs/protocol.md, or null having already refused. */
    private fun verifiedStamp(
        session: ControlSession,
        request: Envelope,
    ): ScreenGeometryRegistry.Stamp? {
        val claimed = request.claimedGeometry()
        if (claimed == null) {
            refuse(
                session,
                request,
                InputFailure.BadRequest(
                    "geom {id, width, height} is required on anything carrying coordinates",
                ),
            )
            return null
        }
        val current = ScreenGeometryRegistry.current()
        InputGeometry.verify(current, claimed)?.let {
            refuse(session, request, it)
            return null
        }
        return current
    }

    private fun outOfFrame(
        point: FramePoint,
        stamp: ScreenGeometryRegistry.Stamp,
    ): InputFailure = InputFailure.GeometryStale(
        "(${point.x.toInt()}, ${point.y.toInt()}) is outside the " +
            "${stamp.width}x${stamp.height} screen it was stamped for",
    )

    // ---- replies ----------------------------------------------------------------------------

    /**
     * Running totals since process start, so that every line about input carries its own
     * denominator.
     *
     * Defect 18 hid behind 197 refusals that nothing divided: a refusal count on its own cannot
     * distinguish "input has never once worked" from "input works and the user misclicked a lot",
     * and those are the two readings that mattered. Both counters are printed on both kinds of
     * line, so either one answers the question on its own.
     */
    private val delivered = java.util.concurrent.atomic.AtomicLong(0)
    private val refused = java.util.concurrent.atomic.AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    private fun answer(session: ControlSession, request: Envelope, failure: InputFailure?) {
        if (failure == null) {
            delivered.incrementAndGet()
            LinkLog.i("input", "${request.type} delivered — ${tally()}")
            session.ack(request)
        } else {
            refuse(session, request, failure)
        }
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: InputFailure) {
        refused.incrementAndGet()
        LinkLog.w(
            "input",
            "${request.type} refused: ${failure.label} — ${failure.reason} — ${tally()}",
        )
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = failure.feature,
            fixHint = failure.fixHint,
        )
    }

    // ---- payload reading ---------------------------------------------------------------------
    //
    // Deliberately tolerant about *types* and strict about *presence*: a Mac that sends 540 where
    // 540.0 was expected is not a bug worth refusing, but a coordinate message with no geometry
    // stamp is refused every time.

    private fun Envelope.float(name: String): Float? =
        payload[name]?.jsonPrimitive?.content?.toFloatOrNull()

    private fun Envelope.string(name: String): String? =
        payload[name]?.jsonPrimitive?.content

    private fun Envelope.duration(default: Long): Long =
        (payload["durationMs"]?.jsonPrimitive?.content?.toDoubleOrNull()?.toLong() ?: default)
            .coerceIn(1L, MAX_DURATION_MS)

    private fun Envelope.framePoint(xName: String, yName: String): FramePoint? {
        val x = float(xName) ?: return null
        val y = float(yName) ?: return null
        return FramePoint(x, y)
    }

    private fun Envelope.claimedGeometry(): GeometryStamp? {
        val geom = (payload["geom"] as? JsonObject) ?: return null
        val id = geom["id"]?.jsonPrimitive?.content?.toLongOrNull() ?: return null
        val width = geom["width"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
        val height = geom["height"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
        return GeometryStamp(id, width, height)
    }

    private fun Envelope.framePath(): List<FramePoint>? {
        val array = (payload["points"] as? JsonArray) ?: return null
        if (array.size < 2 || array.size > MAX_PATH_POINTS) return null
        return array.map { element ->
            val point = element.jsonObject
            val x = point["x"]?.jsonPrimitive?.content?.toFloatOrNull() ?: return null
            val y = point["y"]?.jsonPrimitive?.content?.toFloatOrNull() ?: return null
            FramePoint(x, y)
        }
    }
}
