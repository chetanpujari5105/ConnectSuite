# File sharing overnight — 2026-09-29 (01:41–02:45 IST, unattended, owner-authorised)

> Evidence for this night's work, kept out of `docs/testing.md` only because that file holds the owner's
> uncommitted Run A block (42 lines, SHA-256 `64533824…` at the start and untouched since). Fold it in when
> that block is committed. Every number here comes from the instrument named beside it.

## 0 · Conditions

- **SM-S938B `RZCY12330DT`, pinned** (`scripts/target-device.sh samsung`). It was **locked with a secure
  keyguard all night** (`isKeyguardShowing=true`, `deviceLocked=1`, dozing). No Gallery, My Files, share
  sheet, Sidekick screen or phone screenshot was possible, and none was attempted.
- The phone **dropped off USB for about 20 minutes** (≈ 01:55–02:15). `adb devices` was empty and macOS
  listed no Samsung USB device. The Wi-Fi link to the Mac stayed up throughout. With nothing on the bus
  the pin refused, as designed, and only Mac-side readings were taken in that window.
- **Network:** the Mac on the phone's own hotspot (default gateway `10.36.14.60` = the phone), RTT
  4.1–14.2 ms (avg 6.5).
- **Session:** the Mac app ran with **no** debug switches throughout, at `share.file 2` + `share.ask 1`.
  **No version-3 session was opened**; nothing was armed; no component was switched.

## 1 · Baseline (read-only, before any write)

- HEAD `3240b15`. Uncommitted, untouched all night: `PRODUCT.md` (`bba7aac0…`), `skills-lock.json`
  (`b181c91a…`), `docs/testing.md` (`64533824…`).
- Phone: `versionName 2.0.0`, `lastUpdateTime 2026-09-28 11:34:59`, certificate `d3a505d2…7d26`.
  - 28 runtime grants; listener and accessibility bindings present.
  - One trust row for `Chetans-MacBook-Pro`, read from the database with its WAL.
  - `cache/share-staging` empty. Free space **10,916,848 KiB**.
  - Synthetic sources hashed: `SidekickShareTest/sidekick-share-test-001.png` `d5cfb8a3…`,
    `…-image.png` `1afc71b6…`, `Documents/SidekickShareTest/sidekick-share-test-file.bin` `b5f989fe…`.
- Mac: the app was stopped; `desktop/dist` digest `cb74d20d6de3172e` (= the runbook's). Free space
  20,014,932 KiB. `~/Downloads/Sidekick`: every file hashed; `share-temporary-files.json` `[]`.

## 2 · Option B, development only (`b641aca`)

`ShareAdmission.PROVISIONAL_DEV_CANDIDATE` now has floor = **fixed 1 GiB**; it was `⌈3%·T⌉ + 1 GiB`.
Unchanged:

- the ½ quota share;
- the 256 MiB margin;
- 5 s reading freshness;
- the during-copy and final re-checks;
- deletion of the partial on a stop;
- refusal on any missing, stale or future reading.

It is reachable only through the debuggable build's version-3 arm, and is **not** a release policy.

- `ShareDevReserveTest`: 8 tests, 7 red against the 3% floor. The eighth, which pins the unchanged
  refusals, is green both ways.
- Mutation `floorExtraBytes = 0` → 7 red; source restored by checksum.
- Two `ShareAdmissionBudgetTest` boundaries were recomputed for the new floor.
- **Installed on the phone** (see §6). **Not exercised on hardware**: the two concurrent share copies it
  admits need the share sheet, and the phone was locked.

## 3 · Several files in one Android share (`352f1b3`) — development only, not verified on hardware

The review screen already existed, debug-only and disabled. It shows the count, each file's name and size,
**Send N files**, and one row per file with its own offer and state, saying *Saved* only on that file's
acknowledged, Mac-verified verdict.

**Tonight's change:** proposal §7 and §13.1 already said *Withdraw stays per file, on its own row*, but the
screen had no per-row control. Now each offered row has its own **Cancel**:

- It sends `share.cancel{user}` for the offer the queue recorded for that file index, never looked up by name.
- It appears exactly while the single-file sheet's `canWithdraw` would allow it.
- Its accessible name names the file.

Test and mutation: `ShareManyCopyTest`, one table test over every offer state and prep, red then green.
The mutation "any unsaved row is cancellable" is red.

**Not drawn anywhere yet.** Making the flow real for users needs decisions that are not in the approved
contract (§8 below).

## 4 · Measured, Mac → phone (the Files pane's Send, timed to the phone's verified verdict)

Instrument: `scripts/transfer-speed-probe.mjs` (committed). It drives the pane's own `offer()` and Send (by
id), and a MutationObserver timestamps each file's phase. **`arrived` is drawn only on the phone's
`fs.transfer.done ok`**, so every rate below is receiver-verified. Every file reported *checksum matched*;
files over 64 MiB were not used (above that no digest is agreed).

