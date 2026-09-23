package com.chetan.connectsuite.mirror.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Feature F (2026-09-23): what the phone tells the Mac about Android's screen-sharing prompt.
 *
 * The prompt's buttons are Android's and the maker's, and they differ — on the SM-S938B they read
 * "Next" then "Share screen", while these sentences said *Tap "Start now"*. So no sentence may quote
 * a button label; it says what to do ("approve screen sharing") and leaves the words to the phone.
 */
class ConsentCopyTest {

    private val every = listOf(
        MirrorFailure.ConsentDenied,
        MirrorFailure.ConsentDismissed,
        MirrorFailure.ConsentTimeout,
        MirrorFailure.PhoneLocked,
        MirrorFailure.SecureSurface,
        MirrorFailure.EncoderInitFailed("x"),
        MirrorFailure.EncoderDied("x"),
        MirrorFailure.VideoChannelUnauthorised,
        MirrorFailure.DeclinedOnPhone,
    )

    /** A quoted, capitalised phrase — `"Start now"`, `“Share screen”` — is a button label. */
    private val quotedLabel = Regex("""["“][A-Z][^"”]{1,30}["”]""")

    @Test
    fun `no sentence sent to the Mac quotes a button label`() {
        for (failure in every) {
            for (text in listOfNotNull(failure.reason, failure.fixHint)) {
                assertTrue("${failure.label}: $text", quotedLabel.find(text) == null)
            }
        }
    }

    @Test
    fun `control — the label pattern sees the sentence that shipped`() {
        assertTrue(quotedLabel.find("Start mirroring again and tap \"Start now\" on the phone.") != null)
    }

    @Test
    fun `no sentence names the app by its old name`() {
        for (failure in every) {
            for (text in listOfNotNull(failure.reason, failure.fixHint)) {
                assertTrue("${failure.label}: $text", !text.contains("ConnectSuite"))
            }
        }
    }

    @Test
    fun `declining on the phone is its own failure, not a denied system prompt`() {
        assertEquals("declined-on-phone", MirrorFailure.DeclinedOnPhone.label)
        assertTrue(MirrorFailure.DeclinedOnPhone.reason != MirrorFailure.ConsentDenied.reason)
        assertTrue(MirrorFailure.DeclinedOnPhone.reason.contains("declined on the phone"))
    }

    @Test
    fun `after a timeout the hint does not point at the notification that the timeout removed`() {
        // The request notification carries setTimeoutAfter(CONSENT_TIMEOUT_MS): it is gone the
        // moment this failure is raised, on the phone and in the sentence the Mac shows.
        val hint = MirrorFailure.ConsentTimeout.fixHint!!
        assertTrue(hint, !hint.contains("notification", ignoreCase = true))
        assertTrue(hint, hint.startsWith("Start mirroring again"))
    }

    @Test
    fun `the timeout does not claim Android's prompt was shown`() {
        // A backgrounded request usually ends as an untapped notification, with no prompt at all.
        val reason = MirrorFailure.ConsentTimeout.reason
        assertTrue(reason, !reason.contains("prompt", ignoreCase = true))
    }
}
