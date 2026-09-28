# Feature A — several pending files: one receive window with a queue (proposal rev 4, for review)

**Rev 4, 2026-09-26 (Stage 0: documents only).** Replaces rev 3 (2026-09-25). Rev 3's text is kept
below where rev 4 does not replace it; §11–§20 are new. **Built inert since 2026-09-26 — see *Build
status*; not approved, not advertised.** The contract text is
`docs/protocol.md` → *Share → Version 3 (PROPOSED)*. Large files are a **separate** design:
`docs/feature-a-large-file-proposal.md` (Path L). This file is Path S, small files copied privately
before they are offered.

**Approved direction (owner, 2026-09-25):**
- **One receive window**, with a card per file and **individual Accept and Decline**. No extra popups.
- **Stage A** (send another while one waits) comes **before** Gallery multi-select.
- **No group actions** yet.
- **Not approved:** enabling any of it, and the 4 GiB figure. (Stage A was later built inert; see
  *Build status*.)

**What rev 3 corrects in rev 2 and in the committed contract text:**

| # | Was | Is |
|---|---|---|
| R1 | *"a queued offer ends only through the transfer ahead of it … or a cancel"* | a queued offer **does not expire while queued**; it ends only by a cancel from either side, the session ending, or the phone's 60-minute backstop |
| R2 | phone admits while `Σ(staged) + margin(Σ) ≤ free` | **double-counted**: bytes already staged are already missing from `free`. The check is made **once per file, before its copy starts** (§4) |
| R3 | "staged bytes per session ≤ 4 GiB" read as a file limit | a **concurrency cap on Path S private copies only**. A file alone keeps the v2 free-space rule, however large; above what can be copied, the file goes to Path L. **The value is not proposed for locking** (§4) |
| R4 | queued card: *"starts after IMG_1.jpg"* | files are pulled in **Accept order**, so the card names its position: *"Accepted — 2nd in line"* (§5). *Wording superseded — §5, corrected 2026-09-28: "Accepted — waiting its turn" / "1 transfer is ahead of it."* |
| R5 | Mac reservation: *"sizes accepted and not finished"* | defined precisely, including when each reservation is released (§4) |

**Owner decisions recorded in rev 4 (2026-09-26):**
- Multi-file sharing is the next priority: **small photo and document batches first**, through one Mac
  receive window with an **individual Accept or Decline per file**. No popups per file, no Accept all.
  Large-file streaming stays separate (Path L).
- **Approved for development only, as PROVISIONAL parameters:** D1's live per-copy budget with
  f = ½, a floor of 3% of total + 1 GiB, and readings at most 5 s old (§4); D3's 60-minute backstop for
  an accepted file waiting in the queue (§6); D4's per-file handling of unknown sizes (§14).
- **Unchanged:** the single-file admission rule, `s + max(256 MiB, ⌈s/10⌉) ≤ free`.
- **Also decided (owner, 2026-09-26, later the same day):**
  - **B — an extra share from the single-file sheet is refused, never left waiting.** When another
    private copy is already held (`Σ > 0`) and the §4 budget refuses this one, the sheet shows a clear
    refusal with the **measured** limit and a **Try again** action (§2). *Waiting for room* is only for
    a selection (§12). With no other copy held (`Σ = 0`), the single-file flow is **unchanged**.
  - **C — any eventual Stage 1 hardware test runs with version 3 armed on both sides for the test
    only, then disarmed, with the normal version-2 launch restored and read back** (§10, §19). This
    describes a future test; **it is not authorised by this decision.**
- **Not approved:** enabling any of it — Stage 1 wiring, the development switch, or advertising
  `share.file 3`. Stage A and the Stage B groundwork are **built inert** (*Build status*). Also not
  approved: the notification in §13.3, and every value in this file for production.

**What rev 4 corrects in rev 3 and in the records:**

| # | Was | Is |
|---|---|---|
| R6 | a fixed cap `C` on private copies held at once, with a candidate of ≈ 7.8 GB | **no fixed cap.** An extra copy is admitted against a budget read live on the phone, immediately before that copy (§4). The measured cache quota (183,326,942 bytes on the SM-S938B, 2026-09-26 10:14:15) is **one device's input**, not a limit that applies elsewhere, and staying below it **does not guarantee** Android keeps the copies (§4) |
| R7 | §3: *"A selection over a §4 limit is refused as a whole"* | only the **count** (over 10), an unusable item, another share still preparing on the phone (`ANOTHER_IN_PROGRESS`), or a version-2 Mac refuses a selection as a whole. **Size never refuses a whole selection**: a file that does not fit yet **waits for room** (§12), and a file that cannot fit even alone fails **by itself** (§15) |
| R8 | the sheet was assumed to keep a Gallery or My Files grant only while it exists, from `ACTION_SEND` readings | the `SEND_MULTIPLE` grant path is **verified from platform source** and **not measured** on any device. What may continue after the review screen closes is stated from that evidence and no further (§11) |
| R9 | a status report said the lost-copy checks were "not proven on hardware" | the **30-second held-copy check** and the **Mac main-window card wording** for a lost copy were **observed** on the SM-S938B, 2026-09-26 14:32–14:37. The **receive-window wording** and the **Accept-time check on a lost copy** were **not** (§16) |

---

## Build status — 2026-09-26 (overnight, offline, **inert**)

Stage A is **built behind `share.file 3`, which neither side advertises**, so none of it is reachable
in a pairing. Evidence: `docs/testing.md` → *Version 3 queue, Stage A*.

- **Built:** the Mac's ten-offer book, Accept-order queue with one writer, per-offer reservations
  (including an Accept whose own check is still running), the queue lifetime and the late-failure Retry
  window; the window's list of cards with per-offer Accept / Decline / Cancel; re-presenting only for a
  queued file that ends *not saved*; the phone's ten-offer limit, one pull per session, the queue bound
  and its backstop, and the admission call the sheet makes before a copy.
- **Still disabled, deliberately:** `share.file 3` is advertised only after a debug arm on the phone and
  the `shareV3` switch on an unpackaged Mac with `share.ask` open — neither has been done. **`APPROVED_CAP`
  is still `null`**: a caller that supplies no budget readings (any release build) is refused a second
  concurrent copy (`CapNotApproved`). Stage B (`SEND_MULTIPLE`) is not registered.
