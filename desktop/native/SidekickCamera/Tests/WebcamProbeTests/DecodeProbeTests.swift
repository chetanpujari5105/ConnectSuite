import CoreMedia
import CoreVideo
import Foundation
import Testing
import VideoToolbox
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe
import WebcamTestSupport

// The encoder spike's decode probe, against generated fixtures only: pictures made here, H.264 made by
// this Mac's VideoToolbox encoder (standing in for the phone's MediaCodec), wrapped by the phone
// stand-in. No device, no camera, no network. What these prove is that the probe's readings are
// correct readings of real H.264 — not anything about the Samsung's encoder, which is the spike's job.

let SESSION = SessionID(hex: "00112233445566778899aabbccddeeff")!

/// One encoded stream: `count` pictures, an IDR at each index in `idrAt`, P-frames between.
func stream(width: Int, height: Int, count: Int, idrAt: Set<Int> = [0],
            profile: CFString = kVTProfileLevel_H264_Baseline_AutoLevel) throws -> [(annexB: Data, isIDR: Bool)] {
    let enc = try TestH264Encoder(width: width, height: height, profile: profile)
    return try (0..<count).map { i in
        try enc.encode(TestPatterns.marked(width: width, height: height, background: UInt8(60 + i % 120)),
                       ptsMicros: UInt64(i) * 33_333, forceKeyframe: idrAt.contains(i))
    }
}

func spsNAL(_ annexB: Data) -> Data? { WebcamAUCodec.nalUnits(annexB)?.first { ($0.first ?? 0) & 0x1F == 7 } }

/// VideoToolbox's own reading of the same SPS and PPS — the independent second reading.
func videoToolboxDims(_ annexB: Data) throws -> (Int, Int) {
    let units = try #require(WebcamAUCodec.nalUnits(annexB))
    let sps = try #require(units.first { ($0.first ?? 0) & 0x1F == 7 })
    let pps = try #require(units.first { ($0.first ?? 0) & 0x1F == 8 })
    var fd: CMVideoFormatDescription?
    let st: OSStatus = sps.withUnsafeBytes { s in
        pps.withUnsafeBytes { p in
            let ptrs = [s.bindMemory(to: UInt8.self).baseAddress!, p.bindMemory(to: UInt8.self).baseAddress!]
            return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                allocator: kCFAllocatorDefault, parameterSetCount: 2, parameterSetPointers: ptrs,
                parameterSetSizes: [sps.count, pps.count], nalUnitHeaderLength: 4, formatDescriptionOut: &fd)
        }
    }
    #expect(st == noErr)
    let desc = try #require(fd)
    let d = CMVideoFormatDescriptionGetDimensions(desc)
    return (Int(d.width), Int(d.height))
}

@Suite struct SPS {
    // 1272 and 360 are not multiples of 16, so their SPS crops on the right as well as (for 1080) at the
    // bottom — without them a reader that ignored horizontal cropping passed (mutation SW1).
    @Test(arguments: [(1920, 1080, "baseline"), (1920, 1080, "high"), (1280, 720, "baseline"), (1280, 720, "high"),
                      (960, 540, "baseline"), (1272, 720, "high"), (360, 640, "baseline")])
    func theReaderAgreesWithVideoToolboxOnRealParameterSets(width: Int, height: Int, profile: String) throws {
        let p = profile == "high" ? kVTProfileLevel_H264_High_AutoLevel : kVTProfileLevel_H264_Baseline_AutoLevel
        let first = try #require(try stream(width: width, height: height, count: 1, profile: p).first)
        let nal = try #require(spsNAL(first.annexB))
        let info = try #require(SPSReader.parse(nal))
        let vt = try videoToolboxDims(first.annexB)
        #expect(info.width == vt.0 && info.height == vt.1, "the reader and VideoToolbox read the same SPS differently")
        #expect(info.width == width && info.height == height)
        // Coded is the macroblock grid: 1080 is 68 rows of 16, i.e. 1088, cropped back to 1080.
        #expect(info.codedWidth == (width + 15) / 16 * 16 && info.codedHeight == (height + 15) / 16 * 16)
        #expect(info.codedWidth > info.width || width % 16 == 0, "a width off the macroblock grid must be cropped")
        #expect(info.profileIdc == (profile == "high" ? 100 : 66))
        #expect(info.chromaFormatIdc == 1 && info.frameMbsOnly)
    }

