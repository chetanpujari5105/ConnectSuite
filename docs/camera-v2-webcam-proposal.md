# Camera v2 — "Sidekick Camera", the phone as a Mac webcam: feasibility and architecture

**Status: revision 2, 2026-10-03.** Revision 1 was the plan. Revision 2 records the owner's decisions
below. W0 (the contract) and W1 (the Mac's Swift bridge and the extension's logic, run in-process) are
**approved**, and W1 is built and tested locally. **Nothing is signed, installed or activated, and no
capture was run.** Camera v1 (`docs/camera-v1.md`, `docs/protocol.md` → Camera) is not touched by
anything here.

**The contract is now `docs/protocol.md` → *Webcam*.** Where this file and that section disagree, the
contract wins: it was written after this file and corrects it in places (§7 lists them).

**The goal.** The Samsung's camera is selectable as **"Sidekick Camera"** in Google Meet, Zoom, FaceTime
and every other Mac app that lists cameras. Today it is viewable only inside Sidekick's Camera pane.

### Decisions, 2026-10-03 (owner)

| # | Decision | Effect on this plan |
|---|---|---|
| **B11** | **Approved:** a separate `webcam.*` namespace, with capability and version negotiation. Camera v1's public behaviour and the `camera.*` contract stay unchanged | §7; the contract is `docs/protocol.md` → *Webcam* |
| **B10 / D-2** | **Not approved for this version: the 10-second linger.** The phone's capture stops as soon as the last active webcam consumer closes. The virtual device may stay available, showing an honest camera-off placeholder | §6.3 becomes option A. Joining a meeting may take more than one tap; that cost is accepted |
| — | **Enumerating the device, opening it, or the meeting app's camera permission never counts as phone capture consent** | §6.1 rule 1. A consumer starting the device may *send a request*. Only the phone owner's tap starts capture |
| — | **Explicit Stop, disconnect, expired consent and privacy/lifecycle shutdown always stop immediately** | §6.2 |
| — | **No automatic capture restart, and expired consent is never reused** | §6.1. A session that ended for any reason other than its consumers leaving does not ask again by itself. The next request needs a new consumer episode or a person's click |
| W0, W1 | Approved; local only | §12. W2 onward needs separate approval |
| Not approved | Developer Program purchase, Xcode, signing, SIP or developer mode, install or activation, notarization, phone capture, USB tethering, live meeting tests, any change to Camera v1, release | unchanged blockers, §15 |

D-1 (the device is always present while the extension is active) and D-3 (the front camera is sent
unmirrored) were not separately decided. The contract carries both as written, and W5's compatibility
readings remain the place to revisit them.

---

## 0. Verdict

**Feasible, using only Apple's supported mechanism, and the blocker is an account rather than code.**

- A macOS **Core Media I/O Camera Extension** is the only supported way to publish a camera. It is a
  *system extension*, available since macOS 12.3.
  - The DAL plug-in route is gone. `docs/mac-audio-routes.md` §5 found `/Library/CoreMediaIO/Plug-Ins/DAL/`
    empty on this Mac, and OBS's own notes say DAL was deprecated in 12.3 and removed in 14.
- Installing one needs the **System Extension** and **App Groups** capabilities.
  - Apple's *supported capabilities (macOS)* table lists both under **ADP and Developer ID only**. A
    free Apple Account is not in either column.
  - So **nothing can be activated on this Mac until there is an Apple Developer Program membership**
    (B1).
  - The one alternative is `systemextensionsctl developer on`, which needs **SIP disabled**. That is a
    change to macOS security settings and is out of bounds for this brief. It is rejected in §3.5.
- **About 60 % of the work needs no account at all and can be built and tested on this Mac today.** That
  covers:
  - the phone's hardware-encoded camera stream;
  - the wire contract;
  - the Mac's decode bridge;
  - the extension's logic in-process;
  - every state machine and quality counter.

  Measured: the installed Command Line Tools SDK (macOS 26 SDK, Swift 6.3.2) typechecks a probe using
  `CMIOExtensionStream.Direction.sink`, `CMIOExtensionClient.signingID`/`.pid`,
  `OSSystemExtensionRequest.activationRequest`, `CMIOStreamCopyBufferQueue`, `CMIODeviceStartStream`,
  `VTDecompressionSession` and `kCMIODevicePropertyDeviceIsRunningSomewhere`. The control: the first
  attempt failed on a renamed Swift symbol, so the typechecker was actually reading the SDK.
  `Testing.framework` (Swift Testing) is present in the CLT, so `swift test` is available without Xcode.
- **What cannot be known before signing:**
  - whether Meet and Zoom accept the device;
  - real CPU and latency through `cmioextension`;
  - the approval UX on macOS 26.

  §11 pre-registers what each answer would mean.

**Not promised, anywhere in this document:** zero latency, zero frame drops, a fixed frame rate, or
1080p on every phone. 1080p/30 is a **target with a fallback ladder** (§8.3). Every number Sidekick
shows is a measurement with its unit and denominator (§10).

---

## 1. What was read and measured for this plan

| Reading | Result | Control / caveat |
|---|---|---|
| `sw_vers`, `uname -m` | macOS **26.6.1** (25G76), arm64 | — |
| `xcode-select -p`; `xcodebuild -version` | **Command Line Tools only; Xcode not installed** | `xcodebuild` refused with "requires Xcode", so this is an absence of Xcode, not a failed query |
| `security find-identity -v -p codesigning` | **0 valid identities** | matches `docs/phase-9-distribution-audit.md` D12/D14 (ad-hoc builds) |
| `systemextensionsctl list` | **0 extensions** | same reading as `docs/mac-audio-routes.md` on 2026-09-14 |
| `csrutil status` | **SIP enabled** | — |
| SDK frameworks | CoreMediaIO, SystemExtensions, VideoToolbox, IOSurface **present**; `CMIOExtension*.h` headers present | — |
| Swift typecheck probe (scratchpad, never run) | **passes** for every symbol listed in §0 | first attempt **failed** on `CMIOExtensionStreamDirection` → renamed `CMIOExtensionStream.Direction`, so the check can fail |
| `CMIOExtensionClient` header | exposes `clientID`, `signingID` (macOS 13+), `pid`, **no audit token** | relevant to sink authentication, §6.4 |
| Apple: *Creating a camera extension with Core Media I/O* | macOS 12.3+; provider/device/stream model; *"Only apps that reside in the `/Applications` directory can activate an extension"*; admin approval in System Settings | — |
| Apple: *Debugging and testing system extensions* | extensions live in `Contents/Library/SystemExtensions`; developer mode lifts the location check | developer mode requires SIP disabled (multiple secondary sources); rejected |
| Apple: *Supported capabilities (macOS)* | System Extension and App Groups: **ADP, Developer ID** | read through a summariser; re-read it on the day the account exists |
| macOS 15+ approval location | System Settings → General → **Login Items & Extensions → Camera Extensions** | vendor guides (OBSBOT, mimoLive, OBS forum); on 26 it is unread |
| Licences (GitHub API) | Halle/SinkCam **MIT**, last push 2026-05-18; ldenoue/cameraextension **MIT**, 2022-07-04; obs-studio **GPL-2.0**; scrcpy **Apache-2.0** | this repo has **no LICENSE file**, which makes the GPL question sharper, §13 |
| Repo | v1 = CameraX `ImageAnalysis` → NV21 → JPEG, 960 × 720, 15 fps cap, port 42502 by claim, foreground-only, debug-only; mirror = MediaCodec H.264 surface encoder (`ScreenEncoder.kt`) with Annex B and an IDR-on-request path; Mac WebCodecs decoder `H264Canvas` | — |

