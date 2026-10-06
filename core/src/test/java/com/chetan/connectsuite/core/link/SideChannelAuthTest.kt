package com.chetan.connectsuite.core.link

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * S2b, defect 189 — `docs/protocol.md` → *Session tokens*: a side channel belongs to its session's Mac.
 *
 * Reaches the production [SideChannelAuth] with the real [SessionRegistry] (generic so a test can hold
 * plain sessions). Not reached: `LinkServer.acceptSideChannel`'s socket handling, and a second trusted
 * Mac on hardware — none exists. The revocation on session end is `ControlSession.run`'s `finally`,
 * which calls the same `revoke` used here.
 */
class SideChannelAuthTest {

    private data class FakeSession(val peerFingerprint: String)

    @Test fun `S2b - only the session's own Mac may claim its side channel`() {
        val registry = SessionRegistry<FakeSession>()
        val macA = "AB:".repeat(31) + "AB"; val macB = "CD:".repeat(31) + "CD"
        val tokenA = registry.issue(FakeSession(macA))
        val authorize = { token: String, peer: String -> SideChannelAuth.authorize(token, peer, registry::resolve) { it.peerFingerprint } }
        assertTrue("control: the owner is authorised", authorize(tokenA, macA) is SideChannelAuth.Verdict.Authorized)
        assertTrue("any punctuation of the owner", authorize(tokenA, macA.replace(":", "").lowercase()) is SideChannelAuth.Verdict.Authorized)
        assertTrue("another TRUSTED Mac holding A's token is refused", authorize(tokenA, macB) is SideChannelAuth.Verdict.Refused)
        registry.revoke(tokenA)
        assertTrue("an ended session's token is refused", authorize(tokenA, macA) is SideChannelAuth.Verdict.Refused)
        val tokenA2 = registry.issue(FakeSession(macA))
        assertNotEquals("a reconnect gets a new token", tokenA, tokenA2)
        assertTrue("the old token stays dead after a reconnect", authorize(tokenA, macA) is SideChannelAuth.Verdict.Refused)
        assertTrue(authorize(tokenA2, macA) is SideChannelAuth.Verdict.Authorized)
        assertTrue("an empty owner never matches", SideChannelAuth.authorize("t", "", { FakeSession("") }) { it.peerFingerprint } is SideChannelAuth.Verdict.Refused)
    }

}
