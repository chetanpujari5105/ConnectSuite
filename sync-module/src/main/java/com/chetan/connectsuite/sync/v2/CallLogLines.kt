package com.chetan.connectsuite.sync.v2

/**
 * The sentences `CallWatcher` writes to `LinkLog` about a call episode — the one home of them.
 *
 * `docs/protocol.md` → Calls → *What a Mac may keep about a call* ends: **the phone's own logs carry
 * no numbers.** `LinkLog` writes to a rotating file, and until this object existed two lines broke
 * that rule on every call: the episode's first line named the caller as `from +15551234567 (Ada
 * Lovelace)`, and the late-number correction as `number +15551234567 (Ada Lovelace)`.
 *
 * **The rule is enforced by the signatures, not by care.** No function here takes a number or a
 * name — only whether there was one. A line built here cannot leak a caller because it is never
 * given one, and a later edit that wants to print the number has to change a signature to do it,
 * which is a visible act rather than one interpolation among many. The wire is untouched: the
 * `call.incoming` and `call.ended` payloads still carry the number and the contact name, because a
 * live card is display, not storage.
 *
 * Here and not inline for the same reason as [CallAckWording]: `CallWatcher` needs a `Context` and a
 * `LinkServer`, so a JVM test can reach these sentences only if they live somewhere pure.
 *
 * ### Consequence for one tool
 *
 * `scripts/step70-gate.mjs --require-correction` read the full number out of the correction line to
 * decide whether a ring was the expected caller. With the number gone it **fails closed** — refuses
 * — which its own fixture `format moved — fails CLOSED, not open` requires. Step 70 passed and Phase
 * 4 is closed; a future gate keys on `callId` and timing, not on a number in a log.
 */
internal object CallLogLines {

    /** The first line of an episode: what began, and whether the platform gave it a number. */
    fun began(
        callId: String,
        phase: String,
        hasNumber: Boolean,
        hasContactName: Boolean,
        episodesWithNumber: Long,
        episodes: Long,
    ): String {
        val who = when {
            hasContactName -> "number present, contact name found"
            hasNumber -> "number present, no contact name"
            else -> "number withheld by the platform"
        }
        return "Call $callId $phase: $who — $episodesWithNumber of $episodes episodes with a number " +
            "since start"
    }

    /**
     * Defect 45, option 4: the inbound number arrived after the card went out, and the card was
     * re-sent. The phrase `card corrected in place` is what `scripts/step70-watch.mjs` waits for and
     * is kept verbatim; only the caller is gone from it.
     */
    fun cardCorrected(
        callId: String,
        phase: String,
        hasContactName: Boolean,
        arrivedAfterMs: Long,
        episodesCorrected: Long,
        episodes: Long,
    ): String =
        "Call $callId card corrected in place: number arrived ${arrivedAfterMs}ms into the $phase, " +
            (if (hasContactName) "contact name found" else "no contact name") +
            " — $episodesCorrected of $episodes episodes corrected since start"

    /** The last line of an episode. */
    fun ended(callId: String, disposition: String, durationMs: Long): String =
        "Call $callId ended $disposition after ${durationMs}ms"
}
