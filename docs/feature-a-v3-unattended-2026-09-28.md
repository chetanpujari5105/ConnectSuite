# Feature A version 3 — unattended block, 2026-09-28 (12:50–15:10 IST)

> **Why this is its own file.** Its evidence belongs in `docs/testing.md`, but that file holds the owner's
> uncommitted 42-line Run A block, which this block was told not to stage or commit. Fold this file into
> `docs/testing.md` when that block is committed. **Nothing was installed, enabled, armed, sent, accepted,
> declined or deleted on the SM-S938B; the Mac dev app was not launched; `desktop/dist` was not built.**

## 0 · State at the start

- HEAD `c8df24b`. The phone Σ-release follow-up **exists and is that commit**: `ShareFeature.store`'s rule and
  `stagingContext`'s sum moved verbatim into `ShareOffer.storeLive` / `ShareOffer.heldBytes`;
  `ShareOfferHeldTest` (7) drives the real transitions with a second offer live. Read, not assumed:
  `git show c8df24b`, and the test re-run green in this block.
- Uncommitted and left alone throughout: `PRODUCT.md`, `docs/testing.md` (+42, the Run A M3 block),
  `skills-lock.json`. None was staged; `git status` after every commit shows the same three.
- Approval status carried unchanged: the §4 budget values (½, 3% + 1 GiB, 5 s), the 60-minute backstop, the
  stall clock's 10/60 minutes — **PROVISIONAL, development only** (owner, 2026-09-26/28);
  `MAX_LIVE_OFFERS_V3 = 10` and `ShareSelection.MAX_FILES = 10` — **proposed, not approved**; the 4 GiB figure —
  **not approved**, used nowhere. No value was changed.

## 1 · Phone: `Σ` and the disk agree — `1f86ab8`

`c8df24b` proved a copy leaves `Σ` on every end. What it restated was `DeleteStaged`'s **execution**. That
branch of `ShareFeature.apply` moved verbatim into `ShareStaging.discardStaged(cacheDir, offerId)`.

`ShareOfferDiskTest` (11) uses two **real** staged copies (`ShareStaging.copy`) for two live offers. It drives
A through the real transitions, stores each result through `storeLive`, and executes `DeleteStaged` through
`discardStaged`. After every step, A is in `Σ` exactly when its `.bin` is on disk at its length. B's copy
stays intact and byte-exact (`readBack` digest) throughout.

Ends covered: saved, declined, Mac cancel while queued at v3, Mac pull cancel, phone withdraw, TTL expiry, the
queue backstop, session ended, and staging-lost (only the marker is left to delete). A failed attempt keeps
its copy until the Retry window closes. A repeated end deletes nothing more. A null cache dir, or a symlinked
staging dir, deletes nothing.

**Red first:** five mutations, restored by checksum:

| Mutation | Red |
|---|---|
| The executor does nothing | 11 |
| `discard` wipes the whole directory | 11 |
| An end without `DeleteStaged` | 9 |
| `storeLive` keeps ended offers | 10 |
| The executor follows a symlink | 1 |

**Not reached, stated:** `ShareFeature`'s lookup-and-store glue and its lock. Between the map update and the
deletion, the copy sits in the budget's "other cache" `N` rather than in `Σ`. `Bq = ⌊Q·½⌋ − K` either way, so
nothing is counted twice.

## 2 · Mac: the receive window's re-presentation call site — `d407dd6`

`main.ts`'s two `onChange` loops moved verbatim into `ShareWindowPresenter.toPresent` (`shareWindowRules.ts`).
A real `ShareReceiver` at 3+3 is subscribed before the offers arrive, as `main` is:

- A, B and C each present once on arrival.
- B is accepted first and never queued; it stalls and fails with a Retry open, and presents nothing.
- A is queued, then saved, and presents nothing.
- C is queued, then fails its checksum with a Retry open, and presents **exactly once more**.

`shareDecision.test.ts` now also asserts that the handler presents exactly what `toPresent` returns.

**Red:** four mutations. Three turn the new test red:

- the queued-failure half removed;
- every failure presenting;
- attention not remembered.

The fourth, `main` presenting arrivals only, turns the source guard red.

## 3 · Mac: disconnect with waiting, queued and receiving together — `d721afd` (test only)

A is waiting, B is receiving (20,000 of 100,000 bytes, a real partial) and C is queued, and the session ends:

- All three read `ended`.
- A late Accept of A sends no `share.respond`.
- Only B was ever pulled; nothing is published and no verdict is sent.
- The ledger is `[]`.
- The next session's offer is checked with **0 reserved**.

**Red:** three mutations, each red on this test: the session end skips waiting offers; it does not abort the
pull; an ended offer keeps its reservation.

