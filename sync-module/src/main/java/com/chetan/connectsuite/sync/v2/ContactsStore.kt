package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.ContactsContract
import android.util.Base64
import com.chetan.connectsuite.core.link.LinkLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream

/**
 * Reads the phone's contacts, and turns numbers into names for everything else in Phase 4.
 *
 * The second job is the one that matters most. An SMS thread list and a call log carry phone
 * numbers, and a Mac showing columns of `+15551234567` is technically a working feature and
 * practically unusable. Every lookup in this file exists so that the *other* features are legible.
 *
 * Nothing here caches across requests. `ContactsContract` is backed by a real index and a lookup
 * costs about a millisecond; a cache would buy that millisecond back in exchange for showing the
 * wrong name after the user edits a contact, which is a bad trade for a feature whose entire job
 * is to be right about who someone is.
 */
object ContactsStore {

    /** The `contacts.list` cap from docs/protocol.md. A page, not a phone book. */
    const val MAX_LIMIT = 200
    const val DEFAULT_LIMIT = 50

    /**
     * Largest contact photo put on the control channel, in bytes.
     *
     * 64 KiB, and enforced by downscaling rather than by refusing: a user whose contact has a
     * 4-megapixel photo wants a smaller picture, not an error. The control channel accepts 16 MiB
     * frames, so this is not about what fits — it is about a channel that carries a live link not
     * being asked to move photographs. Bulk delivery is the bulk channel's job.
     */
    const val MAX_PHOTO_BYTES = 64 * 1024

    private val projection = arrayOf(
        ContactsContract.Contacts._ID,
        ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
        ContactsContract.Contacts.PHOTO_ID,
    )

    /**
     * One page of contacts, ordered by display name.
     *
     * **Not newest-first**, unlike every other list in Phase 4, and docs/protocol.md says so: a
     * contact book has no meaningful recency and alphabetical is the only order a person can
     * navigate. That is why this takes `since` rather than `before` — a Mac that has synced once
     * refreshes by asking what changed, not by paging backwards through the alphabet.
     */
    fun list(
        context: Context,
        limit: Int,
        query: String?,
        sinceMs: Long?,
    ): Pair<List<JsonObject>, Boolean> {
        val capped = limit.coerceIn(1, MAX_LIMIT)
        val where = StringBuilder()
        val args = mutableListOf<String>()

        // Contacts with no name at all are rows the user has never seen and cannot recognise —
        // usually an account sync artefact. They would be blank lines in the Mac's list.
        where.append("${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} IS NOT NULL")
        if (sinceMs != null) {
            where.append(" AND ${ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP} > ?")
            args.add(sinceMs.toString())
        }
        if (!query.isNullOrBlank()) {
            where.append(" AND ${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} LIKE ?")
            args.add("%$query%")
        }

        // One more than asked for, which is how `hasMore` is answered without a second count
        // query: if the extra row exists there is more, and it is dropped before sending.
        val rows = mutableListOf<JsonObject>()
        var hasMore = false
        query(
            context,
            ContactsContract.Contacts.CONTENT_URI,
            projection,
            where.toString(),
            args.toTypedArray(),
            "${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} COLLATE NOCASE ASC",
        ) { cursor ->
            while (cursor.moveToNext()) {
                if (rows.size == capped) {
                    hasMore = true
                    break
                }
                val id = cursor.getString(0) ?: continue
                rows.add(
                    buildJsonObject {
                        put("id", id)
                        put("displayName", cursor.getString(1).orEmpty())
                        put("hasPhoto", cursor.getLongOrNull(2) != null)
                        put("numbers", numbersFor(context, id))
                        put("emails", emailsFor(context, id))
                    },
                )
            }
        }
        return rows to hasMore
    }

    /** One contact by its id, or null. */
    fun byId(context: Context, id: String, withPhoto: Boolean): JsonObject? {
        var result: JsonObject? = null
        query(
            context,
            ContactsContract.Contacts.CONTENT_URI,
            projection,
            "${ContactsContract.Contacts._ID} = ?",
            arrayOf(id),
            null,
        ) { cursor ->
            if (cursor.moveToFirst()) {
                result = buildJsonObject {
                    put("id", id)
                    put("displayName", cursor.getString(1).orEmpty())
                    put("hasPhoto", cursor.getLongOrNull(2) != null)
                    put("numbers", numbersFor(context, id))
                    put("emails", emailsFor(context, id))
                    if (withPhoto) photoFor(context, id)?.let { put("photo", it) }
                }
            }
        }
        return result
    }

    /**
     * One contact by phone number.
     *
     * `PhoneLookup` rather than a `LIKE` on the number column, because number matching is not
     * string matching: `+1 555-123-4567`, `5551234567` and `(555) 123 4567` are the same person,
     * and the platform already holds the normalised index that knows it. Rolling our own would
     * mean re-implementing per-region dialling rules, badly.
     */
    fun byNumber(context: Context, number: String, withPhoto: Boolean): JsonObject? {
        val id = contactIdForNumber(context, number) ?: return null
        return byId(context, id, withPhoto)
    }

