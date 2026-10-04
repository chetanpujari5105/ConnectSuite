import Foundation


/// The bridge's admission rules for access units (docs/protocol.md → Electron main ↔ the bridge).
///
/// **Main is the only source of liveness.** The gate never infers a session from AUs; it admits an
/// AU only for the session main announced, and drops everything else with a cause. Every AU it is
/// shown is counted exactly once, as accepted or under one drop cause, so `received` always equals
/// `accepted + dropped` — the denominator rule, enforced by a test rather than by care.
///
/// **The session is decided before the bytes are read.** An AU tagged with no live session, an ended
/// one or another one is dropped without being parsed, so nothing it contains can end anything — a
/// delayed error from an old session cannot stop its replacement. Only for the live session does a
/// structural or codec-contract violation become fatal ([Admission.reject]): that session is ended
/// here, at once, and reported once (`stream-rejected`). The drops the contract names as drops stay
/// drops: a stale generation, a PTS that does not increase, and the wait for an IDR after a Mac-side
/// drop.
public struct SessionGate: Sendable {
    public enum Drop: String, Sendable, CaseIterable {
        case noLiveSession, endedSession, otherSession, staleGeneration
        case awaitingKeyframe, outOfOrder, malformed
    }

    public enum Admission: Sendable, Equatable {
        case accept(WebcamAU)
        case drop(Drop)
        /// The live session's stream broke the contract. The gate has already ended the session;
        /// the effects stop its sink and report it. Counted under `Drop.malformed`.
        case reject(StreamFault, [Effect])
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
        /// Report to main that the live session's stream broke the contract (`stream-rejected`).
        /// `generation` is 0 when the AU could not be read far enough to say.
        case reportRejected(SessionID, generation: UInt16, fault: StreamFault)
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
        // Whose AU it is comes first, from the record's own id: bytes tagged with anything but the
        // live session are never read, so they cannot end it.
        guard let current = live else {
            return drop(tombstones.contains(session) ? .endedSession : .noLiveSession)
        }
        if tombstones.contains(session) { return drop(.endedSession) }
        guard session == current else { return drop(.otherSession) }

        let au: WebcamAU
        do { au = try WebcamAUCodec.parse(frame) } catch let m as MalformedAU {
            return reject(current, generation: 0, StreamFault(m))
        } catch {
            // Unreachable: `parse` throws only `MalformedAU`. Swift's untyped `throws` needs the arm,
            // and an AU nobody could read is still the live session's broken stream.
            return reject(current, generation: 0, .lengthMismatch)
        }
        let g = au.header.generation
        // Stale, not malformed: `running` travels on the control connection and can overtake the
        // last AUs of the generation it replaces.
        if g < highestGeneration { return drop(.staleGeneration) }
        switch validator.check(au) {
        case .malformed(let v): return reject(current, generation: g, StreamFault(v))
        case .dropOutOfOrderPTS:
            adopt(g)
            return drop(.outOfOrder)
        case .accept: break
        }
        // A higher generation is adopted, not refused: it can only arrive on the session's own
        // claimed socket, and it may outrun the `running` that announces it (two connections). Its
        // first AU being an IDR with SPS and PPS is the validator's rule, and fatal above.
        adopt(g)
        if needsKeyframe && !au.isKeyframeWithConfig { return drop(.awaitingKeyframe) }
        needsKeyframe = false
        accepted += 1
        return .accept(au)
    }

    private mutating func reject(_ id: SessionID, generation: UInt16, _ fault: StreamFault) -> Admission {
        dropped[.malformed, default: 0] += 1
        return .reject(fault, end(id, reason: "malformed") + [.reportRejected(id, generation: generation, fault: fault)])
    }

    private mutating func drop(_ cause: Drop) -> Admission {
        dropped[cause, default: 0] += 1
        return .drop(cause)
    }
}
