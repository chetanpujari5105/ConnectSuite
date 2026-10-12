# Sidekick Camera — the Mac half of Camera v2 (phase W1)

The phone as a macOS camera called **"Sidekick Camera"**: the frame bridge and the Camera
Extension's logic. The contract is `docs/protocol.md` → *Webcam*, and the plan is
`docs/camera-v2-webcam-proposal.md`.

**Status, 2026-10-03.** Built with the Command Line Tools only, and tested **in-process**.

- **Not done:** nothing is signed with a real identity, packaged, installed or activated. No phone
  capture has run. **W3 (2026-10-04):** Electron main's controller and `BridgeProcess`
  (`desktop/src/main/webcam.ts`, `webcamBridge.ts`) drive this bridge's built executable in
  `desktop/src/main/webcamBridge.test.ts`; nothing in the running app spawns it.
- **The bridge's first record is `ready`** `{device, producerIdentity}` (added in W3,
  docs/protocol.md → The Mac's local contract). On this Mac it reads `not-installed` / `unconfigured`,
  and main asks the phone for nothing while either holds.
- **Not on the wire:** `webcam.*` exists in the contract and in no `MessageType`.
- **Camera v1 is untouched.**
- **The encoder spike's decode probe (2026-10-04):** `sidekick-camera-decode-probe` (`Sources/WebcamProbe/`)
  is the bridge's own `BridgeCore` ending in a sink that counts and discards, plus an SPS reader checked
  against VideoToolbox's. Development only: never packaged, never resolved by the production controller,
  writes nothing. Runbook: `docs/camera-v2-encoder-spike.md`. Not run against a phone.
- **Signing correction (2026-10-04):** *Blocked* below assumes Developer ID throughout. Per Apple DTS, a
  Developer ID–signed system extension will not load until it is **notarized**, so the **local**
  activation test should use **Apple Development** signing and development profiles, and Developer ID
  plus notarization is the separate distribution step. `docs/camera-v2-signing-readiness.md`.

## Layout

| Target | Frameworks | What it is |
|---|---|---|
| `WebcamCore` | Foundation | The AU codec and stream rules, the bridge's record framing, `SessionGate`, `ConsumerLedger`, `Tombstones`, the permanent identifiers |
| `WebcamMedia` | CoreMedia, CoreVideo, VideoToolbox, CoreGraphics, CoreText | `H264Decoder`, `FrameComposer` (rotate, then letterbox), `FrameScaler`, `PlaceholderCards`, `SinkQueue` (a real `CMSimpleQueue`), sample-buffer tags |
| `WebcamExtension` | CoreMediaIO, Security | The real `CMIOExtension{Provider,Device,Stream}Source` classes, `FrameRelay`, `ProducerAuthorizer` with `SecurityFrameworkVerifier` |
| `WebcamBridge` | CoreMediaIO | `BridgeCore` (gate → bounded in-order decode → compose → sink), `CMIOSinkPort`, `ConsumerWatcher` |
| `sidekick-camera-bridge` | — | The bridge executable: stdin/stdout records, stderr diagnostics, **no listening socket** |
| `sidekick-camera-extension` | — | The extension's entry point. **Compiled only** (see *Blocked*) |
| `WebcamTestSupport` | — | Generated pictures, a real `VTCompressionSession` H.264 encoder, the phone stand-in, and the **injected** identity verifier |

## Build and test

```sh
swift build                 # debug; `-c release` for release
node run-tests.mjs          # the suite; writes .test-run.json on every run, red or green
```

`node run-tests.mjs` is required rather than a bare `swift test`. Under the Command Line Tools,
SwiftPM does not find `Testing.framework`, and `swift test` fails with "no such module 'Testing'".
The wrapper passes the CLT's framework and library paths explicitly. `scripts/check-suites-run.mjs`
reads its record as the Swift leg of the commit hook. **A filtered run (`--filter`) is recorded as
filtered and counts as unrun.**

