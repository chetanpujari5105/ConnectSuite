# ConnectSuite

> ## ✅ **Phase 4 is CLOSED — 2026-08-31.** Phase 5 may open.
>
> Step 70 (the ring) and step 71 (the SMS sitting) both passed on hardware. Every Phase 4 feature is
> proven on the device. The full summary is `docs/phase-4-closeout.md`; the evidence is
> `docs/testing.md`; the index is `docs/defects.md`.
>
> **Nobody needs to be asked to ring this phone again, and no second person is needed for anything
> in Phase 4.**
>
> **What is still open, and none of it blocks Phase 5:** **30**'s no-thread half (one send to a
> number with no thread — prove the absence in `mms-sms/conversations` *and* `content://sms` first;
> orphaned rows outlive a deleted conversation), and **51** (the after-send SMS retry logs an `E`
> and counts a `dropped` for messages the observer then delivers — reporting only, nothing is lost).
> **17, 33 and 38** stay deferred with fix directions.
>
> **Reinstalling is safe — but it leaves the phone serverless.** `adb install -r` preserves every
> runtime grant and both secure-settings bindings (tested on this device: 11 of 11 `granted=true`,
> listener and accessibility strings intact). What `-r` *does* cost is `LinkService`: the app
> returns via the notification-listener rebind with every feature installed and no port bound. Start
> it by name with `am start -n …/MainActivity` and confirm with **`scripts/link-up.sh`**, which is
> the only thing in the repo that catches it — and never by grepping for `Listening on`, which is
> written once per `onCreate` and is absent by design on a healthy running service.
>
> **The Mac's link state has a second lookalike, found in step 71:** `ifconfig` can show a stale
> lease while `ipconfig getsummary en0` already carries the new one. If the Mac says the phone
> "timed out", read `getsummary` before concluding anything about the network.
>
> Phase 5's decisions are recorded in `docs/phase-5-proposals.md`; nothing there is implemented, and
> `docs/protocol.md` is deliberately unmodified.


Two apps that connect an Android phone to a Mac over the local network with no cloud, no account, and no relay server.

## Layout

The Android app is a multi-module Gradle build at the repo root (there is no `android/` directory):

- `app/` — Kotlin, Jetpack Compose. The launcher activity, navigation, onboarding.
- `core/` — the shared library module. Identity/TLS, trust store, Room database, the v2 link layer (`core/.../link/`), the wire protocol (`core/.../protocol/Messages.kt`).
- `sync-module/` — notifications, SMS, transfers, and their UI.
- `mirror-module/` — screen mirroring (v2, MediaProjection). All of it is under `v2/`; the v1 ADB mirror and the `:mirror-server` dex module were deleted on 2026-08-26.
- `desktop/` — Electron + TypeScript. Main process owns sockets; the renderer only draws.
- `docs/protocol.md` — the wire protocol. It is the contract. Change it there first, then both sides.
- `docs/testing.md` — acceptance steps and the evidence behind every result, appended as each phase lands.
- `docs/defects.md` — **the defect register.** Every defect, its status, and for the open ones a fix
  direction and the wrong fix to avoid. `docs/testing.md` holds the evidence; this is the index.
  Kept in sync by `scripts/check-defects.sh`, wired to `PreToolUse` on `git commit`.
