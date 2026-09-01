package com.chetan.connectsuite.sync.v2

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.chetan.connectsuite.core.link.LinkLog
import java.io.InputStream
import java.io.OutputStream

/**
 * `Download/ConnectSuite` — **the one destination on this phone that needs no grant at all.**
 *
 * ### Why this exists when [SafTreeStore] already works
 *
 * A SAF tree is a folder the user picked, and picking one is an onboarding step with a picker, a
 * refusal the platform will not explain, and a wall we have to write copy about. This root skips all
 * of it. Observed at `targetSdk 36` with `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
 * `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` all `false` in the same run that wrote 256 MB here —
 * `docs/phase-5-fs-media-proposal.md` §4, and `docs/testing.md` → Slice 2 preliminaries.
 *
 * So a fresh install can receive a file from the Mac before the user has granted anything, which
 * makes "send this to my phone" work on the first run rather than after a folder pick.
 *
 * ### It is flat, and that is the platform rather than a shortcut
 *
 * **`MediaStore` cannot represent an empty directory.** A directory here exists only as the
 * `RELATIVE_PATH` prefix of a row that is in it — create no file and there is no folder, delete the
 * last file and the folder goes. So [mkdir] refuses: a `fs.mkdir` that returned an entry would be
 * describing something that does not exist and will not appear in the next listing.
 *
 * The consequence is that this root has **no subdirectories at all**. A push names a file and
 * nothing else. That is the right shape for what this is — an inbox, not a filesystem — and the
 * alternative (inferring folders from `RELATIVE_PATH` prefixes) would offer navigation into
 * directories that vanish when their last file is deleted.
 *
 * ### What it can see, which is less than what is there
 *
 * Without `READ_EXTERNAL_STORAGE` a `MediaStore` query returns **this package's own contributions**.
 * A file the user drags into `Download/ConnectSuite` with their own file manager is really there and
 * this root will not list it. That is stated on the wire rather than papered over: the Mac shows the
 * folder's own sentence, and the alternative — asking for storage permission so a listing looks
 * complete — is the permission this project has decided twice not to ask for.
 *
 * ### The partial is the platform's, not ours
 *
 * Everywhere else in `fs.*` a partial is `name.part` ([FsPartials]). Here it is an `IS_PENDING` row:
 * the platform stages it as `.pending-<n>-<name>` and hides it from every other client's queries, so
 * the central rule — *a partial is never visible at its final name* — is enforced by Android in its
 * own vocabulary. Two destinations, two conventions, and the transfer knows which one it got.
 */
class DownloadsStore(private val context: Context) : FsStore {

    override val rootId: String = FsPaths.DOWNLOADS_ROOT_ID
    override val label: String = FsPaths.DOWNLOADS_ROOT_LABEL
    override val kind: String = FsPaths.KIND_DOWNLOADS
    override val writable: Boolean = true
    override val supportsDirectories: Boolean = false

    private val collection: Uri = MediaStore.Downloads.EXTERNAL_CONTENT_URI

    override fun freeBytes(): Long = FsRoots.sharedVolumeFreeBytes(context)

