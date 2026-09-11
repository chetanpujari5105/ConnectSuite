package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.BackgroundRestriction
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.CapabilityHold
import com.chetan.connectsuite.core.link.CapabilityStatus
import com.chetan.connectsuite.core.link.heldBackSummary
import com.chetan.connectsuite.core.link.hold
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 102 — the app could not tell it had been background-restricted.
 *
 * One UI restricts apps it judges unused, on its own and with no notice. A restricted app cannot
 * hold the foreground service a `MediaProjection` is handed to, so on 2026-09-10 this handset
 * killed eight consecutive mirror sessions 107-116 ms in and said *"Screen capture was stopped on
 * the phone"* every time. Lifting the op produced a 6 min 33 s session on the first tap.
 *
 * ### What these tests can and cannot reach
 *
 * They cover the **rule**: which capabilities the restriction reaches, what is said about it, and
 * that the phone's held-back tally adds up. They cannot cover the **reading** —
 * `ActivityManager.isBackgroundRestricted()` is an Android call and there is no JVM seam for it,
 * which is why [com.chetan.connectsuite.core.link.BackgroundRestrictionReading] is one function
 * with one job rather than logic worth testing.
 *
 * That split is deliberate and it is the `LinkWaitStatus` lesson stated in advance: the decision is
 * tested here, the *write* is not, and the honest status of the write is **unproven on hardware**.
 * The stimulus that would prove it is one command and is named in `docs/testing.md` → Phase 7
 * Slice 39; it is not run here because the op was deliberately restored to `allow` on the only
 * device that has ever had it set.
 */
class BackgroundRestrictionTest {

    private fun status(
        name: String = Capability.MIRROR,
        permitted: Boolean = true,
        implemented: Boolean = true,
        running: Boolean = true,
        restricted: Boolean = false,
    ) = CapabilityStatus(
        name = name,
        permitted = permitted,
        implemented = implemented,
        missing = emptyList(),
        running = running,
        backgroundRestricted = restricted,
    )

    // ---- which capabilities the restriction reaches ------------------------------------------

    @Test
    fun `the restriction withholds mirror and nothing else`() {
        val reached = CapabilityContract.allCapabilities
            .filter { CapabilityContract.blockedByBackgroundRestriction(it, true) }
        // Not `assertTrue(mirror in reached)` — that passes just as well when the restriction
        // blankets everything, which is the tempting wrong fix and the one the register warns
        // about. The whole set is asserted, so widening it has to be deliberate.
        assertEquals(listOf(Capability.MIRROR), reached)
    }

    @Test
    fun `an unrestricted phone is blocked on nothing`() {
        assertTrue(
            CapabilityContract.allCapabilities
                .none { CapabilityContract.blockedByBackgroundRestriction(it, false) },
        )
    }

    @Test
    fun `sms and contacts go on working while the app is restricted`() {
        // Measured, not assumed: with the op set on this handset for twelve hours every capability
        // that does not need a foreground service answered normally. A blanket withdrawal would
        // have been a wall drawn where there is none.
        listOf(Capability.SMS, Capability.CONTACTS, Capability.NOTIFICATIONS, Capability.FILES)
            .forEach {
                assertFalse(it, CapabilityContract.blockedByBackgroundRestriction(it, true))
            }
    }

    @Test
    fun `a restricted mirror is not advertisable however complete everything else is`() {
        val handlers = CapabilityContract.contracts.getValue(Capability.MIRROR).requests
        fun advertised(restricted: Boolean) = CapabilityContract.advertisable(
            grantedPermissions = emptySet(),
            specialAccessHeld = emptySet(),
            registeredTypes = handlers,
            videoServed = true,
            bulkServed = false,
            backgroundRestricted = restricted,
        )
        assertTrue("control: unrestricted, this is the set that must advertise", Capability.MIRROR in advertised(false))
        assertFalse(Capability.MIRROR in advertised(true))
    }

    // ---- what is said about it ----------------------------------------------------------------

    @Test
    fun `the reason a restricted mirror carries is the restriction, not a permission`() {
        val reason = status(restricted = true).reason
        assertEquals(BackgroundRestriction.CAPABILITY_REASON, reason)
    }

