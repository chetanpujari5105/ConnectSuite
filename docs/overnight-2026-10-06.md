# Overnight engineering — 2026-10-05 → 06 (unsupervised; code, tests and documents only)

> **Finished 2026-10-06 ~03:30 IST.** The morning summary at the top of `docs/RESUME.md` points here;
> the feature matrix is `docs/release-readiness-2026-10-06.md`. Nothing in this file was run on the
> phone, on a live profile, or in the running Sidekick app. Every number below is from a JVM,
> `node --test`, a temporary directory, or a **synthetic renderer harness** (§ Harness) — this Mac,
> invented data, no link. **Sidekick is not ready to ship**; passing tests do not change that.

## Evidence log, one entry per change

### E1 — `CameraStreamTest` was timing-dependent (`148b93a`)

- **Repetition did not reproduce it:** 25/25 green under 12× `yes` CPU load.
- **Widening did:** a `Thread.sleep(150)` placed in `CameraStream.shutdown()` after the CAS — the
  stream still correct, `onClosed` still called exactly once, only later — turned **2 of 6** red.
  `isOpen` flips at the CAS, before `closeSocket()` and `onClosed()` run on the watcher thread; one
  test asserted the call count right after polling `!isOpen`, two others covered the gap with
  `sleep(50)` / `sleep(100)`, and the producer test used a 500 ms wall-clock bound.
