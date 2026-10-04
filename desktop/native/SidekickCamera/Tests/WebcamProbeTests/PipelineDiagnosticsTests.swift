import Foundation
import VideoToolbox
import Testing
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe
import WebcamTestSupport

// Defect 177's instrument: the bridge's timing and recovery readings, through the real BridgeCore with
// the probe's decoder and sink and real H.264. Time is a ManualClock the test sets and decode durations
// are charged by GatedDecoder, so every number below is exact — nothing here measures this Mac's speed
// except the last test, which says so.

private let W = 640, H = 360
private let FRAME_US: UInt64 = 33_333

private func aus(_ count: Int = 20, idrAt: Set<Int> = [0, 10]) throws -> [Data] {
    try stream(width: W, height: H, count: count, idrAt: idrAt).map(\.annexB)
}

private func rig(_ clock: ManualClock, _ dec: GatedDecoder) -> ProbeRig {
    dec.clock = clock
    clock.set(us: 0)
    let r = ProbeRig(inner: dec, clock: clock.read)
    r.live()
    return r
}

@Suite(.serialized) struct PipelineDiagnosticsReadings {
    @Test func anOverflowIsTimedPlacedInItsGOPAndItsRecoveryMeasured() throws {
        let f = try aus()
        let clock = ManualClock(), dec = GatedDecoder()
        dec.costUs = [0: 20_000]                                  // the first decode, with its setup
        let r = rig(clock, dec)
        let at = { (i: Int) in clock.set(us: UInt64(i) * FRAME_US) }

        at(0); r.feed(f[0], width: W, height: H)
        dec.hold(call: 1)
        at(1); r.feed(f[1], width: W, height: H, drain: false)
        dec.entered.wait()                                        // frame 1 is inside the decoder
        for i in 2...9 { at(i); r.feed(f[i], width: W, height: H, drain: false) }
        clock.set(us: 300_000)
        dec.release.signal()
        r.core.drain()
        for i in 10..<20 { at(i); r.feed(f[i], width: W, height: H) }

        let d = r.core.diagnostics
        let c = r.c
        #expect(c["droppedDecodeQueue"] == 1 && c["gate.awaitingKeyframe"] == 3)
        // Frame 6 overflowed: the 7th AU received, 6 frames after its IDR, 200 ms after live, while
        // frame 1 had been decoding for 167 ms, with one decode completed before it.
        let o = try #require(d.firstOverflow)
        #expect(o == PipelineDiagnostics.Overflow(atReceived: 7, sinceLiveUs: 199_998, gopIndex: 6, inFlightUs: 166_665, decodesBefore: 1))
        #expect(d.overflowEvents == 1 && d.idrFlushes == 0)
        // The picture came back with the IDR at frame 10, admitted after the break: 133 ms, 3 refused.
        #expect(d.recoveries == 1 && d.recoveryLastUs == 333_330 - 199_998 && d.recoveryMaxRefused == 3)
        #expect(c["diag.recovery.open"] == 0 && d.unrecovered == 0)
        // Frames 2–5 were admitted before the break and decoded after it: they are NOT the recovery.
        #expect(c["sinkEnqueued"] == 16)
        // Durations: frame 0 20 ms (charged), frame 1 held 267 ms, the rest 0.
        #expect(d.decode.firstUs == 20_000 && d.decode.maxUs == 266_667 && d.decode.overBudget == 1 && d.decode.count == 16)
        // Frame 2 waited from 66.7 ms to 300 ms behind the held decode.
        #expect(d.queueWait.maxUs == 300_000 - 66_666)
        #expect(r.core.invariantHolds)
    }

