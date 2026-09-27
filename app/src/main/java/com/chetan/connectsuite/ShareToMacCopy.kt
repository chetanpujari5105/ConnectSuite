package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareConcurrentBudget
import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import com.chetan.connectsuite.sync.v2.ShareIntake.Refusal
import com.chetan.connectsuite.sync.v2.ShareOffer
import com.chetan.connectsuite.sync.v2.ShareStaging
import java.util.Locale

/**
 * The state of the "Send to Mac" sheet, with nothing Android in it, so a JVM test can enumerate
 * every state and read the sentence each one shows.
 *
 * **Before an offer** the file is only prepared: [Ready] means *privately staged on this phone* and
 * nothing more. **After an offer** the sheet follows the phone's offer state machine
 * ([ShareOffer.State]) through [reduce], and exactly one rule is load-bearing: **only [Saved] says
 * the file is on the Mac, and only the Mac's verified `share.saved {ok:true}` produces it.** The phone
 * finishing its own send is [Sending] with `allSent`, never saved; a verdict that never comes is
 * [Unconfirmed], which says the Mac *may* have kept it.
 */
sealed interface ShareSheetState {
    data object Starting : ShareSheetState
    data class Refused(val reason: Refusal) : ShareSheetState
    data class Preparing(val name: String, val copied: Long, val expected: Long?) : ShareSheetState
    data class Ready(
        val name: String,
        val mime: String,
        val bytes: Long,
        val availability: Availability,
        /** Why the last Send did not make an offer, when it did not. Cleared by the next try. */
        val notOffered: NotOffered? = null,
        /**
         * With [NotOffered.MAC_BUSY]: the offer already live on this session, as it stands — so the sheet
         * names the waiting file and offers to withdraw it. Cleared when that offer ends.
         */
        val waitingOther: OtherOffer? = null,
    ) : ShareSheetState

    /** Another file's live offer, from the phone's own record of it. */
    data class OtherOffer(val offerId: String, val name: String, val awaitingAnswer: Boolean)
    data class Failed(val name: String, val failure: Failure) : ShareSheetState

    // ---- after an offer: every one of these carries the Mac it was offered to ---------------------

    /** Offered; the Mac holds it on its card until a person answers or it expires. */
    data class WaitingForMac(val name: String, val bytes: Long, val mac: String) : ShareSheetState
    /** Accepted and streaming, or — [allSent] — every byte sent and the Mac's verdict not yet in. */
    data class Sending(val name: String, val bytes: Long, val mac: String, val allSent: Boolean) : ShareSheetState
    /** The Mac verified and published it. [savedAs] is the Mac's name for it, which may differ. */
    data class Saved(val name: String, val mac: String, val savedAs: String) : ShareSheetState
    /** Every byte sent; the Mac's verdict never arrived. It may or may not be on the Mac. */
    data class Unconfirmed(val name: String, val mac: String) : ShareSheetState
    /** The Mac reported it could not save this attempt; a person on the Mac may Retry. */
    data class SendFailed(val name: String, val mac: String, val reason: String) : ShareSheetState
    /** Ended with nothing saved on the Mac, for [why]. */
    data class Stopped(val name: String, val mac: String, val why: StopReason) : ShareSheetState

    sealed interface Failure {
        data class NoSpace(val needed: Long, val free: Long) : Failure
        data class OverLimit(val limit: Long) : Failure
        data object ReadFailed : Failure
        data object WriteFailed : Failure
        /** The grant did not survive the activity being recreated (a rotation). The copy is cancelled. */
        data object AccessLostOnRecreate : Failure
        data object StagingUnavailable : Failure
        /**
         * Version 3 only (PROPOSED): files are already prepared for live offers and no cap on copies
         * held at once is approved, so this one was not copied. [held] is what those copies take.
         */
        data class HoldingAnother(val held: Long) : Failure
        /** Version 3 only, and only once a cap is approved: this copy would pass it. */
        data class OverHoldCap(val held: Long, val cap: Long) : Failure
        /**
         * Version 3 only, development (owner decision B): another file's copy is held for a live offer
         * ([held] bytes) and the per-copy budget refused this one. [limit] is the **measured** room for
         * one more copy at that moment, or null when no measurement was possible; [size] is this file's
         * reported size, or null. Nothing was copied or kept. The sheet offers **Try again**.
         * [anotherPreparing]: a Try again found another file being prepared right now.
         *
         * [why] is the budget's own refusal, carried unchanged (null only for a copy that reached the
         * limit it was admitted with). [at] says whether any of this file was copied before it stopped —
         * the wording may say *nothing was copied* only when that is true. **[held], [limit] and [why]
         * are the facts of the check that refused**, never re-read afterwards: see ShareAdmission.Stop.
         */
        data class NoRoomYet(
            val held: Long, val size: Long?, val limit: Long?, val anotherPreparing: Boolean = false,
            val why: ShareConcurrentBudget.Refusal? = null,
            val at: NoRoomAt = NoRoomAt.BeforeCopy,
        ) : Failure
    }

