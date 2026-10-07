package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The half of `fs.*` that has no Android in it: ids, paths, ordering, the cursor, and the payloads.
 *
 * Split out for the reason `CLAUDE.md` names by name. A JVM unit test that merely *references* an
 * object holding an Android static in a field initializer dies with `ExceptionInInitializerError`,
 * and the answer is never `returnDefaultValues = true` — it is to move the pure part out, which is
 * where [MediaPayloads], `SmsPayloads` and `CallWatcher.dispositionOf` came from. [SafTreeStore] and
 * [AppFilesStore] are the halves that touch the platform.
 *
 * ### One rule, one home
 *
 * The ordering below is expressed **once**, in [ENTRY_ORDER], and both the page builder and its test
 * evaluate that same comparator. `MediaPayloadsTest`'s first version wrote the cursor predicate out
 * a second time in the test, so deleting the tiebreak from the query left every assertion green — it
 * was not a weak test, it was testing a copy. [pageOf] exists so there is nothing here for a test to
 * re-implement.
 */
object FsPaths {

    /** The app-private root, always present, listed even when the user has granted nothing. */
    const val APP_ROOT_ID = "app:files"

    /**
     * Never the received folder's name. Until 2026-10-08 this was `ConnectSuite` — the on-disk name of
     * `Download/ConnectSuite`, the *other* root — and a file sent to the root chosen by that name
     * landed here, where My Files cannot see it. The Mac now names both fixed roots by `kind`; this is
     * what the phone's own refusals say, and what an older Mac shows.
     */
    const val APP_ROOT_LABEL = "Sidekick private storage"

    const val SAF_PREFIX = "saf:"

    const val DEFAULT_LIMIT = 200

    /**
     * The largest listing this will build, and it is the frame caps deciding a payload shape.
     *
     * An `fs.list` ack is a control frame; an entry is roughly 150–250 bytes of JSON. An uncapped
     * listing of a 100,000-file directory builds a frame the far side is obliged to refuse, and a
     * refused frame closes the socket — so the symptom of the missing cap would be *"this folder
     * disconnects the app"*. 500 keeps the largest legal ack near 125 KB.
     */
    const val MAX_LIMIT = 500

    const val DIR_MIME = "inode/directory"

    /**
     * The grant-free destination: `Download/ConnectSuite`, through `MediaStore`.
     *
     * Not a SAF tree and not app-private, so it is neither of the other two ids. It needs **no
     * permission of any kind**, which is what makes it the default push target — a fresh install can
     * receive a file before the user has picked a folder.
     */
    const val DOWNLOADS_ROOT_ID = "downloads:connectsuite"

    /**
     * What the user reads. Never the path, and never `Download/ConnectSuite` either: the folder is
     * an inbox, and naming it after its location invites the belief that everything in that location
     * is visible here, which is exactly what is not true.
     */
    const val DOWNLOADS_ROOT_LABEL = "Received files"

    /** `kind` values a root may carry. `ALL` is reserved and this build never emits it. */
    const val KIND_APP = "app"
    const val KIND_TREE = "tree"

    /**
     * `Download/ConnectSuite`. A third kind rather than a lie: it is not a tree the user granted
     * (there is nothing to revoke, and it must not appear on the Folders screen as removable) and it
     * is not app-private (the user's file manager can open it). A Mac that does not know this word
     * carries it through and shows it plainly, which is what `toRoot` already does.
     */
    const val KIND_DOWNLOADS = "downloads"

    // ---- ids ------------------------------------------------------------------------------------

    /**
     * Percent-encoding, RFC 3986 unreserved set, written here rather than borrowed.
     *
     * `android.net.Uri.encode` would drag Android into this object and `java.net.URLEncoder` is the
     * wrong encoding — it is `application/x-www-form-urlencoded`, which writes a space as `+` and
     * would produce an id the phone cannot decode back to the document it names. Ids are opaque to
     * the Mac and are round-tripped, never interpreted, so the only property that matters is that
     * [encodeId] and [decodeId] are exact inverses over every byte a document id can hold.
     */
    fun encodeId(raw: String): String {
        val out = StringBuilder(raw.length + 8)
        for (byte in raw.toByteArray(Charsets.UTF_8)) {
            val ch = byte.toInt().toChar()
            if (ch.isUnreserved()) out.append(ch) else out.append('%').append("%02X".format(byte))
        }
        return out.toString()
    }