- **Stage 1, built 2026-09-26 (uncommitted, automated tests only — nothing installed, armed or run on a
  device):** the §18 switch on both sides (`ShareDevGate.v3` + the `DUMP`-gated `ShareDevV3Activity`; the
  Mac's `shareV3Activation`), and `ShareConcurrentBudget` wired into `ShareAdmission.forCopy` at version 3
  with copies held, with readings from `ShareBudgetReadings` supplied by the single-file sheet **only in a
  debuggable build**. The sheet's refusal is decision B's (*no room for another file yet*, the measured
  limit, **Try again**). `APPROVED_CAP` stays `null` and still governs any caller that supplies no readings.
  Evidence: `docs/testing.md` → *Version 3 Stage 1*.
- **Built for version 2 (`acd24a4`), installed on the SM-S938B in the debug build from `f71285b`:** the lost-copy checks (held-copy check
  every 30 s, Accept-time check, pull-start check). What of this has been observed on hardware is in §16.
- **Provisional, not approved:** the 60-minute queue lifetime (`QUEUE_LIFETIME_CANDIDATE_MS`, both
  sides). No 4 GiB or 8.13 GB figure is used as a limit anywhere.
- **Found while building it:** defect 155 (a Decline during an Accept's check could end *saved*; also
  in version 2 — unreachable through the window). Fixed in `676c5f2`; in the running Mac dev app
  (pid 93018, `dist` built from `f71285b`); the race has not been produced on hardware.
- **Unmeasured:** the list's layout and scrolling in a real window; everything on a device.

## 1 · Today (measured from the code): both are blocked

- **Multi-select:** `SEND_MULTIPLE` is not registered, a multi-item `SEND` is refused, and the offer's
  `item` is one object.
- **Another while one waits:** one live offer per session on both sides, visible since `02d95b3`
  (passed on the SM-S938B, 2026-09-25).

---

## 2 · Stage A — what a person sees

- **On the phone:** each file keeps its own sheet and its own offer. A second Send makes a second offer
  unless a §4 limit applies, in which case the sheet says which one, with the numbers.
  - **The single-file sheet never waits for room** (owner decision B). If a copy is already held
    (`Σ > 0`) and the §4 budget refuses this file, or a reading is missing or stale, the sheet shows a
    **refusal**, copies nothing and offers nothing:
    - with readings: *{Mac} is still handling another file from this phone, so this phone can prepare
      only X more right now; this file is Y.* — `X` is the **measured** `min(Bq, Bs)` of that
      attempt, and no fixed figure appears;
    - with a missing, stale or impossible reading: *Couldn't measure how much room this phone has
      for another file right now.*
    - **Try again** re-runs the same admission with fresh readings (≤ 5 s old). It is a person's tap,
      never a timer, and it works only while the sheet is open, because it reads the shared URI (§11).
      A still-refused attempt shows the refusal again with the new numbers. After the sheet closes,
      the person shares the file again.
    - At 10 live offers, the sheet shows the same refusal shape with the existing `busy` wording.
  - **With no other copy held (`Σ = 0`)** the sheet is the version-2 flow **unchanged** — same rule,
    same words, same tests (§18).
- **On the Mac:** one window, one card per offer, **in the order the offers arrived**.
  - Each card shows the name, type, exact size, destination and a type glyph — no preview before Accept.
  - Each has its own **Accept** and **Decline**.
  - **Pulls run one at a time, in the order the files were accepted.**
- **Unchanged:** the window never takes focus on arrival, never covers a full-screen Space, and never
  uses Notification Center. Escape declines only the focused card's waiting offer.

| Card state | Words on the Mac | What exists where |
|---|---|---|
| waiting | *Samsung SM-S938B wants to send a file* | phone: private copy · Mac: nothing |
| queued | *Accepted — 2nd in line. It starts on its own when the file ahead finishes.* | phone: private copy · Mac: nothing |
| receiving | *n of N · p%* (never 100%) | Mac: its own nonce'd partial |
| checking | *All bytes received — checking before saving* | Mac: the partial, being verified |
| saved | *Saved on this Mac* · *the phone confirmed it* / *confirmation to phone unknown* | Mac: the published file · phone: copy deleted |
| not saved | the reason, and *Try again* while its window is open | Mac: nothing · phone: copy kept for the window |
| declined · expired · withdrawn · cancelled · ended with the connection · refused | each its own word | nothing kept on either side |

---

## 3 · Stage B — Gallery and My Files multi-select (after Stage A is proven on hardware)

> **Groundwork built 2026-09-26, not wired, not registered** (`ShareSelection.kt`; `docs/testing.md` →
> *Stage B groundwork*): parsing, whole-selection refusal, and one-at-a-time staging with per-file
> cleanup. With no approved cap it refuses every selection of more than one file.
> **This implements rev 3's whole-selection cap refusal** (`ShareBatch.admitSelection` →
> `CapNotApproved`, or `OverCap` on `Σ` plus the known sizes), which R7 withdraws. Stage 2 replaces it
> with per-file admission (§4, §12).

> **Stage 2 begun 2026-09-27 — development only, automated tests only, uncommitted** (`docs/testing.md` →
> *Stage 1 verified through Gradle, and Stage 2 begun*). `ShareManyQueue` (the §12/§14/§15 rules),
> `ShareManyCopy` (§13.1, §13.2, §15 wording), and a debug-source-set `ShareManyToMacActivity` whose
> manifest entry is `android:enabled="false"`. **Not built:** ~~the stall clock~~ (built 2026-09-28, §12), Stop preparing, the §13.3
> notification, keep-screen-on, and `group` (no Mac-side C3 validation exists). Leaving the screen ends
> unprepared files: a fail-closed placeholder, not a decision on option A.

*Rev 4 replaces this section's rules. The flow is below; the rules are §11–§15.*

- **A new activity**, `ShareManyToMacActivity`, registers `SEND_MULTIPLE` with the same types as the
  single-file filter and no `text/*`. `ShareToMacActivity`, its `SEND` filter and its tests are **not
  touched**. A `SEND_MULTIPLE` carrying **one** file becomes a single-file share at any version (§15).
- **Review first, copy after.** The screen opens on the list — each file's name and its size (or *size
  not reported*), read from the provider's `OpenableColumns` without opening the content — plus the
  count and the total of known sizes. Nothing is copied until the person presses **Send N files**.
- On Send, files are copied privately **one at a time**. Each is offered **as soon as its copy is
  ready**, so offers reach the Mac over time rather than all at once. Every file is its own offer, with
  its own Accept and Decline on the Mac.
- A file that does not fit yet **waits for room** (§12). A file that cannot be prepared fails **by
  itself** (§15). **Size never refuses the whole selection.**
- `group {id, index, count}` is **display only** and authorises nothing (§17, C3).
- A file too large even alone fails with its numbers. **Path L is not built**, so the screen does not
  offer it as a route.

---

## 4 · Limits and exact byte accounting

