package com.chetan.connectsuite

import com.chetan.connectsuite.sync.v2.ShareIntake.Availability
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The sheet's sentences, read from the one list the sheet draws from. Slice 1 sends nothing, so no
 * sentence may say a file was sent or saved, and "Ready" must say it was not.
 */
class ShareToMacCopyTest {

    private val all = ShareToMacCopy.everySentence().filter { it.isNotBlank() }

    @Test fun `the enumeration reaches every state (control)`() {
        assertTrue(all.size >= 30)
    }

    @Test fun `Ready says the file is prepared on this phone and not sent`() {
        val ready = ShareToMacCopy.detail(ShareSheetState.Ready("a.bin", "application/octet-stream", 100_000, Availability.NotConnected))
        assertTrue(ready, ready.contains("Prepared privately on this phone"))
        assertTrue(ready, ready.contains("has not been sent"))
        assertEquals("Ready on this phone", ShareToMacCopy.headline(ShareSheetState.Ready("a", "b/c", 0, Availability.NotConnected)))
    }

    @Test fun `every sentence that mentions sending says nothing was sent`() {
        all.filter { Regex("\\bsent\\b", RegexOption.IGNORE_CASE).containsMatchIn(it) }.forEach {
            assertTrue(it, it.contains("has not been sent") || it.contains("Nothing was sent"))
        }
    }

    @Test fun `no sentence claims anything was saved`() {
        all.forEach { assertFalse(it, Regex("\\bsaved\\b", RegexOption.IGNORE_CASE).containsMatchIn(it)) }
    }

    @Test fun `the only sentence placing something on the Mac denies it`() {
        all.filter { it.contains("on your Mac") }.forEach { assertTrue(it, it.contains("nothing is on your Mac")) }
    }

    @Test fun `a disconnected Mac and an unsupported one get different sentences, both saying why`() {
        val off = ShareToMacCopy.availability(Availability.NotConnected)
        val on = ShareToMacCopy.availability(Availability.NotSupported("Chetan’s MacBook Pro"))
        assertTrue(off, off.contains("isn’t connected"))
        assertTrue(on, on.contains("Chetan’s MacBook Pro") && on.contains("isn’t available"))
    }

    @Test fun `no sentence carries a package id`() {
        val pkg = Regex("\\b[a-z][a-z0-9_]*(\\.[a-z0-9_]+){2,}\\b")
        all.forEach { assertFalse(it, pkg.containsMatchIn(it)) }
    }

    @Test fun `sizes show the exact count and then a human form`() {
        assertEquals("0 bytes", ShareToMacCopy.bytes(0))
        assertEquals("100,000 bytes (97.7 KB)", ShareToMacCopy.bytes(100_000))
        assertEquals("230,778 bytes (225 KB)", ShareToMacCopy.bytes(230_778))
    }
}
