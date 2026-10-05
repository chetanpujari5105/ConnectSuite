import CoreMedia
import CoreVideo
import Foundation
import Testing
@testable import WebcamBridge
import WebcamCore
@testable import WebcamExtension
import WebcamMedia
import WebcamTestSupport

// End to end, in one process:
//
//   generated pictures → VTCompressionSession (the phone's job) → wire frames → bridge records →
//   BridgeCore → a real CMSimpleQueue → SidekickCameraDevice → the source stream's deliveries
//
// Real: the codec, the bridge's pipeline, VideoToolbox decode/rotate/fit, the queue, the device and
// its CoreMediaIO objects. **Stood in for:** the producer's identity (InjectedVerifier) and
// CoreMediaIO's cross-process sink transport — the test dequeues the queue and hands each frame to
// `receiveFromProducer`, which is what the device's sink timer does with `consumeSampleBuffer`.

let LIVE = SessionID(hex: "0123456789abcdef0123456789abcdef")!
let OTHER = SessionID(hex: "fedcba9876543210fedcba9876543210")!

struct Verifier: CodeIdentityVerifier {
    func check(pid: pid_t, requirement: String) -> CodeCheck { .satisfied }   // INJECTED
}

final class Rig {
    let sink = QueueSinkPort()
    let device: SidekickCameraDevice
    var bridge: BridgeCore!
    var statuses: [BridgeStatus] = []
    var phone = PhoneStandIn()
    let encoder: TestH264Encoder
    var clock: UInt64 = 50_000_000_000
    let width: Int, height: Int

    init(width: Int = 1280, height: Int = 720, decoder: FrameDecoding? = nil) throws {
        self.width = width
        self.height = height
        device = try SidekickCameraDevice(authorizer: ProducerAuthorizer(teamID: "INJECTED01", verifier: Verifier()),
                                          relay: FrameRelay(), runsOwnTimers: false)
        encoder = try TestH264Encoder(width: width, height: height)
        let lock = NSLock()
        bridge = BridgeCore(sink: sink, decoder: decoder ?? H264Decoder()) { [unowned self] s in
            lock.lock(); self.statuses.append(s); lock.unlock()
        }
        // The bridge's sink starting and stopping is the device's sink stream starting and stopping.
        sink.onStart = { [unowned self] in try? self.device.sinkStream.startStream() }
        sink.onStop = { [unowned self] in try? self.device.sinkStream.stopStream() }
        #expect(device.authorizeProducer(clientID: UUID(), claim: ProducerClaim(signingID: SidekickCameraIdentity.bridgeIdentifier, pid: 1)))
    }

    /// A consumer (a meeting app) starts the device; the bridge hears the count.
    func consumerArrives() throws {
        try device.sourceStream.startStream()
        bridge.consumersChanged(device.consumerCount)
    }

    func consumerLeaves() throws {
        try device.sourceStream.stopStream()
        bridge.consumersChanged(device.consumerCount)
    }

