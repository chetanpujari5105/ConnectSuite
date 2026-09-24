package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The guard rail for capability honesty.
 *
 * `hello.ack` advertising a capability is a promise to the Mac that the feature works. Deriving
 * that from permission grants alone once advertised `mirror`, `files` and `apps` on a build where
 * none of the three had a single handler — the Mac un-greyed those panes and every click came back
 * `FEATURE_UNAVAILABLE`.
 *
 * The first test here is the one that matters: with nothing registered, nothing may be advertised,
 * no matter how many permissions the user has granted. It fails loudly the moment someone adds a
 * capability without wiring its handlers.
 */
class CapabilityContractTest {

    /**
     * Every permission and both Settings toggles granted — the most permissive input possible.
     *
     * Taken from the contract rather than written out, so a capability that gains a permission
     * cannot quietly make this test less permissive than its name claims.
     */
    private val allPermissions = CapabilityContract.allDeclaredPermissions()
    private val allSpecialAccess = CapabilityContract.SpecialAccess.entries.toSet()

    @Test
    fun `no handlers registered means nothing is advertised`() {
        val advertised = CapabilityContract.advertisable(
            grantedPermissions = allPermissions,
            specialAccessHeld = allSpecialAccess,
            registeredTypes = emptySet(),
            videoServed = false,
            bulkServed = false,
            backgroundRestricted = false,
        )

        assertEquals(
            "A capability with no handler must never be advertised, even when its permission " +
                "is granted. Advertised anyway: $advertised",
            emptySet<String>(),
            advertised,
        )
    }

    @Test
    fun `every capability requires every one of its declared handlers`() {
        for ((capability, contract) in CapabilityContract.contracts) {
            if (contract.requests.isEmpty()) continue

            // All handlers but one, plus both side channels: still not enough.
            for (omitted in contract.requests) {
                val partial = contract.requests - omitted
                assertFalse(
                    "$capability was advertised while missing a handler for $omitted",
                    CapabilityContract.isImplemented(
                        capability = capability,
                        registeredTypes = partial,
                        videoServed = true,
                        bulkServed = true,
                    ),
                )
            }

            // The complete set, with both side channels served, is enough.
            assertTrue(
                "$capability has all its handlers and both channels but is still not implemented",
                CapabilityContract.isImplemented(
                    capability = capability,
                    registeredTypes = contract.requests,
                    videoServed = true,
                    bulkServed = true,
                ),
            )
        }
    }

    @Test
    fun `mirror needs the video channel and files needs the bulk channel`() {
        val mirror = CapabilityContract.contracts.getValue(Capability.MIRROR)
        assertFalse(
            "mirror advertised with no video channel sink — the Mac would get a session that " +
                "never delivers a frame",
            CapabilityContract.isImplemented(
                Capability.MIRROR,
                registeredTypes = mirror.requests,
                videoServed = false,
                bulkServed = true,
            ),
        )

        val files = CapabilityContract.contracts.getValue(Capability.FILES)
        assertFalse(
            "files advertised with no bulk channel sink",
            CapabilityContract.isImplemented(
                Capability.FILES,
                registeredTypes = files.requests,
                videoServed = true,
                bulkServed = false,
            ),
        )
    }

    @Test
    fun `a capability with no wire protocol is never advertisable`() {
        // `mic` has no mic.* messages in docs/protocol.md. An empty requirement set must not be
        // read as "nothing required" — that vacuous truth is exactly how this bug class starts.
        assertFalse(
            "mic has no protocol messages defined but was advertised anyway",
            CapabilityContract.isImplemented(
                Capability.MIC,
                registeredTypes = emptySet(),
                videoServed = true,
                bulkServed = true,
            ),
        )
        assertEquals(
            listOf("no wire protocol defined yet"),
            CapabilityContract.missingFor(Capability.MIC, emptySet(), true, true),
        )
    }

    @Test
    fun `an unknown capability is never advertised`() {
        assertFalse(
            CapabilityContract.isImplemented("teleport", setOf("teleport.now"), true, true),
        )
    }

    @Test
    fun `permission alone never advertises and implementation alone never advertises`() {
        val contacts = CapabilityContract.contracts.getValue(Capability.CONTACTS).requests

        assertEquals(
            "implemented but not permitted must stay off",
            emptySet<String>(),
            CapabilityContract.advertisable(
                grantedPermissions = emptySet(),
                specialAccessHeld = emptySet(),
                registeredTypes = contacts,
                videoServed = true,
                bulkServed = true,
                backgroundRestricted = false,
            ),
        )
        assertEquals(
            "permitted but not implemented must stay off",
            emptySet<String>(),
            CapabilityContract.advertisable(
                grantedPermissions = setOf("android.permission.READ_CONTACTS"),
                specialAccessHeld = emptySet(),
                registeredTypes = emptySet(),
                videoServed = true,
                bulkServed = true,
                backgroundRestricted = false,
            ),
        )
        assertEquals(
            "both halves present must turn it on",
            setOf(Capability.CONTACTS),
            CapabilityContract.advertisable(
                grantedPermissions = setOf("android.permission.READ_CONTACTS"),
                specialAccessHeld = emptySet(),
                registeredTypes = contacts,
                videoServed = true,
                bulkServed = true,
                backgroundRestricted = false,
            ),
        )
    }

    @Test
    fun `every capability name in the protocol has a contract`() {
        // Guards the next phase: adding a name to Capability without deciding what it requires
        // would otherwise silently fall through isImplemented's "unknown" branch forever.
        val declared = setOf(
            Capability.MIRROR, Capability.INPUT, Capability.NOTIFICATIONS, Capability.SMS,
            Capability.CALLS, Capability.CONTACTS, Capability.FILES, Capability.PHOTOS,
            Capability.CLIPBOARD, Capability.REMOTE, Capability.APPS, Capability.MIC,
            Capability.SHARE,
        )
        assertEquals(
            "every Capability constant needs an entry in CapabilityContract.contracts",
            declared,
            CapabilityContract.allCapabilities,
        )
    }

    @Test
    fun `contracts only require inbound requests, never phone-pushed events`() {
        // Requiring a handler for an event the phone *sends* could never be satisfied, so the
        // capability would be permanently dark for a reason nobody could find.
        val outboundOnly = setOf(
            MessageType.NOTIF_POSTED,
            MessageType.NOTIF_REMOVED,
            MessageType.SMS_RECEIVED,
            MessageType.CALL_INCOMING,
            MessageType.CALL_ENDED,
            MessageType.CAPABILITIES_CHANGED,
            MessageType.BATTERY_STATE,
            MessageType.NET_STATE,
            MessageType.FS_TRANSFER_PROGRESS,
            MessageType.FS_TRANSFER_DONE,
        )
        for ((capability, contract) in CapabilityContract.contracts) {
            val offenders = contract.requests intersect outboundOnly
            assertTrue(
                "$capability requires handlers for events the phone sends, not receives: $offenders",
                offenders.isEmpty(),
            )
        }
    }
}
