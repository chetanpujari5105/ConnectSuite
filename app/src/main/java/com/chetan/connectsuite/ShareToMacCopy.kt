package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import com.chetan.connectsuite.sync.v2.ShareIntake.Refusal
import java.util.Locale

/**
 * The state of the "Send to Mac" sheet, with nothing Android in it, so a JVM test can enumerate
 * every state and read the sentence each one shows.
 *
 * **Slice 1 has no offer.** `Ready` means *privately staged on this phone* and nothing more: not
 * sent, not saved, not on the Mac. There is no state in this slice that could mean any of those.
 */
sealed interface ShareSheetState {
    data object Starting : ShareSheetState
    data class Refused(val reason: Refusal) : ShareSheetState
    data class Preparing(val name: String, val copied: Long, val expected: Long?) : ShareSheetState
    data class Ready(val name: String, val mime: String, val bytes: Long, val availability: Availability) : ShareSheetState
    data class Failed(val name: String, val failure: Failure) : ShareSheetState

    sealed interface Failure {
        data class NoSpace(val needed: Long, val free: Long) : Failure
        data class OverLimit(val limit: Long) : Failure
        data object ReadFailed : Failure
        data object WriteFailed : Failure
        /** The grant did not survive the activity being recreated (a rotation). The copy is cancelled. */
        data object AccessLostOnRecreate : Failure
        data object StagingUnavailable : Failure
    }
}

/** Every sentence the sheet can show. The sentences live here so the test reads what the user reads. */
object ShareToMacCopy {

    const val TITLE = "Send to Mac"
    const val LEAVING = "Leaving this screen discards the prepared copy."
    const val CANCELLED = "Cancelled. Nothing was sent, and the prepared copy was deleted."
    const val DISCARDED = "Closed. Nothing was sent, and the prepared copy was deleted."
    const val SEND_BUTTON = "Send"
    const val CANCEL_BUTTON = "Cancel"
    const val CLOSE_BUTTON = "Close"

    fun headline(state: ShareSheetState): String = when (state) {
        ShareSheetState.Starting -> "Opening the file…"
        is ShareSheetState.Refused -> "Sidekick can’t use this share"
        is ShareSheetState.Preparing -> "Preparing…"
        is ShareSheetState.Ready -> "Ready on this phone"
        is ShareSheetState.Failed -> "Couldn’t prepare this file"
    }

    fun detail(state: ShareSheetState): String = when (state) {
        ShareSheetState.Starting -> ""
        is ShareSheetState.Refused -> refusal(state.reason)
        is ShareSheetState.Preparing ->
            "Copying it privately on this phone: ${bytes(state.copied)}" + (state.expected?.let { " of ${bytes(it)}" } ?: "") + "."
        is ShareSheetState.Ready ->
            "Prepared privately on this phone (${bytes(state.bytes)}). It has not been sent, and nothing is on your Mac."
        is ShareSheetState.Failed -> failure(state.failure)
    }

    /** Only for [ShareSheetState.Ready]: why Send is not available. Slice 1 always has a reason. */
    fun availability(a: Availability): String = when (a) {
        Availability.NotConnected ->
            "Your Mac isn’t connected, and sending files to a Mac isn’t available in this version of Sidekick yet."
        is Availability.NotSupported ->
            "Sending files to ${a.macName} isn’t available in this version of Sidekick yet."
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

    /** Every sentence a user can be shown, for the test. Parameterised ones with representative values. */
    fun everySentence(): List<String> {
        val states = buildList<ShareSheetState> {
            add(ShareSheetState.Starting)
            Refusal.values().forEach { add(ShareSheetState.Refused(it)) }
            add(ShareSheetState.Preparing("a.bin", 4096, 100_000))
            add(ShareSheetState.Preparing("a.bin", 4096, null))
            add(ShareSheetState.Ready("a.bin", "application/octet-stream", 100_000, Availability.NotConnected))
            add(ShareSheetState.Ready("a.bin", "application/octet-stream", 0, Availability.NotSupported("Mac")))
            listOf(
                ShareSheetState.Failure.NoSpace(1, 0), ShareSheetState.Failure.OverLimit(1),
                ShareSheetState.Failure.ReadFailed, ShareSheetState.Failure.WriteFailed,
                ShareSheetState.Failure.AccessLostOnRecreate, ShareSheetState.Failure.StagingUnavailable,
            ).forEach { add(ShareSheetState.Failed("a.bin", it)) }
        }
        return states.flatMap { listOf(headline(it), detail(it)) } +
            listOf(availability(Availability.NotConnected), availability(Availability.NotSupported("Mac"))) +
            listOf(TITLE, LEAVING, CANCELLED, DISCARDED, SEND_BUTTON, CANCEL_BUTTON, CLOSE_BUTTON)
    }
}
