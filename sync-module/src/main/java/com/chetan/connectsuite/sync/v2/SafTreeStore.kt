package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import com.chetan.connectsuite.core.link.LinkLog
import java.io.InputStream
import java.io.OutputStream

/**
 * One granted SAF tree, addressed by root-relative segments and by document id.
 *
 * ### Why there is no path here
 *
 * A tree is a document URI, not a directory. Resolving `Camera/trip` means listing `Camera`'s
 * children and matching a display name, then doing it again — one query per segment. Inventing a
 * POSIX-looking string for the tree and navigating that would be a fiction the Mac then tries to
 * follow, which is the argument §2 of the payload spec gives for addressing a `(rootId, path)` pair
 * in the first place.
 *
 * ### The one place a document is deleted
 *
 * `DocumentsContract.deleteDocument` is called from exactly **two** functions in this module, one
 * per question, and `FsDeleteGuardTest` fails if a third call site appears. That is the enforceable
 * half of the compare-and-delete rule: the guard cannot be bypassed by a caller who reaches for a
 * bare delete, because there is no bare delete to reach for.
 *
 * - [deleteIfUnchanged] answers *may this file the Mac was looking at be destroyed?* — compare and
 *   delete, and the only route `fs.delete` has.
 * - [deleteArtifact] answers *may this transfer artifact be cleaned up?* — a `.part` or `.failed`
 *   this app created, or a destination the Mac authorised with `overwrite: true` on the control
 *   channel before a byte moved.
 *
 * **It went from one to two when push landed, and the guard is what forced the distinction.** The
 * first version of `commit()` called the platform delete three times inline, one of which silently
 * removed a user's existing file — `overwrite` was in the payload spec and had not been
 * implemented. The test failed, and the hole was in the code rather than in the test.
 */
