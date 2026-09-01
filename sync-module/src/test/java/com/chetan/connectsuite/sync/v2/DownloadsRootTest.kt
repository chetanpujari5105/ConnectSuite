package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The grant-free destination's identity and the one string that has to be exactly right.
 *
 * **What this cannot reach, said rather than implied.** [DownloadsStore] is a `MediaStore` client
 * and nothing here calls it: a JVM test that touched its `collection` field would die on
 * `MediaStore.Downloads.EXTERNAL_CONTENT_URI`, and `returnDefaultValues = true` would make every
 * Android call in the module silently return null, which is the fix `CLAUDE.md` forbids by name. So
 * the listing, the pending-item resume and the delete are proven **on hardware** —
 * `docs/testing.md` → Slice 9 — and this covers the parts a unit test can honestly hold.
 *
 * A `const val` in a companion object is inlined at the call site, so reading `RELATIVE_PATH` here
 * does not initialise the class. That is what makes this test possible at all, and it is the reason
 * the constant lives in a companion rather than as a property.
 */
class DownloadsRootTest {

    @Test
    fun `the relative path ends in a slash, because MediaStore normalises it and a query does not`() {
        // **The trap this test exists for.** `MediaStore` stores `RELATIVE_PATH` with a trailing
        // slash. A `RELATIVE_PATH=?` bound with `Download/ConnectSuite` therefore matches nothing
        // while the insert that created the row stored `Download/ConnectSuite/` — two spellings of
        // one path, and the symptom is a folder that reads as empty forever with no error anywhere.
        //
        // Deleting the slash is a one-character tidy-up that looks harmless in a diff.
        assertTrue(
            "RELATIVE_PATH must end in a slash: ${DownloadsStore.RELATIVE_PATH}",
            DownloadsStore.RELATIVE_PATH.endsWith("/"),
        )
        assertEquals("Download/ConnectSuite/", DownloadsStore.RELATIVE_PATH)
    }

    @Test
    fun `the three root kinds are three different words`() {
        // The Mac counts `tree` to decide how many folders the user has shared. If `downloads` were
        // spelled `tree`, a phone that had shared nothing would report one shared folder — and the
        // pane's almost-empty state, which is where the Download wall lives, would never draw.
        val kinds = listOf(FsPaths.KIND_DOWNLOADS, FsPaths.KIND_APP, FsPaths.KIND_TREE)
        assertEquals("the kinds must be distinct: $kinds", kinds.size, kinds.toSet().size)
    }

    @Test
    fun `the downloads root id is not a SAF root id`() {
        // `FsRoots.find` matches on this string. A downloads id that started with `saf:` would be
        // routed by prefix somewhere as a tree and fail at the provider rather than at the lookup.
        assertTrue(!FsPaths.DOWNLOADS_ROOT_ID.startsWith(FsPaths.SAF_PREFIX))
        assertNotEquals(FsPaths.APP_ROOT_ID, FsPaths.DOWNLOADS_ROOT_ID)
    }

    @Test
    fun `the label a user reads is not the path`() {
        // The folder is an inbox. Naming it after its location invites the belief that everything in
        // that location is visible here, and that is exactly what is not true: without storage
        // permission a MediaStore query returns this package's own contributions only.
        assertEquals("Received files", FsPaths.DOWNLOADS_ROOT_LABEL)
        assertTrue(!FsPaths.DOWNLOADS_ROOT_LABEL.contains("/"))
        assertTrue(!FsPaths.DOWNLOADS_ROOT_LABEL.contains("Download"))
    }

    /**
     * That the grant-free root is actually wired into the inventory.
     *
     * The constants above can all be right over a build that never constructs the store —
     * `FsRoots.all` is where it becomes a root, and that call needs a `Context`. A source scan is
     * what can see it from here, and it is honest about being a source scan.
     */
    @Test
    fun `FsRoots offers the grant-free root, not just the app-private one`() {
        val sources = SourceTree.kotlinFiles()
        val roots = sources.singleOrNull { it.name == "FsRoots.kt" }
            ?: throw AssertionError("FsRoots.kt is not where this guard expects it")
        val text = roots.readText()
        assertTrue(
            "FsRoots.all must add the DownloadsStore, or a push with no folder shared has nowhere " +
                "to land",
            text.contains("add(DownloadsStore(context))"),
        )
        // The control: this scan must be able to see a thing it already knows is there.
        assertTrue(
            "the scan cannot see AppFilesStore either, so it is not reading FsRoots at all",
            text.contains("add(AppFilesStore(context))"),
        )
    }
}