- **Fix:** `CameraStream.awaitThreadsEnded(timeoutMs)` joins writer and watcher; every "exactly once"
  is counted after it. The producer test asserts the writer is still inside its first write when ten
  offers return (an offer that waited on the writer could only return after the gate's 5 s timeout).
- **Fixed tests:** green clean; green under the 150 ms widening; red under a double-`onClosed`
  mutation (3 of 6) and an offer-blocks-on-writer mutation (1 of 6). 20/20 under load.

### E2 — the pending Activity call-data rewrite could destroy unrelated rows (`87a8b29`)

The one-time rewrite added in `0555c3e` runs on the **next launch** of the Mac app and keeps no backup
(a backup would keep the numbers it removes). Reviewed with synthetic fixtures only:

| Found | Consequence |
|---|---|
| any unreadable line triggered a rewrite that deleted it | a hard quit's half-written *non-call* row was destroyed |
| every non-call row was re-serialised from parsed fields | any field this build does not read was silently dropped |
| a failed rewrite of `activity.jsonl.old` threw through `initAt` | the pane read "could not read" over a readable history; a `.rewrite` temp file was left behind |
| a file ending in a half-written line had the next event appended to it | the new event became unreadable too (masked until now by the over-eager rewrite) |

**Now:** call rows are rewritten under the rule; every other readable row is written back byte for
byte; an unreadable line is kept unless it may hold call data (mentions `calls`, or a 5+ digit run
outside `seq`/`at`); a failed rewrite is logged with its counts, its temp file removed, and the
history still returned. Red first 3 of 5; four mutations each red on exactly their test.

**Synthetic dry run at the real file's scale** (temporary directory, never the profile): 455 lines —
75 numbered call rows, 377 other rows, 3 broken lines → 75 rewritten, 1 broken call line dropped,
**379/379 non-call lines kept verbatim**, 0 numbers left on disk, 2.7 ms.

**What still needs approval:** the rewrite itself, which happens when the app is next launched. It is
irreversible by design. Two copies of older history are **outside** its reach and still hold numbers
if they exist: `logs/activity.jsonl.pre-migration` (the ConnectSuite merge's backup) and the
ConnectSuite folder's own `logs/activity.jsonl`. Neither was opened tonight.

### E3 — notification keys in logs (`98f8e3d`)

Android's key is `user|package|id|tag|uid`; WhatsApp's tag for a one-to-one chat is the contact's
JID (their number). Mac `nativeNotifier` logged it on **every cooldown decision**; Mac
`notifications` on a debug path; phone `NotificationRelay` on a failed dismiss. Both sides now log
`tag#<per-process salted hash>`. Red on both sides with the raw key restored.

### E4 — a failed contact lookup logged the number (`4b3159f`)

`ContactsStore.query` logged `Query on $uri failed: ${it.message}`; the lookup URI is
`…/phone_lookup/<number>` and Android's `SecurityException` repeats it. `ProviderLog.queryFailed`
cuts every `content://` URI after its first segment, in the URI and the message, keeping the
exception type. Red: raw line restored (1/3), redact made a no-op (2/3).

### E5 — SMS logs carried numbers (`0c8a9fe`)

Mac: `sms.send` refusals (`RECIPIENT_MISMATCH`, `SEND_FAILED` name numbers on purpose, for the
person) were logged whole, twice; now `code-only`, the sentence still reaches the pane. Phone:
`no provider row for $address`, and the mismatch line listing both number sets. New guards on both
sides; the phone scan found the mismatch line on its first run.

### E6 — notification reply/action refusals logged a contact's name (`840adc9`)

The wrong-conversation refusal quotes the conversation title. `tell()` gained `ask()`'s existing
`refusalLog`; `notif.reply` and `notif.action` log by code.

### E7 — step 70's `--require-correction` could never pass after `559f1da` (`2d23951`)

It read the number out of the correction line; the line no longer carries one, so the capture was
the word `arrived` and every reject would have been withheld. It now ties the correction to the
**one** inbound episode of the watch by call id, and refuses with a printed reason on zero or two.
9 fixtures, both line formats (the installed APK still writes the old one). Not run against a phone.

### E8 — defect 122: printed shortcuts that did nothing (`ff5245a`)

`⌘⇧.` and `⌘⇧T` were printed by the palette and bound to nothing. The palette's commands now become
a **Mirror** menu whose accelerators are the printed keys, running the palette's own `runCommand`;
the page-level `⌘⇧M` handler is removed (one owner). `⌘⇧4` is no longer printed — macOS takes it
first. Tests only; **not seen in the running app**, which was not relaunched.

### E9 — UI harness findings, part 1 (`af8df44`)

- **Files:** a crumb with no space in it (`Download/ConnectSuite`, the grant-free root every phone
  has) could not wrap and ran **56 px under "Send to phone…"** at 1100×700 and at 1.2× zoom. It now
  shrinks with an ellipsis and carries its full name as a tooltip only when clipped. Re-measured: ends
  10 px before the button.
- **Accessible names:** New-conversation recipient and message, Contacts search, both Settings address
  fields (placeholder-only) and the mirror canvas (focusable, forwards keys to the phone, no name).
- **Files sort headers** were 12 px-tall buttons; an `::after` grows the hit area to 24 px without
  moving the row (the harness measures the box, not the pseudo-element — an instrument limit).

### E10 — a refused call log was a blank column after six seconds (`213ae57`)

Measured with the phone refusing `call.log`: the reason was in a notice that hides itself at 6 s;
at 7 s the history column was empty and *Frequently called* still promised to read the log "once it
arrives". Now the refusal is pane state, drawn in the column with **Try again**; a refused re-read
keeps the earlier rows with "Showing the log as last read."

### E11 — the same gap in Messages (`05faea7`)

"Reading the phone's conversations…" stood forever over a refused `sms.threads`. Same fix. The sweep
that found both: every pane with the phone refusing, read again at 7 s for the refusal's text —
Files, Photos, Apps, Activity keep theirs; Clipboard's apparent "0 entries over a refused read" was
the harness's own fixture (`clip-history` is answered from the Mac's memory and cannot fail).

### E12 — Photos rebuilt every tile on every page, twice (`ae2be75`)

Synthetic 6,000-photo roll, paged 120 at a time as the pane does:

| tiles drawn | before: page ms / longest main-thread task | after |
|---:|---|---|
| 600 | 67 / 0 | 17 / 0 |
| 1,200 | 121 / 100 | 25 / 0 |
| 2,400 | 221 / 208 | 25 / 0 |
| 3,720 | 417 / 336 | 24 / 0 |

Pages now append in place (joining the last day's grid), thumbnails fill their tiles, a click moves
the highlight. A full draw still happens for anything else. Tested against a one-page draw of the same
items; two mutations red.

### E13 — a transfer progress tick rebuilt the Files listing (`654d400`)

Full Files render: **8.8 ms at 200 rows, 41.9 ms at 1,000** (median of 20, layout included). The phone
sends a tick up to 4/s per file (`PROGRESS_INTERVAL_MS = 250`), several files at once. A tick only moves
`delivered`, which only the send card reads, so it now redraws the card.

### E14 — the call banner's packaged-build gate had no test (`f6a2fa1`)

`callBannerEnabled()` is `!app.isPackaged && debugSwitches().callBanner`; now held by a test, red with
the packaged clause dropped. The banner stays development-only.

### Checked and left alone (recorded so nobody re-derives them)

- **Link teardown** (`link.ts`) rejects every pending request, clears timers, detaches its close
  listener and emits session-ended once. No change.
- **Per-pull listeners** (`files.ts`) are removed in a `finally`; the one await before it
  (`pullDestination`) cannot throw (`freeName` catches every `lstat`). No change.
- **The ConnectSuite → Sidekick Activity merge** keeps `activity.jsonl.pre-migration`. No change.
- **Sidebar at 700 px tall:** the Settings row is half under the account block, but the nav is its own
  scroll port and `⌘,` / the palette reach it. **Calls' dialler at 700 px:** *Frequently called* is in
  a scroll port too. Both reachable, neither stranded; recorded as compact-height density, not fixed.
- **File names** appear in many phone `fs` log lines. Metadata, not on the night's privacy list, and an
  existing design choice; a decision for the owner, not a silent change.

## Harness

`scratchpad/ui-harness/` (session scratch, not in the repository): a copy of `desktop/` without
`node_modules`/`dist`/`release`, compiled there; a throwaway Electron main with its **own userData
directory**, hidden windows, no debugging port, `app.dock.hide()`; a preload exposing a Proxy bridge
with invented data (fictional 555 numbers, made-up names, long labels on purpose). Each job injects an
instrument control (an overflowing box, an unnamed button, two overlapping buttons) and requires the
measurement to see all three — **every job passed its control**.

**Surfaces and viewports actually measured:** all 13 routed panes (Overview, Mirror, Files, Photos,
Messages, Notifications, Clipboard, Calls, Camera, Apps, Activity, Settings, Pairing) at
**1100×700, 1280×800, 1440×920, 1728×1117** and **1280×800 at 1.2× (View → Zoom In)**, dark and light,
with populated data; empty, disconnected and refusing data at 1100×700 and 1440×920 — **18 jobs, 234
pane renders**. Not measured: the floating mirror window, the share receive window, the palette and
dialogs open, Increase Contrast, VoiceOver itself (names were read from the DOM, not spoken), keyboard
traversal order, and any real phone data.

**After the fixes:** 0 unnamed controls, 0 placeholder-only fields, 0 overlapping controls, 0 clipped
controls, 0 page-level horizontal overflow across the 234. The 62 remaining "hard clips" are
intentional (visually-hidden labels; a two-line clamp on app names).

**Performance, x1 and x10 synthetic data, 1440×920:** every pane routes in ~17 ms at realistic sizes.
Remaining bottlenecks, measured and not changed: a notification change and an incoming SMS each
rebuild their whole list (~8 ms at 40 notifications / 60 threads, ~40 ms at 400 / 600); Apps' first
draw is ~90 ms at 1,230 apps; a full Files render is ~42 ms at 1,000 rows (now off the progress path).

## Final results (fresh, end of night)

| Suite | Result |
|---|---|
| Mac `npm test` | **1,779 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo** (baseline 1,751) |
| Mac typechecks (`tsc --noEmit`, app and test configs) | clean |
| Phone JVM, `./gradlew testDebugUnitTest --rerun-tasks` | **1,367 pass / 0 fail / 0 skipped** across app 188, camera 187, core 233, input 52, mirror 65, sync 642 (baseline 1,358); results < 1 min old when read |
| Guards: protocol spec, apps verb, renderer scripts/views, colour tokens, contrast, motion, debt claims, clip echo, orphan tests, versions, state vocabulary, suites-run, defects | all rc 0 |
| Fixture suites: `check-script-fixtures` 24/24, no-force-stop, target-device 17/17, adb-count 5/5, check-defects 5/5 | all pass |
| **Not run tonight** | Swift (`desktop/native/SidekickCamera`, 140 at last count); any device or emulator test |

**Flaky tests:** `CameraStreamTest` was the one reported; fixed deterministically (E1), 20/20 under
load afterwards. No other flake was seen in 12 full Mac runs and 2 fresh full phone runs (plus about a
dozen single-module runs) tonight — an absence over few runs, not evidence that none exist.

## Artifacts

**No distributable artifact was built.** No `.dmg`, no `.zip`, no APK, no `npm run build` in
`desktop/` (the running app loads `desktop/dist/`, which is untouched). The only build was the scratch
compile inside the session scratchpad, used by the harness and never launched as Sidekick.

## What needs approval or hands next

1. **Installing the phone build** — carries `559f1da`, `98f8e3d`, `4b3159f`, `0c8a9fe` (logs without
   numbers or names). Approval for `adb install -r` on the SM-S938B via `scripts/adb-pinned.sh`, then
   start `LinkService` by name and confirm with `scripts/link-up.sh` (CLAUDE.md: `-r` leaves the phone
   serverless).
2. **Rebuilding and relaunching the Mac app** — and with it, **the one-time Activity call-data
   rewrite runs** (E2). It is irreversible by design. If the older copies outside its reach
   (`activity.jsonl.pre-migration`, the ConnectSuite folder's `activity.jsonl`) should also lose their
   numbers, that is a separate decision about your files.
3. **A supervised look at the UI changes in the real window** — they are proven in a synthetic harness
   only.
4. **Defect 30** — one consenting SMS to a number with no thread.
5. **Defect 137** — a supervised read of `ExternalStorageProvider`'s log around one probe run.
6. **Release decisions** — `SHARE_V3_RELEASE`, `SHARE_WAIT_RELEASE`, `FS_BLOCKS_RELEASE`, the app icon
   (D4), and signing (Apple Developer Program, a release keystore). None can be done unsupervised.

## Supervised release-verification plan (step by step)

1. **Pin the phone.** `scripts/target-device.sh` must name the SM-S938B; every write goes through
   `scripts/adb-pinned.sh`.
2. **Back up what the Mac rewrite will touch, if wanted** — your decision (E2): copy the profile's
   `logs/` somewhere private *before* the relaunch; the rewrite itself keeps no backup on purpose.
3. **Build the Mac app** (`npm run build` in `desktop/`), then quit the running Sidekick through its
   menu and relaunch with `--force-renderer-accessibility --remote-debugging-port=9222`. Read the log
   for `Rewrote activity.jsonl: N call row(s)… / M line(s) kept` and confirm `N` and `M` against the
   row count you expect (the dry run on synthetic data: 75 rewritten, 379/379 others kept).
4. **Install the phone build**, start `MainActivity` by name, run `scripts/link-up.sh` until three OKs.
5. **Privacy check on hardware** — receive one WhatsApp notification and one SMS, make and end one
   call; then read both logs for any 6+ digit run that is not a timestamp, counter or size. Control:
   the same grep must find the call id and the `[notif]` package line you just caused.
6. **The UI changes, by name over CDP** (`scripts/probe.mjs`): Files at 1100 wide with
   `Download/ConnectSuite` open (crumb ends before *Send to phone…*); `⌘⇧.` and `⌘⇧T` from the Mirror
   menu; the canvas and fields announce names (VoiceOver once).
7. **A refused call log** — revoke Phone / Call logs on the phone, open Calls: the column must say why
   and offer *Try again*; re-grant, press it, rows return. Same for Messages with SMS permission.
8. **Photos at depth** — scroll a long album 20+ pages; time a page append in DevTools' Performance
   panel; compare with E12's harness numbers, which are not the phone's.
9. **Defect 30** and **step 70** (`scripts/step70-watch.mjs --require-correction`, now id-based) only
   with a second person and their consent.
10. Record every reading with its control in `docs/testing.md`; only then reconsider the matrix.

## Confirmation

No live profile was read, migrated or rewritten; no Activity history, log, backup or profile of yours
was opened. No phone action, ADB command, install, call, capture, camera, microphone or screen
recording. No Bluetooth, pairing, routing, permission or system-setting change. Nothing installed,
purchased, signed, notarized, pushed, published or released. The running Sidekick (pid 91450, started
12:51) was not relaunched, attached to or driven; `desktop/dist/` was not rebuilt. Your uncommitted
edits (`PRODUCT.md`, `docs/RESUME.md`'s body, `docs/testing.md`, `camera-*.md`, `SidekickCamera/README.md`,
`skills-lock.json`) and untracked files were not staged, stashed or changed.