- `docs/phase-4-closeout.md` — what Phase 4 proved, what it deferred, and what Phase 5 inherits.
- `docs/phase-5-closeout.md` — **the Phase 5 ledger, and the phase IS closed — 2026-09-02, against
  both of its conditions, which are answered one at a time in its banner.** What passes and what
  proved it; what is unproven **with the control each one needs** rather than as a list of gaps; and
  every deferral by number. Condition 1 (the five clipboard readings with their controls, plus the
  feature the pre-registered table names for the answer that came back) is `docs/testing.md` →
  Slices 11-13. Condition 2 (defect 57's branch produced, **or** carried as a numbered deferral) took
  the second option deliberately; it is deferral 57 in `docs/defects.md`.

  **This entry itself carried the correction that makes it worth reading.** For a day it said *the
  phase is not closed* and pointed at row 1 of the unproven table — *clipboard has never been
  measured on this device at all* — while the ledger's own banner three paragraphs above that table
  cited the Slice 11 readings by number. **A close-out and its unproven table were written in one
  sitting and disagreed with each other**, and the disagreement then propagated into three more
  documents. Nothing in the build can compare two prose claims, which is why it survived; the fix is
  four struck sentences rather than a checker. Read the *untestable or unproven* table before
  claiming anything in Phase 5 is finished — and note that its row 1 is now struck, not live.
- `docs/phase-5-files-onboarding-proposal.md` — the SAF grant surface: the phone's Folders screen,
  the copy that states the `Download` wall plainly, and — **rev 2, and the part to read** — every
  state each side can be in, drawn before either is built. A pane showing zero folders and a pane
  that failed to load are the same picture, so §3 separates them in four independent ways and names
  the one place the platform makes them genuinely indistinguishable (a refused folder and a
  cancelled pick both arrive as `null`). **The phone half is built — 2026-09-01, all four states on
  hardware**; the Mac's Files pane (§3.3, §3.4, §6) is still a proposal.
- `docs/phase-5-fs-media-proposal.md` — the `fs.*` / `media.*` payload specification. **Both halves
  are implemented and both contracts have now moved to `docs/protocol.md`** — Files (plus `fs.thumb`)
  and Photos, the latter migrated on 2026-09-01. Read this file for the *arguments*; the contract is
  `docs/protocol.md` and it wins wherever the two disagree.

  **The gap that produced the Photos migration is worth more than the migration.** `media.buckets`,
  `media.list`, `media.thumb` and `media.original` sat in the contract's message-type list, specified
  nowhere in it, for a whole phase — and the note left behind said the migration was *owed by
  whoever next touches `media.*`*, which is a rule enforced by someone remembering. Two of the four
  were *mentioned* — five times and four times — in prose about `fs.thumb`, so the document read as though they
  were covered. It is a hook now: `scripts/check-protocol-spec.mjs`, wired to `PreToolUse` on
  `git commit`, which counts a type as specified only where it opens a heading or a paragraph, and
  which found two more gaps nobody had noticed — `mirror.stop` and `mirror.keyframe`, both
  implemented and both undocumented since Phase 2.
  Read this for the *arguments*, and note two recorded deviations: the delete refusal ships as
  `TARGET_STALE` rather than `STALE_TARGET`, and `push` is not served yet. It was written as prose
  against `docs/protocol.md` while nothing was built; where the two now disagree, `docs/protocol.md`
  wins, because it is the contract and this was the argument for it.
- `docs/phase-5-clipboard-proposal.md` — the clipboard spec pass, **written before any code and
  implementing none of it.** Four things worth reading first:
  - the **background-read wall is inherited from documentation and has never been measured on this
    device.** §2 names five readings, each with the lookalike it excludes, and **the instrument is
    built** — `ClipProbeActivity`, debug-only, never run. Nothing below §2 may be built first;
  - §2's **pre-registered decision table**: the product shape for every answer the readings can
    give, written *before* the reading so nothing can be rationalised afterwards. A refusal makes
    this a foreground-only feature, which is a different product, and that is decided already;
  - §5 said the Mac's clipboard is **not** written automatically — a single-slot store with no undo,
    so an arriving entry is offered rather than applied. **That was reversed on 2026-09-02 on the
    condition the contract itself named**, which was *revisit it with an undo, not by removing the
    confirmation*: the Mac now applies on arrival and keeps what it overwrote as a `displaced`
    history entry that Restore puts back. **The phone did not follow**, and the asymmetry is a
    measurement rather than a preference — it may not read its clipboard while unfocused, so it
    cannot see what it would destroy and cannot offer it back. Auto-apply there is a setting, off by
    default. **Mac → phone became automatic on 2026-09-02** — a polling watcher, because
    `NSPasteboard` has no change notification and Electron exposes no `changeCount`; the button is a
    manual override now. Two readings from that slice are worth more than the feature: the
    concealed-clipboard check shipped in Slice 12 **could never have fired**, because the convention
    writes its marker as a present type with *empty data* and the check read the value — its control
    passed only because the control wrote a value nothing in the wild writes, so the control and the
    real input differed in the exact attribute being read. `has`, never `read`. And the mutation
    matrix caught a second *two-guards-one-test* gap, in the file written to prevent the first one.
    `docs/testing.md` → Slices 12 and 13, and `docs/protocol.md` wins over §5;
  - §6 is **the first at-rest storage decision in this project**: memory only, 20 entries, 64 KB
    each, cleared on disconnect, gone on restart, and **no clipboard text in any log line** —
    `LinkLog` writes to a rotating file, so a handler written the way every other handler in this
    repo is written would put people's passwords on disk while the history was scrupulously
    in-memory.
- `docs/single-device-audit.md` — **every hardware reading in this repo came from one SM-S938B.**
  Which findings are AOSP, which are Samsung, and which are honestly *unknown, single-device*. The
  method that answered most of it is one command — ask which package implements the thing you
  measured and where its APK lives — and it produced two surprises: the SAF picker is **Google's,
  Play-updated**, and `com.android.providers.telephony` is **Samsung's `SecTelephonyProvider.apk`
  behind an AOSP package name**. Read §4 before assuming a vendor claim is safe, and §6.4 for the
  one wall in this app with an expiry date nobody controls.
- `docs/RESUME.md` — where work resumes and how to pick it up. **Read it first.** It currently holds
  the Phase 5 opening brief: what the proposals decide, what they leave open, and the first slice.
- `docs/phase-6-brief.md` — **the Phase 6 brief, and no code is written.** What needs the user's
  hands, what this handset can prove alone, and the three things that genuinely need a second device.
  Its §0 is the one to read first: the phone under test is **already exempt from battery
  optimisation**, so the obvious experiment measures the wrong path — the instrument's own state
  contaminating the reading, in the phase where that is most expensive. It also carries the first
  Phase 6 defect, found statically: `RECEIVE_BOOT_COMPLETED` is declared and **nothing receives it**,
  so the link does not come back after a reboot.
- `docs/phase-7-apps-proposal.md` — **app launching, and the measurement comes before the payload.**
  `apps.list`, `apps.launch` and `apps.icon` have been in the contract's inventory since Phase 2 and
  implemented nowhere. Shaped like the clipboard proposal rather than the `fs.*` one, because two
  platform questions decide what the feature *is*: what the app can enumerate, and whether it may
  launch anything while backgrounded. §2.3 is a **pre-registered decision table** with four outcomes,
  two of which produce a different feature and one of which produces **no feature** — a verb that
  returns success and does not launch is worse than an absent one, and it is the outcome every
  automated check would call a pass. Two things are already decided and must not be reopened: the
  `<queries>` block exists (defect 28) and `QUERY_ALL_PACKAGES` was refused on Play-policy grounds,
  and a package id is a handle rather than a sentence.

  **The reading landed on the fourth row and the feature shipped anyway, which is the part worth
  carrying forward.** Rows 3 and 4 turned out to be two different questions: the *mechanism* is row
  4 — a backgrounded `startActivity` refused **silently** — and the *product* is row 3, a
  notification the user taps, which the silent block cannot touch because it never calls
  `startActivity` from the background. So row 4 is a **prohibition on a name**, not on the feature,
  and that distinction was only available because the names were fixed in `docs/protocol.md` before
  the experiment ran. `MessageType` has no `APPS_LAUNCH`; `scripts/check-apps-verb.mjs` keeps it
  that way, and `docs/testing.md` → Phase 7 Slice 8 is the build.
- `docs/phase-3-input.md` — the Phase 3 brief: input injection via AccessibilityService. **Phase 3
  is closed** (2026-08-31); this is the record of what it built, not a live brief. The current brief
  is `docs/RESUME.md`.

minSdk 29, targetSdk 36, compileSdk 36. Java 17 toolchain — Gradle needs a JDK 17-21 (`JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`), the system JDK 25 will not run AGP 8.13.

## Roadmap

**This list is the phase numbering. Nothing else is.**

| Phase | Scope | State |
|---|---|---|
| 1 | Transport, QR pairing, TLS, discovery, auto reconnect | **Done** — passed on hardware 2026-08-25 |
| 2 | Screen mirroring (MediaProjection capture, H.264, video socket) | **Done** — closed 2026-08-26 |
| 3 | **Input injection (AccessibilityService)** — see `docs/phase-3-input.md` | **Done** — passed on hardware 2026-08-27; closed retroactively 2026-08-31 |
| 4 | Notifications + reply, calls (events, dialing, answer/reject), SMS/MMS threads, media remote | **Done** — closed 2026-08-31 after step 71 |
| 5 | Files both directions, photo/video browser with drag to Finder, clipboard with history, contacts | **Done** — closed 2026-09-02 against both its conditions (`docs/phase-5-closeout.md`); photos done; **Files is complete** as of 2026-09-01 (both directions with resume, the Folders screen, the Files pane, the grant-free `Download/ConnectSuite` destination, drag to Finder); **contacts shipped in Phase 4** and is not outstanding — see `docs/phase-5-closeout.md`. **Clipboard is built in both directions** — the wall measured (Slice 11, 2026-09-01), the feature landed, and Handoff-style auto-apply added on the Mac with a setting on the phone (Slice 12, 2026-09-02). Both directions are as automatic as their platforms allow — the Mac watches its own clipboard, the phone cannot and no Android app can. ~~Outstanding: the phone has not been reinstalled with the latest copy change~~ — **closed 2026-09-03 by reading the installed APK rather than the install date.** `pm path` → `adb pull` → `strings`: *"Copied on your Mac"*, *"On your clipboard"* and *"Copy to this phone"* are all present in the APK actually on the device (`lastUpdateTime=2026-09-03 01:22:04`), with a negative control at 0 (*"Copied on your Commodore"*) and a positive control at 177 (*"ConnectSuite"*). **Phase 5 has nothing outstanding.** A fourth probe in the same run is the one worth keeping: `adb tcpip` came back **present=1**, which reads as defect 65 resurrected and is not — it is `OnboardingCopy.forbiddenMechanisms`' own `why` string, the sentence explaining why the phrase is banned, compiled into the same dex. The copy describing an absence contains the words for the thing that is absent |
| 6 | Background reliability on One UI — surviving Samsung's battery manager, doze, reconnect after sleep | **In progress** — code landed 2026-09-02: `LinkBootReceiver` (defect 60), the wake-lock refresh (61), the crash-serverless fix (62). Forced Doze passes on the **exempt** path with a live message across it. **The reboot happened, 2026-09-02: the receiver fires and the link is up with nothing tapped — but the branch that ran was `already listening`, because the listener rebind beat it by 3.9 s. The boot path has still never started anything (defect 64).** The unexempt path is **out of scope on this handset** — `am set-standby-bucket … 5` is refused, so the bucket cannot be put back; it needs a second device |
| 7 | Mac UX — packaging, distribution, app launching, and the polish pass | **In progress** — **apps landed 2026-09-03**: `apps.list`, `apps.icon`, `apps.open.ask`, a twelfth nav row, and **123 of 123 launcher packages with resolved names and real icons on hardware**. There is no `apps.launch` and a commit hook keeps it that way — the measurement forbade the *name*, not the feature (`docs/phase-7-apps-proposal.md` §2.4). Before that, 2026-09-02: the **Activity** pane, palette **deep links**, two view classes off the renderer-view debt list. **Pairing's phone half is now built**: F1-F5 of `docs/phase-7-pairing-flow.md`, all five items that need no protocol change — a fifth onboarding page ending on pairing, the Mac tab reordered behind an **Advanced** fold, and the phone finally saying *which* silence it is in. F6 and F7 change `docs/protocol.md` and are not built. **F2, F4 and F5 are proven on hardware 2026-09-03** (`docs/testing.md` → Phase 7 Slice 9): the Advanced fold in both directions, the wait clock sampled **across** its threshold rather than at it, and a refused handshake on screen with a key prefix predicted before the run. The slice's more useful finding is a verdict script of my own that printed `DEFECT 64 CLOSED` over a phone that had not rebooted — its greps had no time bound and its controls were printed and then ignored |
| 9 | Distribution — packaging, signing, release builds | **Started** — 2026-09-02, only the parts needing no Apple account: `docs/phase-9-distribution-audit.md` (thirteen rows, two corrected by measurement), an unsigned `.dmg`, a 25 MB release APK, and one version scheme (`docs/versioning.md`) with a sixth commit hook. **Neither artifact can be given to anyone, and both were measured rather than assumed**: the `.dmg`'s app is *ad-hoc* signed and Gatekeeper returns an error instead of a verdict (D12 — worse than unsigned, since the right-click bypass does not apply), and the release APK is refused by the platform outright with `INSTALL_PARSE_FAILED_NO_CERTIFICATES` (D13). **Nothing signed, notarized or published**; the config for all three is written with credentials blank |

`android-connect-suite-claude-code-prompt.md` is the **v1 plan and is superseded**. Its phases are
numbered differently (its Phase 3 is file transfer, its Phase 6 is input) and its Phase 5 and 6 are
built entirely on ADB — `adb tcpip`, a pushed dex, `adb shell input tap` — which locked decision #1
forbids. Read it for feature intent only. Where it and this table disagree, this table wins.

Phases 4-7 are a working order, not a commitment; 3 is fixed. Deletion of superseded code is a
cleanup step inside whatever phase makes it safe, never a phase of its own.

**Phase 3 was closed on paper on 2026-08-31, three days after it closed in fact.** The steps ran on
2026-08-27 (`docs/testing.md`, "Phase 3 step results"), defects 18-21 were fixed and closed with
them, and Phase 4 was then built on top of the input path and closed in its own right — so the table
read "in progress" for a phase whose successor was already done. The only Phase 3 step not marked
PASS is **33**, recorded as *not runnable as written* on this hardware: locking the phone stops
MediaProjection before any input can be attempted, so the canvas is dead before the sentence the
step asks for could be produced. `InputFailure.PhoneLocked` is unit-tested and correct; the route to
it is unreachable here. That is an observation about the step, not an open item.

The lesson is the one this file already carries about defect 31 — a phase's state lives in a table
that nothing in the build can check, so it goes stale silently. `scripts/check-defects.sh` guards
defect rows and has no opinion about phase rows; that gap is named here rather than fixed, because a
checker that parses this table would be guarding one sentence against no known failure mode beyond
the one now corrected.

**Why 4-7 are grouped this way** (revised 2026-08-26, replacing the first cut of the same table):

- **Calls sit with notifications in 4** because they share a permission surface, not because they
  are similar features. `READ_PHONE_STATE`/`READ_CALL_LOG` are asked for in the same run of runtime
  prompts, and the media remote is gated on the *notification listener* grant
  (`MediaSessionManager.getActiveSessions`, see `Capabilities.kt`) — so it belongs to the same
  grant as notifications and is cheapest to build beside them. Splitting these across phases means
  asking the user for overlapping permissions twice.
- **5 is everything that moves a file or a string**: transfers, the photo browser, the clipboard,
  contacts. One bulk channel, one set of storage grants.
- **6 is reliability, and it comes before polish.** A phone that silently drops the link is worse
  than one that looks plain: One UI's battery manager kills backgrounded foreground services,
  Doze suspends sockets, and a Mac that reconnects only when the user notices is not the "QR once,
  then auto reconnect" this project promised. This is a phase because it is measurement and
  hardening across every feature built so far, not a feature of its own.
- **7 is the Mac's side of the experience** — packaging, signing, distribution, and the polish
  pass, with app launching folded in as the one remaining phone feature small enough to ride along
  with it.

## Reference behaviour

LinkMyMac (linkmymac.com) is the behavioural target: notification mirroring with reply, SMS and MMS threads, call events and dialing, contacts, file transfer in both directions, photo and video browser with drag to Finder, bidirectional clipboard with history, screen mirroring with control, app launching, media remote, virtual webcam, QR pairing once, then auto reconnect over USB or private local Wi-Fi.

Study KDE Connect for the pairing and trust model, and scrcpy for the capture and encoding pipeline. Read them for design, write our own implementation.

## Locked architecture decisions

1. No ADB anywhere in the v2 code path. Capture uses MediaProjection. Input uses AccessibilityService. If a task seems to need ADB, stop and ask.
2. Android binds the listening sockets. The Mac connects out. Ports: 42501 control, 42502 video, 42503 bulk.
3. Transport is TLS 1.3 with self-signed certificates on both ends and fingerprint pinning after pairing. No plaintext fallback, ever.
4. Discovery order on the Mac: last known IP, then default gateway IP (the phone is the gateway when the Mac is on its hotspot), then mDNS `_connectsuite._tcp`, then manual IP entry.
5. One control channel carries JSON. Video and bulk transfer get their own sockets, authorised by the session token from the control handshake.
6. Every feature degrades to "unavailable, here is why" instead of failing silently. Permission not granted, phone locked, encoder failed: each produces a specific user-visible reason string.

### Deviations from the original v2 brief, with reasons

- **Phone identity key is EC P-256, not RSA-4096.** `core/.../crypto/DeviceIdentity.kt` already mints a hardware-backed P-256 key in the Android Keystore and the Keystore self-signs its certificate. That is strictly stronger than a 4096-bit RSA key (which on most devices is *not* hardware-backed, and whose handshake costs tens of milliseconds on a phone CPU). The Mac side uses RSA-2048 because Node's `node-forge` path is simplest there; both ends are pinned by SHA-256 fingerprint, so key type is a local choice.
- **Pairing keeps the v1 trust store.** `TrustedDeviceEntity` (Room) already stores deviceId + certificate + fingerprint + last address. The QR flow writes into that same table instead of a second one.

## Platform walls (do not attempt, do not design around)

- Call audio cannot be streamed. `CAPTURE_AUDIO_OUTPUT` is system-only and AccessibilityService call recording violates Play policy. The documented answer for users is to pair the Mac to the phone over Bluetooth as an audio device.
- Screen capture returns black frames for FLAG_SECURE surfaces (lock screen, banking apps, DRM video). This is enforced by Android. Detect and show a message, do not retry.
- MediaProjection consent cannot be cached across sessions. Every capture start needs a fresh user tap on Android 14+.
- Background clipboard reads are blocked since Android 10 unless the app has an enabled AccessibilityService or is the default IME.
- Arbitrary key injection is impossible. There is no public API for an AccessibilityService to
  synthesise a `KeyEvent`; `INJECT_EVENTS` is signature-level and will never be available to this
  app. Volume, power and hardware keys cannot be pressed remotely. `input.key` is therefore text
  entry plus the global actions below, and nothing else — see `docs/protocol.md`.
- `performGlobalAction` is the whole of `input.global`: back, home, recents, notifications, quick
  settings, lock screen, and the power *menu*. There is no power-button press, and there never
  will be one.
- An AccessibilityService cannot be granted programmatically. `ACTION_ACCESSIBILITY_SETTINGS` is a
  deep link into Settings and nothing more; the user enables it by hand, once, and can revoke it
  the same way. That is the onboarding cost of Phase 3 and it is unavoidable.
- **There is no path-based view of the phone's shared storage.** Scoped storage is not optional at
  `targetSdk 36`, so `fs.*` browses **SAF trees the user granted**, one folder at a time. Observed on
  this handset (SM-S938B, Android 16, 2026-08-31), through our own package at `targetSdk 36` because
  the restriction is applied against the *calling package*: `ACTION_OPEN_DOCUMENT_TREE` refuses the
  **root of internal storage** and refuses **`Download` itself**, in both cases by listing the folder
  normally and **disabling** `USE THIS FOLDER` with *"Can't use this folder — to protect your privacy,
  choose another folder"*. Folders **inside** `Download` are grantable, which is why the "send to
  phone" default is `Download/ConnectSuite` rather than app-private storage. `Android/data` and
  `Android/obb` are unreachable by any route, for any app.

  **`Download/ConnectSuite` is now a root in its own right** (`downloads:connectsuite`, through
  `MediaStore`) and needs **no grant of any kind** — proven with both media permissions revoked,
  2026-09-01. So a push works on a phone that has shared nothing, and the SAF picker is for *browsing*
  the phone rather than for receiving from the Mac. It lists this package's own contributions only,
  and it is flat: `MediaStore` cannot represent an empty directory.

  **`EXTRA_INITIAL_URI` is honoured on this handset and a bad aim degrades to the parent** — measured
  2026-09-01, which is what unblocked the quick-pick chips. The single constraint it produces: **no
  chip may point inside `Download`**, because a missing folder there degrades into the refusal below.

  The consequence to state to users rather than let them discover: **a file sitting directly in
  `Download/` can never be reached by this app.** `MANAGE_EXTERNAL_STORAGE` would lift all of it and
  **we are deliberately not asking for it** — whole-of-storage is the one permission that makes
  people uninstall an app whose entire pitch is no cloud and no account. The reasoning, the readings
  with their controls, and the recorded upgrade path are in `docs/phase-5-fs-media-proposal.md` §1.

  **This wall has an expiry date nobody controls, and that is a maintenance obligation rather than a
  worry.** The refusal is `com.google.android.documentsui`'s, and on this handset that package lives
  in `/data/app` at versionName 17 — **it updates itself from the Play Store**, on a schedule neither
  Samsung nor we control, and it is not pinned to the OS version. So the most-cited platform fact in
  this repo — written into `docs/protocol.md`, the phone's Folders screen and the Mac's Files pane —
  can change under a running install with no OS upgrade to signal it. `SafProbeActivity` is the only
  thing that would notice. Re-run it when DocumentsUI updates, and do not re-argue the wall from
  documentation. `docs/single-device-audit.md` §6.4.
- Nothing works outside the local network without a relay. Out of scope for v2 core; Tailscale is the documented optional path.

## Code rules

- Kotlin: coroutines and Flow, no AsyncTask, no RxJava. Compose for UI. (v1 uses hand-rolled singletons rather than Hilt; new code follows the surrounding style — do not half-introduce DI.)
- TypeScript on the desktop, strict mode on. Sockets and file IO live in the main process. The renderer only draws and sends intents over IPC.
- Shared message types are defined once per side (`core/.../protocol/Messages.kt`, `desktop/src/shared/protocol.ts`) and must stay in sync with `docs/protocol.md`.
- Every socket handler logs to a rotating file. The desktop debug HUD shows fps, bitrate, round trip time, dropped frames, and connection state.
- **Log the success case, not only the failure — a count with no denominator is not evidence.**
  Every counter is published beside the thing that gives it meaning: successes beside failures,
  frames beside elapsed time, bytes beside a rate. A number on its own reads as whichever story
  the reader already believes.

  This is a rule because it has already hidden two defects in one day. Defect 18 sat behind 187
  refusals with no success count — indistinguishable from "the user misclicked a lot" until the
  denominator turned out to be zero, and input had never once worked. The mirror's first frame
  counter reported 83 frames with no fps beside it, which said nothing about whether the pipeline
  was keeping up. Both were fixed the same way, twice, so it belongs here rather than in a third
  fix.

  Concretely: if you write `LinkLog.w(...)` on a failure path, the matching success path gets a
  line too, at the same volume — not a debug line, not a periodic summary that averages the
  failure away. If the volume genuinely cannot be afforded, carry the running tally *on the
  failure line* so the ratio survives even when the successes do not.
- **The Mac has a test suite now: `npm test` in `desktop/`.** `node --test` with `tsx`, one dev
  dependency, no config file. Test files are `*.test.ts` beside what they test and are excluded
  from `tsc`'s emit, so nothing test-shaped reaches `dist/`.

  It was added on 2026-08-28 because the Mac had **zero** tests against the phone's ~300, and six
  of the defects found in Phase 3 and 4 — 19, 22, 23, 24, 25 and 26 — were all Mac-side. It stood at
  **106** when the app shell landed on 2026-08-30 and **129** at the close of Phase 4 on 2026-08-31,
  against the phone's **189** (67 `sync-module` + 122 `core`).

  The renderer is loaded as plain `<script>` tags and cannot use `export`, so a renderer rule is
  made testable by hanging the pure half on `globalThis` at the bottom of the file — see
  `src/renderer/calls.ts` and its test. That is still the "testable seam" rule, not an exception to
  it: the test runs the code that draws the card, rather than a second copy of the rule that can
  drift from it.

  **The same rule applies on the phone, with `Telephony` in the place of Electron.** A JVM unit
  test that merely *references* an object holding an Android static in a field initializer dies
  with `ExceptionInInitializerError` — `SmsStore` does, via `CONTENT_CONVERSATIONS_URI`. The answer
  is not `returnDefaultValues = true`, which makes every Android call in the module silently return
  null; it is to move the pure part out. `SmsPayloads` and `CallWatcher.dispositionOf` came out
  that way, for defects 34 and 36.

  Two rules for what goes in it. First, **a new test must be shown to fail against the defect it
  is named for** — reintroduce the bug, watch it go red, put it back. A test that cannot fail is
  the same shape as an empty accessibility query: it reads as evidence and is not.

  **The newest way to write a test that cannot fail is to _model_ the thing under test instead of
  calling it.** `MediaPayloadsTest` pages over rows in memory to prove the `beforeId` tiebreak spans
  a burst of photos sharing one `DATE_ADDED` second. Its first version wrote the cursor predicate out
  a second time, in the test — so deleting the tiebreak from the query left every assertion green.
  The test was not weak; it was testing a copy. It was fixed by moving the decision into one place
  (`MediaPayloads.cursorOf`) that the query renders to SQL and the test evaluates in memory, after
  which the red-first run failed exactly as it should: page two returned `[1000]` where `[1003,
  1002]` belonged, three rows gone between two pages that each looked perfectly well formed.

  This shape hides where a test cannot reach the real thing — SQL, a wire format, a provider — and
  the honest test is the one that reaches as far as it can and then **says what it did not reach**.
  The rule: if a test contains a second expression of the rule it is checking, the two will
  disagree eventually and the test will be the one that is wrong. Give the rule one home and let the
  test call it.

  **The third variety, and it is the one that looks most like a good test: _the test calls the rule
  correctly, at a layer the defect is not in._** The two above are recognisable once named — a test
  that restates the rule, and a rule living where no test can reach. This one passes every review,
  because by every visible standard it is exemplary: it names the behaviour, it calls the production
  function rather than a copy, it covers the boundary in both directions, and it goes red under
  mutation of the thing it tests.

  Defect 67 is the worked example, and the numbers are what make it worth a section.
  `LinkWaitStatusTest` had **eleven tests, six mutations, both sides of a twenty-second threshold**,
  green throughout, over a feature that **had never once worked in the field**. The phone's
  "check your Wi-Fi" hint was supposed to appear after twenty seconds of silence. It appeared
  instantly, on every phone, for every user, because the elapsed time was measured from
  `listeningSinceMillis` — written once when the server started — rather than from the start of the
  wait. `LinkWaitStatus.of` was **correct the entire time**: given a wait that began three seconds
  ago it withholds the hint, exactly as eleven tests asserted. The defect was in the *write*, in a
  `copy()` inside `onSessionEnded` that no test could see.

  **The tell is that every test constructs its input by hand:**

  ```kotlin
  private fun listening(sinceAgo: Long = 0L, …) = LinkState(
      …,
      listeningSinceMillis = t0 - sinceAgo,      // ← the TEST decides what this field means
  )
  ```

  That line is unremarkable, appears in almost every unit test ever written, and is precisely the
  problem: the test supplies a **well-formed** value for a field the product fills in wrongly, so the
  question *does anything real ever produce this?* is never asked. The suite proves the decision and
  is silent about the state.

  **The diagnostic, and it is one question:** *what writes this field, and is that code in the test's
  reach?* If the answer is "a `copy()` inside a class needing a `Context`, a socket, or a database",
  then the decision is tested and the feature is not. Ask it of every field a test constructs — the
  ones with a plausible-sounding name are the dangerous ones, because the name is what persuades
  everybody that the test's value and the product's value are the same thing. Here the name *was*
  the bug: `listeningSince` is a fact about the server, `waitingSince` is a fact about the wait, and
  the code, the tests and the reasoning all used the first where they meant the second.

  **The fix is structural rather than more tests, and this is the part that generalises.** Adding
  test cases at the same layer does nothing — proven, not assumed: two tests were added asserting
  that a two-second-old wait carries no hint however long the phone has been up, the original bug was
  mutated back in, and the suite **stayed green**, because both new tests also supplied the field by
  hand. What worked was extracting the transition into a named function on the state —
  `LinkState.afterSessionEnded(peerName, closeReason, nowMillis)` — which `LinkServer` calls and a
  JVM test can call too. Three mutations then went red, each on exactly one test, and all three had
  been green before the extraction.

  So the rule: **when a defect is about _when_ something becomes true rather than _what_ is said
  about it, the test has to reach the transition.** State machines fail at their edges, and an edge
  is a write. If the write is somewhere a test cannot go, moving it is the fix, and it comes before
  writing a single further test about the decision.

  **And the reason this is written down rather than left in the defect record: nothing in this
  project's practice would have caught it.** Not the red-first rule — the tests were shown red
  against mutations of `of()`. Not the control rule — the controls were real. Not the
  no-second-expression rule — the test called the real function. It was found by putting the feature
  on a screen and looking at it, twenty-five seconds after stopping the Mac app. **A mutation score
  is a statement about the code the tests reach**, and a suite can be green, mutation-tested, and
  entirely orthogonal to the defect. When a feature has never been observed working, the honest
  status is *unproven*, whatever the suite says.

  Second, prefer
  making the code testable over mocking Electron. `src/shared/` is the electron-free layer and is
  where a testable seam belongs; `session.ts` came out of `link.ts` that way.
- **One selector belongs to exactly one stylesheet.** `tokens.css`, `shell.css` and `styles.css`
  load in that order into one cascade, so two rules at equal specificity are resolved by document
  order and **the later sheet silently wins**. Silently is the whole problem: nothing errors,
  nothing logs, `tsc` is clean, the tests are green, and the app renders wrong in a way that looks
  like a design decision.

  It cost three bugs in one sitting on 2026-08-30, all found by eye rather than by any check:
  styles.css's own `:root` block overrode `--accent` with a blue, so the design's violet was never
  once drawn; the same block's `--bg` painted the window ground nine steps too light, so every
  translucent surface composited wrong; and a duplicated `.toolbar-button` beat
  `.mirror-only { display: none }`, so the Mirror-only Floating window button drew on all eleven
  screens.

  The division: **tokens.css owns colour** and the two global requirements (`:focus-visible`, the
  reduced-motion block); **shell.css owns the frame** — window, sidebar, nav, island, dock, palette,
  toast; **styles.css owns what lives inside a screen**. A component that needs a value which is not
  a token means the token is missing — add it to tokens.css rather than defining a second `:root`.

  Enforced by `src/renderer/stylesheets.test.ts`, which parses all three and fails on any selector
  declared in two of them, or on a custom property declared outside tokens.css. It carries both
  controls: one proving it can see a collision, one proving it does not mistake an `@media` body
  for a top-level rule.

- **An icon name that is not in an enumeration is an icon nobody can check.** `icons.ts` holds the
  geometry and `navModel.iconNamesUsedByTheShell()` holds every name the app asks for; `icons.test.ts`
  asserts none is empty and `navModel.test.ts` asserts every name resolves.

  This exists because the build shipped with **no icons at all** and nothing noticed: the Mirror
  tool rail drew a `.tool-glyph` span with a border and no contents, so Capture and Refresh
  rendered as empty rings — visible in a screenshot and invisible to every check in the repo.
  The first version of the guard enumerated only the sidebar and the dock and **passed with
  `capture` deleted**, which is the same defect one layer up: a guard that does not cover the thing
  it is named for. The tool rail and the six global actions moved into `navModel.ts` so they are
  inside it.

- Write the acceptance test steps into `docs/testing.md` as you complete each phase.
- Do not rewrite working code from v1 unless the phase says to. (The one exception is already done: the v1 ADB mirror, its `LEGACY_ADB_MIRROR` flag, and `:mirror-server` were deleted on 2026-08-26 once v2 mirroring passed on hardware. No ADB remains in the repo.)

## Rules for driving the apps under test

These are not habits, they are rules. Both were written after a run where breaking them cost real
damage on the user's own device or nearly recorded a false result.

- **Every `adb` command that changes a device's state goes through the pin. Reads may stay loose.**
  Installs, uninstalls, `pm clear`, `pm grant`/`revoke`, `settings put`, `am force-stop`, `am
  broadcast`, `content insert/delete`, anything writing a file. The call form is
  `adb -s "$(scripts/target-device.sh)" …`, and the pin refuses rather than guessing, so a wrong
  device stops the command instead of receiving it.

  The line is drawn at **state change, not risk**: a read on the wrong phone produces a wrong
  reading, which the rest of this file is about catching, and a write on the wrong phone is somebody
  else's device altered. Only the second is unrecoverable, and only the second is worth the friction
  on every call.

- **Check *which device* before anything that writes to one. `scripts/target-device.sh`.**
  `adb install`, `adb shell`, every `pm` and `settings` command targets whatever single device is on
  the bus and tells you nothing about which. Every hardware reading in this repo is from one
  SM-S938B (`docs/single-device-audit.md`), and on 2026-09-02 a **signed release APK was issued at
  an OPPO CPH1859** that had replaced it on the cable. What stopped it was `minSdk 29` against an
  SDK 28 device — an accident, not a check. On a slightly newer stranger's phone it would have
  installed.

  **The absence had already reported it and was explained away.** Two commands earlier,
  `pm list packages | grep chetan` returned nothing on a device where the debug build had been
  installed twenty minutes before. That result was *impossible* on the right phone; it was read as a
  bad grep pattern.

  This is the lookalike rule with the **target** swapped instead of the query, and it is the variant
  no care about queries can catch: the query was correct, the object underneath it had changed. So
  the question *what else would produce this absence?* has one more answer than the table below
  lists — **"you are looking at a different machine"** — and it belongs on the list whenever a
  reading comes off a device.

  The guard pins serial *and* model, refuses to guess, prints what is attached instead, and emits
  `-s <serial>` so the write cannot be ambiguous. Setting `ANDROID_SERIAL` in a profile is **not**
  the fix: invisible at the call site, gone in a new terminal, same silent targeting with a
  different default. The check goes in the path of the command that writes.

- **Never drive the Mac UI or the phone by coordinates when a named target exists.** Press the
  button by its accessibility name, tap the view by its resource id or content description. A
  coordinate is a guess about a layout that is still moving.

  The Mac's notification list re-renders on every incoming notification, so a point read off a
  screenshot is stale before it is used. A blind `click at {453, 827}` looked like "the click did
  not register" and had in fact pressed **Share** on a Samsung screenshot notification and opened
  a share sheet on the phone — the click landed, the row had moved under it. That was the second
  coordinate-guessed click to do something unintended on the user's device, after the one that
  reached the dialer. Two is a pattern, and the blast radius is somebody's real phone.

  Practically: start Electron with `--force-renderer-accessibility` so `System Events` can see the
  buttons at all (without it Chromium exposes one opaque `AXGroup`), and prefer
  `adb shell input tap` driven from a `uiautomator dump` over a remembered pixel. If no named
  target exists, add one — a stable id is cheaper than a second accident. Coordinates are a last
  resort for genuinely unnamed surfaces, announced before the click, never a default.

- **Before a negative result becomes evidence, prove the query returns a known positive.**
  Not a habit, a precondition. A query that cannot tell its target from something resembling it
  produces a clean, specific, confident wrong answer, and nothing downstream can distinguish that
  from a real finding.

  Three in one day, and four more since — all the same shape:

  | Query | Reported | Actually |
  |---|---|---|
  | `Reply` button absent from the accessibility tree (step 47) | feature missing | the tree was empty; Chromium builds none without `--force-renderer-accessibility` |
  | `grep -c remoteinput` on `dumpsys notification` | 2 reply actions present | 2 lines of `android.remoteInputHistory=null` |
  | drawn button labels vs the phone's `isReply` action title (step 49) | 6 of 6 rows leaking | the Mac's own Reply affordance shares the label *and* the CSS class |
  | no platform call-log row for `c13` (defect 47) | the call was over, so the card was stale | a **self-managed** WhatsApp call — `SamsungCallLog.Loggable okayToLog:false`. It was live, and the card was true |
  | `adb shell content query --where 'date<…'` on `mms-sms/conversations` (defect 50) | the provider honours selections, so the pager's cursor *value* must be wrong | the shell **inlines its literal**; the app **binds a `?`**, and this view answers a bound argument with an empty cursor. The selection was never running |
  | a 320 ms shell poll watching for a `MediaStore` pending file (2026-08-31) | *(not reported — the miss was caught first)* | the publish took **263 ms**. The window opened and closed between two samples, so the poll held **no reading at all**, in either direction |
  | a pager probe capped at 200 pages, over a 16,369-item album (2026-08-31) | `10000 of 16369, match=false` — read as a pager that stops early | the **probe's own cap**. The pager was fine; the instrument ended the run and then reported the ending as the finding |
  | `KEYCODE_BACK` in DocumentsUI, waiting for the cancel branch's log line (2026-09-01) | *(not reported — caught first)* | BACK **navigates up** in the picker, it does not cancel. The activity was still resumed and the branch had not run. The absent line was a reading that did not exist yet |
  | `dumpsys activity permissions \| grep -c documents/tree` after a revoke (2026-09-01) | 2 tree grants — read as *"Remove did nothing"* | the released grant **is still a row**, at `persisted=0x0`. The real grant is the one at `persisted=0x3`. Row presence is not grant persistence |
  | the push-resume probe's `sentBeforeCut` after `socket.destroy()` (2026-09-01) | 12,058,624 bytes delivered — read as *resume works* | **zero bytes arrived.** `destroy()` discards the send buffer, so the number was bytes *queued*. The instrument reported its own intention as a measurement, and underneath it a **truncated push was being committed as complete** — defect 56 |
  | a Gradle mutation run reading `build/test-results/*.xml` (2026-09-01) | `failures=0` — read as *the guard does not catch this* | the build **did not compile**, so nothing rewrote the file. The reading was the previous run's, served with no indication of its age |
  | `clipboard.read('org.nspasteboard.ConcealedType')` after `clipboard.writeBuffer` of the same type (2026-09-02) | the marker is readable — *the concealed-clipboard check works* | **Chromium wrote it and Chromium read it back.** A password manager writes through `NSPasteboard`, and against that the same call returns `""`. The run proved Chromium agrees with itself |
  | the same check's positive control, which wrote `'1'` as the marker's value | the check fires on a marked clipboard | the convention writes the marker as a **present type carrying empty data**. `read(type) !== ''` is false for every real concealed clip ever written; the control was the only input in the world that could have passed it |
  | `strings installed.apk | grep -cF 'adb tcpip'` after defect 65's fix (2026-09-03) | **present=1** — read as defect 65 resurrected, ADB copy back in an app whose decision #1 is *no ADB anywhere* | the match is `OnboardingCopy.forbiddenMechanisms`' own `why` string — *the sentence explaining why the phrase is banned*, compiled into the same dex as the copy it guards. KDoc is stripped; a string literal is not |

  Between them, false absences and false presences alike, which is the point: the failure is not
  "empty means broken", it is that **the check could not separate signal from lookalike** and said
  so with full confidence either way.

  So every check carries a control that must come back non-trivially true, and it is recorded in
  `docs/testing.md` beside the result:

  - *Absence* — enumerate the whole surface first and confirm things you already know are there
    come back. "The card is gone" counts only alongside "the same dump still returned 18 other
    buttons".
  - *Presence* — look at what matched, not the count. A `grep -c` is not evidence; the matched
    lines are.
  - *Discrimination* — when the target and its lookalike share every attribute you are matching on,
    stop and find one that separates them. For the chips that was a count, not a name.

  **An absence in a platform store is the easiest of these to get wrong, and the fourth row is the
  worked example.** A row that is not in a provider is not evidence that the thing did not happen —
  it is evidence that *this provider does not hold it*, and those are different sentences. Before an
  absence counts, **name at least one other thing that produces the same absence** and say why it is
  ruled out. For `c13` the unnamed lookalike was "a call the platform does not log", which is an
  entire ordinary category — every WhatsApp, Signal and Meet call on the device — and naming it
  would have taken one sentence and killed a defect a day earlier. `dumpsys telecom` was the query
  that separated them and it was never run, because the absence already looked like an answer.

  The fourth row is also the first one this project caught **before** it cost anything and **while
  writing the record that made the claim** — the earlier three were each found by someone else's
  reading, or after the damage. That is the direction this rule is supposed to travel, and it is
  recorded as a rule rather than as an apology inside a closed defect: the register entry for 47 is
  withdrawn, and this line is what survives it. When you catch yourself leaning on an absence,
  the question is not *am I sure* — it is *what else would look exactly like this*.

  **The fifth entry is defect 50, and it generalises furthest, because there the lookalike was our
  own tooling.** `SmsStore.threads` paged with `selection = "date < ?"` and a bound argument;
  `content://mms-sms/conversations` answers that with an **empty cursor** — no exception, nothing
  for `runCatching` to log — so the phone honestly reported `0 threads, hasMore=false` and the
  pager stalled at 50 with every layer telling the truth. Asked the obvious way, the provider looked
  innocent: `adb shell content query --where 'date<…'` returns 2990 rows and honours `--sort` too.
  **The shell inlines its literal; the app binds a `?`.** Those are two different clients issuing
  two different queries, and only one of them is the product.

  So the rule, which is not about content providers: **verify a mechanism through the same client
  the product uses, or you have verified a different mechanism.** A shell tool, a `curl`, a REPL, a
  test double — each differs from the shipping call path somewhere, and that difference is exactly
  where this class of bug lives. When a hand probe and the app disagree, **the probe is not the
  tiebreaker, it is the second suspect.** The corollary for a green suite: a test that reaches the
  provider by a path the app never takes can pass forever over a feature that has never worked.

  And the diagnostic is worth stealing on its own: **pass a parameter whose correct answer is
  "everything".** A cursor above the newest row must return every row. It returned zero — and a
  wrong *value* cannot do that, only a query that never ran. One reading, taken before any tuning,
  moved this from "the cursor is wrong" to "the selection is dead" and cost nothing. Anything taking
  a parameter has such a value; send it first.

  **The enforcement question, asked and answered: this one does not get a hook, and here is why.**
  No unit test can see it — the behaviour belongs to one OEM's content provider, and a JVM test that
  could reach that provider would be reaching it by a path the app does not take, which is the very
  mistake above. A grep forbidding `selectionArgs` on this URI would guard the one line we already
  fixed and nothing else. So the enforcement is a *precondition on the claim* rather than a check on
  the code: **a provider pager may not be recorded as working on the strength of its control
  rendering or its first page returning rows — it is recorded on consecutive pages, counted, on
  hardware.** That is what 32's entry in `docs/testing.md` carries (50 → 89 → 126 → 158 → 183, every
  entry distinct) and it is what the next pager owes too.

  **And there is a third precondition, learned from `media.list` on 2026-08-31: pages that sum and
  never repeat do not prove the _tiebreaker_ ran.** A cursor ordered `date DESC, id DESC` only needs
  its id half when a page boundary lands inside a group sharing a timestamp. If no boundary does,
  the run passes **identically** with the tiebreak deleted — so a green pager is not evidence for
  the thing most likely to be removed as redundant later.

  What makes it evidence is counting the boundaries that landed in a tie group. Camera's 16,369
  items paged 33 times to `16,369 == 16,369` with zero repeats, and **6 of those 32 boundaries fell
  inside a tie group, carrying 10 rows a bare-millisecond cursor would have dropped.** That number,
  not the clean total, is what says the tiebreak is load-bearing on this data. Publish it beside the
  totals: it is the denominator for the totals in exactly the way a failure count needs a success
  count, and without it someone reads a green pager and deletes the clause that made it green.

  **`fs.list` is the same discipline with the opposite result, and it is why this is a rule rather
  than a boast.** Paging a 16,377-entry directory to exhaustion on the same handset: 33 pages, every
  id distinct, sums reached, `stopped=exhausted` — and **`tieBoundaries: 0`**. Not one page boundary
  landed inside a group of entries sharing a display name, so that run proves the pager advances and
  proves **nothing whatever** about the `id` tiebreak. Deleting the tiebreak would have left it
  identically green. The tiebreak is load-bearing here for a reason the totals cannot show — a
  `DocumentsProvider` does not guarantee unique display names, and the row order is not ours, so
  every page is a fresh query — and the only test that can see it shuffles the listing between
  pages. **Publish the boundary count whether it is 6 or 0**; the 0 is the more important number,
  because it is the one that says a clean run is not the evidence someone will take it for.

  **The sixth entry is the newest and the smallest, and it is a rule about sampling: a window that
  falls between two samples is a _missing_ reading, not a negative one.** Watching for a file that
  exists only while a `MediaStore` publish is pending, a shell loop sampled every ~320 ms and the
  publish finished in **263 ms** — the directory was empty at 19:51:38.993 and held the finished
  file at 19:51:39.321. Nothing was seen, and "nothing was seen" was one sentence away from being
  written down as "the pending file is not visible", which is a claim about the platform that the
  run could not support. The fix is not a faster poll — a faster poll is a smaller window, not a
  guaranteed one. It is to **hold the state open**: a probe path that performs the same insert and
  never commits, so the thing being observed stops being a race.

  This is the first of these caught *before* it was written down rather than after — the fourth was
  caught while writing the record, and the first three were caught by someone else's reading or by
  the damage. The question that catches it is not *did I see it* but **could I have seen it** — and
  when the answer is "only if I sampled inside a window I do not control", the reading does not
  exist yet.

  **The seventh is that rule's mirror image, and the pair is the useful thing.** A probe paging a
  16,369-item album stopped at its own `MAX_PAGES = 200` and printed
  `10000 of 16369, match=false` — a clean, specific, confident claim that the pager stops early.
  Nothing was wrong with the pager. The instrument ended the run, and then reported its ending as
  the finding.

  So: **the sixth missed a window and held no reading; the seventh invented an ending and held a
  wrong one.** Both are the instrument contaminating the result, from opposite directions, and both
  are invisible in the output unless the instrument reports its own limits. The fix in each case is
  the same shape — the probe now prints `stopped=exhausted` or `stopped=page cap`, and says
  `sums=not tested — capped` rather than `NO`, because **a run that hit a cap has proven the pager
  advances and has proven nothing about the total.**

  The general form, worth applying to anything that measures: **every bound the instrument imposes —
  a timeout, a page cap, a sample interval, a buffer size, a `head -20` — must appear in what it
  reports, or a result shaped by that bound will be read as a result about the thing measured.**

  **The eleventh entry is the third member of that pair, and the uncomfortable part is where it
  happened.** A Gradle mutation run read `build/test-results/*.xml` and reported `failures=0` — the
  guard does not catch this. The build had **not compiled**: the mutation was written in a form that
  did not typecheck, `testDebugUnitTest` never ran, and nothing rewrote the results file. The verdict
  came from the *previous* run, served with no indication of its age and no exit code beside it.

  Line them up, because the three are one failure wearing three costumes:

  | | What the instrument did | What was reported |
  |---|---|---|
  | 263 ms window | sampled outside the window | **no reading**, read as a negative |
  | 200-page cap | ended the run itself | **its own ending**, read as the pager's |
  | stale results XML | never ran, and served the last run's file | **an older reading**, read as this run's |

  The first held nothing, the second held something about itself, the third held something true
  about a different moment — and all three printed a confident number.

  **This one happened inside the run written to prove a guard against exactly this family.** The
  session had just added a row to this table about an instrument reporting a state it had not
  measured, and then did it, three mutations later, in the mutation testing meant to establish that
  defect 56's guard could see its own defect. Being able to state the rule is not being immune to it,
  and a project that has written this table nine times over is precisely the project most likely to
  trust its own harness.

  So the harness owes what the probes owe. Every automated verdict prints **the age of the artifact
  it read and the exit code of the command that should have produced it** — one line, and the version
  of this run that has them reads `results file written 0.1s ago; gradle exit: 0`. An artifact older
  than the run is not a result, it is a memory, and `failures=0` from a build that never compiled is
  the most confident wrong answer in the set.

  **The eighth and ninth entries are one rule on two different tools, and neither of them is about
  folders.** They were found in the same hour, from opposite directions, and both would have been
  written down as facts about the product:

  - **A missing reading is not a negative one, again — this time because the action had not
    happened.** Waiting for the cancel branch's log line after pressing `KEYCODE_BACK` in
    DocumentsUI, nothing appeared, and *"the silent branch does not run"* was one sentence away.
    BACK **navigates up** inside the picker; it does not cancel. `dumpsys activity activities` still
    named `PickActivity` as resumed. This is the 263 ms window with a different cause — there the
    window closed between samples, here the window had not opened — and the same fix: **establish
    that the thing you are waiting for has actually been triggered before reading its absence.**
  - **A row's presence is not the property you are counting.** After
    `releasePersistableUriPermission`, `dumpsys activity permissions` **still lists the released
    grant** — with `persisted=0x0`, beside `mode=0x1 owned=0x1` transient entries. Counting rows
    matching `documents/tree` returns 2 and reads as a failed remove. The discriminator is
    `persisted=`, **never the row's presence**.

  **The part that will catch someone is that the same query gave two different answers an hour
  apart, honestly.** An earlier revoke in the same sitting left *no* row, because that grant had
  been created by a process that had since died, so there was no transient entry to linger. Same
  command, same package, same provider: clean absence once, a misleading presence the next time, and
  **nothing in the output announces which situation you are in.** A reading taken only in the first
  situation would have established "revoke removes the row" as a fact, and the second reading would
  then have looked like a bug in the revoke.

  So: when a tool reports an aggregate — a count, a presence, an exit code — **name the attribute
  that distinguishes the thing you mean from the thing that merely matches**, and check that the
  attribute is in the output at all. `grep -c` was the second entry in this table and it is the
  ninth as well; the failure has not changed since.

  ### **Two readings, one fact** — the family, now with three members

  Three of the entries above are not lone bad readings. They are **pairs**: two instruments asked the
  same question about the same fact at the same time, and returned different answers. The pattern is
  worth a name because a fourth one is otherwise indistinguishable from an ordinary bug, and because
  the instinct it triggers — *which tool do I trust?* — is the wrong instinct every time.

  | The fact | Reading A | Reading B | Which was right |
  |---|---|---|---|
  | Does `mms-sms/conversations` honour a selection? (defect 50) | `adb shell content query --where 'date<…'` → 2990 rows | the app's bound `?` → **empty cursor** | **Both.** The shell *inlines* its literal, the app *binds*; two clients, two different queries, and only one of them is the product |
  | What is the Mac's current DHCP lease? (step 71) | `ifconfig en0` → the old subnet | `ipconfig getsummary en0` → `yiaddr = 10.108.253.92` | **B.** `ifconfig` was serving a stale lease while the new one was already in place |
  | Is `push-probe.bin` there, and how big? (slice 8) | `ls -la` → 3,000,000 bytes, the OLD file | `sha256sum` → `No such file or directory` | **Neither.** A SAF delete-plus-rename leaves stat-by-name briefly serving a stale entry to one caller and a miss to the next. Listing the *directory* was the third query that answered it |
  | Does the phone still trust this Mac? (2026-09-02) | `sqlite3` on a copied `connectsuite.db` → 1 row, the Mac is stored | the app's own `[trust] Forgot …` log line, and a `Rejected unpaired client` for the same key | **B.** Room runs WAL; the delete was in `connectsuite.db-wal` and the copied main file was a pre-delete snapshot. **The stale reading was the one that confirmed the hypothesis** — see the section below on why that variety is worse |

  **The three answers are A-and-B, B, and neither — which is exactly why "pick the more trustworthy
  tool" fails.** There is no ranking that gets all three right. `adb` is not less reliable than the
  app; `ifconfig` is not a worse tool than `ipconfig`; `ls` is not wrong about files.

  What works is the same question in all three cases: **what is each one actually reading?** Not
  *which is correct* — that is unanswerable from inside the disagreement — but what each query
  literally asked, of what, at what moment. A bound parameter and an inlined literal are two
  requests. A cached interface record and a DHCP client's state are two stores. A directory entry
  and a path lookup are two indexes over one filesystem. Once the two readings are known to be
  *about different things*, the disagreement stops being a contradiction and becomes information,
  and the third query that settles it usually suggests itself.

  Three corollaries, one per row, and they generalise past their own tools:

  - **When a hand probe and the product disagree, the probe is the second suspect, not the
    tiebreaker.** It differs from the shipping call path somewhere, and that difference is where
    this class of bug lives.
  - **A disagreement between two readings of one fact is a finding in itself** — worth a line in
    `docs/testing.md` even when the practical answer is already clear, because the next person will
    reach for the wrong one of the two.
  - **Two disagreeing readings do not imply one is right.** The `/sdcard` row is the one to remember:
    the correct answer came from a query neither of them had made.

  A fourth member of this family is likely and this is what makes it findable: **any time two things
  in this repo can answer one question, write down that they can, before they disagree.**


  #### The variety that is worse: when the instrument's fault produces the answer you wanted

  Every other member of this family produced a wrong answer **nobody wanted** — an empty cursor, a
  page cap, a stale XML, a hidden pane. Being unwelcome is what got them looked at. A reading that
  contradicts your expectation is *interrogated*; a reading that confirms it is *filed*.

  So the dangerous instrument fault is not the one that misleads. It is the one that misleads
  **towards the hypothesis already on the table**, because the check that would catch it is the one
  step nobody performs on good news.

  **The worked example, 2026-09-02.** A release build would not pair. The hypothesis on the table,
  reasonable and offered first, was *the Mac's slot still holds a pairing from the debug install, so
  the phone is being shown a certificate it never pinned*. Testing it meant reading the phone's trust
  store:

  ```
  $ adb shell run-as … cat databases/connectsuite.db > cs.db
  $ sqlite3 cs.db "select name, fingerprint from trusted_devices;"
  Chetans-MacBook-Pro|DESKTOP|3030c8ebcddcd0fb…          ← the Mac IS still stored
  ```

  That is a **stale pre-delete snapshot**, and it is the reading that fits the hypothesis. Room runs
  SQLite in **WAL mode**: committed writes live in `connectsuite.db-wal` until a checkpoint, so a
  copy of `connectsuite.db` alone is the database *as of some earlier moment*, served with no
  indication of its age and no error. Copied with its `-wal`:

  ```
  with the WAL     → 0 rows          ← the Mac had been forgotten
  main file only   → 1 row           ← the answer that confirmed the theory
  ```

  The truth was the opposite of the hypothesis: the phone had forgotten the Mac (a `Forget` tap,
  logged), the Mac still held the phone, and nothing about the release build's identity was involved.
  A confirmed theory, a plausible mechanism, and a clean SQL result — all wrong, and all pointing the
  same way.

  **Why this variety earns its own entry:**

  - **The stale-XML row was caught by its own oddity** — `failures=0` from a build that had not
    compiled is strange on its face. A trust-store row that says exactly what you predicted is not
    strange at all. There is nothing to notice.
  - **Confirmation removes the second query.** The habit this file is built on — *ask a third
    question when two readings disagree* — is triggered by disagreement. One reading that agrees
    with you produces no disagreement, so the habit never fires.
  - **It is the shape that survives review.** The write-up would have read *"the phone still trusts
    the old certificate, so the release app cannot pair"* — coherent, evidenced, and false, with a
    real defect (the `Forget` tap and the asymmetric trust it leaves) invisible behind it.

  **The rule, stated for any store and not just SQLite: a file copied out of a running system is a
  question about a different moment than the one you asked.** Databases with write-ahead logs,
  journals or snapshots (`-wal`, `-shm`, `-journal`, an LSM's memtable, a log-structured store's tail)
  keep recent truth *outside* the file everyone names. Copy the whole set, or read through the
  engine, or say the reading may be stale — but never take the main file as the state.

  **And the general form, which is the part that is not about databases:** when a reading confirms
  the hypothesis, that is the moment to spend one query on the instrument, because it is the only
  moment the reading will not be challenged on its own. Concretely: *what would this instrument have
  shown if the hypothesis were false* — and if the answer is "the same thing", there is no reading
  yet.

  #### The degenerate case: one reading wearing two hats

  The family above is two instruments disagreeing. The failure below is the same family with **the
  second reading missing entirely** — and it is worse, because a disagreement is at least visible
  and this produces a clean, confirming, single answer.

  **If the instrument supplies its own input, it measures itself.** The concealed-clipboard check
  was validated by `clipboard.writeBuffer(type, …)` followed by `clipboard.read(type)`: Chromium
  wrote the marker, Chromium read it back, and it came back. That is a true statement about
  Chromium's encoding and says **nothing whatever** about a marker a password manager wrote —
  measured a day later through `NSPasteboard`, the same call returns `""`, and the check that
  shipped could never have fired on the input it exists for.

  The question that catches it is not *did the control pass* but **who wrote the thing I am
  reading**. When the answer is *this same subsystem*, there is no reading yet — there is a
  round-trip. A round-trip is worth taking (it proves the call path is wired) and it must be
  labelled as one, never as evidence about foreign input. `scripts/support/write-marked-clip.swift`
  exists for exactly this: when the product's own API cannot construct the state under test, the
  stimulus comes from outside the product or the reading does not exist.

  #### And the control must differ from the real input only in the thing being tested

  The second half of the same failure, and it is the one that made it survive review. The control
  wrote `'1'` as the marker's *value*, and the check read the value. Real markers carry **empty
  data** — the type's presence is the whole signal. So the control and the real input differed in
  **exactly the attribute under test**, which makes a control not merely weak but actively
  misleading: it certifies the one behaviour that does not occur.

  Stated generally: **a control is a claim that this input is like the real one in every way that
  matters.** Before trusting one, name the attribute the check reads and confirm the control carries
  it *the way the real input does* — not merely that it carries it. Here that is one sentence —
  *does a real password manager set a value, or just the type?* — and it was never asked, because
  the control passed.

  The two halves are one rule from two directions: the first says the stimulus must come from
  outside the instrument, the second says it must resemble the real thing where it counts. Fail
  either and the result is a confident green over a feature that has never worked.

