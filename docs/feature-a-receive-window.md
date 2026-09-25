# Feature A — the Mac receive window: safety map, conflicts, and plan

Written 2026-09-25, before any code for the receive window. **Step 1 of the owner's brief** (the
compact receive window, per-device automatic acceptance, real progress, optional sound). It records
what the verified transfer path does today, file by file, so the redesign can move the *surface*
without touching the *path*.

Contract: `docs/protocol.md` → Extensions (`share.ask`) and Share → Version 2. Where this file and
the contract disagree, the contract wins until the change in §4 is approved.

---

## 1 · The transfer path as it stands (Mac side), with the code that holds each rule

| Stage | Where | What it guarantees |
|---|---|---|
| Offer arrives | `main.ts` → `shareReceiver.onOffer` on `MessageType.SHARE_OFFER` | only on the live control socket |
| Validation | `shared/shareOffer.ts` `ShareOfferBook.receive` | field rules, `rootId`, expiry window, one live offer per session, replay refused unanswered |
| Session binding | `share.ts:258` `sessionKey = link.token()` | the offer is held against **this session's token**; `decide` (`share.ts:341`) and `attempt` (`share.ts:387`, `:412`) refuse if the token changed |
| Destination check | `share.ts:566` `destination()` → `downloads.ts:51` `ensureReceiveFolder` + `shareDestination.ts:90` `checkDestination` | folder usable, `size + max(256 MiB, size/10)` free, hard links proven with a ledgered probe; run **at the offer and again at Accept** |
| Decision surface | `renderer/shareReceive.ts` card → IPC `share-decide` → `shareDecision.ts` `handleShareDecision` | page sends `{offerId, decision}` and nothing else; Accept refused unless the main window is visible, not minimised and focused; Decline always honoured |
| Accept | `share.ts:329` `decide` | re-checks version, session and destination; sends `share.respond accept`; nothing is pulled without the phone's `accepted` ack |
| Pull | `share.ts:385` `attempt` → `bulk.ts:566` `pullShareWith` | begin ack must match offer size+digest; bulk socket over TLS 1.3 with the session token; nonce'd partial `.<offerId>.<nonce>.sidekick-share.part` created `wx` and ledgered; 30 s idle timer |
| Verification | `bulk.ts` `complete()` | flushed; on-disk length = received = offered; SHA-256 = offered; not cancelled |
| Publication | `shareDestination.ts:160` `publishExclusive` | hard link to the first free `name (n).ext` (`EEXIST` → next), then unlink the partial. **Never overwrites; no rename fallback** |
| Verdict | `share.ts:442` | `share.saved {ok:true}` only after publication; no ack → `saved-unacknowledged`, file kept, never retried |
| Session end | `main.ts:1346` `onSessionEnded(shareSessionKey)` | live offers become `ended`; a running pull is aborted and its own partial deleted |

**How the TLS session is bound to an offer.** The Mac connects out and pins the phone's certificate
fingerprint against `store.paired.fingerprint` before the handshake is adopted (`link.ts:351-361`).
A mismatch is refused, not retried. The phone's `hello.ack` then issues the session token
(`link.ts`, `session.sessionToken`), and that token is the offer's `sessionKey`. So an offer can
only exist on a socket whose peer presented the pinned certificate, and every later step is refused
when the token changes. The bulk socket presents the same token and the phone binds a share pull to
the offer's session (contract → *The bulk socket is bound to the session*).

**The Mac holds exactly one paired phone** (`store.ts` `paired: PairedPhone | null`: `deviceId`,
`deviceName`, `fingerprint`, `pairedAt`). *Forget* (`main.ts:3087`) sets it to `null` and stops the
link. There is no second-phone path to worry about in this build.

## 2 · What may be shown before Accept, and where each value comes from

