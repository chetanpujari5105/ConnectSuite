package com.chetan.connectsuite.sync.v2

import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Defect 208, the phone's half: an id that does not belong to the requested tree is refused **before**
 * the provider is asked, and counted as refused — never as *gone*.
 *
 * Hardware, 2026-10-08 stage 11: a 10-character MediaStore id arrived against the DCIM tree;
 * `ExternalStorageProvider` threw `StringIndexOutOfBoundsException` inside `enforceTree`, `readRow`
 * caught it and returned null, and the handler counted the file *gone* — an exception's name read as a
 * fact about our world (defect 57's shape). Runs the real per-item decision [FsThumbItems.answer] and the
 * real structural rule [FsIdScope.inTree] against a store double that records every provider-reaching call.
 * **Not reached:** the real provider and `onThumb`'s wire framing.
 */
class FsThumbRootTest {

    private class RecordingStore(private val owns: (String) -> Boolean?) : FsStore {
        val asked = mutableListOf<String>()
        override val rootId = "saf:primary%3ADCIM"
        override val label = "DCIM"
        override val kind = FsPaths.KIND_TREE
        override val writable = false
        override fun ownsId(id: String): Boolean? = owns(id)
        override fun freeBytes() = 0L
        override fun listChildren(segments: List<String>): List<FsPaths.Entry>? = null
        // The provider's behaviour for a foreign id on this handset: it throws, and the store's catch
        // turns that into null — which is what made the file read as gone.
        override fun statById(id: String): FsPaths.Entry? {
            asked += id
            return if (id.startsWith("primary:DCIM/")) FsPaths.Entry(id, "IMG.jpg", false, 1, 1, "image/jpeg") else null
        }
        override fun mkdir(segments: List<String>, name: String): FsPaths.Entry? = null
        override fun deleteIfUnchanged(id: String, expectSize: Long, expectMtimeMs: Long) = throw UnsupportedOperationException()
        override fun openStream(id: String): InputStream? = null
        override fun thumbnail(id: String, maxEdge: Int): FsThumbs.Thumb? = FsThumbs.Thumb(byteArrayOf(1), 1, 1)
        override fun openPartial(segments: List<String>, name: String): FsPartial? = null
    }

    private val tree = { id: String -> FsIdScope.inTree("com.android.externalstorage.documents", "primary:DCIM", id) }

    @Test
    fun `a MediaStore id against a DCIM tree is refused without asking the provider`() {
        val store = RecordingStore(tree)
        val item = FsThumbItems.answer(store, "1000308768", 256) { _, _ -> }
        assertEquals(FsThumbItem.NotInRoot, item)
        assertEquals("the provider was asked about an id outside its tree", emptyList<String>(), store.asked)
    }

    @Test
    fun `control - an id inside the tree reaches the provider and makes a thumbnail`() {
        val store = RecordingStore(tree)
        val item = FsThumbItems.answer(store, "primary:DCIM/Camera/IMG.jpg", 256) { _, _ -> }
        assertTrue(item is FsThumbItem.Made)
        assertEquals(listOf("primary:DCIM/Camera/IMG.jpg"), store.asked)
    }

    @Test
    fun `an undecidable id is still asked, and a missing one is gone`() {
        val store = RecordingStore { null }
        assertEquals(FsThumbItem.Gone, FsThumbItems.answer(store, "opaque-42", 256) { _, _ -> })
        assertEquals(listOf("opaque-42"), store.asked)
    }

    @Test
    fun `the tree rule - inside, the tree itself, a sibling with a shared prefix, a storage root, other providers`() {
        val ext = "com.android.externalstorage.documents"
        assertEquals(true, FsIdScope.inTree(ext, "primary:DCIM", "primary:DCIM/Camera/a.jpg"))
        assertEquals(true, FsIdScope.inTree(ext, "primary:DCIM", "primary:DCIM"))
        assertEquals(false, FsIdScope.inTree(ext, "primary:DCIM", "primary:DCIMX/a.jpg"))
        assertEquals(false, FsIdScope.inTree(ext, "primary:DCIM", "1000308768"))
        assertEquals(false, FsIdScope.inTree(ext, "primary:DCIM", "primary:Documents/a.txt"))
        assertEquals(true, FsIdScope.inTree(ext, "primary:", "primary:DCIM"))
        assertEquals(false, FsIdScope.inTree(ext, "primary:", "1234-5678:DCIM"))
        assertEquals(null, FsIdScope.inTree("com.google.android.apps.docs.storage", "acc=1;doc=x", "acc=1;doc=y"))
        assertEquals(null, FsIdScope.inTree(null, "primary:DCIM", "anything"))
    }
}
