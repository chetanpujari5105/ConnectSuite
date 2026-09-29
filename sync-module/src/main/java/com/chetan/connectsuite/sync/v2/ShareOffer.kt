package com.chetan.connectsuite.sync.v2

/**
 * One share offer's life on the phone — docs/protocol.md → Share. Pure: every transition is a
 * function a JVM test calls, and **every transition into an end carries [Effect.DeleteStaged]**, so
 * "no staged data outlives an offer" is a property of the transitions rather than of whoever
 * remembers to clean up (the defect-67 rule).
 *
 * ### Two versions, one state machine
 *
 * **Version 1** (negotiated `share.file` 1): offered → declined | expired | cancelled | session ended.
 * `accept` is refused with `BAD_REQUEST` and the offer stays live.
 *
 * **Version 2** (negotiated 2 — both peers must advertise it): offered → accepted → sending →
 * awaiting verdict → **saved**, or → failed (Retry window) → sending again from byte 0 … → expired.
 * The phone keeps advertising 1 until the Mac half exists (slice 3d), so in a live pairing every
 * version-2 path below is unreachable, and `ShareOfferTest` pins that.
 *
 * ### The one rule this file exists to hold
 *
 * **Only [saved] with `ok: true` from the Mac makes an offer [State.Saved].** The phone finishing its
 * send ([pullEnded]) moves it to [State.AwaitingVerdict], never further; a verdict that does not come
 * within [VERDICT_DEADLINE_MS] makes it `failed (unconfirmed)`. Expired is its own end and is never a
 * kind of declined (owner decision G6).
 */
object ShareOffer {

    const val TTL_MS = 10L * 60 * 1000

    /**
     * How long a waiting offer lives, from the session's negotiated `share.wait` (docs/protocol.md →
     * Extensions → `share.wait`, **PROPOSED**): the value is minutes, both sides advertise their limit,
     * and the agreed wait is the lower. **Absent — either side older — is exactly [TTL_MS]**, so no peer
     * is ever sent an offer it would refuse as too far ahead. Clamped to [WAIT_MIN_MINUTES],
     * [WAIT_MAX_MINUTES]: an offer never waits indefinitely, and a peer advertising 1 cannot shorten it
     * below today's. The accepted-queue lifetime is separate and unchanged ([QUEUE_LIFETIME_CANDIDATE_MS]).
     */
    const val WAIT_MIN_MINUTES = 10
    const val WAIT_MAX_MINUTES = 30
    fun ttlFor(negotiatedWaitMinutes: Int?): Long =
        (negotiatedWaitMinutes ?: WAIT_MIN_MINUTES).coerceIn(WAIT_MIN_MINUTES, WAIT_MAX_MINUTES) * 60_000L
    const val VERDICT_DEADLINE_MS = 60_000L
    const val RETRY_WINDOW_MS = 5L * 60 * 1000
    /** The negotiated `share.file` version at which a transfer exists. */
    const val TRANSFER_VERSION = 2
    /**
     * The negotiated `share.file` at which several offers may be live and an accepted one may wait its
     * turn (docs/protocol.md → Share → Version 3, PROPOSED). **Neither side advertises it**; below it
     * every rule here is exactly version 2.
     */
    const val QUEUE_VERSION = 3
    /** Live offers per trusted session at version 3 — the owner's figure (2026-09-25). */
    const val MAX_LIVE_OFFERS_V3 = 10
    /**
     * How long an accepted offer may wait for its pull at version 3, from the Accept — **a candidate,
     * not an approved value.** It replaces the 10-minute offer TTL for an accepted offer only; the phone
     * ends it with `share.cancel {expired}` and deletes the copy (the backstop).
     */
    const val QUEUE_LIFETIME_CANDIDATE_MS = 60L * 60 * 1000