    func control(_ m: ControlMessage) { #expect(bridge.handle(BridgeRecord(type: .control, body: ControlCodec.encode(m))) == .continue) }

    /// One picture through the phone stand-in and into the bridge as a record.
    @discardableResult
    func send(_ session: SessionID = LIVE, keyframe: Bool = false, marker: UInt8 = 235) throws -> Data {
        let pic = try TestPatterns.marked(width: width, height: height, marker: marker)
        let (annexB, _) = try encoder.encode(pic, ptsMicros: phone.ptsMicros + 33_333, forceKeyframe: keyframe)
        let frame = phone.frame(annexB: annexB, width: width, height: height)
        let body = ControlCodec.accessUnitBody(session: session, frame: frame)
        #expect(bridge.handle(BridgeRecord(type: .accessUnit, body: body)) == .continue)
        return frame
    }

    /// CoreMediaIO's transport, stood in for: everything queued goes to the device's sink.
    func pump() {
        bridge.drain()
        while let sb = sink.queue.dequeue() { device.receiveFromProducer(sb, nowNanos: clock) }
    }

    func tick(advanceMs: UInt64 = 33) -> FrameRelay.Delivery {
        clock += advanceMs * 1_000_000
        return device.tick(nowNanos: clock)!
    }
}

@Suite(.serialized) struct EndToEnd {
    @Test func generatedFramesArriveUprightFittedAndLive() throws {
        let rig = try Rig()
        rig.phone.rotation = 1
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        for _ in 0..<5 { try rig.send() }
        rig.pump()
        let d = rig.tick()
        #expect(d.picture == .fresh && d.session == LIVE)
        // 1280×720 with rotation 1 composes into the 720p class, upright and pillarboxed; the device's
        // default active format is 1080p, so it is fitted up and labelled upscaled.
        #expect(CVPixelBufferGetWidth(d.buffer) == 1920 && d.upscaled)
        let marker = PixelBuffers.meanLuma(d.buffer, x: 1000, y: 100, w: 150, h: 150)   // top-right of the picture
        let other = PixelBuffers.meanLuma(d.buffer, x: 700, y: 700, w: 150, h: 150)    // bottom-left
        let bar = PixelBuffers.meanLuma(d.buffer, x: 10, y: 10, w: 400, h: 1000)
        #expect(marker > 200 && (95...125).contains(other) && bar < 22, "marker \(marker) other \(other) bar \(bar)")
        #expect(rig.bridge.invariantHolds)
        #expect(rig.bridge.countsSnapshot()["sinkEnqueued"] == 6)
    }

    @Test func noSessionNoConsentMeansOnlyThePlaceholder() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        // The phone is sending, but main never said the session is live (no tap, no `running`).
        try rig.send(keyframe: true)
        for _ in 0..<4 { try rig.send() }
        rig.pump()
        for _ in 0..<10 { #expect(rig.tick().picture == .off) }
        #expect(rig.bridge.countsSnapshot()["gate.noLiveSession"] == 5)
        #expect(rig.sink.starts == 0)
    }

    @Test func explicitStopClearsOldPixelsAndReleasesEverything() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        rig.pump()
        // The state the rule exists for: a live frame **on screen** when Stop is pressed — and more
        // queued behind it, not yet consumed. (The first version of this test pressed Stop before any
        // frame reached the extension, so it passed with the slot-clearing deleted: mutation M1.)
        let live = rig.tick()
        #expect(live.picture == .fresh && rig.device.relay.holdsFrame)
        let liveDigest = PixelBuffers.digest(live.buffer)
        try rig.send()
        try rig.send()
        rig.bridge.drain()
        #expect(rig.sink.queue.count > 0)
        rig.control(.sessionEnded(LIVE, reason: "person"))
        #expect(rig.sink.queue.count == 0 && rig.sink.queue.flushed > 0)
        #expect(rig.sink.stops == 1 && !rig.device.relay.holdsFrame)
        rig.pump()
        let after = rig.tick(advanceMs: 1)
        #expect(after.picture == .off && after.session == nil)
        let pristine = try PlaceholderCards().buffer(.cameraOff, format: .fullHD)
        #expect(PixelBuffers.digest(after.buffer) == PixelBuffers.digest(pristine))
        #expect(PixelBuffers.digest(after.buffer) != liveDigest)
        #expect(rig.statuses.contains(.sink(.idle)))
        #expect(rig.bridge.countsSnapshot()["pending"] == 0)
        #expect(rig.bridge.invariantHolds)
    }

