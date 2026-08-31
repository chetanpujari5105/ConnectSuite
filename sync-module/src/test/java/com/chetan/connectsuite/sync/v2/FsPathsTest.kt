package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of `fs.*`, on a plain JVM.
 *
 * Every test here drives the shipping expression rather than a copy of it — [FsPaths.pageOf] is
 * called, not re-implemented, and [FsPaths.deleteVerdict] is the same function the two stores gate
 * on. `MediaPayloadsTest`'s first version wrote the cursor predicate out a second time and stayed
 * green with the tiebreak deleted; the fix was to give the rule one home, and this file is written
 * against that lesson from the start.
 */
class FsPathsTest {

    private fun file(name: String, id: String = name, size: Long = 10, mtime: Long = 100) =
        FsPaths.Entry(id = id, name = name, dir = false, size = size, mtimeMs = mtime, mime = "text/plain")

    private fun dir(name: String, id: String = name) =
        FsPaths.Entry(id = id, name = name, dir = true, size = 0, mtimeMs = 0, mime = FsPaths.DIR_MIME)

    // ---- ids ------------------------------------------------------------------------------------

    @Test
    fun `ids round-trip through the percent encoding exactly`() {
        // A document id holds a colon and a slash as a matter of course — `primary:DCIM/Camera` is
        // the ordinary shape — and a display-name-derived id can hold anything at all.
        val awkward = listOf(
            "primary:DCIM",
            "primary:Download/ConnectSuite",
            "msf:1000012345",
            "a b+c%d",
            "été 😀",
            "",
        )
        awkward.forEach { raw ->
            assertEquals(raw, FsPaths.decodeId(FsPaths.encodeId(raw)))
        }
    }

    @Test
    fun `a space encodes as a percent escape, never as a plus`() {
        // URLEncoder would write `+` here. It is form encoding, not URI encoding, and the id would
        // decode back to a document this phone does not have.
        assertEquals("a%20b", FsPaths.encodeId("a b"))
        assertEquals("primary%3ADCIM", FsPaths.encodeId("primary:DCIM"))
    }

    @Test
    fun `a root id carries the tree document id and hands it back`() {
        val rootId = FsPaths.rootIdForTree("primary:DCIM")
        assertEquals("saf:primary%3ADCIM", rootId)
        assertEquals("primary:DCIM", FsPaths.treeDocumentIdOf(rootId))
        assertEquals(null, FsPaths.treeDocumentIdOf(FsPaths.APP_ROOT_ID))
    }

    // ---- paths ----------------------------------------------------------------------------------

    @Test
    fun `a dot-dot segment is refused rather than normalised`() {
        // Normalising an escape attempt and then serving the result is how a traversal gets served
        // politely: the caller asked for something outside the tree, got something inside it, and
        // nothing recorded that the request was malformed.
        val rejected = FsPaths.splitPath("Camera/../../secrets")
        assertTrue(rejected is FsPaths.PathResult.Rejected)
        assertTrue((rejected as FsPaths.PathResult.Rejected).why.contains(".."))
    }

    @Test
    fun `an absolute path is refused, because under SAF there is nothing for it to mean`() {
        assertTrue(FsPaths.splitPath("/sdcard/DCIM") is FsPaths.PathResult.Rejected)
    }

    @Test
    fun `an empty path is the root of the tree, not an error`() {
        assertEquals(emptyList<String>(), (FsPaths.splitPath(null) as FsPaths.PathResult.Ok).segments)
        assertEquals(emptyList<String>(), (FsPaths.splitPath("") as FsPaths.PathResult.Ok).segments)
        assertEquals(
            listOf("Camera", "trip"),
            (FsPaths.splitPath("Camera/trip") as FsPaths.PathResult.Ok).segments,
        )
    }

    @Test
    fun `mkdir creates one directory, never a chain`() {
        assertEquals(null, FsPaths.rejectionForName("trip"))
        assertTrue(FsPaths.rejectionForName("trip/2026")!!.contains("/"))
        assertTrue(FsPaths.rejectionForName("..")!!.isNotEmpty())
        assertTrue(FsPaths.rejectionForName(null)!!.isNotEmpty())
    }

    // ---- ordering -------------------------------------------------------------------------------

    @Test
    fun `byte-wise ordering is not the platform's string ordering, and the difference is real`() {
        // U+1F600 is a surrogate pair beginning 0xD83D, so UTF-16 sorts it *below* U+E000; its
        // UTF-8 bytes begin 0xF0, which sorts it *above*. Two ends that agree on "byte-wise" while
        // one of them uses `String.compareTo` land their cursor in different places, and the
        // symptom is a page boundary that skips exactly the rows with an emoji in the name.
        val emoji = "\uD83D\uDE00" // U+1F600
        val privateUse = "\uE000"
        assertTrue(emoji.compareTo(privateUse) < 0)
        assertTrue(FsPaths.compareBytewise(emoji, privateUse) > 0)
        assertNotEquals(
            emoji.compareTo(privateUse) < 0,
            FsPaths.compareBytewise(emoji, privateUse) < 0,
        )
    }

