import Foundation
import Testing
@testable import WebcamCore

/// The golden bytes live once, in docs/fixtures, and are read in place.
func goldenFrame() throws -> Data {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("docs/fixtures/webcam-au-v1.hex")
    let text = try String(contentsOf: url, encoding: .utf8)
    let hex = text.split(separator: "\n").filter { !$0.hasPrefix("#") }.joined()
        .filter { $0.isHexDigit }
    var out = Data()
    var i = hex.startIndex
    while i < hex.endIndex {
        let j = hex.index(i, offsetBy: 2)
        out.append(UInt8(hex[i..<j], radix: 16)!)
        i = j
    }
    return out
}

@Suite struct GoldenFixture {
    @Test func parsesEveryFieldTheContractNames() throws {
        let bytes = try goldenFrame()
        #expect(bytes.count == 53)
        let au = try WebcamAUCodec.parse(bytes)
        #expect(au.frame.flags == 0x03)
        #expect(au.frame.pts == 0x0102030405060708)
        #expect(au.frame.length == 40)
        #expect(au.header.facing == .front)
        #expect(au.header.rotation == 3)
        #expect(au.header.discontinuity == false)
        #expect(au.header.generation == 7)
        #expect(au.header.width == 1920 && au.header.height == 1080)
        #expect(au.header.sequence == 0x01020304)
        #expect(au.nalTypes == [7, 8, 5])
        #expect(au.isKeyframeWithConfig)
    }

    @Test func encoderReproducesTheGoldenBytes() throws {
        let bytes = try goldenFrame()
        let au = try WebcamAUCodec.parse(bytes)
        #expect(WebcamAUCodec.encode(header: au.header, pts: au.frame.pts, annexB: au.annexB) == bytes)
    }
}

/// Each row mutates the golden frame in exactly one place and names the error the contract's
/// malformed list requires — so a reader that accepts the mutation, or rejects it for another
/// reason, fails the row.
@Suite struct MalformedList {
    static func mutate(_ f: (inout [UInt8]) -> Void) throws -> Data {
        var b = [UInt8](try goldenFrame()); f(&b); return Data(b)
    }

    @Test func lengthOverTheCapIsRefusedFromTheDeclaredLengthAlone() throws {
        // 2 MiB + 1 declared, with only 40 bytes present: refused on the declaration, not after
        // trying to read 2 MiB.
        let d = try Self.mutate { b in b[9] = 0x00; b[10] = 0x20; b[11] = 0x00; b[12] = 0x01 }
        #expect(throws: MalformedAU.lengthOverCap(2 * 1024 * 1024 + 1)) { try WebcamAUCodec.parse(d) }
    }

    @Test func exactlyTheCapIsNotOverIt() throws {
        let annexB = Data([0, 0, 0, 1, 0x65]) + Data(count: WebcamAUCodec.maxPayload - WebcamHeader.size - 5)
        let h = WebcamHeader(facing: .back, rotation: 0, discontinuity: false, generation: 1, width: 1920, height: 1080, sequence: 1)
        let frame = WebcamAUCodec.encode(header: h, pts: 1, annexB: annexB)
        #expect(throws: Never.self) { try WebcamAUCodec.parse(frame) }
    }

    @Test func rows() throws {
        let cases: [(String, (inout [UInt8]) -> Void, MalformedAU)] = [
            ("frame flag bit 2", { $0[0] |= 0x04 }, .frameFlagsReserved(0x07)),
            ("version 2", { $0[13] = 2 }, .unknownVersion(2)),
            ("codec 2", { $0[14] = 2 }, .unknownCodec(2)),
            ("facing 3", { $0[15] = 3 }, .badFacing(3)),
            ("rotation 4", { $0[16] = 4 }, .badRotation(4)),
            ("header flag bit 1", { $0[17] = 0x02 }, .headerReservedBits),
            ("reserved byte", { $0[18] = 1 }, .headerReservedBits),
            ("generation 0", { $0[19] = 0; $0[20] = 0 }, .zeroGeneration),
            ("odd width", { $0[22] = 0x81 }, .badDimensions(width: 0x0781, height: 1080)),
            ("width 3842", { $0[21] = 0x0F; $0[22] = 0x02 }, .badDimensions(width: 3842, height: 1080)),
            ("height 14", { $0[23] = 0; $0[24] = 14 }, .badDimensions(width: 1920, height: 14)),
            ("no start code", { $0[29] = 0x09 }, .noStartCode),
            ("IDR claimed, slice is P", { $0[49] = 0x41 }, .idrFlagWithoutIDR),
            ("config claimed, no PPS", { $0[41] = 0x06 }, .configFlagWithoutConfig),
        ]
        for (name, f, expected) in cases {
            let d = try Self.mutate(f)
            #expect(throws: expected, "row: \(name)") { try WebcamAUCodec.parse(d) }
        }
    }