- **Fix the name before you take the reading, and measure against the name you would have to
  defend.** A measurement taken while the thing measured is still unnamed will be written up under
  whichever name flatters the result, and nobody afterwards can tell the difference.

  The worked example is `apps.*`, 2026-09-02 to 09-03. Two names for one idea — `apps.launch` and
  `apps.open.ask` — were written into `docs/protocol.md` **before** the experiment ran, with a
  pre-registered table saying which reading produced which. Then the reading came back as the worst
  row: a backgrounded `startActivity` **returns normally, logs nothing, and brings nothing to the
  front**.

  Because the names already existed, that result had a place to land, and the place it landed
  changed what it meant. **The prohibition it produced is on a name, not on the feature.** The
  original table conflated *how the platform refuses* with *what should be built*, and only the
  first is a measurement:

  | | The finding |
  |---|---|
  | The mechanism | Row 4 — blocked *silently*. This forbids `apps.launch` outright: a verb built on it returns success and does nothing |
  | The product | Row 3 — a notification the user taps. `apps.open.ask` never calls `startActivity` from the background, so the silent block cannot touch it |

  **That split is only visible because the names were fixed first.** Had the verb been called
  `apps.launch` throughout the experiment, the same reading would have been written up as *"launch
  works, via a notification"* — which is a true sentence about a mechanism and a false one about the
  verb, and it is the shape §"A true sentence about the wrong one of two paths" says nothing in
  review is aimed at. The ack would have meant *asked*, the callers would have read *opened*, and
  the correction would have arrived after a Mac-side grid, a retry and a pending-launch queue had
  all been built on the word.

  So the rule has two halves, and the second is the one people skip:

  - **Name the thing before measuring it**, in the contract, with the alternatives written down.
  - **Measure against the name you would have to defend, not the one you hope for.** The question is
    not *did it work* but *would I sign the sentence this name commits me to*. `apps.launch` commits
    you to "the app came to the front"; the reading could not support that, and no amount of
    "well, it opens eventually" repairs it.

  The corollary is about deletion. A name the measurement refused is **not** kept around as a
  reserved constant — `MessageType` has no `APPS_LAUNCH`, and `scripts/check-apps-verb.mjs` is what
  keeps it that way. An unused constant with a better name than the one that shipped is one
  autocomplete from a handler.

