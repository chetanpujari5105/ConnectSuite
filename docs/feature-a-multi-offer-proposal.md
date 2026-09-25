# Feature A — several pending files: one receive window with a queue (proposal rev 2, for review)

Rev 2, 2026-09-25. Replaces rev 1 (`f6e4ea2`). **Nothing here is built.** The contract text this
proposes is in `docs/protocol.md` → *Share → Version 3 (proposed)*, marked as not implemented; nothing
advertises `share.file 3`.

**Owner decisions already taken (2026-09-25):**
- **One receive window** with a visible queue: a card per file, each with its own Accept and Decline.
  **No additional popup windows.**
- **Build order:** stage A, *send another while one waits*; then stage B, Gallery multi-select.
- **Accept all / Decline all are deferred** until the per-file flow is proven on hardware.
- A **proposed** limit of 10 pending files, and a byte cap that is justified here before it is locked.

---

## 1 · Today, measured from the code (why both are blocked)

| Question | Answer | Where |
|---|---|---|
| Several images in one Gallery share | **No.** The manifest registers only `SEND`; a `SEND` carrying more than one item is refused `MORE_THAN_ONE`; the offer holds one `item`, "never an array" | `AndroidManifest.xml`, `ShareIntake.decide`, `docs/protocol.md` |
| Another image while one waits | **No.** One live offer per session, on the phone (`ShareOffer.busyWith`) and on the Mac (`ShareOfferBook` → `busy`); since `02d95b3` the refusal is visible | `ShareFeature.offerStaged`, `shared/shareOffer.ts` |

---

## 2 · Stage A — send another while one waits

**Person-visible behaviour**
- **On the phone:** each file keeps its own *Send to Mac* sheet and its own offer. A second Send
  makes a second offer; it is refused only at the limits in §4, with the numbers.
- **On the Mac:** the receive window lists one card per offer, in the order the offers arrived. Each
  card has:
  - name, type, exact size and destination, and a type glyph — no preview before Accept;
  - its own Accept and Decline, then its own truthful state (below).
- **One transfer at a time.** Accepted files transfer one after another, in the order they were
  accepted.
- **Window behaviour is unchanged:** it appears without focus when a card needs attention, never
  above a full-screen Space, never through Notification Center.
- **Accessibility:** Escape declines only the focused card's waiting offer; the tab order runs card
  by card, Decline before Accept.

**States a card can show**, each a fact rather than a guess:

| State | Words (Mac) | What exists where |
|---|---|---|
| waiting | *Galaxy wants to send a file* | phone: private copy. Mac: nothing |
| queued | *Accepted — starts after "IMG_1.jpg"* | phone: private copy. Mac: nothing yet |
| receiving | *n of N · p%* (never 100%) | phone: private copy. Mac: its own nonce'd partial |
| checking | *All bytes received — checking before saving* | Mac: partial being verified |
| saved | *Saved on this Mac* · *the phone confirmed it* **or** *confirmation to phone unknown* | Mac: published file. Phone: copy deleted |
| not saved | the reason; *Try again* while its window is open | Mac: nothing kept. Phone: copy kept for the retry window |
| declined / expired / withdrawn / cancelled / ended with the connection / refused | its own word, never "Declined" for anything a person did not decline | nothing kept on either side |

---

## 3 · Stage B — Gallery multi-select (after A is proven)

- **Registration:** the phone also registers `SEND_MULTIPLE`, and the sheet lists every selected
  file with its size and the batch total.
- **Offers:** each file is staged privately, **one at a time in selection order**, and offered as
  soon as it is staged. The first card can be decided while later files are still being copied.
- **Every file is its own offer,** with its own Accept and Decline. The offer carries an optional
  `group` so the Mac can show "3 of 5 from one share" — **display only, never an authority**: no
  decision is ever made per group in this stage.
- **Over the per-batch limit** (§4) the sheet refuses the whole selection and states the limit.
  Android cannot deselect inside a share, so the person re-shares fewer files. A batch is never
  silently truncated.

---

## 4 · Limits — the proposal, and what each is for

