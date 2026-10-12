# Camera v1 — a live phone-camera preview in the Mac's Camera pane

**Status: built and tested with generated fixtures, 2026-10-02; first supervised hardware sitting the same
evening — the two privacy checks and one approved session passed on the SM-S938B, with one wrong end reason
on Mac Stop (see *Hardware results*). That reason (defect 167) and the Mac's missing lifecycle log
(defect 168) are fixed in `35e1860`, tests only. The one approved retry (21:33) expired unanswered —
no capture. **A second session at 22:10 passed**: 168 is verified on hardware, and 167 is verified for
the stop-first order, with the close-first re-attribution still tested only. Most of the plan is still unrun. Not release-ready. Release builds do
not install it.** The contract is `docs/protocol.md` → Camera, and it
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
- 15 fps / JPEG q70 is a target, never a measurement. The size is a **bound**, not a target: 4:3 within
  1280 × 720, which is 960 × 720 — see *Resolution: why 960 × 720*. No latency, frame-rate, CPU, heat or bandwidth
  claim is made. JPEG costs several Mbit/s where H.264 would cost one or two.
- The NV21 conversion is a plain loop over chroma; its cost on the device is unmeasured.

## Supervised hardware-test plan (steps 1–5 and the Stop half of 7 run on 2026-10-02 in a bounded sitting; the rest not approved, not run)

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

## Hardware results — 2026-10-02, 19:41–20:07 IST (SM-S938B, phone APK `d0ce977f…` of `c2913a1`)

Bounded and supervised: preflight, two privacy checks and **one** approved session. Every picture
judgement is the owner's, by eye; no image, screenshot or frame was saved. Full evidence: `docs/testing.md`
→ *Camera v1 — first supervised hardware sitting*.

| Plan step | As run | Result |
|---|---|---|
| 1 Capability | Phone advertised `camera`; pane offered *Ask phone for camera*; arriving asked the phone nothing | **pass** |
| 2 Request alone | **Variant:** Sidekick in the foreground, so the request screen, not a notification. Unanswered | **pass** — no camera client at any 1 s sample; `EXPIRED` at 30.0 s on both ends; 0 frames; phone left on an ended *Camera off* screen |
| 3 Decline | Owner tapped Decline | **pass** — `DECLINED`, 0 frames, no camera event |
| 4 Approve | Owner tapped Start camera; **no permission dialog** (`CAMERA` already granted from the QR scanner) | **pass** — the camera opened only after the tap; Mac *Live · back camera · 960 × 720*; owner: matches the phone's preview |
| 5 Switch and rotate | rear → front → rear from the Mac; landscape and back | **pass by eye** — front mirrored like the phone's preview, no new request; upright and un-stretched in landscape. The Mac's DOM cannot see the rotation; it rests on the owner's observation |
| 7 Mac Stop (first half) | One real Stop | **mechanics pass, wording fails** — see below |
| 6, 7 (pane exit), 8, 9 | — | **not run** |

**Procedural overrun.** The approval bounded live observation to **60 seconds**; the session ran **164.5 s**,
because the switch and rotation steps waited on questions to the owner and no deadline was enforced. That
is outside the approved bound and is recorded as such. **A future driver arms the capture deadline at
`attached` and presses the real Stop when it fires**, recording that the deadline ended the session; it
never extends the session silently.

**Measured:** 960 × 720 from both cameras (not the 1280 × 720 target). 2,325 frames sent, 0 dropped, and
2,325 received, over 164.5 s from attach to close (a mean of about 14.1 a second including two switches —
arithmetic, not a measured frame rate). No latency figure is claimed. No restart in the 4 minutes after Stop.

