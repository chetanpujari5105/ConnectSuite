# Morning plan — 2026-10-07 (owner present; every numbered step needs its own go-ahead)

**State at handoff (03:55 IST):** Mac runs `4661015` (PID 67469, `desktop/dist` `bb594168…`), watcher **off**,
pairing **v2**. Phone runs `286e2b0` (`5f014e9e…30ad`, installed 2026-10-06 23:23:31), **locked and dozing**
at the 02:4x read-only check. Nothing from tonight is installed. Stage D is **PARTIAL** (`docs/evidence/
stage-d-2026-10-07/RECORD.md`); Wi-Fi interruption (C step 3), pairing cancellation (H4b) and stages E/F are
unverified.

**Ready, not installed** (session scratch, `artifacts-bf096e1/`): Mac `dist` manifest `0c074f7d…2f29` (312
files, same §9.2 procedure); packaged `Sidekick.app` (fuses `000011011`, `app.asar` `5127b900…f9851`,
deep-verified ad-hoc); debug APK `9b7d34f0…17f7` (signer `d3a505d2…7d26`, versionCode 1 — an `install -r`
update). **Superseded and not to be installed:** the `6777b74` scratch package (carried the withdrawn
quarantine exclusions).

## 0. Decide first: resume D on the current builds, or update first

Tonight's fixes change exactly what D measures: the phone now logs **every** focus-sync exit by name and each
selection start by route (`PROCESS_TEXT` / `SEND`), and the Mac counts the offer banner's
*requested / reported shown / failed* states and says a refusal in the pane. **Recommended: update first (1),
then resume D (2)** — otherwise step 6 can fail again with the same blind spot.

## 1. Update both apps (approval: install + relaunch)

1. Read-only pre-checks as in §9.6 of the verification plan (pin, signer, versionCode, grants per profile,
   listener bound, watcher off, rollback copies `shasum -c`).
2. Phone: `scripts/adb-pinned.sh samsung install -r --user 0 <artifacts>/app-debug-bf096e1.apk`; then
   `scripts/link-up.sh` (autostart restarted the link last time; if not, start `MainActivity` by name).
3. Mac: quit Sidekick from its menu; move the live `dist` aside (as A3); `ditto` the `bf096e1` dist in; verify
   `0c074f7d…`; relaunch with the two verification flags. The Activity rewrite already ran in A3 and is
   idempotent; expect no rewrite count.
4. Pass: three `link-up.sh` OKs, `pairing: v2`, watcher off (setting + IPC), grants unchanged.

## 2. Resume stage D (owner's hands; synthetic markers only)

The Mac clipboard currently holds **non-marker content not written by Sidekick** — not read. Before any step the
owner replaces it with M-BASE, as in step 1.

1. **Step 6 again, with an instrument that can see the toolbar.** Before the tap: start a bounded logcat read
   for `ActivityTaskManager` `START` lines and the app's `clip` tag; the owner long-presses in the test note and
   **a `screencap` of the toolbar is taken** (the popup window is in a screenshot even where `uiautomator` cannot
   read it; kept private unless the owner approves it as evidence). Owner taps *Send to Mac* once.
   - `START … SendSelectionActivity` + `selection route: PROCESS_TEXT (Text)` + a Mac offer → toolbar route
     **works**; step 6's earlier miss stays unexplained.
   - toolbar item visible, tapped, **no** `START` → the tap did not dispatch (A).
   - `START` present, no `selection route` line → delivery or the activity (B).
2. **Step 7** — Dismiss an offer: clipboard unchanged, `Offer dismissed` line.
3. **Step 8** — one focus sync with M-SYNC-1: owner copies it on the phone, opens Sidekick; read the new
   `focus sync: <REASON>` line (expect `SENT`), the Mac's arrival, and the clipboard equality helper.
4. **Banner (step 3)**: Sidekick unfocused, one offer. With the dev build macOS refuses the banner by design; the
   pass is now the app saying so: `offer notification FAILED — …` in the log **and** the pane's sentence. A
   banner click needs a packaged build (see 6).
5. Restore the clipboard by M1; G-style log grep for markers (expect 0, control ≥ 3).

## 3. Defect 137 — one provider reading (approval: a logcat read while the Files pane lists DCIM)

`logcat -c` is not needed. Note the time, open **DCIM** once in the Mac's Files pane, then read logcat since
that time for tags `ExternalStorage`, `FileSystemProvider`, `DocumentsProvider`, `FuseDaemon`, `MediaProvider`,
with the app's own `fs.list` line as the control. Look for *"No permission to access parentDocumentId"* or a
FUSE `readdir` denial. **No re-grant, no picker, no fallback.** Tonight's code reading found no Sidekick-side
defect: the provider's own cursor reports 0 rows (2026-09-23 probe).

## 4. Connection and pairing (approval per step)

C step 3 — phone Wi-Fi off, then on, once (expect reconnect with no pairing request). H4b — start a pairing and
cancel it once (expect nothing stored on either side).

## 5. Stage E, then F (as written in the verification plan)

E: drop `~/.s7-run/drop-me.txt` → sheet names it → Return cancels → drop again → Send → phone digest OK.
F: one synthetic push and one pull from `Download/ConnectSuite`; **new tonight:** read the Mac log's
`quarantine present/absent` line for the pulled file (`absent` is expected on the dev build) and the Photos
save line's *checksum matched / not checksummed* sentence; mirror 30 s with `Encoded +N frames` ticking.

## 6. Packaged Sidekick, once (approval: launch a packaged build; best on a fresh macOS user)

Launch `artifacts-bf096e1/…/Sidekick.app` (not the dev build) — it mints its own identity and needs its own
pairing, so on the owner's account it would compete with the dev profile; a fresh macOS user avoids that.
Read: it starts; `--remote-debugging-port` exits 78; one synthetic pull gets `quarantine present`; a clipboard
offer banner appears and its click opens the pane.

## Approvals this plan needs, in order

1. Install the `bf096e1` APK on user 0, and replace + relaunch the Mac `dist` (1).
2. Owner hands for D steps 6–8, the banner step, and a private `screencap` of the toolbar (2).
3. One logcat read during one DCIM listing (3).
4. Wi-Fi off/on once; one pairing cancellation (4).
5. Stages E and F (5).
6. A packaged-build launch, preferably on a fresh macOS user (6).
7. Separately, not for the morning: Apple Developer Program, release keystore, ML Kit decision, dependency
   audit tool, notices screen, publisher details (`docs/privacy-and-distribution-2026-10-07.md` §8).
