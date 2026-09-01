package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What `clipboard` promises, and the gate that was removed for a measured reason.
 *
 * The removal is the part worth a guard. Deleting a gate is exactly what a loosening looks like —
 * defect 54 is the case where loosening `containsAll` would have advertised a capability over a
 * dead verb — so this test states the difference: **the handler half is untouched and still
 * complete-or-nothing**, and what went is a *permission* gate on a rule this device does not
 * implement.
 */
class ClipContractTest {

    private val contract = CapabilityContract.contracts.getValue(Capability.CLIPBOARD)

    @Test
    fun `clipboard requires all three verbs and nothing less`() {
        assertEquals(
            setOf(MessageType.CLIP_PUSH, MessageType.CLIP_REQUEST, MessageType.CLIP_HISTORY),
            contract.requests,
        )
        assertEquals(
            "the feature must serve exactly what the contract demands",
            contract.requests,
            ClipFeature.handledTypes,
        )
    }

    @Test
    fun `two of three handlers is not a clipboard`() {
        val partial = ClipFeature.handledTypes - MessageType.CLIP_HISTORY
        assertFalse(
            "a capability advertised over a missing verb is the promise defect 54 was about",
            partial.containsAll(contract.requests),
        )
        assertTrue(ClipFeature.handledTypes.containsAll(contract.requests))
    }

    @Test
    fun `clipboard is gated on no permission and no special access, and that is the measurement`() {
        // Measured 2026-09-01 (docs/testing.md, Slice 11): background reads are refused with the
        // accessibility service bound and with it disabled alike — 90 of 90 and 60 of 60 — so the
        // grant this was gated on guards nothing here. The asymmetry lives in the answers instead:
        // an unfocused phone says PHONE_NOT_FOREGROUND rather than the pane going grey over a
        // Settings switch that cannot help.
        //
        // If someone re-adds a gate here, this test is where they have to argue with the reading.
        assertEquals(emptySet<String>(), contract.permissions)
        assertEquals(emptySet<Set<String>>(), contract.permissionAlternatives)
        assertEquals(null, contract.specialAccess)
    }

    @Test
    fun `clipboard needs neither side channel`() {
        // A clipboard entry is a small JSON payload on the control channel. The moment somebody
        // reaches for the bulk socket to carry one, the design has gone wrong — that is what the
        // 64 KB cap and the images-are-out-of-scope decision exist to prevent.
        assertFalse(contract.needsBulkChannel)
        assertFalse(contract.needsVideoChannel)
    }
}