**Wrong end reason on Mac Stop — defect 167, fixed in `35e1860` (tests only).** `stop()` ends locally as `stopped-by-mac` and closes the stream socket
**before** sending `camera.stop`. The phone sees the close first, stops as `STREAM_CLOSED`, and its
`camera.state` then overrides the Mac's own reason through `onState`'s refine rule. Both screens then say the
connection closed. The Mac adds *"check the Mac and phone are on the same network"* and a raw
`stream-closed` token. Fix direction, unimplemented: a reason this side *knows* (`stopped-by-mac`) is never
refined by the phone, and the copy never names the network for an end the Mac caused. The tempting wrong
fix is to delay the socket close until the phone answers, which re-opens M6's *stop ends the stream at once*.

**Mac logging gap — defect 168, fixed in `35e1860` (tests only).** The Mac writes one `[camera]` line per session (the request ack). Live, switch, stop
and the received-frame count are not logged, against `CLAUDE.md`'s *log the success case* rule.

**Newly unproven, beyond the list above:** the permission dialog and the expiry running under it; the 1280 ×
720 target not being met (whether CameraX chose 4:3 for the analysis use case is unread).

## Resolution: why 960 × 720 (investigation only — nothing changed)

**What the code asks for.** `ImageAnalysis` gets a `ResolutionSelector` with only a
`ResolutionStrategy(Size(1280, 720), FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)`. It sets **no aspect-ratio
strategy**. `Preview` is `Preview.Builder().build()`, with no selector at all.

**What CameraX does with that.** In CameraX 1.4.2, `ResolutionSelector.Builder()` initialises its aspect
ratio to `AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY`. That was read from the library itself, not
the documentation: `javap` on `camera-core-1.4.2.aar`'s `ResolutionSelector$Builder.<init>` shows a
`getstatic …RATIO_4_3_FALLBACK_AUTO_STRATEGY` into `mAspectRatioStrategy`. So CameraX first prefers the
camera's **4:3** sizes, then applies the bound inside that group: the closest size **not larger than**
1280 × 720, else the closest larger one. The largest 4:3 size whose height fits 720 is **960 × 720**.
A 16:9 1280 × 720 is not in the preferred group, so it is not chosen **even if the camera offers it**.
Both cameras gave 960 × 720, which is exactly this rule's answer when the camera lists 960 × 720 YUV.

**What is not known.**
- Whether this camera lists 1280 × 720 YUV at all. No reading was taken, and none is claimed.
- What size the on-screen `Preview` got. Its default is also 4:3, so the Mac and the phone show the
  same field of view, which matches the owner's *"matches the phone's preview"*. Its size is not logged.
- The reported 960 × 720 is the analysis `ImageProxy`'s size (rounded down to even). It is sent in every
  frame header and in `running`, so the Mac's status line names what was actually encoded.

**Verdict.** 960 × 720 is the configuration working as written, not a fallback or a fault. The defect
was in this document's wording, which called 1280 × 720 a "target", and that is corrected above.

**Proposals — separate, not implemented, each needing its own approval:**
1. **Report the selected sizes (reporting only, low risk).** After `bindToLifecycle`, add
   `imageAnalysis.resolutionInfo?.resolution` and `preview.resolutionInfo?.resolution` (with the crop
   rect) to the phone's `Camera bound:` line. The size choice then becomes a reading on every run,
   rather than an inference from the frame header. It changes no configuration.
2. **A 16:9 stream, only if wanted (configuration change).** Set
   `AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY` on **both** `ImageAnalysis` and `Preview`. On
   one alone, the Mac would show a different field of view from the phone's own preview. Keep the
   1280 × 720 bound and the closest-lower rule.
   - **Before:** a read-only reading of the device's YUV stream configurations for cameras 0 and 1
     (`dumpsys media.camera`).
   - **Costs:** a narrower vertical field of view from a 4:3 sensor, and 921,600 pixels a frame instead
     of 691,200 (+33 %) through the NV21 loop, the JPEG encoder and the link.
   - **Risk:** on other devices, a combination CameraX must fall back from.
   - **Recommendation: do not.** Keep 4:3; nothing observed calls for it.

