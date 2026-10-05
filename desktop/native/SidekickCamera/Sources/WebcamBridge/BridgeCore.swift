import CoreMedia
import CoreVideo
import Foundation
import WebcamCore
import WebcamMedia

public protocol FrameDecoding: AnyObject {
    func decode(annexB: Data, ptsMicros: UInt64) throws -> CVPixelBuffer
    func invalidate()
}

extension H264Decoder: FrameDecoding {}

/// What the bridge tells Electron main (record type 0x81).
public enum BridgeStatus: Equatable {
    /// Once, first, at startup: whether CoreMediaIO lists Sidekick Camera, and whether this build
    /// carries a Team ID for the producer requirement. Main sends no `webcam.request` unless both
    /// are true. The second is the compiled constant, not the extension's verdict.
    case ready(deviceInstalled: Bool, producerIdentityConfigured: Bool)
    case consumers(Int)
    case sessionEnded(SessionID, reason: String)
    /// The live session's stream broke the access-unit contract; the bridge has already ended it.
    /// Bound to that session's id, sent at most once for it. `generation` 0: not readable.
    case streamRejected(SessionID, generation: UInt16, fault: StreamFault)
    case sink(SinkState)
    case counts([String: Int])
    case error(String)
    /// The live session's decode chain just broke: the gate refuses every non-IDR until an IDR with SPS
    /// and PPS. Once per break, on the change from decoding to waiting (docs/protocol.md → the local
    /// contract, version 2). Main may answer it with `webcam.keyframe`.
    case chainBroken(SessionID, generation: UInt16, cause: ChainBreakCause)
    /// The first frame admitted after that break reached the sink. Once per `chainBroken`.
    case chainRecovered(SessionID, generation: UInt16)

    public var json: Data {
        let obj: [String: Any]
        switch self {
        case let .ready(device, producer):
            obj = ["op": "ready", "device": device ? "installed" : "not-installed",
                   "producerIdentity": producer ? "configured" : "unconfigured"]
        case let .consumers(n): obj = ["op": "consumers", "count": n]
        case let .sessionEnded(id, r): obj = ["op": "session-ended", "sessionId": id.hex, "reason": r]
        case let .streamRejected(id, g, f):
            obj = ["op": "stream-rejected", "sessionId": id.hex, "generation": Int(g), "violation": f.rawValue]
        case let .sink(s): obj = ["op": "sink", "state": s.rawValue]
        case let .counts(c): obj = ["op": "counts", "counts": c]
        case let .error(e): obj = ["op": "error", "error": e]
        case let .chainBroken(id, g, c):
            obj = ["op": "chain-broken", "sessionId": id.hex, "generation": Int(g), "cause": c.rawValue]
        case let .chainRecovered(id, g):
            obj = ["op": "chain-recovered", "sessionId": id.hex, "generation": Int(g)]
        }
        return try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    }

    public var record: BridgeRecord { BridgeRecord(type: .status, body: json) }
}

/// Why the chain broke, as `chain-broken` carries it. A closed set, held to the shared vocabulary fixture.
public enum ChainBreakCause: String, CaseIterable, Sendable {
    case queueFull = "queue-full", decodeFailed = "decode-failed", composeFailed = "compose-failed"
}

/// The bridge's pipeline (docs/protocol.md → Electron main ↔ the bridge, and Bounded buffering):
///
///     record → SessionGate → decode stage (≤ 4 AUs, in order) → FrameComposer → SinkPort (≤ 3, latest wins)
///
/// - **Main is the only source of liveness.** AUs are admitted only for the session main announced.
/// - **Nothing is superseded before decode.** Skipping an AU breaks H.264's reference chain, so a full
///   decode stage drops non-IDR AUs and the gate then waits for the next IDR with SPS and PPS.
/// - **No frame of an ended session reaches the sink.** A frame that finishes decoding after its
///   session ended is discarded at the sink's door and counted.
/// - **Every AU admitted is accounted for exactly once** (`invariantHolds`).
public final class BridgeCore {
    public let decodeCapacity: Int
    private let sink: SinkPort
    private let decoder: FrameDecoding
    private let emit: (BridgeStatus) -> Void
    private let decodeQueue = DispatchQueue(label: "sidekick.camera.bridge.decode")
    private let lock = NSLock()