    @Test
    fun `folders sort before files whatever their names are`() {
        val sorted = listOf(file("aaa"), dir("zzz")).sortedWith(FsPaths.ENTRY_ORDER)
        assertEquals(listOf("zzz", "aaa"), sorted.map { it.name })
    }

    @Test
    fun `two entries sharing a name are separated by their ids`() {
        // Display names in a DocumentsProvider are **not** guaranteed unique — the provider chooses
        // them, and a MediaStore-backed tree can present two rows with the same `_display_name`. So
        // this tie group is a real shape, not a contrived one, and it is the only thing the id
        // tiebreak exists for.
        val sorted = listOf(
            file("photo.jpg", id = "msf%3A2"),
            file("photo.jpg", id = "msf%3A1"),
        ).sortedWith(FsPaths.ENTRY_ORDER)
        assertEquals(listOf("msf%3A1", "msf%3A2"), sorted.map { it.id })
    }

    // ---- paging ---------------------------------------------------------------------------------

    /**
     * Pages a whole directory and reports what the run actually proved, not just that it summed.
     *
     * `sums == true` with `boundariesInTieGroups == 0` is a green pager that says **nothing** about
     * the tiebreak — the run would pass identically with the id clause deleted. That is the third
     * precondition in `CLAUDE.md`, and it is reported here rather than left for a reader to assume.
     */
    private data class PagerRun(
        val seen: List<String>,
        val pages: Int,
        val boundariesInTieGroups: Int,
    )

    private fun pageEverything(all: List<FsPaths.Entry>, limit: Int): PagerRun {
        val seen = mutableListOf<String>()
        var cursor: FsPaths.Cursor = FsPaths.Cursor.None
        var pages = 0
        var tieBoundaries = 0
        while (true) {
            val page = FsPaths.pageOf(all, cursor, limit)
            pages++
            page.entries.forEach { seen += it.id }
            if (!page.hasMore) break
            val last = page.entries.last()
            // A boundary lands inside a tie group when the entry it cuts after shares its `name`
            // with another entry — which is exactly when a name-only cursor cannot advance.
            if (all.count { it.name == last.name } > 1) tieBoundaries++
            cursor = FsPaths.Cursor.After(last.name, last.id)
            if (pages > 1000) error("the pager did not terminate; this is the instrument's own cap")
        }
        return PagerRun(seen, pages, tieBoundaries)
    }

    @Test
    fun `consecutive pages sum to the directory and repeat nothing`() {
        val all = (1..47).map { file("f%03d.txt".format(it), id = "id-$it") } +
            (1..5).map { dir("d$it") }
        val run = pageEverything(all, limit = 10)
        assertEquals(all.size, run.seen.size)
        assertEquals(all.size, run.seen.toSet().size)
        assertTrue("expected several pages, got ${run.pages}", run.pages > 4)
    }

    @Test
    fun `a page boundary inside a group of identical names does not lose the rest of the group`() {
        // Twelve documents with one display name, paged three at a time: every boundary from the
        // second page on falls inside the tie group. A cursor on `name` alone cannot advance past
        // the first of them and would either loop forever or skip the other eleven.
        val all = (1..12).map { file("photo.jpg", id = FsPaths.encodeId("msf:%04d".format(it))) }
        val run = pageEverything(all, limit = 3)
        assertEquals(12, run.seen.size)
        assertEquals(12, run.seen.toSet().size)
        assertTrue(
            "the run proved nothing about the tiebreak: ${run.boundariesInTieGroups} tie boundaries",
            run.boundariesInTieGroups > 0,
        )
    }

    @Test
    fun `a cursor whose entry has vanished repeats entries rather than skipping any`() {
        // Renamed or deleted between two pages. The page then starts at the first entry the
        // comparator puts after the cursor, with the vanished entry assumed to have been a folder —
        // chosen so the failure is a repeat, never a gap. A repeated row is cosmetic; a skipped row
        // is a file the user cannot see and has no way to discover.
        val all = listOf(dir("alpha"), dir("beta"), file("one.txt"), file("two.txt"))
        val page = FsPaths.pageOf(all, FsPaths.Cursor.After("gone", "gone-id"), limit = 10)
        assertEquals(FsPaths.CursorResolution.APPROXIMATE, page.resolution)
        assertTrue(page.entries.any { it.name == "one.txt" })
        assertTrue(page.entries.any { it.name == "two.txt" })
    }

    @Test
    fun `the first page reports itself as such`() {
        val page = FsPaths.pageOf(listOf(file("a")), FsPaths.Cursor.None, limit = 10)
        assertEquals(FsPaths.CursorResolution.FIRST_PAGE, page.resolution)
        assertEquals(1, page.total)
        assertFalse(page.hasMore)
    }

    @Test
    fun `limit is clamped rather than trusted`() {
        val all = (1..600).map { file("f$it", id = "id$it") }
        assertEquals(FsPaths.MAX_LIMIT, FsPaths.pageOf(all, FsPaths.Cursor.None, 10_000).entries.size)
        assertEquals(1, FsPaths.pageOf(all, FsPaths.Cursor.None, 0).entries.size)
    }

