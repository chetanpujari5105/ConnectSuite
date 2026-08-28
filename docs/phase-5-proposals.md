# Phase 5 proposals — for reading, not for landing

Written 2026-08-29, before step 70 has run and before Phase 5 has opened. **Nothing here is
committed to `docs/protocol.md`.** The protocol is the contract; this is the argument for changing
it, kept separate so it can be read, disagreed with, and reverted on its own.

> ### Decisions taken 2026-08-29 — read before implementing
>
> Reviewed and **accepted**:
>
> - **`sms.sent` as an event, ack left alone.** The ack keeps meaning "the radio accepted this".
> - **The delay-before-re-fetch stays rejected**, and stays written down. Three reaches for the same
>   wrong shape is enough.
> - **Bug 6 at 1 MB**, with a separate small header cap, write-side enforcement in `Framing`, no
>   resync, and the denominator on the refusal line.
> - **The package-id rule is codified in `CLAUDE.md`**, alongside the gate rule — not only here.
> - **The `before` cursor is decided now rather than discovered twice.** The decision is written into
>   §1 below; it was the one open question and it is no longer open.
>
> One thing changed since this was written: the unrecorded gap in §1 is now **defect 44**, with its
> own record in `docs/defects.md`, because it shares a symptom with 39 and would otherwise be folded
> into it and half-fixed.
>
> **Still gated on step 70.** Phase 5's first act claims `bulkChannelSink`, and a failed ring must
> not be debugged through a transport change.

Four pieces, all prose:

1. [The protocol decision for defects 30, 32 and 39](#1-the-protocol-decision-for-defects-30-32-and-39)
2. [What survives from v1's `TransferManager`](#2-what-survives-from-v1s-transfermanager)
3. [Bug 6 — frame enforcement on the bulk channel](#3-bug-6--frame-enforcement-on-the-bulk-channel)
4. [Where defect 33 lands in Phase 5](#4-where-defect-33-lands-in-phase-5)

---

## 1. The protocol decision for defects 30, 32 and 39

### The finding that changes the shape of this work: only one of the three needs the protocol

The three were grouped because they looked like one decision about `sms.send`. Reading both sides
says otherwise. **Two of them are already possible on the wire and are Mac-side gaps.**

| Defect | Needs a protocol change? | Why |
|---|---|---|
| **30** — cannot start a new conversation | **No** | `docs/protocol.md` already specifies two shapes for `sms.send`, the second being `{"addresses":[…],"body":"…"}` with no `threadId`, and rule 5 says `threadId` may be omitted for a genuinely new conversation. **The phone already implements it**: `SmsFeature.onSend` guards the verification with `if (threadId != null)`, and afterwards resolves `threadId ?: SmsStore.threadIdFor(context, recipients.first())`. The Mac simply has no surface that can name a recipient — `SmsBridge.smsSend(threadId, body)` cannot express one. |
| **32** — cannot reach a thread past the first page | **No** | The phone already pages: `SmsStore.threads(context, limit, request.long("before"))`. The Mac calls `smsThreads({ limit: PAGE })` and never passes `before`, and `SmsView.renderList` reports `threadsHasMore` in prose — *"Older conversations are not shown."* — with no control to act on it. The message pager on the same screen already does this correctly (`loadOlder`, `before: oldest.dateMs`). |
| **39** — a sent message is missing from the thread | **Yes** | `sms.send`'s ack is `{"threadId":"42","recipients":1}`. It carries no message, so there is nothing for the pane to append and the composer falls back to re-reading the provider 30 ms after the send — before the row exists. |

That is worth stating plainly because it changes what Phase 5's SMS sitting *is*: **one protocol
change and two Mac features**, not a protocol redesign. It also means 30 and 32 could be done
without touching the wire at all, and could ship before the protocol change if that is convenient.

### The one real change, and the shape I recommend

There is a second gap that the same change closes — now **defect 44** — and it is the reason for the
shape:

> **A message sent from the phone itself never reaches the Mac.** `SmsFeature` pushes exactly one
> event — `SMS_RECEIVED`, from the inbound broadcast — and there is no observer on outgoing
> messages. Type someone a reply on the handset and the Mac's open thread does not move. Same
> user-visible symptom as 39 (the thread is missing a message), different cause, and neither is
> covered by the other.

So the choice is not "ack vs. nothing", it is **where the sent message enters the Mac's model.**

**Proposed: a new `sms.sent` event, and leave the ack alone.**

```json
sms.sent   — event
{"threadId":"42",
 "messages":[{"id":"9912","address":"+15551234567","body":"on my way",
              "dateMs":1756299100000,"inbound":false,"read":true,
              "kind":"sms","hasAttachments":false}]}
```

Identical payload shape to `sms.received`, differing only in `inbound: false`. Emitted whenever the
provider gains an outgoing row — whether the send came from this Mac, another client, or the phone's
own keyboard.

**Why an event rather than enriching the ack:**

- **It closes both gaps with one mechanism.** An ack only answers the client that asked, so a
  message typed on the phone still would not appear.
- **The Mac already has the receiving half.** `SmsView`'s `onSmsReceived` appends
  `event.message` to the open thread when the ids match and refreshes the list otherwise. Handling
  `sms.sent` identically is a handler registration, not new logic — and the *append* path is the one
  step 68 proved works, in a way it took two logs and a timing control to establish.
- **The ack keeps meaning one thing.** Today it means "the radio accepted this", which is a
  statement about the send. Making it also carry a provider row means it can either be late or be
  wrong, and every caller then has to handle an ack that succeeded with no message in it.
- **It survives defect 17's fix.** When the Mac can hold more than one phone — or one phone can
  serve two Macs — an ack reaches one client and the other's thread silently diverges.

**The race, and the rule it must follow.** The provider write is asynchronous; `SmsFeature.onSend`
already documents this (*"It can still be null on the first message to a new number — the write is
asynchronous"*). So `sms.sent` faces exactly the race that defect 34 fixed for `sms.received`, and it
must be answered the same way, not a new way:

- the same bounded retry — **three looks at 150 ms**, `PROVIDER_LOOKS` / `PROVIDER_LOOK_DELAY_MS`,
  already in `SmsFeature`;
- the same honest success line naming which look won — `sms.sent pushed after N lookup(s) — N
  pushed / M dropped since start` — because that denominator is what made 68a reportable as
  *"the retry was not exercised"* rather than as a pass;
- the same refusal to emit a partial shape: no row after three looks means **drop it and log `e:`**,
  never an event with a `threadId` and no message.

**Explicitly rejected: a delay before the composer's re-fetch.** It is the shape this codebase has
now rejected three times — defect 36 shipped it, defect 37 declined it, and defect 39's own record
names it. A timer substitutes a plausible value for a known one. The phone knows when its own write
landed; the Mac should be told, not left to guess how long to wait.

**Not proposed:** changing `sms.send`'s request shape. The recipient rule in `docs/protocol.md` — both
facts named, verified on the side that holds the truth, nothing sent on a mismatch — is the one
guard in this project against an unrecoverable error, and defect 30 does not need it relaxed. It
needs a Mac that can name a recipient.

### What the two Mac-side gaps need, for completeness

**30 — a compose surface.** `SmsBridge.smsSend(threadId, body)` grows to
`smsSend({ threadId?, addresses, body })`, and the pane gains a "New conversation" affordance with a
recipient field. The rule in `docs/protocol.md` still binds: the Mac resolves `addresses` from the
thread it is sending into, or from what the user typed for a genuinely new one, and **never** from
whichever thread the UI has open. A new-conversation send omits `threadId` and names `addresses`
only, which is shape two, already specified and already implemented on the phone.

One consequence worth deciding before it is built: a new conversation to a number that *already has*
a thread will be merged by the provider into that thread. The pane should therefore treat the ack's
`threadId` as authoritative and open that thread, rather than assuming it created a new one.

**32 — a thread pager.** `loadThreads` takes `before`, and `renderList` grows a "Load older
conversations" button when `threadsHasMore`, mirroring `loadOlder` on the message list.

### The `before` cursor — **decided 2026-08-29**, not left to be discovered twice

**The hazard is in three pagers, not two, and it is not theoretical.** `before` is an exclusive
millisecond timestamp and every query orders by date alone, with no tiebreaker:

| Pager | Query |
|---|---|
| `SmsStore.threads` | `date < ?`, `ORDER BY date DESC` |
| `SmsStore.messages` | `DATE < ?`, `DATE DESC`, over **two tables merged** |
| `CallLogStore.entries` | `DATE < ?`, `DATE DESC` |

Rows sharing a `dateMs` at a page boundary are skipped or repeated depending on the provider's
tie-break, which is not specified. **And MMS makes it certain rather than unlucky**: the MMS table
stores dates in *seconds* (`SmsStore` divides by 1000 going in and multiplies coming out), so every
MMS in the same second collides exactly.

Three options were weighed:

| | How | Why not |
|---|---|---|
| **(a) compound cursor** | add `beforeId`; order by `(dateMs, id)` | needs a wire field and a documented total ordering |
| (b) inclusive `before` + client de-dup by id | no wire change | **unbounded failure**: if more rows share one timestamp than the page size, the cursor never advances and the pager loops forever |
| (c) widen each page to include its whole boundary timestamp | no wire change | same unbounded failure in a different costume — a page cannot advance *within* a timestamp group, so a large enough group stalls it, and the page size stops being bounded |

**Decision: (a).** The deciding property is not exactness, it is that **(a) can advance inside a
shared timestamp and the other two cannot.** Options (b) and (c) both make progress depend on
eventually finding a timestamp boundary, which a bulk import or a burst of MMS in one second can
deny indefinitely. That is a stall with no upper bound, and it would present as "the pager stops
working on exactly one person's phone".

**The shape, and it is backward compatible:**

```json
{"limit":50,"before":1756300000000,"beforeId":"9911"}
```

- `before` stays what it is: an exclusive millisecond timestamp, and the coarse filter the provider
  query uses.
- `beforeId` is **optional**. Absent, behaviour is exactly today's — so nothing that exists breaks,
  and the Mac's message pager can adopt it independently of the thread pager.
- Ordering is documented as **`dateMs` descending, then `id` descending compared byte-wise as a
  string**. The comparison does not need to be semantically meaningful; it needs to be *total,
  deterministic and agreed by both sides*, and a byte-wise string compare is all three even across
  the `sms` and `mms` id spaces.
- The phone filters `date <= before` and then drops everything at or before `(before, beforeId)` in
  that ordering.

**Two consequences worth stating now rather than meeting later.**

1. **The phone must over-read past the boundary group.** Fetching `limit + 1` is not enough when the
   boundary timestamp holds more rows than that. The rule: read `limit + 1`; if the last row shares
   its `dateMs` with the boundary, keep reading that timestamp. Bound it, and when the bound is hit
   return what was read with `hasMore: true` — **the cursor still advances**, because the id
   tiebreaker resumes inside the timestamp. That is option (a)'s whole advantage, and it is only
   real if the over-read rule exists.
2. **Message ids are asymmetric today** — MMS rows are `"mms:$id"` and SMS rows are a bare `_ID`.
   The byte-wise ordering is total regardless, so the cursor works as-is. Normalising SMS to
   `"sms:$id"` would be tidier and is **not** proposed here: it would invalidate every id the Mac
   currently holds, for cosmetics, in the same sitting as a paging change. Recorded as a separate
   question, not folded in.

**Applies to `call.log` too.** Same optional `beforeId`, same ordering rule. It has one table and no
id-space complication, so it is the cheapest place to implement the pattern first and prove it.

### Summary of the proposed protocol diff

Against `docs/protocol.md`, SMS section:

- **Add** `sms.sent` — event, payload identical to `sms.received` with `inbound: false`, emitted on
  any new outgoing provider row regardless of origin, with the same bounded-retry and
  drop-rather-than-partial rule.
- **Add** to `Messages.kt` and `protocol.ts`: `const val SMS_SENT = "sms.sent"`. (`protocol.ts`
  declares 18 of 53 types; this is a good moment to close some of that drift, but that is a separate
  argument.)
- **Unchanged**: `sms.send`'s request shape, the recipient rule, `sms.threads`, `sms.messages`.
- **Changed, decided**: an optional `beforeId` on `sms.threads`, `sms.messages` and `call.log`, with
  the ordering rule above. Backward compatible; absent means today's behaviour.

---

## 2. What survives from v1's `TransferManager`

`sync/transfer/TransferManager.kt`, 718 lines, written against the v1 Android-to-Android transport.
CLAUDE.md says read it for design and write our own. This is the read.

### What is worth keeping — the design, not the code

**1. Absolute offsets on every chunk, and resume from the partial file.** The single best idea in
the file. Each chunk carries where it belongs rather than relying on arrival order, so an
interrupted transfer resumes from what is already on disk instead of restarting. `acceptOffer`
computes `resumeOffsets` per file from what the receiver already holds and sends them back with the
acceptance; the sender seeks and skips. The v2 bulk header already anticipates this — the documented
`pull` header carries `"offset":<bytes>` — so the shape is compatible.

**Keep, and note the phone is the one that will need it most.** A phone that sleeps or roams mid-copy
is normal, not exceptional, and Phase 6 is explicitly about that.

**2. Adaptive chunk sizing.** `adaptChunkSize` doubles towards `ChunkSizes.MAX` (256 KB) above
8 MB/s and halves towards `MIN` (64 KB) below 1 MB/s. Cheap, self-correcting, no configuration.
**Keep the idea.** Note the constants are already shared in `core/.../protocol/TransferProtocol.kt`
and the documented bulk channel says "raw chunks of 256 KB" — the doc should say *up to* 256 KB, or
the adaptive behaviour contradicts the contract on its first slow link.

**3. SHA-256 computed streaming, and verified on arrival.** The sender digests as it reads; the
receiver digests the file it wrote and compares. **And the part worth copying verbatim in spirit:**
on a mismatch the partial file is **deleted**, with the comment *"A corrupt file is worse than a
missing one — drop the partial so a retry is clean."* That is the same judgement as "unavailable,
here is why" over silent failure. Keep it, and keep the reasoning in the comment.

One caveat: the digest is computed over the *skipped* region too when resuming (`skipBuffer`), which
is correct and easy to get wrong — a resumed transfer that digests only the new bytes reports a
checksum failure on a perfectly good file.

**4. Progress as a separate concern from the payload.** `TransferProgress` carries
`bytesPerSecond` and derives `fraction` and `etaSeconds`, and progress is throttled by
`shouldReport()` rather than emitted per chunk. The v2 protocol already puts progress on the
**control** channel, not the bulk one, which is the same separation and is correct.

**5. The offer/accept handshake.** A transfer is offered, the receiver accepts or declines, and only
then do bytes move. This is what makes "drag to Finder" and "send to phone" safe: nothing arrives
unrequested. **Keep**, and it maps onto `fs.transfer.begin` on the control channel.

**6. Room-backed transfer rows with a status enum.** Survives process death, which is the whole
reason a paused transfer can resume after Samsung kills the service. **Keep.**

### What dies with `NetworkPacket`

- **Every wire type.** `TransferOffer`, `TransferResponse`, `TransferFileMeta` and the whole
  `TransferProtocol` object are `NetworkPacket` bodies routed by `PacketType`. v2 has JSON envelopes
  on the control channel and a framed binary side channel. The *fields* are worth keeping; the
  serialization and routing are not.
- **`ConnectionManager` / `DeviceConnection` / `RoutedPacket`.** The v1 transport. v2's equivalent
  is `ControlSession` plus an `AuthenticatedChannel`. Nothing here ports.
- **Chunks as packets on the one connection.** v1 interleaves file chunks with everything else on a
  single link. v2 has a dedicated bulk socket precisely so a 2 GB video cannot stall a `ping`. This
  is an architectural improvement and it means the v1 send loop cannot be lifted — it is written
  around `connection.send(packet)`, not around a stream it owns.
- **Both-ends-symmetric design.** v1 runs the same manager on two Android peers, with direction
  decided per job. v2 is asymmetric: the phone serves, the Mac connects, and the Mac has a
  filesystem the phone cannot enumerate. The offer/accept flow survives; the symmetry does not.
- **`PendingIncomingOffer` carrying `peerName`.** Fine in v1, meaningless in v2 where there is one
  peer.

### The one thing to be careful about

`TransferManager` is a singleton holding `ConcurrentHashMap`s of live state keyed by `transferId`
and `jobId`, started and stopped with the service. That works, and CLAUDE.md's rule about following
the surrounding style applies — but v2's bulk channel hands the feature an `AuthenticatedChannel`
that is scoped to a *session*, and a session can end mid-transfer. The v2 design needs an explicit
answer to "what happens to a running transfer when the control session dies" that v1 never had to
give, because in v1 the connection and the transfer were the same thing.

Phase 2 already learned this lesson in a harsher form: `sessionEndedSink` exists because the mirror
kept a live `MediaProjection` running with no consumer — *"capture with no consumer, which is a
privacy defect and not merely a leak"*. A file transfer with no consumer is a smaller problem but
the same shape, and the hook to hang it on already exists.

---

## 3. Bug 6 — frame enforcement on the bulk channel

### First, correcting the premise

`docs/status.md` (2026-08-25) says `MAX_FRAME` is *"declared on both ends and enforced on neither
side channel"*. **That is no longer true**, and its own staleness banner covers it. Enforcement
exists in four places today:

| Where | What it enforces |
|---|---|
| `core/.../link/Framing.kt:19` | `readFrame(input, maxLength = Link.MAX_FRAME)` — every phone read, one place |
| `desktop/src/main/framing.ts:16` | the same default on the Mac |
| `desktop/src/main/video.ts:179` | an explicit check on the video channel, closing the socket rather than resyncing |
| `mirror-module/.../VideoChannel.kt:95` | the phone's video **send** side refuses to emit an over-size frame |

So the video channel is covered on both ends, in both directions, since Phase 2. What is genuinely
unenforced is the **bulk** channel — and only because nothing serves it: `bulkChannelSink` is never
assigned, and `acceptSideChannel` refuses the socket with `FEATURE_UNAVAILABLE` before any framing
happens.

The one thing already enforced on the bulk path is the **token frame**, read with an explicit
128-byte cap (`Framing.readFrame(input, 128)`) inside a 10-second `soTimeout`. That is the right
pattern and the proposal below extends it rather than replacing it.

### What enforcement should look like, decided before fs.* rides on it

**a. The bulk channel needs its own cap, and it should be smaller than `MAX_FRAME`, not larger.**

The instinct with file transfer is to raise the limit. The opposite is correct. The bulk channel
moves **chunks**, and `ChunkSizes.MAX` is 256 KB. A frame larger than a chunk is not a big transfer,
it is a peer that has lost sync or is lying — so the cap should sit just above the largest legitimate
frame:

```
Link.MAX_BULK_FRAME = 1 * 1024 * 1024      // 4x ChunkSizes.MAX, room for the JSON header
```

`MAX_FRAME` at 8 MB is sized for a video keyframe. Applying it to bulk would let a peer allocate 8 MB
per frame to move 256 KB of payload, which is 32x the memory for no capability. **A cap justified by
the thing it carries, not inherited from a different channel.**

**b. Enforce on the write side too, not only the read side.** `VideoChannel.kt:95` already refuses to
*send* an over-size frame, and that is the half that catches our own bugs rather than a hostile
peer's. A bulk sender that builds a 3 MB chunk because an adaptive size ran away should fail on our
side with a clear line, not produce a frame the receiver silently closes the socket over.

**c. The header frame gets its own, much smaller cap, like the token does.** The documented bulk
header is a small JSON object (`transferId`, `direction`, `path`, `size`, `mtime`, `sha256`,
optional `offset`). A path can be long, but nothing here justifies megabytes:

```
header frame     ≤ 64 KB      // read with an explicit cap, as the token is at 128 bytes
chunk frames     ≤ MAX_BULK_FRAME
```

Reading the header with the same cap as the payload means a malformed first frame can allocate the
full chunk budget before anything has been authenticated beyond the token.

**d. A violation closes the socket and says which cap was exceeded — and does not resync.**
`video.ts` already documents this reasoning: *"deliberately strict: a length over MAX_FRAME closes
the socket rather than trying to resync"*. A length prefix is either right or the stream is
desynchronised, and there is no third case worth guessing at. The log line must name the cap and the
offending length, because "closed the bulk socket" with no number is the shape of a bug nobody can
diagnose.

**e. It must be enforced in `Framing`, not in the feature.** Both sides already have exactly one
framing implementation *"so a length prefix is validated in exactly one place"*. The bulk cap should
be a parameter passed at the call site, the way the 128-byte token cap is — not a second check
written inside `fs.*` that can drift from it.

**f. And the counter rule applies.** Per CLAUDE.md, a refusal count with no denominator is not
evidence. If the bulk channel logs a rejected frame it must also carry frames accepted and bytes
moved, or the first over-size frame in a 10,000-frame transfer reads as a broken channel.

**Why now.** All of the above is a fifteen-line decision while nothing serves the channel. After
`fs.*` ships, changing a cap means changing what an already-shipped sender will emit, and a cap that
is too small then looks like a transfer bug for large files. The video channel got this right at the
start; the bulk channel can too.

---

## 4. Where defect 33 lands in Phase 5

**Defect 33** is: the phone puts package ids into sentences users read, in places that do not go
through `AppLabels.of`.

### The important finding first: `fs.*` and `media.*` have no payload specification yet

`docs/protocol.md` lists the eight `fs.*` and four `media.*` type names in its inventory and
specifies **nothing else about them** — no request shape, no response shape, no error table. The only
concrete text is the bulk-channel header. So the honest answer to "list the sites that would put a
package id into a user-visible string" is that **there are no such sites yet, and this is the moment
the question is cheap to answer** — the same argument as Bug 6.

Where they *would* arise, given what these features do on Android:

| Surface | How a package id gets in | What should be sent instead |
|---|---|---|
| `media.buckets` | `MediaStore` buckets are directories, and app-owned ones are named by package — `Android/media/com.whatsapp/WhatsApp Images`, `Pictures/com.instagram.android`. A bucket list drawn straight from `BUCKET_DISPLAY_NAME` shows package ids in a picker. | `bucketName` for display, plus the raw `bucketId` as the handle. Where a bucket path contains a package segment, resolve it through `AppLabels.of` and send `appName` beside it. |
| `media.list` items | `OWNER_PACKAGE_NAME` (API 29+) is the natural "which app made this" field and is a package id by definition. | Send both: `ownerPackage` as data, `ownerAppName` as the label. Same pairing as `remote.state`, which already sends `package` **and** `appName`. |
| `fs.list` entries | The phone's storage root is full of package-named directories — `Android/data/com.foo`, `Android/obb/com.foo`. A file browser drawing directory names shows them. | `name` stays the real directory name — it is a path component and must not be prettified, or the Mac cannot navigate back to it — with an optional `displayName` carrying the resolved label. **The path is data; only the label is a sentence.** |
| `fs.*` and `media.*` **error strings** | The likeliest regression, and the one with precedent. Defect 28 was found in a *reason string*, not a list: "no permission to read com.foo" is a sentence a user reads. | Any error mentioning an app resolves it. `FeatureOf` already maps `fs` → `files` and `media` → `photos`, so the `feature` field is right; it is the human `message` that needs the label. |
| `fs.transfer.*` progress and completion | "Saved to Android/data/com.foo" in a Mac notification. | The same `displayName` pairing, chosen at render time by the Mac. |

### The rule this suggests, which is worth writing into `docs/protocol.md` when `fs.*` is specified

> **A package id may appear on the wire only as a machine handle, never as the only thing a user
> will read.** Any payload carrying a package name carries a resolved label beside it, and any
> human-readable `message` mentioning an app names the app, not the package.

`remote.state` already obeys this (`"package"` and `"appName"`). Notifications already obey it
(`NotificationRelay.kt:110`). Codifying it before `fs.*` is written means Phase 5 cannot reintroduce
defect 33 by omission — which is exactly how it arose, since nothing in the build relates a package
id to the sentence it ends up in.

### Two practical notes for whoever does it

**Enumerate rather than fix what you can see.** Defect 28 was believed to be two copies and was
three; the third was found only by looking for all of them. The same applies here: when `fs.*` lands,
grep for every `packageName` reaching a string, not just the ones a screenshot showed.

**`AppLabels.of` returns the package name as its honest fallback**, and logs at warning level with
`resolved / fell back` beside it. That is correct and should not be "fixed" — a package with no
launcher icon has no better name. What matters is that the fallback is *reached through* `AppLabels`
so it is counted, rather than a raw id being interpolated somewhere that never asks.

---

## Status of these proposals

None of this is implemented, and none of it should be until step 70 has run and Phase 4 is closed.
The order inside Phase 5, if the proposals survive review:

1. `sms.sent` — it closes **39 and 44 together**, and 44 is the half that cannot be fixed on the Mac.
   30 and 32 are Mac-side and can proceed in parallel. The cursor question is already answered above.
2. Bug 6's caps, before `fs.*` has a first consumer.
3. The package-id rule written into `docs/protocol.md` as `fs.*` and `media.*` are specified.
4. The transfer implementation, borrowing v1's offsets, adaptive chunking, streaming digest and
   offer/accept, and none of its transport.
