package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.CapabilityStatus
import com.chetan.connectsuite.core.link.WITHHELD_REASON
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Audit 2026-10-14, G2: a capability this build withholds by release policy (Camera v1 in a release
 * build) told the Mac `not built yet — waiting on camera.request, camera.stop, camera.switch, camera
 * channel unserved`, and the Mac's Camera pane drew it verbatim. The rule: a withheld capability's
 * reason is one plain sentence, whatever else is missing.
 *
 * Reaches [CapabilityStatus.reason]. Not reached: `CapabilityDetector.diagnostics()` passing the flag
 * (it needs a `Context`) and `CameraFeature.install` calling `withhold` (source-scanned in
 * `CameraReleaseGateTest`).
 */
class WithheldReasonTest {

    private fun camera(withheld: Boolean) = CapabilityStatus(
        name = "camera",
        permitted = true,
        implemented = false,
        missing = listOf("camera.request", "camera.stop", "camera.switch", "camera channel unserved"),
        withheld = withheld,
    )

    @Test
    fun `a withheld capability says so in plain words, never the handler list`() {
        assertEquals("Not available in this beta yet.", camera(withheld = true).reason)
        assertEquals(WITHHELD_REASON, camera(withheld = true).reason)
    }

    @Test
    fun `withheld wins over a missing permission and a background restriction`() {
        val status = camera(withheld = true).copy(
            permitted = false,
            missingPermissions = listOf("Camera"),
            backgroundRestricted = true,
        )
        assertEquals(WITHHELD_REASON, status.reason)
    }

    @Test
    fun `a withheld capability is never advertised, even with every other half present`() {
        val whole = camera(withheld = true).copy(implemented = true, missing = emptyList())
        assertFalse(whole.advertised)
    }

    @Test
    fun `control - an unimplemented capability that is not withheld keeps the developer reason`() {
        val reason = camera(withheld = false).reason!!
        assertTrue(reason, reason.startsWith("not built yet — waiting on camera.request"))
    }
}