## What the suite proves, and what each proof stands on

**89 tests in 23 suites, green** (78 at W1; 9 added by the W3 correction and 2 by W2, 2026-10-04).
Evidence: `docs/evidence/camera-v2-w1-2026-10-03/`, `docs/evidence/camera-v2-w3-corrections-2026-10-04/`,
`docs/evidence/camera-v2-w2-2026-10-04/`.

| The brief's test | Where | Real, or stood in for |
|---|---|---|
| No source or no consent → only a placeholder | `OnlyAPlaceholder`, `EndToEnd.noSessionNoConsentMeansOnlyThePlaceholder` | real device and relay; the card's digest is compared with a freshly rendered card |
| Authorized vs wrong or missing producer identity | `Authorization`, `RealCodeSignatures` | decisions: **injected verifier**. Signature reading: **real** `SecCodeCopyGuestWithAttributes`/`SecCodeCheckValidity` against `/bin/sleep` (positive control: `anchor apple` satisfied), this process and a dead pid |
| Stale session or generation rejection | `Gate`, `Relay`, `EndToEnd.staleSessionsAndGenerationsAreRejected` | real |
| Malformed or oversized frames | `MalformedList` (one mutation per contract row), `RecordFraming`, `EndToEnd.malformed…` | real; the golden fixture is read in place from `docs/fixtures/webcam-au-v1.hex` |
| A malformed AU **of the live session** ends it, once, bound to its id (`stream-rejected`); bytes tagged with any other session end nothing; the documented drops stay drops | `FatalInput`, `EndToEnd.malformed…`, `Vocabulary` | real gate and pipeline; the violation tokens are held to `docs/fixtures/webcam-vocabulary-v1.json`, which Electron main's parser reads too |
| The **phone's** writer output decodes here | `PhoneStream` | the bytes are `docs/fixtures/webcam-phone-stream-v1.hex`, which camera-module's production assembler and writer reproduce byte for byte; the gate and VideoToolbox decode are real. **Stood in for:** the phone's encoder — the H.264 is this Mac's VideoToolbox, cut into MediaCodec-shaped buffers by `Tools/make-mediacodec-sample.swift` |
| Formats, orientation, aspect ratio | `Compose`, `Publishing`, `EndToEnd.generatedFramesArriveUprightFittedAndLive` | real VideoToolbox: generated pictures → `VTCompressionSession` → `VTDecompressionSession` → `VTPixelRotationSession` → `VTPixelTransferSession`. All four rotations, the pillarbox measured in pixels |
| Monotonic timestamps, bounded buffering | `Relay.timestampsStrictlyIncrease…`, `Queueing`, `EndToEnd.aSlowDecoder…`, `EndToEnd.aSlowExtension…` | real `CMSimpleQueue`; the slow decoder is a real decoder with an injected 4 ms delay |
| Slow and multiple consumers | `Consumers.slowAndFastConsumers…` | **modelled**: CoreMediaIO's fan-out to clients cannot run in-process. Fake consumers with their own bounded queues show that the extension's tick never waits for them and holds one frame |
| The last consumer closing stops the session | `Gate`, `Consumers`, `EndToEnd.theLastConsumerClosing…`, `BridgeProcess` | real ledger on real stream start/stop calls; the real bridge binary on this Mac |
| Producer or consumer failure and replacement | `EndToEnd.aProducerFailureRecovers…`, `Consumers.aConsumerReplacing…`, `Consumers.theProducerDisconnecting…` | real, with one injected decode failure |
| Explicit Stop clears old pixels and releases resources | `Relay.aStopClears…`, `EndToEnd.explicitStopClears…` | real: a frame **on screen** and more queued when Stop arrives; the queue is flushed, the sink stopped, the next tick's digest is the pristine card's |
| No reappearance of a stopped stream | `Relay.aStoppedSessionNeverReappears…`, `EndToEnd.aStoppedStreamNeverReappears` | real: late AUs, a re-announcement, and a replay from a replacement producer |

