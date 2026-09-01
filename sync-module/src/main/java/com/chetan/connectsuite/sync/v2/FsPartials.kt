package com.chetan.connectsuite.sync.v2

/**
 * The on-disk convention for a transfer arriving at this phone, and the one place the suffixes are
 * spelled on this side.
 *
 * The Mac has the same three states in `desktop/src/shared/transferFiles.ts`, written first because
 * the Mac was the receiver first. **This is the phone's half of one convention, not a second
 * convention** — the states, the suffixes and the resume rule are the contract in
 * `docs/protocol.md`, and both sides implement it rather than one side copying the other.
 *
 * | State | On disk | Means |
 * |---|---|---|
 * | In flight, or interrupted | `holiday.mov.part` | Bytes are good as far as they go. **Resumable.** |
 * | Verified complete | `holiday.mov` | Done. Any stale `.part` or `.failed` for this name is gone. |
 * | Checksum mismatch | `holiday.mov.failed`, and **no** `.part` | The bytes were wrong and have been deleted. **Retry from zero.** |
 *
 * ### The filename is never the authority, and on this side that matters more
 *
 * A granted tree is `DCIM` or `Documents` — shared with every downloader, sync client and camera app
 * on the device, all of which write `.part` files as a matter of course. "Resume from any `.part` we
 * find" would mean **appending our bytes to a stranger's half-finished download** and then renaming
 * the result over their file. So [resumeFrom] takes the recorded length and refuses to guess without
 * one, and every caller consults the transfer record rather than the directory.
 *
 * That risk is the Mac's too, but it is worse here: on the Mac the destination is a folder we chose,
 * and here it is a folder the user shared with us.
 */
object FsPartials {

    /** The suffix on a partial. Declared once on this side; `FsPartialsTest` checks that. */
    const val PART_SUFFIX = ".part"

    /** The suffix on the sidecar left where a checksum failed. */
    const val FAILED_SUFFIX = ".failed"

    /**
     * Whether the Mac asked to replace a file already at the destination.
     *
     * **Only the exact string `true` is a yes.** Absent is no, `null` is no, and anything that is
     * not a boolean is no — because the cost of the two mistakes is not symmetric: reading a
     * missing field as "yes" destroys a file the user did not offer up, and reading a malformed
     * one as "no" costs a refusal the Mac can answer. A lenient parser here would be that decision
     * taken by whoever wrote the JSON reader.
     */
    fun overwriteRequested(raw: String?): Boolean = raw == "true"

    fun partNameFor(name: String): String = name + PART_SUFFIX

    fun failedNameFor(name: String): String = name + FAILED_SUFFIX

    /** Why a resume was refused, in words the log can carry without a second lookup. */
    sealed interface Resume {
        /** Start at zero. [why] is logged; it is not sent to the Mac as a code. */
        data class FromZero(val why: String) : Resume
        data class FromOffset(val offset: Long) : Resume
    }

    /**
     * Where to start receiving, given the partial on disk and our own record of it.
     *
     * Mirrors `isResumable` on the Mac, including the case that looks like an edge and is not:
     * **a partial shorter than the record resumes from the file's length, never the record's**,
     * because the file is what the digest will actually cover. A record claiming more bytes than
     * exist is how a resumed digest silently omits a hole.
     *
     * @param partBytes length of the `.part` on disk, or null when there is none
     * @param recordedBytes what our own transfer record says we wrote, or null when we have no record
     * @param totalBytes the size the sender declared
     */
    fun resumeFrom(partBytes: Long?, recordedBytes: Long?, totalBytes: Long): Resume {
        if (partBytes == null) return Resume.FromZero("there is no partial file")
        if (recordedBytes == null) {
            return Resume.FromZero(
                "a partial with no transfer record of ours beside it — treated as another app's file",
            )
        }
        if (partBytes > recordedBytes) {
            return Resume.FromZero(
                "the partial holds $partBytes bytes where our record says $recordedBytes",
            )
        }
        if (partBytes >= totalBytes) {
            return Resume.FromZero("the partial already holds $partBytes of $totalBytes bytes")
        }
        if (partBytes == 0L) return Resume.FromZero("the partial is empty")
        return Resume.FromOffset(partBytes)
    }

    /**
     * The sidecar's contents — a small text file, readable by whoever opens the folder.
     *
     * **A sidecar rather than a rename**, for the reason the Mac's copy gives: renaming the bad
     * partial to `holiday.mov.corrupt` keeps the corrupt bytes, which is exactly what *a corrupt
     * file is worse than a missing one* forbids, and it leaves something a hopeful user can rename
     * back. The sidecar carries the fact without carrying the bytes.
     */
    fun sidecarText(
        name: String,
        whenIso: String,
        bytes: Long,
        expected: String,
        actual: String,
    ): String = buildString {
        appendLine("ConnectSuite transfer failed — checksum mismatch")
        appendLine("file      $name")
        appendLine("when      $whenIso")
        appendLine("size      $bytes bytes received")
        appendLine("expected  $expected")
        appendLine("actual    $actual")
        appendLine()
        appendLine("The received bytes were wrong and have been deleted, so a retry starts clean.")
        appendLine("This file is a note, not your data. Deleting it is safe.")
    }
}