class SafTreeStore(
    private val context: Context,
    private val treeUri: Uri,
    override val label: String,
    override val writable: Boolean,
) : FsStore {

    private val treeDocumentId: String = DocumentsContract.getTreeDocumentId(treeUri)

    override val rootId: String = FsPaths.rootIdForTree(treeDocumentId)

    override val kind: String = FsPaths.KIND_TREE

    /**
     * Free space on the volume the tree lives on, approximated by the app's own external volume.
     *
     * There is no path to `StatFs` under SAF, so this is the primary shared volume's figure and is
     * wrong for a tree on an SD card — a case this handset does not have and this build does not
     * claim to serve. Named here rather than left as a silently plausible number.
     */
    override fun freeBytes(): Long = FsRoots.sharedVolumeFreeBytes(context)

    private val resolver get() = context.contentResolver

    // ---- reads ----------------------------------------------------------------------------------

    private val projection = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )

    private fun entryOf(cursor: Cursor): FsPaths.Entry? {
        val docId = cursor.getString(0) ?: return null
        val name = cursor.getString(1) ?: return null
        val mime = cursor.getString(2)
        val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
        return FsPaths.Entry(
            id = FsPaths.encodeId(docId),
            name = name,
            dir = isDir,
            // A directory's `size` is 0 on the wire. The provider reports a block size here —
            // a fact about the filesystem, not about the entry — and the payload spec's own
            // example carries 0. AppFilesStore already did this; the two must agree.
            size = if (isDir || cursor.isNull(3)) 0L else cursor.getLong(3),
            mtimeMs = if (cursor.isNull(4)) 0L else cursor.getLong(4),
            // Normalised to the protocol's spelling. SAF says
            // `vnd.android.document/directory`; the wire says `inode/directory`, and one home for
            // that translation is this line.
            mime = if (isDir) FsPaths.DIR_MIME else (mime ?: "application/octet-stream"),
        )
    }

    private fun childrenOf(parentDocumentId: String): List<FsPaths.Entry>? =
        Snapshots.getOrBuild(rootId, parentDocumentId) {
            val childrenUri =
                DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
            val out = mutableListOf<FsPaths.Entry>()
            val startedAt = System.currentTimeMillis()
            val ok = runCatching {
                resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) entryOf(cursor)?.let { out += it }
                    true
                }
            }.getOrElse {
                LinkLog.w("fs", "$rootId could not list $parentDocumentId", it)
                null
            }
            // Null rather than an empty snapshot: a directory we could not read is not a directory
            // with no children, and caching the second for 30 s would be this pane's own defining
            // confusion written into the phone.
            if (ok == null) null else out to (System.currentTimeMillis() - startedAt)
        }

    /** Walks [segments] from the tree root, one query per segment. Null when any of them is absent. */
    private fun resolveDirectory(segments: List<String>): String? {
        var current = treeDocumentId
        for (segment in segments) {
            val children = childrenOf(current) ?: return null
            val match = children.firstOrNull { it.name == segment && it.dir } ?: return null
            current = FsPaths.decodeId(match.id)
        }
        return current
    }

    override fun listChildren(segments: List<String>): List<FsPaths.Entry>? {
        val parent = resolveDirectory(segments) ?: return null
        return childrenOf(parent)
    }

    private fun documentUri(id: String): Uri =
        DocumentsContract.buildDocumentUriUsingTree(treeUri, FsPaths.decodeId(id))

    /**
     * Reads one row **now**. Every caller that acts on the answer calls this immediately before
     * acting; nothing caches what it returns.
     */
    private fun readRow(id: String): FsPaths.Entry? = runCatching {
        resolver.query(documentUri(id), projection, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) entryOf(cursor) else null
        }
    }.getOrElse {
        LinkLog.w("fs", "$rootId could not stat $id", it)
        null
    }

    override fun statById(id: String): FsPaths.Entry? = readRow(id)

    // ---- writes ---------------------------------------------------------------------------------

    override fun mkdir(segments: List<String>, name: String): FsPaths.Entry? {
        val parent = resolveDirectory(segments) ?: return null
        val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parent)
        val created = runCatching {
            DocumentsContract.createDocument(
                resolver,
                parentUri,
                DocumentsContract.Document.MIME_TYPE_DIR,
                name,
            )
        }.getOrElse {
            LinkLog.w("fs", "$rootId mkdir $name failed under ${FsPaths.joinPath(segments)}", it)
            null
        } ?: return null
        Snapshots.invalidate(rootId)
        return readRow(FsPaths.encodeId(DocumentsContract.getDocumentId(created)))
    }

    /**
     * Compare-and-delete. The predicate is evaluated **twice**, and the second time is the gate.
     *
     * The first read answers the caller; the second read is taken with nothing between it and
     * `deleteDocument` but the `if` that judges it. That is deliberate duplication rather than a
     * redundant query: the rule in `CLAUDE.md` is that *the predicate that decides whether to act is
     * evaluated at the moment of acting, not read into a variable earlier*, and a verdict computed
     * at the top of a function and acted on at the bottom is precisely the shape that hung up a live
     * call after reading the card that said not to.
     *
     * The refusal says what it refused and why, per the same rule — a silent no-op is removed by the
     * next person trying to find out why nothing happened.
     */
    override fun deleteIfUnchanged(
        id: String,
        expectSize: Long,
        expectMtimeMs: Long,
    ): DeleteOutcome {
        val seen = readRow(id) ?: return DeleteOutcome.NotFound
        when (val verdict = FsPaths.deleteVerdict(seen, expectSize, expectMtimeMs)) {
            is FsPaths.DeleteVerdict.Mismatch -> {
                LinkLog.w("fs", "$rootId refusing to delete ${seen.name}: ${verdict.why}")
                return if (seen.dir) DeleteOutcome.Refused(verdict.why)
                else DeleteOutcome.Stale(seen.size, seen.mtimeMs)
            }
            is FsPaths.DeleteVerdict.Match -> Unit
        }

        // Re-read, and re-judge, immediately before the irreversible call. The row can change
        // under a slow first read; nothing above this line authorises anything.
        val atTheMoment = readRow(id) ?: return DeleteOutcome.NotFound
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

        val gone = runCatching {
            DocumentsContract.deleteDocument(resolver, documentUri(id))
        }.getOrElse {
            LinkLog.e("fs", "$rootId delete of ${atTheMoment.name} threw", it)
            false
        }
        Snapshots.invalidate(rootId)
        return if (gone) {
            LinkLog.i(
                "fs",
                "$rootId deleted ${atTheMoment.name} (${atTheMoment.size} bytes) after the size and " +
                    "modified time both matched what the Mac last saw",
            )
            DeleteOutcome.Deleted
        } else {
            DeleteOutcome.Refused("the phone's storage provider refused the delete")
        }
    }

    override fun openStream(id: String): InputStream? {
        val row = readRow(id) ?: return null
        if (row.dir) return null
        return runCatching { resolver.openInputStream(documentUri(id)) }.getOrElse {
            LinkLog.w("fs", "$rootId could not open ${row.name}", it)
            null
        }
    }

    /**
     * Deletes a **transfer artifact** — a `.part` or a `.failed` we created, or a destination the
     * Mac explicitly asked to overwrite.
     *
     * ### Why this exists beside [deleteIfUnchanged] rather than inside it
     *
     * `deleteIfUnchanged` is compare-and-delete: it exists so `fs.delete` can never destroy a file
     * the Mac was not looking at. These three are a different question. Two of them delete files
     * **this app created and named**, and the third deletes a destination the Mac authorised with
     * `overwrite: true` — a decision taken on the control channel, before a byte moved, and refused
     * with `TARGET_STALE` when it was not given.
     *
     * They are one function rather than three call sites so that `FsDeleteGuardTest` can still say
     * something true: **the platform's delete appears in exactly two places in this module**, one
     * per question, and a third is a test failure. Folding these into `deleteIfUnchanged` would have
     * meant inventing an expected size for a file nobody looked at, which is the compare half
     * becoming a formality — the worst outcome available.
     */
    private fun deleteArtifact(id: String, why: String): Boolean {
        val gone = runCatching {
            DocumentsContract.deleteDocument(resolver, documentUri(id))
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not delete $why", it)
            false
        }
        Snapshots.invalidate(rootId)
        return gone
    }

    override fun openPartial(segments: List<String>, name: String): FsPartial? {
        if (!writable) {
            LinkLog.w("fs", "$rootId is read-only; refusing to open a partial for $name")
            return null
        }
        val parent = resolveDirectory(segments) ?: return null
        val partName = FsPartials.partNameFor(name)
        val existing = childrenOf(parent)?.firstOrNull { it.name == partName && !it.dir }
        val partId = existing?.let { FsPaths.decodeId(it.id) } ?: runCatching {
            // A partial is always created with a generic type. Giving it the real MIME would let a
            // provider "helpfully" append its own extension to a name that already ends in .part.
            DocumentsContract.createDocument(
                resolver,
                documentUri(FsPaths.encodeId(parent)),
                "application/octet-stream",
                partName,
            )?.let { DocumentsContract.getDocumentId(it) }
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not create $partName", it)
            null
        } ?: return null

        // The provider may have renamed the document to avoid a collision — `foo.part (1)`. Read the
        // row back rather than assuming the name we asked for is the name we got, which is the same
        // discipline as re-reading a row immediately before a delete.
        val actual = readRow(FsPaths.encodeId(partId))
        if (actual == null) {
            LinkLog.w("fs", "$rootId created $partName and could not read it back")
            return null
        }
        Snapshots.invalidate(rootId)
        return SafPartial(parentId = parent, partId = partId, partName = actual.name, finalName = name)
    }

    /**
     * One partial in a SAF tree.
     *
     * Every operation re-resolves through the provider rather than caching a `Uri`, because a
     * document can be renamed or removed by anything else on the device between two of these calls —
     * these are not our directories.
     */
    private inner class SafPartial(
        private val parentId: String,
        private val partId: String,
        private val partName: String,
        private val finalName: String,
    ) : FsPartial {

        private val encoded = FsPaths.encodeId(partId)

        override val bytesOnDisk: Long
            get() = readRow(encoded)?.size ?: 0L

        override fun append(): OutputStream? = runCatching {
            // "wa" is append. Plain "w" truncates, and a resumed transfer that truncates its own
            // partial produces a file whose digest can never match and whose bytes are half gone —
            // a data-loss bug that looks like a checksum bug.
            resolver.openOutputStream(documentUri(encoded), "wa")
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not open $partName for append", it)
            null
        }

        override fun read(): InputStream? = runCatching {
            resolver.openInputStream(documentUri(encoded))
        }.getOrElse {
            LinkLog.w("fs", "$rootId could not read $partName back", it)
            null
        }

        override fun commit(): FsPaths.Entry? {
            // Any stale sidecar for this name is cleared first: a finished file sitting beside a
            // `.failed` note about itself is a directory that contradicts itself.
            childrenOf(parentId)
                ?.firstOrNull { it.name == FsPartials.failedNameFor(finalName) && !it.dir }
                ?.let { stale -> deleteArtifact(stale.id, "a stale .failed sidecar") }

            // An existing file at the final name is removed before the rename, because SAF will
            // otherwise hand back `holiday (1).mov` and the Mac would be told a name it did not ask
            // for. Overwrite is the caller's decision and it has already been taken by this point.
            childrenOf(parentId)
                ?.firstOrNull { it.name == finalName && !it.dir }
                ?.let { previous ->
                    // Only reachable when the Mac sent `overwrite: true`; `fs.transfer.begin`
                    // refuses with TARGET_STALE otherwise, before the socket opens.
                    deleteArtifact(previous.id, "the destination $finalName, which the Mac asked to replace")
                }

            val renamed = runCatching {
                DocumentsContract.renameDocument(resolver, documentUri(encoded), finalName)
            }.getOrElse {
                LinkLog.e("fs", "$rootId could not rename $partName to $finalName", it)
                null
            }
            Snapshots.invalidate(rootId)
            if (renamed == null) {
                // The partial is left exactly where it is. A failed rename has lost nothing; a
                // delete here would.
                return null
            }
            return readRow(FsPaths.encodeId(DocumentsContract.getDocumentId(renamed) ?: return null))
        }

        override fun discardAsFailed(sidecar: String) {
            deleteArtifact(encoded, "the corrupt $partName")
            runCatching {
                val uri = DocumentsContract.createDocument(
                    resolver,
                    documentUri(FsPaths.encodeId(parentId)),
                    "text/plain",
                    FsPartials.failedNameFor(finalName),
                )
                if (uri != null) {
                    resolver.openOutputStream(uri, "w")?.use { it.write(sidecar.toByteArray()) }
                }
            }.onFailure { LinkLog.w("fs", "$rootId could not write the .failed sidecar", it) }
            Snapshots.invalidate(rootId)
        }

        override fun keep() {
            Snapshots.invalidate(rootId)
        }
    }

    companion object {
        /** Free bytes on a real path, for the roots that have one. */
        fun freeBytesAt(path: String): Long = runCatching { StatFs(path).availableBytes }.getOrDefault(0L)
    }

    /**
     * A short-lived snapshot of one directory's children, and it is a **correctness** fix first.
     *
     * ### The reading that made this necessary
     *
     * Paging `DCIM/Camera` — 16,376 entries — took **490 seconds over 33 pages**, 17.6 s of it on
     * the first page and roughly the same on every one after. `limit` bounds the frame and never the
     * work: a `DocumentsProvider` honours neither a sort order nor a limit, so each page listed all
     * 16,376 rows again to hand back 500 of them. Eight minutes to page one folder is not a slow
     * feature, it is an unusable one, and it was invisible until the pager was run to exhaustion on
     * real data rather than on a first page.
     *
     * ### Why the cache is not just a speed-up
     *
     * Re-reading the directory on every page is *also wrong*. Two queries a second apart can return
     * different rows — a photo taken, a download finished — and the sorted position of the cursor
     * then shifts underneath the pager, which is how a run loses or repeats entries between two
     * pages that each look perfectly well formed. A snapshot held for the length of a paging run is
     * the consistent view the cursor was always assuming it had.
     *
     * ### What it is not allowed to do
     *
     * It must never outlive a change **we** made, so [invalidate] is called by every write on this
     * store. It cannot see a change made by anything else on the phone, which is the same
     * unenforceable third row the `.part` convention has: we do not own these directories. The TTL
     * is the whole of the answer to that, and it is short.
     */
    internal object Snapshots {
        /**
         * Idle time before a snapshot is dropped. **Sliding**: a hit renews it.
         *
         * A paging run that is actively asking for pages keeps the one consistent directory its
         * cursor assumes; a run that stopped ten minutes ago does not. Renewing on a hit is what
         * makes those two different, and without it a long run would silently re-read the whole
         * directory at whatever page happened to cross the boundary — which is the 17-second page,
         * back again, in one place out of thirty-three and impossible to reproduce on purpose.
         */
        private const val IDLE_TTL_MS = 30_000L

        /**
         * The oldest a snapshot may ever be, however busy the run.
         *
         * The sliding TTL alone has no ceiling, and a directory we do not own can change at any
         * time. This is the bound on how wrong the view is allowed to get, and it is the reason the
         * sliding renewal is safe rather than merely convenient.
         */
        private const val MAX_AGE_MS = 120_000L

        /** Four, because a paging run is one directory and a user browsing is a handful. */
        private const val MAX_ENTRIES = 4

        private data class Snapshot(
            val entries: List<FsPaths.Entry>,
            val takenAtMs: Long,
            var touchedAtMs: Long,
            val readMs: Long,
        )

        private val byKey = LinkedHashMap<String, Snapshot>()

        private var hits = 0L
        private var misses = 0L

        /**
         * The serialisation, and the only thing that decides whether a second caller builds.
         *
         * It lives in [SingleFlight] rather than here because this object cannot be reached from a
         * JVM test — [put] logs through `LinkLog` into `android.util.Log` — and the concurrency is
         * the half that needs one. `SafTreeStoreJoinTest` exercises that class directly.
         */
        private val flight = SingleFlight<String>()

        private fun key(rootId: String, documentId: String) = "$rootId::$documentId"

        @Synchronized
        fun hit(rootId: String, documentId: String): List<FsPaths.Entry>? {
            val snapshot = byKey[key(rootId, documentId)] ?: run { misses++; return null }
            val now = System.currentTimeMillis()
            if (now - snapshot.touchedAtMs > IDLE_TTL_MS || now - snapshot.takenAtMs > MAX_AGE_MS) {
                byKey.remove(key(rootId, documentId))
                misses++
                return null
            }
            snapshot.touchedAtMs = now
            hits++
            return snapshot.entries
        }

        /**
         * The whole cache decision in one place: return a live snapshot, or build this directory
         * **exactly once** while every other caller for it waits on that build rather than starting
         * a second one.
         *
         * ### The reading
         *
         * `DCIM/Camera` takes 10,371 ms to snapshot and the Mac's `fs.list` timeout was 10,000 ms,
         * so the first open of a large folder always failed — and each failed attempt started
         * *another full rebuild*, because a miss went straight to the read with nothing serialising
         * it. Three overlapping builds of one directory were measured (10,371 / 11,352 / 10,082 ms),
         * each making the others slower, and the pane drew its failure card for a folder that is
         * perfectly readable. Raising the timeout alone would have left the stampede in place and
         * made it worse, because a longer window is more time in which to start more of them.
         *
         * This is the same *"who else calls this, and what happens if they both do"* the Mac's
         * `refresh()` already learned, on the other side of the link. A type cannot express it:
         * every intermediate state here was legal, and the wrong outcome was assembled out of legal
         * states in the wrong order.
         *
         * [build] returns the entries and the milliseconds the read took, or null if the directory
         * could not be listed — a failure is **not** cached, so a transient provider error does not
         * become a 30-second lie.
         */
        fun getOrBuild(
            rootId: String,
            documentId: String,
            build: () -> Pair<List<FsPaths.Entry>, Long>?,
        ): List<FsPaths.Entry>? =
            flight.run(
                key = key(rootId, documentId),
                cached = { hit(rootId, documentId) },
                build = {
                    build()?.let { (entries, readMs) ->
                        put(rootId, documentId, entries, readMs)
                        entries
                    }
                },
            )

        @Synchronized
        fun put(rootId: String, documentId: String, entries: List<FsPaths.Entry>, readMs: Long) {
            val now = System.currentTimeMillis()
            byKey[key(rootId, documentId)] = Snapshot(entries, now, now, readMs)
            while (byKey.size > MAX_ENTRIES) byKey.remove(byKey.keys.first())
            // The hit count beside the miss count and the read that caused the miss — a cache
            // reporting only its hits cannot be told from one that is never asked.
            LinkLog.i(
                "fs",
                "snapshot of $documentId in $rootId: ${entries.size} entries read in ${readMs}ms; " +
                    "$hits hits / $misses misses / ${flight.joins()} joined since start, " +
                    "${byKey.size} directories held",
            )
        }

        /** Called by every write. A listing that outlives our own change is a listing that lies. */
        @Synchronized
        fun invalidate(rootId: String) {
            val dropped = byKey.keys.filter { it.startsWith("$rootId::") }
            dropped.forEach { byKey.remove(it) }
            if (dropped.isNotEmpty()) {
                LinkLog.i("fs", "dropped ${dropped.size} snapshot(s) of $rootId after a write")
            }
        }
    }
}
