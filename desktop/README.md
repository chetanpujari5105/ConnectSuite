# ConnectSuite Desktop (macOS mirror client)

Renders the `mirror-server` capture stream on a Mac and injects input back, so a phone can be
mirrored and controlled from the desktop.

This is a second controller for the existing capture server, alongside the Android one in
`mirror-module`. The wire protocol is unchanged — 12-byte framed Annex-B H.264 out, `ControlMessage`
bytes back.

## Why it uses the `adb` binary

`mirror-module` speaks the ADB protocol by hand because it runs on a phone with no adb available.
Here the real binary exists, so this client shells out to it. That also means the Android 11+
6-digit `adb pair` transport works, which the hand-rolled client explicitly does not implement.

## Running

```bash
cd desktop
npm install
npm start
```

Requires the capture server dex:

```bash
./gradlew :mirror-server:packageServerDex
```

`ADB_PATH` overrides adb discovery. For a scripted run:

```bash
CONNECTSUITE_AUTOSTART=1 CONNECTSUITE_SERIAL=<serial> npm start
```

## Test scripts

Each isolates one layer, so a failure points at a specific stage rather than "it doesn't work":

| Script | Checks |
| --- | --- |
| `node test-stream.js <serial> [quality] [secs]` | Transport only — no decode. Frame counts, config packet, time to first frame. |
| `node test-input.js <serial>` | Input injection *and* coordinate scaling, by tapping dial keys and reading back the digits. |
| `node test-bench.js <serial> [quality] [secs]` | fps, bitrate and inter-frame gaps with the screen actually moving. |

## Layout

```
src/adb.js       adb discovery, device list, physical display size
src/session.js   push dex, forward port, start server, frame de-framing
src/control.js   ControlMessage encoding + device coordinate mapping
src/main.js      Electron main: session lifecycle, input scaling
src/renderer/    WebCodecs H.264 decode, canvas render, mouse/keyboard capture
```

## Two things worth knowing

**Coordinate scaling uses the panel's real resolution, not the video size.** The server clamps
incoming touches against `DisplayInfo.width/height` (1440×3120 on an S25 Ultra), while the encoded
video is capped by `maxSize` (498×1080 at the Balanced preset). Scaling to the video size puts every
tap in the top-left third of the screen. `adb shell wm size` is the authority here; the renderer
sends fractions and `main.js` applies the panel resolution in exactly one place.

**`adb forward` accepts a local connection before it knows the device side exists.** Connecting
eagerly hands back a socket that never carries a byte, and the server's two `accept()` calls end up
out of step — video on a dead socket, control never arriving. `session.js` gates on the abstract
socket appearing in `/proc/net/unix`, then verifies each connection survives before using it.

## v2 (TypeScript client)

`npm start` builds `src/` with `tsc` and launches the v2 client: TLS to the phone on
42501/42502/42503, QR pairing, gateway/mDNS discovery, auto reconnect. Sockets live in the main
process (`src/main/`), the renderer only draws.

The v1 ADB mirror is preserved in `legacy/` and runs with `npm run start:legacy`
(`LEGACY_ADB_MIRROR=1`). It will be deleted once phase 3 passes on hardware.