| Run | Build | Files | Click → last verified verdict |
|---|---|---|---|
| a | original (`cb74d20d`) | 64 MiB | 3,671 ms (18.3 MB/s) — **first transfer after launch; not quoted as a baseline** |
| c1, c3 | original | 32 MiB | 856 / 857 ms (39.2 MB/s) |
| c2, c4 | `4ba09ed` (backpressure) | 32 MiB | 798 / 814 ms (42.1 / 41.2 MB/s) |
| a, f1, f3 | original | 8 × 1 MiB | 1,571 / 1,429 / 1,348 ms |
| e1, e3 | `4ba09ed` (verdicts held a slot) | 8 × 1 MiB | 1,486 / 1,543 ms — no gain |
| e2, e4, f2, f4 | `aff63a9` (writes hold a slot) | 8 × 1 MiB | 1,047 / 1,314 / 986 / 1,000 ms |
| i, j1, j2 | `aff63a9` + phone `f8dca91` | 8 × 1 MiB | **706 / 714 / 782 ms** |

Old and new builds were **interleaved on the same link** (the old one rebuilt from `git archive HEAD`, digest
reproduced exactly). The first before/after pair (18.3 → 44.6 MB/s at 64 MiB) was **confounded**: it
compared a cold first transfer with a warm one. The interleaved pairs show the true large-file gain from
backpressure is ≈ 6%.

**Where the per-file cost was** — the phone's own log, instrumented in `f8dca91`:

- ≈ 30 ms from agreement to authorising the bulk socket; the phone's TLS handshake is not the cost.
- ≈ 50 ms of bytes for 1 MiB.
- Then **131–328 ms in `PendingItem.commit()`**, split as:
  - delete-by-name 93–202 ms, **removing 0 rows every time**;
  - `IS_PENDING = 0` 6–105 ms;
  - `statById` 49–56 ms, which listed the whole folder to find one row.
- After `f8dca91`: stat 1–3 ms; name check 44–97 ms; publish 54–122 ms.

## 5 · Measured, phone → Mac

| Path | Result |
|---|---|
| Files pull (the pane's selection pull, verified against the phone's pre-agreed digest), 64 MiB | wire 1,624 ms (330.6 Mbit/s); click → settled 2,169 ms, then 1,358 ms on a later run (incl. the 250 ms selection delay) |
| Files pull, 1 MiB | click → settled 413–516 ms; wire 68–87 ms |
| **Share path (offer → Accept → pull → publish)** | **not measured on hardware** — see below |
| Share receiver, **harness only** (loopback TCP, no TLS, no Wi-Fi, `pullShareWith` + ledger + exclusive publish) | 64 MiB 160–163 ms (≈ 410 MB/s); 1 MiB 12.6 ms |

Every pulled file was hashed and equals its source. That includes a Mac → phone → Mac round trip of four
files and the renamed `(2)` file.

**Why the share path is unmeasured.** A synthetic offer made from adb through the production offer path
(`ShareOfferProbeActivity`, 1 MiB, seed 101, SHA-256 `50b50dfd…`) reached the receive window. The new gated
instrument `scripts/share-accept-probe.mjs` read the card as:

- file `sidekick-offer-probe-1048576.bin`, size `1,048,576 bytes`;
- Accept's accessible name *"… from Samsung SM-S938B and save it to ~/Downloads/Sidekick"*;
- no pull claimed; nothing in the folder.

Its first press was refused **by the probe itself**, because the card writes the folder as `~/…` and the
probe expected the absolute path. After that fix, **every press was refused by the product** with *"not
accepted: the window is not in front"*. `acceptAllowed` requires the OS window to be focused.

