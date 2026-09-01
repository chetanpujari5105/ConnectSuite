package com.chetan.connectsuite.sync.v2

import java.io.InputStream
import java.io.OutputStream

/**
 * What one root can be asked to do. Two implementations: [SafTreeStore] and [AppFilesStore].
 *
 * The interface exists because `fs.*` addresses two genuinely different things through one payload —
 * a SAF tree the user granted, and the app's own private folder — and the handler in [FsFeature]
 * must not know which it is holding. Under SAF there is no absolute path, so every method here is
 * addressed the way the wire is: by root-relative segments, or by the phone's own opaque id.
 */
interface FsStore {

    val rootId: String
    val label: String

    /** `app` or `tree`. `all` is reserved for an all-files upgrade that is recorded and not built. */
    val kind: String

    val writable: Boolean

    fun freeBytes(): Long

    /** Children of a directory, unsorted. **Null** means the path does not resolve. */
    fun listChildren(segments: List<String>): List<FsPaths.Entry>?

    /** One entry by the id a listing gave out, or null when it is gone. */
    fun statById(id: String): FsPaths.Entry?

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
