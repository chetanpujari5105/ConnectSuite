// swift-tools-version:6.0
//
// Sidekick Camera — the Mac half of Camera v2 (docs/protocol.md → Webcam).
//
// Phase W1: the frame bridge and the Camera Extension's logic, built with the Command Line Tools
// and tested in-process. Nothing here is signed, packaged, installed or activated, and the
// `sidekick-camera-extension` executable is compiled only: a Camera Extension runs when macOS loads
// it from a signed `.systemextension` bundle, which is blocked on the Apple Developer Program
// (README → Blocked).
//
// Tests need Swift Testing's path passed explicitly under the CLT; run them with `node run-tests.mjs`.
import PackageDescription

let package = Package(
    name: "SidekickCamera",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "sidekick-camera-bridge", targets: ["sidekick-camera-bridge"]),
        .executable(name: "sidekick-camera-extension", targets: ["sidekick-camera-extension"]),
    ],
    targets: [
        // Foundation only: the wire codec, the bridge's record framing, the session gate.
        .target(name: "WebcamCore"),
        // CoreMedia / CoreVideo / VideoToolbox / CoreGraphics: decode, compose, cards, sink queue.
        .target(name: "WebcamMedia", dependencies: ["WebcamCore"]),
        // CoreMediaIO / Security: the extension's provider, device and streams, and the relay.
        .target(name: "WebcamExtension", dependencies: ["WebcamCore", "WebcamMedia"]),
        // The bridge's pipeline and its CoreMediaIO sink port.
        .target(name: "WebcamBridge", dependencies: ["WebcamCore", "WebcamMedia"]),
        .executableTarget(name: "sidekick-camera-bridge", dependencies: ["WebcamBridge"]),
        .executableTarget(name: "sidekick-camera-extension", dependencies: ["WebcamExtension"]),
        // Generated frames and real H.264 for the tests. Not linked into either executable.
        .target(name: "WebcamTestSupport", dependencies: ["WebcamCore", "WebcamMedia"]),
        // Reads docs/fixtures/webcam-au-v1.hex in place: one copy of the golden bytes, not two.
        .testTarget(name: "WebcamCoreTests", dependencies: ["WebcamCore"]),
        .testTarget(name: "WebcamMediaTests", dependencies: ["WebcamMedia", "WebcamTestSupport"]),
        .testTarget(name: "WebcamExtensionTests",
                    dependencies: ["WebcamExtension", "WebcamMedia", "WebcamTestSupport"]),
        .testTarget(name: "WebcamBridgeTests",
                    dependencies: ["WebcamBridge", "WebcamExtension", "WebcamTestSupport"]),
    ],
    swiftLanguageModes: [.v5]
)
