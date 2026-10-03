import CoreMedia
import CoreMediaIO
import CoreVideo
import Foundation
import Testing
import WebcamCore
@testable import WebcamExtension
import WebcamMedia
import WebcamTestSupport

final class Counter: @unchecked Sendable {
    private let lock = NSLock(); private var n = 0
    func bump() { lock.lock(); n += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return n }
}

let A = SessionID(hex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")!
let B = SessionID(hex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")!

// MARK: - The real CoreMediaIO objects

@Suite struct Publishing {
    /// CoreMediaIO allows one provider per process, and every test target shares this process, so
    /// this is the only place a provider is made.
    static let provider = Result { try SidekickCameraProvider(clientQueue: nil) }

    @Test func theDeviceAndBothStreamsAreRealCMIOObjects() throws {
        let p = try Self.provider.get()
        #expect(p.provider.devices.count == 1)
        let d = p.deviceSource.device!
        #expect(d.localizedName == "Sidekick Camera")
        #expect(d.deviceID == SidekickCameraIdentity.deviceID)
        #expect(d.streams.count == 2)
        #expect(p.deviceSource.sourceStream.stream.direction == .source)
        #expect(p.deviceSource.sinkStream.stream.direction == .sink)
        let dims = p.deviceSource.sourceStream.formats.map { CMVideoFormatDescriptionGetDimensions($0.formatDescription) }
        #expect(dims.map { [$0.width, $0.height] } == [[1920, 1080], [1280, 720]])
        #expect(p.deviceSource.sourceStream.formats.allSatisfy {
            CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        })
        // Attached to its provider, the device publishes count changes through the real
        // notifyPropertiesChanged (which crashes on an unattached device).
        #expect(p.deviceSource.attachedToProvider)
        try p.deviceSource.sourceStream.startStream()
        #expect(p.deviceSource.consumerCount == 1)
        try p.deviceSource.sourceStream.stopStream()
        #expect(p.deviceSource.consumerCount == 0)
    }

    @Test func theConsumerCountIsReadOnlyAndStartsAtZero() throws {
        let d = try SidekickCameraDevice(relay: FrameRelay(), runsOwnTimers: false)
        let read = { try d.deviceProperties(forProperties: [SidekickCameraDevice.consumerCountProperty])
            .propertiesDictionary[SidekickCameraDevice.consumerCountProperty]?.value as? String }
        #expect(try read() == "0")
        let attempt = CMIOExtensionDeviceProperties(dictionary: [
            SidekickCameraDevice.consumerCountProperty: CMIOExtensionPropertyState(value: "9" as NSString),
        ])
        try d.setDeviceProperties(attempt)
        #expect(try read() == "0")
        try d.sourceStream.startStream()
        #expect(try read() == "1")
    }

    @Test func aClientMayChooseFormatAndRateButOnlyWithinWhatIsPublished() throws {
        let s = try SidekickCameraDevice(relay: FrameRelay(), runsOwnTimers: false).sourceStream!
        let set = CMIOExtensionStreamProperties(dictionary: [:])
        set.activeFormatIndex = 1
        set.frameDuration = CMTime(value: 1, timescale: 120)
        try s.setStreamProperties(set)
        #expect(s.activeFormat == .hd)
        #expect(s.frameDuration == CMTime(value: 1, timescale: 30))
        let bad = CMIOExtensionStreamProperties(dictionary: [:])
        bad.activeFormatIndex = 7
        try s.setStreamProperties(bad)
        #expect(s.activeFormat == .hd)
    }
}

// MARK: - No source, no consent: only a placeholder

@Suite struct OnlyAPlaceholder {
    @Test func consumersWithNoProducerSeeOnlyTheCameraOffCard() throws {
        let (auth, _) = injectedAuthorizer()
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        try d.sourceStream.startStream()        // a meeting app opened and started the device
        try d.sourceStream.startStream()        // a second one
        var clock = Clock()
        let off = try PlaceholderCards().buffer(.cameraOff, format: .fullHD)
        for _ in 0..<60 {
            let delivery = try #require(d.tick(nowNanos: clock.advance(ms: 33)))
            #expect(delivery.picture == .off && delivery.session == nil)
            #expect(PixelBuffers.digest(delivery.buffer) == PixelBuffers.digest(off))
        }
        #expect(d.relay.delivered == [.off: 60])
    }

