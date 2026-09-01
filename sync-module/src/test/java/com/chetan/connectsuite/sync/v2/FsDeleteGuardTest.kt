package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The enforceable half of the compare-and-delete rule: **there is no bare delete to reach for.**
 *
 * `CLAUDE.md` asks, of any rule worth writing down, what would have stopped it — and answers that
 * "someone remembering" is not an enforcement point. For a guard on the one verb in this phase that
 * destroys data, the answer cannot be a comment. It is this: the platform's deletion calls appear in
 * exactly one function each, both of which take the expected size and modified time, and a second
 * call site anywhere in the module fails this test.
 *
 * It is the same shape as `stylesheets.test.ts` failing on a selector declared in two sheets, and of
 * `transferFiles.test.ts` pinning the `.part` suffix to one module.
 *
 * ### It carries its own fixtures, because a matcher without them is a rule you are guessing about
 *
 * `no-force-stop.sh`'s first matcher denied every command that merely *talked* about the rule,
 * including writing the doc that carries its argument — a hook that forbids writing its own other
 * half. It was fixed by giving it six fixtures. The two control tests below are this file's: one
 * proving the scan can see a second call site, one proving it does not count a mention inside a
 * comment as one.
 */
class FsDeleteGuardTest {

    private fun moduleRoot(): File {
        var dir = File(System.getProperty("user.dir")!!).absoluteFile
        while (!File(dir, "src/main/java/com/chetan/connectsuite/sync/v2").isDirectory) {
            dir = dir.parentFile ?: error("could not find sync-module from ${System.getProperty("user.dir")}")
            if (dir.name == "ConnectSuite") {
                val candidate = File(dir, "sync-module")
                if (candidate.isDirectory) return candidate
            }
        }
        return dir
    }

    private fun sources(): List<File> =
        File(moduleRoot(), "src/main/java/com/chetan/connectsuite/sync/v2")
            .listFiles { f -> f.name.endsWith(".kt") }!!
            .sortedBy { it.name }

    /**
     * Counts real call sites, ignoring anything inside a comment.
     *
     * The comment stripping is what makes the count a reading rather than a grep: this file, the
     * KDoc on `deleteIfUnchanged`, and the interface's own documentation all name the call, and a
     * matcher that could not tell prose from code would forbid explaining itself.
     */
    private fun callSites(source: String, needle: String): Int =
        source.lineSequence()
            .map { it.substringBefore("//") }
            .filterNot { it.trimStart().startsWith("*") }
            .count { it.contains(needle) }

    @Test
    fun `a document is deleted from exactly two places, one per question`() {
        // **This test went from one to two when push landed, and it is the reason the hole was
        // found rather than shipped.** `commit()` called the platform delete three times inline,
        // and one of those silently removed a user's existing file at the destination — `overwrite`
        // was in the payload spec and had not been implemented. The guard failed, the code was
        // wrong, and the number here moved only after the third call site became two named
        // functions answering two different questions:
        //
        //   deleteIfUnchanged — may this file the Mac was looking at be destroyed? (compare-and-delete)
        //   deleteArtifact    — may this transfer artifact be cleaned up? (.part, .failed, or an
        //                       authorised overwrite)
        //
        // Raising this number to fit new code is how a guard stops guarding. It may only move when a
        // genuinely new *question* appears, and the function answering it is named here.
        val hits = sources().associate { it.name to callSites(it.readText(), "DocumentsContract.deleteDocument") }
        val withCalls = hits.filterValues { it > 0 }
        assertEquals(
            "DocumentsContract.deleteDocument must appear in exactly one file — found $withCalls",
            mapOf("SafTreeStore.kt" to 2),
            withCalls,
        )
        val source = sources().first { it.name == "SafTreeStore.kt" }.readText()
        assertEquals("deleteIfUnchanged must still exist", 1, callSites(source, "fun deleteIfUnchanged("))
        assertEquals("the second call site must be the named artifact helper", 1, callSites(source, "private fun deleteArtifact("))
    }

    @Test
    fun `a transfer artifact is never deleted by the compare-and-delete path, and vice versa`() {
        // The two questions must not blur. Folding the artifact deletes into `deleteIfUnchanged`
        // would mean inventing an expected size for a file nobody looked at — the compare half
        // becoming a formality, which is worse than not having it.
        val source = sources().first { it.name == "SafTreeStore.kt" }.readText()
        val artifact = source.substringAfter("private fun deleteArtifact(").substringBefore("\n    }")
        assertTrue(
            "deleteArtifact must not consult the compare-and-delete verdict",
            !artifact.contains("FsPaths.deleteVerdict("),
        )
    }

    @Test
    fun `the app-private root deletes a file from exactly one place`() {
        val hits = sources().associate { it.name to callSites(it.readText(), "file.delete()") }
        assertEquals(mapOf("AppFilesStore.kt" to 1), hits.filterValues { it > 0 })
    }

