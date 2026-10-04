import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox
import WebcamCore
import WebcamMedia

/// Generated pictures with a known asymmetric marker, and real H.264 made from them by
/// `VTCompressionSession` — so the tests decode genuine access units without a phone.
public enum TestPatterns {
    /// Mid-grey picture with a bright block in the top-left quarter: after any rotation, where the
    /// block lands says which way the picture was turned.
    public static func marked(width: Int, height: Int, background: UInt8 = 110, marker: UInt8 = 235) throws -> CVPixelBuffer {
        let pb = try PixelBuffers.makeNV12(width: width, height: height)
        PixelBuffers.fill(pb, y: background)
        PixelBuffers.fill(pb, y: marker, rect: (0, 0, width / 2, height / 2))
        return pb
    }

    public static func flat(width: Int, height: Int, y: UInt8) throws -> CVPixelBuffer {
        let pb = try PixelBuffers.makeNV12(width: width, height: height)
        PixelBuffers.fill(pb, y: y)
        return pb
    }
}

public enum EncoderError: Error { case session(OSStatus), encode(OSStatus), noOutput }

/// A real hardware/software H.264 encoder producing Annex B access units — the phone's job, done
/// on the Mac for fixtures. Real time, no B-frames, so output order equals input order.
public final class TestH264Encoder {
    private let session: VTCompressionSession
    private var outputs: [(Data, Bool)] = []
    public let width: Int, height: Int

    /// Baseline by default; the decode probe's tests also ask for High, whose SPS carries the chroma
    /// format and scaling-matrix fields a Baseline SPS omits.
    public init(width: Int, height: Int, profile: CFString = kVTProfileLevel_H264_Baseline_AutoLevel) throws {
        self.width = width
        self.height = height
        var s: VTCompressionSession?
        let st = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(width), height: Int32(height),
                                            codecType: kCMVideoCodecType_H264, encoderSpecification: nil,
                                            imageBufferAttributes: nil, compressedDataAllocator: nil,
                                            outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        guard st == noErr, let s else { throw EncoderError.session(st) }
        session = s
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_ProfileLevel, value: profile)
        VTSessionSetProperty(s, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: NSNumber(value: 1000))
        VTCompressionSessionPrepareToEncodeFrames(s)
    }

    deinit { VTCompressionSessionInvalidate(session) }

    /// One picture in, one Annex B access unit out (SPS and PPS ahead of every IDR).
    public func encode(_ pb: CVPixelBuffer, ptsMicros: UInt64, forceKeyframe: Bool = false) throws -> (annexB: Data, isIDR: Bool) {
        var result: (Data, Bool)?
        var cbStatus: OSStatus = noErr
        let props = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        let st = VTCompressionSessionEncodeFrame(session, imageBuffer: pb,
                                                 presentationTimeStamp: CMTime(value: Int64(ptsMicros), timescale: 1_000_000),
                                                 duration: .invalid, frameProperties: props, infoFlagsOut: nil) { status, _, sb in
            cbStatus = status
            if let sb { result = Self.annexB(sb) }
        }
        guard st == noErr else { throw EncoderError.encode(st) }
        VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
        guard cbStatus == noErr else { throw EncoderError.encode(cbStatus) }
        guard let result else { throw EncoderError.noOutput }
        return result
    }

    static func annexB(_ sb: CMSampleBuffer) -> (Data, Bool) {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]]
        let notSync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        var out = Data()
        let start: [UInt8] = [0, 0, 0, 1]
        if !notSync, let fd = CMSampleBufferGetFormatDescription(sb) {
            var count = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: 0, parameterSetPointerOut: nil,
                                                               parameterSetSizeOut: nil, parameterSetCountOut: &count,
                                                               nalUnitHeaderLengthOut: nil)
            for i in 0..<count {
                var ptr: UnsafePointer<UInt8>?
                var size = 0
                CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: i, parameterSetPointerOut: &ptr,
                                                                   parameterSetSizeOut: &size, parameterSetCountOut: nil,
                                                                   nalUnitHeaderLengthOut: nil)
                if let ptr { out.append(contentsOf: start); out.append(ptr, count: size) }
            }
        }
        guard let block = CMSampleBufferGetDataBuffer(sb) else { return (out, !notSync) }
        var length = 0
        var ptr: UnsafeMutablePointer<CChar>?
        CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &ptr)
        guard let ptr else { return (out, !notSync) }
        let raw = UnsafeRawPointer(ptr).assumingMemoryBound(to: UInt8.self)
        var i = 0
        while i + 4 <= length {
            let n = Int(raw[i]) << 24 | Int(raw[i + 1]) << 16 | Int(raw[i + 2]) << 8 | Int(raw[i + 3])
            out.append(contentsOf: start)
            out.append(raw + i + 4, count: n)
            i += 4 + n
        }
        return (out, !notSync)
    }
}

/// Builds wire frames the way the phone will: one AU, the 13-byte frame header, the 16-byte webcam
/// header, an increasing sequence.
public struct PhoneStandIn {
    public var facing: Facing = .front
    public var rotation: UInt8 = 0
    public var generation: UInt16 = 1
    public var sequence: UInt32 = 0
    public var ptsMicros: UInt64 = 1_000_000

    public init() {}

    public mutating func frame(annexB: Data, width: Int, height: Int, discontinuity: Bool = false) -> Data {
        sequence += 1
        ptsMicros += 33_333
        return WebcamAUCodec.encode(
            header: WebcamHeader(facing: facing, rotation: rotation, discontinuity: discontinuity,
                                 generation: generation, width: UInt16(width), height: UInt16(height),
                                 sequence: sequence),
            pts: ptsMicros, annexB: annexB)
    }
}
