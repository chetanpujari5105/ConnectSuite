package com.chetan.connectsuite.setup

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `app/` never reads `persistedUriPermissions` itself; it asks `FsRoots`.
 *
 * `FsRootsSingleSourceTest` pins the platform's grant list to one reader, but it scans
 * `sync-module` only — so Set up Sidekick read the list twice from `app/`, counting **every**
 * persisted grant where the Folders screen counts readable **tree** grants, and nothing could see it.
 * This is the same rule for the module the first guard does not reach. Comments are stripped, so the
 * KDoc explaining the rule stays legal.
 */
class AppGrantReaderTest {

    private val token = "persistedUriPermissions"

    private fun sources(): List<File> =
        File("src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun code(source: String): String =
        source.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
            .lines().joinToString("\n") { it.substringBefore("// ") }

    @Test
    fun `the scan sees app's sources and the FsRoots call it expects`() {
        val files = sources()
        assertTrue("found ${files.size} Kotlin files under src/main/java; the scan would be vacuous (13 on 2026-09-23)", files.size >= 10)
        assertTrue(
            "no file calls FsRoots — the control that the scan reads code",
            files.any { code(it.readText()).contains("FsRoots.grantedTrees(") },
        )
    }

    @Test
    fun `the stripper keeps a real call and drops prose about it`() {
        val fixture = "/** mentions $token */\nval n = resolver.$token.size // and $token\n"
        assertEquals(1, Regex(Regex.escape(token)).findAll(code(fixture)).count())
    }

    @Test
    fun `no file in app calls persistedUriPermissions`() {
        val callers = sources().filter { code(it.readText()).contains(token) }.map { it.name }
        assertEquals("these read the grant list instead of asking FsRoots", emptyList<String>(), callers)
    }
}
