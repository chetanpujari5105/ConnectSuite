import Foundation

/// What one H.264 sequence parameter set says about the picture (ITU-T H.264 §7.3.2.1.1).
///
/// Two sizes, because they answer different questions. **Coded** is the macroblock grid the encoder
/// actually compressed — 1920 × 1088 for a 1080p stream. **Cropped** is the picture after the SPS's own
/// frame-cropping rectangle — 1920 × 1080 — and is what a decoder hands back. The webcam header's
/// width and height are compared with the cropped size, never the coded one.
public struct SPSInfo: Sendable, Equatable {
    public var profileIdc: Int
    public var constraintFlags: Int
    public var levelIdc: Int
    public var chromaFormatIdc: Int
    public var frameMbsOnly: Bool
    public var codedWidth: Int
    public var codedHeight: Int
    public var width: Int
    public var height: Int
}

/// Reads the fields above from one SPS NAL unit (header byte first, start code removed). Returns nil
/// for anything it cannot read to the end of the cropping rectangle — never a guessed size.
///
/// Used by the decode probe only. The decoder itself takes its sizes from VideoToolbox's own SPS
/// parse (`CMVideoFormatDescriptionCreateFromH264ParameterSets`), so the two are independent
/// readings of the same bytes, and the probe's tests compare them.
public enum SPSReader {
    /// Profiles whose SPS carries chroma format, bit depths and scaling matrices (§7.3.2.1.1).
    static let highProfiles: Set<Int> = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]

    public static func parse(_ nal: Data) -> SPSInfo? {
        let bytes = [UInt8](nal)
        guard bytes.count >= 4, bytes[0] & 0x1F == 7 else { return nil }
        var r = BitReader(rbsp: removeEmulationPrevention(Array(bytes.dropFirst())))
        guard let profile = r.bits(8), let constraints = r.bits(8), let level = r.bits(8),
              r.ue() != nil /* seq_parameter_set_id */ else { return nil }

        var chroma = 1
        if highProfiles.contains(profile) {
            guard let c = r.ue(), c <= 3 else { return nil }
            chroma = c
            if chroma == 3 { guard r.bits(1) != nil else { return nil } }   // separate_colour_plane_flag
            guard r.ue() != nil, r.ue() != nil, r.bits(1) != nil else { return nil }   // bit depths, qpprime
            guard let scaling = r.bits(1) else { return nil }
            if scaling == 1 {
                for i in 0..<(chroma == 3 ? 12 : 8) {
                    guard let present = r.bits(1) else { return nil }
                    if present == 1 { guard r.skipScalingList(size: i < 6 ? 16 : 64) else { return nil } }
                }
            }
        }
        guard r.ue() != nil else { return nil }                        // log2_max_frame_num_minus4
        guard let pocType = r.ue() else { return nil }
        if pocType == 0 {
            guard r.ue() != nil else { return nil }
        } else if pocType == 1 {
            guard r.bits(1) != nil, r.se() != nil, r.se() != nil, let cycle = r.ue(), cycle <= 255 else { return nil }
            for _ in 0..<cycle { guard r.se() != nil else { return nil } }
        }
        guard r.ue() != nil, r.bits(1) != nil else { return nil }      // max_num_ref_frames, gaps
        guard let wMbs = r.ue(), let hMapUnits = r.ue(), let fmo = r.bits(1) else { return nil }
        if fmo == 0 { guard r.bits(1) != nil else { return nil } }     // mb_adaptive_frame_field_flag
        guard r.bits(1) != nil else { return nil }                     // direct_8x8_inference_flag
        guard let cropping = r.bits(1) else { return nil }
        var crop = (left: 0, right: 0, top: 0, bottom: 0)
        if cropping == 1 {
            guard let l = r.ue(), let rr = r.ue(), let t = r.ue(), let b = r.ue() else { return nil }
            crop = (l, rr, t, b)
        }

        let frameMbsOnly = fmo == 1
        let codedWidth = (wMbs + 1) * 16
        let codedHeight = (2 - fmo) * (hMapUnits + 1) * 16
        // §7.4.2.1.1, CropUnitX / CropUnitY.
        let (subW, subH): (Int, Int) = switch chroma { case 1: (2, 2); case 2: (2, 1); default: (1, 1) }
        let cropUnitX = chroma == 0 ? 1 : subW
        let cropUnitY = (chroma == 0 ? 1 : subH) * (2 - fmo)
        let width = codedWidth - cropUnitX * (crop.left + crop.right)
        let height = codedHeight - cropUnitY * (crop.top + crop.bottom)
        guard width > 0, height > 0 else { return nil }
        return SPSInfo(profileIdc: profile, constraintFlags: constraints, levelIdc: level, chromaFormatIdc: chroma,
                       frameMbsOnly: frameMbsOnly, codedWidth: codedWidth, codedHeight: codedHeight,
                       width: width, height: height)
    }

    /// Drops every 0x03 that follows two zero bytes (§7.4.1, emulation_prevention_three_byte).
    static func removeEmulationPrevention(_ b: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(b.count)
        var zeros = 0
        for byte in b {
            if zeros >= 2 && byte == 3 { zeros = 0; continue }
            out.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return out
    }
}

struct BitReader {
    private let b: [UInt8]
    private var bit = 0

    init(rbsp: [UInt8]) { b = rbsp }

    mutating func bits(_ n: Int) -> Int? {
        guard n <= 32, bit + n <= b.count * 8 else { return nil }
        var v = 0
        for _ in 0..<n {
            v = v << 1 | Int((b[bit >> 3] >> (7 - UInt8(bit & 7))) & 1)
            bit += 1
        }
        return v
    }

    /// Unsigned Exp-Golomb.
    mutating func ue() -> Int? {
        var zeros = 0
        while true {
            guard let x = bits(1) else { return nil }
            if x == 1 { break }
            zeros += 1
            if zeros > 31 { return nil }
        }
        guard let rest = bits(zeros) else { return nil }
        return (1 << zeros) - 1 + rest
    }

    /// Signed Exp-Golomb.
    mutating func se() -> Int? {
        guard let k = ue() else { return nil }
        return k % 2 == 1 ? (k + 1) / 2 : -(k / 2)
    }

    mutating func skipScalingList(size: Int) -> Bool {
        var last = 8, next = 8
        for _ in 0..<size {
            if next != 0 {
                guard let delta = se() else { return false }
                next = (last + delta + 256) % 256
            }
            last = next == 0 ? last : next
        }
        return true
    }
}
