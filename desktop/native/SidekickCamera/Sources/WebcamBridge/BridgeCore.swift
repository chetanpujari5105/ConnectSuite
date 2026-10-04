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
        }
        return try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    }

    public var record: BridgeRecord { BridgeRecord(type: .status, body: json) }
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
    private var waiting: [(au: WebcamAU, session: SessionID)] = []
    private var decoding = false
    public private(set) var maxWaiting = 0
    private var composers: [PublishedFormat: FrameComposer] = [:]

    // Counters past the gate. The gate keeps its own (received, accepted, dropped by cause).
    private var droppedDecodeQueue = 0
    private var decodeErrors = 0
    private var composeErrors = 0
    private var discardedEnded = 0
    private var sinkEnqueued = 0
    private var sinkUnavailable = 0
    private var upscaled = 0

    public init(sink: SinkPort, decoder: FrameDecoding = H264Decoder(), decodeCapacity: Int = 4,
                emit: @escaping (BridgeStatus) -> Void) {
        self.sink = sink
        self.decoder = decoder
        self.decodeCapacity = decodeCapacity
        self.emit = emit
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
        let admission = withGate { $0.admit(session: session, frame: frame) }
        if case let .reject(_, effects) = admission {
            // The live session's stream broke the contract: its sink is stopped and the picture
            // cleared first, then main is told. No retry — the session is buried.
            apply(effects)
            return
        }
        guard case let .accept(au) = admission else { return }

        lock.lock()
        if waiting.count >= decodeCapacity {
            if au.isKeyframeWithConfig {
                // Everything waiting predates this IDR and is useless now: drop it, keep the IDR.
                droppedDecodeQueue += waiting.count
                waiting.removeAll()
            } else {
                droppedDecodeQueue += 1
                lock.unlock()
                withGate { $0.noteDownstreamDrop() }
                return
            }
        }
        waiting.append((au, session))
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
            let (au, session) = waiting.removeFirst()
            lock.unlock()
            decodeAndFeed(au, session: session)
        }
    }

    private func decodeAndFeed(_ au: WebcamAU, session: SessionID) {
        guard isLive(session) else { count(\.discardedEnded); return }

        let decoded: CVPixelBuffer
        do { decoded = try decoder.decode(annexB: au.annexB, ptsMicros: au.frame.pts) } catch {
            count(\.decodeErrors)
            withGate { $0.noteDownstreamDrop() }
            return
        }
        let w = Int(au.header.width), h = Int(au.header.height)
        let format: PublishedFormat = max(w, h) >= 1920 ? .fullHD : .hd
        let composed: CVPixelBuffer
        do {
            let composer = try composer(for: format)
            composed = try composer.compose(decoded, quarterTurns: au.header.rotation)
            if composer.upscaled > 0 { lock.lock(); upscaled = composers.values.map(\.upscaled).reduce(0, +); lock.unlock() }
        } catch {
            count(\.composeErrors)
            withGate { $0.noteDownstreamDrop() }
            return
        }
        guard let sb = try? SampleBuffers.make(composed, pts: CMTime(value: Int64(DispatchTime.now().uptimeNanoseconds),
                                                                     timescale: 1_000_000_000)) else {
            count(\.composeErrors)
            return
        }
        SampleBuffers.tag(sb, session: session, generation: au.header.generation)
        // The door: a session can end while its frame was decoding. Checked again here, last.
        guard isLive(session) else { count(\.discardedEnded); return }
        if sink.enqueue(sb) { count(\.sinkEnqueued) } else { count(\.sinkUnavailable) }
    }

    private func composer(for format: PublishedFormat) throws -> FrameComposer {
        lock.lock(); defer { lock.unlock() }
        if let c = composers[format] { return c }
        let c = try FrameComposer(output: format)
        composers[format] = c
        return c
    }

    // MARK: Effects

    private func apply(_ effects: [SessionGate.Effect]) {
        for e in effects {
            switch e {
            case .startSink:
                emit(.sink(sink.start()))
            case .stopSink:
                // Never deferred: flush and stop first, then forget the decoder's references.
                sink.stopAndFlush()
                decodeQueue.async { [decoder] in decoder.invalidate() }
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

    private func count(_ key: ReferenceWritableKeyPath<BridgeCore, Int>) {
        lock.lock(); self[keyPath: key] += 1; lock.unlock()
    }

    /// Waits until the decode stage is empty.
    public func drain() { decodeQueue.sync {} }

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