---

## 2. Architecture

```
 PHONE (SM-S938B)                                MAC
 ┌─────────────────────────┐   TLS 1.3, 42502    ┌──────────────────────────────────────────────┐
 │ Webcam screen (fg only) │   claim "webcam"    │ Sidekick.app  (in /Applications, signed)      │
 │  Camera2/CameraX ──┐    │ ══════════════════▶ │  Electron main: owns the socket (rule)        │
 │  preview surface   │    │  H.264 AUs + 24-B   │    │ length-prefixed AUs, bounded, latest-wins │
 │  MediaCodec surface┘    │  header per AU      │    ▼ (Unix-domain socket, 0600, per-launch)   │
 │  HW H.264 encoder       │                     │  Sidekick Camera Bridge (Swift helper):        │
 │  webcam.* on 42501 ◀───▶│ ◀═══ control ═════▶ │    VTDecompressionSession → IOSurface NV12    │
 └─────────────────────────┘                     │    rotate/scale (VTPixelTransfer/Rotation)    │
                                                 │    CMSimpleQueueEnqueue → SINK stream ─┐      │
                                                 │  Contents/Library/SystemExtensions/    │      │
                                                 │   Sidekick Camera.systemextension ◀────┘      │
                                                 │    (sandboxed, run by the system as           │
                                                 │     _cmiodalassistants, not as the user)      │
                                                 │    SOURCE stream "Sidekick Camera" ──▶ Meet,  │
                                                 │    paced at the client's chosen rate   Zoom,  │
                                                 │                                        FaceTime│
                                                 └──────────────────────────────────────────────┘
```

### 2.1 Who owns what

| Process | Owns | Must not |
|---|---|---|
| Phone | consent, camera, encoder, stop authority, thermal step-down | send a frame before the tap or after any end (v1 rules 1–4 carried over verbatim) |
| Electron main | the TLS socket, `webcam.*` control, the session state machine, the bridge's lifetime, the UI's truth | decode video, or hold more than a bounded number of access units (AUs) |
| Bridge helper | H.264 decode, rotation, scaling, the sink feed, quality counters | open any network socket; it reads only its parent's Unix socket |
| Camera Extension | publishing the device, format negotiation, pacing the source stream, placeholder frames, **authenticating its sink client** | reach the network, read the user's files, or start anything. It cannot: it is sandboxed and runs as another user |
| Renderer | drawing state; a preview of the same decoded stream (optional, §8.5) | touch sockets (existing rule) |

### 2.2 Why this shape, and what each alternative was rejected for

| Alternative | Rejected because |
|---|---|
| Decode in the renderer with WebCodecs (as the mirror does), then hand pixels to native | 1080p NV12 is ~3.1 MB/frame; at 30 fps that is ~93 MB/s copied out of Chromium and through IPC. The IOSurface route moves a mach port, not pixels |
| The extension connects to the phone itself | It is sandboxed and runs as `_cmiodalassistants`, so it has no access to the user's Keychain or TLS identity. It would also break locked decision #2 / *sockets live in the main process* |
| The extension reads frames from an app-group container or shared memory | Different user, and the extension's sandbox profile is camera-specific. Halle's write-up (theoffcuts.org part 2) found app-group and XPC routes unreliable for exactly this reason. The **sink stream** is the mechanism Apple's sample and every maintained implementation use |
| A Node-API addon doing the decode inside Electron main | It works, but a VideoToolbox or CMIO fault would take down the process holding every link socket. It also needs `node-gyp` against Electron's ABI on every Electron bump. A separate Swift helper is crash-isolated, builds with `swiftc`/SwiftPM from the CLT, and is testable with fixtures and no Electron. **The activation call may still need a tiny addon (§3.3).** |
| A DAL plug-in | Removed in macOS 14; nothing loads it |
| Keep JPEG (v1) and feed the extension | At 1080p/30, v1's per-pixel NV21 loop plus software JPEG is the work most likely to heat the phone, and JPEG at q70 costs roughly 5–10× H.264's bitrate. v1 rejected H.264 only because CameraX could not feed both a preview and a MediaCodec surface without a GL pipeline. Camera2's guaranteed `PRIV PREVIEW + PRIV RECORD` stream combination removes that reason, §8.2 |

---

## 3. How the extension fits the Electron app

### 3.1 Bundle layout

```
/Applications/Sidekick.app/Contents/
  MacOS/Sidekick                                 Electron
  MacOS/Sidekick Camera Bridge                   Swift helper (signed, hardened runtime)
  Library/SystemExtensions/
    com.chetan.sidekick.desktop.camera.systemextension/   ← the Camera Extension
  embedded.provisionprofile                      Developer ID profile carrying system-extension.install
  Frameworks/…                                   Electron (unchanged)
```

electron-builder does not know about system extensions. The work is:

- `extraFiles`/`afterPack` places the prebuilt `.systemextension` and the helper.
- `provisioningProfile:` embeds the profile.
- Entitlements per component (§4).
- **The existing `build/adhoc-sign.mjs` inside-out signer is replaced by Developer ID signing** in the
  same order. The extension is signed first, then the helper, the Electron components, and the app last.
- `com.apple.security.cs.disable-library-validation` is **deleted** in the same change, as
  `entitlements.mac.plist` already instructs (D14).

### 3.2 Building the native parts

| Part | Build | Needs Xcode? |
|---|---|---|
| Bridge helper | SwiftPM or `swiftc`, CLT SDK | **No** — verified by typecheck |
| Extension (code) | `swiftc` against CoreMediaIO, packaged as a bundle with an `Info.plist` carrying `CMIOExtension` → `CMIOExtensionMachServiceName` (must be prefixed by the app group) | **No** to compile |
| Extension (provisioned, signed) | provisioning profile + Team ID + app group | **Practically yes** — Xcode's automatic signing and capability editor are the supported path. A manual `codesign` + downloaded profile is possible but fragile. Recommend installing Xcode (B2) |
| Activation shim | ~80 lines of Objective-C in a Node-API addon, or the helper (§3.3) | No |

