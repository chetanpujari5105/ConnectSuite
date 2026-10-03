import Foundation

/// Identifiers that become permanent once a build ships (proposal B4). Kept in one place so the
/// extension, the bridge and the tests cannot disagree about them.
public enum SidekickCameraIdentity {
    /// The name every Mac app lists. Owner-confirmed spelling is B4; this is the proposal's.
    public static let deviceName = "Sidekick Camera"
    public static let manufacturer = "Sidekick"
    /// Apps remember a camera by its id, so these must never change once published. Generated once,
    /// 2026-10-03.
    public static let deviceID = UUID(uuidString: "6F1F3C9E-2B5D-4C1A-9E7B-5A2C8D4E1F60")!
    public static let sourceStreamID = UUID(uuidString: "0B8E4A71-6C3D-4F25-8A19-D7E2C5B3A946")!
    public static let sinkStreamID = UUID(uuidString: "A4D2971C-3E58-4B6F-B0C1-82F9E6D5A713")!

    public static let appBundleID = "com.chetan.sidekick.desktop"
    public static let extensionBundleID = "com.chetan.sidekick.desktop.camera"
    public static let bridgeIdentifier = "com.chetan.sidekick.desktop.camera-bridge"

    /// **nil until the Apple Developer Program exists (B1).** With no Team ID the extension's
    /// producer requirement can name none, so every producer is refused — fail closed.
    public static let teamID: String? = nil

    /// The read-only custom property carrying the consumer count, as a decimal string.
    public static let consumerCountProperty = "4cc_scns_glob_0000"

    /// Sample-buffer attachments carrying the session on the sink (defence in depth; proposal Q7).
    public static let sessionAttachmentKey = "SidekickWebcamSessionID"
    public static let generationAttachmentKey = "SidekickWebcamGeneration"
}