| Limit | Proposed | Status |
|---|---|---|
| Live offers per session | **10** | proposed (owner's figure) |
| Files per selection (Stage B) | **10** | proposed; equal to the live limit |
| One file, alone | the v2 rule, unchanged: `s + max(256 MiB, ⌈s/10⌉) ≤ free`, read immediately before its copy starts | proven on hardware; **no fixed size** |
| Private copies held at once (phone, Path S) | **no fixed cap**: a per-copy budget read live (below) | **PROVISIONAL, development only** (rev 4) |
| Mac reservations | as defined below | proposed |

**Phone accounting (Path S), rev 4.** *Rev 3's fixed cap `C` and its ≈ 7.8 GB candidate are
withdrawn (R6).*

- A file is admitted **when its copy is about to start**, not when it is offered, because the copy is
  what consumes space. `Σ` is the total of copies that already exist for live offers. They are
  already on disk, so already absent from `free`, and are never subtracted a second time (R2).
- **A file alone (`Σ = 0`): the single-file rule, unchanged**: `s + max(256 MiB, ⌈s/10⌉) ≤ free`. No
  quota, reading or budget below applies to it, however large it is and even if every reading is
  unavailable.
- **An extra file (`Σ > 0`)** may be copied only up to `min(Bq, Bs)`, computed immediately before its
  copy starts from readings **at most 5 s old**:

  ```
  Q  = StorageManager.getCacheQuotaBytes(this volume)       read live, every time
  K  = this app's whole cache (own-package cacheBytes)       includes every staged copy
  w  = bytes of this copy already written (0 before it starts)
  N  = K − Σ − w                                             this app's other cache
  Bq = ⌊Q · ½⌋ − N − Σ − w                                   quota budget
  H  = ⌈3% · total bytes⌉ + 1 GiB                            free-space floor
  Bs = largest x with x + max(256 MiB, ⌈(Σ + w + x)/10⌉) ≤ usable − H
  ```

  The budget is checked again **while the copy runs** and **once when it finishes**, with fresh
  readings. A quota that drops, a reading that disappears or goes stale, or free space falling
  towards `H` stops the copy, deletes its partial, and moves the file to *waiting for room* (§12) —
  or, from the single-file sheet, to its refusal with **Try again** (§2).
  The arithmetic is `ShareConcurrentBudget` (`f71285b`), unchanged.
- **Status of the values:** ½, 3% + 1 GiB and 5 s are **PROVISIONAL development parameters**
  (owner, 2026-09-26). None is a production constant; production values are a separate decision.
- **A missing, stale or impossible reading refuses only the extra copy.** In a selection the file
  waits for room, and it is never a failure while the file could still be prepared alone (§12). From
  the single-file sheet it is a refusal with **Try again** (§2).
- **A copy stops counting in `Σ` the moment its offer ends** — saved, declined, withdrawn, expired,
  cancelled, lost or ended with the connection — because every one of those ends deletes it
  (unchanged).
- One copy runs at a time (the existing `ANOTHER_IN_PROGRESS` rule), so two copies cannot race for
  the same space.

**What the quota is, and what it is not.**
- `Q` is the size above which the platform clears **this app's** cache **first** when it needs space.
  It is an eviction-priority threshold that the platform recomputes from use. It is **not** capacity,
  **not** a reservation, and **not** a promise: Android may clear cache below it, and staying under it
  **does not guarantee** a staged copy survives.
- **One measured input, from one device:** 183,326,942 bytes on the SM-S938B (`RZCY12330DT`),
  2026-09-26 10:14:15 (`docs/testing.md` → *Stage 0 corrections*). At that reading, with one 1 MiB copy
  held, `Bq` was 89,980,015 bytes and `Bs` was 6,281,791,226, so the quota bound. That ≈ 90 MB is **a
  worked example, not a limit**: another phone, or this one on another day, reads a different `Q`.
  **No figure from this reading appears in code or copy.**
- **Every held copy stays covered by the version-2 lost-copy checks** (`acd24a4`): the 30-second
  held-copy check, the Accept-time check and the pull-start check. A copy the platform removes ends
  **that file only**, as `staging-lost`; the others are unaffected. What of this is proven on
  hardware is in §16.
- **Context:** the SM-S938B is below Samsung's caution line (22.6 GB usable; caution 27.5 GB, warning
  13.7 GB; `dumpsys devicestoragemonitor`, 2026-09-25). The floor `H` exists so that concurrent
  staging never pushes a phone towards its own warning state.

**Mac accounting.**
- **At the offer and again at Accept:** `free ≥ R + size + margin(size)`, where `R` is the sum of
  reservations and margin is the Path S margin `max(256 MiB, ⌈size/10⌉)`.
- **Reservations, per offer:**
  - **queued:** reserves its full `size`, from Accept until it ends or starts receiving;
  - **receiving:** reserves `size − bytes already written to its partial`;
  - **released at once** on saved, saved-unacknowledged (the bytes are now a real file), not saved,
    cancelled, declined, withdrawn, expired, lost (`staging-lost`) or ended.
- **A Retry re-reserves** through the same Accept check. It does not hold space during its window.

---

## 5 · Accepted and queued: consent, privacy, and the window

**Consent wording**, because an Accept now authorises a transfer that may start later, with nobody
watching. *Corrected 2026-09-28 to the shipped, test-pinned copy (`desktop/src/shared/shareReceiveCopy.ts`,
`shareReceiveCopy.test.ts`); this section had kept rev 3's draft sentences, which were never built.*
- On **every** waiting card at version 3 — whether or not another file is ahead — the line above the
  buttons reads *"Accept this file now. If another transfer is running, this one starts when it
  finishes."* The code labels this *"the owner's wording, exactly"* (`676c5f2`, 2026-09-26); no separate
  approval record was found in `docs/`. At version 2 the line is absent.
  - The buttons read **Decline** and **Accept**. **Open, not built:** the accessible names do **not**
    repeat the sentence. Accept's is *"Accept {file} (file N, arrived hh:mm:ss) from {phone} and save it
    to {folder}"*; the sentence is read as the card's text. Whether Accept's name must carry it is the
    owner's decision (consent wording), and is not changed here.
- After Accept, while another transfer is ahead, the card reads *"Accepted — waiting its turn"*, then
  *"1 transfer is ahead of it."* (or *"N transfers are ahead of it."*), then *"It starts on its own when its
  turn comes. Nothing of it is on this Mac yet, and it is not saved."*, with **Cancel** (owner-approved and
  committed, 2026-09-28 02:0x — `docs/RESUME.md`).

**Privacy of a queued file:**
- Nothing of it is on the Mac — no bytes, no partial, no preview — only the name, type and size the
  offer already showed.
- The phone keeps its private copy. The phone logs no file name; the Mac logs a name only once saved.

**Closing and reopening the window:**
- **Closing hides the window. It cancels nothing and declines nothing.** Queued files keep their
  place and start when their turn comes; the receiving file continues.
- The main window's card list shows every offer's current state, with **Show**.
- **Reopening** (Show, or a new offer arriving) draws every card in its current state. Nothing is
  replayed or re-asked.
- **The window re-presents itself — inactive, never taking focus — only when a card newly needs a
  person:** a new waiting offer, a refusal, or a queued file that became *not saved* (it can be tried
  again).
  - A queued file starting, progressing or being saved does **not** re-present the window.
  - It updates its card and the main window's card only.

---

## 6 · Expiry, per file

| State | Ends when | Words |
|---|---|---|
| waiting | 10 min after the phone offered it — **unchanged** | *Expired — nobody answered in time* |
| queued | **does not expire while queued.** Ends by a cancel from either side, the session ending, or the backstop | — |
| queued, backstop | the phone ends an accepted offer whose pull has not begun **60 min** after Accept (`share.cancel{expired}`). **Approved for development only** (owner, 2026-09-26); the production value is open | *Expired before it started* |
| waiting for room (phone only, rev 4) | never offered, so nothing on the Mac. Ends when prepared; after **10 min of running stall-clock time** or a **60-min** wall-clock ceiling (both PROVISIONAL, proposed for review — the clock **pauses** while the file waits only on accepted, receiving or checking offers, §12); or when the screen closes or the session ends | phone: *Not sent — …* (§13) |
| receiving | 30 s with no byte — unchanged | *The transfer stopped* |
| checking → verdict | no `share.saved` within 60 s of the last byte — the phone reads `unconfirmed`, unchanged | phone: *Not confirmed* |
| not saved | its 5-min Retry window, unchanged; a Retry goes to the **back** of the queue | *Expired* when the window closes |

---

## 7 · Cancellation — per file, never collateral

