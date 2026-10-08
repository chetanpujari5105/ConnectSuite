package com.chetan.connectsuite.link

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * The pairing scanner's decoder: one camera luminance plane in, the QR's text out, or null.
 *
 * ZXing core (Apache-2.0) replaced ML Kit on 2026-10-08. It is a pure-Java decoder — no model download,
 * no Play services, no network and no telemetry — so the phone's *nothing leaves your network* is true of
 * the scanner too. Pure, so `QrFrameDecoderTest` reaches it with the Mac's own code as input.
 *
 * Rotation is not applied: QR finder patterns are rotation-invariant, so a code held sideways decodes
 * as it is. The text is read as UTF-8, which is how the Mac's `qrcode` encoder writes byte mode.
 */
object QrFrameDecoder {

    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.CHARACTER_SET to "UTF-8",
        DecodeHintType.TRY_HARDER to true,
    )

    fun decode(luma: ByteArray, rowStride: Int, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || rowStride < width) return null
        // The camera's last row may stop at `width` rather than run to the stride. Padding to a full
        // frame covers that and any short buffer: the padding is zeros, which carry no code.
        val padded = if (luma.size >= rowStride * height) luma else luma.copyOf(rowStride * height)
        val source = PlanarYUVLuminanceSource(padded, rowStride, height, 0, 0, width, height, false)
        val reader = QRCodeReader()
        return try {
            reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (_: ReaderException) {
            // `NotFoundException` — no code in view yet, the answer for almost every frame — and a code
            // that did not read cleanly (checksum, format). Either way the next frame tries again.
            null
        } finally {
            reader.reset()
        }
    }
}