| Value | Source | Trust |
|---|---|---|
| Sending phone | **the Mac's own pairing record** (`store.paired.deviceName`), not the offer's `from` | the offer's `from` is text the phone chose; the paired record is what the certificate was pinned to. The card today draws `from`; the window will draw the paired name, and the offer's `from` only if it differs |
| File name | `sanitizeShareName(item.name)` (`shared/shareNames.ts:20`), re-applied in `snapshots()` | sender-chosen; sanitised; always set as `textContent` |
| Type | `item.mime`, validated `type/subtype` ≤ 127 chars | sender-chosen; a label only — it chooses a placeholder glyph, never a handler |
| Exact size | `item.size`, integer | sender-claimed, then **enforced**: more bytes → `truncated`, fewer → `truncated`, different → `checksum` |
| Destination | the Mac's own `ensureReceiveFolder()` result, shown as `~/…` (`shareDecision.ts:74`) | the Mac's; the page never sends it back |
| Preview | **none exists before transfer** | the protocol has no bounded preview for a share offer (`fs.thumb` refuses `share:` roots by contract). So the window shows a type placeholder and says nothing about a thumbnail |

## 3 · How a saved file is identified for Open / Reveal without trusting the page

Today `pullShareWith` resolves `{ ok: true, savedAs, path }` (`bulk.ts:677`) and `ShareReceiver`
keeps only `savedAs`. The plan: at publication, the receiver records a **publication record** in
main-process memory — `{ path, dev, ino, size }` from an `lstat` of the published path taken
immediately after the link. The page asks `share-open` / `share-reveal` with an `offerId` alone
(same parser shape as `share-decide`: exactly one key, the id pattern). The main process looks up the
record, `lstat`s the path again, and acts only if it is still a regular file (not a link) with the
same device, inode and size. Anything else answers *"That file has moved or changed since it was
saved"* and does nothing. The path never crosses IPC in either direction.

## 4 · Conflicts with the current contract and rules — what needs the owner's decision

### 4.1 Automatic acceptance contradicts `share.ask` — **a contract change, not built, awaiting approval**

`share.ask: 1` in the Mac's `hello` is a promise *to the phone*: *"every ordinary version-2 offer on
this session is held on the card for a person's Accept; nothing accepts it automatically"*. Share →
Accept adds *"There is no automatic acceptance in any build that ships."* The phone enables ordinary
Send on the strength of that promise. A per-phone automatic-accept setting makes the promise false
for the one phone it is granted to, while the Mac keeps advertising it.

**Proposed change (not applied):** reword the Mac's half of `share.ask: 1` to *"every ordinary offer
is decided by a person on this Mac: either at the offer, or by a standing grant this person made for
this paired phone's certificate on this Mac, which is off by default and revocable"*, and replace the
Accept sentence with the grant's exact bounds (below). No wire change: no new message, no new field,
no version bump — the phone's behaviour is identical because it never learned *how* the Mac decides.
The alternative, a separate ext key (`share.auto`) so the phone can tell, was considered and not
recommended: the phone has nothing to do differently, and a key nobody reads is decoration.

**The grant, as it would be built:**

- stored as `{ fingerprint, deviceId, pairedAt, grantedAt }` — matched on **all three** of the
  pairing record's `fingerprint`, `deviceId` and `pairedAt`, and on the live session's peer
  fingerprint (a minimal read-only accessor on `LinkClient`), so a re-pair of the same phone
  (new `pairedAt`, and a new fingerprint after a reinstall) revokes it by construction. *Forget*
  also clears it explicitly;
- applied only where `receiverMode` is `share.ask` (production), **never** in the synthetic-only
  development mode, and never through the development allowlist;
- falls back to asking (never auto-saves) when: the grant does not match; the size exceeds the
  auto-accept limit (proposed **2 GiB**); free space after the file would fall under
  `spaceNeeded(size) + 5 GiB`; the destination check is anything but supported; a copy with the same
  SHA-256 was already saved this run; or another auto-accept from this phone is still receiving;
- offered only in Settings → Security (with a confirmation sheet), and after a manual Accept on the
  completed window as a secondary link — never pre-checked.

**Nothing in this list is built** until the owner approves the contract wording.

### 4.2 "The card is the only decision surface" — changed by the brief itself

Share → Accept and `shareDecision.ts`'s header say the card is the only decision surface and a
hidden window leaves an offer to expire. The brief replaces that with a Sidekick-owned utility window
that appears without focus. This is a Mac-UX statement, not a wire rule, and the owner's brief is the
decision; the contract sentence is updated in the same commit that builds the window. What is kept:

- **no** macOS Notification Center alert and **no** Dock bounce (the brief repeats this);
- the window is shown **inactive** (`showInactive`) — it never takes key focus on arrival, so typing
  elsewhere cannot press Accept — and at the normal window level, never `alwaysOnTop`, never on all
  workspaces. A full-screen or presentation app's Space is left alone; the window waits on the
  desktop Space and the offer expires honestly if nobody looks;
- the Accept gate stays: honoured only from a visible, non-minimised, **focused** decision window.
  `acceptFirstMouse` stays off, so the first click on an inactive window only focuses it;
- **one decision surface per offer:** the utility window. The in-window card becomes a status row
  with *Show* (reopens the window) and loses its Accept/Decline. Closing the window is *not* Decline:
  the offer stays pending and says so on the card.

### 4.3 The native-notifications rule

`nativeNotifier.ts` posts phone notifications through Notification Center. The receive window does
**not** go through it and adds no `Notification` for shares; `phase-7-state.md` §5 remains about
phone notifications. No conflict once §4.2 is recorded.

### 4.4 Sounds — "interface sounds" is on the handoff's *unbuilt* list

`docs/sidekick-figma-handoff.md` §9 lists *interface sounds* as unbuilt, not cut. An opt-in setting
(default off) is within that. **Wall:** Electron exposes no reading of macOS Focus / Do Not Disturb,
and an app playing its own audio is not silenced by Focus the way a notification sound is. So the
sound setting cannot honestly promise to respect Focus; see §6.

### 4.5 Progress — no protocol change needed

The phone sends no progress messages and none are needed: `pullShareWith` already counts
`received` per frame (`bulk.ts:713`). The plan exposes that count through an `onProgress` callback,
coalesced to at most ~8 updates a second, and the receiver carries it as `receivedBytes`. It is
**receiver-measured bytes written to the partial**, not the phone's claim, and nothing is animated
beyond the last measured value.

### 4.6 Mac-initiated Cancel — within the contract, one sentence stale

`share.cancel` as a Mac → phone request is specified and the phone handles it in every live state,
stopping a live pull (`ShareOffer.cancelFromMac`). The contract says *"A Mac of this revision never
sends the request — it has no card to cancel from"*; that sentence changes with the Cancel button.
Cancel is refused once publication has begun (the receiver's existing rule: a cancel during
publication cannot unpublish).

## 5 · Status, 2026-09-25

| Step | State |
|---|---|
| 1 map | this file, `f9e86c9` |
| 2 receive window | **built**, `7fdce44` |
| 3 automatic acceptance | **not built — waiting for the owner to approve §4.1's contract wording** |
| 4 progress and completion | **built**, `5046017` |
| 5 sound | **not built** — §6: it cannot honour Focus / Do Not Disturb, which the brief requires |
| 6 verification | automated + harness, `docs/testing.md` → *Feature A receive window*; no hardware transfer yet |

## 5 · The build order that follows from this

1. **This map** (this commit).
2. **The receive window**: `main/shareWindow.ts` (the Electron half: create, `showInactive`, place,
   close ≠ decline), `shared/shareWindowModel.ts` (the pure model, tested), `renderer/share-window.*`.
   IPC `share-decide` accepts the share window's `webContents` and applies the same gate to it.
3. **Automatic acceptance** — **stopped here for approval of §4.1.**
4. **Real progress and completion**: `onProgress`, `receivedBytes`, `ShareReceiver.cancel`, the
   publication record, `share-open` / `share-reveal`, a post-publication thumbnail from
   `nativeImage.createThumbnailFromPath` (QuickLook; bounded by a timeout; images and video posters
   alike) — requested only in state `saved` / `saved-unacknowledged`.
   **Copy is left out of v1**: the app's clipboard feature carries text, and there is no tested
   file-copy semantics to reuse.
5. **Sound**: see §6.

## 6 · Sound — what can and cannot be honest

Two short tones synthesised with WebAudio in the receive window (Sidekick-original: no file, no
sample), one for *a request needs you*, one for *verified and published*. Off by default, one
setting. Played at most once per 4 s whatever arrives, never for a sender-side `done`, a failure, a
cancel or `saved-unacknowledged`, and never for an offer that was already live before a reconnect.
**It cannot read Focus / Do Not Disturb**, so the setting's own copy says so rather than claiming
to respect it.
