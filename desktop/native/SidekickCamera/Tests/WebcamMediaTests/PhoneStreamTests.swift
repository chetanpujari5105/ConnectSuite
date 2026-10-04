import CoreVideo
import Foundation
import Testing
import WebcamCore
@testable import WebcamMedia

/// The stream the **phone's** production writer produced (camera-module's WebcamPhoneStreamFixtureTest
/// reproduces `docs/fixtures/webcam-phone-stream-v1.hex` byte for byte), read in place and run through the
/// bridge's real admission rules and a real VideoToolbox decode.
///
/// Real: the phone's machine gate, assembler and writer (in Kotlin, on the JVM); this gate and decoder.
/// **Stood in for:** the phone's encoder — the bitstream came from a Mac's VideoToolbox, cut into
/// MediaCodec-shaped buffers (`docs/fixtures/webcam-mediacodec-sample-v1.txt`). So this proves the wrap and
/// the decode, not what this phone's MediaCodec emits.
@Suite struct PhoneStream {
    static func frames() throws -> [Data] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("docs/fixtures/webcam-phone-stream-v1.hex")
        return try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
            .filter { !$0.hasPrefix("#") && !$0.isEmpty }
            .map { line in
                var out = Data()
                var i = line.startIndex
                while i < line.endIndex {
                    let j = line.index(i, offsetBy: 2)
                    out.append(UInt8(line[i..<j], radix: 16)!)
                    i = j
                }
                return out
            }
    }

    @Test func everyAUThePhoneWroteIsAdmittedAndDecodes() throws {
        let frames = try Self.frames()
        #expect(frames.count == 9)
        let session = SessionID(hex: "5ed15e5510000000000000000000c0de")!
        var gate = SessionGate(consumers: 1)
        #expect(gate.sessionLive(session, generation: 1) == [.startSink(session)])
        let decoder = H264Decoder()
        var sizes: [String] = []
        for f in frames {
            guard case let .accept(au) = gate.admit(session: session, frame: f) else {
                Issue.record("the gate refused an AU the phone wrote: \(gate.dropped)"); return
            }
            let pb = try decoder.decode(annexB: au.annexB, ptsMicros: au.frame.pts)
            sizes.append("\(CVPixelBufferGetWidth(pb))x\(CVPixelBufferGetHeight(pb)) g\(au.header.generation) r\(au.header.rotation)")
        }
        #expect(gate.accepted == 9 && gate.droppedTotal == 0)
        #expect(sizes == Array(repeating: "320x180 g1 r1", count: 6) + Array(repeating: "256x144 g2 r0", count: 3))
        #expect(gate.live == session)
    }

    @Test func theSwitchIsADiscontinuityAndStartsWithAnIDRWithSPSAndPPS() throws {
        let aus = try Self.frames().map { try WebcamAUCodec.parse($0) }
        #expect(aus.map(\.isKeyframeWithConfig) == [true, false, false, false, true, false, true, false, false])
        #expect(aus.map(\.header.discontinuity) == [false, false, false, false, false, false, true, false, false])
        #expect(aus.map(\.header.facing) == [.front, .front, .front, .front, .front, .front, .back, .back, .back])
        #expect(aus.map(\.header.sequence) == Array(1...9).map(UInt32.init))
        // The bridge's own stream rules agree: nothing fatal, nothing out of order.
        var v = StreamValidator()
        #expect(aus.allSatisfy { v.check($0) == .accept })
    }
}
