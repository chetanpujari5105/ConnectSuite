package com.chetan.connectsuite.core.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 205's measurement switch: a debuggable build may run without the link's partial wake lock while a
 * marker file is present in its private storage, so the lock's effect can be measured on battery. A
 * release build always holds it — the marker cannot change shipped behaviour.
 */
class LinkLockPolicyTest {
    @Test
    fun `a debuggable build with the marker runs without the wake lock`() {
        assertEquals(false, LinkLockPolicy.holdsWakeLock(debuggable = true, markerPresent = true))
    }

    @Test
    fun `a release build holds the lock whatever is on disk, and so does a debug build without the marker`() {
        assertEquals(true, LinkLockPolicy.holdsWakeLock(debuggable = false, markerPresent = true))
        assertEquals(true, LinkLockPolicy.holdsWakeLock(debuggable = false, markerPresent = false))
        assertEquals(true, LinkLockPolicy.holdsWakeLock(debuggable = true, markerPresent = false))
    }

    @Test
    fun `the marker's name says what it does and which defect it is for`() {
        assertTrue(LinkLockPolicy.NO_WAKE_LOCK_MARKER.contains("205") && LinkLockPolicy.NO_WAKE_LOCK_MARKER.contains("no-link-wakelock"))
    }
}
