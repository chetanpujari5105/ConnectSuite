import Foundation
import Testing
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe
import WebcamTestSupport

// Version 2's bridge half (docs/protocol.md → the local contract, `chain-broken` / `chain-recovered`):
// the bridge tells main once per break that the live session's chain broke, and once that it recovered.
// Main answers the first with `webcam.keyframe`. Through the real BridgeCore, real H.264, the probe's
// decoder and sink; GatedDecoder holds and fails chosen calls.

private let W = 640, H = 360
private let OTHER = SessionID(hex: "ffeeddccbbaa99887766554433221100")!

private func aus(_ idrAt: Set<Int> = [0, 10]) throws -> [Data] {
    try stream(width: W, height: H, count: 20, idrAt: idrAt).map(\.annexB)
}

private extension ProbeRig {
    var broken: [(SessionID, UInt16, ChainBreakCause)] {
        statuses.compactMap { if case let .chainBroken(id, g, c) = $0 { return (id, g, c) } else { return nil } }
    }
    var recovered: [(SessionID, UInt16)] {
        statuses.compactMap { if case let .chainRecovered(id, g) = $0 { return (id, g) } else { return nil } }
    }
}

@Suite(.serialized) struct ChainSignals {
    @Test func anOverflowIsSignalledOnceAndItsRecoveryOnce() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.unconvertibleAt = [3]   // a second break while already waiting: frame 3 fails to compose
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H)
        dec.hold(call: 1)
        r.feed(f[1], width: W, height: H, drain: false)
        waitFor(dec.entered, "frame 1 inside the decoder")
        for i in 2...9 { r.feed(f[i], width: W, height: H, drain: false) }   // 6 overflows; 7-9 refused
        #expect(r.broken.count == 1, "one break, however many AUs it cost")
        dec.release.signal()
        r.core.drain()
        #expect(r.c["composeErrors"] == 1, "the second break happened")
        #expect(r.broken.count == 1, "a break while already waiting reports nothing")
        #expect(r.recovered.isEmpty, "frames admitted before the break are not the recovery")
        for i in 10..<20 { r.feed(f[i], width: W, height: H) }
        let b = try #require(r.broken.first), rec = try #require(r.recovered.first)
        #expect(b.0 == SESSION && b.1 == 1 && b.2 == .queueFull)
        #expect(r.recovered.count == 1 && rec.0 == SESSION && rec.1 == 1)
        #expect(r.core.invariantHolds)
    }

    @Test func aDecodeFailureWithNoRecoveryWaitingIsSignalled() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<20 { r.feed(f[i], width: W, height: H) }
        #expect(r.broken.count == 1 && r.broken.first?.2 == .decodeFailed)
        #expect(r.recovered.count == 1 && r.c["gate.awaitingKeyframe"] == 6)
    }

    @Test func aDecodeFailureWithAValidIDRAlreadyWaitingSignalsNothing() throws {
        let f = try aus([0, 5, 10]), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<3 { r.feed(f[i], width: W, height: H) }
        dec.hold(call: 3)
        r.feed(f[3], width: W, height: H, drain: false)
        waitFor(dec.entered, "frame 3 inside the decoder")
        for i in 4...7 { r.feed(f[i], width: W, height: H, drain: false) }
        dec.release.signal()
        r.core.drain()
        for i in 8..<20 { r.feed(f[i], width: W, height: H) }
        #expect(r.broken.isEmpty && r.recovered.isEmpty, "the chain never waited: nothing to ask for")
        #expect(r.c["diag.chain.recoveryKept"] == 1)
    }

    @Test func aComposeFailureIsSignalledWithItsCause() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.unconvertibleAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<20 { r.feed(f[i], width: W, height: H) }
        #expect(r.broken.count == 1 && r.broken.first?.2 == .composeFailed && r.recovered.count == 1)
    }

    @Test func aSessionsFirstIDRIsNotABreak() throws {
        let f = try aus(), dec = GatedDecoder()
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<20 { r.feed(f[i], width: W, height: H) }
        #expect(r.broken.isEmpty && r.recovered.isEmpty && r.c["sinkEnqueued"] == 20)
    }

    @Test func aBreakCarriesTheCurrentGeneration() throws {
        let f = try aus([0, 3, 10]), dec = GatedDecoder()
        dec.failAt = [5]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<3 { r.feed(f[i], width: W, height: H) }
        r.phone.generation = 2
        for i in 3..<12 { r.feed(f[i], width: W, height: H) }     // gen 2 from its IDR at 3; 5 fails
        #expect(r.broken.first?.1 == 2 && r.recovered.first?.1 == 2, "\(r.broken) \(r.recovered)")
    }

    @Test func aStaleSessionsFailureSignalsNothingAndAStoppedBreakNeverRecovers() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [2]
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H); r.feed(f[1], width: W, height: H)
        dec.hold(call: 2)
        r.feed(f[2], width: W, height: H, drain: false)
        waitFor(dec.entered, "A's frame inside the decoder")
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        for i in 10...13 { r.feed(f[i], width: W, height: H, session: OTHER, drain: false) }
        dec.release.signal()
        r.core.drain()
        #expect(r.broken.isEmpty && r.recovered.isEmpty, "A's failure is no fact about B: \(r.broken)")

        // B breaks, then ends before any IDR: its break is never reported recovered — not even to a C.
        let g = GatedDecoder()
        g.failAt = [1]
        let r2 = ProbeRig(inner: g)
        r2.live()
        for i in 0..<5 { r2.feed(f[i], width: W, height: H) }
        _ = r2.core.control(.sessionLive(OTHER, generation: 1))
        for i in 10..<16 { r2.feed(f[i], width: W, height: H, session: OTHER) }
        #expect(r2.broken.count == 1 && r2.broken.first?.0 == SESSION && r2.recovered.isEmpty, "\(r2.recovered)")
        #expect(r2.core.invariantHolds)
    }

    @Test func theRecordsCarryExactlyTheContractsFieldsAndCauses() throws {
        let b = try JSONSerialization.jsonObject(with: BridgeStatus.chainBroken(SESSION, generation: 7, cause: .decodeFailed).json) as! [String: Any]
        #expect(Set(b.keys) == ["op", "sessionId", "generation", "cause"])
        #expect(b["op"] as? String == "chain-broken" && b["sessionId"] as? String == SESSION.hex && b["generation"] as? Int == 7 && b["cause"] as? String == "decode-failed")
        let r = try JSONSerialization.jsonObject(with: BridgeStatus.chainRecovered(SESSION, generation: 7).json) as! [String: Any]
        #expect(Set(r.keys) == ["op", "sessionId", "generation"] && r["op"] as? String == "chain-recovered")
        // One copy of the closed set, read in place.
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("docs/fixtures/webcam-vocabulary-v1.json")
        let doc = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        #expect(doc["chainBreakCauses"] as? [String] == ChainBreakCause.allCases.map(\.rawValue))
    }
}