- CDP `Page.bringToFront` made `document.hasFocus()` read **true** in the page while the main process still
  refused: two readings of one fact, and the product's is the true one.
- System Events lists no windows for the app.
- The main window's Show matched no single card.

**The gate was not worked around.** The offer expired untouched at 02:40:42: the Mac logged *expired, not
declined*, the phone logged *staged copy deleted, 2 file(s)*, staging was 0 and the ledger `[]`.

## 6 · Device changes

**Phone — three `adb install -r` of the debug APK** (same package, certificate `d3a505d2…7d26` on both
APKs). The last is `f8dca91`'s build `d1a1b2b0…`, `lastUpdateTime 2026-09-29 02:26:42`.

For each install, before and after, these were **identical**:

- the 28 grants;
- both bindings;
- the trust row (read with its WAL);
- the MD5 of every `shared_prefs` file and the settings DataStore.

`LinkService` came back by itself within 1 s each time (logged `Foreground claimed as PACKAGE_REPLACED`),
`link-up.sh` read 3/3, and the Mac reconnected at `share.file 2`.

**Phone files written:**

- 150 synthetic `sidekick-speed-*` files (≈ 437 MiB) in `Download/ConnectSuite`.
- The staging copy of the synthetic offer, deleted by the product on expiry.

Nothing else was created, and nothing was deleted by me. Free space: 10,916,848 → 10,435,636 KiB.

**Mac:**

- `desktop/dist` rebuilt from the working tree at `aff63a9`: digest `ffe2fceae4a128ae`, was
  `cb74d20d6de3172e`. The dev app runs it, **no switches**, connected.
- `~/Downloads/Sidekick`: nothing changed or removed; added the pulled
  `sidekick-speed-a-{64m,8m,1m-1,1m-2}.bin`, `sidekick-speed-b-64m.bin`, `sidekick-speed-i-1m-2.bin`,
  `sidekick-speed-i-1m-1 (2).bin`.
- Free space 20,014,932 → 17,209,320 KiB. Scratch builds and test files are in the session scratchpad.

Screenshot: `docs/evidence/transfer-speed-2026-09-29/mac-files-send-4-arrived.png`. It shows the send card
*"4 files arrived on Samsung SM-S938B"*, each *checksum matched*, and the unaccepted synthetic offer's tray
card beside it.

## 7 · Findings

1. **Push had no backpressure** (fixed in `4ba09ed`). A 64 MiB file was entirely queued 78 ms after the
   socket opened. The log called that *"pushed … in 78ms (6883.0 Mbit/s)"*, and a push the phone hung up
   on could resolve ok.
2. **Same-name files in one batch could share one partial on the phone** (Mac-side mitigation in
   `4ba09ed`). `DownloadsStore.openPartial` reuses any pending item with that display name, and the old
   loop started file 2 as soon as file 1 was merely queued. The phone-side guard (refuse a second push onto
   a name with a live incoming transfer) is **not built**: it needs a decision, and a phone still accepts
   such a push from any client that does not serialise.
3. **Received files' publish did a folder-wide listing and an unconditional delete per file** (fixed in
   `f8dca91`).
4. **`document.hasFocus()` from CDP is a lookalike of window focus.** The product's Accept gate reads the
   real one.
5. **No defect numbers were assigned.** `docs/defects.md` and `docs/testing.md` must change together, and
   `testing.md` holds the owner's uncommitted block.

## 8 · What (c) several-files needs that tonight could not do

Each of these needs the owner:

1. The phone unlocked, for the §11 grant readings and Run B.
2. A production path to `share.file 3` on both sides, which is not in the approved contract.
3. The §20 decisions: the notification, Stop preparing, lifecycle option A, production values, and
   `MAX_FILES`.

`docs/feature-a-v3-production-enablement.md` lists all of it; none of it changed tonight.

## 9 · (d) Large files

Not ready, and not claimed:

- **Mac → phone above 64 MiB agrees no digest**, so the phone reports `verified=false`. Tonight's change
  only bounds memory and makes the sent count honest. Hashing larger files first, or a trailing digest, is a
  protocol or policy decision.
- **Phone → Mac share stages a private copy of the whole file** in the phone's cache, so a file larger than
  the phone's free space cannot be shared. Path L (`docs/feature-a-large-file-proposal.md`) is a proposal,
  not built.
- Nothing above 64 MiB was transferred tonight.
