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

    @Test
    fun `every row's buttons name their own feature for a screen reader`() {
        SetupPlan.items.forEach { item ->
            listOf(SetupPlan.actionLabel(item, Status.Off), SetupPlan.NOT_NOW).filterNotNull().forEach { label ->
                val said = SetupPlan.buttonDescription(item, label)
                assertTrue("'$said' does not name '${item.title}'", said.contains(item.title))
                assertTrue("'$said' does not say what the button does", said.contains(label))
            }
        }
    }

    @Test
    fun `the battery row's button says Allow, because Android answers it with a dialog here`() {
        val battery = SetupPlan.items.single { it.id == SetupPlan.BATTERY }
        assertEquals("Allow", SetupPlan.actionLabel(battery, Status.Off))
        // Once refused for good, Settings is the only route left, and the label says so.
        assertEquals("Open Settings", SetupPlan.actionLabel(battery, Status.NeedsSettings))
        // The other special-access rows really do open Settings.
        val control = SetupPlan.items.single { it.id == SetupPlan.CONTROL }
        assertEquals("Open Settings", SetupPlan.actionLabel(control, Status.Off))
    }

    // ---- defect 139: selected-only photos ----------------------------------------------------

    private val photos get() = SetupPlan.items.single { it.id == SetupPlan.PHOTOS }

    @Test
    fun `selected-only photos says so, and offers the platform's change-selection flow`() {
        assertEquals("Some photos allowed", SetupPlan.statusLabel(photos, Status.Limited))
        assertEquals("Change selection", SetupPlan.actionLabel(photos, Status.Limited))
    }

    @Test
    fun `selected-only is neither On nor Off in words, and counts as a feature that works`() {
        assertFalse(SetupPlan.statusLabel(photos, Status.Limited) == SetupPlan.statusLabel(photos, Status.On))
        assertFalse(SetupPlan.statusLabel(photos, Status.Limited) == SetupPlan.statusLabel(photos, Status.NeedsSettings))
        assertTrue(SetupPlan.isWorking(Status.Limited))
        val counted = SetupPlan.items.filter { it.mechanism != Mechanism.ReportOnly }
        assertEquals("1 of ${counted.size} turned on", SetupPlan.summary(mapOf(SetupPlan.PHOTOS to Status.Limited)))
    }

    @Test
    fun `selected-only photos also offers app settings, with change selection still first`() {
        assertEquals("Change selection", SetupPlan.actionLabel(photos, Status.Limited))
        assertEquals("Open app settings", SetupPlan.secondaryActionLabel(photos, Status.Limited))
        assertEquals(
            "Open app settings: Photos and videos",
            SetupPlan.buttonDescription(photos, SetupPlan.secondaryActionLabel(photos, Status.Limited)!!),
        )
    }

    @Test
    fun `the second action names the page it reaches, not the one it cannot`() {
        val label = SetupPlan.secondaryActionLabel(photos, Status.Limited)!!
        // It lands on App info (SpecialAccess.appDetailsIntent); the Photos page is closed to apps.
        assertFalse(label, label.contains("photo", ignoreCase = true))
        assertEquals("Tap Permissions, then Photos and videos.", SetupPlan.secondaryGuidance(photos, Status.Limited))
    }

    @Test
    fun `the guidance appears only where the second action does`() {
        for (item in SetupPlan.items) for (status in Status.entries) {
            assertEquals(
                "${item.id} / $status",
                SetupPlan.secondaryActionLabel(item, status) != null,
                SetupPlan.secondaryGuidance(item, status) != null,
            )
        }
    }

    @Test
    fun `no other row or state has a second action`() {
        var checked = 0
        for (item in SetupPlan.items) for (status in Status.entries) {
            if (item.id == SetupPlan.PHOTOS && status == Status.Limited) continue
            assertEquals("${item.id} / $status", null, SetupPlan.secondaryActionLabel(item, status))
            checked++
        }
        // Control: the loop really covered every other pair, so its silence means something.
        assertEquals(SetupPlan.items.size * Status.entries.size - 1, checked)
    }

    @Test
    fun `the Mac's limited reason and the phone's row say the same first words`() {
        assertTrue(
            com.chetan.connectsuite.core.permissions.MediaAccess.SELECTED_REASON
                .startsWith(SetupPlan.statusLabel(photos, Status.Limited)),
        )
    }
}
