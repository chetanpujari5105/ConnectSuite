import CoreMedia
import CoreVideo
import VideoToolbox
import WebcamCore

public enum DecodeError: Error, Equatable {
    /// A non-IDR, or an IDR with no parameter sets ever seen: nothing to decode it against.
    case noParameterSets
    case formatDescription(OSStatus)
    case session(OSStatus)
    case blockBuffer(OSStatus)
    case sampleBuffer(OSStatus)
    case decode(OSStatus)
    case noImage
}

/// One H.264 access unit (Annex B) in, one IOSurface-backed `420v` buffer out, through
/// `VTDecompressionSession`. Synchronous: the bridge decodes in order on its own queue, and a
/// decode that returned has either produced a frame or said why not.
///
/// New SPS/PPS (a new generation, a camera switch, an encoder reconfiguration) replace the session,
/// because the old session's format no longer describes the bytes.
public final class H264Decoder {
    private var session: VTDecompressionSession?
    private var format: CMVideoFormatDescription?
    private var parameterSets: [Data] = []
    public private(set) var sessionsCreated = 0

    public init() {}

    deinit { invalidate() }

    public func invalidate() {
        if let s = session {
            VTDecompressionSessionWaitForAsynchronousFrames(s)
            VTDecompressionSessionInvalidate(s)
        }
        session = nil
        format = nil
        parameterSets = []
    }

    public func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
        guard let units = WebcamAUCodec.nalUnits(annexB) else { throw DecodeError.noParameterSets }
        let sps = units.first { ($0.first ?? 0) & 0x1F == 7 }
        let pps = units.first { ($0.first ?? 0) & 0x1F == 8 }
        if let sps, let pps, [sps, pps] != parameterSets {
            try configure(sps: sps, pps: pps)
        }
        guard let session, let format else { throw DecodeError.noParameterSets }

        // AVCC: each slice NAL behind a 4-byte big-endian length. Parameter sets and access-unit
        // delimiters live in the format description, not in the sample.
        var avcc = Data()
        for unit in units where ![7, 8, 9].contains((unit.first ?? 0) & 0x1F) {
            var len = UInt32(unit.count).bigEndian
            avcc.append(Data(bytes: &len, count: 4))
            avcc.append(unit)
        }

        var block: CMBlockBuffer?
        var st = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: avcc.count,
            blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
            dataLength: avcc.count, flags: 0, blockBufferOut: &block)
        guard st == noErr, let block else { throw DecodeError.blockBuffer(st) }
        st = avcc.withUnsafeBytes {
            CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block,
                                          offsetIntoDestination: 0, dataLength: avcc.count)
        }
        guard st == noErr else { throw DecodeError.blockBuffer(st) }

        var timing = CMSampleTimingInfo(duration: .invalid,
                                        presentationTimeStamp: CMTime(value: Int64(ptsMicros), timescale: 1_000_000),
                                        decodeTimeStamp: .invalid)
        var sizes = [avcc.count]
        var sample: CMSampleBuffer?
        st = CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block,
                                       formatDescription: format, sampleCount: 1,
                                       sampleTimingEntryCount: 1, sampleTimingArray: &timing,
                                       sampleSizeEntryCount: 1, sampleSizeArray: &sizes,
                                       sampleBufferOut: &sample)
        guard st == noErr, let sample else { throw DecodeError.sampleBuffer(st) }

        var image: CVImageBuffer?
        var callbackStatus: OSStatus = noErr
        st = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: [],
                                               infoFlagsOut: nil) { status, _, buffer, _, _ in
            callbackStatus = status
            image = buffer
        }
        VTDecompressionSessionWaitForAsynchronousFrames(session)
        guard st == noErr else { throw DecodeError.decode(st) }
        guard callbackStatus == noErr else { throw DecodeError.decode(callbackStatus) }
        guard let image else { throw DecodeError.noImage }
        return image
    }

    private func configure(sps: Data, pps: Data) throws {
        invalidate()
        var fd: CMVideoFormatDescription?
        let st: OSStatus = sps.withUnsafeBytes { s in
            pps.withUnsafeBytes { p in
                let ptrs = [s.bindMemory(to: UInt8.self).baseAddress!, p.bindMemory(to: UInt8.self).baseAddress!]
                let sizes = [sps.count, pps.count]
                return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: kCFAllocatorDefault, parameterSetCount: 2, parameterSetPointers: ptrs,
                    parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &fd)
            }
        }
        guard st == noErr, let fd else { throw DecodeError.formatDescription(st) }
        let dims = CMVideoFormatDescriptionGetDimensions(fd)
        let attrs = PixelBuffers.attributes(width: Int(dims.width), height: Int(dims.height))
        var s: VTDecompressionSession?
        let cst = VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: fd,
                                               decoderSpecification: nil,
                                               imageBufferAttributes: attrs as CFDictionary,
                                               outputCallback: nil, decompressionSessionOut: &s)
        guard cst == noErr, let s else { throw DecodeError.session(cst) }
        session = s
        format = fd
        parameterSets = [sps, pps]
        sessionsCreated += 1
    }
}
