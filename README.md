# ConnectSuite

Two independent tools in one Android app, both running entirely over your own network — no
account, no server in the middle, no mobile data.

| Module | What it does |
| --- | --- |
| **Sync** | Pair two devices, send files at Wi-Fi speed, and mirror notifications and incoming SMS between them. |
| **Mirror** | See and control another Android device's screen from this one. No root. |

---

## Building

```bash
git clone <your-repo> ConnectSuite
cd ConnectSuite
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew :app:assembleDebug
```

Requirements: JDK 17–21 (Android Studio's bundled JBR works), Android SDK platform 36,
build-tools 36.0.0. The debug APK lands in `app/build/outputs/apk/debug/`.

### Module layout

```
ConnectSuite/
├── app/            Application shell: onboarding, bottom nav, wiring
├── core/           Identity, pairing, TLS transport, discovery, Room, settings
├── sync-module/    File transfer, notification & SMS mirroring, Sync UI
├── mirror-module/  ADB client, H.264 decode, Mirror UI
└── mirror-server/  Capture server dexed and pushed to the *target* device
```

`core` owns everything about "is this device trusted and how do I talk to it". `sync-module` and
`mirror-module` are independent of each other — Mirror does not use the pairing system at all,
since it talks to the target over ADB rather than over ConnectSuite's own protocol.

---

## Module 1 — Sync

### Pairing

Modelled on KDE Connect's trust-on-first-use scheme.

1. Each device generates an EC P-256 key pair in the Android Keystore on first launch. The private
   key is hardware-backed and cannot be extracted, even on a rooted device.
2. Devices announce themselves by UDP broadcast (port 1763) and by Wi-Fi Direct DNS-SD service
   records — the identity packet carries only a device id, name, type and TCP port.
3. Tapping **Pair** opens a mutually-authenticated TLS connection and sends a pairing request. Both
   users see the same 8-group key fingerprint and must confirm it matches.
4. On accept, each side stores the certificate the other actually presented. Every later connection
   is pinned against it; a device presenting a different key is rejected, even if it claims the
   same device id.

Unpaired devices can complete the TLS handshake — they have to, so you can see the fingerprint you
are being asked to confirm — but the transport layer routes nothing except pairing packets until a
matching fingerprint is in the trust store.

### File transfer

- Files are offered as a job; the receiver accepts before a single byte is written.
- Data moves in 64–256 KB chunks, with the chunk size adapting to observed throughput.
- Every file is SHA-256 checked on arrival. A mismatch discards the partial rather than saving a
  corrupt file.
- Incoming bytes land in a private `.part` file and are only published to
  `Downloads/ConnectSuite/` once verified — which is also what makes resume work. If a connection
  drops mid-transfer, the row stays `PAUSED` and picks up from the stored offset when the device
  comes back.
- Folder structure is preserved through a per-file relative path.

### Notification & SMS mirroring

- `NotificationMirrorService` (a `NotificationListenerService`) captures posted notifications and
  pushes them over the existing paired connection.
- Filtering happens on the *sending* side, so an excluded app's content never leaves the device.
  Group summaries and ongoing notifications are dropped — mirroring a media-player notification
  that ticks every second would flood the link for nothing.
- Dismissing a mirrored notification on the receiving device sends a dismiss command back, which
  cancels it on the phone.
- SMS mirroring is opt-in twice: globally in Sync settings, and per paired device.
- Sync settings has a master kill switch that stops all mirroring instantly without un-pairing
  anything.

---

## Module 2 — Mirror

Architecture follows scrcpy's client/server split:

1. The controller speaks the ADB wire protocol directly to the target's `adbd` — there is no `adb`
   binary bundled, and none is needed.
2. It pushes `connectsuite-server.dex` to `/data/local/tmp/` and starts it with `app_process`, so
   the server runs as the shell user (uid 2000).
3. That uid already holds `CAPTURE_VIDEO_OUTPUT` and `INJECT_EVENTS`, which is precisely why no
   root is required — and why there is no "start recording?" consent dialog, unlike a
   `MediaProjection`-based approach.
4. The server creates a virtual display through `SurfaceControl`, points it at a `MediaCodec`
   hardware H.264 encoder's input surface, and streams the elementary stream back over an ADB
   forwarded socket.
5. The controller decodes into a `SurfaceView` and sends touches, keys and typed text back over a
   second socket, translated to the target's own resolution.

Frames never touch the heap on either side — display surface into encoder, decoder into view
surface — which is what keeps latency low rather than merely the framerate high.

### Target setup (one time, per device you want to mirror)

None of this can be automated. Android deliberately requires a person at the target device.

1. **Settings → About phone**, tap **Build number** seven times.
2. **Settings → System → Developer options** → turn on **Wireless debugging**.
3. Plug the target into a computer once and run `adb tcpip 5555`. Unplug immediately after; the
   port stays open until the device reboots or Wi-Fi is toggled.
4. In ConnectSuite's Mirror tab, enter `<target-ip>:5555` and tap **Connect**. Accept the
   *"Allow wireless debugging?"* prompt on the target, ticking **Always allow**.

The in-app setup wizard (Mirror tab → **?**) walks through the same steps.

### Quality presets

| Preset | Resolution | Bitrate | For |
| --- | --- | --- | --- |
| 720p · 4 Mbps | 720 | 4 Mbps / 30 fps | Weak or congested Wi-Fi |
| 1080p · 8 Mbps | 1080 | 8 Mbps / 60 fps | Default, solid 5 GHz |
| 1080p · 20 Mbps | 1080 | 20 Mbps / 60 fps | USB or an excellent network |

---

## Releasing

### 1. Create a keystore

```bash
keytool -genkeypair -v \
  -keystore connectsuite-release.jks \
  -alias connectsuite \
  -keyalg RSA -keysize 4096 -validity 10000
```

Back up the `.jks` file and its passwords somewhere durable. Lose them and you can never publish an
update to the same listing — Play matches updates by signing key, and there is no recovery path.

### 2. Point the build at it

```bash
cp keystore.properties.example keystore.properties
# edit keystore.properties with your real passwords
```

`keystore.properties` and `*.jks` are gitignored. If the file is absent the release build still
assembles but comes out **unsigned**, so a missing keystore fails loudly at install time rather
than silently shipping a debug-signed APK.

### 3. Build

```bash
./gradlew :app:assembleRelease          # APK
./gradlew :app:bundleRelease            # AAB, for Play
```

Verify before shipping:

```bash
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs -v \
  app/build/outputs/apk/release/app-release.apk
```

---

## Known limitations

These are platform constraints, not gaps in the implementation. None of them can be worked around
in code.

**No iPhone support for notifications, SMS or call logs.** Apple's sandbox gives third-party apps
no access to Messages, the notification stream, or the call log on either end. An iPhone can
neither send this data to ConnectSuite nor display what ConnectSuite sends. This affects every app
of this kind, not just this one.

**Screen mirroring requires debugging enabled on the target.** Developer Options plus an open
debugging port. There is no API to enable this remotely or silently — that is the entire point of
the restriction.

**Pairing via the 6-digit wireless-debugging code is not implemented.** Android 11+ offers a
TLS-based `adb pair` handshake using SPAKE2. This build implements the classic RSA-authenticated
ADB transport instead, so mirroring targets a port opened with `adb tcpip 5555`. The setup wizard
directs users down the path that works.

**Display capture uses internal framework APIs.** `SurfaceControl.createDisplay` is not public API.
It is reached by reflection with per-release fallbacks, and some Android 14+ OEM builds restrict it
further. When it is unavailable, the session fails with a clear message rather than a blank screen.

**OEM battery managers kill background services.** Xiaomi/HyperOS is the most aggressive, followed
by Samsung, OnePlus, Oppo and Vivo. Android's own battery-optimisation exemption (requested during
onboarding) does not disable these. Users have to allow the app under *Autostart*, *Protected
apps*, or the equivalent in their system settings. This is documentation, not a bug to fix.

