# Resume here — Phase 5 opening brief, written 2026-08-31

**Phase 4 is closed.** Step 70 (the ring) and step 71 (the SMS sitting) both passed on hardware.
Nothing in Phase 4 is waiting on a device, a second person, or a booking. The previous contents of
this file — the step-70 preconditions, the stale-overnight table, the line to give the second
person — are all discharged and have been deleted rather than left to be mistaken for live
instructions. The record of that work is `docs/testing.md`; the summary is
`docs/phase-4-closeout.md`.

**Phase 5 is open.** Slice 1 (Bug 6's frame caps) shipped on 2026-08-31; the `fs.*` / `media.*`
payload specification is written as a proposal and is the next thing to read —
`docs/phase-5-fs-media-proposal.md`. Nothing in `fs.*` or `media.*` is implemented.

---

## Start of day, both sides

Neither side survives the night, and the phone in particular comes back **fully granted and
serverless** after any `adb install -r`.

```bash
# phone: starts LinkService, which nothing else does
adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity
scripts/link-up.sh          # the only thing in the repo that catches a serverless process

# Mac: kill every instance first — a second one silently keeps port 9222 and every
# reading then comes from the stale window
pkill -f "ConnectSuite/desktop/node_modules/electron"
cd desktop && npm run build && \
  nohup ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222 &
```

`link-up.sh` must reach **3 of 3** — the third reading is an `ESTABLISHED` control session, i.e. a
Mac actually attached. Do not grep the phone log for `Listening on`; it is written once per
`onCreate` and is absent by design on a healthy running service.

**If the Mac says the phone timed out, read `ipconfig getsummary en0` before believing it.** In step
71 `ifconfig` showed a stale lease on the wrong subnet while `getsummary` already carried
`yiaddr = 10.108.253.92, router 10.108.253.63` — the correct one. Two reads of the same fact
disagreeing, with the less obvious one right.

Baselines, as of Phase 5 slice 7: phone **247** tests (`core` 77, `input-module` 44,
`sync-module` 95, `mirror-module` 31), Mac **172** tests, `tsc --noEmit` clean. The figure this file
carried at the close of Phase 4 — *189 (67 `sync-module` + 122 `core`)* — does not reconcile with the
tree by either counting method and has been corrected rather than restated; see the note at the end
of `docs/testing.md`. Run Gradle with `--rerun-tasks` when you intend a *run* — an
up-to-date task writes no new result XML and is not evidence.

---

## What `docs/phase-5-proposals.md` has already decided

**These are decisions, not options.** The arguments are in the file. Do not re-litigate them, and do
not implement an alternative without saying why the recorded reasoning is wrong.

| Decided | What, and where |
|---|---|
| **Bug 6's caps** | `MAX_BULK_FRAME = 1 MB` — *smaller* than `MAX_FRAME`'s 8 MB, because the bulk channel moves 256 KB chunks and a bigger frame is a peer that has lost sync, not a bigger transfer. Header frame capped separately at **64 KB**. Enforced **write-side as well as read-side**, inside `Framing` with the cap passed at the call site, never a second check inside `fs.*`. A violation **closes the socket and names the cap and the offending length**; it does not resync. §3 |
| **The package-id rule** | A package id may appear on the wire as a machine handle, never as the only thing a user reads. Every payload carrying one carries a resolved label beside it. Already codified in `CLAUDE.md`; to be written into `docs/protocol.md` as `fs.*` and `media.*` are specified. §4 |
| **What survives from v1's `TransferManager`** | The *design*, not the code: absolute offsets per chunk with resume from the partial file, adaptive chunk sizing, streaming SHA-256 with the partial **deleted** on mismatch, progress on the control channel, the offer/accept handshake, Room-backed rows. Everything `NetworkPacket` dies. §2 |
| **The `before` cursor** | Optional `beforeId`, ordering `dateMs DESC` then `id DESC` byte-wise, backward compatible — the only option that can advance *inside* a shared timestamp. Applies to `sms.threads`, `sms.messages` and `call.log`. **Decided and not implemented.** §1 |
| **The delay-before-re-fetch** | Permanently rejected. Five reaches for that shape now. §1 |

---

## What it leaves open

0. **Settled since this list was written:** the `photos` permission gate now models what the OS
   actually asks for — `{READ_MEDIA_IMAGES, READ_MEDIA_VIDEO}` **or** `{READ_EXTERNAL_STORAGE}`,
   one alternative granted in full — and both are declared in the manifest. Defect **54** (photos
   would have advertised itself with nothing serving the bulk channel `media.original` runs on) was
   taken red first and closed. The push destination is decided: `Download/ConnectSuite` through
   `MediaStore`, which needs **no grant at all**, observed on the handset — see
   `docs/phase-5-fs-media-proposal.md` §4.
1. ~~**`fs.*` and `media.*` have no payload specification at all.**~~ **Answered as a proposal,
   2026-08-31: `docs/phase-5-fs-media-proposal.md`.** Request and response shapes for all twelve
   types, the error table, the package-id rule written into the wire, and the session-death policy
   that was open question 2. It is prose against `docs/protocol.md` and nothing in it is
   implemented — read it and disagree with it before any of it is built.
2. **What happens to a running transfer when the control session dies.** v1 never had to answer this
   because the connection and the transfer were the same object; v2's bulk channel is scoped to a
   session that can end mid-copy. `sessionEndedSink` already exists as the hook — Phase 2 added it
   when the mirror kept a live `MediaProjection` with no consumer — but the policy is undecided.
3. **`beforeId` is decided and unbuilt.** All three pagers still cursor on a bare millisecond, so
   rows sharing one can be skipped at a page boundary. Known limit, recorded, not a new finding.
4. **The doc contradicts itself on chunk size.** The bulk channel is documented as "raw chunks of
   256 KB" while adaptive sizing ranges 64 KB–256 KB. It must read *up to* 256 KB, or the first slow
   link violates the contract.

---

## Slice 7 — the Mac's Files pane — **built and running, 2026-09-01**

The read half, against a phone side proven first. Evidence: `docs/testing.md` → **Slice 7**;
departures from the canvas: `docs/design-departures.md` → **Files, F1–F7**.

`M2` (one root) and `M4` (a real `ROOT_NOT_GRANTED`, produced by revoking the folder on the phone
while the Mac had it selected) were both measured in the running app, minutes apart, and differ four
ways — colour, glyph, headline verb, retry. Each difference was deleted in turn and the guard went
red for each.

Three things to carry forward:

1. **A tagged union does not protect you from two callers.** The route opening and the capability
   arriving both refreshed, the second reset the listing under the first, and the pane settled on an
   **empty table with no error** — the confusion the whole design prevents, reached through
   concurrency. `refresh()` is serialised now.
2. **`[data-screen="files"]` matches two elements** — the app window carries it as a route marker,
   and the section is the pane. `querySelector` returns the window, so a check written that way
   counts the sidebar's buttons and reports a hidden pane as visible. Use
   `section[data-screen="…"]`, and assert visibility before believing a measurement.
3. **Searching text for an affordance finds the copy explaining its absence.** A `/drop|upload/`
   regex matched the degraded banner's own sentence. Count controls, not words.

**Not built:** push, and anything that writes. The pane has no `Copy to Mac` button yet either — the
pull path belongs with the transfer queue rather than bolted onto a detail card the day the pane
lands.

## Slice 6 — the Folders screen — **done on hardware, 2026-09-01**

**A release build can grant a folder for the first time.** Until this slice the only route to a SAF
tree was `SafProbeActivity`, which cannot ship — so `fs.list` served roots no shipping build could
create. Proposed first (`docs/phase-5-files-onboarding-proposal.md` rev 2), then built. Evidence:
`docs/testing.md` → **Slice 6**.

All four states observed on the device, including one that had to be *produced*: a folder was
created, granted, and deleted underneath its live grant to reach the *"This folder is gone from the
phone"* row. A real grant was taken through the screen and read back from the platform, and it is
provably new rather than yesterday's surviving — a different `UriPermission` object id and a
`persistedCreate` matching our own log line to the millisecond.

Three things worth carrying forward:

1. **A refusal and a cancellation are the same `null`.** Android disables `USE THIS FOLDER` inside
   its own picker rather than returning an error, so nothing may be explained *after* a pick. The
   `Download` wall is permanent copy in every state because there is no afterwards to put it in.
   Now a rule in `CLAUDE.md`, and enforced — `pickMessage` returns `null`, shown to fail red.
2. **The phone has four states and none is a failure; the Mac gets six.** Reading
   `persistedUriPermissions` is in-process and cannot fail, so a "couldn't load" card here would be
   unreachable and indistinguishable from a bug in the empty state. Also a rule now, enforced by an
   exhaustive `when` plus a source scan for the case the compiler misses.
3. **`dumpsys activity permissions` lists released grants** with `persisted=0x0` until the owning
   process lets go. Counting `documents/tree` rows says a removal did nothing. The discriminator is
   `persisted=`, not the row's presence.

**Not built, deliberately:** the Mac's Files pane, push, and **quick-pick chips — which is a
decision, not a deferral.** A chip is a promise about where the picker opens and this app cannot
make it: with `EXTRA_INITIAL_URI` unset the picker does not start at the top of storage, it
*chooses*, and on this handset it **restored its last location** and opened inside `DCIM`. A chip
labelled `Camera` would be right by coincidence and wrong by default.

### Next, in order

1. ~~**The Folders screen**~~ — **done, slice 6, 2026-09-01.**
2. ~~**The Mac's Files pane**~~ — **done, slice 7, 2026-09-01.** Read half only; no upload
   affordance, by three separate statements and one test.
3. **Push**, which is the phone as receiver: `.part`/`.failed` in a SAF tree, the `MediaStore`
   pending item for `Download/ConnectSuite`, and the Room row that is authoritative for resume. It
   also owes the reading §4 of the payload proposal still lists as unproven — **whether a pending
   `MediaStore` item can be resumed across process death** — and the `EXTRA_INITIAL_URI` reading in
   §8.3 of the onboarding proposal, which needs `Download/ConnectSuite` to exist and so is naturally
   this sitting's.

### Before Phase 6, and read-only: the single-device audit

**Every hardware reading in this repo came from one handset — SM-S938B, Android 16, One UI.** The
record does not currently distinguish *platform* behaviour from *vendor* behaviour anywhere, and
this app is meant to run on every Android phone. A separate sitting, changing no code, goes through
the findings and marks each **AOSP** (holds anywhere), **Samsung/One UI** (vendor), or — the answer
that must be available and used — **unknown, single-device**. Guessing is the failure mode here;
"unknown" is a correct answer and a confident wrong label is not.

The ones that most need it, named so the sitting starts somewhere: the **SAF picker refusals** (the
storage root and `Download`, and whether the refusal is DocumentsUI-generic or One UI's), the
**call log** and `SamsungCallLog.Loggable okayToLog`, **DUAL_APP** users, **process management** and
what survives a background kill, and **defect 55's timings**, which are one provider's
implementation on one device.

## Slice 5 — `fs.*`, the phone side — **done on hardware, 2026-09-01**

**All six `files` verbs answer, and the capability is advertised for the first time.** Built in the
order the brief set: read paths (`fs.list` roots, `fs.list` in a tree, `fs.stat`, `fs.mkdir`), then
`fs.delete`, then `fs.transfer.begin`. Evidence: `docs/testing.md` → **Slice 5**; the contract is now
in `docs/protocol.md` under **Files**.

Three things worth carrying forward more than the rest:

1. **`verified: true` happened for the first time in this project.** `fs.transfer.begin` pre-hashes
   below a 64 MB ceiling, so a digest is agreed before a byte moves. Three independently computed
   digests agreed on a clean pull; then one byte was flipped in flight, deliberately, and the
   `CHECKSUM_MISMATCH` branch ran for the first time on both ends — partial deleted, `.failed`
   sidecar written, nothing at the final name.
2. **Defect 55: the pager was correct and took eight minutes.** 33 pages, 16,377 entries, every id
   distinct, sums reached — and 490 seconds, because `limit` bounds the frame and never the work.
   Fixed with a per-directory snapshot (490 s → 21 s). **A green pager needs a clock beside it**;
   none of the three preconditions in `CLAUDE.md` would have caught this.
3. **A test of mine was not evidence, and a mutation run said so.** Deleting the id tiebreak left the
   obvious tie-group paging test green — stable sort, positional cursor. The test that can see it
   shuffles the listing between pages, which is the real condition: every page is a fresh provider
   query and the row order is not ours.

### What slice 5 did **not** do, and none of it is a surprise

| | State |
|---|---|
| **Push** — `direction: "push"` | Answers `FEATURE_UNAVAILABLE` with a sentence. `files` is advertised anyway, on the argument that all six *verbs* answer and one direction degrades per locked decision 6. **The Mac's Files pane must not draw an upload affordance until this lands.** If that reads as too generous, the fix is a contract knob, not a loosened `containsAll` |
| **The Mac's Files pane** | Deliberately not built. The phone side is now proven, so it is unblocked |
| **The Folders screen on the phone** | **Built in slice 6, 2026-09-01.** All four states observed on hardware and a real folder granted through it on a release-shaped path. `docs/testing.md` → Slice 6 |
| **The id tiebreak on real data** | `tieBoundaries: 0` over 16,377 real entries. Exercised only by the shuffle unit test, and said so rather than implied |
| **Resume on an `fs.*` pull** | The path is shared with `media.original` and was proven there in slice 4. Nothing has sent a non-zero offset for an `fs.*` transfer specifically |

## Slice 4 — resume, built digest-first — **done and exercised on hardware, 2026-09-01**

**Resume works and has been observed.** A 52 MB video interrupted at 26,476,544 bytes: the `.part`
held exactly that, the resumed attempt was offered exactly that as its offset, the second socket
carried only half the file, and **three independently computed whole-file digests agree** — the
phone's, the Mac's resumed one, and an independent hash of what landed. `docs/testing.md` →
**Slice 4**.

Built in the order the failure demands: the digest first, red before green
(`src/shared/transferDigest.ts`, six tests), then the receiver's three on-disk states
(`src/shared/transferFiles.ts`), then the hardware run.

**The first hardware run did not resume, and that finding is the useful part**: `fail()` resolved
before the write stream flushed, so a caller stat'd a `.part` that was still growing and recorded a
length that then changed. `isResumable` refused — correctly — and re-fetched a gigabyte. Fixed by
awaiting the flush. The guard turning a corruption into a slow success is the trade working.

### Still open in the transfer path

1. ~~**The checksum-mismatch branch has never run.**~~ **It ran on 2026-09-01**, in slice 5, on a
   deliberately flipped byte with `fs.transfer.begin`'s pre-hashed digest. `docs/testing.md` →
   Slice 5 §7.
2. **Push.** The receiver built here is the Mac's. The phone's receiver is still not built —
   `fs.transfer.begin` refuses `direction: "push"` with `FEATURE_UNAVAILABLE`.
3. **Whether a pending `MediaStore` item can be resumed across process death** — still unproven, still
   load-bearing for the default push destination.
4. **The frame-cap refusal path stays unit-test-only.** Looked for in this slice and not taken: the
   only way to emit an over-cap frame on a real socket is a peer built to do it, which is a second
   client verifying a refusal our own writer refuses to produce.

## Slice 3 — `media.original` and the Mac's first bulk client — **done, 2026-09-01**

**Port 42503 carries bytes.** Three photos pulled phone → Mac with digests compared on both ends,
frame tallies on both sides, and `photos` advertised — the capability and the feature arriving in
the same moment, which is what `CapabilityContract` was written to enforce. Slice 1's on-socket debt
for the frame caps is discharged on the accept path; the *refusal* path is still unit-test-only.

Evidence: `docs/testing.md` → **Slice 3**. Two things it leaves unproven and names: **resume** (the
phone honours an `offset` and digests the skipped bytes, but nothing has ever sent a non-zero one)
and **push** (nothing writes to the phone yet).

### Next: the transfer slice — `fs.*`

Its obligations are already written and must not be brought forward or skipped:

1. **The resumed-digest test, red first.** Interrupt a transfer, resume it, assert the receiver's
   digest equals a whole-file digest of the source — then reintroduce the bug by starting the digest
   at `offset` and watch it report `CHECKSUM_MISMATCH` on a byte-identical file. The sender's half
   exists (`BulkTransfers.digestSkipped`); the receiver's does not, and neither does the test.
2. **Whether a pending `MediaStore` item can be resumed across process death.** Unproven,
   load-bearing for the default push destination, and it gets a hardware reading before code depends
   on it — `docs/phase-5-fs-media-proposal.md` §4.
3. **The SAF grant surface and the onboarding copy**, which §8 still lists as open.

## Slice 2b — the Mac's Photos pane — **built and running, 2026-08-31**

The pane is real: 149 albums, 35,755 items, thumbnails, paging by scroll, all through the control
channel. It is built on three verbs and **the `photos` capability is still not advertised** — that
combination is deliberate, it is the four-state model's *partly offering* state, and the banner is
what makes it a designed inconsistency rather than an accidental one. Departures are in
`docs/design-departures.md` → **Photos** (P1–P6); the evidence is `docs/testing.md` → **Slice 2b**.

**The grey chip was never a defect** — it went green in slice 3 when `media.original` and the bulk
channel landed together, which is the mechanism working. Nobody loosened
`CapabilityContract.isImplemented`, and nobody should.

## Slice 2 — the photo browser's three read verbs — **done on hardware, 2026-08-31**

`media.buckets`, `media.list` and `media.thumb` are implemented and unit-tested;
`docs/testing.md` → **Phase 5 → Slice 2** holds the record. **`media.original` is deliberately not
here**, so `photos` stays unavailable and the Mac's Photos pane stays grey — that is the expected
state and it is asserted as a test, not left to be rediscovered. Do not loosen
`CapabilityContract.isImplemented`'s `containsAll` to turn the chip green.

**Both preconditions are discharged on hardware.** Edits paged `20 → 40 → 60 → 80 → 93` and Camera
paged 33 pages to `16,369 == 16,369`, every id distinct, through the app's own client. **6 of
Camera's 32 page boundaries fell inside a tie group and 10 photographs would have been dropped by a
bare-millisecond cursor** — the `beforeId` decision earning itself on a real camera roll rather than
on a fixture.

The probe is still there and takes a bucket now:

```bash
adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.probe.MediaProbeActivity \
  --ei limit 500 --es bucket -1739773001
adb logcat -s MediaProbe:V
```

It reads `stopped=exhausted` versus `page cap` and will not claim a sum it did not reach.

### Then, in order

1. **Slice 3 — `media.original` + the Mac's first bulk client.** It turns `photos` green (all four
   verbs plus a served bulk channel) and it discharges slice 1's outstanding debt: the frame caps
   are proven by unit tests only, and this is the cheapest thing that proves them on a real socket.
   `media.original` is pull-only, with no destination, no SAF and no push direction — a fraction of
   `fs.transfer`'s surface.
2. **The transfer slice.** Its first obligation is named and must not be brought forward: the
   resumed-digest test — interrupt, resume, assert the receiver's digest equals a whole-file digest
   of the source — shown **red first** against a digest started at `offset`. It stays a precondition
   on that slice rather than being written early against no receiver.
   Its second is the one §4 leaves open: **whether a pending `MediaStore` item can be resumed across
   process death.** Unproven, load-bearing for the default push destination, and it gets a hardware
   reading before code depends on it.
3. **Then `fs.*`**, which needs the SAF grant surface and the onboarding copy §8 still lists as open.

## Slice 1 — **DONE, 2026-08-31**

**Bug 6's frame caps on the bulk channel shipped.** `MAX_BULK_FRAME` = 1 MB and
`MAX_BULK_HEADER_FRAME` = 64 KB, enforced read *and* write side inside `Framing` on both ends, with
the cap passed at the call site, a refusal that names the cap and the offending length, and the
accepted frames/bytes on the same line. The contract is in `docs/protocol.md` under
**Bulk channel → Frame caps**; the evidence, including both suites shown failing against the missing
cap first, is `docs/testing.md` under **Phase 5 → Slice 1**.

Two things it turned up in passing. **The control channel wrote under the wrong cap** — it reads at
`MAX_CONTROL_FRAME` and would have written at the `MAX_FRAME` default, latent since Phase 1, fixed
in both `ControlSession.kt:98` and `link.ts:572`. And **the caps are proven by unit tests only**,
because nothing serves the bulk channel yet; the first `fs.*` transfer owes the on-socket evidence.

**Next: the `fs.*` / `media.*` payload specification** — written, not implemented. It is
`docs/phase-5-fs-media-proposal.md`, a proposal against `docs/protocol.md`, which stays unmodified
apart from the frame-caps section above.

The original framing of this slice is kept below.

**Bug 6's frame caps on the bulk channel.** Proposals §3, item 2 of their order — item 1 (`sms.sent`)
already shipped inside Phase 4.

**Why this first, in one sentence:** it is a fifteen-line decision *while nothing serves the
channel*, and after `fs.*` ships, changing a cap means changing what an already-shipped sender
emits, at which point a too-small cap looks like a transfer bug for large files.

**What it depends on:** nothing that is not already in the repo. It touches `Framing` on both sides
and the two constants — no new protocol messages, no device, no permissions, no second person. The
video channel is the worked example: `VideoChannel.kt:95` already refuses to *send* an over-size
frame, and `video.ts` already documents why a bad length closes the socket instead of resyncing.

**What "done" looks like:**

- the cap lives in `Framing` and is passed at the call site, the way the 128-byte token cap is;
- the write side refuses too, so our own runaway chunk fails on our side with a clear line;
- the refusal names **which** cap and the offending length;
- and it carries a denominator — frames accepted and bytes moved beside frames rejected — or the
  first over-size frame in a 10,000-frame transfer reads as a broken channel.

**Then**, in order: the package-id rule into `docs/protocol.md` as `fs.*` and `media.*` are
specified; then the transfer itself.

---

## Carried-over defects — small, and none of them blocks the above

| # | State | What it needs |
|---|---|---|
| **30** (half) | open | One send from the Mac to a number with **no** thread on this handset. No code is pending. Prove the absence in `mms-sms/conversations` **and** `content://sms` first — orphaned `sms` rows outlive a deleted conversation, and step 71 lost its no-thread case to exactly that |
| **51** | open | The after-send SMS retry logs an `E` and increments `dropped` for messages the observer then delivers, 2 of 2. Reporting only. Two triggers need two counters; **do not** raise the retry budget |
| **52** | open — **fix on next touch of the mirror** | Found by the sweep 51 asked for, 2026-08-31. `VideoChannel` drops frames for three reasons into one counter, and the third — a frame past `MAX_FRAME`, refused by the writer — increments nothing, so the mirror's only correctness fault is absent from its own `droppedFrames`. The `Dropped N frames; the Mac is behind` line also asserts a cause it does not decide, which is defect 40's shape a third time. **Not deferred**: owed by whoever next opens `mirror-module` for any reason. The `oversize` counter is the half that matters and comes first |
| **53** | open | Same sweep. Two of `calls.ts`'s four `refused` increments log nothing, so part of the tally has no line above it. One question, four reasons — it needs lines, not more counters |
| **17** | deferred | The Mac holds one phone structurally. Felt the first time anyone tests two phones |
| **33** | deferred | Package ids in user-visible strings on the **phone** side. Lands naturally with the package-id rule above |
| **38** | deferred | `onAudioInfoChanged` is not overridden. **Its test note must survive**: check `controller.playbackInfo.playbackType` before claiming a fix, and test with the phone's hardware volume keys, never `volume_set` from the Mac — that pushes through `onCommand` and makes a broken build look fixed |

---

## Two things not to rediscover

- **A protocol asymmetry, read in source and never observed.** `CallFeature.replayTo`
  (`CallFeature.kt:120`) returns silently when no call is live, and `call-current` answers from the
  Mac's own cache rather than asking the phone — so a missed `call.ended` could not be repaired by
  any reconnect or refresh. **No instance has ever been seen.** It is a paragraph for
  `docs/protocol.md` when the call namespace is next revised, not a defect.
- **The serverless-process window is Phase 6's, not Phase 5's.** A process started by the platform
  rebinding the notification listener installs every feature and never starts `LinkService`.
  `scripts/link-up.sh` detects it; nothing fixes it.