    @Test func aStoppedStreamNeverReappears() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        rig.pump()
        #expect(rig.tick().session == LIVE)
        rig.control(.sessionEnded(LIVE, reason: "person"))
        // Late AUs of the ended session, a re-announcement of it, and a replay straight into the
        // extension from a replacement producer: none of them shows anything.
        try rig.send(keyframe: true)
        rig.control(.sessionLive(LIVE, generation: 2))
        #expect(rig.statuses.contains { if case .error = $0 { return true }; return false })
        rig.pump()
        try rig.device.sinkStream.startStream()
        let replay = try SampleBuffers.make(try TestPatterns.marked(width: 1920, height: 1080), pts: .zero)
        SampleBuffers.tag(replay, session: LIVE, generation: 3)
        rig.device.receiveFromProducer(replay, nowNanos: rig.clock)
        for _ in 0..<30 { #expect(rig.tick().picture == .off) }
        #expect(rig.bridge.countsSnapshot()["gate.endedSession"] == 1)
        #expect(rig.device.relay.refused[.endedSession] == 1)
        #expect(rig.sink.starts == 1)
    }

    @Test func theLastConsumerClosingStopsTheSessionWithoutWaitingForMain() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        rig.pump()
        #expect(rig.tick().picture == .fresh)
        try rig.consumerLeaves()
        #expect(rig.sink.stops == 0)                       // one consumer remains
        try rig.consumerLeaves()
        #expect(rig.sink.stops == 1)                       // at once, no linger
        #expect(rig.statuses.contains(.sessionEnded(LIVE, reason: "no-consumers")))
        #expect(rig.statuses.contains(.consumers(0)))
        try rig.send()
        rig.pump()
        #expect(rig.tick().picture == .off)
        #expect(rig.bridge.countsSnapshot()["gate.endedSession"] == 1)
    }

    @Test func staleSessionsAndGenerationsAreRejected() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 2))
        rig.phone.generation = 2
        try rig.send(keyframe: true)
        try rig.send(OTHER, keyframe: true)                // another session's AU
        rig.phone.generation = 1
        try rig.send(keyframe: true)                       // an older generation of this one
        rig.phone.generation = 3
        try rig.send(keyframe: true)                       // a switch outran its `running`: adopted from its IDR
        rig.pump()
        let c = rig.bridge.countsSnapshot()
        // Every one a drop, none fatal: the live session survives all of them. (A generation whose
        // first AU is not an IDR is fatal instead — FatalInput.aGenerationThatDoesNotStartWithAnIDR….)
        #expect(c["gate.otherSession"] == 1 && c["gate.staleGeneration"] == 1 && c["gate.malformed"] == 0)
        #expect(rig.bridge.gateSnapshot.live == LIVE)
        #expect(c["accepted"] == 2 && c["sinkEnqueued"] == 2)
        #expect(rig.bridge.gateSnapshot.highestGeneration == 3)
        #expect(rig.bridge.invariantHolds)
    }

    @Test func malformedAndOversizedInputIsRefusedBeforeItIsTrusted() throws {
        let rig = try Rig()
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        // An AU record without its session id, a status record sent the wrong way, a control record
        // that is not JSON: each is a malformed record (the bridge reports and exits).
        guard case .malformed = rig.bridge.handle(BridgeRecord(type: .accessUnit, body: Data(count: 10))) else { Issue.record("short AU record"); return }
        guard case .malformed = rig.bridge.handle(BridgeRecord(type: .status, body: Data("{}".utf8))) else { Issue.record("status in"); return }
        guard case .malformed = rig.bridge.handle(BridgeRecord(type: .control, body: Data("x".utf8))) else { Issue.record("bad json"); return }
        // A well-formed record carrying a malformed AU **of the live session** ends that session:
        // the sink stopped, the picture cleared, and one `stream-rejected` bound to its id. No crash,
        // no exit, no retry (docs/protocol.md → The Mac's local contract).
        var bad = [UInt8](try rig.send(keyframe: true)); bad[13] = 9
        rig.pump()
        #expect(rig.tick().picture == .fresh)
        _ = rig.bridge.handle(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: LIVE, frame: Data(bad))))
        _ = rig.bridge.handle(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: LIVE, frame: Data(bad))))
        rig.pump()
        #expect(rig.bridge.countsSnapshot()["gate.malformed"] == 1)
        #expect(rig.bridge.countsSnapshot()["gate.endedSession"] == 1)
        let rejected = rig.statuses.filter { if case .streamRejected = $0 { return true }; return false }
        #expect(rejected == [.streamRejected(LIVE, generation: 0, fault: .unknownVersion)])
        #expect(rig.statuses.last == .streamRejected(LIVE, generation: 0, fault: .unknownVersion))
        #expect(rig.statuses.contains(.sink(.idle)))
        #expect(rig.bridge.gateSnapshot.live == nil)
        #expect(rig.tick().picture == .off)
        // The status as main reads it: fixed tokens, no error text.
        let json = try JSONSerialization.jsonObject(with: rejected[0].json) as! [String: Any]
        #expect(json["op"] as? String == "stream-rejected" && json["violation"] as? String == "unknown-version")
        #expect(json["sessionId"] as? String == LIVE.hex && json["generation"] as? Int == 0)
        // An oversized record is refused from its 4-byte prefix.
        var dec = RecordDecoder()
        #expect(throws: RecordError.lengthOverCap(0x7FFF_FFFF)) { _ = try dec.feed(Data([0x7F, 0xFF, 0xFF, 0xFF])) }
        #expect(rig.bridge.invariantHolds)
    }

    @Test func aProducerFailureRecoversOnlyAtTheNextIDR() throws {
        final class FlakyDecoder: FrameDecoding {
            let real = H264Decoder(); var failNext = false
            func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
                if failNext { failNext = false; throw DecodeError.decode(-12909) }
                return try real.decode(annexB: annexB, ptsMicros: ptsMicros)
            }
            func invalidate() { real.invalidate() }
        }
        let flaky = FlakyDecoder()
        let rig = try Rig(decoder: flaky)
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        rig.bridge.drain()
        flaky.failNext = true
        try rig.send()                                     // fails to decode
        rig.bridge.drain()
        try rig.send()                                     // refused: the chain is broken
        try rig.send(keyframe: true)                       // recovers
        try rig.send()
        rig.pump()
        let c = rig.bridge.countsSnapshot()
        #expect(c["decodeErrors"] == 1 && c["gate.awaitingKeyframe"] == 1 && c["sinkEnqueued"] == 3)
        #expect(rig.bridge.invariantHolds)
    }

    @Test func aFailedDecodeShowsNoFrameFromTheBrokenChainThenVideoPausedThenTheRecovery() throws {
        // Part B through the real extension: AUs waiting behind a failed decode never reach it, so the
        // relay repeats the last good frame, then draws the video-paused card once the stall threshold
        // passes — the same placeholder rule as any other Mac-side drop — and is fresh again at the IDR.
        final class HeldFailingDecoder: FrameDecoding {
            let real = H264Decoder(); var calls = 0; var failAt = -1
            let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
            func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
                let n = calls; calls += 1
                if n == failAt { entered.signal(); release.wait(); throw DecodeError.decode(-12909) }
                return try real.decode(annexB: annexB, ptsMicros: ptsMicros)
            }
            func invalidate() { real.invalidate() }
        }
        let dec = HeldFailingDecoder()
        dec.failAt = 2
        let rig = try Rig(width: 640, height: 360, decoder: dec)
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true); try rig.send()
        rig.pump()
        #expect(rig.tick().picture == .fresh)
        let accepted = rig.device.relay.accepted
        try rig.send()                                       // fails, held inside the decoder
        #expect(dec.entered.wait(timeout: .now() + 10) == .success)
        try rig.send(); try rig.send()                       // its dependents, waiting
        dec.release.signal()
        rig.pump()
        #expect(rig.device.relay.accepted == accepted, "a frame from the broken chain reached the extension")
        #expect(rig.tick().picture == .repeat)
        #expect(rig.tick(advanceMs: 1_100).picture == .paused)
        try rig.send()                                       // refused: no IDR yet
        try rig.send(keyframe: true); try rig.send()         // recovers
        rig.pump()
        #expect(rig.tick().picture == .fresh)
        let c = rig.bridge.countsSnapshot()
        #expect(c["decodeErrors"] == 1 && c["droppedDecodeQueue"] == 2 && c["gate.awaitingKeyframe"] == 1 && c["sinkEnqueued"] == 4, "\(c)")
        #expect(rig.bridge.invariantHolds)
    }

    @Test func aSlowDecoderIsBoundedAndEveryAUIsAccountedFor() throws {
        final class SlowDecoder: FrameDecoding {
            let real = H264Decoder()
            func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer {
                Thread.sleep(forTimeInterval: 0.004)
                return try real.decode(annexB: annexB, ptsMicros: ptsMicros)
            }
            func invalidate() { real.invalidate() }
        }
        let rig = try Rig(width: 640, height: 360, decoder: SlowDecoder())
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        // Pre-encode, so the flood arrives faster than the 4 ms decoder can keep up.
        var frames: [Data] = []
        for i in 0..<240 {
            let pic = try TestPatterns.marked(width: 640, height: 360)
            let (a, _) = try rig.encoder.encode(pic, ptsMicros: UInt64(i + 1) * 33_333, forceKeyframe: i % 30 == 0)
            frames.append(rig.phone.frame(annexB: a, width: 640, height: 360))
        }
        for f in frames {
            _ = rig.bridge.handle(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: LIVE, frame: f)))
            #expect(rig.sink.queue.count <= 3)
        }
        rig.bridge.drain()
        let c = rig.bridge.countsSnapshot()
        // The bound is the stage's own high-water mark, recorded at every append — not a sample.
        #expect(c["maxWaiting"]! <= 4, "the decode stage held \(c["maxWaiting"]!) waiting AUs")
        #expect(c["maxWaiting"]! == 4, "the flood never filled the decode stage — no reading")
        #expect(c["droppedDecodeQueue"]! > 0)
        #expect(rig.sink.queue.count <= 3)
        #expect(rig.bridge.invariantHolds, "\(c)")
        print("slow-decoder flood: \(c)")
    }

    @Test func aSlowExtensionCostsOldFramesNeverLatencyOrMemory() throws {
        // Nobody consumes the sink queue (the extension stalls); the bridge keeps the newest three.
        let rig = try Rig(width: 640, height: 360)
        try rig.consumerArrives()
        rig.control(.sessionLive(LIVE, generation: 1))
        try rig.send(keyframe: true)
        for _ in 0..<19 { try rig.send(); rig.bridge.drain() }
        let c = rig.bridge.countsSnapshot()
        #expect(c["sinkEnqueued"] == 20 && rig.sink.queue.count == 3 && c["supersededSink"] == 17)
        // What is left is the newest three, in order.
        let seqs = (0..<3).compactMap { _ in rig.sink.queue.dequeue() }.map { CMSampleBufferGetPresentationTimeStamp($0) }
        #expect(seqs.count == 3 && seqs[0] < seqs[1] && seqs[1] < seqs[2])
    }
}

/// The real CoreMediaIO sink port and consumer watcher, on this Mac, where no extension is
/// activated. The positive control is that the same enumeration lists the Mac's own camera.
@Suite struct OnThisMac {
    @Test func theRealSinkPortReportsTheDeviceNotInstalledFromARealEnumeration() {
        let devices = CMIOSinkPort.devices()
        print("CoreMediaIO devices on this Mac: \(devices.map { "\($0.name) [\($0.uid)]" })")
        #expect(!devices.isEmpty, "the enumeration returned nothing — no reading")
        #expect(!devices.contains { $0.name == SidekickCameraIdentity.deviceName })
        let port = CMIOSinkPort()
        #expect(port.start() == .deviceNotInstalled)
        #expect(!port.enqueue(try! SampleBuffers.make(try! TestPatterns.flat(width: 1280, height: 720, y: 1), pts: .zero)))
    }

    @Test func theConsumerWatcherFindsNoDeviceAndReportsZero() {
        var seen: [Int] = []
        let w = ConsumerWatcher { seen.append($0) }
        w.start()
        #expect(!w.deviceFound && seen == [0])
        w.stop()
    }
}