    @Test func framesFromAnUnstartedOrUnauthorizedSinkAreRefused() throws {
        let (auth, _) = injectedAuthorizer(.notSatisfied)
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        try d.sourceStream.startStream()
        #expect(!d.authorizeProducer(clientID: producerID, claim: bridgeClaim))
        try d.sinkStream.startStream()          // the system would not call this; the device must cope
        d.receiveFromProducer(try liveFrame(A), nowNanos: 1)
        #expect(d.relay.refused == [.noProducer: 1])
        #expect(d.tick(nowNanos: 2)?.picture == .off)
    }

    @Test func anAuthorizedProducerWithNoFrameYetIsStillCameraOff() throws {
        let (auth, _) = injectedAuthorizer()
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        try d.sourceStream.startStream()
        #expect(d.authorizeProducer(clientID: producerID, claim: bridgeClaim))
        try d.sinkStream.startStream()
        #expect(d.tick(nowNanos: 5)?.picture == .off)
    }
}

// MARK: - Who may produce

@Suite struct Authorization {
    @Test func withNoTeamIDEveryProducerIsRefusedEvenAPerfectOne() {
        // Fail closed: the shipped identity has no Team ID, and a verifier that would say yes to
        // anything is never even asked.
        let box = InjectedVerifier(.satisfied)
        let a = ProducerAuthorizer(verifier: InjectedCodeVerifier(box: box))
        #expect(SidekickCameraIdentity.teamID == nil)
        #expect(a.authorize(bridgeClaim) == .refused(.noTeamIDConfigured))
        #expect(box.asked.isEmpty)
    }

    @Test func wrongOrMissingIdentitiesAreRefusedBeforeTheSignatureIsChecked() {
        let (a, box) = injectedAuthorizer(.satisfied)
        #expect(a.authorize(ProducerClaim(signingID: nil, pid: 1)) == .refused(.missingSigningID))
        #expect(a.authorize(ProducerClaim(signingID: "", pid: 1)) == .refused(.missingSigningID))
        #expect(a.authorize(ProducerClaim(signingID: "com.example.zoom", pid: 1)) == .refused(.wrongSigningID("com.example.zoom")))
        #expect(box.asked.isEmpty)
    }

    @Test func theRightSigningIDIsNotEnoughTheSignatureMustSatisfyTheRequirement() throws {
        let (a, box) = injectedAuthorizer(.notSatisfied)
        #expect(a.authorize(bridgeClaim) == .refused(.signatureRequirementFailed(errSecCSReqFailed)))
        // `#require`, not an index: a mutation that skips the verifier must fail this test, not crash
        // the process and take every other result with it (it did, once).
        let asked = try #require(box.asked.first)
        #expect(box.asked.count == 1)
        #expect(asked.pid == 4242)
        #expect(asked.requirement ==
            "anchor apple generic and identifier \"com.chetan.sidekick.desktop.camera-bridge\" and certificate leaf[subject.OU] = \"INJECTED01\"")
        box.verdict = .gone
        #expect(a.authorize(bridgeClaim) == .refused(.processGone(errSecCSNoSuchCode)))
        box.verdict = .satisfied
        #expect(a.authorize(bridgeClaim) == .authorized)
    }

    @Test func refusalsAreRecordedWithTheIdentityRefused() throws {
        let (auth, _) = injectedAuthorizer(.notSatisfied)
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        _ = d.authorizeProducer(clientID: UUID(), claim: ProducerClaim(signingID: "evil.injector", pid: 77))
        _ = d.authorizeProducer(clientID: UUID(), claim: bridgeClaim)
        #expect(d.producerRefusals == [.wrongSigningID("evil.injector"), .signatureRequirementFailed(errSecCSReqFailed)])
    }
}

