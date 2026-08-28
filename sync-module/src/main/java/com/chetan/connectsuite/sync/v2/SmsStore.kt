package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.Telephony
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Reads SMS and MMS out of the phone's own provider.
 *
 * Everything here goes through `content://mms-sms`, which is the only place a non-default SMS app
 * can read from. That has one consequence worth stating up front, because it shapes every method
 * below: **we see what the user's real messaging app has already stored.** A message is here
 * because the platform put it here, not because we captured it, so there is nothing to keep in
 * sync and no second copy to go stale.
 *
 * ### What "SMS" means on the wire, and what it does not
 *
 * `docs/protocol.md` says `sms.*` carries SMS and the *text parts* of MMS, and reports attachments
 * without delivering them. That is implemented here rather than fudged: [messages] reads both
 * tables, joins an MMS's text parts into `body`, and sets `hasAttachments` from the parts it did
 * not send. A Mac showing a text-only MMS as though it were the whole message would be lying about
 * a picture the user's friend sent, which is the sort of quiet wrongness that makes people stop
 * trusting a mirror.
 */
object SmsStore {

    const val MAX_LIMIT = 200
    const val DEFAULT_LIMIT = 50

    /** The `mms-sms` conversations view: SMS and MMS threads together, newest first. */
    private val conversations: Uri = Telephony.MmsSms.CONTENT_CONVERSATIONS_URI

    /**
     * One page of threads, newest first.
     *
     * `contactName` is filled in per thread through [ContactsFeature.nameFor], which returns null
     * when contacts access is off — so the field is simply absent and the Mac shows the number.
     * That degradation is deliberate and is described in docs/protocol.md; refusing to build a
     * thread list because a *different* capability is ungranted would be a worse trade.
     */
    fun threads(
        context: Context,
        limit: Int,
        beforeMs: Long?,
    ): Pair<List<JsonObject>, Boolean> {
        val capped = limit.coerceIn(1, MAX_LIMIT)
        val rows = mutableListOf<JsonObject>()
        var hasMore = false

        val selection = if (beforeMs != null) "date < ?" else null
        val args = if (beforeMs != null) arrayOf(beforeMs.toString()) else null

        query(
            context,
            conversations,
            // Deliberately null rather than a column list. The conversations view does not accept
            // an arbitrary projection on every OEM — Samsung's provider throws on some columns
            // that AOSP allows — and the rows are small enough that reading them whole is cheaper
            // than maintaining a per-vendor projection table.
            null,
            selection,
            args,
            "date DESC",
        ) { cursor ->
            while (cursor.moveToNext()) {
                if (rows.size == capped) {
                    hasMore = true
                    break
                }
                val threadId = cursor.stringOf("thread_id") ?: continue
                val address = cursor.stringOf("address")
                    ?: addressForThread(context, threadId)
                    ?: ""
                rows.add(
                    buildJsonObject {
                        put("threadId", threadId)
                        put("addresses", buildAddresses(address))
                        put("snippet", cursor.stringOf("body").orEmpty())
                        put("dateMs", cursor.longOf("date") ?: 0L)
                        put("unread", unreadCount(context, threadId))
                        put("messageCount", messageCount(context, threadId))
                        ContactsFeature.nameFor(context, address)?.let { put("contactName", it) }
                    },
                )
            }
        }
        return rows to hasMore
    }

    /**
     * One page of messages in a thread, newest first, SMS and MMS interleaved.
     *
     * The two live in different tables with different column names and — the part that catches
     * everyone — **different time units**: `sms.date` is epoch milliseconds and `mms.date` is
     * epoch *seconds*. They are read separately, normalised, merged and then paged, because a
     * single query across `mms-sms` cannot project the columns both sides need.
     *
     * Reading `limit` from each table before merging is deliberate over-reading. The alternative,
     * splitting the limit between them, silently truncates a thread that is all SMS — and a thread
     * that is all SMS is most threads.
     */
    fun messages(
        context: Context,
        threadId: String,
        limit: Int,
        beforeMs: Long?,
    ): Pair<List<JsonObject>, Boolean> {
        val capped = limit.coerceIn(1, MAX_LIMIT)
        val sms = smsIn(context, threadId, capped + 1, beforeMs)
        val mms = mmsIn(context, threadId, capped + 1, beforeMs)

        val merged = (sms + mms).sortedByDescending { it.second }
        val hasMore = merged.size > capped
        return merged.take(capped).map { it.first } to hasMore
    }

