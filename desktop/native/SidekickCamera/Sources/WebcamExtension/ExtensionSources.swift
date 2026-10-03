import CoreMedia
import CoreMediaIO
import Foundation
import IOKit.audio
import os.log
import WebcamCore
import WebcamMedia

// The Camera Extension: Apple's provider → device → stream model, written from the CoreMediaIO
// headers. Halle Winkler's SinkCam (MIT, ATTRIBUTION.md) was read as a design reference for the
// timer-driven sink consumption; no code was copied.
//
// These are the real `CMIOExtension*Source` classes the system would load. W1 instantiates them
// in-process — the provider, the device and both streams are real CoreMediaIO objects, and
// `stream.send` is really called — but nothing here has been loaded by `cmioextension`, and the
// system's own fan-out to clients is not exercised (README → What W1 does not prove).

let log = Logger(subsystem: SidekickCameraIdentity.extensionBundleID, category: "extension")

/// The provider: one device, Sidekick Camera.
public final class SidekickCameraProvider: NSObject, CMIOExtensionProviderSource {
    public private(set) var provider: CMIOExtensionProvider!
    public let deviceSource: SidekickCameraDevice

    public init(clientQueue: DispatchQueue?, authorizer: ProducerAuthorizer = ProducerAuthorizer(),
                relay: FrameRelay? = nil) throws {
        deviceSource = try SidekickCameraDevice(authorizer: authorizer, relay: relay ?? FrameRelay())
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: clientQueue)
        try provider.addDevice(deviceSource.device)
        deviceSource.attachedToProvider = true
    }

    public var availableProperties: Set<CMIOExtensionProperty> { [.providerManufacturer] }

    public func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let p = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) { p.manufacturer = SidekickCameraIdentity.manufacturer }
        return p
    }

    public func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {}

    /// Any app may connect: listing and opening the device is the ordinary webcam model, and it is
    /// **not** consent to anything. The picture is gated, not the device.
    public func connect(to client: CMIOExtensionClient) throws {}

    public func disconnect(from client: CMIOExtensionClient) {
        deviceSource.clientDisconnected(client.clientID)
    }
}

/// The device: a source stream every consumer reads, and a sink stream only the bridge may feed.
public final class SidekickCameraDevice: NSObject, CMIOExtensionDeviceSource {
    public private(set) var device: CMIOExtensionDevice!
    public private(set) var sourceStream: SidekickSourceStream!
    public private(set) var sinkStream: SidekickSinkStream!
    public let relay: FrameRelay
    public let authorizer: ProducerAuthorizer

    private let lock = NSLock()
    private var ledger = ConsumerLedger()
    private var producerClientID: UUID?
    private var producerClient: CMIOExtensionClient?
    private var sinkRunning = false
    private var tickTimer: DispatchSourceTimer?
    private var sinkTimer: DispatchSourceTimer?
    private let timerQueue = DispatchQueue(label: "sidekick.camera.extension.timers", qos: .userInteractive)
    private let runsOwnTimers: Bool

    public private(set) var producerRefusals: [ProducerRefusal] = []
    /// Called with every delivery, after `stream.send`. Logging in production; observation in tests.
    public var onDelivery: ((FrameRelay.Delivery) -> Void)?
    /// Called on every consumer-episode transition.
    public var onConsumerTransition: ((ConsumerLedger.Transition, Int) -> Void)?

    public static let consumerCountProperty = CMIOExtensionProperty(rawValue: SidekickCameraIdentity.consumerCountProperty)

    /// Public so the tests can build a device without a provider: CoreMediaIO allows **one**
    /// `CMIOExtensionProvider` per process and raises an NSException ("There should be only one
    /// CMIOProvider per extension.") on the second — read in W1, 2026-10-03.
    ///
    /// `runsOwnTimers: false` leaves ticking and sink consumption to the caller, so a test can drive
    /// a clock by hand. Production always runs them.
    public init(authorizer: ProducerAuthorizer = ProducerAuthorizer(), relay: FrameRelay,
                runsOwnTimers: Bool = true) throws {
        self.authorizer = authorizer
        self.relay = relay
        self.runsOwnTimers = runsOwnTimers
        super.init()
        let id = SidekickCameraIdentity.deviceID
        device = CMIOExtensionDevice(localizedName: SidekickCameraIdentity.deviceName, deviceID: id,
                                     legacyDeviceID: id.uuidString, source: self)
        sourceStream = SidekickSourceStream(device: self)
        sinkStream = SidekickSinkStream(device: self)
        try device.addStream(sourceStream.stream)
        try device.addStream(sinkStream.stream)
    }