/// **Real Security framework calls against real processes.** These prove the verifier reads real
/// code signatures and evaluates real requirements — the positive control is an Apple platform
/// binary satisfying `anchor apple`. They do **not** prove that a Developer-ID-signed bridge is
/// accepted: no such certificate exists, so that reading is W4's.
@Suite(.serialized) struct RealCodeSignatures {
    func spawnSleep() throws -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sleep")
        p.arguments = ["10"]
        try p.run()
        return p
    }

    @Test func anAppleBinarySatisfiesAnchorAppleButNotOurTeamRequirement() throws {
        let p = try spawnSleep()
        defer { p.terminate() }
        let v = SecurityFrameworkVerifier()
        #expect(v.check(pid: p.processIdentifier, requirement: "anchor apple") == .satisfied)
        let ours = ProducerAuthorizer.requirement(teamID: "ABCDE12345", identifier: SidekickCameraIdentity.bridgeIdentifier)
        guard case .notSatisfied = v.check(pid: p.processIdentifier, requirement: ours) else {
            Issue.record("an Apple binary satisfied a Team-ID requirement"); return
        }
    }

    @Test func thisTestProcessSatisfiesNoTeamRequirement() {
        let ours = ProducerAuthorizer.requirement(teamID: "ABCDE12345", identifier: SidekickCameraIdentity.bridgeIdentifier)
        guard case .notSatisfied = SecurityFrameworkVerifier().check(pid: getpid(), requirement: ours) else {
            Issue.record("the unsigned test runner passed a Team-ID requirement"); return
        }
    }

    @Test func anExitedProcessIsGoneAndABadRequirementIsReported() throws {
        let p = try spawnSleep()
        let pid = p.processIdentifier
        p.terminate()
        p.waitUntilExit()
        guard case .noSuchProcess = SecurityFrameworkVerifier().check(pid: pid, requirement: "anchor apple") else {
            Issue.record("a dead pid was not reported gone"); return
        }
        guard case .invalidRequirement = SecurityFrameworkVerifier().check(pid: getpid(), requirement: "anchor apple and (") else {
            Issue.record("a malformed requirement was not reported"); return
        }
    }
}

// MARK: - The relay

@Suite struct Relay {
    func ready() throws -> FrameRelay {
        let r = try FrameRelay()
        r.producerStarted()
        return r
    }

    @Test func freshThenRepeatThenPausedNeverAFrozenFrameLabelledLive() throws {
        let r = try ready()
        var c = Clock()
        r.ingest(try liveFrame(A), nowNanos: c.now)
        #expect(try r.tick(format: .fullHD, nowNanos: c.advance(ms: 33)).picture == .fresh)
        #expect(try r.tick(format: .fullHD, nowNanos: c.advance(ms: 33)).picture == .repeat)
        #expect(try r.tick(format: .fullHD, nowNanos: c.advance(ms: 900)).picture == .repeat)  // 966 ms old
        let stale = try r.tick(format: .fullHD, nowNanos: c.advance(ms: 100))                  // 1066 ms old
        #expect(stale.picture == .paused && stale.session == nil)
        #expect(PixelBuffers.digest(stale.buffer) == PixelBuffers.digest(try PlaceholderCards().buffer(.videoPaused, format: .fullHD)))
    }

    @Test func badPixelFormatsAndSizesAreRefused() throws {
        let r = try ready()
        var bgra: CVPixelBuffer?
        CVPixelBufferCreate(nil, 1920, 1080, kCVPixelFormatType_32BGRA, nil, &bgra)
        #expect(r.ingest(try SampleBuffers.make(bgra!, pts: .zero), nowNanos: 1) == .badPixelFormat)
        let odd = try SampleBuffers.make(try TestPatterns.flat(width: 1024, height: 576, y: 50), pts: .zero)
        #expect(r.ingest(odd, nowNanos: 1) == .badSize)
        #expect(r.accepted == 0 && r.ingested == 2)
    }

    @Test func aStaleGenerationIsRefusedAndANewSessionClearsTheOldPixelsFirst() throws {
        let r = try ready()
        r.ingest(try liveFrame(A, generation: 3), nowNanos: 1)
        #expect(r.ingest(try liveFrame(A, generation: 2), nowNanos: 2) == .staleGeneration)
        r.ingest(try liveFrame(B, generation: 1, y: 60), nowNanos: 3)
        #expect(r.isEnded(A))
        #expect(r.ingest(try liveFrame(A, generation: 4), nowNanos: 4) == .endedSession)
        #expect(try r.tick(format: .fullHD, nowNanos: 5).session == B)
    }

    @Test func aStopClearsTheSlotAndTheNextTickIsThePristineCard() throws {
        let cards = PlaceholderCards()
        let r = try FrameRelay(cards: cards)
        r.producerStarted()
        let frame = try liveFrame(A)
        let liveDigest = PixelBuffers.digest(CMSampleBufferGetImageBuffer(frame)!)
        r.ingest(frame, nowNanos: 1)
        #expect(try r.tick(format: .fullHD, nowNanos: 2).picture == .fresh)
        r.producerStopped()
        #expect(!r.holdsFrame && r.cleared == 1)
        let after = try r.tick(format: .fullHD, nowNanos: 3)   // 2 ns later: well inside the stall threshold
        #expect(after.picture == .off)
        #expect(after.buffer === (try cards.buffer(.cameraOff, format: .fullHD)))
        #expect(PixelBuffers.digest(after.buffer) != liveDigest)
    }

