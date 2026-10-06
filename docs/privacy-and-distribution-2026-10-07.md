# Privacy, policy and distribution package — DRAFT (2026-10-07)

> **Drafts for the owner, not a compliance certificate.** Nothing here is legal advice or a store reviewer's
> verdict. Publisher identity, support contact and any jurisdiction-specific wording are **owner-supplied**
> and appear as `[OWNER: …]`; none is invented. Builds on `docs/release-audit-2026-10-06.md` §C (P1–P14),
> whose sources were read on 2026-10-06; two of them were re-read today (§7).

## 1. Data flows — what the product handles, where it goes, how long it stays

Read from source at `f8dabdf`. **"No cloud" is a statement about Sidekick's own design, not a measurement of
all network traffic** — see §3. Every phone ↔ Mac transfer below is TLS 1.3 between the person's own two
devices, both ends pinned by certificate fingerprint; there is no Sidekick server or account.

| Data | Read on | Sent to | Stored where, how long | Deletion |
|---|---|---|---|---|
| Notifications (app, title, text, actions) | phone (notification listener) | the paired Mac | Mac: memory while connected; not logged (defect 179: tags hashed) | gone on disconnect / quit |
| SMS/MMS threads, sending | phone (`READ_SMS`, `SEND_SMS`, `RECEIVE_SMS`) | Mac | Mac: memory | gone on disconnect / quit |
| Call log, call state, dialling | phone (`READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE`, `ANSWER_PHONE_CALLS`) | Mac | Mac memory; Activity rows record call **events** with numbers redacted (defect 181/191) | Activity file, below |
| Contacts | phone (`READ_CONTACTS`) | Mac (lookups, photos) | Mac: memory cache, cleared on disconnect | — |
| Photos & videos | phone (`READ_MEDIA_*`, limited access honoured) | Mac on request | Mac: thumbnails in memory; preview originals in a temp folder (`$TMPDIR/sidekick-preview`), cleared at app start; **Save** writes to the receive folder (default `~/Downloads/Sidekick`) | person deletes saved files |
| Files | phone (SAF trees the person granted; `Download/ConnectSuite`) | Mac on request; Mac → phone on request | receive folder; phone `Download/ConnectSuite`; Mac pull-resume records in the app profile | person deletes; records removed on completion/cancel/Forget |
| Clipboard | phone (only while Sidekick is focused, or text another app hands it); Mac (watcher, if enabled) | the other device | **memory only**, 20 entries × 64 KB, cleared on disconnect; never logged (text, sender app — defect 194) | gone on disconnect / quit |
| Screen (mirroring) and input | phone (MediaProjection, consent each time; AccessibilityService for input) | Mac, live only | not recorded; a screenshot is saved to the Desktop only when the person presses Capture | person deletes |
| Installed launcher apps (names, icons) | phone | Mac | memory | — |
| Battery, network vitals | phone | Mac | memory | — |
| Pairing identity | both | each other's certificate fingerprint | phone: Android Keystore key + Room trust store; Mac: key encrypted with `safeStorage` (Keychain) in the app profile, pairing record in settings | **Forget** on either side; uninstall |
| Diagnostic logs | both | **nowhere** (not uploaded) | phone `files/logs/link.log` ≤ 512 KB + one rotated file; Mac `logs/` ≤ 512 KB + one rotated file. Lengths, counts and states — no message, clipboard or file content by design | phone: clear data / uninstall; Mac: delete the profile folder |
| Activity history (Mac) | Mac | nowhere | `logs/activity.jsonl`, last 2,000 events read; details truncated; call numbers redacted | delete the profile folder; CSV export is the person's own file |

**Mac profile location:** `~/Library/Application Support/<profile>` (`sidekick-desktop` for the current builds;
the packaged name is to be confirmed on the first packaged run). **Deleting all Mac-side data** = quit Sidekick,
delete that folder, delete the Keychain item *“<app> Safe Storage”*, and delete the receive folder if wanted.
This is **not yet documented to users** (P10).

**Backups.** Phone (read from the manifest): `android:allowBackup="false"`, and `data_extraction_rules.xml`
excludes `sharedpref` and `database` from both cloud backup and device-to-device transfer, so the trust store
and settings never leave the phone that way; the Keystore identity key cannot be exported at all. **To confirm,
not assumed:** on Android 12+ `allowBackup="false"` does not stop device-to-device migration, and the `files`
domain (diagnostic logs) is not excluded there — counts and states only, but it should be stated or excluded.
Mac: the profile is inside `~/Library`, so **Time Machine includes it** unless excluded; the receive
folder is backed up like any Downloads file.

## 2. Permissions (phone) and why each exists