    val DECLINE_REASONS = setOf(
        "not-available", "not-negotiated", "malformed-offer", "busy",
        "user", "folder-unavailable", "insufficient-space", "unsupported-destination",
    )
    val SAVE_FAILURE_REASONS = setOf(
        "checksum", "truncated", "interrupted", "insufficient-space", "write-failed", "unsupported-destination",
    )
    val PHONE_CANCEL_REASONS = setOf("user", "expired", "staging-lost")
    /**
     * The failure reason for a send the Mac never gave a verdict on. **Ambiguous by construction**:
     * the Mac may have saved the file and lost the acknowledgement, or may have saved nothing. It is
     * never reported as saved and never reported as a plain failure either.
     */
    const val UNCONFIRMED = "unconfirmed"
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
        val name: String = "",
        val mime: String = "application/octet-stream",
        /** The live or last pull's id (`ts-…`), while one exists. */
        val transferId: String? = null,
        val verdictDueMs: Long? = null,
        val retryUntilMs: Long? = null,
        /** Version 3: accepted and waiting for its pull — it ends at this moment if the pull has not begun. */
        val queueUntilMs: Long? = null,
    )

    sealed interface State {
        data object Offered : State
        data object Accepted : State
        data object Sending : State
        data object AwaitingVerdict : State
        data class Failed(val reason: String) : State
        data class Saved(val savedAs: String) : State
        data class Declined(val reason: String) : State
        data object Expired : State
        data class Cancelled(val by: Side, val reason: String) : State
        data object SessionEnded : State
    }

    enum class Side { PHONE, MAC }

    /** How the phone's own stream of a pull ended. None of these is a save. */
    enum class PullEnd { SENT, SOURCE_CHANGED, FAILED }

    fun isLive(state: State): Boolean = when (state) {
        State.Offered, State.Accepted, State.Sending, State.AwaitingVerdict, is State.Failed -> true
        else -> false
    }

    /**
     * **The answer-once rule for the phone's live offers**, moved verbatim from `ShareFeature.store`
     * (2026-09-28) so a JVM test reaches it: a live offer stays in [live]; an ended one leaves it. `Σ`
     * is [heldBytes] over what stays, so a copy leaves `Σ` the moment its offer ends, and only then.
     * Callers hold their own lock; this adds none.
     */
    fun storeLive(live: MutableMap<String, Offer>, o: Offer) {
        if (isLive(o.state)) live[o.offerId] = o else live.remove(o.offerId)
    }

    /** `Σ`: the bytes of every staged copy held for a live offer — `ShareFeature.stagingContext`'s sum, moved verbatim. */
    fun heldBytes(live: Collection<Offer>): Long = live.sumOf { it.bytes }

    /**
     * **In progress**, in the sense of the several-files stall clock (docs/feature-a-multi-offer-proposal.md
     * §12): accepted on the Mac — queued, receiving, or checking — each of which ends in bounded time by its
     * own rule. Not an offer nobody has answered, and not a failed pull waiting in its retry window.
     */
    /**
     * Accepted and **waiting its turn** behind another pull (version 3). Only a version-3 accept sets
     * [Offer.queueUntilMs] — version 2 never does — so a version-2 `Accepted`, the moment before its pull
     * begins, is never called queued.
     */
    fun isQueued(o: Offer): Boolean = o.state == State.Accepted && o.queueUntilMs != null

    fun inProgress(state: State): Boolean = when (state) {
        State.Accepted, State.Sending, State.AwaitingVerdict -> true
        else -> false
    }

    /**
     * **The one-live-offer rule** (docs/protocol.md → Share → `share.offer`: *at most one offer per
     * session is live*), as a pure function so the sheet's Busy path and its tests run the rule
     * `ShareFeature.offerStaged` runs. Returns the offer that blocks a new one on [sessionKey], or null.
     * Every entry in [held] is live by construction (`ShareFeature` drops an offer when it ends), and
     * [isLive] is checked anyway so a stale entry can never block.
     *
     * [maxLive] is how many live offers one session may hold. **The default, 1, is the version-2
     * contract and the only value any caller passes today.** Version 3 (docs/protocol.md → Share →
     * Version 3, PROPOSED, advertised by neither side) would raise it; its number is still a proposal,
     * so it is a parameter and no value is written here. At the limit, the **oldest** live offer is
     * returned as the one blocking.
     */
    fun busyWith(held: Collection<Offer>, sessionKey: String, maxLive: Int = 1): Offer? {
        require(maxLive >= 1) { "maxLive is at least 1, got $maxLive" }
        val live = held.filter { it.sessionKey == sessionKey && isLive(it.state) }
        return if (live.size >= maxLive) live.minByOrNull { it.offeredAtMs } else null
    }

    /** Whether a live offer is still waiting for the Mac's answer — the only time withdrawing it stops nothing mid-flight. */
    fun awaitingAnswer(state: State): Boolean = state == State.Offered

    sealed interface Effect {
        data object DeleteStaged : Effect
        /** `share.cancel` event, phone → Mac. */
        data class SendCancel(val reason: String) : Effect
        /** Register the bulk pull for this transfer id (the stream reads the staged copy only). */
        data class RegisterPull(val transferId: String) : Effect
        /** Stop the live bulk pull for this transfer id. */
        data class CancelPull(val transferId: String) : Effect
        data class ScheduleVerdictDeadline(val atMs: Long) : Effect
        data class ScheduleRetryClose(val atMs: Long) : Effect
        /** Version 3: end this accepted offer at [atMs] if its pull has not begun (the backstop). */
        data class ScheduleQueueEnd(val atMs: Long) : Effect
    }

    /** What a request handler sends back. `null` values are sent as JSON null. */
    sealed interface Reply {
        data class Ack(val fields: Map<String, Any?>) : Reply
        data class Error(val code: String, val message: String) : Reply
    }

    data class Result(val offer: Offer?, val reply: Reply?, val effects: List<Effect>)

    private const val BAD_REQUEST = "BAD_REQUEST"
    private const val NOT_FOUND = "NOT_FOUND"
    private const val NOT_FOUND_MESSAGE = "No live offer with that id on this session"
    /** The answer when the phone no longer holds the prepared copy — at Accept, or when a pull begins. */
    const val STAGING_LOST_MESSAGE = "The prepared copy is no longer on this phone"

    /** Into an end: whatever else it does, the staged copy goes, and a live pull is stopped first. */
    private fun ended(offer: Offer, state: State, vararg extra: Effect): Pair<Offer, List<Effect>> {
        val stop = if (offer.state == State.Sending && offer.transferId != null) listOf(Effect.CancelPull(offer.transferId)) else emptyList()
        return offer.copy(state = state) to (stop + listOf(*extra) + Effect.DeleteStaged)
    }

    private fun badId(offerId: String?) = offerId == null || !ShareStaging.isAttemptId(offerId)

    /**
     * The moment a still-waiting offer ends: its offer TTL while [State.Offered], or — at version 3,
     * once accepted — its queue bound instead. Version 2 never sets [Offer.queueUntilMs], so there an
     * accepted offer keeps the offer TTL exactly as before.
     */
    private fun waitsUntil(o: Offer): Long = if (o.state == State.Accepted && o.queueUntilMs != null) o.queueUntilMs else o.expiresAtMs

    /**
     * **One share pull at a time per session** (Version 3 rule 2): another offer on [sessionKey], not
     * [offerId], whose pull is live. At version 2 only one offer is ever live, so this is never set there.
     */
    fun pullInFlight(held: Collection<Offer>, sessionKey: String, offerId: String): Offer? =
        held.firstOrNull { it.sessionKey == sessionKey && it.offerId != offerId && it.state == State.Sending }

    private fun same(offer: Offer?, fromSession: String, offerId: String): Offer? =
        offer?.takeIf { it.offerId == offerId && it.sessionKey == fromSession && isLive(it.state) }

    // ---- share.respond ---------------------------------------------------------------------------

    /**
     * `share.respond`. Field checks first ([BAD_REQUEST] is a Mac fault whatever the offer), then the
     * lookup ([NOT_FOUND] for missing, another session's, or not awaiting an answer —
     * indistinguishable on purpose), then the decision. [negotiatedVersion] is the session's
     * `share.file`; below [TRANSFER_VERSION], `accept` is refused and the offer stays live.
     */
    fun respond(
        offer: Offer?, fromSession: String, offerId: String?, decision: String?, reason: String?,
        nowMs: Long, negotiatedVersion: Int = 1, queueLifetimeMs: Long = QUEUE_LIFETIME_CANDIDATE_MS,
        /** Whether the staged copy is still there at the offered length — the caller's file check. No default: every caller must say. */
        stagedIntact: Boolean,
    ): Result {
        if (badId(offerId)) return Result(offer, Reply.Error(BAD_REQUEST, "offerId is missing or malformed"), emptyList())
        when (decision) {
            "decline" -> if (reason == null || reason !in DECLINE_REASONS) {
                return Result(offer, Reply.Error(BAD_REQUEST, "decline needs a known reason"), emptyList())
            }
            "accept" -> Unit
            else -> return Result(offer, Reply.Error(BAD_REQUEST, "decision must be decline or accept"), emptyList())
        }
        val live = same(offer, fromSession, offerId!!)?.takeIf { it.state == State.Offered }
            ?: return Result(offer, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), emptyList())
        if (nowMs >= live.expiresAtMs) return expireInstead(live)
        if (decision == "accept") {
            if (negotiatedVersion < TRANSFER_VERSION) {
                return Result(live, Reply.Error(BAD_REQUEST, "This phone cannot send files yet"), emptyList())
            }
            // The staged copy is checked BEFORE `accepted` is acknowledged: an Accept for a file this
            // phone no longer holds ends the offer as `staging-lost` (the Mac is told) and is answered
            // like any offer already ended — `NOT_FOUND` — so nothing is ever pulled for it.
            if (!stagedIntact) {
                val (next, effects) = ended(live, State.Cancelled(Side.PHONE, "staging-lost"), Effect.SendCancel("staging-lost"))
                return Result(next, Reply.Error(NOT_FOUND, STAGING_LOST_MESSAGE), effects)
            }
            val ack = Reply.Ack(mapOf("offerId" to offerId, "state" to "accepted"))
            if (negotiatedVersion >= QUEUE_VERSION) {
                // It may wait behind other transfers: bounded from the Accept, not by the offer's TTL.
                val until = nowMs + queueLifetimeMs
                return Result(live.copy(state = State.Accepted, queueUntilMs = until), ack, listOf(Effect.ScheduleQueueEnd(until)))
            }
            return Result(live.copy(state = State.Accepted), ack, emptyList())
        }
        val (next, effects) = ended(live, State.Declined(reason!!))
        return Result(next, Reply.Ack(mapOf("offerId" to offerId, "state" to "declined")), effects)
    }

    // ---- the pull --------------------------------------------------------------------------------

    /**
     * `fs.transfer.begin` on `share:<offerId>`, already routed here by [ShareRoot]. Allowed only for
     * item `"0"`, on the offer's own session, while it is [State.Accepted] and unexpired, or
     * [State.Failed] with its Retry window open — and never while another pull of it is live. Every
     * refusal is `NOT_FOUND`. The ack always says offset 0: there is no resume.
     */
    fun beginPull(offer: Offer?, fromSession: String, offerId: String, itemId: String?, transferId: String, nowMs: Long, chunkMax: Int): Result {
        val live = same(offer, fromSession, offerId) ?: return Result(offer, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), emptyList())
        if (itemId != "0") return Result(live, Reply.Error(NOT_FOUND, "A share root holds item \"0\" only"), emptyList())
        when (live.state) {
            State.Accepted -> if (nowMs >= waitsUntil(live)) return expireInstead(live)
            is State.Failed -> if (nowMs >= (live.retryUntilMs ?: 0L)) return expireInstead(live)
            else -> return Result(live, Reply.Error(NOT_FOUND, "That offer is not waiting for a pull"), emptyList())
        }
        require(ShareRoot.isShareTransfer(transferId)) { "a share pull needs a share transfer id" }
        val next = live.copy(state = State.Sending, transferId = transferId, verdictDueMs = null)
        val ack = mapOf(
            "transferId" to transferId, "direction" to "pull", "size" to live.bytes, "name" to live.name,
            "mime" to live.mime, "sha256" to live.sha256, "offset" to 0L, "chunkMax" to chunkMax, "mtimeMs" to null,
        )
        return Result(next, Reply.Ack(ack), listOf(Effect.RegisterPull(transferId)))
    }

    /**
     * The phone's own stream of [transferId] ended. **Not a save**: a clean send waits for the Mac's
     * verdict; a failed stream waits too (the Mac reports it); only a source that changed under the
     * read ends the offer, as `staging-lost`.
     */
    fun pullEnded(offer: Offer, transferId: String, end: PullEnd, nowMs: Long): Result {
        if (offer.state != State.Sending || offer.transferId != transferId) return Result(offer, null, emptyList())
        if (end == PullEnd.SOURCE_CHANGED) {
            val (next, effects) = ended(offer.copy(state = State.AwaitingVerdict), State.Cancelled(Side.PHONE, "staging-lost"), Effect.SendCancel("staging-lost"))
            return Result(next, null, effects)
        }
        val due = nowMs + VERDICT_DEADLINE_MS
        return Result(offer.copy(state = State.AwaitingVerdict, verdictDueMs = due), null, listOf(Effect.ScheduleVerdictDeadline(due)))
    }

    /** `fs.transfer.cancel` for a share transfer: only its own session may stop it. */
    fun cancelPull(offer: Offer?, fromSession: String, transferId: String): Result {
        val live = offer?.takeIf { it.transferId == transferId && it.sessionKey == fromSession && isLive(it.state) }
            ?: return Result(offer, Reply.Error(NOT_FOUND, "No live share transfer with that id on this session"), emptyList())
        val (next, effects) = ended(live, State.Cancelled(Side.MAC, "user"))
        return Result(next, Reply.Ack(mapOf("transferId" to transferId, "stopped" to true)), effects)
    }

    // ---- share.saved -----------------------------------------------------------------------------

    /**
     * The Mac's verdict — **the only way to [State.Saved]**. Accepted from the offer's own session
     * while a pull is sending or awaiting its verdict; anything else (another session, a second
     * verdict for the same attempt, a verdict before any pull) is `NOT_FOUND`. An `ok: true` whose
     * byte count differs from the offer, or which is not `verified`, is a Mac fault (`BAD_REQUEST`)
     * and changes nothing: the verdict deadline still stands.
     */
    fun saved(
        offer: Offer?, fromSession: String, offerId: String?, ok: Boolean?, bytes: Long?, verified: Boolean?,
        savedAs: String?, reason: String?, nowMs: Long,
    ): Result {
        if (badId(offerId)) return Result(offer, Reply.Error(BAD_REQUEST, "offerId is missing or malformed"), emptyList())
        if (ok == null) return Result(offer, Reply.Error(BAD_REQUEST, "ok is required"), emptyList())
        if (ok) {
            if (savedAs.isNullOrBlank() || savedAs.contains('/')) return Result(offer, Reply.Error(BAD_REQUEST, "savedAs must be a file name"), emptyList())
        } else if (reason == null || reason !in SAVE_FAILURE_REASONS) {
            return Result(offer, Reply.Error(BAD_REQUEST, "a failed save needs a known reason"), emptyList())
        }
        val live = same(offer, fromSession, offerId!!)?.takeIf { it.state == State.Sending || it.state == State.AwaitingVerdict }
            ?: return Result(offer, Reply.Error(NOT_FOUND, "No share transfer awaiting a verdict with that id on this session"), emptyList())
        if (ok) {
            if (bytes != live.bytes || verified != true) {
                return Result(live, Reply.Error(BAD_REQUEST, "A save must be verified and of the offered size"), emptyList())
            }
            // No CancelPull: the phone's stream of these bytes has finished or is finishing, and the
            // receiver already has all of them. The end below still deletes the staged copy.
            val next = live.copy(state = State.Saved(savedAs!!))
            return Result(next, Reply.Ack(mapOf("offerId" to offerId, "state" to "saved")), listOf(Effect.DeleteStaged))
        }
        return failInto(live, reason!!, nowMs, Reply.Ack(mapOf("offerId" to offerId, "state" to "failed")))
    }

    /** No verdict came in time: `failed (unconfirmed)`, never saved. */
    fun verdictDeadline(offer: Offer, nowMs: Long): Result {
        val due = offer.verdictDueMs
        if (offer.state != State.AwaitingVerdict || due == null || nowMs < due) return Result(offer, null, emptyList())
        return failInto(offer, UNCONFIRMED, nowMs, null)
    }

    /** The Retry window closed with no successful attempt: the offer expires and the copy goes. */
    fun retryWindowClosed(offer: Offer, nowMs: Long): Result {
        val until = offer.retryUntilMs
        if (offer.state !is State.Failed || until == null || nowMs < until) return Result(offer, null, emptyList())
        return expireInstead(offer).copy(reply = null)
    }

    private fun failInto(live: Offer, reason: String, nowMs: Long, reply: Reply?): Result {
        val until = minOf(nowMs + RETRY_WINDOW_MS, live.queueUntilMs ?: live.expiresAtMs)
        val stop = if (live.state == State.Sending && live.transferId != null) listOf(Effect.CancelPull(live.transferId)) else emptyList()
        if (until <= nowMs) {
            val (next, effects) = ended(live, State.Expired, Effect.SendCancel("expired"))
            return Result(next, reply, effects)
        }
        val next = live.copy(state = State.Failed(reason), retryUntilMs = until, verdictDueMs = null)
        return Result(next, reply, stop + Effect.ScheduleRetryClose(until))
    }

    // ---- cancel, expiry, session, staging --------------------------------------------------------

    /** `share.cancel` as a request from the Mac. Any live state; a live pull is stopped. */
    fun cancelFromMac(offer: Offer?, fromSession: String, offerId: String?, reason: String?, nowMs: Long): Result {
        if (badId(offerId)) return Result(offer, Reply.Error(BAD_REQUEST, "offerId is missing or malformed"), emptyList())
        if (reason == null || reason !in MAC_CANCEL_REASONS) return Result(offer, Reply.Error(BAD_REQUEST, "reason must be user"), emptyList())
        val live = same(offer, fromSession, offerId!!) ?: return Result(offer, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), emptyList())
        if ((live.state == State.Offered || live.state == State.Accepted) && nowMs >= waitsUntil(live)) return expireInstead(live)
        val (next, effects) = ended(live, State.Cancelled(Side.MAC, reason))
        return Result(next, Reply.Ack(mapOf("offerId" to offerId, "stopped" to true)), effects)
    }

    /**
     * **The held-copy check.** While an offer waits — offered, accepted and queued, or failed inside its
     * Retry window — its staged copy is the only thing that could still be sent. If the caller's file
     * check found it gone or the wrong length, the offer ends now as `staging-lost` and the Mac is told,
     * rather than both sides showing a file as waiting until a pull finds it missing. A pull in flight
     * is not judged here: the stream checks the copy's digest as it reads ([PullEnd.SOURCE_CHANGED]),
     * and after the last byte the Mac holds what it verified.
     */
    fun stagingCheck(offer: Offer, stagedIntact: Boolean): Result {
        val waiting = offer.state == State.Offered || offer.state == State.Accepted || offer.state is State.Failed
        if (!waiting || stagedIntact) return Result(offer, null, emptyList())
        val (next, effects) = ended(offer, State.Cancelled(Side.PHONE, "staging-lost"), Effect.SendCancel("staging-lost"))
        return Result(next, null, effects)
    }

    /** The phone ends its own live offer: `user` or `staging-lost`. The Mac is told. */
    fun cancelFromPhone(offer: Offer, reason: String): Result {
        require(reason in PHONE_CANCEL_REASONS && reason != "expired") { "expiry has its own transition" }
        if (!isLive(offer.state)) return Result(offer, null, emptyList())
        val (next, effects) = ended(offer, State.Cancelled(Side.PHONE, reason), Effect.SendCancel(reason))
        return Result(next, null, effects)
    }

    /**
     * The offer-expiry timer. Only an offer still waiting — offered or accepted — expires on it. A
     * pull in progress is bounded by the stall and the verdict deadline instead, and a failed one by
     * its Retry window (which never runs past `expiresAtMs`).
     */
    fun expire(offer: Offer, nowMs: Long): Result {
        if ((offer.state != State.Offered && offer.state != State.Accepted) || nowMs < waitsUntil(offer)) {
            return Result(offer, null, emptyList())
        }
        return expireInstead(offer).copy(reply = null)
    }

    /** The session it was offered on is gone. No message: there is nobody to send it to. */
    fun sessionEnded(offer: Offer, sessionKey: String): Result {
        if (!isLive(offer.state) || offer.sessionKey != sessionKey) return Result(offer, null, emptyList())
        val (next, effects) = ended(offer, State.SessionEnded)
        return Result(next, null, effects)
    }

    private fun expireInstead(live: Offer): Result {
        val (next, effects) = ended(live, State.Expired, Effect.SendCancel("expired"))
        return Result(next, Reply.Error(NOT_FOUND, NOT_FOUND_MESSAGE), effects)
    }

    // ---- what the phone says about an offer ------------------------------------------------------

    /** The one question the phone's copy may ask: does this state say the file is saved? */
    fun reportsSaved(state: State): Boolean = state is State.Saved

    /**
     * The phone's sentence for a state (the log today, a surface later). Only [State.Saved] — the
     * Mac's `share.saved {ok:true}` — says saved. [UNCONFIRMED] says what is actually known: the
     * bytes were sent and the Mac did not answer, so it **may** have saved them.
     */
    fun describe(state: State): String = when (state) {
        State.Offered -> "offered"
        State.Accepted -> "accepted"
        State.Sending -> "sending"
        State.AwaitingVerdict -> "sent; awaiting the Mac's verdict (not saved)"
        is State.Failed -> if (state.reason == UNCONFIRMED) {
            "sent, but the Mac did not confirm it; it may or may not have been kept there — check the Mac before sending again"
        } else {
            "failed (${state.reason}); Retry window open"
        }
        is State.Saved -> "saved on the Mac as ${state.savedAs}"
        is State.Declined -> "declined (${state.reason})"
        State.Expired -> "expired"
        is State.Cancelled -> "cancelled by the ${state.by.name.lowercase()} (${state.reason})"
        State.SessionEnded -> "ended with the session"
    }
}
