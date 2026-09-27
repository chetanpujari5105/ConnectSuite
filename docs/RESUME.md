# Resume here — written 2026-09-28 (overnight): Stage 2 hardened, stall clock built, runbook written; uncommitted

> Supersedes the entry below. **Nothing installed, armed, enabled, relaunched, transferred, deleted or
> committed; the SM-S938B was not addressed.** The Mac dev app (pid 93018) and `desktop/dist` (12:53:08)
> were not touched. `docs/testing.md` → *Stage 2 hardening* holds every number below.

1. **Fixed, with deterministic tests:**
   - the close-versus-open race — an open gate, so no shared URI is opened once `end()` has taken effect;
     `end()` waits for at most one open already under way (main thread, one provider call);
   - a per-file `OpenFailed` log line, class name only, no name or URI (`ShareManyQueue.notPreparedLine`);
   - an offered row that could revert to *Waiting for you to accept* once its offer aged out of the 16
     recent views;
   - `SEND_MULTIPLE` items silently dropped (empty `EXTRA_STREAM`, non-URI `ClipData` items) —
     `ShareSelection.streams`;
   - Back left the queue opening URIs until `onCleared` — now ended in `onStop` (**reasoned, untested**).
2. **Built for review — the §12 stall clock** (debug path only, PROVISIONAL values, monotonic clock,
   synthetic-time tests). **Revised 01:10 on the owner's decision:** the pause check is a hypothetical
   crediting the in-progress copies' bytes to both `Σ'` and `free'`; actual admission is unchanged; the §4
   quota and usable-space readings are never invented when `Σ' > 0`. **All five §12 readings accepted by
   the owner, 2026-09-28, for development testing only** — not production; both limits stay PROVISIONAL.
3. **Verified (after the revision):** phone 217/0, 499/0, 132/0 (`--rerun-tasks`); Mac 1,267/0, both
   typechecks; 15 checkers exit 0; 19 mutations red last night, and N1–N6 plus seven re-runs red after
   the revision (N6 only after a test was added for it). Debug APK: the multi-file activity `enabled=false`; release APK and dex: no
   multi-file or v3-arm activity, no `SEND_MULTIPLE`.
4. **The first live test cannot run on the current Mac:** its `dist` has no `shareV3` at all. The plan,
   approvals and restore steps are `docs/feature-a-v3-supervised-runbook.md` — **not run, not authorised.**
5. **Needs the owner:** review and commit (recommended before any install); the five §12 readings; whether
   these review findings get defect numbers; the §11 grant measurement or an explicit waiver; the runbook's
   approvals M1–M5 and P1–P6, at the time.
6. **Mac free space:** 25 GiB at the start, 26,125 MiB after the builds, then **24,995 MiB** at 01:05 —
   a 1.1 GiB fall while only Markdown was written; 74 MiB of it is this session's scratch copies
   (unzipped dex, in the session scratchpad). The rest is unexplained; stable over 30 s. **25,848 MiB at
   01:21** after the revision. Nothing deleted.

# Resume here — written 2026-09-27 (late): pre-hardware review done; the unverified-cleanup path tested; uncommitted

> Supersedes the entry below. Nothing installed, armed, enabled, relaunched, sent, deleted or committed. The
> running Mac dev app and `desktop/dist` (12:53:08) were not touched; the Samsung was not addressed.

1. **Added:** a synthetic test that produces a partial `ShareStaging.copy` cannot delete (read-only staging
   directory) and proves the queue fails closed — no retry, no offer, nothing unidentified deleted, one
   per-file reason naming the attempt. `Env.notPrepared` + a warning log line; §14's sentence plus one.
   4 mutations red. `docs/testing.md` → *review before hardware*.
2. **Verified:** phone 217/0, 481/0, 129/0 (Gradle, `--rerun-tasks`); Mac 1,267/0; 14 checkers 0; debug APK
   has the Stage 2 activity `enabled=false`; release APK and manifest have neither version-3 activity nor
   `SEND_MULTIPLE` (release dex byte-identical to the packaged one). Free space 22.5 GiB → 25.4 GiB.
