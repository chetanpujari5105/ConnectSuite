import CoreMedia
import CoreVideo

/// What Sidekick Camera advertises (docs/protocol.md → What the Mac publishes). `420v` only, two
/// sizes, 15–30 fps. The client picks; 1080p/30 is a target, never a promise.
public struct PublishedFormat: Hashable, Sendable, CustomStringConvertible {
    public let width: Int
    public let height: Int

    public static let pixelFormat: OSType = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange // '420v'
    public static let fullHD = PublishedFormat(width: 1920, height: 1080)
    public static let hd = PublishedFormat(width: 1280, height: 720)
    /// Index order is the order the extension lists them in.
    public static let all: [PublishedFormat] = [.fullHD, .hd]

    /// Frame durations: the fastest a client may ask for, and the slowest.
    public static let minFrameDuration = CMTime(value: 1, timescale: 30)
    public static let maxFrameDuration = CMTime(value: 1, timescale: 15)

    public static func matching(width: Int, height: Int) -> PublishedFormat? {
        all.first { $0.width == width && $0.height == height }
    }

    public func makeFormatDescription() -> CMVideoFormatDescription {
        var fd: CMVideoFormatDescription?
        let st = CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault, codecType: Self.pixelFormat,
            width: Int32(width), height: Int32(height), extensions: nil, formatDescriptionOut: &fd)
        precondition(st == noErr && fd != nil, "CMVideoFormatDescriptionCreate failed: \(st)")
        return fd!
    }

    public var description: String { "\(width)×\(height) 420v" }
}
