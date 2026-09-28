# Feature A version 3 — supervised hardware runbook (Run A, then Run B)

> **Status: written 2026-09-28, NOT RUN, NOT AUTHORISED.** Nothing here has been done to either device.
> Every numbered action under *Approvals* needs the owner's yes, at the time, for that action. The
> contract is `docs/protocol.md` → Share → Version 3 (PROPOSED); the arguments are
> `docs/feature-a-multi-offer-proposal.md` rev 4 (§10, §11, §12, §19). Where this runbook and the
> proposal disagree, the proposal wins and this file is wrong.

> **Overnight update, 2026-09-28 (03:30) — read before resuming. Facts, not passes.**
> - **Run A so far** (`docs/testing.md` → *Version 3 Run A* and *Run A after 02:31*): M3 done; two simultaneous
>   waiting offers were seen at 02:36 — **of one file twice** (100,718 B), accepted in arrival order, `0 ahead`
>   both times, both saved equal to the source. **A1 as written (two different files, accepted out of order)
>   has not been run.** A2–A4 not run. The Mac still runs pid 5021 with `shareV3`; the phone is still armed-and-
>   consumed on the 02:25 session.
> - **The installed phone build does not have tonight's commits** (`8690e1f`, `e916f66`): no repeat refusal, no
>   session pin, no grant probe, no component switch. Run A does not need them; **Run B does** — rebuild, then a
>   fresh P1 before Run B.
> - **P3 is refused by the shell.** `pm enable` of these components fails with `SecurityException: Shell cannot
>   change component state` — on the SDK 37 emulator, and **measured on the SM-S938B on 2026-09-28, 11:41:48**.
>   Use the app's own switch (debug, DUMP-gated), which both accepted:
>   `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyComponentsActivity --es component many --ez on true`
>   and for P3′ the same with `--ez on false` (restores the manifest default). It logs
>   `component many: default → enabled (asked enabled)` under tag `ShareManyComponents` and in `link.log`.
> - **P6's instrument is built**: `ShareManyGrantProbeActivity` (component `probe` in the switch above), disabled.
>   Procedure in §5.1 below. Emulator readings exist and are emulator evidence only.

> **PAUSED 2026-09-28 20:29 IST, at the baseline. Nothing armed, launched or offered.** Every check passed except
> the phone's free space: **10,047,544 KiB of 478,509,056 KiB (2%)**, down from 18 GB at 15:0x.
>
> With a copy already held, a second copy is admitted only when usable space clears the provisional floor
> `⌈3%·T⌉ + 1 GiB` (`ShareAdmission.PROVISIONAL_DEV_CANDIDATE`). On this phone the floor is 15,773,540,025 B.
> Below it `A − H < 0`, so `spaceLimit` returns −1 and file 2 would be refused `OVER_SPACE_BUDGET` (measured
> limit 0), whatever the quota. So two waiting cards cannot form and A1 cannot run.
>
> The drop is not Sidekick's: at 20:38 its cache was 11 KiB and staging 4 KiB (0 files), `SidekickShareTest`
> was 332 KiB and `SidekickGrantP5` 116 KiB. **The cause is unknown** and, by the owner's instruction, not
> investigated beyond those areas.
>
> **Resume only when the owner says the phone has room** — roughly 16.1 GB free is needed (the floor, plus the
> 256 MiB margin, plus the file). Then retake this whole baseline and proceed only if the admission check
> passes. The floor is not to be changed.
>
> **Superseded 2026-09-29 (owner, Option B):** the development floor is now a fixed 1 GiB reserve (`b641aca`),
> installed on the phone at 02:26:42 (`f8dca91` build). Retake the whole A1 baseline against it before P2.