`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `CHANGE_WIFI_STATE`,
`CHANGE_WIFI_MULTICAST_STATE` (LAN link, mDNS) · `ACCESS_FINE/COARSE_LOCATION` (≤ API 32 only, Wi-Fi P2P
discovery; no location read) · `NEARBY_WIFI_DEVICES` (`neverForLocation`) · `FOREGROUND_SERVICE` +
`_CONNECTED_DEVICE`, `_DATA_SYNC`, `_MEDIA_PROJECTION` · `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`,
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (keep the link) · `POST_NOTIFICATIONS` · `READ_SMS`, `RECEIVE_SMS`,
`SEND_SMS` · `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE`, `ANSWER_PHONE_CALLS` · `READ_CONTACTS` ·
`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` (≤ 32) ·
`CAMERA` (QR scan; camera feature when enabled). **Special access, granted by hand:** notification listener,
AccessibilityService (input), MediaProjection (each session). Play eligibility per permission: audit §C P1–P8.

## 3. "No cloud" versus external traffic — and ML Kit

| Component | Known external traffic | Evidence |
|---|---|---|
| Sidekick's own code, both apps | none designed: the phone listens on the LAN, the Mac connects to it; no server, no analytics, no crash reporter | source |
| **ML Kit barcode scanning (phone)** | **yes, by its own terms**: *"The ML Kit APIs also send metrics about the performance and utilization of the APIs in your app to Google"*, and *"may contact Google servers from time to time in order to receive things like bug fixes, updated models and hardware accelerator compatibility information."* Input images and results stay on the device. *"You are responsible for informing users … about Google's processing of ML Kit metrics data."* | terms re-read 2026-10-07 |
| ML Kit's dependency graph | the release classpath includes `com.google.android.datatransport:transport-backend-cct` and `com.google.firebase:firebase-components`/`-encoders(-json)` — Google's logging transport | `:app:dependencies --configuration releaseRuntimeClasspath`, offline, 2026-10-07 — **structural, not a traffic reading** |
| Android / macOS themselves | OS-level traffic exists regardless of Sidekick and is not Sidekick's to disclose | — |
| Electron/Chromium (Mac) | none expected from the configuration (no auto-update, no remote content); **unmeasured** | — |

**A short traffic capture would not prove absence**: metrics are batched and sent on the transport's own
schedule, possibly hours later or on another network.

**Options for P3 / defect 188 (owner decision):**

1. **Disclose** (fastest, honest): change *"No cloud, no account, nothing leaves your network"* to wording that
   is true — e.g. *"Your messages, files and screen go only between your phone and your Mac. No Sidekick
   account or server. The QR scanner (Google ML Kit) sends Google anonymous usage metrics."* — and say it in
   the privacy policy and Data safety.
2. **Replace the scanner** with an on-device decoder that has no network path (e.g. ZXing `core`, Apache-2.0,
   driven by the existing CameraX `ImageAnalysis`). Removes ML Kit, Play-services and the transport from the
   APK. Costs: a new dependency (needs approval), decode quality to be measured on hardware, and ZXing is in
   maintenance mode. **Recommended for v1** if the "nothing leaves your network" promise is to stay.
3. Google's code-scanner API: still a Google component; does not remove the question.

**Not done tonight:** no copy changed, no dependency added, no capture run.

## 4. Dependencies and licences (local inventory, nothing transmitted)

**Mac — what ships** (read from the packaged `app.asar`, 2026-10-07): **53 npm packages** — MIT 41, ISC 8,
BSD-3-Clause 1 (`fast-uri`), BSD-2-Clause 1 (`json-schema-typed`), MIT-or-CC0 1, **`node-forge` 1.4.0
BSD-3-Clause OR GPL-2.0** (BSD-3-Clause elected). Plus Electron 43.4.1 (MIT) with Chromium and Node.js, whose
notices ship inside the framework (`LICENSES.chromium.html`). Full list:
`docs/evidence/privacy-2026-10-07/mac-shipped-packages.txt`.

**Phone — release runtime classpath** (173 artifacts, offline): androidx 134, Kotlin/kotlinx 16, ML Kit 5,
Play services 4, Firebase 4, datatransport 3, okio 2, ODML 1, AutoValue 1, Guava 1, javax.inject 1, JSpecify 1.
**Per-artifact licences could not be read locally** (the Gradle cache holds the `.aar`s, not the POMs).
By publisher: AndroidX, Kotlin, okio, Guava, AutoValue, javax.inject, JSpecify are Apache-2.0; ML Kit, Play
services, Firebase and datatransport are distributed under Google's SDK terms (proprietary; ML Kit terms
above). **A notices screen does not exist in either app** — needed before release; Google's
`oss-licenses` plugin or a generated asset are the usual routes (a new build plugin needs approval).
Full list: `docs/evidence/privacy-2026-10-07/phone-runtime-artifacts.txt`.

**Vulnerability audit:** **not run.** `npm audit` / OSV would send the dependency list off this machine or
install a scanner; both need approval (tracker U-2 unchanged).

## 5. Drafts

### 5.1 Privacy policy (draft)

> **Sidekick Privacy Policy** — `[OWNER: effective date]` — Publisher: `[OWNER: legal name, address]` —
> Contact: `[OWNER: support email]`
>
> Sidekick connects your Android phone and your Mac directly over your local network. There is no Sidekick
> account and no Sidekick server. **What moves between your devices:** notifications, messages, call events,
> contacts, photos, files, clipboard text, your phone's screen and the input you send to it — each only when
> you use the feature, and only between the phone and the Mac you paired by scanning a code. The connection is
> encrypted (TLS 1.3) and each device accepts only the other's certificate.
>
> **What is stored:** on the Mac, files you save go to the folder you chose; an activity history (with phone
> numbers removed) and diagnostic logs stay in Sidekick's folder in your Library. Clipboard history is kept in
> memory only and cleared when the devices disconnect. On the phone, diagnostic logs and the paired-Mac record
> stay in the app's storage. Logs record counts and states, not your content. Nothing is uploaded by Sidekick.
>
> **Third parties:** `[choose per §3: "The QR scanner uses Google ML Kit, which sends Google anonymous metrics
> about its performance and use; images are processed on your phone and are not sent." — or remove if the
> scanner is replaced]`.
>
> **Your choices:** every phone permission can be refused or revoked in Android Settings; the feature that needs
> it then says it is unavailable. **Forget** removes the pairing on either device. To delete everything: on the
> phone, uninstall Sidekick (or Clear storage); on the Mac, quit Sidekick and delete
> `~/Library/Application Support/<profile>`, the Keychain item "<app> Safe Storage", and any files you saved.
>
> **Children:** `[OWNER]`. **Changes:** `[OWNER: how users are told]`.

### 5.2 In-app disclosures (drafts, before the system prompt)

- *Accessibility (input):* "Sidekick uses Android's Accessibility service only so the Mac you paired can tap,
  type and go Back on this phone while you are mirroring. It does not read your screen's text, does not act on
  its own, and sends nothing anywhere else. You can turn it off in Settings at any time."
- *SMS & calls:* "To show your texts and calls on your Mac and let you reply or dial from it, Sidekick reads your
  messages and call log on this phone and sends them only to your paired Mac."
- *Notifications:* "Sidekick shows this phone's notifications on your paired Mac and lets you reply. They are
  not stored on the Mac after you disconnect."
- *Photos:* "Choose *Allow all* to browse your library from the Mac, or *Allow limited access* to share only
  the photos you pick."

### 5.3 Google Play Data safety — draft answers (only if Play is chosen)

| Question | Draft answer | Why |
|---|---|---|
| Data collected (transmitted off device)? | **ML Kit metrics: yes** (App activity / diagnostics, by Google) unless the scanner is replaced; everything else: **no** | transfers between the user's own devices, end-to-end encrypted and user-initiated, fall under Play's exemptions — **to confirm against the form's current wording** |
| Data shared with third parties? | ML Kit metrics to Google (if kept) | §3 |
| Encrypted in transit | yes | TLS 1.3, pinned |
| Users can request deletion | yes — on-device deletion (uninstall / Forget / clear storage); no server copy exists | §1 |

### 5.4 Permission-declaration checklist (Play only)

SMS/Call Log exception (P1) · AccessibilityService form + video (P2) · FGS types `connectedDevice`, `dataSync`,
`mediaProjection` with videos (P4) · photo/video broad access (P5) · battery-optimisation exemption (P6 — not
obviously eligible) · prominent disclosures (§5.2). **Two (P2, P6) are genuinely uncertain**; see the audit.

## 6. Channels and the Mac signing choice

| | Direct (both apps) | Play (phone) | Mac App Store |
|---|---|---|---|
| Needs | release keystore; **Android developer verification** before its 2027 global date; users allow unknown sources | everything in §5.3–5.4 plus a verified developer account | App Sandbox (not designed), different entitlements |
| Mac | **Developer ID Application** certificate (Apple Developer Program, paid, Account Holder creates it) + **notarization** + stapling; hardened runtime already on; then drop `disable-library-validation` (S5) | — | not recommended for v1 |

The **Mac signing decision is separate from the deferred virtual webcam**: the main app needs Developer ID and
notarization regardless; the Camera Extension adds its own system-extension entitlement and is not in v1.
Apple's Developer ID page (re-read 2026-10-07) describes Gatekeeper checking for a Developer ID and
notarization as "even more confidence"; **what recent macOS does with an un-notarized app is still not sourced
here** — confirm on Apple's notarization documentation before writing user-facing install steps.

**Recommendation (unchanged from the audit):** direct distribution for v1 on both sides; Play later or never.

## 7. Sources re-read 2026-10-07

- ML Kit terms: https://developers.google.com/ml-kit/terms — quoted in §3.
- Apple Developer ID: https://developer.apple.com/developer-id/ — quoted in §6.
- Everything else: `docs/release-audit-2026-10-06.md` → *Sources* (read 2026-10-06).

## 8. Owner decisions needed

1. Publisher legal name, address, support email, effective date (policy, Developer ID, Android verification).
2. ML Kit: disclose (option 1) or replace (option 2, new dependency).
3. Channel: direct only, or Play for the phone (then §5.3–5.4).
4. Apple Developer Program enrolment for Developer ID + notarization.
5. Approval to run a dependency vulnerability audit (and which tool).
6. A licences/notices screen in both apps (and approval of the plugin or generator used).
7. Phone backup: whether diagnostic logs (`files` domain) may move in a device-to-device transfer — exclude or state it.
