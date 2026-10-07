# Release-verification run — 2026-10-08 (owner present, phone connected)

**Status of this file:** Phase 0 (reconciliation and the canonical matrix) and Phase 1 (code, tests and isolated
builds while the defect 199 soak runs) are written. Phase 2 (hardware) is a **runbook** below, each stage with its pass
criterion, its stop rule and the approval it needs; results are appended under each stage as they happen. Phase 3 is
the report at the end. **Sidekick is not ready to ship** — see the verdict.

Labels used everywhere in this file, and nowhere loosened:

- **hardware-verified** — read on the SM-S938B + this Mac with a control, *naming the build pair*. ⚠ = verified on a
  build older than the code now deployed or about to be.
- **tests-only** — automated tests (and mutations) pass on the current tree; no hardware reading of this code.
- **not run** — no reading of any kind. **blocked** — cannot run without something only the owner can supply.

## 0. Revisions — what is committed versus what is deployed (00:08 IST)

| | Revision | Note |
|---|---|---|
| Branch HEAD at start | `ccc185d` (defect 200 quit coordinator, code only) | |
| Mac, running | dev `desktop/dist` from **`bf096e1`** (`0c074f7d…`), PID 88287 since 2026-10-07 10:39:53 | does **not** carry 200, 201–204, F1, F2 |
| Phone, installed | debug APK from **`c05efcc`** (`0d42e27d…`), user 0, since 2026-10-07 13:56:08 | phone code at HEAD differs only by 202's label |
| Phase 1 commits | `a178bfa` (201), `79b8c5b` (202), `acc119d` (203, 204), `219cb76` (F2), `81ff971` (F1), then the docs commit | local, not pushed |

## 1. T1–T5 (the L1/L2 large-pull tests) — reconciled

All on the synthetic `sidekick-pass-stop-200mb.bin` (`_id` 1000308768, 209,715,200 B, SHA-256 `bf375859…cbbec9`) unless
named. **Every pass below is ⚠** — it predates the deployed builds, and 203/204 change the Mac's pull path again.

