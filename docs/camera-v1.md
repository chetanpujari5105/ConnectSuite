# Camera v1 — a live phone-camera preview in the Mac's Camera pane

**Status: built and tested with generated fixtures only, 2026-10-02. Not run on any phone. Not
release-ready. Release builds do not install it.** The contract is `docs/protocol.md` → Camera, and it
wins wherever this file disagrees. This file is the arguments, the limits, and the supervised
hardware-test plan.

## What it is, and what it is not

A paired phone shows its camera, live, inside Sidekick's Camera pane on the Mac — for as long as the
phone's owner has approved it on the phone and keeps the phone's camera screen open.

It is **not**:

- a macOS virtual webcam for Zoom, Teams or FaceTime — that needs a signed Camera Extension and is
  still behind Phase 8's signing;
- audio of any kind — no microphone permission is requested;
- recording, snapshots or saving anything;
- background or lock-screen capture;
- a cloud relay or anything reachable off the local network.

## The decisions, with the alternative each one rejected

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Capture stack | **CameraX 1.4.2** — `Preview` on the phone's screen plus `ImageAnalysis` with keep-only-latest | Camera2 by hand: a second stack beside the CameraX the QR scanner already ships. CameraX is the project's existing, justified capture stack |
| Codec | **One JPEG per frame** (`YuvImage.compressToJpeg`), decoded on the Mac by `createImageBitmap` | H.264 through MediaCodec, which is what the mirror does. CameraX cannot hand one camera to both an on-screen `Preview` and a MediaCodec input surface without a GL effect pipeline — a second architecture. And every JPEG stands alone: dropping any frame is always safe, there is no keyframe to strand a decoder on, no decoder state to go stale, and no contention for the hardware encoder a running mirror holds. The cost is bandwidth — several Mbit/s at 720p15 instead of one or two — on a LAN, which is what this project assumes |
| Transport | **The existing video port, 42502, with a claim in the token frame** | A new port (the microphone's precedent, 42504). The brief rules out an independent listener, and none is needed: the token frame already authorises a socket to a session, and a word plus a `streamId` in it routes the socket to the right stream. The mirror's token-only frame is byte-for-byte unchanged |
| Orientation | **In-band, in a 16-byte header on every frame** | On `camera.state`. The control channel and the stream arrive on two clocks; a switch announced on one while frames arrive on the other draws one camera's frame with the other's mirroring. `CLAUDE.md` → *A predicate over two independent clocks* is the general form |
| Consent | **Per `camera.request`, by a tap on the phone; permission only after that tap** | Treating a granted `CAMERA` permission as consent. A permission is a standing grant; consent is to *this* session for *this* Mac |
| Visibility | **The camera is bound to the phone's camera screen**; it stops when that screen stops being visible | A `camera`-type foreground service. That is background capture, and Android 14+ restricts it for good reason. v1 does not need it and does not try |
| Coexistence | **Refuse while mirroring** (`CAMERA_BUSY`) | Stopping the mirror to make room. The brief forbids interrupting a mirror; refusing is honest and costs one sentence |
| Release | **`CameraFeature.install` is a no-op unless the build is debuggable** | A runtime switch. A gate that is a build fact cannot be flipped on a release phone by anything |
| Mac Stop policy | **Leaving the Camera pane stops the stream** | Letting it run in the background. A camera nobody is looking at is a camera held open for no one |

No new third-party dependency is introduced. CameraX (Apache 2.0, Google) is already in `app/` for QR
pairing; the JPEG encoder is Android's `YuvImage`; the decoder is Chromium's `createImageBitmap`.
scrcpy's camera source (`--video-source=camera`, Camera2 → MediaCodec) was read for design and is the
reference for the H.264 route not taken.

## The flow

```
Mac                                    phone
 │ camera.request {facing}  ─────────▶ │  ack: awaiting-approval + streamId   (camera CLOSED)
 │                                     │  request screen over Sidekick, or a notification
 │                                     │  owner taps Start camera
 │                                     │  CAMERA permission dialog, only if not yet granted
 │ ◀───────── camera.state starting    │  camera opening
 │ 42502: "<token> camera <streamId>"▶ │  claim checked: session, streamId, phase, claimed once
 │ ◀───────── camera.state running     │  first frame + socket attached
 │ ◀══════════ frames (JPEG + header)  │  15 fps cap, 2-deep queue, oldest evicted
 │ camera.switch / camera.stop ──────▶ │
 │ ◀───────── camera.state stopped     │  reason from a closed set
```

## Where the code is

| Side | File | What it holds |
|---|---|---|
| core | `core/.../link/SideChannelClaim.kt` | the claim grammar, strict and pure |
| core | `core/.../link/LinkServer.kt` | routes a camera claim to `cameraChannelSink`, never to the mirror; a refused camera claim is never reported to the mirror's owner; a session-ended **listener list** (the mirror's single slot untouched) |
| core | `core/.../link/CapabilityContract.kt` | `camera`: three requests, the claim served, no permission gate; `cameraServed` is not defaulted |
| phone | `camera-module/.../CameraSessionMachine.kt` | **every rule**: consent, expiry, ownership, claim-once, epoch, the single exit |
| phone | `camera-module/.../CameraEngine.kt` | executes the machine's effects against the link, the screen and the clock |
| phone | `camera-module/.../CameraActivity.kt` | request screen, permission after the tap, CameraX bound to this activity, the analyzer |
| phone | `camera-module/.../CameraStream.kt` | two-deep queue, evict oldest, hang-up and protocol-violation detection |
| phone | `camera-module/.../CameraFrameCodec.kt`, `FramePrep.kt` | the frame header, NV21 conversion, the 15 fps pacer |
| phone | `camera-module/.../CameraFeature.kt` | `CameraReleaseGate` and the install |
| Mac | `desktop/src/main/camera.ts` | `CameraController` (Electron-free) and the pinned stream socket |
| Mac | `desktop/src/shared/cameraFrame.ts` | the strict frame reader |
| Mac | `desktop/src/renderer/camera.ts` | `CameraView`, the pane spec, the draw matrix, `CameraCanvasPainter` |
| both | `docs/fixtures/camera-frame-v1.hex` | the golden frame both ends are asserted against |

