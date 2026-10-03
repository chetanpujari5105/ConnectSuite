/// Ended session ids, remembered so a stopped stream can never reappear: not from a late frame in
/// flight, not from a queue, not from a replacement producer replaying old frames.
///
/// Bounded, because a session id is 128 random bits and the set would otherwise grow for the life
/// of the process. 256 sessions is far more than one sitting produces; the bound and the number
/// evicted are both reported, so a run that hit it says so.
public struct Tombstones: Sendable {
    public let capacity: Int
    private var order: [SessionID] = []
    private var set: Set<SessionID> = []
    public private(set) var evicted = 0

    public init(capacity: Int = 256) { self.capacity = capacity }

    public func contains(_ id: SessionID) -> Bool { set.contains(id) }

    public mutating func bury(_ id: SessionID) {
        guard !set.contains(id) else { return }
        if order.count == capacity {
            set.remove(order.removeFirst())
            evicted += 1
        }
        order.append(id)
        set.insert(id)
    }

    public var count: Int { order.count }
}