    /** When the no-room refusal happened, and so what the sheet may say was copied. */
    sealed interface NoRoomAt {
        /** Refused before a byte was read: nothing was copied. */
        data object BeforeCopy : NoRoomAt
        /** The budget re-check stopped the copy after [bytes] were prepared; they were deleted. */
        data class StoppedPartway(val bytes: Long) : NoRoomAt
        /** The copy reached the limit it was admitted with; what was prepared was deleted. */
        data object ReachedLimit : NoRoomAt
    }

    /** Why Send made no offer. The prepared copy is still this sheet's; nothing reached the Mac. */
    enum class NotOffered { MAC_BUSY, OUT_OF_RULE }

    /**
     * Why an offer ended with nothing saved. [byPerson] is the fact the copy must respect: a
     * `not-available` decline is a protocol stub and **never** a person's decision (docs/protocol.md →
     * Share), so only `user` is worded as someone declining.
     */
    enum class StopReason(val byPerson: Boolean) {
        DECLINED_BY_PERSON(true),
        DECLINED_NO_SPACE_ON_MAC(false),
        DECLINED_FOLDER_UNAVAILABLE(false),
        DECLINED_UNSUPPORTED_DESTINATION(false),
        DECLINED_NOT_AVAILABLE(false),
        DECLINED_BUSY(false),
        DECLINED_UNREADABLE(false),
        EXPIRED(false),
        CANCELLED_HERE(true),
        CANCELLED_ON_MAC(true),
        DISCONNECTED(false),
        DISCONNECTED_MID_TRANSFER(false),
        STAGING_LOST(false),
    }
}

/**
 * The sheet's state after an offer, from the phone's own offer state — pure, so a test reaches every
 * pair. [prev] matters in two places, both about not rounding an unknown into a known:
 *
 * - once [ShareSheetState.Unconfirmed], only a later [ShareOffer.State.Saved] (a Mac Retry that
 *   succeeded) changes it. The Retry window then closing is an `Expired` to the state machine, and
 *   "nothing was saved" would be false: the Mac may have kept the file.
 * - the session ending after every byte was sent is [ShareSheetState.Unconfirmed] — the contract's
 *   *"or the session ends first"* — not a plain disconnect.
 */
