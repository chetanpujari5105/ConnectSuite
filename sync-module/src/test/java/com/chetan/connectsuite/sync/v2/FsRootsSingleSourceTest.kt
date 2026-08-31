package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The granted folders have exactly one reader in this module.
 *
 * `contentResolver.persistedUriPermissions` is the platform's own list and the only thing that can
 * revoke a grant. A second reader is a second copy of a fact we do not own, free to disagree with
 * the first the moment a grant is dropped — and the screen would then offer a folder `fs.list`
 * cannot open. The rule has one home, `FsRoots`, and this is what keeps it there.
 *
 * Same shape as the Mac's `transferFiles.test.ts` pinning the `.part` suffix, and enforceable for
 * the same reason: the property is about *where a name appears*, which a source scan can see and a
 * runtime test cannot.
 *
 * ### It matches the call, not the word — and that is defect 41's lesson, not a nicety
 *
 * The first version of this test matched the bare token anywhere in a file and **failed on its
 * first run against `FoldersModel.kt`, whose KDoc explains why it does not read the list.** A guard
 * that forbids documenting the rule it enforces has broken the pair it belongs to, exactly as the
 * force-stop hook did when it denied the commit writing its own other half. So comments are
 * stripped before matching, and the stripper carries fixtures in both directions.
 *
 * ### It proves it can fail before it reports anything
 *
 * A scan that finds no files passes "appears at most once" trivially — a test that reads as evidence
 * and is not. Three controls bound it: the sources must be found, the stripper must not eat code,
 * and the stripper must actually remove a comment.
 */
class FsRootsSingleSourceTest {

    private val token = "persistedUriPermissions"

    private fun kotlinFiles(): List<File> = SourceTree.kotlinFiles()

    /**
     * Kotlin source with its comments removed, well enough to tell a call from a sentence about one.
     *
     * `//` is only treated as a line comment when it is not preceded by `:`, so the `content://`
     * that appears in prose and in strings throughout this module does not truncate a line. It is a
     * heuristic and is named as one; the fixtures below are what say it holds for the shapes this
     * tree actually contains.
     */
    private fun withoutComments(source: String): String {
        val noBlocks = source.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        return noBlocks.lines().joinToString("\n") { line ->
            var at = line.indexOf("//")
            while (at > 0 && line[at - 1] == ':') at = line.indexOf("//", at + 1)
            if (at < 0) line else line.substring(0, at)
        }
    }

    @Test
    fun `the scan can see this module's sources at all`() {
        val files = kotlinFiles()
        assertTrue(
            "the scan found ${files.size} Kotlin sources; every other assertion here would be vacuous",
            files.size > 20,
        )
        val control = files.count { it.readText().contains("FsRoots") }
        assertTrue("control token 'FsRoots' found in $control files; expected several", control >= 2)
    }

    @Test
    fun `the stripper removes a comment and leaves the code that follows it`() {
        val fixture = """
            /** A KDoc mentioning $token, which is prose and not a call. */
            class Thing {
                // a line comment mentioning $token
                fun read() = resolver.$token.size   // trailing comment
                val url = "content://example/tree"  // a :// must not truncate this line
            }
        """.trimIndent()
        val stripped = withoutComments(fixture)
        assertEquals(
            "the stripper must remove prose and keep exactly the one real call",
            1,
            Regex(Regex.escape(token)).findAll(stripped).count(),
        )
        assertTrue("the code after a :// must survive", stripped.contains("content://example/tree"))
    }

    @Test
    fun `the stripper does not eat the call it is looking for`() {
        // The other direction of the same control: a stripper that removed everything would make
        // the real assertion pass forever.
        val fsRoots = kotlinFiles().single { it.name == "FsRoots.kt" }
        assertTrue(
            "FsRoots.kt must still contain the call after stripping, or the stripper is too greedy",
            withoutComments(fsRoots.readText()).contains(token),
        )
    }

    @Test
    fun `only FsRoots reads the platform's list of granted folders`() {
        val readers = kotlinFiles()
            .filter { withoutComments(it.readText()).contains(token) }
            .map { it.name }
            .sorted()
        assertEquals(
            "$token must have exactly one reader — found $readers. A view model or a second store " +
                "reading it directly is a second copy of a fact the platform owns. Naming it in a " +
                "comment is fine and is not what this matches.",
            listOf("FsRoots.kt"),
            readers,
        )
    }
}