## Bounded hardware retry plan for 167 and 168 (not approved, not run)

**One sitting, one approved session, a hard capture deadline.**
- **Preconditions:** the owner's go-ahead for one `install -r` of `35e1860`'s debug APK and one Mac
  build + relaunch.
- **Pinning:** every `adb` write pinned; snapshots before and after as in the first sitting.
- **Hands off:** no transfer, mirror, permission change or deletion; the paused pull is not touched.

0. **Preflight**, as in the first sitting. Optionally, with its own approval, the read-only stream
   configuration reading from proposal 2 — recorded as a reading, not acted on.
1. **One request; the owner taps Start camera.** The driver arms a **20-second capture deadline** at the
   phone's `attached` line, independent of any question it is waiting on.
2. **At about 5 s, one Mac switch to the front camera.** The Mac log must show, in order: *requested*,
   *accepted by the phone*, *switch confirmed: frames now from the front camera*.
3. **By the deadline at the latest, one real Mac Stop.** If the deadline fires, the driver presses Stop
   itself and records that the deadline ended the session. It never extends the session.
4. **Pass, on both ends:**
   - **Mac:** ended `stopped-by-mac` with *"You stopped the camera from this Mac."*; no code line, no
     network sentence; the lifecycle lines present once each, and one termination line with
     received / not drawn / the phone's counts.
   - **Phone:** the screen reads *"The Mac stopped the camera."*; the log shows either `stopped:
     STOPPED_BY_MAC`, or `STREAM_CLOSED` followed by `re-attributed STREAM_CLOSED → STOPPED_BY_MAC`.
   - **Record which of the two orders happened.** That order is the reading this run exists to take.
   - **Control:** both ends show 0 camera clients after Stop, and no restart within 60 s.
5. **Stop the sitting on:**
   - any capture before the tap;
   - any frame after Stop;
   - a deadline overrun;
   - any unexplained change.

**Still outside it:** the permission dialog (needs `CAMERA` revoked, its own approval), Home/lock, pane exit,
disconnect, mirror busy, background or notification requests.

## Retry results — 2026-10-02, 21:33 IST (phone APK `1f3a0a00…` of `a76ae78`): expired, nothing verified

**The one request expired unanswered.**
- The phone had Instagram in front, so the request went out **as a notification**.
- The owner was told to expect the request screen, and Start camera was never tapped.
- Both ends ended it at 30.0 s as `expired`, with 0 frames. No camera client ever appeared, and the
  request notification was removed. Nothing restarted in the 60 s observed.
- No second request was made, as approved.

**Defect 167 is unverified. Defect 168 is partly seen:** its request, ack and single termination lines
appeared, with counts and tallies; its approval, first-frame and switch lines were not reached. Evidence:
`docs/testing.md` → *Camera retry for defects 167 and 168*.

**The driver crashed while recording the ending** (an `at` key collision in its own event recorder),
after the request had ended. Its deadline logic was never exercised, because no attachment happened.

**What the next attempt needs:**
- **A read-only foreground check in preflight.** If Sidekick is not the resumed activity, ask the owner
  to bring it forward, or tell them plainly that the request will arrive as a notification.
- **The driver's recorder fixed and dry-run** through an ended request. The deadline, the switch and the
  ceiling are unchanged.

## Second retry — 2026-10-02, 22:10 IST: PASS

One session, Sidekick in front, the owner's tap, and the driver's deadline armed at 22:10:56.611.

- **Timing:** switch at about 5 s; the **planned Stop at 15.002 s**, inside the 20 s limit. No deadline,
  ceiling or emergency Stop.
- **Mac:** *"You stopped the camera from this Mac."*
- **Phone:** *"The Mac stopped the camera."*
- **No raw token and no network advice.**
- **Frames:** 197 sent = 197 received = 197 drawn; **0 drawn after Stop**; nothing in flight at the Stop.
- **No camera client** at any sample to 60 s.
- **Mac log:** approval, first frame, switch requested / accepted / confirmed, one termination, and the
  phone's account (*agreed*).

