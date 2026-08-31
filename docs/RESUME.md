# Resume here — Phase 5 opening brief, written 2026-08-31

**Phase 4 is closed.** Step 70 (the ring) and step 71 (the SMS sitting) both passed on hardware.
Nothing in Phase 4 is waiting on a device, a second person, or a booking. The previous contents of
this file — the step-70 preconditions, the stale-overnight table, the line to give the second
person — are all discharged and have been deleted rather than left to be mistaken for live
instructions. The record of that work is `docs/testing.md`; the summary is
`docs/phase-4-closeout.md`.

**Phase 5 may open. It has not been started, deliberately.**

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

Baselines, as of the close of Phase 4: phone **189** tests (67 `sync-module` + 122 `core`), Mac
**129** tests, `tsc --noEmit` clean. Run Gradle with `--rerun-tasks` when you intend a *run* — an
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

1. **`fs.*` and `media.*` have no payload specification at all.** `docs/protocol.md` lists the eight
   `fs.*` and four `media.*` type names in its inventory and specifies nothing else — no request
   shape, no response shape, no error table. The only concrete text is the bulk-channel header. This
   is the largest open question in Phase 5 and the proposals deliberately do not answer it.
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

## The first slice, and what it depends on

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