fun reduce(prev: ShareSheetState, name: String, bytes: Long, mac: String, s: ShareOffer.State): ShareSheetState {
    if (prev is ShareSheetState.Saved) return prev
    if (prev is ShareSheetState.Unconfirmed && s !is ShareOffer.State.Saved && !ShareOffer.isLive(s)) return prev
    val allSentBefore = (prev is ShareSheetState.Sending && prev.allSent) || prev is ShareSheetState.Unconfirmed
    fun stop(why: ShareSheetState.StopReason) = ShareSheetState.Stopped(name, mac, why)
    return when (s) {
        ShareOffer.State.Offered -> ShareSheetState.WaitingForMac(name, bytes, mac)
        ShareOffer.State.Accepted, ShareOffer.State.Sending -> ShareSheetState.Sending(name, bytes, mac, allSent = false)
        ShareOffer.State.AwaitingVerdict -> ShareSheetState.Sending(name, bytes, mac, allSent = true)
        is ShareOffer.State.Saved -> ShareSheetState.Saved(name, mac, s.savedAs)
        is ShareOffer.State.Failed ->
            if (s.reason == ShareOffer.UNCONFIRMED) ShareSheetState.Unconfirmed(name, mac) else ShareSheetState.SendFailed(name, mac, s.reason)
        is ShareOffer.State.Declined -> stop(
            when (s.reason) {
                "user" -> ShareSheetState.StopReason.DECLINED_BY_PERSON
                "insufficient-space" -> ShareSheetState.StopReason.DECLINED_NO_SPACE_ON_MAC
                "folder-unavailable" -> ShareSheetState.StopReason.DECLINED_FOLDER_UNAVAILABLE
                "unsupported-destination" -> ShareSheetState.StopReason.DECLINED_UNSUPPORTED_DESTINATION
                "busy" -> ShareSheetState.StopReason.DECLINED_BUSY
                "not-available" -> ShareSheetState.StopReason.DECLINED_NOT_AVAILABLE
                else -> ShareSheetState.StopReason.DECLINED_UNREADABLE
            },
        )
        ShareOffer.State.Expired -> stop(ShareSheetState.StopReason.EXPIRED)
        is ShareOffer.State.Cancelled -> when {
            s.by == ShareOffer.Side.MAC -> stop(ShareSheetState.StopReason.CANCELLED_ON_MAC)
            s.reason == "staging-lost" -> stop(ShareSheetState.StopReason.STAGING_LOST)
            else -> stop(ShareSheetState.StopReason.CANCELLED_HERE)
        }
        ShareOffer.State.SessionEnded -> when {
            allSentBefore -> ShareSheetState.Unconfirmed(name, mac)
            prev is ShareSheetState.Sending -> stop(ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER)
            else -> stop(ShareSheetState.StopReason.DISCONNECTED)
        }
    }
}

/**
 * **Who owns the staged copy when the person leaves the screen** — the one cleanup decision this
 * sheet makes. Before an offer the sheet owns it, and leaving deletes it (slice 1, unchanged). From
 * the moment an offer is made, `ShareFeature` owns it: every end of the offer — answered, expired,
 * cancelled, the session ending — deletes it there (`ShareOffer`: *every transition into an end
 * carries DeleteStaged*). So leaving an offered sheet neither deletes the copy under a live offer nor
 * cancels an offer the Mac may be about to accept; the offer runs to its own bounded end.
 */
/**
 * Send made no offer because [other] is live on this session (`ShareOffer.busyWith`). The sheet stays
 * [ShareSheetState.Ready] — **this** file stays prepared and owned by the sheet — and says which file is
 * in the way. Nothing about either file changes here.
 */
fun onBusy(ready: ShareSheetState.Ready, other: ShareOffer.Offer): ShareSheetState.Ready =
    ready.copy(
        notOffered = ShareSheetState.NotOffered.MAC_BUSY,
        waitingOther = ShareSheetState.OtherOffer(other.offerId, other.name, ShareOffer.awaitingAnswer(other.state)),
    )

/**
 * The blocking offer moved to [otherState] (null: the phone no longer holds it). When it is no longer
 * live the busy note clears and Send works again; while live, whether it can still be withdrawn is kept
 * current. Anything that is not a busy [ShareSheetState.Ready] is returned unchanged.
 */
fun afterOtherChanged(state: ShareSheetState, otherState: ShareOffer.State?): ShareSheetState {
    if (state !is ShareSheetState.Ready || state.notOffered != ShareSheetState.NotOffered.MAC_BUSY) return state
    val other = state.waitingOther ?: return state
    if (otherState == null || !ShareOffer.isLive(otherState)) return state.copy(notOffered = null, waitingOther = null)
    return state.copy(waitingOther = other.copy(awaitingAnswer = ShareOffer.awaitingAnswer(otherState)))
}

/** Send is offered only when it can make an offer: prepared, a Mac that asks, and no other file in the way. */
fun canSend(state: ShareSheetState): Boolean =
    state is ShareSheetState.Ready && state.availability is Availability.Available &&
        state.notOffered != ShareSheetState.NotOffered.MAC_BUSY

/** **Try again** exists only after a "no room for another file yet" refusal (decision B). */
fun canTryAgain(state: ShareSheetState): Boolean =
    state is ShareSheetState.Failed && state.failure is ShareSheetState.Failure.NoRoomYet