    @Test func aStoppedSessionNeverReappearsFromAnyProducer() throws {
        let r = try ready()
        r.ingest(try liveFrame(A), nowNanos: 1)
        r.sessionEnded(A)
        #expect(try r.tick(format: .fullHD, nowNanos: 2).picture == .off)
        // The same producer replays it, then a replacement producer does.
        #expect(r.ingest(try liveFrame(A, generation: 9), nowNanos: 3) == .endedSession)
        r.producerStopped(); r.producerStarted()
        #expect(r.ingest(try liveFrame(A), nowNanos: 4) == .endedSession)
        for t in UInt64(5)..<50 { #expect(try r.tick(format: .fullHD, nowNanos: t).picture == .off) }
    }

    @Test func timestampsStrictlyIncreaseAcrossEveryChangeEvenIfTheClockDoesNot() throws {
        let r = try ready()
        var stamps: [UInt64] = []
        let clocks: [UInt64] = [100, 100, 99, 100, 5_000, 5_000, 1_200_000_000, 1, 1]
        for (i, t) in clocks.enumerated() {
            if i == 1 { r.ingest(try liveFrame(A), nowNanos: t) }       // off → live
            if i == 5 { r.ingest(try liveFrame(B), nowNanos: t) }       // a session change
            if i == 7 { r.producerStopped() }                            // live/paused → off
            stamps.append(try r.tick(format: i % 2 == 0 ? .fullHD : .hd, nowNanos: t).hostTimeNanos)
        }
        #expect(zip(stamps, stamps.dropFirst()).allSatisfy { $0 < $1 }, "\(stamps)")
    }

    @Test func aSmallerSourceIsFittedAndLabelledUpscaled() throws {
        let r = try ready()
        r.ingest(try liveFrame(A, format: .hd), nowNanos: 1)
        let d = try r.tick(format: .fullHD, nowNanos: 2)
        #expect(d.upscaled && CVPixelBufferGetWidth(d.buffer) == 1920)
        r.ingest(try liveFrame(A, format: .fullHD), nowNanos: 3)
        #expect(!(try r.tick(format: .hd, nowNanos: 4)).upscaled)
    }
}

// MARK: - Consumers

@Suite struct Consumers {
    @Test func theLastConsumerClosingEndsTheEpisodeAndOnlyThat() throws {
        let d = try SidekickCameraDevice(relay: FrameRelay(), runsOwnTimers: false)
        var seen: [(ConsumerLedger.Transition, Int)] = []
        d.onConsumerTransition = { seen.append(($0, $1)) }
        try d.sourceStream.startStream()
        try d.sourceStream.startStream()
        try d.sourceStream.stopStream()
        #expect(seen.map(\.0) == [.episodeBegan])
        try d.sourceStream.stopStream()
        #expect(seen.map(\.0) == [.episodeBegan, .episodeEnded])
        #expect(d.consumerCount == 0)
        try d.sourceStream.stopStream()                    // a duplicate stop: an anomaly, not a transition
        #expect(seen.count == 2 && d.ledgerSnapshot.anomalies == 1)
    }

    /// The device's own `DispatchSourceTimer`, as production runs it: ticks arrive while a consumer
    /// exists, and stop when the last one leaves.
    @Test func theRealTickTimerRunsOnlyWhileConsumed() async throws {
        let d = try SidekickCameraDevice(relay: FrameRelay())
        let count = Counter()
        d.onDelivery = { _ in count.bump() }
        try d.sourceStream.startStream()
        try await Task.sleep(nanoseconds: 400_000_000)
        #expect(d.isTicking)
        let whileConsumed = count.value
        #expect(whileConsumed >= 6, "≈12 expected at 30 fps over 400 ms; got \(whileConsumed)")
        try d.sourceStream.stopStream()
        try await Task.sleep(nanoseconds: 100_000_000)
        #expect(!d.isTicking)
        let afterStop = count.value
        try await Task.sleep(nanoseconds: 300_000_000)
        #expect(count.value == afterStop, "ticks continued after the last consumer left")
    }

