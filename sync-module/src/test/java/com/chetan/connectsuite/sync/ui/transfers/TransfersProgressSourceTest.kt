package com.chetan.connectsuite.sync.ui.transfers

import com.chetan.connectsuite.sync.SourceTree
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Transfers bar is the one that eases between byte counts (`ProgressMotion`). Wiring only. */
class TransfersProgressSourceTest {

    @Test
    fun `the transfers bar eases between readings`() {
        val screen = File(SourceTree.mainSources(), "com/chetan/connectsuite/sync/ui/transfers/TransfersScreen.kt").readText()
        val call = screen.substringAfter("SidekickProgress(").substringBefore(")\n")
        assertTrue(call, call.contains("easeBetweenReadings = true"))
    }
}