| Limit | Proposed value | Why this and not another |
|---|---|---|
| Pending offers per session | **10** | owner's figure. It bounds the Mac window (10 cards scroll inside the 560 px cap), the phone's live-offer map and the number of private copies |
| Files per batch (stage B) | **10** | = the pending limit. Picking one file past what the Mac can hold would be a guaranteed refusal |
| Bytes per file | **unchanged from v2**: `s + max(256 MiB, ⌈s/10⌉) ≤ free` on the phone (`ShareStaging.limit`), and `size + max(256 MiB, ⌈size/10⌉)` free on the Mac at the offer and at Accept | already proven on hardware; it guarantees the copy never fills the phone or the Mac |
| Staged bytes per session (the batch cap), phone | **the same formula over the sum:** `Σs + max(256 MiB, ⌈Σs/10⌉) ≤ free`, **and** at most **4 GiB** | see below |
| Reserved bytes, Mac | every accepted-not-finished size is reserved: Accept needs `free ≥ reserved + spaceNeeded(size)` | two files that each fit alone must not both be accepted into a disk that holds one |

**Why a batch cap at all, and why 4 GiB is proposed rather than locked:**
- **The copies are real.** Each staged file is a full private copy, so a batch **doubles its
  footprint on the phone** until each file ends. Applying the proven per-file formula to the sum
  keeps the existing guarantee — the phone is never filled — for a batch as for one file.
- **The copies live in the app's cache directory.** Android may delete cache files under storage
  pressure, apps over `StorageManager.getCacheQuotaBytes` first. A copy deleted that way is handled
  (`staging-lost`, the offer ends, nothing is saved), but a batch that exceeds the quota invites
  exactly that failure part-way through.
  - **That quota has never been read on the SM-S938B**, so 4 GiB is a placeholder, not a
    measurement.
  - The lock is `min(4 GiB, measured cache quota, the free-space formula)`, and the 4 GiB survives
    only if the quota is larger.
- **Throughput is deliberately not the justification.** This repo has no sustained multi-GB
  reading — small files measured 70–904 Mbit/s, and 39.4 Mbit/s for a 571 KB preview today. The
  expiry rules in §6 therefore do not depend on file sizes, so the cap need not either.

**Before the limits are locked into the contract**, two readings, both read-only or synthetic:
1. `getCacheQuotaBytes` for our package on the SM-S938B — a debug-only probe line; the phone is not
   otherwise touched.
2. One sustained synthetic transfer of ≥ 1 GiB, generated bytes only, for a denominator on the time
   a full queue takes. It informs the copy, not the cap.

---

## 5 · Accepted-but-queued: what a person is agreeing to, and what is exposed

- **An Accept is consent to that file's transfer whenever its turn comes.** A queued file starts on
  its own, even if the window was closed or nobody is at the Mac. That is what the Accept meant, and
  the card says *Accepted — starts after "IMG_1.jpg"* with **Cancel** beside it, so the consent is
  visible and revocable until it starts.
- **Nothing of a queued file is on the Mac.** No bytes, no preview, no partial — only the name, type
  and size the offer already showed. The phone holds its private copy.
- **Names are visible on the Mac's screen** to anyone looking at it, as they are for one file today.
  - The window does not appear over a full-screen or presentation Space, and never goes to
    Notification Center, so a screen being shared in a meeting does not show the queue.
  - It is still visible on the desktop. A *hide file names in the receive window* setting is a
    possible later addition and is not proposed here.
- **Logs:** the phone logs no file names (unchanged); the Mac logs a name only for a published file
  (unchanged); no log line carries file contents.
- **Thumbnails** only after verified publication, images and video only (unchanged).

---

## 6 · Expiry — per file, and independent of how big the queue is

