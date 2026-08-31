package com.chetan.connectsuite.sync.v2

import java.io.InputStream

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
