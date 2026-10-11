# Sidekick beta — install and pair (one page)

*Updated 2026-10-12 for the beta token (builds from `711a1e0` on; release candidate `8f8ecbb` has no token
step). Statements the owner has not yet confirmed on a fresh Mac
account or a tester's phone are listed in `docs/release-candidate-2026-10-11.md` §5 — not in this page.*

Sidekick connects your Android phone and your Mac directly over your own Wi-Fi (or your phone's hotspot).
There is no account and no server. This is a **test build from one developer**: neither app is signed by Apple
or listed on Google Play, so both systems will warn you before they open it. Each warning below is expected.
**Never turn off Gatekeeper or System Integrity Protection** — nothing here needs it.

**You need:** a Mac on macOS 11 or later, an Android phone on Android 10 or later, both on the same network,
and about ten minutes.

## Mac

1. Open the `.dmg` you were sent (`Sidekick-2.0.0-arm64.dmg` for Apple-silicon Macs, `Sidekick-2.0.0.dmg` for
   Intel) and drag **Sidekick** into **Applications**. *(The Intel build has never been run on an Intel Mac — if
   you have one, say so in your report.)*
2. Open Sidekick from Applications. macOS says it **could not verify** the app and offers only *Done* and
   *Move to Bin*. Choose **Done**.
3. Open **System Settings → Privacy & Security**, scroll to the message about Sidekick being blocked, click
   **Open Anyway**, enter your Mac password, then confirm **Open Anyway** in the dialog that follows. You do
   this once.
4. Sidekick asks for your **beta token** — the text or the `.sidekick-token` file you were sent with the app.
   Paste it into the box and press **Use this token**, or press **Open token file…** and choose the file. The
   token is checked on your Mac; nothing is sent anywhere.
5. If macOS asks whether Sidekick may **find devices on your local network**, click **Allow** — this is how it
   reaches your phone. Sidekick shows **Scan this with your phone** and a pairing code.

## Phone

1. Open the `.apk` you were sent (from your Downloads, Files app or browser).
2. Android asks you to allow that app to **install unknown apps**. Turn it on for that one app, go back, and tap
   **Install**. If Google Play Protect warns that the app is from an unknown developer, read the warning; install
   anyway only if this file came from the person who invited you. *(Some countries now restrict apps from
   unregistered developers on certified phones; if Android refuses outright, tell the developer which country
   your phone is set to.)*
3. Open **Sidekick** and tap **Get started**. Read the short introduction (**Continue**), then on
   **Connect your Mac** tap **Scan the code** and allow the camera when asked. The camera is used only to read
   the code, on the phone; the picture goes nowhere.
4. Point the phone at the code on your Mac. The phone shows **Paired with** your Mac's name, and the Mac's
   Overview shows your phone as **Connected**.

## Using it on the Mac

The Overview screen has three buttons under your phone's card:

- **Start mirroring** (⌘⇧M) — shows your phone's screen on the Mac. Android asks you to allow it **every time**
  mirroring starts; that is Android's rule, not a fault. Banking apps and the lock screen show as black.
- **Send files** — choose files on your Mac; Sidekick shows what will be sent and to where before anything
  moves, then the progress. They arrive in **Download › ConnectSuite** on the phone (called *Received files*
  in Sidekick). The button is greyed, with the reason on hover, when the phone is not connected or cannot
  receive files.
- **Device info** — the connection and what the phone is offering.

**Recent activity** below them lists the latest events; **View all** opens the full Activity list.

Camera and webcam are **not** in this build.

## Your beta token

- Your access runs until the date in your token — 45 days. **Settings › About › Beta access** shows the end
  date and how many days are left. You get one quiet notice 7 days before the end and one the day before.
- Reinstalling Sidekick does not change the end date — it is part of the token.
- When it ends, Sidekick shows a screen saying so, with a box for a new token. **Nothing is deleted or hidden:**
  Activity, Settings and the files you received are all still there, and Activity can still be exported.
  Ask the developer for a new token and enter it there, or in Settings › About.
- If Sidekick says your Mac's date looks earlier than before, check **System Settings › General › Date &
  Time**. Fixing the date fixes it.
- If a token is refused, the message says why — not copied completely, not issued for this build, ended, or
  not started yet.

## After pairing

- **Grant only what you want to use.** Each feature asks for its own permission the first time you turn it on
  (notifications, messages, calls, photos, screen mirroring, Send to Mac). Everything else works without the
  ones you skip, and each screen says what is missing.
- **Battery:** while your Mac is awake and connected, Sidekick keeps the phone ready to answer it. On the
  developer's phone that cost about 0.4 % of the battery per hour (one measurement, one phone). When the Mac
  sleeps or disconnects, that stops. If Sidekick is high in your phone's battery list **with the Mac asleep**,
  tell the developer. If your phone stops Sidekick in the background, look in its settings for "Battery" or
  "Background usage" for Sidekick and allow it.
- If the Mac ever shows **"This Mac still remembers a phone"** with a **Forget** button, press it, then scan the
  new code; on the phone, remove the Mac under **Paired Macs** too.
- If Sidekick on the Mac shows **"Sidekick can't use this Mac's saved key"**, choose **Quit** and tell the
  developer — do not choose *Start Over with a New Key* unless asked; it means pairing again.

## Removing it

- **Phone:** uninstall Sidekick — that removes its data. Files it received stay in `Download/ConnectSuite`.
- **Mac:** quit Sidekick, move it from Applications to the Bin, delete
  `~/Library/Application Support/sidekick-desktop`, and in **Keychain Access** delete the item *Sidekick Safe
  Storage*. Files it received stay in `~/Downloads/Sidekick`.

## What to report

One message per problem, with:

1. **What you did**, step by step, and **what you expected**.
2. **What the screen said, word for word** (a screenshot is fine — crop out anything personal).
3. **When** it happened (date and time), so it can be found in the logs.
4. Your **Mac model and macOS version**, your **phone model and Android version**, and which `.dmg` you used.
5. Whether it happens **again** if you repeat it.

Also worth reporting: anything that took longer than you expected, any warning you were not told about above,
and any wording you did not understand.

If the developer asks for logs: Mac — `~/Library/Application Support/sidekick-desktop/logs/`; phone — the
developer will tell you how. Logs hold connection states, counts and **file names**; they are written to carry
no message text, clipboard text or phone numbers. Look through them before sending if you want to.