**Read against the wired code, no change needed:**
- **Reservations** derive from state (`reservationOf`). Every in-flight state reserves; `receiving` spans
  write, check and publish, and publication is an exclusive link in the same folder.
- **Accept order** and **one writer:** existing tests `v3 (3+3)…` and `two queued files start in the order
  they were accepted`.
- **Version 2 fallback:** `v3 gate off — negotiated 2`, and phone `ShareOfferQueueTest` `an older peer —
  version 2 — never queues`.
- **The phone's one pull per session:** `ShareOfferQueueTest`.

## 4 · The receive window, driven in an isolated harness — `4498d4b`

**Harness** (source in `docs/evidence/feature-a-v3-window-harness-2026-09-28/`):

- the real `share-window.html`, `shareWindow.js` and `shareWindowModel.js` from a **scratch build** of the
  working tree;
- a throwaway Electron main with the real window options (360 px, unfocused `showInactive`, 120–560 px
  height clamp);
- a stand-in preload with the real bridge's shape, which records every request and answers `ok`;
- CDP on :9333, every recorded read through `scripts/probe.mjs` with a control.

There was no link, phone or store, and filenames were synthetic only. The real `dist` still read
`11:13:57` afterwards.

**Readings (screenshots `1-…` to `7-…` in the evidence folder):**

| Question | Reading |
|---|---|
| Does any update take focus? | No, at every step: the window unfocused, `document.hasFocus()` false, `activeElement` = `BODY` |
| Waiting | *"Synthetic Phone wants to send a file"*, name, type, exact bytes, *Save to*, the owner's v3 sentence; **Decline**, **Accept** |
| Queued | *"Accepted — waiting its turn"*, *"1 transfer is ahead of it."* / *"2 transfers are ahead of it."*; **Cancel** |
| Receiving | *"Receiving from Synthetic Phone…"*; a progressbar with `aria-valuenow`, `aria-valuemax` and valuetext; *"Not saved yet…"*; **Cancel** |
| Saved | *"Saved on this Mac"*, *"Complete and checked. The phone confirmed it."*; **Show in Finder**, **Open** |
| Failed, Retry open | *"Not saved"*, *"What arrived did not match…"*; **Give up**, **Try again** |
| Declined, cancelled, expired, ended, failed with no Retry | each a headline, *"Nothing was saved."*, and **Close**; the no-action ends linger out after 8 s unfocused (measured 8,034 ms), while saved stays |
| Accessible names | every action names its file and arrival (`… (file 3, arrived 14:57:12) …`) — **except a finished card's Close** (defect below) |
| Tab order (DOM order, tabindex ≥ 0 — **not** a real Tab press) | header Hide, then Decline and Accept per card in arrival order |
| Focus ring | `:focus-visible` forced on each Accept: `solid 2px` |
| Accept on C (focus + click) | exactly `decide:accept:C` |
| Escape, nothing focused | `close-window` only; the window hidden, unfocused |
| Escape on a focused queued card | `close-window` only — nothing cancelled |
| Escape on a focused waiting card | `decide:decline:A` — **documented** (proposal line 121; `shareQueueView.test.ts`) |
| Header close while files wait | label *"Hide this window. Waiting files keep waiting until they expire."*; click → `close-window` only |
| A finished card's Close | the card leaves the list; **no request** sent |

**Defect fixed — `4498d4b`.** A finished card's Close read *"Close — Declined"* on every declined card, which
is ambiguous in a screen reader's button list. At version 3 it now names its file; at version 2 it is
unchanged.

- The test asserts the fact per action, over every state and both Retry values.
- It is red against the old code, and red if the ident is applied at version 2 too.
- Read back in the harness: two finished cards, two distinct names.

**Not reached by the harness:** the real Accept gate (`acceptAllowed` wants a visible, focused window, and a
first click on the inactive window only focuses it, since `acceptFirstMouse` is off). `.click()` bypasses
both. Real Tab and Enter presses were not dispatched either. Those need the real app or a person.

**Instrument faults caught here, none reported as findings:**
1. The first driver expected one `<li>` per offer. A card enters only once it has been pending or shown, so
   an offer injected as already saved is never drawn. That is the documented rule, and a state a real run
   cannot produce. Replaced by a stepped lifecycle.
2. A step moved a card from *failed, Retry open* to *failed, no Retry* in place, and that card never lingered
   out. The Mac never makes that transition: `onRetryWindowClosed` moves it to `expired`.
3. zsh does not word-split a `$A="adb-pinned.sh samsung"` variable. Four device reads failed with *no such
   file*, and were re-run through a function.
4. The first resolver control grepped a pattern the output does not contain and came back empty. It was
   redone on `packageName=`, and only then was the `SEND_MULTIPLE` zero read.

