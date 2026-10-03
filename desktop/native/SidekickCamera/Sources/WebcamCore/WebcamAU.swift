import Foundation

// docs/protocol.md → The webcam access unit. One H.264 access unit per video-channel frame: the
// 13-byte frame header, then a 16-byte webcam header, then Annex B.

public enum Facing: UInt8, Sendable, Equatable {
    case back = 0, front = 1, external = 2
}

/// The video channel's 13-byte header. Its flags are the access unit's own: IDR and SPS/PPS.
public struct FrameHeader: Sendable, Equatable {
    public static let size = 13
    public static let flagIDR: UInt8 = 0x01
    public static let flagConfig: UInt8 = 0x02

    public var flags: UInt8
    /// µs, the phone's CLOCK_MONOTONIC at capture (the `pong` monoUs clock). Never a presentation
    /// time on the Mac: the device stamps frames with the Mac's host clock at delivery.
    public var pts: UInt64
    public var length: UInt32

    public init(flags: UInt8, pts: UInt64, length: UInt32) {
        self.flags = flags
        self.pts = pts
        self.length = length
    }

    public var claimsIDR: Bool { flags & Self.flagIDR != 0 }
    public var claimsConfig: Bool { flags & Self.flagConfig != 0 }
}

/// The 16-byte webcam header at the start of every payload.
public struct WebcamHeader: Sendable, Equatable {
    public static let size = 16
    public static let version: UInt8 = 1
    public static let codecH264AnnexB: UInt8 = 1
    public static let flagDiscontinuity: UInt8 = 0x01

    public var facing: Facing
    /// Quarter turns clockwise that make the picture upright, 0...3.
    public var rotation: UInt8
    public var discontinuity: Bool
    public var generation: UInt16
    /// Coded size, before rotation.
    public var width: UInt16
    public var height: UInt16
    public var sequence: UInt32

    public init(facing: Facing, rotation: UInt8, discontinuity: Bool, generation: UInt16,
                width: UInt16, height: UInt16, sequence: UInt32) {
        self.facing = facing
        self.rotation = rotation
        self.discontinuity = discontinuity
        self.generation = generation
        self.width = width
        self.height = height
        self.sequence = sequence
    }
}

public struct WebcamAU: Sendable, Equatable {
    public var frame: FrameHeader
    public var header: WebcamHeader
    /// The Annex B bytes, starting with a start code.
    public var annexB: Data
    /// NAL unit types in order of appearance.
    public var nalTypes: [UInt8]

    public var isIDR: Bool { nalTypes.contains(5) }
    public var hasConfig: Bool { nalTypes.contains(7) && nalTypes.contains(8) }
    /// What a new generation, or a recovery after a drop, must start with.
    public var isKeyframeWithConfig: Bool { isIDR && hasConfig }
}

/// Everything the contract lists as malformed for a single AU. The Mac closes the stream on any of
/// them. Rules that need the session's history (generation going backwards, sequence not increasing,
/// the first AU of a generation) are `StreamValidator`'s.
public enum MalformedAU: Error, Sendable, Equatable {
    case shorterThanFrameHeader(Int)
    case frameFlagsReserved(UInt8)
    case lengthOverCap(UInt32)
    case lengthMismatch(declared: UInt32, actual: Int)
    case payloadTooShort(Int)
    case unknownVersion(UInt8)
    case unknownCodec(UInt8)
    case badFacing(UInt8)
    case badRotation(UInt8)
    case headerReservedBits
    case badDimensions(width: UInt16, height: UInt16)
    case zeroGeneration
    case noStartCode
    case idrFlagWithoutIDR
    case configFlagWithoutConfig
}

public enum WebcamAUCodec {
    /// WEBCAM_MAX_AU: the payload (webcam header plus Annex B), not counting the frame header.
    public static let maxPayload = 2 * 1024 * 1024
    /// The header, a 4-byte start code and one NAL header byte.
    public static let minPayload = WebcamHeader.size + 5
    public static let minDimension: UInt16 = 16
    public static let maxDimension: UInt16 = 3840

