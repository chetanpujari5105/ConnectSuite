# Camera hardening overnight — 2026-10-03 (00:00–12:55 IST, unattended): tests only

**Nothing in this report is hardware-verified, and Camera is not release-ready.** No device, app or
artifact was touched: no `adb` command reached a device, no install, no camera request, no relaunch, no
push. The historical results stay as recorded: the 22:38 batch (case A NO READING; B, C, D NOT RUN), the
22:53 retry (NO READING) and the 23:14 timed-Home attempt (scripted procedure NO READING).

Evidence for every line below: `docs/testing.md` → *Camera hardening overnight — 2026-10-03*. Register:
`docs/defects.md` rows 169–176.

## Commits (local, on `clipboard-watcher-and-phase-5-close`, not pushed)

| Commit | Task | Scope |
|---|---|---|
| `29386f3` | 1 — consent, permission, lifecycle | defects **169, 170, 171** (phone): `CameraHostCore` (new), the deadline on approve/permission, the request route decided before the ack; 3 new test files; `docs/protocol.md` → `camera.request` |
| `9dbb8ab` | 2 — transport and frame pipeline | defects **172, 173** (Mac): drawn-based stall and per-frame outcomes, no connection without an identity; real-TLS `cameraTransport.test.ts`, painter tests, reader fuzz, the phone's stream over real TCP; `docs/protocol.md` → the camera frame |
| `2ddfd33` | 3 — truthful states and logging | defects **174, 175, 176** (both sides): who ended the session, asking again after a cancel, the phone's milestone lines; `cameraWiring.test.ts` |
| `4164d96` | 4 — the driver as tooling | `scripts/camera-driver-core.mjs`, `scripts/camera-driver.mjs` and their fixtures; r1–r6 kept under `docs/evidence/camera-v1-drivers/` |
| *(this file's commit)* | handoff | this report |

## Implemented (tests only)

| # | What was wrong | Now |
|---|---|---|
| 169 | A camera could bind after its stream ended (the bind check read the published UI state, which trails the machine) | generation ticket + the machine's exact stream-and-epoch check; released once, with a tally |
| 170 | A Start tap or permission answer after the 30 s deadline, before the timer ran, opened the camera | judged on the clock; ends as `expired`. Expiry unchanged at 30 s |
| 171 | The ack claimed a notification Android would drop (only the permission was checked) | route `SCREEN` / `NOTIFICATION` / `NONE` decided first; truthful sentence; each outcome logged |
| 172 | Frames the page could not draw were invisible; a frozen picture stayed "Live" | ack carries stream + outcome; size-mismatched pixels not drawn; stall from the newest drawn frame's arrival; counts by cause |
| 173 | No phone identity → still connected and handshook | no connection at all; errors handled for the socket's life |
| 174 | A Disconnect on this Mac read "Your phone disconnected" (the predicted case D failure) | `disconnected-here` vs a cause-free `disconnected`; the phone's sentence names no cause either |
| 175 | Asking again right after cancelling an in-flight request was refused as busy | waits for the earlier request's ack and withdrawal |
| 176 | The phone logged nothing when a stream went live or a switch took effect | exact milestone lines; Decline, permission and the phone's Switch logged |

Also, no defect found: the frame reader (400 seeded splits, 2,000 hostile inputs), the phone's stream
socket over real TCP, and the Camera bridge's completeness end to end. Unchanged by design: 960 × 720,
foreground-only, no microphone, recording, snapshots, background start or webcam.

## Fresh numbers at the end (12:48–12:55)

- **Mac** `npm test`: **1,543 / 0** (from 1,504). `tsc --noEmit` app and test: 0.
- **Phone** `testDebugUnitTest --rerun-tasks`: **1,248 / 0** (from 1,207; camera-module 67 → 108), all 127
  result files written by that run, Gradle exit 0.
- **Script fixtures**: 23 of 23 suites green (two new: 31 + 6 fixtures).
- **All 16 commit hooks** allow; `check-defects` 160 rows, all with records.
- **Builds**: the Mac app built in a scratch copy (`tsc` 0, 260 files); the debug APK assembled into
  `app/build` (`98187d17…`), **not installed**.

## Mutations — 40 run, 39 red, 1 survived

Each restored and SHA-256-verified; Gradle verdicts only from result files newer than the run, Node
verdicts with a per-test timeout.

- Task 1: P169-A, C red; **P169-B red on its isolating test** (the pending-switch case is held by both
  guards); P170-A, B, C; P171-A, B, C, D.
- Task 2: M172-A…H; M173-A (its first run's second red was *my harness*, not the mutant — corrected in
  the record); PS-A, PS-B (the phone's stream over real TCP).
- Task 3: MW-A, MW-B (the bridge check can fail); M174-A, B, C; P174-A; M175-A, C (C's first run hung the
  runner 600 s; the restore was verified by content, then it was re-run with a per-test timeout); P176-A, B.
  **M175-B survives**: `LinkClient.request` writes synchronously on one ordered connection, so awaiting the
  withdrawal matters only for a phone that handles control messages concurrently.
- Task 4: D-B…D-I, including **D-H: the phone's source reworded**, caught by the line-contract fixture.
- Red-first against the code before each fix: 170 (the camera opened for an expired request); 172 (17 of
  59 against HEAD's two camera files); 174 (3); 175 (2); the phone sentence (1).

## Actual coverage, and the boundary of each

| Reached for real | Mocked or source-only — not reached |
|---|---|
| The machine's rules, `CameraHostCore` against the real machine, the route and delivery decisions, the milestone lines | CameraX, the main thread's `Handler` order, `runOnUiThread`, `NotificationManager` (a recorder backend and source scans) |
| The Mac's `openCameraSocket`, pin and claim over **real TLS 1.3 on loopback** with per-run certificates; the production controller and reader end to end on that socket | The phone's TLS and claim parser: a Node TLS server plays the phone. The two halves have only met on hardware |
| The phone's `CameraStream` over **real loopback TCP** (FIN, RST, a stray byte, local close) | TLS on the phone (Keystore identity under `LinkServer`) |
| The painter's decisions with a hand-released decoder and fake bitmaps | `createImageBitmap`, a real canvas, real JPEG bytes |
| The bridge's completeness, as source | Electron IPC running |
| The driver core under every recorded fault, the CLI's refusals with a recording fake `adb` | `adb`, `run-as`, `tail -c`, CDP and the pane's DOM: **the CLI has never run against a device** |

Two races were exercised in one order only, and the records say so: the phone stream's local close won
200 of 200 runs (the FIN/RST tests cover the other order); the driver's deadline race was widened until
both orders occurred.

## Protected work — verified unchanged at the end

- `PRODUCT.md`, `skills-lock.json`, `docs/RESUME.md`, `docs/camera-v1.md`: byte-identical to the start.
- `docs/testing.md`: the start-of-night file is an unchanged prefix; only the four sections were appended,
  and each commit staged HEAD plus its own section — never the owner's block.
- The index holds nothing staged; the unstaged remainder is the owner's original +884 / −6.
- 76 untracked entries (23 files, 53 links): identical hashes and targets.
- The running Mac app (pid 39218) and its `dist` (`f3742ea7…`): not rebuilt, not relaunched.
- All 65 live Mac artifacts — the paused partial (100,663,296 B, inode 88373242), its record, the
  `(7).bin.failed` marker, `sidekick.json`, the identity — identical in hash, size, mtime and inode.
- The phone: no `adb` command was issued against it. The CLI fixture ran `adb-pinned.sh` once with a
  recording fake `adb` (via `CONNECTSUITE_ADB`), and neither pin script calls `adb` directly.

## Unresolved, and what needs the owner

- **No hardware reading of any of this.** The smallest batch is below.
- **The raw outputs of the 2026-10-02 runs live only in `/tmp`** (`…/7cdb5592-…/scratchpad/r2–r6`). The
  driver sources are now in the repo; the outputs are not, by choice (device dumps), and are listed with
  hashes in `docs/evidence/camera-v1-drivers/scratch-manifest.sha256`. Whether to keep them is yours.
- Whether to commit `docs/RESUME.md`, `docs/camera-v1.md` and your `docs/testing.md` block (all still
  uncommitted, as you left them).
- Observed again, not changed: `defects-in-sync.sh` (scoped to `git commit`) denied a non-commit command
  carrying a heredoc while the register was briefly out of step.
- Not pushed.

## The smallest supervised hardware batch still needed

Approvals first: install `4164d96`'s debug APK (`98187d17…`) and rebuild + relaunch the Mac app.

1. **One plain session** — `node scripts/camera-driver.mjs --dry-run --case plain`, then
   `--execute --case plain --report <new file> --owner-present`. You tap Start camera; the Mac's Stop (or
   the 20 s cap) ends it. Reads: 171's *request screen opened over Sidekick*; 176's *running: first frame
   …*; 169's *Camera released (closed) … 1 released of 1 bound*; 172's `received, drawn, not drawn` line.
2. **Case D** — one session, then the tray's Disconnect while live. Reads 174 on both screens: the Mac
   *"You disconnected this Mac…"*, the phone *"The connection to the Mac ended…"*.
3. *Optional:* one request with Sidekick **not** in front (no setting changed) for 171's *notification
   posted* line and its sentence on the Mac. The `NONE` route needs notifications switched off — a
   settings change that needs its own approval; not proposed.
4. *Optional:* case A again with `--case home`, nobody touching the phone after Start camera, if the
   scripted Home itself is to be shown.

Not reachable on hardware on demand, and staying tests-only: 170 (a timer later than a tap), 173 (a
session with no pinned identity), 175 (a cancel inside one round trip), and 169's race.

## Supervised follow-up — 2026-10-03, 13:07–14:22 IST

The update above was installed and verified, and the driver was validated read-only. **Session 1 is a NO
READING:** the phone was asleep at the driver's gate, so no request was sent. Session 2 did not run. Record:
`docs/testing.md` → *Camera supervised sessions — 2026-10-03*; handoff at the top of `docs/RESUME.md`.

**Second Session 1 attempt, 15:09 IST:** 11 of 12 pre-registered bounds met. The phone's `stopped` line took
the close-first route (`STREAM_CLOSED`, re-attributed to `STOPPED_BY_MAC`). Session 2 is held for the owner.
Record: `docs/testing.md` → *Camera Session 1, second attempt*.

**Session 2 (case D), 15:59 IST: NO READING.** The actor's tray AppleScript failed to compile (`its` is
reserved), so no Disconnect happened and the 20 s cap stopped capture. There was no retry. Record:
`docs/testing.md` → *Camera Session 2, case D*.
