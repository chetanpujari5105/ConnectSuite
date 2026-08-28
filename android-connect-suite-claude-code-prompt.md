# Claude Code Build Prompt — "ConnectSuite" (O+ Connect + Screen Mirroring Clone)

Copy the sections below into Claude Code as sequential prompts (one phase at a time). Each phase is self-contained so you can test before moving to the next. Reference repos are listed per phase — tell Claude Code to study their architecture/protocol, not copy code verbatim, so your app is your own IP.

---

## PROJECT OVERVIEW (paste this first as context)

```
I'm building "ConnectSuite" — an Android + Desktop app suite with two independent modules:

MODULE 1: Cross-Device Sync ("Connect")
- Wi-Fi Direct / local-network file transfer between two Android phones, or Android and PC/Mac, at high speed with no mobile data usage.
- Notification mirroring: notifications from phone appear on the connected desktop/other phone.
- Optional SMS/call log sync (Android-to-Android or Android-to-PC only; NOT Android-to-iPhone, which is blocked by Apple's sandbox).
- Encrypted device pairing using certificate pinning, similar to KDE Connect's trust model.

MODULE 2: Screen Mirror & Control ("Mirror")
- Mirror one Android device's screen onto another Android device or a PC, with low latency (<100ms).
- Full touch/keyboard input injection back to the mirrored device.
- Works over USB or same-Wi-Fi TCP/IP using ADB, no root required.

Tech stack: Kotlin for Android app, Electron (Node.js) for the desktop companion app, since I'm comfortable with JS/web dev. Target: Android 10+, works without root.

Reference architectures to study (not copy code, replicate design):
- KDE Connect (github.com/kde/kdeconnect-kde and KDE Connect Android) — pairing/trust model, notification sync protocol
- WiFiDirectFileTransfer-Kotlin (github.com/dawidolko/WiFiDirectFileTransfer-Kotlin) — Wi-Fi Direct file transfer flow
- scrcpy (github.com/Genymobile/scrcpy) — screen capture + ADB streaming architecture
- ScrcpyForAndroid (github.com/zwc456baby/ScrcpyForAndroid) — phone-to-phone mirroring over ADB-over-Wi-Fi

Build this in phases. Confirm each phase compiles and runs before moving to the next. Ask me clarifying questions before writing code if any requirement is ambiguous.
```

---

## PHASE 1 — Project Scaffolding

```
Create the base project structure:

1. An Android Studio project (Kotlin, min SDK 29/Android 10) named "ConnectSuite" with:
   - Package structure: com.[myname].connectsuite.sync and com.[myname].connectsuite.mirror as two separate feature modules
   - Gradle setup for a multi-module app (core, sync-module, mirror-module)
   - Required permissions declared in AndroidManifest.xml: ACCESS_WIFI_STATE, CHANGE_WIFI_STATE, ACCESS_FINE_LOCATION (needed for Wi-Fi P2P discovery), BIND_NOTIFICATION_LISTENER_SERVICE, INTERNET, READ_SMS/READ_CALL_LOG (optional, request at runtime)
   - A simple bottom-nav UI with two tabs: "Sync" and "Mirror"

2. A separate Electron desktop project named "ConnectSuite-Desktop" with:
   - Basic window, IPC setup
   - A settings screen for paired-device management
   - Placeholder screens for "Received Files", "Notifications", "Screen Mirror"

Do not implement any networking logic yet — just scaffolding, navigation, and permission request flows. Show me the file tree when done.
```

---

## PHASE 2 — Device Discovery & Pairing (Module 1 foundation)

```
Implement device discovery and secure pairing for the Sync module:

1. Android side: use WifiP2pManager to discover nearby devices advertising the same service (use WifiP2pManager.Channel + WifiP2pManager.ActionListener + a custom service info record so only ConnectSuite instances show up, not all Wi-Fi Direct devices).

2. Pairing flow: on first connection between two devices, generate an ECDSA or RSA key pair on each device, exchange public keys/certificates over the initial handshake, and store the trusted certificate fingerprint locally (SharedPreferences or Room DB) — model this after KDE Connect's trust-on-first-use pairing, where the user must manually confirm a pairing request shown as a notification/dialog on both ends.

3. All subsequent connections between two already-paired devices should auto-verify via the stored certificate before allowing any data exchange — reject unknown/unpaired devices silently.

4. Desktop (Electron) side: implement the same discovery via mDNS/Bonjour or a simple UDP broadcast on the local network (since desktops don't support Wi-Fi Direct the same way), matching the Android side's protocol so an Android phone and a desktop can discover and pair with each other.

5. Build a simple "Paired Devices" screen listing connected/available devices with connect/forget buttons.

Test scenario: pair two Android phones on same Wi-Fi, and separately pair one Android phone with the desktop app. Confirm pairing request/accept UI works on both ends before moving to Phase 3.
```

---

## PHASE 3 — File Transfer

```
Implement high-speed file transfer over the paired connection:

1. Once two devices are paired (Phase 2), open a TCP socket over the established Wi-Fi Direct group (Android-to-Android) or over the local network socket (Android-to-desktop).
2. Build a chunked file transfer protocol: split files into 64KB-256KB chunks, send with a simple header (filename, total size, checksum), show live progress on both sender and receiver UI.
3. Support multi-file and folder transfer (zip small folders on the fly, or transfer file-by-file with a manifest).
4. Add resume-on-failure: if the connection drops mid-transfer, store partial progress and offer to resume rather than restart.
5. UI: sender picks files via Android's file picker or drag-and-drop on desktop; receiver gets a "Save to Downloads" prompt with speed/ETA shown.

Test with a 500MB+ file to confirm speed and stability before moving to Phase 4.
```