    /**
     * The listing, and the one query in this class.
     *
     * **`RELATIVE_PATH` is matched with a bound argument**, which is the thing defect 50 says to
     * verify through the product's own client rather than through `adb shell content query` — the
     * shell inlines its literal and the app binds a `?`, and those are two different queries. The
     * hardware reading for this one is in `docs/testing.md` → Slice 9.
     */
    override fun listChildren(segments: List<String>): List<FsPaths.Entry>? {
        // No subdirectories exist here, so any path below the root does not resolve — and `null` is
        // exactly the right answer for that, distinct from the empty list this returns for an empty
        // inbox. The two must not collapse: one is "nothing here yet", the other is "no such place".
        if (segments.isNotEmpty()) return null
        return runCatching {
            context.contentResolver.query(
                collection,
                arrayOf(
                    MediaStore.Downloads._ID,
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.SIZE,
                    MediaStore.Downloads.DATE_MODIFIED,
                    MediaStore.Downloads.MIME_TYPE,
                ),
                "${MediaStore.Downloads.RELATIVE_PATH}=?",
                arrayOf(RELATIVE_PATH),
                null,
            )?.use { cursor ->
                val id = cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
                val name = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
                val size = cursor.getColumnIndexOrThrow(MediaStore.Downloads.SIZE)
                val modified = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DATE_MODIFIED)
                val mime = cursor.getColumnIndexOrThrow(MediaStore.Downloads.MIME_TYPE)
                buildList {
                    while (cursor.moveToNext()) {
                        add(
                            FsPaths.Entry(
                                id = cursor.getLong(id).toString(),
                                name = cursor.getString(name) ?: continue,
                                dir = false,
                                size = cursor.getLong(size),
                                // DATE_MODIFIED is **seconds**. Sending it unscaled puts every file
                                // in 1970 and makes `deleteIfUnchanged`'s mtime comparison a
                                // guaranteed mismatch — the same units trap `media.*` carries.
                                mtimeMs = cursor.getLong(modified) * 1_000L,
                                mime = cursor.getString(mime) ?: "application/octet-stream",
                            ),
                        )
                    }
                }
            } ?: emptyList()
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not list $RELATIVE_PATH", it)
            null
        }
    }

    override fun statById(id: String): FsPaths.Entry? =
        listChildren(emptyList())?.firstOrNull { it.id == id }

    /**
     * Always null, and the KDoc on this class says why: `MediaStore` has no empty directories.
     *
     * This is locked decision 6 in one method — the feature is unavailable here and the refusal
     * names the reason rather than failing silently. `FsFeature` turns the null into a
     * `BAD_REQUEST` the Mac can show.
     */
    override fun mkdir(segments: List<String>, name: String): FsPaths.Entry? {
        LinkLog.w(
            "fs",
            "$rootId cannot create \"$name\": MediaStore has no empty directories — a folder here " +
                "exists only as the relative path of a file that is in it",
        )
        return null
    }

    /** Compare-and-delete, evaluated twice. See [SafTreeStore.deleteIfUnchanged] for the argument. */
    override fun deleteIfUnchanged(
        id: String,
        expectSize: Long,
        expectMtimeMs: Long,
    ): DeleteOutcome {
        val seen = statById(id) ?: return DeleteOutcome.NotFound
        when (val verdict = FsPaths.deleteVerdict(seen, expectSize, expectMtimeMs)) {
            is FsPaths.DeleteVerdict.Mismatch -> {
                LinkLog.w("fs", "$rootId refusing to delete ${seen.name}: ${verdict.why}")
                return DeleteOutcome.Stale(seen.size, seen.mtimeMs)
            }
            is FsPaths.DeleteVerdict.Match -> Unit
        }
        val atTheMoment = statById(id) ?: return DeleteOutcome.NotFound
        if (FsPaths.deleteVerdict(atTheMoment, expectSize, expectMtimeMs)
            !is FsPaths.DeleteVerdict.Match
        ) {
            LinkLog.w(
                "fs",
                "$rootId refusing to delete ${atTheMoment.name}: it changed between the check and " +
                    "the delete — ${atTheMoment.size} bytes at ${atTheMoment.mtimeMs}",
            )
            return DeleteOutcome.Stale(atTheMoment.size, atTheMoment.mtimeMs)
        }
        val uri = uriFor(id) ?: return DeleteOutcome.Refused("that id is not one of ours")
        val removed = runCatching { context.contentResolver.delete(uri, null, null) }.getOrElse {
            LinkLog.w("fs", "$rootId could not delete ${atTheMoment.name}", it)
            0
        }
        return if (removed > 0) {
            LinkLog.i(
                "fs",
                "$rootId deleted ${atTheMoment.name} (${atTheMoment.size} bytes) after the size and " +
                    "modified time both matched what the Mac last saw",
            )
            DeleteOutcome.Deleted
        } else {
            DeleteOutcome.Refused("the file could not be removed")
        }
    }

    override fun openStream(id: String): InputStream? {
        val uri = uriFor(id) ?: return null
        return runCatching { context.contentResolver.openInputStream(uri) }.getOrNull()
    }

    /**
     * Opens — or **re-opens** — the pending item this push writes into.
     *
     * ### The resume lookup is the load-bearing part
     *
     * A pending row already carrying this display name is *our own interrupted transfer*, and
     * reusing it is what lets a push resume. The row survives process death; whether the bytes in
     * it can be appended to afterwards was listed as **unproven** in
     * `docs/phase-5-fs-media-proposal.md` §4 and is now measured — `docs/testing.md` → Slice 9.
     *
     * ### It cannot be another app's file, which is the one thing that makes this safe
     *
     * The [FsPartials] convention refuses to resume a `.part` it has no record of, because `DCIM` is
     * shared with every downloader on the phone. That risk does not exist here: without storage
     * permission the query returns **this package's own contributions only**, so a pending row we
     * can see is a pending row we wrote. The transfer record is still consulted for the offset —
     * the platform's length is the input, never the decision.
     */
    override fun openPartial(segments: List<String>, name: String): FsPartial? {
        if (segments.isNotEmpty()) {
            LinkLog.w("fs", "$rootId has no subdirectories; refusing a push into ${FsPaths.joinPath(segments)}")
            return null
        }
        val existing = pendingIdFor(name)
        if (existing != null) {
            val uri = ContentUris.withAppendedId(collection, existing)
            LinkLog.i(
                "fs",
                "$rootId reusing the pending item for $name (id $existing, ${lengthOf(uri)} bytes " +
                    "already staged) — this is the resume path",
            )
            return PendingItem(uri, name)
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = runCatching { context.contentResolver.insert(collection, values) }.getOrElse {
            LinkLog.w("fs", "$rootId could not create a pending item for $name", it)
            null
        } ?: return null
        LinkLog.i("fs", "$rootId staged $name as a pending item at $uri")
        return PendingItem(uri, name)
    }

    /** The id of a pending row of ours with this display name, or null. The resume lookup. */
    private fun pendingIdFor(name: String): Long? = runCatching {
        context.contentResolver.query(
            // `IS_PENDING` rows are excluded from ordinary queries; this asks for them explicitly.
            MediaStore.setIncludePending(collection),
            arrayOf(MediaStore.Downloads._ID),
            "${MediaStore.Downloads.RELATIVE_PATH}=? AND ${MediaStore.Downloads.DISPLAY_NAME}=? " +
                "AND ${MediaStore.Downloads.IS_PENDING}=1",
            arrayOf(RELATIVE_PATH, name),
            null,
        )?.use { if (it.moveToFirst()) it.getLong(0) else null }
    }.getOrElse {
        LinkLog.w("fs", "$rootId could not look for a pending $name", it)
        null
    }

    private fun uriFor(id: String): Uri? =
        id.toLongOrNull()?.let { ContentUris.withAppendedId(collection, it) }

    /**
     * The pending item's length **from a file descriptor**, not from the row's `SIZE`.
     *
     * `SIZE` on a pending row is what the inserting client declared or what the last scan saw, and a
     * resume that trusts it appends at the wrong offset. `statSize` is the file. This is the same
     * rule the `.part` convention states as *a record longer than the file is how a resumed digest
     * silently omits a hole* — read the bytes, not the bookkeeping.
     */
    private fun lengthOf(uri: Uri): Long = runCatching {
        context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize }
    }.getOrNull() ?: 0L

    /**
     * A push landing in `Download/ConnectSuite`, with the platform holding the partial.
     *
     * The three endings are the same three [FsPartials] names on every other root; only the
     * mechanism differs. `commit` clears `IS_PENDING` instead of renaming, and the "delete a stale
     * artifact" step is a row delete rather than a file delete — but it is still the **second, named
     * question** `FsDeleteGuardTest` insists on, not a fourth anonymous delete.
     */
    private inner class PendingItem(
        private val uri: Uri,
        private val name: String,
    ) : FsPartial {

        override val bytesOnDisk: Long get() = lengthOf(uri)

        override fun append(): OutputStream? = runCatching {
            // "wa" — append. Not "w", which truncates, and truncating here is a resume that
            // silently starts over while reporting an offset it did not honour.
            context.contentResolver.openOutputStream(uri, "wa")
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not open the pending $name for append", it)
            null
        }

        override fun read(): InputStream? =
            runCatching { context.contentResolver.openInputStream(uri) }.getOrNull()

        override fun commit(): FsPaths.Entry? {
            // Overwrite. `fs.transfer.begin` has already refused this push unless the Mac asked for
            // it, so reaching here means replacing was authorised — and it is the *first* of the two
            // deletes, the one that answers "may this file the Mac was looking at be destroyed?".
            deleteFinalNamed(name)
            val values = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            val updated = runCatching {
                context.contentResolver.update(uri, values, null, null)
            }.getOrElse {
                LinkLog.e("fs", "$rootId could not publish $name", it)
                0
            }
            if (updated == 0) {
                LinkLog.e("fs", "$rootId could not clear IS_PENDING on $name; the partial is kept")
                return null
            }
            val id = ContentUris.parseId(uri).toString()
            return statById(id) ?: FsPaths.Entry(
                id = id,
                name = name,
                dir = false,
                size = bytesOnDisk,
                mtimeMs = System.currentTimeMillis(),
                mime = "application/octet-stream",
            )
        }

        override fun discardAsFailed(sidecar: String) {
            // The corrupt bytes go. This is the checksum path and it is the only one that destroys
            // received data, on purpose.
            val removed = runCatching { context.contentResolver.delete(uri, null, null) }
                .getOrElse { 0 }
            if (removed == 0) LinkLog.e("fs", "$rootId could not delete the corrupt pending $name")
            // The sidecar is a published row rather than a pending one, or nobody would ever see it.
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, FsPartials.failedNameFor(name))
                put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH)
                put(MediaStore.Downloads.MIME_TYPE, "text/plain")
            }
            runCatching {
                val note = context.contentResolver.insert(collection, values) ?: return@runCatching
                context.contentResolver.openOutputStream(note)?.use {
                    it.write(sidecar.toByteArray())
                }
            }.onFailure { LinkLog.w("fs", "$rootId could not write the .failed note", it) }
        }

        /** Left pending. The next `fs.transfer.begin` for this name finds it and resumes into it. */
        override fun keep() {
            LinkLog.i(
                "fs",
                "$rootId keeping the pending $name at ${bytesOnDisk} bytes; the next attempt " +
                    "resumes into this same item",
            )
        }
    }

    /**
     * Removes a *published* row at this name, and only that.
     *
     * **The second named question**, kept apart from the one above it for the reason defect 56's
     * sitting recorded as a rule: a guard that counts deletes tells you the total changed, and a
     * guard that names them tells you which appeared. `FsDeleteGuardTest`'s number is two because
     * there are two questions, not because two is closer to four.
     */
    private fun deleteFinalNamed(name: String): Int = runCatching {
        context.contentResolver.delete(
            collection,
            "${MediaStore.Downloads.RELATIVE_PATH}=? AND ${MediaStore.Downloads.DISPLAY_NAME}=?",
            arrayOf(RELATIVE_PATH, name),
        )
    }.getOrElse {
        LinkLog.w("fs", "$rootId could not clear a previous $name", it)
        0
    }

    companion object {
        /**
         * The trailing slash is required. `MediaStore` normalises `RELATIVE_PATH` to end in one, so
         * a query bound with `Download/ConnectSuite` matches **nothing** while the insert that made
         * the row stored `Download/ConnectSuite/`. Two spellings of one path is the shape of a
         * folder that reads as empty forever.
         */
        const val RELATIVE_PATH = "Download/ConnectSuite/"
    }
}