**Not exercised:** the close-first order. This time the stop reached the phone first, so it ended as
`STOPPED_BY_MAC` directly.

**Also on record:** the owner's own 21:51 session (stopped on the phone) showed the Mac replacing its
guess `stream-lost` with the phone's `stopped-on-phone` — 167's other path.

**The driver** is now `driver-core.mjs` + `retry-driver.mjs` (session scratchpad), with 10 local tests,
including the real 20 s deadline under failure.

Evidence: `docs/testing.md` → *Camera session for defects 167 and 168*.

## Lifecycle batch — 2026-10-02, 22:24–22:41 IST: stopped after case A (NO READING); B, C, D not run

- **Case A (phone Home) is a NO READING.** The driver mistook the 22:10 session's `attached` log line,
  still in the last 40 lines it reads, for this request's attachment. It anchored the 20 s deadline at the
  request press, and that deadline cancelled the request before Start camera was tapped. No capture, no
  frames, no camera event. Home and the reopen were never reached.
- **The batch stopped there, as the approval requires on an instrument failure.**
  - **B** (lock), **C** (pane exit) and **D** (Disconnect) were not run.
  - The driver was not repaired. Its fix direction — count only log lines written after this request,
    or naming its stream id — is in `docs/testing.md` → *Camera lifecycle batch*.
- **Pre-registered and unverified:** the bounds predicted that **D would fail on wording**. The Mac's
  `disconnected` ending says *"Your phone disconnected, so the camera stopped."* even when the Mac's own
  Disconnect caused it.
- **Case D's control:** the tray menu's Disconnect / Connect items, reached by name through System
  Events. The Overview pane's Disconnect would first be a pane exit (case C).

## Case A retry — 2026-10-02, 23:01 IST: NO READING (Home after the cap); close-first re-attribution observed

The 22:38 batch result stands as recorded: **A NO READING; B, C and D NOT RUN**.

**The retry, after a driver-only repair** (the phone log read from a recorded byte offset and inode; the
full stream id taken from the Mac's state; phone lines matched by 8-character prefix, labelled as such;
the cap armed only on this stream's own start):
- One request was approved at 23:01:34, and the picture was live at 23:01:35.
- **Home was not pressed until 23:02:00**, so the 20 s deadline pressed the real Stop at 19.5 s.
- **Result: NO READING** — the Home stimulus never ran during capture.

**Seen anyway:**
- The instrument armed on the right event.
- 266 frames drawn, 0 after Stop; one frame in flight at the close, discarded.
- The camera released at 23:01:53.
- **The phone's close-first re-attribution happened on hardware:** `STREAM_CLOSED → STOPPED_BY_MAC`, with
  the Mac's *"You stopped the camera from this Mac."* kept. This is a log reading; the phone screen was
  not read.
- **No restart after the reopen at 23:03:05,** from a post-hoc read-only check rather than the planned
  live watch.

Evidence: `docs/testing.md` → *Camera case A retry*.

## Case A with a timed Home — 2026-10-02, 23:16 IST: scripted procedure NO READING; product checks held on the owner's own Home

- **The driver's Home was never sent.** The owner pressed Home about 3 s after the picture went live,
  before the driver's 5 s timer.
- **Every product check held on that Home:**
  - `LEFT_SCREEN` on the phone; the Mac's *"…camera screen left your phone's display."*;
  - the picture cleared and the camera released;
  - 63 / 63 / 63 frames, 0 drawn after the end, nothing in flight;
  - a normal reopen with no capture, no new request and no reused consent;
  - a clean 60 s watch from the confirmed reopen.
- **The scripted procedure itself is a NO READING:** steps A–B were not exercised.
- B, C and D remain unapproved.

Evidence: `docs/testing.md` → *Camera case A with a timed Home*.
