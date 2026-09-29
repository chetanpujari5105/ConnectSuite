# Ship / no-ship — 2026-09-29

> For the owner's decision. **I do not approve a release; this says what the evidence supports.**
> Status marks and evidence per row are in `docs/release-inventory.md`; the day's runs in
> `docs/complete-app-pass-2026-09-29.md`. Nothing here was pushed, signed, packaged for distribution,
> or switched on for release.

## Verdict

**NO-SHIP as a distributable release**, for reasons that are not code defects and that only the owner can
clear:

1. **Neither app can be installed by anyone else.** The `.dmg` is ad-hoc signed (Gatekeeper returns an
   error, not a verdict — Phase 9 D12) and the release APK is unsigned (refused with
   `INSTALL_PARSE_FAILED_NO_CERTIFICATES` — D13). Both need the owner's Developer ID and keystore.
2. **Three release policies are the owner's and are off:** several files per share
   (`MULTI_FILE_RELEASE` / `SHARE_V3_RELEASE`), 30-minute waits (`WAIT_RELEASE` / `SHARE_WAIT_RELEASE`),
   and the values under them (`MAX_FILES = 10`, the per-copy budget, the 60-minute accepted queue).
   With all three off, a release build is the single-file product that passed on 2026-09-25.

**As a personal release candidate on the owner's own two devices** (debug phone build + unpackaged Mac),
the file-sharing core is **ready for the owner's acceptance walkthrough below**.

## The matrix

| Area | Feature | Decision | Why |
|---|---|---|---|
| Files | Mac → phone, several files, every size checksummed | **SHIP-candidate** | RDV today: 96 MiB *checksum matched* on the phone's own digest; resume, collision `(2)`, stop verified earlier |
| Files | Phone → Mac Files pull | **SHIP-candidate ≤ 64 MiB**; **NO-SHIP claim above** | verified only ≤ 64 MiB; above, honestly *not verified* (large-file L1 owed) |
| Files | Pull publication exclusive, partial owned, name sanitised (150, 151, traversal) | **SHIP-candidate** | tests + mutations; live pull saved as `(2)` with original untouched |
| Security | Transfers bound to their session, random ids, cancel scoped (148, 149) | **SHIP-candidate** | tests + source guards; live positive path; the refusal needs a second Mac (none exists) |
| Share | Android → Mac, one file (v2) | **SHIP-candidate** | RDV 2026-09-25 and again today |
| Share | Android → Mac, several files (Gallery, My Files, per-file Cancel) | **NEEDS OWNER: release policy** | RDV today (R1 accept/decline/accept; My Files four mixed with a cancel); debug builds only |
| Share | Text files (`.txt`, `.csv`) | **SHIP-candidate for mixed selections**; text-only selection **resolves by query only** | mixed passed live; a text-only share not yet run |
| Share | 30-minute waiting offers (`share.wait`) | **NEEDS OWNER: the contract change and release policy** | RDV: negotiated 30 live, older peer falls back to 10, card shows *until 15:41*; expiry at 30 min being observed |
| Share | Very large files (≥ tens of GB, 500 GB) | **NO-SHIP** | the share stages a whole private copy; Path L is a proposal; L3 (refuse when no room) built; L1/L2/L4/L5 not built |
| Photos | Browse, preview, save, drag; **checksummed** ≤ 64 MiB | **SHIP-candidate** | photo digest RDV today (`verified=true`); defect 89 (trash as album) and 136 (thumb size) open, cosmetic |
| Messages | SMS/MMS threads, send, new conversation | **SHIP-candidate with a known gap** | defect 30's no-thread half untested |
| Calls | events, dial, answer/reject, keypad | **SHIP-candidate** | call audio is a platform wall, stated in the UI |
| Notifications | mirror + reply | **SHIP-candidate** | Phase 4 |
| Notifications | macOS banners when the window is not in front | **NO-SHIP in the dev app** | macOS refuses them (`UNErrorDomain error 1`) — needs the signed, packaged app |
| Clipboard | both directions, history, Restore | **SHIP-candidate** | phone → Mac needs the app in front (wall) |
| Mirror | screen + input + floating window | **SHIP-candidate** | per-session consent and FLAG_SECURE are walls |
| Media | remote / Now Playing | **SHIP-candidate with a known gap** | defect 38 deferred |
| Apps | list + open-on-phone (ask-and-tap) | **SHIP-candidate** | `apps.launch` deliberately absent |
| Pairing | QR once, pinning, reconnect | **SHIP-candidate** | *Rejected* never produced by a real phone; defect 17 deferred |
| Appearance | light theme | **SHIP-candidate** | rendered sweep today: 2,880 text elements, 0 below AA, both themes; accent marks fixed |
| Accessibility | Mac focus, labels, reduced motion | **SHIP-candidate, standard undecided** | 816/816 focus rings (09-20); no VoiceOver walk recorded; `PRODUCT.md` has no chosen standard |
| Accessibility | phone TalkBack | **NO-SHIP claim** | never run on hardware |
| Camera | virtual webcam | **not in scope** | parked by record; drawn honestly as unbuilt |
| Packaging | `.dmg`, release APK | **NO-SHIP** | unsigned (above) |

## Acceptance walkthrough for the owner (≈ 15 minutes, synthetic files only)

Do these on your own devices, with the debug phone build and the Mac dev app as they are now.

1. **Several files from Gallery.** Gallery → *SidekickShareTest* → select `002.jpg`, `003.png`,
   `clip.mp4` → Share → **Send to Mac** → the review shows exactly three, one consent sentence →
   **Send 3 files**. On the Mac the window appears without taking focus and each card says *"Waits for
   your answer until HH:MM"* (≈ 30 minutes ahead). Accept one, Decline one, leave one.
   *Expect:* the accepted file saved (a `(2)` name if it already exists — nothing replaced); the declined
   one gone from the phone; the untouched one still waiting after 10 minutes.
2. **Per-file Cancel.** My Files → *Documents/SidekickShareTest* → select all four → Send → tap
   **Cancel** on one row on the phone. *Expect:* that card ends on the Mac within seconds; the others
   still wait.
3. **Text files only.** My Files → select only `notes.txt` and `table.csv` → Share. *Expect:* **Send to
   Mac** is listed (it was not before today); both arrive; the Mac card reads *CSV spreadsheet*.
4. **Mac → phone, large.** Make a synthetic file: `head -c 314572800 /dev/urandom >
   ~/Desktop/sidekick-300m.bin` (300 MiB). Files pane → Received files → **Send to phone…** → that file. *Expect:* a *Checking … before sending* line on a large file, then *Arrived ·
   checksum matched*.
5. **Photo save.** Photos → *SidekickShareTest* → save `003.png`. *Expect:* it lands in
   `~/Downloads/Sidekick`, and the Mac log shows `verified=true`.
6. **Light theme.** Settings → Appearance → Light, walk every pane. *Expect:* nothing unreadable; the
   green status marks are olive, not lime.

If any step does not behave as written, that is a finding — say what you saw, and I will fix it before
anything moves toward a release.