    /**
     * The display name for a number, or null.
     *
     * The hot path: called once per SMS thread and once per call-log row. Returns just the name,
     * because that is all those lists carry and building a whole contact per row would turn one
     * list query into three hundred.
     */
    fun nameForNumber(context: Context, number: String): String? {
        if (number.isBlank()) return null
        var name: String? = null
        query(
            context,
            Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)),
            arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
            null,
            null,
            null,
        ) { cursor ->
            if (cursor.moveToFirst()) name = cursor.getString(0)?.takeIf { it.isNotBlank() }
        }
        return name
    }

    private fun contactIdForNumber(context: Context, number: String): String? {
        var id: String? = null
        query(
            context,
            Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)),
            arrayOf(ContactsContract.PhoneLookup.CONTACT_ID),
            null,
            null,
            null,
        ) { cursor ->
            if (cursor.moveToFirst()) id = cursor.getString(0)
        }
        return id
    }

    // ---- sub-queries ----------------------------------------------------------------------

    private fun numbersFor(context: Context, contactId: String) = buildJsonArray {
        query(
            context,
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.TYPE,
                ContactsContract.CommonDataKinds.Phone.LABEL,
            ),
            "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
            arrayOf(contactId),
            null,
        ) { cursor ->
            while (cursor.moveToNext()) {
                val value = cursor.getString(0)?.takeIf { it.isNotBlank() } ?: continue
                add(
                    buildJsonObject {
                        put("value", value)
                        put(
                            "label",
                            ContactsContract.CommonDataKinds.Phone
                                .getTypeLabel(context.resources, cursor.getInt(1), cursor.getString(2))
                                .toString(),
                        )
                    },
                )
            }
        }
    }

    private fun emailsFor(context: Context, contactId: String) = buildJsonArray {
        query(
            context,
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Email.ADDRESS,
                ContactsContract.CommonDataKinds.Email.TYPE,
                ContactsContract.CommonDataKinds.Email.LABEL,
            ),
            "${ContactsContract.CommonDataKinds.Email.CONTACT_ID} = ?",
            arrayOf(contactId),
            null,
        ) { cursor ->
            while (cursor.moveToNext()) {
                val value = cursor.getString(0)?.takeIf { it.isNotBlank() } ?: continue
                add(
                    buildJsonObject {
                        put("value", value)
                        put(
                            "label",
                            ContactsContract.CommonDataKinds.Email
                                .getTypeLabel(context.resources, cursor.getInt(1), cursor.getString(2))
                                .toString(),
                        )
                    },
                )
            }
        }
    }

    /**
     * Base64 PNG, downscaled until it fits [MAX_PHOTO_BYTES], or null when there is no photo.
     *
     * `preferHighres = true` asks for the *display* photo and falls back to the thumbnail, which
     * is the right way round and worth stating because of how lopsided the two are on a real
     * phone. Measured on this handset, 2026-09-05 (docs/testing.md, Phase 7 Slice 22):
     *
     * | | contacts | source size |
     * |---|---|---|
     * | a thumbnail (`PHOTO_ID`) | **224** of 665 | 96 px |
     * | a display photo (`PHOTO_FILE_ID`) | **17** of 665 | 720 px |
     *
     * So for 207 of the 224 this returns a 96 px image however it is asked, and the Mac's largest
     * disc is 104 px at DPR 2. That is soft, and it is the picture the user chose; there is no
     * larger one to fetch.
     *
     * The size of what it produced is logged rather than inferred. A photo is the only thing this
     * feature puts on the control channel and [MAX_PHOTO_BYTES] is the only thing bounding it, so
     * a downscale loop that stopped in the wrong place would be invisible until the frame-length
     * check refused a frame.
     */
    private fun photoFor(context: Context, contactId: String): String? = runCatching {
        val stream = ContactsContract.Contacts.openContactPhotoInputStream(
            context.contentResolver,
            Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_URI, contactId),
            /* preferHighres = */ true,
        ) ?: return null
        val full = stream.use { BitmapFactory.decodeStream(it) } ?: return null

        var edge = full.width.coerceAtLeast(full.height)
        var encoded = encode(full)
        // Halve until it fits. A loop rather than an arithmetic guess because PNG size depends on
        // the image, not only on its dimensions — a photograph and a flat-colour avatar of the
        // same size differ by an order of magnitude.
        var bitmap = full
        while (encoded.length * 3 / 4 > MAX_PHOTO_BYTES && edge > 64) {
            edge /= 2
            val scale = edge.toFloat() / bitmap.width.coerceAtLeast(bitmap.height)
            bitmap = Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).toInt().coerceAtLeast(1),
                (bitmap.height * scale).toInt().coerceAtLeast(1),
                true,
            )
            encoded = encode(bitmap)
        }
        LinkLog.i(
            "contacts",
            "Photo for $contactId: ${full.width}x${full.height} source, " +
                "sent ${bitmap.width}x${bitmap.height} at ${encoded.length * 3 / 4} bytes " +
                "of $MAX_PHOTO_BYTES allowed",
        )
        encoded
    }.onFailure { LinkLog.w("contacts", "Photo for $contactId failed: ${it.message}") }.getOrNull()

    private fun encode(bitmap: Bitmap): String = ByteArrayOutputStream().use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /**
     * One content query, closed on every path.
     *
     * A `ContentResolver` cursor that is not closed leaks a binder object and, on One UI, produces
     * a `CursorWindow` warning storm that buries everything else in the log. `use` is not optional
     * here even though nothing in the body throws today.
     */
    private inline fun query(
        context: Context,
        uri: Uri,
        projection: Array<String>,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String?,
        body: (Cursor) -> Unit,
    ) {
        runCatching {
            context.contentResolver
                .query(uri, projection, selection, selectionArgs, sortOrder)
                ?.use(body)
        }.onFailure { LinkLog.w("contacts", "Query on $uri failed: ${it.message}") }
    }

    private fun Cursor.getLongOrNull(index: Int): Long? =
        if (isNull(index)) null else getLong(index)
}