    private var gate = SessionGate()
    /// AUs admitted and not yet decoding — at most `decodeCapacity`. Owned here rather than left in
    /// a dispatch queue, because a dispatched item cannot be withdrawn: an earlier version flagged
    /// superseded items stale and let them run out, and the stage grew by one per IDR during a
    /// backlog (11 against a bound of 4, caught by `aSlowDecoderIsBoundedAndEveryAUIsAccountedFor`).
    private var waiting: [Waiting] = []
    private struct Waiting { let au: WebcamAU; let session: SessionID; let ordinal: Int; let admittedNs: UInt64 }
    private var decoding = false
    public private(set) var maxWaiting = 0

    /// What one session needs before its first frame — both published formats' composers, each with its
    /// rotation session — made when main says the session is live, on its own queue, so it overlaps the
    /// first IDR's decode instead of following it (defect 177, option A). The decoder is not here: it
    /// cannot exist before the stream's SPS and PPS, and nothing stands in for them.
    ///
    /// Owned by its session. A Stop or a replacement detaches it; a preparation that completes after
    /// that is released where it finished, never installed, so nothing it made outlives its session or
    /// can be used by another. Identity is the ownership token: only the object `preparation` still
    /// points at may install anything.
    private final class Preparation {
        let session: SessionID
        let done = DispatchGroup()
        /// Written by the prepare queue before `done` is left; after that, only by the decode queue.
        var composers: [PublishedFormat: FrameComposer] = [:]
        init(session: SessionID) { self.session = session; done.enter() }
    }
    /// The live session's preparation, or nil. Guarded by `lock`.
    private var preparation: Preparation?
    /// True while the decode stage is blocked on its session's preparation. Guarded by `lock`.
    private var waitingOnPreparation = false
    private let prepareQueue = DispatchQueue(label: "sidekick.camera.bridge.prepare")
    /// The session whose stream the decoder's reference state belongs to. Decode queue only.
    private var decoderOwner: SessionID?
    /// The break `chain-broken` was sent for and not yet recovered: its session, generation, and the gate's
    /// running count when it broke — a frame admitted after it reaching the sink is the recovery. Guarded
    /// by `lock`. An ended session's entry needs no clearing: recovery also requires the session to be the
    /// live one, and an ended session is tombstoned and never live again.
    private var signalledBreak: (session: SessionID, generation: UInt16, afterOrdinal: Int)?
    private let makeComposer: (PublishedFormat) throws -> FrameComposer

    // Counters past the gate. The gate keeps its own (received, accepted, dropped by cause).
    private var droppedDecodeQueue = 0
    private var decodeErrors = 0
    private var composeErrors = 0
    private var discardedEnded = 0
    private var sinkEnqueued = 0
    private var sinkUnavailable = 0
    private var upscaled = 0
    /// Timing and recovery readings, metadata only (defect 177). Guarded by `lock`.
    private var diag = PipelineDiagnostics()
    /// Monotonic nanoseconds. Injected so tests drive time explicitly instead of sleeping.
    private let clock: () -> UInt64

    public init(sink: SinkPort, decoder: FrameDecoding = H264Decoder(), decodeCapacity: Int = 4,
                clock: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
                makeComposer: @escaping (PublishedFormat) throws -> FrameComposer = BridgeCore.preparedComposer,
                emit: @escaping (BridgeStatus) -> Void) {
        self.sink = sink
        self.decoder = decoder
        self.decodeCapacity = decodeCapacity
        self.clock = clock
        self.makeComposer = makeComposer
        self.emit = emit
    }

    /// A composer with everything it can make before a frame exists: its pixel-buffer pool, its
    /// transfer session and its rotation session.
    public static func preparedComposer(_ format: PublishedFormat) throws -> FrameComposer {
        let c = try FrameComposer(output: format)
        try c.prepareRotation()
        return c
    }

    public enum Outcome: Equatable { case `continue`, shutdown, malformed(String) }

    // MARK: Inputs

