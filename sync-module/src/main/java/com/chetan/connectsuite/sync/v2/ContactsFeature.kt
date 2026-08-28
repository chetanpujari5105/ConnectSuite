package com.chetan.connectsuite.sync.v2

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
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
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicLong

/**
 * Wires contacts into the link, and by doing so turns the `contacts` capability on.
 *
 * The smallest feature in Phase 4 and the one the other two lean on: `sms.threads` and `call.log`
 * both call [ContactsStore.nameForNumber], so granting contacts is what turns two columns of phone
 * numbers into two columns of people. Neither of them *requires* it — they degrade to numbers and
 * say nothing about it, because a thread list that refuses to load without contacts access would
 * be a worse trade than one that shows numbers.
 */
object ContactsFeature {

    val handledTypes: Set<String> = setOf(
        MessageType.CONTACTS_LIST,
        MessageType.CONTACTS_GET,
    )

    @Volatile
    private var installed = false

    private val delivered = AtomicLong(0)
    private val refused = AtomicLong(0)

    private fun tally(): String = "${delivered.get()} delivered / ${refused.get()} refused since start"

    fun install(context: Context, link: LinkServer) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        handledTypes.forEach { type -> link.register(type, handlerFor(type, app)) }
        link.refreshCapabilities()
        LinkLog.i(
            "contacts",
            "Contacts feature installed; READ_CONTACTS " +
                (if (granted(app)) "granted" else "not granted") +
                "; capabilities now: ${link.capabilities.current().sorted()}",
        )
    }

    fun uninstall(link: LinkServer) {
        if (!installed) return
        installed = false
        handledTypes.forEach(link::unregister)
        link.refreshCapabilities()
    }

    /** True when the OS would let us read the book. The other half is [handledTypes] being live. */
    fun granted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * The name for a number, for the other Phase 4 features, or null.
     *
     * Returns null rather than throwing or refusing when contacts access is off. That is the whole
     * degradation rule for name resolution: a thread list without names is still a thread list,
     * and refusing to build one because a *different* capability is ungranted would take a working
     * feature off the Mac to punish a permission the user declined for good reason.
     */
    fun nameFor(context: Context, number: String): String? {
        if (!granted(context)) return null
        return ContactsStore.nameForNumber(context, number)
    }

    private fun handlerFor(type: String, context: Context): MessageHandler = when (type) {
        MessageType.CONTACTS_LIST -> MessageHandler { session, request -> onList(session, request, context) }
        MessageType.CONTACTS_GET -> MessageHandler { session, request -> onGet(session, request, context) }
        else -> error("ContactsFeature.handledTypes lists $type with no handler")
    }

    private fun onList(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, ContactsFailure.NotGranted)
        val limit = request.int("limit") ?: ContactsStore.DEFAULT_LIMIT
        if (limit < 1 || limit > ContactsStore.MAX_LIMIT) {
            return refuse(
                session,
                request,
                ContactsFailure.BadRequest("limit must be between 1 and ${ContactsStore.MAX_LIMIT}"),
            )
        }

        val (contacts, hasMore) = ContactsStore.list(
            context = context,
            limit = limit,
            query = request.str("query"),
            sinceMs = request.long("since"),
        )
        delivered.incrementAndGet()
        LinkLog.i("contacts", "contacts.list → ${contacts.size} rows, hasMore=$hasMore — ${tally()}")
        session.ack(request) {
            put("contacts", buildJsonArray { contacts.forEach { add(it) } } as JsonArray)
            put("hasMore", hasMore)
        }
    }

    private fun onGet(session: ControlSession, request: Envelope, context: Context) {
        if (!granted(context)) return refuse(session, request, ContactsFailure.NotGranted)
        val id = request.str("id")
        val number = request.str("number")
        if (id == null && number == null) {
            return refuse(session, request, ContactsFailure.BadRequest("id or number is required"))
        }
        val withPhoto = request.payload["withPhoto"]?.jsonPrimitive?.content == "true"

        val contact = if (id != null) {
            ContactsStore.byId(context, id, withPhoto)
        } else {
            ContactsStore.byNumber(context, number!!, withPhoto)
        } ?: return refuse(session, request, ContactsFailure.NoSuchContact(id ?: number!!))

        delivered.incrementAndGet()
        LinkLog.i("contacts", "contacts.get → ${id ?: number} found — ${tally()}")
        session.ack(request) { contact.forEach { (key, value) -> put(key, value) } }
    }

    private fun refuse(session: ControlSession, request: Envelope, failure: ContactsFailure) {
        refused.incrementAndGet()
        LinkLog.w("contacts", "${request.type} refused: ${failure.label} — ${tally()}")
        session.sendError(
            requestId = request.id,
            code = failure.code,
            message = failure.reason,
            feature = Capability.CONTACTS,
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

/** Every way a contacts request can fail, each with the sentence a person reads. */
sealed class ContactsFailure(
    val label: String,
    val code: String,
    val reason: String,
    val fixHint: String? = null,
) {
    object NotGranted : ContactsFailure(
        label = "not-granted",
        code = ErrorCode.PERMISSION_DENIED,
        reason = "This phone is not sharing its contacts.",
        fixHint = "On the phone: Settings > Apps > ConnectSuite > Permissions > Contacts, and " +
            "choose Allow.",
    )

    class NoSuchContact(what: String) : ContactsFailure(
        label = "no-such-contact",
        code = ErrorCode.NOT_FOUND,
        reason = "The phone has no contact matching $what.",
    )

    class BadRequest(detail: String) : ContactsFailure(
        label = "bad-request",
        code = ErrorCode.BAD_REQUEST,
        reason = "That request was not understood by the phone ($detail), so nothing was sent.",
    )
}