## Implemented, and blocked

**Implemented (tests only):** the whole approved scope — contract and privacy rules, phone request screen
with destination Mac, camera choice, Start camera / Decline, live preview with Switch and Stop; every
end path releasing camera, socket, timers and notification; denied permission, camera unavailable, camera
in use, expiry, cancellation and rapid start/stop; rotation and front mirroring carried in-band; bounded
buffering on both ends; the Mac pane's every state; Mac Stop and Switch bound to the owning stream;
older-peer fallback; release gate off.

**Not implemented, deliberately:** a virtual webcam, audio, recording or snapshots, background or lock-screen
capture, automatic restart of any kind, and coexistence beyond refusing while mirroring.

**Blocked on hardware, and only on hardware:** everything that needs a real camera, a real link or a real
screen. Nothing has been measured; see the plan below.

## Evidence (2026-10-02)

The fresh suite and guard numbers are in `docs/testing.md` → *Camera v1*. Mutation testing, each mutation
red on the test named for its rule, each restore SHA-256-verified, Gradle result files checked fresh
(≤ 0.2 s) and exit codes recorded; none uncounted for a compile failure or a hang:

| | Rule | Caught by |
|---|---|---|
| P1 | a Mac request never opens the camera | *a Mac request alone never opens the camera* |
| P2 | no socket before approval | *no frame and no socket before approval* |
| P3 | stop is the owner's | *another connection cannot stop, switch or claim the stream* |
| P4 | a claim is the owner's | *a socket claim is refused from another session…* |
| P5 | a stream is claimed once | same, and *a switch stays inside the approved stream* |
| P6 | every end closes the camera | *every way out releases the camera…* |
| P7 | a replaced camera's frames are refused | *frames from the replaced camera are refused…* |
| P8 | expiry at 30 s, not before | *an unanswered request expires at 30 seconds, not before* |
| P9 | only the owner's session end stops it | *another connection cannot…*, *the replaced session's commands…* |
| P10 | approval names its stream | *a tap naming a stream that is not awaiting does nothing* |
| P11 | leaving the screen ends a live stream | *leaving the camera screen ends a live stream…* |
| P12 | release builds never install | *a release build never installs Camera v1* |
| P13 | a slow Mac loses the oldest frame | *a slow Mac costs the oldest frames…* |
| P14 | the claim word is exact | *nearly a camera claim is no claim* |
| M1 | no Mac socket before `starting` | *a request opens no socket* |
| M2 | events bound to the session token | *news about another stream, or from a replaced session…* |
| M3 | only its own session's end | *its own session ending ends the stream…* |
| M4 | one frame with the renderer | *frames reach the renderer one at a time…* |
| M5 | two seconds is a stall | *two seconds without a frame hides the picture…* |
| M6 | stop closes the socket at once | *stop ends the stream at once…* |
| M7 | a late ack after stop is withdrawn | *stop while the request is still in flight…* |
| M8 | sequence must increase | *a sequence that does not increase is refused* |
| M9 | the cap is checked from the header | *a length over the cap is refused from the header alone* |
| M10 | leaving the pane stops | *leaving the pane stops an open stream or request…* |
| M11 | a stalled picture is hidden | *a stalled stream hides the picture…* |
| M12 | an end clears the canvas | *an ended stream clears the picture…* |
| M13 | mirror after rotation | *mirroring is applied to the upright picture, after the turn* |
| M14 | arriving asks nothing | *arriving at the pane asks the phone nothing…* |