    public func handle(_ record: BridgeRecord) -> Outcome {
        switch record.type {
        case .control:
            let message: ControlMessage
            do { message = try ControlCodec.decode(record.body) } catch {
                return .malformed("control record: \(error)")
            }
            return control(message)
        case .accessUnit:
            guard let (id, frame) = ControlCodec.splitAccessUnitBody(record.body) else {
                return .malformed("access-unit record without a 16-byte session id")
            }
            accessUnit(session: id, frame: frame)
            return .continue
        case .status:
            return .malformed("a status record travels bridge → main only")
        }
    }

    public func control(_ message: ControlMessage) -> Outcome {
        switch message {
        case let .sessionLive(id, g):
            let now = clock()
            withDiag { $0.sessionLive(nowNs: now) }
            apply(withGate { $0.sessionLive(id, generation: g) })
            return .continue
        case let .sessionEnded(id, r):
            apply(withGate { $0.sessionEnded(id, reason: r) })
            return .continue
        case .shutdown:
            if let id = withGate({ $0.live }) { apply(withGate { $0.sessionEnded(id, reason: "shutdown") }) }
            return .shutdown
        }
    }

    /// The extension's consumer count changed. Reaching zero ends a live session here and now —
    /// rule 6 — and main is told, so it sends `webcam.stop` `no-consumers`.
    public func consumersChanged(_ count: Int) {
        emit(.consumers(count))
        apply(withGate { $0.consumersChanged(count) })
    }

    public func accessUnit(session: SessionID, frame: Data) {
        let now = clock()
        // The gate's running count is this AU's ordinal: every AU admitted later has a larger one.
        let (admission, ordinal) = withGate { g -> (SessionGate.Admission, Int) in
            let a = g.admit(session: session, frame: frame)
            diag.arrived(nowNs: now)
            return (a, g.received)
        }
        if case let .reject(_, effects) = admission {
            // The live session's stream broke the contract: its sink is stopped and the picture
            // cleared first, then main is told. No retry — the session is buried.
            apply(effects)
            return
        }
        guard case let .accept(au) = admission else { return }

        lock.lock()
        let gopIndex = diag.accepted(isKeyframe: au.isKeyframeWithConfig)
        if waiting.count >= decodeCapacity {
            if au.isKeyframeWithConfig {
                // Everything waiting predates this IDR and is useless now: drop it, keep the IDR.
                droppedDecodeQueue += waiting.count
                diag.idrFlushed(waiting.count)
                waiting.removeAll()
            } else {
                droppedDecodeQueue += 1
                diag.overflowed(nowNs: now, atReceived: ordinal, gopIndex: gopIndex)
                lock.unlock()
                breakChain(.queueFull, session: session, nowNs: now)
                return
            }
        }
        waiting.append(Waiting(au: au, session: session, ordinal: ordinal, admittedNs: now))
        maxWaiting = max(maxWaiting, waiting.count)
        let start = !decoding
        if start { decoding = true }
        lock.unlock()
        if start { decodeQueue.async { [self] in self.runDecodeLoop() } }
    }

    // MARK: The decode stage

    /// Decodes everything waiting, in order, then goes idle.
    private func runDecodeLoop() {
        while true {
            lock.lock()
            guard !waiting.isEmpty else { decoding = false; lock.unlock(); return }
            let next = waiting.removeFirst()
            lock.unlock()
            decodeAndFeed(next)
            withDiag { $0.frameDone() }
        }
    }