- **Ground truth and the reading have to be in the same unit before either one is a number.** A
  comparison across units does not fail loudly; it produces a plausible gap, and somebody spends a
  day hunting a defect that does not exist.

  It nearly happened twice in this feature, in opposite directions. `adb shell cmd package
  query-activities` counts **launcher activities** — 244, later 246. Every app-side query counts
  **distinct packages** — 122, later 123. One package can publish several launcher entries, so both
  numbers are honest and neither is wrong. Compared to each other they report the app seeing *"122
  of 244"*: a **45% package-visibility gap** that does not exist, over a result that was in fact
  *122 of 122*, perfect.

  What makes it dangerous rather than merely wrong is that the fictional gap is **exactly the shape
  of a real, well-known bug.** Android 11 package visibility hiding half the launcher set is
  plausible, is what `<queries>` exists for, and is what defect 28 already was. The wrong number
  does not look like a units error — it looks like a diagnosis.

  So, before a ground truth and a reading are compared:

  - **Say the unit out loud in both, in the same sentence.** "246 activities" against "123 packages"
    is obviously not a subtraction; "246" against "123" invites one.
  - **Recount the ground truth in the reading's unit** rather than converting the reading.
    `… | grep -o packageName= | sort -u | wc -l` is one pipe and it makes the comparison legal.
  - **Carry the unit into the code and the log.** `AppsPayloads.MAX_APPS` is documented in packages,
    and the phone's own line says *"this counts PACKAGES; `query-activities` counts ACTIVITIES and
    is a larger number for the same phone"* — so the next person to run both does not have to
    rediscover it.

  This is the denominator rule one level down. That rule says a count needs the number that gives it
  scale; this one says the two numbers have to be **of the same thing** before the ratio means
  anything at all.