    /** SMS rows of a thread, each paired with its epoch-ms date so the merge can sort. */
    private fun smsIn(
        context: Context,
        threadId: String,
        limit: Int,
        beforeMs: Long?,
    ): List<Pair<JsonObject, Long>> {
        val rows = mutableListOf<Pair<JsonObject, Long>>()
        val selection = StringBuilder("${Telephony.Sms.THREAD_ID} = ?")
        val args = mutableListOf(threadId)
        if (beforeMs != null) {
            selection.append(" AND ${Telephony.Sms.DATE} < ?")
            args.add(beforeMs.toString())
        }

        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE,
                Telephony.Sms.TYPE,
                Telephony.Sms.READ,
            ),
            selection.toString(),
            args.toTypedArray(),
            "${Telephony.Sms.DATE} DESC",
        ) { cursor ->
            while (cursor.moveToNext() && rows.size < limit) {
                rows.add(smsRow(cursor, threadId) to (cursor.longOf(Telephony.Sms.DATE) ?: 0L))
            }
        }
        return rows
    }

    /**
     * MMS rows of a thread: text parts joined into `body`, everything else counted.
     *
     * Three queries per message is the shape the provider forces — the message row, its parts, and
     * its addresses — and it is why the MMS side is capped harder than the SMS side would need to
     * be. A thread of a hundred MMS would otherwise be three hundred content queries for one page.
     */
    private fun mmsIn(
        context: Context,
        threadId: String,
        limit: Int,
        beforeMs: Long?,
    ): List<Pair<JsonObject, Long>> {
        val rows = mutableListOf<Pair<JsonObject, Long>>()
        val selection = StringBuilder("${Telephony.Mms.THREAD_ID} = ?")
        val args = mutableListOf(threadId)
        if (beforeMs != null) {
            // Seconds, not milliseconds. This is the single most common MMS bug and it fails
            // silently: comparing a millisecond cursor against a second column returns every row
            // ever sent, so a page that looks fine is actually the whole thread.
            selection.append(" AND ${Telephony.Mms.DATE} < ?")
            args.add((beforeMs / 1000).toString())
        }

        query(
            context,
            Telephony.Mms.CONTENT_URI,
            arrayOf(
                Telephony.Mms._ID,
                Telephony.Mms.DATE,
                Telephony.Mms.MESSAGE_BOX,
                Telephony.Mms.READ,
            ),
            selection.toString(),
            args.toTypedArray(),
            "${Telephony.Mms.DATE} DESC",
        ) { cursor ->
            while (cursor.moveToNext() && rows.size < limit) {
                val id = cursor.stringOf(Telephony.Mms._ID) ?: continue
                val dateMs = (cursor.longOf(Telephony.Mms.DATE) ?: 0L) * 1000L
                val inbound = cursor.intOf(Telephony.Mms.MESSAGE_BOX) == Telephony.Mms.MESSAGE_BOX_INBOX
                val parts = partsOf(context, id)
                val address = mmsAddress(context, id, inbound)
                rows.add(
                    buildJsonObject {
                        put("id", "mms:$id")
                        put("threadId", threadId)
                        put("address", address)
                        put("body", parts.text)
                        put("dateMs", dateMs)
                        put("inbound", inbound)
                        put("read", cursor.intOf(Telephony.Mms.READ) == 1)
                        put("kind", "mms")
                        // The honest half of the MMS story. docs/protocol.md promises the Mac is
                        // told an attachment exists and is not sent one; this is where "exists" is
                        // decided, and it is a count of parts that were not text rather than a
                        // guess from the message type.
                        put("hasAttachments", parts.attachments > 0)
                        if (parts.attachments > 0) put("attachmentCount", parts.attachments)
                    } to dateMs,
                )
            }
        }
        return rows
    }

    private class MmsParts(val text: String, val attachments: Int)

    private fun partsOf(context: Context, messageId: String): MmsParts {
        val text = StringBuilder()
        var attachments = 0
        query(
            context,
            Uri.parse("content://mms/part"),
            arrayOf("_id", "ct", "text"),
            "mid = ?",
            arrayOf(messageId),
            null,
        ) { cursor ->
            while (cursor.moveToNext()) {
                when (val type = cursor.stringOf("ct")) {
                    "text/plain" -> cursor.stringOf("text")?.let {
                        if (text.isNotEmpty()) text.append('\n')
                        text.append(it)
                    }
                    // SMIL is the layout description every MMS carries. It is not an attachment
                    // and counting it would put "1 attachment" on every text-only MMS.
                    "application/smil", null -> Unit
                    else -> if (type.isNotBlank()) attachments++
                }
            }
        }
        return MmsParts(text.toString(), attachments)
    }

    /**
     * The other party's number on an MMS.
     *
     * `addr` rows carry a type: 137 is FROM and 151 is TO. Which one is "the other party" depends
     * on direction, which is why this takes it — reading FROM on an outgoing message returns the
     * user's own number and would draw every sent MMS as though a stranger had sent it.
     */
    private fun mmsAddress(context: Context, messageId: String, inbound: Boolean): String {
        val wanted = if (inbound) MMS_ADDR_FROM else MMS_ADDR_TO
        var address = ""
        query(
            context,
            Uri.parse("content://mms/$messageId/addr"),
            arrayOf("address", "type"),
            "type = ?",
            arrayOf(wanted.toString()),
            null,
        ) { cursor ->
            if (cursor.moveToFirst()) address = cursor.stringOf("address").orEmpty()
        }
        return address
    }

    /** One `sms.received` payload, from the parts a broadcast handed us. */
    fun receivedPayload(
        context: Context,
        address: String,
        body: String,
        dateMs: Long,
    ): JsonObject? {
        // The broadcast arrives before the provider has necessarily written the row, so the id and
        // thread are looked up rather than assumed. An absent id is honest; a fabricated one would
        // be a token the Mac could hand back and get NOT_FOUND for — which is why a lookup that
        // comes back empty produces *no payload at all* rather than a partial one. See the
        // retry in SmsFeature.onReceived, which is what makes that outcome rare.
        val row = newestRowFor(context, address) ?: return null
        return SmsPayloads.receivedEnvelope(
            threadId = row.threadId,
            id = row.id,
            address = address,
            body = body,
            dateMs = dateMs,
            contactName = ContactsFeature.nameFor(context, address),
        )
    }

    /** The `_id` and `thread_id` of one provider row, read together. */
    data class ReceivedRow(val id: String, val threadId: String)

    /**
     * Both ids in **one** query.
     *
     * Two queries could straddle the provider write — the thread found, the id not, or the row
     * replaced between them — and produce a message stamped with an id belonging to a different
     * row. The pair is only meaningful read together.
     */
    fun newestRowFor(context: Context, address: String): ReceivedRow? {
        var row: ReceivedRow? = null
        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms._ID, Telephony.Sms.THREAD_ID),
            "${Telephony.Sms.ADDRESS} = ?",
            arrayOf(address),
            "${Telephony.Sms.DATE} DESC",
        ) { cursor ->
            if (cursor.moveToFirst()) {
                val id = cursor.getString(0)
                val thread = cursor.getString(1)
                if (!id.isNullOrBlank() && !thread.isNullOrBlank()) row = ReceivedRow(id, thread)
            }
        }
        return row
    }

    private fun smsRow(cursor: Cursor, threadId: String): JsonObject = buildJsonObject {
        put("id", cursor.stringOf(Telephony.Sms._ID).orEmpty())
        put("threadId", threadId)
        put("address", cursor.stringOf(Telephony.Sms.ADDRESS).orEmpty())
        put("body", cursor.stringOf(Telephony.Sms.BODY).orEmpty())
        put("dateMs", cursor.longOf(Telephony.Sms.DATE) ?: 0L)
        // MESSAGE_TYPE_INBOX is the only inbound type; everything else — sent, outbox, draft,
        // failed, queued — came from this phone. Collapsing them to a boolean is what the Mac
        // needs to decide which side of the thread to draw the bubble on.
        put("inbound", cursor.intOf(Telephony.Sms.TYPE) == Telephony.Sms.MESSAGE_TYPE_INBOX)
        put("read", cursor.intOf(Telephony.Sms.READ) == 1)
        put("kind", "sms")
        put("hasAttachments", false)
    }

    // ---- sub-queries ----------------------------------------------------------------------

    private fun buildAddresses(address: String) =
        kotlinx.serialization.json.buildJsonArray {
            if (address.isNotBlank()) {
                address.split(' ', ',').filter { it.isNotBlank() }.forEach {
                    add(kotlinx.serialization.json.JsonPrimitive(it))
                }
            }
        }

    private fun unreadCount(context: Context, threadId: String): Int = countWhere(
        context,
        "${Telephony.Sms.THREAD_ID} = ? AND ${Telephony.Sms.READ} = 0",
        arrayOf(threadId),
    )

    private fun messageCount(context: Context, threadId: String): Int = countWhere(
        context,
        "${Telephony.Sms.THREAD_ID} = ?",
        arrayOf(threadId),
    )

    private fun countWhere(context: Context, selection: String, args: Array<String>): Int {
        var count = 0
        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms._ID),
            selection,
            args,
            null,
        ) { cursor -> count = cursor.count }
        return count
    }

    private fun addressForThread(context: Context, threadId: String): String? {
        var address: String? = null
        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS),
            "${Telephony.Sms.THREAD_ID} = ?",
            arrayOf(threadId),
            "${Telephony.Sms.DATE} DESC",
        ) { cursor -> if (cursor.moveToFirst()) address = cursor.getString(0) }
        return address
    }

    /** The thread a number belongs to, or null when the provider has not created one yet. */
    fun threadIdFor(context: Context, address: String): String? {
        var id: String? = null
        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.THREAD_ID),
            "${Telephony.Sms.ADDRESS} = ?",
            arrayOf(address),
            "${Telephony.Sms.DATE} DESC",
        ) { cursor -> if (cursor.moveToFirst()) id = cursor.getString(0) }
        return id
    }

    /** True when the thread exists at all, so a send or a read can refuse with NOT_FOUND. */
    fun threadExists(context: Context, threadId: String): Boolean =
        countWhere(context, "${Telephony.Sms.THREAD_ID} = ?", arrayOf(threadId)) > 0

    /** Every distinct address in a thread, for a send that was given a thread and no recipient. */
    fun addressesIn(context: Context, threadId: String): List<String> {
        val found = linkedSetOf<String>()
        query(
            context,
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS),
            "${Telephony.Sms.THREAD_ID} = ?",
            arrayOf(threadId),
            "${Telephony.Sms.DATE} DESC",
        ) { cursor ->
            while (cursor.moveToNext()) {
                cursor.getString(0)?.takeIf { it.isNotBlank() }?.let(found::add)
            }
        }
        return found.toList()
    }

    // ---- cursor plumbing --------------------------------------------------------------------

    private inline fun query(
        context: Context,
        uri: Uri,
        projection: Array<String>?,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String?,
        body: (Cursor) -> Unit,
    ) {
        runCatching {
            context.contentResolver
                .query(uri, projection, selection, selectionArgs, sortOrder)
                ?.use(body)
        }.onFailure { LinkLog.w("sms", "Query on $uri failed: ${it.message}") }
    }

    /**
     * Column lookups by name rather than by index.
     *
     * The conversations view is read with a null projection (see [threads]) so the column order is
     * the provider's, not ours, and it differs between OEMs. Looking up by name costs a hash and
     * removes a whole class of "works on a Pixel, wrong column on a Samsung" bug.
     */
    private fun Cursor.stringOf(column: String): String? {
        val index = getColumnIndex(column)
        return if (index < 0 || isNull(index)) null else getString(index)?.takeIf { it.isNotBlank() }
    }

    private fun Cursor.longOf(column: String): Long? {
        val index = getColumnIndex(column)
        return if (index < 0 || isNull(index)) null else getLong(index)
    }

    private fun Cursor.intOf(column: String): Int? {
        val index = getColumnIndex(column)
        return if (index < 0 || isNull(index)) null else getInt(index)
    }

    /** PDU address types, from the MMS spec. There is no platform constant for either. */
    private const val MMS_ADDR_FROM = 137
    private const val MMS_ADDR_TO = 151
}

