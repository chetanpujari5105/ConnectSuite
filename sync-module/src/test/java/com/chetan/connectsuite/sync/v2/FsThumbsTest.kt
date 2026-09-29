package com.chetan.connectsuite.sync.v2

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The thumbnail arithmetic, which is the half of `fs.thumb` that a JVM test can reach and the half
 * that can be wrong while still producing a picture.
 *
 * `BitmapFactory` and `Bitmap` are Android statics, so [FsThumbs.fromStream] and [FsThumbs.encode]
 * cannot run here. The answer to that in this repo is never `returnDefaultValues = true` — which
 * makes every Android call silently return null and every test vacuously green — it is to put the
 * decidable part somewhere a test can call it. [FsThumbs.sampleSize], [FsThumbs.scaledSize] and
 * [FsThumbs.edgeOf] are that part, and the code under test calls these same functions rather than a
 * second copy of the rule.
 *
 * **What this does not reach, said plainly:** nothing here proves a JPEG comes out, that the
 * provider's own thumbnail path in `SafTreeStore` works, or that base64 round-trips. Those need the
 * device, and they are step-level evidence in `docs/testing.md`.
 */
class FsThumbsTest {

    // ---- sampleSize -------------------------------------------------------------------------------

    @Test
    fun `a large photo is sampled down, never below the requested edge`() {
        // A 4000x3000 camera JPEG at 256: /8 is 500x375, /16 would be 250x187 — under 256 on both
        // edges, so 8 is the answer. Going further would decode smaller than asked and then upscale,
        // which is the defect the Photos pane already shipped once.
        assertEquals(8, FsThumbs.sampleSize(4000, 3000, 256))
    }

    @Test
    fun `an image already smaller than the edge is not sampled at all`() {
        assertEquals(1, FsThumbs.sampleSize(100, 80, 256))
    }

    @Test
    fun `the sample factor is always a power of two`() {
        for (w in listOf(300, 1024, 4000, 12000)) {
            for (edge in listOf(64, 256, 512)) {
                val s = FsThumbs.sampleSize(w, w, edge)
                assertTrue("$s is not a power of two (w=$w edge=$edge)", s > 0 && (s and (s - 1)) == 0)
            }
        }
    }

    @Test
    fun `a degenerate size does not divide by zero`() {
        assertEquals(1, FsThumbs.sampleSize(0, 0, 256))
        assertEquals(1, FsThumbs.sampleSize(-4, 10, 256))
    }

    @Test
    fun `a panorama is sampled, rather than decoded whole for a 13-pixel-tall thumbnail`() {
        // The memory property, and the one a mutation exposed by NOT failing. Requiring both edges
        // to stay above maxEdge meant an 8000x400 panorama never sampled at all — 12.8 MB of bitmap
        // decoded to produce 256x13. Bounding by the longest edge samples it to 500x25.
        val s = FsThumbs.sampleSize(8000, 400, 256)
        assertEquals(16, s)
        assertEquals(500, 8000 / s)
        // And the output is unchanged, which is why no correctness test could have caught it.
        assertEquals(256 to 13, FsThumbs.scaledSize(8000 / s, 400 / s, 256))
    }

    @Test
    fun `sampling never takes the longest edge below the requested size`() {
        // The property, over a spread rather than one case: after sampling, the image must still be
        // at least `edge` on at least one axis, or the encode step is upscaling.
        for (w in listOf(500, 1000, 4000, 8000)) {
            for (h in listOf(400, 1000, 3000, 6000)) {
                val edge = 256
                val s = FsThumbs.sampleSize(w, h, edge)
                val longest = maxOf(w, h)
                assertTrue(
                    "sampled ${w}x$h by $s → longest ${longest / s}, under $edge; scaling would upscale",
                    longest / s >= edge || longest < edge,
                )
            }
        }
    }

    // ---- scaledSize -------------------------------------------------------------------------------

    @Test
    fun `scaling preserves aspect ratio on the long edge`() {
        assertEquals(256 to 192, FsThumbs.scaledSize(4000, 3000, 256))
        assertEquals(192 to 256, FsThumbs.scaledSize(3000, 4000, 256))
    }

    @Test
    fun `a small image is returned at its own size and never upscaled`() {
        // The Photos pane drew a detail preview at two and a half times the thumbnail's real size.
        // This is that rule for `fs.thumb`, asserted rather than assumed.
        assertEquals(64 to 64, FsThumbs.scaledSize(64, 64, 256))
        assertEquals(100 to 80, FsThumbs.scaledSize(100, 80, 512))
    }

    @Test
    fun `a very wide image keeps at least one pixel on the short edge`() {
        val (w, h) = FsThumbs.scaledSize(10000, 3, 256)
        assertEquals(256, w)
        assertTrue("short edge collapsed to $h", h >= 1)
    }

    // ---- edgeOf -----------------------------------------------------------------------------------

    @Test
    fun `maxEdge is bounded rather than refused`() {
        assertEquals(FsThumbs.DEFAULT_EDGE, FsThumbs.edgeOf(null))
        assertEquals(256, FsThumbs.edgeOf(256))
        // The protocol caps at 512: above that it is a preview and belongs on the bulk channel.
        assertEquals(FsThumbs.MAX_EDGE, FsThumbs.edgeOf(4096))
        assertEquals(1, FsThumbs.edgeOf(0))
        assertEquals(1, FsThumbs.edgeOf(-10))
    }

    @Test
    fun `the batch cap matches the protocol`() {
        // `docs/protocol.md` says 32, for a reason it states: 32 x ~33 KB is about 1 MB, and the cap
        // bounds head-of-line blocking on the channel that also carries ping. A change here without
        // a change there is a wire that disagrees with its contract.
        assertEquals(32, FsThumbs.MAX_IDS)
        assertEquals(512, FsThumbs.MAX_EDGE)
    }

    // ---- the two together -------------------------------------------------------------------------

    @Test
    fun `sample then scale lands on the requested edge for a real camera photo`() {
        // The end-to-end arithmetic for the commonest case on this device: a 4000x3000 Camera JPEG.
        val edge = 256
        val s = FsThumbs.sampleSize(4000, 3000, edge)
        val (w, h) = FsThumbs.scaledSize(4000 / s, 3000 / s, edge)
        assertEquals(256, w)
        assertEquals(192, h)
    }

    /**
     * Defect 136: `media.thumb` answered 640 × 480 and 453 × 806 for `maxEdge: 512`, because the photo
     * path encoded whatever `loadThumbnail` returned. It now leaves through [FsThumbs.encode], so the
     * provider's oversized results are bounded by this rule — the measured sizes, fitted.
     */
    @Test fun `the provider's oversized thumbnails from defect 136 are fitted inside maxEdge`() {
        assertEquals(512 to 384, FsThumbs.scaledSize(640, 480, 512))
        assertEquals(288 to 512, FsThumbs.scaledSize(453, 806, 512))
        assertEquals("never upscaled", 300 to 200, FsThumbs.scaledSize(300, 200, 512))
        val reader = com.chetan.connectsuite.sync.SourceTree.kotlinFiles().single { it.name == "MediaStoreReader.kt" }.readText()
        assertTrue("media.thumb leaves by the one encoder", reader.contains("FsThumbs.encode(bitmap, edge)"))
        assertFalse("and never compresses the provider's bitmap itself", reader.contains("bitmap.compress("))
    }
}