    // MARK: CMIOExtensionDeviceSource

    public var availableProperties: Set<CMIOExtensionProperty> {
        [.deviceTransportType, .deviceModel, Self.consumerCountProperty]
    }

    public func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let p = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) { p.transportType = kIOAudioDeviceTransportTypeVirtual }
        if properties.contains(.deviceModel) { p.model = SidekickCameraIdentity.deviceName }
        if properties.contains(Self.consumerCountProperty) {
            p.setPropertyState(CMIOExtensionPropertyState(value: "\(consumerCount)" as NSString),
                               forProperty: Self.consumerCountProperty)
        }
        return p
    }

    /// Read-only. Nothing that changes the picture can be set from outside (the contract's "no
    /// other channel" rule): a property set carries no client identity.
    public func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {}

    // MARK: Consumers (the source stream)

    public var consumerCount: Int {
        lock.lock(); defer { lock.unlock() }
        return ledger.count
    }

    public var ledgerSnapshot: ConsumerLedger {
        lock.lock(); defer { lock.unlock() }
        return ledger
    }

    func sourceStarted() {
        lock.lock()
        let t = ledger.started()
        let count = ledger.count
        lock.unlock()
        publishConsumerCount(count)
        if let t {
            if t == .episodeBegan { startTicking() }
            onConsumerTransition?(t, count)
        }
    }

    func sourceStopped() {
        lock.lock()
        let t = ledger.stopped()
        let count = ledger.count
        lock.unlock()
        publishConsumerCount(count)
        if let t {
            if t == .episodeEnded { stopTicking() }
            onConsumerTransition?(t, count)
        }
    }

    /// Set once the device is added to its provider. `notifyPropertiesChanged` and `stream.send` on a
    /// device with no provider both dereference a nil dispatch queue and crash the process (SIGSEGV
    /// in `dispatch_async` — read in W1, 2026-10-03), so neither is called before then; a reader
    /// asking later gets the current count from `deviceProperties` anyway.
    public var attachedToProvider = false

    private func publishConsumerCount(_ count: Int) {
        guard attachedToProvider else { return }
        let state = CMIOExtensionPropertyState<AnyObject>(value: "\(count)" as NSString)
        device.notifyPropertiesChanged([Self.consumerCountProperty: state])
    }

    // MARK: The producer (the sink stream)

    /// The identity decision for a client asking to start the sink. `CMIOExtensionClient` cannot be
    /// constructed outside the system, so `authorizedToStartStream(for:)` reduces the client to its
    /// three fields and calls this — **the injected boundary W1's tests enter at.**
    public func authorizeProducer(clientID: UUID, claim: ProducerClaim) -> Bool {
        let verdict = authorizer.authorize(claim)
        lock.lock(); defer { lock.unlock() }
        switch verdict {
        case .authorized:
            producerClientID = clientID
            return true
        case let .refused(why):
            producerRefusals.append(why)
            log.error("sink refused for signingID \(claim.signingID ?? "nil", privacy: .public) pid \(claim.pid): \(String(describing: why), privacy: .public)")
            return false
        }
    }

    func rememberProducerClient(_ client: CMIOExtensionClient) {
        lock.lock(); defer { lock.unlock() }
        if client.clientID == producerClientID { producerClient = client }
    }

    func sinkStarted() {
        lock.lock()
        let authorized = producerClientID != nil
        sinkRunning = authorized
        let client = producerClient
        lock.unlock()
        guard authorized else { return }
        relay.producerStarted()
        if let client { startConsuming(from: client) }
    }

    func sinkStopped() {
        lock.lock()
        sinkRunning = false
        lock.unlock()
        stopConsuming()
        relay.producerStopped()
    }

    func clientDisconnected(_ clientID: UUID) {
        lock.lock()
        let wasProducer = clientID == producerClientID
        if wasProducer {
            producerClientID = nil
            producerClient = nil
            sinkRunning = false
        }
        lock.unlock()
        if wasProducer {
            stopConsuming()
            relay.producerStopped()
        }
    }

    /// One frame from the producer. In production the sink timer calls this with what
    /// `consumeSampleBuffer(from:)` returned; W1's tests call it with frames dequeued from the
    /// bridge's real `CMSimpleQueue` — standing in for CoreMediaIO's cross-process transport.
    /// A frame arriving while no authorized sink is running is refused by the relay (`noProducer`).
    public func receiveFromProducer(_ sb: CMSampleBuffer, nowNanos: UInt64 = DispatchTime.now().uptimeNanoseconds) {
        relay.ingest(sb, nowNanos: nowNanos)
    }

    // MARK: Delivery

    /// One tick: what the relay says to show, sent on the source stream with a host-clock time.
    @discardableResult
    public func tick(nowNanos: UInt64 = DispatchTime.now().uptimeNanoseconds) -> FrameRelay.Delivery? {
        let format = sourceStream.activeFormat
        guard let d = try? relay.tick(format: format, nowNanos: nowNanos),
              let sb = try? SampleBuffers.make(d.buffer, pts: CMTime(value: Int64(d.hostTimeNanos), timescale: 1_000_000_000),
                                               duration: sourceStream.frameDuration) else {
            log.error("tick produced no frame")
            return nil
        }
        // Like notifyPropertiesChanged, `send` on a stream whose device has no provider dereferences
        // a nil queue and crashes (read in W1). Unattached, the delivery is computed and observed but
        // has nowhere to go.
        if attachedToProvider {
            sourceStream.stream.send(sb, discontinuity: [], hostTimeInNanoseconds: d.hostTimeNanos)
        }
        onDelivery?(d)
        return d
    }

    public var isTicking: Bool { timerQueue.sync { tickTimer != nil } }

    private func startTicking() {
        guard runsOwnTimers else { return }
        timerQueue.async { [weak self] in
            guard let self, self.tickTimer == nil else { return }
            let t = DispatchSource.makeTimerSource(flags: .strict, queue: self.timerQueue)
            t.schedule(deadline: .now(), repeating: self.sourceStream.frameDuration.seconds, leeway: .milliseconds(2))
            t.setEventHandler { [weak self] in self?.tick() }
            self.tickTimer = t
            t.resume()
        }
    }

    private func stopTicking() {
        timerQueue.async { [weak self] in
            self?.tickTimer?.cancel()
            self?.tickTimer = nil
        }
    }

    private func startConsuming(from client: CMIOExtensionClient) {
        guard runsOwnTimers else { return }
        timerQueue.async { [weak self] in
            guard let self, self.sinkTimer == nil else { return }
            let t = DispatchSource.makeTimerSource(flags: .strict, queue: self.timerQueue)
            // Faster than the source so arrival jitter does not become latency; an empty queue
            // returns at once.
            t.schedule(deadline: .now(), repeating: 1.0 / 90.0, leeway: .milliseconds(2))
            t.setEventHandler { [weak self] in
                guard let self else { return }
                self.sinkStream.stream.consumeSampleBuffer(from: client) { sb, seq, _, _, _ in
                    guard let sb else { return }
                    self.receiveFromProducer(sb)
                    let now = DispatchTime.now().uptimeNanoseconds
                    self.sinkStream.stream.notifyScheduledOutputChanged(
                        CMIOExtensionScheduledOutput(sequenceNumber: seq, hostTimeInNanoseconds: now))
                }
            }
            self.sinkTimer = t
            t.resume()
        }
    }

    private func stopConsuming() {
        timerQueue.async { [weak self] in
            self?.sinkTimer?.cancel()
            self?.sinkTimer = nil
        }
    }
}