    /// Parses one whole frame: the 13-byte frame header and exactly `length` payload bytes.
    public static func parse(_ bytes: Data) throws -> WebcamAU {
        let b = [UInt8](bytes)
        guard b.count >= FrameHeader.size else { throw MalformedAU.shorterThanFrameHeader(b.count) }
        let flags = b[0]
        guard flags & ~(FrameHeader.flagIDR | FrameHeader.flagConfig) == 0 else {
            throw MalformedAU.frameFlagsReserved(flags)
        }
        let pts = readU64(b, 1)
        let length = readU32(b, 9)
        // The cap is checked against the declared length before anything else is trusted.
        guard length <= UInt32(maxPayload) else { throw MalformedAU.lengthOverCap(length) }
        guard b.count - FrameHeader.size == Int(length) else {
            throw MalformedAU.lengthMismatch(declared: length, actual: b.count - FrameHeader.size)
        }
        guard Int(length) >= minPayload else { throw MalformedAU.payloadTooShort(Int(length)) }

        let p = FrameHeader.size
        guard b[p] == WebcamHeader.version else { throw MalformedAU.unknownVersion(b[p]) }
        guard b[p + 1] == WebcamHeader.codecH264AnnexB else { throw MalformedAU.unknownCodec(b[p + 1]) }
        guard let facing = Facing(rawValue: b[p + 2]) else { throw MalformedAU.badFacing(b[p + 2]) }
        let rotation = b[p + 3]
        guard rotation <= 3 else { throw MalformedAU.badRotation(rotation) }
        let hflags = b[p + 4]
        guard hflags & ~WebcamHeader.flagDiscontinuity == 0, b[p + 5] == 0 else {
            throw MalformedAU.headerReservedBits
        }
        let generation = readU16(b, p + 6)
        let width = readU16(b, p + 8)
        let height = readU16(b, p + 10)
        let sequence = readU32(b, p + 12)
        guard validDimension(width), validDimension(height) else {
            throw MalformedAU.badDimensions(width: width, height: height)
        }
        guard generation != 0 else { throw MalformedAU.zeroGeneration }

        let annexB = Data(b[(p + WebcamHeader.size)...])
        guard let nalTypes = nalUnitTypes(annexB) else { throw MalformedAU.noStartCode }
        let frame = FrameHeader(flags: flags, pts: pts, length: length)
        let au = WebcamAU(
            frame: frame,
            header: WebcamHeader(facing: facing, rotation: rotation,
                                 discontinuity: hflags & WebcamHeader.flagDiscontinuity != 0,
                                 generation: generation, width: width, height: height,
                                 sequence: sequence),
            annexB: annexB, nalTypes: nalTypes)
        if frame.claimsIDR && !au.isIDR { throw MalformedAU.idrFlagWithoutIDR }
        if frame.claimsConfig && !au.hasConfig { throw MalformedAU.configFlagWithoutConfig }
        return au
    }

    /// Writes one whole frame. The frame-header flags are derived from the NAL units, so an encoder
    /// built on this cannot claim an IDR it does not carry.
    public static func encode(header: WebcamHeader, pts: UInt64, annexB: Data) -> Data {
        let types = nalUnitTypes(annexB) ?? []
        var flags: UInt8 = 0
        if types.contains(5) { flags |= FrameHeader.flagIDR }
        if types.contains(7) && types.contains(8) { flags |= FrameHeader.flagConfig }
        var out = Data()
        out.append(flags)
        appendU64(&out, pts)
        appendU32(&out, UInt32(WebcamHeader.size + annexB.count))
        out.append(WebcamHeader.version)
        out.append(WebcamHeader.codecH264AnnexB)
        out.append(header.facing.rawValue)
        out.append(header.rotation)
        out.append(header.discontinuity ? WebcamHeader.flagDiscontinuity : 0)
        out.append(0)
        appendU16(&out, header.generation)
        appendU16(&out, header.width)
        appendU16(&out, header.height)
        appendU32(&out, header.sequence)
        out.append(annexB)
        return out
    }

    static func validDimension(_ v: UInt16) -> Bool {
        v >= minDimension && v <= maxDimension && v % 2 == 0
    }

    /// The NAL unit types of an Annex B buffer, or nil when it does not begin with a start code.
    public static func nalUnitTypes(_ annexB: Data) -> [UInt8]? {
        nalUnits(annexB)?.compactMap { $0.first.map { $0 & 0x1F } }
    }

