package com.chetan.connectsuite.core.link

import com.chetan.connectsuite.core.protocol.Link

/**
 * A QR this phone has scanned and the Mac it is now expecting.
 *
 * The deadline is computed from [Link.PAIR_TOKEN_TTL_MS] — the **same constant** `LinkServer` arms
 * the token with — rather than from a literal. That matters: `CLAUDE.md`'s rule is that a rule with
 * two expressions will eventually have two answers, and a screen counting down five minutes while
 * the server enforced something else is precisely that bug, wearing a progress bar.
 */
data class ScannedPairing(val macName: String, val scannedAtMillis: Long) {
    val expiresAtMillis: Long get() = scannedAtMillis + Link.PAIR_TOKEN_TTL_MS
}

/**
 * What the Connect-a-Mac flow shows, as a closed set.
 *
 * ### The states are the phone's, not the reference's
 *
 * The reference images draw a phone that *searches* for a Mac, *verifies* it, then *connects* —
 * three stages with a stepper. **This phone does none of those things.** Locked decision #2 is that
 * Android binds the listening sockets and the Mac connects out, so after the QR is scanned the
 * phone writes the trust row, arms a token and **waits**. It never dials, never discovers, and has
 * no vantage point from which to observe a handshake in progress: the TLS exchange and the token
 * check both happen inside `accept()`, and the first thing the phone can publish is a session that
 * already exists.
 *
 * So there is no `Searching` and no `Verifying` here. Drawing them would be the unreachable-state
 * failure `CLAUDE.md` records against the phone's Folders screen — a state nobody can ever tell
 * from a bug in its neighbour, because the only way to see it is a bug in its neighbour.
 *
 * What replaces them is [Waiting], which is true, and which carries the one real quantity the wait
 * has: how much of the pairing token's life is left.
 */
sealed interface ConnectStage {

    /** No local address, so no Mac can reach this phone whatever else is true. */
    data object NoNetwork : ConnectStage

    /** Nothing scanned, nothing refused. The entry screen. */
    data object Entry : ConnectStage

    /** Scanned, trusted, armed. The Mac has until [expiresAtMillis] to dial in. */
    data class Waiting(
        val macName: String,
        val scannedAtMillis: Long,
        val expiresAtMillis: Long,
    ) : ConnectStage {
        fun millisLeft(nowMillis: Long): Long = (expiresAtMillis - nowMillis).coerceAtLeast(0L)

        /**
         * How much of the token's life remains, 1f → 0f.
         *
         * A determinate bar, because the quantity is genuinely known. The reference draws a bar
         * that fills as three invented stages complete; this one drains as a real deadline
         * approaches, which is the same picture carrying a fact instead of a mood.
         */
        fun fractionLeft(nowMillis: Long): Float {
            val span = (expiresAtMillis - scannedAtMillis).toFloat()
            if (span <= 0f) return 0f
            return (millisLeft(nowMillis) / span).coerceIn(0f, 1f)
        }
    }

    /**
     * The token's five minutes ran out **by this screen's own clock**, with no Mac.
     *
     * Derived locally, and therefore a *guess about silence*: nothing arrived, and the deadline
     * passed. It is the weaker of the two expiry statements and [Rejected] outranks it.
     */
    data class Expired(val macName: String) : ConnectStage

    /**
     * The server turned a Mac away over its pairing token, and said which of three reasons.
     *
     * This is the **authoritative** failure: a Mac got through TLS, presented a token, and
     * `acceptPairToken` refused it. It outranks [Expired] because the two can both apply at once —
     * a Mac arriving one second late produces a real `TOKEN_EXPIRED` *and* satisfies the local
     * clock — and only one of them knows whether anything actually turned up. "Your Mac connected
     * too late" and "nothing ever came" are different things to tell somebody.
     */
    data class Rejected(val reason: PairRejectReason, val macName: String) : ConnectStage

    /** A session exists. */
    data class Connected(val macName: String) : ConnectStage

    /**
     * A Mac reached the phone and was turned away at the TLS handshake.
     *
     * Amber rather than red, per the brief: a stranger being refused is the security model
     * working, and the only case where it is a *problem* is the one this copy names — your own Mac,
     * with a key that has changed.
     */
    data class Refused(val fingerprintPrefix: String, val address: String?) : ConnectStage

    companion object {
        /**
         * The decision, in one place, composed from [LinkWaitStatus] rather than restating it.
         *
         * [LinkWaitStatus] already owns *connected vs refused vs waiting* and has eleven tests and
         * a hardware defect (67) behind that precedence. Writing a second ordering here would be
         * the "one rule, two expressions" failure; this adds only what that type does not know
         * about — whether a QR has been scanned, and whether there is a network at all.
         *
         * @param localAddress `PhoneAddress.localIpv4()`, passed in so this stays a pure function.
         */
        fun of(
            state: LinkState,
            scanned: ScannedPairing?,
            localAddress: String?,
            nowMillis: Long,
        ): ConnectStage {
            val wait = LinkWaitStatus.of(state, nowMillis)

            // A live session outranks everything: if a Mac is connected then there is obviously a
            // network, and whatever was refused a minute ago is no longer the story.
            if (wait is LinkWaitStatus.Connected) {
                return Connected(wait.clients.firstOrNull() ?: scanned?.macName ?: "your Mac")
            }

            if (localAddress == null) return NoNetwork

            // A refusal that happened *after* the scan is about this pairing attempt and is the
            // better explanation of the silence. One from before it is about something else.
            val refusal = state.lastRefusal
            if (wait is LinkWaitStatus.Refused &&
                refusal != null &&
                refusal.atMillis >= (scanned?.scannedAtMillis ?: Long.MIN_VALUE)
            ) {
                return Refused(wait.fingerprintPrefix, wait.address)
            }

            // The server's reason beats the local clock's guess whenever both could apply.
            //
            // Tied to the scan rather than to a time window: a rejection from before this scan is
            // about a previous attempt, and a new scan is exactly the act that makes the old one
            // irrelevant. `Entry` deliberately shows nothing — a rejection with nothing scanned has
            // no attempt to be about.
            val reject = state.lastPairReject
            if (scanned != null && reject != null && reject.atMillis >= scanned.scannedAtMillis) {
                return Rejected(reject.reason, scanned.macName)
            }

            if (scanned != null) {
                return if (nowMillis >= scanned.expiresAtMillis) {
                    Expired(scanned.macName)
                } else {
                    Waiting(scanned.macName, scanned.scannedAtMillis, scanned.expiresAtMillis)
                }
            }

            return Entry
        }
    }
}
