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

    /** A pairing is armed for this fingerprint and the hello carried neither `pair` nor a token. */
    TOKEN_MISSING,

    /** Pairing v2: the hello carried a v1 `pairToken`. v1 pairing is never accepted — no fallback. */
    UPGRADE_REQUIRED,

    /** Pairing v2: `pair.confirm` did not verify, or `hello.pair` was malformed. */
    PROOF_INVALID,

    /** Pairing v2: the Mac asked to pair and this phone is not waiting for it. */
    NOT_ARMED,

    /** Pairing v2: [PhonePairing.MAX_FAILURES] failed Mac proofs; the arm is cleared. */
    TOO_MANY_ATTEMPTS,
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
            UPGRADE_REQUIRED ->
                "This Mac's Sidekick is too old to pair securely. Update it on the Mac, then show " +
                    "a fresh code."
            PROOF_INVALID ->
                "The Mac could not prove it showed the code this phone scanned. Show a fresh one " +
                    "on the Mac and scan it again."
            NOT_ARMED ->
                "This phone is not waiting to pair. Show a fresh code on the Mac and scan it again."
            TOO_MANY_ATTEMPTS ->
                "Too many failed attempts with that code. Show a fresh one on the Mac and scan it " +
                    "again."
        }
}
