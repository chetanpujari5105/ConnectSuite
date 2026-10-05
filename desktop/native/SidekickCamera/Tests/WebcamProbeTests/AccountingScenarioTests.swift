import CoreVideo
import Foundation
import Testing
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe

// Every way an access unit can end, produced by the PRODUCTION counting path — the real `BridgeCore`
// with the probe's real decoder and sink, real H.264 from this Mac's VideoToolbox — and written to
// docs/fixtures/webcam-spike-accounting-v1.json, which the spike's scorer (scripts/webcam-spike-core.mjs,
// version 2) is tested against. So the scorer is judged on counts BridgeCore actually produces, not on
// counts a test wrote by hand: the 2026-10-04 run failed a hand-modelled rule that had never seen a
// frame decoded and then discarded at the session's door.
//
// Timing is controlled, never slept: `GatedDecoder` holds one chosen decode call until the test
// releases it, so "the Stop lands while a frame is decoding" is a sequence, not a race.
//
// WEBCAM_UPDATE_FIXTURES=1 rewrites the fixture; otherwise the counts must equal it exactly.

/// The real decoder, with one call held and chosen calls failed or answered with a buffer the composer
/// cannot convert. Call numbers count decode attempts from 0.
final class GatedDecoder: FrameDecoding {
    let real = H264Decoder()
    private let lock = NSLock()
    private var calls = 0
    private var holdAt: Int?
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    var failAt: Set<Int> = []
    var unconvertibleAt: Set<Int> = []
    /// A controlled decode duration: the call advances `clock` by this many microseconds.
    var costUs: [Int: UInt64] = [:]
    var defaultCostUs: UInt64 = 0
    var clock: ManualClock?
    /// Runs on the decode thread as call `n` returns — a test's handle on what happens next.
    var afterDecode: [Int: () -> Void] = [:]

    func hold(call n: Int) { lock.lock(); holdAt = n; lock.unlock() }

    func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
        lock.lock(); let n = calls; calls += 1; let held = holdAt == n; lock.unlock()
        if held { entered.signal(); release.wait() }
        clock?.advance(us: costUs[n] ?? defaultCostUs)
        if failAt.contains(n) { throw DecodeError.decode(-12909) }
        let pb = try real.decode(annexB: annexB, ptsMicros: ptsMicros)
        afterDecode[n]?()
        if unconvertibleAt.contains(n) { return try Self.unconvertible() }
        return pb
    }

    /// How many times the bridge reset the decoder's reference state.
    var invalidations: Int { lock.lock(); defer { lock.unlock() }; return resets }
    private var resets = 0

    func invalidate() { lock.lock(); resets += 1; lock.unlock(); real.invalidate() }

    /// A buffer VideoToolbox's pixel transfer will not convert to the published format.
    static func unconvertible() throws -> CVPixelBuffer {
        var pb: CVPixelBuffer?
        let st = CVPixelBufferCreate(kCFAllocatorDefault, 4, 4, kCVPixelFormatType_DisparityFloat16, nil, &pb)
        guard st == kCVReturnSuccess, let pb else { throw DecodeError.decode(st) }
        return pb
    }
}

/// Monotonic time the test sets: nothing in a diagnostics test depends on how fast this Mac is.
final class ManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private var ns: UInt64 = 1_000_000_000
    /// Microseconds since the clock's origin, as the test reasons about them.
    func set(us: UInt64) { lock.lock(); ns = 1_000_000_000 + us * 1_000; lock.unlock() }
    func advance(us: UInt64) { lock.lock(); ns += us * 1_000; lock.unlock() }
    var nowUs: UInt64 { lock.lock(); defer { lock.unlock() }; return (ns - 1_000_000_000) / 1_000 }
    var read: () -> UInt64 { { [self] in lock.lock(); defer { lock.unlock() }; return ns } }
}

/// 20 pictures, 640×360, IDR at 0 and 10, P-frames between.
private let W = 640, H = 360

private func scenarioStream() throws -> [Data] {
    try stream(width: W, height: H, count: 20, idrAt: [0, 10]).map(\.annexB)
}

/// The keys the scorer's accounting reads, plus the probe's decode counts that version 1 mistook for a
/// terminal disposition. Missing keys are written as absent, never as 0.
private let FIXTURE_KEYS = [
    "received", "accepted", "pending", "maxWaiting",
    "gate.noLiveSession", "gate.endedSession", "gate.otherSession", "gate.staleGeneration",
    "gate.awaitingKeyframe", "gate.outOfOrder", "gate.malformed",
    "droppedDecodeQueue", "decodeErrors", "composeErrors", "discardedEnded", "sinkEnqueued", "sinkUnavailable",
    "probe.decodeAttempts", "probe.decoded", "probe.decodeFailed", "probe.composedDiscarded",
]

private func slice(_ c: [String: Int]) -> [String: Int] {
    var out: [String: Int] = [:]
    for k in FIXTURE_KEYS { if let v = c[k] { out[k] = v } }
    return out
}

