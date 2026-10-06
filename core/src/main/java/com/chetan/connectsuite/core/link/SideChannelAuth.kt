package com.chetan.connectsuite.core.link

/**
 * Who may claim a side channel — audit S2b, defect 189; `docs/protocol.md` → *Session tokens*.
 *
 * Until 2026-10-06 a video or bulk socket was authorised by its token alone: any Mac this phone trusts
 * could present another Mac's live token and be attached to that Mac's session. Now the token must
 * resolve to a live session **and** the TLS client certificate on the side channel must be that
 * session's own peer. A revoked token (the session ended, the Mac was forgotten, it reconnected and got
 * a new one) resolves to nothing.
 *
 * Generic over the session type and pure, so a JVM test drives it with the real [SessionRegistry].
 */
object SideChannelAuth {
    sealed interface Verdict<out S> {
        data class Authorized<S>(val session: S) : Verdict<S>
        data class Refused(val reason: String) : Verdict<Nothing>
    }

    fun <S> authorize(
        token: String,
        channelPeerFingerprint: String,
        resolve: (String) -> S?,
        ownerOf: (S) -> String,
    ): Verdict<S> {
        val session = resolve(token) ?: return Verdict.Refused("unknown or ended session token")
        val owner = PairingQrPayload.normalizeFingerprint(ownerOf(session))
        val channel = PairingQrPayload.normalizeFingerprint(channelPeerFingerprint)
        if (owner.isEmpty() || owner != channel) {
            return Verdict.Refused("a side channel from a different Mac than the session's owner")
        }
        return Verdict.Authorized(session)
    }
}