| Test | Result | Build pair | Where |
|---|---|---|---|
| **T1** full block pull | **hardware-verified ⚠** — PASS 2026-09-30 (≈13:56), SHA-256 equal | Mac dev before `01ebf3b` / phone 12:01 install | `docs/RESUME.md` → 2026-09-30 14:00 |
| **T2** Pause → Resume | **hardware-verified ⚠** — first attempt NOT RUN (no Pause in the real app → defect 156); **retry PASS 15:20–15:22**: paused at 750/1,600 blocks, no auto-resume in 60 s, Resume from block 750, `(4).bin` SHA-256 equal | Mac `01ebf3b` / phone 12:01 | RESUME → 2026-09-30 15:25; `docs/testing.md` → Defect 156 |
| **T3** Disconnect → Connect | **hardware-verified ⚠** — 15:34 PASS with a finding (the phone streamed on → defect 157); **retry PASS 18:20** after 157's fix: stop in 12 ms, auto-resume at block 640, `(6).bin` equal | both `4095665` | RESUME → 2026-09-30 18:25 |
| **T4** corruption in transit (T4-A) | **hardware-verified ⚠** — PASS 2026-10-01 16:44–16:53: block 800 named, nothing published, `(7).bin.failed` kept, no retry. **T4-B** (a paused partial altered at rest) **not planned, not run** | phone `95a8cdd` / Mac `4c50a4d2…` | `docs/testing.md` → L1/L2 T4-A |
| **T5** source change | **NOT hardware-verified.** T5-B **NO READING** twice (19:58: the send card hid Pause; 23:14: a shell write did not change MediaStore's metadata). The 23:38 changed-source prefix check: **phone refused correctly, Mac mishandled it** → defect 158, fixed `b1f62fc` (tests only), deployed since (it is in `bf096e1`), **never re-run**. T5-A unproven | — | `docs/testing.md` → T5-B, prefix check, Defect 158 |

**The paused partial and `.failed` marker, read 2026-10-08 01:3x (listing of the synthetic names only):** the T5 paused
partial `.sidekick-t5-source-change-200mb (2).bin.sidekick-pull.part` and its resume record are **gone** —
`~/Library/Application Support/sidekick-desktop/pull-resume/` (path confirmed from `main.ts:432`) is empty; how it
went is not established by this read. T4-A's `sidekick-pass-stop-200mb (7).bin.failed` (430 B, 2026-10-01 16:51) is
still there. `(2)`–`(6).bin` (209,715,200 B each) and the T5 source copy remain. Nothing was deleted by this run.

## 2. The canonical matrix — features

Gate = what a **release** build from HEAD does. "HW latest" names the build pair. Stage = where Phase 2 reads it.

| # | Feature | Release gate | Tests | HW latest | **Label now** | Stage |
|---|---|---|---|---|---|---|
| 1 | Pairing v2 (QR secret proven both ways) | on | 15 + 17 + vectors | v2 re-pair 2026-10-06 23:57 (dev builds; scan not directly observed); H4b/H7/H8 not run | **hardware-verified (partial) ⚠** — impostor-first, replay and side-channel binding never run on hardware | 3 |
| 2 | Reconnect & discovery | on | yes | Mac-side outages recovered on last-known 2026-10-07 (v2, no pairing request); Wi-Fi/hotspot/USB matrix **not run** | **hardware-verified (partial)** | 9 |
| 3 | Notifications mirror/reply | on | yes | Phase 4 ⚠ | **hardware-verified ⚠** | — (not in this run's brief; F5 grep owed) |
| 4 | Mac native notifications | on | yes | 2026-09-04 (older packaged ConnectSuite); **dev build refused by macOS** 2026-10-07 | **blocked** for the dev build — needs a signed/packaged build | 13 |
| 5 | SMS/MMS read & reply | on | yes | step 71 ⚠ | **hardware-verified ⚠** | — |
| 6 | New SMS conversation (defect 30) | on (Mac half) | fakes | explicit-address only | **not run** — needs a consenting number | 11 |
| 7 | Calls events/dial/answer/reject | on | yes | step 70 ⚠ | **hardware-verified ⚠** | — |
| 8 | Call audio on the Mac | n/a | — | SCO fails both ways | **platform wall — never claim** | — |
| 9 | Incoming-call banner | off when packaged | 22 + gate | none | **not run** — needs a consenting caller | 10 |
| 10 | Contacts | on | yes | Phase 4 | **hardware-verified ⚠** | — |
| 11 | Media remote | on | yes | step 67 ⚠; defect 38 (volume one-way) | **hardware-verified ⚠** | — |
| 12 | Files Mac → phone (push, resume) | on | yes | **2026-10-07 22:29 on `bf096e1`/`c05efcc`**: one 129 B push into `Download/ConnectSuite`, SHA-256 equal (pinned bulk socket in use) | **hardware-verified (small file only)** | 5, 7 |
| 13 | Files phone → Mac (browse, pull, drag) | on | yes (+203/204) | 2026-10-07 22:30 pull of 129 B `verified=true`; drag-out 22:32; **granted trees list 0 (defect 137)** | **hardware-verified (Download/ConnectSuite only)**; 203/204 **tests-only** | 4, 5, 7, 11 |
| 14 | Block-verified pulls > 64 MiB (`fs.blocks`) | **off** in release | yes | T1–T4 ⚠ (dev runs) | **development-only**; release pulls > 64 MiB are **unverified** and say so | 4 |
| 15 | Photos & video browser | on | yes | 2026-09-23 ⚠ | **hardware-verified ⚠**; *checksum sentence* not run (would need personal photos) | — |
| 16 | Clipboard + history (S7 offers) | on | yes (+F2) | Stage D 2026-10-07 on `bf096e1`/`c05efcc`: Share route, offer, Copy, Restore-over-newer refusal, Dismiss, focus sync (HOT) | **hardware-verified (partial)**; toolbar `PROCESS_TEXT` route and banner display **not shown** | 6 |
| 17 | Mirroring + control | on | yes | 2026-09-10 ⚠; 2026-10-07 two starts ended `consent-timeout` | **hardware-verified ⚠**, current build **not shown** | 8 |
| 18 | Apps list / ask to open | on | yes | 2026-09-03 | **hardware-verified ⚠** | — |
| 19 | Phone → Mac sharing | packaged Mac: `share.file 1` only | yes | dev runs | **gated off / deferred** | 5 (small share only) |
| 20 | Camera v1 | off unless debuggable | yes | 2026-10-02/03 supervised | **hardware-verified ⚠ (debug only), deferred** | 10 |
| 21 | Phone as Mac webcam | off | Swift 140 | spike PASS 2026-10-05 | **deferred — never claim** | — |
| 22 | Activity, Settings, theme, login item | on | yes | 2026-09-16; Activity rewrite **ran** 2026-10-06 23:13 | **hardware-verified ⚠** | 2 |

## 3. The canonical matrix — blockers and open defects (ranked)

| Rank | ID | What | Label | What closes it |
|---|---|---|---|---|
| 1 | **RB1** | No signed build of either app (Mac ad-hoc; release APK unsigned) | **blocked — owner** (Apple Developer Program; release keystore approval) | Developer ID + notarization; a signed APK that installs |
| 2 | **P3 / 188** | Phone copy says *"nothing leaves your network"*; ML Kit + Google `datatransport` (CCT backend) are on the release classpath (structural, re-verified 2026-10-08) | **open — owner decision** | §5 below: disclose with the exact wording, or replace the scanner |
| 3 | **RB5** | No privacy policy, publisher identity or contact | **blocked — owner** | the addendum's skeleton filled in by the owner |
| 4 | **R-199** | `LinkService` killed by the `dataSync` limit | fixed `c05efcc`, installed; **soak running** (end ≥ 06:04:41); static discriminator recorded at install B; dynamic discriminator (emulator) **not run** | end check (stage 0); emulator control |
| 5 | **S1/182 + S2b/189** | pairing authentication; side channels bound to the owning session | **hardware-verified (partial)** — a v2 pair exists; impostor/replay/side-channel cases **not run** | stage 3 |
| 6 | **137** | granted SAF trees list 0 entries | **open** — provider returns an empty cursor; no Sidekick defect found | stage 11 (fresh-grant control) |
| 7 | **30** | new conversation to a number with no thread | **open** | stage 11, consenting number only |
| 8 | **201–204** | drop-sheet keys; root names; space resume; pull progress | **tests-only** (fixed in source, not deployed) | stages 2, 4, 7 |
| 9 | **200** | windowless process after the first Quit | **tests-only**, not deployed; cause not established | stage 2 (the quit itself is the reading) |
| 10 | **S5/184** | fuses + debugging-switch guard | **verified on isolated packaged builds** (static on HEAD 2026-10-08; dynamic harness 2026-10-07); entitlement half needs Developer ID | stage 13 |
| 11 | **S8/186** | quarantine on received files | **measured on a harness**; never on a packaged Sidekick | stage 13 |
| 12 | **U-2** | dependency advisories | **not run** — needs approval to send/download (OSV offline recommended) | owner decision |
| 13 | **U-3** | any phone but the SM-S938B | **unknown** | a second handset (not this run) |
| — | 17, 33, 38, 51 | deferred / reporting-only | unchanged | — |

## 4. Phase 2 runbook — hardware, one stage at a time

**Rules for every stage.** Every state-changing `adb` command goes through `scripts/adb-pinned.sh samsung …` (refuses on
a wrong or ambiguous device). Reads print sizes, hashes and counts — never notification, clipboard, contact, message or
file-name content beyond the synthetic files named here. A stage stops at its first unexplained mismatch, and an
absence is not evidence until its control returned a known positive. The owner taps every consent dialog; nothing
bypasses a consent gate or the Mac's focus/Accept gate.

**Stage 0 — soak end check (≥ 06:04:41), before anything else.** Read-only: newest user-0 exit record (expect
13:56:08.525 `PACKAGE UPDATED`), crash buffer package lines (expect 2, the 07:14 crash), app PID (expect 23946),
`LinkService` createTime older than T0 and `types=0x00000010`, `link-up.sh` three OKs, every claim since T0 `0x10`
(expect none), coverage gaps named (log rotation, monitor checks missed). Pass is about **endurance of the installed
build**, not proof of 199's cause (audit F7).

**Stage 1 — baseline (read-only).** Pin; `pm path` + pull + SHA-256 of the installed APK (expect `0d42e27d…`); signer
`apksigner verify --print-certs` (expect `CN=Android Debug`, `d3a505d2…7d26`); runtime grants count per user;
listener/accessibility settings strings; Mac `dist` manifest hash (expect `0c074f7d…`); `pairing: 2` and
`watchClipboard` from the Mac's store; free space (`df` on `/data` via `dumpsys diskstats`, Mac `statfs` of
`~/Downloads/Sidekick`); no active transfer (Mac log, phone `[bulk]` tail); `Download/ConnectSuite` row count and the
synthetic source's SHA-256 (expect `bf375859…`).

**Stage 2 — deploy.** Phone: `install -r --user 0` of the APK built from the Phase 1 HEAD by `git archive` (same debug
signer; no `-d`, `-g`, uninstall, clear or permission change), then `am start -n …/MainActivity` once and
`link-up.sh`. Mac: quit by the named menu item (the deployed `bf096e1` has no coordinator; if it stalls, that is
defect 200's second sighting — record it, then the second named click), move `desktop/dist` aside into the private
rollback folder (never delete), `ditto` the `dist` built from the same HEAD, verify its manifest, relaunch with
`--force-renderer-accessibility --remote-debugging-port=9222` and **no** `CONNECTSUITE_*` variables (those two flags
are the verification session's CDP access, not release configuration). Compare every stage-1 reading after.
**Pass:** grants, bindings, pairing and watcher unchanged; link up on v2 with no pairing request; 0 E in both logs;
the next quit of the new build logs `[quit] … will-quit reached`.

**Stage 3 — secure re-pair (S1/S2b), approved once by the owner.** Forget on both sides, scan a fresh QR. Cases:
(a) **attacker answers first** — a loopback stand-in that answers the Mac before the phone must be refused and receive
no token (the H7 stand-in does not exist yet; if it cannot be built safely, record **not run**); (b) **no replay
before authentication** — the Mac's log shows no non-handshake message processed before `pair.confirm`; (c) **side
channels bound to the owning session** — a bulk claim with the right token from a second TLS peer is refused. No other
state deleted. **Pass:** `pairing: v2` on both sides, the three refusals logged with counts.

**Stage 4 — T2–T5 on the 200 MiB synthetic source** via the real Files-pane Pause/Resume (CDP by accessible name).
T2 (Pause at 40–60 % by the phone's `sending` report → no auto-resume for 60 s → Resume → SHA-256 equal, partial and
record gone); **new with 204:** the pane's `#files-pull-progress` advances and shows *re-checking* on Resume. T3
(Disconnect at 40–60 % → stop < 2 s, 0 B growth → Connect → auto-resume → equal). T4-A (debug probe armed once →
block named, nothing published, `.failed` kept — note `(7).bin.failed` already exists, so the free-name rule must be
re-checked at preflight). T5 needs a stimulus MediaStore reflects (runbook revision 2 failed on metadata) — **design
before running**; if none is safe, T5 stays **not run**. Each with before/after receive-folder inventory.

**Stage 5 — small files both ways.** Synthetic files only: push one and three (multi-select in Gallery/My Files share
on the phone) → Accept / Decline / Cancel each once on the Mac's receive window; collision names `name (2)`;
SHA-256 on both ends.

**Stage 6 — clipboard S7.** Offer, Copy, Dismiss, Restore-over-newer, duplicate Copy — synthetic markers, helper prints
only which marker. Then the toolbar route: in a genuine in-app test note, long-press → enumerate the toolbar through
`uiautomator dump --windows`; if *Send to Mac* is offered, tap it by name and read `selection route: PROCESS_TEXT … →
Sent` (phone) and `Offered … NOT applied` (Mac). If it is not offered, compare with `query-activities PROCESS_TEXT`
and record **unavailable, cause not established** — not a dispatch failure.

**Stage 7 — drop sheet and Files push.** After deploy: a genuine Finder drop → AX `AXDefaultButton` (expect none) and
`AXCancelButton` (expect Cancel); Return (expect: nothing, sheet stays — **201's chosen behaviour**); Escape (expect:
not confirmed); drop again → Send by click → one dispatch. The rail reads *Received files* / *Sidekick private
storage* with where each is (202); push into Received files lands in `/sdcard/Download/ConnectSuite`, SHA-256 equal;
drag-out to Finder.

**Stage 8 — mirror and input.** The owner at the phone; I say **"tap now"** immediately before the start. Pass: 30 s of
`Encoded +N frames` ticking (a running-thing line, not `Mirror session started`), one input (back) acknowledged, stop
from the Mac, `media_projection` null after. Then the consent-timeout behaviour: one start left untapped → the
documented timeout, nothing captured.

**Stage 9 — reconnect.** Topology first (the Mac is on the phone's hotspot, so *phone Wi-Fi off/on* tests nothing).
Cases, each once and each approved: Mac Wi-Fi off/on; hotspot off/on; USB tether if available. Pass: one session after
each (`link-up.sh` → 1 control session), recovery time measured from the Mac's `Disconnected` to `Connected`, no
pairing request.

**Stage 10 — camera v1** per `docs/camera-v1.md`'s hand-off (owner taps consent). Incoming-call banner **only** with a
named consenting caller.

**Stage 11 — defect 137 and defect 30.** 137, in order: (a) read-only — `dumpsys package com.android.externalstorage`
(which APK, version; AOSP or Samsung), `appops get` for it and for Sidekick; (b) logcat during one DCIM listing (tags
`ExternalStorage`, `DocumentsProvider`, `FuseDaemon`, `MediaProvider`) with Sidekick's own `fs.list` line as the
control; (c) **the missing control**: the owner grants one **new** synthetic folder (`Documents/Sidekick137` holding
three synthetic files) through the picker, and Sidekick lists it. 3 rows → the provider serves this uid and the old
grants are in a bad state (re-granting them becomes the owner's remediation); 0 rows → a uid-level refusal (the
appops/package reading names it). No re-grant of existing folders, no MediaStore/path fallback. Defect 30 only with a
consenting number, absence proven in `mms-sms/conversations` **and** `content://sms` first.

**Stage 12 — accessibility.** Prepare the VoiceOver and TalkBack checklists; ask before taking over the screen or speech.

**Stage 13 — packaged builds.** Mac: the isolated ad-hoc packaged build of the final HEAD (static checks as in Phase 1);
a **launch** only with approval and preferably on a fresh macOS user (it mints its own identity and needs its own
pairing). Android: `assembleRelease` **unsigned** in an isolated copy (the signing flag is never typed); manifest and
`aapt dump badging`; **not installed**, never signed with the owner's key.

## 5. ML Kit — the copy, and the two honest options

The phone shows, on *Link your Mac*: *"No cloud, no account, nothing leaves your network"* (`ConnectMacScreen.kt:262`)
and *"No cloud, no account, no relay in the middle"* (`:180`). The first is false while ML Kit is in the build: its
terms say it sends Google usage metrics, and Google's logging transport (`transport-backend-cct`) is on the release
classpath. (The Mac's `NSLocalNetworkUsageDescription` — *"Nothing leaves your local network"* — is about the Mac app,
which has no ML Kit; it stands.)

| Option | Copy | Cost |
|---|---|---|
| **A. Disclose** (no code beyond strings) | Trust column: *"No cloud, no account. Your files and messages stay on your network."* Scan screen, under the viewfinder: *"The QR scanner is Google ML Kit. It sends Google anonymous usage statistics — never the camera image or the code."* Privacy policy and Data safety say the same | the product's headline promise gets an asterisk |
| **B. Replace the scanner** (recommended) | Keep *"nothing leaves your network"* — then true for the phone app | a new dependency (e.g. ZXing core, Apache-2.0, pure Java, no network) fed by the existing CameraX `ImageAnalysis`; removes ML Kit, Play services and `datatransport` from the APK. **Needs approval** (not in the offline Gradle cache) and a hardware scan test |

## 6. Phase 3 — report

*(Written at the end of the run; see the section below once Phase 2 completes.)*
