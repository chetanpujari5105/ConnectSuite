package com.chetan.connectsuite.sync.v2

import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of `media.*`, tested on a plain JVM.
 *
 * That this file can exist at all is the point of splitting [MediaPayloads] out of
 * [MediaStoreReader]: a test that merely referenced an object holding `MediaStore`'s content URIs
 * in a field initializer would die in `<clinit>` with `ExceptionInInitializerError`, which is what
 * `SmsStore` does and why `SmsPayloads` was carved out for defect 34.
 *
 * ### The rows below stand in for a real burst, and the numbers are not arbitrary
 *
 * `DATE_ADDED` is in seconds. A camera burst, a bulk import or a WhatsApp download of an album puts
 * hundreds of rows on one value — the collision is certain rather than unlucky — so every boundary
 * case here is expressed as several ids sharing a second.
 */
class MediaPayloadsTest {

    @Test
    fun `no cursor selects everything, which is the first reading to take`() {
        // The diagnostic whose correct answer is "everything": a wrong cursor *value* cannot
        // return zero rows, only a selection that never ran can. It is sent before any tuning, and
        // it is what separated "the cursor is wrong" from "the selection is dead" in defect 50.
        val selection = MediaPayloads.listSelection(bucketId = null, beforeMs = null, beforeId = null)
        assertEquals("media_type IN (1,3)", selection.where)
        assertTrue(selection.args.isEmpty())
        assertFalse(selection.lossy)
    }

    @Test
    fun `the cursor advances inside a shared second, which a bare timestamp cannot`() {
        val selection = MediaPayloads.listSelection(
            bucketId = "-1739773001",
            beforeMs = 1756298000_123L,
            beforeId = 1000012345L,
        )
        assertEquals(
            "media_type IN (1,3) AND bucket_id = ? AND " +
                "(date_added < ? OR (date_added = ? AND _id < ?))",
            selection.where,
        )
        // Seconds, floored — and the same second twice, because the second clause is the tie group.
        assertEquals(listOf("-1739773001", "1756298000", "1756298000", "1000012345"), selection.args)
        assertFalse(selection.lossy)
    }

    @Test
    fun `a cursor with no beforeId is marked lossy rather than quietly degrading`() {
        val selection = MediaPayloads.listSelection(null, beforeMs = 1756298000_999L, beforeId = null)
        assertEquals("media_type IN (1,3) AND date_added < ?", selection.where)
        assertEquals(listOf("1756298000"), selection.args)
        assertTrue(
            "a bare-millisecond cursor skips the rest of its second; the caller has to be able to say so",
            selection.lossy,
        )
    }

    /**
     * The red-first test for the id tiebreak, expressed against a real page boundary.
     *
     * A burst of five frames shares one second. Page 1 ends inside it. Page 2's cursor is the last
     * item of page 1, and the rows page 2 must return are the remaining members of that same
     * second — which is exactly what `date_added < s` alone cannot express.
     *
     * Reintroduce the bug by dropping the `beforeId` clause from [MediaPayloads.listSelection] and
     * this fails: the second page's predicate excludes every row in the boundary second, three
     * frames vanish between pages, and both pages still look internally consistent.
     */
    @Test
    fun `a page boundary inside a burst loses no rows and repeats none`() {
        val second = 1756298000L
        val burst = listOf(
            Row(id = 1005, dateAddedSeconds = second),
            Row(id = 1004, dateAddedSeconds = second),
            Row(id = 1003, dateAddedSeconds = second),
            Row(id = 1002, dateAddedSeconds = second),
            Row(id = 1001, dateAddedSeconds = second),
            Row(id = 1000, dateAddedSeconds = second - 1),
        )

        val pageOne = page(burst, limit = 2, beforeMs = null, beforeId = null)
        assertEquals(listOf(1005L, 1004L), pageOne.map { it.id })

        val last = pageOne.last()
        val pageTwo = page(burst, limit = 2, beforeMs = last.dateAddedSeconds * 1000, beforeId = last.id)
        assertEquals(listOf(1003L, 1002L), pageTwo.map { it.id })

        val lastOfTwo = pageTwo.last()
        val pageThree = page(burst, limit = 2, beforeMs = lastOfTwo.dateAddedSeconds * 1000, beforeId = lastOfTwo.id)
        assertEquals(listOf(1001L, 1000L), pageThree.map { it.id })

        val seen = pageOne + pageTwo + pageThree
        assertEquals("every row, once", burst.map { it.id }, seen.map { it.id })
        assertEquals("no repeats across pages", seen.size, seen.map { it.id }.toSet().size)
    }

