package com.chetan.connectsuite.setup

import com.chetan.connectsuite.onboarding.OnboardingCopy
import com.chetan.connectsuite.setup.SetupPlan.Mechanism
import com.chetan.connectsuite.setup.SetupPlan.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The checklist's rules, run against [SetupPlan] itself — the list the screen draws. */
class SetupPlanTest {

    @Test
    fun `the checklist's copy passes onboarding's forbidden-mechanism guard`() {
        assertEquals(emptyList<OnboardingCopy.Violation>(), OnboardingCopy.violations(SetupPlan.allText))
    }

    @Test
    fun `the guard can see a violation in this list, so its empty answer means something`() {
        assertTrue(OnboardingCopy.violations(SetupPlan.allText + "run adb tcpip 5555").isNotEmpty())
    }

    @Test
    fun `nearby devices is not asked for — the Mac link was measured not to need it (defect 69)`() {
        assertFalse(SetupPlan.items.any { it.id.contains("nearby") || it.title.contains("Nearby") })
    }

    @Test
    fun `the camera is reported, never requested, from this list`() {
        val camera = SetupPlan.items.single { it.id == SetupPlan.CAMERA }
        assertEquals(Mechanism.ReportOnly, camera.mechanism)
        assertNull(SetupPlan.actionLabel(camera, Status.NotAskedYet))
        assertNull(SetupPlan.actionLabel(camera, Status.Off))
    }

    @Test
    fun `every feature can be declined, and only the link's own grant cannot`() {
        val required = SetupPlan.items.filterNot { it.optional }.map { it.id }
        assertEquals(listOf(SetupPlan.NOTIFICATIONS), required)
    }

    @Test
    fun `texts, calls, contacts and photos each have a row that asks — defect 134`() {
        for (id in listOf(SetupPlan.TEXTS, SetupPlan.CALLS, SetupPlan.CONTACTS, SetupPlan.PHOTOS)) {
            val item = SetupPlan.items.single { it.id == id }
            assertEquals(id, Mechanism.Runtime, item.mechanism)
            assertEquals(id, "Allow", SetupPlan.actionLabel(item, Status.Off))
        }
    }

    @Test
    fun `special access goes to Settings, and a runtime grant Android stopped offering does too`() {
        val control = SetupPlan.items.single { it.id == SetupPlan.CONTROL }
        assertEquals("Open Settings", SetupPlan.actionLabel(control, Status.Off))
        val texts = SetupPlan.items.single { it.id == SetupPlan.TEXTS }
        assertEquals("Open Settings", SetupPlan.actionLabel(texts, Status.NeedsSettings))
        assertEquals("Turned off in Settings", SetupPlan.statusLabel(texts, Status.NeedsSettings))
    }

    @Test
    fun `an item that is on offers nothing, except folders, which can be managed`() {
        val texts = SetupPlan.items.single { it.id == SetupPlan.TEXTS }
        assertNull(SetupPlan.actionLabel(texts, Status.On))
        val folders = SetupPlan.items.single { it.id == SetupPlan.FOLDERS }
        assertEquals("Manage", SetupPlan.actionLabel(folders, Status.On))
        assertEquals("2 folders shared", SetupPlan.statusLabel(folders, Status.On, folderCount = 2))
    }

    @Test
    fun `the summary is a count with its denominator, and the camera is not in it`() {
        val all = SetupPlan.items.associate { it.id to Status.On }
        assertEquals("9 of 9 turned on", SetupPlan.summary(all))
        assertEquals("0 of 9 turned on", SetupPlan.summary(emptyMap()))
    }
}