/**
 * The sheet state for a concurrent copy its budget re-check stopped: **exactly the re-check's facts** —
 * its reason, the `Σ` it read, its measured limit — and the bytes prepared before the stop. Nothing is
 * re-read here, so the other offers ending in the meantime cannot turn the sentence into *another file
 * … (0 bytes prepared for it)*, and a valid measurement cannot be worded as *couldn't measure*.
 */
fun noRoomAfterStop(stopped: ShareStaging.Outcome.BudgetStopped, size: Long?): ShareSheetState.Failure.NoRoomYet =
    ShareSheetState.Failure.NoRoomYet(
        held = stopped.stop.held, size = size, limit = stopped.stop.limit,
        why = stopped.stop.why, at = ShareSheetState.NoRoomAt.StoppedPartway(stopped.bytesWritten),
    )

/** The other file may be withdrawn only while it waits for an answer — never mid-transfer. */
fun canWithdrawOther(state: ShareSheetState): Boolean =
    state is ShareSheetState.Ready && state.notOffered == ShareSheetState.NotOffered.MAC_BUSY &&
        state.waitingOther?.awaitingAnswer == true

enum class SheetExit { DISCARD_STAGED, LEAVE_TO_OFFER, NOTHING }

fun onLeave(state: ShareSheetState): SheetExit = when (state) {
    ShareSheetState.Starting, is ShareSheetState.Preparing, is ShareSheetState.Ready -> SheetExit.DISCARD_STAGED
    is ShareSheetState.WaitingForMac, is ShareSheetState.Sending, is ShareSheetState.SendFailed -> SheetExit.LEAVE_TO_OFFER
    is ShareSheetState.Refused, is ShareSheetState.Failed, is ShareSheetState.Saved,
    is ShareSheetState.Unconfirmed, is ShareSheetState.Stopped -> SheetExit.NOTHING
}

/**
 * Whether the sheet offers **Cancel** (withdraw the offer) rather than Close. Not once every byte is
 * sent: a cancel then cannot unpublish anything the Mac saved, and the sheet would say "Cancelled"
 * over a file that may be on the Mac.
 */
fun canWithdraw(state: ShareSheetState): Boolean =
    state is ShareSheetState.WaitingForMac || (state is ShareSheetState.Sending && !state.allSent)

/** Every sentence the sheet can show. The sentences live here so the test reads what the user reads. */
object ShareToMacCopy {

    const val TITLE = "Send to Mac"
    const val LEAVING = "Leaving this screen discards the prepared copy."
    const val CANCELLED = "Cancelled. Nothing was sent, and the prepared copy was deleted."
    const val DISCARDED = "Closed. Nothing was sent, and the prepared copy was deleted."
    const val WITHDRAWN = "Withdrawn. Nothing was saved on your Mac, and the prepared copy was deleted."
    const val SEND_BUTTON = "Send"
    const val CANCEL_BUTTON = "Cancel"
    const val CLOSE_BUTTON = "Close"
    const val TRY_AGAIN_BUTTON = "Try again"

    fun headline(state: ShareSheetState): String = when (state) {
        ShareSheetState.Starting -> "Opening the file…"
        is ShareSheetState.Refused -> "Sidekick can’t use this share"
        is ShareSheetState.Preparing -> "Preparing…"
        is ShareSheetState.Ready -> when {
            state.notOffered != ShareSheetState.NotOffered.MAC_BUSY -> "Ready on this phone"
            state.waitingOther?.awaitingAnswer == false -> "Another file is being sent to your Mac"
            else -> "Another file is waiting for approval on your Mac"
        }
        is ShareSheetState.Failed ->
            if (state.failure is ShareSheetState.Failure.NoRoomYet) "No room for another file yet" else "Couldn’t prepare this file"
        is ShareSheetState.WaitingForMac -> "Waiting for you to accept on ${state.mac}"
        is ShareSheetState.Sending -> if (state.allSent) "Sent — waiting for ${state.mac} to confirm" else "Sending to ${state.mac}…"
        is ShareSheetState.Saved -> "Saved on ${state.mac}"
        is ShareSheetState.Unconfirmed -> "Not confirmed by ${state.mac}"
        is ShareSheetState.SendFailed -> "${state.mac} couldn’t save it"
        is ShareSheetState.Stopped -> stoppedHeadline(state.why, state.mac)
    }

