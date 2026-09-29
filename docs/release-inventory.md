# Sidekick — release inventory (the source of truth for "is it finished?")

> Opened 2026-09-29 (10:55 IST) at the start of the complete-app pass, and **updated as each item
> moves**. Read from code and the evidence records, not from plans or headings. Where a status
> rests on hardware evidence from an earlier date that was **not re-run this sitting**, the row says
> so — an old pass is evidence about an old build.
>
> Sources read to build it: `docs/RESUME.md`, the last four commits, `PRODUCT.md`,
> `desktop/src/renderer/navModel.ts` (`SCREENS`), `app/src/main/AndroidManifest.xml`, the phone's
> share resolution (queried live, below), `docs/defects.md` (every row not closed), `docs/testing.md`
> section headings plus the sections cited, `docs/transfer-overnight-2026-09-29.md`,
> `docs/sidekick-full-app-inventory.md` (2026-09-20), `docs/remaining.md` (2026-09-05).

## Status marks

| Mark | Meaning |
|---|---|
| **NB** | not built |
| **UR** | built but unreachable by a user |
| **DBG** | debug-build only (a release build does not have it) |
| **UT** | user-facing but untested on a real device (or tested only by harness / unit test) |
| **RDV** | real-device verified — the dated evidence is cited |
| **RR** | release-ready: RDV **and** nothing open against it **and** shippable in a signed build |