- **Mac:** Decline while waiting; Cancel while queued or receiving; Give up when not saved.
- **Phone:** Withdraw on that file's sheet, in any live state.
- **A saved file cannot be cancelled.** No action ends another file. Cancelling the receiving file
  lets the next queued file start. Group actions are deferred.

---

## 8 · Disconnect and restart (Path S) — cleanup, and how each side confirms it

| Event | Every live Path S offer | The receiving file | Published files |
|---|---|---|---|
| Link drops | ends on both sides without a message (unchanged) | the pull is aborted; the Mac deletes its own partial and forgets it in the ledger | kept; a mid-publication one is `saved-unacknowledged` |
| Mac app quits or crashes | gone (memory only); the phone sees the session end | the next launch's ledger sweep deletes the partial, by identity | kept |
| Phone app restarts or is killed | the Mac sees the session end | as above | kept |
| Reconnect | **nothing resumes or re-offers**; the person sends again | — | — |

**How each side confirms the cleanup:**
- **Phone:** one line per ended offer — *"offer … ended (session ended): staged copy deleted, N
  file(s)"* (it writes this today) — and each open sheet reads *Ended with the connection*.
- **Mac:** every affected card reads *Ended with the connection — nothing saved*. The ledger line
  reports the partials deleted, and whatever it could not prove it left and names.
- **Nothing** here deletes a published file.

(Path L pauses rather than ends; see `docs/feature-a-large-file-proposal.md` §5.)

---

## 9 · "Saved" — exact, per file

- **Mac: *Saved on this Mac*** only after, for **that** offer:
  1. every byte arrived;
  2. the partial was flushed;
  3. its on-disk length equals the bytes received and the offer's size;
  4. SHA-256 equals the offer's digest;
  5. it was exclusively published.
- **Then, separately:** *the phone confirmed it* when `share.saved {ok:true}` was acknowledged;
  otherwise *confirmation to phone unknown*.
- **Phone: *Saved*** only on that acknowledged verdict.
- **Summaries** count facts — *3 saved · 1 declined · 1 not confirmed* — and never say *all saved*
  unless every file is saved **and** confirmed.

---

## 10 · Stage A test plan — bounded, for approval

**Automated (no device):**
- negotiation fixtures 3+3 and 3+2, both sides;
- admission at 1, 10 and 11 offers, the file-alone (`Σ = 0`) exemption from the §4 budget, and the
  per-file margin over `Σ + s`;
- two accepted offers pulled strictly in Accept order, each with its own partial and ledger entry;
- reservations: the second of two files that fit alone refused; release on each end state;
- queued → cancelled, ended by disconnect, and expired by the backstop, each deleting its copy;
- the window drawing three cards in three states without moving focus, and **not** re-presenting on a
  queued file's save;
- each named rule shown red under mutation.

**Hardware — one supervised run, synthetic files only:**

| Bound | Value |
|---|---|
| Files | the two generated images in `SidekickShareTest` only (100,718 and 230,778 bytes) |
| Install | one `install -r` of the Stage A build, same readings before and after |
| Version 3 | **armed for the run on both sides** — the phone by its debug arm activity, the Mac relaunched with the `shareV3` debug switch (`CONNECTSUITE_DEBUG_SWITCHES=shareV3`) (§18). **Afterwards:** the phone disarmed (a process restart clears the arm) and the Mac relaunched **without switches**, then the normal version-2 negotiation read back on both sides |
| Duration | ≤ 30 minutes, three sequences, then stop |
| Destructive actions | none — no deletion, no personal media, no Accept by the harness |

1. **Two waiting, then out of order.** Send both. Both cards show; Accept the **second**, then the
   first. It transfers first; the other reads *2nd in line*, then saves.
   - **Pass:** both SHA-256 equal the phone's; collision-safe names; exactly one partial at any sample.
2. **Queue cancel.** Send both again; Accept both; Cancel the queued one before it starts.
   - **Pass:** it never pulls (no `fs.transfer.begin` for it), its phone copy is deleted, and the
     other saves.
3. **Disconnect with two waiting.** Send both; press **Disconnect** on the Mac, a Mac-side action with
   no phone settings touched.
   - **Pass:** both cards *Ended with the connection*; phone staging empty; Mac ledger `[]`; nothing
     published.

**Stop conditions:**
- any offer whose name or size is not one of the two files;
- any pull before an Accept;
- any change to a pre-existing file;
- any device reading differing after the install.

---

# Rev 4 additions (2026-09-26, Stage 0: documents only)

## 11 · `SEND_MULTIPLE` grants and the review screen's lifetime: verified, measured, and unknown

**What the platform source says (verified by reading it, not measured).** From AOSP
`frameworks/base`, `core/java/android/content/Intent.java` on the `main` branch, fetched 2026-09-26
(file SHA-256 prefix `924e9760629e0558`), `migrateExtraStreamToClipData(Context)`:

- For `ACTION_SEND_MULTIPLE`, when the sender supplied **no** `ClipData`, the framework builds one
  `ClipData` holding **every** `EXTRA_STREAM` URI and **adds `FLAG_GRANT_READ_URI_PERMISSION`**. That
  is the same mechanism as `ACTION_SEND`.
- It **skips the migration** when the sender already supplied `ClipData` (the sender's own flags
  apply), when extras are already parcelled, and when the stream, text and HTML lists differ in
  length.
- The flag's javadoc says the grant covers *"all URIs"* in the `ClipData` and that *"only the grant
  flags of the top-level Intent are used"*. It says **nothing** about how long the grant lasts.
- Android's guide (*Sharing a file*, developer.android.com, read 2026-09-26) says: *"The permissions
  you grant are temporary and expire automatically when the receiving app's task stack is
  finished."* That is a statement about the task stack, not about one activity or `onStop`.

**What has been measured — all for `ACTION_SEND` (one file). Nothing for `SEND_MULTIPLE`:**

| Where | Source | Reading | What it shows |
|---|---|---|---|
| Pixel 10 emulator, 2026-09-23 | Google Photos, DocumentsUI | `SecurityException` at +1 s, +30 s, +120 s after `onDestroy`; the control read inside the activity succeeded | the grant did not outlive the finished activity |
| SM-S938B, `b3eca15` | Samsung My Files | `SecurityException` **+2 s after Finish** while the staged copy read fine; one reading | the same, once, on this phone |
| SM-S938B, `b3eca15` | Samsung My Files | re-open **succeeded after an activity recreation** | the grant survived one recreation |
| SM-S938B, `b3eca15` | Samsung Gallery | readable after Finish | **confounded, not a finding**: Sidekick holds `READ_MEDIA_IMAGES`, which opens `content://media` with no grant |

