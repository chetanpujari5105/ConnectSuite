# Overnight report — 2026-10-15 (autonomous run, owner away)

Branch `overnight/2026-10-15` in the worktree `../ConnectSuite-overnight`, from `5cc0826`. Nothing pushed,
merged, signed, notarized, uploaded or published. No gate changed. No ADB, nothing touched on the phone.
The packaged app was not launched or clicked. Nothing of the owner's was deleted, and the owner's
uncommitted edits in the main checkout were not touched. The private run log is
`~/Documents/Sidekick-private/app-run-log-2026-10-15.md`.

Tags: **[V]** verified (file:line or output named), **[U]** unverified, **[A]** assumed or inferred.

## Second run — 14:35 to 15:02, "DMG first" (supersedes the first run's status, gates and checklist)

### Status

| Step | State | Evidence |
|---|---|---|
| 0 Disk | done | 15.39 GiB free at 14:35 **[V df]**. 1,310 temp folders from my own test runs deleted by literal path (276 MB) after attribution: birth time, test prefix, and no open files. Two samples 53 s apart: 15.661 → 15.667 GiB, so nothing was writing |
| 1 Build the DMG | **done** | `share-staging-2026-10-15/Sidekick-2.0.1-arm64.dmg`, from `cd54324` |
| 2 Static check | done on the final DMG | below |
| 3 Reconcile gates | done | the code has **18** switches, not 16; my earlier count was wrong. A real gap was found (below) |
| 4 Menu-bar fix | done | `cd54324`, red-first; the DMG was rebuilt to include it |
| 5 Mac suite | done | **2147/2147** **[V `.test-run.json` 14:50]**. Android suites not run, per the brief |
| 6 Dev-app walkthrough | **done, partly** | every pane read on the branch build. The phone **refused the connection** (`ECONNREFUSED :42501`), so there were no photos to select and the photo/video detail card was not observed |
| 7 Report | done | this section |

### The DMG

- Final: `~/Documents/Sidekick-private/share-staging-2026-10-15/Sidekick-2.0.1-arm64.dmg`, 121,674,439 bytes, sha256
  **`8d85df662a13b1e9be6ff042e00868bef18438d47c0b39dc1b47c2d187305bac`** (`SHA256SUMS.txt` beside it) **[V]**.
- First build, kept for comparison: `superseded-c01ee62/Sidekick-2.0.1-arm64.dmg`, sha256 `91490a0d…148bf7a`.
  It has no menu-bar fix.
- Built as `docs/release-candidate-2026-10-14b.md:4-5`: `npm run build`, then
  `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never`. It is ad-hoc signed by the
  `afterPack` hook only; there is no Developer ID, no notarization and no upload. Each build used about 540 MB
  (537 MB for the final one). The intermediate `desktop/release/` (517 MB, gitignored at `.gitignore:43`) was
  deleted before the rebuild; the final `release/` is left in place (~517 MB, rebuildable, owner may delete).
- Free space: 15.39 GiB at 14:35 → 14.73 GiB at 15:02 **[V]**.

### Static check of the final DMG (mounted read-only; the app was not launched) [V output]