| State | Ends when | Words |
|---|---|---|
| waiting | 10 minutes after the phone offered it (the phone's `expiresAtMs`; on the Mac, `min(expiresAtMs, received + 10 min)`) — **unchanged** | *Expired — nobody answered in time* |
| queued | **does not expire while the queue moves.** It ends only if the transfer ahead of it stops making progress: that one is ended by the existing 30-second idle rule, and the queue moves on | — |
| queued, backstop | the phone ends an accepted offer whose pull has not begun **60 minutes** after its Accept (`share.cancel{expired}`) — so no private copy is ever held indefinitely | *Expired before it started* |
| receiving | 30 s with no byte (unchanged) | *The transfer stopped* |
| checking → verdict | the phone treats no `share.saved` within 60 s of its last byte as `unconfirmed` (unchanged) | phone: *Not confirmed*; Mac: whatever it knows |
| not saved | its 5-minute Retry window (unchanged); a Retry joins the **back** of the queue | *Expired* when the window closes |

The TTL of an accepted offer is the one real protocol change here. Today every live offer expires 10
minutes after it was offered, whatever its state. A file accepted at minute 9, behind a large one,
would then expire mid-queue — the queue would destroy consent the person had given.

---

## 7 · Cancellation — per file, never collateral

- **Mac:** Decline (waiting); Cancel (queued or receiving); Give up (not saved, in its window).
  Each sends `share.cancel{user}` or `share.respond decline` for **that offer only**.
- **Phone:** Withdraw on that file's sheet, in any live state — including queued and receiving; a
  receiving file's partial is deleted on the Mac.
- **A saved file cannot be cancelled** on either side.
- **No action ends another file.** Cancelling the receiving file lets the next queued one start;
  declining one waiting file changes no other card.
- Group actions (*Decline all*, *Withdraw all*) are **deferred**, like *Accept all*.

---

## 8 · Disconnect and restart

| Event | Waiting / queued offers | The receiving file | Published files |
|---|---|---|---|
| **Link drops** (Wi-Fi, sleep, out of range) | end on both sides without a message; the phone deletes every private copy; cards read *Ended with the connection — nothing saved* | the pull is aborted; the Mac deletes its own partial | kept. One mid-publication is `saved-unacknowledged`, as today |
| **Mac app quits or crashes** | offers are memory only, so they are gone; the phone sees the session end and deletes every copy | the startup ledger sweep removes the partial, by identity | kept |
| **Phone app restarts or is killed** | the Mac sees the session end, as above; the phone's startup staging sweep deletes every copy no live offer owns (unchanged) | as above | kept |
| **Reconnect** | **nothing resumes or re-offers.** The phone's sheet, if still open, reads *Ended with the connection*, and the person sends again. An offer never survives its session | — | — |

---

## 9 · "Saved" — the exact meaning, per file

- **The Mac's card says *Saved on this Mac* only when all of these hold,** in this order:
  1. every byte of **that** offer arrived;
  2. the partial was flushed;
  3. its on-disk length equals the bytes received and the offer's size;
  4. its SHA-256 equals the offer's digest;
  5. it was published by exclusive hard link under a free name.

  Then, separately: *the phone confirmed it* when the phone acknowledged `share.saved {ok:true}`;
  otherwise *confirmation to phone unknown*.
- **The phone's sheet says *Saved* only on that acknowledged verdict.**
- **No batch or window summary may round these up.** A summary counts facts — *3 saved · 1 declined ·
  1 not confirmed* — and never says *all saved* unless every file is saved and confirmed.
- A file saved while other files failed is saved; a failed file is never *Saved*.

---

## 10 · Protocol and state-machine changes (exact) — contract text proposed in `docs/protocol.md`

1. **`share.file: 3`**, negotiated by the existing rule `min(mine, theirs)`: 3 + 3 → 3, 3 + 2 → 2. A
   version-2 peer keeps exactly today's behaviour; `share.ask` is unchanged and still required.
2. **The live-offer limit** at 3 is 10 per session, enforced by both sides. `busy` means *at the
   limit*.
3. **`share.offer`** may carry `group: {id, index, count}` at 3 (stage B) — optional, display only.
   `item` stays one object.
4. **Accepted offers leave the 10-minute TTL** (§6), with the phone's 60-minute backstop.
5. **The Mac serialises pulls:** one share pull per session at a time. The phone refuses a second
   concurrent share pull with `BAD_REQUEST`, as defence.
6. **Mac receiver** gains `queued` and a single pull slot, plus space reservation at Accept.
7. **Phone** replaces `busyWith` with `admit(held, session, version, sizes, free)`: *Admit*, or *Busy*
   with the reason and the numbers. At version 2, `admit` **is** `busyWith`.
8. **Unchanged:** `share.respond`, `share.cancel`, `share.saved`, the share root, the session-bound
   bulk socket, the nonce'd partial and ownership ledger, exclusive publication, Saved only on the
   receiver's verdict, and the `saved-unacknowledged` rules — all already keyed per offer.

---

## 11 · How stage A would be proven, before stage B starts

- **Automated:**
  - negotiation fixtures on both sides;
  - `admit` at 1, 10 and 11 offers and at the byte cap;
  - two accepted offers pulled strictly in sequence, each with its own partial and ledger entry;
  - space reservation refusing the second of two files that each fit alone;
  - a queued file cancelled, ended by disconnect, and expired by the backstop — each deleting its
    copy;
  - the window drawing three cards in three states without moving focus.
- **Hardware, synthetic files only:**
  - three generated files from the SidekickShareTest album: one declined, one cancelled while
    queued, one saved;
  - then a disconnect with two waiting.
