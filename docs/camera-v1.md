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
| core | `core/.../link/SideChannelClaim.kt` | the claim grammar, pure |
| core | `core/.../link/LinkServer.kt` | routes a camera claim to `cameraChannelSink`, never to the mirror |
| core | `core/.../link/CapabilityContract.kt` | `camera`: three requests, the claim served, no permission gate |

The phone module and the Mac pane are described in their own commits and in the handoff section
below as they land.