    fun detail(state: ShareSheetState): String = when (state) {
        ShareSheetState.Starting -> ""
        is ShareSheetState.Refused -> refusal(state.reason)
        is ShareSheetState.Preparing ->
            "Copying it privately on this phone: ${bytes(state.copied)}" + (state.expected?.let { " of ${bytes(it)}" } ?: "") + "."
        is ShareSheetState.Ready ->
            "Prepared privately on this phone (${bytes(state.bytes)}). It has not been sent, and nothing is on your Mac."
        is ShareSheetState.Failed -> failure(state.failure)
        is ShareSheetState.WaitingForMac ->
            "Offered to ${state.mac} (${bytes(state.bytes)}). Nothing moves until someone accepts it there; " +
                "if nobody does, the offer expires in 10 minutes."
        is ShareSheetState.Sending -> if (state.allSent) {
            "All ${bytes(state.bytes)} have left this phone. It is saved only when ${state.mac} has checked it and says so."
        } else {
            "Accepted on ${state.mac}. Sending ${bytes(state.bytes)}; it is not saved until ${state.mac} has checked it."
        }
        is ShareSheetState.Saved ->
            if (state.savedAs == state.name) "${state.mac} checked every byte and saved it as “${state.savedAs}”."
            // Not "because a file of that name was there": the Mac also sanitises names, so a different
            // name is a fact about the result and not evidence of a collision.
            else "${state.mac} checked every byte and saved it as “${state.savedAs}” — that is its name on the Mac."
        is ShareSheetState.Unconfirmed ->
            "Every byte was sent, but ${state.mac} never confirmed it. It may or may not be there — check your Mac before sending it again."
        is ShareSheetState.SendFailed -> "${saveFailure(state.reason)} Nothing was saved. Someone on ${state.mac} can retry for up to 5 minutes."
        is ShareSheetState.Stopped -> stoppedDetail(state.why, state.mac)
    }

    /** Only for [ShareSheetState.Ready]: whether Send works, and why not when it does not. */
    fun availability(a: Availability): String = when (a) {
        Availability.NotConnected -> "Your Mac isn’t connected. Connect it to send this file."
        is Availability.NotSupported -> "${a.macName} can’t receive files from this phone yet. Update Sidekick on your Mac."
        is Availability.Available -> "Sends to ${a.macName}, which will ask you to accept it before anything moves."
    }

    fun notOffered(n: ShareSheetState.NotOffered): String = when (n) {
        ShareSheetState.NotOffered.MAC_BUSY -> "Your Mac is already waiting on another file from this phone. Finish that one first."
        ShareSheetState.NotOffered.OUT_OF_RULE -> "This file’s name or type can’t be sent as it is. Nothing was sent."
    }

    const val WITHDRAW_OTHER_BUTTON = "Withdraw that file"

    /**
     * The busy sentence for a sheet that knows which file is in the way. Says what happened to **both**
     * files — this one is still prepared and was not sent; the other is untouched — and the two ways out.
     */
    fun busy(other: ShareSheetState.OtherOffer?): String = when {
        other == null -> notOffered(ShareSheetState.NotOffered.MAC_BUSY) + " This file is still prepared here; nothing was sent."
        other.awaitingAnswer ->
            "“${other.name}” is waiting for approval on your Mac. This file is still prepared here and was not sent. " +
                "Withdraw that file to send this one instead, or wait: Send works again as soon as your Mac answers."
        else ->
            "“${other.name}” is being sent to your Mac right now. This file is still prepared here and was not sent. " +
                "Send works again as soon as that one finishes."
    }

    fun withdrewOther(name: String): String =
        "Withdrew “$name”. Nothing of it was saved on your Mac. This file is still ready to send."

    /** For an offered sheet: what leaving does. It does not discard — the offer owns the copy now. */
    fun leavingOffered(mac: String): String =
        "You can leave this screen. The offer stays open on $mac until it’s answered or expires; Cancel withdraws it."

