import Foundation
import Testing
import WebcamBridge
import WebcamCore
import WebcamMedia
@testable import WebcamProbe
import WebcamTestSupport

// Defect 177, option A: a session's composers are made at `session-live`, on their own queue, so they
// overlap the first IDR's decode. Through the real BridgeCore with the probe's decoder and sink and real
// H.264; composers come from `GatedComposers`, which makes REAL composers and can hold, fail or charge a
// chosen call. Nothing here measures this Mac's speed — the release comparison does that, and says so.

/// Makes real composers through `BridgeCore.preparedComposer`, with one chosen call held, chosen calls
/// failed, and a weak reference to everything it made — so "released" is an observation, not a hope.
final class GatedComposers: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    private var holdAt: Int?
    private var made: [(format: PublishedFormat, ref: Weak)] = []
    final class Weak { weak var c: FrameComposer?; init(_ c: FrameComposer) { self.c = c } }
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    var failAt: Set<Int> = []
    var costUs: [Int: UInt64] = [:]
    var clock: ManualClock?

    func hold(call: Int) { lock.lock(); holdAt = call; lock.unlock() }
    var calls: Int { lock.lock(); defer { lock.unlock() }; return n }
    /// Composers made and still alive.
    var alive: Int { lock.lock(); defer { lock.unlock() }; return made.filter { $0.ref.c != nil }.count }
    func composed(_ format: PublishedFormat) -> Int {
        lock.lock(); defer { lock.unlock() }
        return made.filter { $0.format == format }.compactMap { $0.ref.c?.composed }.reduce(0, +)
    }

    func make(_ format: PublishedFormat) throws -> FrameComposer {
        lock.lock(); let i = n; n += 1; let held = holdAt == i; lock.unlock()
        if held { entered.signal(); release.wait() }
        clock?.advance(us: costUs[i] ?? 0)
        if failAt.contains(i) { throw ComposeError.pool(-1) }
        let c = try BridgeCore.preparedComposer(format)
        lock.lock(); made.append((format, Weak(c))); lock.unlock()
        return c
    }
}

private let W = 640, H = 360
private let OTHER = SessionID(hex: "ffeeddccbbaa99887766554433221100")!

private func aus(_ count: Int = 10, width: Int = W, height: Int = H, idrAt: Set<Int> = [0]) throws -> [Data] {
    try stream(width: width, height: height, count: count, idrAt: idrAt).map(\.annexB)
}

private func rig(_ comps: GatedComposers, decoder: FrameDecoding = H264Decoder(), clock: ManualClock? = nil) -> ProbeRig {
    ProbeRig(inner: decoder, clock: clock?.read, makeComposer: comps.make)
}

/// A bounded wait for a gate a test holds: 10 s, then an issue rather than a hung run.
func waitFor(_ sem: DispatchSemaphore, _ what: String) {
    if sem.wait(timeout: .now() + 10) == .timedOut { Issue.record("never reached: \(what)") }
}

/// A bounded poll on a state the bridge reports, never on elapsed time: it fails if the state is not
/// reached within 10 s, which is the instrument giving up, not a timing claim about the bridge.
func until(_ what: String, _ cond: () -> Bool) {
    let deadline = Date().addingTimeInterval(10)
    while !cond() { if Date() > deadline { Issue.record("never reached: \(what)"); return }; usleep(1_000) }
}

@Suite(.serialized) struct Preparation {
    @Test func bothComposersAreMadeAtSessionLiveBeforeAnyAccessUnitAndTheFramesUseThem() throws {
        let comps = GatedComposers()
        let r = rig(comps)
        r.live()
        r.core.drain()
        #expect(comps.calls == 2 && comps.alive == 2, "both published formats, made before any AU")
        #expect(r.core.diagnostics.preparations == 1 && r.core.diagnostics.preparationsFailed == 0)
        for a in try aus() { r.feed(a, width: W, height: H) }
        #expect(comps.calls == 2, "no composer was made on the frame path")
        #expect(comps.composed(.hd) == 10 && comps.composed(.fullHD) == 0, "640×360 composes into the 720p class")
        #expect(r.c["sinkEnqueued"] == 10 && r.core.invariantHolds)
    }

    @Test func theFirstIDRDecodesWhileThePreparationIsStillRunning() throws {
        // The field's startup is a burst: main flushes the AUs it held before `running` right after
        // `session-live`. So preparation must overlap the first decode, not precede it on one queue.
        let comps = GatedComposers(), dec = GatedDecoder()
        comps.hold(call: 0)
        dec.hold(call: 0)
        let r = rig(comps, decoder: dec)
        r.live()
        waitFor(comps.entered, "the preparation started")                                     // preparation is running, and held
        let f = try aus()
        r.feed(f[0], width: W, height: H, drain: false)
        waitFor(dec.entered, "the IDR inside the decoder while its preparation is held")                                       // ...and the IDR is inside the decoder
        dec.release.signal()
        until("the decoded IDR waiting on its preparation") { r.core.isWaitingOnPreparation }
        #expect(r.c["sinkEnqueued"] == 0, "nothing is composed before its composers exist")
        comps.release.signal()
        r.core.drain()
        #expect(r.c["sinkEnqueued"] == 1 && comps.calls == 2 && r.core.invariantHolds)
    }

