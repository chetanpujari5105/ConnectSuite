package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.protocol.ErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The send rule: a mismatched thread and recipient pair is refused, and nothing is sent.
 *
 * This is the one test in the repo guarding an *unrecoverable* outcome. Everything else here
 * protects a convenience — a tap that did not land, a mirror that went black — and can be
 * re-run by clicking again. A message delivered to the wrong person cannot be taken back, is
 * visible to somebody who was never meant to see it, and the user finds out from them.
 *
 * So the cases below are written from the failure backwards: what would a drifted Mac actually
 * send, and does the phone stop it. See "The send rule" in docs/protocol.md.
 */
class SmsSendRuleTest {

    // ---- the case the rule exists for ---------------------------------------------------------

    @Test
    fun `a recipient who is not in the thread is refused`() {
        // The drifted Mac: it thinks it is in Ada's thread and is holding Grace's number, because
        // the pane was switched between composing and sending.
        val verdict = SmsRecipients.verify(
            requested = listOf("+15559990000"),
            threadHas = listOf("+15551234567"),
        )
        assertTrue("a stranger's number must never verify", verdict is SmsRecipients.Verdict.Mismatch)
    }

    @Test
    fun `the refusal names both numbers, because only the user can tell which is the stranger`() {
        val verdict = SmsRecipients.verify(
            requested = listOf("+15559990000"),
            threadHas = listOf("+15551234567"),
        ) as SmsRecipients.Verdict.Mismatch
        val described = verdict.describe()
        assertTrue("must name what was asked for: $described", described.contains("+15559990000"))
        assertTrue("must name who the thread is with: $described", described.contains("+15551234567"))
    }

    @Test
    fun `the mismatch failure reports its own code, not a generic bad request`() {
        // BAD_REQUEST is a malformed message. This is a well-formed message that would have gone
        // to the wrong person, and whoever reads the log afterwards needs to tell them apart.
        val failure = SmsFailure.RecipientMismatch(
            SmsRecipients.verify(listOf("+15559990000"), listOf("+15551234567"))
                as SmsRecipients.Verdict.Mismatch,
        )
        assertEquals(ErrorCode.RECIPIENT_MISMATCH, failure.code)
        assertTrue(
            "the sentence must say nothing was sent",
            failure.reason.contains("not sent") || failure.fixHint!!.contains("Nothing was sent"),
        )
    }

    // ---- what must still work -----------------------------------------------------------------

    @Test
    fun `the same number written two ways is one recipient`() {
        // A false mismatch costs a retry; the rule must not be so strict that ordinary formatting
        // makes the feature unusable.
        assertEquals(
            SmsRecipients.Verdict.Agreed,
            SmsRecipients.verify(listOf("+1 555-123-4567"), listOf("5551234567")),
        )
        assertEquals(
            SmsRecipients.Verdict.Agreed,
            SmsRecipients.verify(listOf("(555) 123 4567"), listOf("+15551234567")),
        )
        assertEquals(
            SmsRecipients.Verdict.Agreed,
            SmsRecipients.verify(listOf("555.123.4567"), listOf("555-123-4567")),
        )
    }

    @Test
    fun `a group thread verifies only when every member is named`() {
        val group = listOf("+15551110000", "+15552220000", "+15553330000")
        assertEquals(
            SmsRecipients.Verdict.Agreed,
            SmsRecipients.verify(group.reversed(), group),
        )
        assertTrue(
            "sending to part of a group is not obviously right, and this is not the place to guess",
            SmsRecipients.verify(group.take(2), group) is SmsRecipients.Verdict.Mismatch,
        )
        assertTrue(
            "an extra recipient on a group send is the dangerous case",
            SmsRecipients.verify(group + "+15559990000", group) is SmsRecipients.Verdict.Mismatch,
        )
    }

    // ---- leaning towards refusing -------------------------------------------------------------

    @Test
    fun `a thread whose recipients cannot be read is refused, not trusted`() {
        // "We could not check" must never resolve to "send it anyway". This is the substitution the
        // whole rule exists to prevent, and it is the one a well-meaning fix would reintroduce.
        assertEquals(
            SmsRecipients.Verdict.Unverifiable,
            SmsRecipients.verify(listOf("+15551234567"), emptyList()),
        )
        assertEquals(
            SmsRecipients.Verdict.Unverifiable,
            SmsRecipients.verify(listOf("+15551234567"), listOf("", "  ")),
        )
        assertEquals(ErrorCode.RECIPIENT_MISMATCH, SmsFailure.Unverifiable("42").code)
    }

    @Test
    fun `two numbers that merely end alike are two numbers`() {
        // Android's own PhoneNumberUtils.compare defaults to the last seven digits, which makes
        // these one number. That is a fine default for deciding whose photo to show beside a
        // message and an unacceptable one for deciding who receives it.
        assertFalse(
            "different area codes must not collapse",
            SmsRecipients.same("+15551234567", "+19991234567"),
        )
        assertTrue(
            SmsRecipients.verify(listOf("+19991234567"), listOf("+15551234567"))
                is SmsRecipients.Verdict.Mismatch,
        )
    }

    @Test
    fun `short codes match only exactly`() {
        // Short codes are suffixes of each other in a way real numbers are not, so suffix matching
        // there would make several unrelated senders into one recipient.
        assertTrue(SmsRecipients.same("22395", "22395"))
        assertFalse(SmsRecipients.same("22395", "922395"))
        assertFalse(SmsRecipients.same("2395", "22395"))
    }

    @Test
    fun `an empty or digitless recipient never verifies`() {
        assertTrue(SmsRecipients.verify(listOf(""), listOf("+15551234567")) is SmsRecipients.Verdict.Mismatch)
        assertTrue(SmsRecipients.verify(listOf("n/a"), listOf("+15551234567")) is SmsRecipients.Verdict.Mismatch)
        assertFalse(SmsRecipients.same("", "+15551234567"))
        assertFalse(SmsRecipients.same("+15551234567", ""))
    }

    @Test
    fun `a send with no recipients at all is refused rather than resolved from the thread`() {
        // The rule's first clause. Resolving the recipient from the threadId is exactly the
        // inference the rule forbids: it makes the thread the single source of truth, and a single
        // source cannot be checked against anything.
        assertEquals(ErrorCode.BAD_REQUEST, SmsFailure.NoRecipients.code)
        assertTrue(
            "the hint must say to resolve the recipient, not just to add a field",
            SmsFailure.NoRecipients.fixHint!!.contains("recipients"),
        )
    }

    @Test
    fun `normalisation strips formatting and nothing else`() {
        assertEquals("15551234567", SmsRecipients.digits("+1 (555) 123-4567"))
        assertEquals("", SmsRecipients.digits("no digits here"))
    }
}
