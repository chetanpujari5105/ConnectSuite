import CoreMedia
import CoreVideo
import Foundation
import WebcamBridge
import WebcamCore
import WebcamMedia

/// The encoder spike's Mac half (docs/camera-v2-encoder-spike.md): the **real** bridge pipeline —
/// `SessionGate` → in-order VideoToolbox decode → `FrameComposer` — ending in a sink that counts and
/// discards. Nothing is published as a camera, nothing is drawn, nothing is written to disk, and no
/// byte of a picture outlives the call that produced it. What survives is integers.
///
/// It reads three things, each at the stage that owns it, so a disagreement between them is visible:
///
/// | Reading | Taken from | Stage |
/// |---|---|---|
/// | the header's width, height, generation, sequence, PTS, flags | `observe(frame:)` | every AU **as it arrived**, before the gate |
/// | NAL unit types, SPS profile and both SPS sizes | `ProbeDecoder` | every AU the gate **accepted** |
/// | the decoded buffer's width and height | `ProbeDecoder` | every AU **VideoToolbox decoded** |
///
/// `received` and `accepted` are the gate's own counters; the probe never counts them a second time.
public final class ProbeTally: @unchecked Sendable {
    private let lock = NSLock()
    private var c: [String: Int] = [:]
    private var lastPts: UInt64?
    private var firstPts: UInt64?
    private var lastIdrPts: UInt64?
    private var lastSequence: UInt32?
    private var headerDims: (Int, Int)?
    private var spsDims: (Int, Int)?
    private var decodedDims: (Int, Int)?

    public init() {}

    // MARK: Arrival (before the gate)

    /// One whole frame as it arrived, read with the production codec. A frame the codec refuses is
    /// counted and left for the gate to judge — the probe never decides what is malformed.
    public func observe(frame: Data) {
        guard let au = try? WebcamAUCodec.parse(frame) else { bump("probe.arrived.unparsed"); return }
        lock.lock(); defer { lock.unlock() }
        c["probe.arrived", default: 0] += 1
        let h = au.header
        let dims = (Int(h.width), Int(h.height))
        if let prev = headerDims, prev != dims { c["probe.header.sizeChanges", default: 0] += 1 }
        headerDims = dims
        c["probe.header.width"] = dims.0
        c["probe.header.height"] = dims.1
        c["probe.header.rotation"] = Int(h.rotation)
        c["probe.header.facing"] = Int(h.facing.rawValue)
        c["probe.header.generationMin"] = min(c["probe.header.generationMin"] ?? Int(h.generation), Int(h.generation))
        c["probe.header.generationMax"] = max(c["probe.header.generationMax"] ?? 0, Int(h.generation))
        if h.discontinuity { c["probe.header.discontinuities", default: 0] += 1 }
        if au.frame.claimsIDR { c["probe.header.flaggedIdr", default: 0] += 1 }
        if c["probe.arrived"] == 1 {
            c["probe.firstArrivedIsIdrWithConfig"] = au.isKeyframeWithConfig ? 1 : 0
            c["probe.header.firstSequence"] = Int(h.sequence)
        }
        if let s = lastSequence, h.sequence > s &+ 1 { c["probe.header.sequenceGaps", default: 0] += Int(h.sequence - s - 1) }
        lastSequence = h.sequence

        // The phone's capture clock (CLOCK_MONOTONIC µs). A span and IDR spacing — targets are 30 fps
        // and 2 s, reported beside these, never judged by them here.
        let pts = au.frame.pts
        if firstPts == nil { firstPts = pts }
        if let p = lastPts, pts <= p { c["probe.pts.nonIncreasing", default: 0] += 1 }
        lastPts = max(lastPts ?? 0, pts)
        c["probe.pts.spanUs"] = Int((lastPts ?? pts) - (firstPts ?? pts))
        if au.isIDR {
            if let last = lastIdrPts, pts > last {
                let gap = Int(pts - last)
                c["probe.idr.gaps", default: 0] += 1
                c["probe.idr.maxGapUs"] = max(c["probe.idr.maxGapUs"] ?? 0, gap)
                c["probe.idr.minGapUs"] = min(c["probe.idr.minGapUs"] ?? gap, gap)
            }
            lastIdrPts = pts
        }
    }

    // MARK: Accepted and decoded

