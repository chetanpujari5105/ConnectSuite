# Feature A — several pending files: one receive window with a queue (proposal rev 3, for review)

**Rev 3, 2026-09-25.** Replaces rev 2 (`46bd6d1`). **Nothing is built.** The contract text is
`docs/protocol.md` → *Share → Version 3 (PROPOSED)*. Large files are a **separate** design:
`docs/feature-a-large-file-proposal.md` (Path L). This file is Path S, small files copied privately
before they are offered.

**Approved direction (owner, 2026-09-25):**
- **One receive window**, with a card per file and **individual Accept and Decline**. No extra popups.
- **Stage A** (send another while one waits) comes **before** Gallery multi-select.
- **No group actions** yet.
- **Not approved:** implementation, and the 4 GiB figure.

**What rev 3 corrects in rev 2 and in the committed contract text:**

| # | Was | Is |
|---|---|---|
| R1 | *"a queued offer ends only through the transfer ahead of it … or a cancel"* | a queued offer **does not expire while queued**; it ends only by a cancel from either side, the session ending, or the phone's 60-minute backstop |
| R2 | phone admits while `Σ(staged) + margin(Σ) ≤ free` | **double-counted**: bytes already staged are already missing from `free`. The check is made **once per file, before its copy starts** (§4) |
| R3 | "staged bytes per session ≤ 4 GiB" read as a file limit | a **concurrency cap on Path S private copies only**. A file alone keeps the v2 free-space rule, however large; above what can be copied, the file goes to Path L. **The value is not proposed for locking** (§4) |
| R4 | queued card: *"starts after IMG_1.jpg"* | files are pulled in **Accept order**, so the card names its position: *"Accepted — 2nd in line"* (§5) |
| R5 | Mac reservation: *"sizes accepted and not finished"* | defined precisely, including when each reservation is released (§4) |

---

## 1 · Today (measured from the code): both are blocked

- **Multi-select:** `SEND_MULTIPLE` is not registered, a multi-item `SEND` is refused, and the offer's
  `item` is one object.
- **Another while one waits:** one live offer per session on both sides, visible since `02d95b3`
  (passed on the SM-S938B, 2026-09-25).

---

## 2 · Stage A — what a person sees

- **On the phone:** each file keeps its own sheet and its own offer. A second Send makes a second offer
  unless a §4 limit applies, in which case the sheet says which one, with the numbers.
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

## 3 · Stage B — Gallery multi-select (after Stage A is proven on hardware)

- The phone registers `SEND_MULTIPLE`. The sheet lists the files and their total.
- Files are copied privately **one at a time, in selection order**, and each is offered as soon as it
  is copied. Every file is its own offer, with its own Accept and Decline.
- `group {id, index, count}` is **display only**.
- A selection over a §4 limit is refused **as a whole**, with the limit stated; it is never silently
  truncated.
- A file in the selection too large for Path S makes the sheet send the person to Path L for that
  file; the others proceed.

---

## 4 · Limits and exact byte accounting

| Limit | Proposed | Status |
|---|---|---|
| Live offers per session | **10** | proposed (owner's figure) |
| Files per selection (Stage B) | **10** | proposed; equal to the live limit |
| One file, alone | the v2 rule, unchanged: `s + max(256 MiB, ⌈s/10⌉) ≤ free`, read immediately before its copy starts | proven on hardware; **no fixed size** |
| Private copies held at once (phone, Path S) | a cap `C` on `Σ` of live copies | **value open** — see below |
| Mac reservations | as defined below | proposed |

**Phone accounting (Path S).**
- A file is admitted **when its copy is about to start**, not when it is offered, because the copy is
  what consumes space.
- With `Σ` the total of copies that already exist for live offers (already on disk, so already out of
  `free`), a new file of `s` bytes starts only if **both**:
  1. `s + max(256 MiB, ⌈(Σ + s)/10⌉) ≤ free` — the proven margin, taken over everything held;
  2. `Σ + s ≤ C` **or** `Σ = 0` — a file alone is never refused by `C`, so the cap limits how much is
     held at once, never how large one file may be.
- **A copy stops counting in `Σ` the moment its offer ends** — saved, declined, withdrawn, expired,
  cancelled or ended with the connection — because every one of those ends deletes it (unchanged).
- One copy runs at a time (the existing `ANOTHER_IN_PROGRESS` rule), so two copies cannot race for
  the same space.

**Why `C` exists, and why no value is proposed for locking.**
- Copies live in the app's **cache directory**, which Android may clear under storage pressure; a
  copy cleared that way ends its offer as `staging-lost`.
- **The SM-S938B is already below Samsung's caution line** (22.6 GB usable; caution 27.5 GB, warning
  13.7 GB; `dumpsys devicestoragemonitor`, 2026-09-25).
- The per-app cache quota could not be read without a build: `cachequota.xml` is `system`-only, and
  `dumpsys storagestats` prints nothing.
- **Candidate rule, for your decision:** `C = max(0, usable − warningThreshold − 1 GiB)`. That would
  be **≈ 7.8 GB** on this phone today, and it never stages the phone into its own warning state.
  - The warning threshold is Samsung-specific. Where it cannot be read, fall back to 10% of total
    storage.
  - Or lock `min(C, getCacheQuotaBytes)` after the quota reading, which needs a debug build.

**Mac accounting.**
- **At the offer and again at Accept:** `free ≥ R + size + margin(size)`, where `R` is the sum of
  reservations and margin is the Path S margin `max(256 MiB, ⌈size/10⌉)`.
- **Reservations, per offer:**
  - **queued:** reserves its full `size`, from Accept until it ends or starts receiving;
  - **receiving:** reserves `size − bytes already written to its partial`;
  - **released at once** on saved, saved-unacknowledged (the bytes are now a real file), not saved,
    cancelled, declined, expired or ended.
- **A Retry re-reserves** through the same Accept check. It does not hold space during its window.

---

## 5 · Accepted and queued: consent, privacy, and the window

**Consent wording**, because an Accept now authorises a transfer that may start later, with nobody
watching:
- On a waiting card **while another file is ahead**, the button reads **Accept** and the line above
  it reads *"If you accept, it transfers on its own after the 1 file ahead of it."* The accessible
  name says the same.
- After Accept the card reads *"Accepted — 2nd in line. It starts on its own when the file ahead
  finishes."* with **Cancel**.

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
| queued, backstop | the phone ends an accepted offer whose pull has not begun **60 min** after Accept (`share.cancel{expired}`) | *Expired before it started* |
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
- admission at 1, 10 and 11 offers, the first-file-alone exemption from `C`, and the per-file margin
  over `Σ + s`;
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
| Install | one `install -r` of the Stage A build, same readings before and after; Mac relaunched without switches |
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