    fun decodeId(encoded: String): String {
        val bytes = ArrayList<Byte>(encoded.length)
        var i = 0
        while (i < encoded.length) {
            val c = encoded[i]
            if (c == '%' && i + 2 < encoded.length) {
                val hex = encoded.substring(i + 1, i + 3).toIntOrNull(16)
                if (hex != null) {
                    bytes.add(hex.toByte())
                    i += 3
                    continue
                }
            }
            c.toString().toByteArray(Charsets.UTF_8).forEach { bytes.add(it) }
            i++
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    private fun Char.isUnreserved(): Boolean =
        this in 'A'..'Z' || this in 'a'..'z' || this in '0'..'9' || this == '-' ||
            this == '.' || this == '_' || this == '~'

    /** `saf:primary%3ADCIM` from the tree's document id. The grant *is* the id; nothing stores it. */
    fun rootIdForTree(treeDocumentId: String): String = SAF_PREFIX + encodeId(treeDocumentId)

    /** The tree document id inside a `saf:` root id, or null when this is not one. */
    fun treeDocumentIdOf(rootId: String): String? =
        if (rootId.startsWith(SAF_PREFIX)) decodeId(rootId.removePrefix(SAF_PREFIX)) else null

    // ---- paths ----------------------------------------------------------------------------------

    /** What a `path` field turned out to be. */
    sealed interface PathResult {
        /** Root-relative segments, empty for the root of the tree itself. */
        data class Ok(val segments: List<String>) : PathResult
        data class Rejected(val why: String) : PathResult
    }

    /**
     * Splits and validates a root-relative path, refusing an escape rather than normalising it.
     *
     * **A `..` is rejected, never resolved.** Normalising an escape attempt and then serving the
     * result is how a path traversal gets served politely: the caller asked for something outside
     * the granted tree, got something inside it, and nothing anywhere recorded that the request was
     * malformed. `BAD_REQUEST` is the honest answer, and it is the Mac's fault to fix.
     *
     * An absolute path is refused for the same reason — under SAF there is no absolute path to
     * mean, so one arriving is a Mac that has built a POSIX-looking string out of a document id.
     */
    fun splitPath(path: String?): PathResult {
        if (path == null || path.isBlank()) return PathResult.Ok(emptyList())
        if (path.startsWith("/")) return PathResult.Rejected("path must be relative to the root")
        val segments = path.split('/').filter { it.isNotEmpty() }
        segments.forEach { segment ->
            if (segment == "..") return PathResult.Rejected("path may not contain a `..` segment")
            if (segment == ".") return PathResult.Rejected("path may not contain a `.` segment")
        }
        return PathResult.Ok(segments)
    }

    /** Joins segments back into the `path` an ack echoes. */
    fun joinPath(segments: List<String>): String = segments.joinToString("/")

    /** A `name` for `fs.mkdir` — one component, never a chain. */
    fun rejectionForName(name: String?): String? = when {
        name.isNullOrBlank() -> "name is required"
        name.contains('/') -> "name may not contain `/` — mkdir creates one directory, not a chain"
        name == "." || name == ".." -> "name may not be `.` or `..`"
        else -> null
    }

    // ---- entries, ordering and paging -----------------------------------------------------------

    /** One directory entry, before it becomes JSON. */
    data class Entry(
        val id: String,
        val name: String,
        val dir: Boolean,
        val size: Long,
        val mtimeMs: Long,
        val mime: String,
    )

    /**
     * Compares two byte arrays as unsigned bytes — what "byte-wise" in the payload spec means.
     *
     * Kotlin's `String.compareTo` orders by UTF-16 code unit, which is **not** UTF-8 byte order:
     * a supplementary character sorts below `U+E000`–`U+FFFF` in UTF-16 and above them in UTF-8. Two
     * ends agreeing on "byte-wise" and one of them using the platform comparator is a cursor that
     * lands in a different place on each side, which shows up as a page boundary that skips or
     * repeats exactly the rows containing an emoji in their name.
     */
    fun compareBytewise(a: String, b: String): Int {
        val x = a.toByteArray(Charsets.UTF_8)
        val y = b.toByteArray(Charsets.UTF_8)
        var i = 0
        while (i < x.size && i < y.size) {
            val diff = (x[i].toInt() and 0xFF) - (y[i].toInt() and 0xFF)
            if (diff != 0) return diff
            i++
        }
        return x.size - y.size
    }

    /**
     * Folders first, then name ascending byte-wise, then id ascending byte-wise.
     *
     * The same total-ordering discipline the `beforeId` decision took for `sms.threads`,
     * `sms.messages` and `call.log`, for the same reason: a cursor on one field cannot advance
     * *inside* a group sharing that field's value. The tiebreaker is not required to be meaningful,
     * only total, deterministic, and agreed by both sides.
     */
    val ENTRY_ORDER: Comparator<Entry> = Comparator { a, b ->
        val byDir = b.dir.compareTo(a.dir)
        if (byDir != 0) return@Comparator byDir
        val byName = compareBytewise(a.name, b.name)
        if (byName != 0) return@Comparator byName
        compareBytewise(a.id, b.id)
    }

    /** The `(afterName, afterId)` pair, or its absence. */
    sealed interface Cursor {
        object None : Cursor
        data class After(val name: String, val id: String) : Cursor
    }

    fun cursorOf(afterName: String?, afterId: String?): Cursor =
        if (afterName == null || afterId == null) Cursor.None else Cursor.After(afterName, afterId)

    /**
     * How [pageOf] found its starting point, so a log can say so.
     *
     * The instrument reports its own bounds — a page that started somewhere approximate must not be
     * indistinguishable from one that started exactly where it was asked to.
     */
    enum class CursorResolution {
        /** No cursor was sent. The first page. */
        FIRST_PAGE,

        /** The cursor entry was found in the sorted listing and the page starts after it. Exact. */
        EXACT,

        /**
         * The cursor entry is gone — renamed or deleted between two pages.
         *
         * The page then starts at the first entry the comparator puts strictly after the cursor,
         * with the vanished entry assumed to have been a **folder**. That assumption is chosen to
         * over-return rather than under-return: folders sort first, so treating the missing entry as
         * one can only re-send entries the Mac already has, never skip one it does not. A repeated
         * row is a cosmetic fault in a file list; a skipped row is a file the user cannot see and
         * has no way to discover.
         */
        APPROXIMATE,
    }

    data class Page(
        val entries: List<Entry>,
        val hasMore: Boolean,
        val resolution: CursorResolution,
        /** How many entries the directory held in total — the denominator for [entries]. */
        val total: Int,
    )

    /**
     * Sorts, seeks to the cursor and takes one page — the whole paging decision, in one place.
     *
     * **The listing is sorted in memory over the entire directory**, and that is a real bound worth
     * stating rather than discovering: `DocumentsProvider` does not honour a sort order or a limit,
     * so `limit` bounds the *frame*, never the work. A directory of 100,000 files is fully read on
     * every page. It is the honest implementation of the ordering the payload spec fixes — the
     * alternative is trusting a provider-side sort that most providers ignore silently, which would
     * put the two sides' idea of "the next page" out of step with nothing logging it.
     */
    fun pageOf(all: List<Entry>, cursor: Cursor, limit: Int): Page {
        val sorted = all.sortedWith(ENTRY_ORDER)
        val capped = limit.coerceIn(1, MAX_LIMIT)

        val start: Int
        val resolution: CursorResolution
        when (cursor) {
            is Cursor.None -> {
                start = 0
                resolution = CursorResolution.FIRST_PAGE
            }
            is Cursor.After -> {
                val exact = sorted.indexOfFirst { it.name == cursor.name && it.id == cursor.id }
                if (exact >= 0) {
                    start = exact + 1
                    resolution = CursorResolution.EXACT
                } else {
                    val ghost = Entry(cursor.id, cursor.name, dir = true, 0, 0, DIR_MIME)
                    start = sorted.indexOfFirst { ENTRY_ORDER.compare(it, ghost) > 0 }
                        .let { if (it < 0) sorted.size else it }
                    resolution = CursorResolution.APPROXIMATE
                }
            }
        }

        val slice = sorted.drop(start).take(capped)
        return Page(
            entries = slice,
            hasMore = start + slice.size < sorted.size,
            resolution = resolution,
            total = sorted.size,
        )
    }


    // ---- the delete guard -----------------------------------------------------------------------

    /** Whether a file still is what the Mac last saw. See [deleteVerdict]. */
    sealed interface DeleteVerdict {
        object Match : DeleteVerdict
        data class Mismatch(val why: String) : DeleteVerdict
    }

    /**
     * The predicate `fs.delete` acts on — pure, so it has one home and a test can drive it.
     *
     * **This is the only expression allowed to decide whether a delete happens**, and the stores
     * evaluate it twice: once to answer, and once again immediately before the irreversible call
     * with a freshly read row. That is `scripts/step70-watch.mjs`'s shape, and it is here for the
     * reason that script exists — *a check that does not gate the action is decoration*. The step 70
     * watcher read the live call card six times, saw plainly that it was not the call under test,
     * and clicked Reject anyway, because the click was the next statement and nothing stood between
     * them. It hung up the user's own outgoing call.
     *
     * A delete on someone's phone, issued from a list that re-renders under the pointer, is the same
     * class of action with a worse blast radius: a hung-up call can be redialled.
     *
     * **What this does not claim.** There is no atomic compare-and-delete in `DocumentsContract`, so
     * a window of microseconds remains between the second read and the delete. It is stated rather
     * than papered over: the guard closes the window a *stale Mac* opens — a list drawn minutes ago
     * — which is the whole of the risk this is written against. It does not close a window some
     * other process on the phone could open by rewriting the file in that instant, and nothing
     * available on this platform would.
     */
    fun deleteVerdict(entry: Entry, expectSize: Long, expectMtimeMs: Long): DeleteVerdict = when {
        entry.dir -> DeleteVerdict.Mismatch(
            "that is a directory, and directory deletion is not part of this protocol"
        )
        entry.size != expectSize -> DeleteVerdict.Mismatch(
            "it holds ${entry.size} bytes where the Mac last saw $expectSize"
        )
        entry.mtimeMs != expectMtimeMs -> DeleteVerdict.Mismatch(
            "it was last modified at ${entry.mtimeMs} where the Mac last saw $expectMtimeMs"
        )
        else -> DeleteVerdict.Match
    }

    // ---- payloads -------------------------------------------------------------------------------

    /**
     * One root in the `fs.list` discovery ack.
     *
     * A Mac must handle a `kind` it does not recognise by showing the root with its label and no
     * special treatment, never by discarding it — which is what keeps `kind: "all"` reserved for an
     * all-files upgrade that would then be one more root rather than a protocol change.
     */
    fun root(
        rootId: String,
        label: String,
        kind: String,
        writable: Boolean,
        freeBytes: Long,
    ): JsonObject = buildJsonObject {
        put("rootId", rootId)
        put("label", label)
        put("kind", kind)
        put("writable", writable)
        put("freeBytes", freeBytes)
    }

    /**
     * One `fs.list` entry.
     *
     * **[name] is always the real path component** and is what the Mac sends back to navigate.
     * Where the component is a package id, [displayName] and [packageName] go beside it — never
     * instead of it. Prettifying `name` itself would break navigation, which is the whole reason the
     * path is data and only the label is a sentence.
     */
    fun entry(
        entry: Entry,
        packageName: String? = null,
        displayName: String? = null,
    ): JsonObject = buildJsonObject {
        put("id", entry.id)
        put("name", entry.name)
        put("dir", entry.dir)
        put("size", entry.size)
        put("mtimeMs", entry.mtimeMs)
        put("mime", entry.mime)
        if (packageName != null) {
            put("packageName", packageName)
            put("displayName", displayName ?: packageName)
        }
    }

    /**
     * The `fs.stat` ack.
     *
     * `sha256` is **null** unless the phone already holds one and is never computed here: digesting
     * a 4 GB video to answer a stat call would block the control channel for a minute with no
     * progress reporting. The digest is computed streaming during a transfer, which is where it
     * belongs and where there is something to report it on.
     */
    fun stat(entry: Entry, sha256: String? = null): JsonObject = buildJsonObject {
        put("id", entry.id)
        put("name", entry.name)
        put("dir", entry.dir)
        put("size", entry.size)
        put("mtimeMs", entry.mtimeMs)
        put("mime", entry.mime)
        put("sha256", sha256)
    }


    /**
     * A tree's document id turned into the breadcrumb a person reads: `DCIM › Camera`.
     *
     * The URI is the machine handle and this is the sentence — the package-id rule applied to a
     * different kind of opaque identifier, and it binds the same way. A raw
     * `content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FCamera` in a label is
     * defect 33's shape with a different id in it.
     *
     * `primary:` (or any other volume prefix) is dropped because it names the storage volume, and
     * this build serves one. If an SD-card tree ever becomes grantable the prefix is what tells two
     * `DCIM`s apart, and this is the function that would have to say so.
     */
    fun labelForTreeDocumentId(documentId: String): String {
        val afterVolume = documentId.substringAfter(':', documentId)
        val segments = afterVolume.split('/').filter { it.isNotBlank() }
        return if (segments.isEmpty()) documentId else segments.joinToString(" \u203a ")
    }

    /**
     * True when a folder name is shaped like a package id **and nothing more is claimed**.
     *
     * Deliberately narrow, and identical in spirit to [MediaPayloads.packageSegmentOf]: a name
     * looking like a package id is not evidence that an app owns the folder. The caller resolves it
     * through `AppLabels.of` and emits the pair **only when the label comes back different from the
     * id** — that difference is the discrimination, because it means an app by that name is
     * actually installed. A folder a person named `com.something` in their own Documents resolves to
     * itself and gets no label, which is the package-id rule declining to invent the sentence it
     * exists to prevent.
     */
    fun looksLikePackageId(name: String): Boolean {
        if (!name.contains('.')) return false
        val parts = name.split('.')
        if (parts.size < 2) return false
        return parts.all { part ->
            part.isNotEmpty() && part.first().isLetter() && part.all { it.isLetterOrDigit() || it == '_' }
        }
    }
}
