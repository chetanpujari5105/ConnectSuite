package com.chetan.connectsuite.core

import com.chetan.connectsuite.core.link.AdvertisedState
import com.chetan.connectsuite.core.link.CapabilityContract
import com.chetan.connectsuite.core.link.advertisementChanged
import com.chetan.connectsuite.core.permissions.MediaAccess
import com.chetan.connectsuite.core.permissions.MediaAccess.Companion.READ_EXTERNAL_STORAGE
import com.chetan.connectsuite.core.permissions.MediaAccess.Companion.READ_MEDIA_IMAGES
import com.chetan.connectsuite.core.permissions.MediaAccess.Companion.READ_MEDIA_VIDEO
import com.chetan.connectsuite.core.permissions.MediaAccess.Companion.READ_MEDIA_VISUAL_USER_SELECTED
import com.chetan.connectsuite.core.protocol.Capability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Defect 139: one full / selected-only / none state for photos, read the same way by the capability
 * the Mac sees and by the checklist on the phone.
 *
 * Every input here is a **granted set**, which is what the OS reports; the one thing a JVM test
 * cannot reach is what Android actually grants for each dialog choice. That was measured on the
 * emulator before the fix (a limited pick without the selected-photos declaration came back as a
 * one-time compatibility grant) and is owed again after it — see `docs/testing.md`.
 */
class MediaAccessTest {

    private val full = setOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO)
    private val selected = setOf(READ_MEDIA_VISUAL_USER_SELECTED)

    @Test
    fun `both media permissions are full access`() {
        assertEquals(MediaAccess.FULL, MediaAccess.of(full))
    }

    @Test
    fun `full wins when Android also reports the selected-photos grant`() {
        assertEquals(MediaAccess.FULL, MediaAccess.of(full + selected))
    }

    @Test
    fun `the selected-photos grant alone is selected, never full`() {
        assertEquals(MediaAccess.SELECTED, MediaAccess.of(selected))
    }

    @Test
    fun `images without videos is not full — the videos would be invisible`() {
        assertEquals(MediaAccess.DENIED, MediaAccess.of(setOf(READ_MEDIA_IMAGES)))
        assertEquals(MediaAccess.SELECTED, MediaAccess.of(setOf(READ_MEDIA_IMAGES) + selected))
    }

    @Test
    fun `storage is full access below Android 13, and nothing is none`() {
        assertEquals(MediaAccess.FULL, MediaAccess.of(setOf(READ_EXTERNAL_STORAGE)))
        assertEquals(MediaAccess.DENIED, MediaAccess.of(emptySet()))
    }

    @Test
    fun `Android 14 and later ask for the selected-photos permission with the other two`() {
        assertEquals(listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED), MediaAccess.requestFor(34))
        assertEquals(listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED), MediaAccess.requestFor(36))
        assertEquals(listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO), MediaAccess.requestFor(33))
        assertEquals(listOf(READ_EXTERNAL_STORAGE), MediaAccess.requestFor(32))
    }

    // ---- the capability the Mac sees, from the same state --------------------------------------

    @Test
    fun `the photos capability is permitted exactly when access is not none`() {
        val cases = listOf(full, selected, full + selected, setOf(READ_EXTERNAL_STORAGE), emptySet(), setOf(READ_MEDIA_IMAGES))
        cases.forEach { granted ->
            assertEquals(
                "permitted for $granted",
                MediaAccess.of(granted) != MediaAccess.DENIED,
                CapabilityContract.isPermitted(Capability.PHOTOS, granted, emptySet()),
            )
        }
    }

    @Test
    fun `selected-only photos is advertised with a limited reason, the phone's own sentence`() {
        val limits = CapabilityContract.limitations(setOf(Capability.PHOTOS, Capability.FILES), selected)
        assertEquals(mapOf(Capability.PHOTOS to MediaAccess.SELECTED_REASON), limits)
        assertTrue(MediaAccess.SELECTED_REASON.startsWith("Some photos allowed"))
    }

    @Test
    fun `full photos carries no limitation, and an unadvertised capability is never limited`() {
        assertEquals(emptyMap<String, String>(), CapabilityContract.limitations(setOf(Capability.PHOTOS), full))
        assertEquals(emptyMap<String, String>(), CapabilityContract.limitations(emptySet(), selected))
    }

    @Test
    fun `full to selected-only is a change the Mac is sent, though no name moved`() {
        val names = setOf(Capability.PHOTOS)
        val before = AdvertisedState(names, emptyMap(), CapabilityContract.limitations(names, full))
        val after = AdvertisedState(names, emptyMap(), CapabilityContract.limitations(names, selected))
        assertTrue(advertisementChanged(before, after))
        assertFalse(advertisementChanged(after, after.copy()))
    }

    /**
     * The root cause of defect 139 was a missing declaration: without it Android runs the app in
     * compatibility mode and a limited pick comes back as a one-time full grant. `CapabilityPermission
     * Test` is satisfied by any one declared alternative, so it stayed green with this line deleted —
     * this is the check that goes red.
     */
    @Test
    fun `every permission MediaAccess asks for is declared in the app manifest`() {
        val manifest = File("../app/src/main/AndroidManifest.xml")
        assertTrue("app manifest not found at ${manifest.absolutePath}", manifest.exists())
        val text = manifest.readText()
        val asked = (32..36).flatMap { MediaAccess.requestFor(it) }.toSet()
        assertTrue("control: the request lists must name the selected-photos permission", READ_MEDIA_VISUAL_USER_SELECTED in asked)
        val undeclared = asked.filterNot { text.contains("android:name=\"$it\"") }
        assertEquals("requested but not declared", emptyList<String>(), undeclared)
    }
}