    private fun stoppedHeadline(why: ShareSheetState.StopReason, mac: String): String = when (why) {
        ShareSheetState.StopReason.DECLINED_BY_PERSON -> "Declined on $mac"
        ShareSheetState.StopReason.EXPIRED -> "Expired"
        ShareSheetState.StopReason.CANCELLED_HERE -> "Cancelled"
        ShareSheetState.StopReason.CANCELLED_ON_MAC -> "Stopped on $mac"
        ShareSheetState.StopReason.DISCONNECTED, ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER -> "$mac disconnected"
        ShareSheetState.StopReason.STAGING_LOST -> "The prepared copy was lost"
        else -> "$mac couldn’t take it"
    }

    private fun stoppedDetail(why: ShareSheetState.StopReason, mac: String): String = when (why) {
        ShareSheetState.StopReason.DECLINED_BY_PERSON -> "Someone on $mac declined it. Nothing was sent."
        ShareSheetState.StopReason.DECLINED_NO_SPACE_ON_MAC -> "$mac doesn’t have enough free space for it. Nothing was sent."
        ShareSheetState.StopReason.DECLINED_FOLDER_UNAVAILABLE -> "$mac’s receive folder isn’t available. Nothing was sent."
        ShareSheetState.StopReason.DECLINED_UNSUPPORTED_DESTINATION ->
            "$mac’s receive folder can’t save files safely (for example, an exFAT drive). Nothing was sent."
        ShareSheetState.StopReason.DECLINED_NOT_AVAILABLE -> "$mac can’t receive files from this phone right now. Nothing was sent."
        ShareSheetState.StopReason.DECLINED_BUSY -> "$mac is already handling another file from this phone. Nothing was sent."
        ShareSheetState.StopReason.DECLINED_UNREADABLE -> "$mac couldn’t read the offer. Nothing was sent."
        ShareSheetState.StopReason.EXPIRED -> "The offer to $mac ran out of time. Nothing was saved there."
        ShareSheetState.StopReason.CANCELLED_HERE -> WITHDRAWN
        ShareSheetState.StopReason.CANCELLED_ON_MAC -> "It was stopped on $mac. Nothing was saved there."
        ShareSheetState.StopReason.DISCONNECTED -> "The connection to $mac ended before anyone accepted it. Nothing was sent."
        ShareSheetState.StopReason.DISCONNECTED_MID_TRANSFER ->
            "The connection to $mac dropped during the transfer, so it was not confirmed. Check your Mac before sending it again."
        ShareSheetState.StopReason.STAGING_LOST -> "The copy prepared on this phone changed or disappeared. Share the file again."
    }

    private fun saveFailure(reason: String): String = when (reason) {
        "checksum" -> "What arrived didn’t match what this phone sent."
        "truncated" -> "Fewer bytes arrived than were sent."
        "interrupted" -> "The transfer stalled."
        "insufficient-space" -> "The Mac ran out of space."
        "unsupported-destination" -> "The Mac’s receive folder can’t save files safely."
        else -> "The Mac couldn’t write it."
    }

    fun refusal(r: Refusal): String = when (r) {
        Refusal.NOT_A_SEND -> "Sidekick was opened without a file to send."
        Refusal.MORE_THAN_ONE -> "Send one file at a time for now."
        Refusal.NO_FILE -> "No file came with this share."
        Refusal.NOT_CONTENT -> "The app shared this file in a way Sidekick can’t read safely. Try sharing it from Files or Gallery."
        Refusal.FOLDER -> "That’s a folder. Share a single file instead."
        Refusal.ANOTHER_IN_PROGRESS -> "Another file is already being prepared. Finish or cancel that one first."
    }

