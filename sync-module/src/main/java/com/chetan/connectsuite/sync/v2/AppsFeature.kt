package com.chetan.connectsuite.sync.v2

import android.content.Context
import com.chetan.connectsuite.core.link.ControlSession
import com.chetan.connectsuite.core.link.LinkLog
import com.chetan.connectsuite.core.link.LinkServer
import com.chetan.connectsuite.core.link.MessageHandler
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.Envelope
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * The `apps` capability: list them, draw them, and **ask** to open one.
 *
 * ### Three verbs, and the missing fourth is the point
 *
 * `apps.list` and `apps.icon` are ordinary reads. `apps.open.ask` is not a launch verb, does not
 * call `startActivity`, and its ack means *the question was asked* — never *the app opened*.
 *
 * That shape is a measurement rather than a preference. `docs/phase-7-apps-proposal.md` §2.4, on
 * this handset, 2026-09-03: with ConnectSuite backgrounded and the screen on, `startActivity` for a
 * third-party package **threw nothing, logged nothing, and did not bring the app to the front** —
 * `dumpsys activity activities` still named the launcher as topmost. That is the proposal's fourth
 * row: the outcome every automated check calls a pass and which fails only in a user's hand. A verb
 * built on it would report success and do nothing.
 *
 * So there is no `apps.launch` in `MessageType`, nothing here registers one, and the prohibition has
 * an enforcement point rather than a comment: `scripts/check-apps-verb.mjs`, wired to `PreToolUse`
 * on `git commit`. `AppsContractTest` is its twin on this side — it asserts, against the live
 * `handledTypes` and the live capability contract, that no type in this namespace contains the word.
 *
 * ### What the counters mean
 *
 * `asked` beside `refused`, and `asked` is deliberately **not** called *opened*. The phone cannot
 * know whether an app opened: what opens it is a person tapping a notification, later, or never. A
 * counter named for something the process cannot observe is the first place a wrong claim gets a
 * number attached to it and becomes believable.
 */
object AppsFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.APPS_LIST,
        MessageType.APPS_ICON,
        MessageType.APPS_OPEN_ASK,
    )

    @Volatile
    private var installed = false

    private val listed = AtomicLong(0)
    private val iconsServed = AtomicLong(0)
    private val asked = AtomicLong(0)
    private val refused = AtomicLong(0)

    private fun tally(): String =
        "${listed.get()} lists / ${iconsServed.get()} icon batches / ${asked.get()} asked / " +
            "${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }
        link.refreshCapabilities()
        LinkLog.i(
            "apps",
            "Apps feature installed with all ${handledTypes.size} verbs and no launch verb — " +
                "background activity starts are refused silently on this platform, so opening is a " +
                "notification the user taps. Notifications currently " +
                (if (AppsNotifications.canPost(app)) "permitted" else "BLOCKED, so apps.open.ask cannot be delivered") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        link.refreshCapabilities()
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.APPS_LIST -> MessageHandler { session, request -> onList(session, request, context) }
        MessageType.APPS_ICON -> MessageHandler { session, request -> onIcon(session, request, context) }
        MessageType.APPS_OPEN_ASK -> MessageHandler { session, request -> onOpenAsk(session, request, context) }
        else -> error("AppsFeature.handledTypes lists $type with no handler")
    }

    // --- apps.list ---------------------------------------------------------------------------------

    /**
     * Every launcher package, sorted, with both counts.
     *
     * The elapsed time is on the line beside the count because `CLAUDE.md`'s pager rule applies to a
     * list that does not page as much as to one that does — defect 55 was a pager that lost no rows
     * and took 490 seconds, invisible in every count. This one is a single in-memory query plus a
     * label lookup per package; if it ever stops being that, the number on this line is where it
     * will show.
     */
    private fun onList(session: ControlSession, request: Envelope, context: Context) {
        val startedAt = System.currentTimeMillis()
        val page = AppsPayloads.page(AppsStore.apps(context))
        val elapsed = System.currentTimeMillis() - startedAt
        listed.incrementAndGet()

        session.ack(request) {
            put(
                "apps",
                buildJsonArray { page.apps.forEach { add(AppsPayloads.entry(it)) } } as JsonArray,
            )
            put("count", page.count)
            // Sent always, not only when it differs. A field that appears only on truncation is a
            // field nobody's parser has ever seen, on the one day it matters.
            put("total", page.total)
        }
        LinkLog.i(
            "apps",
            "apps.list → ${page.count} of ${page.total} packages in ${elapsed}ms" +
                (if (page.truncated) " — TRUNCATED at the ${AppsPayloads.MAX_APPS} cap" else "") +
                " — ${tally()}",
        )
    }

    // --- apps.icon ---------------------------------------------------------------------------------

    private fun onIcon(session: ControlSession, request: Envelope, context: Context) {
        val packages = request.payload["packages"]?.let { element ->
            runCatching { element.jsonArray.map { it.jsonPrimitive.content } }.getOrNull()
        } ?: return refuse(
            session, request, ErrorCode.BAD_REQUEST,
            "packages must be an array of package names.",
        )

        if (!AppsPayloads.iconBatchIsLegal(packages.size)) {
            return refuse(
                session, request, ErrorCode.BAD_REQUEST,
                "packages must hold 1 to ${AppsPayloads.MAX_ICON_PACKAGES} entries; " +
                    "this asked for ${packages.size}.",
            )
        }
        val edge = AppsPayloads.iconEdgeOrNull(request.int("maxEdge"))
            ?: return refuse(
                session, request, ErrorCode.BAD_REQUEST,
                "maxEdge must be between ${AppsPayloads.MIN_ICON_EDGE} and " +
                    "${AppsPayloads.MAX_ICON_EDGE}; nothing was scaled to fit.",
            )

        val icons = AppsStore.icons(context, packages, edge)
        iconsServed.incrementAndGet()
        session.ack(request) {
            put("icons", buildJsonArray { icons.forEach { add(it) } } as JsonArray)
        }
    }

    // --- apps.open.ask ------------------------------------------------------------------------------

    /**
     * Posts the question, and answers `{ asked: true }` only when it was actually posted.
     *
     * Three refusals, and each one is a thing that genuinely did not happen:
     *
     *  - no `package` — `BAD_REQUEST`.
     *  - no launcher intent for it **right now** — `NOT_FOUND`. Re-resolved here rather than trusted
     *    from whatever the Mac's grid holds, because an app can be uninstalled between a list being
     *    drawn and a tile being clicked, and offering to open something that is gone is worse than
     *    saying so.
     *  - notifications off — `NOTIFICATIONS_BLOCKED`. **This is the refusal that matters.** The
     *    tempting alternative is to post nothing and ack anyway, which reintroduces the exact
     *    failure this whole namespace is shaped around: a success that did not happen, invisible to
     *    every check, discovered by a person watching a phone that never buzzed.
     */
    private fun onOpenAsk(session: ControlSession, request: Envelope, context: Context) {
        val packageName = request.str("package")
            ?: return refuse(session, request, ErrorCode.BAD_REQUEST, "package is required.")

        val intent = AppsStore.launchIntentFor(context, packageName)
            ?: return refuse(
                session, request, ErrorCode.NOT_FOUND,
                // The label, not the id, in the sentence — and AppLabels falls back to the id only
                // when it genuinely cannot resolve one, which for a missing package it cannot.
                "${AppLabels.of(context, packageName)} is not installed on this phone, or has no " +
                    "home-screen icon to open.",
                fixHint = "Refresh the app list.",
            )

        val label = AppLabels.of(context, packageName)
        val posted = AppsNotifications.ask(
            context = context,
            packageName = packageName,
            label = label,
            intent = intent,
            askedBy = session.peerName,
        )
        if (!posted) {
            return refuse(
                session, request, ErrorCode.NOTIFICATIONS_BLOCKED,
                "The phone could not show the request: notifications from ConnectSuite are turned " +
                    "off, and tapping one is the only way an app can be opened from here.",
                fixHint = "Turn on notifications for ConnectSuite on the phone.",
            )
        }

        asked.incrementAndGet()
        session.ack(request) {
            // The only field, deliberately. There is nowhere to read *opened* from because the
            // phone does not know and will not learn — a client wanting to draw "opened" has to be
            // told it cannot, and the absence of a field is how it is told.
            put("asked", true)
        }
        LinkLog.i(
            "apps",
            "apps.open.ask → asked to open \"$label\" ($packageName); whether it opens is the " +
                "user's tap and this phone will never know — ${tally()}",
        )
    }

    private fun refuse(
        session: ControlSession,
        request: Envelope,
        code: String,
        message: String,
        fixHint: String? = null,
    ) {
        refused.incrementAndGet()
        LinkLog.w("apps", "${request.type} refused: $code — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = code,
            message = message,
            feature = Capability.APPS,
            fixHint = fixHint,
        )
    }

    private fun Envelope.str(key: String): String? =
        payload[key]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }

    private fun Envelope.int(key: String): Int? =
        payload[key]?.jsonPrimitive?.content?.toIntOrNull()
}