/// The six scenarios. Each returns the rig after it has drained, with the bridge's own invariant asserted.
enum Scenario: String, CaseIterable {
    case ordinaryCompletion = "ordinary-completion"
    case decodedThenDiscardedAtFinalCheck = "decoded-then-discarded-at-final-check"
    case stopWhileDecodingWithFramesWaiting = "stop-while-decoding-with-frames-waiting"
    case decodeQueueDrop = "decode-queue-drop"
    case decodeFailure = "decode-failure"
    case composeFailure = "compose-failure"

    func run() throws -> ProbeRig {
        let aus = try scenarioStream()
        let dec = GatedDecoder()
        let rig = ProbeRig(inner: dec)
        rig.live()
        let feed = { (i: Int, drain: Bool) in rig.feed(aus[i], width: W, height: H, drain: drain) }
        let end = { _ = rig.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac")) }
        switch self {
        case .ordinaryCompletion:
            for i in 0..<20 { feed(i, true) }
        case .decodedThenDiscardedAtFinalCheck:
            // The field case: the Stop lands while the last frame is inside VideoToolbox. It decodes, then
            // meets the session check at the sink's door and is discarded — decoded AND discarded, once.
            feed(0, true); feed(1, true)
            dec.hold(call: 2)
            feed(2, false)
            dec.entered.wait()
            end()
            dec.release.signal()
        case .stopWhileDecodingWithFramesWaiting:
            feed(0, true)
            dec.hold(call: 1)
            feed(1, false)
            dec.entered.wait()
            feed(2, false); feed(3, false)          // waiting behind the held decode
            end()
            dec.release.signal()
        case .decodeQueueDrop:
            // The decoder stalls on frame 1; four P-frames fill the stage; frame 6 overflows it and is
            // dropped; the gate then refuses 7–9 until the IDR at 10. The 2026-10-04 run's shape.
            feed(0, true)
            dec.hold(call: 1)
            feed(1, false)
            dec.entered.wait()
            for i in 2...6 { feed(i, false) }
            for i in 7...9 { feed(i, false) }
            dec.release.signal()
            rig.core.drain()
            for i in 10..<20 { feed(i, true) }
        case .decodeFailure:
            dec.failAt = [3]
            for i in 0..<20 { feed(i, true) }
        case .composeFailure:
            dec.unconvertibleAt = [3]
            for i in 0..<20 { feed(i, true) }
        }
        rig.core.drain()
        return rig
    }
}

@Suite(.serialized) struct AccountingScenarios {
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("docs/fixtures/webcam-spike-accounting-v1.json")

    @Test(arguments: Scenario.allCases)
    func everyScenarioEndsEveryAUExactlyOnce(_ s: Scenario) throws {
        let rig = try s.run()
        let c = rig.c
        #expect(rig.core.invariantHolds, "\(s.rawValue): \(c)")
        // What makes each scenario the scenario it is named for — without these, a scenario that never
        // reached its condition would still balance.
        switch s {
        case .ordinaryCompletion:
            #expect(c["sinkEnqueued"] == 20 && c["discardedEnded"] == 0 && c["droppedDecodeQueue"] == 0)
        case .decodedThenDiscardedAtFinalCheck:
            #expect(c["probe.decoded"] == 3 && c["discardedEnded"] == 1 && c["sinkEnqueued"] == 2, "\(c)")
        case .stopWhileDecodingWithFramesWaiting:
            #expect(c["probe.decoded"] == 2 && c["discardedEnded"] == 3 && c["sinkEnqueued"] == 1, "\(c)")
        case .decodeQueueDrop:
            #expect(c["droppedDecodeQueue"] == 1 && c["gate.awaitingKeyframe"] == 3 && c["maxWaiting"] == 4, "\(c)")
            #expect(c["sinkEnqueued"] == 16)
        case .decodeFailure:
            #expect(c["decodeErrors"] == 1 && c["probe.decodeFailed"] == 1 && c["gate.awaitingKeyframe"] == 6, "\(c)")
        case .composeFailure:
            #expect(c["composeErrors"] == 1 && c["probe.decoded"] == 14 && c["gate.awaitingKeyframe"] == 6, "\(c)")
        }
    }

    @Test func theFixtureIsWhatBridgeCoreProduces() throws {
        var produced: [String: [String: Int]] = [:]
        for s in Scenario.allCases { produced[s.rawValue] = slice(try s.run().c) }
        let doc: [String: Any] = [
            "about": "Counts produced by the real BridgeCore + the decode probe's decoder and sink, one per scenario, by Tests/WebcamProbeTests/AccountingScenarioTests.swift. Read by scripts/webcam-spike-core.test.mjs. Regenerate with WEBCAM_UPDATE_FIXTURES=1 node run-tests.mjs.",
            "scenarios": produced,
        ]
        let data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
        if ProcessInfo.processInfo.environment["WEBCAM_UPDATE_FIXTURES"] == "1" {
            try data.write(to: Self.fixtureURL)
        }
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtureURL)) as? [String: Any]
        let savedScenarios = try #require(saved?["scenarios"] as? [String: [String: Int]])
        #expect(savedScenarios == produced, "the fixture drifted from what BridgeCore produces — regenerate it")
    }
}