| Check | Result |
|---|---|
| Version | `CFBundleShortVersionString` 2.0.1, `CFBundleVersion` 2.0.1, id `com.chetan.sidekick.desktop`, `LSMinimumSystemVersion` 11.0 |
| Architecture | `lipo`: arm64 for the main binary and the framework; **0** x86_64 Mach-O files in the bundle |
| Usage descriptions | `NSDownloadsFolderUsageDescription` = the new sentence; `NSLocalNetworkUsageDescription` = ours. Also present are Electron's generic defaults: Camera, Microphone, AudioCapture, BluetoothAlways and BluetoothPeripheral, all *"This app needs access to …"*. Those are owner-visible if macOS ever prompts for them |
| `LSFileQuarantineEnabled` | true |
| Fuses | RunAsNode off, NodeOptions env off, Inspect args off, ASAR integrity **on**, OnlyLoadAppFromAsar **on** (the fuse wire is 101100011 → 000011011, per the build log) |
| Signature | `Signature=adhoc`, flags `adhoc,runtime`, TeamIdentifier not set, `codesign --verify --deep --strict` OK, `spctl -a` **rejected** (expected without notarization); ad-hoc 22/22 nested components |
| ASAR | 921 files, 176 under `dist/`. 0 test, testkit, map or `.ts` files in `dist/`; 0 files with a `PRIVATE KEY` header; 0 matches for token patterns. `trialKey.js` is a public key (839 bytes, `PRIVATE` 0 times) |
| Dev switches | the reader is present (`debugSwitches.js`); six of 18 switches are not packaging-guarded. See the next table |
| `sidekick-media` | `registerSchemesAsPrivileged` in `mediaPreview.js:47,57` (standard, secure, fetch, stream), called at `main.js:1151` at module load, before ready. There are no `CFBundleURLTypes`, and none are needed: it is an in-app scheme |
| This branch's fixes | `trayWriter.js` present, 0 bare tray setters in `main.js`, `prepareReceiveFolder` ×3, `saveFailure` ×5, `folder-unavailable` ×1 |

### Corrected gate table (branch `cd54324`; values read from source **and** from the built JS)

**Constants.** None was changed.

| Gate | Where | Value | Hides |
|---|---|---|---|
| `SHARE_V3_RELEASE` | `desktop/src/main/shareActivation.ts:98` (built `shareActivation.js:70`) | false | several files per phone share |
| `MULTI_FILE_RELEASE` + `share_many_enabled` | `core/.../link/Extensions.kt:60`, `app/src/main/res/values/bools.xml:9` | false / false | same, phone side; the multi-select share entry |
| `SHARE_WAIT_RELEASE` | `shareActivation.ts:104` (built `:75`) | false | 30-minute waiting offers (10 min instead) |
| `WAIT_RELEASE` | `Extensions.kt:69` | false | same, phone side |
| `FS_BLOCKS_RELEASE` (Mac) | `desktop/src/shared/extensions.ts:32` (built `:36`) | false | block-verified pulls above 64 MiB; they arrive not checksummed (defect 187) |
| `FS_BLOCKS_RELEASE` (phone) | `Extensions.kt:79` | false | same |
| `WEBCAM_RELEASE` (Mac) | `desktop/src/shared/webcamWire.ts:87` (built `:80`) | false | the phone as a Mac webcam |
| `WEBCAM_RELEASE` (phone) | `Extensions.kt:95` | false | same |
| `CameraReleaseGate.allows(debuggable)` | `camera-module/.../CameraFeature.kt:24` | `= debuggable` | Camera v1 live preview on a release phone |
| `PRODUCTION_TRANSFER` | `Extensions.kt:51` | **true** | — (single-file phone → Mac share is on) |
| `SHARE_PRODUCTION_READINESS` | `shareActivation.ts:62-63` (built `:45`) | true / true | — (the Mac half of the above) |
| Developer menu | `main.ts` `showDeveloperItems: !app.isPackaged` (built `main.js:1127`) | hidden when packaged | Reload, DevTools |
| Refused launch switches | `desktop/src/main/releaseGuards.ts`, applied at `entry.js:12` | 9 refused: `--remote-debugging-port/-pipe/-address`, `--remote-allow-origins`, `--inspect`, `--inspect-brk`, `--inspect-port`, `--inspect-publish-uid`, `--js-flags` | debugging a packaged app |

**`CONNECTSUITE_DEBUG_SWITCHES`: 18 names** (`debugSwitches.ts:172-191`), the same 18 the audit lists in
§1.2/§3 (D6–D9). **No audit entry is missing or extra.** My earlier "16" came from a regex, `[a-zA-Z]+`, that cannot
match `shareV2` or `shareV3Off` **[V]**.