**Unknown, and not to be assumed:**
- whether Samsung Gallery and My Files send `SEND_MULTIPLE` with their own `ClipData` (then their
  flags decide) or with `EXTRA_STREAM` only (then the framework's migration decides);
- how long a grant lasts while the receiving activity is **stopped but not finished**. The platform
  text points at the task stack, and nothing here has measured it. **It is not claimed that every
  shared URI becomes unreadable at `onStop`.** The single-file sheet finishing at `onStop` is **this
  app's own choice** (`ShareToMacActivity.onStop`), not a platform fact;
- whether a `SEND_MULTIPLE` grant survives recreation on this phone.

**The rule that follows, and why it does not depend on the unknowns:**
- **Shared URIs are read only while the review screen is alive** — the one condition under which every
  control above succeeded. After it finishes, **nothing reads a shared URI**, even where a read might
  still succeed. For Gallery this includes reads through Sidekick's own media permission: that would
  be a different legal basis, it fails under partial media access, and it is not approved.
- **What can safely continue after the screen closes:** every file **already prepared and offered**.
  Its private copy belongs to its offer and lives in the app process, not the screen, so Accept,
  queueing, the transfer, the Mac's check and *Saved* all run from the copy, exactly as for one file
  today. Leaving does **not** withdraw an offered file (unchanged from version 2).
- **What cannot continue:** any file not yet prepared — never started, waiting for room, or between an
  unknown-size attempt and its retry (§14). It becomes **Not sent — the share screen closed before it
  was prepared**, its partial copy (if any) is deleted, and the Mac never hears of it.
- **Lifecycle, proposed (option A):** the review screen behaves like the single-file sheet and finishes
  when it stops without a configuration change. While any file is preparing or waiting for room, it
  keeps the display on (`FLAG_KEEP_SCREEN_ON`), so a screen timeout does not end the batch. It
  releases that as soon as no file is preparing or waiting. Option B — keep preparing while stopped
  and rely on the grant lasting — is **not proposed**, because it needs the measurement below first.

**The measurement owed before Stage 2's hardware run (needs owner approval; not run):** a debug-only
`SEND_MULTIPLE` receiver, following the §4 instrument of `docs/phase-7-share-proposal.md`.
- **Samsung My Files** is the discriminating source, because Sidekick has no other access to its
  provider.
- Per item, record: the `ClipData` item count, whether `EXTRA_STREAM` was also present, the answering
  authority, and a **control read inside the live activity**. Then take reads at +1 s, +30 s and
  +120 s **after finish**.
- Gallery rows count as a grant reading **only** with `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` revoked,
  which is a device change needing separate approval. Otherwise they are recorded as *confounded*.

## 12 · Waiting for room: when it retries, times out or fails

**A file waits for room** when, at its turn:
- (a) it would be an extra copy (`Σ > 0`) and the §4 budget refuses it, including a missing or stale
  reading; or
- (b) the session already has 10 live offers; or
- (c) it is an unknown-size file waiting for its one retry alone (§14).

**It fails at once instead of waiting** when nothing that could end would make room. For a known size
`s`, that means `s + max(256 MiB, ⌈s/10⌉) > free + Σ`: even with every held copy released, the
single-file rule refuses it. That is *Not enough space on this phone*, with the numbers (§15).

**Retry triggers.** Each trigger re-reads the readings (≤ 5 s old) and re-evaluates the waiting files:
1. any live offer on this session **ends**, in any state — this releases its copy from `Σ` and a live
   slot;
2. a copy of this selection **finishes or fails**;
3. **every 5 s** while any file waits, because free space and the quota can change without an event.

**Order, and why nothing starves.**
- Waiting files are retried **oldest first, in selection order**. A waiting file is **never overtaken
  by another waiting file**.
- Only a file **never yet tried** may go ahead of a waiting one. Each file is tried **once** (twice for
  an unknown-size retry, §14), and a selection holds at most 10. So **at most 9 files can ever go
  ahead** of any one file.
- **No other share can add to `Σ` meanwhile.** While a selection has any file that is neither offered
  nor ended, it counts as a live attempt, so the existing `ANOTHER_IN_PROGRESS` rule refuses a second share
  on this phone.

**Why a wait always ends.**
- A file waiting for reason (a) or (b) is always waiting on a **live offer**, because `Σ > 0` or live
  offers exist. Every live offer ends in bounded time: unanswered after 10 minutes; queued after the
  60-minute backstop; receiving after 30 s with no byte.
  The stall clock and its 60-minute ceiling (below) bound the wait even where these rules do not —
  a trickling transfer, or a reading that never returns.
- If `Σ = 0` and no copy is running, the file is no longer an extra copy. The single-file rule decides
  at once, and the file is either prepared or fails. It cannot keep waiting.

**The wait is bounded by a stall clock, not by elapsed time — PROPOSED for review, not approved.**
*The first draft of rev 4 had a flat "10 minutes in total". That is withdrawn:* it would end a file while an earlier file was still
legitimately in progress. A wait is attributed at each evaluation (every trigger above, so at most 5 s
apart), and only a wait that nothing in progress explains counts against the file.

- **In progress** means a live offer on this session that has been **accepted — queued, receiving,
  or checking** (after the last byte, awaiting its verdict). Each of those already ends in bounded
  time by its own rule: the 60-minute queue backstop, 30 s with no byte, 60 s with no verdict.
- **The clock is paused** when the file **would be admitted if every in-progress offer's copy were
  released** — that is, admission re-run, **as a hypothetical only**, with `n` in-progress offers holding
  `b` staged bytes taken out: `Σ' = Σ − b`, **`free' = free + b`** (a released copy's bytes are free space
  again), and `live' = live − n`. If `Σ' = 0` the single-file rule decides on `free'`, with no quota
  reading. Then the file is waiting **only** for work already under way, and that is not a stall.
  *(Owner, 2026-09-28: `free'` replaces the first build's reading, which kept `free` unchanged and so
  expired a file whose only obstacle was the space an accepted copy occupied.)*
  - **The credit is hypothetical.** It decides only whether the clock counts. It is never used to
    admit, copy or reserve anything: actual admission reads the measured `Σ` and `free`, so a paused
    file is copied only once the in-progress offer has really ended and its space is really free.
  - When `Σ' > 0` the §4 budget's own readings (quota, this app's cache, usable space) are live
    measurements and are **not** adjusted; only `Σ'` and `free'` are credited. Where that leaves a file
    running although releasing the copies would admit it, the clock errs towards ending the file, not
    towards keeping it.
  - An impossible or unrepresentable reading keeps the clock **running**: nothing in progress, a
    negative number, more in-progress offers than live ones, more of their bytes than `Σ`, or
    `free + b` past the largest representable value.
- **The clock runs** otherwise: the file would still be refused with every in-progress copy released.
  That covers waiting on offers **nobody has answered yet**, a **missing, stale or impossible reading**
  that the paused case does not bypass, and free space that is short for reasons outside this app.
- **Start, pause, resume.** It starts running when the file first enters *waiting for room*. Each
  evaluation sets it running or paused until the next one. A pause keeps the time already counted and
  a resume continues from it. It is **never reset** while the file waits, including between an
  unknown-size attempt and its retry (§14, reason (c)). It is measured on the monotonic clock
  (`elapsedRealtime`), so a wall-clock change neither ends nor extends it.
- **How it ends:**
  - **10 minutes of running time** (PROVISIONAL, development only) → **Not sent — waited too long
    for room on this phone.** Ten minutes matches the unanswered-offer lifetime, so a file stalled
    behind unanswered offers outlives them.
  - **A wall-clock ceiling of 60 minutes** from entering *waiting for room*, paused or not
    (PROVISIONAL, development only) → the same *Not sent* line. It exists because a receiving offer
    that trickles one byte every 29 s never trips the 30 s rule. With Path S sizes and the §4 budget,
    no healthy queue should reach it.
  - Otherwise the file leaves waiting because it is **prepared**, or it ends by the events below.
- **What the person sees** (§13.1): while paused, *Waiting for {Mac} to finish an earlier file.*;
  while running, the existing waiting line. The row never shows a countdown.

