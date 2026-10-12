# PC-only audit — 2026-10-07, 16:05–16:40 IST (phone disconnected, owner resting)

Repository inspection, offline tests and guards, and documentation reconciliation only. **No phone command,
ADB, install, relaunch, CDP attach, IPC call, clipboard read or write, transfer, pairing or settings change.**
No source, manifest or build file was edited. Nothing was committed.

This is **not** a full audit and nothing here says the product is ready: every hardware-only item in §7 is still
open, defect 199 is **not** closed, and no soak was run — the disconnected interval is not one.

## 1. Revisions — audited source versus what is deployed

| | Revision | Evidence |
|---|---|---|
| Source audited | branch `clipboard-watcher-and-phase-5-close`, HEAD **`ccc185d`** | `git rev-parse HEAD` at 16:05:45 |
| Mac, running | development `desktop/dist` from **`bf096e1`** (manifest `0c074f7d…2f29`), PID **88287**, started 10:39:53 with `--force-renderer-accessibility --remote-debugging-port=9222` | `ps` at 16:3x (unchanged); `docs/testing.md` → *Mac update A* |
| Phone, installed | debug APK from **`c05efcc`** (`0d42e27d…0af6`), user 0, installed 13:56:08 | `docs/testing.md` → *Install B* (not re-read: no phone) |
| HEAD vs Mac | HEAD adds only defect 200's quit coordinator: `desktop/src/main/{main,quitCoordinator,webcamSpike,webcamWiring}.ts` + tests (7 files) | `git diff --name-only bf096e1 HEAD -- desktop/src` |
| HEAD vs phone | **identical** for every phone module and Gradle file | `git diff --stat c05efcc HEAD -- app core sync-module mirror-module input-module camera-module build.gradle.kts settings.gradle.kts gradle` → empty |

So: every Mac finding below applies to the running app except defect 200's fix (not running); every phone finding
applies to the installed build.

Tools: Node v24.14.1, npm 11.11.0, JDK 21.0.10 (Android Studio JBR), Gradle wrapper (offline).

## 2. Checks run (all against HEAD `ccc185d`, working tree with the owner's uncommitted doc edits)

| Check | Command | Result | Duration |
|---|---|---|---|
| Mac unit/integration | `npm test` in `desktop/` | **1,964 / 0** (0 skipped, 0 cancelled), exit 0; `.test-run.json` written 10:41:34Z (=16:11:34 IST), `green: true` | 87 s |
| Mac typecheck | `npm run typecheck` | exit 0 | 2 s |
| Phone JVM | `./gradlew testDebugUnitTest --offline --rerun-tasks --no-build-cache` | **1,454 / 0**, 0 errors, 0 skipped; 138 tasks executed; 153 result files, **0 older than the run**. core 276, app 206, sync-module 668, camera-module 187, mirror-module 65, input-module 52 | 3 m 59 s |
| Guards | every `scripts/check-*.mjs` (14) + `scripts/check-defects.sh` | **all exit 0**; `check-script-fixtures`: 24 of 24 fixture suites green (floor 12) | ~50 s |
| Hook fixtures | `scripts/hooks/no-force-stop.test.sh`, `no-release-signing.test.sh` | all fixtures pass | <1 s |
| Swift (`SidekickCamera`) | — | **NOT RUN** — camera module, outside this audit's scope; it rebuilds `.build/` | — |
| Lint | — | **NOT RUN** — no lint command is configured in either build | — |
| Release / packaged builds | — | **NOT RUN** — not needed for the audit; would write `release/` and is a deployment-shaped action | — |

**Side-effect controls.** Before running: the Mac tests use per-test `mkdtemp` `userData` and loopback only; the
webcam bridge test spawns the debug bridge binary (as every previous run did); the fixture suites use a fake
`adb` (`CONNECTSUITE_ADB`) and refuse before CDP. After running: `git status --porcelain` identical to the
pre-run snapshot, and SHA-256 of all 10 owner-modified files unchanged. The phone counts equal defect 199's
recorded 1,454 — expected, since no phone code changed after `c05efcc`.