| Switch | Packaged-build handling **[V file:line]** | Audit says |
|---|---|---|
| `callBanner` | `!app.isPackaged &&` — `main.ts:262` | forced off ✔ |
| `skipTrial` | `!app.isPackaged &&` — `main.ts:1008` | ignored ✔ |
| `keychainNotice` | `app.isPackaged \|\|` — `main.ts:1226` (only turns a notice **on**) | ✔ |
| `webcamDev`, `webcamSpike` | `!app.isPackaged &&` — `main.ts:1494,1562-1563` (`:1583` only logs) | ✔ |
| `pairDecoyFirst` | `!app.isPackaged &&` — `main.ts:1502` | ✔ |
| `delayFloatListeners` | `app.isPackaged ? false :` — `main.ts:1884` | ✔ |
| `shareSilent`, `shareAcceptProbe`, `shareDevReceive`, `shareV2`, `shareV3Off` | `app.isPackaged ? {all false} :` — `main.ts:1428-1435` | ✔ |
| **`stallRemoved`** | **no packaging guard** — `notifications.ts:126` | ✘ audit: "ignored or forced off" |
| **`bypassReplyGuard`** | **no packaging guard** — `notifications.ts:173` | ✘ |
| **`bypassRemoteGuard`** | **no packaging guard** — `remote.ts:238` | ✘ |
| **`forceRecipientMismatch`** | **no packaging guard** — `sms.ts:231` | ✘ |
| **`stallCallEnded`** | **no packaging guard** — `calls.ts:93` | ✘ |
| **`shareOmitExt`** | **no packaging guard** — `link.ts:529,703` | ✘ |

**What that means [V by code, not run]:** `debugSwitches()` reads the environment variable with no packaging check
(`debugSwitches.ts:214-216`, whose own comment says main.ts guards it). A packaged build refuses only **argv**
switches (`entry.js:12`). So a packaged Sidekick started from a shell with `CONNECTSUITE_DEBUG_SWITCHES=bypassReplyGuard`
(or any of the six) would run with that guard weakened. Several of them weaken send guards (reply, remote, the SMS
recipient check). This contradicts the module header (*"inert in a packaged build"*) and audit §1.2's **[V]**.

It needs someone able to set an environment variable for the user's process, so the exposure is local. The fix is one
line (`debugSwitches()` returns all-off when `app.isPackaged`, read through `entry.js` or a passed flag), plus a test.
**Not done: the brief said do not change any gate.** It is an owner decision.

### Menu-bar fix (`cd54324`) — what the hang report proves and what it does not

