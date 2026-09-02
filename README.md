# ConnectSuite

Two independent tools in one Android app, both running entirely over your own network — no
account, no server in the middle, no mobile data.

| Module | What it does |
| --- | --- |
| **Sync** | Pair two devices, send files at Wi-Fi speed, and mirror notifications and incoming SMS between them. |
| **Mirror** | Put this phone's screen on a paired Mac and control it from there. No root, no debugging, no setup. |

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

Capture is `MediaProjection`, encode is `MediaCodec`, and the frames go to the paired Mac over the
v2 link's video socket. **There is no ADB anywhere in this path** — locked architecture decision #1
in `CLAUDE.md`.

1. The Mac sends `mirror.start`. The phone raises Android's own capture-consent prompt and the user
   taps to allow it.
2. `MediaProjection` gives us a virtual display; it is pointed at a `MediaCodec` hardware H.264
   encoder's input surface.
3. The elementary stream goes back over port 42502, authorised by the session token from the
   control handshake.
4. The Mac decodes and draws it, and sends touches and typed text back on the control channel,
   translated to the phone's own resolution. Input is injected by an `AccessibilityService`.

Frames never touch the heap on either side — display surface into encoder, decoder into view
surface — which is what keeps latency low rather than merely the framerate high.

### Setup

**None.** Mirroring needs no permission you have not already granted and no developer settings on
either machine. Two things about it are worth knowing, because both are Android's rules rather than
ours:

- **Android asks every time.** `MediaProjection` consent cannot be cached across sessions on
  Android 14+, so every mirroring session begins with a tap on the phone. No app can turn this off.
- **Some surfaces stay black.** The lock screen, banking apps and DRM video set `FLAG_SECURE`, and
  Android hands us black frames for them. The Mac shows a message saying so rather than a blank
  window.

An earlier version of this app mirrored a *second Android device* over an ADB connection, using a
pushed `connectsuite-server.dex` running as uid 2000. That implementation, its `LEGACY_ADB_MIRROR`
flag and the `:mirror-server` module were **deleted on 2026-08-26** once the MediaProjection path
passed on hardware. If you find instructions anywhere telling you to run `adb tcpip 5555`, they are
describing software that no longer exists.

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

**Mirroring consent cannot be remembered.** `MediaProjection` requires a fresh user tap on the
phone for every session on Android 14+. There is no API to cache it and no flag to disable the
prompt.

**Secure surfaces capture as black frames.** Anything marked `FLAG_SECURE` — the lock screen,
banking apps, DRM video — is blanked by Android itself during capture. The Mac detects it and says
so rather than showing a black window and no explanation.

**Call audio cannot be streamed.** `CAPTURE_AUDIO_OUTPUT` is system-only, and recording calls
through an `AccessibilityService` violates Play policy. Pair the Mac to the phone over Bluetooth as
an audio device instead.

**Hardware keys cannot be pressed remotely.** There is no public API for an `AccessibilityService`
to synthesise a `KeyEvent`; `INJECT_EVENTS` is signature-level. Volume, power and hardware keys are
therefore not remotable — text entry and the global actions (back, home, recents, notifications,
quick settings, lock screen, power menu) are the whole of what can be injected.

**There is no path-based view of shared storage.** Scoped storage is not optional at `targetSdk
36`, so file browsing works over SAF trees the user has granted, one folder at a time. Android
refuses a grant on the storage root and on `Download` itself; folders inside `Download` are
grantable, which is why files sent from the Mac land in `Download/ConnectSuite`. A file sitting
directly in `Download/` cannot be reached by this app. `MANAGE_EXTERNAL_STORAGE` would lift this
and is deliberately not requested.

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
| Mirror: the Mac asks and nothing happens | Android will not let a backgrounded app raise the capture prompt. Open ConnectSuite on the phone, go to the Mirror tab, and tap **Start** — that tap is the foreground Android insists on. |
| Mirror: the window is black | The app on screen sets `FLAG_SECURE` (lock screen, banking, DRM video). Android blanks it during capture; nothing can be done about it. |
| Mac never connects after pairing | Both must be on the same Wi-Fi. The phone's Mac tab says how long it has been waiting and whether anything was refused. |
| The link is gone after a phone restart | It comes back at your **first unlock**, not at boot — the trust store is credential-encrypted, so Android holds `BOOT_COMPLETED` until then. |

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

---

## About this repository

### Commit history

Work on ConnectSuite began **2026-08-21**. The repository was initialised **2026-08-28**, so the
first seven days are consolidated into the root commit (`Phase 4: four Mac panes …`, 205 files)
rather than spread across the commits that produced them. Phases 1, 2 and 3 were built, and passed
on hardware, before the first commit exists — their dates are recorded in `CLAUDE.md`'s roadmap
table and in `docs/testing.md`, which is where the real chronology lives.

Commit dates are the dates the commits were made and have not been adjusted.

### Phone numbers and contact names are substitutions

Every phone number and personal contact name in the documentation, the test fixtures and the
commit messages is a **substitution, not a real number or a real person**. The numbers
(`9800000001`, `9900000002`, `8800000004`, and others of that shape) and the contact labels
(`Contact B`, `Contact D`, `Contact G`) replace the real ones the features were developed against.

They were substituted throughout the history — blobs and commit messages alike — before this
repository was first published, because the call, SMS and contact features were necessarily built
and verified against real people's numbers, and those are not ours to publish.

The substitution is **stable and shape-preserving**: one real number maps to exactly one
replacement everywhere it appears, in every form (bare, `91`-prefixed, `+91`-prefixed, and spaced).
This matters because it is load-bearing — `CallNumberRulesTest` and `scripts/step70-gate.mjs`
assert *equality and containment between* numbers rather than against literals, so the defect
narratives in `docs/defects.md` and `docs/testing.md` still describe the failures they actually
describe, and the suites still pass for the reasons they always passed.

`Chetan` is the author and is not a substitution.
