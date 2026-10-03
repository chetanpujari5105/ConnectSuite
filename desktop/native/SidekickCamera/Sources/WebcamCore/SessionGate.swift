import Foundation


/// The bridge's admission rules for access units (docs/protocol.md → Electron main ↔ the bridge).
///
/// **Main is the only source of liveness.** The gate never infers a session from AUs; it admits an
/// AU only for the session main announced, and drops everything else with a cause. Every AU it is
/// shown is counted exactly once, as accepted or under one drop cause, so `received` always equals
/// `accepted + dropped` — the denominator rule, enforced by a test rather than by care.
public struct SessionGate: Sendable {
    public enum Drop: String, Sendable, CaseIterable {
        case noLiveSession, endedSession, otherSession, staleGeneration
        case awaitingKeyframe, outOfOrder, malformed
    }

    public enum Admission: Sendable, Equatable {
        case accept(WebcamAU)
        case drop(Drop)
    }

    /// What the bridge must do as a consequence of a control input.
    public enum Effect: Sendable, Equatable {
        /// Start feeding the sink for this session.
        case startSink(SessionID)
        /// Stop the sink, flush its queue and clear the picture. Never deferred.
        case stopSink(SessionID, reason: String)
        /// Report to main that the bridge ended the session itself.
        case reportEnded(SessionID, reason: String)
        /// A `session-live` for a session already ended: refused, and nothing is restarted.
        case refusedEnded(SessionID)
    }

    public private(set) var live: SessionID?
    public private(set) var highestGeneration: UInt16 = 0
    public private(set) var needsKeyframe = true
    public private(set) var tombstones = Tombstones()
    private var validator = StreamValidator()
    private var consumers = 0

    public private(set) var received = 0
    public private(set) var accepted = 0
    public private(set) var dropped: [Drop: Int] = [:]

    public init(consumers: Int = 0) { self.consumers = consumers }

    public var droppedTotal: Int { dropped.values.reduce(0, +) }

    // MARK: Control

    public mutating func sessionLive(_ id: SessionID, generation: UInt16) -> [Effect] {
        if tombstones.contains(id) { return [.refusedEnded(id)] }
        var effects: [Effect] = []
        if let current = live, current != id {
            effects += end(current, reason: "superseded")
        }
        if consumers == 0 {
            // A session announced with nobody watching is ended here rather than fed (rule 6). Main
            // ends it on the wire; the bridge does not wait to be told.
            tombstones.bury(id)
            return effects + [.reportEnded(id, reason: "no-consumers")]
        }
        if live == id {
            adopt(generation)
            return effects
        }
        live = id
        highestGeneration = generation
        needsKeyframe = true
        validator = StreamValidator()
        return effects + [.startSink(id)]
    }

    public mutating func sessionEnded(_ id: SessionID, reason: String) -> [Effect] {
        if live == id { return end(id, reason: reason) }
        tombstones.bury(id)
        return []
    }

    public mutating func consumersChanged(_ count: Int) -> [Effect] {
        consumers = max(0, count)
        guard consumers == 0, let id = live else { return [] }
        return end(id, reason: "no-consumers") + [.reportEnded(id, reason: "no-consumers")]
    }

    /// A drop made after the gate (a full decode queue, a decode error): the next AU admitted must be
    /// an IDR with SPS and PPS, because a decoder that missed a reference cannot show the next frame.
    public mutating func noteDownstreamDrop() { needsKeyframe = true }

    private mutating func end(_ id: SessionID, reason: String) -> [Effect] {
        tombstones.bury(id)
        live = nil
        highestGeneration = 0
        needsKeyframe = true
        return [.stopSink(id, reason: reason)]
    }

    private mutating func adopt(_ generation: UInt16) {
        if generation > highestGeneration {
            highestGeneration = generation
            needsKeyframe = true
        }
    }

    // MARK: Access units

    public mutating func admit(session: SessionID, frame: Data) -> Admission {
        received += 1
        let au: WebcamAU
        do { au = try WebcamAUCodec.parse(frame) } catch { return drop(.malformed) }
        guard let current = live else {
            return drop(tombstones.contains(session) ? .endedSession : .noLiveSession)
        }
        if tombstones.contains(session) { return drop(.endedSession) }
        guard session == current else { return drop(.otherSession) }
        let g = au.header.generation
        if g < highestGeneration { return drop(.staleGeneration) }
        // A higher generation is adopted, not refused: it can only arrive on the session's own
        // claimed socket, and it may outrun the `running` that announces it (two connections).
        if g > highestGeneration {
            highestGeneration = g
            needsKeyframe = true
        }
        if needsKeyframe && !au.isKeyframeWithConfig { return drop(.awaitingKeyframe) }
        switch validator.check(au) {
        case .accept: break
        case .dropOutOfOrderPTS: return drop(.outOfOrder)
        case .malformed: return drop(.malformed)
        }
        needsKeyframe = false
        accepted += 1
        return .accept(au)
    }

    private mutating func drop(_ cause: Drop) -> Admission {
        dropped[cause, default: 0] += 1
        return .drop(cause)
    }
}
