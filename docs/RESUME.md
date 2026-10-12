# BETA KEY CREATED, OWNER TOKEN WORKING, RC `83c4096` — 2026-10-12 small hours: 3 local commits; nothing pushed, signed or published

1. **Key:** created once on the owner's Mac with the documented command; public key
   `MCowBQYDK2VwAyEA5JYQoRvRKm4y1orhtMhrO5dC4mJL75s4f6Xhz/olFKc=` in `desktop/src/main/trialKey.ts` (`3f5155d`,
   red-first). The private key was only `stat`ed (mode 600, outside the repo); guard `--tree` PASS on 2,788 files.
   **Owner's to-do: back up the key folder offline.**
2. **Owner token** *Chetan (owner)*, 11 Oct → 25 Nov 2026, in the key folder's `tokens/`; entered through the real
   screen of the development app **without** `skipTrial` (it now runs that way): gate lifted, link back in 0.2 s,
   pairing unchanged, About *45 days left*.
3. **Every state walked on screen** (shifted clock in an isolated second instance, never the system clock):
   `docs/testing.md` → *Beta trial — key created…*, screenshots `docs/evidence/trial-states-2026-10-12/`.
   Found and fixed red-first: **221** (a refusal in Settings while valid showed nothing and threw) and **222** (a
   thank-you stayed under a later clock-back/expired screen) — `83c4096`.
4. **RC `83c4096`** in `~/.connectsuite-evidence-private/rc-83c4096/` (older folders kept): fuses `000011011`,
   quarantine key, ASAR integrity, gates off, public key in the packaged `trialKey.js`, packaged build cannot skip
   the trial, **0 private-key hits** in both Mac builds, both zips and the APK. `docs/release-candidate-2026-10-12.md`.
5. **Tests:** Mac 2,103 / 0; scripts 325 / 0; 17 hooks allowed every commit. Docs: trial summary (*Issuing a token
   to a tester*), tester guide, checklist steps 2–4 and 18. Next: checklist step 5 (publisher details).

# BETA TOKEN TRIAL + "SIDEKICK" WORDING — 2026-10-12 early: 7 local commits; nothing pushed, signed or published

1. **Built (owner's decision D):** signed, 45-day beta tokens checked offline on the Mac — `2c7d924` private-key
   commit guard; `c0071d4` token core + store + link gate + IPC; `d5b98e0` the trial screen, token entry,
   Settings › About line, 7/1-day notices; `a9aebde` `scripts/issue-trial-token.mjs`; `da1d28f` subtitle fix;
   `c1440a5` docs (`docs/trial-licence-summary-2026-10-11.md` → *Decided and built* has the key command).
   Nothing is sent anywhere. A packaged build always checks; a development build skips only with
   `CONNECTSUITE_DEBUG_SWITCHES=skipTrial`.
2. **`desktop/src/main/trialKey.ts` is `null`:** no public key yet, so every build (the running development
   app included) shows *This copy of Sidekick can't check beta tokens* and does not connect to the phone.
   Owner's next step: run the key command, send the 60-character public key; then embed, rebuild, issue a
   token, enter it.
3. **Phone wording:** `711a1e0` — the Files pane's grant hint and 14 more sentences now say Sidekick;
   `scripts/check-app-name.mjs` guards it. Debug APK `7207ce92…` installed on the SM-S938B; link service up,
   3 ports listening; no Mac attached because of item 2.
4. **Tests:** Mac 2,099 / 0; scripts 325 / 0; phone core 282, sync-module 685, input-module 52, app 217, 0
   failures; all hooks allowed every commit. Mutations: 10 on the token core, 4 on the view, 5 on the key guard
   — each red.
5. **Observed, not fixed:** the Overview subtitle reads *Pair a phone to get started* for any paired Mac whose
   link is idle (e.g. after Disconnect) — `overviewSubtitle`'s default branch.

# SEND FILES, SPACING, RC `8f8ecbb`, BETA DOCS — 2026-10-11 night: 6 local commits; nothing pushed, signed or published

1. **Committed (owner-approved):** `c013ff8` the Overview row Start mirroring · **Send files** · Device info
   (Send files = the Files pane's own `pickAndOffer`, aimed at Received files; View activity removed);
   `fb2df10` Recent activity rows (ink between the lines 1.63 → 6.63 px, no clipped descenders, row 52 px);
   `8b1c4d8` `tile-centre-sweep.mjs` gates text-block spacing + evidence `docs/evidence/recent-spacing-2026-10-11/`;
   `8f8ecbb` design-departures V4; plus this docs commit. Mac 2,054 / 0, scripts 308 / 0, all 16 hooks allowed
   every commit. The owner's uncommitted edits in 12 files are untouched.
2. **Send files hardware check passed** (23:57–23:58): both synthetic files sent from the Overview button, the
   phone `verified=true` for each, and `sha256sum` on the phone equal to the Mac sources (4 KiB `dbfe7be8…0748`,
   100 MiB `a852b0f4…8139`, 240.8 Mbit/s). All synthetic copies deleted by literal path (Desktop sources and
   folder, the copy-back in `~/Downloads/Sidekick`, the two phone MediaStore rows); nothing else touched.
3. **Release candidate `8f8ecbb`** (unsigned, ad-hoc, isolated build, nothing launched):
   `~/.connectsuite-evidence-private/rc-8f8ecbb/` with SHA256SUMS; `rc-34362e1/` kept. arm64 `.dmg`
   `2dd74a2a…b92b`, APK `53802a45…dc0f`. Static checks all pass (fuses `000011011`, quarantine key, ASAR
   integrity, gates off, new logo pixel-identical, new strings, 0 test files, no debug components, no
   `dataSync`, 4 exported activities + 2 permission-guarded receivers). Known: the x64 framework sign failure
   (D12), and the Intel app has never run. Record: `docs/release-candidate-2026-10-11.md`.
4. **Docs refreshed:** `docs/beta-tester-guide.md` (new row, pairing path as the app says it today), the
   privacy/Data-safety draft re-checked against `8f8ecbb` (Tailscale sentence softened, no in-app permission
   page), `docs/trial-licence-summary-2026-10-11.md`, `docs/beta-launch-checklist-2026-10-11.md` (19 steps).
   Statements still to confirm: release-candidate record §5 (13) and §6 (9).
5. **Next:** the owner's trial decision (checklist step 2), then publisher details (step 5).

# CARD LAYOUT, PHONE TILE, QUIT WORDING, RAW SPEED — 2026-10-11 late afternoon: 4 local commits; nothing pushed, signed or published

1. **Overview device card (defect 218), owner approved:** the facts were pinned to the card's bottom (102 px
   under the pill, 0 under the last row). The whole column is now centred on the phone illustration, 24 px from
   pill to facts, at every size and theme; the sweep gates it. Commit `3b8e4af`.
2. **Phone "Your Mac" card (defect 219), hardware-verified:** tile 4.13 dp low → 0.13 dp (a background-less pill
   kept its padding). The phone runs debug APK `9bf3c01d…` (this code). Commit `b1b3b4b`.
3. **Activity wording (defect 220), verified on the running app:** a quit or relaunch reads *"Sidekick was
   closed on this Mac"*; real drops keep their sentence. Commit `a96e0ab`. Not changed: *Device forgotten*
   still takes the generic failure sentence.
4. **Storage card:** correct — it is the phone's shared storage, 5.4 GB free of 490 GB (df agrees).
5. **Raw speed, hotspot secured:** no gain from 2/4/8 streams in either direction (Mac → phone 276 single vs 272
   four; phone → Mac 398 vs 367). **The multi-stream push was not built**, per the owner's rule. If a slow link
   state comes back (single ≈ 110), re-run `raw-link-speed.mjs` there first. The design that fits the code
   when it is wanted: interleaved fixed slices on N sockets, merged *in order* into the existing append-only
   receive loop (`receiveFrom`'s single `framing.readChunk()` is the only call that changes), so the partial
   stays a contiguous prefix and the verdict, digest and resume code are reused unchanged.
6. **Totals:** Mac 2,044 / 0; phone 1,184 run this sitting (core 282, sync-module 685, app 217; camera, mirror,
   input not re-run — unchanged); scripts 305 / 0; all 15 guards exit 0.
7. **Left on your devices:** phone on the USB cable, charging (77 %), Sidekick in front; Mac `dist` rebuilt at
   `a96e0ab`, relaunched (window on the external display). No synthetic files created this sitting (the raw
   tool uses `/dev/zero`); `~/Downloads/Sidekick/speed-{4mb,100mb,595mb}.mp4` are from your 14:17 share and were
   left.

# ICON ALIGNMENT + SHARING SPEED — 2026-10-11 afternoon: 2 local commits; nothing pushed, signed or published

**Read first:** `docs/transfer-speed-2026-10-11.md` §5–§9 (the second sitting) and defect **217**.

1. **Icons (defect 217), fixed, measured on the development app:** the device card's four fact tiles sat 1.05 / 1.30 px
   below their text at every size and theme, while every box centre read 0.00. `text-box` trimming makes `align-items:
   center` centre the letters: 0.00 / 0.00 everywhere, 48 tile centres compared, 0 moved. Checked everywhere else
   with the same pattern: the sidebar device card (−0.27 px), Recent activity (−0.67) and the security card (−0.47)
   were already within 1 px and are unchanged; Settings and the other panes have none. Guard: `scripts/tile-centre-
   sweep.mjs` (live, gates at 1 px), red on the old build, green after. Commit `26add06`.
2. **Speed: nothing in the transfer path changed, because nothing measured was Sidekick's.** Your video: 11.1 s on
   the wire at 429 Mbit/s (the link's speed then), ~1–2 s of staging before your Send tap, and 1.4 s + 19.3 s of
   yours. Phone → Mac: one Sidekick stream equals four raw TCP streams. Mac → phone: one stream gets about half of
   what four get in today's link state (push 112 Mbit/s against raw 109–112 single, 205–207 four). A multi-stream
   push is **designed (§9), not built**: a contract change across the push path's resume and verdict logic, and its
   gain depends on the link state.
3. **Shipped in this commit:** staging timing in the share log (`staged … in N ms (read · hash · write)`),
   `scripts/raw-link-speed.mjs` (raw ceiling, 1–N streams, both directions), and `transfer-speed-probe.mjs` now
   pulls in grid view too. 1 MiB staging buffers were tried on hardware and **not** kept.
4. **Fresh totals:** Mac 2,040 / 0; phone 1,485 / 0 (core 279, app 217, sync-module 685, camera-module 187,
   mirror-module 65, input-module 52; `--rerun-tasks`, 0 stale result files); scripts 297 / 0.
5. **Left on your devices:** phone runs the debug build `19f087e8…` (this commit's code), 27 grants, both bindings,
   link 3/3, **charging on the USB cable**; every synthetic file deleted on both devices (phone 2.3 GB free, which is
   tight: a share of a file over ~2 GB will be refused for space). Mac: `dist` rebuilt from `26add06` and relaunched;
   the Files pane was routed by the probes and left on Received files.
6. **Your decision:** whether to build the multi-stream push. Its precondition is one raw reading in the fast link
   state (§9). Unrelated but seen: macOS reports your hotspot's security as **None**. If that's real, the hotspot is
   open, and Sidekick's own traffic is TLS-pinned either way.

# UX POLISH, SPEED AND TRIAL-DESIGN BATCH — 2026-10-10/11: sections 0–7 done; 16 local commits; nothing pushed, signed or published

**Read first:** `docs/ux-audit-2026-10-10.md` (findings, every string changed, the spacing pass),
`docs/transfer-speed-2026-10-11.md`, `docs/trial-licence-proposal-2026-10-10.md`; evidence in `docs/testing.md` →
*UX polish, speed and trial-design batch*; defects **210–216** in `docs/defects.md`.

1. **Fixed, hardware-verified:** stale panes on return (212 — Photos shows new photos/videos on top after a click
   back to the Mac, scroll kept; Files keeps your folder and redraws a big one in 5 ms while the phone re-reads);
   window re-fit when moved between displays (213 — you confirmed); Android Send files works through the share flow
   (214 — end to end, hash equal); the Mac name wraps at large text (216); the new logo on both apps (you confirmed
   launcher, splash, menu bar).
2. **Fixed, tests only on hardware:** 210 (a stray `}` that disabled a CSS rule), 211 (Messages banner outliving a
   reconnect), Calls re-read on return, float/receive window re-fit on display changes; 215 measured in the sweep.
3. **Copy:** mechanism words out of the main UI on both apps, the phone app named Sidekick on the Mac (Appendix B);
   security, consent and clipboard-offer wording kept in substance. Full before/after table in the audit doc §3.
4. **Speed:** no change — Sidekick runs at 97–100 % of the raw link both ways; the link (your phone's Wi-Fi 6
   hotspot) moved between 1,200 and 600 Mbit/s while measured. 631 MB phone → Mac: 6.8 s at the fast state, 11.9 s at
   the slow one. The remembered ~2 s was a 96 MiB file or a loopback harness.
5. **Trial:** design only — signed, time-boxed tokens enforced on the Mac for the beta; a merchant of record for
   sale; eight decisions listed in the proposal §9. No licence code exists.
6. **Commits (local):** `9b56a0c` `ef3db00` `fd954cf` `94d1138` `90bfb3c` `37b7175` `5c9e458` `4d65ea0` `390e19d`
   `f71ffd1` `620ffce` `e2866d0` `3502476` `debfa97` `c004491`, and the commit carrying this entry.
7. **Fresh totals after the last code change:** Mac **2,040 / 0** (npm exit 0), typechecks exit 0 (test ratchet
   14 / 14); phone **1,484 / 0** (core 279, app 217, sync-module 684, camera-module 187, mirror-module 65,
   input-module 52; `--rerun-tasks`, 0 stale result files); scripts 290 / 0; every guard exit 0. Swift not run (no
   Swift changed).
8. **Left on your devices:** phone — debug build from `620ffce` (27 grants, both bindings, link 3/3); **screen timeout
   still at 10 minutes** (you set it for this session); font, density and rotation read and restored. The test
   photos and video you took for this batch (three photos at 2026-10-10 23:05; a photo and a short video at
   2026-10-11 00:29) are **kept** — say if they should go. Mac — `dist` built at `e2866d0`; the renderer was
   reloaded after that build, the main process is the relaunch from the logo build (`main.ts` unchanged since); the
   packaged app's new icon is in `build/icon.icns` (a development run shows Electron's Dock icon). Every synthetic
   file from this batch was deleted on both devices (`send-files-test.txt`; `speed-631mb.bin` and its `(2)` copy).
9. **Your decisions:** the trial's eight (proposal §9); whether to delete the now-unused old icon vectors
   (`app/src/main/res/drawable/ic_launcher_*.xml`), `tile-44/56@*` and the `--brand-stage*` / `--brand-halo-*`
   tokens; the earlier owner checklist in `docs/beta-hardware-plan-2026-10-09.md` is unchanged.

# CLEANUP + MAC REDEPLOY — 2026-10-10 evening: test files removed on both devices; `9ccb1b4` is deployed on the Mac

1. **Deleted** (each proven by a doc entry, a recorded hash or a generated name; literal paths; neighbours re-listed):
   - Mac `~/Downloads/Sidekick`: **51** synthetic files (every `sidekick-*`, `inbox-probe`, `nogrant-probe`, `drop-me*`);
     your 22 photos and videos untouched. `~/.s7-run` gone (3 drop files, `.DS_Store`, both folders by rmdir).
   - Mac scratch: 44 earlier session scratchpads under `/private/tmp/claude-501/…ConnectSuite` (~10.5 GB, no keystores
     found), `desktop/release` (743 MB, the 2026-09-17 ConnectSuite packaged build), `/private/tmp/claude-501/bulk.ts.orig`,
     and ~87,000 npm-test temp dirs in `$TMPDIR` (33 prefixes proved against repo `mkdtemp` calls, only dirs idle ≥ 2 h;
     2.10 → 0.13 GB) plus `sidekick-207-profile-kwZzN1`.
   - Phone (`adb-pinned.sh`): **208** files (~1.69 GB) from `Download/ConnectSuite`, `Pictures|Documents/SidekickShareTest`,
     `Download/SidekickGrantP5`, `Pictures|Documents/SidekickRC`; those five folders rmdir'd; `files/shared/drop-me.txt`
     via run-as. MediaStore lists none of them (218 → 10 rows: one unknown file + 9 directory rows of deleted folders;
     DCIM control 22,461 rows). No SAF grant pointed at a deleted folder.
2. **Kept:** `~/.connectsuite-evidence-private/rollback-2026-10-06` (your choice). The RC moved out of `/private/tmp`
   (wiped at reboot) to `~/.connectsuite-evidence-private/rc-34362e1/` — APK `c0814f50…`, dmgs `d9d3a456…`/`f08492d6…`,
   both zips, and the older unsigned APK `8803cfcd…`; hashes identical after the move, `SHA256SUMS.txt` beside them.
   **Unknown, left:** `Download/ConnectSuite/TNbdOLDFd7pfa-Qr.mp4` (arrived via Sidekick, no record); the
   `cdp-profile-*`, `frames.err`, `pg.html`, `prod.log` in `/private/tmp/claude-501` (the Lookamx-website project's);
   20 unproven `$TMPDIR` prefixes.
3. **Free space:** Mac 3.1 → 22.0 GB. Phone 4,661,128 → 4,530,436 KB — **confounded**: a 584,608,433-byte video was
   recorded on the phone at 20:00 during the run, so the phone figure is not a measure of what was freed.
4. **Mac redeployed:** `desktop/dist` rebuilt at 20:08 from HEAD `50c997d` (desktop source equal to HEAD); the built
   `bulk.js` carries `9ccb1b4`'s `cancelled → stopped` branch (control: the 10-08 dist copy lacks it). Before quitting:
   no transfer since 19:40:06, `pull-resume/` empty, ledger `share-temporary-files.json` `[]`, receive folder the default
   `~/Downloads/Sidekick`; the app's quit logged *nothing to wait for (2 checked)*. Relaunched 20:10 (PID 16240):
   stored identity `A9:59:35:BB…` loaded, connected via last-known, pairing v2 — **no re-pair**; profile
   `sidekick-desktop-dev`; one instance; no `CONNECTSUITE_*` variables, 0 debug-switch lines; `link-up.sh` 3/3.
5. **Still yours, by hand on the phone:** Sidekick → Sync → Folders → Documents › Sidekick137 → **Remove** (stale grant).
   Also still running: orphaned Mac test processes from Oct 3/7 (PIDs 25501, 88652, 89011) — not touched.

# BETA HARDWARE RUN — 2026-10-09/10: the beta plan run on the phone and the Mac — **every check that needs no one else has passed; what is left is the owner's** (signing, policy blanks, a fresh macOS user, named consenting people)

**Read first:** `docs/beta-hardware-plan-2026-10-09.md` — its status block says what is done and what is left, and
ends with **the owner's checklist in plain words**. Evidence: `docs/testing.md` → *Release-fix batch 2026-10-09 —
hardware run* and the sections after it; `docs/evidence/release-candidate-2026-10-09/`.

1. **Hardware-verified (SM-S938B + the development Mac app):** install over the old build keeping all 27 grants and
   both settings switches (A1–A6); the development profile seeded by copy with the stored identity loaded, no prompt
   (207 b); *This Mac still remembers a phone* with **Forget** (207 d); **a real ZXing scan and re-pair**, v2 both sides
   proved (B1); the selection entry does not pull Sidekick forward (B4); **drop sheet: Return cancels at once, Escape
   does nothing** (B5 — the accepted trade-off), on a real sheet; share collision → `name (2).ext`, hashes equal (B6);
   gallery multi-select → one offer per file, Accept/Decline each (B7, both ends); Cancel mid-transfer at 101,974,016 of
   314,572,800 bytes → nothing saved, both partials gone (B8); thumbnails of the selected root only (B9); a Pause or
   Disconnect logged as *stopped*, not failed (B10).
2. **Found on hardware and fixed (each red first, mutation-checked):** `27a6f0d` — 208's root check refused real DCIM
   ids (percent-encoded wire ids checked undecoded) and the Mac cached the refusal; `177aab6` — expected stops logged at
   W/E and counted failed; `9ccb1b4` — the phone's stop line read the tally before counting its own stop (my
   `177aab6`), and the Mac logged a person's Cancel as `W … failed`. `9ccb1b4` is **tests-only on both ends**: the phone
   build carries it but no stream has stopped since; **the Mac has run it since 2026-10-10 20:10** (rebuilt and
   relaunched — see the entry above), and no Mac-side Cancel has been exercised on it yet.
3. **Defect 205 — accepted by the owner (2026-10-10): the lock is kept and its cost stated** (≈ 20 mAh per hour while a
   Mac is awake and connected; released when the Mac sleeps — the lock is held only while connected). Hour B and the
   night without the lock did not compare the two conditions (phone in use; Mac asleep from 19:01); both are recorded
   with why. Stated in the privacy draft §3 and the tester guide; reopen conditions in the register. Debug markers
   removed; lock re-verified held.
4. **Commits (local, not pushed):** `27a6f0d` `177aab6` `0aaebb5` `9ccb1b4` `06a89a1` `c66ef7f` `731f50e`, and the
   commit carrying this entry. Nothing signed, notarized, published or pushed; no release gate changed.
5. **Fresh totals, after the last code change:** phone **1,481 / 0** (core 279, app 214, sync-module 684, camera-module 187, mirror-module 65, input-module 52; `--rerun-tasks`, 0 result files older than the run, gradle exit 0); Mac **2,017 / 0** (npm exit 0); Mac typecheck exit 0, test ratchet 14 / 14 (2026-10-09, no Mac code since).
6. **Left on your devices:** phone — debug build from `c66ef7f` (`4d548ae0…`), re-paired to this Mac (the Mac stores
   the phone as `2F:97:0F:EC…`), `adb logcat -c` run once on 2026-10-09; the **`Documents/Sidekick137` grant** still
   held (folder deleted). Mac — profile `sidekick-desktop-dev` (the original `sidekick-desktop` untouched),
   `desktop/dist` rebuilt on 2026-10-09; Sidekick's window moved to the built-in display for B5. **Deleted on the
   owner's list, each hashed first:** 7 files in `~/Downloads/Sidekick`, 11 files and 4 folders on the phone. **Not
   deleted (not on the list):** 8 older `sidekick-pass-stop-200mb` copies (1.6 GB) and `sidekick-s5-a/b.txt` in
   `~/Downloads/Sidekick`, `~/.s7-run`, the T1 evidence.
7. **Next:** the owner's checklist (plan status block). Then, with a new macOS account and the signed APK, §D's
   fresh-user test — the first run of the packaged Mac app and the release APK anywhere.

# RELEASE-FIX BATCH — 2026-10-09: items 1–7 built, tested and committed; hardware NOT run (phone off USB) — beta NOT YET, four steps away

**Read first:** `docs/release-verification-2026-10-08.md` §7 (items table and verdict), then
`docs/beta-hardware-plan-2026-10-09.md` (what runs next, step by step). Evidence: `docs/testing.md` →
*Release-fix batch 2026-10-09*; `docs/evidence/release-candidate-2026-10-09/`.

1. **Built and proven (tests, mutations, isolated runs — no hardware):**
   - **207:** a stored identity this build cannot open is never overwritten (Quit / Show folder / Start over,
     old key kept); development builds use `sidekick-desktop-dev` (seeded once by copy); one process per
     profile; the pairing screen offers *Forget <phone>* and arms no code while a phone is stored; migration
     design in `docs/protocol.md`. Isolated Electron run with real `safeStorage`: files byte-identical, second
     instance refused, 0 network lines.
   - **208:** a listing race (old root's page landing in the new root's list) fixed; queued batches dropped;
     the phone refuses a foreign id before the provider (`BAD_REQUEST`, *refused*, never *gone*).
   - **Item 3:** `SendSelectionActivity` `taskAffinity=""`, guarded for every share/selection entry.
   - **Item 4:** ML Kit → ZXing 3.5.3 (Apache-2.0, no deps, no network code). Release classpath Google
     artifacts 16 → 0; manifest components 26 → 20; APK 25 → 5.1 MB. *"Nothing leaves your network"* kept, now
     true of the phone app.
   - **Item 5:** clipboard arrival card worded by route; "ConnectSuite" → "Sidekick" in clipboard copy; a
     Mac-closed stream logged at I as *stopped*; test-file typecheck ratchet (new defect **209**: 14 mis-shaped
     test calls, listed); log privacy re-read.
   - **Fresh:** Mac **2,014 / 0**, both typechecks + test ratchet clean; phone **1,470 / 0** (six modules,
     `--rerun-tasks`, 0 stale result files); Swift **140 / 0**; scripts **290 / 0**; every guard and hook fixture
     exit 0. ~42 mutations red. One unidentified Mac failure in one run (2,007/1), not seen in 7 runs since.
2. **Committed** (local, not pushed): `cdee313` `0745cd6` `12ce28e` `2114c0f` `34362e1` `a4cc38f`, and the commit
   carrying this entry.
3. **Ready, not installed or launched** (session scratch `rc-34362e1/`): Mac `Sidekick-2.0.0-arm64.dmg`
   `d9d3a456…`, Intel `.dmg` `f08492d6…`, zips; unsigned release APK `c0814f50…`. Hashes and static checks:
   `docs/release-candidate-2026-10-09.md`. Tester guide: `docs/beta-tester-guide.md`.
4. **Needs your decision or hands:** sign the APK (your act); publisher name, address, email, effective date;
   **205** (measure vs accept — left blank in the brief); **the drop sheet's Escape** (accept vs custom sheet —
   left blank); phone on USB for §A–B of the hardware plan; a new macOS user for the fresh-user test; a
   consenting number (30) and caller (camera 6/8/9, banner); licence-report and OSV-audit approvals.
5. **Next:** phone on USB → A1–A6 (install, relaunch, read `seed: copied`) → B1 real ZXing scan (one re-pair
   approved) → B2, B4, B9, B10.
6. **Left changed on your devices:** **nothing on the phone** (never connected). Mac: no Sidekick relaunched,
   `desktop/dist` **not** rebuilt (builds were in scratch); one development Electron ran for ~5 s on a temporary
   profile in `/var/folders/…/sidekick-207-profile-*` (left there; nothing in your profiles or Keychain changed —
   its prompt appeared on screen briefly); one attributes-only Keychain read of two item names (no secrets, no
   prompt); `com.google.zxing:core:3.5.3` downloaded into `~/.gradle`. Your uncommitted edits untouched; this
   entry and the register/testing sections were staged without them.

# RELEASE-VERIFICATION RUN — 2026-10-08 (owner present): Phase 1 code + Phase 2 hardware stages 0–13 — **NO-SHIP**; two release-relevant defects found and fixed on hardware

**Read first:** `docs/release-verification-2026-10-08.md` §6 (report, ranked blockers, decisions owed, verdict); evidence
in `docs/testing.md` → *Release-verification run, Phase 1* and *Phase 2*.

1. **Built and proven:**
   - **Hardware-verified on the deployed builds:** pairing v2 re-pair + **impostor answers first** (refused 6/6, 0 proofs,
     injection dropped); **T2, T3, T4-A, T5-B** (T5-B for the first time; defect 166 verified); phone → Mac sharing
     (Accept/Decline/Cancel); clipboard S7 (offer, Copy once, duplicate refused, Restore-over-newer refused, Dismiss);
     drop sheet, collision-safe push, drag-out; mirror start/frames/input/stop and the 30 s consent timeout; reconnect
     after Mac Wi-Fi outages (~10.5 s, one session); camera v1 request/approve/switch/stop (1224 sent = received).
   - **Found and fixed on hardware:** **206** — every receive-window Accept/Decline refused since S4 (`97193bf`);
     **201** — Phase 1's drop-sheet fix let Return reach *Send* on real sheets; refixed so Return cancels (`f3c9eec`).
   - **Found, open:** **207** — a build that cannot decrypt the stored Mac identity overwrites it (an old packaged copy on
     the shared profile destroyed the pairing; re-paired with approval) — release-blocking for any signing change;
     **205** — the link's wake lock is the largest app battery consumer overnight; **208** — stale thumbnail ids after a
     root switch. **137 not reproduced** (fresh and old grants list). **199**: endurance verified (battery died at 10:31,
     after the window), still open.
   - **Phase 1 (code):** 202 root names, 203 space/resume, 204 pull progress, F1/F2, H7 tooling, policy addendum.
   - **Fresh:** Mac 1,981/0, phone 1,455/0, Swift 140/0, scripts 290/0, typechecks and every guard green.
2. **Committed** (local, not pushed): `a178bfa` `79b8c5b` `acc119d` `219cb76` `81ff971` `00e84ab` `7507217` `d2b58f2`
   `424d080` `9d30318` `e609538` `3d875cd` `933e576` `26c055f` `97193bf` `e43ce18` `0f5c8c1` `f3c9eec` `e7ba1d9` `697a58d`
   `3e018c2` `f7633f8` `6285001`, and the commit carrying this entry.
3. **Ready, not installed or launched:** packaged `.app` of `6285001` (static checks pass); unsigned release APK of
   `7507217`.
4. **Needs your decision:** distribution route; ML Kit (A disclose / B replace — recommended); publisher details; policy
   values (gates stay off); 205; 201's Escape trade-off; signing/enrolment; OSV audit. Exact list: report §6.6.
5. **Next:** fix 207 before any signed build; then the unrun items in §6.5 (defect 30 with a consenting number, call
   banner, camera 6/8/9, screen-reader passes, packaged launch on a fresh macOS user).
6. **Left changed on your devices:** phone — `fbb1de42…` installed; Sidekick's **accessibility service on** (you turned it
   on); pairing v2 to the Mac's new identity `a95935bb…`; synthetic files in `Download/ConnectSuite` (`drop-me (2)–(5).txt`,
   `Download/SidekickS5/`, `Documents/Sidekick137/` and its grant; the T5 source is
   now H2; **the phone is off USB**. Mac — `dist` `0c269edb…` running (PID 14347); old `dist`s moved (not deleted) to
   `~/.connectsuite-evidence-private/rollback-2026-10-06/mac-live-dist-moved-at-2026-10-08/`; the old packaged copy quit
   (not deleted); **the development identity `B5:9F:4B:BA…` is gone** (207); `~/Downloads/Sidekick` gained `(7)`, `(8)`,
   `(9).bin.failed`, `t5 (2).bin`, `sidekick-s5-a/b.txt`, `drop-me (5).txt`; **T4-A's 2026-10-01 `.failed` marker was
   removed by the product** when `(7).bin` published; `~/.s7-run/drop-me (5).txt`; Brave's windows minimized (Dock);
   Mac clipboard holds a synthetic marker. Nothing pushed, signed or published.

# OVERNIGHT 2026-10-07 (unattended): clipboard gaps, S5/S8/S9, UI sweep, privacy drafts — 10 commits; NOTHING installed or relaunched

**Read first:** `docs/morning-plan-2026-10-07.md` (what to do, in order, with the approvals each step needs),
then `docs/evidence/stage-d-2026-10-07/RECORD.md`.

1. **Built and proven (tests, mutations, isolated builds/harnesses — no hardware):**
   - Stage D recorded honestly: **PARTIAL**; step 2 passed for `ACTION_SEND` only; banner refused by macOS;
     step 6 inconclusive between toolbar action and delivery; later paths not exercised by it.
   - Phone (192–194): share route reads text as `CharSequence`; every focus sync ends in a named reason with
     counts; clipboard logs carry no text and no sender app; selection starts counted per route.
   - Mac (195–198): offer banner counts requested / reported shown / failed / clicked and the pane says a
     refusal; Settings trust sentence follows every status (legacy → unpaired → v2); zoom can no longer shrink
     the page below 1100×700 CSS px; a failed pairing code is explained.
   - S8/186: `LSFileQuarantineEnabled` + every received file's attribute read and reported (measured on a
     packaged harness; exclusions ignored by macOS, so not set). S5/184 (part): fuses `000011011` + packaged
     builds refuse debugging switches (guard is load-bearing for `--remote-debugging-port`). S9/187: all
     transfer paths inventoried; Photos now says when a save was not checksummed; pre-hash path tested.
   - 137: no Sidekick-side defect found; the provider reading is in the morning plan.
   - Privacy/distribution drafts: `docs/privacy-and-distribution-2026-10-07.md` (ML Kit structurally confirmed
     to bring Google's logging transport; not a traffic measurement).
   - Fresh: phone **1,434/0**, Mac **1,955/0**, typechecks clean, Swift **140/0**, scripts **287/0**, hooks
     pass, guards exit 0. ~46 mutations red. No flake seen (Mac suite 8 full runs).
2. **Committed** (local, not pushed): `fa0320a`, `9195f39`, `a93297e`, `0cbe9c8`, `d4436d8`, `6777b74`,
   `425e578`, `f8dabdf`, `bf096e1`, and the commit carrying this entry.
3. **Ready, not installed:** `artifacts-bf096e1/` in the session scratch — Mac dist `0c074f7d…`, packaged app
   (`app.asar` `5127b900…`), debug APK `9b7d34f0…` (same signer, versionCode 1).
4. **Needs your decision/hands:** install both before resuming D (recommended); D steps 6–8 and the banner
   step; one logcat read for 137; C step 3 and H4b; E then F; a packaged launch on a fresh macOS user; and the
   owner items in the privacy package §8 (publisher details, ML Kit, Developer ID, keystore, audit tool, notices).
5. **Next:** the morning plan, step 1.
6. **Left changed on your devices:** nothing. One read-only phone check at ~02:4x (locked, dozing; A4 install
   time confirmed). Mac watcher still **off**; real clipboard not read or written; pairing v2 untouched; both
   rollback copies and the Activity backup untouched (reminder due end of stage G or 2026-10-13); nothing
   published or pushed. Your uncommitted edits untouched; this entry and the `testing.md` section were staged
   without them. One scratch folder was created and removed under `~/Library/Caches` for the quarantine reading.

# SUPERVISED VERIFICATION — 2026-10-06: A0 done (watcher off); defect 191 fixed in code; NOTHING installed or relaunched

**Read first:** `docs/supervised-verification-plan-2026-10-06.md` (stages A0–G, §8 is A0's record).

1. **Built and proven:** A0 — the live Mac app's clipboard watcher is **off** (`watchClipboard=false`,
   `watching=false`, stop logged 18:23:46), verified three ways; no clipboard content read or changed.
   Defect 191 — the pending Activity rewrite now changes only a redacted call `detail`; unknown fields
   kept and reported (`4661015`; red first, 6 mutations red; Mac 1,898/0).
2. **Committed** (local): `4ee586b` (plan), `4661015` (fix), plus the commit carrying this entry.
3. **Ready, not used:** Mac artifact from `4661015` (manifest `bb594168…`) and the debug APK from `286e2b0`
   (`5f014e9e…`), pinned in the session scratch directory. The `286e2b0` Mac build is superseded.
4. **Needs your hands / approval:** M1 chosen — you copy harmless test text on the Mac and the phone; plug the
   phone into USB for the read-only checks (pin, `dumpsys package`, `pm path`, signer); then A1's APK pull,
   A2 (optional private Activity copy), A3, A4 — each separately.
5. **Next:** the read-only USB checks as soon as the phone is attached; nothing that writes.
6. **Left changed on your devices:** the Mac watcher setting (off; undo = the same toggle) and the main window
   now showing the Clipboard pane. Nothing on the phone. Your uncommitted edits untouched.

# S4 FILE-GRANT FOLLOW-UP + S7 CLIPBOARD PROVENANCE — 2026-10-06: built, tested, committed; NOTHING installed or relaunched

**Read this first.** Defects **190** (new) and **185** in `docs/defects.md`. Evidence:
`docs/evidence/s4-file-grant-2026-10-06/`, `docs/evidence/s7-clipboard-origin-2026-10-06/`. Contract:
`docs/protocol.md` → `clip.push` → *Provenance*. Hardware plan: `docs/s7-hardware-verification-proposal.md`.

1. **Built and proven (code, isolated tests — no hardware):**
   - **A / defect 190.** Original result: through the production `main.ts` handlers, a compromised main
     renderer sent an arbitrary synthetic path to `fs-grant-source`, and `fs-send` then **opened and hashed
     all 34 bytes** of it; only the harness's missing phone stopped the upload. Fixed: the channel is gone; a
     drop is confirmed in a **native sheet** (`fs-confirm-drop`) naming every file or source folder, Cancel
     the default, one at a time; every grant is bound to window, `dev`/`ino` and one hour
     (`desktop/src/main/sourceGrants.ts`). Valid pick, confirmed drop → read; forged, expired, swapped,
     replaced-window, float/receive → **0 opens**. 9 mutations red.
   - **B / S7 / defect 185.** `clip.push` carries `origin`, stamped by the phone's route (`ClipRoute`); the
     Mac applies only the exact string `clipboard`. Selection, absent and unknown origins become offers: ≤ 5,
     ≤ 64 KB, 10 min, bound to the control session, single-use Copy through the normal arrival path; Dismiss,
     expiry, disconnect never write; banner with fixed copy only when unfocused, click opens the pane; Restore
     by id and refused over newer content. Red first on both sides; Mac 13 + phone 5 mutations red.
   - **Fresh:** Mac **1,893 / 0**, both typechecks; phone **1,405 / 0** (`--rerun-tasks`, six modules, every
     results file from the run); every guard exit 0.
   - **Instrument faults caught in the run, all recorded in the evidence:** a mutation pass that ran no tests
     (zsh did not split `$T`; eight false "reds"); a mutation malformed by precedence; one that hung; and a
     phone guard blind to string-literal extras (P4 green first, fixed).
2. **Committed** (local, not pushed): `02c570e` (A), `afa88be` (contract), `001f452` (phone), `b674ccf`
   (Mac), plus the commit carrying this entry.
3. **Readable, not built:** `docs/s7-hardware-verification-proposal.md` V0–V11 (includes the real drop for 190).
4. **Needs your decision or hands:** approval of that hardware run, step by step (V1 relaunch runs the
   Activity rewrite; V5–V6 write the Mac clipboard with synthetic text, saved and restored).
5. **Would do next, on approval:** the hardware run; then the dependency audit decision.
6. **Left changed on your devices:** nothing. No phone or ADB, no launch or relaunch, `desktop/dist` not
   rebuilt, no real clipboard written. Your uncommitted edits untouched; this entry and the `testing.md`
   sections were staged without them.

**Product consequences to carry into release notes:** a drop needs one native confirmation, and a drop's
"N items were left out" line is no longer shown; a batch item starting > 1 h after its choice must be
re-chosen; a drop from > 12 folders needs **Send to phone…**; text sent with **Send to Mac** from another
phone app needs **Copy** on the Mac; an old phone's ordinary syncs need Copy too until it updates; a new phone
with an old Mac is still unprotected.

# S4 MAC IPC BOUNDARY + PHONE PAIRING COPY — 2026-10-06: built, tested, committed; NOTHING installed or relaunched

**Read this first.** Matrix: `docs/ipc-authorization.md` (133 channels). Evidence:
`docs/evidence/s4-ipc-2026-10-06/`. Tracker: `docs/release-tracker.md`. Next proposal: S7 in
`docs/phase-2-hardening-proposals.md`.

1. **Built and proven (code, isolated runs — no hardware):**
   - **S4 (defect 183):** every Mac IPC handler sits behind `guardIpc` — sender by object identity among
     registered windows, main frame only, exact page, role, then payload validation — before it runs.
     Preloads: main 150, float 25, receive window 8 methods. Also fixed: `sendAll` sent clipboard text and
     activity into the float/receive windows' processes; `fs-send` read any path; `fs-drag`/`reveal-saved`
     trusted renderer paths; a receive window could act on offers it was never shown; `pairing-qr-render`.
   - **Isolated Electron, real preloads and pages:** a compromised float page was refused SMS, Forget and
     pairing; replaced, unregistered, wrong-page and subframe senders refused; 0 forbidden handlers ran;
     the real pages initialised with 33 allowed calls and 0 refusals.
   - **The pairing secret, stated precisely:** the raw field never crosses IPC; the QR image encodes it.
   - **Phone copy:** "Code scanned. Verifying your Mac…" until the phone verified the Mac; "Paired" only
     then (`ConnectStage.pairingOutcome`); cancel and failure say so. No protocol change.
   - **Fresh:** Mac **1,856/0** (both typechecks); phone **1,396/0** (`--rerun-tasks`, ≤ 3.3 min old);
     every guard rc 0. Mutations: 9 Mac (S4) + 2 phone (copy), all red.
2. **Committed** (local, not pushed): `8f2a483` (S4), `ed14b6e` (phone copy), `0aa5864` (register,
   tracker, S7 proposal, hardware plan), plus the commit carrying this entry.
3. **Readable, not built:** S7 proposal (three decisions at its end); hardware plan H1–H12.
4. **Needs your decision or hands:** S7's decisions; each hardware step (H4 re-pairs your devices, H2 runs
   the Activity rewrite); S5 with signing; ML Kit; publisher details.
