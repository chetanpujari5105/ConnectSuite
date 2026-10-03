import CoreGraphics
import CoreText
import CoreVideo
import Foundation
import VideoToolbox

/// The two cards Sidekick Camera can show instead of the camera (docs/protocol.md → What the
/// picture is). Other people in a meeting see these, so they name no phone, person or network, and
/// neither claims live video.
public enum Card: String, CaseIterable, Sendable {
    case cameraOff = "camera off"
    case videoPaused = "video paused"

    public var text: String {
        switch self {
        case .cameraOff: return "Sidekick Camera — camera off"
        case .videoPaused: return "Sidekick Camera — video paused"
        }
    }
}

public enum CardError: Error { case context, transfer(OSStatus) }

/// Renders each card once per format, with CoreText into a BGRA buffer and then into `420v` through
/// `VTPixelTransferSession`, and caches the result. A tick showing a card costs a dictionary lookup.
///
/// The cached buffer is never written again after it is rendered. That is what makes "a stop clears
/// the picture" checkable: a card delivered after a stop is this exact, pristine buffer, and nothing
/// of a session's last frame can be in it.
public final class PlaceholderCards {
    private var cache: [String: CVPixelBuffer] = [:]
    private let lock = NSLock()
    public private(set) var renders = 0

    public init() {}

    public func buffer(_ card: Card, format: PublishedFormat) throws -> CVPixelBuffer {
        lock.lock(); defer { lock.unlock() }
        let key = "\(card.rawValue)@\(format.width)x\(format.height)"
        if let hit = cache[key] { return hit }
        let made = try render(card, format: format)
        cache[key] = made
        renders += 1
        return made
    }

    private func render(_ card: Card, format: PublishedFormat) throws -> CVPixelBuffer {
        let w = format.width, h = format.height
        var bgra: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA,
                            [kCVPixelBufferIOSurfacePropertiesKey: [:] as [CFString: Any]] as CFDictionary, &bgra)
        guard let bgra else { throw CardError.context }
        CVPixelBufferLockBaseAddress(bgra, [])
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(bgra), width: w, height: h,
                                  bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(bgra),
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                                      | CGBitmapInfo.byteOrder32Little.rawValue) else {
            CVPixelBufferUnlockBaseAddress(bgra, [])
            throw CardError.context
        }
        ctx.setFillColor(CGColor(red: 0.07, green: 0.07, blue: 0.09, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let font = CTFontCreateWithName("Helvetica Neue" as CFString, CGFloat(h) / 18, nil)
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0.82, alpha: 1),
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: card.text, attributes: attrs))
        let bounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
        ctx.textPosition = CGPoint(x: (CGFloat(w) - bounds.width) / 2 - bounds.minX,
                                   y: (CGFloat(h) - bounds.height) / 2 - bounds.minY)
        CTLineDraw(line, ctx)
        CVPixelBufferUnlockBaseAddress(bgra, [])

        let out = try PixelBuffers.makeNV12(width: w, height: h)
        var t: VTPixelTransferSession?
        VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &t)
        guard let t else { throw CardError.transfer(-1) }
        defer { VTPixelTransferSessionInvalidate(t) }
        let st = VTPixelTransferSessionTransferImage(t, from: bgra, to: out)
        guard st == noErr else { throw CardError.transfer(st) }
        return out
    }
}