    @Test func theFieldShapeAStalledIDRInALaterGOPDropsIndexFiveAndTheRestOfTheGOP() throws {
        // The 2026-10-04 run's arithmetic: IDR in flight + 4 waiting, so GOP index 5 overflows and every
        // P-frame after it is refused until the next IDR. Here the IDR at 10 stalls (GOP length 10, so
        // 4 refused rather than the field's 54) — and it is the SECOND GOP, so an index that is not reset
        // at an IDR reads 15, not 5 (mutation D2 was green against the first-GOP test alone).
        let f = try aus(30, idrAt: [0, 10, 20])
        let clock = ManualClock(), dec = GatedDecoder()
        let r = rig(clock, dec)
        let at = { (i: Int) in clock.set(us: UInt64(i) * FRAME_US) }
        for i in 0..<10 { at(i); r.feed(f[i], width: W, height: H) }
        dec.hold(call: 10)
        at(10); r.feed(f[10], width: W, height: H, drain: false)
        dec.entered.wait()
        for i in 11...19 { at(i); r.feed(f[i], width: W, height: H, drain: false) }
        at(20); dec.release.signal(); r.core.drain()
        for i in 20..<30 { at(i); r.feed(f[i], width: W, height: H) }
        let d = r.core.diagnostics, c = r.c
        let o = try #require(d.firstOverflow)
        #expect(o.gopIndex == 5 && o.atReceived == 16 && o.decodesBefore == 10 && o.inFlightUs == 5 * 33_333, "\(o)")
        #expect(c["gate.awaitingKeyframe"] == 4 && c["droppedDecodeQueue"] == 1)
        #expect(d.recoveries == 1 && d.recoveryMaxRefused == 4 && d.recoveryLastUs == 20 * 33_333 - 15 * 33_333)
        #expect(r.core.invariantHolds)
    }

    @Test func whatCompletesAfterTheStopIsCountedAndItsLatenessMeasured() throws {
        let f = try aus()
        let clock = ManualClock(), dec = GatedDecoder()
        let r = rig(clock, dec)
        clock.set(us: 0); r.feed(f[0], width: W, height: H)
        clock.set(us: 33_333); r.feed(f[1], width: W, height: H)
        dec.hold(call: 2)
        clock.set(us: 66_666); r.feed(f[2], width: W, height: H, drain: false)
        dec.entered.wait()
        clock.set(us: 80_000); r.feed(f[3], width: W, height: H, drain: false)
        clock.set(us: 100_000); _ = r.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        clock.set(us: 150_000)
        dec.release.signal()
        r.core.drain()
        let d = r.core.diagnostics
        #expect(d.discardedAfterDecode == 1 && d.discardedBeforeDecode == 1)
        #expect(d.completionsAfterEnd == 1 && d.maxLateUs == 50_000)
        #expect(r.c["discardedEnded"] == 2)
        #expect(r.core.invariantHolds)
    }

    @Test func decodeDurationsAreChargedAndOverBudgetDecodesCounted() throws {
        let f = try aus()
        let clock = ManualClock(), dec = GatedDecoder()
        dec.costUs = [0: 80_000, 5: 40_000]
        dec.defaultCostUs = 10_000
        let r = rig(clock, dec)
        for i in 0..<20 { clock.set(us: max(clock.nowUs, UInt64(i) * FRAME_US)); r.feed(f[i], width: W, height: H) }
        let d = r.core.diagnostics
        #expect(d.decode.count == 20 && d.decode.firstUs == 80_000 && d.decode.maxUs == 80_000)
        #expect(d.decode.overBudget == 2 && d.decode.totalUs == 80_000 + 40_000 + 18 * 10_000)
        #expect(d.service.overBudget == 2, "compose is instant on this clock, so service = decode")
        #expect(d.overflowEvents == 0 && d.recoveries == 0)
    }

    @Test func aBurstAndAGapInArrivalAreBothSeen() throws {
        let f = try aus()
        let clock = ManualClock(), dec = GatedDecoder()
        let r = rig(clock, dec)
        clock.set(us: 10_000)
        for i in 0..<6 { r.feed(f[i], width: W, height: H) }     // six AUs in the same instant
        clock.set(us: 510_000); r.feed(f[6], width: W, height: H)
        let d = r.core.diagnostics
        #expect(d.maxArrivalsPerFrame == 6 && d.maxArrivalGapUs == 500_000)
    }

