package com.chetan.connectsuite.sync.v2

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * Turning a file into a thumbnail, in one place, for every `fs.*` root.
 *
 * ### Why the decode is here and not in each store
 *
 * `SafTreeStore`, `AppFilesStore` and `DownloadsStore` address three genuinely different things, and
 * `FsStore` exists because of that. But *"decode an image, shrink it to `maxEdge`, encode a JPEG"*
 * is the same work in all three, and three copies of it would be three places to get the sampling
 * arithmetic wrong. Each store supplies bytes; this decides what a thumbnail is.
 *
 * A store may still override the *source* — `SafTreeStore` asks the provider for its own cached
 * thumbnail first, which is far cheaper than decoding a 12 MP JPEG — but it comes back here to be
 * bounded and encoded, so a provider handing back something enormous cannot bypass the caps.
 */
object FsThumbs {

    /** The protocol's cap. Above this it is a preview and belongs on the bulk channel. */
    const val MAX_EDGE = 512

    /** What the wire asks for when it does not say. Matches `media.thumb`'s default. */
    const val DEFAULT_EDGE = 256

    /**
     * The protocol's batch cap. 32 x ~33 KB base64 is about 1 MB, well inside `MAX_CONTROL_FRAME`,
     * and it bounds head-of-line blocking on the channel that also carries `ping`.
     */
    const val MAX_IDS = 32

    /** JPEG quality. 80 is where a 256 px thumbnail stops getting visibly better and keeps growing. */
    private const val QUALITY = 80

    /** A thumbnail that was produced, with the dimensions it actually came out at. */
    data class Thumb(val bytes: ByteArray, val width: Int, val height: Int) {
        // Kotlin data classes compare a ByteArray by reference; these two are here so the type
        // behaves the way its name implies rather than surprising a future caller.
        override fun equals(other: Any?): Boolean =
            this === other ||
                (other is Thumb && width == other.width && height == other.height &&
                    bytes.contentEquals(other.bytes))

        override fun hashCode(): Int = 31 * (31 * bytes.contentHashCode() + width) + height
    }

    /** [maxEdge] clamped into the protocol's range. A request outside it is bounded, not refused. */
    fun edgeOf(requested: Int?): Int {
        val wanted = requested ?: DEFAULT_EDGE
        return wanted.coerceIn(1, MAX_EDGE)
    }

    /**
     * The sample factor `BitmapFactory` should decode at.
     *
     * **Pure, and separated from the decode so a test can reach it.** The arithmetic is the only
     * part that can be wrong in a way that produces a plausible picture: too small a factor decodes
     * a 12 MP image into memory to throw most of it away, and too large a one produces a thumbnail
     * blurrier than asked for. A JVM test cannot call `BitmapFactory`, which is exactly the reason
     * this is not inside it — the same seam as `SmsPayloads` and `SingleFlight`.
     *
     * `inSampleSize` must be a power of two; `BitmapFactory` rounds down to one anyway, so this
     * returns the largest power of two that keeps the **longest** edge at or above [maxEdge] — never
     * below, or [scaledSize] upscales afterwards, which is defect-shaped: the Photos pane once drew a
     * thumbnail at two and a half times its real size.
     *
     * **The longest edge, and that is the whole rule.** The first version required *both* edges to
     * stay above [maxEdge], which is the same picture and far more memory: a 8000×400 panorama has a
     * short edge under 256 immediately, so it never sampled at all and decoded 12.8 MB of bitmap to
     * produce a 256×13 thumbnail. [scaledSize] bounds by the longest edge, so this is the condition
     * that matches it.
     *
     * That was found by a mutation that **failed to fail**: flipping the `&&` to `||` broke no test,
     * because it produced identical output. The right response to a mutation nothing catches is not
     * a new test for the old code — it is asking what the condition is actually for, and here the
     * answer was that neither form said it.
     */
    fun sampleSize(width: Int, height: Int, maxEdge: Int): Int {
        if (width <= 0 || height <= 0) return 1
        val longest = maxOf(width, height)
        var sample = 1
        while (longest / (sample * 2) >= maxEdge) {
            sample *= 2
        }
        return sample
    }

    /**
     * The size a bitmap should be scaled to, preserving aspect ratio, never upscaling.
     *
     * Also pure, also for the reason above. Returning the source size when it is already smaller
     * than [maxEdge] is the rule that keeps a 64 px icon from being blown up to 256.
     */
    fun scaledSize(width: Int, height: Int, maxEdge: Int): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return 0 to 0
        val longest = maxOf(width, height)
        if (longest <= maxEdge) return width to height
        val factor = maxEdge.toDouble() / longest
        return maxOf(1, Math.round(width * factor).toInt()) to
            maxOf(1, Math.round(height * factor).toInt())
    }

    /**
     * Decode [open] twice — bounds first, then pixels — and encode a JPEG no larger than [maxEdge].
     *
     * [open] is called up to twice and must return a **fresh** stream each time: the first pass sets
     * `inJustDecodeBounds` and consumes the header, and a stream cannot be rewound in general.
     * Returning null from either call, or bytes that are not an image, yields null rather than
     * throwing — "this file has no thumbnail" is an ordinary answer for most files.
     */
    fun fromStream(open: () -> InputStream?, maxEdge: Int): Thumb? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val opened = open() ?: return null
        opened.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
        }
        val second = open() ?: return null
        val decoded = second.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
        return encode(decoded, maxEdge)
    }

    /** Bound an already-decoded bitmap and encode it. The one exit every thumbnail leaves by. */
    fun encode(bitmap: Bitmap, maxEdge: Int): Thumb? {
        val (width, height) = scaledSize(bitmap.width, bitmap.height, maxEdge)
        if (width <= 0 || height <= 0) return null
        val scaled =
            if (width == bitmap.width && height == bitmap.height) bitmap
            else Bitmap.createScaledBitmap(bitmap, width, height, true)
        val out = ByteArrayOutputStream()
        val ok = scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
        if (scaled !== bitmap) scaled.recycle()
        if (!ok) return null
        return Thumb(out.toByteArray(), width, height)
    }
}
