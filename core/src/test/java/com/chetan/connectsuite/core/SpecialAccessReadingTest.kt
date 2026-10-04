package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.CapabilityContract.SpecialAccess
import com.chetan.connectsuite.core.link.CapabilityStatus
import com.chetan.connectsuite.core.link.SpecialAccessReading
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 37 — a re-granted notification listener never turns its capabilities back on.
 *
 * ### What went wrong
 *
 * Found on hardware 2026-08-28 while setting up step 67's second precondition: revoke notification
 * access, then re-grant it. The listener rebound and the media-session listener attached, and the
 * capability set went on saying both were unavailable, permanently:
 *
 * ```
 * 17:14:57.000 I [notif]  Notification listener attached to the link
 * 17:14:57.002 I [caps]   Capabilities unchanged (calls,contacts,input,mirror,sms); reason changed:
 *                         notifications - missing Notification access; remote - missing Notification access
 * 17:14:57.003 I [remote] Media session listener attached; phone-side changes will now reach the Mac
 * ```
 *
 * Read `.002` against the two lines either side of it. The service is bound, and the capability
 * line says the access is missing. A fresh read of `enabled_notification_listeners` returned true
 * the whole time; the value the refresh acted on, ~2 ms after the write, did not.
 *
 * **This is defect 31 inverted** — 31 was a lit chip over dead wiring, 37 is a dark chip over live
 * wiring — and it is the same underlying error in both: the capability set disagreeing with what
 * is actually running.
 *
 * ### What this test covers, and what it cannot
 *
 * Two things were wrong and only this one is a pure function.
 *
 * 1. **The stale read** — fixed by [SpecialAccessReading.granted], which counts a bound component
 *    as proof of its own grant. That is what these tests pin.
 * 2. **The missing backstop** — `startWatching` was registered from `LinkServer.start()`, so the
 *    observer that would have healed a stale read did not exist while the server was down, which
 *    is when a user is most likely to be toggling grants. Fixed by moving it to `LinkServer`'s
 *    `init`. That is a lifetime, not a value, and it is verified on hardware instead: grant a
 *    capability with the link **down** and watch the set correct itself. See docs/testing.md.
 *
 * Each test below was run against the pre-fix expression (`granted = namedInSettings` alone) and
 * shown to fail before being kept, except where noted as a guard.
 */
class SpecialAccessReadingTest {

    private val notifications = CapabilityContract.contracts.getValue(Capability.NOTIFICATIONS).requests
    private val remote = CapabilityContract.contracts.getValue(Capability.REMOTE).requests
    private val input = CapabilityContract.contracts.getValue(Capability.INPUT).requests

    /** The whole detector path, minus the two Android statics: settings + bound, in and out. */
    private fun advertised(
        namedInSettings: Set<SpecialAccess>,
        bound: Set<SpecialAccess>,
        registered: Set<String>,
    ): Set<String> = CapabilityContract.advertisable(
        grantedPermissions = emptySet(),
        // Unchanged from before the fix: both halves, always. Only `granted` is read differently.
        specialAccessHeld = SpecialAccessReading.granted(namedInSettings, bound) intersect bound,
        registeredTypes = registered,
        videoServed = false,
        cameraServed = false,
        webcamServed = false,
        bulkServed = false,
        backgroundRestricted = false,
    )

    @Test
    fun `defect 37 - a bound listener whose setting reads stale-false is still granted`() {
        // The exact state at 17:14:57.002: bound, and the settings read has not landed.
        assertEquals(
            setOf(SpecialAccess.NOTIFICATION_LISTENER),
            SpecialAccessReading.granted(
                namedInSettings = emptySet(),
                bound = setOf(SpecialAccess.NOTIFICATION_LISTENER),
            ),
        )
    }

    @Test
    fun `defect 37 - notifications and remote come back on with the listener bound`() {
        assertEquals(
            "a bound listener must light both capabilities its grant covers",
            setOf(Capability.NOTIFICATIONS, Capability.REMOTE),
            advertised(
                namedInSettings = emptySet(),
                bound = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registered = notifications + remote,
            ),
        )
    }

    @Test
    fun `defect 37 - the reason must not read 'missing Notification access' over a bound service`() {
        // The user-visible half. This sentence, over a listener that is bound and working, is the
        // symptom: a greyed pane with a message telling someone to grant what they have granted.
        val permitted = SpecialAccess.NOTIFICATION_LISTENER in SpecialAccessReading.granted(
            namedInSettings = emptySet(),
            bound = setOf(SpecialAccess.NOTIFICATION_LISTENER),
        )
        val status = CapabilityStatus(
            name = Capability.NOTIFICATIONS,
            permitted = permitted,
            implemented = true,
            missing = emptyList(),
            missingPermissions = emptyList(),
            running = true,
        )
        assertTrue("must be advertised", status.advertised)
        assertNull("an advertised capability has no reason: ${status.reason}", status.reason)
    }

    // ---- guards: the invariants this fix must not have loosened ---------------------------

    @Test
    fun `a grant with nothing bound still advertises nothing`() {
        // RunningGateTest's first case, restated through the new reading so the fix cannot quietly
        // turn "granted" back into "advertised". This one passes before and after; it is a guard.
        assertEquals(
            emptySet<String>(),
            advertised(
                namedInSettings = setOf(
                    SpecialAccess.NOTIFICATION_LISTENER,
                    SpecialAccess.ACCESSIBILITY_SERVICE,
                ),
                bound = emptySet(),
                registered = notifications + remote + input,
            ),
        )
    }

    @Test
    fun `a bound listener does not carry the accessibility service with it`() {
        assertEquals(
            "one bound component grants its own access and no other",
            setOf(Capability.NOTIFICATIONS, Capability.REMOTE),
            advertised(
                namedInSettings = emptySet(),
                bound = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registered = notifications + remote + input,
            ),
        )
    }

    @Test
    fun `unbinding takes the capabilities away again`() {
        // The other direction, and the one that keeps this from being a one-way ratchet: the
        // settings entry surviving a teardown must not hold the chip up on its own. This is the
        // reinstall case RunningGateTest was written for, re-checked through the new reading.
        val stillNamed = setOf(SpecialAccess.NOTIFICATION_LISTENER)
        assertTrue(
            "bound: advertised",
            advertised(stillNamed, stillNamed, notifications).contains(Capability.NOTIFICATIONS),
        )
        assertFalse(
            "unbound: not advertised, even though Settings still names it",
            advertised(stillNamed, emptySet(), notifications).contains(Capability.NOTIFICATIONS),
        )
    }
}