**Build status, 2026-09-28 (development only, still PROPOSED, values PROVISIONAL, uncommitted):** built as
written in `ShareManyQueue.StallClock` and `tickLocked`, on an injected monotonic clock, and tested with
synthetic time only (`docs/testing.md` → *Stage 2 hardening*). The text above was implementable without a
contradiction; five places needed a reading, each chosen and pinned by a test. **All five are accepted by
the owner (2026-09-28) for development testing only — not as production behaviour.** The 10-minute limit
and the 60-minute ceiling stay PROVISIONAL (§20.6). When `Σ' > 0` the hypothetical pause check does **not**
invent quota or usable-space readings: the §4 readings stay as measured, and only `Σ'` and `free'` are
credited.
1. **Decided by the owner, 2026-09-28: a released copy's bytes are credited to `free'` as well as taken
   from `Σ'`**, in the hypothetical only (the bullet above). The first build kept `free` unchanged, and a
   file whose only obstacle was the space an accepted copy occupied (`s + M(s)` = 300 MiB + 2,000 B,
   300 MiB free, a 4,000 B accepted copy) expired at 10 minutes; it now pauses, is admitted on the measured
   numbers once that offer ends, runs again if free space falls so that the release would no longer be
   enough, and fails at once as *no space* if even every held copy would not be. The §4 readings are not
   adjusted when `Σ' > 0`.
2. **A limit is checked before the same evaluation's admission.** A file whose 10 minutes ran out
   between two evaluations ends, even if it would have been admitted at that evaluation (≤ 5 s early).
3. **Its own copy attempt is not waiting.** Between an unknown-size attempt 1 and its retry, the copy's
   own time is not added to the running total (the file was not waiting), but it does count towards the
   60-minute ceiling, which runs from the first entry into waiting. The running total is never reset.
4. **"Wall-clock ceiling" is measured on the monotonic clock**, as the bullet above requires of the
   stall clock, so a clock change neither ends nor extends it. "Wall-clock" is read as *paused or not*.
5. **Reason (b) keeps its own line** (*{Mac} already has 10 files …*) whether paused or not; the paused
   line replaces only the (a)/(c) line.
An in-progress reading that cannot be true (more accepted offers than live ones, or more of their bytes
than `Σ`) keeps the clock running.

**It also ends, as Not sent,** when:
- the screen closes (§11);
- the person presses **Stop preparing** (proposed, §20);
- the session ends. On reconnect nothing resumes, exactly as for offers (§8).

## 13 · States and wording

`{Mac}` is the connected Mac's name. Where a single-file string exists in `ShareToMacCopy.kt`, the row
**reuses it word for word**, so one file shared alone and one file in a selection read the same.

### 13.1 · The phone's per-file row

| State | Row label | Detail line | What exists |
|---|---|---|---|
| not started | *Not prepared yet* | — | nothing |
| preparing | *Preparing…* | *Copying it privately on this phone: 1.2 MB of 3.4 MB.* (no "of" when the size is unknown) | a private partial |
| waiting for room | *Waiting for room* | stall clock paused (§12): *Waiting for {Mac} to finish an earlier file. Keep this screen open.* Running: *Prepared when an earlier file finishes. Keep this screen open.* — or, for reason (b), *{Mac} already has 10 files from this phone in progress.* | nothing |
| prepared | *Ready on this phone* | *Prepared privately on this phone (3.4 MB). It has not been sent, and nothing is on your Mac.* | the private copy |
| offered | *Waiting for you to accept on {Mac}* | *Offered to {Mac} (3.4 MB). Nothing moves until someone accepts it there; if nobody does, the offer expires in 10 minutes.* | the private copy |
| accepted, queued | *Accepted on {Mac} — waiting its turn* | *It starts on its own when the file ahead of it finishes. Nothing of it is on your Mac yet.* | the private copy |
| transferring | *Sending to {Mac}…* | *Accepted on {Mac}. Sending 3.4 MB; it is not saved until {Mac} has checked it.* | copy + Mac partial |
| all bytes left the phone | *Sent — waiting for {Mac} to confirm* | *All 3.4 MB have left this phone. It is saved only when {Mac} has checked it and says so.* | copy + Mac partial |
| **confirmed Saved** | *Saved on {Mac}* | *{Mac} checked every byte and saved it as "…".* Only on an **acknowledged** `share.saved {ok:true}` | Mac file; copy deleted |
| not confirmed | *Not confirmed by {Mac}* | the existing unconfirmed sentence | copy deleted |
| Mac could not save | *{Mac} couldn't save it* | the existing reason, and the Retry window | copy kept for the window |
| **not sent** | *Not sent* | the reason: each §15 preparation failure, *declined on {Mac}*, *expired*, *withdrawn*, *stopped on {Mac}*, *{Mac} disconnected*, *the prepared copy was lost*, *the share screen closed before it was prepared*, *waited too long for room on this phone* | nothing on either side |

- **Only one label says "Sent", and only after every byte has left the phone.** Offered, accepted and
  queued files are **never** called sent.