**Wi-Fi Direct availability varies.** Some devices have no P2P radio, and some OEM builds limit
concurrent P2P and infrastructure connections. The app detects this and falls back to
local-network discovery, which works whenever both devices share an access point.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| No devices found | Both devices must be on the same Wi-Fi, or use Wi-Fi Direct. Client isolation ("AP isolation") on the router blocks device-to-device traffic entirely — check the router settings. |
| Pairing request never arrives | Grant the nearby-devices permission on both ends. Requests expire after 45 seconds. |
| Paired but "not reachable" | The device's IP changed. Open the app on both ends so they re-announce. |
| Notifications stop after a while | Battery optimisation. Allow the app in *both* Android's setting and your OEM's autostart/protected-apps list. |
| Transfers stall near the end | Usually a Wi-Fi power-save drop. The transfer pauses and resumes automatically once both devices are visible again. |
| Mirror: "Could not reach" | Wrong IP or the port is closed. Re-run `adb tcpip 5555` over USB — a reboot closes it. |
| Mirror: connects then fails at "Starting capture" | The target's build restricts the display-capture APIs. Known on some Android 14+ OEM images. |
| Mirror: no "Allow debugging" prompt | The target's screen must be unlocked for the prompt to appear. |

---

## Testing across OEM skins

Background-service reliability varies more between OEM skins than between Android versions, so
verify on at least these three before sharing publicly:

**Stock Android / Pixel** — the baseline. Notification mirroring should survive overnight with
only the battery-optimisation exemption.

**Samsung One UI** — check *Settings → Battery → Background usage limits*; ensure ConnectSuite is
not in "Sleeping apps" or "Deep sleeping apps". One UI also re-adds apps to that list on its own
after a period of disuse, so re-check after a few days.

**Xiaomi HyperOS / MIUI** — the strictest. Needs *Autostart* enabled, battery saver set to "No
restrictions", and the app locked in the recents view. Verify that a transfer survives the screen
turning off, and that notification mirroring still works an hour after the app was last opened.

For each: pair two devices, send a 500 MB+ file, lock both screens mid-transfer, and confirm it
resumes; then leave the app for an hour and confirm a notification still mirrors.
