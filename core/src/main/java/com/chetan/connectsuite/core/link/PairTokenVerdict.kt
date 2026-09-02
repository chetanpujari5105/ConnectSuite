package com.chetan.connectsuite.core.link

/**
 * Why the phone turned away a `hello` that carried a pairing token — `docs/protocol.md` →
 * `pair.rejected`.
 *
 * These are reachable **only after TLS succeeded**, which means the certificate was already pinned.
 * A Mac that is not paired at all fails in the handshake and there is no channel to answer on; that
 * case is shown on the phone's own screen instead (defect 66). The two failures are different and
 * neither substitutes for the other — which is worth stating here because "pairing failed" is the
 * sentence somebody will eventually try to use for both.
 */
enum class PairRejectReason {
    /** The QR was scanned but the Mac did not connect within `Link.PAIR_TOKEN_TTL_MS`. */
    TOKEN_EXPIRED,

    /** A token was presented and is not the armed one — usually a stale QR still on a screen. */
    TOKEN_MISMATCH,

    /** A pairing is armed for this fingerprint and the hello carried no token. An older Mac. */
    TOKEN_MISSING,
    ;

    /**
     * The fallback sentence.
     *
     * `docs/protocol.md` says the Mac must prefer its own copy keyed on the reason; this is what
     * reaches a log, and what an older Mac that does not know the reason code will show. It is
     * written as a complete instruction rather than a diagnosis because the person reading it is
     * mid-setup and wants to know what to do next.
     */
    val message: String
        get() = when (this) {
            TOKEN_EXPIRED ->
                "The pairing code expired. Show a fresh one on the Mac and scan it again."
            TOKEN_MISMATCH ->
                "That code does not match the one this phone scanned. Show a fresh one on the " +
                    "Mac and scan it again."
            TOKEN_MISSING ->
                "The Mac connected without a pairing code. Show a fresh one on the Mac and scan " +
                    "it again."
        }
}

/** The outcome of checking a hello's pairing token. */
sealed interface PairTokenVerdict {
    data object Accepted : PairTokenVerdict
    data class Rejected(val reason: PairRejectReason) : PairTokenVerdict
}
