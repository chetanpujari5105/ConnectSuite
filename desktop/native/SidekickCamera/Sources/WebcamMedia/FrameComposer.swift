import CoreVideo
import VideoToolbox

public enum ComposeError: Error, Equatable {
    case session(OSStatus)
    case rotate(OSStatus)
    case transfer(OSStatus)
    case pool(CVReturn)
    case badRotation(UInt8)
}

/// A decoded frame into one published format: rotated upright, then fitted into landscape 16:9 with
/// its aspect ratio preserved. A portrait picture is pillarboxed — centred, full height, black bars —
/// and **never cropped** (docs/protocol.md → What the Mac publishes).
///
/// Both steps are VideoToolbox's: `VTPixelRotationSession` (macOS 13) and `VTPixelTransferSession`
/// in letterbox mode. The destination is filled black first, so the bars are black whatever the
/// transfer session does with the area outside the picture.
public final class FrameComposer {
    public let output: PublishedFormat
    private var rotation: VTPixelRotationSession?
    private var transfer: VTPixelTransferSession?
    private let pool: CVPixelBufferPool

    public private(set) var composed = 0
    /// Frames whose picture was smaller than the output in both dimensions: reported as upscaled,
    /// never as the output's resolution.
    public private(set) var upscaled = 0

    public init(output: PublishedFormat) throws {
        self.output = output
        guard let pool = PixelBuffers.makePool(width: output.width, height: output.height) else {
            throw ComposeError.pool(kCVReturnError)
        }
        self.pool = pool
        var t: VTPixelTransferSession?
        let st = VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &t)
        guard st == noErr, let t else { throw ComposeError.session(st) }
        VTSessionSetProperty(t, key: kVTPixelTransferPropertyKey_ScalingMode, value: kVTScalingMode_Letterbox)
        transfer = t
    }

    deinit {
        if let r = rotation { VTPixelRotationSessionInvalidate(r) }
        if let t = transfer { VTPixelTransferSessionInvalidate(t) }
    }

    /// `quarterTurns` is the header's rotation: quarter turns clockwise that make the picture upright.
    public func compose(_ source: CVPixelBuffer, quarterTurns: UInt8) throws -> CVPixelBuffer {
        guard quarterTurns <= 3 else { throw ComposeError.badRotation(quarterTurns) }
        let upright = quarterTurns == 0 ? source : try rotate(source, quarterTurns: quarterTurns)

        var out: CVPixelBuffer?
        let pst = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &out)
        guard pst == kCVReturnSuccess, let out else { throw ComposeError.pool(pst) }
        PixelBuffers.fill(out, y: PixelBuffers.blackY)
        let st = VTPixelTransferSessionTransferImage(transfer!, from: upright, to: out)
        guard st == noErr else { throw ComposeError.transfer(st) }

        composed += 1
        let w = CVPixelBufferGetWidth(upright), h = CVPixelBufferGetHeight(upright)
        let scale = min(Double(output.width) / Double(w), Double(output.height) / Double(h))
        if scale > 1.0 { upscaled += 1 }
        return out
    }

    /// Creates the rotation session now rather than on the first rotated frame. It needs nothing from
    /// the stream, so the bridge does it before a session's first frame (defect 177).
    public func prepareRotation() throws {
        guard rotation == nil else { return }
        var r: VTPixelRotationSession?
        let st = VTPixelRotationSessionCreate(kCFAllocatorDefault, &r)
        guard st == noErr, let r else { throw ComposeError.session(st) }
        rotation = r
    }

    private func rotate(_ source: CVPixelBuffer, quarterTurns: UInt8) throws -> CVPixelBuffer {
        try prepareRotation()
        let angle: CFString
        switch quarterTurns {
        case 1: angle = kVTRotation_CW90
        case 2: angle = kVTRotation_180
        default: angle = kVTRotation_CCW90
        }
        VTSessionSetProperty(rotation!, key: kVTPixelRotationPropertyKey_Rotation, value: angle)
        let w = CVPixelBufferGetWidth(source), h = CVPixelBufferGetHeight(source)
        let swap = quarterTurns % 2 == 1
        let dst = try PixelBuffers.makeNV12(width: swap ? h : w, height: swap ? w : h)
        let st = VTPixelRotationSessionRotateImage(rotation!, source, dst)
        guard st == noErr else { throw ComposeError.rotate(st) }
        return dst
    }
}

/// Scales a composed frame from one published format to another (the client chose the other one).
/// Both are 16:9, so this is a pure resize. The extension counts it, and labels an increase in size
/// as upscaled.
public final class FrameScaler {
    private let transfer: VTPixelTransferSession
    private var pools: [PublishedFormat: CVPixelBufferPool] = [:]

    public init() throws {
        var t: VTPixelTransferSession?
        let st = VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &t)
        guard st == noErr, let t else { throw ComposeError.session(st) }
        VTSessionSetProperty(t, key: kVTPixelTransferPropertyKey_ScalingMode, value: kVTScalingMode_Letterbox)
        transfer = t
    }

    deinit { VTPixelTransferSessionInvalidate(transfer) }

    public func fit(_ source: CVPixelBuffer, to format: PublishedFormat) throws -> CVPixelBuffer {
        if CVPixelBufferGetWidth(source) == format.width, CVPixelBufferGetHeight(source) == format.height {
            return source
        }
        if pools[format] == nil { pools[format] = PixelBuffers.makePool(width: format.width, height: format.height) }
        var out: CVPixelBuffer?
        let pst = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pools[format]!, &out)
        guard pst == kCVReturnSuccess, let out else { throw ComposeError.pool(pst) }
        PixelBuffers.fill(out, y: PixelBuffers.blackY)
        let st = VTPixelTransferSessionTransferImage(transfer, from: source, to: out)
        guard st == noErr else { throw ComposeError.transfer(st) }
        return out
    }
}