3. **Review findings not fixed:** a narrow window where one `openInputStream` can follow `screenClosed()`
   (no byte read); `OpenFailed` is not logged per item; the review screen has never been rendered.
4. **Needs the owner:** review and commit; the added sentence; the §20 decisions; the §11 grant
   measurement; approval of the supervised Stage 1 hardware run.

# Resume here — written 2026-09-27 (evening): Stage 1 verified through Gradle; Stage 2 built, development only; uncommitted

> Supersedes the entry below. Nothing installed, armed, relaunched, transferred, deleted or committed. The
> running Mac dev app (pid 93018) and `desktop/dist` (12:53:08) were not touched.

1. **Stage 1 verified:**
   - phone core 217/0, sync-module 459/0, app 116/0 (Gradle, `--rerun-tasks`, artifacts ≤ 23 s old);
   - debug and release built; the v3 arm is absent from the merged **and** packaged release manifest;
   - Mac 1,267/0, typecheck clean, a scratch emit; every guard exit 0;
   - no defect found.
2. **Stage 2 built (development only):**
   - `ShareManyQueue`, `ShareSelection.atSend`, `ShareManyCopy`;
   - a debug-only `ShareManyToMacActivity` and its model, registered **`android:enabled="false"`**.

   Final: phone 217/0, 480/0, 128/0; 12 mutations red on their named tests plus one documented survivor.
   `docs/testing.md` → *Stage 1 verified through Gradle, and Stage 2 begun*.
3. **Not built (open decisions, proposal §20):** the stall clock, Stop preparing, the notification,
   keep-screen-on, and `group` (Mac-side C3 validation is missing). Leaving the screen is a fail-closed
   placeholder, not option A.
4. **Needs the owner:**
   - review and commit;
   - the §20 decisions;
   - the §11 `SEND_MULTIPLE` grant measurement;
   - any hardware run. Stage 1's run comes before Stage 2's.
5. **Left on devices:** unchanged. Mac free space was about 17.7 GiB at the end (7.2 GiB at the start); the
   rise is unexplained.

# Resume here — written 2026-09-27: Stage 1 wording fix, automated only (standalone JVM), uncommitted; Stage 2 not started

> Supersedes the 19:15 entry below for Stage 1. Nothing installed, armed, relaunched, transferred, deleted or
> committed. The running Mac dev app and `desktop/dist` (12:53:08) were not touched.

1. **Fixed (source):** a budget-stopped concurrent copy now carries its re-check's reason, `Σ` and measured
   limit to the sheet (`ShareAdmission.Stop`, `stopCopying`, `limitAfterDiscarding`, `BudgetStopped.stop`,
   `noRoomAfterStop`). *Couldn’t measure* appears only for a missing, stale or inconsistent reading. `Σ` is
   no longer re-read after a stop. A partial copy says what was prepared and that it was deleted.
   `docs/testing.md` → *the stopped-copy wording fix*.
2. **Proof:** 193/0 on a standalone Kotlin 2.2.20 compile of the pure share files and 13 test classes,
   including every version-2 single-file suite; Mac 1,267/0; 6 of 6 mutations red. **No Gradle ran**: disk
   was 3.8–4.2 GiB, under the 5 GiB gate. `ShareToMacModel.kt` was not compiled whole.
3. **Owed before a commit** (needs ≥ 5 GiB free): the phone suites through Gradle (`core`, `sync-module`,
   `app`, `--rerun-tasks`, artifact ages read); the debug and release builds and the merged-manifest check,
   in a scratch location.
4. **Stage 2 (`SEND_MULTIPLE`) was not started:** it was conditional on the disk gates holding, and they did
   not. The open decisions are unchanged (proposal §20).
5. **Left on devices:** unchanged. The Gradle daemon (idle, this project) was stopped with `--stop`.