5. **Would do next, on approval:** S7, contract first.
6. **Left changed on your devices:** nothing. No phone or ADB; Sidekick not launched or relaunched;
   `desktop/dist` not rebuilt (builds were scratch copies); no profile read. Your edits untouched.

# PAIRING V2 + S2b — 2026-10-06: both built, tested and committed; NOTHING installed, re-paired or run on hardware

**Read this first.** Contract: `docs/protocol.md` → *Pairing (version 2)* and *Session tokens*. Evidence:
`docs/evidence/pairing-v2-2026-10-06/`. Tracker: `docs/release-tracker.md`. **Every existing pairing,
including yours, is legacy** — it still works, it is labelled, it is never upgraded by an update.

1. **Built and proven (code, loopback TLS, JVM — no hardware):**
   - **The defect, red first on HEAD's own code:** an impostor answering on loopback was pinned as the
     phone and received the pairing token (`pinned=IMPOSTOR tokenSentToImpostor=true`).
   - **S1 (defect 182):** the QR carries a 32-byte secret that never crosses the wire; the phone proves
     it first (`pair.proof`), the Mac verifies and proves back (`pair.confirm`), the phone verifies and
     persists before `hello.ack`. HMAC-SHA256 over a label, the role, both certificate fingerprints and
     both fresh nonces; constant-time compares. Proofs match vectors from an independent Python
     implementation on both sides. Nothing is stored, served or replayed before both proofs verify; the
     Mac drops every non-handshake message until then. v1 refused both ways, no fallback.
   - **S2b (defect 189):** a side channel is accepted only from the TLS peer that owns the token's session.
   - **Tests:** Mac 16 integration tests through the real `LinkClient` + 3 vector tests; phone
     `PairingV2Test` 16 + `SideChannelAuthTest` 1. Mutations: 9 red, 1 equivalent (explained in
     `mutations.md`). 6/6 repeat runs and 3/3 under CPU load green.
   - **Fresh:** Mac **1,831/0** (both typechecks clean); phone **1,387/0** (`--rerun-tasks`, results
     ≤ 5 min old); Swift **140/0**; every guard rc 0.
2. **Committed** (local, not pushed): `7815923` (S2b), `b5f8184` (S1), `e79e3a9` (register, tracker,
   hardware proposal), plus the commit carrying this entry.
3. **Readable, not built:** `docs/pairing-v2-hardware-test-proposal.md` (H1–H8); H7's impostor stand-in
   script does not exist yet.
4. **Needs your decision or hands:** each hardware step separately — H4 **re-pairs your Mac and phone**
   (forget on both sides); H2 relaunches the Mac and runs the pending Activity rewrite. Still open from
   before: S4, S5, S7, ML Kit, publisher details, signing.
5. **Would do next, on approval:** H1–H6 on the SM-S938B, then S4.
6. **Left changed on your devices:** nothing. No phone or ADB; Sidekick not launched or relaunched;
   `desktop/dist` not rebuilt; no profile read; your pairing untouched. A test bound `127.0.0.1:42501`
   for ~0.1 s in an isolated copy and released it (verified 0 listeners after). Your uncommitted edits are
   untouched.

# RELEASE PHASE 1 — 2026-10-06: S2, S6, S3, U1 fixed in source and committed; S1 drafted; NOTHING installed or relaunched

**Read this first.** The canonical tracker is now `docs/release-tracker.md`; the audit is
`docs/release-audit-2026-10-06.md`. **Sidekick is not ready to ship** — no signed build, S1 open, and
nothing below is on the phone or in the running Mac app.

1. **Built and proven (tests, mutations, isolated runs — no hardware):**
   - **S2 (defect 178):** every Mac bulk and mirror-video socket is pinned to the session's phone before
     a byte is written (`desktop/src/main/pinnedTls.ts`). Loopback TLS: a wrong peer, no session, or a
     session ending mid-handshake → **0 application bytes** on push, pull, share pull and video (was
     68–107). 21 tests; check disabled → 12 red, re-read removed → 4 red.
   - **S6 (179):** notification tags log as per-process ordinals (HMAC-keyed table, capped, never
     persisted) on both sides. The audit's FNV attack is a test, red against the old code on both sides.
   - **S3 (180):** windows may show only the three app pages (`windowGuard.ts`, exact resolved paths);
     `window.open`/`<webview>` denied; drops refused outside zones (`dropGuard.ts`); `sandbox: true`
     explicit. Isolated Electron with the real preload: unguarded, an untrusted page reached 166 bridge
     methods; guarded, it never loaded. **No real OS-level drag was done.**
   - **U1/U2 (181):** Settings rows wrap, the nav compacts on short windows, notification rows never
     shrink. Harness with a new control-versus-text check: Settings 2→0 / 5→0 at 1100×700 and 1.2×, both
     themes. **Synthetic only.**
   - **Docs:** defect 100 closed (not a code defect, its own 2026-09-10 reading); D4 closed (the
     2026-09-19 package carries the icon, hash-matched); the FNV claim corrected; 182–189 registered.
   - **Fresh:** Mac **1,812/0** (both typechecks clean); phone **1,370/0** (`--rerun-tasks`, results
     ≤ 9 min old); Swift **140/0** via `node run-tests.mjs` (a bare `swift test` cannot find Testing
     under the CLT, as its README says); every guard rc 0; fixture suites green.
2. **Committed** (local, not pushed): `6dca964` (S2), `4161e70` (S6), `fc69776` (S3), `7d0d557` (U1),
   `93a16d9` (tracker, audit, register, proposals), plus the commit carrying this entry.
3. **Readable, not built:** `docs/pairing-v2-proposal.md` (S1 draft — not in `docs/protocol.md`),
   `docs/phase-2-hardening-proposals.md` (S4, S5, S7, integrity inventory).