**Live app, read-only:** PID 88287 still running since 10:39:53; stored `watchClipboard = False`
(`sidekick.json`, that one key read; file last modified 16:02:02, before this session). No CDP, no IPC.

## 3. Findings

Severity is about practical impact on this product. "Confirmed" means the code was read and the behaviour
follows from it (or the repo already holds a reading); "suspicion" means it was not demonstrated.

### F1 · Medium · confirmed — every non-connected status tick re-runs eight disconnect clears, each logging, and this rotates evidence out of the Mac log

`desktop/src/main/main.ts:1849-1861` runs `notifications.clear()`, `contacts.clear()`, `clip.clear()`,
`photos.clear()`, `clearPreviews()`, `apps.clear()`, `remote.clear()`, `sms.clear()`, `calls.clear()` on **every**
status event whose phase is not `connected` — not on the transition. Several log unconditionally
(`clipboard.ts:503` *"Cleared 0 clipboard entries: the link dropped"*, `contacts.ts:162`, `sms.ts:364`,
`notifications.ts:148`, `calls.ts:244`, `remote.ts:150`). Each retry cycle is several status events.

**Already observed, not hypothetical:** Install B (`docs/testing.md`) records the Mac's 11:18:41–13:38:01 outage
(274 attempts) writing *"~825 lines per pane over the gap"*, and the same record notes *"the Mac watcher's
start/stop lines had rotated out of both logs"* — the log is 512 KB + one rotated file (`logger.ts:11`).

**Why it matters now:** the six-hour soak (§7) depends on log evidence. A Mac-side outage of an hour or two during
the soak can rotate away the soak's own start lines on the Mac. No data is lost or harmed; diagnostics are.

**Reproduction (no device):** in an isolated copy, drive the status handler with `connected → connecting →
connecting → idle` and count `Cleared` lines: expect 8+ per non-connected event today, 8 once with the fix.

**Smallest fix (not applied):** run the block only on the transition out of `connected`:

```diff
--- desktop/src/main/main.ts (proposal, NOT applied)
+    const wasConnected = lastStatus?.phase === 'connected';   // read BEFORE `lastStatus = status`
     notifierWasConnected = status.phase === 'connected';
     lastStatus = status;
 …
-    if (status.phase !== 'connected') {
+    if (status.phase !== 'connected' && wasConnected) {
       notifications.clear();
```

Caveat to check first: whether anything can be populated while not connected (a late ack landing after the
drop). If so, keep the clears per tick and instead make each `clear()` log only when it removed something.
**Verification:** extract the predicate into `src/shared/` with a red-first test (connected→connecting clears
once; connecting→connecting does not); Mac suite; on hardware the C-step-3 Wi-Fi off/on gives exactly one set of
`Cleared` lines per outage.

### F2 · Medium (disclosure accuracy) · confirmed — the privacy draft says logs hold "lengths, counts and states"; both apps log transferred file names, and the Mac's Activity file keeps names and opened link hosts

