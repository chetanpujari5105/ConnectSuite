package com.chetan.connectsuite.sync.v2

/**
 * One share offer's life on the phone — docs/protocol.md → Share, and slice 2 of
 * `docs/phase-7-share-plan.md`. Pure: every transition is a function a JVM test calls, and every
 * transition out of `Offered` carries [Effect.DeleteStaged], so "no staged data outlives an offer" is
 * a property of the transitions rather than of whoever remembers to clean up (the defect-67 rule).
 *
 * **This revision has no accept and no transfer.** The only ends are declined, expired, cancelled
 * (by either side) and the session ending. `accept` is refused with `BAD_REQUEST` and the offer stays
 * live, because an ack of `accepted` with no pull behind it would be a promise nothing keeps.
 *
 * Expired is its own end, never a kind of declined: an offer nobody answered was not refused by
 * anybody (owner decision G6).
 */
object ShareOffer {

    const val TTL_MS = 10L * 60 * 1000

    /** Declines a Mac of this revision may send, and the three reserved for a person's decision. */
    val DECLINE_REASONS = setOf(
        "not-available", "not-negotiated", "malformed-offer", "busy",
        "user", "folder-unavailable", "insufficient-space",
    )
    val PHONE_CANCEL_REASONS = setOf("user", "expired", "staging-lost")
    val MAC_CANCEL_REASONS = setOf("user")

    data class Offer(
        val offerId: String,
        /** The session token it was offered on. Answers from any other session are `NOT_FOUND`. */
        val sessionKey: String,
        val bytes: Long,
        val sha256: String,
        val offeredAtMs: Long,
        val expiresAtMs: Long,
        val state: State = State.Offered,
    )

    sealed interface State {
        data object Offered : State
        data class Declined(val reason: String) : State
        data object Expired : State
        data class Cancelled(val by: Side, val reason: String) : State
        data object SessionEnded : State
    }

    enum class Side { PHONE, MAC }

    sealed interface Effect {
        data object DeleteStaged : Effect
        /** `share.cancel` event, phone → Mac. */
        data class SendCancel(val reason: String) : Effect
    }

    /** What a request handler sends back. */
    sealed interface Reply {
        data class Ack(val fields: Map<String, Any>) : Reply
        data class Error(val code: String, val message: String) : Reply
    }

    data class Result(val offer: Offer?, val reply: Reply?, val effects: List<Effect>)

    private const val BAD_REQUEST = "BAD_REQUEST"
    private const val NOT_FOUND = "NOT_FOUND"
    private val NOT_FOUND_MESSAGE = "No live offer with that id on this session"

    private fun ended(offer: Offer, state: State, vararg extra: Effect) =
        offer.copy(state = state) to (listOf(*extra) + Effect.DeleteStaged)

    /**
     * `share.respond`. Field checks first ([BAD_REQUEST] is a Mac fault whatever the offer), then the
     * lookup ([NOT_FOUND] for missing, another session's, or already ended — indistinguishable on
     * purpose), then the decision.
     */
    fun respond(offer: Offer?, fromSession: String, offerId: String?, decision: String?, reason: String?, nowMs: Long): Result {
        if (offerId == null || !ShareStaging.isAttemptId(offerId)) return Result(offer, Reply.Error(BAD_REQUEST, "offerId is missing or malformed"), emptyList())
        when (decision) {
            "decline" -> if (reason == null || reason !in DECLINE_REASONS) {
                return Result(offer, Reply.Error(BAD_REQUEST, "decline needs a known reason"), emptyList())
            }
            "accept" -> Unit
            else -> return Result(offer, Reply.Error(BAD_REQUEST, "decision must be decline or accept"), emptyList())
        }
        val live = liveFor(offer, fromSession, offerId) ?: return Result(offer, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), emptyList())
        if (nowMs >= live.expiresAtMs) return expireInstead(live)
        if (decision == "accept") {
            return Result(live, Reply.Error(BAD_REQUEST, "This phone cannot send files yet"), emptyList())
        }
        val (next, effects) = ended(live, State.Declined(reason!!))
        return Result(next, Reply.Ack(mapOf("offerId" to offerId, "state" to "declined")), effects)
    }

    /** `share.cancel` as a request from the Mac. */
    fun cancelFromMac(offer: Offer?, fromSession: String, offerId: String?, reason: String?, nowMs: Long): Result {
        if (offerId == null || !ShareStaging.isAttemptId(offerId)) return Result(offer, Reply.Error(BAD_REQUEST, "offerId is missing or malformed"), emptyList())
        if (reason == null || reason !in MAC_CANCEL_REASONS) return Result(offer, Reply.Error(BAD_REQUEST, "reason must be user"), emptyList())
        val live = liveFor(offer, fromSession, offerId) ?: return Result(offer, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), emptyList())
        if (nowMs >= live.expiresAtMs) return expireInstead(live)
        val (next, effects) = ended(live, State.Cancelled(Side.MAC, reason))
        return Result(next, Reply.Ack(mapOf("offerId" to offerId, "stopped" to true)), effects)
    }

    /** The phone ends its own offer: `user` or `staging-lost`. The Mac is told. */
    fun cancelFromPhone(offer: Offer, reason: String): Result {
        require(reason in PHONE_CANCEL_REASONS && reason != "expired") { "expiry has its own transition" }
        if (offer.state != State.Offered) return Result(offer, null, emptyList())
        val (next, effects) = ended(offer, State.Cancelled(Side.PHONE, reason), Effect.SendCancel(reason))
        return Result(next, null, effects)
    }

    /** The expiry timer. Early or late ticks are harmless: only a live offer past its time expires. */
    fun expire(offer: Offer, nowMs: Long): Result {
        if (offer.state != State.Offered || nowMs < offer.expiresAtMs) return Result(offer, null, emptyList())
        return expireInstead(offer)
    }

    /** The session it was offered on is gone. No message: there is nobody to send it to. */
    fun sessionEnded(offer: Offer, sessionKey: String): Result {
        if (offer.state != State.Offered || offer.sessionKey != sessionKey) return Result(offer, null, emptyList())
        val (next, effects) = ended(offer, State.SessionEnded)
        return Result(next, null, effects)
    }

    private fun liveFor(offer: Offer?, fromSession: String, offerId: String): Offer? =
        offer?.takeIf { it.offerId == offerId && it.sessionKey == fromSession && it.state == State.Offered }

    private fun expireInstead(live: Offer): Result {
        val (next, effects) = ended(live, State.Expired, Effect.SendCancel("expired"))
        return Result(next, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), effects)
    }
}