Red-first is by mutation: this is new code, so there was no earlier version to be red against; each
mutation reinstates the specific failure its test is named for.

**What no test here reaches**, said rather than implied: `CameraActivity`, `CameraEngine` and the CameraX
binding (Android-only — the call sites are held by source scans); `LinkServer`'s routing of the claim (the
parser is tested, the accept loop is not); `openCameraSocket`'s TLS pin; `CameraCanvasPainter`'s canvas
calls (its matrix is tested); and the real pane layout (the DOM double lays nothing out).

## Remaining limitations

**Privacy**
- The 30-second expiry keeps running while Android's permission dialog is up; an owner who takes longer
  than that gets `expired` and must be asked again. Safe, and slightly unkind.
- If notifications are off *and* Sidekick is in the background, the request is reachable only by opening
  Sidekick within 30 s (the request screen then opens over it).
- A mirror started *while* a camera stream is live is not refused by the camera feature; both run and share
  nothing. Mirror's code was not touched to change that.

**Compatibility**
- Rotation and front mirroring are computed from CameraX's `rotationDegrees` and a physical-orientation
  listener; whether the Mac's picture matches the phone's screen for the front camera on One UI is unmeasured.
- `CameraState` errors are mapped by code; which codes One UI actually raises for "in use" is unmeasured.
- A display-size or theme change on the phone is declared in `configChanges`; any other configuration change
  recreates the activity and ends the stream as `left-screen`.

**Performance**
- 720p / 15 fps / JPEG q70 is a target, never a measurement. No latency, frame-rate, CPU, heat or bandwidth
  claim is made. JPEG costs several Mbit/s where H.264 would cost one or two.
- The NV21 conversion is a plain loop over chroma; its cost on the device is unmeasured.

## Supervised hardware-test plan (one sitting, not approved, not run)

Preconditions: one new debug APK installed on the SM-S938B and one Mac build relaunched — **both need
the owner's go-ahead**. Pin every `adb` write with `scripts/adb-pinned.sh`. No transfer, mirror or file
operation runs during it; the paused Files artifact is not touched.

1. **Capability.** Mac Settings → Capabilities shows Camera *available*. Control: a release-gated build
   (not built here) would list it unavailable.
2. **A request alone opens nothing.** Click *Ask phone for camera* with Sidekick in the background on the
   phone. Pass: a notification, no camera indicator (green dot) in the status bar, the Mac reads *waiting*.
   Wait 35 s: the Mac reads *The request expired*, the notification is gone. No camera dot at any point.
3. **Decline.** Ask again, open the notification, tap *Decline*: Mac reads *Declined on your phone*; no dot.
4. **Approve.** Ask again, tap *Start camera* (grant the permission dialog if shown). Pass: the camera dot
   appears only after the tap; the Mac goes *Starting* → *Live*; the picture is upright and matches the
   phone's own preview; the status line names the size actually chosen.
5. **Switch.** Press *Switch to front camera* on the Mac: same stream, picture mirrored like the phone's
   preview, no new request on the phone. Turn the phone to landscape: the Mac's picture stays upright.
6. **Leave the screen.** Press Home on the phone. Pass: the Mac reads *camera screen left your phone's
   display*, the dot disappears, the counts line shows frames sent and received.
7. **Mac Stop and pane exit.** Repeat 4, then click *Stop camera*; repeat 4 again, then navigate to another
   pane. Pass both times: the phone's screen reads *Camera off* and the dot disappears within a second.
8. **Disconnect.** Repeat 4, then Disconnect on the Mac. Pass: the dot disappears; nothing restarts on
   reconnect; the Mac reads *Your phone disconnected*.
9. **Busy.** Start mirroring, then ask for the camera. Pass: *Your phone is busy*, mirroring unaffected.

Readings to record, each with its control: the camera-dot state before and after every tap, the phone's
`[camera]` log lines (`attached`, `stopped: … sent / … dropped`), and the Mac's `camera` log lines. **Do not
claim latency or frame rate from this run** unless a measurement with a control is designed for it.