    /// **Modelled, not CoreMediaIO's.** The system fans one source stream out to every client; that
    /// cannot run in-process. These fake consumers model it — each with its own bounded queue and
    /// drain rate — to show the property the extension owns: its tick never waits on a consumer and
    /// it never holds more than one frame, however slow a consumer is.
    final class FakeConsumer {
        let capacity: Int, drainEvery: Int
        var queue: [FrameRelay.Delivery] = [], received = 0, dropped = 0, ticks = 0, maxDepth = 0
        init(capacity: Int, drainEvery: Int) { self.capacity = capacity; self.drainEvery = drainEvery }
        func offer(_ d: FrameRelay.Delivery) {
            ticks += 1
            if queue.count == capacity { queue.removeFirst(); dropped += 1 }
            queue.append(d); maxDepth = max(maxDepth, queue.count)
            if ticks % drainEvery == 0, !queue.isEmpty { queue.removeFirst(); received += 1 }
        }
    }

    @Test func slowAndFastConsumersShareOneSourceAndNeitherBuffersTheExtension() throws {
        let (auth, _) = injectedAuthorizer()
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        let fast = FakeConsumer(capacity: 2, drainEvery: 1)
        let slow = FakeConsumer(capacity: 2, drainEvery: 7)
        d.onDelivery = { fast.offer($0); slow.offer($0) }
        try d.sourceStream.startStream(); try d.sourceStream.startStream()
        _ = d.authorizeProducer(clientID: producerID, claim: bridgeClaim)
        try d.sinkStream.startStream()
        var c = Clock()
        let frame = try liveFrame(A)
        for i in 0..<300 {
            if i % 2 == 0 { d.receiveFromProducer(frame, nowNanos: c.now) }
            d.tick(nowNanos: c.advance(ms: 33))
        }
        #expect(fast.ticks == 300 && slow.ticks == 300)            // the slow one held nobody up
        #expect(fast.received == 300 && fast.dropped == 0)
        #expect(slow.maxDepth <= 2 && slow.dropped > 0)            // its own loss, bounded, counted
        #expect(slow.received + slow.dropped + slow.queue.count == 300)
        #expect(d.relay.delivered[.fresh, default: 0] + d.relay.delivered[.repeat, default: 0] == 300)
    }

    @Test func aConsumerReplacingAnotherGetsTheSamePictureNotAResumedSession() throws {
        let (auth, _) = injectedAuthorizer()
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        try d.sourceStream.startStream()
        _ = d.authorizeProducer(clientID: producerID, claim: bridgeClaim)
        try d.sinkStream.startStream()
        d.receiveFromProducer(try liveFrame(A), nowNanos: 1)
        #expect(d.tick(nowNanos: 2)?.session == A)
        // The consumer crashes; the bridge, told the count is 0, ends A and stops its sink.
        try d.sourceStream.stopStream()
        d.relay.sessionEnded(A)
        try d.sinkStream.stopStream()
        // A new consumer arrives: nothing of A is shown, and A cannot be fed back in.
        try d.sourceStream.startStream()
        #expect(d.tick(nowNanos: 3)?.picture == .off)
        _ = d.authorizeProducer(clientID: producerID, claim: bridgeClaim)
        try d.sinkStream.startStream()
        d.receiveFromProducer(try liveFrame(A), nowNanos: 4)
        #expect(d.tick(nowNanos: 5)?.picture == .off)
        #expect(d.relay.refused[.endedSession] == 1)
    }

    @Test func theProducerDisconnectingClearsThePictureAtOnce() throws {
        let (auth, _) = injectedAuthorizer()
        let d = try SidekickCameraDevice(authorizer: auth, relay: FrameRelay(), runsOwnTimers: false)
        try d.sourceStream.startStream()
        _ = d.authorizeProducer(clientID: producerID, claim: bridgeClaim)
        try d.sinkStream.startStream()
        d.receiveFromProducer(try liveFrame(A), nowNanos: 1)
        #expect(d.tick(nowNanos: 2)?.picture == .fresh)
        d.clientDisconnected(producerID)       // what disconnect(from:) does with the client's id
        #expect(!d.relay.holdsFrame)
        #expect(d.tick(nowNanos: 3)?.picture == .off)
        d.receiveFromProducer(try liveFrame(B), nowNanos: 4)
        #expect(d.relay.refused[.noProducer] == 1)
    }
}
