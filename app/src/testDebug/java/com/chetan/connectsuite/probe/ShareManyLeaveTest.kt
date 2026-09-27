package com.chetan.connectsuite.probe

import com.chetan.connectsuite.probe.ShareManyLeave.Action
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The several-files screen's `onStop` rule (§11): leaving ends every file not yet offered, whether the
 * screen is finishing (Back) or not (Home); a rotation ends nothing; one file keeps the single-file rule.
 * Reaches the decision only — the activity that calls it has no JVM test.
 */
class ShareManyLeaveTest {

    @Test fun `Back - already finishing - still ends the selection in onStop, not later in onCleared`() {
        assertEquals(Action.END_SELECTION, ShareManyLeave.onStop(changingConfigurations = false, finishing = true, singleFile = false))
    }

    @Test fun `Home - not finishing - ends the selection and finishes the screen`() {
        assertEquals(Action.END_SELECTION_AND_FINISH, ShareManyLeave.onStop(changingConfigurations = false, finishing = false, singleFile = false))
    }

    @Test fun `a rotation ends nothing, for several files or one`() {
        for (finishing in listOf(false, true)) for (single in listOf(false, true)) {
            assertEquals("finishing=$finishing single=$single", Action.STAY, ShareManyLeave.onStop(true, finishing, single))
        }
    }

    @Test fun `one file keeps the single-file sheet's rule whether finishing or not`() {
        assertEquals(Action.SINGLE_FILE_RULE, ShareManyLeave.onStop(false, finishing = true, singleFile = true))
        assertEquals(Action.SINGLE_FILE_RULE, ShareManyLeave.onStop(false, finishing = false, singleFile = true))
    }

    @Test fun `no leave of several files is left without ending the selection (control over every combination)`() {
        val several = listOf(false, true).map { ShareManyLeave.onStop(false, it, singleFile = false) }
        assertEquals(2, several.size)
        several.forEach { assertEquals(true, it == Action.END_SELECTION || it == Action.END_SELECTION_AND_FINISH) }
    }
}