# Resume here — written 2026-09-26 (19:15): version 3 Stage 1 built, automated tests only, uncommitted

> Supersedes the 14:50 entry below for the several-files work. Nothing installed, armed, relaunched,
> transferred, deleted or committed. The running Mac dev app (pid 93018) and its `dist` were not touched.

1. **Built (owner-approved, development only):**
   - the version-3 switch — phone `ShareDevGate.v3` + `DUMP`-gated `ShareDevV3Activity`; Mac `shareV3`
     debug switch + `shareV3Activation` (unpackaged, `share.ask` open, synthetic gate closed);
   - the §4 per-copy budget in `ShareAdmission.forCopy`, with readings from `ShareBudgetReadings`,
     supplied by the single-file sheet only in a debuggable build;
   - decision B's *No room for another file yet* with the measured limit and **Try again**.
   `SEND_MULTIPLE`, the review screen and the §12 stall clock are **not** built.
2. **Proof:** Mac 1,267/0, phone core 217/0, sync-module 453/0, app 110/0; typecheck and six guards green;
   11 of 11 mutations red on their named tests. `docs/testing.md` → *Version 3 Stage 1*.
3. **Not verified:** readings on a device; the merged release manifest; the window with several cards at a
   real size. Stage 1's hardware gate (§10 with decision C's arm and disarm) is **not authorised**.
4. **Open (owner):** the notification, Stop preparing, lifecycle option A, production values, the
   `SEND_MULTIPLE` grant measurement, a commit of this work, and any hardware run.
5. **Mac free space** fell from 7,477 to about 5,650 MiB during the sitting, with a −1 GiB step while
   nothing of this work wrote. The cause is unconfirmed; nothing was deleted.

# Resume here — written 2026-09-26 (after the 14:50 cleanup): multi-file Stage 0, documents only, uncommitted

> Supersedes the 00:40 entry below for the several-files work. Nothing built, installed, armed,
> transferred, deleted or committed in this sitting; the Mac card still visible was not touched.

1. **Owner direction (2026-09-26):** multi-file sharing is the next priority — small photo and document
   batches first, one Mac receive window, an individual Accept or Decline per file, no Accept all.
   Large files stay separate (Path L). **Approved for development only, PROVISIONAL:** the live per-copy
   budget (½ / 3% + 1 GiB / 5 s), the 60-minute accepted-queue backstop, and unknown sizes handled file
   by file. The single-file admission rule is unchanged.
2. **Written, uncommitted, for review:**
   - `docs/feature-a-multi-offer-proposal.md` rev 4: R6–R9 and §11–§20 — grants and lifecycle,
     waiting for room, wording, unknown sizes, failures, hardware status, C1–C7, leak prevention,
     stage gates, open decisions;
   - `docs/protocol.md` → Version 3, rewritten to C1–C7, all still PROPOSED;
   - `docs/testing.md` → *Stage 0 corrections*;
   - defect 155's row in `docs/defects.md`.
3. **Corrected:** the 14:32 run **observed** the 30-second lost-copy check and the Mac main-card
   wording. It did **not** observe the receive-window wording or the Accept-time check on a lost copy.
   The cache quota (183,326,942 bytes, SM-S938B, 10:14:15) is now recorded. Defect 155's fix is in the
   running dev app (pid 93018, `f71285b`), unproduced on hardware.
4. **Committed since the 00:40 entry** (not by this sitting): `c89aa9f` `ef79fc1` `a18f45d` `f55e044`
   `acd24a4` `f71285b`.
5. **Decided after review (owner, 2026-09-26):** B — the single-file sheet **refuses** an extra copy
   with the measured limit and **Try again**, never waits; unchanged when no other copy is held.
   C — any future Stage 1 hardware test arms version 3 on both sides for the test only, then disarms and
   reads back `share.file 2`. **Neither authorises a test.** The flat 10-minute wait cap is replaced by
   a **stall clock** (proposal §12), which is proposed for review and not approved.