    func accepted(nalTypes: [UInt8], sps: SPSInfo?) {
        lock.lock(); defer { lock.unlock() }
        c["probe.decodeAttempts", default: 0] += 1
        if nalTypes.contains(7) { c["probe.nal.sps", default: 0] += 1 }
        if nalTypes.contains(8) { c["probe.nal.pps", default: 0] += 1 }
        if nalTypes.contains(5) { c["probe.nal.idrAUs", default: 0] += 1 }
        if nalTypes.contains(1) && !nalTypes.contains(5) { c["probe.nal.nonIdrAUs", default: 0] += 1 }
        if !nalTypes.contains(1) && !nalTypes.contains(5) { c["probe.nal.noSliceAUs", default: 0] += 1 }
        if nalTypes.contains(6) { c["probe.nal.seiAUs", default: 0] += 1 }
        if c["probe.decodeAttempts"] == 1 { c["probe.firstAcceptedIsIdr"] = nalTypes.contains(5) ? 1 : 0 }
        if let sps {
            let dims = (sps.width, sps.height)
            if let prev = spsDims, prev != dims { c["probe.sps.sizeChanges", default: 0] += 1 }
            spsDims = dims
            c["probe.sps.profile"] = sps.profileIdc
            c["probe.sps.level"] = sps.levelIdc
            c["probe.sps.constraints"] = sps.constraintFlags
            c["probe.sps.chromaFormat"] = sps.chromaFormatIdc
            c["probe.sps.codedWidth"] = sps.codedWidth
            c["probe.sps.codedHeight"] = sps.codedHeight
            c["probe.sps.width"] = sps.width
            c["probe.sps.height"] = sps.height
            if let h = headerDims, h != dims { c["probe.mismatch.headerVsSps", default: 0] += 1 }
        } else if nalTypes.contains(7) {
            c["probe.sps.unreadable", default: 0] += 1
        }
    }

    func decoded(width: Int, height: Int, wasIdr: Bool) {
        lock.lock(); defer { lock.unlock() }
        c["probe.decoded", default: 0] += 1
        c[wasIdr ? "probe.decoded.idr" : "probe.decoded.nonIdr", default: 0] += 1
        let dims = (width, height)
        if let prev = decodedDims, prev != dims { c["probe.decoded.sizeChanges", default: 0] += 1 }
        decodedDims = dims
        c["probe.decoded.width"] = width
        c["probe.decoded.height"] = height
        if let s = spsDims, s != dims { c["probe.mismatch.spsVsDecoded", default: 0] += 1 }
        if let h = headerDims, h != dims { c["probe.mismatch.headerVsDecoded", default: 0] += 1 }
    }

    func decodeFailed() { bump("probe.decodeFailed") }

    // MARK: The sink

    func composed() { bump("probe.composedDiscarded") }
    func sinkStarted() { bump("probe.sinkStarts") }
    func sinkStopped() { bump("probe.sinkStops") }

    private func bump(_ key: String) {
        lock.lock(); c[key, default: 0] += 1; lock.unlock()
    }

    public func snapshot() -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        return c
    }
}

/// The production decoder with the probe's readings around it. Every decode still goes through
/// `H264Decoder` — VideoToolbox's `VTDecompressionSession` — and its answer is returned unchanged.
public final class ProbeDecoder: FrameDecoding {
    private let inner: FrameDecoding
    private let tally: ProbeTally

    public init(tally: ProbeTally, inner: FrameDecoding = H264Decoder()) {
        self.tally = tally
        self.inner = inner
    }

    public func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
        let units = WebcamAUCodec.nalUnits(annexB) ?? []
        let types = units.compactMap { $0.first.map { $0 & 0x1F } }
        let sps = units.first { ($0.first ?? 0) & 0x1F == 7 }.flatMap(SPSReader.parse)
        tally.accepted(nalTypes: types, sps: sps)
        do {
            let pb = try inner.decode(annexB: annexB, ptsMicros: ptsMicros)
            tally.decoded(width: CVPixelBufferGetWidth(pb), height: CVPixelBufferGetHeight(pb), wasIdr: types.contains(5))
            return pb
        } catch {
            tally.decodeFailed()
            throw error
        }
    }

    public func invalidate() { inner.invalidate() }
}

/// Where the composed frames go: nowhere. Counted, then released by returning. It reports itself
/// `feeding` while started because it is taking frames — the spike runner labels every one of these
/// as the decode probe's, never as Sidekick Camera's.
public final class ProbeSink: SinkPort {
    private let tally: ProbeTally
    private let lock = NSLock()
    private var started = false
    public var supersededSink: Int { 0 }

    public init(tally: ProbeTally) { self.tally = tally }

    public func start() -> SinkState {
        lock.lock(); started = true; lock.unlock()
        tally.sinkStarted()
        return .feeding
    }

    public func enqueue(_ sb: CMSampleBuffer) -> Bool {
        lock.lock(); let on = started; lock.unlock()
        guard on else { return false }
        tally.composed()
        return true
    }

    public func stopAndFlush() {
        lock.lock(); started = false; lock.unlock()
        tally.sinkStopped()
    }
}