- **A tagged union is a rule about what can be represented, not about who may write it.** Making an
  ambiguous state unrepresentable does nothing about two callers racing to set an unambiguous one,
  and the second writer is free to move the machine back to a state the first had already left.

  The worked example is as sharp as it gets: **the pane whose entire design exists to keep "no
  folders" apart from "couldn't read folders" reached exactly that confusion through a race.** The
  Files pane's state is one tagged union in `src/shared/`, `empty` and `failed` cannot both be true
  or both be false, the render switches on `kind` and the compiler checks it is exhaustive — and on
  a cold start the route opening and the `files` capability arriving both called `refresh()` within
  a frame of each other. The first fetched the roots and listed 28 entries. The second reset the
  listing underneath it and its own `fs.list` then timed out. **The pane settled on an empty table
  with no error at all**, which is the one outcome the type was built to make impossible:

  ```
  02:55:13 I [files] fs.list saf:primary%3ADCIM/ → 28 entries, hasMore=false, 53 ms — 1 ok / 0 failed
  02:55:31 W [files] fs.list saf:primary%3ADCIM failed: fs.list timed out after 10000ms
  ```

  Both triggers were *correct*. Neither is a bug on its own, and neither could be removed. That is
  what makes this a rule rather than a defect: the guarantee was never violated — every intermediate
  value was a legal state — and the wrong picture was assembled out of legal states in the wrong
  order.

  So: **anything that can be triggered by more than one event needs its concurrency stated, not just
  its type.** The fix here is one line of intent — a second caller *joins the run in flight* rather
  than starting another — and the question that finds it is *who else calls this, and what happens
  if they both do*. Ask it of every fetch that a route, a capability, a reconnect and a retry can all
  begin, which on this Mac is all of them.

  The corollary worth keeping: a type system reasons about one thread's values, a race is about two
  threads' order, and no amount of care in the first buys anything in the second.