`docs/privacy-and-distribution-2026-10-07.md:27` (draft): *"Lengths, counts and states — no message, clipboard or
file content by design."* The code logs **file names** on both sides — Mac `main.ts:2786-2790`
(`${original}: hashed …`), `main.ts:2813` (`… already exists on the phone`), `bulk.ts:539`, `bulk.ts:547`, the CSV export path (`main.ts:2663`);
phone `DownloadsStore.kt:241-330` (9 lines with `$name`), `BulkTransfers.kt:400`, `SafTreeStore.kt` (2). The Mac's
persistent `activity.jsonl` records file names (`'Sent to phone'`, `'Saved to Mac'`) and, on a user's **Open** of a
clipboard link, the link's **host** (`main.ts:2575`: `activity.record('clipboard', 'Opened a link', new
URL(url).host)`) — a piece of clipboard content written to disk, which the clipboard proposal's §6 storage rule
("no clipboard text in any log line") does not anticipate for the Activity store.

Not a leak off the device (nothing is uploaded), and file names are not file *content*. But a disclosure draft
that is narrower than the code is the defect-63 shape. **Fix (docs, not applied to the draft's sentence):** say
"file names" in the logs and Activity rows, and decide whether an opened link's host belongs in Activity (the
smallest code fix is to record `'Opened a link'` with no detail). A dated note pointing here was added under the
draft's table; the owner decides the wording.

### F3 · Low · confirmed residual — Restore's newer-content check and its write are two calls

`desktop/src/main/clipboard.ts:324-333`: `clipboard.readText() !== replacedBy` then `clipboard.writeText(item.text)`.
Both are synchronous in one tick, so the window is microseconds, but another process can write the pasteboard in
between and Restore would overwrite it. Electron exposes no `changeCount`, so there is no compare-and-swap. Also
the guard compares **plain text only**: if the user has since copied rich content (or an image with a text
representation) whose plain text equals the replaced entry, Restore overwrites the rich content. Hardware
evidence for the guard itself is good (15:30:39 refusal, clipboard kept). **Recommendation:** record as an
accepted residual in the S7 section of `docs/protocol.md`; a real fix needs a native `NSPasteboard.changeCount`
helper, which is not proportionate.

### F4 · Low · confirmed — the PROCESS_TEXT cause was stated as established in one record

`docs/testing.md` → *Stage D resumed … 14:51–15:19* said the toolbar route was *"BLOCKED, by configuration rather
than dispatch"* and that *"One UI's per-app selection-menu filter (Manage apps) is hiding it here."* The evidence
is: 13 `PROCESS_TEXT` resolvers for user 0 including Sidekick (registration), and *Send to Mac* absent from the
enumerated Keep toolbar and its overflow. That does not separate a One UI per-app filter from the menu Keep itself
builds, an ordering/overflow limit, or a filter state set earlier. The later 15:23 record already says *"cause not
established"*. Further against the stated cause: on **2026-09-04 (Phase 7 Slice 21) Keep raised the platform
toolbar and delivered from it** (`CLAUDE.md` → Platform walls), so the same app behaved differently five weeks apart
and nothing recorded today separates what changed. **Corrected** by a dated note in place (§5). The 14:19 owner send shows the route *can* dispatch
somewhere; it was not a supervised step.

### F5 · Informational · confirmed — the native-banner refusal explanation is supported for the development build only

Development: `addRequest not allowed: com.github.Electron` (stage D 01:13) and Phase 7 Slice 13 / defect 81
(2026-09-03: dev run refused; **an older packaged *ConnectSuite* build posted with 0 refusals**). For the
**current** packaged Sidekick (`bf096e1` artifact, fuses flipped, different name and bundle) there is **no
reading**, and "posted with 0 refusals" was never "a banner displayed and clicked". So packaging is the
documented route, not a demonstrated fix. Note also `offerBannerGuidance` (`clipOfferNotifier.ts:61`) tells a
development user "This development build cannot show notifications" — consistent with the September reading.
Separately, the doc table in `clipOfferNotifier.ts:25` defines `withdrawn` as "its offer ended", while a click also
counts as `withdrawn` (`:97`, asserted by `clipOfferNotifier.test.ts:151`). Intended; only the comment is loose.

### F6 · Low · suspicion — `fs-send` for the same source twice keeps only the second abort handle

`main.ts:2771`: `sendHashes.set(options.source, abort)` overwrites an in-flight entry for the same source, so
*Stop* during hashing reaches only the later call. The renderer de-duplicates by source (`files.ts:570`) and a
batch refuses to start while one is unsettled (`files.ts:605`), so this needs a renderer misbehaving or a
second window. Not reproduced. A second identical send would arrive as `name (2)` (no overwrite — `TARGET_STALE`
is honoured), so no data is harmed. **Fix if wanted:** refuse an `fs-send` whose source is already in
`sendHashes`.

### F7 · Coverage gap — the six-hour soak, as planned, cannot discriminate the fix from the old build

Defect 199's plan item 2 passes on *no new exit record after > 6 h backgrounded, every claim `0x10`*. On the
**old** build the crash needed a `USER` claim (`0x11`) with **no** later narrowing claim (the 23:57 re-pair); an
ordinary `MainActivity` open is followed within a millisecond by the capability refresh's `UNKNOWN` `0x10` claim
(`docs/evidence/fgs-timeout-2026-10-07/README.md`), so the old build would also have survived the planned
stimulus. The soak is therefore an **endurance and regression** check of the installed build, not proof that
199's cause is removed. The discriminating evidence that exists is static and already recorded at install B:
`FOREGROUND_SERVICE_DATA_SYNC` declared **0** times, `LinkService` `foregroundServiceType` `0x10`. The dynamic
discriminator is the emulator control (plan item 1). §7 states this in the soak's pass criteria.

### Areas checked with no material finding (with the evidence relied on)

- **Clipboard provenance and offers** — `clipOffers.ts:19-21` applies only `origin === 'clipboard'`; offers capped
  at 5, 10 min, session-bound, single-use (`:93-103`); Dismiss, expiry, disconnect never write
  (`clipboard.ts:274-312`, `:495-504`); an ended offer has no Copy or Open (`renderer/clipboard.ts:780-806`);
  the renderer never sends offer text (`clipboardView.test.ts:525`). Hardware: stage D 15:23–15:35.
- **URL handling** — no automatic opening anywhere: the only `openExternal` is `clip-open` (`main.ts:2565-2577`),
  user click only, re-decided in main by `openableUrl` (http/https, whole string, ≤ 2,048 chars, no whitespace).
- **Watcher-off enforcement** — the watcher starts only at startup when `watchClipboard` is stored true
  (`main.ts:2085`) or by the toggle (`:2439`); no other `clipWatcher.start` call site.
- **Focus sync** — every exit named (`FocusSync.kt`); `NO_LINK` counts nothing as sent; `UNCHANGED` / `ECHO`
  de-duplicate; focus re-checked after the read (`ClipFeature.kt:633-640`). Phone history cleared when the last
  session ends (`:188-193`, `:220-231`); Mac history and offers cleared on drop (`clipboard.ts:495-504`).
- **Selection routes** — `SendSelectionActivity.kt`: both extras read as `CharSequence`; restored instance never
  re-sends (`:58-62`); stream-bearing shares go to the file sheet; referrer never logged.
- **Android service (defect 199 fix)** — every reason maps to `connectedDevice` (`LinkAutoStart.kt`,
  `foregroundTypesFor`); `dataSync` absent from all manifests (only remaining mention is `LinkTimeout.typeName`'s
  label); USER starts call `LinkService.start` directly (`MainActivity.kt:53`, `LinkRoute.kt:171,235`,
  `OnboardingScreen.kt:333`), so the timeout hold (`ensureRunning`'s gate) can only hold automatic routes and
  a person can always restart; `onTimeout` stops first (`LinkTimeout.kt`). `MirrorService` keeps its own
  `mediaProjection` type; `ConnectionService` is `connectedDevice`. Not reachable by any test: the platform
  timer and `onTimeout` delivery (as the register says).
- **Native drop** — Cancel is both `defaultId` and `cancelId` (`main.ts:2702`), so Return and Escape cancel; one
  sheet at a time (`:2684`); grants bound to window, `dev`/`ino`, one hour (`sourceGrants.ts`); `fs-send` re-stats
  and checks before opening a byte (`main.ts:2763-2769`). **Return-cancels on a real sheet is unproven.**
- **Transfer integrity and cleanup** — Mac partials use the Sidekick-only suffix `.<name>.sidekick-pull.part`
  (`transferFiles.ts:54`, defect 151) and every delete targets that path or an app-written `.failed` marker
  (`bulk.ts:743`, `:755`, `:769-775`); publish is an exclusive hard link or `COPYFILE_EXCL` (`bulk.ts:734-758`, defect 150), so
  cleanup cannot delete a published file; the documented residual race is in `bulk.ts:938-962` (the share route's own partial). Phone push never
  overwrites (`TARGET_STALE`), deletes are named (`FsDeleteGuardTest`). Inventory:
  `docs/transfer-integrity-inventory-2026-10-07.md` (and 187: no check above 64 MiB without `fs.blocks`).
- **Debug paths** — Mac development switches and the share auto-accept allowlist are forced off when packaged
  (`main.ts:1165-1167`, `:253`, `:1130`); the live launch had 0 `CONNECTSUITE_*` variables. Phone probes are in
  `app/src/debug` only and exported only behind `android.permission.DUMP` or a narrowed SEND filter (defect 152,
  `DebugProbeGateTest`) — note the installed build **is** a debug APK, so these exist on the owner's phone in
  that gated form.
- **Quit coordinator (defect 200, not deployed)** — idle quit is not held; held quit bounded at 10 s, teardown once,
  re-issue once (`quitCoordinator.ts`). No defect found; Electron's real exit remains unreached by tests.

## 4. Evidence reconciliation (§2 of the brief)

| Distinction the record must keep | State in the docs before this audit | Action |
|---|---|---|
| `ACTION_SEND` Share route passed | correct (01:13 on old builds; 15:17, 15:27, 15:31 on deployed) | none |
| `PROCESS_TEXT` unavailable in observed Keep toolbar; cause not established | the 14:51 record asserted a cause (F4) | dated correction note added |
| Restore-over-newer refusal passed | correct (15:30:39) | none |
| Dismiss without mutation passed | correct (15:32:12) | none |
| Focus sync on a HOT resume, not a cold start | the section says HOT; the *Stage D overall* line said "one focus sync" without it | qualifier added to the overall line |
| USER reclaim and `types=0x10` observed | correct (14:18:43 owner open; 15:33:51) | none |
| Notification guidance/counters passed; banner display and click did not | correct | none |
| *Stage D overall* mixes two build pairs | Copy, duplicate-Copy refusal and a successful Restore passed only on `4661015`/`286e2b0` (01:11–01:42); not re-run on `bf096e1`/`c05efcc` | qualifier added |
| Foreground-start check "before 14:35" vs the owner's 14:18:43 open | not contradictory but unexplained: `LinkService` "created about 18 min earlier" puts the reading at ≈14:14, before the open | dated clarification added |
| Register says "not installed" for 182, 183, 185, 189, 190, 191 (rewrite "not run"), 192–198 | stale: all are in the deployed builds (verified with `git merge-base --is-ancestor`); 191's rewrite ran at A3 | dated deployment notes appended to each row; original text kept |
| Release tracker: S1, S2, R-199 "not installed"; row 16 "stage D PARTIAL"; decision "install `bf096e1` before resuming stage D" | stale | dated notes appended |
| Defect 199 | **not closed**; correct | none |

**Background interval for defect 199, from existing evidence only.** The only interval with both ends observed and
Sidekick known not to be in the foreground is **13:56:09 → ≈14:14** (install B's automatic restart, no Activity;
then the pre-check reading `MainActivity` not running, `LinkService` `types=0x10`, latest exit record the 13:56:08
`PACKAGE UPDATED`) — about **18 minutes**. Between the owner's 14:18:43 open and the 15:33:51 HOT resume the
`LinkService` read `0x10` with no new exit record at 15:19 and 15:33, but when Sidekick left the foreground after
14:18:43 was not recorded, so no start time is claimed. After 15:35 there is **no reading**; the disconnected,
resting interval is not evidence of anything.

## 5. Files created or changed by this audit

| File | Change |
|---|---|
| `docs/pc-only-audit-2026-10-07.md` | **created** (this report) |
| `docs/testing.md` | insertions only: three dated audit notes in the 2026-10-07 sections, and a link to this report at the end. The owner's uncommitted content is untouched (verified by diff against a pre-edit copy: additions only) |
| `docs/defects.md` | insertions only: a dated *Deployed* note inside the status cells of 182, 183, 185, 189–198 |
| `docs/release-tracker.md` | insertions only: dated notes on S1/182, S2/178, R-199, row 16 and the 2026-10-07 decision line |
| `docs/privacy-and-distribution-2026-10-07.md` | insertion only: one dated note under the data-flow table pointing to F2 |

Not changed: any source, manifest, Gradle or package file; `docs/RESUME.md`; the verification plan; any
evidence file. Nothing committed. Scratch (session scratchpad, outside the repo): status and hash snapshots,
test outputs, pre-edit copies.

## 6. Preservation summary

- **Backups:** `~/.connectsuite-evidence-private/` — directory names listed only (three folders); contents not
  opened, hashed or changed. The Activity backup reminder still stands (end of stage G or 2026-10-13).
- **Personal data:** no clipboard, notes, browser data, photos, Downloads or unrelated directories read. One key
  read from the app's `sidekick.json` (`watchClipboard`). No environment, token, key or fingerprint printed.
- **Deployment:** the live Mac app (PID 88287) not touched — no CDP, IPC, relaunch, `dist` rebuild. Phone not
  contacted. No second app instance. Owner's 10 modified files: hashes identical after the test runs; the four
  docs listed in §5 then received insertions only.

## 7. Remaining device session — shortest ordered checklist (nothing below has started)

Every step needs the owner present and its own go-ahead. Pin every phone write through `scripts/adb-pinned.sh`.

**0. Fresh preflight (read-only).** `scripts/target-device.sh samsung` → `RZCY12330DT`; current user 0; installed
`base.apk` pulled and hashed = `0d42e27d…0af6`; `dumpsys activity exit-info` newest record (expect 13:56:08.525
`PACKAGE UPDATED`, or note anything newer **before** doing anything else — a newer one is a finding about the
resting interval); `dumpsys activity services` `LinkService` `isForeground` and `types`; `scripts/link-up.sh`
three OKs and its `createTime`; Mac: PID 88287 alive, `ipconfig getsummary en0` (not `ifconfig`), stored
`watchClipboard False` and live `watching=false`, `pairing: 2`. Owner confirms harmless text on both clipboards.

**1. Six-hour background soak (defect 199 plan item 2).**
- *Baseline, observed:* record exit-info newest record, `LinkService` `types` and `createTime`, phone `link.log`
  line count, every `Foreground … claimed` line so far, Mac log line count. Then the owner leaves Sidekick (Home),
  and the **background transition is read**, not assumed: `dumpsys activity activities` top resumed is not
  Sidekick; record that time as T0.
- *Allowed during:* ordinary phone use in other apps, locking, Doze; the Mac awake and on the same network.
  *Not allowed:* opening Sidekick on the phone, any `am start`, install, force-stop, reboot, Wi-Fi changes, the
  clipboard watcher.
- *Interruption rules:* Sidekick opened, the app updated, or the phone rebooted → the interval ends there; record
  it as partial and restart from a new observed T0. A Mac-side disconnect is recorded with times, is **not** a
  failure, and does not end the interval (the claim is about the phone's process) — but read F1 first: a long Mac
  outage can rotate the Mac log, so note the Mac log's line count at T0 and at each read.
- *End checks at ≥ T0 + 6 h:* no new exit-info record and nothing for the package in `logcat -b crash`;
  `LinkService` `isForeground=true types=0x00000010`; `createTime` older than T0 (same service instance);
  `link-up.sh` three OKs; every claim line since baseline `0x10`.
- *What a pass means (F7):* the installed build held its link > 6 h in the background without a timeout exit. It
  does **not** by itself show 199's cause removed; that rests on the install-B manifest reading and, if wanted,
  the emulator control (plan item 1, a separate approval).

**2. Stage E — native Finder drop** (after or outside the soak window; it opens Sidekick's Mac window only, not
the phone app). Create the synthetic file first (`mkdir -m 700 ~/.s7-run && printf '…synthetic…' >
~/.s7-run/drop-me.txt`, hash recorded — **the folder does not exist now**). Owner drags it from Finder onto the
Files pane over `Download/ConnectSuite` → sheet names `drop-me.txt` → **Return** → expect `drop … not confirmed —
nothing granted` and no transfer → drag again → **Send** → phone digest verified, name as dropped or `(2)` on a
collision. A programmatic drop does not count.

**3. Stage F.** One synthetic push and one pull from `Download/ConnectSuite`; drag the pulled file to Finder by
the owner's hand; read the `quarantine absent/present` line (absent expected on the development build) and the
Photos checksum sentence if a Photos save is used; mirror 30 s with `Encoded +N frames` ticking.

**4. Separately tracked, not part of E/F:** the toolbar `PROCESS_TEXT` route (needs a host app whose toolbar
shows *Send to Mac* — Chrome was such an app in Slice 21 — and one supervised tap with the `START` / route-line
instrument from the morning plan §2.1); the native banner shown and clicked (packaged build, preferably a fresh
macOS user, morning plan §6); C step 3 (Wi-Fi off/on — also the cheap hardware check for F1's line counts); H4b.

**5. Stage G — cleanup** (exact list; delete nothing until the owner approves each):
- Mac: `~/.s7-run/` (once created in step 2) and the synthetic file pulled in stage F (name recorded then);
  the Mac clipboard (currently M-SYNC-2 per the 15:35 record) replaced by the owner (M1).
- Phone: the Keep test notes holding M-OFFER-2 (01:3x) and M-OFFER-3…M-SYNC-2 (14:51–15:33); the synthetic push
  target in `Download/ConnectSuite` from stage E/F; the phone clipboard (M-SYNC-2) replaced by the owner.
- Logs: V9 marker grep (expect 0, control ≥ 3) before any cleanup.
- **Keep:** `~/.connectsuite-evidence-private/` (rollback copies, Activity backup — reminder 2026-10-13),
  committed evidence.

**6. If F1's fix is approved and deployed later:** one disconnect/reconnect, count `Cleared` lines per outage.

## A. Completed while you rested

Mac suite 1,964/0 and typecheck; phone suite 1,454/0 (fresh, offline); 15 guards and 24 fixture suites green;
code paths traced for clipboard, Android service, notifications, drop and transfer, privacy and debug gates;
two Medium findings (F1 log flood rotating evidence; F2 privacy draft narrower than the code), three Low, one
coverage gap in the soak's discriminating power; evidence reconciled with dated, insert-only corrections.

## B. Blocked because the phone was unavailable

The soak; any reading of the phone's state since 15:35 (exit-info, `types`, `link-up.sh`); stage E's phone digest;
stage F; the toolbar route; C step 3; H4b; anything that would confirm F1 on hardware.

## C. Smallest next supervised session

Preflight (§7.0) → start the soak with an observed T0 (§7.1) → while it runs, stage E on the Mac only up to the
Return-cancels check (no phone app opened; the Send half lands a file on the phone and is fine during the soak
only if the owner agrees it does not count as foreground use — it does not open Sidekick on the phone) → end
checks at T0 + 6 h → stage F → G.

## D. Items still preventing readiness

Defect 199 not hardware-verified (soak; optional emulator control); stage E (real drop, Return-cancels) and F;
banner display/click on a packaged build; toolbar route end to end; defect 200 not deployed; F1 and F2 open;
and the standing release blockers in `docs/release-tracker.md` — no signed build (RB1), ML Kit (P3/188),
publisher/privacy policy (RB5), dependency audit unknown (U-2), single-device evidence (U-3).