    @Test func preparationTimeIsReportedApartFromTheFirstFramesDecodeAndCompose() throws {
        let clock = ManualClock(), comps = GatedComposers(), dec = GatedDecoder()
        comps.clock = clock; dec.clock = clock
        comps.costUs = [0: 30_000]
        dec.costUs = [0: 50_000]
        clock.set(us: 0)
        let r = rig(comps, decoder: dec, clock: clock)
        r.live()
        r.core.drain()
        r.feed(try aus()[0], width: W, height: H)
        let d = r.core.diagnostics
        #expect(d.preparationMaxUs == 30_000, "the preparation, timed on its own")
        #expect(d.decode.firstUs == 50_000 && d.compose.firstUs == 0, "the first frame's own work, without the preparation")
        #expect(d.firstFrameSinceLiveUs == 80_000 && d.preparationWaitMaxUs == 0)
    }

    @Test func aFrameThatWaitsForItsPreparationHasTheWaitTimed() throws {
        let clock = ManualClock(), comps = GatedComposers()
        clock.set(us: 0)
        comps.hold(call: 0)
        let r = rig(comps, clock: clock)
        r.live()
        waitFor(comps.entered, "the preparation started")
        r.feed(try aus()[0], width: W, height: H, drain: false)
        until("the decoded IDR waiting on its preparation") { r.core.isWaitingOnPreparation }
        clock.advance(us: 40_000)
        comps.release.signal()
        r.core.drain()
        #expect(r.core.diagnostics.preparationWaitMaxUs == 40_000 && r.c["sinkEnqueued"] == 1)
    }

    @Test func aStopDuringPreparationReleasesWhatItMadeAndRevivesNothing() throws {
        let comps = GatedComposers()
        comps.hold(call: 0)
        let r = rig(comps)
        r.live()
        waitFor(comps.entered, "the preparation started")
        _ = r.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        comps.release.signal()
        r.core.drain()
        let d = r.core.diagnostics
        #expect(d.preparationsDiscarded == 1 && d.preparations == 0)
        #expect(comps.alive == 0, "the composers made after the Stop were released where they were made")
        // Nothing came back: the session is still ended and its AUs are refused unread.
        for a in try aus(3) { r.feed(a, width: W, height: H) }
        #expect(r.c["gate.endedSession"] == 3 && r.c["sinkEnqueued"] == 0)
        #expect(r.statuses.filter { $0 == .sink(.feeding) }.count == 1, "the sink was started once, for the live session")
        #expect(r.core.gateSnapshot.live == nil && r.core.invariantHolds)
    }

    @Test func aPreparationWhoseSessionEndedBeforeItBeganMakesNothing() throws {
        // A's preparation is held; A is replaced by B, and B is stopped, before either is released. B's
        // preparation then begins with its session already gone: it makes nothing at all.
        let comps = GatedComposers()
        comps.hold(call: 0)
        let r = rig(comps)
        r.live()
        waitFor(comps.entered, "the preparation started")
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        _ = r.core.control(.sessionEnded(OTHER, reason: "stopped-by-mac"))
        comps.release.signal()
        r.core.drain()
        #expect(comps.calls == 2, "A's two calls only; B's preparation made nothing: \(comps.calls)")
        #expect(r.core.diagnostics.preparationsDiscarded == 2 && comps.alive == 0)
    }

    @Test func aStopWhileAFrameWaitsForItsPreparationDiscardsTheFrameAndMakesNothingForIt() throws {
        let comps = GatedComposers()
        comps.hold(call: 0)
        let r = rig(comps)
        r.live()
        waitFor(comps.entered, "the preparation started")
        r.feed(try aus()[0], width: W, height: H, drain: false)
        until("the decoded IDR waiting on its preparation") { r.core.isWaitingOnPreparation }
        _ = r.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        comps.release.signal()
        r.core.drain()
        let d = r.core.diagnostics
        #expect(r.c["sinkEnqueued"] == 0 && r.c["discardedEnded"] == 1 && d.discardedAfterDecode == 1)
        #expect(comps.calls == 2 && comps.alive == 0, "no composer was made on the frame path for an ended session")
        #expect(r.core.invariantHolds)
    }

    @Test func aReplacementGetsItsOwnPreparationAtItsOwnSizeAndTheOldOneIsReleased() throws {
        let comps = GatedComposers()
        let r = rig(comps)
        r.phone.rotation = 1
        r.live()
        for a in try aus(6, width: 1920, height: 1080) { r.feed(a, width: 1920, height: 1080) }
        #expect(comps.composed(.fullHD) == 6)
        _ = r.core.control(.sessionLive(OTHER, generation: 1))
        r.core.drain()
        #expect(comps.calls == 4 && comps.alive == 2, "A's composers released, B's two made")
        r.phone.rotation = 0
        for a in try aus(6, width: 1280, height: 720) { r.feed(a, width: 1280, height: 720, session: OTHER) }
        #expect(comps.composed(.hd) == 6 && comps.calls == 4)
        #expect(r.c["sinkEnqueued"] == 12 && r.core.diagnostics.preparations == 2 && r.core.invariantHolds)
    }

    @Test func aFailedPreparationFallsBackToMakingTheComposerOnTheFramePath() throws {
        let comps = GatedComposers()
        comps.failAt = [0]                                       // the 1080p composer
        let r = rig(comps)
        r.live()
        r.core.drain()
        #expect(r.core.diagnostics.preparationsFailed == 1 && comps.alive == 1)
        for a in try aus(4, width: 1920, height: 1080) { r.feed(a, width: 1920, height: 1080) }
        #expect(comps.calls == 3 && comps.composed(.fullHD) == 4, "made once, on the first frame, and kept")
        #expect(r.c["sinkEnqueued"] == 4 && r.core.invariantHolds)
        _ = r.core.control(.sessionEnded(SESSION, reason: "stopped-by-mac"))
        r.core.drain()
        #expect(comps.alive == 0, "the frame path's composer belongs to the session too, and went with it")
    }
}
