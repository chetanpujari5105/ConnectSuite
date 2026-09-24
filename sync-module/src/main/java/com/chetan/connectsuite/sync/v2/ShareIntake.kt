package com.chetan.connectsuite.sync.v2

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
     * Whether the file could be sent now. **Slice 1 has no offer and no `share.file` negotiation**, so
     * no Mac can advertise support and there is deliberately no `Available` member. Slice 2 adds the
     * negotiated flag as a parameter and `Available` together; adding either alone would be a Send
     * button with nothing behind it.
     */
    sealed interface Availability {
        data object NotConnected : Availability
        data class NotSupported(val macName: String) : Availability
    }

    fun availability(connectedMacName: String?): Availability =
        if (connectedMacName.isNullOrBlank()) Availability.NotConnected else Availability.NotSupported(connectedMacName)
}
