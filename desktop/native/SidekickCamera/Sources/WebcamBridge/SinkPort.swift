import CoreMedia
import CoreMediaIO
import Foundation
import WebcamCore
import WebcamMedia

/// Where the bridge's composed frames go.
public protocol SinkPort: AnyObject {
    /// Locates and starts the sink for a live session.
    func start() -> SinkState
    /// Latest-wins enqueue; false when there is no started sink.
    func enqueue(_ sb: CMSampleBuffer) -> Bool
    /// Flushes everything queued and stops the sink. Never deferred.
    func stopAndFlush()
    var supersededSink: Int { get }
}

public enum SinkState: String, Sendable, Equatable {
    /// Sidekick Camera is not among CoreMediaIO's devices: the extension is not activated.
    case deviceNotInstalled = "device-not-installed"
    /// The device exists and refused this process as its producer.
    case refused
    case idle
    case feeding
}

/// The real sink: Sidekick Camera's sink stream, located through CoreMediaIO's device list by its
/// stable device UID, fed through the queue `CMIOStreamCopyBufferQueue` returns.
///
/// On this Mac today the device does not exist — nothing is activated — so `start()` returns
/// `deviceNotInstalled` from a **real** enumeration, whose positive control is that the same call
/// lists the Mac's own camera (WebcamBridgeTests).
public final class CMIOSinkPort: SinkPort {
    private var deviceID: CMIOObjectID?
    private var streamID: CMIOStreamID?
    private var queue: SinkQueue?
    public private(set) var state: SinkState = .idle
    public var supersededSink: Int { queue?.supersededSink ?? 0 }

    public init() {}

    /// Every CoreMediaIO device's object id, name and UID. Read-only; starts nothing.
    public static func devices() -> [(id: CMIOObjectID, name: String, uid: String)] {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
        var ids = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
        var used: UInt32 = 0
        guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, size, &used, &ids) == noErr else { return [] }
        return ids.map { ($0, stringProperty($0, kCMIOObjectPropertyName) ?? "?",
                          stringProperty($0, kCMIODevicePropertyDeviceUID) ?? "?") }
    }

    static func stringProperty(_ object: CMIOObjectID, _ selector: Int) -> String? {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(selector),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var value: Unmanaged<CFString>?
        var used: UInt32 = 0
        let st = withUnsafeMutablePointer(to: &value) {
            CMIOObjectGetPropertyData(object, &addr, 0, nil, UInt32(MemoryLayout<CFString?>.size), &used, $0)
        }
        guard st == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }

    /// The extension publishes `deviceID.uuidString` as the legacy id, which is the UID CoreMediaIO
    /// lists.
    public static func locateSidekickCamera() -> CMIOObjectID? {
        devices().first { $0.uid == SidekickCameraIdentity.deviceID.uuidString }?.id
    }

    public func start() -> SinkState {
        guard let device = Self.locateSidekickCamera() else {
            state = .deviceNotInstalled
            return state
        }
        // Never run: on this Mac no activated extension exists for `locateSidekickCamera` to find,
        // so everything below compiles against the CLT SDK and has not executed. Its first run is
        // proposal §11.2 item 3 (W4).
        deviceID = device
        let st = startSinkStream(device: device)
        state = st == noErr ? .feeding : .refused
        return state
    }

    /// The device's sink stream: the one whose direction is output (0). Which scope CoreMediaIO
    /// lists a Camera Extension's sink stream under is unread, so this asks in the global scope and
    /// discriminates on the stream's own direction property rather than on its position.
    private func startSinkStream(device: CMIOObjectID) -> OSStatus {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyStreams),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        var st = CMIOObjectGetPropertyDataSize(device, &addr, 0, nil, &size)
        guard st == noErr else { return st }
        var streams = [CMIOStreamID](repeating: 0, count: Int(size) / MemoryLayout<CMIOStreamID>.size)
        var used: UInt32 = 0
        st = CMIOObjectGetPropertyData(device, &addr, 0, nil, size, &used, &streams)
        guard st == noErr else { return st }
        guard let sink = streams.first(where: { Self.direction(of: $0) == 0 }) else { return -1 }
        var q: Unmanaged<CMSimpleQueue>?
        st = CMIOStreamCopyBufferQueue(sink, { _, _, _ in }, nil, &q)
        guard st == noErr, let q else { return st }
        queue = SinkQueue(adopting: q.takeRetainedValue())
        st = CMIODeviceStartStream(device, sink)
        if st == noErr { streamID = sink }
        return st
    }

    static func direction(of stream: CMIOStreamID) -> UInt32? {
        var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOStreamPropertyDirection),
                                             mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                             mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var value: UInt32 = 0
        var used: UInt32 = 0
        let st = CMIOObjectGetPropertyData(stream, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &used, &value)
        return st == noErr ? value : nil
    }

    public func enqueue(_ sb: CMSampleBuffer) -> Bool {
        guard state == .feeding, let queue else { return false }
        return queue.enqueueLatest(sb)
    }

    public func stopAndFlush() {
        queue?.flush()
        if let d = deviceID, let s = streamID { CMIODeviceStopStream(d, s) }
        streamID = nil
        queue = nil
        if state == .feeding { state = .idle }
    }
}

/// An in-process sink over a real `CMSimpleQueue`: what W1's end-to-end tests feed, and what they
/// drain into a real `SidekickCameraDevice`. It stands in for CoreMediaIO's cross-process transport,
/// which nothing here can reach before activation.
public final class QueueSinkPort: SinkPort {
    public let queue: SinkQueue
    public private(set) var started = false
    public private(set) var starts = 0
    public private(set) var stops = 0
    public var onStart: (() -> Void)?
    public var onStop: (() -> Void)?
    public var supersededSink: Int { queue.supersededSink }

    public init(capacity: Int = 3) { queue = SinkQueue(capacity: capacity) }

    public func start() -> SinkState {
        started = true
        starts += 1
        onStart?()
        return .feeding
    }

    public func enqueue(_ sb: CMSampleBuffer) -> Bool {
        guard started else { return false }
        return queue.enqueueLatest(sb)
    }

    public func stopAndFlush() {
        queue.flush()
        if started { stops += 1 }
        started = false
        onStop?()
    }
}