The native parts get their own `npm run build:native` step, with **pinned build outputs checked by
SHA-256 in CI-equivalent hooks** in the same way as everything else here. A suite that is not run is
invisible in a green (`check-suites-run.mjs`), so the Swift suite gets a third leg in that guard.

### 3.3 Activation, and the open question about who calls it

`OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier:queue:)` must come from a
process whose **main bundle contains the extension**, and which carries
`com.apple.developer.system-extension.install`.

- **Recommended:** a minimal Node-API addon in Electron main. Main *is* `Sidekick.app`, which carries
  the profile and the entitlement.
- **The alternative** is to call it from the helper. A bare executable in `Contents/MacOS` resolves
  `Bundle.main` to the enclosing `.app`, but restricted entitlements on a bare executable are a known
  trap: a profile cannot be embedded in a non-bundle.
- This is **Q1**, answerable only with a profile. It is the first thing Phase W4 tests.

The delegate's results each get a distinct, logged, user-visible state, never one "failed":

| Delegate outcome | Sidekick says |
|---|---|
| `requestNeedsUserApproval` | "Allow Sidekick Camera in System Settings → General → Login Items & Extensions → Camera Extensions", plus a button that opens that pane |
| `.completed` | "Sidekick Camera is installed" |
| `.willCompleteAfterReboot` | "Finishes after a restart". Honest, and it happens on replacement |
| `didFailWithError` | the `OSSystemExtensionError` code by name (e.g. `unsupportedParentBundleLocation` = not in `/Applications`, which is the most likely first failure) |
| replacement (`actionForReplacingExtension`) | replace only when `CFBundleVersion` increased, logged with both versions |

