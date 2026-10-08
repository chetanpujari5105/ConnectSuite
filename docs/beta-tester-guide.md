# Sidekick beta — install and pair (one page)

Sidekick connects your Android phone and your Mac directly over your own Wi-Fi (or your phone's hotspot).
There is no account and no server. This is a **test build from one developer**: neither app is signed by Apple
or listed on Google Play, so both systems will warn you before they open it. Each warning below is expected;
the steps say exactly what you will see. **Never turn off Gatekeeper or System Integrity Protection** — nothing
here needs it.

**You need:** a Mac on macOS 11 or later, an Android phone on Android 10 or later, both on the same network,
and about ten minutes.

## Mac

1. Open the `.dmg` you were sent (`Sidekick-2.0.0-arm64.dmg` for Apple-silicon Macs, `Sidekick-2.0.0.dmg` for
   Intel) and drag **Sidekick** into **Applications**.
2. Open Sidekick from Applications. macOS says it **could not verify** the app and offers only *Done* and
   *Move to Bin*. Choose **Done**.
3. Open **System Settings → Privacy & Security**, scroll to the message about Sidekick being blocked, click
   **Open Anyway**, enter your Mac password, then click **Open** in the dialog that follows. You do this once.
4. When macOS asks whether Sidekick may **find devices on your local network**, click **Allow** — this is how it
   reaches your phone. Sidekick now shows a pairing code (a QR code).

## Phone

1. Open the `.apk` you were sent (from your Downloads, Files app or browser).
2. Android asks you to allow that app to **install unknown apps**. Turn it on for that one app, go back, and tap
   **Install**. If Google Play Protect warns that the app is from an unknown developer, read the warning; tap
   **More details → Install anyway** only if this file came from the person who invited you. *(Some countries
   now restrict apps from unregistered developers on certified phones; if Android refuses outright, tell the
   developer which country your phone is set to.)*
3. Open **Sidekick**. Go through the short introduction, then **Link your Mac → Scan**, and allow the camera when
   asked. The code is read on the phone; the camera picture goes nowhere.
4. Point the phone at the code on your Mac. Both screens say **Paired** within a few seconds.

## After pairing

- **Grant only what you want to use.** Each feature asks for its own permission the first time you turn it on
  (notifications, messages, calls, photos, screen mirroring, Send to Mac). Everything works without the ones you
  skip, and each screen says what is missing.
- If the Mac ever shows **"This Mac still remembers a phone"** with a **Forget** button, press it, then scan the
  new code; on the phone, remove the Mac under **Paired Macs** too.
- If Sidekick on the Mac shows **"Sidekick can't use this Mac's saved key"**, choose **Quit** and tell the
  developer — do not choose *Start Over* unless asked; it means pairing again.

## Removing it

- **Phone:** uninstall Sidekick — that removes its data. Files it received stay in `Download/ConnectSuite`.
- **Mac:** quit Sidekick, move it from Applications to the Bin, delete
  `~/Library/Application Support/sidekick-desktop`, and in **Keychain Access** delete the item *Sidekick Safe
  Storage*. Files it received stay in `~/Downloads/Sidekick`.

## Reporting a problem

Say what you did, what you expected, and what the screen said, word for word. If the developer asks for logs:
Mac — `~/Library/Application Support/sidekick-desktop/logs/`; phone — the developer will tell you how. Logs hold
connection states, counts and **file names**; they are written to carry no message text, clipboard text or
phone numbers.