**Red-first.** Fourteen mutations, each reinstating the specific defect a test is named for, and
each went red on that test. The run printed every record's age and exit code, so a stale result
could not pass for a fresh one. They are listed in the evidence folder. Two of them corrected a
test rather than the code:

- `explicitStopClearsOldPixelsAndReleasesEverything` first pressed Stop before any frame had reached
  the extension. It stayed green with the slot-clearing deleted (M1), because it never tested the
  state the rule exists for. It now has a frame on screen.
- An authorization test indexed `asked[0]`. Under a mutation that skipped the verifier, that crashed
  the whole test process and hid every other result. It uses `#require` now.

## Readings W1 took, which the proposal did not have

1. **One `CMIOExtensionProvider` per process.** A second one raises an NSException: "There should be
   only one CMIOProvider per extension." The tests make one provider (`Publishing.provider`) and
   build every other device directly.
2. **An unattached device crashes on `notifyPropertiesChanged` and on `stream.send`.** Both
   dereference a nil dispatch queue (SIGSEGV in `dispatch_async`). The device calls neither until it
   has been added to its provider (`attachedToProvider`).
3. **The CMIOExtension objects work in-process.** The provider, the device, both streams and their
   formats are real objects, and `send` returns. What does not exist in-process is the system's side:
   `cmioextension` loading the bundle, clients connecting, and the sink's cross-process transport.
4. **CoreMediaIO enumeration is readable from a plain process and starts nothing.** On this Mac it
   lists exactly one device, `FaceTime HD Camera`. That is the positive control for
   `CMIOSinkPort.start() == .deviceNotInstalled`.
5. **The decode stage's first bound was wrong.** An IDR arriving at a full stage flagged older items
   stale, but they stayed in their dispatch slots. A backlog grew by one per IDR, to **11 against a
   bound of 4**. The stage now owns its waiting list. The contract's other correction, that the decode
   stage never supersedes an AU (the H.264 reference chain), was made before the code.

## What W1 does not prove

- **That a signed, installed extension behaves like the in-process one.** That covers activation,
  `cmioextension` hosting, client fan-out and pacing, and whether meeting apps list the device.
- **That a Developer-ID-signed bridge passes `ProducerAuthorizer`.** No certificate exists, and the
  shipped `teamID` is `nil`, so every producer is refused: it fails closed. The real Security calls are
  proven against Apple and unsigned binaries only.
- **Proposal Q7, Q8 and Q9:**
  - Q7: whether sample-buffer attachments cross the sink;
  - Q8: per-client or per-transition `startStream`;
  - Q9: whether the sink makes the device "running somewhere".

  The design does not depend on any of them, and each needs a signed build.
- **`CMIOSinkPort`'s sink-stream path and `ConsumerWatcher`'s property listener.** Both compile. Neither
  has executed, because there is no device for them to find.
- **Anything about latency, CPU, frame rate or quality.** No figure in this package is a measurement
  of the product. The 1080p/30 figures are targets.

## Blocked, and the exact remaining steps

Nothing below is stubbed. Each step is blocked on something only the owner can approve, in the
order it would happen.

**Re-measured 2026-10-05** (`docs/camera-v2-signing-readiness.md` §8, read-only): Command Line Tools only,
no Xcode; **0** code-signing identities of any kind; no provisioning profiles; no extension bundle files
or activation code in the tree; SIP enabled; 0 system extensions. **The local activation test uses
Apple Development signing and needs no notarization; Developer ID is distribution only** — the rows
below say which. The paid Apple Developer Program is needed for both: System Extension and App Groups
have no free-account support.

