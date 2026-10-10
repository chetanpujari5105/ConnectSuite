# Beta hardware plan — 2026-10-09 (prepared; each step runs only on the owner's word)

> **Status, 2026-10-10** (evidence: `docs/testing.md` → *hardware run* and the sections after it):
> **Done on hardware:** A1–A6, B1 (first scan), B2, B4, B5 (Return cancels; Escape does nothing — accepted), B6,
> B7 (both ends), and B8, B9, B10 after one fix each (`9ccb1b4`, `27a6f0d`, `177aab6`). B3 stands from the isolated
> run. Defect 205 **accepted by the owner — lock kept, cost stated**. The phone runs the debug build from `c66ef7f`.
> Synthetic test files deleted on both devices (owner's list).
> **Left:** B1's second scan of a fresh code (needs a Forget and re-pair; optional) · B11, B12 (a consenting caller /
> number) · §C screen readers (ask before taking over speech) · §D fresh user (a new macOS account; a second phone
> or approval to uninstall here; the **signed** APK) · `9ccb1b4` not yet seen on hardware on either end (no
> stream has stopped since the phone install; the Mac's running `dist` predates it — rebuild and relaunch).
>
> ### What the owner still has to do, in plain words
>
> 1. **Sign the Android app** with your release key. Nothing can be installed by a tester until you do.
> 2. **Fill in the privacy policy's blanks** (`docs/privacy-policy-draft-2026-10-09.md`): your legal name, postal
>    address, support email, the date it takes effect, where it will be hosted, and how changes are announced.
> 3. **Make two small decisions** in that same file: may the phone's diagnostic logs move when someone copies their
>    phone to a new one, and should old Mac Activity history that may hold link hosts be rewritten.
> 4. **Create a new macOS user account** for the first-time-user test, and tell me when it exists.
> 5. **Decide how to test a fresh phone install:** lend a second Android phone, or allow uninstalling the test build
>    here (that removes every permission and both settings switches, which are then granted again by hand).
> 6. **Remove the old test folder's access on the phone:** Sidekick → Sync → Folders → *Documents › Sidekick137* →
>    Remove. The folder itself is already deleted.
> 7. **Name a number and a caller who agree to be used** — one number for the new-conversation SMS test (defect 30)
>    and one caller for the camera and call-banner tests — or tell me to leave those out of the beta.
> 8. **Say when I may run the screen-reader checks** — VoiceOver on the Mac and TalkBack on the phone speak aloud and
>    take over the screen for a few minutes each.
> 9. **Decide about the licence list:** a licence-report plugin or one online fetch would confirm the licence of every
>    Android library (today 152 of 153 are by publisher, not read from the files). Both need your yes.
> 10. **Optional tidy-up:** older test files are still on the Mac — eight `sidekick-pass-stop-200mb` copies in
>     `~/Downloads/Sidekick` (1.6 GB), two `sidekick-s5-*.txt`, and `~/.s7-run`. They were not on your list, so they
>     stay until you say.
>
> Apple notarization, Developer ID and any Play listing are not needed for a named-tester beta and remain your call.

Builds under test: **phone** — a debug APK from `34362e1` or later (same signer as the installed one, so no
uninstall and no grant loss); **Mac** — the development `dist` built from the same commit, relaunched from the
repo (never the packaged app on this account — defect 207). Every write to the phone goes through
`scripts/adb-pinned.sh samsung …`.

**Two things change on the first relaunch of the development Mac app, and both are this batch's fixes:**
1. **Profile move (207 b).** The development build now uses `~/Library/Application Support/sidekick-desktop-dev`,
   seeded once by **copying** `sidekick-desktop` (the original is not touched). Expected log line:
   `Profile …/sidekick-desktop-dev (development; seed: copied; single-instance lock held)`. The pairing,
   settings and Activity come across in the copy, so **no re-pair is expected**. If the copied key cannot be
   opened, the new prompt appears instead of an overwrite — choose **Quit** and tell me.
2. **The ZXing scanner** is in the debug APK; the old ML Kit pieces leave the phone with the update.

## A. Deploy checks (before and after each install)

| Step | Command / action | Pass |
|---|---|---|
| A1 pin | `scripts/target-device.sh samsung` | `OK target … SM-S938B` |
| A2 snapshot before | `scripts/adb-pinned.sh samsung shell dumpsys package com.chetan.connectsuite.debug` → grants (`granted=true` count), `lastUpdateTime`; `settings get secure enabled_notification_listeners` / `enabled_accessibility_services`; signer via `pm path` + `apksigner verify --print-certs` | recorded |
| A3 install | `scripts/adb-pinned.sh samsung install -r <debug apk>` | `Success` |
| A4 snapshot after | A2 again | grants equal, both bindings intact, signer equal |
| A5 link | `am start -n …/MainActivity`, then `scripts/link-up.sh` | 3/3 OK |
| A6 Mac | rebuild `dist`, relaunch with both flags; read the `Profile …` and `identity` lines | `seed: copied`, `Stored identity … loaded`, `Connected … pairing: v2` |

## B. Checks owed by this batch

| # | Check | Needs | Pass criterion |
|---|---|---|---|
| B1 | **Real QR scan with ZXing** | the owner points the phone at the Mac's code; one re-pair (approved for this batch) | phone `Code scanned. Verifying your Mac…` then `Paired`; Mac `pairing v2, both sides proved the code`; a second scan of a rotated code also reads (control: the decoder ran, not a cached result) |
| B2 | **207 (d) on hardware** | B1's re-pair path: before forgetting on the Mac, open the pairing screen | card reads *This Mac still remembers a phone* with **Forget <phone>**; no code drawn; pressing it draws a code |
| B3 | **207 (a, c) with a second copy** — isolated temp profile only | nothing from the owner | repeat `iso207.mjs` against the relaunched build: files byte-identical, second instance refused (done once in scratch, `docs/evidence/release-candidate-2026-10-09/tests/207-isolated.json`) |
| B4 | **Item 3 on hardware** | phone on USB | `am start -f 0x10000000 -n …/.SendSelectionActivity --es android.intent.extra.PROCESS_TEXT <marker>` from the shell: `dumpsys activity` shows it in **its own task**, `MainActivity` not resumed, **no** `focus sync` line. Control: the same launch against the pre-fix build reproduced the sync on 2026-10-08 (stage 6) |
| B5 | **Drop sheet Return / Escape** on a real sheet | owner's decision on the Escape trade-off; a window arrangement where the sheet is visible | Return → *not confirmed — nothing granted*; Escape → per the decision; Send by title → exactly one dispatch |
| B6 | **Share collision** — share the same synthetic file twice | owner's tap ×2 | second lands as `name (2).ext`; both SHA-256 equal to the source |
| B7 | **Gallery multi-select share** | owner selects 2–3 synthetic images | one offer per file, Accept/Decline each |
| B8 | **Mid-transfer share Cancel** | a bounded synthetic file under the phone's staging quota (measure the quota first) | Cancel → transfer stops, no partial published, both sides say *cancelled* |
| B9 | **208 on hardware** | switch root while a listing loads (Received files ↔ DCIM) | phone logs `0 refused` in normal use and **no** `enforceTree` exception in logcat; Mac grid shows only the selected root's files |
| B10 | **Expected stop at I** | a block pull Paused from the Mac | phone line `block pull stopped: the Mac closed the stream …` at **I**, tally `… / 1 stopped / …` |
| B11 | Camera steps 6, 8, 9 and the call banner | **a consenting caller the owner names** | `docs/camera-v1.md` plan — not run without the name |
| B12 | Defect 30 (new SMS conversation) | **a consenting number the owner names** | §C of defect 30's row — not run without the number |

## C. Screen-reader passes (ask before taking over the screen or speech)

**VoiceOver (Mac)** — per screen, with VO on: the sidebar reads each pane's name once; the pairing card reads
its title, then the code's *state* line, then **Forget …** or **Show a fresh code**; Files: root rail items say
name and *read only/read and write*, rows say name, size and date, Pause/Cancel are reachable by VO-arrow;
Clipboard: each history row says source and kind (never a displaced entry's text); the drop sheet's buttons read
*Cancel* (default) and *Send*; the identity prompt and the second-instance prompt read their message and every
button.

**TalkBack (phone)** — Link your Mac: title, the three trust columns, **Scan**; the scan screen announces the
camera and the back control; Paired Macs: each Mac's name and *Forget*; Folders: each grant and *Remove*; the
share sheets: file name, size, Send/Cancel; Send to Mac: the toast is announced.

## D. Fresh-user test (item 9) — bounded plan; Mac half waits for the owner to create the account

**Mac, on a new macOS user (owner creates it; I never use the owner's account for a packaged launch):**
1. Copy `Sidekick-2.0.0-arm64.dmg` into the new user's Downloads with quarantine (download it through Safari, or
   `cp` then note that `cp` does **not** add quarantine — the Safari route is the realistic one).
2. Follow `docs/beta-tester-guide.md` word for word; time each step; record every dialog's exact text.
3. Pair with the phone (this re-pairs the phone to a different Mac identity — needs the owner's approval, or a
   second phone).
4. Send one file each way; Disconnect; Connect; quit and reopen (no prompt expected).
5. Uninstall per the guide; then list what is left: `~/Library/Application Support/sidekick-desktop*`,
   `~/Library/Caches/com.chetan.sidekick.desktop*`, `~/Library/Preferences/com.chetan.sidekick.desktop.plist`,
   `~/Library/Saved Application State/com.chetan.sidekick.desktop.savedState`, `~/Library/Logs/Sidekick*`, the
   Keychain item, `~/Downloads/Sidekick`. Every leftover goes into the guide's *Removing it* section.

**Android, a fresh install:** needs either a second phone or the owner's approval to uninstall the debug build
on the SM-S938B (which drops every grant and both secure-settings bindings). Then: install the **signed**
release APK (after the owner signs it), onboarding, every permission prompt's text, pair, a file each way,
disconnect/reconnect, uninstall, and `Download/ConnectSuite` (left by design).

**Bounds stated:** one Mac model, one phone, one macOS version, one network; synthetic files only.

## E. Defects that stay open with a reason

- **30** — blocked until the owner names a consenting number.
- **137** — not reproduced on hardware (2026-10-08, old and fresh grants listed). **Would reopen it:** any
  granted tree listing 0 entries while `ExternalStorageProvider`'s own `query` (logcat) shows rows, or a listing
  that differs between Sidekick and the system picker for the same tree. The probe stays.
- **205** — decision owed (below). Not changed in code.
