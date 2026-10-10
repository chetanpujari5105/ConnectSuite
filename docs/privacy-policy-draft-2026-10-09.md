# Privacy policy and Data safety — DRAFT (2026-10-09, release candidate `34362e1`)

Supersedes the skeleton in `docs/release-policy-addendum-2026-10-08.md` §2 and the Data safety table in
`docs/privacy-and-distribution-2026-10-07.md` §5.3 now that the QR scanner is ZXing (item 4). **Nothing here is
published.** Every sentence in §1 maps to a reading in §2–§5. Fields in `[[BRACKETS]]` are the owner's to supply;
none was invented.

## What the owner must still supply

| Field | Where it appears |
|---|---|
| `[[PUBLISHER LEGAL NAME]]` | policy header, contact |
| `[[POSTAL ADDRESS]]` | policy header |
| `[[SUPPORT EMAIL]]` | policy header, contact, tester guide |
| `[[EFFECTIVE DATE]]` | policy header |
| `[[WHERE THE POLICY IS HOSTED]]` | a URL testers and (later) Play can open — needs no server of Sidekick's; any static page |
| `[[HOW CHANGES ARE ANNOUNCED]]` | policy §Changes |
| Decision: may the phone's diagnostic logs move in a device-to-device transfer? (today: not excluded) | §2 *Backups* |
| Decision: rewrite Activity history written before `219cb76` that may hold clipboard link hosts? (irreversible) | §2 *Mac* |

---

## 1. Privacy policy (draft text)

