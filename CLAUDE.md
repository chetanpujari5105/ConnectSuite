# ConnectSuite

> ## ⏸ Resume here: **`docs/RESUME.md`** — one thing is outstanding (2026-08-29)
>
> **Step 70 has not run.** It needs a second person to ring the phone once, takes about thirty
> seconds of their time, and is the last hardware evidence Phase 4 is waiting on — it proves defect
> **36** and defect **35c**. Everything else in Phase 4 is closed.
>
> `docs/RESUME.md` has the command, the one line to give the second person, what a pass looks like,
> and **which preconditions went stale overnight** — five of the eight must be re-read rather than
> trusted, and one of them (`Watching PHONE_STATE`) will produce a false positive if you grep the
> whole log instead of today's window.
>
> **Do not reinstall the phone build** before running it; a reinstall resets grants and bindings.
> **Do not start Phase 5** until it has run — its first act claims `bulkChannelSink`, and a failed
> ring must not be debugged through a transport change. Phase 5's decisions are already taken and
> recorded in `docs/phase-5-proposals.md`; nothing there is implemented.


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
- `docs/RESUME.md` — the one outstanding piece of work and how to pick it up. Read it first.
- `docs/phase-3-input.md` — the current phase brief: input injection via AccessibilityService.

minSdk 29, targetSdk 36, compileSdk 36. Java 17 toolchain — Gradle needs a JDK 17-21 (`JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home`), the system JDK 25 will not run AGP 8.13.

## Roadmap

**This list is the phase numbering. Nothing else is.**

| Phase | Scope | State |
|---|---|---|
| 1 | Transport, QR pairing, TLS, discovery, auto reconnect | **Done** — passed on hardware 2026-08-25 |
| 2 | Screen mirroring (MediaProjection capture, H.264, video socket) | **Done** — closed 2026-08-26 |
| 3 | **Input injection (AccessibilityService)** — see `docs/phase-3-input.md` | **In progress** — opened 2026-08-26 |
| 4 | Notifications + reply, calls (events, dialing, answer/reject), SMS/MMS threads, media remote | Not started |
| 5 | Files both directions, photo/video browser with drag to Finder, clipboard with history, contacts | Not started |
| 6 | Background reliability on One UI — surviving Samsung's battery manager, doze, reconnect after sleep | Not started |
| 7 | Mac UX — packaging, distribution, app launching, and the polish pass | Not started |

`android-connect-suite-claude-code-prompt.md` is the **v1 plan and is superseded**. Its phases are
numbered differently (its Phase 3 is file transfer, its Phase 6 is input) and its Phase 5 and 6 are
built entirely on ADB — `adb tcpip`, a pushed dex, `adb shell input tap` — which locked decision #1
forbids. Read it for feature intent only. Where it and this table disagree, this table wins.

Phases 4-7 are a working order, not a commitment; 3 is fixed. Deletion of superseded code is a
cleanup step inside whatever phase makes it safe, never a phase of its own.

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
  of the defects found in Phase 3 and 4 — 19, 22, 23, 24, 25 and 26 — were all Mac-side. Four more
  panes are coming in Phases 4 and 5.

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
  the same shape as an empty accessibility query: it reads as evidence and is not. Second, prefer
  making the code testable over mocking Electron. `src/shared/` is the electron-free layer and is
  where a testable seam belongs; `session.ts` came out of `link.ts` that way.
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

  Three in one day, all the same shape:

  | Query | Reported | Actually |
  |---|---|---|
  | `Reply` button absent from the accessibility tree (step 47) | feature missing | the tree was empty; Chromium builds none without `--force-renderer-accessibility` |
  | `grep -c remoteinput` on `dumpsys notification` | 2 reply actions present | 2 lines of `android.remoteInputHistory=null` |
  | drawn button labels vs the phone's `isReply` action title (step 49) | 6 of 6 rows leaking | the Mac's own Reply affordance shares the label *and* the CSS class |

  Two produced false absences and one a false presence, which is the point: the failure is not
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

