package com.chetan.connectsuite.sync.v2

/**
 * What the selection route decides, extracted so a JVM test can reach it.
 *
 * ### Why this is not a private `when` inside `ClipFeature`
 *
 * It was, for about an hour. `ClipFeature` holds a `ClipboardManager` and a `LinkServer` and needs a
 * `Context`, so a unit test cannot construct one — which would have left the *ordering of these
 * guards* in exactly the place defect 67 lives: a decision that is correct in the author's head,
 * untestable, and wrong the day somebody reorders two lines.
 *
 * The ordering is the part with content, and each position is a claim:
 *
 * | # | Guard | Why it is here and not lower |
 * |---|---|---|
 * | 1 | empty | the cheapest, and an empty selection is not a link problem |
 * | 2 | no link | **before** size and echo: with no Mac connected, "too long" and "same as your Mac" are both answers to a question nobody asked, and the second is a claim about a Mac that is not there |
 * | 3 | too large | before the echo check, because the echo comparison on a 5 MB string is work we would then throw away |
 * | 4 | echo | last, because it is the only one that needs the link's own history |
 *
 * The `NoLink` position is the one that would silently rot. Moving it below `echo` would make a
 * disconnected phone answer *"that already came from your Mac"* — a confident sentence about a
 * machine that is not on the other end, and the exact shape of the false-attribution failures this
 * project keeps recording.
 */
object SelectionSend {

    /** What the route did. Never a bare boolean — every branch gets said out loud to the user. */
    sealed interface Outcome {
        data class Sent(val bytes: Int) : Outcome
        data object NoLink : Outcome
        data object Empty : Outcome
        data object TooLarge : Outcome
        data object SameAsMac : Outcome
    }

    /**
     * The decision, with nothing Android in it.
     *
     * [echo] is passed as a function rather than a value so it is only *called* when the earlier
     * guards have passed — which is the ordering claim above, expressed in a way that a test can
     * catch rather than only assert. A test that passes a throwing `echo` proves guard 2 runs first.
     */
    fun decide(
        text: String,
        hasLiveSession: Boolean,
        tooLarge: (String) -> Boolean,
        echo: (String) -> ClipEcho.Decision,
    ): Outcome {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return Outcome.Empty
        if (!hasLiveSession) return Outcome.NoLink
        if (tooLarge(trimmed)) return Outcome.TooLarge
        return when (echo(trimmed)) {
            ClipEcho.Decision.Echo -> Outcome.SameAsMac
            // Unreachable for a USER trigger and stated rather than folded into the send branch:
            // collapsing it would hide the day somebody changes `maySend`.
            ClipEcho.Decision.Unchanged -> Outcome.SameAsMac
            ClipEcho.Decision.Send -> Outcome.Sent(ClipboardPayloads.byteLength(trimmed))
        }
    }

    /**
     * Every way one start of `SendSelectionActivity` ends, for the counters on the log line. Two more
     * than [Outcome], because an intent can fail before there is any text to decide about — and a
     * start that carried no text is a different fact from a selection that was blank.
     */
    enum class Counted { SENT, NO_LINK, EMPTY, TOO_LARGE, SAME_AS_MAC, NO_TEXT_EXTRA, UNSUPPORTED_ACTION }

    fun counted(outcome: Outcome): Counted = when (outcome) {
        is Outcome.Sent -> Counted.SENT
        Outcome.NoLink -> Counted.NO_LINK
        Outcome.Empty -> Counted.EMPTY
        Outcome.TooLarge -> Counted.TOO_LARGE
        Outcome.SameAsMac -> Counted.SAME_AS_MAC
    }

    /**
     * One sentence per outcome, here rather than in the activity so the test runs the strings the
     * user sees rather than a second copy of them.
     *
     * Each says what happened and where the text went. `NoLink` is the one that must not read as a
     * fault: a phone in a pocket away from its Mac is the *ordinary* case, not a broken one.
     */
    fun message(outcome: Outcome): String = when (outcome) {
        // S7: the Mac offers a selection rather than applying it, so the toast says where the step is.
        is Outcome.Sent -> "Sent to your Mac — choose Copy there"
        Outcome.NoLink -> "Your Mac isn’t connected — nothing was sent"
        Outcome.Empty -> "Nothing was selected"
        Outcome.TooLarge -> "That selection is too long to send"
        Outcome.SameAsMac -> "That already came from your Mac"
    }
}
