package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The clipboard feature's sentences a person reads — the `message` and `fixHint` the Mac shows verbatim,
 * and the clip label other clipboard apps display — name the app by its current name (2026-10-09; the
 * release run saw *"open ConnectSuite"* on the Mac). Package names and comments are not sentences and are
 * not read.
 */
class ClipCopyNameTest {
    private fun source(): String =
        listOf("src/main/java/com/chetan/connectsuite/sync/v2/ClipFeature.kt",
            "sync-module/src/main/java/com/chetan/connectsuite/sync/v2/ClipFeature.kt").map(::File).first { it.isFile }.readText()

    @Test
    fun `no person-facing clipboard sentence names the old app`() {
        val sentences = Regex("""(?:message|fixHint)\s*=\s*"([^"]*)"|newPlainText\("([^"]*)\"""").findAll(source())
            .map { it.groupValues[1] + it.groupValues[2] }.toList()
        assertTrue("control: the sentences were found (${sentences.size})", sentences.size >= 3)
        assertEquals(emptyList<String>(), sentences.filter { "ConnectSuite" in it })
    }
}