    @Test
    fun `the only deletion the store interface offers is the guarded one`() {
        val store = sources().first { it.name == "FsStore.kt" }.readText()
        // A `fun delete(` would be an unguarded deletion a future caller could reach for without
        // naming what they expect to be there — which is the entire failure this guard prevents.
        assertEquals(0, callSites(store, "fun delete("))
        assertEquals(1, callSites(store, "fun deleteIfUnchanged("))
    }

    @Test
    fun `both deletions are preceded by a second reading of the guard, taken at the moment of acting`() {
        // The predicate is evaluated twice on purpose: once to answer the caller, and once more
        // with a freshly read row and nothing between it and the irreversible call. A verdict
        // computed at the top of a function and acted on at the bottom is the shape that hung up a
        // live call after reading the card that said not to.
        listOf("SafTreeStore.kt", "AppFilesStore.kt").forEach { name ->
            val source = sources().first { it.name == name }.readText()
            assertEquals(
                "$name must evaluate FsPaths.deleteVerdict twice",
                2,
                callSites(source, "FsPaths.deleteVerdict("),
            )
        }
    }

    @Test
    fun `the guard's own reads never come from the directory snapshot`() {
        // The snapshot exists so a paging run sees one consistent directory; it must never decide a
        // delete. `readRow` queries the document URI directly and is what both evaluations of the
        // guard call, so the cache is reachable from the *listing* path and from nowhere else. A
        // guard that could be answered from a 30-second-old cache is a guard that re-checks a copy.
        //
        // This asserts **two named questions** rather than one count, which is what the count was
        // standing in for. It used to count `Snapshots.hit(` and require it inside `childrenOf`;
        // when the cache grew a single entry point — `getOrBuild`, which coalesces concurrent
        // callers — that count went to zero, because the read moved *inside* the cache and is now
        // unqualified there. Raising or lowering the number would have been the edit that stops a
        // guard guarding: the property never changed, only the shape it is written in, and the
        // second assertion below is the half that was previously only implied.
        val source = sources().first { it.name == "SafTreeStore.kt" }.readText()

        // (1) There is exactly one way into the snapshot from this store, and it is the listing.
        assertEquals(
            "the snapshot must have exactly one entry point from the store",
            1,
            callSites(source, "Snapshots.getOrBuild("),
        )
        assertTrue(
            "the one snapshot entry point must be inside childrenOf",
            source.substringAfter("private fun childrenOf(")
                .substringBefore("private fun resolveDirectory(")
                .contains("Snapshots.getOrBuild("),
        )

        // (2) Everything from the first row-read to the cache's own declaration — `readRow`,
        // `deleteIfUnchanged`, `deleteArtifact`, `openPartial` — *reads* nothing from the snapshot.
        //
        // The boundaries are asserted before they are used. `private val projection` was the first
        // choice for the closing one and sits at line 67, *before* `readRow`: `substringBefore`
        // returns the whole string when its delimiter is absent, so that scan would have run to end
        // of file, swallowed the `Snapshots` object itself, and reported on a region nobody meant.
        // A source scan with a wrong boundary is the "what did I actually measure" failure with no
        // error to show for it.
        val from = "private fun readRow("
        val to = "internal object Snapshots {"
        assertTrue("boundary '$from' missing", source.contains(from))
        assertTrue("boundary '$to' missing", source.contains(to))
        assertTrue("boundaries are out of order", source.indexOf(from) < source.indexOf(to))
        val actingPath = source.substring(source.indexOf(from), source.indexOf(to))

        // `invalidate` is deliberately *not* in this list. Every write calls it, and must: a
        // listing that outlives our own change is a listing that lies. What is forbidden is
        // **reading** a decision out of the cache.
        listOf("Snapshots.getOrBuild(", "Snapshots.hit(").forEach { reach ->
            assertEquals(
                "the acting path must not read the snapshot via $reach",
                0,
                callSites(actingPath, reach),
            )
        }
        assertTrue(
            "control — the acting path region must be the one that invalidates, or it is the wrong region",
            callSites(actingPath, "Snapshots.invalidate(") > 0,
        )
    }

    // ---- the fixtures ---------------------------------------------------------------------------

    @Test
    fun `control — the scan can see a second call site`() {
        val withTwo = """
            fun a() { DocumentsContract.deleteDocument(resolver, uri) }
            fun b() { DocumentsContract.deleteDocument(resolver, other) }
        """.trimIndent()
        assertEquals(2, callSites(withTwo, "DocumentsContract.deleteDocument"))
    }

    @Test
    fun `control — a mention in prose is not a call site`() {
        val prose = """
            /**
             * See DocumentsContract.deleteDocument for what this guards.
             */
            // DocumentsContract.deleteDocument is called below, once.
            fun a() { DocumentsContract.deleteDocument(resolver, uri) }
        """.trimIndent()
        assertEquals(1, callSites(prose, "DocumentsContract.deleteDocument"))
        assertTrue(prose.contains("DocumentsContract.deleteDocument"))
    }
}
