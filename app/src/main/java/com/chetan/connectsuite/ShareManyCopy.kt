package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake
import com.chetan.connectsuite.sync.v2.ShareManyQueue.NotSentWhy
import com.chetan.connectsuite.sync.v2.ShareManyQueue.Prep
import com.chetan.connectsuite.sync.v2.ShareManyQueue.WaitReason
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareSelection

/**
 * **Stage 2, development only** — what the several-files review screen says (docs/feature-a-multi-offer-proposal.md
 * rev 4 §13 and §15). Pure, so a JVM test reads every sentence. The screen itself is in the debug
 * source set only (`ShareManyToMacActivity`); these strings reach no release screen.
 *
 * - **A row after its offer is the single-file sheet word for word** — [ShareToMacCopy.headline] and
 *   [ShareToMacCopy.detail] over the same [reduce] — except the two places §13.1 differs: an accepted
 *   file waiting its turn is not *Sending*, and an offer that ended with nothing saved is labelled
 *   *Not sent* with the single-file sentence as its reason.
 * - **Only [ShareSheetState.Saved] says saved**, and only the Mac's verified `share.saved {ok:true}`
 *   produces it ([reduce]). The summary says *all saved* only when every file is saved.
 * - **Only all bytes having left the phone says Sent.** Offered, accepted and queued files never do.
 */
sealed interface ShareManyRow {
    val name: String
    data class Before(override val name: String, val prep: Prep, val expected: Long?) : ShareManyRow
    /**
     * An offered file, following its offer. [queued] is `ShareOffer.State.Accepted` — the Mac accepted it
     * and it waits its turn — which the single-file [reduce] folds into *Sending*.
     */
    data class After(override val name: String, val state: ShareSheetState, val queued: Boolean) : ShareManyRow
}

object ShareManyCopy {

    const val NOT_SENT = "Not sent"
    const val SIZE_NOT_REPORTED = "size not reported"

    fun sendButton(count: Int) = "Send $count files"

    /** The review line under the list: count and the total of the sizes that were reported. */
    fun reviewTotal(sizes: List<Long?>): String {
        val known = sizes.filterNotNull()
        val unknown = sizes.size - known.size
        return "${sizes.size} files · ${ShareToMacCopy.bytes(known.sum())}" +
            if (unknown > 0) " ($unknown with the $SIZE_NOT_REPORTED)" else ""
    }

    fun label(row: ShareManyRow, mac: String): String = when (row) {
        is ShareManyRow.Before -> when (val p = row.prep) {
            Prep.NotStarted -> "Not prepared yet"
            is Prep.Preparing -> "Preparing…"
            is Prep.Waiting -> "Waiting for room"
            // Offered with no offer state seen yet: exactly what the offer's first state says.
            is Prep.Offered -> ShareToMacCopy.headline(ShareSheetState.WaitingForMac(row.name, p.bytes, mac))
            is Prep.NotSent -> NOT_SENT
        }
        is ShareManyRow.After -> when {
            row.queued -> "Accepted on $mac — waiting its turn"
            row.state is ShareSheetState.Stopped -> NOT_SENT
            else -> ShareToMacCopy.headline(row.state)
        }
    }

    fun detail(row: ShareManyRow, mac: String): String = when (row) {
        is ShareManyRow.Before -> when (val p = row.prep) {
            Prep.NotStarted -> ""
            is Prep.Preparing -> ShareToMacCopy.detail(ShareSheetState.Preparing(row.name, p.copied, row.expected))
            is Prep.Waiting -> waiting(p.reason, mac, p.paused)
            is Prep.Offered -> ShareToMacCopy.detail(ShareSheetState.WaitingForMac(row.name, p.bytes, mac))
            is Prep.NotSent -> notSent(p.why, mac)
        }
        is ShareManyRow.After ->
            if (row.queued) "It starts on its own when the file ahead of it finishes. Nothing of it is on your Mac yet."
            else ShareToMacCopy.detail(row.state)
    }

    /**
     * The waiting line (§13.1). For (a) and (c) the §12 **stall clock** (PROPOSED, development only)
     * chooses: paused — the file waits only on files the Mac has already accepted — says so; running
     * says only *"Prepared when an earlier file finishes."*, which claims nothing about what holds the
     * room. Reason (b) keeps its own sentence either way: it names the limit that is actually reached.
     * No line shows a countdown.
     */
    fun waiting(r: WaitReason, mac: String, paused: Boolean = false): String = when {
        r == WaitReason.LiveLimit -> "$mac already has 10 files from this phone in progress."
        paused -> "Waiting for $mac to finish an earlier file. Keep this screen open."
        else -> "Prepared when an earlier file finishes. Keep this screen open."
    }

