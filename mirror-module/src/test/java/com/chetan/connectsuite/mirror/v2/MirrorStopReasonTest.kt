package com.chetan.connectsuite.mirror.v2

import com.chetan.connectsuite.core.link.BackgroundRestriction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 104 — eight hand-written stop sentences, two of them three words apart.
 *
 * `MirrorEngine.stop` took a `String`, so every call site wrote its own. *"Stopped on the phone"*
 * was the user tapping Stop; *"Screen capture was stopped on the phone"* was
 * `MediaProjection.Callback.onStop` — Android taking the projection away — and it was the only
 * thing the app said while the background restriction killed eight consecutive sessions at
 * 107-116 ms on 2026-09-10.
 *
 * ### What this suite does and does not reach
 *
 * It reaches the **vocabulary and the derivation**: the closed set, the sentences, and which of
 * the two revoke reasons a given reading produces. It does **not** reach `onStop` itself, which is
 * a platform callback inside a class that needs a `Context`, a `MediaProjection` and a live
 * encoder. That is the `LinkWaitStatus` split stated up front rather than discovered later: the
 * decision is in [MirrorStopReason.revoked] where a test can call it, the callback's only job is
 * to take the reading and pass it in, and the honest status of *that* line is unproven on
 * hardware. The stimulus is named in `docs/testing.md` → Phase 7 Slice 39.
 */
class MirrorStopReasonTest {

    private val all = listOf(
        MirrorStopReason.RestartedByMac,
        MirrorStopReason.RestartedFromPhone,
        MirrorStopReason.MacDisconnected,
        MirrorStopReason.StoppedFromPhone,
        MirrorStopReason.StoppedByMac,
        MirrorStopReason.FeatureUninstalled,
        MirrorStopReason.ServiceDestroyed,
        MirrorStopReason.AndroidRevokedWhileRestricted,
        MirrorStopReason.AndroidRevoked,
    )

    @Test
    fun `a stop Android caused names Android, and never the person holding the phone`() {
        // **This is the rule the defect was about**, and it replaces a string-distance check that
        // passed with the original defect sentence restored. Reintroducing
        // *"Screen capture was stopped on the phone."* as the platform revoke turns this red on
        // the first clause, whatever the sibling sentences have been reworded to since — which the
        // near-miss check could not do, because it measured the pair rather than the claim.
        all.filter { it.actor == MirrorStopReason.Actor.ANDROID }.forEach {
            assertTrue(
                "${it.label} does not say who did it: ${it.sentence}",
                it.sentence.contains("Android"),
            )
            assertFalse(
                "${it.label} blames the phone's user: ${it.sentence}",
                Regex("\\byou\\b", RegexOption.IGNORE_CASE).containsMatchIn(it.sentence),
            )
        }
    }

    @Test
    fun `a stop the person made says so, so the two are not one sentence apart`() {
        val user = all.filter { it.actor == MirrorStopReason.Actor.PHONE_USER }
        assertTrue("control: there are phone-user stops to check", user.isNotEmpty())
        user.forEach {
            assertFalse(
                "${it.label} attributes a person's tap to the platform: ${it.sentence}",
                it.sentence.contains("Android"),
            )
        }
    }

    @Test
    fun `every reason has an actor, and the platform is the only one with two`() {
        // A closed enum with an unused member is a member somebody will reach for; a closed enum
        // missing one is the `UNKNOWN` route of defect 80. Both are asserted here.
        assertEquals(
            MirrorStopReason.Actor.entries.toSet(),
            all.map { it.actor }.toSet(),
        )
    }

    @Test
    fun `no two reasons share a sentence, and none is a near-miss of another`() {
        // The defect was not two identical strings — it was two that read the same at a glance.
        // So this asserts on the *words*, which is what a person compares, rather than on
        // equality, which the eight originals already satisfied.
        val byWords = all.associateWith { it.sentence.lowercase().split(Regex("\\W+")).filter { w -> w.isNotEmpty() }.toSet() }
        for (a in all) {
            for (b in all) {
                if (a === b) continue
                val overlap = byWords.getValue(a) intersect byWords.getValue(b)
                val smaller = minOf(byWords.getValue(a).size, byWords.getValue(b).size)
                assertTrue(
                    "too alike to tell apart:\n  ${a.label}: ${a.sentence}\n  ${b.label}: ${b.sentence}",
                    overlap.size < smaller,
                )
            }
        }
    }