> **Sidekick privacy policy** · Effective `[[EFFECTIVE DATE]]` · Published by `[[PUBLISHER LEGAL NAME]]`,
> `[[POSTAL ADDRESS]]` · Contact `[[SUPPORT EMAIL]]`
>
> **What Sidekick is.** Two apps — one for your Android phone, one for your Mac — that connect directly to each
> other on your own network. There is no Sidekick account and no Sidekick server, and we receive nothing from
> either app.
>
> **What moves between your devices.** When you turn a feature on, Sidekick moves that feature's data between
> your phone and your Mac only: notifications, text messages, call events, contacts you look up, clipboard
> text, files and photos you choose, the list of apps you can open, battery and network status, and your
> phone's screen while you mirror it. It travels over an encrypted connection (TLS 1.3) whose keys are pinned
> when you pair the two devices by scanning a code. If you enter a Tailscale address on the Mac, the connection
> runs over your own Tailscale network instead of your local one.
>
> **What leaves your network.** Nothing, from Sidekick. Neither app contains analytics, advertising, crash
> reporting or any other service that sends data to us or to a third party. The phone's QR scanner reads the
> code on the phone itself.
>
> **What is stored, and where.**
> - *On your Mac:* files you copy to it (in `~/Downloads/Sidekick`, or the folder you choose); an Activity
>   history of what happened (event types, times, file names, and call events with the contact's name but never
>   the number), kept to the latest 2,000 events; diagnostic logs (connection states, counts and file names — no
>   message, clipboard or file content), at most about 1 MB; your settings and the pairing record; and this
>   Mac's private key, sealed in your login Keychain. All of it is in
>   `~/Library/Application Support/sidekick-desktop` except the files you received and the Keychain item.
> - *On your phone:* files sent to it (in `Download/ConnectSuite`, or Sidekick's private storage); the pairing
>   record; a transfer history; diagnostic logs of the same kind, at most about 1 MB; and the phone's private key,
>   kept in Android's hardware-backed Keystore, which cannot be exported.
> - *Clipboard history* is kept in memory only — at most 20 entries — and cleared when the connection ends.
>   Notifications, messages, call lists, contacts and photos shown on the Mac are held in memory while you are
>   connected and are not written to disk, except a photo or file you choose to save.
>
> **How long.** Until you delete it: received files stay where you put them; the Activity history keeps the
> latest 2,000 events; logs rotate at about 512 KB; the in-memory data above goes when the connection ends or
> the app quits.
>
> **How to delete it.** *Phone:* uninstall Sidekick (files it received stay in `Download/ConnectSuite` until you
> delete them). *Mac:* quit Sidekick, delete it, delete `~/Library/Application Support/sidekick-desktop`, and in
> Keychain Access delete the item named *Sidekick Safe Storage*; files you received stay in `~/Downloads/Sidekick`
> until you delete them. *Forget* on either device removes the pairing.
>
> **Backups.** The phone app opts out of Android cloud backup. On the Mac, Time Machine includes the folder
> above unless you exclude it.
>
> **Permissions.** Each Android permission is asked for when you turn on the feature that needs it, and the
> feature works only while it is granted; you can revoke any of them in Android Settings. The full list and what
> each is for is in the app's information page `[[LINK]]`.
>
> **Children.** Sidekick is not directed at children under 13.
>
> **Changes.** `[[HOW CHANGES ARE ANNOUNCED]]`. **Contact.** `[[SUPPORT EMAIL]]`.

## 2. The readings behind §1

| Sentence | Reading |
|---|---|
| *No analytics, crash reporting or third-party service* | Phone: release runtime classpath has **0** Google Play-services / Firebase / ML Kit / `datatransport` artifacts and no other networking library; phone main sources contain **0** `http` strings; release dex byte-search **0** (positive control 1). Mac: 59 bundled npm packages, none a telemetry SDK (list in §5). `docs/release-candidate-2026-10-09.md` §3 |
| *The scanner reads the code on the phone* | ZXing core 3.5.3: no runtime dependencies, no socket/`URLConnection`/process references (item 4) |
| *Activity: call events with the contact's name, never the number; 2,000 events* | defects 181/191; `activity.ts` `MAX_EVENTS = 2_000` |
| *Logs ≈ 1 MB, file names, no content* | phone `LinkLog.MAX_BYTES = 512 KB` + one rotated file; Mac `logger.ts` 512 KB × 2; file names per PC-only audit F2. **Activity history written before `219cb76` may hold a clipboard link's host** — owner decision whether to rewrite it |
| *Clipboard: memory only, 20 entries, cleared on disconnect* | `docs/phase-5-clipboard-proposal.md` §6; clipboard text is never logged (re-checked for this batch's new log lines) |
| *Phone opts out of cloud backup* | `android:allowBackup="false"`; `data_extraction_rules.xml` excludes `sharedpref` and `database`. **Open:** the `files` domain (diagnostic logs) is not excluded from device-to-device transfer on Android 12+ — owner decision to exclude or state it |
| *Mac key in the Keychain* | `safeStorage`; item name measured 2026-10-08 (attributes only) |

## 3. Android permissions — what each is for (release manifest, 31)

| Permission | For |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `CHANGE_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE` | the local link to the Mac and finding each other on the network (mDNS). No internet destination is contacted |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (Android 12 and older only) | Android requires them on those versions to read Wi-Fi network details; no location is read |
| `NEARBY_WIFI_DEVICES` (`neverForLocation`) | the same on Android 13+, declared as never used for location |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` | keeping the link to the Mac alive, with a visible notification |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | screen mirroring, after Android's own consent dialog each time |
| `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | reconnecting after sleep and restart. **Cost stated (kept by decision, defect 205):** while a Mac is connected the link keeps the phone's processor awake — ≈ 20 mAh per hour on the test phone (≈ 0.4 % of a 5,000 mAh battery), one reading. It is released when the Mac disconnects or sleeps; a night with the Mac asleep measured Sidekick at under 1 mAh |
| `POST_NOTIFICATIONS` | the link's status notification and the clipboard, share and app-opening prompts |
| `READ_SMS`, `RECEIVE_SMS`, `SEND_SMS` | showing and sending text messages from the Mac |
| `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE`, `ANSWER_PHONE_CALLS` | call events, recent calls, dialling and answering from the Mac |
| `READ_CONTACTS` | names and photos beside messages and calls |
| `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` (≤ Android 12) | the photo and video browser; partial access is honoured |
| `CAMERA` | scanning the pairing code (the camera feature is not in this build) |
| `com.chetan.connectsuite.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | added by AndroidX so the app's own internal broadcasts cannot be received by other apps |

**Granted by hand in Settings, not by a permission prompt:** notification access (notifications on the Mac),
the accessibility service (Mac → phone input), and screen-capture consent (each mirroring session).

## 4. Google Play Data safety — draft answers (Play is out of scope for this beta; kept for later)

| Question | Draft answer | Note |
|---|---|---|
| Does the app collect or share user data? | **No** | Data moves only between the user's own two devices, end-to-end encrypted, initiated by the user, with no developer server. Whether Play's form treats such transfers as "not collected" must be confirmed against the form's current wording before submitting |
| Is data encrypted in transit? | Yes — TLS 1.3, both ends pinned | |
| Can users request deletion? | Yes — all data is on the user's devices; uninstall / Forget / delete the Mac folder | No server copy exists |
| Third-party SDKs that collect data | None (ML Kit removed 2026-10-08) | release classpath reading above |
| SMS / Call Log permissions | **Not assessed.** Play restricts these to default-handler apps and listed exceptions; whether any exception covers this app must be checked against Play's current policy before a Play build | blocking for Play only |

## 5. Third-party licences (from the real dependency graph)

**Mac** (59 packages read from this build's `app.asar`): MIT 47, ISC 8, BSD-3-Clause 1, BSD-2-Clause 1,
BSD-3-Clause OR GPL-2.0 1 (`node-forge`; BSD-3-Clause elected), MIT OR CC0-1.0 1; plus Electron 43.4.1 (MIT) with
Chromium's and Node's notices inside the framework. Full list: `docs/evidence/release-candidate-2026-10-09/mac-licences.tsv`.

**Phone** (release runtime classpath, 153 external artifacts — `android-licences.tsv` in the same folder): `com.google.zxing:core` — Apache-2.0 **read from
its POM**. The other 152 are AndroidX (`androidx.*`), Kotlin and kotlinx (`org.jetbrains.*`), Okio, Guava
`listenablefuture`, AutoValue annotations and JSpecify — all published by their owners under Apache-2.0, but
**not read from the artifacts**: the Gradle cache holds Gradle module metadata for them, not POMs, so the
licence field could not be read offline. A licence-report plugin, or one online fetch of the POMs, would settle
it — owner approval needed either way.

**Neither app has a notices screen.** Required before a public release; for a named-tester beta, shipping this
list beside the downloads is the interim.
