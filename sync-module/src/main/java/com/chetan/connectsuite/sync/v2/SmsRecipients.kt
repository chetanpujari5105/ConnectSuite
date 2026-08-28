package com.chetan.connectsuite.sync.v2

/**
 * Decides whether an `sms.send`'s recipients are the ones its thread actually belongs to.
 *
 * This is the whole of "The send rule" from docs/protocol.md, and it is a separate, pure object so
 * that it can be tested exhaustively without a phone, a provider or a radio. Everything it knows is
 * two lists of strings.
 *
 * ### Why the rule exists at all
 *
 * Phase 4 is the first phase where a bug loses something rather than annoying someone. Every
 * failure before it is recoverable by clicking again — a tap in the wrong place can be undone, a
 * black mirror comes back. **A message delivered to the wrong person cannot be taken back.** It is
 * visible to somebody who was never meant to see it, and the user finds out from them.
 *
 * So a send carries two independent facts — the thread and the recipients — and the phone, which
 * is the side holding the truth, checks that they agree. A Mac that has drifted (a stale thread
 * list, a pane switched between composing and sending, an off-by-one into a list) produces a pair
 * that disagrees, and this is what stops it.
 *
 * ### Why the comparison leans towards refusing
 *
 * A false *mismatch* costs the user a retry. A false *match* sends a private message to a stranger.
 * Those are not comparable, so every judgement below is made in the direction of refusing:
 *
 * - An unverifiable thread — one whose recipients cannot be read — is refused rather than trusted.
 *   "We could not check" must never resolve to "send it anyway".
 * - Suffix matching requires the **whole** shorter number to be a suffix of the longer one, not a
 *   fixed seven digits of it. Android's own `PhoneNumberUtils.compare` defaults to comparing the
 *   last seven, which makes `+1-555-123-4567` and `+1-999-123-4567` the same number. That is a
 *   sensible default for deciding whose photo to show beside a message, and an unacceptable one
 *   for deciding who receives it.
 * - The two sets must match **exactly**, not overlap. Sending to a subset of a group thread is not
 *   obviously wrong, but it is not obviously right either, and this is not the place to guess.
 */
object SmsRecipients {

    /**
     * Shortest number that may be matched as a suffix rather than in full.
     *
     * Below this, only exact equality counts. Short codes — the five- and six-digit numbers banks
     * and two-factor services send from — are all suffixes of each other in a way real numbers are
     * not, so allowing suffix matching there would make several unrelated senders one recipient.
     */
    const val MIN_SUFFIX_DIGITS = 7

    /** Why a send was refused. Null is the only outcome that allows a message onto the radio. */
    sealed class Verdict {
        /** The pair agrees. */
        object Agreed : Verdict()

        /**
         * The thread's real recipients could not be read, so nothing could be checked.
         *
         * Deliberately not the same as [Mismatch]: the Mac may be perfectly correct and the
         * provider simply has no rows for this thread — an MMS-only conversation, or one deleted
         * between the list and the send. It is still a refusal, because unverifiable is not
         * verified.
         */
        object Unverifiable : Verdict()

        /** [requested] and [threadHas] name different people. Nothing was sent to anyone. */
        data class Mismatch(
            val requested: List<String>,
            val threadHas: List<String>,
        ) : Verdict() {
            /** For the sentence the user reads. Numbers, not normalised keys — they have to recognise them. */
            fun describe(): String {
                val extra = requested.filterNot { r -> threadHas.any { same(r, it) } }
                val missing = threadHas.filterNot { t -> requested.any { same(t, it) } }
                return when {
                    extra.isNotEmpty() && missing.isNotEmpty() ->
                        "it named ${extra.joinToString(", ")} but that conversation is with " +
                            missing.joinToString(", ")
                    extra.isNotEmpty() ->
                        "${extra.joinToString(", ")} is not in that conversation"
                    else ->
                        "it left out ${missing.joinToString(", ")}, who is in that conversation"
                }
            }
        }
    }

    /**
     * Compares what the Mac asked to send to against what the thread really is.
     *
     * @param requested the `addresses` from `sms.send`.
     * @param threadHas every distinct address the provider holds for that thread.
     */
    fun verify(requested: List<String>, threadHas: List<String>): Verdict {
        val asked = requested.filter { digits(it).isNotEmpty() }
        if (asked.isEmpty()) return Verdict.Mismatch(requested, threadHas)
        if (threadHas.none { digits(it).isNotEmpty() }) return Verdict.Unverifiable

        val everyAskedIsInThread = asked.all { one -> threadHas.any { same(one, it) } }
        val everyThreadMemberWasAsked = threadHas.all { one -> asked.any { same(one, it) } }
        return if (everyAskedIsInThread && everyThreadMemberWasAsked) {
            Verdict.Agreed
        } else {
            Verdict.Mismatch(requested, threadHas)
        }
    }

    /**
     * Whether two written forms are the same phone number.
     *
     * Exact digits, or the whole of the shorter as a suffix of the longer once both are at least
     * [MIN_SUFFIX_DIGITS] long. `+1 555-123-4567` and `5551234567` are one number;
     * `5551234567` and `9991234567` are two.
     */
    fun same(a: String, b: String): Boolean {
        val left = digits(a)
        val right = digits(b)
        if (left.isEmpty() || right.isEmpty()) return false
        if (left == right) return true

        val shorter = if (left.length <= right.length) left else right
        val longer = if (left.length <= right.length) right else left
        if (shorter.length < MIN_SUFFIX_DIGITS) return false
        return longer.endsWith(shorter)
    }

    /** Everything that is not a digit, removed. `+`, spaces, dashes, brackets and dots all go. */
    fun digits(number: String): String = number.filter(Char::isDigit)
}