- **It proves [V]:** for the 41 samples at 03:28, the main thread was blocked inside AppKit drawing Sidekick's
  status item (`NSStatusBarButtonCell drawWithFrame` → `NSSceneStatusItem` → `FBSScene` → a dispatch wait *"blocked
  by queue in a transient state"*). The app had been unresponsive for 8,945 s by then.
- **It does not prove:**
  - that a call from this app started that draw (no Electron Tray setter is on the stack; the draw runs from a Core
    Animation commit, which macOS also triggers itself);
  - that the hang began at 21:15:33, when the log stopped. That is an inference;
  - that fewer redraws would have prevented it.
- **What the change does:** the tray is redrawn only when its title, tooltip or menu actually differ from what it
  last showed. Before, it was redrawn on every status tick, every 30 s while disconnected. That removes the redraws
  nobody needed, which is the only part of the trigger this repo owns. Red-first: the wiring test was red on the old
  `refreshTray`; removing the writer's comparison turns 2 tests red.

### Dev-app walkthrough (branch build, phone not connected) [V `probe.mjs` readings]

| Pane | Visible buttons (disabled) | State shown |
|---|---|---|
| Overview | 8 (2) | data-state `working`, `connecting` |
| Mirror | 13 (7) | — |
| Messages | 3 (0) | empty: *Pick a conversation* / *No conversation open* |
| Notifications | 0 | no `.state-block`. What it shows when disconnected uses another element **[U]** |
| Calls | 0 | same as Notifications **[U]** |
| Files | 0 | loading: *Reading the phone's folders…*; empty: *Nothing selected* (data-state M1) |
| Photos | 0 | permission: **"The phone is not sharing its photos"**; empty: *Nothing selected* |
| Clipboard | 7 (0) | data-state `offline` |
| Apps | 0 | permission: **"The phone is not sharing its apps"** |
| Camera | 0 | blocked: *Your phone is not connected* (×2) |
| Activity | 13 (1) | — |
| Settings | 13 (0) | — |

**Finding:** with the link down, Photos and Apps word it as the **phone refusing** ("not sharing", kind
`permission`), while Camera says *not connected*. This is the "what else produces this state" mistake in copy. Not
fixed.

**Photos detail card: not observed this run** (no phone, so no tiles). From source, identical on this branch apart
from 3a:
- Save to Mac shows for photos and videos alike;
- selecting a video fetches only a thumbnail and offers **Play** (or **Try anyway** for formats this Mac cannot play);
- after a save the card offers **Reveal in Finder**, and there is no "open in another app".

One instrument fault was caught: the first pass settled on "buttons > 0", which is wrong for panes that correctly have
none. Those 6 readings were marked not reportable and re-read immediately; the values were the same.

**Left as found:** I quit only my instance. The original dev app runs again from the main checkout with the same flags
(launcher PID 65940, PPID 1, started 15:02:12). It now has a window, which the 12 Oct instance did not. While
restoring it, one relaunch of mine started while the profile was still locked, and **probably showed the "another copy
is already using…" dialog for about a minute**. I closed it by killing that instance, without clicking.

### Decisions this run, and how to reverse each

| # | Decision | Reverse |
|---|---|---|
| 10 | Deleted 1,310 temp folders attributed to my test runs (list: `~/Documents/Sidekick-private/tmp-deleted-by-app-run-2026-10-15.txt`) | not reversible. They were test scratch from this run; `npm test` recreates them |
| 11 | Stopped my own Gradle daemons | they restart on the next Gradle run |
| 12 | `desktop/node_modules` in the worktree is now an APFS clone, not a symlink | `rm -rf` it and re-link |
| 13 | Kept the first DMG as `superseded-c01ee62/` | delete that folder |
| 14 | Committed the menu-bar change (`cd54324`) | `git revert cd54324` |
| 15 | Did **not** fix the six unguarded debug switches (a gate change) | — owner's call |
| 16 | Stopped and restarted the 12 Oct dev app to run the branch build | it runs again from the main checkout |
| 17 | Left the final `desktop/release/` (~517 MB) in the worktree | `rm -rf ../ConnectSuite-overnight/desktop/release` |

### Morning checklist (replaces the one at the end of this file)

1. **The fresh-user test, which is the one thing only you can do.**
   - Create a new macOS user. Copy
     `~/Documents/Sidekick-private/share-staging-2026-10-15/Sidekick-2.0.1-arm64.dmg` to it, and check it with
     `shasum -a 256` (`8d85df66…7305bac`).
   - Install it, open it (right-click → Open, or Privacy & Security → Open Anyway), and pair the phone.
   - In Photos, Save to Mac one photo and one video. The Downloads prompt should show *"Sidekick saves the photos,
     videos and files you copy from your phone into your Downloads folder."*
   - Once, answer **Don't Allow**: the card should say *"Not saved. Sidekick is not allowed to save into …"* and the
     grid should stay.
   - Also select a video and see whether Play works in the packaged app (the `sidekick-media` scheme, audit G9).
   - Watch the menu-bar dot through a disconnect and a reconnect.
2. **The phone was not listening** at 14:57 (`ECONNREFUSED`). Check that Sidekick is running on it before the test.
   The phone was not touched this run.
3. **Decide on the six unguarded debug switches** (table above). Recommended: make `debugSwitches()` all-off when
   packaged, with a test, before the beta ships.
4. **Decide on the copy** "The phone is not sharing its photos/apps" when the phone is simply not connected.
5. **Intel patches:** apply the two patch files in `~/Documents/Sidekick-private/intel-removal-patches/`, then move
   the Intel `.dmg` out of the share folder by hand.
6. **Route C wording:** make the three corrections below in `docs/defects.md` / `docs/testing.md`.
7. **Disk you can clear (nothing else was deleted):**
   - ~3 GB of older test leftovers in `$(getconf DARWIN_USER_TEMP_DIR)` (from before this run);
   - the two stray `.git` folders (~104 GiB);
   - `~/Library/Application Support/Claude` 10.95 GiB, `…/com.google.AIEdgeEloquent` 8.77 GiB,
     `~/Library/Developer/CoreSimulator` 5.39 GiB (rebuildable), `~/Library/Caches` 6.11 GiB (cache);
   - the worktree's `desktop/release/` (~517 MB);
   - three OS-update snapshots, which macOS manages itself.
8. Merge or cherry-pick `overnight/2026-10-15` (`648c35a`, `0ec647e`, `7533a89`, `ca80556`, `cd54324` + docs).

---

## First run — 13:15 to 14:20

## Status

| Step | State | Why |
|---|---|---|
| 1 Diagnose packaged app | **done, differently** | PID 27401 was already gone at 13:16, so `sample` could not run. macOS's own hang report for it was read instead |
| 2 Worktree | done | `../ConnectSuite-overnight`, branch `overnight/2026-10-15` |
| 3a Save to Mac write failure | done | `648c35a` |
| 3b Apple silicon only | done | `0ec647e`, plus 2 patch files (not applied) |
| 3c Route C 223/224 | done | `7533a89` + `ca80556` |
| 3d Hang fix | analysis only | the blocking wait is inside macOS, not in the repo |
| 4 Build + unsigned DMG | **not run** | free space under 15 GiB the whole time: 13.32 → 10.96 GiB |
| 5 Static DMG check | **partly** | no DMG exists. Gates re-read from source; Mac suite run |
| 6 Dev-app walkthrough | **not run** | the dev app has no window, and the relaunch from the branch needs step 4. The Photos questions are answered from source |
| 7 Report | done | this file |

## Commits

| Commit | What | Tests |
|---|---|---|
| `648c35a` | Save to Mac: a refused write says so in the Photos pane | Mac 2140/2140 **[V]** |
| `0ec647e` | Packaging: arm64 only | Mac 2141/2141 **[V]** |
| `7533a89` | Route C for defects 223/224 | input-module 53/53, sync-module 688/688 **[V]** |
| `ca80556` | Route C: guard 223's log half on this branch | input-module 54/54, sync-module 688/688 **[V]** |

The final counts are: **Mac 2141/2141**, **input-module 54/54**, **sync-module 688/688** (Gradle exit 0, result files
under 10 s old when read). The app, core, mirror-module and camera-module suites were **not run** in the worktree:
no change touches them, and nothing in them calls a changed constructor **[V by grep]**.

Two things about running the suites in a worktree:

- **The repo's commit hooks do not guard commits in a worktree.** They key off `$CLAUDE_PROJECT_DIR`, which is the main
  checkout. Every hook in `scripts/hooks/` was therefore run by hand against the worktree before each commit. All
  passed except `script-fixtures-green`, whose one red fixture needs a built `desktop/dist`. Its exact rule was
  applied to a scratch `tsc` emit instead: 22 renderer-loaded shared files, 0 offenders **[V]**.
- A fresh worktree fails 21 camera-bridge tests ("the bridge is not built"). `desktop/node_modules` and
  `desktop/native/SidekickCamera/.build` are symlinks to the main checkout's copies. The main build is from the same
  Swift sources (clean against HEAD) **[V]**. Both symlinks are untracked and never staged.

## Step 1 — the packaged app (PID 27401)

- **It is gone.** Neither 27401 nor its zombie child 49568 existed at 13:16 **[V `ps`]**. Nothing needs quitting.
  How it ended is **[U]**: the unified log has nothing between 03:27:30 and 03:31. This run did not quit it.
- **Evidence:** `/Library/Logs/DiagnosticReports/Sidekick_2026-10-15-032910_Chetans-MacBook-Pro.hang` (root-owned,
  not copied). Its header reads: Sidekick 2.0.1, `/Applications/Sidekick.app`, *"Unresponsive for 8945 seconds before
  sampling"* (00:59 → 03:28), CPU 0.016 s, and 1511 MB of free disk at the time. It is the only process of 622 in the
  report carrying that note **[V]**.
- **The main thread, identical in all 41 samples [V]:** `-[NSStatusBarButtonCell drawWithFrame:inView:]` →
  `-[NSSceneStatusItem _setSelectedContentFrame:options:]` → `-[FBSScene _updateClientSettings:]` →
  `-[BSServiceDispatchQueue performAsyncAndWait:]` → `_dispatch_event_loop_wait_for_ownership`. The kernel annotates it
  *"blocked by queue in a transient state"*. The modules are AppKit, FrontBoardServices, BoardServices and libdispatch;
  there is no JS, Node or libuv frame. In plain words, it is blocked inside macOS while drawing the app's menu-bar
  (Tray) icon.
- **Why the log stopped at 2026-10-14T21:15:33.825 (`W [link]`) [A]:** every link status tick calls `refreshTray()`
  (`desktop/src/main/main.ts:2113`), which calls `tray.setTitle` / `setToolTip` / `setContextMenu` (`main.ts:884-886`)
  even when nothing changed. While disconnected, that happens every 30 s. Once the main thread was stuck there, the
  event loop never ran again: no further log lines, and the exited `/sbin/route` child was never reaped (hence the
  zombie).
- **`discovery.ts:57` is not the cause [V]:** `exec` is `promisify(execFile)` (`discovery.ts:1,2,9`). It is
  asynchronous, has `{ timeout: 2000 }`, and is wrapped in try/catch (lines 55–64).
- **3d decision:** the cause is in macOS, so nothing was committed. One mitigation is offered as an owner decision
  (below): touch the tray only when the title, tooltip or menu actually changes. That would cut the redraws from every
  30 s to real changes only. It would not make the deadlock impossible.

## Step 3a — what was wrong with Save to Mac

These came from reading the code; none of it is a hardware record.

1. **The default receive folder's `mkdir` was unguarded** (`downloads.ts:56` at 5cc0826). It threw past every caller's
   `{ ok: false }` branch. It is now `prepareReceiveFolder`, which returns a sentence naming the folder (EPERM/EACCES are
   worded as a permission, anything else carries its code).
2. **The second `mkdir`, in `PhotosClient.original`,** ran after the phone had agreed the transfer, so a throw there
   also skipped the cancel. It now goes through the same call, and the phone gets `fs.transfer.cancel` with reason
   `folder-unavailable`. That is an existing term from the share vocabulary, and the phone logs any reason as free text
   (`BulkStops.kt` `describe`).
3. **The pane's `pull()` had `try/finally` and no `catch`,** so a thrown save reset the button silently.
4. **Also found: a refused save was written into the pane-wide `failure`,** which **hides the whole grid** and heads it
   *"The phone is not sharing its photos"*, about a refusal from the Mac. Both now land in `saveFailure`, drawn under the
   Save button for that photo: *"Not saved. …"* plus the hint.
5. `NSDownloadsFolderUsageDescription` was added: *"Sidekick saves the photos, videos and files you copy from your phone
   into your Downloads folder."*

Red-first **[V]**: 2 renderer tests went red on the unfixed pane (one an uncaught rejection), and mutations M1–M3 each
went red. **Not reached [U]:** the EPERM path on a fresh macOS account (needs the packaged app), and how the new line
looks on screen (no relaunch).

## Step 3c — Route C, and the wording corrections for `docs/defects.md` / `docs/testing.md`

The owner's two files were not edited. Their 223/224 entries describe the **play/release-vc3** port. On this branch:

1. **The commit hash.** `defects.md:4206,4214` and `testing.md:30977,30988` say *"Fixed in `6e0acb4`"*. That commit
   is only on `play/release-vc3` **[V `git branch --contains`]**. On this branch the fix is **`7533a89`**, with the log
   guard in **`ca80556`**.
2. **53/53 vs 64/64.** `testing.md:30979` says *"After: input-module 64/64"*. Here it is **53/53** after `7533a89`
   and **54/54** after `ca80556`. The 11-test gap is `InputDisclosureTest`, which this branch does not carry.
3. **The InputDisclosureTest line.** `testing.md:30979-30980` says *"the sentence restored → 2 red (GestureDispatchTest,
   InputDisclosureTest); the log line restored → 1 red"*. Measured here **[V]**:
   - restoring 223 exactly as it was: **1** red in input-module (the defect-223 test) and **2** red in
     `PackageIdInProseTest`;
   - restoring the log line: **0 red at `7533a89`** (nothing on this branch tested it), and 1 red from `ca80556` on.