/// The stream every consumer reads. Starting it is a **consumer** (the ledger counts it); it is never
/// consent, and any client may start it.
public final class SidekickSourceStream: NSObject, CMIOExtensionStreamSource {
    public private(set) var stream: CMIOExtensionStream!
    private unowned let device: SidekickCameraDevice
    private let streamFormats: [CMIOExtensionStreamFormat]
    private let lock = NSLock()
    private var activeIndex = 0
    private var duration = PublishedFormat.minFrameDuration

    init(device: SidekickCameraDevice) {
        self.device = device
        streamFormats = PublishedFormat.all.map {
            CMIOExtensionStreamFormat(formatDescription: $0.makeFormatDescription(),
                                      maxFrameDuration: PublishedFormat.maxFrameDuration,
                                      minFrameDuration: PublishedFormat.minFrameDuration,
                                      validFrameDurations: nil)
        }
        super.init()
        stream = CMIOExtensionStream(localizedName: "\(SidekickCameraIdentity.deviceName).Video",
                                     streamID: SidekickCameraIdentity.sourceStreamID, direction: .source,
                                     clockType: .hostTime, source: self)
    }

    public var formats: [CMIOExtensionStreamFormat] { streamFormats }

    public var activeFormat: PublishedFormat {
        lock.lock(); defer { lock.unlock() }
        return PublishedFormat.all[activeIndex]
    }

