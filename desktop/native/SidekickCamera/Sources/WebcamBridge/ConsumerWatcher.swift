import CoreMediaIO
import Foundation
import WebcamCore

/// Reads Sidekick Camera's consumer count — the extension's read-only custom property — through
/// CoreMediaIO, and calls back on every change.
///
/// With no activated extension the device is not among CoreMediaIO's devices, so the count is 0
/// and `deviceFound` is false. That is the state of this Mac today, and it means the bridge ends any
/// announced session at once (`no-consumers`): with nobody able to watch, nothing is fed. The
/// property listener below compiles against the CLT SDK and has never fired.
public final class ConsumerWatcher {
    public private(set) var deviceFound = false
    private var device: CMIOObjectID?
    private let queue = DispatchQueue(label: "sidekick.camera.bridge.consumers")
    private let onChange: (Int) -> Void
    private var listener: CMIOObjectPropertyListenerBlock?

    /// '4cc_scns_glob_0000' → selector 'scns', global scope, main element.
    static var address: CMIOObjectPropertyAddress {
        let fourcc = "scns".utf8.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        return CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(fourcc),
                                         mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                         mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    }

    public init(onChange: @escaping (Int) -> Void) { self.onChange = onChange }

    /// Locates the device and reports the current count (0 when it is absent).
    public func start() {
        device = CMIOSinkPort.locateSidekickCamera()
        deviceFound = device != nil
        guard let device else { onChange(0); return }
        var addr = Self.address
        let block: CMIOObjectPropertyListenerBlock = { [weak self] _, _ in
            guard let self else { return }
            self.onChange(self.read(device) ?? 0)
        }
        listener = block
        CMIOObjectAddPropertyListenerBlock(device, &addr, queue, block)
        onChange(read(device) ?? 0)
    }

    public func stop() {
        guard let device, let listener else { return }
        var addr = Self.address
        CMIOObjectRemovePropertyListenerBlock(device, &addr, queue, listener)
        self.listener = nil
    }

    func read(_ device: CMIOObjectID) -> Int? {
        var addr = Self.address
        var value: Unmanaged<CFString>?
        var used: UInt32 = 0
        let st = withUnsafeMutablePointer(to: &value) {
            CMIOObjectGetPropertyData(device, &addr, 0, nil, UInt32(MemoryLayout<CFString?>.size), &used, $0)
        }
        guard st == noErr, let value else { return nil }
        return Int(value.takeRetainedValue() as String)
    }
}