    @Test func framesWaitingBehindAFailedDecodeAreStillDecodedAndThatIsCounted() throws {
        // A FINDING, not a fix: after a decode failure, P-frames already in the stage reference a picture
        // the decoder never produced, and the bridge decodes them anyway. The counter makes it visible.
        let f = try aus()
        let clock = ManualClock(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = rig(clock, dec)
        for i in 0..<3 { r.feed(f[i], width: W, height: H) }
        dec.hold(call: 3)
        r.feed(f[3], width: W, height: H, drain: false)
        dec.entered.wait()
        r.feed(f[4], width: W, height: H, drain: false)
        r.feed(f[5], width: W, height: H, drain: false)
        dec.release.signal()
        r.core.drain()
        let c = r.c, d = r.core.diagnostics
        #expect(c["probe.decodeAttempts"] == 6, "frames 4 and 5 were attempted after frame 3 failed: \(c)")
        #expect(d.decodedAfterFailure + (c["decodeErrors"]! - 1) == 2, "\(c)")
        print("defect 177 — after a failed decode, waiting dependants: \(d.decodedAfterFailure) decoded, \(c["decodeErrors"]! - 1) failed")
        #expect(r.core.invariantHolds)
    }
}

@Suite(.serialized) struct PipelineDiagnosticsBounds {
    @Test func theKeySetIsFixedSmallAndInsideMainsParserLimit() throws {
        let empty = ProbeRig().core.countsSnapshot()
        let r = ProbeRig()
        r.live()
        for a in try aus(60, idrAt: [0, 30]) { r.feed(a, width: W, height: H) }
        let after = r.core.countsSnapshot()
        #expect(Set(empty.keys) == Set(after.keys), "the counters grew with the stream")
        #expect(after.keys.filter { $0.hasPrefix("diag.") }.count == 35)
        #expect(after.count <= 64, "BridgeCore's share of the 128 counters Electron main accepts")
        #expect(r.c.count <= 128, "with the probe's tally: \(r.c.count)")
        #expect(after.values.allSatisfy { $0 >= 0 } && after.keys.allSatisfy { $0.count <= 64 })
    }

    @Test(arguments: Scenario.allCases)
    func theDiagnosticsAgreeWithTheAccounting(_ s: Scenario) throws {
        let r = try s.run()
        let c = r.c, d = r.core.diagnostics
        #expect(d.decode.count == c["probe.decodeAttempts"] ?? 0)
        #expect(d.compose.count == c["probe.decoded"] ?? 0)
        #expect(d.overflowEvents + d.idrFlushedAUs == c["droppedDecodeQueue"]!)
        #expect(d.discardedBeforeDecode + d.discardedAfterDecode == c["discardedEnded"]!)
        let breaks = c["droppedDecodeQueue"]! + c["decodeErrors"]! + c["composeErrors"]!
        #expect(d.recoveries + d.unrecovered + (c["diag.recovery.open"] ?? 0) <= breaks)
        if breaks > 0, s != .stopWhileDecodingWithFramesWaiting, s != .decodedThenDiscardedAtFinalCheck {
            #expect(d.recoveries == 1, "\(s.rawValue): every break here recovered at the next IDR")
        }
    }