- **The instrument gets its own control before the reading counts — third sitting, and now from
  three directions at once.** The rule above this one is about a device or a provider lying; the one
  below it is about the DOM. This is the same rule again, and it is here because three *different*
  measurement faults landed in one afternoon, each read plausibly and each was about the wrong
  thing:

  | The instrument | What it reported | What it was actually measuring |
  |---|---|---|
  | `document.querySelector('[data-screen="files"]')` | the pane: `visible: true`, and its buttons | **the app window** — which carries the same attribute as its route marker and comes first in document order. The button list was the sidebar's, and a pane that was hidden reported itself visible |
  | a `/drop\|upload\|send to phone/` regex over the pane's text | an upload affordance is present | the **degraded banner's own sentence** — *"Sending files to the phone from here does not yet"*. The copy explaining an absence contains the words for the thing that is absent |
  | reading the `Download` wall's copy from the state card | the wall is in the pane | the card only renders with **at most one root**, so the wall drew only in the almost-empty case — the state nobody with folders is ever in. Present in the code, invisible to every real user |

  **Each of the three is a different failure and they share one cause.** The first measured a
  superset of the target. The second matched a lookalike made of the target's own words. The third
  measured a real thing in the one situation that does not occur. None produced an error, none
  looked wrong, and two of them produced *confirming* answers — the most expensive kind.

  The controls, in the same order, and all three are one line each:

  - **Narrow the selector until it can only be the thing**, then assert what you narrowed to is the
    thing: `section[data-screen="files"]`, and a check that it is visible before believing anything
    it says about itself. When an attribute can appear on two elements, `querySelector` picks the
    document order, not the meaning.
  - **Count controls, never words.** An affordance is a `button`, an `input[type=file]`, a drop
    handler — things you can enumerate. Text search finds the sentence apologising for its absence.
  - **Check a state in the situation the user is in**, not in the situation that makes it easy to
    render. "Is the copy present?" is the wrong question; "is it present *with two folders
    granted*?" is the one that found this.

  **That third row broke a second time, and the second break is the more useful one, because the
  first fix did not fail — the untested half did.** The condition is `showsState` in the Files pane:
  it chooses between the state card (which carries the `Download` wall in its copy) and a plain wall
  line, and `wallEl.hidden = showsState` makes the two homes complementary. Slice 7 got it wrong one
  way; slice 9 got it wrong the other way, when a second grant-free root made `roots.length > 1`
  permanently true and the **M2 card stopped being drawn at all** — no headline, no guidance, on the
  one screen where the user has done nothing yet.

  Two things to take from it, and only the second is about folders:

  - **Say what actually went missing.** The first write-up of the second break said *the wall
    stopped drawing for everyone*. It did not: the wall moved to its other home, and exactly one
    copy was on screen throughout. The claim was adjacent to the truth and more alarming than it, and
    it was made by reading one condition and not the line that consumes the same boolean the other
    way round. **A regression report is a reading too**, and "what else would look exactly like this"
    applies to your own diff.
  - **Four tests went red on the mutation and none of them touches the thing that broke.**
    `sharedFolderCount` and `filesPaneView` are covered; `showsState` lives in the renderer and is
    reached by no test — the same condition, untested, both times. A guard on the function that was
    written correctly is not a guard on the decision that keeps going wrong. When a bug recurs in one
    line, the question is not *is the new expression right* but **what would have caught either
    version**, and if the answer is "nothing", the line is in the wrong file.

  This is now the third sitting where the reading was fine and the instrument was not — the probe
  cap, the hidden grid, and these three — so the general form is worth stating without a device in
  it: **a measurement has two halves, what you measured and what you measured it on, and only the
  first one ever gets checked.** Before a reading becomes a finding, say out loud what element, what
  rows, what window it came from, and what else would have satisfied that description.

- **Searching for a forbidden thing finds the sentence forbidding it — and after three sightings the
  location of the hole is known, which is the useful part.** A guard names what it bans. That name is
  a string. The string ships in the same artifact as the thing it guards. So a text search for the
  banned thing matches its own prohibition, and reports the ban as a violation.

  Three sightings, in three languages and three artifacts:

  | Search | Reported | The match was |
  |---|---|---|
  | `/drop\|upload\|send to phone/` over the Files pane's text | an upload affordance is present | the **degraded banner's own sentence** — *"Sending files to the phone from here does not yet…"* |
  | `read('org.nspasteboard.ConcealedType')` against a control writing `'1'` | the concealed check fires | the control was the only input that could pass it; real markers carry **empty data** |
  | `strings installed.apk \| grep -cF 'adb tcpip'` | defect 65 resurrected | `OnboardingCopy.forbiddenMechanisms`' `why` field — **the explanation of the ban**, in the same dex |

  **The instinct after the third is to audit every string guard in the repo. That was done, and it is
  the wrong target — all of them already carry the discriminator**, each one added after this bit
  somebody:

  - `check-apps-verb.mjs` strips comments and states the split outright — *a use is a quoted wire
    literal or an identifier; a mention is the name in a comment or in Markdown* — with a fixture
    asserting the KDoc explaining the absent verb stays legal.
  - `check-protocol-spec.mjs` counts a type as specified only where it **opens a heading or a
    paragraph**, because occurrence-counting passes on a passing mention.
  - `check-renderer-views.mjs` requires **construction**, not mention.
  - `check-clip-echo.mjs` declares two homes and expects the names throughout the prose that explains
    them.
  - `no-force-stop.sh` strips heredoc bodies and `-m` values, and has six fixtures — three that must
    deny, three that must pass — after denying the commit that wrote its own rationale.

  **So the hole is not in the committed guards. It is in the one-off read**, and that is exactly
  where it will always be: nobody writes a use/mention discriminator for a command they intend to run
  once. All three sightings above are ad-hoc probes, and the third one's number went straight into
  `CLAUDE.md`'s roadmap row — which is the definition of *a read whose number gets written down*, the
  scope `scripts/probe.mjs` already claims for DOM reads.

  The rule, then, is not "add a guard". It is: **a text search over a blob is never evidence for a
  user-facing claim, because the blob contains the prose about the claim.** Ask the question of the
  enumeration instead — for onboarding copy that is `OnboardingCopyTest` running
  `forbiddenMechanisms` against the **page list**, which is a list of strings someone chose, not a
  grep over everything the compiler emitted. When no enumeration exists, the honest report is the
  match itself and not the count: *what did it match, and who wrote that line*. The second entry in
  this file's control table has said **look at the matched lines, a `grep -c` is not evidence** since
  Phase 3; this is that rule meeting a compiled artifact, where the matched line has no file and no
  author until you go and find it.

- **The DOM-as-instrument rule has a mechanism now: `scripts/probe.mjs`. Use it, do not re-derive it.**
  Every CDP read that feeds a claim in `docs/testing.md` goes through it. `control` is a required
  argument with no default; a fixed sleep cannot be expressed (`settle: {until, within}` returns
  `stopped: 'deadline'` and `reportable: false` when it gives up); no result is a scalar; the element
  is resolved by `__probe.one()`, which throws on no match, on two matches, and on a hidden node; and
  a `text:` matcher is refused for presence questions in favour of counting controls.

  It exists because the rule below was written three times and broken three times, each time by
  whoever had most recently written it — a control is a separate voluntary act from a reading, and
  nobody feels the need for one while reading a number that looks right. It was run against all three
  faults that produced it and catches all three; the evidence is in `docs/testing.md`.

  **The enforcement point is `scripts/probe.test.mjs`**: three fixtures, each with a control for the
  opposite case, plus a scan that fails when anything under `scripts/` calls `Runtime.evaluate`
  outside `probe.mjs`. It found a real violation on its first run. `scripts/files-pane-probe.mjs` is
  the worked example — and it caught its own author twice while being written, once reading a
  28-row folder as a scroll-containment failure and once reading a mid-`refresh()` transient as a
  vanished wall. **Scope: reads whose numbers get written down.** Ad-hoc poking stays ad-hoc, and
  widening it further is how people start routing around it.

- **The instrument gets a control before the reading does — and the DOM is an instrument.**
  The rule above is usually applied to a device or a provider. It applies unchanged to the thing
  drawing the UI, and it was broken twice in one sitting on 2026-08-31, in both directions:

  - **A false negative.** Scrolling a photo grid to load its next page appeared to do nothing:
    `clientHeight` and `scrollHeight` both `0`, no page fetched. That was one sentence from
    *"paging does not work"*. The pane had routed itself away and the section was `hidden` — a
    hidden element cannot scroll and reports no height, so the run measured **nothing at all**. The
    control is one line: assert the thing you are measuring is visible, before believing what it
    reports about itself.
  - **A false positive, from the eye rather than a query.** The same grid's tiles were reported —
    confidently, from a screenshot — as "tall, not square". Measured, they are **126 × 126** with
    `aspect-ratio: 1` applied. A screenshot is a reading like any other and carries no scale unless
    something in it does.

  Both directions matter, which is why they are one rule: **a negative impression is no more
  evidence than a negative reading.** Before a look at a screenshot becomes a defect, measure the
  thing; before an empty result becomes a finding, prove the surface was there to be read.

  This is the same defect as a failure count with no success count, one section up: a number, or an
  absence, with nothing to give it scale. The 11:00 adb dropout is what the rule looks like when it
  works — 27 samples read "grant revoked", the control column read 0 in the same rows, and a defect
  that did not exist stayed out of this repo.

- **A check that does not gate the action is decoration.** If code reads a target and then acts
  regardless of what it read, the read is not a safety measure — it is a log line that makes the
  eventual accident harder to explain, because the transcript will show the right value being
  observed immediately before the wrong thing was done.

  Written on 2026-08-29, after it cost the user a phone call. The step 70 watcher waited for the
  live call card, read it **six times** — `who="Chetan"`, `status="Dialling · +919800000001"` — and
  then clicked **Reject**, because the click was the next statement and nothing stood between them.
  `Dialling` is not `Ringing` and that number is not the caller's; the readings said plainly that
  this was not the call under test. It hung up the user's own outgoing call to the second person,
  two seconds in, and the real ring arrived 32 seconds later with nothing watching.

  This is the same shape as the two rules above it, which is why it belongs beside them rather than
  inside one defect's record. The coordinate rule says do not act on a target you have not
  identified. The control rule says do not accept a reading you cannot trust. This one closes the
  gap between them: **having identified the target correctly is worth nothing if the action does
  not depend on the identification.**

  **There is a third form, found on 2026-09-02, and no amount of screen-reading catches it.** A
  script gated on every check it had — resumed activity confirmed, screen re-dumped before each tap,
  refusing when the screen moved — correctly navigated to a settings screen and then flipped a toggle
  it had been written to flip the day before, after that decision had been explicitly reversed. Every
  gate verified the **target** of the action; none verified its **premise**, and the premise had
  expired. So: *is this still wanted* is part of the predicate, and it is the part a dump cannot
  answer. The corollary is about tools rather than checks — **automation built for a decision that
  has been reversed is part of what gets reverted.** A script that still works perfectly for a
  purpose nobody holds any more will be reached for by the next person who recognises its name, which
  is the force-stop failure wearing a different command.

  Concretely, for anything that drives a real device: the predicate that decides *whether* to act is
  the same expression that decides *what was seen*, evaluated at the moment of acting — not earlier,
  and not in a comment. Re-check it immediately before the irreversible call, since the card can
  change underneath a slow read. And when it refuses, **say what it refused and why**, or the next
  person debugging a silent no-op will remove the gate to find out. `scripts/step70-watch.mjs` is
  the worked example: it will not click unless the card reads `Ringing` *and* carries the expected
  number, it re-tests both immediately before the click, and it logs every card it declines to
  touch.