    private func decodeAndFeed(_ w: Waiting) {
        let au = w.au, session = w.session
        guard isLive(session) else { count(\.discardedEnded); withDiag { $0.discardedBeforeDecoding() }; return }

        // One session's references at a time: a different session's first AU starts from nothing.
        if decoderOwner != session {
            if decoderOwner != nil { decoder.invalidate() }
            decoderOwner = session
        }
        let decodeStart = clock()
        withDiag { $0.decodeStarted(nowNs: decodeStart, admittedNs: w.admittedNs) }
        let decoded: CVPixelBuffer
        do { decoded = try decoder.decode(annexB: au.annexB, ptsMicros: au.frame.pts) } catch {
            let now = clock()
            withDiag { $0.decodeFinished(startNs: decodeStart, nowNs: now, ordinal: w.ordinal, isKeyframe: au.isKeyframeWithConfig, ok: false) }
            count(\.decodeErrors)
            decodeFailed(w, nowNs: now)
            return
        }
        let composeStart = clock()
        withDiag { $0.decodeFinished(startNs: decodeStart, nowNs: composeStart, ordinal: w.ordinal, isKeyframe: au.isKeyframeWithConfig, ok: true) }
        let w0 = Int(au.header.width), h0 = Int(au.header.height)
        let format: PublishedFormat = max(w0, h0) >= 1920 ? .fullHD : .hd
        let composed: CVPixelBuffer
        do {
            guard let composer = try composer(for: format, session: session) else {
                // The session ended while this frame decoded: discarded, and nothing is made for it.
                let now = clock()
                count(\.discardedEnded)
                withDiag { $0.discardedAfterDecoding(nowNs: now) }
                return
            }
            let before = composer.upscaled
            composed = try composer.compose(decoded, quarterTurns: au.header.rotation)
            if composer.upscaled > before { count(\.upscaled) }
        } catch {
            let now = clock()
            withDiag { $0.composeFinished(decodeStartNs: decodeStart, startNs: composeStart, nowNs: now, ok: false) }
            count(\.composeErrors)
            breakChain(.composeFailed, session: session, nowNs: now)
            return
        }
        guard let sb = try? SampleBuffers.make(composed, pts: CMTime(value: Int64(DispatchTime.now().uptimeNanoseconds),
                                                                     timescale: 1_000_000_000)) else {
            let now = clock()
            withDiag { $0.composeFinished(decodeStartNs: decodeStart, startNs: composeStart, nowNs: now, ok: false) }
            count(\.composeErrors)
            return
        }
        let composeEnd = clock()
        withDiag { $0.composeFinished(decodeStartNs: decodeStart, startNs: composeStart, nowNs: composeEnd, ok: true) }
        SampleBuffers.tag(sb, session: session, generation: au.header.generation)
        // The door: a session can end while its frame was decoding. Checked again here, last.
        guard isLive(session) else { count(\.discardedEnded); withDiag { $0.discardedAfterDecoding(nowNs: composeEnd) }; return }
        if sink.enqueue(sb) {
            count(\.sinkEnqueued)
            let recovered: BridgeStatus? = withGate { g in
                diag.enqueued(ordinal: w.ordinal, nowNs: composeEnd, refusedSoFar: g.dropped[.awaitingKeyframe] ?? 0)
                // The signalled break is over once a frame admitted after it reaches the sink — the gate
                // admits nothing after a break but an IDR with SPS and PPS, so that frame is the IDR's chain.
                guard let b = signalledBreak, b.session == session, g.live == session, w.ordinal > b.afterOrdinal else { return nil }
                signalledBreak = nil
                return .chainRecovered(session, generation: au.header.generation)
            }
            if let recovered { emit(recovered) }
        } else {
            count(\.sinkUnavailable)
        }
    }

    /// The decode chain broke: the gate refuses everything until an IDR with SPS and PPS, and the gap
    /// in the picture is timed from here. Only the live session's chain: a break in an ended session's
    /// frame is no fact about its replacement.
    private func breakChain(_ kind: PipelineDiagnostics.Break, session: SessionID, nowNs: UInt64) {
        let signal: BridgeStatus? = withGate { g in
            guard g.live == session else { diag.staleFailure(); return nil }
            let wasWaiting = g.needsKeyframe
            g.noteDownstreamDrop()
            diag.broke(kind, nowNs: nowNs, receivedSoFar: g.received, refusedSoFar: g.dropped[.awaitingKeyframe] ?? 0)
            return wasWaiting ? nil : signalBreak(session, kind, generation: g.highestGeneration, received: g.received)
        }
        if let signal { emit(signal) }
    }

    /// Records the break `chain-broken` is about to report. Called under `lock`, on the change from
    /// decoding to waiting only — so a second break while still waiting reports nothing.
    private func signalBreak(_ session: SessionID, _ kind: PipelineDiagnostics.Break, generation: UInt16, received: Int) -> BridgeStatus {
        let cause: ChainBreakCause
        switch kind {
        case .queueFull: cause = .queueFull
        case .decodeFailed: cause = .decodeFailed
        case .composeFailed: cause = .composeFailed
        }
        signalledBreak = (session, generation, received)
        return .chainBroken(session, generation: generation, cause: cause)
    }

