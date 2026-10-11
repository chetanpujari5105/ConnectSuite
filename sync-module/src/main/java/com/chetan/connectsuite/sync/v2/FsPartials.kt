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
     * @param createdNow the store created this partial in the same call ([FsPartial.createdNow])
     */
    fun resumeFrom(partBytes: Long?, recordedBytes: Long?, totalBytes: Long, createdNow: Boolean = false): Resume {
        if (partBytes == null) return Resume.FromZero("there is no partial file")
        // Defect 160: the first push of any name creates its partial before asking this, so "no record"
        // used to describe a partial made a moment ago by this very push as another app's file. Only a
        // partial this push created **and** that is still empty is named as new; anything else with no
        // record keeps the conservative reason below, and the decision is FromZero in every case.
        if (createdNow && partBytes == 0L) return Resume.FromZero("a new, empty partial created for this push — nothing to resume")
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
     * How a received transfer ended, decided from the two numbers and the two digests and nothing
     * else.
     *
     * ### This function exists because defect 56 had no test
     *
     * The receive path compared digests and, when the Mac had agreed none, committed whatever had
     * arrived. **A stream that ends early is an interruption, and with no digest nothing else
     * knows that** — the length agreed on the control channel is the only thing that can tell. A
     * push interrupted above the 64 MB pre-hash ceiling therefore committed a half file at its
     * final name, which is precisely what `.part` exists to prevent, defeated on the last step.
     *
     * The fix landed inline in [BulkTransfers] and was guarded by nothing. It is here now so a
     * test can reach it, because the rule this project already carries is that a guard living only
     * in the branch it guards is one refactor away from absent.
     *
     * ### The order is the rule, not an implementation detail
     *
     * **Length is decided before digest, and inverting the two is the subtle way to bring the
     * defect back.** A truncated arrival *also* fails its digest, so a digest-first reading
     * reports [Corrupt] — and [Corrupt]'s disk policy is to **destroy the partial**, which is the
     * opposite of what a resumable interruption needs. The visible symptom would not be a corrupt
     * file; it would be a 2 GB push that restarts from zero every time the network blinks, with a
     * `.failed` sidecar explaining a corruption that never happened. `FsArrivalTest` pins the
     * order with a case whose two readings disagree.
     *
     * @param received total bytes on disk, including any resumed from a previous attempt
     * @param agreed the size named on the control channel before a byte moved
     * @param expectedSha the digest agreed in advance, or null when the sender did not pre-hash
     * @param actualSha the digest of what actually landed, over the whole file
     */
    fun arrivalVerdict(
        received: Long,
        agreed: Long,
        expectedSha: String?,
        actualSha: String,
    ): Arrival = when {
        received < agreed -> Arrival.Short(received, agreed)
        received > agreed -> Arrival.Overrun(received, agreed)
        expectedSha == null -> Arrival.Complete(verified = false)
        expectedSha != actualSha -> Arrival.Corrupt(expectedSha, actualSha)
        else -> Arrival.Complete(verified = true)
    }

    /**
     * The four ways a received transfer can end, and the disk policy each one carries.
     *
     * The policy is written here beside the verdict rather than left to the caller, because the
     * whole defect was a caller that had a verdict and no policy for one of the cases.
     */
    sealed interface Arrival {
        /** Keep the partial or destroy it. The single question the receive path asks of a verdict. */
        val keepsPartial: Boolean

        /**
         * Everything agreed arrived.
         *
         * [verified] false is not a failure and is not hidden: it says a digest was never agreed,
         * so nothing compared the bytes. It is a separate field from `ok` precisely so a success
         * nobody checked cannot look like a success that was.
         */
        data class Complete(val verified: Boolean) : Arrival {
            override val keepsPartial: Boolean get() = false
        }

        /** Fewer bytes than agreed. **Resumable**, so the partial and its record both survive. */
        data class Short(val received: Long, val agreed: Long) : Arrival {
            override val keepsPartial: Boolean get() = true
        }

        /**
         * More bytes than agreed.
         *
         * Destroyed rather than kept: an overrun cannot be resumed into anything sensible, and
         * there is no offset a next attempt could be given that means "unsend those bytes".
         */
        data class Overrun(val received: Long, val agreed: Long) : Arrival {
            override val keepsPartial: Boolean get() = false
        }

        /** The right number of bytes and the wrong ones. Destroyed: a corrupt file is worse than a missing one. */
        data class Corrupt(val expected: String, val actual: String) : Arrival {
            override val keepsPartial: Boolean get() = false
        }
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
        appendLine("Sidekick transfer failed — checksum mismatch")
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