## Step 5 — every release gate, from source at this branch (no DMG to read)

| Gate | Where **[V]** | Value | What it hides | vs audit §1 |
|---|---|---|---|---|
| `SHARE_V3_RELEASE` | `desktop/src/main/shareActivation.ts:98` | false | several files per phone share | same |
| `MULTI_FILE_RELEASE` | `core/.../link/Extensions.kt:60` | false | same, plus the multi-select share entry (`share_many_enabled` false in `app/src/main/res/values/bools.xml:9`, true in debug) | same |
| `SHARE_WAIT_RELEASE` | `shareActivation.ts:104` | false | 30-minute waiting offers | same |
| `WAIT_RELEASE` | `Extensions.kt:69` | false | same | same |
| `FS_BLOCKS_RELEASE` (Mac) | `desktop/src/shared/extensions.ts:32` | false | block-verified pulls above 64 MiB (defect 187) | same |
| `FS_BLOCKS_RELEASE` (phone) | `Extensions.kt:79` | false | same | same |
| `WEBCAM_RELEASE` (Mac) | `desktop/src/shared/webcamWire.ts:87` | false | Camera v2, the phone as a webcam | same |
| `WEBCAM_RELEASE` (phone) | `Extensions.kt:95` | false | same | same |
| `CameraReleaseGate.allows(debuggable) = debuggable` | `camera-module/.../CameraFeature.kt:24` | no constant | Camera v1 live preview | audit says `:23`; line drift only |
| `PRODUCTION_TRANSFER` | `Extensions.kt:51` | **true** | single-file phone → Mac share (on) | same |
| `SHARE_PRODUCTION_READINESS` | `shareActivation.ts:62-63` | both facts true | the Mac half of the above | same |
| `callBanner` switch | `main.ts:262` | forced off when packaged | the incoming-call banner | audit says `:261`; line drift |
| `skipTrial` switch | `main.ts:1008` | ignored when packaged | the beta-token check | same |
| Developer menu items | `main.ts:1297` `showDeveloperItems: !app.isPackaged` | hidden when packaged | Reload, DevTools | same |
| Refused command-line switches | `desktop/src/main/releaseGuards.ts` | packaged exits on them | `--remote-debugging-port` and others | not recounted |
| Debug switches | `desktop/src/main/debugSwitches.ts` | ~~ignored when packaged~~ | test-only switches and six feature switches | **Corrected in the second run:** 18 names, as the audit says (my 16 was a regex error), and 6 of them are **not** packaging-guarded — see the corrected gate table above |