**Activation is user-initiated** (a button in Settings → Camera). Sidekick never activates silently on
launch. Uninstall is a deactivation request behind a button, plus a documented manual path
(`systemextensionsctl` is read-only for users; deleting the app from Finder prompts on recent macOS,
and OBS issue #9714 shows what happens without a deactivation button).

### 3.4 What exists while Sidekick is not running

The device stays published while the extension is active, whether or not Sidekick is open (§6.1). The
extension cannot launch Sidekick. So "Sidekick Camera" selected with Sidekick closed shows the
**"Open Sidekick on this Mac"** card. That is truthful, and it is the only thing the extension can know
in that state.

### 3.5 Development without an account: considered and rejected

`systemextensionsctl developer on` lets extensions load from anywhere, but it requires **SIP disabled**.
That changes macOS security settings, which this brief rules out, and it would also give a development
loop that differs from the shipping one in the exact layer under test (signing and activation). The
pre-account phases (W0–W3) therefore test the extension's **logic in-process** (§11.1). Activation
waits for B1.

---

## 4. Entitlements, signing and approvals

| Component | Entitlements | Signing |
|---|---|---|
| `Sidekick.app` (Electron) | existing hardened-runtime set (JIT, unsigned-exec-memory, dyld-env, network.client, files…) **minus** `disable-library-validation`, **plus** `com.apple.developer.system-extension.install`, `com.apple.security.application-groups = [<TEAMID>.com.chetan.sidekick.camera]` | Developer ID Application, profile embedded |
| Bridge helper | hardened runtime; `com.apple.security.device.camera` **only if Q2 shows the sink client needs camera TCC** (unknown, §14). The default is none | Developer ID, same Team ID |
| Camera Extension | `com.apple.security.app-sandbox`, `com.apple.security.application-groups` (same group). **No network, no file entitlements.** Camera entitlement not needed: it captures nothing | Developer ID, same Team ID, its own profile |
| Distribution | notarization of the `.dmg`/`.zip` (an outbound upload of the whole binary, B6), stapling | — |

Approvals that only a person can give, in order:

1. Admin approval of the extension in System Settings, once per Mac.
2. Each meeting app's **own** macOS camera permission (Chrome, zoom.us). This is unchanged by us, and
   already granted on most Macs.
3. **The phone owner's tap, per webcam session (§6).** No Mac-side approval substitutes for it.

---

## 5. Publishing "Sidekick Camera"

### 5.1 The device

- `localizedName` **"Sidekick Camera"**, manufacturer "Sidekick", and a **stable `deviceID` UUID**
  hard-coded in the extension. Apps remember the selection by ID, so this must never change.
- **Always present while the extension is active.** It is not added and removed with the phone
  connection: several apps handle camera hot-plug badly, and a device that disappears mid-call is worse
  than one that shows a truthful card. This is pre-registered as decision D-1, revisitable after W5's
  compatibility readings.
- Transport type: virtual. No microphone (v1 rule 5), so no audio device is published.

### 5.2 Formats advertised

- `420v` (NV12 video range), **1920 × 1080 and 1280 × 720, each at 30 fps**, with min/max frame duration
  allowing 15–30.
- Clients pick the format, and the extension cannot make Meet choose 1080p. So the extension
  **scales the newest decoded frame to the client's chosen format** with `VTPixelTransferSession`, and
  reports the scale it applied (§10). A 720p phone stream into a 1080p client format is labelled
  **upscaled**, never "1080p".
- 4:3 is not advertised. The phone captures 16:9 directly (§8.4).

### 5.3 What the picture is, in every state

These cards are **seen by other people in the meeting**. They name no phone, person or network, and
they never claim live video.

**Revision 2 cuts the seven cards of revision 1 to two.** The extension may only show what it can
know for itself. It can know two things: whether an authorized producer is feeding it frames of a live
session, and how old the newest frame is. "Waiting for approval", "phone not connected" and "open
Sidekick" are facts held by Electron main. Showing them would need an extra channel into the extension,
and every channel into it is an injection surface (§6.4). Those states belong in the Mac's Camera pane,
which the Mac's owner is looking at. The meeting sees "camera off", which is true in every one of them.

| State | Card text | Frames |
|---|---|---|
| Every state with no live session: Sidekick not running, no phone, waiting for approval, declined, stopped by any route, an older phone | "Sidekick Camera — camera off" | placeholder at the client's rate |
| Live | the camera | decoded frames |
| A live session, but no fresh frame for > 1.0 s (pre-registered; v1 used 2 s for its own pane). This includes a camera switch | "Sidekick Camera — video paused" | placeholder. **Never the frozen last frame labelled as live** (defect 172's lesson) |

The placeholder is NV12 rendered once per card and per format, and cached. It costs nothing per frame.
A stop **replaces** the latest-frame slot with nothing. The next tick draws the card, never the last
frame of the ended session.

---

## 6. Consent, session binding, and Stop

### 6.1 The rules, carried from v1 and extended

1. **A Mac app opening Sidekick Camera never opens the phone's camera.** It may cause a *request*,
   and only the phone owner's tap answers it. Enumerating the device, opening it, or the meeting app's
   own camera permission never counts as consent (owner's decision, 2026-10-03).
   - The extension counts its **source** stream's starts and stops, and publishes the count as a
     read-only custom property.
   - The bridge reads that property through CMIO and reports it to Electron main.
   - Main sends `webcam.request` when a **consumer episode** begins: the count going from 0 to 1.
   - Revision 1 used `kCMIODevicePropertyDeviceIsRunningSomewhere` here. Revision 2 does not, because
     whether the bridge's own *sink* stream also makes the device "running somewhere" is unread (Q9).
     If it did, the bridge's feed would look like a consumer and keep the session alive with nobody
     watching.
2. **Consent is per webcam session and never stored.** A session starts at the tap. It ends at the first
   of these:
   - phone Stop;
   - leaving the phone's webcam screen;
   - Mac Stop;
   - disconnect (either side);
   - **the last consumer leaving: at once, with no linger** (§6.3, owner's decision);
   - the request expiring unanswered;
   - thermal critical;
   - a privacy or lifecycle shutdown on the Mac (sleep, screen lock, fast user switch, Sidekick
     quitting).

   A new session needs a new tap.
3. **Nothing restarts by itself.** A session that ended for any reason other than its consumers leaving
   **spends** the consumer episode it belonged to. While that episode lasts, the Mac sends no further
   request on its own. The next request comes only from a new episode (every consumer gone, then one
   back) or from the person clicking **Ask phone** in the Camera pane. Reconnecting after a disconnect
   asks for nothing. Consent never carries across sessions, so there is nothing to reuse.
4. **No frame before the tap, none after the end**, enforced on the phone (the authority) and again on
   the Mac, twice. The bridge drops any AU whose `sessionId` and generation are not current. The
   extension then refuses any frame of a session it has seen end.
5. **Foreground only, as v1.** The phone's webcam screen stays visible with `keepScreenOn`. No
   `camera`-type foreground service, no lock-screen capture. The phone's own green privacy dot is
   visible throughout.

### 6.2 Stop must be immediate, measured from both ends

| Trigger | First action | Pass criterion (to be measured, not promised) |
|---|---|---|
| Phone **Stop** / Home / lock / screen off | phone closes the camera *first*, then reports | camera dot off ≤ 1 s; the Mac card turns to "camera off" within one frame interval of the `webcam.state stopped` arrival |
| Mac **Stop** (Camera pane, tray item "Stop Sidekick Camera", menu-bar extra) | `webcam.stop` + socket close (v1's ordering and defect 167's re-attribution rule apply) | phone camera released ≤ 1 s; 0 frames drawn into CMIO after the Stop |
| Disconnect (tray, network loss, phone app killed) | each side ends locally on socket loss | card within the stall threshold plus one frame; phone camera released ≤ 1 s |
| Meet/Zoom closes the device (last consumer) | `webcam.stop` `no-consumers` **at once**. The bridge stops feeding on the same reading, without waiting for main | as Mac Stop |
| Mac sleep, screen lock, fast user switch | `webcam.stop` `shutdown` at once | as Mac Stop |
| Sidekick quits / crashes | the extension loses its sink client → card at once; the phone sees the socket close | the camera releases on the phone side whether or not Sidekick said goodbye |

The ceiling the supervised tests arm (as v1's driver does): any frame after any end is a failure that
stops the sitting.

### 6.3 D-2, decided: no linger (option A)

**Decided 2026-10-03: option A for this version.** The last consumer leaving ends the session at once.
Option B, the 10-second linger, is **not enabled** and is not built behind a flag. Revisiting it needs
W5's measured open/close counts *and* a new decision. The cost is the one revision 1 predicted: Meet and
Zoom may open and close the device more than once while joining, and each new episode is a new request
and a new tap. W5 records how many.

Revision 1's analysis, kept for the record:

Meet and Zoom open and close a camera several times before a call: device enumeration, the pre-join
preview, then join. If every close ends the session, the owner taps the phone three times to join one
meeting. Three options:

| Option | Behaviour | Cost |
|---|---|---|
| **A — no linger** | every client close ends the session | repeated taps; most honest |
| **B — short linger (recommended: 10 s)** | after the last client leaves, the *same* stream stays live for ≤ 10 s with the phone screen reading "No app is using the camera — stopping in N s", then ends | the camera is on with no consumer for ≤ 10 s; visible on the phone |
| C — "keep ready" | stream stays up until explicitly stopped | a camera held open for no one; rejected, as v1 rejected it |

B is not stored consent. It is the same stream not yet ended, and it is visible on the phone the whole
time. *(Revision 1's recommendation. Not adopted; see the decision above.)*

### 6.4 The sink is an injection surface, and it is closed

Halle's SinkCam README warns that any process aware of a sink can feed it. The extension therefore
starts its sink only for a client whose:

- `signingID` equals the bridge helper's identifier, **and**
- process passes a code-signing requirement pinned to our Team ID:
  `anchor apple generic and certificate leaf[subject.OU] = "<TEAMID>"`, checked via
  `SecCodeCopyGuestWithAttributes` on the client's `pid`.

Every refusal is logged with the signingID it refused.

**Until a Team ID exists, the requirement names none, and the extension refuses every producer.** It
fails closed: it never falls back to trusting `signingID`. W1's tests exercise the real
`SecCodeCopyGuestWithAttributes` and `SecCodeCheckValidity` calls against real processes. An Apple
platform binary satisfies `anchor apple` (the positive control), and the test process satisfies no Team ID
requirement. That proves the call path and the requirement evaluation. **It does not prove that a
Developer-ID-signed bridge is accepted**, because no such certificate exists yet. That reading is §11.2
item 3.

`signingID` alone is spoofable by any ad-hoc-signed binary choosing the same identifier.
`CMIOExtensionClient` exposes a `pid`, **not an audit token**, so a PID-reuse race remains in
principle. That race is recorded as residual risk R-1 rather than claimed closed.

The source side is the ordinary webcam model: any app the user has granted camera access can open
Sidekick Camera. The phone tap is the gate on what that app can receive.

---

## 7. Wire contract

**Superseded by `docs/protocol.md` → *Webcam* (W0, 2026-10-03).** The contract differs from the text
below in six places, each for a reason:

1. **No `webcam.quality` message.** Nothing measures quality until W2. A message specified before
   anything can fill it is a contract section no end can send, so it is added with W2's first reading.
2. **The per-AU header is 16 bytes, not 24.** The video channel's 13-byte frame header already carries
   the capture PTS (the phone's monotonic µs, the `pong` clock). A second timestamp would be the same
   fact twice, and two copies of one fact drift.
3. **Version negotiation is the `ext` key `webcam: 1`, beside the capability.** It is the mechanism
   `share.*` already uses. The capability says *built and allowed*; the version says *which messages*.
4. **The bridge's channel to Electron main is the child process's stdin and stdout.** There is no
   Unix-domain socket in the filesystem, so there is nothing for another process to connect to.
5. **`webcam.stop` carries a `cause`** (`person`, `no-consumers`, `shutdown`), so the phone can say *why*
   its camera turned off.
6. **The consumer signal is the extension's own source-stream count**, not `DeviceIsRunningSomewhere`
   (§6.1 rule 1, Q9).
7. **The bridge's decode stage never supersedes an access unit.** §8.6's "newest replaces the waiting
   one" would break H.264's reference chain. AUs are decoded in order, and only decoded frames are
   replaced. A drop recovers at the phone's next periodic IDR (target 2 s); there is no keyframe request
   in version 1.

The rest of this section is revision 1's draft, kept for the reasoning.

v1's `camera.*` is left byte-for-byte alone. v2 is a **separate capability `webcam`**:

- messages `webcam.request` / `webcam.state` / `webcam.stop` / `webcam.switch` / `webcam.quality`;
- claim word **`webcam`** in the 42502 token frame.

`SideChannelClaim` gains one word additively, and v1's golden fixtures (`camera-frame-v1.hex`) are the
regression guard that proves v1 unchanged. Same consent rules as §6.1. `webcam.request` carries which
client apps opened the device (from `CMIOExtensionClient.signingID`, resolved to a display name). That
lets the phone say "Zoom wants to use your camera on Chetan's MacBook Pro". Without it the phone could
only say "a Mac app", which is the package-id-in-prose rule pointed at Mac apps. This field is Phase
W5, not MVP.

**The per-AU header, 24 bytes, in-band**, for the same two-clock reason v1 carries orientation in-band:

| Field | Bytes | Why |
|---|---|---|
| magic + version | 2 | strict reader, as v1 |
| flags (key, config, discontinuity) | 1 | IDR rules |
| rotation (0/90/180/270) + facing | 1 | applied on the Mac by `VTPixelRotationSession`; MediaCodec cannot rotate |
| epoch | 2 | a camera switch increments it; old-epoch AUs are dropped |
| sequence | 4 | gaps are counted, not guessed |
| capture time (phone `SENSOR_TIMESTAMP`, µs) | 8 | latency measurement (§10.2) |
| length | 4 | checked against a cap before reading, as v1 M9 |

---

## 8. The media path

### 8.1 Hardware-encoded H.264, not the v1 JPEG preview

**Decision: yes, reuse hardware encoding.** The *mirror's* encoder knowledge is reused, not v1's JPEG
path:

- MediaCodec AVC;
- `KEY_LATENCY = 1`, `KEY_PRIORITY = 0`;
- Annex B with SPS/PPS in-band before every IDR;
- IDR on request;
- the drop-until-keyframe rule.

The Mac's `H264Canvas` already proves Annex-B parsing against this phone.

**Rejected for MVP:** HEVC (Zoom and Meet never see our codec, so HEVC buys only link bitrate, and it
adds a second decoder path) and AV1 (encoder availability). HEVC is revisited only if W5 shows the Wi-Fi
link is the bottleneck.

### 8.2 Phone capture stack (decision by spike, pre-registered)

| Option | How | For | Against |
|---|---|---|---|
| **P1 — Camera2 directly (recommended)** | one `CameraCaptureSession` with two outputs: the on-screen preview `SurfaceView` and the encoder's `createInputSurface()` | `PRIV PREVIEW + PRIV RECORD` is a **mandatory stream combination for every camera device**, so the platform guarantees it; zero-copy into the encoder; scrcpy's camera source is the precedent (Apache-2.0, design reference only) | a second camera stack beside CameraX (v1 and the QR scanner keep CameraX; this is scoped to a new module) |
| P2 — CameraX `Preview` + `CameraEffect`/GL to fan out to the encoder surface | GL pipeline | stays on CameraX | exactly the "second architecture" v1 refused; more code than P1 |
| P3 — CameraX `ImageAnalysis` YUV → MediaCodec ByteBuffer input | CPU copy of ~3 MB/frame | smallest change from v1 | per-frame CPU copy at 1080p/30 is the heat source P1 avoids |

**Spike W2-S1 decides it, with criteria fixed now:** P1 wins if it holds 1080p/30 encoder output
(measured from encoder output timestamps, with elapsed time beside the count) for 10 minutes on the
SM-S938B with lower phone CPU than P3. If P1 fails on this device, P3 is the fallback. P2 is used only
if both fail.

### 8.3 1080p/30 target and the fallback ladder

| Rung | Size | fps | Starting bitrate |
|---|---|---|---|
| 0 (target) | 1920 × 1080 | 30 | 8 Mbit/s |
| 1 | 1280 × 720 | 30 | 4 Mbit/s |
| 2 | 1280 × 720 | 24 | 3 Mbit/s |
| 3 | 960 × 540 | 15 | 1.5 Mbit/s |

- **Down** on any of these, each logged with its cause:
  - phone `PowerManager` thermal status ≥ `MODERATE`;
  - encoder output < 90 % of target fps over a 5 s window;
  - link drops > 5 % of AUs over 5 s;
  - Mac decode p95 > one frame interval.
- **Up** only after 30 s clean (hysteresis).
- A rung change that needs a new encoder size is a reconfigure with an IDR. Bitrate alone changes live
  via `PARAMETER_KEY_VIDEO_BITRATE`, as the mirror already does.
- `THERMAL_STATUS_CRITICAL` ends the session with its own reason ("the phone is too hot").
- Whether rung 0 is reachable at all on this phone is a **reading** (W2). If the camera does not offer
  1920 × 1080 as a `PRIV` output with 30 fps in its stream configuration map, the plan starts at rung 1
  and says so.

### 8.4 Orientation, mirroring, aspect

- The **output is always landscape 16:9**, because meeting apps expect it.
  - Phone in landscape: upright fill.
  - Phone in portrait: the upright portrait image **pillarboxed** in the 16:9 frame, never cropped to a
    sliver.
  - The rule is in the header and applied on the Mac, so it is one place, tested.
- **Front camera is sent unmirrored.** Meet, Zoom and FaceTime mirror the *self-view* locally and send
  the unmirrored image. Mirroring in the source would make text read backwards for everyone else. This
  **differs from v1's pane**, which mirrored the front camera like the phone's preview, and is
  deliberate. Recorded as D-3.
- Capture is 16:9 from the sensor (a 16:9 `PRIV` size), so the field of view matches between the
  phone's preview and the Mac.

### 8.5 Camera switching

`webcam.switch {facing}` from the Mac, or the phone's own Switch button:

- the camera session reopens and the generation increments (revision 1 called it the epoch);
- the encoder reconfigures if the size differs, and the first AU is an IDR;
- the Mac holds the last frame ≤ 500 ms, then shows the "switching" card, counted.

Same consent: a switch stays inside the approved session (v1's P5).

### 8.6 Bounded buffering, end to end

| Stage | Bound | Overflow rule |
|---|---|---|
| Phone encoder output → socket | 2 AUs in flight + the current GOP's reference chain | on backpressure, drop **all** non-IDR AUs until the next IDR, then request one; count `dropped_backpressure` |
| Electron main → bridge | 4 AUs | same keyframe rule; count `dropped_bridge` |
| Bridge decode | 1 in flight, 1 waiting | the newest decoded frame replaces the waiting one; count `superseded` |
| Extension | **one** "latest frame" slot | each source tick sends the latest frame; no new frame → `repeat` (≤ stall threshold) |

There is no unbounded queue anywhere, so latency can only fall behind by dropping, and every drop is
counted at the stage that made it.

---

## 9. Transport: Wi-Fi, and the truth about USB

### 9.1 What carries the video

The existing TLS 1.3 link over the local network: Wi-Fi, or the phone's hotspot. Locked decisions #2
and #3 are unchanged. 8 Mbit/s at rung 0 is within what the mirror already carries.

### 9.2 USB: the options, honestly

| Route | Status here |
|---|---|
| ADB forward/reverse | **Forbidden** (locked decision #1) |
| **USB tethering** (phone as a USB network adapter) | Works with zero new transport code **if macOS gets a network interface**. macOS has a native CDC-NCM driver and **no RNDIS driver**. Which one One UI 8 / Android 16 presents on this phone is **unread**. **Side effect to warn about:** the Mac may route its internet through the phone's mobile data |
| Android Open Accessory (AOA) | A real USB transport without ADB: the Mac (IOKit/libusb) switches the phone to accessory mode, and the phone shows a one-time prompt. It is a whole new transport (TLS over a bulk endpoint) and re-enumerates the USB device, which disturbs the development `adb` link. **Deferred to its own proposal** |

### 9.3 "USB is plugged in" is never shown as "video over USB"

- Sidekick reports the **route the socket actually uses**: the TLS socket's local address → interface
  (`os.networkInterfaces()`) → hardware-port type (SystemConfiguration, read-only).
- The label is one of **"Wi-Fi (en0)"**, **"USB network (enN)"** or **"Network (enN)"**.
- "USB network" requires the interface's hardware port to be a USB-class Ethernet/NCM port **and** the
  peer address to be the phone's on that interface.
- **The phone being on the USB bus** (IOKit sees it, it is charging, `adb` sees it) is a separate fact.
  It is never used for the label. The pairing is tested with a control: cable in plus tethering off
  must read "Wi-Fi".

---

## 10. Truthful quality reporting

### 10.1 What Sidekick shows, with units and denominators

The Camera pane and a `webcam.quality` log line every 5 s:

- **Phone**:
  - capture size;
  - encoder fps out (frames / elapsed s);
  - bitrate (bytes / elapsed s);
  - rung and why;
  - thermal status.
- **Link**: AUs sent / received / `dropped_backpressure`, by window.
- **Mac bridge**: decoded / `superseded` / decode errors; decode time p50/p95.
- **Extension**:
  - frames delivered to clients split **fresh / repeat / held / placeholder**, against ticks;
  - the client-chosen format;
  - scale applied ("upscaled 1280×720 → 1920×1080").
- **Route** (§9.3).
- **Latency** (§10.2), only with its error bound.

Wording rules:

- Never "1080p" when the phone sends 720p.
- Never "30 fps" as a setting. The measured fresh-frame rate is what is shown.
- A failure counter never appears without its success counter (`CLAUDE.md` rule).

### 10.2 Latency, measured not asserted

- **Phone-capture → Mac-delivered**: header `SENSOR_TIMESTAMP` → bridge enqueue time. The two clocks
  are related by a ping exchange on the control channel (min-RTT offset), and shown as **"≈ N ms
  (± RTT/2)"**. Without a current offset estimate, no number is shown.
- **Glass-to-glass** (a test, not a UI number): a millisecond counter on the Mac screen, filmed by the
  phone, appears in Meet's self-view, and one screenshot holds both. Median and p95 over ≥ 30 samples,
  with the display refresh interval stated as the bound.

---

## 11. Test plan

### 11.1 Local — buildable and runnable on this Mac today (no account, no install)

- **Phone (JVM, Gradle):**
  - the webcam session machine: v1's privacy rules P1–P14 restated for `webcam`, plus the immediate
    no-consumers stop (no linger), thermal end and generation;
  - header codec with a golden fixture `docs/fixtures/webcam-au-v1.hex` shared with the Mac;
  - the ladder's decisions as a pure function over measured windows;
  - every rule red-first by mutation, as in v1.
- **Mac (`npm test`):**
  - the controller (request on a consumer episode, no automatic re-request, the immediate
    no-consumers stop, stop ordering, re-attribution);
  - the AU reader (fuzz + golden);
  - route labelling, with a fixture for "cable in, tethering off → Wi-Fi";
  - the quality line.
- **Bridge (Swift, `swift test` with Swift Testing from the CLT):**
  - decode **recorded** H.264 fixtures (generated on the Mac with VideoToolbox's encoder, so no phone is
    needed) to IOSurface NV12;
  - rotation/pillarbox/scale matrix;
  - bounded-queue and keyframe rules;
  - the Unix-socket framing.
- **Extension logic in-process:**
  - the `CMIOExtensionDeviceSource`/`StreamSource` objects are plain Swift, so a test harness
    instantiates them **without the system**, drives ticks, and asserts fresh/repeat/placeholder
    selection, stall threshold, format scaling and sink-client authorisation decisions (the Offcuts
    "end-to-end testing app" approach). This tests the logic, **not** `cmioextension` delivery, and the
    record will say so.
- **Real TLS loopback** for the 42502 `webcam` claim, as `cameraTransport.test.ts` does for v1.

### 11.2 Needs a signed build, an install to `/Applications`, and approval (after B1–B5)

1. **Activation outcomes:**
   - from `~/Downloads` → expect `unsupportedParentBundleLocation`, which is the control that the
     location check is live;
   - then from `/Applications` → `requestNeedsUserApproval` → approve → `.completed`;
   - `systemextensionsctl list` shows it `[activated enabled]`.
2. **Device visible, apps as controls first:** Photo Booth and QuickTime → New Movie Recording list
   "Sidekick Camera". Then the placeholder card is visible with Sidekick closed.
3. **Sink authentication:**
   - the real bridge → accepted;
   - a second ad-hoc binary with the same `signingID` → **refused**, and logged.

   This is the control that the Team-ID check is doing the work rather than the identifier.
4. **Consent flow end to end** with Photo Booth: open → phone request → tap → live → each §6.2 trigger,
   each with v1-style bounds and a 20 s capture cap armed at live.
5. **Upgrade and uninstall:** a bumped `CFBundleVersion` replaces it (record whether a reboot was
   demanded); deactivate → the device disappears.

### 11.3 Compatibility — Meet and Zoom

The far end is the reading, because self-view is local and proves nothing about what was sent. Each
call is joined **twice from this Mac**: the Sidekick Camera participant (Chrome) and a viewer
participant (Safari, or a second Chrome profile). The viewer's tile is the evidence.

| App | Pass |
|---|---|
| Photo Booth, QuickTime | control: the system path works |
| **Google Meet in Chrome** | listed; selected; viewer sees live video; the format Chrome negotiated recorded |
| Google Meet in Safari | same |
| **Zoom (desktop app)** | listed; selected; viewer (Zoom web client in a browser) sees live video |
| FaceTime | listed and live (FaceTime to own Apple ID devices, if available) |
| Teams, Slack huddles, OBS | optional, informational |

The pre-registered table for these:

| Outcome | Meaning | Product |
|---|---|---|
| listed and live everywhere | the extension path works | ship behind the gate |
| listed in Apple apps, not in Zoom/Meet | app-side filtering (Zoom has historically gated virtual cameras) | report per app, name it in Sidekick's help; **no workaround that impersonates a hardware camera** |
| not listed anywhere | activation/publishing defect | W4 not passed |
| listed, but black or frozen at the far end | pacing or format bug | W5 not passed. The far-end tile is the only test that sees this |

Each app's open/close count during join is recorded. It is the reading any future revisit of D-2 would
need; D-2 is decided as no linger for this version.

### 11.4 Long-session hardware runs (owner present, approved per sitting)

- **60 min Meet call at rung 0** with the phone **on battery, cable out**. `docs/testing.md` row 10
  shows USB keeps charging, so a tethered run measures nothing about drain. Read `dumpsys battery` and
  `dumpsys thermalservice` at start and end, and the rung timeline.
- **Latency** (§10.2) at minutes 1, 30, 60: does it grow? Growth with bounded queues means a clock or
  pacing bug, not a buffer.
- **Frame accounting**: fresh/repeat/placeholder against ticks, and phone sent vs Mac received vs
  delivered, with every denominator.
- **Mac CPU**: `top -l` for the helper, Electron main and `cmioextension`/the extension process,
  sampled every 10 s (no `sudo`, no `powermetrics`).
- **Wi-Fi only**, then (if the §9.2 reading allows) **USB tethering**, each with its route label
  confirmed.
- **Stress**: rung changes forced by a warm phone, a camera switch every 2 min, the link dropped once
  (Wi-Fi off on the Mac for 5 s). Pass: the card appears within the stall threshold, no frame after a
  session end, and a new tap is required.

---

## 12. Phased implementation plan

Each phase ends on a named reading. "Local" means this Mac and the test suites, with no device writes.

| Phase | What | Where it runs | Needs approval for | Exit reading |
|---|---|---|---|---|
| **W0 — decisions and contract** | approve D-1…D-3 and the `webcam.*` namespace; write it into `docs/protocol.md` first; fixtures | local, docs | the namespace (B11), D-2 | `check-protocol-spec` green with `webcam.*` specified |
| **W1 — Mac native skeleton** | SwiftPM package: bridge (decode, rotate, scale, sink-feed behind a protocol), extension sources, the in-process harness; `npm run build:native`; the Swift leg of `check-suites-run` | **local** | — | Swift suite green, mutation-tested; v1 suites unchanged |
| **W2 — phone encoder** | new webcam path in a new package of `camera-module` (or a new module); Camera2 two-output spike S1; ladder; thermal; header; `webcam.*` handlers; **debug-only gate** like v1 | local for code; **one supervised sitting** for S1 | install of a debug APK + one capture sitting (B7) | S1's pre-registered verdict; encoder fps / bitrate / thermal over 10 min |
| **W3 — end to end without the extension** | Electron main ↔ bridge; the bridge's decoded frames shown in a **dev-only Sidekick pane** (a debug window drawing the bridge's IOSurfaces), so the whole phone→Mac path including consent and Stop is proven **before signing exists** | local + supervised sitting | Mac rebuild/relaunch + phone install + one sitting | §6.2 triggers pass on hardware with the bridge as the consumer |
| **W4 — signed extension** | Xcode project for the extension, profiles, **Apple Development** signing for the local activation test (Developer ID only for distribution — `docs/camera-v2-signing-readiness.md` §6, re-measured 2026-10-05 §8); activation addon; Settings → Camera install/uninstall UI; sink authentication | **blocked on B1–B5** — B1 is the **paid** program even for the local test: Apple's macOS capability table gives System Extension and App Groups no free-account support | membership, Xcode, `/Applications` install, activation, System Settings approval | §11.2 items 1–5 |
| **W5 — compatibility and endurance** | §11.3 and §11.4; client-app names on the phone's request; tune D-2 from the measured counts | hardware, supervised | Meet/Zoom accounts, call sittings, a cable-out battery run (B7, B8) | the pre-registered compatibility table filled in; long-session numbers with denominators |
| **W6 — USB reading** | owner enables USB tethering once; read-only `ifconfig`/`networksetup`; if an NCM interface appears, one route-labelled session | hardware | owner's hands, mobile-data routing warning (B9) | route label proven with its control; or "USB: none without AOA", recorded |
| **W7 — distribution** | notarize, staple, release gate lifted for the phone half deliberately, uninstall docs | — | notarization upload (B6), release decision | a downloaded, quarantined copy activates and appears in Meet on a clean user account |

**Revision 2 status.** W0 and W1 are approved and done locally. W2/W3's code needs its own approval;
W2's spike sitting and W3's sitting each need the usual install/relaunch approval. W4 onward stays
blocked on B1.

**W1 as built (2026-10-03).** The package is `desktop/native/SidekickCamera/` (its README carries the
evidence and the limits). It changes one thing about the table above: the Swift suite runs with
`swift test` from the Command Line Tools, but **only with `Testing.framework`'s path passed
explicitly**. SwiftPM does not find it in the CLT on its own, and a run without the flags fails with
"no such module 'Testing'". The package's `run-tests.mjs` passes the flags and records every run, red or
green, for `check-suites-run.mjs`'s Swift leg.

---

## 13. Reuse, licence and security review

| Source | Licence | Use | Review before reuse |
|---|---|---|---|
| Apple's Camera Extension Xcode template and *Creating a camera extension with Core Media I/O* sample | Apple sample-code licence (permissive; **verify the `LICENSE.txt` in the download**) | **reuse** as the extension skeleton | pin the SDK version; strip the sample's `SampleCapture` strings; no entitlements beyond §4 |
| **Halle/SinkCam** | MIT, last push 2026-05-18 (maintained) | **reuse patterns** for the sink→source relay, with attribution | its own README's injection warning → our §6.4; read every line copied; pinned commit hash in an `ATTRIBUTION` file. **Reviewed 2026-10-03 at `ce124cfc4c599e93830a18c2944b1be47bb15559`:** `LICENSE` is MIT, "Copyright (c) 2026 Halle Winkler". The source files still carry a 2022 header reading "All rights reserved", which the repository's `LICENSE` grants permissions over. **Decision: no code copied.** W1 is written from Apple's headers, and SinkCam is a design reference only (a timer-driven `consumeSampleBuffer` with `notifyScheduledOutputChanged`, and the sink's queue-size properties). Recorded in the package's `ATTRIBUTION.md` with the file hashes read |
| ldenoue/cameraextension | MIT, last push 2022-07-04 | read for the CMIO C-API sink feed (`CMIOStreamCopyBufferQueue`, `CMSimpleQueueEnqueue`) | stale; read, don't copy |
| OBS `mac-virtualcam` (Camera Extension since OBS 30, IOSurface zero-copy, NV12) | **GPL-2.0** | **design reference only** | **no code copied.** This repo has **no LICENSE file**; GPL code would impose GPL on Sidekick. Owner decision if that ever changes |
| scrcpy camera source | Apache-2.0 | design reference for Camera2 → MediaCodec (already cited by v1) | — |
| johnboiles/obs-mac-virtualcam | archived, DAL | none | obsolete mechanism |

No new runtime dependency is proposed: Apple frameworks, plus the existing CameraX and Camera2
(platform) on the phone.

---

## 14. Risks and unknowns

| # | Unknown | How it gets answered | Phase |
|---|---|---|---|
| Q1 | Can the helper call the activation API, or must Electron main via an addon? | first signed build | W4 |
| Q2 | Does feeding a CMIO **sink** require camera TCC for the feeding process on macOS 26? | first signed build; the prompt either appears or not, with Photo Booth as control | W4 |
| Q3 | Does this phone offer 1920 × 1080 `PRIV` at 30 fps on both cameras? | read-only stream-configuration reading (`dumpsys media.camera`), then S1 | W2 |
| Q4 | NCM or RNDIS for USB tethering on One UI 8? | W6 reading | W6 |
| Q5 | Does replacing the extension need a reboot on 26? (Offcuts: "no live replacements… in a single user session") | W4 item 5 | W4 |
| Q6 | Does Zoom list a third-party camera extension today? | W5 table | W5 |
| Q7 | Do `CMSampleBuffer` attachments (the session id and generation) survive the CMIO sink queue between processes? | first signed build: send a tagged frame and read the tag in the extension's log. **The design does not depend on it**: the sink stream's start and stop bound a session on their own, and the tags are defence in depth | W4 |
| Q8 | Does CMIO call a source stream's `startStream`/`stopStream` once per client, or once per 0↔1 transition? | first signed build: two consumers, read the extension's count. W1's ledger is correct under both, and nothing depends on the exact number above 1 | W4 |
| Q9 | Does the bridge's own **sink** stream make the device `DeviceIsRunningSomewhere`? | first signed build, with no consumer open. This is why the consumer signal is the extension's own count (§6.1) | W4 |
| R-1 | PID-reuse race in sink authentication (no audit token in `CMIOExtensionClient`) | residual, documented | — |
| R-2 | Phone heat over a long call with the screen on | the ladder; option to dim the phone's preview to minimum brightness while keeping it visible (measured in W5, not assumed) | W5 |
| R-3 | Approval friction: admin approval plus a per-session phone tap plus the meeting app's own camera permission | designed copy for each; D-2 reduces the taps | W4/W5 |
| R-4 | Developer workflow: every extension change needs a signed build in `/Applications`, and maybe a reboot | the in-process harness carries most iteration (W1) | all |

---

## 15. Blockers for approval

Nothing below has been done. Each is a separate yes/no.

| # | Blocker | Why it cannot be avoided | Cost |
|---|---|---|---|
| **B1** | **Apple Developer Program membership** (Team ID) | System Extension and App Groups are ADP/Developer ID-only capabilities. Without it nothing activates. Also closes D12, D14, D15 and defect 81 | $99/yr; enrolment |
| **B2** | **Install Xcode** (full) | provisioning profiles and the extension target. The CLT covers compile and test only | large download; no settings change |
| **B3** | Create the App IDs, app group and profiles in the developer portal | profiles carry the restricted entitlement | portal actions under the owner's account |
| **B4** | Confirm identifiers: extension `com.chetan.sidekick.desktop.camera`, group `<TEAMID>.com.chetan.sidekick.camera`, device name "Sidekick Camera" | they are permanent once a device ID ships (D9's personal-namespace question applies) | decision |
| **B5** | Approve, per sitting: install the signed Sidekick into `/Applications`, activate the extension, and the **admin approval in System Settings** (owner's hands) | Apple requires all three; reversible by deactivation | owner present |
| **B6** | Notarization (uploads the binary to Apple) | distribution only, W7 | outbound transfer |
| **B7** | Phone sittings: debug APK install, the W2 encoder spike, a 60-min cable-out battery run | hardware readings | owner's time |
| **B8** | Meet and Zoom accounts and test calls | far-end compatibility (§11.3) | accounts |
| **B9** | USB-tethering reading | owner toggles it on the phone; the Mac's internet may route via mobile data | data use |
| ~~B10~~ | ~~Product decisions~~ **Decided 2026-10-03:** no linger (D-2 = A). D-1 and D-3 carried as written. Cards cut to two (§5.3) | — | — |
| ~~B11~~ | ~~The `webcam.*` namespace and claim word~~ **Approved 2026-10-03.** Now `docs/protocol.md` → *Webcam* | — | — |

---

## Sources

- Apple — [Creating a camera extension with Core Media I/O](https://developer.apple.com/documentation/coremediaio/creating-a-camera-extension-with-core-media-i-o)
- Apple — [Debugging and testing system extensions](https://developer.apple.com/documentation/driverkit/debugging-and-testing-system-extensions)
- Apple — [System Extension entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.system-extension.install)
- Apple — [Supported capabilities (macOS)](https://developer.apple.com/help/account/reference/supported-capabilities-macos)
- Apple — [WWDC22: Create camera extensions with Core Media IO](https://developer.apple.com/videos/play/wwdc2022/10022/)
- Apple Developer Forums — [sink stream direction](https://developer.apple.com/forums/thread/708550), [XPC from app to CMIOExtension](https://developer.apple.com/forums/thread/706184)
- Halle Winkler — [Getting to grips with the CMIO Camera Extension, part 1](https://theoffcuts.org/posts/core-media-io-camera-extensions-part-one/), [part 2](https://theoffcuts.org/posts/core-media-io-camera-extensions-part-two/); [SinkCam](https://github.com/Halle/SinkCam)
- [ldenoue/cameraextension](https://github.com/ldenoue/cameraextension)
- OBS — [mac-virtualcam camera extension PR #7777](https://github.com/obsproject/obs-studio/pull/7777), [uninstall issue #9714](https://github.com/obsproject/obs-studio/issues/9714)
- macOS 15+ approval location — [OBS forum](https://obsproject.com/forum/threads/macos-15-sequoia-beta-system-extensions-settings-moved.176958/), [mimoLive manual](https://mimolive.com/user-manual/playout-output-destinations/virtual-camera/installing-and-activating-virtual-camera-extension/)
- SIP requirement for developer mode — [Der Flounder](https://derflounder.wordpress.com/2020/09/01/uninstalling-macos-system-extensions/)
