package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.CapabilityContract.SpecialAccess
import com.chetan.connectsuite.core.link.CapabilityStatus
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A grant is not a running component, and a capability needs both.
 *
 * ### What went wrong
 *
 * Found on hardware 2026-08-27, during the first run of the notifications acceptance steps. Three
 * capabilities — `input`, `notifications` and `remote` — were advertised to the Mac while nothing
 * was behind any of them, and would have refused every request:
 *
 * ```
 * 15:46:51.908 I [notif]  Notification feature installed; listener is not bound
 * 15:46:51.908 I [caps]   Capabilities now: input,mirror,notifications
 * 15:46:51.913 I [caps]   Capabilities now: input,mirror,notifications,remote
 * ```
 *
 * `enabled_notification_listeners` named the service; `dumpsys activity services` showed its
 * `ServiceRecord` with `app=null`; it was absent from the platform's live-listener list. The
 * accessibility service was observed in the same state at the same time, with the app process
 * down.
 *
 * **Reinstalling the APK tears down both bound components, and the
 * `NotificationListenerService` does not come back, while the secure setting goes on naming it.**
 * So its grant reads as granted indefinitely — not for a moment — and during development that is
 * every single install.
 *
 * The `AccessibilityService` does not behave that way once the process is running again: on both
 * reinstalls measured on 2026-08-27 (23:13:15 and 23:19:02) it logged `Accessibility service
 * connected` within 40ms of process start, unaided, and `input` went green. Whether the earlier
 * `app=null` sighting differs because that observation was taken with the process down has not
 * been tested, so it is recorded as two observations rather than explained as one rule. Either way
 * the gate is unaffected: it asks the owning module through `requireRunning` instead of assuming,
 * which is the entire point of supplying it from the feature modules. See docs/testing.md.
 *
 * ### Why the existing gates could not catch it
 *
 * Both were passing and both were right. The permission gate correctly reported a grant; the
 * handler gate correctly reported registered handlers. The specification was what was wrong: it
 * assumed a grant implied something running, which is true for a runtime permission and false for
 * the two capabilities backed by a Settings toggle. This is the third instance of one family —
 * `calls` gated on two of four permissions, `sms` requiring a permission declared nowhere, and now
 * a grant with nothing behind it — and all three are the same question: does the thing we are
 * promising actually work.
 */
class RunningGateTest {

    private val notifications = CapabilityContract.contracts.getValue(Capability.NOTIFICATIONS).requests
    private val remote = CapabilityContract.contracts.getValue(Capability.REMOTE).requests
    private val input = CapabilityContract.contracts.getValue(Capability.INPUT).requests

    /** What the detector now passes down: granted **and** running. */
    private fun advertised(
        granted: Set<SpecialAccess>,
        running: Set<SpecialAccess>,
        registered: Set<String>,
    ): Set<String> = CapabilityContract.advertisable(
        grantedPermissions = emptySet(),
        specialAccessHeld = granted intersect running,
        registeredTypes = registered,
        videoServed = false,
        bulkServed = false,
        backgroundRestricted = false,
    )

    @Test
    fun `a granted but unbound listener advertises nothing`() {
        // The exact hardware state of the 15:46:51 run.
        assertEquals(
            "granted with nothing running must advertise nothing",
            emptySet<String>(),
            advertised(
                granted = setOf(SpecialAccess.NOTIFICATION_LISTENER, SpecialAccess.ACCESSIBILITY_SERVICE),
                running = emptySet(),
                registered = notifications + remote + input,
            ),
        )
    }

    @Test
    fun `binding the service is what turns the capabilities on`() {
        assertEquals(
            setOf(Capability.NOTIFICATIONS, Capability.REMOTE),
            advertised(
                granted = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                running = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registered = notifications + remote,
            ),
        )
    }

    @Test
    fun `running without the grant is not enough either`() {
        // The reverse case, which cannot happen through Settings but can through a stale supplier
        // — a module that cached "connected" across a revocation. Both halves, always.
        assertEquals(
            emptySet<String>(),
            advertised(
                granted = emptySet(),
                running = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registered = notifications,
            ),
        )
    }

    @Test
    fun `the two toggles are independent of each other`() {
        // One grant covers notifications and remote; it must not carry input along with it.
        assertEquals(
            setOf(Capability.NOTIFICATIONS, Capability.REMOTE),
            advertised(
                granted = setOf(SpecialAccess.NOTIFICATION_LISTENER, SpecialAccess.ACCESSIBILITY_SERVICE),
                running = setOf(SpecialAccess.NOTIFICATION_LISTENER),
                registered = notifications + remote + input,
            ),
        )
    }

    @Test
    fun `capabilities with no Settings toggle are untouched by the running gate`() {
        // Mirror, files and apps have no special access, so `running` must default true for them
        // rather than making the new gate a fourth way for them to be switched off.
        val status = CapabilityStatus(
            name = Capability.MIRROR,
            permitted = true,
            implemented = true,
            missing = emptyList(),
        )
        assertTrue("a capability with no component must default to running", status.running)
        assertTrue(status.advertised)
    }

    // ---- the sentence ---------------------------------------------------------------------

    @Test
    fun `a granted-but-not-running capability does not tell the user to grant it`() {
        val status = CapabilityStatus(
            name = Capability.NOTIFICATIONS,
            permitted = true,
            implemented = true,
            missing = emptyList(),
            missingPermissions = emptyList(),
            running = false,
        )
        assertFalse("must not be advertised", status.advertised)
        val reason = status.reason!!
        // The whole point of the third gate having its own sentence. Telling someone to turn on a
        // switch that is already on is worse than saying nothing: they go looking for a setting
        // they have already set, and conclude the feature is broken rather than unbound.
        assertTrue("must say it is already granted: $reason", reason.contains("granted in Settings"))
        assertTrue("must name the cause: $reason", reason.contains("reinstalled"))
        assertTrue("must give the actual fix: $reason", reason.contains("off and on"))
        assertFalse(
            "must not read as an ungranted permission: $reason",
            reason.startsWith("missing"),
        )
    }

    @Test
    fun `an ungranted capability still says which permission is missing`() {
        val status = CapabilityStatus(
            name = Capability.NOTIFICATIONS,
            permitted = false,
            implemented = true,
            missing = emptyList(),
            missingPermissions = listOf(SpecialAccess.NOTIFICATION_LISTENER.label),
            running = false,
        )
        // Not permitted outranks not running: there is no point telling someone to rebind a
        // service they have never allowed.
        assertTrue(status.reason!!.contains("Notification access"))
    }
}
