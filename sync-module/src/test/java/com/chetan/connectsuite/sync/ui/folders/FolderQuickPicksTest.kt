package com.chetan.connectsuite.sync.ui.folders

import com.chetan.connectsuite.sync.v2.FsPaths
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one rule that keeps a quick pick from walking a user into the wall it exists to avoid.
 *
 * The chips were refused outright in `docs/phase-5-files-onboarding-proposal.md` §5 and shipped
 * after three hardware readings — `docs/testing.md` → Slice 9. Two of the readings are about what
 * the picker does and cannot be unit-tested at all. The third produced a constraint, and that is
 * what this file holds.
 */
class FolderQuickPicksTest {

    @Test
    fun `no chip may point inside Download, because a bad aim lands in its parent`() {
        // **The whole reason this file exists.** Measured on hardware: aimed at a folder that does
        // not exist, the picker opens in the *parent*. For anything under `Download` that parent is
        // the one directory DocumentsUI refuses — the confirm button is disabled and no error is
        // returned — so a chip whose folder happens to be missing would deliver the user precisely
        // onto the refusal the wall copy exists to keep them away from.
        assertFalse(FolderQuickPicks.isSafeTarget("primary:Download"))
        assertFalse(FolderQuickPicks.isSafeTarget("primary:Download/ConnectSuite"))
        assertFalse(FolderQuickPicks.isSafeTarget("primary:Download/anything/at/all"))
        // Case is not a defence: the document id comes from us today and from a settings file
        // tomorrow.
        assertFalse(FolderQuickPicks.isSafeTarget("primary:download/ConnectSuite"))
    }

    @Test
    fun `the volume root is not a safe target either`() {
        // DocumentsUI refuses the root of internal storage for the same reason and in the same way:
        // it lists normally and cannot be confirmed. Observed with `enabled="false"` on the confirm
        // button, `docs/evidence/saf-probe-2026-08-31/`.
        assertFalse(FolderQuickPicks.isSafeTarget("primary:"))
        assertFalse(FolderQuickPicks.isSafeTarget("primary"))
    }

    @Test
    fun `an ordinary folder is a safe target`() {
        // The control. A rule that refuses everything passes the test above and is useless.
        assertTrue(FolderQuickPicks.isSafeTarget("primary:DCIM/Camera"))
        assertTrue(FolderQuickPicks.isSafeTarget("primary:Documents"))
        // Not a false positive from a substring: `Downloads` is a different folder from `Download`,
        // and a `startsWith` check would refuse it.
        assertTrue(FolderQuickPicks.isSafeTarget("primary:Downloads2"))
    }

    @Test
    fun `every shipped chip passes the rule`() {
        // The rule guards nothing if the list it guards was never run through it. This is the guard
        // that would have caught §8.1's planned `Received files` chip, which pointed at
        // `Download/ConnectSuite`.
        for (pick in FolderQuickPicks.ALL) {
            assertTrue(
                "${pick.label} aims at ${pick.documentId}, which is not a safe target",
                FolderQuickPicks.isSafeTarget(pick.documentId),
            )
        }
        assertTrue("the chip list is empty, so the loop above proved nothing", FolderQuickPicks.ALL.isNotEmpty())
    }

    @Test
    fun `a chip predicts the root id the wire will actually report`() {
        // Two encoders that drift produce a chip that never hides itself after being granted, which
        // reads as the chip not working. There is one encoder: `FsPaths.rootIdForTree`, the same one
        // `fs.list` uses, and this asserts the chip goes through it rather than agreeing with it.
        val camera = FolderQuickPicks.ALL.single { it.label == "Camera" }
        assertEquals(FsPaths.rootIdForTree("primary:DCIM/Camera"), camera.rootIdIfGranted)
        assertTrue(
            "the root id must be escaped, not raw: ${camera.rootIdIfGranted}",
            camera.rootIdIfGranted.startsWith("saf:") && !camera.rootIdIfGranted.contains("/"),
        )
    }

    @Test
    fun `a folder already shared is not offered again`() {
        val camera = FolderQuickPicks.ALL.single { it.label == "Camera" }
        val offered = FolderQuickPicks.offered(setOf(camera.rootIdIfGranted))
        assertFalse("Camera is already shared and must not be offered", offered.contains(camera))
        // The control: hiding one chip must not hide the rest.
        assertEquals(FolderQuickPicks.ALL.size - 1, offered.size)
    }

    @Test
    fun `every chip granted is an empty rail, which the screen draws as nothing`() {
        val all = FolderQuickPicks.ALL.map { it.rootIdIfGranted }.toSet()
        assertTrue(FolderQuickPicks.offered(all).isEmpty())
    }
}
