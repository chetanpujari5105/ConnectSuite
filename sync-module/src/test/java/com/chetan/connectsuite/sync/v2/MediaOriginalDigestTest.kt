package com.chetan.connectsuite.sync.v2

import com.chetan.connectsuite.sync.SourceTree
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `media.original` acked `sha256: null` always, so no photo pull could ever be verified (2026-09-29).
 * It now follows `fs.transfer.begin`: pre-hashed at or below the ceiling, through the **same** routine,
 * and the ack carries what was computed. `registerMediaPull` needs a `Context` and `MediaStore`, which
 * no JVM test can build, so this guards the two call sites by source — the shape `FsArrivalTest` uses.
 */
class MediaOriginalDigestTest {
    @Test fun `media originals are pre-hashed by the Files rule and the ack carries the digest`() {
        val sources = SourceTree.kotlinFiles()
        assertTrue("the source scan found ${sources.size} files", sources.size > 10)
        val bulk = sources.single { it.name == "BulkTransfers.kt" }.readText()
        val media = sources.single { it.name == "MediaFeature.kt" }.readText()
        assertTrue(bulk.contains("sha256 = prehashStream(row.first, row.third) { context.contentResolver.openInputStream(uri) }"))
        assertTrue("Files and media share one pre-hash rule", bulk.contains("prehashStream(entry.name, entry.size) { store.openStream(entry.id) }"))
        assertTrue(media.contains("put(\"sha256\", pending.sha256)"))
        assertFalse("the ack no longer hard-codes null", media.contains("put(\"sha256\", null as String?)"))
    }
}