**Not checked, and only a DMG can answer them:** the version in the built Info.plist, the built usage descriptions,
fuses, ASAR contents, and the `sidekick-media` registration.

## Step 6 — Photos, from source (renderer/photos.ts is identical at 83c4096 and 5cc0826 [V])

- **Save to Mac on the detail card:** drawn for **any** selected item, photo or video, whenever photos are advertised
  (`photos.ts:1450-1456`). There is no kind check **[V source]**.
- **Selecting a video:** fetches only the 512 px thumbnail. The automatic full-size load is for images of 40 MiB or
  less (`photos.ts:100,1160`). The stage then offers **Play** (`:252`), or, for a format this Mac's player cannot play,
  *"This Mac's player cannot play this … video. Save to Mac to open it…"* with **Try anyway · size** (`:209,225`).
  Play fetches the original into the private preview cache and shows a `<video controls>` (`:1314`) **[V source]**.
- **Open:** there is no "open in another app" action. After a save the card offers **Reveal in Finder** (`:1483`).
  An image over 40 MiB offers **Load full size · size** (`:260`) **[V source]**.
- **Compared with audit §4:** consistent. Two things are not in the audit: the refused-save state that hid the grid
  under a wrong headline (fixed in `648c35a`), and the missing `NSDownloadsFolderUsageDescription` (added). The audit's
  G4 subtitle ("organise") was not re-checked on screen.

