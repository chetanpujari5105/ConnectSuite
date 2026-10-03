import CoreMediaIO
import Foundation
import WebcamExtension

// The Camera Extension's entry point. COMPILED ONLY. A Camera Extension runs when macOS loads it from
// a signed `.systemextension` bundle inside a signed app in /Applications, after the admin approves it
// — none of which exists, and all of which is blocked on the Apple Developer Program (README →
// Blocked). Running this binary directly is not a test of anything: `startService` expects to be
// launched by the system.

let providerSource = try SidekickCameraProvider(clientQueue: nil)
CMIOExtensionProvider.startService(provider: providerSource.provider)
CFRunLoopRun()