## 5 · Findings recorded, not fixed (each needs the owner)

- **F4 — the newest waiting file can arrive out of sight.** Measured with `__probe.onScreen`, with five files
  arriving one by one at the 560 px cap and `scrollTop` 0 throughout:

  | Arrival | Newest card on screen at rest |
  |---|---|
  | 1st | fully visible |
  | 2nd | fully visible |
  | 3rd | 89% visible |
  | 4th | 0% |
  | 5th | 0% |

  The window presents itself for that file and the live region announces it, but the card is below the fold
  with only a scrollbar to say so (`7-fifth-arrival.png`). This repo's rule is that a card carrying a state
  must be visible at rest. **Not fixed, because every fix changes what a person sees before consenting.**
  - Scrolling the new card into view could move an Accept under a pointer.
  - A *"2 more files waiting below"* line is new copy.
  - Newest-first reverses the arrival order the proposal fixed.

  Recommendation: scroll the subject into view (`nearest`) only when the window is neither hovered nor
  focused. That is the same condition the linger already uses, and it is when nobody can be mid-click.
- **F5 — proposal §5's consent sentence is stale.** It reads *"If you accept, it transfers on its own after
  the 1 file ahead of it."* The code carries *"Accept this file now. If another transfer is running, this one
  starts when it finishes."*, marked *"the owner's wording, exactly"* and pinned by a test since `676c5f2`.
  The code is presumed right; the proposal text needs the owner to confirm and correct it.
- **F6 — the phone's `onBeginPull` glue is not JVM-reachable** (same shape as F3). It holds the second-pull
  refusal and the staging-lost check at pull start. The rules it calls are tested (`pullInFlight`,
  `stagingCheck`); the glue needs a `LinkServer`.

## 6 · Suites and guards at the end

- **Phone** (`--rerun-tasks`, every results file newer than the run): core 217, sync-module 528, app 164,
  input-module 52, mirror-module 60 — **0 failures, 0 skipped**.
- **Mac:** **1,282/0**, 0 skipped (`desktop/.test-run.json`, green); both typechecks clean.
- **Guards:** 17 commit guards exit 0 on each commit. `scripts/motion-sweep.mjs` was **not run**: it needs the
  app up (`ECONNREFUSED`), and its own hook says it is not a commit guard.
- **Not run:** the emulator, any Compose UI of the phone's several-files screen, and `desktop/dist`.

## 7 · Connected Samsung, read-only (15:0x IST) — every write-capable command went through the pin; nothing written

| | Reading |
|---|---|
| Device | `RZCY12330DT`, SM-S938B, SDK 36; `adb devices` lists only it |
| Users | current user **0**; users 95 (Dual App) and 150 (Secure Folder) also running |
| Installed | `com.chetan.connectsuite.debug` `2.0.0`, `lastUpdateTime=2026-09-28 11:34:59` (the P1 install of `491cd21`, per the Run B record) |
| Link | `link-up.sh`: service foreground, 42501/42502/42503 LISTEN under uid 11011; **no Mac session** (the Mac app is stopped) |
| Component overrides | none, in `enabledComponents` or in `disabledComponents` |
| Resolvers, user 0 | `SEND_MULTIPLE`: **0 of ours** for `image/png` (of 86 lines) and `application/pdf` (of 50). Control — `SEND`: ours 12 of 146 (png), 4 of 74 (pdf). `SEND image/png` → `ShareToMacActivity` ("Send to Mac") **and two debug probes**, "Sidekick grant probe (debug)" and "Sidekick staging proof (debug)"; `SEND application/pdf` → `ShareToMacActivity` only |
| Runtime permissions, user 0 | 14 `granted=true`, including `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and `POST_NOTIFICATIONS`; unchanged by this block |
| Staging | `cache/share-staging` empty |
| Free space | phone `/data` 18 GB free (96% used); Mac 15,006 MiB free (floor 3 GiB) |
| Synthetic files, SHA-256 | `Download/SidekickGrantP5/sidekick-grant-p5-a.pdf` 40,000 B `dfe83252…c329` ✓ recorded; `…-b.pdf` 70,000 B `acb1c151…26a9` ✓; `Pictures/SidekickShareTest/sidekick-share-test-001.png` 100,718 B `d5cfb8a3…c9ff` ✓; **`Pictures/SidekickShareTest/sidekick-share-test-image.png` 230,778 B `1afc71b6…c84c` — present on the SM-S938B**, which the runbook had as *unknown* (recorded on the emulator only) |

The §11 grant check was **not** repeated. The P5 reading already exists, and its intake needs a person's taps
in My Files, which an unattended block cannot make.