4. **Needs your decision or hands:** approve the S1 draft (old peers will refuse to pair, never fall
   back); S7 offer-vs-apply; ML Kit (capture F9, then disclose or replace); publisher name, contact and
   privacy policy; the dependency audit (OSV offline recommended — a new tool to install); plan F step
   by step (F2 runs the irreversible Activity rewrite); signing and enrollment.
5. **Would do next, on approval:** S1 + S2b per the draft, contract first.
6. **Left changed on your devices:** nothing. No phone or ADB; Sidekick not launched or relaunched;
   `desktop/dist` not rebuilt (all builds were scratch copies); no profile read. Your uncommitted edits
   (`PRODUCT.md`, this file's body, `docs/testing.md`, `camera-*.md`, `SidekickCamera/README.md`,
   `skills-lock.json`) and untracked files are untouched.

# OVERNIGHT 2026-10-05 → 06 (unsupervised): 14 commits, tests and a synthetic harness only — NOT release-ready, nothing installed or relaunched

**Read this first.** Full report: `docs/overnight-2026-10-06.md`. Feature matrix and release blockers:
`docs/release-readiness-2026-10-06.md`. **Sidekick is not ready to ship** — no signed build of either
app, defect 137 open, and nothing below is on the phone or in the running Mac app.

1. **Built and proven (tests, mutations, a synthetic renderer harness — no hardware):**
   - **Flaky `CameraStreamTest`** — the race was in the test (`isOpen` flips before `onClosed` runs);
     proven by widening, fixed with a thread join, 20/20 under load.
   - **The pending Activity call-data rewrite** (runs at the Mac's next launch, irreversible) could
     delete unrelated rows; now touches call rows only, keeps what it cannot read, never blanks the
     pane on a write failure. Synthetic 455-row dry run: 379/379 non-call lines kept verbatim.
   - **Privacy:** logs no longer carry a WhatsApp contact's number (notification tag), a looked-up
     number (contacts failure path), SMS numbers (refusals, drops, mismatch) or a contact's name
     (notification reply refusals). Mac and phone.
   - **step70 `--require-correction`** could never pass after `559f1da`; now ties the correction to
     the call by id.
   - **Defect 122:** `⌘⇧.`/`⌘⇧T` were printed and unbound; now a Mirror menu built from the palette.
     `⌘⇧4` no longer printed (macOS takes it).
   - **UI** (13 panes × 1100/1280/1440/1728 + 1.2× zoom, dark/light, four data states — 234 renders):
     Files breadcrumb overlap, five unnamed fields/canvas, 12 px sort targets; Calls and Messages
     were blank/"Reading…" after a refusal — now say why with **Try again**.
   - **Performance:** Photos page append flat at ~25 ms (was 417 ms with a 336 ms block at 3,720 tiles);
     Files progress ticks no longer rebuild the listing.
   - **Fresh:** Mac **1,779/0**, phone **1,367/0** (`--rerun-tasks`), both typechecks, every guard and
     fixture suite green. Swift not run.
2. **Committed** (local, not pushed): `148b93a` `87a8b29` `98f8e3d` `4b3159f` `0c8a9fe` `840adc9`
   `2d23951` `ff5245a` `af8df44` `213ae57` `05faea7` `ae2be75` `654d400` `f6a2fa1`, plus the commit
   carrying this entry and the two documents.
3. **Readable, not built:** the harness lives in the session scratchpad only; recorded-not-fixed items
   (sidebar density at 700 px, file names in phone logs, whole-list rebuilds on notification/SMS events)
   are in the report.
4. **Needs your decision or hands:** installing the phone build (privacy fixes); rebuilding and
   relaunching the Mac app — **which runs the irreversible Activity rewrite**; a look at the UI
   changes in the real window; defect 30's one send; defect 137's provider read; the release flags,
   the icon (D4) and signing. The supervised plan is the report's last section.
5. **Would do next:** the supervised plan's steps 1–7, in order.
6. **Left changed on your devices:** nothing. Phone untouched (no ADB). Sidekick still pid 91450 from
   12:51, not relaunched or attached; `desktop/dist/` not rebuilt. Your uncommitted edits and untracked
   files untouched; this entry is the only addition to this file, staged without them.

# OPTION B (webcam.keyframe) BUILT, CODE ONLY — 2026-10-05: ext.webcam 2; evidence of the 12:48 run committed; defect 177 OPEN; nothing run on hardware

**Read this first.** Two approved steps, both done. No install, relaunch, capture, signing or push.

1. **Built and proven (tests and mutations only):**
   - **The 12:48 IST hardware run's evidence is committed** (`76d2d14`): PASS 28/28, 425 AUs, 0 drops, no
     overflow. The driver's sanitized report, the pre-registration, the readout and the run record are in
     `docs/evidence/camera-v2-encoder-spike-2026-10-05/`. **The snapshots are NOT in the repository** —
     they hold device settings, the pairing fingerprint and personal file names — and live in
     `~/.connectsuite-evidence-private/camera-v2-encoder-spike-2026-10-05/` (0700/0600, `SHA256SUMS`),
     pointed to by `snapshots.pointer.md`. The 2026-10-04 FAIL and its post-hoc re-score are unchanged.
   - **Option B**, contract first (`71865a2`), then the bridge (`139dd4e`), Electron main (`636bd7d`) and the
     phone (`a96a474`): `ext.webcam` **2** = version 1 + `webcam.keyframe`; the AU header version stays 1.
     The bridge sends `chain-broken` once per break and `chain-recovered` once after it; main asks only for
     the current session/generation/bridge, one outstanding, one per second, 2 s ack / 3 s IDR wait, no
     retry, and measures request / IDR received / recovered apart; the phone accepts only from the owner,
     for the running session at its announced generation, once a second, and asks only the encoder still
     bound to that session and generation. v1 peers: nothing sent, periodic IDR fallback.
   - **Fresh, final tree:** Swift 140/0, Mac 1,686/0, phone 1,349/0 (clean `--rerun-tasks`), scripts 287/0,
     hook fixtures pass, both typechecks clean, spec guard green. 18 mutations red (MK-S1..3, MK-M1..9,
     MK-P1..6), each restored and checksum-verified.
2. **Committed** (local, not pushed): `76d2d14`, `71865a2`, `139dd4e`, `636bd7d`, `a96a474`, `5b24e7c`.
   Your edits (`docs/testing.md`'s other lines, this file, `PRODUCT.md`, `camera-*.md`, `skills-lock.json`,
   untracked files) are untouched and uncommitted.
3. **Not reached by any test, by design of the codebase:** `WebcamEngine`'s dispatch to the activity and
   `WebcamActivity`'s forwarding. **Not proven at all:** that a keyframe request shortens a real recovery.
4. **Needs your decision:** the single hardware verification below, which needs a stimulus that does not
   exist yet (a natural break did not happen in the 12:48 run), a phone install, a `dist` build, a release
   rebuild and a relaunch — each its own approval. Also: `scripts/hooks/protocol-spec-in-sync.sh` denies
   **every** Bash command while the spec check is red, not only commits; it cost one lost edit here.
5. **Would do next, on approval:** a probe-only, flag-gated simulated decode failure at one AU, then the
   one short supervised run in the report.
6. **Left changed on your devices:** phone — nothing (APK `b0ad2a47…` still v1 of webcam). Mac — Sidekick
   running normally (12:51 launch, no switches); `.build/release` holds the A+B probe/bridge (`331cc7bb…`,
   `39011e97…`) — **not** rebuilt for B, and must be rebuilt **together with `desktop/dist`** before any
   run, because a B bridge's `chain-broken` is unknown to the current `dist`'s parser.

# CAMERA V2 ENCODER SPIKE, SECOND RUN — 2026-10-05 12:48 IST (owner-supervised, once): PASS; no overflow; evidence UNCOMMITTED; Mac back to normal

**Read this first.** One approved diagnostic run with the A+B bridge. Full record:
`docs/evidence/camera-v2-encoder-spike-2026-10-05/RUN.md` (uncommitted, as approved).

1. **Built and proven:** **PASS, 28 of 28** pre-registered criteria (scorer v2, unchanged): 425 AUs, 8 IDR +
   417 P decoded, 0 failures, 1920×1080 at every stage, accounting 425 = 425, planned Stop at 15,002 ms,
   camera released in 1,364 ms, 60 s of nothing. Route `en0` Wi-Fi. **Defect 177: no overflow in this run**
   (high-water 3 of 4, one interval with 5 AUs) — a reading, not proof burst recovery is solved; the earlier
   overflow's field cause remains unmeasured. Preparation 43.9 ms, never waited on; first frame 118 ms after
   live; `decodedAfterFailure` 0.
2. **Committed:** nothing this run. Accepted earlier: `80a89f0`, `0e584b7`, `a16cee8`.
3. **Readable, not committed:** the run's evidence directory — `report.json`, `diag-readout.txt`,
   `preregistration.*`, `snapshot-before/`, `snapshot-after/`, `RUN.md`.
4. **Needs your decision:** whether to commit that evidence; whether to approve option B (keyframe request).
   Defect 177 stays open. The earlier run's FAIL, its re-score and the private original are untouched.
5. **Would do next, on approval:** commit the evidence; then B, if wanted — this run neither required nor
   ruled it out.
6. **Left changed on your devices:** phone — nothing (no reinstall). Mac — `.build/release` rebuilt
   (probe `331cc7bb…`, bridge `39011e97…`); Sidekick relaunched normally at 12:51:08 with no switches; the
   old app (pid 54964) did not quit on SIGTERM and was quit through its named menu item.

# DEFECT 177 — OPTION A AND THE DECODE-FAILURE FIX BUILT — 2026-10-05 (code, tests and generated streams only): defect stays OPEN; no capture, no phone change, no relaunch

**Read this first.** Two approved, scoped changes, both committed locally; their evidence committed
separately. **No hardware reading exists for either.** No capture, wire message, keyframe policy, queue
bound or quality change. The 2026-10-04 run's verdict and its private original report are untouched.

1. **Built and proven (tests, mutations, a release comparison):**
   - **A — composers prepared at `session-live` (`80a89f0`).** Both published formats' composers (pool,
     transfer, rotation sessions) are made on their own queue beside the first IDR's decode; Stop or
     replacement detaches them, a late completion is released and never installed, nothing is made for an
     ended session. The decoder is not prepared (needs SPS/PPS; nothing stands in for them).
     `PreparationTests` 9; MA1–MA6 red, restored with SHA-256 checks.
   - **B — decode-failure recovery (`0e584b7`).** `docs/protocol.md` (local main↔bridge only) states it:
     a decode failure is a recoverable Mac-side drop. The decoder is reset; waiting AUs of that session
     before a current-generation IDR with SPS/PPS are dropped undecoded (`droppedDecodeQueue`); such an
     IDR and its chain are kept; stale-session failures touch nothing of a replacement. A second fault
     found red-first: a Stop's decoder reset could land after the replacement's IDR — the decoder now has
     one owner. `DecodeRecoveryTests` 10 + one end-to-end placeholder test; MB1–MB8 red (MB7 green first,
     test added).
   - **Release comparison** (`docs/evidence/camera-v2-decode-recovery-2026-10-05/`, 180 runs, old / A /
     A+B on identical generated bytes, 10 reps predeclared): first frame ~125 → ~85 ms; paced-arrival
     overflow 6/10 → 1/10 (loaded Mac); **every burst still overflows, 30/30 on each build, 54 refused,
     ~2 s.**
   - **Fresh:** Swift 132/0 (2 opt-in skipped), Mac 1,660/0, scripts 287/0, hook fixtures, both typechecks.
2. **Committed** (local, not pushed): `80a89f0` (A), `0e584b7` (B), `a16cee8` (evidence + defects,
   proposal §8, and my `docs/testing.md` section only). Your other edits — `docs/testing.md`'s 1,117 lines,
   this file, `PRODUCT.md`, `camera-*.md`, `skills-lock.json`, untracked files — are uncommitted, untouched.
3. **Readable, not built:** options B (`webcam.keyframe`), C, D in the proposal §5. **B is still
   justified**: A does nothing for the ~2 s recovery gap after any overflow.
4. **Needs your decision or hands:** approval of the single supervised run below, and of B. The private
   original report at `~/.connectsuite-evidence-private/…` is kept.
5. **Would do next, on approval:** one short supervised spike (the existing runbook, 15 s planned Stop)
   with a release probe rebuilt from `0e584b7` — the current `.build/release` is the 2026-10-04 17:07
   build without the diagnostics. It would read `diag.overflow.first.*` (the field cause),
   `diag.prepare.waitMaxUs`, `diag.firstFrame.sinceLiveUs` and `diag.chain.decodedAfterFailure`.
6. **Left changed on your devices:** phone — nothing. Mac — `desktop/native/SidekickCamera/.build/debug`
   rebuilt by the tests; three release probes and a bench in this session's scratchpad (not
   `.build/release`, which is unchanged); `graphify-out/` refreshed. Sidekick (pid 54964) not touched.

# CAMERA V2 SPIKE FOLLOW-UP — 2026-10-04 (20:05–21:00 IST): Mac relaunched normally; scorer v2 and the sanitizer; the run's evidence re-scored; defect 177 instrumented and proposed. No capture, no phone change

**Read this first.** Three approved steps, in order, all done. **No further spike or capture was run or
approved.** The 19:57 IST run's verdict is **FAIL** and stays FAIL; a separate, post-hoc re-score exists.