    fun failure(f: ShareSheetState.Failure): String = when (f) {
        is ShareSheetState.Failure.NoSpace ->
            "Not enough space on this phone to prepare it: it needs ${bytes(f.needed)} free and ${bytes(f.free)} is. Nothing was kept."
        is ShareSheetState.Failure.OverLimit ->
            "It’s larger than this phone has room to prepare right now (up to ${bytes(f.limit)}). Nothing was kept."
        ShareSheetState.Failure.ReadFailed -> "The file stopped being readable partway through. Nothing was kept."
        ShareSheetState.Failure.WriteFailed -> "Sidekick couldn’t write its private copy. Nothing was kept."
        ShareSheetState.Failure.AccessLostOnRecreate ->
            "Android withdrew access to the file when the screen changed. Share it again. Nothing was kept."
        ShareSheetState.Failure.StagingUnavailable -> "Sidekick’s private storage isn’t usable right now. Nothing was kept."
        is ShareSheetState.Failure.HoldingAnother ->
            "Another file is already prepared and waiting for your Mac (${bytes(f.held)}). For now this phone holds one at a time — " +
                "wait for it to finish or withdraw it, then share this again. Nothing was kept."
        is ShareSheetState.Failure.OverHoldCap ->
            "Files waiting for your Mac already take ${bytes(f.held)}, and this one would pass the ${bytes(f.cap)} this phone holds at once. " +
                "Wait for one to finish or withdraw one, then share this again. Nothing was kept."
        is ShareSheetState.Failure.NoRoomYet -> noRoomYet(f)
    }

    private fun noRoomYet(f: ShareSheetState.Failure.NoRoomYet): String {
        val other = "Your Mac is still handling another file from this phone (${bytes(f.held)} prepared for it)."
        val fell = when {
            f.at !is ShareSheetState.NoRoomAt.StoppedPartway || f.limit == null -> ""
            f.why == ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET -> "This phone’s free space fell while this file was being prepared. "
            f.why == ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET ->
                "The storage Android lets Sidekick use for files it is preparing filled up while this one was being prepared. "
            else -> "The room for it fell while it was being prepared. "
        }
        // "Couldn't measure" only when there is no measurement: the wording keys on the limit itself.
        val room = when {
            f.anotherPreparing -> "Another file is being prepared on this phone right now, so this one can’t start yet."
            f.limit == null -> "Sidekick couldn’t measure how much room this phone has for another file right now."
            f.size == null -> "${fell}With that held, this phone can prepare only ${bytes(f.limit)} more right now, and this file’s size isn’t reported."
            else -> "${fell}With that held, this phone can prepare only ${bytes(f.limit)} more right now, and this file is ${bytes(f.size)}."
        }
        val kept = when (val at = f.at) {
            ShareSheetState.NoRoomAt.BeforeCopy -> "Nothing was copied or kept."
            is ShareSheetState.NoRoomAt.StoppedPartway ->
                "Sidekick stopped after preparing ${bytes(at.bytes)} of it and deleted that part. Nothing was kept."
            ShareSheetState.NoRoomAt.ReachedLimit ->
                "Sidekick stopped when it reached that limit and deleted what it had prepared. Nothing was kept."
        }
        return "$other $room $kept Tap $TRY_AGAIN_BUTTON when the other file has finished — while this screen is open."
    }

    /** `230,778 bytes (225 KB)` — the exact count first, then a human form. */
    fun bytes(n: Long): String {
        val exact = String.format(Locale.US, "%,d bytes", n)
        if (n < 1024) return exact
        val units = listOf("KB", "MB", "GB", "TB")
        var v = n / 1024.0
        var i = 0
        while (v >= 1024 && i < units.lastIndex) { v /= 1024; i++ }
        val human = if (v >= 100) String.format(Locale.US, "%.0f %s", v, units[i]) else String.format(Locale.US, "%.1f %s", v, units[i])
        return "$exact ($human)"
    }