- The **Saved** label requires the acknowledged verdict, exactly as for one file.
- **Withdraw** stays per file, on its own row (the single-file sheet's action), while the screen is
  open.

### 13.2 · The summary line

It counts facts, in this fixed order, and omits zeros:

*3 saved on {Mac} · 1 not confirmed · 1 sending · 1 accepted, waiting its turn · 2 waiting for you to
accept · 1 waiting for room · 1 not sent*

- It **never** says *all saved* unless every file in the selection is *Saved on {Mac}*.
- It **never** counts an offered, accepted or queued file as sent.

### 13.3 · The notification — proposal only, **not approved, not to be implemented yet**

- **When:** posted only if the review screen closes while at least one file was **never offered**. If
  every file was offered, the Mac carries their state and no notification is posted.
- **Text:**
  - Title: *Not every file was offered to {Mac}*
  - Body: *2 of 5 weren't prepared before the share screen closed, so {Mac} never saw them. 3 were
    offered and are waiting for someone to accept them on {Mac}. Share the others again to send
    them.*
- **Rules:**
  - It never uses "sent" for an offered file.
  - It names **no file**.
  - Its lock-screen version carries no counts or names.
  - It is not updated later with transfer progress; that stays on the Mac.

### 13.4 · The Mac

- **Unchanged from §2:** one window, one card per offer, individual **Accept** and **Decline**, and
  the §9 definition of *Saved on this Mac*.
- **New, display only:** cards sharing a `group.id` get a header that counts facts —
  *"5 files from SM-S938B · 1 saved · 2 waiting · 1 declined"*.
  - Cards arrive over time, and the header counts only the offers that have arrived. It **never**
    waits for `count`, and never shows a placeholder for a file that was not offered.
  - If offers sharing an `id` disagree on `count`, the cards are shown **without** a header.
- **There is no Accept all, and no Decline all.**

## 14 · Unknown sizes: finite, and nothing left behind

Admitted **file by file** (owner, 2026-09-26). An unknown size never refuses a selection.

1. **At its turn, if `Σ = 0`:** one copy under the single-file rule, bounded by
   `ShareStaging.limit(free)`. Reaching that limit is a **failure**: *Larger than this phone can
   prepare right now*, with the limit. **No retry.**
2. **At its turn, if `Σ > 0`: attempt 1**, bounded by `min(Bq, Bs)` (§4). If the copy reaches that
   bound, or a check during the copy refuses:
   - the copy stops, and **its partial is deleted** (`ShareStaging.copy` deletes on every
     non-success);
   - **then the absence is verified**: no `<attemptId>` file left in staging, checked as regular
     files with links not followed, the `ShareHeldCopies` way. **Only after that** does the file
     become *waiting for room* for **attempt 2**;
   - if the absence cannot be verified, the file **fails** (*Couldn't clean up the partial copy on
     this phone*) with **no retry**. The staging sweep at the next start is the backstop.
3. **Attempt 2 — the only retry:** runs only when `Σ = 0` and no copy is running, under the single-file
   rule. Reaching that limit is the same failure as (1). **There is no attempt 3.**
4. **A known size whose copy grows past its bound** (the provider under-reported it) follows the same
   path as (2)–(3).
5. **A retry needs the screen alive**, because it reads the shared URI (§11). If the screen closes
   first, the file is *Not sent — the share screen closed before it was prepared*.

## 15 · One file's failure, and the rest

**A single file's failure never ends, withdraws or blocks another file.**
- Its partial is deleted, it leaves `Σ`, and that release is itself a §12 retry trigger, so it can
  **unblock** a waiting file.
- Files already offered are untouched. The failure shows on its row and in the summary.

**Per-file failures, and the words:**

| Cause | Row detail |
|---|---|
| provider refused the open, or the metadata query | *Sidekick couldn't open this file. The app that shared it may not allow it.* |
| read failed part-way (`SourceReadFailed`) | *Reading stopped part-way — access ended or the file changed. Nothing was sent.* |
| too large even with every held copy released (§12) | *Not enough space on this phone to prepare it: needs X, Y free.* |
| unknown size past the single-file limit (§14) | *Larger than this phone can prepare right now (limit X).* |
| write failed (`WriteFailed`) | *Couldn't write the prepared copy on this phone.* |
| partial not verified deleted (§14) | *Couldn't clean up the partial copy on this phone. Sidekick won't try this file again from this screen, and nothing of it reached {Mac}.* (second sentence added 2026-09-27, development only, for review) |
| name or type out of rule (`OUT_OF_RULE`) | the existing single-file sentence |
| declined by the Mac, per file (`insufficient-space`, `folder-unavailable`, …) | the existing single-file sentence for that reason |
| lost after it was offered (`staging-lost`) | *The copy prepared on this phone changed or disappeared. Share the file again.* |

**Selection-wide ends.** These affect every file **not yet offered**, and never an offered one, except
where the session itself ends:
- the screen closes (§11);
- **Stop preparing** (proposed);
- the stall clock or its ceiling (§12), which apply per file;
- **the session ends** — then offered files also end under the unchanged version-2 rules (*{Mac}
  disconnected*, or *Ended with the connection* on the Mac).

**Refusing the whole selection, before anything is read or copied:**
- more than 10 files: *Sidekick sends up to 10 files at a time — you selected 14.* Never truncated;
- item *n* is a folder, or not a `content:` URI: *Item 3 can't be sent (a folder).*;
- another share is still preparing on this phone: the existing `ANOTHER_IN_PROGRESS` sentence;
- **more than one file while the session negotiated version 2:** *{Mac} can receive one file at a time
  from this phone. Update Sidekick on your Mac to send several at once.*

**Not a refusal:** no Mac connected. The list shows and **Send N files** stays disabled until a Mac
connects, as the single-file sheet does today. **One file** in a `SEND_MULTIPLE` is a single-file
share: the version-2 rule and the single-file wording, at any version.

## 16 · Hardware status, corrected (`docs/testing.md` → *Stage 0 corrections*)

| Behaviour | On the SM-S938B |
|---|---|
| 30-second held-copy check ends a **waiting** offer whose copy is gone | **observed**, 2026-09-26 14:37:30.476 — 3.1 s after the rename; the Mac got `share.cancel … staging-lost` 27 ms later |
| Mac **main-window card** wording for a lost copy | **observed**, read by the owner on the device |
| **Receive-window** wording for a lost copy | **not observed** — the window closed 8 s after the cancel, unread |
| **Accept-time check on a lost copy** | **not observed** — no Accept was sent. At 14:13 the same check passed on an **intact** copy, which shows it does not block a good file, not that it catches a lost one |
| The receive window's card content **before** an Accept | **not observed** — the 14:13 readback was taken after the Accept at 14:15:02 |
| Defect 155 (a Decline during an Accept's check) | fixed in `676c5f2`. **In the Mac dev app running since 2026-09-26 12:53:45** (pid 93018, `dist` built from `f71285b`), **not produced on hardware** |
| `SEND_MULTIPLE` grants from Gallery or My Files | **not measured** (§11) |

**Owed as Stage 1–2 hardware gates:**
1. the receive-window lost-copy wording;
2. an Accept on a lost copy, answered `NOT_FOUND` with nothing pulled;
3. every card read **before** its Accept;
4. the §11 `SEND_MULTIPLE` grant readings.

## 17 · Contract changes C1–C7 (the text is `docs/protocol.md` → Version 3; all still PROPOSED)

| # | Change |
|---|---|
| C1 | Rule 4, phone half: the fixed cap `C` is replaced by the §4 per-copy budget. `Q` is described as the platform's eviction threshold, read live, **not a guarantee**. Values are marked PROVISIONAL, development only. The single-file rule is unchanged, and it governs any file alone. From the single-file sheet an extra copy the budget refuses is **refused with the measured limit and Try again**, never left waiting (decision B) |
| C2 | New rule 5, phone behaviour only, no new message: review before copying; copies one at a time; each offered when ready; waiting for room with its triggers, order, stall clock (paused while only in-progress offers hold the room; 10 minutes running, 60-minute ceiling — PROPOSED for review) and ends (§12); files never offered produce no traffic; leaving does not withdraw offered files |
| C3 | `share.offer` may carry `group {id, index, count}` at version 3 only. It is validated, and a malformed value is declined `malformed-offer`. It is display only and authorises nothing; the Mac never waits for `count`; a `count` mismatch within one `id` means no header |
| C4 | At version 3 `busy` means the session already holds 10 live offers. The phone checks its own limit first; a `busy` decline of a selection's file sends it back to waiting for room, under the same cap |
| C5 | Rule 3: the 60-minute backstop is **approved for development only**; the production value is open |
| C6 | Negotiation: sending several files needs `share.file` 3. At 2 a selection of more than one file is refused by the phone; a `SEND_MULTIPLE` of one file is a single-file share at any version |
| C7 | Development advertisement of `share.file 3` (§18), written under Version 3 → *Negotiation*. Production advertisement stays at 2 on both sides |

**No new `share.cancel` reason and no new message type.**

## 18 · What stays exactly as it is, and how the development switch cannot leak

**Single-file, version 2, unchanged:**
- `ShareToMacActivity`, its `SEND` filter, `ShareIntake` and the sheet's wording are **not edited**.
- `ShareAdmission.forCopy` already reduces to `ShareStaging.preflight` below version 3 or with `Σ = 0`.
- Stage gates require the existing single-file suites to pass **with their files unchanged**:
  `ShareToMacFlowTest`, `ShareToMacCopyTest`, `ShareManifestTest`'s `SEND` cases, `ShareOfferV2Test`,
  `ShareOfferBusyTest`, `ShareOfferStagingLostTest`, and the Mac's version-2 cases in `share.test.ts`.

**Manual approval per file, no Accept all:**
- At version 3 the Mac holds **every** offer for a person's click. The allowlist that auto-accepts
  synthetic probes exists only under the synthetic-only development gate, which never coexists with
  `share.ask`.
- `group` authorises nothing. An Accept acts on one `offerId`, and a test asserts that deciding one
  card changes no other card's state.

**The version-3 development switch — built in Stage 1 (2026-09-26), development only, not yet used on a device:**
- **Phone:**
  - It is armed only by a debug-source-set activity (`app/src/debug`), exported only behind
    `android.permission.DUMP`, like `ShareDevV2Activity`. A release build does not contain it.
  - The arm is one in-memory flag, consumed by **one** trusted handshake and cleared at every process
    start — the `ShareDevGate` pattern.
  - `Extensions.advertised` returns `share.file 3` only when the build is **debuggable** (read at
    runtime from `ApplicationInfo.FLAG_DEBUGGABLE`) **and** the flag was armed for this handshake.
  - Two independent fences, and `PHONE` is not edited.
- **Mac:**
  - The `shareV3` debug switch (`CONNECTSUITE_DEBUG_SWITCHES=shareV3`; this Mac's switches are an environment
    variable, not a command-line flag) is honoured only when `app.isPackaged` is **false** — the same check that already
    keeps `shareV2Activation` out of packaged builds.
  - It is also honoured only while `share.ask` is active and the synthetic-only gate is closed, so the
    receiver stays *Ask for every offer* with an empty allowlist.
  - A packaged build ignores the switch and logs that it refused it. `MAC_EXT` and
    `SHARE_PRODUCTION_READINESS` are not edited.
- **Tests that would pin it:**
  - the arm activity is in the debug manifest, absent from `main`, and absent from the **merged
    release manifest**;
  - `advertised` is 2 when unarmed, when armed but not debuggable, and on the handshake after an armed
    one;
  - the Mac is never 3 when packaged, or without `share.ask`;
  - negotiation fixtures 3+3 → 3, 3+2 → 2 and 2+3 → 2, read by both sides.
- **Both sides log the advertised version on every handshake**, so a leak would be visible in the
  first line of a session.

## 19 · Stage gates, and the actions that need the owner

| Stage | Built | Must pass before the next stage |
|---|---|---|
| **0** (this) | documents only | owner review; documentation guards green |
| **1** | the §18 switch; the §4 budget used by `forCopy` at version 3 in debug builds, with readings behind a replaceable source | automated: §18 tests; the budget's boundaries and stale/missing readings; single-file suites unchanged; each new rule red under its own mutation. **Hardware:** §10's three sequences, plus §16 owed readings 1–3 |
| **2** | `ShareManyToMacActivity`, the review screen, `ShareBatch` wired, §12 waiting, §14 retry, §15 failures | automated: `SEND` vs `SEND_MULTIPLE` routing; 0, 1, 2, 10 and 11 files; a one-file `SEND_MULTIPLE` at version 2; a version-2 Mac with several files; waiting-for-room order, triggers and ends; the stall clock paused behind a queued, a receiving and a checking offer, running behind an unanswered offer and on a missing reading, never reset on resume, and the 60-minute ceiling; unknown size → verified deletion → one retry → failure; one failure beside successes; closing mid-copy; every wording row. **Hardware:** the §11 grant readings first; then 3 synthetic images from Gallery, 1 synthetic PDF and 1 synthetic file larger than that day's measured `min(Bq, Bs)` from My Files, so waiting for room is seen live; every row and every Mac card read **before** each decision |
| **3** | the Mac group header | automated: header counts, `count` mismatch, *all saved* only when all are saved **and confirmed** (§9), re-presenting only when a card newly needs a person. **Hardware:** cards and header read through `scripts/probe.mjs` before and after each decision; each saved file's SHA-256 equal to the phone's |
| **4** | disconnect and restart hardening | automated: disconnect, Mac quit and phone restart with files waiting, queued and receiving. **Hardware:** Disconnect with 2 waiting and 1 queued; ⌘Q mid-queue, then relaunch; one phone process restart by a method named at the time — never `am force-stop` |

**Every hardware stage:**
- **Version 3 is armed for the test only, on both sides** (owner decision C, describing future tests;
  **none is authorised by it**): the phone by the §18 debug arm activity, the Mac relaunched with
  the `shareV3` debug switch (`CONNECTSUITE_DEBUG_SWITCHES=shareV3`). Both sides' logs must show `share.file 3` negotiated before the first step. **Afterwards**
  the phone is disarmed (a process restart clears the arm), the Mac is quit and relaunched **without
  switches**, and both logs must show `share.file 2` negotiated again. That read-back ends the stage.
- Mac free space **≥ 2,048 MiB and stable over 30 s** before starting; stop below 1,024 MiB.
- Synthetic files only.
- Space limits are tested with **injected readings**, never by filling a disk.

**Needs the owner's approval — SM-S938B:**
1. each `install -r`, then restarting `MainActivity` by name, with baseline readings before and after;
2. arming version 3;
3. putting synthetic files on the phone;
4. the Gallery and My Files taps (the owner makes them);
5. renaming a staged copy to simulate a lost copy;
6. revoking media permissions for the Gallery grant rows, if wanted;
7. a phone process restart;
8. any deletion, by exact name after checks.

**Needs the owner's approval — Mac:**
1. `npm run build` into the running app's `dist`;
2. quitting and relaunching the dev app with the `shareV3` debug switch (`CONNECTSUITE_DEBUG_SWITCHES=shareV3`) — **this dismisses the card still visible**;
3. Accept, Decline and Cancel (the owner makes them);
4. Disconnect and ⌘Q;
5. any deletion in `~/Downloads/Sidekick`.

**Both:** every commit. Read-only log, free-space, ledger and `probe.mjs` reads are announced before
they run.

## 20 · Open decisions after Stage 0

**Decided since Stage 0 opened (owner, 2026-09-26):** B, the single-file sheet refuses instead of
waiting (§2); C, arming both sides for any Stage 1 hardware test, then disarming and restoring version
2 (§10, §19). Neither authorises a test.

**Open:**
1. **The §13.3 notification:** approve, change or drop. It is documented only.
2. **The §12 stall clock**, proposed for review: paused while a file waits only on accepted,
   receiving or checking offers; 10 minutes of running time; a 60-minute wall-clock ceiling. All
   development only. *Built 2026-09-28 for review (debug path only); five readings in §12's build status
   need a yes or a change; the first was decided by the owner on 2026-09-28 (`free'` credited), and all five
   were accepted the same day **for development testing only**. Production behaviour and values remain
   open (item 6).*
3. **Stop preparing** (§12, §15): a button that ends every file not yet offered and leaves offered ones
   alone.
4. **Lifecycle option A** (§11) with keep-screen-on while preparing or waiting.
5. **The §11 `SEND_MULTIPLE` grant measurement:** when, and whether the Gallery rows are run with media
   permissions revoked or recorded as confounded.
6. **Production values** for the §4 budget (½, 3% + 1 GiB, 5 s), the 60-minute backstop, and the
   stall clock's 10-minute and 60-minute values — before any production enablement, never by default.
7. **Stage 1 go-ahead.**
