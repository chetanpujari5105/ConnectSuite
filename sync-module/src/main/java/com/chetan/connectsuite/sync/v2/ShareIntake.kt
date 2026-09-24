package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.Extensions

/**
 * Whether a share intent can be taken, and whether the Mac could receive it — slice 1 of
 * `docs/phase-7-share-plan.md`. Pure: the activity reads the intent and passes plain values, so a
 * JVM test reaches every refusal.
 *
 * ### What is taken
 *
 * `ACTION_SEND` with exactly one stream, whose scheme is `content`, whose type is not a folder. The
 * stream comes from `EXTRA_STREAM`, or from the only `ClipData` item when a sender attaches the grant
 * there instead. Everything else is refused **before anything is read**, each with its own reason.
 *
 * ### Why a `file://` stream is refused
 *
 * A `file://` URI carries no grant: reading it would mean reading a path with this app's own
 * permissions, which is not what the person shared. Since Android 7 a well-behaved sender never
 * shares one.
 */
object ShareIntake {

    const val ACTION_SEND = "android.intent.action.SEND"

    sealed interface Decision {
        data object Take : Decision
        data class Refuse(val reason: Refusal) : Decision
    }

    enum class Refusal { NOT_A_SEND, MORE_THAN_ONE, NO_FILE, NOT_CONTENT, FOLDER, ANOTHER_IN_PROGRESS }

    /**
     * @param streamScheme the scheme of the stream, from `EXTRA_STREAM` or the single `ClipData` item.
     * @param clipItems `ClipData.itemCount`, or 0 when there is no `ClipData`.
     * @param otherAttemptLive a staging attempt in this process is still live (v1 is one at a time).
     */
    fun decide(action: String?, streamScheme: String?, clipItems: Int, mime: String, otherAttemptLive: Boolean): Decision =
        when {
            action != ACTION_SEND -> Decision.Refuse(Refusal.NOT_A_SEND)
            clipItems > 1 -> Decision.Refuse(Refusal.MORE_THAN_ONE)
            streamScheme == null -> Decision.Refuse(Refusal.NO_FILE)
            !streamScheme.equals("content", ignoreCase = true) -> Decision.Refuse(Refusal.NOT_CONTENT)
            ShareNames.isDirectory(mime) -> Decision.Refuse(Refusal.FOLDER)
            otherAttemptLive -> Decision.Refuse(Refusal.ANOTHER_IN_PROGRESS)
            else -> Decision.Take
        }

    /**
     * Whether the prepared file can be sent now — docs/protocol.md → Extensions → the `share.ask`
     * extension. [Availability.Available] only when a Mac is connected **and** its session negotiated
     * `share.file` ≥ 2 with `share.ask` ([Extensions.ordinarySend]): a Mac that promised to hold the
     * offer for a person's Accept. **No Mac build makes that promise yet**, so in every live pairing
     * this returns [Availability.NotConnected] or [Availability.NotSupported] and Send stays disabled.
     *
     * The synthetic-only development Mac (`share.file` 2 without `share.ask`) is deliberately
     * [Availability.NotSupported]: it would decline an ordinary file `not-available` at once.
     */
    sealed interface Availability {
        data object NotConnected : Availability
        data class NotSupported(val macName: String) : Availability
        data class Available(val macName: String) : Availability
    }

    /** @param negotiated the live session's negotiated extensions; ignored when no Mac is connected. */
    fun availability(connectedMacName: String?, negotiated: Map<String, Int>? = null): Availability = when {
        connectedMacName.isNullOrBlank() -> Availability.NotConnected
        Extensions.ordinarySend(negotiated) -> Availability.Available(connectedMacName)
        else -> Availability.NotSupported(connectedMacName)
    }
}