    @Test
    fun `every label is distinct, because the log is what a defect is reconstructed from`() {
        assertEquals(all.size, all.map { it.label }.toSet().size)
    }

    @Test
    fun `every sentence is a sentence, since both sides draw it verbatim`() {
        all.forEach {
            assertTrue("not capitalised: ${it.sentence}", it.sentence.first().isUpperCase())
            assertTrue("no full stop: ${it.sentence}", it.sentence.endsWith("."))
        }
    }

    // ---- the derivation ------------------------------------------------------------------------

    @Test
    fun `a revoke on a restricted phone names the restriction`() {
        val reason = MirrorStopReason.revoked(backgroundRestricted = true)
        assertEquals(MirrorStopReason.AndroidRevokedWhileRestricted, reason)
        assertTrue(reason.sentence, reason.sentence.contains("foreground status"))
        assertTrue(reason.sentence, reason.sentence.contains("background-restricted"))
        // The fix hint is the one from core, not a second copy of it: two sentences about one
        // switch will disagree eventually and the phone's card is the one people act on.
        assertEquals(BackgroundRestriction.STEPS, reason.fixHint)
    }

    @Test
    fun `a revoke on an unrestricted phone claims neither of the two causes it cannot tell apart`() {
        val reason = MirrorStopReason.revoked(backgroundRestricted = false)
        assertEquals(MirrorStopReason.AndroidRevoked, reason)
        assertNotNull(reason.fixHint)
        // Both named, neither asserted. `onStop()` carries no reason at any SDK level this app
        // compiles against, so a sentence picking one would be right about half the time and
        // confident every time — the folder-picker rule.
        assertTrue(reason.fixHint!!.contains("notification shade"))
        assertTrue(reason.fixHint.contains("Android takes the capture back"))
        assertFalse(
            "must not blame the person holding the phone",
            reason.sentence.contains("You ") || reason.sentence.contains("you "),
        )
    }

    @Test
    fun `the restricted revoke is the only stop that sends anyone to a setting`() {
        val withHints = all.filter { it.fixHint != null }.map { it.label }.toSet()
        assertEquals(
            setOf(
                MirrorStopReason.AndroidRevokedWhileRestricted.label,
                MirrorStopReason.AndroidRevoked.label,
            ),
            withHints,
        )
        // An ordinary stop is not a problem and must not offer advice about one — the status
        // island's lesson: a surface that says something when there is nothing to say trains
        // people to stop reading it.
        assertNull(MirrorStopReason.StoppedFromPhone.fixHint)
        assertNull(MirrorStopReason.MacDisconnected.fixHint)
    }

    @Test
    fun `no stop sentence offers a retry of the thing that cannot succeed`() {
        // Each foreground-service start buys another allowance and another withdrawal; seven taps
        // on 2026-09-10 bought seven. The unrestricted revoke *may* say "start again" because on
        // that phone it will work — the restricted one may not.
        val r = MirrorStopReason.AndroidRevokedWhileRestricted
        assertFalse(
            "${r.label} offers a retry",
            Regex("try again|start .*again", RegexOption.IGNORE_CASE)
                .containsMatchIn(r.sentence + " " + (r.fixHint ?: "")),
        )
    }

    @Test
    fun `a failure carries its own sentence through the stop, rather than a mechanical one`() {
        val failure = MirrorFailure.PhoneLocked
        val reason = MirrorStopReason.Failed(failure)
        assertEquals(failure.reason, reason.sentence)
        assertEquals(failure.fixHint, reason.fixHint)
        assertTrue(reason.label.contains(failure.label))
    }
}
