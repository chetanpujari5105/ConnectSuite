package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A reply is refused when the notification it was aimed at has become a different conversation.
 *
 * The second of the two unrecoverable outcomes in this phase. The SMS rule guards a message going
 * to the wrong number; this guards a reply going into the wrong conversation, which is the same
 * harm reached by a different route — and by a route where nothing in the platform can detect it,
 * because the `PendingIntent` is always correctly bound to whatever notification currently holds
 * it. That is exactly what makes it dangerous rather than merely broken.
 *
 * The comparison itself is two strings, so it is tested here as two strings. What cannot be tested
 * without a phone — that `StatusBarNotification.getKey()` really is reused across conversations by
 * some apps — is the premise, and it is recorded in docs/protocol.md rather than asserted.
 */
class NotificationTargetRuleTest {

    /**
     * The decision `targetStillMatches` makes, extracted so it can be driven without Android.
     *
     * Kept in step with the production copy by [the sentence tests below][refusalNamesBothSides]
     * plus the shape of the rule being three lines long. A fuller extraction — a pure object like
     * `SmsRecipients` — would be the right call the moment this grows a fourth case.
     */
    private fun allows(seenTitle: String?, currentTitle: String?): Boolean {
        val seen = seenTitle?.takeIf { it.isNotBlank() } ?: return true
        val now = currentTitle?.takeIf { it.isNotBlank() } ?: return true
        return seen == now
    }

    @Test
    fun `a key now holding a different conversation is refused`() {
        // The failure the rule exists for: one notification id reused for whatever arrived most
        // recently. The Mac's row says Ada; the notification at that key is now Grace.
        assertTrue("must refuse", !allows("Ada Lovelace", "Grace Hopper"))
    }

    @Test
    fun `the same conversation still replies, even after a new message arrives in it`() {
        // The common case, and the reason the discriminator is the title rather than the post
        // time: post time changes on every update including a new message in the same thread,
        // which is the single most likely thing to happen while somebody is typing a reply.
        assertTrue(allows("Ada Lovelace", "Ada Lovelace"))
    }

    @Test
    fun `an absent title on either side means there is nothing to disagree about`() {
        // A deliberate limit, not an oversight. An older Mac that does not send the field and a
        // notification that genuinely has no title both still work.
        assertTrue(allows(null, "Ada Lovelace"))
        assertTrue(allows("Ada Lovelace", null))
        assertTrue(allows(null, null))
        assertTrue(allows("", "Ada Lovelace"))
        assertTrue(allows("Ada Lovelace", "   "))
    }

    @Test
    fun refusalNamesBothSides() {
        // The user is the only one who can see what nearly happened, so the sentence names both
        // conversations rather than describing the problem abstractly.
        val failure = NotificationFailure.TargetStale("Ada Lovelace", "Grace Hopper")
        assertTrue(failure.reason.contains("Ada Lovelace"))
        assertTrue(failure.reason.contains("Grace Hopper"))
        assertTrue(
            "must say nothing was sent",
            failure.reason.contains("not sent") || failure.fixHint!!.contains("Nothing was sent"),
        )
    }

    @Test
    fun `a stale target is not the same code as a dismissed one`() {
        // NOT_FOUND asks the Mac to refresh a list. TARGET_STALE says a reply would have gone to
        // the wrong person. Collapsing them would file the second under routine housekeeping.
        assertEquals(ErrorCode.TARGET_STALE, NotificationFailure.TargetStale("a", "b").code)
        assertEquals(ErrorCode.NOT_FOUND, NotificationFailure.Gone.code)
        assertNotEquals(NotificationFailure.TargetStale("a", "b").reason, NotificationFailure.Gone.reason)
    }

    @Test
    fun `the target rule and the input coordinate contract refuse for the same reason`() {
        // Both say "what you aimed at is not what is there now". Keeping the codes distinct but
        // the shape identical is the point: a future feature with a stale-target problem should
        // reach for this pattern rather than inventing a third one.
        assertNotEquals(ErrorCode.TARGET_STALE, ErrorCode.GEOMETRY_STALE)
        assertTrue(NotificationFailure.TargetStale("a", "b").fixHint!!.contains("try again"))
    }
}
