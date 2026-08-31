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
- `docs/phase-5-files-onboarding-proposal.md` — the SAF grant surface: the phone's Folders screen,
  the copy that states the `Download` wall plainly, and — **rev 2, and the part to read** — every
  state each side can be in, drawn before either is built. A pane showing zero folders and a pane
  that failed to load are the same picture, so §3 separates them in four independent ways and names
  the one place the platform makes them genuinely indistinguishable (a refused folder and a
  cancelled pick both arrive as `null`). **The phone half is built — 2026-09-01, all four states on
  hardware**; the Mac's Files pane (§3.3, §3.4, §6) is still a proposal.
- `docs/phase-5-fs-media-proposal.md` — the `fs.*` / `media.*` payload specification. **`fs.*` and
  `media.*` are now implemented and the contract has moved to `docs/protocol.md`** (Files, Photos);
  read this for the *arguments*, and note two recorded deviations: the delete refusal ships as
  `TARGET_STALE` rather than `STALE_TARGET`, and `push` is not served yet. It was written as prose
  against `docs/protocol.md` while nothing was built; where the two now disagree, `docs/protocol.md`
  wins, because it is the contract and this was the argument for it.
- `docs/single-device-audit.md` — **every hardware reading in this repo came from one SM-S938B.**
  Which findings are AOSP, which are Samsung, and which are honestly *unknown, single-device*. The
  method that answered most of it is one command — ask which package implements the thing you
  measured and where its APK lives — and it produced two surprises: the SAF picker is **Google's,
  Play-updated**, and `com.android.providers.telephony` is **Samsung's `SecTelephonyProvider.apk`
  behind an AOSP package name**. Read §4 before assuming a vendor claim is safe, and §6.4 for the
  one wall in this app with an expiry date nobody controls.
- `docs/RESUME.md` — where work resumes and how to pick it up. **Read it first.** It currently holds
  the Phase 5 opening brief: what the proposals decide, what they leave open, and the first slice.
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
| 5 | Files both directions, photo/video browser with drag to Finder, clipboard with history, contacts | **In progress** — photos done; `fs.*` reads, delete and pull done on hardware 2026-09-01; the phone's **Folders screen** and the Mac's **Files pane** both done 2026-09-01. Outstanding: **push** (both halves of "both directions" are not done), clipboard, contacts, drag to Finder |
| 6 | Background reliability on One UI — surviving Samsung's battery manager, doze, reconnect after sleep | Not started |
| 7 | Mac UX — packaging, distribution, app launching, and the polish pass | Not started |

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
  test call it. Second, prefer
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

  This is now the third sitting where the reading was fine and the instrument was not — the probe
  cap, the hidden grid, and these three — so the general form is worth stating without a device in
  it: **a measurement has two halves, what you measured and what you measured it on, and only the
  first one ever gets checked.** Before a reading becomes a finding, say out loud what element, what
  rows, what window it came from, and what else would have satisfied that description.

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

  This does not mean every rule gets a hook; most do not warrant one. It means the question gets
  asked, and "documented" is not recorded as "handled".

