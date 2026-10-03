import CoreVideo
import CryptoKit
import Foundation

public enum PixelBufferError: Error, Equatable {
    case create(CVReturn)
    case lock(CVReturn)
}

/// IOSurface-backed NV12 (`420v`) buffers: the format the decoder emits, the composer writes and
/// the extension publishes. IOSurface backing is what lets a frame cross to the extension as a
/// mach port rather than as copied pixels.
public enum PixelBuffers {
    public static let blackY: UInt8 = 16
    public static let neutralC: UInt8 = 128

    public static func attributes(width: Int, height: Int) -> [CFString: Any] {
        [
            kCVPixelBufferPixelFormatTypeKey: PublishedFormat.pixelFormat,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as [CFString: Any],
        ]
    }

    public static func makeNV12(width: Int, height: Int) throws -> CVPixelBuffer {
        var pb: CVPixelBuffer?
        let st = CVPixelBufferCreate(kCFAllocatorDefault, width, height, PublishedFormat.pixelFormat,
                                     attributes(width: width, height: height) as CFDictionary, &pb)
        guard st == kCVReturnSuccess, let pb else { throw PixelBufferError.create(st) }
        return pb
    }

    public static func makePool(width: Int, height: Int, minimumBuffers: Int = 3) -> CVPixelBufferPool? {
        var pool: CVPixelBufferPool?
        CVPixelBufferPoolCreate(kCFAllocatorDefault,
                                [kCVPixelBufferPoolMinimumBufferCountKey: minimumBuffers] as CFDictionary,
                                attributes(width: width, height: height) as CFDictionary, &pool)
        return pool
    }

    /// Fills a rectangle (in luma pixels) of an NV12 buffer with one colour.
    public static func fill(_ pb: CVPixelBuffer, y: UInt8, cb: UInt8 = neutralC, cr: UInt8 = neutralC,
                            rect: (x: Int, y: Int, w: Int, h: Int)? = nil) {
        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        let r = rect ?? (0, 0, w, h)
        let yBase = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
        let yStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        for row in max(0, r.y)..<min(h, r.y + r.h) {
            memset(yBase + row * yStride + max(0, r.x), Int32(y), min(w, r.x + r.w) - max(0, r.x))
        }
        let cBase = CVPixelBufferGetBaseAddressOfPlane(pb, 1)!.assumingMemoryBound(to: UInt8.self)
        let cStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
        for row in max(0, r.y / 2)..<min(h / 2, (r.y + r.h) / 2) {
            var p = cBase + row * cStride + max(0, r.x / 2) * 2
            for _ in max(0, r.x / 2)..<min(w / 2, (r.x + r.w) / 2) {
                p[0] = cb; p[1] = cr; p += 2
            }
        }
    }

    public static func luma(_ pb: CVPixelBuffer, x: Int, y: Int) -> UInt8 {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
        return base[y * CVPixelBufferGetBytesPerRowOfPlane(pb, 0) + x]
    }

    /// Mean luma over a rectangle — robust to codec noise, which a single pixel is not.
    public static func meanLuma(_ pb: CVPixelBuffer, x: Int, y: Int, w: Int, h: Int) -> Double {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        var sum = 0
        for row in y..<(y + h) { for col in x..<(x + w) { sum += Int(base[row * stride + col]) } }
        return Double(sum) / Double(w * h)
    }

    /// SHA-256 over the visible pixels of both planes (row padding excluded), so two buffers with
    /// the same picture hash equal whatever their strides.
    public static func digest(_ pb: CVPixelBuffer) -> String {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        var hasher = SHA256()
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        for plane in 0..<CVPixelBufferGetPlaneCount(pb) {
            let base = CVPixelBufferGetBaseAddressOfPlane(pb, plane)!
            let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, plane)
            let rows = plane == 0 ? h : h / 2
            let rowBytes = plane == 0 ? w : (w / 2) * 2
            for r in 0..<rows {
                hasher.update(bufferPointer: UnsafeRawBufferPointer(start: base + r * stride, count: rowBytes))
            }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    public static func isIOSurfaceBacked(_ pb: CVPixelBuffer) -> Bool {
        CVPixelBufferGetIOSurface(pb) != nil
    }
}