    fun notSent(w: NotSentWhy, mac: String): String = when (w) {
        NotSentWhy.OpenFailed -> "Sidekick couldn’t open this file. The app that shared it may not allow it."
        NotSentWhy.ReadFailed -> "Reading stopped part-way — access ended or the file changed. Nothing was sent."
        is NotSentWhy.NoSpace -> "Not enough space on this phone to prepare it: needs ${ShareToMacCopy.bytes(w.needed)}, ${ShareToMacCopy.bytes(w.free)} free."
        is NotSentWhy.TooLarge -> "Larger than this phone can prepare right now (limit ${ShareToMacCopy.bytes(w.limit)})."
        NotSentWhy.WriteFailed -> "Couldn’t write the prepared copy on this phone."
        // §14's sentence first, word for word; then what it means for this file, since it is never retried.
        NotSentWhy.CleanupUnverified -> "Couldn’t clean up the partial copy on this phone. " +
            "Sidekick won’t try this file again from this screen, and nothing of it reached $mac."
        NotSentWhy.OutOfRule -> ShareToMacCopy.notOffered(ShareSheetState.NotOffered.OUT_OF_RULE)
        NotSentWhy.MacCannotReceive -> needsVersion3(mac)
        NotSentWhy.ScreenClosed -> "The share screen closed before it was prepared."
        NotSentWhy.Disconnected -> "$mac disconnected before it was offered."
        // §12: the running limit and the ceiling read the same; the log line says which.
        is NotSentWhy.WaitedTooLong -> "It waited too long for room on this phone and was never offered to $mac."
    }

    fun needsVersion3(mac: String) = "$mac can receive one file at a time from this phone. Update Sidekick on your Mac to send several at once."

    /** A whole selection refused before anything is read (§15). [count] is how many were selected; [index] is 1-based. */
    fun refusal(r: ShareSelection.Refusal, count: Int, index: Int?, mac: String?): String = when (r) {
        ShareSelection.Refusal.NOT_A_SEND_MULTIPLE -> ShareToMacCopy.refusal(ShareIntake.Refusal.NOT_A_SEND)
        ShareSelection.Refusal.NO_FILES -> ShareToMacCopy.refusal(ShareIntake.Refusal.NO_FILE)
        ShareSelection.Refusal.TOO_MANY -> "Sidekick sends up to ${ShareSelection.MAX_FILES} files at a time — you selected $count."
        ShareSelection.Refusal.FOLDER -> "Item ${index ?: "?"} can’t be sent (a folder)."
        ShareSelection.Refusal.NOT_CONTENT -> "Item ${index ?: "?"} can’t be sent (the app didn’t share it as a file Sidekick can read)."
        ShareSelection.Refusal.ANOTHER_IN_PROGRESS -> ShareToMacCopy.refusal(ShareIntake.Refusal.ANOTHER_IN_PROGRESS)
        ShareSelection.Refusal.NEEDS_VERSION_3 -> needsVersion3(mac ?: "Your Mac")
    }

    /**
     * §13.2: facts in a fixed order, zeros omitted. The seven the proposal names come first, in its
     * order; four more make every row counted exactly once — *preparing*, *not prepared yet*, *couldn’t
     * save* and *sent, waiting to confirm* (which the proposal does not name; the last is the only count
     * that says sent, and it counts only files whose every byte left the phone).
     */
    fun summary(rows: List<ShareManyRow>, mac: String): String {
        val c = linkedMapOf(
            "saved on $mac" to 0, "not confirmed" to 0, "sending" to 0, "sent, waiting for $mac to confirm" to 0,
            "accepted, waiting its turn" to 0, "waiting for you to accept" to 0, "waiting for room" to 0,
            "preparing" to 0, "not prepared yet" to 0, "$mac couldn’t save" to 0, "not sent" to 0,
        )
        fun inc(k: String) { c[k] = c.getValue(k) + 1 }
        for (r in rows) when (r) {
            is ShareManyRow.Before -> when (r.prep) {
                Prep.NotStarted -> inc("not prepared yet")
                is Prep.Preparing -> inc("preparing")
                is Prep.Waiting -> inc("waiting for room")
                is Prep.Offered -> inc("waiting for you to accept")
                is Prep.NotSent -> inc("not sent")
            }
            is ShareManyRow.After -> when {
                r.queued -> inc("accepted, waiting its turn")
                else -> when (val s = r.state) {
                    is ShareSheetState.Saved -> inc("saved on $mac")
                    is ShareSheetState.Unconfirmed -> inc("not confirmed")
                    is ShareSheetState.Sending -> inc(if (s.allSent) "sent, waiting for $mac to confirm" else "sending")
                    is ShareSheetState.WaitingForMac -> inc("waiting for you to accept")
                    is ShareSheetState.SendFailed -> inc("$mac couldn’t save")
                    else -> inc("not sent")
                }
            }
        }
        if (rows.isNotEmpty() && c.getValue("saved on $mac") == rows.size) return "All ${rows.size} saved on $mac"
        return c.filterValues { it > 0 }.entries.joinToString(" · ") { "${it.value} ${it.key}" }
    }

    /**
     * A row for an offered file, from its offer's latest state [s] and the row last drawn for it, [prev].
     *
     * [s] is null when `ShareFeature.views` holds no entry for the offer — **either** it has not been seen
     * yet, **or** it has aged out of the newest 16 kept there. Those two are told apart by [prev], never
     * guessed: with a row already drawn, that row stands (a file shown *Saved* never goes back to
     * *Waiting for you to accept*); with none, null, and the caller draws the offer's first state.
     */
    fun after(name: String, bytes: Long, mac: String, prev: ShareManyRow.After?, s: ShareOffer.State?): ShareManyRow.After? {
        s ?: return prev
        // Several files are version 3 only, where every Accepted is queued until its pull begins.
        val state = reduce(prev?.state ?: ShareSheetState.WaitingForMac(name, bytes, mac), name, bytes, mac, s,
            queued = s == ShareOffer.State.Accepted)
        return ShareManyRow.After(name, state, queued = s == ShareOffer.State.Accepted)
    }
}