    /** Every state the sheet can be in, with representative values — the test's enumeration. */
    fun everyState(): List<ShareSheetState> = buildList {
        add(ShareSheetState.Starting)
        Refusal.values().forEach { add(ShareSheetState.Refused(it)) }
        add(ShareSheetState.Preparing("a.bin", 4096, 100_000))
        add(ShareSheetState.Preparing("a.bin", 4096, null))
        add(ShareSheetState.Ready("a.bin", "application/octet-stream", 100_000, Availability.NotConnected))
        add(ShareSheetState.Ready("a.bin", "application/octet-stream", 0, Availability.NotSupported("Mac")))
        add(ShareSheetState.Ready("a.bin", "application/octet-stream", 0, Availability.Available("Mac")))
        ShareSheetState.NotOffered.values().forEach { add(ShareSheetState.Ready("a.bin", "b/c", 0, Availability.Available("Mac"), it)) }
        add(ShareSheetState.Ready("a.bin", "b/c", 0, Availability.Available("Mac"), ShareSheetState.NotOffered.MAC_BUSY, ShareSheetState.OtherOffer("s-x", "b.jpg", true)))
        add(ShareSheetState.Ready("a.bin", "b/c", 0, Availability.Available("Mac"), ShareSheetState.NotOffered.MAC_BUSY, ShareSheetState.OtherOffer("s-x", "b.jpg", false)))
        listOf(
            ShareSheetState.Failure.NoSpace(1, 0), ShareSheetState.Failure.OverLimit(1),
            ShareSheetState.Failure.ReadFailed, ShareSheetState.Failure.WriteFailed,
            ShareSheetState.Failure.AccessLostOnRecreate, ShareSheetState.Failure.StagingUnavailable,
            ShareSheetState.Failure.HoldingAnother(100_718), ShareSheetState.Failure.OverHoldCap(100_718, 1_000_000),
            ShareSheetState.Failure.NoRoomYet(100_718, 230_778, 89_000), ShareSheetState.Failure.NoRoomYet(100_718, null, 89_000),
            ShareSheetState.Failure.NoRoomYet(100_718, 230_778, null), ShareSheetState.Failure.NoRoomYet(100_718, 230_778, 0, anotherPreparing = true),
            ShareSheetState.Failure.NoRoomYet(100_718, 230_778, 89_000, why = ShareConcurrentBudget.Refusal.OVER_SPACE_BUDGET,
                at = ShareSheetState.NoRoomAt.StoppedPartway(8_388_608)),
            ShareSheetState.Failure.NoRoomYet(100_718, null, 89_000, why = ShareConcurrentBudget.Refusal.OVER_QUOTA_BUDGET,
                at = ShareSheetState.NoRoomAt.StoppedPartway(8_388_608)),
            ShareSheetState.Failure.NoRoomYet(100_718, 230_778, null, why = ShareConcurrentBudget.Refusal.READING_STALE,
                at = ShareSheetState.NoRoomAt.StoppedPartway(8_388_608)),
            ShareSheetState.Failure.NoRoomYet(100_718, null, 89_000, at = ShareSheetState.NoRoomAt.ReachedLimit),
        ).forEach { add(ShareSheetState.Failed("a.bin", it)) }
        add(ShareSheetState.WaitingForMac("a.bin", 100_000, "Mac"))
        add(ShareSheetState.Sending("a.bin", 100_000, "Mac", allSent = false))
        add(ShareSheetState.Sending("a.bin", 100_000, "Mac", allSent = true))
        add(ShareSheetState.Saved("a.bin", "Mac", "a.bin"))
        add(ShareSheetState.Saved("a.bin", "Mac", "a (2).bin"))
        add(ShareSheetState.Unconfirmed("a.bin", "Mac"))
        ShareOffer.SAVE_FAILURE_REASONS.forEach { add(ShareSheetState.SendFailed("a.bin", "Mac", it)) }
        ShareSheetState.StopReason.values().forEach { add(ShareSheetState.Stopped("a.bin", "Mac", it)) }
    }

    /** Every sentence a user can be shown, for the test. */
    fun everySentence(): List<String> =
        everyState().flatMap { listOf(headline(it), detail(it)) } +
            listOf(Availability.NotConnected, Availability.NotSupported("Mac"), Availability.Available("Mac")).map(::availability) +
            ShareSheetState.NotOffered.values().map(::notOffered) +
            listOf(null, ShareSheetState.OtherOffer("s-x", "b.jpg", true), ShareSheetState.OtherOffer("s-x", "b.jpg", false)).map(::busy) +
            listOf(WITHDRAW_OTHER_BUTTON, withdrewOther("b.jpg")) +
            listOf(leavingOffered("Mac"), TITLE, LEAVING, CANCELLED, DISCARDED, WITHDRAWN, SEND_BUTTON, CANCEL_BUTTON, CLOSE_BUTTON, TRY_AGAIN_BUTTON)
}