---

## PHASE 4 — Notification & SMS Mirroring

```
Implement notification mirroring:

1. Create a NotificationListenerService on Android that captures posted notifications (app name, title, text, timestamp, small icon) excluding your own app's notifications and any apps the user excludes in settings.
2. Push captured notification data over the already-established paired socket connection (reuse Phase 2/3's transport layer) to the connected desktop or second phone in real time.
3. Desktop app: render incoming notifications in a live feed UI, with click-to-dismiss syncing back to the phone (send a dismiss command back over the socket, and call NotificationManager.cancel() on the phone side).
4. Optional SMS sync: request READ_SMS/RECEIVE_SMS permission, capture new incoming SMS via a BroadcastReceiver on SMS_RECEIVED_ACTION, and push to the desktop feed the same way. Clearly label this as Android-to-Android/PC only — do not attempt this for any iOS target, since Apple blocks this at the OS level for third-party apps.
5. Add a settings toggle to disable notification/SMS mirroring per app, and a master kill switch.

This completes Module 1. Test end-to-end: send an SMS to the paired phone and confirm it appears on desktop within 1-2 seconds.
```

---

## PHASE 5 — Screen Mirroring Foundation (Module 2)

```
Implement the screen mirror module using an ADB-based architecture inspired by scrcpy:

1. On the "controller" side (PC or the controlling phone), implement ADB command execution: detect connected devices via `adb devices`, and for Wi-Fi targets, support `adb tcpip 5555` + `adb connect <ip>:5555` pairing flow with a QR-code or manual IP entry UI.
2. Push a small server component (a lightweight APK/dex payload run via `adb shell app_process`, similar to how scrcpy pushes its server jar) onto the target device that:
   - Uses Android's MediaProjection + VirtualDisplay APIs to capture the screen
   - Encodes the captured frames using the device's hardware H.264/H.265 encoder (MediaCodec API)
   - Streams the encoded frames back to the controller over the existing ADB connection (via `adb forward` a local socket)
3. On the controller (Electron desktop app), decode the incoming H.264 stream (use ffmpeg.js or a native decoder binding) and render it to a canvas/video element in near real time.
4. Add basic connection status UI: resolution, current fps, and latency indicator.

Reference scrcpy's actual open-source server/client split architecture (github.com/Genymobile/scrcpy) for the exact ADB forwarding and encoding approach — implement your own version of this flow rather than embedding their binary, so it's genuinely your build.

Test: mirror one Android phone's screen to the Electron desktop app over USB first, confirm smooth 30fps+ before attempting Wi-Fi mode.
```

---

## PHASE 6 — Input Injection & Phone-to-Phone Mirroring

```
Add remote control and phone-to-phone mirroring:

1. Input injection: on the controller, capture mouse clicks/drags and keyboard input on the mirrored video view, translate coordinates to the target device's actual resolution, and send them as `adb shell input tap x y` / `adb shell input swipe x1 y1 x2 y2 x3 y3 duration` / `adb shell input text "..."` commands (or via the pushed server's direct input injection for lower latency, same approach as scrcpy's control socket).
2. Phone-to-phone mirroring: adapt Phase 5's flow so the "controller" role can run on an Android phone instead of desktop — the controlling phone needs ADB client capability, which requires either a rooted setup or a companion pairing app on the target phone that accepts wireless debugging pairing codes (Android 11+ supports pairing wireless debugging via a 6-digit code without USB, use `adb pair` flow). Reference ScrcpyForAndroid's structure (github.com/zwc456baby/ScrcpyForAndroid) for this specific phone-to-phone flow.
3. Add a resolution/bitrate selector (e.g., 720p/15Mbps for weak Wi-Fi vs 1080p/30Mbps for USB) so users on slow networks aren't stuck with unusable lag.
4. Add a clear one-time setup wizard walking the user through enabling Developer Options + Wireless Debugging, since this is the single biggest onboarding blocker for non-technical users.

Test full remote control (tap, swipe, type) both over USB and over Wi-Fi before considering this module complete.
```

---

## PHASE 7 — Polish, Packaging, Distribution

```
Final polish pass before sharing publicly:

1. Add a unified onboarding flow explaining both modules (Sync and Mirror) with permission requests batched sensibly, not all at once.
2. Add error handling for common failure modes: Wi-Fi Direct not supported on device, ADB debugging not enabled, pairing timeout, connection drop mid-transfer.
3. Build a signed release APK (guide me through generating a keystore and signing config in build.gradle).
4. Package the Electron app for Windows and macOS using electron-builder.
5. Write a README covering setup, known limitations (no iOS notification/SMS sync possible; screen mirroring requires Developer Options), and troubleshooting.
6. Suggest a battery-optimization exemption request flow so background notification listening doesn't get killed by Android's aggressive power management (especially on Xiaomi/OnePlus/Samsung which have their own battery managers).

Once this is done, walk me through testing on at least 3 different Android OEM skins (Samsung One UI, Xiaomi HyperOS/MIUI, stock Android) since background service reliability varies a lot across them.
```

---

## Known Hard Limits (do not attempt to work around these)

- No notification, SMS, or call-log sync to/from iPhone — Apple's sandbox blocks this for all third-party apps, not just yours.
- Screen mirroring/control always requires Developer Options + USB or Wireless Debugging enabled on the target device — there is no way to enable this remotely or silently; the user must do it manually once.
- Some OEM battery managers (especially Xiaomi, and to a lesser extent Samsung) may kill background services unless the user manually whitelists the app — this needs to be documented for end users, not "fixed" in code.
