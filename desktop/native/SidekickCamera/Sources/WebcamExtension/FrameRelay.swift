import CoreMedia
import CoreVideo
import Foundation
import WebcamCore
import WebcamMedia

/// The extension's picture logic, between its sink (frames in from the bridge) and its source
/// (frames out to every consumer). docs/protocol.md → What the picture is.
///
/// - **One slot.** The newest accepted frame replaces the last. Nothing queues behind it, so a slow
///   consumer cannot slow the source and the relay never holds more than one frame.
/// - **Three pictures.** A frame no older than the stall threshold, the *video paused* card while a
///   session is live but stale, or the *camera off* card. Never a frozen frame labelled live.
/// - **A stop clears the slot** at once: the producer stopping, the producer leaving, a session
///   ending. The next tick draws the camera-off card.
/// - **A stopped stream never reappears.** Ended sessions are remembered, and a frame tagged with
///   one is refused from any producer.
/// - **Host-clock timestamps, strictly increasing**, across every change of what is shown.
public final class FrameRelay {
    public enum Refusal: String, Sendable, CaseIterable {
        case noProducer, badPixelFormat, badSize, endedSession, staleGeneration
    }

    public enum Picture: String, Sendable {
        case fresh, `repeat`, paused, off
    }

    public struct Delivery {
        public let buffer: CVPixelBuffer
        public let picture: Picture
        /// Host-clock nanoseconds; strictly greater than the previous delivery's.
        public let hostTimeNanos: UInt64
        public let format: PublishedFormat
        /// The session whose frame this is, or nil for a card.
        public let session: SessionID?
        public let upscaled: Bool
    }

    public let stallThresholdNanos: UInt64
    private let cards: PlaceholderCards
    private let scaler: FrameScaler
    private let lock = NSLock()

    private var producerActive = false
    private var sessionLive = false
    private var currentSession: SessionID?
    private var highestGeneration: UInt16 = 0
    private var tombstones = Tombstones()
    private var slot: (buffer: CVPixelBuffer, arrivalNanos: UInt64, session: SessionID?, delivered: Bool)?
    private var lastDeliveryNanos: UInt64 = 0

    public private(set) var ingested = 0
    public private(set) var accepted = 0
    public private(set) var refused: [Refusal: Int] = [:]
    public private(set) var delivered: [Picture: Int] = [:]
    public private(set) var cleared = 0

    public init(stallThresholdNanos: UInt64 = 1_000_000_000, cards: PlaceholderCards = PlaceholderCards()) throws {
        self.stallThresholdNanos = stallThresholdNanos
        self.cards = cards
        self.scaler = try FrameScaler()
    }

    // MARK: Producer side (the sink)

    /// The authorized producer's sink stream started.
    public func producerStarted() {
        lock.lock(); defer { lock.unlock() }
        producerActive = true
        sessionLive = false
        slot = nil
    }

    /// The producer stopped its sink or disconnected. The picture clears now.
    public func producerStopped() {
        lock.lock(); defer { lock.unlock() }
        producerActive = false
        endCurrentLocked()
    }

    /// Ends a session by id (main told the bridge, and the bridge's next frame names a new session,
    /// or the sink stopped). Idempotent.
    public func sessionEnded(_ id: SessionID) {
        lock.lock(); defer { lock.unlock() }
        tombstones.bury(id)
        if currentSession == id { endCurrentLocked() }
    }

    @discardableResult
    public func ingest(_ sb: CMSampleBuffer, nowNanos: UInt64) -> Refusal? {
        lock.lock(); defer { lock.unlock() }
        ingested += 1
        guard producerActive else { return refuse(.noProducer) }
        guard let pb = CMSampleBufferGetImageBuffer(sb),
              CVPixelBufferGetPixelFormatType(pb) == PublishedFormat.pixelFormat else {
            return refuse(.badPixelFormat)
        }
        guard PublishedFormat.matching(width: CVPixelBufferGetWidth(pb), height: CVPixelBufferGetHeight(pb)) != nil else {
            return refuse(.badSize)
        }
        var session: SessionID?
        if let (id, generation) = SampleBuffers.tags(sb) {
            if tombstones.contains(id) { return refuse(.endedSession) }
            if let current = currentSession, current != id {
                // A new session from the same producer: the old one is over, and its pixels go first.
                tombstones.bury(current)
                slot = nil
                highestGeneration = 0
            }
            if currentSession == id, generation < highestGeneration { return refuse(.staleGeneration) }
            currentSession = id
            highestGeneration = max(highestGeneration, generation)
            session = id
        }
        // Untagged frames (proposal Q7) are bounded by the sink's own start and stop.
        sessionLive = true
        slot = (pb, nowNanos, session, false)
        accepted += 1
        return nil
    }

    private func refuse(_ r: Refusal) -> Refusal {
        refused[r, default: 0] += 1
        return r
    }

    private func endCurrentLocked() {
        if let id = currentSession { tombstones.bury(id) }
        if slot != nil { cleared += 1 }
        slot = nil
        sessionLive = false
        currentSession = nil
        highestGeneration = 0
    }

    // MARK: Consumer side (the source)

    /// One tick of the client's frame rate. Never blocks on a consumer and never queues.
    public func tick(format: PublishedFormat, nowNanos: UInt64) throws -> Delivery {
        lock.lock(); defer { lock.unlock() }
        let t = max(nowNanos, lastDeliveryNanos + 1)
        lastDeliveryNanos = t

        if let s = slot, nowNanos >= s.arrivalNanos, nowNanos - s.arrivalNanos <= stallThresholdNanos {
            let picture: Picture = s.delivered ? .repeat : .fresh
            slot = (s.buffer, s.arrivalNanos, s.session, true)
            let w = CVPixelBufferGetWidth(s.buffer)
            let out = try scaler.fit(s.buffer, to: format)
            delivered[picture, default: 0] += 1
            return Delivery(buffer: out, picture: picture, hostTimeNanos: t, format: format,
                            session: s.session, upscaled: format.width > w)
        }
        let card: Card = (producerActive && sessionLive) ? .videoPaused : .cameraOff
        let picture: Picture = card == .videoPaused ? .paused : .off
        delivered[picture, default: 0] += 1
        return Delivery(buffer: try cards.buffer(card, format: format), picture: picture,
                        hostTimeNanos: t, format: format, session: nil, upscaled: false)
    }

    public var holdsFrame: Bool {
        lock.lock(); defer { lock.unlock() }
        return slot != nil
    }

    public func isEnded(_ id: SessionID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return tombstones.contains(id)
    }
}
