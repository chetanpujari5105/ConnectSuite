# Overnight report — 2026-10-15 (autonomous run, owner away)

Branch `overnight/2026-10-15` in the worktree `../ConnectSuite-overnight`, from `5cc0826`. Nothing pushed,
merged, signed, notarized, uploaded or published. No gate changed. No ADB, nothing touched on the phone.
The packaged app was not launched or clicked. Nothing of the owner's was deleted, and the owner's
uncommitted edits in the main checkout were not touched. The private run log is
`~/Documents/Sidekick-private/app-run-log-2026-10-15.md`.

Tags: **[V]** verified (file:line or output named), **[U]** unverified, **[A]** assumed or inferred.

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
| Debug switches | `desktop/src/main/debugSwitches.ts` | ignored when packaged | test-only switches and six feature switches | audit says 18 names; this run counted **16** `DebugSwitches` fields. The counting methods differ, **unreconciled [U]** |

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

## Morning checklist

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