    @Test func emulationPreventionBytesAreRemovedAndOnlyThose() {
        #expect(SPSReader.removeEmulationPrevention([0, 0, 3, 1, 0, 0, 3, 0, 5, 3]) == [0, 0, 1, 0, 0, 0, 5, 3])
        #expect(SPSReader.removeEmulationPrevention([0, 3, 0, 0, 2]) == [0, 3, 0, 0, 2])
    }

    @Test func anythingUnreadableIsNilNeverAGuessedSize() throws {
        let first = try #require(try stream(width: 1280, height: 720, count: 1).first)
        let sps = try #require(spsNAL(first.annexB))
        #expect(SPSReader.parse(sps.prefix(5)) == nil)                       // truncated
        #expect(SPSReader.parse(Data([0x68] + sps.dropFirst())) == nil)      // a PPS header byte
        #expect(SPSReader.parse(Data()) == nil)
    }
}

/// The probe's pipeline, in process: the real `BridgeCore` with the probe's decoder and sink.
final class ProbeRig {
    let tally = ProbeTally()
    var statuses: [BridgeStatus] = []
    var core: BridgeCore!
    var phone = PhoneStandIn()

    init(inner: FrameDecoding = H264Decoder(), clock: (() -> UInt64)? = nil,
         makeComposer: @escaping (PublishedFormat) throws -> FrameComposer = BridgeCore.preparedComposer) {
        let lock = NSLock()
        core = BridgeCore(sink: ProbeSink(tally: tally), decoder: ProbeDecoder(tally: tally, inner: inner),
                          clock: clock ?? { DispatchTime.now().uptimeNanoseconds },
                          makeComposer: makeComposer) { [unowned self] s in
            lock.lock(); statuses.append(s); lock.unlock()
        }
        core.consumersChanged(1)
    }

    func live(_ generation: UInt16 = 1) { _ = core.control(.sessionLive(SESSION, generation: generation)) }

    /// As the probe's main loop does it: observed on arrival, then handed to the gate.
    /// `drain: false` leaves the decode stage running, for tests that hold the decoder mid-frame.
    func feed(_ annexB: Data, width: Int, height: Int, session: SessionID = SESSION, drain: Bool = true) {
        let frame = phone.frame(annexB: annexB, width: width, height: height)
        tally.observe(frame: frame)
        core.accessUnit(session: session, frame: frame)
        if drain { core.drain() }
    }

    var c: [String: Int] { core.countsSnapshot().merging(tally.snapshot()) { a, _ in a } }
}

@Suite(.serialized) struct Pipeline {
    @Test func aRealStreamIsDecodedAndEveryReadingAgrees() throws {
        let rig = ProbeRig()
        rig.live()
        let aus = try stream(width: 1920, height: 1080, count: 60, idrAt: [0, 30], profile: kVTProfileLevel_H264_High_AutoLevel)
        #expect(aus.filter(\.isIDR).count == 2, "fixture: two IDRs, the rest P-frames")
        for au in aus { rig.feed(au.annexB, width: 1920, height: 1080) }
        let c = rig.c
        #expect(c["received"] == 60 && c["accepted"] == 60)
        #expect(c["probe.decoded"] == 60 && c["probe.decoded.idr"] == 2 && c["probe.decoded.nonIdr"] == 58)
        #expect(c["probe.nal.sps"] == 2 && c["probe.nal.pps"] == 2 && c["probe.nal.idrAUs"] == 2 && c["probe.nal.nonIdrAUs"] == 58)
        #expect(c["probe.firstArrivedIsIdrWithConfig"] == 1 && c["probe.firstAcceptedIsIdr"] == 1)
        #expect(c["probe.header.width"] == 1920 && c["probe.sps.width"] == 1920 && c["probe.decoded.width"] == 1920)
        #expect(c["probe.header.height"] == 1080 && c["probe.sps.height"] == 1080 && c["probe.decoded.height"] == 1080)
        #expect(c["probe.sps.codedHeight"] == 1088 && c["probe.sps.profile"] == 100)
        #expect(c["probe.mismatch.headerVsSps"] == nil && c["probe.mismatch.spsVsDecoded"] == nil && c["probe.mismatch.headerVsDecoded"] == nil)
        #expect(c["probe.decodeFailed"] == nil && c["decodeErrors"] == 0)
        // 30 pictures apart on the stand-in's 33 333 µs clock; 59 intervals across the span.
        #expect(c["probe.idr.gaps"] == 1 && c["probe.idr.maxGapUs"] == 30 * 33_333)
        #expect(c["probe.pts.spanUs"] == 59 * 33_333 && c["probe.header.sequenceGaps"] == nil)
        #expect(c["probe.composedDiscarded"] == 60 && c["sinkEnqueued"] == 60)
        #expect(rig.core.invariantHolds)
    }

