import CoreMedia

/// The bounded queue between the bridge and the extension's sink: a real `CMSimpleQueue`, the type
/// CoreMediaIO hands a sink client through `CMIOStreamCopyBufferQueue`.
///
/// **Latest wins.** When it is full, the oldest frame is dequeued and released before the newest is
/// enqueued, and that is counted `supersededSink`. A slow extension therefore costs old frames,
/// never latency, and never memory.
///
/// The queue stores retained `CMSampleBuffer` pointers, so everything it holds is released by
/// `flush()` — which a stop calls before anything else, so no frame of an ended session is left
/// waiting to be consumed.
public final class SinkQueue {
    public let queue: CMSimpleQueue
    public let capacity: Int
    private let owned: Bool
    public private(set) var enqueued = 0
    public private(set) var supersededSink = 0
    public private(set) var flushed = 0
    private let lock = NSLock()

    /// A queue of our own (in-process tests, and the development preview).
    public init(capacity: Int = 3) {
        var q: CMSimpleQueue?
        let st = CMSimpleQueueCreate(allocator: kCFAllocatorDefault, capacity: Int32(capacity), queueOut: &q)
        precondition(st == noErr && q != nil, "CMSimpleQueueCreate failed: \(st)")
        queue = q!
        self.capacity = capacity
        owned = true
    }

    /// CoreMediaIO's queue for a started sink stream.
    public init(adopting queue: CMSimpleQueue) {
        self.queue = queue
        capacity = Int(CMSimpleQueueGetCapacity(queue))
        owned = false
    }

    deinit { if owned { flushLocked() } }

    public var count: Int { Int(CMSimpleQueueGetCount(queue)) }

    @discardableResult
    public func enqueueLatest(_ sb: CMSampleBuffer) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if CMSimpleQueueGetCount(queue) >= CMSimpleQueueGetCapacity(queue) {
            if let old = CMSimpleQueueDequeue(queue) {
                Unmanaged<CMSampleBuffer>.fromOpaque(old).release()
                supersededSink += 1
            }
        }
        let st = CMSimpleQueueEnqueue(queue, element: Unmanaged.passRetained(sb).toOpaque())
        if st != noErr {
            Unmanaged.passUnretained(sb).release()
            return false
        }
        enqueued += 1
        return true
    }

    /// The consumer's side: takes ownership of the oldest frame.
    public func dequeue() -> CMSampleBuffer? {
        lock.lock(); defer { lock.unlock() }
        guard let p = CMSimpleQueueDequeue(queue) else { return nil }
        return Unmanaged<CMSampleBuffer>.fromOpaque(p).takeRetainedValue()
    }

    public func flush() {
        lock.lock(); defer { lock.unlock() }
        flushLocked()
    }

    private func flushLocked() {
        while let p = CMSimpleQueueDequeue(queue) {
            Unmanaged<CMSampleBuffer>.fromOpaque(p).release()
            flushed += 1
        }
    }
}