| # | Step | Blocked on |
|---|---|---|
| 1 | Enrol in the **paid** Apple Developer Program (a free Apple ID cannot provision System Extension or App Groups); note the **Team ID** | B1 |
| 2 | Install full Xcode (provisioning, capability editor, the extension target) | B2 |
| 3 | In the developer portal, create these, with **Apple Development** profiles for the local test (this Mac registered as a device) and, later and separately, Developer ID profiles for distribution: <br>• App IDs `com.chetan.sidekick.desktop` (System Extension, App Groups) and `com.chetan.sidekick.desktop.camera` (App Groups) <br>• the app group `<TEAMID>.com.chetan.sidekick.camera` | B3 |
| 4 | Confirm the permanent identifiers in `Sources/WebcamCore/Identity.swift`: the device name, the device and stream UUIDs, the bundle ids and the bridge identifier | B4 |
| 5 | Set `SidekickCameraIdentity.teamID` to the Team ID. That is one line; the producer requirement then names it | 1 |
| 6 | Build the extension bundle. In an Xcode Camera Extension target compiling `Sources/WebcamExtension` + `Sources/sidekick-camera-extension`: <br>• `CFBundleIdentifier` `com.chetan.sidekick.desktop.camera`; <br>• `CMIOExtension` → `CMIOExtensionMachServiceName` = `<TEAMID>.com.chetan.sidekick.camera` (it must be prefixed by the app group); <br>• entitlements `com.apple.security.app-sandbox` and `com.apple.security.application-groups`, with **no** network or file entitlements; <br>• signed **Apple Development** with its development profile for the local test; Developer ID with its Developer ID profile only for distribution | 2, 3 |
| 7 | Sign the bridge (Apple Development locally; Developer ID for distribution) with identifier `com.chetan.sidekick.desktop.camera-bridge`, hardened runtime, no entitlements. Add the camera entitlement only if Q2 shows the sink needs camera TCC | 1 |
| 8 | Package with electron-builder: <br>• the extension in `Contents/Library/SystemExtensions/`, the bridge in `Contents/MacOS/`; <br>• `provisioningProfile`; <br>• app entitlements plus `com.apple.developer.system-extension.install` and the app group; <br>• **delete** `disable-library-validation`; <br>• replace `build/adhoc-sign.mjs` with inside-out signing (extension, bridge, Electron parts, app) — Apple Development for the local test, Developer ID for distribution | 1–7 |
| 9 | The activation call (`OSSystemExtensionRequest`) from Electron main (a small Node-API addon) or the bridge (proposal Q1); Settings → Camera install/uninstall UI with every delegate outcome named | 8; W4 |
| 10 | Electron main's half (W3): the `webcam.*` controller with consumer episodes and no automatic re-request, spawning the bridge, and the Camera pane's states | **built** (`desktop/src/main/webcam.ts`), development-gated |
| 11 | The phone's half (W2): the Camera2 → MediaCodec path, the 16-byte header against `docs/fixtures/webcam-au-v1.hex`, and the debug-only gate | **built** (`camera-module/…/webcam/`), debug-only; run on hardware in two supervised encoder spikes |
| 12 | Install the signed app in `/Applications` (B5). Activate it, and the admin approves it in System Settings → General → Login Items & Extensions → Camera Extensions | B5 |
| 13 | The §11.2 readings: <br>• activation from `~/Downloads` refused (`unsupportedParentBundleLocation`, the control) and then accepted from `/Applications`; <br>• `systemextensionsctl list`; <br>• Photo Booth and QuickTime list the device and show the camera-off card; <br>• **sink authorization**: the real bridge accepted, an ad-hoc binary with the same identifier refused and logged; <br>• Q7, Q8 and Q9; <br>• the consent flow end to end with Photo Booth; <br>• upgrade and uninstall | 12 |
| 14 | Meet and Zoom (§11.3): each call joined twice from this Mac, with the **viewer's tile** as the evidence; fill in the pre-registered table | B8, owner present |
| 15 | Notarize for distribution only — never needed for the local Apple Development test | B6 |