    @Test func aHeaderThatDisagreesWithItsOwnSPSIsCountedNotTrusted() throws {
        let rig = ProbeRig()
        rig.live()
        // The header claims 720p; the H.264 inside is 1080p. The gate does not check this; the probe does.
        for au in try stream(width: 1920, height: 1080, count: 3) { rig.feed(au.annexB, width: 1280, height: 720) }
        let c = rig.c
        #expect(c["probe.decoded"] == 3)
        #expect(c["probe.mismatch.headerVsSps"] == 1 && c["probe.mismatch.headerVsDecoded"] == 3)
        #expect(c["probe.mismatch.spsVsDecoded"] == nil)
    }

    @Test func bytesVideoToolboxCannotDecodeAreCountedAsFailuresNeverAsFrames() throws {
        let rig = ProbeRig()
        rig.live()
        // Real SPS and PPS, then an IDR slice whose body is noise: well-formed for the gate, undecodable
        // for VideoToolbox. Without this, a probe that counted frames without decoding them passed (SW5).
        let real = try #require(try stream(width: 1280, height: 720, count: 1).first).annexB
        let units = try #require(WebcamAUCodec.nalUnits(real))
        var junk = Data()
        var rng = SystemRandomNumberGenerator()
        for u in units {
            junk.append(contentsOf: [0, 0, 0, 1])
            if (u.first ?? 0) & 0x1F == 5 {
                junk.append(u.first!)
                junk.append(contentsOf: (0..<4096).map { _ in UInt8.random(in: 1...255, using: &rng) })
            } else {
                junk.append(u)
            }
        }
        rig.feed(junk, width: 1280, height: 720)
        let c = rig.c
        #expect(c["probe.decodeAttempts"] == 1)
        #expect(c["probe.decodeFailed"] == 1 && c["probe.decoded"] == nil, "\(c)")
        #expect(c["decodeErrors"] == 1 && c["probe.composedDiscarded"] == nil)
    }

    @Test func nothingIsDecodedAfterTheSessionEnds() throws {
        let rig = ProbeRig()
        rig.live()
        let aus = try stream(width: 1280, height: 720, count: 6)
        for au in aus.prefix(3) { rig.feed(au.annexB, width: 1280, height: 720) }
        _ = rig.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        for au in aus.suffix(3) { rig.feed(au.annexB, width: 1280, height: 720) }
        let c = rig.c
        #expect(c["probe.decoded"] == 3 && c["gate.endedSession"] == 3)
        #expect(c["probe.sinkStarts"] == 1 && c["probe.sinkStops"] == 1)
        #expect(rig.core.invariantHolds)
    }

    @Test func aGenerationThatDoesNotStartWithAnIDRIsRejectedAndNothingIsDecoded() throws {
        let rig = ProbeRig()
        rig.live()
        let aus = try stream(width: 1280, height: 720, count: 10, idrAt: [0, 5])
        for au in aus.dropFirst() { rig.feed(au.annexB, width: 1280, height: 720) }
        let c = rig.c
        // The contract makes this fatal for the live session (stream-rejected), so the spike reads it as
        // a FAIL rather than as a slow start.
        #expect(c["probe.firstArrivedIsIdrWithConfig"] == 0)
        #expect(c["gate.malformed"] == 1 && c["probe.decoded"] == nil && c["probe.decodeAttempts"] == nil)
        #expect(rig.statuses.contains { if case .streamRejected = $0 { return true } else { return false } })
    }
}

