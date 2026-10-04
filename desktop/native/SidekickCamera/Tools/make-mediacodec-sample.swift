// Writes docs/fixtures/webcam-mediacodec-sample-v1.txt: REAL H.264 from VideoToolbox, cut into the
// buffers an Android MediaCodec encoder hands out — SPS and PPS once per encoder in a separate
// `config` buffer, IDRs **without** them, P-frames — so the phone's assembler and writer can be run on
// genuine bitstream bytes in a JVM test, and the Swift bridge can decode what the phone's writer made.
//
// It is a Mac encoder standing in for the phone's: it proves the wrapping and the decode, and says
// nothing about what this phone's MediaCodec produces. Run once; the output is committed.
//
//   swift desktop/native/SidekickCamera/Tools/make-mediacodec-sample.swift > docs/fixtures/webcam-mediacodec-sample-v1.txt
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

func nv12(_ w: Int, _ h: Int, frame: Int) -> CVPixelBuffer {
    var pb: CVPixelBuffer?
    let attrs = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, attrs, &pb)
    let p = pb!
    CVPixelBufferLockBaseAddress(p, [])
    let y = CVPixelBufferGetBaseAddressOfPlane(p, 0)!.assumingMemoryBound(to: UInt8.self)
    let ys = CVPixelBufferGetBytesPerRowOfPlane(p, 0)
    for r in 0..<h { for c in 0..<w {
        // A gradient with a bright block that moves, so P-frames carry real motion.
        let inBlock = c >= frame * 8 && c < frame * 8 + w / 4 && r < h / 2
        y[r * ys + c] = inBlock ? 235 : UInt8(40 + (c * 150 / w))
    } }
    let uv = CVPixelBufferGetBaseAddressOfPlane(p, 1)!.assumingMemoryBound(to: UInt8.self)
    let uvs = CVPixelBufferGetBytesPerRowOfPlane(p, 1)
    for r in 0..<(h / 2) { for c in 0..<w { uv[r * uvs + c] = 128 } }
    CVPixelBufferUnlockBaseAddress(p, [])
    return p
}

struct Out { var config = Data(); var units: [(Bool, Data)] = [] }

func encode(width: Int, height: Int, keyAt: Set<Int>, count: Int) -> Out {
    var s: VTCompressionSession?
    VTCompressionSessionCreate(allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
                               encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
                               outputCallback: nil, refcon: nil, compressionSessionOut: &s)
    let session = s!
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: NSNumber(value: 1000))
    VTCompressionSessionPrepareToEncodeFrames(session)
    var out = Out()
    let start: [UInt8] = [0, 0, 0, 1]
    for i in 0..<count {
        let props = keyAt.contains(i) ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        VTCompressionSessionEncodeFrame(session, imageBuffer: nv12(width, height, frame: i),
                                        presentationTimeStamp: CMTime(value: Int64(i) * 33_333, timescale: 1_000_000),
                                        duration: .invalid, frameProperties: props, infoFlagsOut: nil) { _, _, sb in
            guard let sb else { return }
            let att = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]]
            let key = !(att?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
            if key && out.config.isEmpty, let fd = CMSampleBufferGetFormatDescription(sb) {
                var n = 0
                CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: 0, parameterSetPointerOut: nil,
                                                                   parameterSetSizeOut: nil, parameterSetCountOut: &n, nalUnitHeaderLengthOut: nil)
                for k in 0..<n {
                    var ptr: UnsafePointer<UInt8>?; var size = 0
                    CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fd, parameterSetIndex: k, parameterSetPointerOut: &ptr,
                                                                       parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
                    out.config.append(contentsOf: start); out.config.append(ptr!, count: size)
                }
            }
            // The slices only: SPS and PPS travel once, in `config`, as MediaCodec sends them.
            var unit = Data()
            let block = CMSampleBufferGetDataBuffer(sb)!
            var length = 0; var raw: UnsafeMutablePointer<CChar>?
            CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &raw)
            let b = UnsafeRawPointer(raw!).assumingMemoryBound(to: UInt8.self)
            var j = 0
            while j + 4 <= length {
                let n = Int(b[j]) << 24 | Int(b[j + 1]) << 16 | Int(b[j + 2]) << 8 | Int(b[j + 3])
                let type = b[j + 4] & 0x1F
                if type != 7 && type != 8 && type != 6 { unit.append(contentsOf: start); unit.append(b + j + 4, count: n) }
                j += 4 + n
            }
            out.units.append((key, unit))
        }
        VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
    }
    VTCompressionSessionInvalidate(session)
    return out
}

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

print("""
# Webcam v1 — REAL H.264 cut into MediaCodec-shaped buffers (VideoToolbox, Baseline, no reordering).
# Generated by desktop/native/SidekickCamera/Tools/make-mediacodec-sample.swift; a Mac encoder standing
# in for the phone's. Read by camera-module's WebcamPhoneStreamFixtureTest, which runs the phone's
# assembler and writer over it and must reproduce docs/fixtures/webcam-phone-stream-v1.hex byte for byte.
#
# `generation <n> <facing> <width> <height> <rotation>` opens a new encoder (a switch).
# `config` is the SPS+PPS buffer (BUFFER_FLAG_CODEC_CONFIG); `key` an IDR with no SPS/PPS; `delta` a P-frame.
# SEI units were dropped by the generator so the sample stays small; nothing else was edited.
""")
for (g, facing, w, h, rot, keys, n) in [(1, "front", 320, 180, 1, Set([0, 4]), 6), (2, "back", 256, 144, 0, Set([0]), 3)] {
    let o = encode(width: w, height: h, keyAt: keys, count: n)
    print("generation \(g) \(facing) \(w) \(h) \(rot)")
    print("config \(hex(o.config))")
    for (key, unit) in o.units { print("\(key ? "key" : "delta") \(hex(unit))") }
}
