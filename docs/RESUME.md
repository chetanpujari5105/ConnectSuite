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

Baselines, as of Phase 5 slice 1: phone **190** tests (`core` 73, `input-module` 44,
`sync-module` 42, `mirror-module` 31), Mac **139** tests, `tsc --noEmit` clean. The figure this file
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

## The first slice — **DONE, 2026-08-31**

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
| **52** | open | Found by the sweep 51 asked for, 2026-08-31. `VideoChannel` drops frames for three reasons into one counter, and the third — a frame past `MAX_FRAME`, refused by the writer — increments nothing, so the mirror's only correctness fault is absent from its own `droppedFrames`. The `Dropped N frames; the Mac is behind` line also asserts a cause it does not decide, which is defect 40's shape a third time |
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