    @Test
    fun `dateMs is milliseconds on the wire even though the column is seconds`() {
        val item = MediaPayloads.item(
            id = 1000012345L,
            kind = "image",
            mime = "image/jpeg",
            size = 3874112L,
            width = 4032,
            height = 3024,
            dateAddedSeconds = 1756298000L,
            durationMs = null,
            ownerPackage = null,
            ownerAppName = null,
        )
        assertEquals("1756298000000", item["dateMs"]?.jsonPrimitive?.content)
        // The id is a string on the wire: it is a handle, and a JSON number large enough to be a
        // MediaStore id is a value a JavaScript client would silently round.
        assertEquals("1000012345", item["id"]?.jsonPrimitive?.content)
    }

    @Test
    fun `a package id never travels without a label beside it`() {
        val item = MediaPayloads.item(
            id = 1L,
            kind = "image",
            mime = "image/jpeg",
            size = 1L,
            width = null,
            height = null,
            dateAddedSeconds = 1L,
            durationMs = null,
            ownerPackage = "com.whatsapp",
            ownerAppName = "WhatsApp",
        )
        assertEquals("com.whatsapp", item["ownerPackage"]?.jsonPrimitive?.content)
        assertEquals("WhatsApp", item["ownerAppName"]?.jsonPrimitive?.content)

        // And when resolution fails, the handle still carries a label — the package id itself,
        // which is AppLabels' honest fallback. What must never happen is the handle travelling
        // alone, because that is the field a Mac would then have to render.
        val unresolved = MediaPayloads.item(
            id = 2L, kind = "image", mime = null, size = 1L, width = null, height = null,
            dateAddedSeconds = 1L, durationMs = null,
            ownerPackage = "com.techmash.playo", ownerAppName = null,
        )
        assertEquals("com.techmash.playo", unresolved["ownerAppName"]?.jsonPrimitive?.content)
    }

    @Test
    fun `an app-owned bucket path yields its package, and an ordinary folder does not`() {
        assertEquals(
            "com.whatsapp",
            MediaPayloads.packageSegmentOf("Android/media/com.whatsapp/WhatsApp Images/"),
        )
        assertEquals("com.whatsapp", MediaPayloads.packageSegmentOf("Android/data/com.whatsapp/files/"))

        // The lookalikes. A user's own folder that happens to contain a dot is not an app bucket,
        // and calling it one would put an invented app name in a sentence — the package-id rule
        // producing the defect it exists to prevent.
        assertNull(MediaPayloads.packageSegmentOf("Pictures/com.example.holiday/"))
        assertNull(MediaPayloads.packageSegmentOf("DCIM/Camera/"))
        assertNull(MediaPayloads.packageSegmentOf("Android/media/notapackage/"))
        assertNull(MediaPayloads.packageSegmentOf(null))
    }

    @Test
    fun `kind comes from the media type, and falls back to the mime prefix`() {
        assertEquals("video", MediaPayloads.kindOf(MediaPayloads.MEDIA_TYPE_VIDEO, "video/mp4"))
        assertEquals("image", MediaPayloads.kindOf(MediaPayloads.MEDIA_TYPE_IMAGE, "image/jpeg"))
        assertEquals("video", MediaPayloads.kindOf(null, "video/mp4"))
        assertEquals("image", MediaPayloads.kindOf(null, "image/heic"))
    }

    @Test
    fun `seconds are floored, not truncated toward zero`() {
        assertEquals(1756298000L, MediaPayloads.secondsOf(1756298000_999L))
        assertEquals(1756298000L, MediaPayloads.secondsOf(1756298000_000L))
        assertEquals(-1L, MediaPayloads.secondsOf(-1L))
    }

    // --- the tiny in-memory provider the boundary test pages over -----------------------------

    private data class Row(val id: Long, val dateAddedSeconds: Long)

    /**
     * Applies the same predicate and ordering the provider would, over rows in memory.
     *
     * The ordering is a model of the SQL's `ORDER BY`, but the **predicate is the production one**
     * — [MediaPayloads.isBeyond] over [MediaPayloads.cursorOf], which is the same decision
     * [MediaPayloads.listSelection] renders into the `WHERE`. An earlier version of this helper
     * spelled the predicate out again here, and would have stayed green with the tiebreak deleted
     * from the query: a test that reads as evidence and is not.
     *
     * What it still cannot answer is whether this provider honours a bound argument at all. That
     * is not a JVM question, and it is settled on hardware through the app's own client — never
     * through `adb shell content query`, which inlines its literal and would be a second client
     * answering a different question.
     */
    private fun page(rows: List<Row>, limit: Int, beforeMs: Long?, beforeId: Long?): List<Row> {
        val cursor = MediaPayloads.cursorOf(beforeMs, beforeId)
        return rows
            .filter { row -> MediaPayloads.isBeyond(cursor, row.dateAddedSeconds, row.id) }
            .sortedWith(compareByDescending<Row> { it.dateAddedSeconds }.thenByDescending { it.id })
            .take(limit)
    }
}