**Nothing in this table is RR today**, for one reason that applies to every row: there is no signed
build of either app (`docs/phase-9-distribution-audit.md` D12/D13/D14/D15 — the Developer ID and the
release keystore are the owner's). RR is therefore written as *RR-candidate*: RDV with nothing open.

## Live state read at 10:55 (read-only)

- Phone SM-S938B (`RZCY12330DT`, sdk 36), debug build installed 2026-09-29 10:35:48 (HEAD `3af33a2`
  era). Mac dev app pid 85347, `dist` built 10:28:19, launched 10:39:52 with both flags.
- Negotiated on the live session: `share.file 3` + `share.ask 1`, both sides (Mac log 10:39:53,
  phone `link.log` 10:39:53). Release policy on both sides: **off** (`MULTI_FILE_RELEASE`,
  `SHARE_V3_RELEASE` false). Several-files is therefore a **debug-build** feature today.
- Mac free space: 15 GB (97% used). Every generated test file is bounded accordingly.

### Share resolution on the phone (live, `cmd package query-activities`, 2026-09-29 11:0x)

| Intent | MIME | Resolves to Sidekick? |
|---|---|---|
| `SEND` | `image/jpeg`, `video/*`, `application/pdf`, `application/octet-stream`, `*/*`, docx | yes — `ShareToMacActivity` |
| `SEND_MULTIPLE` | `image/jpeg`, `image/*`, `video/*`, `*/*`, pdf, docx, octet-stream | yes — `ShareManyToMacActivity` |
| `SEND` | `text/plain` (a `.txt` **file** from My Files) | **no file sheet** — goes to `SendSelectionActivity` (clipboard text send) |
| `SEND` | `text/csv` | **nothing of ours** |
| `SEND_MULTIPLE` | `text/plain`, `text/*` | **nothing of ours** |

The last three rows are a real gap in "My Files multi-select": any selection of text files (`.txt`,
`.csv`, `.json`, `.md`, `.html`, `.ics`, `.vcf` — all `text/*`) does not list Sidekick at all. Row
**F-9** below.

## 1 · File sharing (priority)

| # | Feature | Status | Code entry point | Evidence | Remaining acceptance test |
|---|---|---|---|---|---|
| F-1 | **Mac → phone, several files** (Files pane Send) | **RDV ≤ 64 MiB** | `renderer/files.ts` `confirmSend`/`pumpSend`; `main.ts` `fs-send`; `main/files.ts` `push`; phone `BulkTransfers.receiveFrom` | 2026-09-29 overnight: 8×1 MiB 706–782 ms, 32/64 MiB, every file *checksum matched* on the phone's own digest (`docs/transfer-overnight-2026-09-29.md` §4) | ≥ 3 files incl. one > 64 MiB, each *checksum matched* |
| F-2 | Mac → phone **above 64 MiB** | **RDV** (2026-09-29) | `main/files.ts` `push`, `digestOf`; `main.ts` `fs-send` | `ec71870`. 96 MiB random file 11:19: Mac hashed it in 78 ms; phone `verified=true`, sha `567befd2c824…` = source; card *Arrived · checksum matched*; 39.77 MB/s receiver-verified | a multi-GB file with the *Checking* row visible, and Stop during the hash |
| F-3 | Mac → phone stop / resume / disconnect recovery | **RDV** | `FsPartials.resumeFrom`; `sendBatchStop` | Phase 5 slice 8; resumed push `sidekick-rc-quit-64m.bin` from 52,953,088 B in the Mac log today 10:40:05 | re-run after this pass's changes |
| F-4 | Mac → phone same-name safety | **RDV** | `sendBatch.suffixedName`; `sendBatchNext` name rule | overnight §7.2: different file under an existing name arrived as `(2)`, original hash unchanged | — |
| F-5 | Phone → Mac **Files pull** | **RDV ≤ 64 MiB** | `main/files.ts` `pull`; `bulk.pull`; phone `BulkTransfers.streamTo` | 64 MiB 330.6 Mbit/s, hash equal to source (overnight §5) | above 64 MiB the phone pre-hashes nothing → unverified (F-6) |
| F-6 | Phone → Mac pull **above 64 MiB** | **UT — sent unverified** | phone `BulkTransfers.PREHASH_MAX_BYTES` | by design today; needs a digest that does not block the control channel | design + build (§3 below) |
| F-7 | Mac pulls publish **exclusively** / own their partials | **fixed, RDV normal path** (defects 150, 151; `ec71870`) | `main/bulk.ts` `pull` (`rename` over the final name; deletes an unrecorded `<name>.part`) | tests + mutations; live 11:20: a pull of a name already in the folder saved as `… (2).bin`, original untouched, no partial left, `verified=true` | the race itself is synthetic-only |
| F-8 | Bulk transfers **bound to their session**, unguessable ids | **fixed, RDV positive path** (defects 148, 149; `7e63b81`) | phone `BulkTransfers.serve`, `nextId`, `fs.transfer.cancel` | tests + mutations; live: push `tf-gDl8…` and pull `tf-vX0E…` claimed by their own session | a second session's claim is refused — needs a second Mac (none exists); tests only |
| F-9 | **Text files** in a share (`text/*` with a stream) | **UT — resolves on device** (`5aa1ce5`) | manifest filters; `ShareTextRoute` | after install 11:18: `SEND`/`SEND_MULTIPLE` of `text/plain`, `text/csv`, `text/*` resolve to the file paths | a `.txt` + `.csv` selection from My Files lists Sidekick and arrives |
| F-10 | Phone share → Mac, **one file** (v2) | **RDV** | `ShareToMacActivity` / `ShareToMacModel`; Mac `share.ts` `ShareReceiver`, `shareWindow.ts` | 2026-09-25 supervised live run: 100,718 B, SHA-256 equal, no focus steal, collision-safe (`testing.md` → *the supervised live run*); silent-Send fix live 13:36 | — (regression after this pass) |
| F-11 | Phone share → Mac, **several files, one Gallery share** (v3) | **DBG + UT** | `ShareManyToMacActivity`/`Model`, `ShareManyCopy`; Mac `ShareQueueView` | 2026-09-28 Run A: only **one** offer ever reached the Mac on v3; two-different-files-out-of-order (A1) **never run** | Gallery: 3 images selected → review screen exact → 3 cards → Accept 2 / Decline 1 out of order → 2 saved with SHA-256 equal, 1 declined, nothing moved before Accept |
| F-12 | Phone share → Mac, **several files, one My Files share** (mixed types) | **DBG + UT** | same | Run B P5 read the grant lifetime of two PDFs only (`testing.md` → Run B P5); no transfer | My Files: pdf + jpg + txt (after F-9) → same criteria |
| F-13 | Per-file **Cancel** on the phone's review screen | **DBG, never drawn on hardware** | `ShareManyCopy` per-row cancel (`352f1b3`) | unit test only | cancel one of three while offered; Mac card ends *withdrawn*, others unaffected |
| F-14 | Several-files **release** | **gated — owner's decision** | `Extensions.MULTI_FILE_RELEASE`, Mac `SHARE_V3_RELEASE` | — | not mine to flip |
| F-15 | **Very large file** share (phone → Mac beyond the phone's free space; up to 500 GB) | **NB** (Path L is a proposal) | the share stages a whole private copy (`ShareStaging`) | `docs/feature-a-large-file-proposal.md` | §3 below |
| F-16 | Destination-check probe cleanup by identity | **fixed, tests only** (defect 154) | Mac `shareDestination.ts` `checkDestination` | register row 154 | swap test |

## 2 · Everything else in scope

Evidence dates are the last hardware reading on record; **none was re-run on 2026-09-29 unless it
says so**.

| # | Feature (Mac pane / phone surface) | Status | Entry point | Last evidence | Open against it / remaining acceptance |
|---|---|---|---|---|---|
| P-1 | Pairing: QR once, TLS 1.3, pinning, auto-reconnect | **RDV** | `renderer/pairCard.ts`, `shared/pairSteps.ts`; phone `link/QrScanScreen.kt`, `ConnectMacScreen.kt` | Phase 1 2026-08-25; Batch 6a No network 2026-09-20 | *Rejected* state never produced by a real phone; defect 17 deferred (second phone refused, not evicted) |
| P-2 | Discovery order (last IP → gateway → mDNS → manual) | **RDV** | `main/discovery.ts` | Phase 1; step 71 hotspot | — |
| N-1 | Notifications mirror + reply | **RDV** | `renderer/notifications.ts`; phone listener | Phase 4 (2026-08-31); Batch 4c re-skin 09-20 | — |
| N-2 | **macOS system notifications** (banner when the window is not in front) | **UT — refused in the dev app** | `main/nativeNotifier.ts` | Mac log today: *"macOS refused a notification — UNErrorDomain error 1"* ×3 | needs a signed/packaged app with notification permission; `docs/phase-7-native-notifications.md` |
| M-1 | SMS/MMS threads, send, new conversation | **RDV** (defect 30's no-thread half untested) | `renderer/sms.ts`; phone `SmsStore` | step 71 2026-08-31; Batch 4a 09-19 | one send to a number with no thread |
| C-1 | Calls: events, dial, answer/reject, keypad | **RDV** | `renderer/calls.ts`; phone `CallWatcher` | step 70 2026-08-29; Batch 4b 09-19 | call **audio** is a wall (`CLAUDE.md` Platform walls) |
| R-1 | Media remote / Now Playing | **RDV** | `renderer/remote.ts`, `overview.ts` | Phase 4; Slices 56–61 | defect 38 deferred (phone volume change never reaches the Mac) |
| K-1 | Contacts | **RDV** | `main/contacts.ts`, `renderer/contacts.ts` | Phase 4; live today (`contacts.list` 10:39:53) | — |
| B-1 | Clipboard both directions + history + Restore | **RDV** | `main/clipboard.ts`, `clipboardWatcher.ts`, `renderer/clipboard.ts`; phone Clip | Slices 11–13 (09-01/02); live today (`clip.push` 10:54:23) | phone → Mac needs the app in front — a measured wall |
| V-1 | Screen mirroring (MediaProjection, H.264) + floating window | **RDV** | `renderer/mirror.ts`, `float.ts`; `mirror-module/v2` | Slices 43–53a (09-12 → 09-15) | consent tap every session (wall); FLAG_SECURE black (wall) |
| V-2 | Input on the mirror (tap, swipe, text, global actions) | **RDV** | `pointerGestures.ts`, `input-module` | Phase 3; Slice 50/53 | arbitrary keys impossible (wall) |
| H-1 | Photos browser, preview, video, drag to Finder | **RDV** | `renderer/photos.ts`, `main/photos.ts` | Phase 5; Feature C review 09-23 on the real library | defect 89 (trash shown as an album), 136 (`maxEdge` exceeded) open |
| H-2 | Files browser (SAF roots, grid, sort, filter) | **RDV** | `renderer/files.ts` | Feature D review 09-23 | — |
| A-1 | Apps list + open-on-phone (ask-and-tap) | **RDV** | `renderer/apps.ts`; phone `apps.*` | Slice 8 2026-09-03 (123/123) | `apps.launch` is refused by measurement, deliberately absent |
| O-1 | Overview (hero, media card, activity, metrics) | **RDV** (re-skin) | `renderer/overview.ts` | Slices 58–62; Batch 2 09-19 | — |
| Y-1 | Activity pane | built, **UT** as a whole | `renderer/activity.ts` | Batch 5b 09-20 (screenshot) | — |
| S-1 | Settings (7 panes) | built, partly **UT** | `renderer/settingsControls.ts` | Batch 3/5a | Advanced/About have no design frame |
| T-1 | **Light theme** | built, **partly checked** | `tokens.css`, `shared/appearance.ts` | Slice 55 (09-16): 58 token pairs/theme 0 failing; DOM sweep 3,302 elements | Files, Photos, Mirror, Overview, Notifications, receive window **owed** a light check (full-app inventory §2) |
| X-1 | Accessibility — Mac: focus rings, labels, reduced motion | **partly RDV** | `tokens.css` focus / motion blocks | Batch 6b: 816/816 focus rings; reduced motion measured 09-20 | **no accessibility standard chosen** (`PRODUCT.md`); VoiceOver walk never recorded |
| X-2 | Accessibility — phone: TalkBack | **UT** | Compose semantics | Android UI slice 4 names *"Stimulus: TalkBack on hardware"* — never run | a TalkBack pass over Connect a Mac, the share sheets, Transfers |
| D-1 | Android redesign (Sidekick tokens, one state vocabulary) | **RDV** slices 1–6 | `sync/ui/*`, `link/*`, `setup/*` | Android UI pass 2026-09-22 | open items carried per slice |
| E-1 | Set up Sidekick (phone onboarding) | **RDV** | `setup/SetupScreen.kt` | Feature E review 09-23 | — |
| G-1 | Camera (virtual webcam) | **NB — parked, by record** | `navModel.ts` `camera` `state: 'unbuilt'` | — | not in any phase; stays honest-unbuilt |
| Z-1 | Packaging: `.dmg` / release APK | **UT, not distributable** | `desktop/electron-builder.*`; Gradle release | Phase 9 audit: ad-hoc signature (D12), unsigned APK refused (D13) | Developer ID, notarisation, release keystore — owner-only |

## 3 · Large files (F-15, F-2, F-6) — the design this pass will build toward

Written in full in `docs/large-file-streaming.md` once researched; the headline constraints, read from
the code today:

- **Mac → phone** is already streaming: the phone writes into a `MediaStore` pending item and hashes as
  it writes; there is no second copy. Its limits are the phone's free space and (until this pass) the
  unverified digest above 64 MiB.
- **Phone → Mac Files pull** is already streaming from the SAF/MediaStore source; the phone only
  refuses to pre-hash above 64 MiB, because pre-hashing holds the `fs.transfer.begin` reply.
- **Phone → Mac share** is the one path that copies the whole file into the phone's private cache
  before offering it (`ShareStaging`) — that is what caps it at the phone's free space and makes a
  500 GB claim false today.

## 4 · Change log for this document

| When | What moved |
|---|---|
| 2026-09-29 11:10 | opened |
| 2026-09-29 11:25 | F-2 RDV; F-7, F-8 fixed and RDV on the normal path; F-9 resolves on device; F-16 fixed |