    /**
     * The one test here that can see the id tiebreak, and it exists because the obvious one cannot.
     *
     * `a page boundary inside a group of identical names` passes **identically with the tiebreak
     * deleted** — verified by deleting it — because `sortedWith` is stable and the cursor is
     * resolved positionally, so ties keep whatever order the input had and the page boundary lands
     * in the same place either way. That is a green pager proving nothing about the clause most
     * likely to be removed as redundant later, which is precisely the shape `CLAUDE.md` warns about.
     *
     * What makes the tiebreak load-bearing is that **the input order is not ours**. Every page is a
     * fresh `DocumentsProvider` query and nothing guarantees two queries return rows in the same
     * order. Without a *total* ordering, page two sorts the tie group differently from page one and
     * the cursor lands somewhere else — losing rows between two pages that each look perfectly well
     * formed. Shuffling between pages is that condition, made deterministic.
     */
    @Test
    fun `pages survive the provider returning rows in a different order each time`() {
        val all = (1..12).map { file("photo.jpg", id = FsPaths.encodeId("msf:%04d".format(it))) } +
            (1..8).map { file("note%02d.txt".format(it), id = "n$it") }
        val rng = kotlin.random.Random(20260901)
        val seen = mutableListOf<String>()
        var cursor: FsPaths.Cursor = FsPaths.Cursor.None
        var pages = 0
        while (true) {
            val page = FsPaths.pageOf(all.shuffled(rng), cursor, limit = 3)
            pages++
            page.entries.forEach { seen += it.id }
            if (!page.hasMore) break
            cursor = FsPaths.Cursor.After(page.entries.last().name, page.entries.last().id)
            // The instrument's own bound, reported rather than silently shaping the result: a run
            // that hit this cap has proven the pager advances and has proven nothing about the sum.
            if (pages > 100) {
                throw AssertionError(
                    "stopped=page cap after $pages pages having seen ${seen.size} of ${all.size}; " +
                        "sums=not tested — capped",
                )
            }
        }
        assertEquals("no entry may be seen twice", all.size, seen.toSet().size)
        assertEquals("no entry may be lost between pages", all.size, seen.size)
    }

    // ---- the delete guard -----------------------------------------------------------------------

    @Test
    fun `a delete matching both facts is allowed`() {
        val entry = file("holiday.mov", size = 214748364, mtime = 1756290000000)
        assertEquals(
            FsPaths.DeleteVerdict.Match,
            FsPaths.deleteVerdict(entry, 214748364, 1756290000000),
        )
    }

    @Test
    fun `a delete is refused when the size disagrees`() {
        val entry = file("holiday.mov", size = 214748364, mtime = 1756290000000)
        val verdict = FsPaths.deleteVerdict(entry, 999, 1756290000000)
        assertTrue(verdict is FsPaths.DeleteVerdict.Mismatch)
        assertTrue((verdict as FsPaths.DeleteVerdict.Mismatch).why.contains("214748364"))
    }

    @Test
    fun `a delete is refused when only the modified time disagrees`() {
        // The size is the fact people reach for; the modified time is the one that catches a file
        // rewritten to the same length, which is the case a size-only guard cannot see at all.
        val entry = file("notes.txt", size = 1024, mtime = 1756290000000)
        val verdict = FsPaths.deleteVerdict(entry, 1024, 1756289000000)
        assertTrue(verdict is FsPaths.DeleteVerdict.Mismatch)
        assertTrue((verdict as FsPaths.DeleteVerdict.Mismatch).why.contains("modified"))
    }

    @Test
    fun `a directory is never deleted by this verb`() {
        val verdict = FsPaths.deleteVerdict(dir("Camera"), 0, 0)
        assertTrue(verdict is FsPaths.DeleteVerdict.Mismatch)
        assertTrue((verdict as FsPaths.DeleteVerdict.Mismatch).why.contains("directory"))
    }

    // ---- labels ---------------------------------------------------------------------------------

    @Test
    fun `a tree label is a breadcrumb with no URI left in it`() {
        val label = FsPaths.labelForTreeDocumentId("primary:Download/ConnectSuite")
        assertEquals("Download › ConnectSuite", label)
        assertFalse(label.contains('%'))
        assertFalse(label.contains("content://"))
        assertFalse(label.contains("primary"))
    }

    @Test
    fun `a package-shaped folder name is recognised, and an ordinary one is not`() {
        assertTrue(FsPaths.looksLikePackageId("com.whatsapp"))
        assertTrue(FsPaths.looksLikePackageId("org.mozilla.firefox"))
        assertFalse(FsPaths.looksLikePackageId("Camera"))
        assertFalse(FsPaths.looksLikePackageId("2026.trip"))

        // `holiday.mov` passes this filter too, and that is correct rather than a bug: nothing
        // about the *shape* of a dotted name separates a package id from a filename. This is a
        // cheap pre-filter, it is only ever asked about directories, and the discrimination that
        // actually decides is the `AppLabels` lookup in `FsFeature.labelled` — a label equal to the
        // name means no app by that name is installed and no `displayName` is emitted.
        assertTrue(FsPaths.looksLikePackageId("holiday.mov"))
    }
}