- **A registration line is not an execution line.** "The receiver is running" is not "the branch
  fired", and "the feature is installed" is not "the code path ran". Both are true statements about
  a different layer than the one being asked about, and offering one in place of the other is how a
  build gets called proven on evidence that could not have distinguished it from a build where the
  change was never made.

  This is the third member of the family above and it fails in the same way as the other two: the
  reading is real, the confidence is warranted for what was actually read, and the conclusion is
  about something else. The control rule asks whether a query can tell its target from a lookalike;
  this one asks whether the reading is *about* the target at all.

  The worked example is defect 45's option 4. Its only log line —
  `Call cN card corrected in place: …` — is written inside the correction branch, which needs a live
  episode whose `EXTRA_INCOMING_NUMBER` changes from blank to a number. Outgoing calls carry no such
  extra; the receiver is registered `RECEIVER_NOT_EXPORTED`, so a synthetic `am broadcast` cannot
  reach it, and `PHONE_STATE` is system-only regardless. **Option 4 is therefore unprovable before a
  ring, by construction.** `Watching PHONE_STATE for the inbound number` and `Call watcher started`
  prove the receiver hosting it is registered and nothing more; a checksum match on the installed
  APK proves the code is on the phone and nothing more. Neither is a substitute and neither should
  be offered as one.

  The constructive form, which is what to do rather than what to avoid: when the proof cannot
  precede the act, **make it the act's pass criterion instead of its precondition.**
  `card corrected in place` is what step 70 is watching *for*, not what authorises it to run — and
  `scripts/step70-watch.mjs --require-correction` is that written as code: it holds the ring, waits
  for the line, and refuses the reject if it never comes, so a build whose visible change did not
  happen does not get a call spent on it. Anyone asking for pre-ring proof of option 4 should be
  pointed here.

- **A fix verified only at the moment it fires is not verified against the state it was meant to
  prevent.** The rule above asks whether a reading is *about* the target. This one asks a question
  one level further in: the code ran, the log line is real, the check is green — **but what state
  was the machine in when it ran, and is it the state the defect describes?**

  It has happened twice in two days, and the two together are what make it a rule rather than a
  coincidence:

  | | The state the fix exists to prevent | The state it was observed in | What the green run actually proved |
  |---|---|---|---|
  | **defect 61**, first fix | a wake lock that has lapsed, leaving a gap | a lock *about to* lapse, repaired in time by accident of sampling | that the repair path works — not that the gap never opens |
  | **defect 60**, boot half | a phone that boots with nothing listening | a phone **already listening** when the branch ran | that the receiver is delivered to — not that it can start anything |

  Defect 61 is the sharper of the two because a number caught it. The first fix re-acquired only on
  `!isHeld`, which **repairs a lapse rather than preventing one**, and the overnight run measured a
  **59m49s** hold against a 60-minute timeout — eleven seconds from a nineteen-minute gap opening.
  Had the sampling landed a minute later the run would have been recorded as a pass, over a fix that
  was doing the wrong thing correctly.

  Defect 60 is the commoner shape and the easier one to miss, because **nothing looked wrong at
  all**. A real reboot produced `[autostart] BOOT: …` and `scripts/link-up.sh` returned three OKs
  with nothing tapped — the exact pass criterion, met. The branch that ran was
  `already listening — nothing to do`: the notification-listener rebind had started the service 3.9
  seconds earlier, so the boot path's own start was never reached, and the narrow
  `connectedDevice`-only foreground type it was carefully written to claim has still never been
  claimed at boot. Worse, on a phone with the listener enabled the rebind may *always* win, which
  makes the branch structurally unreachable in the only configuration anybody runs.

  Both are the lookalike table's failure moved inside the experiment. There the question is *what
  else would produce this reading*; here it is **what else would produce this pass** — and the answer
  in both rows is "the version of this fix that does not work".

  So, concretely, before a fix is recorded as proven:

  - **Name the state the defect describes**, in a sentence, and say whether the machine was in it.
    "The link was down and came back" is a different claim from "the link never went down".
  - **A no-op branch is not a pass.** If the code's response to the stimulus was *nothing needed
    doing*, the thing under test did not run. Say so on the line rather than in a footnote — this is
    why `already listening — nothing to do` is logged with its reason attached.
  - **When the state cannot be produced on demand, say the fix is unproven and name the stimulus
    that would prove it.** For defect 60 that is one restart with the notification-listener grant
    revoked, which removes the competing route and leaves the boot path as the only one. Writing
    that down is cheap; discovering in Phase 8 that the boot path never worked is not.
  - **Do not engineer the state by breaking the working path.** Delaying the rebind so the boot
    branch can be seen would sabotage a healthy link to observe an unhealthy one, and the early
    return it would defeat is correct.

  The corollary for instrumentation, which is what makes the next one findable: **when two mechanisms
  can satisfy the same guarantee, the log must say which one did.** `LinkAutoStart` names its reason
  on every line — `LISTENER_REBIND`, `BOOT`, `PACKAGE_REPLACED` — and that is the only reason this
  was visible at all; a single `Link restored` line would have read as a clean pass forever.

- **A pass criterion naming a string the code does not write is a test that can only fail.**
  The small, cheap member of the family above, and it cost two false negatives in one sitting.

  `docs/RESUME.md` defined the boot pass as *"a `[boot] BOOT:` line in `files/logs/link.log`"*. The
  tag is **`autostart`**; no line in this codebase has ever contained `[boot]`. The criterion had
  been written down three days earlier, reviewed, and carried in the brief as the definition of the
  pass — and a grep for it returns zero on a perfectly healthy boot. The same run's first attempt
  read the log of `com.connectsuite.app`, a package that exists on no device here (it is
  `com.chetan.connectsuite.debug`), where `run-as` fails and the count is of nothing.

  Two zeroes, both confident, neither about the boot path.

  The control is one command and it is the same one every time: **prove the query returns a known
  positive before believing a negative.** A `wc -l` showing 439 lines and a grep for a tag known to
  be there (`clip` → 39) turns a zero for `[boot]` into a reading about the boot path rather than
  about the query.

  The enforcement point, since a rule without one is a rule someone remembers: a pass criterion that
  quotes a log string should be **derived from the source that writes it** — `LinkLog.i("autostart",
  …)` — and not typed from memory into a document nothing checks. Where a criterion is written by
  hand anyway, the check that makes it honest is to run the grep against a log known to contain the
  event *before* the run that depends on it.

- **A green pager needs a clock beside it.** The three preconditions above all ask whether a pager
  *loses rows*. None of them asks whether it can be afforded, and a pager can pass every one of them
  and still be unusable.

  Defect 55 is the worked example and it is worth the four numbers. `fs.list` paged a 16,377-entry
  directory in 33 pages, every id distinct, every page summing, `stopped=exhausted` — a clean sweep
  of every check this project had ever asked a pager for. It took **490 seconds**, because `limit`
  bounds the *frame* and never the *work*: a `DocumentsProvider` honours neither a sort order nor a
  limit, so all 16,377 rows were read and sorted again on each of the 33 pages to hand back 500.

  Two things make it belong here rather than in its own defect record. First, **it is only visible by
  running to exhaustion on real data**: one page returning 500 rows in 17 seconds reads as a slow
  phone, and thirty-three of them read as a broken product. Second, **the UI would have hidden it** —
  a grid that loads more when you scroll, slowly, is indistinguishable from a bad moment on the
  network, which is one more reason to prove a phone-side pager before drawing anything on top of it.

  So the rule: a pager is recorded as working on consecutive pages, counted, **with elapsed time per
  page reported beside the counts**. The fix was a per-directory snapshot held for the length of a
  run (490 s → 21 s), and that turned out to be a *correctness* fix too — re-reading between pages
  lets the cursor's sorted position shift underneath the pager, so a snapshot is the consistent view
  the cursor was always assuming it had.

- **Raising a guard's number to fit new code is how it stops guarding.** When a counting guard fails,
  the first hypothesis is that the code is wrong, not that the number is stale. The number moves only
  when the extra work turns out to be a **genuinely different question**, and it moves by being
  replaced with two assertions that name the two questions — never by being incremented.

  The worked example cost a user's file in the writing. `FsDeleteGuardTest` counts calls to
  `DocumentsContract.deleteDocument` on the push path and expects **one**. The first version of
  `commit()` made **four**, and the tempting reading — *push is new, of course it deletes more* —
  would have been one character of edit. One of those four calls was silently removing an existing
  file at the destination: `overwrite` was in the payload spec and had never been implemented, so
  every push over a name that already existed destroyed what was there without asking.

  The guard was right and the code was wrong, which is the ordinary case and not the surprising one.

  The number is **two** now, and what makes that legitimate is not that two is closer to four. It is
  that the fourth call became a named question with its own function: `deleteIfUnchanged` asks *may
  this file the Mac was looking at be destroyed?* and `deleteArtifact` asks *may this transfer
  artifact be cleaned up?* — two different questions with two different answers, **both asserted by
  name** rather than summed into a count. A guard that asserts a total tells you when the total
  changed; a guard that asserts two named calls tells you *which* one appeared.

  Concretely, when a counting guard goes red: name every call the new code makes and say what
  question each answers. If two calls answer the same question, that is the defect. If they answer
  different ones, split the assertion — do not raise the count. And a count that has been raised
  twice is a guard that has stopped guarding; replace it rather than raising it a third time.

- **A probe that reports its stimulus without measuring it can hide the bug it was built to find.**
  An instrument that applies a stimulus must report what the stimulus *did*, not what it *asked for*.
  The two are the same number often enough that the difference is invisible until it matters, and it
  matters exactly when the mechanism under test is broken — which is the run the probe exists for.

  The worked example: the push-resume probe cut a 24 MB transfer and reported `sentBeforeCut:
  12058624`. **Zero bytes had arrived.** `socket.destroy()` discards the send buffer, so 12 MB handed
  to `writeFrame` never left the machine, and the count was **bytes queued**. Every layer then told
  the truth about a different thing: the Mac reported what it had written, the phone reported
  `stopped after 0 bytes`, and *resume does not work* was the reading on offer.

  It is worse than a wrong number, because the wrong number was **plausible and confirming**. A probe
  reporting 12 MB delivered and a phone reporting a resume from 12 MB would have agreed, and the run
  would have been recorded as a pass — over a product where nothing had been delivered.

  And underneath it sat the real defect: a truncated push was being **committed as complete**
  (defect 56). Had the probe been honest about its own stimulus, the interruption would have been an
  ordinary resume and that branch would never have run. **The instrument being wrong is what exposed
  the product bug**, which is not a method anyone can rely on twice, and is the reason this is a rule
  rather than a footnote in one defect.

  So, for anything that injects a stimulus: **report the effect, measured at the far end or at the
  boundary the stimulus actually crosses**, and say which one it is. Bytes *delivered*, not bytes
  written. Taps *the view received*, not taps dispatched. Frames *decoded*, not frames sent. When the
  far end cannot be read, the probe reports the stimulus **labelled as a request** — `queued=12058624`
  — so nobody downstream can mistake it for a measurement. The fix here was a half-close: `end()`
  flushes what is buffered, and the result resolves from the socket's `close` rather than from the
  write loop.

  This is the same failure as the page cap and the 263 ms sampling window, one layer earlier: those
  instruments contaminated a *reading*, and this one contaminated the *stimulus*. Both are covered by
  the general form — **every bound and every assumption the instrument imposes must appear in what it
  reports** — and this is the half that is easy to miss, because a stimulus does not look like a
  measurement until someone reads it as one.

- **A package id may appear as a machine handle, never as the only thing a user reads.** Any payload
  carrying a package name carries a resolved label beside it, and any human-readable `message`
  mentioning an app names the app rather than the package. `remote.state` already obeys this — it
  sends `package` **and** `appName` — and so does the notification relay.

  This is defect 28 and defect 33, which are the same mistake found twice: a raw
  `com.techmash.playo` in a sentence somebody reads. 28 was believed to be two copies of it and
  turned out to be **three**, found only by enumerating rather than fixing the one on screen — so
  the practical half of this rule is *grep for every package name reaching a string, not the ones a
  screenshot showed you*.

  Resolution goes through `AppLabels.of` (`sync-module/.../sync/v2/AppLabels.kt` — not `core/`,
  which is where it is looked for first), always, including when it fails. It returns the package
  name as its honest fallback for a package with no launcher icon, logs at warning level, and keeps
  `resolved / fell back` on the line — so "12 fallbacks" can be told from "12 of 12 fallbacks". The
  fallback is correct and must not be "fixed"; what matters is that it is *reached through*
  `AppLabels` and therefore counted, rather than a raw id being interpolated somewhere that never
  asks.

  Written into the rules on 2026-08-29, before `fs.*` and `media.*` are specified, because that is
  when it is cheap. Those two namespaces have no payload spec yet and will meet package ids in at
  least five places — `MediaStore` bucket names, `OWNER_PACKAGE_NAME`, `Android/data/com.foo`
  directory entries, transfer completion text, and error `message` strings, which is where 28 was
  actually found. A path component stays the real path — prettifying it breaks navigation — and only
  the label is a sentence. See `docs/phase-5-proposals.md` §4.