    @Test func truncatedFrames() throws {
        let b = try goldenFrame()
        #expect(throws: MalformedAU.shorterThanFrameHeader(12)) { try WebcamAUCodec.parse(b.prefix(12)) }
        #expect(throws: MalformedAU.lengthMismatch(declared: 40, actual: 39)) { try WebcamAUCodec.parse(b.prefix(52)) }
        // A payload under 21 bytes, declared honestly.
        var short = [UInt8](b.prefix(13 + 20)); short[12] = 20
        #expect(throws: MalformedAU.payloadTooShort(20)) { try WebcamAUCodec.parse(Data(short)) }
    }

    @Test func threeByteStartCodesAreAccepted() throws {
        let annexB = Data([0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2, 0, 0, 1, 0x65, 3])
        #expect(WebcamAUCodec.nalUnitTypes(annexB) == [7, 8, 5])
    }
}

@Suite struct StreamRules {
    func au(gen: UInt16, seq: UInt32, pts: UInt64, idr: Bool) throws -> WebcamAU {
        let annexB = idr ? Data([0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 3])
                         : Data([0, 0, 0, 1, 0x41, 9])
        let h = WebcamHeader(facing: .back, rotation: 0, discontinuity: false, generation: gen,
                             width: 1280, height: 720, sequence: seq)
        return try WebcamAUCodec.parse(WebcamAUCodec.encode(header: h, pts: pts, annexB: annexB))
    }

    @Test func aGenerationMustStartWithAnIDRCarryingSPSAndPPS() throws {
        var v = StreamValidator()
        #expect(v.check(try au(gen: 1, seq: 1, pts: 10, idr: false)) == .malformed(.generationDidNotStartWithKeyframe(1)))
        var w = StreamValidator()
        #expect(w.check(try au(gen: 1, seq: 1, pts: 10, idr: true)) == .accept)
        #expect(w.check(try au(gen: 1, seq: 2, pts: 20, idr: false)) == .accept)
        #expect(w.check(try au(gen: 2, seq: 3, pts: 30, idr: false)) == .malformed(.generationDidNotStartWithKeyframe(2)))
    }

    @Test func generationBackwardsAndSequenceNotIncreasingAreMalformed() throws {
        var v = StreamValidator()
        _ = v.check(try au(gen: 2, seq: 5, pts: 10, idr: true))
        #expect(v.check(try au(gen: 1, seq: 6, pts: 20, idr: true)) == .malformed(.generationWentBackwards(seen: 2, got: 1)))
        #expect(v.check(try au(gen: 2, seq: 5, pts: 30, idr: false)) == .malformed(.sequenceDidNotIncrease(last: 5, got: 5)))
    }

    @Test func aPTSThatDoesNotIncreaseCostsOneFrameNotTheSession() throws {
        var v = StreamValidator()
        _ = v.check(try au(gen: 1, seq: 1, pts: 100, idr: true))
        #expect(v.check(try au(gen: 1, seq: 2, pts: 100, idr: false)) == .dropOutOfOrderPTS)
        #expect(v.check(try au(gen: 1, seq: 3, pts: 99, idr: false)) == .dropOutOfOrderPTS)
        #expect(v.check(try au(gen: 1, seq: 4, pts: 101, idr: false)) == .accept)
        // A new generation's timeline starts over.
        #expect(v.check(try au(gen: 2, seq: 5, pts: 50, idr: true)) == .accept)
    }
}