    public var frameDuration: CMTime {
        lock.lock(); defer { lock.unlock() }
        return duration
    }

    public var availableProperties: Set<CMIOExtensionProperty> { [.streamActiveFormatIndex, .streamFrameDuration] }

    public func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let p = CMIOExtensionStreamProperties(dictionary: [:])
        lock.lock(); defer { lock.unlock() }
        if properties.contains(.streamActiveFormatIndex) { p.activeFormatIndex = activeIndex }
        if properties.contains(.streamFrameDuration) { p.frameDuration = duration }
        return p
    }

    /// The only settable properties: the client's choice of format and frame rate, clamped to what
    /// is published. Neither can change *what* is shown.
    public func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        lock.lock(); defer { lock.unlock() }
        if let i = streamProperties.activeFormatIndex, PublishedFormat.all.indices.contains(i) { activeIndex = i }
        if let d = streamProperties.frameDuration, d.isValid {
            duration = CMTimeClampToRange(d, range: CMTimeRange(start: PublishedFormat.minFrameDuration,
                                                                end: PublishedFormat.maxFrameDuration))
        }
    }

    public func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool { true }
    public func startStream() throws { device.sourceStarted() }
    public func stopStream() throws { device.sourceStopped() }
}

/// The stream only the authorized bridge may feed.
public final class SidekickSinkStream: NSObject, CMIOExtensionStreamSource {
    public static let queueSize = 3
    public private(set) var stream: CMIOExtensionStream!
    private unowned let device: SidekickCameraDevice
    private let streamFormats: [CMIOExtensionStreamFormat]

    init(device: SidekickCameraDevice) {
        self.device = device
        streamFormats = PublishedFormat.all.map {
            CMIOExtensionStreamFormat(formatDescription: $0.makeFormatDescription(),
                                      maxFrameDuration: PublishedFormat.maxFrameDuration,
                                      minFrameDuration: PublishedFormat.minFrameDuration,
                                      validFrameDurations: nil)
        }
        super.init()
        stream = CMIOExtensionStream(localizedName: "\(SidekickCameraIdentity.deviceName).Sink",
                                     streamID: SidekickCameraIdentity.sinkStreamID, direction: .sink,
                                     clockType: .hostTime, source: self)
    }

    public var formats: [CMIOExtensionStreamFormat] { streamFormats }

    public var availableProperties: Set<CMIOExtensionProperty> {
        [.streamActiveFormatIndex, .streamFrameDuration, .streamSinkBufferQueueSize,
         .streamSinkBuffersRequiredForStartup]
    }

    public func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let p = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { p.activeFormatIndex = 0 }
        if properties.contains(.streamFrameDuration) { p.frameDuration = PublishedFormat.minFrameDuration }
        if properties.contains(.streamSinkBufferQueueSize) { p.sinkBufferQueueSize = Self.queueSize }
        if properties.contains(.streamSinkBuffersRequiredForStartup) { p.sinkBuffersRequiredForStartup = 1 }
        return p
    }

    public func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {}

    public func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        let ok = device.authorizeProducer(clientID: client.clientID,
                                          claim: ProducerClaim(signingID: client.signingID, pid: client.pid))
        if ok { device.rememberProducerClient(client) }
        return ok
    }

    public func startStream() throws { device.sinkStarted() }
    public func stopStream() throws { device.sinkStopped() }
}
