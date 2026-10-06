package com.chetan.connectsuite.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pairing v2's wording on the phone: a scan says it is verifying, and "Paired" appears only through the
 * verified outcome (`ConnectStage.pairingOutcome`, tested in core's `ConnectStageTest`). These hold the
 * screens to that — the copy itself, and that each screen reaches its success text only from the
 * verified branch. Composables are not run here (no Robolectric); this reads their source.
 */
class PairingWordingTest {

    @Test fun `the scan copy is exactly the agreed sentence`() {
        assertEquals("Code scanned. Verifying your Mac…", OnboardingCopy.PAIR_VERIFYING_TITLE)
        assertTrue(OnboardingCopy.allText.contains(OnboardingCopy.PAIR_VERIFYING_TITLE))
        assertFalse("verifying copy must not claim success", OnboardingCopy.PAIR_VERIFYING_SUBTITLE.contains("Paired"))
    }

    private fun root(): File = listOf(File("."), File("..")).first { File(it, "app/src/main").isDirectory }
    private fun code(path: String) = File(root(), path).readText()
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("//[^\\n]*"), "")

    @Test fun `onboarding says Paired only from the verified outcome`() {
        val src = code("app/src/main/java/com/chetan/connectsuite/onboarding/OnboardingScreen.kt")
        assertEquals("one use of the success title", 1, Regex("PAIR_SUCCESS_TITLE").findAll(src).count())
        assertTrue("success lives in PairedState", Regex("fun PairedState[\\s\\S]*?PAIR_SUCCESS_TITLE").containsMatchIn(src))
        val calls = Regex("PairedState\\(").findAll(src).count()
        assertEquals("PairedState is defined once and called once", 2, calls)
        assertTrue("and called only for PairingOutcome.Paired", src.contains("PairingOutcome.Paired -> PairedState("))
        assertTrue("a scan shows the verifying title", src.contains("OnboardingCopy.PAIR_VERIFYING_TITLE"))
    }

    @Test fun `the Mac tab says Paired only for ConnectStage_Paired`() {
        val src = code("app/src/main/java/com/chetan/connectsuite/link/ConnectMacScreen.kt")
        val paired = Regex("\"Paired\"").findAll(src).count()
        assertEquals("the pill and the title — both on the Paired stage", 2, paired)
        assertTrue(src.contains("if (stage is ConnectStage.Paired) StatusPill(\"Paired\""))
        assertTrue(src.contains("is ConnectStage.Paired -> ConnectedStage("))
        assertTrue("the waiting stage says it is verifying", src.contains("Code scanned. Verifying your Mac\\u2026"))
    }
}