    @Test
    fun `the restriction is named ahead of a missing permission, because a grant will not fix it`() {
        val reason = status(restricted = true, permitted = false).reason
        assertEquals(BackgroundRestriction.CAPABILITY_REASON, reason)
    }

    @Test
    fun `no copy anywhere sends the user to battery optimisation`() {
        // The second wrong fix in the register, and the one that reads as helpful: this app already
        // holds that exemption and is restricted regardless, so the prompt changes nothing and the
        // user has already said yes to it.
        val everything = BackgroundRestriction.steps + listOf(
            BackgroundRestriction.CAPABILITY_REASON,
            BackgroundRestriction.ACTION_LABEL,
        )
        everything.forEach { line ->
            assertFalse(
                "sends the user to the wrong switch: $line",
                Regex("optimi[sz]ation", RegexOption.IGNORE_CASE).containsMatchIn(line) &&
                    !line.contains("not the battery optimisation setting"),
            )
        }
    }

    @Test
    fun `no copy anywhere offers a retry`() {
        // The first wrong fix. Seven taps on 2026-09-10 bought seven allowances and seven
        // withdrawals; "try again" is the sentence that produces the eighth.
        val everything = BackgroundRestriction.steps + listOf(BackgroundRestriction.CAPABILITY_REASON)
        everything.forEach { line ->
            assertFalse(
                "offers a retry: $line",
                Regex("try again|retry|start .* again", RegexOption.IGNORE_CASE).containsMatchIn(line),
            )
        }
    }

    @Test
    fun `the phone's copy names the two taps the button cannot make`() {
        // The deep link lands on App info; there is no public action for the Battery page inside
        // it. A button label that implied otherwise would be a promise the platform refuses.
        assertTrue(BackgroundRestriction.STEPS.contains("Battery"))
        assertTrue(BackgroundRestriction.ACTION_LABEL.contains("App info"))
        assertFalse("the button must not claim to reach Battery", BackgroundRestriction.ACTION_LABEL.contains("Battery"))
    }

    // ---- the held-back tally -------------------------------------------------------------------

    @Test
    fun `every combination of the four gates lands in exactly one bucket`() {
        // Enumerated rather than sampled. The hole this closes was found by adding a fourth gate
        // to a tally of two categories and noticing the sum; the case that was *already* wrong
        // before the fourth gate — granted, built, component not bound — is the reinstalled
        // notification listener, which is every development install.
        var held = 0
        for (permitted in listOf(false, true)) {
            for (implemented in listOf(false, true)) {
                for (running in listOf(false, true)) {
                    for (restricted in listOf(false, true)) {
                        val s = status(
                            permitted = permitted,
                            implemented = implemented,
                            running = running,
                            restricted = restricted,
                        )
                        if (s.advertised) {
                            assertNull("an advertised capability is held back by nothing", s.hold)
                        } else {
                            held++
                            assertNotNull(
                                "held back with no bucket: permitted=$permitted implemented=" +
                                    "$implemented running=$running restricted=$restricted",
                                s.hold,
                            )
                            assertNotNull("a held-back capability always has a reason", s.reason)
                        }
                    }
                }
            }
        }
        assertEquals("control: 16 combinations, one of which advertises", 15, held)
    }

    @Test
    fun `the summary's counts add up to the list it annotates`() {
        val statuses = listOf(
            status(name = "mirror", restricted = true),
            status(name = "photos", implemented = false),
            status(name = "sms", permitted = false),
            status(name = "notifications", running = false),
            status(name = "files"),
        )
        val summary = heldBackSummary(statuses)!!
        assertTrue(summary, summary.startsWith("Not offered yet: mirror, photos, sms, notifications —"))
        // Four held back, four buckets, each counted once. Before `hold` existed this line read
        // "2 not built, 1 awaiting a permission" over a list of four.
        CapabilityHold.entries.forEach { assertTrue("$it missing from: $summary", summary.contains("1 ${it.summary}")) }
        assertFalse("an advertised capability must not be listed", summary.contains("files"))
    }

    @Test
    fun `a phone holding nothing back gets no line at all`() {
        assertNull(heldBackSummary(listOf(status(), status(name = "sms"))))
    }
}