/**
 * The `sms.received` payload, built with no [Context] and no content provider anywhere near it.
 *
 * Its own object rather than a method on [SmsStore] for one concrete reason: `SmsStore` holds
 * `Telephony.MmsSms.CONTENT_CONVERSATIONS_URI` in a field initializer, so merely *referencing* it
 * from a JVM unit test throws `ExceptionInInitializerError` off the Android stubs. A shape defined
 * by `docs/protocol.md` deserves a test that reads the contract, and that test cannot run against
 * a function it cannot load.
 *
 * This is the phone-side version of the rule `CLAUDE.md` states for the Mac — prefer making the
 * code testable over mocking the platform — and `src/shared/session.ts` came out of `link.ts` the
 * same way.
 */
object SmsPayloads {

    /**
     * The `sms.received` payload, with no [Context] in sight.
     *
     * Split out so the *shape* can be tested off-device. docs/protocol.md specifies this event as
     * "carrying exactly one `messages[]` entry plus its `threadId`", and defect 34 was this
     * function building it flat instead — every field at the top level, no array, no id — which
     * the Mac dropped on the floor for two sessions while the phone logged a successful push.
     * A shape defined by a contract deserves a test that reads the contract, and that test cannot
     * run against a function that needs a content provider.
     */
    fun receivedEnvelope(
        threadId: String,
        id: String,
        address: String,
        body: String,
        dateMs: Long,
        contactName: String?,
    ): JsonObject = buildJsonObject {
        put("threadId", threadId)
        put(
            "messages",
            kotlinx.serialization.json.buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", id)
                        put("threadId", threadId)
                        put("address", address)
                        put("body", body)
                        put("dateMs", dateMs)
                        put("inbound", true)
                        put("read", false)
                        put("kind", "sms")
                        put("hasAttachments", false)
                        contactName?.let { put("contactName", it) }
                    },
                )
            },
        )
    }
}