    /// A decode failed (docs/protocol.md → a decode failure is a Mac-side drop). Recoverable, never the
    /// contract's fatal path. On the decode queue, before anything else is decoded:
    ///
    /// - the decoder forgets its references, so nothing can be produced from the broken chain;
    /// - every AU of the session waiting before the first IDR with SPS and PPS of the CURRENT generation
    ///   depends on the failed picture (or on a superseded generation) and is dropped undecoded;
    /// - such an IDR, and everything behind it, is a valid chain and is kept; with none, the gate
    ///   refuses every non-IDR until one arrives.
    ///
    /// All under one lock, so an IDR arriving concurrently is either already waiting (and kept) or
    /// admitted afterwards by the gate (and accepted): there is no moment between the two.
    private func decodeFailed(_ w: Waiting, nowNs: UInt64) {
        decoder.invalidate()
        decoderOwner = nil
        var signal: BridgeStatus?
        defer { if let signal { emit(signal) } }
        lock.lock(); defer { lock.unlock() }
        diag.decoderReset()
        guard gate.live == w.session else { diag.staleFailure(); return }
        let current = gate.highestGeneration
        let recovery = waiting.firstIndex {
            $0.session == w.session && $0.au.isKeyframeWithConfig && $0.au.header.generation == current
        }
        let recoveryOrdinal = recovery.map { waiting[$0].ordinal }
        let cut = recovery ?? waiting.count
        var kept: [Waiting] = []
        var flushed = 0
        for (i, x) in waiting.enumerated() {
            if i < cut && x.session == w.session { flushed += 1 } else { kept.append(x) }
        }
        waiting = kept
        droppedDecodeQueue += flushed
        if recovery == nil {
            let wasWaiting = gate.needsKeyframe
            gate.noteDownstreamDrop()
            if !wasWaiting { signal = signalBreak(w.session, .decodeFailed, generation: gate.highestGeneration, received: gate.received) }
        }
        diag.flushedAfterDecodeFailure(flushed, keptRecovery: recovery != nil)
        diag.broke(.decodeFailed, nowNs: nowNs, receivedSoFar: gate.received,
                   refusedSoFar: gate.dropped[.awaitingKeyframe] ?? 0, recoveryFromOrdinal: recoveryOrdinal)
    }

    // MARK: Preparation

    /// Starts preparing `session`'s composers on the prepare queue and returns at once.
    private func prepare(for session: SessionID) {
        let p = Preparation(session: session)
        lock.lock(); preparation = p; lock.unlock()
        prepareQueue.async { [self] in
            let start = clock()
            var made: [PublishedFormat: FrameComposer] = [:]
            var failed = false
            // A Stop or a replacement before this began: nothing is made at all.
            if isCurrent(p) {
                for format in PublishedFormat.all {
                    do { made[format] = try makeComposer(format) } catch { failed = true }
                }
            }
            let us = Int((clock() &- start) / 1_000)
            lock.lock()
            if preparation === p {
                p.composers = made
                diag.prepared(us: us, failed: failed)
            } else {
                diag.preparationDiscarded()
            }
            lock.unlock()
            // When discarded, `made` holds the only references, and they end with this block.
            p.done.leave()
        }
    }

    private func isCurrent(_ p: Preparation) -> Bool { lock.lock(); defer { lock.unlock() }; return preparation === p }

    /// The composer for a frame of `session`, from that session's preparation — waited for if it is
    /// still running, made here only if preparing it failed. Nil when the session is no longer the live
    /// one: nothing is made for a session that ended.
    private func composer(for format: PublishedFormat, session: SessionID) throws -> FrameComposer? {
        lock.lock()
        let p = preparation
        lock.unlock()
        guard let p, p.session == session else { return nil }
        if p.done.wait(timeout: .now()) == .timedOut {
            lock.lock(); waitingOnPreparation = true; lock.unlock()
            let t0 = clock()
            p.done.wait()
            let t1 = clock()
            lock.lock(); waitingOnPreparation = false; diag.waitedForPreparation(us: Int((t1 &- t0) / 1_000)); lock.unlock()
        }
        guard isCurrent(p) else { return nil }
        if let c = p.composers[format] { return c }
        let c = try makeComposer(format)
        p.composers[format] = c
        return c
    }