    /// This Mac's own decode and compose time at 1080p with a quarter turn — a READING, reported, never
    /// asserted against a number: it measures this machine, not the phone's stream or the field run.
    @Test func thisMacsDecodeAndComposeTimeAt1080pRotated() throws {
        let r = ProbeRig()
        r.phone.rotation = 1
        r.live()
        for a in try stream(width: 1920, height: 1080, count: 60, idrAt: [0, 30]).map(\.annexB) { r.feed(a, width: 1920, height: 1080) }
        let d = r.core.diagnostics
        #expect(d.decode.count == 60 && d.compose.count == 60 && d.compose.maxUs > 0 && d.decode.maxUs > 0)
        print("defect 177 — this Mac, 1080p, rotation 1, 60 AUs (drained one at a time): decode first \(d.decode.firstUs) µs, max \(d.decode.maxUs) µs, mean \(d.decode.totalUs / 60) µs, over 33.3 ms \(d.decode.overBudget); compose first \(d.compose.firstUs) µs, max \(d.compose.maxUs) µs, mean \(d.compose.totalUs / 60) µs, over \(d.compose.overBudget); service max \(d.service.maxUs) µs")
    }
}

/// A RELEASE-built probe on a generated 1080p stream with a quarter turn, paced at 30 fps — the
/// reading the debug suite cannot give, because the composer's chroma fill is a per-byte loop that a
/// debug build runs an order of magnitude slower. Opt-in: DECODE_PROBE_BINARY names the binary (build
/// it with `swift build -c release --scratch-path <dir>`, never into `.build/release`, which the dev Mac
/// resolves). Reported, never asserted: it measures this Mac under whatever else is running.
@Suite(.serialized) struct ReleaseProbeTiming {
    static let binary = ProcessInfo.processInfo.environment["DECODE_PROBE_BINARY"]

    @Test(.enabled(if: binary != nil)) func aReleaseProbeAt1080pRotatedAndPaced() throws {
        let exe = URL(fileURLWithPath: Self.binary!)
        var phone = PhoneStandIn()
        phone.rotation = 1
        let control = { (m: ControlMessage) in BridgeRecord.encode(BridgeRecord(type: .control, body: ControlCodec.encode(m))) }
        var input = [control(.sessionLive(SESSION, generation: 1))]
        for au in try stream(width: 1920, height: 1080, count: 150, idrAt: [0, 60, 120], profile: kVTProfileLevel_H264_High_AutoLevel) {
            let frame = phone.frame(annexB: au.annexB, width: 1920, height: 1080)
            input.append(BridgeRecord.encode(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: SESSION, frame: frame))))
        }
        input.append(control(.sessionEnded(SESSION, reason: "stopped-by-mac")) + control(.shutdown))
        let p = Process()
        p.executableURL = exe
        let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
        p.standardInput = inPipe; p.standardOutput = outPipe; p.standardError = errPipe
        try p.run()
        var outData = Data()
        let reader = DispatchGroup()
        reader.enter()
        DispatchQueue.global().async { outData = outPipe.fileHandleForReading.readDataToEndOfFile(); reader.leave() }
        for chunk in input { inPipe.fileHandleForWriting.write(chunk); usleep(33_333) }
        try inPipe.fileHandleForWriting.close()
        DispatchQueue.global().asyncAfter(deadline: .now() + 20) { if p.isRunning { p.terminate() } }
        p.waitUntilExit()
        let err = String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let line = err.split(separator: "\n").first { $0.contains("pipeline:") }.map(String.init)
        #expect(p.terminationStatus == 0 && line != nil, "\(err)")
        print("defect 177 — RELEASE probe, 150 AUs 1080p rotation 1 paced 33.3 ms: \(line ?? "no line")")
        reader.wait()
        var dec = RecordDecoder()
        let last = try dec.feed(outData).compactMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
            .last { $0["op"] as? String == "counts" }?["counts"] as? [String: Int] ?? [:]
        let mean = { (k: String) in (last["diag.\(k).count"] ?? 0) > 0 ? (last["diag.\(k).totalUs"] ?? 0) / last["diag.\(k).count"]! : 0 }
        print("defect 177 — RELEASE means: decode \(mean("decode")) µs, compose \(mean("compose")) µs, service max \(last["diag.service.maxUs"] ?? -1) µs over-budget \(last["diag.service.overBudget"] ?? -1), queue wait max \(last["diag.queueWait.maxUs"] ?? -1) µs")
    }
}
