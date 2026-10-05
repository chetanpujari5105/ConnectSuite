package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 40 — `call.reject delivered` named a disposition that `dispositionOf` then overruled.
 *
 * Found during step 69 on 2026-08-28. The full record is in `CallAckWording`'s own comment and in
 * docs/testing.md; the short version is that the line ended *"so call.ended will say rejected"* in
 * a run whose answer was `answered`, and step 70 asks its reader to read these very lines.
 *
 * These are wording tests, and they are worth having for one specific reason rather than as a
 * matter of course: the sentence and the rule that contradicts it live in different files, so
 * nothing in the build relates them. That is exactly how the wrong sentence got written, and it is
 * the same shape as the defect it describes — two facts with no relationship between them.
 */
class CallAckWordingTest {

    @Test
    fun `the reject ack does not promise an outcome dispositionOf can overrule`() {
        // The two halves side by side, which is the whole point of this test existing.
        //
        // First: this case is real and is what step 69 hit — a call answered by the far end and
        // then hung up from the Mac. `rejected` is flagged and `answered` still wins.
        assertEquals(
            "answered outranks a set reject flag",
            "answered",
            CallWatcher.dispositionOf(answered = true, rejected = true, wasRinging = false),
        )
        // Second: so no ack may state the disposition as settled.
        for (forbidden in CallAckWording.FORBIDDEN_IN_ACKS) {
            assertFalse(
                "the reject ack must not forecast the disposition: found \"$forbidden\" in " +
                    "\"${CallAckWording.REJECT_DELIVERED}\"",
                CallAckWording.REJECT_DELIVERED.contains(forbidden),
            )
        }
    }

    @Test
    fun `the reject ack still says what it did, and names the precedence`() {
        // Not merely stripped of the wrong clause. A reader of step 70 needs to know that reading
        // this line is not reading the disposition, and why.
        val line = CallAckWording.REJECT_DELIVERED
        assertTrue("must say the flag was set: $line", line.contains("flagged"))
        assertTrue("must point at the line that decides: $line", line.contains("call.ended"))
        assertTrue("must name the precedence: $line", line.contains("answered outranks"))
    }

    @Test
    fun `the other two acks report facts and are left alone`() {
        // A guard, not evidence: these were already correct and this test exists so that a later
        // tidy-up of the reject wording does not sweep a forecast into one of them instead.
        for (line in listOf(CallAckWording.ANSWER_DELIVERED, CallAckWording.DIAL_DELIVERED)) {
            for (forbidden in CallAckWording.FORBIDDEN_IN_ACKS) {
                assertFalse("\"$line\" must not forecast: $forbidden", line.contains(forbidden))
            }
        }
    }
}