    /// Whether the decode stage is blocked on its session's preparation right now.
    public var isWaitingOnPreparation: Bool { lock.lock(); defer { lock.unlock() }; return waitingOnPreparation }

    // MARK: Effects

    private func apply(_ effects: [SessionGate.Effect]) {
        for e in effects {
            switch e {
            case let .startSink(id):
                // First, so the composers are being made while the sink starts and the first AUs arrive.
                prepare(for: id)
                emit(.sink(sink.start()))
            case let .stopSink(id, _):
                let now = clock()
                withDiag { $0.sessionEnded(nowNs: now) }
                // Detached now: a preparation still running for it will be released, not installed, and
                // a frame still decoding for it finds no composer.
                lock.lock()
                if preparation?.session == id { preparation = nil }
                lock.unlock()
                // Never deferred: flush and stop first, then forget the decoder's references.
                sink.stopAndFlush()
                // Queued behind the decode loop, which may already be decoding a replacement: the reset
                // applies only while the stopped session still owns the decoder.
                decodeQueue.async { [self] in
                    if decoderOwner == id { decoder.invalidate(); decoderOwner = nil }
                }
                emit(.sink(.idle))
            case let .reportEnded(id, reason):
                emit(.sessionEnded(id, reason: reason))
            case let .refusedEnded(id):
                emit(.error("session-live for \(id.hex), a session that already ended: refused, nothing restarted"))
            case let .reportRejected(id, g, f):
                emit(.streamRejected(id, generation: g, fault: f))
            }
        }
    }

    // MARK: Accounting

    private func isLive(_ id: SessionID) -> Bool { withGate { $0.live == id } }

    @discardableResult
    private func withGate<T>(_ body: (inout SessionGate) -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body(&gate)
    }

    private func withDiag(_ body: (inout PipelineDiagnostics) -> Void) {
        lock.lock(); body(&diag); lock.unlock()
    }

    /// The pipeline's timing and recovery readings, for tests and the probe's exit line.
    public var diagnostics: PipelineDiagnostics { lock.lock(); defer { lock.unlock() }; return diag }

    private func count(_ key: ReferenceWritableKeyPath<BridgeCore, Int>) {
        lock.lock(); self[keyPath: key] += 1; lock.unlock()
    }

    /// Waits until any preparation has finished and the decode stage is empty.
    public func drain() { prepareQueue.sync {}; decodeQueue.sync {} }

    public var gateSnapshot: SessionGate { withGate { $0 } }

    public func countsSnapshot() -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        var c: [String: Int] = [
            "received": gate.received, "accepted": gate.accepted,
            "droppedDecodeQueue": droppedDecodeQueue, "decodeErrors": decodeErrors,
            "composeErrors": composeErrors, "discardedEnded": discardedEnded,
            "sinkEnqueued": sinkEnqueued, "sinkUnavailable": sinkUnavailable,
            "supersededSink": sink.supersededSink, "upscaled": upscaled,
            "pending": waiting.count + (decoding ? 1 : 0), "maxWaiting": maxWaiting,
        ]
        for d in SessionGate.Drop.allCases { c["gate.\(d.rawValue)"] = gate.dropped[d] ?? 0 }
        c.merge(diag.counts) { a, _ in a }
        return c
    }

    /// Every AU shown to the gate is accepted or dropped with a cause, and every accepted AU ends in
    /// exactly one place. Only meaningful once `drain()` has returned.
    public var invariantHolds: Bool {
        let c = countsSnapshot()
        let gateOK = c["received"]! == c["accepted"]! + SessionGate.Drop.allCases.reduce(0) { $0 + c["gate.\($1.rawValue)"]! }
        let pastGate = c["droppedDecodeQueue"]! + c["decodeErrors"]! + c["composeErrors"]! + c["discardedEnded"]!
            + c["sinkEnqueued"]! + c["sinkUnavailable"]!
        return gateOK && c["pending"]! == 0 && c["accepted"]! == pastGate
    }
}
