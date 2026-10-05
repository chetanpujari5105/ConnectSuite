import Foundation
import Testing
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe
import WebcamTestSupport

// Defect 177 §6, part B: after a decode FAILURE, AUs already waiting that depend on the failed picture
// must never reach the decoder, and recovery happens only at a valid IDR of the current session and
// generation. Through the real BridgeCore with the probe's decoder and sink and real H.264; the
// failure itself is GatedDecoder's (`failAt`), which throws before the real decoder sees the bytes.
//
// A decode failure is a RECOVERABLE Mac-side drop. It is not the contract's fatal path (`stream-rejected`,
// SessionGate's validator), which these tests never reach and nothing here changes.

private let W = 640, H = 360
private let OTHER = SessionID(hex: "ffeeddccbbaa99887766554433221100")!

private func aus(_ idrAt: Set<Int> = [0, 10]) throws -> [Data] {
    try stream(width: W, height: H, count: 20, idrAt: idrAt).map(\.annexB)
}

@Suite(.serialized) struct DecodeRecovery {
    @Test func dependentsWaitingBehindAFailedPFrameNeverReachTheDecoder() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<3 { r.feed(f[i], width: W, height: H) }
        dec.hold(call: 3)
        r.feed(f[3], width: W, height: H, drain: false)
        waitFor(dec.entered, "frame 3 inside the decoder")
        r.feed(f[4], width: W, height: H, drain: false)          // both reference frame 3
        r.feed(f[5], width: W, height: H, drain: false)
        dec.release.signal()
        r.core.drain()
        var c = r.c
        #expect(c["probe.decodeAttempts"] == 4, "frames 4 and 5 reached the decoder after frame 3 failed: \(c)")
        #expect(c["droppedDecodeQueue"] == 2 && c["diag.chain.flushedAfterFailure"] == 2, "\(c)")
        #expect(c["diag.chain.decodedAfterFailure"] == 0 && c["decodeErrors"] == 1)
        #expect(dec.invalidations == 1, "the decoder forgot the broken chain, once")
        for i in 6..<10 { r.feed(f[i], width: W, height: H) }     // future non-IDRs: refused
        for i in 10..<20 { r.feed(f[i], width: W, height: H) }    // the next IDR recovers
        c = r.c
        #expect(c["gate.awaitingKeyframe"] == 4 && c["sinkEnqueued"] == 13, "\(c)")
        #expect(c["diag.recovery.count"] == 1 && c["diag.recovery.open"] == 0 && dec.invalidations == 1)
        #expect(r.core.invariantHolds)
    }

    @Test func dependentsWaitingBehindAFailedIDRNeverReachTheDecoder() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [0]
        dec.hold(call: 0)
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H, drain: false)
        waitFor(dec.entered, "the IDR inside the decoder")
        r.feed(f[1], width: W, height: H, drain: false)
        r.feed(f[2], width: W, height: H, drain: false)
        dec.release.signal()
        r.core.drain()
        for i in 3..<20 { r.feed(f[i], width: W, height: H) }
        let c = r.c
        #expect(c["probe.decodeAttempts"] == 11 && c["diag.chain.flushedAfterFailure"] == 2, "1 failed IDR + the 10 from the next IDR: \(c)")
        #expect(c["gate.awaitingKeyframe"] == 7 && c["sinkEnqueued"] == 10 && c["diag.chain.decodedAfterFailure"] == 0)
        #expect(r.core.invariantHolds)
    }

    @Test func aValidRecoveryIDRAlreadyWaitingIsKeptWithEverythingAfterIt() throws {
        // The failed P-frame's one dependent is dropped; the IDR behind it, and the P-frames behind THAT,
        // are a valid chain and are decoded. Frames arriving afterwards join it, unrefused.
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
        let c = r.c
        #expect(c["diag.chain.flushedAfterFailure"] == 1 && c["diag.chain.recoveryKept"] == 1, "\(c)")
        #expect(c["gate.awaitingKeyframe"] == 0 && c["probe.decodeAttempts"] == 19 && c["sinkEnqueued"] == 18, "\(c)")
        // The kept IDR's frame is the picture coming back, though it was admitted before the failure.
        #expect(c["diag.recovery.count"] == 1 && c["diag.chain.decodedAfterFailure"] == 0)
        #expect(r.core.invariantHolds)
    }

    @Test func aRecoveryIDRArrivingAfterTheFailureIsAcceptedAndNothingBeforeItIs() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<20 { r.feed(f[i], width: W, height: H) }
        let c = r.c
        #expect(c["gate.awaitingKeyframe"] == 6 && c["sinkEnqueued"] == 13 && c["diag.chain.flushedAfterFailure"] == 0)
        #expect(c["diag.recovery.count"] == 1 && dec.invalidations == 1 && r.core.invariantHolds)
    }

    @Test func anIDROfASupersededGenerationIsNotARecoveryPoint() throws {
        let f = try aus([0, 3, 10]), dec = GatedDecoder()
        dec.failAt = [1]
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H)
        dec.hold(call: 1)
        r.feed(f[1], width: W, height: H, drain: false)
        waitFor(dec.entered, "frame 1 inside the decoder")
        for i in 2...4 { r.feed(f[i], width: W, height: H, drain: false) }   // P, IDR (gen 1), P
        _ = r.core.control(.sessionLive(SESSION, generation: 2))              // generation 2 is current now
        dec.release.signal()
        r.core.drain()
        r.phone.generation = 2
        r.feed(f[10], width: W, height: H)
        r.feed(f[11], width: W, height: H)
        let c = r.c
        #expect(c["diag.chain.flushedAfterFailure"] == 3 && c["diag.chain.recoveryKept"] == 0, "\(c)")
        #expect(c["probe.decodeAttempts"] == 4 && c["sinkEnqueued"] == 3, "\(c)")
        #expect(r.core.invariantHolds)
    }

    @Test func withNoUsableRecoveryFrameNothingIsShownAndTheGapIsUnrecovered() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<10 { r.feed(f[i], width: W, height: H) }
        _ = r.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        r.core.drain()
        let c = r.c
        #expect(c["sinkEnqueued"] == 3 && c["gate.awaitingKeyframe"] == 6 && c["diag.recovery.unrecovered"] == 1)
        #expect(c["diag.recovery.count"] == 0 && c["diag.chain.decodedAfterFailure"] == 0)
        #expect(dec.invalidations == 1, "the failure reset it; the Stop found nothing left to reset")
        #expect(r.core.invariantHolds)
    }

    @Test func aReplacementDuringRecoveryStartsCleanAndIsNotRefused() throws {
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [3]
        let r = ProbeRig(inner: dec)
        r.live()
        for i in 0..<5 { r.feed(f[i], width: W, height: H) }      // 3 fails, 4 refused
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        for i in 10..<16 { r.feed(f[i], width: W, height: H, session: OTHER) }
        let c = r.c
        #expect(c["gate.awaitingKeyframe"] == 1 && c["sinkEnqueued"] == 9, "\(c)")
        #expect(c["diag.recovery.unrecovered"] == 1 && c["decodeErrors"] == 1 && r.core.invariantHolds)
    }

    @Test func aStaleSessionsDecodeFailureDoesNotTouchItsReplacement() throws {
        // A's frame is inside the decoder when B goes live; it then FAILS. B's IDR and P-frames are
        // already waiting, and B's next P-frame arrives after: none of them is A's to break.
        let f = try aus(), dec = GatedDecoder()
        dec.failAt = [2]
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H); r.feed(f[1], width: W, height: H)
        dec.hold(call: 2)
        r.feed(f[2], width: W, height: H, drain: false)
        waitFor(dec.entered, "A's frame inside the decoder")
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        for i in 10...12 { r.feed(f[i], width: W, height: H, session: OTHER, drain: false) }
        dec.release.signal()
        r.core.drain()
        r.feed(f[13], width: W, height: H, session: OTHER)
        let c = r.c
        #expect(c["gate.awaitingKeyframe"] == 0 && c["diag.chain.flushedAfterFailure"] == 0, "\(c)")
        #expect(c["diag.chain.staleFailures"] == 1 && c["sinkEnqueued"] == 6 && c["decodeErrors"] == 1, "\(c)")
        #expect(r.core.invariantHolds)
    }

    @Test func theOldSessionsStopDoesNotResetTheReplacementsDecoder() throws {
        // Found writing the replacement tests: the Stop's decoder reset was queued behind the decode
        // loop, which can already be decoding the replacement — so it ran AFTER B's IDR, and B's next
        // P-frame failed against a decoder with no session.
        let f = try aus(), dec = GatedDecoder()
        let r = ProbeRig(inner: dec)
        r.live()
        r.feed(f[0], width: W, height: H)
        dec.hold(call: 1)
        r.feed(f[1], width: W, height: H, drain: false)
        waitFor(dec.entered, "A's frame inside the decoder")
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        r.feed(f[10], width: W, height: H, session: OTHER, drain: false)
        r.feed(f[11], width: W, height: H, session: OTHER, drain: false)
        dec.release.signal()
        r.core.drain()
        r.feed(f[12], width: W, height: H, session: OTHER)
        let c = r.c
        #expect(c["decodeErrors"] == 0 && c["sinkEnqueued"] == 4, "\(c)")
        #expect(dec.invalidations == 1, "one reset, at the change of owner, and none afterwards")
        #expect(r.core.invariantHolds)
    }

    @Test func aStaleSessionsComposeFailureDoesNotTouchItsReplacement() throws {
        // The Stop lands after A's frame has its composer and before its compose failure is handled.
        // The decode thread reads the clock once at compose start and once in the failure branch; the
        // test's clock holds it at the second read, so the sequence is fixed rather than raced.
        let f = try aus(), dec = GatedDecoder(), hold = ReadHold()
        dec.unconvertibleAt = [1]
        dec.afterDecode = [1: { hold.arm(skipping: 1) }]
        let r = ProbeRig(inner: dec, clock: hold.read)
        r.live()
        r.feed(f[0], width: W, height: H)
        r.feed(f[1], width: W, height: H, drain: false)
        waitFor(hold.entered, "A's compose failure, before it is handled")
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        hold.release.signal()
        r.core.drain()
        for i in 10...12 { r.feed(f[i], width: W, height: H, session: OTHER) }
        let c = r.c
        #expect(c["composeErrors"] == 1 && c["gate.awaitingKeyframe"] == 0 && c["sinkEnqueued"] == 4, "\(c)")
        #expect(c["diag.chain.staleFailures"] == 1 && r.core.invariantHolds)
    }
}

/// Real monotonic time, except that one armed read blocks until the test releases it.
final class ReadHold: @unchecked Sendable {
    private let lock = NSLock()
    private var skip: Int?
    let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
    func arm(skipping n: Int) { lock.lock(); skip = n; lock.unlock() }
    var read: () -> UInt64 {
        { [self] in
            lock.lock()
            var held = false
            if let n = skip { if n == 0 { skip = nil; held = true } else { skip = n - 1 } }
            lock.unlock()
            if held { entered.signal(); release.wait() }
            return DispatchTime.now().uptimeNanoseconds
        }
    }
}