/// The built executable, run as Electron main's spike runner runs it: records in, records out.
@Suite(.serialized) struct ProbeProcess {
    static var binary: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".build/debug/sidekick-camera-decode-probe")
    }

    func control(_ m: ControlMessage) -> Data { BridgeRecord.encode(BridgeRecord(type: .control, body: ControlCodec.encode(m))) }

    /// [input] is written one chunk at a time, [paceMs] apart — a phone's frames arrive at a frame rate,
    /// not as one burst (a burst meets the decode stage's 4-AU bound, which is a different reading).
    func run(_ input: [Data], paceMs: UInt32 = 0, args: [String] = [], closeStdin: Bool = true, cwd: URL? = nil)
        throws -> (status: Int32, records: [[String: Any]], stderr: String, seconds: Double) {
        let p = Process()
        p.executableURL = Self.binary
        p.arguments = args
        if let cwd { p.currentDirectoryURL = cwd }
        let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
        p.standardInput = inPipe; p.standardOutput = outPipe; p.standardError = errPipe
        let t0 = Date()
        try p.run()
        for chunk in input {
            inPipe.fileHandleForWriting.write(chunk)
            if paceMs > 0 { usleep(paceMs * 1000) }
        }
        if closeStdin { try inPipe.fileHandleForWriting.close() }
        // A child that never exits must fail this test, not hang the suite: terminated after 8 s.
        DispatchQueue.global().asyncAfter(deadline: .now() + 8) { if p.isRunning { p.terminate() } }
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        var dec = RecordDecoder()
        let objs = try dec.feed(outData).compactMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
        return (p.terminationStatus, objs, String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self),
                Date().timeIntervalSince(t0))
    }

    @Test func aRealSessionIsDecodedCountedAndNothingIsWritten() throws {
        #expect(FileManager.default.isExecutableFile(atPath: Self.binary.path), "build the package first")
        var phone = PhoneStandIn()
        var input = [control(.sessionLive(SESSION, generation: 1))]
        for au in try stream(width: 1280, height: 720, count: 20, idrAt: [0, 10]) {
            let frame = phone.frame(annexB: au.annexB, width: 1280, height: 720)
            input.append(BridgeRecord.encode(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: SESSION, frame: frame))))
        }
        input.append(control(.sessionEnded(SESSION, reason: "stopped-by-mac")) + control(.shutdown))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("decode-probe-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let r = try run(input, paceMs: 40, cwd: dir)
        #expect(r.status == 0)
        let ops = r.records.map { $0["op"] as? String ?? "?" }
        #expect(ops.first == "ready")
        #expect(r.records.contains { $0["op"] as? String == "consumers" && $0["count"] as? Int == 1 })
        #expect(r.records.contains { $0["op"] as? String == "sink" && $0["state"] as? String == "feeding" })
        let c = try #require(r.records.last { $0["op"] as? String == "counts" }?["counts"] as? [String: Int])
        // Exact counts are the in-process Pipeline suite's. Here the child decodes while the whole test
        // suite runs beside it, so its 4-AU decode bound may drop under load; what must hold is that
        // every AU is accounted for once, and that what was decoded agrees with itself.
        // (A drop past the gate also makes the gate wait for the next IDR, so `accepted` can fall too.)
        #expect(c["received"] == 20 && c["probe.arrived"] == 20)
        let decoded = c["probe.decoded"] ?? 0
        let gateDrops = c.filter { $0.key.hasPrefix("gate.") }.values.reduce(0, +)
        #expect(c["accepted"]! + gateDrops == 20)
        // Each AU ends in exactly one of BridgeCore's terminal dispositions. NOT `probe.decoded` plus the
        // drops: a frame decoding when the Stop lands is decoded AND `discardedEnded` — the scorer-v1
        // double count, which this test carried too and which surfaced here under load.
        let ended = ["droppedDecodeQueue", "decodeErrors", "composeErrors", "discardedEnded", "sinkEnqueued", "sinkUnavailable"]
            .reduce(0) { $0 + c[$1]! }
        #expect(ended == c["accepted"]!, "\(c)")
        #expect(decoded >= 1 && (c["probe.decoded.idr"] ?? 0) >= 1 && c["probe.composedDiscarded"] == c["sinkEnqueued"])
        #expect(decoded == c["sinkEnqueued"]! + c["sinkUnavailable"]! + c["composeErrors"]! + c["diag.discardedEnded.afterDecode"]!, "\(c)")
        #expect(c["probe.decoded.width"] == 1280 && c["probe.decoded.height"] == 720)
        #expect(r.stderr.contains("invariant holds"))
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path).isEmpty, "the probe wrote something")
    }

    @Test func itEndsByItselfAtItsLifetimeBoundWhateverTheParentDoes() throws {
        // stdin stays open: a parent that never ends the session and never closes the pipe.
        let r = try run([control(.sessionLive(SESSION, generation: 1))], args: ["--max-seconds", "1"], closeStdin: false)
        #expect(r.status == 3)
        #expect(r.seconds < 5)
        // A shutdown stops the sink (it is main's to report the ending, not the probe's).
        #expect(r.records.contains { $0["op"] as? String == "sink" && $0["state"] as? String == "idle" })
        let c = try #require(r.records.last { $0["op"] as? String == "counts" }?["counts"] as? [String: Int])
        #expect(c["probe.lifetimeExpired"] == 1)
    }
}
