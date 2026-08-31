package com.chetan.connectsuite.sync.v2

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import com.chetan.connectsuite.core.link.LinkLog
import java.io.InputStream

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
 * `DocumentsContract.deleteDocument` is called from exactly one function in this module,
 * [deleteIfUnchanged], and `FsDeleteGuardTest` fails if a second call site appears. That is the
 * enforceable half of the compare-and-delete rule: the guard cannot be bypassed by a caller who
 * reaches for a bare delete, because there is no bare delete to reach for.
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

    private fun childrenOf(parentDocumentId: String): List<FsPaths.Entry>? {
        Snapshots.hit(rootId, parentDocumentId)?.let { return it }

        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
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
        if (ok == null) return null
        Snapshots.put(rootId, parentDocumentId, out, System.currentTimeMillis() - startedAt)
        return out
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
                    "$hits hits / $misses misses since start, ${byKey.size} directories held",
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