None of this was observed on screen in this run.

## Decisions made, and how to reverse each

| # | Decision | Reverse |
|---|---|---|
| 1 | No build or DMG: every free-space reading was under 15 GiB | free space, then run step 4 |
| 2 | Steps 1–3 ran anyway, with a 12 GiB floor for test runs (hit at 13:58; nothing ran after) | — |
| 3 | 3d is analysis only; no tray mitigation committed | take the mitigation below |
| 4 | `node_modules` and the Swift `.build` symlinked from the main checkout | delete the two symlinks |
| 5 | Hooks run by hand against the worktree | — |
| 6 | Cancel reason `folder-unavailable` for a folder that cannot be made | change the string in `desktop/src/main/photos.ts` |
| 7 | Added the 223 log-line test (not in the scratch patch) | `git revert ca80556` |
| 8 | Website patch keeps the sign-up form's chip question | edit the patch |
| 9 | `docs/RESUME.md` is not touched on this branch: the main checkout holds an uncommitted entry of mine (03:01), and two edits would conflict | — |

To remove the whole run: `git worktree remove --force ../ConnectSuite-overnight && git branch -D overnight/2026-10-15`
(both created by this run), and delete `~/Documents/Sidekick-private/intel-removal-patches/`.

## Morning checklist (first run — superseded by the second run's checklist above)