> **Run A, step A1 — the exact supervised sequence (written 2026-09-28 15:3x IST). Not run, not
> authorised: every step marked P or M is the owner's yes, at the time.**
>
> **Builds, as they stand:**
> - **Mac `desktop/dist`** = a `git archive` build of **`967117b`**, tree digest **`cb74d20d6de3172e`** (method:
>   SHA-256 over `find . -type f` sorted, first 16 hex; it reproduces the old build's `e604479d0c471925`). It
>   carries F4 (`e19f642`), the v3 Close label (`4498d4b`) and `shareV3`. The Mac app is **stopped**.
> - **Phone:** the P1 install of `491cd21` (`lastUpdateTime 11:34:59`). Phone runtime changes since are verbatim
>   moves only (`c8df24b`, `1f86ab8`), so no P1 is needed.
> - **Files:** `Pictures/SidekickShareTest/sidekick-share-test-001.png` (**file 1**, 100,718 B, `d5cfb8a3…c9ff`)
>   and `…/sidekick-share-test-image.png` (**file 2**, 230,778 B, `1afc71b6…c84c`), both hashed on the SM-S938B.
>
> **0 · Baseline (read-only, the harness).** Stop here and restore (§R) on anything unexpected.
> - `scripts/target-device.sh samsung` names `RZCY12330DT`.
> - `scripts/link-up.sh`: checks 1–2 OK. Check 3 FAILS, as expected, with the Mac app stopped.
> - No Electron process of this repo is running.
> - `desktop/dist` digest is `cb74d20d6de3172e`.
> - Mac free space is ≥ 3 GiB.
> - Phone `cache/share-staging` is empty.
> - Both files re-hashed on the phone.
> - `~/Downloads/Sidekick` listed with every size and SHA-256.
>
> **1 · P2 — arm the phone** (the Mac is quit, so no handshake can spend the arm):
> `scripts/adb-pinned.sh samsung shell am start --user 0 -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez on true`
> - **Pass:** phone `files/logs/link.log` has `debug share.file 3 ARMED for the next trusted handshake only
>   (debuggable build: true) — reconnect the Mac for it to take effect`.
> - **Fail:** go to §R, steps 2 and 6 only.
>
> **2 · M3 — launch the Mac with version 3**, from `desktop/`:
> `CONNECTSUITE_DEBUG_SWITCHES=shareV3 nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &`
> - **Pass:** `~/Library/Application Support/sidekick-desktop/logs/sidekick.log` has `share.file 3 ADVERTISED
>   (development only; every offer held for a person) — this is not a normal run`.
>
> **3 · Read back the first handshake (read-only).**
> - **Pass:** Mac `negotiated {…"share.file":3…}`; phone `armed for this handshake: true; debuggable build: true;
>   phone advertises share.file 3; negotiated share.file 3`.
> - **Control, before believing any zero:** grep the same logs for `ext: phone advertises`.
> - **Fail** (`share.file` is not 3 on both sides, or `share.file 3 NOT advertised: …`): read the reason, edit
>   nothing, and go to §R.
>
> **4 · P4 — the owner shares file 1, then file 2.** Gallery → `SidekickShareTest` → the file → Share →
> **"Send to Mac"**. Never "Sidekick grant probe (debug)" or "Sidekick staging proof (debug)". Share one file
> at a time, leaving the first sheet to share the second.
> - **Pass:** two cards in one receive window, and focus not taken. **No `fs.transfer.begin` before an Accept.**
> - With two cards the window is ≈ 401 px, under its cap, so F4's reveal and indicator are not expected.
>
> **5 · M4 — the owner accepts file 2, then file 1.** The window opens unfocused, and its first click only
> focuses it (`acceptFirstMouse` is off). So: click the window once, then **Accept** on file 2 (230,778 B), then
> **Accept** on file 1.
> - **Pass:** file 2 pulls first, then file 1.
> - Each saved SHA-256 equals its phone source.
> - Collision-safe names; at most one partial at any sample.
> - The phone shows *Saved on {Mac}* only after the acknowledged verdict.
> - If a queue forms, file 1 reads *"Accepted — waiting its turn"* / *"1 transfer is ahead of it."*; if none
>   forms, record that — it is not a failure.
>
> **Stop at once** (owner declines anything pending, then §R) if any of these happen:
> - an offer whose name or size is not file 1 or file 2;
> - any pull before an Accept;
> - any change to a pre-existing file in `~/Downloads/Sidekick`;
> - `share.file` other than 3;
> - free space below 3 GiB;
> - anything the steps do not predict.
>
> **§R · Restore version 2 — always, including after a failed preflight.**
> 1. **M5** — the owner quits the Mac app (⌘Q). Pass: no Electron process of this repo.
> 2. **P2′** — `scripts/adb-pinned.sh samsung shell am start --user 0 -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez on false`.
>    Pass: `debug share.file 3 disarmed (debuggable build: true); the phone advertises its normal share.file`.
> 3. **M5** — relaunch without switches, from `desktop/`:
>    `nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &`.
>    Pass: **no** `share.file 3 ADVERTISED`, and `ext: this Mac advertised {…"share.file":2…}`.
> 4. **Read-only.** Phone: `armed for this handshake: false; …; negotiated share.file 2`. Mac:
>    `negotiated {…"share.file":2…}`.
> 5. **Read-only.** Staging empty; ledger `[]`; free space; `~/Downloads/Sidekick` compared with the baseline
>    (the new saved files named, nothing pre-existing changed).
> 6. **If step 1 failed** (the Mac was never launched): step 2 only, then `link-up.sh`. The arm is memory-only
>    and one-shot either way.
> 7. **If the owner wants `dist` back at `491cd21`:** `git archive 491cd21 desktop`, build in scratch, then
>    `rsync -a --delete` into `desktop/dist`, with the Mac quit. Expected digest: `e604479d0c471925`.
>
> No install, component switch, file creation, deletion or force-stop at any step.

Two runs, **in two separate sittings**, in this order:

- **Run A — the version-3 queue, from two separate single-file shares.** Proves several pending offers,
  one receive window, a per-file Accept or Decline, and pulls in Accept order — with the single-file
  sheet the owner already uses. The multi-file screen stays disabled throughout.
- **Run B — a Gallery / My Files multi-select.** Only after Run A has passed and been restored. It is the
  first time the review screen is ever drawn.

Each run ends with **Restore version 2** (§6), including after a stop.

---

## 1 · What is on each device today (and what is not measured)

| | State | How it is known |
|---|---|---|
| Mac dev app | pid 93018, launched 2026-09-26 12:53:45, `dist` built 12:53:08 from `f71285b` | `ps`, `stat`, 2026-09-28 01:00 |
| Mac `dist` and version 3 | **cannot advertise `share.file 3` at all**: `shareV3` occurs **0** times in `dist/main/main.js` and `shareV3Activation` **0** times in `dist/main/shareActivation.js` (control: `shareV2` 11 times in the same file; `shareV3Activation` twice in the source) | `grep -c`, 2026-09-28 |
| Phone | debug APK from `f71285b`, per the 2026-09-26 record (`docs/testing.md`) — **not re-read**; the phone was not addressed on 2026-09-28 | record only |
| Phone and version 3 | the installed `f71285b` build has **no** `ShareDevV3Activity` and no multi-file screen: both are uncommitted Stage 1–2 work | `git status` |
| Tonight's artifacts | debug `app/build/outputs/apk/debug/app-debug.apk` (SHA-256 `b017c886d09079d5…`), release `…/release/app-release.apk` (`06be16a214b860e7…`) — **from an uncommitted tree**; rebuild after the commit and record the new digest at install time | `shasum`, 2026-09-28 01:00 |

**So both runs need a Mac build into `dist` and a phone `install -r` first.** Committing the Stage 0–2 work
before either is recommended, so the installed build and the Mac's `dist` each name a commit.

## 2 · Approvals needed — each one separately, at the time

**Mac**
- **M1** `npm run build` in `desktop/` — overwrites the running app's `dist`.
- **M2** Quit the dev app (the owner presses ⌘Q). **This dismisses the card still visible.**
- **M3** Launch it with `CONNECTSUITE_DEBUG_SWITCHES=shareV3` (§3).
- **M4** Accept / Decline / Cancel / Disconnect on the Mac — **the owner's own clicks**; the harness clicks
  nothing.
- **M5** Quit and relaunch **without** switches (§6).

**Phone (SM-S938B, every write through `scripts/adb-pinned.sh samsung …`)**
- **P1** `install -r` of the debug APK, then `am start` of `MainActivity` by name.
- **P2** Arm version 3 (`ShareDevV3Activity --ez on true`); **P2′** disarm (`--ez on false`).
- **P3** Run B only: enable the multi-file component; **P3′** return it to its manifest default.
- **P4** The owner's taps in Gallery / My Files and on the phone's sheet.
- **P5** Run A step A3 / Run B, only if the second synthetic image is not already on the phone: putting
  one generated file on it (§4, *Files*).
- **P6** Run B, only if wanted: the §11 grant measurement (§5.1) — instrument built 2026-09-28 (`e916f66`), needs the rebuilt debug APK; enabling it is a P3-type action on the `probe` component.

**Not needed and not to be done:** any deletion, any `am force-stop` (the hook refuses it), any change
to pairing or permissions, any personal media, any `pm clear`.

## 3 · Arming — exact order, and why the order matters

The phone's arm is **consumed by the next trusted handshake** and lives in memory only. The phone
reconnects often (44 handshakes in one day, `docs/phase-7-share-3e-runbook.md` §1), so an arm made
while the Mac is connected can be spent by an automatic reconnect before the relaunch. **The Mac
connects out (locked decision 2), so while the Mac app is quit no handshake can happen at all.** Hence:

| # | Who | Action | Pass — read back before the next step |
|---|---|---|---|
| 0 | read-only | Baseline (§4) | every reading recorded |
| 1 | M1 | `cd desktop && npm run build` | exit 0; `grep -c shareV3 dist/main/main.js` > 0 |
| 2 | P1 | `scripts/adb-pinned.sh samsung install -r app/build/outputs/apk/debug/app-debug.apk` then `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity` | `scripts/link-up.sh` 3/3 — **never** a grep for `Listening on` (CLAUDE.md banner) |
| 3 | M2 | owner quits the Mac app (⌘Q) | `pgrep -f node_modules/.bin/electron` empty |
| 4 | P2 | `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez on true` | phone `files/logs/link.log`: `debug share.file 3 ARMED for the next trusted handshake only (debuggable build: true) — reconnect the Mac for it to take effect` |
| 5 | M3 | from `desktop/`: `CONNECTSUITE_DEBUG_SWITCHES=shareV3 nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &` | Mac `~/Library/Application Support/sidekick-desktop/logs/sidekick.log`: `share.file 3 ADVERTISED (development only; every offer held for a person) — this is not a normal run` |
| 6 | read-only | the first handshake after step 5 | Mac: `ext: this Mac advertised {…"share.file":3…}` and `ext: phone advertises …; negotiated {…"share.file":3…}`. Phone: `ext: share.file 3 (development) — armed for this handshake: true; debuggable build: true; phone advertises share.file 3; negotiated share.file 3` |

Every quoted string is copied from the code that writes it (`ShareDevV3Activity.kt`, `main.ts`,
`link.ts`, `Extensions.kt`), not typed from memory. **Before relying on a zero**, grep the same log for a
string known to be there (e.g. `ext: phone advertises`) — CLAUDE.md, *a pass criterion naming a string
the code does not write*.

**Stop at step 6 if** `share.file 3` is not negotiated on **both** sides, or if the Mac says
`share.file 3 NOT advertised: …` (read its reason; do not retry by editing anything). Then go to §6.

## 4 · Baseline and bounds (both runs)

**Read-only, announced before running:**
- `scripts/target-device.sh samsung` names the SM-S938B; `scripts/link-up.sh` 3/3.
- Mac free space: **≥ 3 GiB (the owner's floor) and ≥ 2,048 MiB stable over 30 s** (§19); stop below
  3 GiB or on a fall of more than 500 MiB inside a run.
- Phone `cache/share-staging` empty; Mac share ledger `[]`; no pending offer on either side.
- The receive folder `~/Downloads/Sidekick` listed with every size and SHA-256.

**Files — synthetic only.**
- `Pictures/SidekickShareTest/sidekick-share-test-001.png`, **100,718 bytes**, SHA-256 `d5cfb8a3…c9ff`
  — recorded on the SM-S938B on 2026-09-26.
- A **second** file of a different size. §10 names the 230,778-byte `sidekick-share-test-image.png`,
  but that file is recorded **on the emulator only**; its presence on the SM-S938B is **unknown**.
  Check by listing `Pictures/SidekickShareTest/` (read-only). If it is absent, putting one generated
  image there is approval **P5**; do not substitute any other file.

**Bounds:** ≤ 30 minutes per run; no deletion; no harness click on either device.

## 5 · The runs

### Run A — two separate single-file shares (the version-3 queue)

Each share is the ordinary single-file sheet: Gallery → one image → Share → Sidekick → **Send to Mac**.
The second share is an **extra copy** (`Σ > 0`), so it is admitted by the §4 per-copy budget; if the
sheet shows *No room for another file yet* with a limit, that is a finding (record the limit), not a
failure to retry.

| Step | The owner does | Pass |
|---|---|---|
| **A1 · two waiting, answered out of order** | Share file 1, then file 2. On the Mac: **Accept file 2**, then **Accept file 1**. | Two cards, one window, focus not stolen. **No pull before an Accept.** File 2 pulls first, then file 1; each saves. Each saved SHA-256 equals the phone's source; collision-safe names; at most one partial at any sample. *Saved on {Mac}* on the phone only after the acknowledged verdict. **If a queue forms** (file 1 accepted while file 2 is still pulling — see the note below the table), file 1's Mac card is expected to read *"Accepted — waiting its turn"* / *"1 transfer is ahead of it."* until it starts |
| **A2 · a queued file cancelled** | Share both again; Accept file 1, then file 2 (the visible phone sheet is file 2's); **Cancel** the queued one before it starts. | **Only if a queue forms.** Expected: the Mac card *"Accepted — waiting its turn"* / *"1 transfer is ahead of it."*; the phone sheet *"Accepted on {Mac} — waiting its turn"* / *"It starts on its own when the file ahead of it finishes. Nothing of it is on your Mac yet."*, with no progress bar, never *Sending*. After Cancel it never pulls (no `fs.transfer.begin` for its id); its phone copy is deleted; the other saves. If no queue forms, record that and skip the Cancel — it is not a failure |
| **A3 · Decline one of two** | Share both; **Decline** one, **Accept** the other. | The declined one: the phone sheet *"Declined on {Mac}"* / *"Someone on {Mac} declined it. Nothing was sent."*; the Mac card *"Declined"* / *"Nothing was saved."*; its copy deleted, nothing written on the Mac; the other saves. This is the per-file decision the multi-file design depends on |
| **A4 · disconnect with two waiting** | Share both; press **Disconnect** on the Mac (a Mac action; no phone setting touched). | Both cards *Ended with the connection*; phone staging empty; Mac ledger `[]`; nothing published |

**Expected wording, not observed.** Every quoted string above is copied from the code on 2026-09-28
(`shareReceiveCopy.ts`, `ShareToMacCopy.kt`); none has been seen on hardware yet. The phone's queued line
is the fix made the same day and is in the build only after it is committed, rebuilt and installed.

**What two small images can prove, and what they cannot.**
- **They can prove two simultaneous waiting offers**: both files offered before any decision — two cards
  in one window, each with its own Accept and Decline, on a session that negotiated `share.file 3`. That
  is the version-3 change, and it needs no timing luck.
- **They prove an accepted-behind-active-transfer queue only if one is actually observed.** A file is
  queued only when it is accepted while another file of the same session is still being pulled or
  checked. With 100,718 B and 230,778 B a pull likely ends before a second click, so A1 and A2 may show
  no queue at all. Record which happened, from the Mac log (a `queued` state, or `filesAhead`); a queue
  that did not form is **not** a failure, and it is **not** evidence that queueing works either.
- **Nothing is created or sent to force one.** A larger synthetic file would make the queue likely; it is
  a separate approval (P5), and it is not part of Run A.

If a queue does form, the phone sheet of the queued file shows **no progress bar** and the waiting line
above; had the connection ended then, it would read *"{Mac} disconnected"* / *"The connection to {Mac}
ended while it was waiting its turn. Nothing was sent."* — expected from the code, not observed.

**Each phone sheet closes when you leave it** to share the next file (`onStop`), so only the most
recently shared file's sheet is on the phone's screen; the earlier file is followed on the Mac.

**Evidence per step:** each card's text **before** its decision (`scripts/probe.mjs`, read-only CDP);
the phone lines `offered s-… to …`, `offer s-… is …`, `offer s-… ended (…)`; the Mac `[share]` and `[bulk]`
lines; the receive-folder listing before/after with SHA-256; phone staging listing after each step.

**Stop conditions (Run A):** an offer whose name or size is not one of the two files; any pull before
an Accept; any change to a pre-existing file in the receive folder; `share.file` other than 3 on either
side; free space below the floor; anything on either screen the steps above do not predict. On a stop:
Decline anything pending (owner), then §6.

### 5.1 · The §11 grant measurement (P6) — run once on the SM-S938B (2026-09-28, P5, two PDFs)

Synthetic files of **one type** only. **Measured on this phone, 2026-09-28** (`docs/testing.md` → *Run B P1–P4*
and *P5*): My Files shares **images** in `Pictures` as MediaStore URIs (`authority=media`), which read
`CONFOUNDED` while Sidekick holds `READ_MEDIA_IMAGES`; it shares **PDFs** through its own
`com.sec.android.app.myfiles.FileProvider`, which no Sidekick permission opens. Use the generated PDFs in
`Download/SidekickGrantP5`. The shell's `pm enable` / `pm default-state` are **refused** on this phone
(`Shell cannot change component state`) — use the in-app switch (`ShareManyComponentsActivity`) only.

**Leaving the probe screen by any route — Home, Back, Finish, the screen timing out — starts timed reads.** So the
owner shares only after the harness says the watcher is ready, and leaves only after the harness confirms both
controls. (On 2026-09-28 the P5 share began before the log mark and the screen stopped before the controls were
confirmed; the reading was kept as a bounded measurement, and this order is the correction.)

| # | Who | Action | Reading / gate |
|---|---|---|---|
| 1 | P3 | enable `probe` with the in-app switch (`--es component probe --ez on true`) | `component probe: default → enabled`; `query-activities -a SEND_MULTIPLE -t application/pdf` lists `ShareManyGrantProbeActivity` and **not** `ShareManyToMacActivity` |
| 2 | harness | re-hash the files on the phone; take a **fresh log mark** from the phone's clock (`date +%s`); start the watcher; tell the owner **"watcher ready"** | the mark recorded; control: `logcat -T` on an earlier mark returns lines |
| 3 | P4 (owner) | **only after "watcher ready":** My Files → `Download/SidekickGrantP5` → select exactly the two PDFs → Share → **Sidekick multi grant probe (debug)**. **Stay on the probe screen.** | `intake` (`items=2`, a PDF type, the authority) and two `phase=CONTROL` lines, all after the mark |
| 4 | harness | compare each control's bytes and SHA-256 with the named files; tell the owner **"both controls match"** — or **"invalid — stop"** (then the owner leaves whenever ready, and the run is recorded as wrong input) | an explicit message; a mismatched digest is never kept |
| 5 | P4 (owner) | **only after "both controls match":** press **Home**; wait about 3 minutes | `phase=STOPPED` ×4 and its verdict; the screen then finishes itself; `phase=FINISHED` ×6 to +120 s and its verdict |
| 6 | P4 (owner, optional, a separate share with steps 2–4 repeated) | rotate once, then **Finish** | `phase=RECREATED` ×2, then `phase=FINISHED` |
| 7 | P3′ | the switch with `--ez on false` | `component probe: enabled → default`; no component overrides; no Sidekick `SEND_MULTIPLE` resolver |

Control: each control digest must equal the file's own SHA-256 (listed read-only beforehand); a control that
fails means **no reading**, not a refusal. The probe writes nothing and sends nothing to the Mac. A second share
while a run owes readings is refused before anything is read (`a run is still taking readings — this share is
ignored`).

### Run B — a Gallery / My Files multi-select (a later sitting)

**Gate:** Run A passed **and** was restored. Proposal §19 also puts the §11 `SEND_MULTIPLE` grant
measurement first. **Its instrument exists since 2026-09-28 (§5.1)**; the owner decides between running it
first, or waiving it for this first run on the ground that the screen reads a shared URI only while it is
alive and fails closed when it is not (§11, and the close-versus-open gate tested on 2026-09-28). Either way
it is recorded as a decision, not skipped silently.

**Enable, only for the run (P3)** — with the in-app switch. (This step first read `pm enable …`; the shell's
`pm enable` is **refused on this phone**, measured 2026-09-28 11:41:48, and must not be used.)

```
scripts/adb-pinned.sh samsung shell am start --user 0 -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyComponentsActivity --es component many --ez on true
```

Read back: the log line `component many: default → enabled (asked enabled)`; `dumpsys package
com.chetan.connectsuite.debug` lists only `ShareManyToMacActivity` under `enabledComponents`; and
`cmd package query-activities --user 0 -a android.intent.action.SEND_MULTIPLE -t image/png` lists it and **not**
`ShareManyGrantProbeActivity`. **Control:** `query-activities --user 0 -a android.intent.action.SEND -t image/png` still lists `ShareToMacActivity`.

| Step | The owner does | Pass |
|---|---|---|
| **B1 · two images, individually decided** | Gallery → select the two synthetic images → Share → Sidekick. Read the review screen, then **Send 2 files**. On the Mac, Accept each card separately. | Review lists exactly 2 names and sizes; nothing copied before Send (`selection of 2 files for review: … nothing copied`); `selection of 2 started at share.file 3; one copy at a time`; two `selection item i/2 attempt=s-… bytes=…: Offered` lines; two cards, each with its own Accept/Decline; the summary never says *saved* before the Mac's verdict; *All 2 saved on {Mac}* only when both are |
| **B2 · leaving the screen** | Share both again; press Send; as soon as the first row reads *Waiting for you to accept*, press **Home**. | Offered files continue on the Mac; any file not yet offered becomes *Not sent — The share screen closed before it was prepared.*; phone log `selection ended (ScreenClosed): …`; **no `selection item` line after it**; staging holds only the offered copies |
| **B3 · one file** | Gallery → select **one** image → Share → Sidekick. | The single-file sheet, word for word (§15) — not the review screen |

Not in Run B, deliberately: waiting-for-room live (needs a file larger than the day's measured
`min(Bq, Bs)`, i.e. a large generated file — a separate approval), the 10-minute stall clock (it would
take 10 minutes of a held offer), and My Files (add as B4 with a synthetic PDF only if B1–B3 pass).

**Stop conditions (Run B):** as Run A, plus: the review lists anything not selected; the review screen
opens for a single file; any `selection item` line after `selection ended`; any row saying *Sent* or
*Saved* before the Mac's verdict.

## 6 · Restore version 2 — always, including after a stop

| # | Who | Action | Pass |
|---|---|---|---|
| 1 | M5 | owner quits the Mac app (⌘Q) | no Electron process of this repo |
| 2 | P2′ | `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareDevV3Activity --ez on false` | phone log `debug share.file 3 disarmed (debuggable build: true); the phone advertises its normal share.file` |
| 3 | P3′ (Run B only) | the in-app switch: `scripts/adb-pinned.sh samsung shell am start --user 0 -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.ShareManyComponentsActivity --es component many --ez on false` | log `component many: enabled → default`; the component in **neither** `enabledComponents` nor `disabledComponents` (back to the manifest's `enabled="false"`); no Sidekick `SEND_MULTIPLE` resolver; control as above |
| 4 | M5 | from `desktop/`: `nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &` — **no** `CONNECTSUITE_DEBUG_SWITCHES` | Mac log has **no** `share.file 3 ADVERTISED`; `ext: this Mac advertised {…"share.file":2…}` |
| 5 | read-only | first handshake | Phone: `ext: share.file 3 (development) — armed for this handshake: false; …; negotiated share.file 2`. Mac: `negotiated {…"share.file":2…}` |
| 6 | read-only | final readings | staging empty, ledger `[]`, free space, receive folder listed — compared with §4's baseline |

**Historical, do not use:** this step first used `pm default-state`, with `pm disable` as its fallback. On this
phone the shell's `pm enable` was refused on 2026-09-28 (11:41:48) inside `PackageManagerShellCommand.runSetEnabledSetting`,
the handler `default-state` and `disable` also use — so expect the same refusal (read from that stack trace, not
separately run). The in-app switch above restores
`COMPONENT_ENABLED_STATE_DEFAULT` and was read back that way on 2026-09-28 (11:50:38 and 12:16:53, for the probe).

**After restore, `dist` is still the version-3-capable build** (switch off). That is inert — the switch
is read only at launch, is forced off when packaged, and needs `share.ask` open — but it is not the
`f71285b` build that ran before. Returning `dist` to a named commit is a scratch build plus `rsync`
(memory note *desktop/dist is the running app*), and is the owner's call.

## 7 · The stall clock, as built (for reading rows during Run B)

Development only; 10 minutes of running time and a 60-minute ceiling, both PROVISIONAL. A waiting file's
clock is **paused** when it would be admitted if every accepted (queued, receiving or checking) offer's
copy were released — computed as a **hypothetical** with `Σ' = Σ − b` and `free' = free + b` for those
offers' `b` bytes (owner, 2026-09-28). The credit only decides whether time counts: the file is still
copied only when the accepted offer has really ended and the space is really free, so a *Waiting for {Mac}
to finish an earlier file* row that stays that way while a transfer runs is **expected**, not a stall.
Neither run is long enough to reach either limit; they are proven with synthetic time only.

## 8 · What this runbook does not prove

- The §11 grant lifetime for `SEND_MULTIPLE` (unmeasured; §5 Run B gate).
- The stall clock on hardware — it is proven only with synthetic time (`docs/testing.md`, 2026-09-28).
- Any Samsung Gallery / My Files behaviour beyond these files on this one phone
  (`docs/single-device-audit.md`).
- Production values of any limit. Every number here is PROVISIONAL, development only (§20.6).
