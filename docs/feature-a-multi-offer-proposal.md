# Feature A — several pending files at once: a bounded design (proposal, not built)

Written 2026-09-25 after the silent second Send (`docs/testing.md` → *The silent second Send*).
**Nothing here is implemented and `docs/protocol.md` is unchanged.** The immediate fix (`02d95b3`)
keeps the one-live-offer rule and makes it visible; this is what would replace the rule.

## 1 · What changes for a person

- **One receive window, several cards.** New offers become cards in the same Sidekick window, newest
  pending on top; never a second floating window. The window grows to its 560 px cap and then scrolls.
- **Each pending file has its own Accept and Decline** and its own truthful status (waiting, queued,
  receiving with its own byte count, checking, saved, not saved, expired, withdrawn).
- **One accepted file transfers at a time.** An accepted file behind another shows *Queued — starts
  after "IMG_1.jpg"*, with Cancel. No card shows progress it is not making.
- On the phone, each file keeps its own Send to Mac sheet and its own offer; Send is refused, with the
  reason, only at the limits below.

## 2 · Limits (both sides enforce them; neither trusts the other's)

| Limit | Value | Where | At the limit |
|---|---|---|---|
| Live offers per session | **5** | phone (`admit`) and Mac (`ShareOfferBook`) | phone: Send disabled, *"Your Mac already has 5 files waiting"*; Mac: decline `busy` |
| Staged bytes per session, phone | **min(4 GiB, free − 1 GiB)** summed over live offers | phone | Send disabled with the numbers |
| Reserved bytes per session, Mac | sum of accepted-not-finished sizes, added to `spaceNeeded(size)` at every Accept | Mac destination check | decline `insufficient-space`, card says so |
| Concurrent share pulls per session | **1** | Mac queue; phone refuses a second with `BAD_REQUEST` as defence | — |
| Queue wait after Accept | **15 min** | Mac | Mac sends `share.cancel{user}`; card: *"Not started in time — nothing saved"* |

## 3 · Protocol changes (exact)

1. **`share.file: 3`** — a new extension version meaning *this peer allows up to 5 live offers per
   session and serialises pulls*. Negotiated by the existing rule `min(mine, theirs)`, so a 2-peer
   keeps one live offer and nothing about version 2 changes. `share.ask` is unchanged and still
   required for ordinary Send. New fixture rows in `docs/fixtures/ext-negotiation.json` and
   `share-ordinary-send.json` (3+3 → 3; 3+2 → 2).
2. **`share.offer`** — payload unchanged. Validation: `busy` now means *the session already holds 5
   live offers* at version 3 (still *one* at version 2).
3. **Accepted offers stop expiring at `expiresAtMs`.** Today an offer is live until its 10-minute TTL
   whatever its state; with a queue, a file accepted at minute 9 behind a large one would expire
   mid-queue. At version 3 an **accepted** offer is bounded instead by the Mac's 15-minute queue wait
   (above) and by the session. `Offered` offers keep the 10-minute TTL exactly.
4. **`share.respond`, `share.cancel`, `share.saved`, `fs.transfer.begin` on `share:<offerId>`** —
   unchanged, already per offer. The session binding of the bulk socket, the per-attempt nonce'd
   partial, the ownership ledger, exclusive hard-link publication, and *Saved only on the receiver's
   verdict* are untouched — each is already keyed by `offerId`/`transferId`.
5. **Disconnect** — unchanged: every live offer of the session ends without a message and each staged
   copy is deleted. The difference is only that it is several.

## 4 · State-machine changes

**Phone (`ShareOffer` / `ShareFeature`).**
- `busyWith(held, key)` becomes `admit(held, key, negotiatedVersion, bytes, free)`, returning
  `Admit` or `Busy(TooMany | TooManyBytes | …, blocking offers)`; at version 2 it is exactly today's rule.
- `Accepted` gains no new state; its TTL expiry transition is skipped at version 3 (item 3 above).
- A second concurrent `beginPull` for another offer on the same session is refused (defence only).
- `ShareFeature.offers` is already a map by `offerId`; the staging sweep already skips
  `liveOfferIds()`. The sheet's Busy view names the blocking file(s) as it does now.

**Mac (`ShareOfferBook` / `ShareReceiver`).**
- `ShareOfferBook` counts live offers per session against the negotiated limit.
- New receive state **`queued`**, between the phone's `accepted` ack and `fs.transfer.begin`. A single
  in-process pull slot; `attempt()` takes it, and the next queued offer starts when it frees. Cancel,
  a phone cancel, and session end each release a queued offer without pulling.
- The Accept re-check reserves space for everything queued or receiving (table above).
- The receive window's subject becomes a list: `newlyNeedingAttention` already tracks offers
  individually; the page gains a card per offer, keyed by `offerId`, rebuilt without moving focus.
  Escape declines only the focused card's waiting offer.

## 5 · Tests it would need before any device run

Negotiation fixtures (both sides); `admit` at 1, 5 and 6 offers and at the byte limit; a queued offer
cancelled, expired-by-queue-wait, and ended by disconnect, each deleting its staged copy; two accepted
offers pulled strictly one after the other with their own partials and ledger entries; space
reservation refusing the second of two offers that fit alone; the window drawing three cards with
independent states. Then a synthetic hardware run: three generated files, one declined, one cancelled
while queued, one saved.

## 6 · Out of scope, and why

Parallel pulls (bandwidth is shared anyway, and one partial at a time keeps the ledger and space
reservation simple); a batch offer carrying several items (the contract's `item` is deliberately one
object); automatic acceptance (still waiting on the §4.1 decision in `docs/feature-a-receive-window.md`).