6. **Needs the owner:** review the Stage 0 diff; the open decisions in the proposal's §20 (the
   notification, the stall clock, Stop preparing, lifecycle option A, the `SEND_MULTIPLE` grant
   measurement, production values, Stage 1 go-ahead).
7. **Left on devices:** unchanged. The phone runs the `f71285b` debug build; the Mac dev app is pid
   93018. Mac free space was 6,235 MiB at the end of the writing. At the 18:30–18:33 review it swung
   from 5,192 to 9,456 MiB, cause unconfirmed (`docs/testing.md` → *Stage 0 corrections*).

# Resume here — written 2026-09-26 (00:40 IST): v3 queue built inert; Stage B groundwork; nothing enabled

> Supersedes the entries below for the several-files work. Nothing pushed, installed or relaunched.
> Evidence: `docs/testing.md` → *Version 3 queue, Stage A* and *Stage B groundwork*; defect 155.
>
> **Superseded in part by rev 4 (2026-09-26):** there is no cap `C` any more (R6, a live per-copy
> budget instead), so 4(a) and supervised step 1's *"Decide `C`"* no longer apply. 4(d) is decided —
> file by file (D4). 4(e) is out of date — the fix is in the running dev app (defect 155's row).

1. **Built and proven (automated only, no device):** version-3 Stage A on both sides behind
   `share.file 3`, which **neither side advertises** — the Mac's ten-offer book, Accept-order queue with
   one writer, reservations, queue lifetime, and a receive window that lists one card per offer with its
   own Accept / Decline / Cancel (`ShareQueueView`); the phone's ten-offer limit, one pull per session,
   queue backstop, and `ShareAdmission.forCopy` (exactly the v2 preflight below v3). Plus Stage B
   groundwork: `ShareSelection` / `ShareBatch` (parse a multi-select, stage one file at a time, per-file
   cleanup). Proof: Mac 1245/1245, phone app 94/0 + sync-module 412/0 + core 212/0, all guards green,
   39 mutations red on their own tests (Mac 16 + the combined M8b, phone 11, batch 11); one Mac
   survivor, M8, documented (two guards, one test). **Correction:** `676c5f2`'s message says *29
   mutations red*; the Stage A count is 28.
2. **Committed:** `676c5f2` (Stage A + defect 155 + docs), `061e243` (Stage B groundwork + docs). This
   RESUME entry is **not** committed.
3. **Half-built:** nothing in the tree. **Deliberately disabled:** `share.file 3` (both sides),
   `ShareAdmission.APPROVED_CAP = null` (so a second concurrent private copy is refused, and every
   multi-file selection is refused), `SEND_MULTIPLE` not registered, no selection sheet, no `group` on
   the wire. The 60-minute queue lifetime is `QUEUE_LIFETIME_CANDIDATE_MS` — provisional.
4. **Needs the owner:** (a) a measured rule for `C` (the cap on private copies held at once) — without
   it no live multi-file test can pass the phone's admission; (b) approve how a dev build may advertise
   `share.file 3` (no gate for it exists — adding one is a change to `Extensions.advertised` on both
   sides); (c) the 60-minute lifetime; (d) whether a selection with unreported sizes is admitted file by
   file (as built) or refused whole; (e) defect 155's fix is in the tree, not in the running Mac app.
5. **Next:** once (a) and (b) are decided, a supervised Stage A run (below). Before that, a layout
   reading of the queue window with synthetic data — the list's scrolling and 560 px clamp are
   **unmeasured** (the DOM double has no layout).
6. **Left changed on devices:** the phone — nothing. The Mac — the dev app (pid 5645, started
   2026-09-25 23:05) was not quit or relaunched; `desktop/dist` was overwritten by one `npm run build` at
   00:15:02 and **restored to a byte-identical build of HEAD** minutes later (the code that app runs).
   Receive folder, synthetic image, pairing, permissions, network, `PRODUCT.md`, `skills-lock.json`,
   logos and design files untouched.

**Supervised steps before a live multi-file (Stage A) test, in order:**
1. Decide `C` and the dev-only way to advertise `share.file 3`; implement both as a reviewed commit
   (neither exists). Keep production at 2.
2. `df -m /System/Volumes/Data` ≥ 1024; `cd desktop && npm test`; phone suites; guards.
3. `scripts/target-device.sh samsung` → `OK target RZCY12330DT (SM-S938B, sdk 36)`.
4. Baseline readings (grants, listener, accessibility, pairing, `scripts/link-up.sh`), one
   `install -r` of the Stage A build, restart `MainActivity` by name, same readings again.
5. Quit the Mac app (⌘Q), confirm 0 sessions, relaunch the built tree with the v3 dev switch; expect
   `share.file 3` negotiated on both sides and **no** production advertisement.
6. Run the proposal's §10 sequences with the two `SidekickShareTest` images only: two waiting then
   accepted out of order; queue cancel; Disconnect with two waiting. Stop conditions as in §10.
7. Afterwards: disarm, relaunch without switches. Delete nothing.

# Resume here — written 2026-09-25 (13:40): receive window passed live; silent-Send fix built, not installed

> Supersedes the entries below for Feature A. Nothing pushed. Evidence: `docs/testing.md` → *the
> supervised live run* and *The silent second Send*.

1. **Built and proven:** the Mac receive window, live on the SM-S938B — a 100,718-byte synthetic image
   saved with its SHA-256 equal to the phone's, arrival without focus, nothing moved before Accept,
   collision-safe naming, one decision surface. The phone's silent-Send fix (`02d95b3`) is proven by
   tests and mutations only.
2. **Committed:** `f9e86c9` `7fdce44` `5046017` `b047f10` (window), `02d95b3` (phone fix),
   `f6e4ea2` (multi-offer proposal), and this record. Phone 776/0, Mac 1168/0, guards 0.
3. **Half-built:** nothing. **Not built:** automatic acceptance (waits on the §4.1 contract decision),
   sounds (cannot honour Focus), multi-offer (proposal only).
4. **Needs the owner:** approve installing `02d95b3` on the Samsung and a supervised re-test of the
   busy sheet; decide §4.1; decide sounds.
5. **Next:** install and test `02d95b3`, because the silent Send is the one user-visible defect found live.
6. **Left on devices:** Mac dev app running this build, connected. Receive folder: 24 entries, including
   files the owner sent and accepted during the run; two gradient copies moved to the Trash **by the
   owner**. Nothing deleted, opened or moved by me. Phone unchanged (11:44 build), staging empty.

# Resume here — written 2026-09-25 (afternoon): the Mac receive window; automatic acceptance waits on one approval

> **Supersedes the two reports below for anything about the Mac's receiving experience.** Nothing is
> pushed. Map: `docs/feature-a-receive-window.md`. Evidence: `docs/testing.md` → *Feature A receive
> window*.

1. **Built and proven (automated + a harness driving the compiled window with synthetic data):** the
   receive window (`7fdce44`) — appears without focus (Finder stayed frontmost), the one decision
   surface, closing ≠ declining; receiver-measured progress, Cancel / Give up / Try again, Open and
   Show in Finder on the re-verified publication, QuickLook thumbnails of the saved file (`5046017`).
2. **Committed:** `f9e86c9` map · `7fdce44` window · `5046017` progress/completion · plus the guard and
   docs commit after it. Mac 1168/1168, phone 766/0 (re-executed), both `tsc` clean, all guards 0.
3. **Half-built:** nothing. **Not built:** automatic acceptance (step 3) and sounds (step 5).
4. **Needs the owner:** (a) approve or reject the contract wording in the map's §4.1 — automatic
   acceptance makes `share.ask`'s promise to the phone false unless the contract is reworded; (b) a
   supervised live send from the Samsung through the new window (steps below); (c) a decision on
   sounds, which cannot respect Focus / Do Not Disturb.
5. **Next:** the live run in (b), because nothing in the new window has seen a real phone. Then step 3
   if (a) is approved.
6. **Left changed on devices:** the Mac dev app was relaunched on this build (no switches) and
   reconnected to the SM-S938B at `share.file 2` + `share.ask 1`. Nothing sent, installed or touched
   on the phone. The scratch harness is stopped.

**Demo, when approved:** unlock the phone → Gallery → share a photo → Sidekick → Send to Mac. The Mac
shows the small window top-right without taking focus → click it once to focus, then Accept → watch
the progress → *Saved on this Mac* with a thumbnail → Open / Show in Finder. Then send one more and
press Hide: the offer keeps waiting, and the main window's card has **Show**.

# Resume here — written 2026-09-25 (late morning): 3e passed; production Send waits on one approval

> **Current state, supersedes the overnight report below.** Slice 3e passed on the SM-S938B (0 B,
> 4 KiB, N1 refused) — `docs/testing.md` → *Feature A slice 3e*. §11 cleanup is built (`5e20963`) and
> the phone's production fact added closed (`9153fe1`). **Every production gate is still closed**:
> `SHARE_PRODUCTION_READINESS` both false, `Extensions.PRODUCTION_TRANSFER` false. Live state: the
> phone runs the candidate APK `0afc695f…` (disarmed); the Mac dev app runs with **no** switches;
> both sides negotiate `share.file 1`; ordinary Send disabled. The proposed flip and the
> Gallery/My Files steps are in the report of this sitting and wait for the owner.

# Resume here — written 2026-09-25 (overnight): Feature A, up to the live-device gate

> A state report for whoever picks this up. Evidence: `docs/testing.md` → *Feature A overnight,
> 2026-09-25*. Contract: `docs/protocol.md` → Extensions (`share.ask`) and Share. Live run:
> `docs/phase-7-share-3e-runbook.md`.

## 0 · State

**Four local commits on `clipboard-watcher-and-phase-5-close`, nothing pushed.** Code, docs and
automated tests only. No `adb`, no device or emulator touched, nothing installed, no offer sent, no
bytes moved. The running Mac app (pid 82426, started 2026-09-24 18:37) was not quit, relaunched or read.

| Commit | What |
|---|---|
| `015b210` | test-config typecheck: 7 errors → 0 (ambient renderer types; one index access) |
| `7520e8f` | **`share.ask`** — a separate ext key that tells a production Mac (asks a person) from the synthetic-only development Mac. No Mac build can advertise it |
| `0f2de7e` | the phone's Send to Mac sheet after *Ready*: Waiting → Sending → Saved only on the Mac's verified verdict, Unconfirmed, Stopped with a reason; Send enabled only by `share.ask` |
| `de9db75` | the Mac card: saved name said once, compact finished cards, newest offer on top (it was being hidden below finished cards) |

Tests: Mac **1109/1109**; both `tsc` configs clean; phone **763 / 0 failures**; all commit guards green.
Candidate APK unchanged: 95,011,036 bytes, SHA-256 `0afc695f…` (built from `65b66a0`, **not installed**).
Mac free space at the end: ~2.6 GiB.

## 1 · What is still blocked, and on what

- **Ordinary Android Send is still disabled in every live pairing**, by construction: the phone enables
  it only when `share.ask` is negotiated, and `SHARE_PRODUCTION_READINESS` pins both Mac facts false.
- **Production enablement needs two things, and only the first is a run:**
  1. **3e passed on hardware** — the runbook, needing your approval (§3 below).
  2. **Temporary-file cleanup scoped to the receive folder** (runbook §11). This is a *proposed* design
     you have not approved; it decides what may be deleted in a person's own folder, so it was **not
     built**. It needs your decision before anyone writes it.
- **A decision I took that you may want to reverse:** leaving the phone's sheet *after* an offer does
  not withdraw it (a person walking to the Mac often lets the screen switch off). The staged copy is
  still always deleted when the offer ends. Reversing it is one line in `onLeave` plus one test.
- **Unmeasured:** P3 (what the card tray covers in the real window); the Compose sheet itself; the
  `requireAsk` branch inside `ShareFeature.offerStaged` (needs a live session).
- Still open from before: defects 30 (no-thread half), 51; 17/33/38 deferred.

## 2 · For the 3e run, three things changed tonight — read before starting

- **Mac:** `npm start` (runbook §4.6) rebuilds from HEAD, so the Mac will now also log
  `share.ask not advertised — the phone's ordinary Send stays disabled: <3 blockers>`. Expected; the
  first blocker names the open development gate. **`share.ask ADVERTISED` would be a STOP.**
- **Phone:** the verified candidate APK predates tonight, so it writes **no** `ext: share.ask …` line —
  expected (runbook §4.8 note). A build from HEAD would write it, and it must say `disabled`.
- **Card:** new offers now appear on top and finished cards are shorter; §7's `onScreen` read should
  come back `visible`.

## 3 · Morning checklist — the supervised Samsung → Mac synthetic transfer (runbook 3e)

Run with you present and the phone unlocked. Every step is the runbook's; this is the order.

1. **Approve**, in words, before step 3: *"Run 3e: install the verified candidate APK on the SM-S938B,
   relaunch the Mac app with the three development switches, arm `share.file 2` once, send the 0-byte
   and 4,096-byte synthetic probes into the scratch folder, and run N1."* Also say which APK: the
   **verified candidate `0afc695f…`** (my recommendation — already checked against §4.3, and Send is
   disabled in it anyway) or a fresh build of HEAD (then §4.3 must be re-run on the new file).
2. Free space: `df -m /System/Volumes/Data` ≥ 1024 MiB (was ~2.6 GiB); `cd desktop && npm test` green.
3. §4.1 `scripts/target-device.sh samsung` → `OK target RZCY12330DT (SM-S938B, sdk 36)`.
4. §4.3 re-check the APK you chose (package, certificate `d3a505d2…7d26`, `ShareDevV2Activity` + DUMP).
5. §4.4 baseline (user-0 grant **names**, listener, accessibility, pairing, `link-up.sh` with
   `ANDROID_SERIAL=RZCY12330DT`) → §4.5 install `-r`, restart `MainActivity` by name, same readings again.
6. §4.6 quit the Mac app (⌘Q), confirm 0 sessions, relaunch with the switches and the two digests.
   Expect `ADVERTISED (development, synthetic-only, scratch folder only)`, the new `share.ask not
   advertised` line, and a first handshake negotiating **1**.
7. §4.7 inventory `~/Downloads/Sidekick` and the configured folder; no `dev-share-receive` yet.
8. §4.8 Disconnect → 0 sessions → arm once → no handshake → Connect once → both sides negotiated **2**,
   exactly one `ext: phone advertises` line since the arm.
9. §5.1 0 bytes, then §5.2 4,096 bytes — every pass line, digests `e3b0…b855` and `1506…80d6`,
   `share-temporary-files.json` = `[]`, inventory unchanged.
10. §6 N1 (100,000 bytes, unlisted) → declined `not-available`, no card, no file.
11. §7 read the card through `probe.mjs`. §8's stop table applies throughout.
12. Afterwards: disarm, quit the Mac app so the next launch is without switches. Delete nothing.

If 3e passes, flipping `syntheticRunPassed` is a separate reviewed commit that records the evidence;
it does **not** enable Send on its own — §11 still blocks it.

## 4 · Things a reader should know

- The harness for the card review is in the session scratchpad and is not committed; its readings and
  screenshots are (`docs/evidence/feature-a-card-2026-09-25/`). Two of its first readings were
  instrument faults (animation mid-flight; a 673 px headless viewport) and are recorded as such.
- `PRODUCT.md`, `skills-lock.json` and the untracked design files were not touched or committed.
