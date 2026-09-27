package com.chetan.connectsuite.probe

import android.content.pm.PackageManager
import com.chetan.connectsuite.probe.ShareManyComponents.Plan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The component harness touches exactly two components, needs an explicit on/off, and restores the default. */
class ShareManyComponentsTest {

    @Test fun `on enables, off restores the manifest default - never an explicit disable`() {
        assertEquals(Plan.Set("probe", "com.chetan.connectsuite.probe.ShareManyGrantProbeActivity", ShareManyComponents.ENABLED),
            ShareManyComponents.plan(true, "probe", true))
        assertEquals(Plan.Set("many", "com.chetan.connectsuite.probe.ShareManyToMacActivity", ShareManyComponents.DEFAULT),
            ShareManyComponents.plan(true, "many", false))
    }

    @Test fun `anything else is refused - another component, no component, no explicit state, a release build`() {
        for (c in listOf(null, "", "ShareToMacActivity", "com.chetan.connectsuite.ShareToMacActivity", "MANY")) {
            assertTrue("$c", ShareManyComponents.plan(true, c, true) is Plan.Refuse)
        }
        assertTrue(ShareManyComponents.plan(true, "probe", null) is Plan.Refuse)
        assertTrue(ShareManyComponents.plan(false, "probe", true) is Plan.Refuse)
        assertEquals(2, ShareManyComponents.ALLOWED.size)
    }

    @Test fun `the restated states are the platform's`() {
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, ShareManyComponents.DEFAULT)
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, ShareManyComponents.ENABLED)
    }
}
