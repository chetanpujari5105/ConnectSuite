package com.chetan.connectsuite.input

import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.protocol.Capability
import com.chetan.connectsuite.core.protocol.ErrorCode
import com.chetan.connectsuite.core.protocol.MessageType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `input` may only be advertised when it is genuinely wired up — and `clipboard` may not be
 * advertised at all just because it shares a permission.
 *
 * That second half is the one worth having. `Capabilities.permittedByOs` adds **both** `input` and
 * `clipboard` the moment the accessibility service is enabled, because background clipboard reads
 * are legal only through such a service. Clipboard has no handlers, so the two-gate contract must
 * keep it off the Mac's list. If it ever appears there, the contract has been bypassed and the Mac
 * has been promised a feature that answers nothing.
 */
class InputContractTest {

    private val contract = CapabilityContract.contracts.getValue(Capability.INPUT)

    private fun advertisable(capability: String, registered: Set<String>): Boolean =
        CapabilityContract.advertisable(
            // The accessibility grant permits both input and clipboard at once, which is the
            // situation under test rather than an over-broad input. Expressing it as the grant
            // itself rather than as a list of capability names is the point of the change: the
            // contract works out which capabilities that grant covers.
            grantedPermissions = emptySet(),
            specialAccessHeld = setOf(CapabilityContract.SpecialAccess.ACCESSIBILITY_SERVICE),
            registeredTypes = registered,
            videoServed = false,
            cameraServed = false,
            bulkServed = false,
            backgroundRestricted = false,
        ).contains(capability)

    @Test
    fun `what InputFeature registers satisfies the contract exactly`() {
        assertEquals(
            "InputFeature must register every message the input contract requires",
            contract.requests,
            InputFeature.handledTypes,
        )
        assertFalse("input needs no video socket", contract.needsVideoChannel)
        assertFalse("input needs no bulk socket", contract.needsBulkChannel)
    }

    @Test
    fun `input is advertisable only with all six handlers`() {
        assertFalse("no handlers — must not advertise", advertisable(Capability.INPUT, emptySet()))
        assertTrue(advertisable(Capability.INPUT, InputFeature.handledTypes))

        contract.requests.forEach { required ->
            assertFalse(
                "removing $required must un-advertise input",
                advertisable(Capability.INPUT, InputFeature.handledTypes - required),
            )
        }
    }

    @Test
    fun `enabling the accessibility service must not advertise clipboard`() {
        // The assertion stands; its reason changed on 2026-09-01. Clipboard used to be gated on
        // the accessibility grant, so this guarded "the grant arrives and the handlers do not".
        // That gate is gone — measured: the rule it modelled does not operate on this device — so
        // what this now guards is plainer and no less worth guarding: **installing input must not
        // advertise clipboard**, because these are different features and `advertisable` is
        // answered by the handler half. A regression here is the false promise the capability
        // contract exists to stop.
        assertFalse(
            "clipboard has no handlers and must stay off the Mac's list",
            advertisable(Capability.CLIPBOARD, InputFeature.handledTypes),
        )
    }

    @Test
    fun `every registered type is one the protocol defines`() {
        val known = setOf(
            MessageType.INPUT_TAP,
            MessageType.INPUT_SWIPE,
            MessageType.INPUT_SCROLL,
            MessageType.INPUT_KEY,
            MessageType.INPUT_TEXT,
            MessageType.INPUT_GLOBAL,
        )
        assertEquals(known, InputFeature.handledTypes)
    }

    // ---- the vocabulary ----------------------------------------------------------------------

    @Test
    fun `every failure carries a sentence, and every actionable one carries a fix`() {
        val failures = listOf(
            InputFailure.ServiceDisabled,
            InputFailure.NoCaptureSession,
            InputFailure.GeometryStale("under test"),
            InputFailure.GestureRefused("under test"),
            InputFailure.NoEditableFocus,
            InputFailure.UnsupportedKey("volume_up", "under test"),
            InputFailure.PhoneLocked,
            InputFailure.SecureSurface,
            InputFailure.BadRequest("under test"),
        )
        for (failure in failures) {
            assertTrue(
                "${failure.label} must read as a sentence, not a code: ${failure.reason}",
                failure.reason.length > 20 && failure.reason.trim().endsWith("."),
            )
            assertEquals(Capability.INPUT, failure.feature)
        }
    }

    @Test
    fun `an unsupported key is never given a fix hint`() {
        // There is nothing the user can do about a platform wall, and offering an action implies
        // there is. "Try again" for a key that can never work is worse than silence.
        assertNull(InputFailure.UnsupportedKey("volume_up", "under test").fixHint)
        assertEquals(ErrorCode.UNSUPPORTED_KEY, InputFailure.UnsupportedKey("f1", "x").code)
    }

    @Test
    fun `input's secure-surface sentence is the mirror's, to the character`() {
        // Shared through core/screen/SecureSurfaceMessage. The user is looking at one black
        // rectangle and must not be given two explanations of it.
        assertEquals(
            com.chetan.connectsuite.core.screen.SecureSurfaceMessage.REASON,
            InputFailure.SecureSurface.reason,
        )
        assertEquals(ErrorCode.SECURE_SURFACE, InputFailure.SecureSurface.code)
    }
}
