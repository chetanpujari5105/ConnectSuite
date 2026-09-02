package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What `apps` promises, and the verb it must never grow.
 *
 * `scripts/check-apps-verb.mjs` guards the *source text* on both sides; this is the same rule
 * asserted against the **live objects** — the registered types and the capability contract as the
 * JVM actually loads them. The two are complementary rather than redundant, and the difference
 * matters: a grep cannot see a set built at runtime, and a JVM test cannot see a name that has not
 * been referenced. Between them a launch verb has nowhere to hide except a string assembled from
 * pieces, which is stated as this pair's bound rather than left implied.
 */
class AppsContractTest {

    private val contract = CapabilityContract.contracts.getValue(Capability.APPS)

    @Test
    fun `apps requires all three verbs and nothing less`() {
        assertEquals(
            setOf(MessageType.APPS_LIST, MessageType.APPS_ICON, MessageType.APPS_OPEN_ASK),
            contract.requests,
        )
        assertEquals(
            "the feature must serve exactly what the contract demands",
            contract.requests,
            AppsFeature.handledTypes,
        )
    }

    @Test
    fun `two of three handlers is not an apps capability`() {
        val partial = AppsFeature.handledTypes - MessageType.APPS_OPEN_ASK
        assertFalse(
            "a grid that lists and draws but cannot ask is not the feature; do not loosen containsAll",
            partial.containsAll(contract.requests),
        )
        assertTrue(AppsFeature.handledTypes.containsAll(contract.requests))
    }

    /**
     * The prohibition, asserted against the live sets rather than against source text.
     *
     * Measured 2026-09-03 (`docs/phase-7-apps-proposal.md` §2.4): a backgrounded `startActivity`
     * returns normally, logs nothing, and does not bring the app to the front. A verb named *launch*
     * would report success and do nothing — the fourth row of the decision table, which every
     * automated check calls a pass. This is one of the two checks that does not.
     */
    @Test
    fun `no verb in this namespace claims to launch anything`() {
        val everything = AppsFeature.handledTypes + contract.requests
        for (type in everything) {
            assertFalse(
                "$type promises a launch this platform refuses silently — see docs/protocol.md, " +
                    "\"The verb that does not exist\"",
                type.contains("launch"),
            )
        }
        // The positive control. Without it the loop above passes just as happily over an empty set,
        // which is the shape of a check that reads as evidence and is not.
        assertEquals(3, everything.size)
        assertTrue(everything.contains("apps.open.ask"))
    }

    /**
     * The gate, and why it is a permission rather than nothing.
     *
     * `clipboard` has no gate because its asymmetry lives in its answers. `apps` has one because a
     * whole verb is undeliverable without it: the only thing that opens an app from the Mac is a
     * person tapping a notification, so with notifications off the capability would be promising a
     * launcher that cannot launch.
     */
    @Test
    fun `apps is gated on notifications, because the tap is the only route there is`() {
        assertEquals(setOf("android.permission.POST_NOTIFICATIONS"), contract.permissions)
        assertTrue("no special access — this is an ordinary runtime grant", contract.specialAccess == null)

        val granted = setOf("android.permission.POST_NOTIFICATIONS")
        assertTrue(CapabilityContract.isPermitted(Capability.APPS, granted, emptySet()))
        assertFalse(CapabilityContract.isPermitted(Capability.APPS, emptySet(), emptySet()))
    }

    @Test
    fun `the chip that is off names the switch a person can find`() {
        // "missing POST_NOTIFICATIONS" tells somebody their feature is off without telling them
        // what to turn on — the failure SpecialAccess.label already records, reintroduced by a
        // missing entry in the label map rather than by any logic.
        assertEquals(
            listOf("Notifications"),
            CapabilityContract.missingPermissionsFor(Capability.APPS, emptySet(), emptySet()),
        )
    }
}