- **When the platform returns one result for two intents, nothing may be explained afterwards.**
  The explanation has to be standing copy, placed before the action, because there is no afterwards
  to put it in.

  The worked example is the folder picker, and it is exact. Android refuses a folder by **disabling
  the confirm button inside DocumentsUI** — the storage root and `Download` list normally and cannot
  be confirmed (`docs/evidence/saf-probe-2026-08-31/`, `enabled="false"` with the refusal strings,
  against `enabled="true"` on two grantable folders in the same run). There is no error, no result
  code, no extra. The user backs out and `OpenDocumentTree` hands back `null` — and a user who
  simply changed their mind hands back **the same `null`**.

  So *"that folder can't be added"* would be a coin flip rendered as a fact, which is every
  lookalike in the table above with the confidence turned up. The Folders screen therefore carries
  the `Download` wall as a **permanent card in every state**, and `pickMessage(rootId = null,
  persisted = true)` returns `null` — enforced by a test shown to fail when it returns a sentence.
  The distinction it preserves is real: a pick that *succeeded* and then failed to persist is
  unambiguous and does get a sentence.

  The general form: before writing a message that explains an outcome, ask **what else produces this
  exact result**. When the answer is "an entirely ordinary other intent", the message is a guess and
  the honest response is silence plus copy that arrived earlier. This is the absence rule pointed at
  the user interface rather than at a probe — *what else would look exactly like this* — and the
  answer here is not obscure, it is half the people who open the picker.

- **A state that cannot be reached must not be drawn beside states that can.** Symmetry between two
  surfaces is not a virtue when the surfaces have different failure modes; matching them invents an
  unreachable state, and an unreachable state is the decoration rule wearing a design.

  The phone's Folders screen reads `contentResolver.persistedUriPermissions` — in-process,
  synchronous, no IPC, no network, no provider that can answer a bound argument with an empty
  cursor. **It cannot fail to load.** So it has four states and none of them is a failure:
  no-folders, folders, a row whose grant outlived its folder, and a pick that returned nothing —
  which is not a screen state at all. The Mac's Files pane asks over a link that drops, and gets six,
  four of which the phone has no use for.

  Drawing a "couldn't load folders" card on the phone would cost nothing to write and would be
  unfalsifiable forever: nobody could ever tell it from a bug in the empty state, because the only
  way to see it is a bug in the empty state. Enforced two ways — the exhaustive `when` in
  `FoldersScreen` makes the compiler refuse a new variant, and `FoldersModelTest` catches the case
  the compiler cannot, someone adding a variant *and* rendering it.

  The counterpart rule is the one this is often confused with, so both are stated: **the empty state
  and the failure state must be visibly different wherever both are reachable** — four independent
  differences on the Mac (colour role, icon, headline verb, and whether a retry exists), because one
  difference is a bug away from none. Reachable: distinguish them four ways. Unreachable: do not
  draw it at all.

- **A true sentence about the wrong one of two paths is more durable than a false one, and nothing
  in review is aimed at it.** A false claim gets deleted on sight by the first person who reads it
  against the code. An *unqualified true* one survives every reading, because everyone who checks it
  finds the mechanism it describes and stops there.

  Defect 63 is the worked example, and the way it was filed is part of the lesson. The onboarding
  security card said *"Devices are paired by confirming a key on both screens, and every connection
  after that is checked against it."* It was reported — by me — as *"describes a pairing flow this
  app does not have"*. That was wrong. `PairingRequestDialog` shows an 8-group `displayFingerprint`,
  `DevicesScreen` shows this device's own `Key …`, `PairingManager.acceptPairing` pins what the peer
  actually presented, and a person taps **Accept**. **The flow is shipped and works.**

  It is the *Sync* path — v1, Android to Android. What changed underneath the sentence is that v2
  added a **second** pairing path, to the Mac, with a different trust model: the Mac draws a QR, the
  phone scans it, the fingerprint is pinned, and nobody confirms anything. Onboarding's subject is
  now that second path. So the sentence is not a lie about a mechanism — it is a **true statement
  about the wrong one of two**, four pages before the user meets the other, with nothing telling
  them which they are reading about.

  **Why this is worse than a false claim, stated as the general rule:** verification of a claim
  usually asks *does this mechanism exist?* — and for this class the answer is yes, every time,
  from anyone who looks. The question that catches it is a different one: **which of the things
  this could be about is it actually about, and is that the one in front of the reader?** Nobody
  asks that unless they already suspect two paths exist.

  The tell, and it is cheap to look for: **the sentence names no subject.** *"Devices are paired
  by…"* — which devices, on which path? A claim that would be true of either path, in a product
  that has two, is unfalsifiable by inspection and wrong half the time in practice. So:

  - **Whenever a product grows a second implementation of something it already had** — a second
    pairing flow, a second transport, a second storage root — **every existing sentence about the
    first one becomes ambiguous on the day the second ships**, and none of them will fail a review.
    The migration is not the risky part; the surviving prose is.
  - **Name the path in the copy.** The replacement here does: *"Pairing is a code you scan once."*
    That sentence is false of Sync, which is exactly what makes it checkable.
  - **Scope the guard to the surface, not the app.** `OnboardingCopy.forbiddenMechanisms` forbids
    *"a key confirmed on both screens"* **in onboarding copy** and nowhere else, because in
    `sync-module` it describes something real. A guard that claimed the mechanism did not exist
    would be repeating the original mistake with more machinery.

  The corollary for defect reports: **a report can be wrong in the direction of being too harsh on
  the code, and that costs a real finding.** Filed as *"a flow this app does not have"*, the fix is
  one string. Filed correctly — *"the right sentence about the wrong path"* — it points at every
  other sentence written before v2 split the path in two, which is where the next one lives.

- **The module with the only user-facing copy in the product was the one module with no test source
  set. That is a structural gap, not a copy bug.** When a defect survives, ask which *module* could
  have caught it before asking which *check* was missing — a check cannot be added to a module that
  has nowhere to put one.

  Defect 65 is the case: onboarding told a new user to enable developer options and run
  `adb tcpip 5555`, to set up an ADB mirror **deleted a week earlier**, in an app whose first locked
  architecture decision is *no ADB anywhere*. A stranger's first run walked them into configuring a
  security-sensitive setting for software that is not in the build.

  It survived for one reason, and it is not that anyone was careless:

  ```
  sync-module   160 tests      core          100      input-module   44
  mirror-module  31            desktop       288      app/src/test   DID NOT EXIST
  ```

  **335 phone tests and 288 Mac tests, and not one of them could see a string in the onboarding
  flow.** `app/` is the module holding `MainActivity`, `AppNavigation`, `OnboardingScreen` and
  `LinkRoute` — which is to say **every screen a first-time user meets** — and it had
  `testImplementation(libs.junit)` sitting in its Gradle file with no `src/test` directory to use
  it. The dependency was declared; the place to put a test was not.

  **A module contributing zero tests is invisible in a total**, which is why no count ever looked
  wrong. This file's own summary at the close of Phase 4 read *"the phone's 189 (67 `sync-module` +
  122 `core`)"* — a sum over two modules of five, written without anyone noticing the other three
  were missing from it, `app` among them.

  **The generalisation, which is the useful half:** a test suite's coverage is usually discussed as
  *which behaviours* are covered. The prior question is **which modules are even addressable**, and
  a module with no test source set does not appear in any coverage report as a gap — it appears as
  nothing at all. The failure is silent in exactly the way `CLAUDE.md`'s other silent failures are:
  nothing errors, nothing warns, the suite is green, and the number goes up every phase.

  So, as a check to run rather than a thing to remember: **enumerate the modules, then enumerate the
  ones with tests, and subtract.** On this project that is one command and it would have returned
  `app` at any point in the last week —

  ```
  $ find . -type d -name test -not -path '*/build/*' | cut -d/ -f2 | sort -u
  core  input-module  mirror-module  sync-module        # app is missing
  ```

  — and the module it returns is, predictably, the one nearest the user. Modules acquire tests when
  someone writes a test for a bug; UI modules get fewer bugs *filed* because their defects are read
  as cosmetic, so they are the last to get a source set and the first to ship prose that lies.

  The fix was not a test. It was a **place to put one**: copy moved out of the composable into
  `OnboardingCopy.kt` so it could be enumerated, and `app/src/test` created so something could read
  it. The eight tests came after, and the drift guard exists to stop the copy leaking back into the
  screen where nothing can reach it.

- **A rule that matters enough to write down is a rule that needs an enforcement point.** Writing
  it in a doc is the start of the job, not the end of it. Ask, in the same sitting: what would have
  stopped this? A hook, a script that does the safe thing, a check in CI, a lint. If the answer is
  "someone remembering", it will be broken again.

  The evidence is this file. The coordinate-clicking rule and the force-stop warning were both
  written on 2026-08-28, and the force-stop warning was broken **four sections later on the same
  day, by the same author**, running the exact command it names. Not from disagreement — the rule
  was known, agreed and freshly written — but because a doc is only consulted by someone who
  already suspects they need it, and nobody suspects that while reaching for a familiar command.

  So the force-stop rule now lives in `scripts/hooks/no-force-stop.sh`, wired to `PreToolUse` in
  `.claude/settings.json`: `am force-stop` on this project's package is refused with the reason and
  the safe alternatives. It denies only our own package. Prose in `docs/testing.md` still explains
  *why*, because a hook can carry a sentence but not an argument — the two are a pair, and the hook
  is the half that actually holds.

  **That hook has its own fixtures now, and it needed them** (defect 41). Its first matcher looked
  for `force-stop` and `connectsuite` anywhere in the command, independently — so it denied every
  command that merely *talked* about the rule, including writing the doc that carries the argument.
  A hook that forbids writing its own other half has broken the pair it is supposed to be. It now
  strips heredoc bodies and `-m` message values before matching the real invocation shape, and
  `scripts/hooks/no-force-stop.test.sh` holds six fixtures: three that must still be denied, three
  that must pass and were denied before. **A matcher without fixtures is a rule you are guessing
  about.**

  The second enforcement point is `scripts/check-defects.sh`, wired through
  `scripts/hooks/defects-in-sync.sh` on `git commit`. It refuses a commit that leaves
  `docs/defects.md` and `docs/testing.md` disagreeing about which defects exist, or an open defect
  with no fix direction. It exists because step 67 passed on hardware, went unrecorded for a full
  sitting, and nothing in the build could tell — while defect 31 sat reading "awaiting step 67"
  after it had been verified. It fails **open** on its own errors: a checker that can wedge the repo
  gets deleted by the first person it wedges. It checks *existence*, not status wording, and says so
  — the statuses are prose, and a checker that forced them into four buckets would either reject
  honest rows or quietly accept wrong ones.

  **The third enforcement point is `scripts/check-protocol-spec.mjs`**, wired through
  `scripts/hooks/protocol-spec-in-sync.sh` on `git commit`, and it is this rule catching itself.
  `media.buckets`, `media.list`, `media.thumb` and `media.original` were named in
  `docs/protocol.md`'s inventory and specified nowhere in it for a whole phase — and what this file
  carried instead of a check was the sentence *migrating it is owed by whoever next touches
  `media.*`*, which is a rule enforced by someone remembering, written in the very file that says
  what that is worth.

  **Its discriminator is the interesting part, and a weaker one would have been worse than none.**
  The obvious check — does the type name appear in the document — **passes on a passing mention**:
  `media.thumb` is named five times in the `fs.thumb` section, in sentences about something else, so
  a checker counting occurrences would have reported the namespace documented on the day it was not.
  A type counts as specified only where it is the **subject** of a heading or a paragraph. That
  distinction is the whole guard, it has 14 fixtures each carrying its opposite, and its control is a
  test rather than a memory: run against the contract as it stood before the migration it must report
  exactly the six real gaps.

  It found two nobody was looking for — `mirror.stop` and `mirror.keyframe`, implemented since Phase
  2 and described nowhere.

  **The seventh is `scripts/check-apps-verb.mjs`**, and it guards a rule the contract states in
  words: exactly one of `apps.launch` / `apps.open.ask` may ever exist, and the measurement chose
  `apps.open.ask`. It is worth a hook because the forbidden name is the **better** one — shorter,
  the obvious verb, what anyone would autocomplete to — so this is not guarding against carelessness
  but against the more attractive option. And the failure would be silent in the usual way: adding
  the constant breaks nothing, registering a handler breaks nothing, and the whole thing is only
  wrong at the far end where a person watches an app not open.

  Its discriminator is the one defect 41 taught: a **use** is a quoted wire literal or an
  identifier; a **mention** is the name in a comment or in Markdown. Comments are stripped before
  matching, so the KDoc explaining why the sibling verb is absent stays legal — a guard that forbids
  writing its own other half has broken the pair it is supposed to be, and there is a fixture
  asserting exactly that case passes. It found a live reference on its first run, in a test nobody
  had thought to update, and it goes red on the real tree under mutation on both sides. And its debt list is **printed on every run with a reason per entry**, so
  a deliberately-unspecified type stays visible; an entry that becomes specified without leaving the
  list fails the check, because an allowlist nobody prunes is how a guard stops guarding.

  This does not mean every rule gets a hook; most do not warrant one. It means the question gets
  asked, and "documented" is not recorded as "handled".

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