1. **The hung packaged app.** It has already exited, so there is nothing to quit. If it hangs again: `sample <pid> 5`,
   then Force Quit. The cause is in macOS; decide whether to take the tray mitigation (item 5).
2. **Disk first, then a fresh-user test.** Free at least 15 GiB; it was 10.96 GiB at 14:13 and falling while nothing
   from this run was going.
   - About 3.3 GB is test leftovers in the user temp folder (`getconf DARWIN_USER_TEMP_DIR`): 31,820 entries, of which
     about 352 MB came from this run. macOS clears old items there on its own.
   - The two stray `.git` folders hold about 104 GiB.
   - Then run step 4 as the last release-candidate record did (`docs/release-candidate-2026-10-14b.md:4-5`): a
     scratch copy of the branch, `npm run build`, `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac
     --publish never` (arm64 only now). Copy the `.dmg` into `~/Documents/Sidekick-private/share-staging-2026-10-15/`
     and write SHA-256 sums.
   - On a **fresh macOS user**: install the staged DMG, pair the phone, and Save to Mac one photo and one video. The
     Downloads prompt should show the new sentence. Answer *Don't Allow* once: the pane should say *"Not saved.
     Sidekick is not allowed to save into …"* with the grid still there.
3. **Intel patch files.** In `~/Documents/Sidekick-private/intel-removal-patches/`: `1-share-folder.patch`,
   `2-website-sidekick-site-v1.patch`, and a README listing every file and line plus the apply commands. Move
   `Intel-untested/Sidekick-2.0.1.dmg` out by hand.
4. **Route C wording.** Make the three corrections above in `docs/defects.md` / `docs/testing.md`, if this branch is
   the one that ships 223/224.
5. **Decisions that remain:**
   - merge `overnight/2026-10-15`, or cherry-pick from it;
   - the tray mitigation;
   - the website chip question;
   - the 16 vs 18 debug-switch count;
   - whether the Play branch (`6e0acb4`) or this branch's port is the record for 223/224.
