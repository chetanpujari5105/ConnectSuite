/// Counts the source stream's starts and stops — the extension's consumer count.
///
/// Whether CoreMediaIO calls `startStream` once per client or once per 0→1 transition is not
/// documented (proposal Q8), so this is correct under both: it is reliable at **0 versus ≥ 1**, and
/// nothing depends on its value above 1. A stop at zero is an anomaly, counted and otherwise
/// ignored; the count never goes negative, so a duplicate stop cannot hide a later start.
///
/// Enumerating the device, opening it, or reading its formats never reaches here. Only a started
/// source stream is a consumer (docs/protocol.md → Consumer episodes).
public struct ConsumerLedger: Sendable, Equatable {
    public enum Transition: Sendable, Equatable {
        /// 0 → 1: the Mac may send at most one automatic `webcam.request` for this episode.
        case episodeBegan
        /// 1 → 0: the last consumer left. Capture stops at once — there is no linger.
        case episodeEnded
    }

    public private(set) var count = 0
    public private(set) var starts = 0
    public private(set) var stops = 0
    public private(set) var anomalies = 0
    public private(set) var episodes = 0

    public init() {}

    public var isConsumed: Bool { count > 0 }

    public mutating func started() -> Transition? {
        starts += 1
        count += 1
        if count == 1 {
            episodes += 1
            return .episodeBegan
        }
        return nil
    }

    public mutating func stopped() -> Transition? {
        stops += 1
        guard count > 0 else {
            anomalies += 1
            return nil
        }
        count -= 1
        return count == 0 ? .episodeEnded : nil
    }
}