    /// The NAL units of an Annex B buffer, start codes removed, or nil when it does not begin with
    /// a start code. Accepts 3- and 4-byte start codes.
    public static func nalUnits(_ annexB: Data) -> [Data]? {
        let b = [UInt8](annexB)
        guard startCodeLength(b, 0) > 0 else { return nil }
        var units: [Data] = []
        var i = 0
        var start = -1
        while i < b.count {
            let sc = startCodeLength(b, i)
            if sc > 0 {
                if start >= 0 { units.append(Data(b[start..<i])) }
                i += sc
                start = i
            } else {
                i += 1
            }
        }
        if start >= 0, start < b.count { units.append(Data(b[start...])) }
        return units.filter { !$0.isEmpty }
    }

    static func startCodeLength(_ b: [UInt8], _ i: Int) -> Int {
        if i + 3 < b.count, b[i] == 0, b[i + 1] == 0, b[i + 2] == 0, b[i + 3] == 1 { return 4 }
        if i + 2 < b.count, b[i] == 0, b[i + 1] == 0, b[i + 2] == 1 { return 3 }
        return 0
    }
}

// MARK: - The rules that need the session's history

/// What `StreamValidator` says about one AU, in the order the contract lists them.
public enum StreamVerdict: Sendable, Equatable {
    case accept
    /// Not malformed: the picture's timeline is the Mac's own, so a capture-clock hiccup costs one
    /// frame and is counted `outOfOrder`.
    case dropOutOfOrderPTS
    case malformed(StreamViolation)
}

public enum StreamViolation: Sendable, Equatable {
    case generationWentBackwards(seen: UInt16, got: UInt16)
    case sequenceDidNotIncrease(last: UInt32, got: UInt32)
    case generationDidNotStartWithKeyframe(UInt16)
}

/// One session's stream, as Electron main's socket reader sees it (W3 implements it in TypeScript
/// against the same fixture). The bridge runs it too, so a fault that reaches the bridge is refused
/// there whatever main did.
public struct StreamValidator: Sendable {
    private var highestGeneration: UInt16 = 0
    private var lastSequence: UInt32?
    private var lastPTSInGeneration: UInt64?

    public init() {}

    public mutating func check(_ au: WebcamAU) -> StreamVerdict {
        let g = au.header.generation
        if g < highestGeneration {
            return .malformed(.generationWentBackwards(seen: highestGeneration, got: g))
        }
        if let last = lastSequence, au.header.sequence <= last {
            return .malformed(.sequenceDidNotIncrease(last: last, got: au.header.sequence))
        }
        if g > highestGeneration {
            guard au.isKeyframeWithConfig else {
                return .malformed(.generationDidNotStartWithKeyframe(g))
            }
            highestGeneration = g
            lastPTSInGeneration = nil
        }
        lastSequence = au.header.sequence
        if let lastPTS = lastPTSInGeneration, au.frame.pts <= lastPTS {
            return .dropOutOfOrderPTS
        }
        lastPTSInGeneration = au.frame.pts
        return .accept
    }
}

// MARK: - Big-endian helpers

@inline(__always) func readU16(_ b: [UInt8], _ i: Int) -> UInt16 {
    UInt16(b[i]) << 8 | UInt16(b[i + 1])
}
@inline(__always) func readU32(_ b: [UInt8], _ i: Int) -> UInt32 {
    (0..<4).reduce(UInt32(0)) { $0 << 8 | UInt32(b[i + $1]) }
}
@inline(__always) func readU64(_ b: [UInt8], _ i: Int) -> UInt64 {
    (0..<8).reduce(UInt64(0)) { $0 << 8 | UInt64(b[i + $1]) }
}
func appendU16(_ d: inout Data, _ v: UInt16) { d.append(UInt8(v >> 8)); d.append(UInt8(v & 0xFF)) }
func appendU32(_ d: inout Data, _ v: UInt32) { for s in stride(from: 24, through: 0, by: -8) { d.append(UInt8((v >> UInt32(s)) & 0xFF)) } }
func appendU64(_ d: inout Data, _ v: UInt64) { for s in stride(from: 56, through: 0, by: -8) { d.append(UInt8((v >> UInt64(s)) & 0xFF)) } }
