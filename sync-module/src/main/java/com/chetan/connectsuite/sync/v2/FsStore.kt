package com.chetan.connectsuite.sync.v2

import java.io.InputStream
import java.io.OutputStream

/**
 * What one root can be asked to do. Three implementations: [DownloadsStore], [SafTreeStore] and
 * [AppFilesStore].
 *
 * The interface exists because `fs.*` addresses genuinely different things through one payload — a
 * SAF tree the user granted, the app's own private folder, and a `MediaStore` collection that needs
 * no permission at all — and the handler in [FsFeature] must not know which it is holding. Under SAF
 * there is no absolute path, so every method here is addressed the way the wire is: by root-relative
 * segments, or by the phone's own opaque id.
 *
 * The one place a caller may ask *which kind* it is holding is [supportsDirectories], and it is a
 * declared capability rather than a type check for that reason.
 */
interface FsStore {

    val rootId: String
    val label: String

    /**
     * `downloads`, `app` or `tree`. `all` is reserved for an all-files upgrade that is recorded and
     * not built.
     */
    val kind: String

    val writable: Boolean

    /**
     * Whether this root can hold directories at all.
     *
     * False for the `downloads` root, because **`MediaStore` cannot represent an empty directory** —
     * a folder there exists only as the relative path of a file inside it. Declared here rather than
     * inferred from a null return, so `fs.mkdir`'s refusal can say *why* instead of reporting the
     * path as missing: locked decision 6 asks for a specific reason, and "that folder does not
     * exist" is a wrong one that would send a user looking for a path problem.
     */
    val supportsDirectories: Boolean get() = true

    fun freeBytes(): Long

    /** Children of a directory, unsorted. **Null** means the path does not resolve. */
    fun listChildren(segments: List<String>): List<FsPaths.Entry>?

    /** One entry by the id a listing gave out, or null when it is gone. */
    fun statById(id: String): FsPaths.Entry?

    /**
     * Whether [id] can belong to this root, decided **without** asking a provider: true, false, or null
     * when this root's ids have no structure to decide by. Defect 208 — a foreign id sent to a SAF tree
     * makes `ExternalStorageProvider` throw inside `enforceTree`, and a caught throw reads as *gone*.
     */
    fun ownsId(id: String): Boolean? = null

    /** Creates one directory under [segments]. Null when the parent does not resolve. */
    fun mkdir(segments: List<String>, name: String): FsPaths.Entry?

    /**
     * Deletes [id] **only if** it still has exactly [expectSize] and [expectMtimeMs].
     *
     * This is the only deletion this interface offers, and that is the design rather than an
     * omission — see [DeleteOutcome] and the note on the implementations. There is deliberately no
     * `delete(id)`.
     */
    fun deleteIfUnchanged(id: String, expectSize: Long, expectMtimeMs: Long): DeleteOutcome

    /** Opens [id] for reading, for a transfer. Null when it is gone or is a directory. */
    fun openStream(id: String): InputStream?

    /**
     * [id]'s own file metadata, from a descriptor the provider opens — not its index (defect 166). The
     * default says *unavailable*, which makes a block pull fall back to [statById] and say so; a store
     * whose provider hands out real file descriptors overrides it.
     */
    fun liveStamp(id: String): SourceStability.ById = SourceStability.ById.Unavailable

    /**
     * A thumbnail for [id], bounded to [maxEdge], or null when this file has none.
     *
     * **Null is an ordinary answer.** Most files are not images: a `.txt`, an `.apk` and a directory
     * have no thumbnail and never will, and the wire says `NO_THUMBNAIL` for them rather than an
     * error — a pane that greyed itself out over a folder of documents would be reporting a normal
     * situation as a fault.
     *
     * The default decodes through [openStream], which works for every root because every root can
     * produce bytes. A store overrides it only to offer a **cheaper source** — `SafTreeStore` asks
     * the provider for its own cached thumbnail, which beats decoding a 12 MP JPEG — and comes back
     * through [FsThumbs.encode] so the caps apply to that path too.
     */
    fun thumbnail(id: String, maxEdge: Int): FsThumbs.Thumb? =
        FsThumbs.fromStream({ openStream(id) }, maxEdge)

    /**
     * Opens the partial for [name] under [segments], creating it if absent.
     *
     * Null when the parent does not resolve, the root is not [writable], or the provider refuses.
     * **The caller decides whether to append**, from the transfer record and [FsPartials.resumeFrom]
     * — this only reports what is on disk. A store that decided for itself would be deciding to
     * append to a file it cannot know is ours.
     */
    fun openPartial(segments: List<String>, name: String): FsPartial?
}

/**
 * A partial being received, and the three ways it can end.
 *
 * One handle rather than four store methods, because the four operations share a resolved parent
 * and a resolved document that are expensive to find again under SAF — and because keeping them
 * together is what makes it obvious that every path out of a transfer is covered.
 */
interface FsPartial {

    /** What the `.part` already holds, right now. The resume input; never the resume decision. */
    val bytesOnDisk: Long

    /**
     * True only when [FsStore.openPartial] created this partial in the same call, so nothing but this
     * transfer can have written it. It changes the **reason** [FsPartials.resumeFrom] gives, never the
     * decision: an empty partial starts at 0 either way. False is the conservative default — a partial
     * found already there, with no record of ours, is still treated as someone else's (defect 160).
     */
    val createdNow: Boolean get() = false

    /** Appends to the partial. Called once; the caller closes it. */
    fun append(): OutputStream?

    /**
     * Reads the partial back from byte 0, for the resume digest.
     *
     * A resumed push must digest the bytes **actually on disk**, not the number a record claims —
     * a record longer than the file is how a resumed digest silently omits a hole and then reports
     * a mismatch on bytes that never arrived.
     */
    fun read(): InputStream?

    /**
     * Renames the partial to its final name and clears any stale `.failed` beside it.
     *
     * Returns the finished entry, or null when the rename failed — in which case the partial is
     * **left alone**, because a rename that failed has not lost anything and a delete would.
     */
    fun commit(): FsPaths.Entry?

    /**
     * Deletes the partial and writes the `.failed` sidecar in its place.
     *
     * The checksum-mismatch path, and the only one that destroys received bytes. It destroys them on
     * purpose: a corrupt file is worse than a missing one.
     */
    fun discardAsFailed(sidecar: String)

    /**
     * Leaves the partial where it is, for a cancel or a dropped socket.
     *
     * The opposite of [discardAsFailed] and the reason both exist: an interrupted partial is a
     * resumable artifact, a checksum-failed partial is corrupt, and they look identical on disk
     * unless something decides.
     */
    fun keep()
}

/**
 * What a compare-and-delete did, with enough detail for the refusal to be actionable.
 *
 * [Stale] carries what the file **actually** is, not just that it differs, because the Mac's next
 * move is to refresh and ask again and it may as well be told the answer. A refusal that says only
 * "no" leaves the caller guessing whether the file grew, shrank, or was replaced by a different one
 * of the same length.
 */
sealed interface DeleteOutcome {
    object Deleted : DeleteOutcome
    object NotFound : DeleteOutcome
    data class Stale(val actualSize: Long, val actualMtimeMs: Long) : DeleteOutcome
    data class Refused(val why: String) : DeleteOutcome
}