1. **Built and proven.**
   - **A7 (20:06).** The debug Sidekick (pid 193, `webcamDev,webcamSpike`) was quit and relaunched
     normally, as pid 54964 with the CDP and accessibility flags. Checked first: no call (`mCallState=0`),
     no camera clients, media projection `null`, no mirror or transfer since 17:09. After: no `DEBUG SWITCHES`,
     `webcam not advertised`, `webcam` absent from the negotiated extensions, no bridge process, nothing
     started, no camera held. `pull-resume/` and `dev-share-receive/` hashes identical before and after
     (`0 expired at start`).
   - **Scorer v2 + sanitizer (`d1cb5e0`).** The FAIL was the scorer's: v1 summed `probe.decoded` as an
     ending, and the frame decoding when the Stop landed is decoded *and* `discardedEnded` (BridgeCore
     re-checks the session after decode). `accounting()` now sums BridgeCore's terminal dispositions,
     checked against `BridgeCore.invariantHolds` from the Swift. Six scenarios run through the real
     BridgeCore with a gated decoder; their counts are `docs/fixtures/webcam-spike-accounting-v1.json`, and the
     scorer holds on each, and fails on one lost or one double-counted AU in each. The sanitizer covers all
     five peer-name shapes (a test enumerates the Kotlin), then every known Mac name, then refuses on any
     residue. M1–M5 red. Runbook §7 item 10 and §8 record the correction.
   - **Evidence (`28c1b38`).** `report.sanitized.json` (derived, names the original's SHA-256) and
     `rescore-v2.json` (not a hardware run; v1 from `e3fea6a` reproduced the FAIL exactly first; v2 moves only
     the accounting line, to PASS; bounds identical; marked **post-hoc**).
   - **Defect 177 (`34db563`).** One decode-stage overflow → 54 P-frames refused (GOP index 5, so that GOP's
     IDR was in flight with four waiting). `PipelineDiagnostics`: 35 fixed integer counters in every
     `counts` status + one line at the probe's exit, nothing per frame. Tests use a manual clock and the
     gated decoder; D1–D4 red (D2 green first, a later-GOP test added). **Readings on this Mac, release
     build, generated 1080p rotated, 5 runs:** first frame 92–106 ms (setup), steady ~9 ms; smooth arrivals
     never overflowed; a 17-AU burst during the first frame reproduced the field signature exactly (54
     refused, 1.65 s). **Field cause unproven.**
   - **Fresh:** Swift **111 / 0** (1 opt-in skipped), Mac **1,660 / 0**, scripts **287 / 0**, both
     typechecks clean, every commit guard passed.
2. **Committed** (local, not pushed): `d1cb5e0`, `28c1b38`, `34db563`. My `docs/testing.md` section went in
   `34db563` by staging the committed file plus that section only; **your edits to `docs/testing.md` remain
   uncommitted**, as do this entry and your other modified and untracked files.
3. **Readable, not built:** `docs/camera-v2-decode-recovery-proposal.md` — the measurements, then four
   options with costs: (A) create the composer at `session-live`; (A′) pipeline decode and compose; (B)
   `webcam.keyframe {sessionId, generation}` with rate limiting, which `docs/protocol.md` already names as the
   addition; (C) a 1 s IDR interval, not recommended; (D) a 4 → 6 decode bound. §6 is a second finding: after a
   decode **failure**, AUs already waiting are still decoded against a missing reference
   (`diag.chain.decodedAfterFailure`, 2 of 2 here). Neither is fixed.
4. **Needs your decision or hands:**
   - Which, if any, of A / B / D (B and D change the contract first), and whether §6's flush is wanted.
   - The **one supervised spike** that would name the field cause: the probe now reports
     `diag.overflow.first.*`. It needs its own approval. The current `.build/release` binaries are the
     17:07 build **without** the diagnostics; the A1 build would have to be redone first.
   - **The unredacted original** is at `~/.connectsuite-evidence-private/camera-v2-encoder-spike-2026-10-04/`
     (dir 0700, file 0600, `SHA256SUMS`). Keep or delete it — your call; nothing references its path.
5. **Would do next, on approval:** option A (local, no contract change), then the supervised run.
6. **Left changed on your devices:** phone: nothing. Mac: Sidekick relaunched normally (pid 54964); a
   release probe built in this session's scratchpad (not `.build/release`); `.build/debug` rebuilt; the
   private evidence directory above; `graphify-out/` refreshed. In
   `docs/evidence/camera-v2-encoder-spike-2026-10-04/`, four files from an earlier sitting
   (`dry-run-1.out`, `snapshot-*`, `snapshot.sh`) are untracked and untouched.

# CAMERA V2 ENCODER SPIKE PREPARED — 2026-10-04 (code and fixtures only): one Samsung spike planned and tooled; signing checklist written; nothing run, installed, relaunched, signed or activated

**Read this first.** The integration checkpoint is accepted. The proposed 30-minute batch (V0–V5 in the
entry below) was **not started** and is replaced, for the first sitting, by ONE short spike. Approved and
done: its preparation and a signing-readiness checklist. **No `adb` or device command, no install, no
capture, no Mac relaunch, no build into `desktop/dist`, no signing, no activation, no push.**

1. **Commits** (local, `clipboard-watcher-and-phase-5-close`, not pushed): the wiring checkpoint
   `e7fb646`, `4e20782`, `73ec308` (unchanged); this sitting `5386814` (decode probe) and `0f9fb01`
   (runner, driver, runbook, signing checklist, mutation record).
2. **Fresh results:** Swift **99 / 0**, Mac **1,660 / 0**, phone **1,342 / 0**, scripts **259 / 0**,
   both typechecks clean, every guard OK. 19 mutations red on their named tests (MS7, SW1, SW5 green
   first and SW6 hung first — each a real gap, fixed).
3. **The spike** — `docs/camera-v2-encoder-spike.md`. One request, the owner's Start tap, back camera,
   planned Stop at **15 s** and an independent **20 s** cap from the tap (both in Electron main), the
   driver's own emergency Home at 25 s, then **60 s** of observation. The route is recorded (`route.address`
   + the Mac interface), never assumed; adb over USB is named as the debugging link, not the video
   transport. Real SPS/PPS/IDR and P-frame checks, header = `running` = SPS-cropped = decoded size with
   the coded size beside it, session/generation identity and the claim, Stop → release → nothing after,
   all **pre-registered** as PASS / FAIL / NO READING in `scripts/webcam-spike-core.mjs` before any
   reading exists.
   - **Tooling** (tested on generated fixtures only): `sidekick-camera-decode-probe` (the bridge's real
     `BridgeCore` + VideoToolbox into a counting sink; writes nothing; self-exits); `EncoderSpike` in
     Electron main behind `webcamDev` **and** `webcamSpike` (live link, v1's pinned opener, the exact
     claim, the phone's unchanged consent; once per launch; no button); the phone's capture line now names
     the encoder, its hardware flag and the AE range; `scripts/webcam-spike-driver.mjs`.
   - **Unchanged:** `WebcamController`'s extension and identity gates, the bridge, `resolveBridgeExecutable`,
     the phone's consent/deadline/claim rules. The development preview is still not built.
4. **Signing** — `docs/camera-v2-signing-readiness.md`. CLT only, **no Xcode**; SIP enabled; 0 system
   extensions; Team ID **missing** (`teamID = nil`); ADP membership and keychain identities **unknown**
   (not read). **Finding that changes W4:** a Developer ID–signed system extension will not load until
   notarized (Apple DTS), so **local activation = Apple Development signing + development profiles, no
   notarization**; Developer ID + notarization is distribution only, a separate approval. The Swift
   README's *Blocked* table assumed Developer ID throughout and now carries the correction.
5. **Left changed on your devices:** nothing on the phone. On the Mac: `.build/debug` rebuilt (Swift), test
   children all reaped (`pgrep` finds none), `graphify-out/` refreshed. The running Sidekick (pid 28482,
   from `dist`) was not touched; `desktop/dist` not rebuilt. **Uncommitted, on purpose:** this entry and
   the new `docs/testing.md` section (both files hold your earlier uncommitted work). Your other modified
   and untracked files are untouched.

**The exact next approval needed** — for the spike's preparation steps and then the sitting, each line
its own yes/no (runbook §4.2, §5, §6):

- **A1** `swift build -c release` (bridge + probe) · **A2** phone debug APK build — local builds only;
- **A3** install that APK on the pinned SM-S938B (`adb install -r` via the pin) · **A4** start it
  (`am start …/MainActivity`) and `scripts/link-up.sh`;
- **A5** `npm run build` into `desktop/dist` · **A6** quit Sidekick pid 28482 and relaunch it
  unpackaged with `CONNECTSUITE_DEBUG_SWITCHES=webcamDev,webcamSpike` and the CDP/accessibility flags;
- then `node scripts/webcam-spike-driver.mjs --dry-run` (read-only gates);
- then **the sitting**: `--execute --report <new file> --owner-present`, owner holding the phone with
  Sidekick in front and the back camera on a non-personal scene; **A7** relaunch Sidekick normally after.

Signing stays a separate track: **Approval L** (local activation: B1 enrol, B2 Xcode, B3 development
profiles, B4 identifiers, B5 `/Applications` + activation + admin approval) and, later and separately,
**Approval D** (Developer ID, notarization upload).

# CAMERA V2 WIRED — 2026-10-04 (code only): mirror ↔ webcam coexistence closed; both apps wired; integration-tested; nothing installed, operated, signed or captured

**Read this first.** Approved: the coexistence fix, then production wiring and integration tests, code
only. Done, committed locally (`e7fb646`, `4e20782`, `73ec308`), **not pushed**. Neither app was installed,
relaunched or operated. **No picture can be produced yet, by design**: the Mac refuses every webcam request
while Sidekick Camera is not installed or the build has no Team ID, and both are blocked on signing.

1. **Exact wiring now complete.**
   - **Coexistence:** a mirror start (Mac or the phone's Mirror tab) is refused while a webcam request or
     session is open — the mirror's `stopped` ack, `CAMERA_BUSY`, nothing touched; the webcam refuses while
     the mirror runs / awaits consent / is coming up / is being admitted; the mirror, Camera v1 and the
     webcam admit under one lock (`core` `CaptureAdmission`). Nothing is stopped to make room. Camera v1's
     unrelated behaviour is unchanged. `docs/protocol.md` → *Starting a session* and *Webcam*.
   - **Phone:** `ConnectSuiteApp` → `CaptureWiring.connect(CameraUse.arbiter, MirrorAdmission.gate)`, the
     real mirror-busy predicate, `WebcamFeature.install` — **debuggable builds only**, `WEBCAM_RELEASE`
     false. Then `webcam` + `ext.webcam` 1 are advertised and the claim is served. Consent, deadlines,
     no-linger and late-callback rules are W2's, unchanged.
   - **Mac:** `main.ts` → `planWebcam` → `wireWebcam` (`desktop/src/main/webcamWiring.ts`). `ext.webcam` 1
     only unpackaged **and** `CONNECTSUITE_DEBUG_SWITCHES=webcamDev` **and** the bridge at
     `desktop/native/SidekickCamera/.build/release/sidekick-camera-bridge`. Bound: `webcam.state`, the
     session ending, suspend / lock-screen / user switch (not resume or unlock), the pane's ask / stop /
     switch; quit writes the stop then reaps the bridge.
   - **UI:** a separate *Use as webcam* card under Camera v1's (`WebcamView`). Not route-bound; no preview;
     Camera v1's controls untouched.
   - **Note:** there is **no release build of the bridge** at that path, so a dev Mac started with
     `webcamDev` today truthfully reports *the camera bridge is not built* (`swift build -c release` in
     `desktop/native/SidekickCamera` makes it — not done here).
2. **Tests and injected boundaries** (`docs/testing.md` → *Camera v2, app wiring*): the Mac suite drives
   the production `wireWebcam` with the **real built Swift bridge** (not installed / unconfigured → nothing
   asked → reaped) and an **INJECTED** bridge child for every flow the real one cannot reach on this Mac;
   the phone link, socket, `ipcMain` and `powerMonitor` are **stand-ins**. The phone's coexistence test
   drives the app's own `CaptureWiring` with the production machines; mirror state is **injected**. Fresh:
   phone **1,342 / 0**, Mac **1,647 / 0**, Swift **89 / 0**, scripts **227 / 0**, typechecks and guards
   clean; Camera v1 **108 / 0** + **78 / 0**. Mutations 9 Mac + 7 phone, red after one fix (MW2/MW3: tests
   had read the production table).
3. **Remaining signing / activation blockers** (proposal §15, README *Blocked*): B1 Apple Developer Program
   membership → B2–B9: a Team ID compiled into `SidekickCameraIdentity` (lifts *unconfigured*), Developer ID
   signing of Sidekick, the bridge and the Camera Extension, the system-extension entitlement and App Group,
   notarization, a build in `/Applications`, the admin's activation in System Settings (lifts *not
   installed*). Release flags stay false on both sides until a commit records evidence.
4. **First Samsung Camera2/MediaCodec verification — bounded, supervised, needs its own approval.** The Mac
   app cannot ask until W4, so the phone half is verified with **repository tooling acting as the paired
   Mac** (like Camera v1's driver), never by loosening the Mac's gate:
   - **Pre-reqs (approval each):** the pinned SM-S938B (`scripts/adb-pinned.sh`), a debug APK install, the
     owner present to tap. No audio, no recording kept: AU dumps live in the session scratchpad, are checked
     and deleted; only counts, hashes and timings are kept.
   - **V0, read-only:** each camera's MediaCodec-capable sizes, AE fps ranges, timestamp source and sensor
     orientation; the AVC encoder's caps. Pre-registered: rung 0 is attempted only if 1920×1080 at 30 fps is
     offered as a PRIV output (proposal Q3).
   - **V1, front, 60 s:** request → tap → record. Pass: IDR+SPS/PPS within 10 s of the tap; `running`'s
     selected size equals the AUs'; every AU accepted by the Swift gate and decoded offline; measured fps
     and IDR interval reported beside the 30 fps / 2 s targets (not pass/fail); rotation byte matches how
     the phone is held.
   - **V2, switch:** `webcam.switch` back → generation 2, IDR with discontinuity, within 2 s.
   - **V3, endings:** phone Stop, Home (`left-screen`), `webcam.stop` `failure` (the phone shows the
     Mac-failure sentence — read by resource id, not coordinates), `no-consumers`, disconnect.
   - **V4, coexistence on device:** mirror running → `webcam.request` refused; webcam awaiting →
     `mirror.start` refused with the sentence; Camera v1 ↔ webcam.
   - **V5, 10 minutes, back camera:** thermal status every 30 s, measured fps/bitrate; stop at `SEVERE`.
   - **Bounds:** ≤ 30 minutes of capture in total, one sitting, an independent 20 s cap on V1–V3's
     startup phases, the owner's tap every session.
5. **Later, separately — Meet / Zoom compatibility (after W4 only):** Sidekick Camera listed in Meet
   (Chrome), Zoom, FaceTime and Photo Booth; selected with no session → the camera-off card; one phone
   request per consumer episode, none on re-selecting after a decline; approval → self-view;
   leaving the call → `no-consumers` stop within 1 s; 1080p and 720p formats; portrait pillarboxed;
   switch mid-call (paused card, then the new camera); sleep/lock mid-call; two apps at once; reopening an
   app never resumes; Zoom's own effects on our frames.
6. **Left changed on your devices:** nothing on the phone. On the Mac: test children only (all reaped;
   `ps` shows none); `graphify-out/` refreshed. `desktop/dist` unchanged (Oct 3); the Sidekick already
   running from it (pid 28482) was not touched. Your six modified files and untracked files are untouched;
   this entry and the `docs/testing.md` section are uncommitted for that reason.

# CAMERA V2 W3 CORRECTIONS + W2 — 2026-10-04 (code only): the stop-failure cause and `stream-rejected`; the phone half built and tested; nothing installed, wired, signed or captured

**Read this first.** Approved: (A) the two W3 contract corrections, then (B) W2 on the phone, code only. Both
are done and committed. **No part of either running app uses any of it**: `ConnectSuiteApp` does not call
`WebcamFeature.install`; `main.ts`, `MAC_EXT` and the renderer are unchanged. The W3 entry below stands.

1. **Built, and what proved it.**
   - **A, `510d808`.** `webcam.stop` cause `failure` + a closed `detail` (phone reason `mac-failed`, never
     worded as a Stop; the phone never shows the string). The bridge's `stream-rejected {sessionId,
     generation, violation}`: decided by session **before** the bytes are read, fatal only for the live
     session, reported once, ignored by main unless the id is current. Shared closed sets in
     `docs/fixtures/webcam-vocabulary-v1.json` (read by TS, Swift, Kotlin).
   - **B, `c0ed2de` + `acb11e4`.** Contract first (selected size beside the target in `running`; v1/webcam
     as one decision; the mirror both ways). `core`: the `webcam` claim, sink, contract and `ext.webcam`
     (installed **and** debuggable; `WEBCAM_RELEASE = false`). `camera-module/.../webcam/`: the session
     machine, AU codec + MediaCodec assembler, stream writer, capture core, `CameraUseArbiter`, the Camera2 →
     MediaCodec backend (compiled only), the screen, notifications, the gated install. Mac: the four names
     in `MessageType` as the twin, nothing else.
   - **Real H.264 across three readers:** VideoToolbox output cut into MediaCodec's shape → the phone's
     production path reproduces `docs/fixtures/webcam-phone-stream-v1.hex` → the Swift gate admits and
     VideoToolbox decodes all 9 AUs → Electron main frames them. The encoder is a Mac's, standing in.
   - **Fresh results:** phone **1,325 / 0** (six modules), Mac **1,616 / 0**, typecheck clean, Swift
     **89 / 0**, every guard OK, spec checker 0 unaccounted (spec-only now 4: `apps.launch`, `mic.*`).
   - **Mutations:** A — 3 TS + 3 Swift; B — 17 phone. All red on the test named for them after one fix:
     **MB14 was green** because the coexistence test modelled the engines' wiring; the decision now has one
     home (`admitCamera` / `admitWebcam`). Also found: a writer test settling on one of two clocks (8/8 red
     alone), fixed. Evidence: `docs/evidence/camera-v2-w3-corrections-2026-10-04/`,
     `docs/evidence/camera-v2-w2-2026-10-04/`; the record is `docs/testing.md` → the two new sections.
2. **Committed:** `510d808`, `c0ed2de`, `acb11e4`, local, **not pushed**. **Not committed, on purpose:**
   this entry and the two `docs/testing.md` sections (both files hold your uncommitted work). Your other
   modified and untracked files are untouched.
3. **Reachable versus not.** Real and tested: the machine, codec, assembler, writer, capture core, arbiter,
   claim, `ext`, contract. **Compiled only, never executed:** `Camera2WebcamBackend`, `WebcamEngine`,
   `WebcamActivity`, `WebcamNotifications`, `WebcamFeature.install`. Held by source scans only: the gate's
   order in `install`, and each engine passing the arbiter's answer through.
4. **Decisions and gaps the code cannot settle:**
   - **The mirror's own admission.** A webcam refuses while mirroring, and a mirror started before the tap
     wins; a `mirror.start` during a *running* webcam is not refused (as for Camera v1). Making the mirror
     refuse is a mirror-contract change and app wiring — your call.
   - **No on-device preview decision yet:** P1 (Camera2, preview + encoder surfaces) is coded; whether this
     phone holds it is S1's reading. The preview surface's aspect is unhandled until then.
   - **Once reinstalled, the debug phone lists `webcam` in `unavailable`** (its "not implemented" reason)
     because the capability now exists and the feature is not installed. The Mac ignores names outside its
     own list, so nothing on screen changes; it is the contract's prescribed release-build row.
   - The dev preview stays deferred; device-not-installed and producer-identity gating are untouched.
5. **Needs your hands**, each a separate approval:
   - **App wiring, both sides together:** `ConnectSuiteApp` → `WebcamFeature.install(this, link, mirrorBusy
     = …)` (and update `WebcamReleaseGateTest`, which fails on purpose when that line appears); `main.ts` →
     construct the controller, advertise `webcamExt`, dispatch `webcam.state`, `powerMonitor`, IPC, a pane.
   - **S1, supervised:** debug APK install + one capture sitting (both cameras, 10 min, rate/size/heat/latency).
   - **W4:** B1–B9 (Apple Developer Program, signing, the extension, activation). Release activation stays off.
6. **Would do next, on approval:** the paired wiring commit (phone install + Mac controller), then S1's
   pre-registered readings.
7. **Left changed on your devices:** nothing on the phone (no `adb`). On the Mac: the Swift bridge rebuilt in
   `desktop/native/SidekickCamera/.build/debug`; `camera-module/build/webcam-phone-stream-v1.bin` (a test
   output); `graphify-out/` refreshed. One `swift` script run (VideoToolbox encode in-process, no device, no
   camera, no TCC). No relaunch, no `dist` build, no extension command, no signing. `ps` shows no bridge or
   test children left.

# CAMERA V2 W3 — 2026-10-04 (01:00–02:10 IST): Electron main's controller and the bridge process built and tested locally; nothing wired, signed, installed or captured

**Read this first.** Only W3 was approved, and it is done. W2 (phone) and W4 (signing, deployment) remain
unapproved. **No part of the running app constructs the new controller**: `main.ts`, `MAC_EXT`,
`MessageType`, the Camera pane and `desktop/dist` are unchanged. The W0/W1 entry below is unchanged.

1. **Built, and what proved it.**
   - `desktop/src/main/webcam.ts` — `WebcamController`: consumer episodes (one automatic request per
     episode, none after a spent one, none after a reconnect or a bridge restart); the phone's tap before
     the socket; `running` before any AU reaches the bridge; the immediate `no-consumers` stop; Stop,
     disconnect, sleep/lock/user switch, quit and the dev switch; Cancel during the ack and late acks; token,
     session, socket and generation ownership; logs without tokens, whole ids or frame bytes.
   - `desktop/src/main/webcamBridge.ts` — `BridgeProcess` (no shell, one resolved path, strict stdout,
     stderr as diagnostics, 4-AU bound with the keyframe rule, ready deadline, shutdown → SIGTERM → SIGKILL,
     resolved on exit) and `resolveBridgeExecutable` (no override, no symlink, no debug fallback).
   - `desktop/src/shared/webcamWire.ts`, `webcamBridgeRecords.ts` — the claim, the stream splitter (the
     bridge stays the one full AU validator), the record codec, the strict status parser, and `webcamExt()`
     (the advertise gate, **not wired**).
   - The bridge's new first record, `ready {device, producerIdentity}` — one row added to
     `docs/protocol.md`'s Mac-local status table, so main reads the Team ID's absence from the bridge instead
     of holding a second copy. **Fail closed**: no request while either is negative. Team ID still `nil`.
   - **Fresh results:** Mac **1,607 / 0**, typecheck clean, Swift **78 / 0**, isolated release build 0
     warnings, script fixtures 23/23, every guard OK. **Mutations:** 20 + re-runs + 1 Swift; all red on the
     test named for them except M1 (unreachable guard, explained). Evidence:
     `docs/evidence/camera-v2-w3-2026-10-04/`; the record is `docs/testing.md` → *Camera v2, W3*.
2. **Committed:** `46c4e24` (the `ready` record, contract row first) and `a7f708b` (controller, bridge
   process, codecs, 64 tests, evidence), local, **not pushed**, on `clipboard-watcher-and-phase-5-close`.
   **Not committed, on purpose:** this entry and the appended `docs/testing.md` section — both files hold
   your earlier uncommitted work. Your other modified and untracked files are untouched.
3. **Reachable production paths versus injected boundaries.**

   | Path | Status |
   |---|---|
   | `BridgeProcess` → the **built** Swift bridge: spawn, `ready`, records split/coalesced, malformed input, stdin close, shutdown, escalation, reaping | **real, exercised** |
   | Controller → real `BridgeProcess` → real bridge on this Mac: reports *not installed / unconfigured*, asks the phone nothing | **real, exercised** |
   | Controller's request/approval/frames/stop logic | **real code, driven by stand-ins** for the phone, the socket and the consumer count |
   | Sidekick Camera installed, producer identity configured, a consumer count ≥ 1 | **injected** — this Mac has none of them |
   | `openCameraSocket` (v1's pinned TLS opener) for the webcam claim | **not exercised**; it is what wiring would pass as `openSocket` |
   | `main.ts` wiring: `MessageType` constants, `hello` ext, `webcam.state` dispatch, `powerMonitor`, IPC, a pane | **not built** — needs approval with W2 |

4. **Half-built, gaps and decisions the code cannot make:**
   - **The pre-signing end-to-end sitting is now impossible by construction.** The proposal's W3 included a
     dev-only preview drawing the bridge's frames; it was out of this approval. Without it, the controller
     correctly refuses every request because no Sidekick Camera exists to show the picture. Either approve a
     dev-preview consumer (and its gate), or accept that the first phone→Mac picture waits for W4.
   - **The contract has no stop cause for a Mac-side failure.** An expiry backstop, a malformed stream, a
     bridge failure and a producer refusal send `webcam.stop` `shutdown` (the phone reads `stopped-by-mac`).
     True, but coarse. A contract decision, not a code one.
   - **Malformed AUs:** main closes the stream on what it frames (length, flags, version, codec,
     generation 0). The bridge's deeper rules (NAL structure, IDR-per-generation, order) **drop and count**
     rather than close, so the contract's "the Mac closes the stream on a malformed AU" holds only for main's
     subset. Closing on the bridge's verdict needs a new status op.
   - The packaged bridge name (`sidekick-camera-bridge` in `Contents/MacOS/`) is W4's to confirm.
5. **Needs your hands:** separate approvals for W2's code; for wiring W3 into `main.ts` (only together with
   W2); for the dev-preview question above; for the stop-cause question. W4 stays blocked on B1–B9.
6. **Would do next, on approval — W2, code only** (no device, no install, no capture):
   - `webcam.*` constants and handlers on the phone, behind `Extensions.WEBCAM_RELEASE = false` and the
     debuggable-build gate; the `webcam` capability and `ext` key advertised only there;
   - the session state machine reusing Camera v1's consent screen: per-request `sessionId`, the `trigger`
     sentence, 30 s expiry on the request's own clock, no tap after the deadline, `CAMERA_BUSY` against v1
     and the mirror both ways, stop causes and `stream-closed` re-attribution;
   - the 42502 `webcam` claim (all five conditions, claimed once);
   - the AU writer: the 16-byte header held to `docs/fixtures/webcam-au-v1.hex`, generation on switch and
     reconfiguration, SPS/PPS on every IDR, a 2 s IDR target, the 2-AU in-flight bound with the keyframe
     rule and a sync-frame request;
   - JVM tests for each, red-first, and the Mac twin's constants only when wiring is approved.
   The Camera2 → MediaCodec spike (S1) and any capture stay a supervised sitting (B7).
7. **Left changed on your devices:** nothing on the phone. On the Mac: the bridge rebuilt in
   `desktop/native/SidekickCamera/.build/debug` (Swift change); an isolated release build in the session
   scratchpad; `graphify-out/` refreshed (gitignored). Tests spawned and reaped local children only. **Three
   orphans from mutation runs** (a SIGSTOPped debug bridge and two `node` stand-ins under `$TMPDIR`) were
   verified by command line and killed; `ps` shows none now, and no test temp directory remains. No app
   relaunch, no `dist` build, no system-extension command, no signing, no TCC prompt.

# CAMERA V2 W0 + W1 — 2026-10-03 (16:40–17:40 IST): contract and Mac logic built locally; nothing signed, installed or captured

**Read this first.** Only W0 and W1 were approved, and both are done. This sitting ends here; W2 onward
needs a new approval. The plan entry below (*CAMERA V2 PLAN*) is unchanged, and its item 5 is what this
entry completed. All the Camera v1 entries below are unchanged.

1. **Built, and what proved it.**
   - **The proposal, revision 2** (`docs/camera-v2-webcam-proposal.md`) records the owner's decisions:
     no linger, an immediate stop on the last consumer, enumerate/open/permission ≠ consent, no automatic
     restart.
   - **W0, the contract.** `docs/protocol.md` → *Webcam*:
     - the device versus the session;
     - consumer episodes, with one automatic request per episode and none after any other ending;
     - `webcam.request/state/stop/switch`, the `webcam` claim on 42502 and the 16-byte AU header with
       its golden fixture `docs/fixtures/webcam-au-v1.hex`;
     - formats, the two cards, host-clock timestamps and bounds per stage;
     - the main ↔ bridge ↔ extension contract;
     - older peers (no v1 fallback), the `ext` `webcam: 1` key, and the dev and release gates.

     `camera.*` is byte-for-byte unchanged. `check-protocol-spec`: 8 spec-only, 0 unaccounted for. Its
     control: the four new names were the only findings before they were allowlisted.
   - **W1, the Mac logic** (`desktop/native/SidekickCamera/`, SwiftPM, CLT only):
     - the real CMIOExtension provider/device/streams;
     - `FrameRelay` and `ProducerAuthorizer`, which fails closed: the Team ID is `nil`;
     - the bridge pipeline, with real VideoToolbox, a real `CMSimpleQueue`, and the bridge executable.

     `node run-tests.mjs`: **78 tests, 0 failing.** A clean isolated debug and release build: 0 warnings.
     **14 mutations, each red on the test named for it.** Evidence: `docs/evidence/camera-v2-w1-2026-10-03/`.
     What each test stands on, and what is **injected** (the identity verifier) or **modelled**
     (CoreMediaIO's fan-out and cross-process transport), is in the package README.
   - **New readings:**
     - one `CMIOExtensionProvider` per process (an NSException);
     - `notifyPropertiesChanged` and `send` crash on a device with no provider;
     - the decode stage's first bound reached 11 against 4, caught by its test and fixed;
     - `swift test` needs Testing.framework's path under the CLT, which the wrapper passes;
     - CoreMediaIO enumeration lists only `FaceTime HD Camera` (the control for "device not installed").
   - **`check-suites-run.mjs` has a Swift leg.** A filtered run counts as unrun. Red-first was done.
   - **SinkCam:** MIT at `ce124cfc…`. Its files carry a stale 2022 "All rights reserved" header. **No
     code copied**; hashes are in `ATTRIBUTION.md`. **OBS (GPL) not read.**
2. **Committed:** `95a5485` (W0) and `28d69d5` (W1), local, **not pushed**, on
   `clipboard-watcher-and-phase-5-close`. **Not committed, on purpose:**
   - `docs/RESUME.md` (this entry) and `docs/testing.md` (a W0/W1 section appended at the end). Both
     files already held your uncommitted work, so they stay as working-tree edits like the entries below.
   - All your other uncommitted and untracked files, which are untouched.
3. **Half-built:** nothing. Two pieces of W1 code compile and have **never executed**, because no device
   exists for them to find:
   - `CMIOSinkPort`'s sink-stream path;
   - `ConsumerWatcher`'s property listener.

   `sidekick-camera-extension` is compiled only.
4. **Needs your hands:**
   - **B1–B9** for anything further. The exact ordered steps for signing, packaging, activation and
     Meet/Zoom are the README's *Blocked* table (15 steps).
   - **W2** (the phone) and **W3** (Electron main's controller and the bridge spawn) each need a
     separate approval, even for code only.
   - **Unproven until a signed build:**
     - that a Developer-ID bridge passes the authorizer;
     - Q7: attachments crossing the sink;
     - Q8: per-client `startStream`;
     - Q9: whether the sink counts as "running somewhere".
5. **Would do next, on approval:** W3's controller in TypeScript, written against the same fixture. It
   is the last piece of the consent policy that can be tested without a device: episodes, no
   automatic re-request, the immediate no-consumers stop, stop ordering. Then W2's code.
6. **Left changed on your devices:** nothing on the phone. No `adb`, and no install, relaunch or settings
   change. On the Mac:
   - **built:** `desktop/native/SidekickCamera/.build/` and an isolated copy in the session scratchpad;
   - **read-only commands only:** CoreMediaIO enumeration with no stream started, and `codesign -dv`;
   - **no signing, no TCC prompt, no system-extension command.**

   The tests spawned `/bin/sleep` briefly, and they wrote crash reports for the test runner to
   `~/Library/Logs/DiagnosticReports/` while I diagnosed (`swiftpm-testing-helper-2026-10-03-17*.ips`).
   The running Sidekick, `desktop/dist`, and all protected transfer artifacts were not touched.

# CAMERA V2 (VIRTUAL WEBCAM) PLAN — 2026-10-03: written, nothing built, signed, installed or captured

**Read this first.** The plan is `docs/camera-v2-webcam-proposal.md` (uncommitted). The Camera v1 entries
below are unchanged, and so are Camera v1's code and `docs/protocol.md`.

1. **Built and proven:** nothing built. The plan rests on these readings:
   - macOS 26.6.1 arm64. **No Xcode, only the Command Line Tools.** 0 signing identities, 0 system
     extensions, SIP enabled.
   - A Swift typecheck of every CoreMediaIO, SystemExtensions and VideoToolbox symbol the plan needs
     **passes** with the CLT SDK. The control: the first attempt failed on a renamed symbol. The probe is
     in the session scratchpad and was never run.
   - Apple's capability table lists System Extension and App Groups as **ADP / Developer ID only**.
2. **Committed:** nothing. HEAD is still `ad8dd55`.
3. **Half-built:** nothing. The proposal's phases W0–W3 need no Apple account. W4 onward is blocked on
   B1 (Developer Program membership).
4. **Needs your hands:** blockers B1–B11 in the proposal's §15, each a separate yes/no. The decisions
   needed first are B10 (D-2: a 10 s linger, so a Meet join is not three taps) and B11 (a separate
   `webcam.*` namespace, so v1 stays byte-for-byte unchanged).
5. **Would do next, on approval:** W0 (`webcam.*` into `docs/protocol.md`), then W1 (the Swift bridge and
   the extension logic, tested in-process). Both are local only.
6. **Left changed on your devices:** nothing. No device writes, no install, no settings change. A
   scratchpad typecheck file only.

# CAMERA SESSION 2 (CASE D) — 2026-10-03 (15:59–16:01 IST): NO READING — the actor's tray AppleScript did not compile; no Disconnect happened; the 20 s cap stopped capture; no retry

**Read this first.** Record: `docs/testing.md` → *Camera Session 2, case D*. Evidence:
`docs/evidence/camera-supervised-2026-10-03/session-2/`. Session 1 (passed with the owner's documented
deviation) and the earlier NO READING entries below are unchanged.

1. **Built and proven:**
   - Session 1 stands: an 11/12 functional smoke pass with the owner-accepted close-first deviation.
   - Session 2's request, approval and live stream (`b836d498…`) worked.
   - The actor's Disconnect gate held at live + 5.0 s.
   - The independent cap fired at anchor + 19.5 s, and the camera was released within 20 s on both clocks.
   - Case D itself has **no reading**: the tray was never clicked, and the link never dropped.
2. **Root cause:** `its`/`it` are AppleScript reserved words in the actor's tray script (`-2740`), reproduced
   offline with `osacompile` (no execution). The local tests used an injected tray, and the earlier tray check
   used a different script, so the live script was never compiled before the run.
3. **Committed:** nothing. HEAD `ad8dd55`, not pushed. All records and evidence are uncommitted.
4. **Needs your hands:** approval for (a) renaming the variables in the actor's AppleScript and compiling it
   with `osacompile` during preparation, (b) whether to note or fix the driver's capture-end dating (it reported
   20.696 s / `withinLimit: false` for a Stop clicked at 19.503 s), and (c) a fresh case D attempt.
5. **Would do next:** (a) and the compile check, then case D again with the same back-to-back procedure and
   revision 2 of its acceptance (`f3940a02…`).
6. **Left changed on your devices:** two Camera sessions in total today. Afterwards: no camera held, Sidekick's
   Camera screen in front, the Mac pane `ended`. All snapshots are identical to before (the 65 protected
   Mac artifacts, `sidekick.json` included); the APK and relaunch changes are as in the entries below.

# CAMERA SESSION 1, SECOND ATTEMPT — 2026-10-03 (15:09–15:11 IST): 11 of 12 bounds met; S1-8's phone line took the close-first route; Session 2 held for the owner

**Read this first.** Record: `docs/testing.md` → *Camera Session 1, second attempt*. Evidence:
`docs/evidence/camera-supervised-2026-10-03/session-1b/`. The 14:17 NO READING entry below is unchanged.

1. **Proven on hardware (production wiring, `98187d17…` + Mac pid 28482):**
   - one request (`35bca7ce…`), bound by both the driver and the actor;
   - the phone's request screen over Sidekick;
   - live, rear 960 × 720; the switch at +5.0 s, confirmed front on both sides;
   - the real Mac Stop at +15.06 s, inside the 20 s cap (16.49 s from the anchor; the cap never fired);
   - the picture cleared (0 lit pixels at +0.3 s) and 0 draws after the Stop;
   - the camera released by +1 s (2 released of 2 bound);
   - counts: 208 sent, 207 received, 207 drawn, 0 not drawn;
   - 60 s watch with no restart.
2. **Not met as written: S1-8.** The phone's `stopped` line reads `STREAM_CLOSED`, because the Mac's socket
   close beat its `camera.stop` by about 2 ms. It was then re-attributed to `STOPPED_BY_MAC` (defect 167's
   close-first path), so the final attribution on both ends is "stopped by this Mac".
3. **Committed:** nothing. HEAD `ad8dd55`, not pushed; every record and all evidence are uncommitted.
4. **Needs your hands:** decide whether S1-8's close-first wording counts as a pass. Session 2 (tray
   Disconnect/Connect) is approved but runs only after a full pass and your fresh readiness.
5. **Would do next:** on your decision, Session 2 with the same back-to-back procedure
   (`actor.mjs disconnect` beside the driver). Its tray path is read-verified, but the actor's disconnect
   mode has **not** been exercised locally — the fake pane has no tray — so it needs that check first.
6. **Left changed on your devices:** as in the entry below, plus one Camera session. Afterwards the phone
   shows Sidekick's Camera screen, with no camera held. Every snapshot is identical to before.

# CAMERA SUPERVISED SESSIONS — 2026-10-03 (13:07–14:22 IST): update done; Session 1 NO READING (phone slept before the request); Session 2 NOT RUN

**Read this first.** Evidence: `docs/testing.md` → *Camera supervised sessions — 2026-10-03*; instruments
and outputs in `docs/evidence/camera-supervised-2026-10-03/` (uncommitted, with `MANIFEST.sha256`).

1. **Built and proven:** the approved update is installed and verified. Phone APK `98187d17…` (debug
   signer `d3a505d2…`, installed 13:16:37, link 3/3); Mac `dist` rebuilt from `ad8dd55`, relaunched once
   (pid 28482, no debug switches), connected, `camera` advertised. The driver passed its read-only
   validation. The separate actor (switch at ~5 s, Mac Stop at ~15 s, tray actions for case D) passed 41/41
   against a fake pane and fake `adb`, one mutation red; beside the real driver core, freezing it left the
   20 s cap to stop capture by itself at anchor + 19.504 s.
2. **Session 1: NO READING.** The dry-run passed at 14:17:01. At 14:17:47.96 the driver's gate found
   the phone asleep (`awake: false`, no resumed activity) and aborted **before any request**. No camera line
   on either end, no camera client. Per the approval, no retry. **Session 2: NOT RUN.**
3. **Committed:** nothing new. HEAD is still `ad8dd55`, not pushed. The new records here and in
   `docs/testing.md`, the overnight report's pointer and the evidence folder are uncommitted on purpose.
4. **Needs your hands:** a fresh approval to run Session 1 again (and then Session 2). The phone must
   stay awake and unlocked with Sidekick in front until the request appears; this time the request should
   follow the readiness reply with no read-only step in between that the screen timeout can outlast.
5. **Would do next:** exactly that — rerun the gates and the execute together, then Session 2 only on
   a full pass. `scripts/camera-driver.mjs` is unchanged. The actor lives in the evidence folder and imports
   `scripts/probe.mjs` by absolute path.
6. **Left changed on your devices:** the phone's APK (`98187d17…`); the Mac app relaunched (pid 28482),
   so `sidekick.json`'s mtime and inode changed (same bytes); the Mac's clipboard pushed to the phone on
   connect (the shipped auto-sync); the Mac's Camera pane is selected. The phone's perms, bindings
   (accessibility reads `null`, as before), prefs, trust store and receive folder, and all 65 protected Mac
   artifacts — the paused partial, its record and the `.failed` marker included — are identical to the
   pre-update snapshot (except that `sidekick.json`).

# CAMERA HARDENING OVERNIGHT — 2026-10-03 (unattended, ended 12:55 IST): 8 defects fixed, tests only; nothing on hardware

**Read this first.** Five local commits on top of `a93ebdb`, none pushed. **No device or app was touched**
and **none of this is hardware-verified; Camera is not release-ready.** The full report is
`docs/camera-overnight-2026-10-03.md`; the evidence is `docs/testing.md` → *Camera hardening overnight*.
The 22:38, 22:53 and 23:14 NO READINGs below are unchanged.

## 1. Built, and what proved it (tests only)

- **Phone:** 169 (a camera could bind after its stream ended), 170 (a tap after the deadline opened it),
  171 (the ack claimed an undeliverable notification), 176 (no line when a stream went live).
- **Mac:** 172 (undrawable frames invisible; frozen picture labelled live), 173 (connected with no
  identity to pin), 174 (a Mac Disconnect read "Your phone disconnected" — the predicted case D issue),
  175 (asking again after a cancel was refused as busy).
- **Driver:** `scripts/camera-driver.mjs` + `camera-driver-core.mjs`, with fixtures for every fault the
  2026-10-02 sittings lost a reading to. **Never run against a device.**
- Fresh: Mac **1,543 / 0**, phone **1,248 / 0** (all result files from a `--rerun-tasks` run), 23/23
  script fixture suites, all 16 hooks allow. **40 mutations: 39 red, M175-B survives** (explained).

## 2. Committed

`29386f3` (task 1), `9dbb8ab` (task 2), `2ddfd33` (task 3), `4164d96` (task 4), `ad8dd55` (the report).

## 3. Half-built

Nothing. The CLI's device functions are ports of r6's and have not executed.

## 4. Needs your hands

- Approval for the smallest hardware batch (the report's last section): one plain session with the new
  driver, then case D with the tray's Disconnect. Both need the `4164d96` debug APK installed and the Mac
  rebuilt and relaunched.
- Whether to keep the 2026-10-02 runs' raw outputs, which exist only in `/tmp`
  (`docs/evidence/camera-v1-drivers/README.md`).
- Whether to commit this file, `docs/camera-v1.md` and your `docs/testing.md` block (all still uncommitted).

## 5. Next, and why

The plain session first: it reads four of the eight fixes (169, 171, 172, 176) in one request, with the
driver's cap. Then case D, which is the one predicted user-visible failure.

## 6. Left changed on your devices

Nothing. Mac app pid 39218 and its `dist` unchanged; the 65 live artifacts (the paused partial, its
record, the `.failed` marker) identical in hash, size, mtime and inode; no `adb` command reached the phone.
The debug APK was assembled into `app/build` only.

---

# CAMERA CASE A, TIMED HOME — 2026-10-02 (23:14–23:17 IST): scripted procedure NO READING (your own Home came first); every product check held; evidence uncommitted

**Read this first.**
- **This sitting committed `a93ebdb` (docs only, local):** the batch result and the 23:01 retry result
  kept separate; defect 167's close-first re-attribution qualified as observed in the phone's log, the Mac
  retaining `stopped-by-mac`, the phone's screen not observed; and the post-reopen evidence marked
  retrospective.
- **Uncommitted:** the timed-Home attempt → `docs/testing.md` → *Camera case A with a timed Home*.

## What happened

1. **The repaired core gained one timed Home action** (fires once, only after THIS stream is live, and
   re-checked at the moment it fires) and a gated, flag-free reopen.
   - 21/21 local tests including the real 20 s cap.
   - Mutations H1, H2, H3 and H4 are red; the H2a control held.
2. **The read-only preflight was clean.** Dry gates passed; you answered *ready*.
3. **One request.**
   - You tapped at 23:16:20, and the picture was live at 23:16:21.
   - **You pressed Home at 23:16:24, before the driver's 5 s timer,** so the driver never sent its Home.
4. **On your Home, every product check held:**
   - `LEFT_SCREEN`, and the Mac's left-the-display wording;
   - the picture cleared and the camera released;
   - 63/63/63 frames, 0 drawn after the end;
   - the gated normal reopen, with no capture, no new request and no reused consent;
   - a clean 60 s watch from the confirmed reopen.
5. **Result:**
   - **the scripted timed-Home procedure is NO READING** (its step A never ran);
   - **the product behaviour for Home held.**
   - Whether that counts for case A is your call.
6. **Instrument race, recorded:** two phone lines read twice. No decision was affected.

## Left changed

- **Phone:** the CAMERA app-op reflects this session.
- **Mac:** one paint/draw-time wrapper on the running app (pid 39218).
- **Unchanged:** the protected artifacts and your files.

## Needs the owner

- How to count this for case A.
- If the scripted Home itself must be shown, one more attempt in which nobody touches the phone after
  Start camera.
- Whether to commit.
- B, C and D are unapproved.

---

# CAMERA CASE A RETRY — 2026-10-02 (22:53–23:04 IST): NO READING (Home after the 20 s cap); repaired driver held; close-first re-attribution seen; evidence uncommitted

**Read this first.**
- HEAD is still `a5e4874`; nothing was committed or pushed.
- The 22:38 batch keeps its result: **A NO READING, B, C and D NOT RUN.** This retry is recorded
  separately: `docs/testing.md` → *Camera case A retry*.

## What happened

1. **The driver was repaired (driver only)**, then proven locally:
   - 16/16 tests, including the stale 22:10 line, rotation, delayed approval and the real 20 s cap;
   - B0, **the 22:38 fault reinstated in full, is red on STALE**, and B1–B5 are red on their named tests;
   - no request was made during any of it.
2. **The read-only preflight was clean** (the approved builds), and bounds were written before the
   request. Dry gates passed; you answered *ready*.
3. **One request.**
   - You tapped Start camera at 23:01:34, and the picture was live at 23:01:35.
   - **Home came at 23:02:00**, so the deadline pressed the real Stop at 23:01:53 (19.5 s after the
     anchor).
   - **NO READING:** Home never ran during capture.
4. **Seen anyway:**
   - the cap armed on this stream's own start;
   - 266 frames drawn, 0 after Stop; one in flight at the close, discarded;
   - the camera released at 23:01:53;
   - **close-first re-attribution on hardware** — the phone ended it as `STREAM_CLOSED`, then
     re-attributed it to `STOPPED_BY_MAC` when the stop arrived 6 ms later; the Mac kept its own reason;
   - **no restart after your reopen at 23:03:05,** from a post-hoc read-only check.

## Not changed

- No product code.
- Defect 167's register row and section now say close-first was observed in the phone's hardware log, the
  Mac retaining `stopped-by-mac`, and the phone's screen redraw not observed.

## Left changed

- **Phone:** the CAMERA app-op reflects this session; `/sdcard/window_dump_cam.xml` is still there.
- **Mac:** unchanged apart from the one paint/draw-time wrapper on the running app (pid 39218).
- **Unchanged:** the protected artifacts and your files.

## Needs the owner

- Whether to commit this evidence.
- Approval for a new case A attempt. Suggestion: start counting the ~5 s for Home from the picture, and
  say it out loud on your side.
- B, C and D stay unapproved.

---

# CAMERA LIFECYCLE BATCH — 2026-10-02 (22:24–22:41 IST): case A NO READING (driver fault); B, C, D NOT RUN; evidence uncommitted

**Read this first.** One commit this sitting, **`a5e4874`** (docs only, local, not pushed):
- 168 hardware-verified;
- 167 hardware-verified for stop-message-first, with the close-first re-attribution tests only;
- the 21:33 expiry and your 21:51 session each recorded on their own.

The lifecycle evidence is uncommitted: `docs/testing.md` → *Camera lifecycle batch*, and
`docs/camera-v1.md` → *Lifecycle batch*.

## What happened

1. **Preparation.**
   - The driver was extended with a case action, a return step and a watch timed from the return: 14/14
     local tests including the real 20 s deadline; mutations L2 and L3 red, L1 unreachable today.
   - Acceptance bounds were written before any request.
   - D's Disconnect is the tray menu, so that D does not become C.
2. **Read-only preflight was clean:** approved builds, link up, idle, protected artifacts identical.
3. **Case A:** one request at 22:38:44.
   - The driver's phone-log poller read **the 22:10 session's `attached` line** as this one's, and armed
     the deadline at the request press.
   - It fired at +19.5 s, before any `Start camera tapped`, and pressed **Cancel request**.
   - No capture, 0 frames, no camera event. Home and the reopen were never reached.
   - **NO READING.**
4. **Batch stopped** on the instrument failure, as approved: **B, C and D not run**, and the driver not
   repaired.

## Closing checks

- The phone and the Mac are unchanged from the preflight: the paused partial, its record, the `.failed`
  marker, ledger `[]`, pairing and settings.
- Link 3/3.
- Your files are SHA-identical.

## Needs the owner

- Approval to fix the driver: only log lines after this request's offset, or naming its stream id, count.
  Prove it with a fixture holding the previous session's `attached` line.
- Approval for a new batch.
- The pre-registered prediction that **D fails on wording** (*"Your phone disconnected"* after a Mac
  Disconnect) is unverified, and is a likely defect for whenever D runs.

---

# CAMERA SESSION FOR 167/168 — 2026-10-02 (22:10 IST): PASS; nothing committed

**Read this first.** HEAD is still `a76ae78`. The evidence is uncommitted:
- `docs/testing.md` → *The owner's own camera session* and *Camera session for defects 167 and 168*;
- `docs/camera-v1.md` → *Second retry*.

The earlier unanswered attempt (21:33, expired) keeps its own record below and in `testing.md`.

## What happened

1. **The driver was fixed first** (the recorder's key collision) and rebuilt as a tested core: 10/10 local
   tests including the real 20 s deadline under failure; mutations D1, D2 and D4 red, D3 paired. No phone
   request during any of it.
2. **Read-only preflight.** The builds were unchanged and approved (`1f3a0a00…`; Mac pid 39218 on the
   21:28 `dist`). It found the owner's 21:51 camera session; you confirmed it. Instagram was in front;
   you opened Sidekick. A dry run read both ends. You answered *Ready to tap Start camera*.
3. **One request (22:10:54).** You tapped Start camera at 22:10:56.347 on the phone's clock.
   - **Switch:** the rear → front switch was requested, accepted and confirmed by frames.
   - **Stop:** the planned Stop was pressed 15.002 s after the anchor.
   - **End:** Mac *"You stopped the camera from this Mac."*; phone *"The Mac stopped the camera."*
   - **Frames:** 197 sent / 197 received / 197 drawn, 0 after Stop. No camera client and no restart for
     60 s.

## Status

- **168:** verified on hardware.
- **167:** verified for the stop-first order. **The close-first re-attribution was not exercised** — the
  stop reached the phone first this time. The genuine-loss refinement was seen in your 21:51 session.

## Left changed

- **Phone:** the CAMERA app-op reflects this session and yours; `/sdcard/window_dump_cam.xml` is still
  there.
- **Mac:** the running app (pid 39218) carries a single paint/draw-time wrapper on its camera painter
  until the next relaunch.
- **Unchanged:** the paused partial, its record, the `.failed` marker, the ledger and pairing.
- **Repo:** uncommitted appends to `docs/testing.md`, `docs/camera-v1.md` and this entry.

## Needs the owner

- Whether to commit the evidence.
- Whether the close-first order needs its own reading. It cannot be forced without a stimulus nobody has
  approved.
- The register rows for 167 and 168 still read *"not yet verified on hardware"*. They were left alone
  because `defects.md` is committed and this evidence is not.

---

# CAMERA RETRY — 2026-10-02 (21:24–21:36 IST): the one request EXPIRED unanswered; no capture; defects 167 and 168 NOT verified; nothing committed

**Read this first.** One approved session, run as approved, which ended before the camera was ever
allowed. HEAD is still `a76ae78`. Evidence: `docs/testing.md` → *Camera retry for defects 167 and 168*.
Summary: `docs/camera-v1.md` → *Retry results*.

## What happened

- **Updates:**
  - Phone: `a76ae78`'s debug APK (`1f3a0a00…`, same debug signer, installed bytes identical), then
    `link-up.sh` 3/3.
  - Mac: rebuilt and relaunched once (21:28:27), no debug switches, reconnected, `camera` advertised.
- **One request at 21:33:20.** Sidekick was not in front — Instagram was, in the preflight reading, and
  this was not acted on — so the phone **posted a notification** instead of the request screen.
  Start camera was never tapped.
- **Expired at 30.0 s on both ends** (phone `.462`, Mac `.561`): 0 frames. No camera client at any reading,
  and the CAMERA app-op's last access unchanged. The request notification is in the archive, not active.
- **60 s observation, by hand:** nothing opened or restarted.
- **No retry,** as approved.
- **The driver crashed while recording the ending:** its own `at` key collision. This was after the
  request ended, with nothing open. Its deadline logic was never exercised. A paint/draw-*time* counter
  stays wrapped round the running renderer's camera painter until the next relaunch.

## Preflight differences, all explained

- `sidekick.json` was rewritten with the same bytes at the Mac's 21:17 reconnect, after a 21:10 network
  drop.
- The empty Room lock file in the app's cache was gone, with the same process running. Probably cache
  trimming, not proven.
- **Your 21:30 share of three files, accepted at 21:31 — you confirmed it.** Three new files are in
  `~/Downloads/Sidekick`.
- The Mac's clipboard sync pushed 3,178 bytes to the phone at relaunch.

## Left changed

- **Phone:** the new debug APK (`lastUpdateTime` 21:28:02); `/sdcard/window_dump_cam.xml` from the first
  sitting, still there.
- **Mac:** `dist` rebuilt and the app relaunched (pid 39218).
- **Unchanged:** the paused partial, its record, the one `.failed` marker, ledger `[]`, pairing,
  permissions and preferences.
- **Repo:** uncommitted appends to `docs/testing.md`, `docs/camera-v1.md` and this entry. Your files are
  SHA-identical.

## Needs the owner

- A new approval for one session, with Sidekick in front on the phone — or the notification path stated
  plainly to you before the request.
- The driver's recorder fixed and dry-run through an ended request first.
- Whether to commit this evidence.

---

# CAMERA FOLLOW-UP — 2026-10-02 (evening): evidence committed; defects 167 and 168 fixed (tests only); 960 × 720 explained; nothing on hardware

**Read this first.** Three local commits on top of `c2913a1`, none pushed. **No install, relaunch, camera
request or other device action happened in this work.** The fixes are unverified on hardware.

## Commits

| Commit | Scope |
|---|---|
| `74dd2e2` | Docs: the first supervised Camera sitting — the precise results, and the **164.5 s overrun** of the approved 60 s observation, with the rule that drivers enforce the deadline |
| `35e1860` | Defects **167** (a Mac Stop worded as a closed connection) and **168** (the Mac's camera log) — Mac and phone, tests, `docs/protocol.md` → `camera.stop`, register rows and evidence |
| *(this commit)* | Docs: `docs/camera-v1.md` → *Resolution: why 960 × 720*, the two proposals, and the bounded retry plan; this entry |

## What changed

- **167:**
  - **Mac:** `camera.stop` is written first and everything is torn down in the same tick, never waiting
    for the ack. A phone `stopped` for an ended stream (same session, exact id) adds its counts once and
    replaces only the Mac's guess, `stream-lost`. An unexplained end says *"The camera stream ended."*,
    and no ending prints its reason token.
  - **Phone:** the owner's stop for the exact stream that has just closed re-attributes it from
    `STREAM_CLOSED` to `STOPPED_BY_MAC`; stated reasons are never touched.
- **168:** the Mac logs:
  - the request, the ack, approval, and the first frame with its size;
  - the switch as requested / accepted / confirmed by frames / refused;
  - one termination line with received, not-drawn and phone counts, and the phone's account once;
  - since-launch tallies. No per-frame lines, tokens, claims or frame bytes.
- **960 × 720 is the configuration working as written.** CameraX 1.4.2's `ResolutionSelector` defaults to
  4:3-first; this was read from its bytecode. The largest 4:3 size inside the 1280 × 720 bound is
  960 × 720. Nothing was changed. Two proposals, not implemented: log the selected sizes (low risk), and a
  16:9 configuration (recommended against).

## Evidence (fresh)

- **Mac:** `npm test` **1,504 / 0** (+12); typecheck app 0, test 0.
- **Phone:** `testDebugUnitTest --rerun-tasks` **1,207 / 0** (+6: camera-module 67). All 124 result
  files were from that run; Gradle exit 0.
- **Guards:**
  - all 16 commit hooks allow;
  - `check-defects` reports 152 rows, all with records;
  - `check-suites-run` is GREEN on both halves.
- **Mutations (each restore SHA-verified):**
  - Mac 167-A…G and 168-B…G are red on their named tests.
  - 168-A survives alone and is red with a second exit (168-A2); the guard holds in the control (A3).
  - Phone P167-A, B, D, E, F are red; C1 survives by design and C2 is red.

## Found on the way

- **`defects-in-sync.sh` denied two Bash commands that were not commits.** The hook is scoped
  `"if": "Bash(git commit *)"` in `.claude/settings.json`. It fired while the register held rows 167 and
  168 before their `testing.md` sections existed, and denied:
  - a Gradle run;
  - the shell append that would have fixed the drift.

  Both commands carried a heredoc; the simple commands in the same state passed. **A guess, not
  verified:** the harness may evaluate the `if` conservatively when it cannot parse a command. The way
  through was the Edit tool. Not changed.
- The refused/error state blocks still show the phone's error code (`CAMERA_BUSY`, `MALFORMED_FRAME`) as
  a code line. That is the app-wide state-block convention, not an end-reason token, and was left alone.

## Protected, verified unchanged

- Your `PRODUCT.md`, `skills-lock.json`, the earlier uncommitted `RESUME.md` entries and `testing.md`
  hunks: the unstaged diff is the start-of-session 739 / 6 after every commit.
- The running Mac app and its `dist`, which were not rebuilt.
- The phone: no `adb` command.
- The paused partial and its record, every `.failed` marker, and the 23 untracked files.

## Needs the owner

- Approval for the bounded retry in `docs/camera-v1.md` → *Bounded hardware retry plan for 167 and 168*.
  It is one session with a 20 s capture deadline that the driver enforces.
- Whether to take proposal 1 (log the selected sizes).
- Whether to look at the `defects-in-sync` hook.
- Whether to delete `/sdcard/window_dump_cam.xml`.
- Whether to push.

---

# CAMERA V1 FIRST HARDWARE SITTING — 2026-10-02 (19:41–20:07 IST): privacy checks and one approved session PASS; Mac Stop reports the wrong reason; nothing committed

**Read this first.** One bounded, supervised sitting on the SM-S938B, approved for preflight, two privacy
checks and **one** preview session only. HEAD is still `c2913a1`; nothing was committed. Evidence:
`docs/testing.md` → *Camera v1 — first supervised hardware sitting* (the last section). Summary and fix
directions: `docs/camera-v1.md` → *Hardware results*.

## What passed

- **Preflight:**
  - The phone was pinned once on USB. The owner connected it; it had been on the Wi-Fi link only.
  - The install waited for a live call to end.
  - `install -r` of `c2913a1`'s debug APK (`d0ce977f…`, the same debug signer as before), then
    `link-up.sh` 3/3.
  - The Mac was rebuilt and relaunched once with no debug switches, and reconnected.
  - The phone advertises `camera`. Nothing auto-started.
- **2A, an unanswered request:**
  - The phone named `Chetans-MacBook-Pro`.
  - No camera client at any one-second sample.
  - Both ends expired it at 30.0 s, with 0 frames.
- **2B, Decline:** `DECLINED` on both ends, 0 frames, and no camera event.
- **3, one approved session:**
  - The camera opened only after **Start camera**. No permission dialog appeared: `CAMERA` was already
    granted.
  - Rear, front and rear again were all switched from the Mac inside one stream, with no new request.
  - The owner confirmed by eye: it matched the phone's preview, front was mirrored the same way, and it
    stayed upright and un-stretched in landscape.
  - 960 × 720 from both cameras.
  - 2,325 frames sent, 0 dropped, 2,325 received.
  - One Mac Stop released the camera and cleared the picture, with no restart over the next 4 minutes.

## What failed, or was found

0. **Procedural overrun.** The approval allowed up to **60 s** of live observation, but the session ran
   **164.5 s**: the switch and rotation steps waited on questions, and the driver enforced no deadline.
   This was outside the approved bound. Future drivers arm the deadline at `attached` and press the real
   Stop when it fires, never extending silently.
1. **Mac Stop ends as `STREAM_CLOSED`.** The Mac closes the socket before it sends `camera.stop`, and the
   phone's reason then overrides the Mac's own `stopped-by-mac`. Both screens say the connection closed;
   the Mac adds *check … the same network* and a raw `stream-closed`. Fix direction and the wrong fix:
   `docs/camera-v1.md`.
2. **The Mac logs one `[camera]` line per session.** That line is the request ack: no live, switch, stop
   or received-frame lines.
3. The capture size is 960 × 720, not the 1280 × 720 target. Why is unread.
4. Instrument: one `uiautomator dump` wrote `/sdcard/window_dump_cam.xml` on the phone (screen text only).
   It was not deleted.

## Left changed on devices

- **Phone:** the debug APK, `lastUpdateTime` 2026-10-02 19:48:33. The CAMERA app-op's last access is this
  session. `/sdcard/window_dump_cam.xml`. Everything else is identical:
  - grants and the listener binding;
  - prefs and DataStore;
  - all 188 receive files;
  - no markers or partials.
- **Mac:** `dist` rebuilt and the app relaunched, so pid 99261 is gone. `sidekick.json` was rewritten with
  the same bytes. The paused pull is untouched: partial 100,663,296 B, inode 88373242, its record, the
  `(7).bin.failed` marker, and ledger `[]`.
- **Repo:** uncommitted additions to `docs/testing.md` (appended), `docs/camera-v1.md` and this entry. Your
  `PRODUCT.md`, `skills-lock.json`, earlier `RESUME.md` entries, earlier `testing.md` text and untracked
  files are unchanged, SHA-verified.

## Needs the owner

- Numbers for findings 1 and 2, and whether to fix them.
- Approval for any remaining plan step: 6 (Home), 7's pane exit, 8 (disconnect), 9 (busy). Also the
  permission dialog, which needs `CAMERA` revoked first — a permission change, so it needs its own
  approval.
- Whether to delete `/sdcard/window_dump_cam.xml`.
- Whether to commit.

---

# CAMERA V1 HANDOFF — 2026-10-02 (written 05:04 IST): built and tested with generated fixtures only; nothing on hardware

**Read this first.** Camera v1 — a live preview of the phone's camera inside the Mac's Camera pane — is
implemented on both sides with tests, in four local commits on top of `685a8f4`, none pushed. **It has not
run on any phone. It is not release-ready, and release builds do not install it.** Full design, evidence and
the hardware plan: `docs/camera-v1.md`. Contract: `docs/protocol.md` → Camera. Evidence: `docs/testing.md`
→ *Camera v1*.

## Commits

| Commit | Scope |
|---|---|
| `09fa76c` | Contract: `camera.request/stop/switch/state`, the camera claim on 42502 (`<token> camera <streamId>`, the mirror's token-only frame unchanged, no new listener), the 16-byte in-band frame header, `CAMERA_BUSY`/`CAMERA_UNAVAILABLE`, `SideChannelClaim`, `LinkServer` routing, the `camera` capability (no permission gate; `cameraServed` not defaulted) |
| `e9140b3` | Phone: new `:camera-module` — `CameraSessionMachine` (all rules), `CameraEngine`, `CameraActivity` (request screen; CameraX Preview + ImageAnalysis bound to the activity), `CameraStream`, codec/NV21/pacer, `CameraReleaseGate`; core session-ended listener list and camera notification channel; guards cover the new module |
| `a75b613` | Mac: `CameraController` (Electron-free), pinned stream socket, strict frame reader, `CameraView` + painter, nav entry built, Settings list, `peerFingerprint()` on the link |
| `c2913a1` | Docs: `docs/camera-v1.md` handoff and the `docs/testing.md` section |

## The privacy rules, and where each is held

- A Mac request never opens the camera — `CameraEffect.OpenCamera` comes only from `approve()`, called by
  the phone's request screen after **Start camera** (P1).
- Permission is not consent — `CAMERA` is asked by Android's dialog only after that tap.
- No socket or frame before approval; one claim per stream; owner-bound stop/switch/claim (P2–P5, P9, M1–M3).
- Foreground only: the camera is bound to `CameraActivity`; `onStop` ends a live stream (P11). No foreground
  service, no restart of any kind; consent dies with the stream.
- Every end releases camera, socket, timers, notification, then reports counts (P6).
- An old frame is never shown as live: two seconds without one hides the picture (M5, M11, M12).
- Release gate: `CameraReleaseGate.allows(debuggable)` (P12).

## Evidence (fresh at the end)

- Mac **1,492 / 0** (+41); typecheck 0. Phone **1,201 / 0** (camera-module 61, core +5), all result files from
  a `--rerun-tasks` run. Every guard green; fixture suites 21 / 21.
- **28 / 28 mutations red** on their named tests, restores SHA-verified, none uncounted.
- Isolated Mac build in scratch: 260 files, `tsc` 0. Debug APK assembled into `app/build`, **not installed**.

## Protected, verified unchanged at the end

`PRODUCT.md`, `skills-lock.json`, the owner's uncommitted `docs/testing.md` blocks (the start-of-night file is
an unchanged prefix of today's, with only the Camera section appended), the earlier `RESUME.md` entries
below, the 23 untracked files, and the running `dist` (pid 99261, not rebuilt, not relaunched). No `adb`
command, no install, no transfer, no Resume/Cancel, no pairing or permission change, nothing signed or pushed.

## Not done, and why

- **No hardware reading of any kind.** The nine-step supervised plan in `docs/camera-v1.md` needs one debug
  APK install and one Mac build + relaunch — both need the owner's go-ahead.
- `PRODUCT.md` still lists Camera as unbuilt — it is the owner's protected file and was not edited.
  `docs/phase-7-state.md` and `CLAUDE.md`'s roadmap likewise still describe the *webcam* as unbuilt, which
  remains true; neither yet mentions the preview.
- Front-camera mirroring/rotation, One UI's camera error codes and all performance are unmeasured.

---

# OVERNIGHT HANDOFF — 2026-10-02 (00:15–01:20 IST): four workstreams, tests only; nothing on hardware; running apps and live artifacts untouched

**Read this first.** Four local commits on top of `b1f62fc`, none pushed. **No result below is
hardware-proven, and the app is not finished or release-ready.** The metadata-based T5-B is still NO
READING; T5-A and T4-B are unapproved and unproven.

## Commits (each with its record in `docs/testing.md` and `docs/defects.md`)

| Commit | Workstream | Defects | Files |
|---|---|---|---|
| `264ec68` | 1 — transfer verdicts and recovery | 158, remaining paths | `bulk.ts`, `filesResume.test.ts` |
| `66f066f` | 4 — failure evidence and logs | **159, 160, 161** | Mac `bulk.ts`, `transferFiles.ts`, `fsBlocks.ts` + tests; phone `FsPartials`, the stores, `FsCorruptionProbe`, `BulkStops`, `BulkTransfers` + tests |
| `a99ee74` | 3 — Files controls and truthful state | **162, 163, 164, 165** | `renderer/files.ts`, `renderer.ts`, `main/files.ts`, `bulk.ts` + `filesWiring`/`filesView`/`filesResume` tests |
| `685a8f4` | 2 — source stability, stale metadata | **166** | phone `SourceStability`, `LiveStat`, the stores, `FsFeature`, `BulkTransfers`, `docs/protocol.md` + `SourceStabilityTest` |

What each one does:
- **158, remaining paths.** A TCP reset no longer downgrades a terminal `SOURCE_CHANGED` to an
  interruption: `close` and `error` share one bounded wait (3 s), entered once, after the claim only.
  Pause, Cancel, teardown and an in-flight record save during that wait are each pinned. A verdict later
  than the bound stays an interruption; that is defined, and not solved.
- **159.** `.failed` markers come in four kinds: checksum, block (the block number and both of its
  digests, and no whole-file hash), source-changed, and unverified. Marker writes report created /
  existed / failed. Retention is explicit and owned-only. The probe line no longer says CHECKSUM_MISMATCH
  for a block pull.
- **160.** A fresh push's own new partial is no longer called another app's file.
- **161.** One session end acts once.
- **162.** A finished send card no longer hides Pause and Cancel.
- **163.** Copy again keeps the valid local copy unless the new copy arrives.
- **164.** Pull state is keyed by root and id.
- **165.** Pause, interruption and low space are each worded once, and "started again from the beginning"
  appears only for a real restart.
- **166.** Block pulls use the file's own size and mtime (`fstat` on the provider's descriptor), and the
  index only when the provider gives none; a replacement under the read counts as changed. It is a
  metadata check, not an immutability guarantee.

## Evidence (fresh at 01:16–01:18)

- **Mac `npm test` 1,451 / 0** (from 1,421). `tsc --noEmit` app 0, test 0.
- **Phone 1,135 / 0**, all 118 result files written by a `--rerun-tasks` run: app 180, core 219, input 52,
  mirror 60, sync 624.
- **All 15 commit guards pass**, plus the force-stop hook's fixtures.
- **The Mac build** was verified in a scratch copy: `tsc` and `copy-assets` exit 0, 254 files. **The
  running `dist` was not rebuilt** (`4c50a4d2…`), and the app is still pid 99261.
- **The debug APK** was assembled into `app/build` only. It was not installed, and no manifest changed.
- **Red-first:** each fix's tests were red against the code before it, for the defect itself.
- **Mutations:** each red on its named test, with every restore SHA-256-verified, every verdict carrying
  an exit code, and Gradle results checked for age.
  - Mac: W1–W5 (W4 is two guards on one property: each alone survives, both together red), X1–X5, R1–R9.
  - Phone: P1, P2b, P3, P4, S1b–S7.
- **Not counted:**
  - P2's and M4's first forms (one did not compile, one hung).
  - S1, which does not reach the measured case.
  - One file-level warning that appears only with a name filter and is identical at `HEAD`.

## Protected, verified unchanged at the end

- Your `PRODUCT.md` and `skills-lock.json`, byte-identical.
- The 23 untracked files and 53 untracked links, identical.
- Your `docs/testing.md` block, and the uncommitted T5-B and prefix-check sections: the start-of-night
  file is an unchanged prefix of the current one, with only appended sections after it.
- The earlier `RESUME.md` entries below, unchanged.
- **All 56 live Mac artifacts** (size, mtime, inode, SHA-256): the T4-A marker, the paused partial
  (100,663,296 B, inode 88373242) and its record (768 blocks, M0), the H0 copy, and the ledger `[]`.
- **No `adb` command was issued**, so the phone source is still H1 with its row at M0.
- Nothing was staged, pushed, signed, released, relaunched or installed.

## Remaining limitations (each also stated in its defect section)

- **158:** a verdict later than 3 s is treated as none. The data stays safe, and the next Resume is
  asked again.
- **159:**
  - The `.failed` retention proposal needs your decision: (a) today's rule, (b) skip names whose marker
    exists, or (c) rename the superseded marker. The **T4-A marker** would be removed by the next
    successful copy of that file landing at `(7).bin` under today's rule (a).
  - No new marker is written when one already stands at that name; the log says so.
- **160, 161, 166:** the Android halves (each store's `createdNow` and `liveStamp`, `LiveStat`, the
  `forgetSession` gate) are not JVM-reachable. 166's call sites are held by a source scan.
- **166 is unmeasured on the device:** does `fstat` on MediaProvider's descriptor see the shell's write?
  - A same-size, mtime-restoring write passes the metadata check. The prefix re-hash covers a resumed
    prefix; nothing covers a concurrent write during a read.
  - Cloud providers fall back to their index, and say so.
  - The first resume after the phone upgrade restarts once.
- **165:** no automatic restart after a prefix mismatch was added, by design. The phone's own sentence
  *"…so it has to start again"* is unchanged.
- **163:** the pane does not re-check that the earlier copy still exists on disk.
- **No debug hold was built.** It was not needed.

## Supervised hardware checks still needed (none approved)

1. **The paused artifact supports only one of these two, and the order is the owner's choice.** Both
   need one Mac build and relaunch; (b) also needs a phone install.
   - **(a) New Mac, current phone build (`95a8cdd`): Resume once.** Verifies 158, 159 and 165. Pass: the
     phone answers `prefix-mismatch` with 0 bytes; the Mac discards the partial (inode 88373242) and the
     record within 3 s; a `(2).bin.failed` *source-changed* marker; no `(2).bin`; not auto-resumable;
     the pane shows no "paused".
   - **(b) New phone and new Mac: Resume once.** Verifies 166 and 165's restart. Pass: the ack refuses
     with `source-changed`, naming the file's own mtime; a restart from 0; the published file is **H1**;
     *"started again from the beginning"*. If the ack accepts instead, `fstat` does not see the write:
     NO READING for 166.

   The other check needs a fresh paused pull and a fresh, approved source edit.
2. **162:** send a file, then copy one back. Pause and Cancel are visible without pressing Done.
3. **163:** Copy again, then Cancel it. The earlier copy is still offered, and a row click starts
   nothing.
4. **160:** push a new name. The phone logs *"a new, empty partial created for this push"*.
5. **161:** Disconnect during a pull. Exactly one *"stopping 1 live stream(s)"* line, then *"already
   handled"*.
6. **159 (phone probe line):** only within an approved T4-type run.

---

# Resume here — written 2026-10-02 (00:15 IST): defect 158 fixed on the Mac in `b1f62fc` (tests only); not on hardware

Evidence: `docs/testing.md` → `### Defect 158` (committed); `docs/defects.md` row and section 158.

1. **The watch that was running closed at 23:50:43.** 0 reconnects, 0 claims; no additional transfer.
   Recorded in the prefix-check section (uncommitted).
2. **Defect 158** (register):
   - Phone prefix-change detection PASSED.
   - No mixed or corrupt file was published.
   - The Mac's terminal-failure handling FAILED.
   - Metadata-based T5-B stays NO READING; T5-A is unproven.
3. **The fix — `b1f62fc`, Mac only, local, not pushed:**
   - A short close of a block pull waits, bounded at 3 s, for the verdict. A terminal `SOURCE_CHANGED` takes
     the established discard: owned partial and record gone, an exclusive `.failed`, no restart.
   - Anything else is still an interruption.
   - Verdicts count only from the pull's own session and transfer.
   - A discarded pull leaves the auto-resume map.
   - Truthful resume log; the pane sentence no longer runs on.
   - Tests: +11 Mac (3 red before for the hardware's reason); M1–M7 each red on its named test.
   - Fresh runs: 1,421/0; typechecks 0; all 15 guards 0.
4. **Staging:** only the scoped files went in. `testing.md` was staged as HEAD plus the Defect 158 section.
   Left uncommitted, as instructed:
   - the owner's `testing.md` block, `PRODUCT.md` and `skills-lock.json`;
   - the T5-B retry and prefix-check sections;
   - the runbook, and this file.
5. **Not done (not approved):**
   - no `npm run build`; `dist` is still `4c50a4d2…`;
   - no relaunch, and nothing installed;
   - the live paused artifact is untouched: partial 100,663,296 B (inode 88373242), its record (768
     blocks, M0), and the phone source H1 with its row at M0.
6. **Proposed single hardware verification:** in the session reply of 2026-10-02.

# Resume here — written 2026-10-01 (23:50 IST): resume prefix check on a changed source — phone refused correctly; Mac kept it as an interruption; nothing committed

Evidence: `docs/testing.md` → *Changed source with unchanged indexed metadata — resume prefix check* (the last
section). **This is a separate result. T5-B (revision 2) stays NO READING at the metadata gate. T5-B's
metadata-based refusal and T5-A are unproven.**

1. **What happened (23:38–23:50):**
   - Preflight retaken with controls: pin, one session, `fs.blocks` 1, probe disarmed; the source H1 with its
     row and `fs.stat` at M0; the partial matched its record (inode 88373242); all 768 retained blocks
     re-hashed to the record; the 262,144 B tail past the verified prefix was treated as unverified.
   - **Resume pressed once (23:40:07).**
   - **Phone:** provisionally accepted, re-hashed blocks 0–767, and answered `SOURCE_CHANGED` / `prefix-mismatch`
     with **0 bytes sent**.
   - **Mac:** nothing was published, and the old prefix was never joined to the new file. But the Mac discarded
     the verdict and logged an **interruption**. Partial and record kept, no restart, auto-resumable on a reconnect
     within 10 minutes. Its own resume preparation truncated the partial to 100,663,296 B.
   - 60 s with no further transfer; every pre-existing file unchanged, the T4-A marker included.
2. **Committed:** nothing. Uncommitted, by instruction:
   - the new last section of `docs/testing.md`;
   - this entry;
   - the runbook banner line.

   The owner's edits are unchanged.
3. **Half-built:** nothing.
4. **Needs the owner:**
   - **The paused partial (768 old blocks, record M0) is still there.** Every Resume will mismatch again, so
     **Cancel** (the paused note's) is the only way out. That is the owner's call; nothing was cancelled.
   - Whether these get defect numbers:
     - the Mac ignoring `prefix-mismatch` when the bulk socket closes with 0 bytes (contradicts
       `docs/protocol.md`; no test covers that shape);
     - the premature *"re-hashed by the phone"* log;
     - the pane's refusal-as-pause sentence;
     - plus the earlier unnumbered findings.
   - Whether to commit.
5. **Left changed on devices:**
   - Mac: the partial was truncated by the app from 100,925,440 to 100,663,296 B; its record was updated
     (`updatedAtMs`). Nothing else changed.
   - Phone: unchanged since 23:15 (source H1, row M0).
   - Nothing deleted, installed or relaunched.

# Resume here — written 2026-10-01 (23:20 IST): L1/L2 T5-B retry (revision 2) — NO READING at the metadata gate; nothing committed

Evidence: `docs/testing.md` → *L1/L2 T5-B retry (runbook revision 2) on hardware* (the last section). Runbook:
`docs/l1-l2-t5b-runbook-2026-10-01.md` (status banner updated; uncommitted).

1. **What happened (23:06–23:17):**
   - The phone returned to USB. Every preflight check was retaken with a control and matched revision 2: M0, H0,
     inode 836493, `fs.stat`, probe disarmed, one session, `fs.blocks` 1, ledger `[]`, no partials, 53 Mac entries
     unchanged.
   - One explained difference: the 23:03 reconnect had cleared the pane's selection. It was restored with a gated,
     selection-only click (the entry was local, so no prefetch), before the cap.
   - Done at 23:14:45. Copy again once, then the real Pause at 46.7 % on `tf-bTWOjSmaPsSNQB9S4_S_kA`, with 768
     verified blocks and the record's `mtimeMs` = M0.
   - The guarded `dd` gave **H1** on the phone.
   - **The gate failed.** The product's `fs.stat` and MediaStore's row both still read **M0** after 30 s (and at
     140 s). The shell's write through `/sdcard` changes the file but not MediaStore's `DATE_MODIFIED`.
   - **Stopped:** Resume not pressed, no further attempt. **T5-B is unproven.**
2. **Committed:** nothing. Last commit `258227d`. Uncommitted, by instruction:
   - the new last section of `docs/testing.md`;
   - this entry;
   - the runbook banner.

   The owner's earlier uncommitted edits are left as they were.
3. **Half-built:** nothing.
4. **Needs the owner:**
   - **The paused pull is still standing.** Resume would test the prefix re-hash (block 100 is inside the 768
     verified blocks), a different case. Cancel on the paused note deletes the partial and record. Neither was
     done.
   - The runbook's only stimulus cannot reach the `source-changed` refusal. A new design is needed: a change the
     platform reflects in MediaStore. Its stimulus would need its own approval, and must not touch or fake
     metadata.
   - Whether to commit.
   - Numbers for the open findings: the send card, *"another app's file"*, the missing restart wording, T4-A's
     three, and now this metadata blind spot.
5. **Left changed on devices:**
   - Phone: the T5 source (`_id` 1000313356) is now **H1**, and its MediaStore row still reads M0. Nothing else
     changed (187 rows identical; `sidekick-pass-stop-200mb.bin` `bf375859…`).
   - Mac: the paused partial `.sidekick-t5-source-change-200mb (2).bin.sidekick-pull.part` (inode 88373242) and
     its `pull-resume` record were added. All 53 earlier entries are unchanged. Ledger `[]`. The pane shows Resume.
   - Nothing was deleted, installed or relaunched.

# Resume here — written 2026-10-01 (20:55 IST): L1/L2 T5-B — NO READING; warning explained; runbook revision 2 written (retry NOT approved); nothing committed

Evidence: `docs/testing.md` → *L1/L2 T5-B on hardware — NO READING* (the last section). Runbook:
`docs/l1-l2-t5b-runbook-2026-10-01.md` (uncommitted; the single retry is its revision 2, §R2).

1. **What happened (19:58–20:03):**
   - Preflight clean; the probe disarmed (log reading with a positive control).
   - Source `sidekick-t5-source-change-200mb.bin` (the approval's name; bytes from the runbook's seed), H0
     `b49846cb…12b93a`. H1 `b38a9052…0da7ba` computed independently (Mac `dd` + `shasum`).
   - Sent once through the pane's card: phone `_id` **1000313356**, M0 `1790864966`, hash H0, verified.
   - Pulled once (`tf-4yTFgavrfIJM7CLjQmjgCg`, offset 0). **The Pause watcher found no Pause button** in 40–60 %,
     pressed nothing, and stood down at 61.5 %. The pull completed and published the unchanged file (= H0).
   - **Stopped as required:** no source write, no `fs.stat` gate, no Resume, no retry. **T5-B is unproven.**
   - Why: `FilesView.renderDetail` gives the detail column to the finished **send card** until it is dismissed, so
     the selected file's Pause/Cancel/Copy controls were never drawn. A runbook gap, and a product finding
     (unresolved, unnumbered): after sending a file, its copy back cannot be paused until the card is dismissed.
2. **Committed:** nothing this sitting. Last commit `258227d`. Uncommitted, by instruction: the new last section
   of `docs/testing.md` with its two investigation subsections (the owner's block at ~25,996 is unchanged and
   separate), this entry, and the runbook (revision 2).
3. **Half-built:** nothing.
4. **Needs the owner:** the phone back on USB; whether to commit; approval for the single retry in §R2; whether the send-card finding and
   the three T4-A findings get numbers. The contract's *"started again from the beginning"* wording is still
   absent from the Mac and was **not** observed or passed.
5. **Done since (20:40–20:55, read-only):**
   - **The push's "another app's file" line is explained.** `DownloadsStore.openPartial` had just **created** row
     1000313356 ("staged … as a pending item"). `FsPartials.resumeFrom` tests "no record" before "empty", so every
     first push of a name reads as a foreign file. Publish removed 0 rows; snapshot A → B was one addition. It is
     misleading wording, not a foreign file. Not established: hidden files of other apps, and the state after
     20:02:47 (the phone left USB about 20:49; that reading failed its control and is not counted).
   - **Hidden-control finding** recorded separately: a completed send card hides the next pull's Pause and Cancel.
     Pressing **Done** is the retry's workaround, not a fix.
   - **Runbook revision 2** (`docs/l1-l2-t5b-runbook-2026-10-01.md` §R2): reuse `_id` 1000313356 after fresh checks
     (M0 1790864966, H0); press **Done**; confirm the selection's own controls; **Copy again** once; resolve the
     destination fresh (`… (2).bin` at 20:49); a new watcher bound to this attempt's id presses the real Pause; stop
     before any edit if Pause is unavailable or missed. **Not approved yet.**
6. **Left changed on devices:**
   - Phone: `Download/ConnectSuite/sidekick-t5-source-change-200mb.bin` (`_id` 1000313356, H0), added by the push.
     Nothing else changed (directory and rows identical since); the probe is not armed.
   - Mac: `~/Downloads/Sidekick/sidekick-t5-source-change-200mb.bin` (H0) added. All 52 earlier entries are
     unchanged, the T4-A marker included. The origin and expected-after files are in the session scratchpad.
     An inert watcher listener remains in the page until the next relaunch. Nothing deleted.

# (earlier) 2026-10-01: L1/L2 T4-A PASSED on hardware — block 800 named; evidence committed (docs only); T5 NOT approved

Evidence: `docs/testing.md` → *L1/L2 T4-A on hardware* (the last section). Plan: `docs/l1-l2-t4a-2026-10-01.md` §5.

1. **Proven on hardware (SM-S938B + this Mac, the synthetic `sidekick-pass-stop-200mb.bin` only):**
   - Armed once for `_id 1000308768`, ttl 300 s, on session `B5:9F:4B:BA…` (the Mac's own certificate).
     One **Copy again** press; the phone bound `tf-O_Tk0JuVS2fRILPc5oVnHQ` and flipped byte 104,923,136 (0x00 → 0xFF)
     after hashing it; the Mac claimed the same id at offset 0.
   - Mac: *"block 800 does not match what the phone read"* (so 800 blocks verified), after 107,479,040 B; nothing
     published at `sidekick-pass-stop-200mb (7).bin`; its partial and record gone; `(7).bin.failed` created
     (430 B) and kept; no retry or resume in 62 s of 5 s samples.
   - Source SHA-256 `bf375859…cbbec9` unchanged; all 51 pre-existing receive-folder entries unchanged (size,
     mtime, inode, SHA-256); ledger `[]`; `pull-resume/` empty; link 3/3.
   - Sender status recorded, not graded: `block pull failed … ConnectionResetException` after the Mac hung up.
2. **Committed:** `95a8cdd` (the preparation: probe, tests, plan), then the documentation-only commit after it
   (`git log -1 -- docs/l1-l2-t4a-2026-10-01.md`): the last section of `docs/testing.md`, this entry, and the
   plan's banner now saying hardware PASSED. Not pushed. The owner's `docs/testing.md` block (~line 25,996),
   `PRODUCT.md`, `skills-lock.json` and every untracked file were left unstaged and unchanged.
3. **Half-built:** nothing.
4. **Needs the owner:** whether the three findings below get defect numbers (they are recorded as
   unresolved and unnumbered); T5's definition and approval — a read-only T5 plan was given in the session
   reply and is not yet written into any document.
5. **Next, if wanted:** T5 once approved; the findings — (1) the `.failed` sidecar says *"checksum mismatch"* for a block mismatch
   and leaves `actual` empty; (2) the phone's probe log line still names `CHECKSUM_MISMATCH`; (3) after Copy
   again the pane's local-copy note is cleared, so a click on that row now starts an ordinary pull by itself.
6. **Left changed on devices:**
   - Phone: `install -r` of `95a8cdd` (`fa5523e7…`, 16:44:28); every grant, binding, app op and prefs file
     unchanged; probe disarmed (consumed); accessibility still off as the owner left it.
   - Mac: app and build unchanged (pid 99261, `dist` `4c50a4d2…`); `~/Downloads/Sidekick/sidekick-pass-stop-200mb
     (7).bin.failed` added and kept. Nothing deleted by hand.

# (earlier) 2026-10-01: T4-A prepared (scoped corruption probe, tests only); nothing installed or run; T5 NOT approved

The full record is `docs/l1-l2-t4a-2026-10-01.md`.

1. **Built and proven (tests only — not on hardware):**
   - **T4 = T4-A**, corruption in transit (rules doc §6 slice 3). T4-B (a retained partial altered while
     paused, S5) is a separate test and is not planned here. T5 is not approved.
   - `FsProbeActivity` is declared again, debug manifest only, `DUMP`-gated, no filter. It now arms only
     `FsCorruptionProbe`: one fixed byte (104,923,136 = block 800 of 1,600, XOR `0xFF`) of one fresh block
     pull of `downloads:connectsuite` / `sidekick-pass-stop-200mb.bin` / 209,715,200 B, for the one live
     session, one-shot, expiring (default 300 s, max 600 s), cleared on disarm, on its session ending, and on
     any near-miss request.
   - The global `BulkTransfers.debugCorruptAtByte` switch (any pull of any kind) is **deleted**. 597cb75 had
     dropped the activity's declaration with no stated reason; the safety intent was recorded in slice 3c
     (*global* arm, so left undeclared), and that intent is what this keeps.
   - Evidence: phone **1,112 / 0** (app 180, core 219, sync 601, input 52, mirror 60, every result file
     written this run); Mac **1,411 / 0**; typecheck 0; all 14 commit checkers 0. **19 mutations, all red**
     (14 phone, 5 Mac), each on the test named for it. Merged manifests rebuilt fresh: release
     `FsProbeActivity` **0** (6 activities), debug **1**, exported, `DUMP`, no filter (control: 11 probe
     components).
   - **No production failure/recovery behaviour changed.** A new Mac test shows today's code already gives
     T4-A's expected result: block named, nothing published, only that pull's partial and record removed,
     a `.failed` beside the free name, no automatic retry.
2. **Committed:** the local preparation commit containing `docs/l1-l2-t4a-2026-10-01.md` (`git log -1 --
   docs/l1-l2-t4a-2026-10-01.md`). Not pushed. The owner's uncommitted `PRODUCT.md`, `docs/testing.md`,
   `skills-lock.json` and untracked files were left unstaged and unchanged.
3. **Half-built:** nothing.
4. **Needs the owner:** approval for the single hardware run in `docs/l1-l2-t4a-2026-10-01.md` §5 (one debug
   `install -r` on the SM-S938B, one arm, one pull; no Mac rebuild). Re-check at preflight that no
   `sidekick-pass-stop-200mb (7).bin.failed` exists: the Mac's free-name rule does not skip a `.failed`, and
   the exclusive write would then leave **no** marker (existing behaviour, not changed).
5. **Next:** that run. Pass = §4's five lines plus `PROBE BOUND` naming the transfer the Mac claimed; no
   `PROBE BOUND` = no reading.
6. **Left changed on devices:** nothing. No device command was issued. The phone still runs the 2026-09-30
   18:16 `4095665` install, which has the old undeclared activity and the global hook (unreachable there).

# (earlier) 2026-09-30 (18:25 IST): T3 retry PASSED — defect 157 VERIFIED ON HARDWARE (all bounds met); T4–T5 NOT approved

- **Devices now run `4095665`:**
  - Phone: `install -r` 18:16:01, APK `4b7041cd…`, same signer; every reading unchanged except the trust
    row's last-seen time.
  - Mac: development app pid 99261, `dist` digest `4c50a4d2…`, no switches.
  - `fs.blocks: 1` negotiated; release flags false.
- **Owner action to know about:** the app was **force-stopped from the phone's Settings at 18:12:51**
  (before any of this), which turned its **accessibility service off**. It was left off. Turn it on again
  in Settings → Accessibility for remote input.
- **T3 retry (bounds fixed at 18:19:59, before the run):**
  - Disconnect at 83,886,080 B (40.00%). Pull stopped 1 ms after the click, settled at 12 ms (bound
    2,000; was 32,804). 0 B of partial growth (bound 16 MiB; was 125.6 MB).
  - The phone's stream ended 3 ms after its session (bound 1,000; was 2,571), counted `failed`, not
    `completed`.
  - One owned partial and one record (640 blocks, 0 B unverified tail); no final file.
  - Connect once: automatic resume at block 640. The phone re-hashed the prefix and sent 125,829,120 B, the
    remainder.
  - `sidekick-pass-stop-200mb (6).bin` SHA-256 equals the source. Partial and record gone, ledger `[]`,
    50 pre-existing files unchanged, source unchanged.
- **Committed** in the documentation-only commit after `4095665` (owner-approved):
  - `docs/defects.md`: the 157 row and heading say fixed in `4095665`, verified on hardware 2026-09-30.
  - `docs/testing.md`: only the `#### Defect 157 — verified on hardware` section. The owner's block stays
    uncommitted and unchanged.
  - This file.
- **Findings, not fixed:**
  1. the phone logs *"stopping 1 live stream(s)"* twice (two `forgetSession` callers);
  2. the paused sentence after an interruption repeats *"What had arrived is kept"* and gives two
     instructions ("continues when the phone is back" and "Resume continues").
- **Kept for review:** `(4)`, `(5)` and `(6)` copies in `~/Downloads/Sidekick`. Nothing deleted.

# (earlier) 2026-09-30 (18:15 IST): defect 157 fixed, TESTS ONLY (`4095665`); nothing installed; T4–T5 not approved

- **Committed `4095665`**, 11 files:
  - Mac: `link.ts`, `files.ts`, `shared/session.ts`, plus `filesResume.test.ts` +4 and
    `linkSessionEnded.test.ts`.
  - Phone: `BulkStops.kt` (new), `BulkTransfers.kt`, `ControlSession.kt`, `BulkStopsTest.kt`.
  - Docs: `docs/defects.md` row and section 157; `docs/testing.md` → Defect 157 (only Claude's section;
    the owner's block is unstaged and unchanged).
- **What it does:**
  - A session ending, by user Disconnect or by the phone closing the link, stops the bulk pull that
    session owns, as an interruption: partial and record kept, reconnect auto-resume unchanged.
  - The phone stops that session's live streams before their next chunk.
  - A block pull counts as completed on the phone only when its verdict was queued.
  - Pause is still manual; Cancel is unchanged; a replacement session is untouched.
- **Evidence:**
  - Red before the fix: 32,131 ms to settle; no event; the stream ran to `Sent`. Mutations MM1–6 and
    PM1–7 each red.
  - Measured stop: Mac 3 ms, phone 0 bytes after the flag.
  - Mac 1,409/0, phone 1,094/0, typechecks 0, guards 0.
- **Not proven on hardware.** The running Mac app (pid 76120) is `01ebf3b` and the phone is the 12:01:35
  install; neither has this fix.
- **Proposed single hardware retry (needs approval):** rebuild and install both, then one T3 exactly as
  before: Disconnect once at 40–60% receiver-confirmed, Connect once. Expected:
  - the partial stops growing within about one chunk;
  - the Mac logs *"stopped: the session it ran on ended"* at once, not after 30 s;
  - the phone logs *"stopping 1 live stream(s) it agreed"* and no `completed`;
  - the reconnect resumes from the verified boundary to a matching SHA-256.

# (earlier) 2026-09-30 (15:40 IST): L1/L2 T3 PASSED (Disconnect → Connect → automatic resume); T4–T5 not run

- **Docs commit `ab93925`:** defect 156 verified on hardware (T2 retry). Only Claude's `testing.md` section
  is in it; the owner's block is still unstaged.
- **T3, 15:34–15:36.** Source `sidekick-pass-stop-200mb.bin` (`_id=1000308768`, `bf375859…`). Mac
  pid 76120 on `01ebf3b`, `fs.blocks: 1`. The full preflight was retaken at 15:32.
  - **Started with the pane's "Copy again"** (the source was already local from T2, so a row click pulls
    nothing). The first driver run refused at its gate with *pane busy*; nothing was clicked.
  - **Disconnect** (Settings → Connection) pressed once, when the Mac's own partial held 84,148,224 B
    (40.13%). Mac logged `Disconnected: user disconnected`; the phone logged `Session … ended: peer
    closed the connection`.
- **What Disconnect did not stop (finding, not numbered):**
  - The phone **kept streaming over the bulk socket to 209,715,200 B**, logging it as `Sent` and
    `completed`.
  - It **dropped every block digest and the `done`** (*"Dropped fs.transfer.blocks: the session is
    closing"*).
  - The Mac then waited 30 s: *"not saved: the phone never said how the transfer ended … 640 blocks
    verified"*, then *"interrupted at 640 verified blocks of 1600; the partial and record are kept"*.
  - At rest: a full-length 209,715,200 B partial, one record (640 digests = 83,886,080 B), and no
    `(5)` file.
  - Cost: about 125.8 MB sent and discarded, and a 30 s wait before the pull counts as interrupted.
    The phone's "completed" tally counts a transfer the Mac did not save.
- **Connect** pressed once at 15:36:10, after the Mac's "interrupted" line.
  - Mac: *"resuming sidekick-pass-stop-200mb.bin automatically: interrupted less than 10 minutes ago in
    this run"*; *"resumes at 83886080 … (640 blocks verified on this Mac and re-hashed by the phone)"*;
    claimed at offset 83886080, so the unverified tail was cut off.
  - Phone: *"resuming at block 640 = byte 83886080"*, then `verifying` to 83,886,080, then `Sent … (125829120
    sent this time, resumed at 83886080)`, manifest `89d45891d883…`.
  - Mac: *"every one of 1600 blocks matched"*.
- **Result:**
  - `~/Downloads/Sidekick/sidekick-pass-stop-200mb (5).bin`, 209,715,200 B, SHA-256 equal to the source.
  - Partial and record gone; ledger `[]`. Only that file was added; all 49 pre-existing files have the
    same SHA-256.
  - The source is unchanged; the link is up.
- **Needs the owner:** whether the Disconnect finding gets a defect number. The likely fix direction
  is that the phone ends a session's live bulk streams when its control session ends, or the Mac aborts
  its active pulls on a user Disconnect. Also: T4/T5 approval.

# (earlier) 2026-09-30 (15:25 IST): L1/L2 T2 retry PASSED on hardware (Pause → Resume); T3–T5 not run

**T2 retry, 15:20–15:22. Source:** `sidekick-pass-stop-200mb.bin`, `_id=1000308768`, 209,715,200 B,
`bf375859…cbbec9`, re-hashed on the phone before and after. Mac pid 76120 on `01ebf3b`, `fs.blocks: 1`.

- **Pause:** the real `#files-pull-pause`, pressed once by the one-shot watcher at a phone `sending`
  report of 96,206,848 B (45.88%).
  - Phone: `fs.transfer.cancel (reason=pause)`, then `Cancelled: 99,876,864 of 209,715,200 bytes`.
  - Mac: `interrupted after 98304000`; *"paused by the person at 750 verified blocks of 1600 … it resumes
    only on Resume"*.
  - Disk: only `.sidekick-pass-stop-200mb (4).bin.sidekick-pull.part` (98,304,000 B, inode 86957531) and
    one record (750 digests, the same inode). No final file; ledger `[]`.
  - UI: *"sidekick-pass-stop-200mb.bin paused — Paused. What had arrived is kept; Resume continues from
    there."* / *"Paused: 94 MB of 200 MB is on this Mac, checked block by block. Resume continues from
    there."* / **Resume**.
- **No automatic resume, 15:20:09 → 15:21:52:**
  - 61 polls with no copying and no new transfer (the probe ended at its 60 s deadline, which it
    reports as an absence, not a reading);
  - 1 `fs.transfer.begin` on each side, the original;
  - the partial's size and mtime unchanged.
- **Resume, pressed once at 15:22:01:**
  - Mac: *"resumes at 98304000 of 209715200 bytes (750 blocks verified on this Mac and re-hashed by the
    phone)"*; `claimed … offset 98304000`.
  - Phone: *"resuming at block 750 = byte 98304000"*; *"resume accepted provisionally at block 750
    (prefix is re-hashed before sending)"*; `verifying` progress 262,144 → 98,304,000, then `sending`
    98,304,000 → 209,715,200.
  - Phone `Sent: 209715200 of 209715200 bytes (111411200 sent this time, resumed at 98304000)`, manifest
    `89d45891d883…`, the same as the full pull at 13:56.
  - Mac *"every one of 1600 blocks matched"*, in 1,869 ms.
- **Result:** `~/Downloads/Sidekick/sidekick-pass-stop-200mb (4).bin`, 209,715,200 B, SHA-256 equal to the
  source; the partial and the record are gone; `pull-resume/` is empty; ledger `[]`. The receive folder
  changed only by that file, and all 48 pre-existing files have the same SHA-256.
- **Defect 156 is now proven on hardware.** That note is not yet committed to `docs/defects.md` or
  `docs/testing.md`.

# (earlier) 2026-09-30 (14:12 IST): defect 156 fixed (`01ebf3b`) and live in the Mac dev app; T2 retry waiting for the phone's USB cable

- **Committed `01ebf3b`:** the Files pane's bridge and subscriptions are built by
  `filesBridgeFrom` / `wireFilesEvents` (`files.ts`), with Pause, paused-list and Cancel-paused passed
  through.
  - `filesWiring.test.ts` (3 tests): red against the moved-verbatim literal; mutations M0–M7 red.
  - Mac 1,402/0, both typechecks 0, 13 guards 0.
  - Defect 156 row and section in `docs/defects.md`. Evidence in `docs/testing.md`, which records T2 as
    *attempted; Pause/Resume not exercised because Pause was unreachable*.
  - Only that section of `testing.md` was committed; the owner's block is unstaged and byte-identical.
- **Mac, relaunched 14:08:52 (pid 76120):**
  - `dist` built from `01ebf3b`: 254 files, digest `29acb87b…`, all fresh; no switches.
  - Negotiated `fs.blocks: 1` with Samsung SM-S938B at 14:08:53. `FS_BLOCKS_RELEASE` false; 0 records
    at start.
  - The live page: the old watcher is gone, and `files.bridge` has `fsPullStop`, `fsPausedPulls` and
    `fsCancelPaused`.
- **T2 retry not started:** the SM-S938B left USB between 13:56 and 14:08 (`adb devices` is empty).
  The preflight's pinned-device, source-hash and phone-log readings need it.
- **Receive folder at 14:08:** 48 entries, unchanged since the T2 attempt; `pull-resume/` empty; ledger
  `[]`; no partials.

# (earlier) 2026-09-30 (14:00 IST): L1/L2 T1 PASSED; T2 NOT RUN — the Files pane has no Pause in the real app

> Supersedes the entries below for L1/L2. T1 passed. T2 was approved and attempted once; it stopped at
> its Pause and was not retried. T3–T5 have not been run and are not approved. Nothing was paused,
> cancelled, disconnected on purpose, corrupted, fixed or deleted.

**T2, 13:55:55: the Pause control does not exist in the running app. This is a wiring defect; no
defect number has been assigned (the owner's decision).**
- **The defect:** `desktop/src/renderer/renderer.ts:1162-1173` builds the Files pane's bridge with
  `fsPull` but without `fsPullStop`, `fsPausedPulls` or `fsCancelPaused`. The preload exposes all
  three on `window.connect`, and a live-page read confirmed them there.
- **Effect in the running build:**
  - `#files-pull-pause` and `#files-pull-cancel` are never drawn, because `files.ts:1755` requires
    `bridge.fsPullStop`.
  - `refreshPaused` returns at once, so a paused pull never shows **Resume**, its paused sentence, or
    its own Cancel.
  - The main-process side (stop, the records, automatic resume) is unaffected.
- **Why the suite passed:** `filesView.test.ts:929` gives the pane a bridge double that has the
  methods, so the test is right about the pane and never reaches the wiring.
- **Suggested fix, not made:** pass the three methods through in `renderer.ts`. Add a guard test that
  every optional `FilesBridge` method the preload exposes is passed through, shown red on today's tree.
- **Timing method (owner's choice, 13:5x):** the pane draws no percentage for a pull, so a one-shot
  in-page watcher on the phone's own `fs.transfer.progress` would press the real Pause once at 40–60%.
- **What happened:**
  - At 89,128,960 B (42.5%, a `sending` report) the watcher found 0 Pause buttons, with the right row
    selected and copying. It refused and clicked nothing.
  - The pull completed: the phone sent 209,715,200 B in 3,981 ms as 1,600 blocks of 128 KiB (manifest
    `89d45891d883…`); the Mac published after all 1,600 matched, 4,123 ms.
- **Source:** `Download/ConnectSuite/sidekick-pass-stop-200mb.bin`, `_id=1000308768`, 209,715,200 B,
  SHA-256 `bf375859eeb4cfaf4e51cc8554d5d14a03f9eb4f6419e7b966becf2d60cbbec9`. It is a synthetic sample
  from the Sidekick feature pass (`docs/sidekick-feature-pass.md`).
- **Left on the Mac, kept for review:**
  - `~/Downloads/Sidekick/sidekick-pass-stop-200mb (3).bin` (inode 86936039, SHA-256 equal to the
    source). It is the only receive-folder change.
  - No partial, no `.failed`, `pull-resume/` empty, ledger `[]`.
  - The page still holds the disarmed watcher (`window.__t2` plus one `onMessage` listener that only
    records events). It goes away when the app is relaunched.
- **To run T2 as written:** fix the wiring (a code change, needing approval), rebuild and relaunch, then
  take T2's preflight again. The new file will be saved as `(4)`.

**T1: one 96 MiB phone → Mac Files pull over `fs.blocks: 1`. PASS.**
- **Source:** `Download/ConnectSuite/sidekick-rc-96m-checksum.bin`, MediaStore `_id=1000312207`, owner
  `com.chetan.connectsuite.debug`, 100,663,296 B, `date_modified=1790660974`, SHA-256
  `567befd2c82465bac100becd3289dbeedb4e725586bf3e443044b8fe79dac80d`. It is the random file the Mac
  generated and pushed on 2026-09-29 11:19 (`docs/release-inventory.md` F-2), so it contains no personal
  data. Its hash, size and `date_modified` were unchanged after the pull.
- **How it was started:** the Files pane's own row click on root `downloads:connectsuite` ("Received
  files"), which selects the row and starts the pane's copy. The row was found by `data-id`, with the
  identity gate re-checked in the same expression that clicked. Scripts:
  `scratchpad/preflight/t1-a-locate.mjs` and `t1-b-pull.mjs`, both through `scripts/probe.mjs`.
- **Receiver-confirmed readings:**
  - Phone: registered `blockSize=131072, 768 blocks, from byte 0`, and `block pull Sent: 100663296 of
    100663296 bytes in 1588ms (507.1 Mbit/s), 768 blocks, manifest 31b63fab07a3…`.
  - Mac: `claimed … offset 0` at 12:11:43.272, then `pulled 100663296 bytes in 1732ms (465.0 Mbit/s) …
    verified=true (every one of 768 blocks matched); 385 frames … 0 rejected`, published 12:11:44.972.
  - Pane: click to outcome 2,089 ms; the block pull was agreed 337 ms after the click. Its text:
    *"Verified block by block: every part matched what the phone read, and the file did not change
    while it was copied."*
- **Saved file:** `~/Downloads/Sidekick/sidekick-rc-96m-checksum.bin`, inode 86920500, 100,663,296 B,
  SHA-256 equal to the source.
- **Receive folder:** only that one file was added; the other 46 entries have the same inode, size and
  mtime.
- **Leftovers:** no `.sidekick-pull.part`, `.part` or `.failed`. `userData/pull-resume/` was created by
  this pull (0700) and is empty; the record was dropped on success. Ledger `[]`; phone staging 0.
- **Free space and link:** Mac 28,280 → 28,175 MiB; link-up 3/3 after.

## Preflight, 12:05 IST

1. **Built and installed:**
   - **Phone:** debug `app-debug.apk`, built 11:57:27 from a clean `15e8243` tree, 96,746,572 B, SHA-256
     `bfe233d8…6aad97`. It replaced `939979ce…a4a022` (installed 2026-09-29 15:48:46) with `install -r` at
     12:01:21–36 on RZCY12330DT (SM-S938B) only.
     - Signer: both APKs `CN=Android Debug`, SHA-256 `d3a505d2…7d26`. Package `com.chetan.connectsuite.debug`,
       versionCode 1, versionName 2.0.0, debuggable.
     - Dex: `fs.blocks` ×4, `FsBlocks` ×2, `BlockPullSender` ×2 in the new APK and 0 in the old one. The
       controls (`ShareStaging` ×4, `LinkService` ×5) appear in both.
   - **Mac:** `desktop/dist` rebuilt from `15e8243` (`npm run build`, exit 0). It now holds 254 files, all
     written by this build, digest `ad109637…` (SHA-256 over the sorted per-file list). Before: 250 files,
     `7a7ff788…`, from 2026-09-29 15:48.
     - The old app (pid 17113) was quit with SIGTERM at 12:02:11. The new one was relaunched at 12:02:44 as
       pid 43238, with `--force-renderer-accessibility --remote-debugging-port=9222` and no
       `CONNECTSUITE_*` variables.
2. **Negotiation, read on both sides:**
   - **New phone, old Mac** (12:01:41): the phone advertised `fs.blocks 1`, the Mac advertised none,
     negotiated none — *"pulls above 64 MiB are unverified and not resumable, as before"*.
   - **Both new** (12:02:46): negotiated
     `{"share.file":3,"share.ask":1,"share.wait":30,"fs.blocks":1}`. The phone says *"block-verified and
     resumable"*. The Mac says `fs.blocks 1 ADVERTISED (packaged: false; FS_BLOCKS_RELEASE: false)`.
   - The share keys are identical to the 10:11 run. `FS_BLOCKS_RELEASE = false` in `Extensions.kt:79`,
     in `extensions.ts:32`, and in the emitted `dist/shared/extensions.js`.
3. **Device state, before (11:56 and 12:01) against after (12:03). All equal:**
   - grants: 28 `granted=true` / 18 false;
   - app ops: 60;
   - notification listener and accessibility bindings (full strings);
   - `accessibility_enabled=1`;
   - prefs: 5 files, every file's md5;
   - trust: 1 row, `b59f4bba…`, read with its WAL. Only `lastSeenAtMillis` moved, to the 12:02:46
     handshake;
   - staging: 0 entries (the startup sweep logged `deleted=0`);
   - `Download/ConnectSuite`: 207 lines, no `.part` or `.failed`;
   - link: `link-up.sh` 3/3.
4. **Stores a sweep could touch, all empty before and after:**
   - Mac `userData/pull-resume/` does not exist (logged *"0 expired at start"*);
   - ledger `[]`;
   - `~/Downloads/Sidekick`: 46 entries, identical inode, size, mtime and SHA-256, with no partial or
     sidecar.
   - Release APK folder: identical hashes and inodes (`app-release.apk` `9ccf7b63…`, 2026-09-29 15:52:38).
5. **Tests, fresh:** Mac 1,399/0. Phone 1,087/0 (app 177, core 219, sync 579, input 52, mirror 60), every
   XML written after the run began.
6. **Free space:**
   - Mac 28,917 → 28,299 MiB.
   - Phone 6,308,384 → 6,187,952 KiB (99% used). The phone was falling about 28 MB per 5 minutes
     before the install; the cause is not ours and was not investigated.
7. **Found, not acted on:**
   - After `install -r` the phone was **not** serverless: LinkService restarted by LISTENER_REBIND,
     PACKAGE_REPLACED and ACCESSIBILITY_BIND within 1.6 s. This contradicts the `CLAUDE.md` banner.
     `am start` was sent anyway.
   - The owner pushed three screenshots Mac → phone at 11:56:02 (completed and verified) before the
     install.
8. **Next, needs the owner:** decide on the Pause wiring fix (see T2 above), then T2–T5. The phone still has 5.9 GiB free, and the Mac's receive
   folder is the default `~/Downloads/Sidekick`.

# Resume here — written 2026-09-29 (16:10 IST): the complete-app pass, day one — file sharing verified on hardware, release gated on the owner

> Supersedes the entries below. Evidence: `docs/complete-app-pass-2026-09-29.md` §1–§8. Status of every
> feature: `docs/release-inventory.md`. Release decision: `docs/ship-no-ship-2026-09-29.md`.

1. **Built and proven on hardware today (SM-S938B + this Mac, synthetic files only):**
   - Android → Mac several files: Gallery R1 (Accept, Decline, Accept out of order), My Files with a
     per-file Cancel, a text-only My Files selection. Every save hash-equal; exclusive `(2)` names; nothing
     before Accept; no focus stolen.
   - Mac → phone above 64 MiB checksummed (96 MiB *checksum matched*).
   - `share.wait` (PROPOSED): 30-minute offers negotiated, visible *until HH:MM*, expired on time with
     cleanup; an older peer falls back to 10.
   - Photos checksummed; thumbnails bounded (defect 136); album labels 11 of 11 distinct (defect 89,
     including a second Android profile `/storage/emulated/95`).
   - Light theme: committed rendered sweep, 2,880 text elements, 0 below AA.
2. **Committed, local, not pushed:** `ec71870` … `d5ad38a` (see `git log 3af33a2..HEAD`).
   Final code tree `42ac5e5`: phone 1,058 / 0 and Mac 1,342 / 0, all fresh; 14 guards and 20 fixture suites pass.
3. **Tests only, owed a hardware reading:** defect 148's *refusal* (needs a second Mac); 150/154 races;
   L3 on a genuinely full disk; L4's copy on a too-large share; the **single `.txt` share hop**
   (`SendSelectionActivity` → file sheet, grant forwarded) — attempted 16:04, aborted before any offer
   when the owner took the phone. The Samsung trash clause is not observable on today's data.
4. **Needs the owner:**
   - The release decision (`docs/ship-no-ship-2026-09-29.md`): signing (B1/B2), the proposed policy
     values (several files, `MAX_FILES` 10, ½ quota + 1 GiB reserve + 5 s, 60-minute queue, 10/60 stall
     clock, `share.wait` 30), and the bounded acceptance test.
   - **`assembleRelease` signed an APK with your release key unintentionally** (a keystore is
     configured on this Mac). It sits in `app/build/outputs/apk/release/`, not installed or shared —
     delete or keep, your call.
   - Approve the L1/L2 contract work (`docs/large-file-strategy-2026-09-29.md`) before any large-file
     protocol change; 500 GB is **not** supported.
5. **Next, in order:** the single `.txt` hop on hardware (My Files opened directly at the synthetic
   folder, as §8); L1/L2 once approved; defect 30's no-thread half (needs a consenting number); TalkBack
   and VoiceOver passes.
6. **Left changed on devices:**
   - Phone: three same-certificate `install -r` of the debug build (last 15:48, containing `8f19af6`);
     grants, bindings, settings, pairing and link identical before and after each.
     Synthetic files added to `Pictures/` and `Documents/SidekickShareTest` (six, 11:20).
   - Mac: `dist` rebuilt from the committed tree and the dev app relaunched (15:48); `~/Downloads/Sidekick`
     gained only synthetic test files (clip (2).mp4, 002.jpg, doc.pdf, notes/table and their `(2)` copies,
     003.png, the 1 MiB pull `(2)`), plus the owner's own two screenshot pulls. Nothing deleted.
   - Your `PRODUCT.md`, `skills-lock.json` and `docs/testing.md` block: untouched, uncommitted.

# Resume here — written 2026-09-29 (02:45 IST, unattended, owner-authorised): faster Mac → phone sends; Option B installed; the phone was locked all night

> Supersedes the entries below. Evidence: `docs/transfer-overnight-2026-09-29.md` (outside
> `docs/testing.md`, which still holds the owner's uncommitted Run A block).

1. **Built and verified on hardware:**
   - **Mac → phone sends, both ends.** Eight 1 MiB files, click to the last verified verdict:
     original build 1,348–1,571 ms → **706–782 ms**.
     - Mac side: a bounded push queue, and at most 3 files being written at once (`4ba09ed`, `aff63a9`).
     - Phone side: a publish that looks up one row instead of listing the folder, and deletes by name
       only when something is there (`f8dca91`).
     - Large files gained ≈ 6% (32 MiB: 39.2 → 41.2–42.1 MB/s, interleaved A/B).
   - **Same-name safety.** Two files that could reach one name on the phone are never in flight together.
     A different file sent under an existing name arrived as `(2)`, and the original's hash was unchanged.
2. **Built, tests only (the phone was locked all night):**
   - Option B, the fixed 1 GiB reserve, development only (`b641aca`). Installed on the phone, never
     exercised.
   - Each offered row in the several-files screen has its own Cancel (`352f1b3`), debug-only. Never drawn.
3. **Not measured:** phone → Mac through the share path. The product's Accept gate needs a
   person-focused window, which automation cannot produce, and it was not worked around. The Files pull
   (the same phone sender) was measured: 64 MiB at 330.6 Mbit/s on the wire.
4. **Needs the owner:**
   - Retake Run A's A1 baseline from scratch. Option B changes the floor, and the phone now runs
     `f8dca91` (installed 02:26:42).
   - Unlock the phone for any share-sheet flow and Run B.
   - Decide the several-files production path (evidence file §8).
   - Decide large-file verification (§9).
   - Decide whether findings 1–3 get defect numbers.
   - Review about 437 MiB of `sidekick-speed-*` synthetic files in the phone's `Download/ConnectSuite`.
     They were left there on purpose.
5. **Left changed:**
   - Phone: three same-signature `install -r`; grants, bindings, trust row and settings were identical
     before and after each.
   - Mac: `desktop/dist` = `aff63a9` build `ffe2fceae4a128ae`; the dev app is running with no switches,
     version 2, connected.
   - Nothing armed, pushed, packaged or deleted.

# Resume here — written 2026-09-28 (20:45 IST): Run A A1 PAUSED at the baseline — phone free space below the budget floor

> Supersedes the entry below for Run A. Details are in the runbook's top banner.

1. **Built:** nothing new this sitting.
2. **Committed:** a docs commit with this entry.
3. **Half-built:** nothing.
4. **Needs the owner:** free space on the SM-S938B, roughly 16.1 GB free needed.
   - It read 10,047,544 KiB (2%) at 20:29, down from 18 GB at 15:0x.
   - Under the provisional floor of 3%·T + 1 GiB (15,773,540,025 B here), the second concurrent copy would be
     refused, so A1's two waiting cards cannot form.
   - The drop is not Sidekick's (its cache, staging and both synthetic folders total about 463 KiB); the cause
     is unknown and deliberately not investigated.
   - Then say so, and the whole A1 baseline is retaken from scratch before P2.
5. **Next:** A1, only after that baseline passes (runbook banner).
6. **Left changed on devices:** nothing.
   - Phone: not armed, no component switch, nothing written.
   - Mac: app stopped; `desktop/dist` = `967117b` build `cb74d20d6de3172e`; ledger `[]`.

# Resume here — written 2026-09-28 (15:35 IST, owner-approved Mac block): F4 built, F5 corrected, dist rebuilt — stopped at the Run A A1 gate

> Supersedes the entry below. The exact A1 sequence, and restore, is the banner at the top of
> `docs/feature-a-v3-supervised-runbook.md`.

1. **Built and proven.**
   - **F4:** a new waiting file is never left out of sight (`e19f642`). It is revealed without focus when
     nobody is using the window. Otherwise an indicator names it and leads to it, and the indicator's slot is
     reserved so it never moves the list.
     - **Tests:** 19, 16 of them red against HEAD; 10 mutations, each red.
     - **Harness at the 560 px cap:** idle, hovered, wheel and indicator-press all behave as specified; the
       window was never focused; no decide or act was sent.
     - Three failed designs are recorded in the commit.
   - **F5** (`967117b`): proposal §5 now quotes the shipped consent copy verbatim, with provenance.
2. **Committed, local, not pushed:** `e19f642`, `967117b`, plus a docs commit with this entry.
   - Mac 1,301/0, both typechecks clean.
   - 17 commit guards 0. `motion-sweep` unrun: it needs the main app on :9222, whose launch connects to the
     phone.
3. **Half-built:** nothing.
4. **Needs the owner:**
   - **F5's open item:** Accept's accessible name does not repeat the consent sentence, which §5 had claimed.
   - Then Run A A1: P2 → M3 → read back → the owner's two shares → the owner's two Accepts → §R.
5. **Next:** Run A A1 (runbook banner).
6. **Left changed:**
   - **`desktop/dist` rebuilt**: `git archive` of `967117b`, digest `cb74d20d6de3172e`, was `e604479d0c471925`
     (`491cd21`), with the Mac app stopped and not relaunched.
   - Nothing on the SM-S938B.

# Resume here — written 2026-09-28 (15:10 IST, unattended): Stage A hardened, window reviewed, live preflight ready — no device write

> Supersedes the entry below. Evidence: `docs/feature-a-v3-unattended-2026-09-28.md` (kept out of
> `docs/testing.md` only because that file holds the owner's uncommitted Run A block; fold it in when
> that block is committed).

1. **Built and proven.** Each item is red under its named mutations; sources restored by checksum.
   - **Phone:** `Σ` and the disk agree per offer, under real staged files, for every end (`1f86ab8`, 11
     tests, 5 mutations). The Σ follow-up itself is `c8df24b`, read and re-run.
   - **Mac, the window's re-presentation call site** (`d407dd6`): driven by a real v3 receiver, 1 test plus
     the source guard, 4 mutations.
   - **Mac, disconnect** with waiting, queued and receiving files together: ledger `[]` and 0 reserved after
     (`d721afd`, 3 mutations).
   - **Mac, the finished-card Close accessible name at v3** (`4498d4b`), found in an isolated window harness.
2. **Committed, local, not pushed:** `1f86ab8`, `d407dd6`, `d721afd`, `4498d4b`, plus a docs commit with
   this entry.
   - **Suites:** phone 217/528/164/52/60, 0 failures (`--rerun-tasks`); Mac 1,282/0; both typechecks clean.
   - **Guards:** 17 commit guards 0. `motion-sweep` was not run (it needs the app).
3. **Half-built:** nothing. The harness (`docs/evidence/feature-a-v3-window-harness-2026-09-28/`) is an
   evidence artifact, not product code.
4. **Needs the owner:**
   - **F4:** the newest waiting file can arrive out of sight; the 4th and 5th arrivals are 0% on screen.
     Every fix changes what a person sees before consenting.
   - **F5:** proposal §5's consent sentence is stale against the owner's wording in code.
   - Whether to M1 so the Close label is under test.
   - Then the live test: **P2 → M3 → the owner's two shares and clicks → restore**. The runbook's new
     preflight banner has the exact list. No install, no P5, no component switch.
5. **Next:** Run A A1 as written, with two different files accepted out of order. It is the first proof of
   version 3 with two different files, and every precondition was read today (runbook preflight).
6. **Left changed on devices:** none.
   - SM-S938B: reads only.
   - Mac: the dev app still stopped; `desktop/dist` untouched (11:13:57). A harness Electron (CDP :9333,
     scratchpad only) was started and then quit.

# Resume here — written 2026-09-28 (03:30, overnight, unsupervised): hardening, the §11 instrument, the live-region fix — no Samsung write

> Supersedes the entry below. `docs/testing.md` → *Run A after 02:31* and *overnight hardening* hold every
> number. **Nothing was installed, enabled, armed, sent, accepted, declined or deleted on the SM-S938B or
> the Mac; the Mac app (pid 5021) and `desktop/dist` were not touched; nothing pushed.**

1. **Live state, read 03:2x (read-only):** Mac pid 5021 since 02:25:24; one handshake since then, still
   `share.file 3` + `share.ask 1`; phone `link-up.sh` 3/3; no `[share]` line after 02:36:53; the receive folder
   identical to the start-of-night snapshot (SHA-256 included). **Any reconnect drops the session to version 2**
   (the arm was one-shot) — re-arm (P2) before continuing Run A if that happens.
2. **Run A, from the log:** at 02:36 two simultaneous waiting offers — **of one file twice** — accepted in arrival
   order, `0 ahead`, both saved equal to the source. A1 as written (two **different** files, out of order) is
   still owed; A2–A4 not run.
3. **Committed, local:** `881c7e2` (Mac: the stale `#share-live` announcement — one rule for the tray and both
   window views); `8690e1f` (phone: a repeated URI refused; the selection pinned to its session so a reconnect
   cannot carry it to another; the `onStop` rule tested); `e916f66` (phone: the §11 `SEND_MULTIPLE` grant
   instrument, and an in-app switch for the two disabled components); a docs commit with this file.
   **`docs/testing.md` is left uncommitted on purpose** — it holds your paused Run A notes as well as tonight's.
4. **Verified:** phone 217/0, 505/0, 164/0, 52/0, 60/0 (`--rerun-tasks`); Mac 1,274/0; 16 checkers 0; 11
   mutations red on named tests (3 Mac, 8 phone); release manifest and release classes free of every several-files and probe
   class. APKs built, installed only on the emulator.
5. **Found:** the shell's `pm enable` is **refused on the SDK 37 emulator** — the runbook's P3; not measured on
   the Samsung; the in-app switch is the fallback. Emulator grant readings (DocumentsUI): readable while stopped
   (+30 s) and after recreation, refused +1 s to +120 s after finish — **emulator only**.
6. **Needs the owner:** review the three code commits and the repeat-refusal policy; decide finding F1 (an
   unbounded main-thread wait in `ShareManyQueue.end`, `docs/feature-a-v3-production-enablement.md` §6); the
   supervised steps in that file's companion runbook, starting with finishing Run A. **Run B needs a rebuilt
   debug APK and a fresh P1** — the installed build predates tonight's commits.

# Resume here — written 2026-09-28 (02:00): Run A prepared — Mac quit, dist built, phone installed; nothing armed

> Supersedes the entry below for Run A. `docs/testing.md` → *Version 3 Run A — preparation* has every reading.

1. **Done, each owner-approved:** M2 (⌘Q, pid 93018 exited), M1 (`dist` = `5ab8774`, `shareV3` present,
   switch off), P1 (`install -r` of `92f503af…`, MainActivity started). All after-readings equal their
   before-readings; `SEND_MULTIPLE` resolves to nothing of ours.
2. **State:** the Mac app is **stopped**; the phone serves `share.file 2`, unarmed, `link-up.sh` 2/3.
3. **Fixed 02:0x, owner-approved, committed with this entry:** a queued version-3 single-file sheet now reads
   *"Accepted on {Mac} — waiting its turn"*, not *"Sending"*; version 2 unchanged. The runbook's
   expected wording is corrected (Mac *"Accepted — waiting its turn"* / *"1 transfer is ahead of it."*;
   phone A3 *"Declined on {Mac}"*), and it now says a queue may not form at all with files this small.
   Then (same morning): a queued file draws **no transfer bar**, and a disconnect while queued says
   *"…ended while it was waiting its turn. Nothing was sent."* — not a dropped transfer. The runbook
   now says two small images prove two simultaneous waiting offers, and a queue **only if observed**.
   **The phone still runs `92f503af…`, without either fix** — it needs the committed debug APK and a
   second P1.
4. **Next, needs the owner:** review; commit; P1 again; then P2 (arm) and M3 (launch with `shareV3`),
   in that order, Mac still quit.

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
