package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.database.Cursor
import android.provider.CallLog
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Reads the phone's call log. One page at a time, newest first, names resolved where possible. */
object CallLogStore {

    const val MAX_LIMIT = 200
    const val DEFAULT_LIMIT = 50

    fun entries(
        context: Context,
        limit: Int,
        beforeMs: Long?,
    ): Pair<List<JsonObject>, Boolean> {
        val capped = limit.coerceIn(1, MAX_LIMIT)
        val rows = mutableListOf<JsonObject>()
        var hasMore = false

        val selection = if (beforeMs != null) "${CallLog.Calls.DATE} < ?" else null
        val args = if (beforeMs != null) arrayOf(beforeMs.toString()) else null

        runCatching {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls._ID,
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE,
                    CallLog.Calls.DATE,
                    CallLog.Calls.DURATION,
                ),
                selection,
                args,
                "${CallLog.Calls.DATE} DESC",
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    if (rows.size == capped) {
                        hasMore = true
                        break
                    }
                    rows.add(row(context, cursor))
                }
            }
        }.onFailure { LinkLog.w("calls", "Call log query failed: ${it.message}") }

        return rows to hasMore
    }

    private fun row(context: Context, cursor: Cursor): JsonObject {
        val number = cursor.getString(1).orEmpty()
        // CACHED_NAME is the name as it was when the call happened, which is why it is preferred:
        // it is what the user saw on the screen at the time. The live lookup is the fallback for
        // rows the platform never cached, and for contacts added since.
        val cached = cursor.getString(2)?.takeIf { it.isNotBlank() }
        return buildJsonObject {
            put("id", cursor.getString(0).orEmpty())
            put("number", number)
            (cached ?: ContactsFeature.nameFor(context, number))?.let { put("contactName", it) }
            put("type", typeName(cursor.getInt(3)))
            put("dateMs", cursor.getLong(4))
            put("durationMs", cursor.getLong(5) * 1000L)
        }
    }

    /**
     * The platform's call type as the name docs/protocol.md uses.
     *
     * `durationMs` is seconds in the provider and milliseconds on the wire — the multiplication in
     * [row] is not a stylistic choice. Every other time on this protocol is milliseconds, and one
     * field in seconds is the kind of inconsistency that produces a call log showing "42 ms".
     */
    private fun typeName(type: Int): String = when (type) {
        CallLog.Calls.INCOMING_TYPE -> "incoming"
        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
        CallLog.Calls.MISSED_TYPE -> "missed"
        CallLog.Calls.REJECTED_TYPE -> "rejected"
        CallLog.Calls.BLOCKED_TYPE -> "blocked"
        CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
        // Unknown rather than a guess. A new call type from a future Android version mislabelled
        // as "incoming" is worse than one the Mac shows plainly as unrecognised.
        else -> "unknown"
    }
}
