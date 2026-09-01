# Phase 5 close-out ledger — files, photos, clipboard, contacts

> ## ⏳ **PHASE 5 IS NOT CLOSED — this is the ledger as it stands on 2026-09-01.**
>
> Everything in scope is proven on hardware **except clipboard**, which has a specification, a
> pre-registered decision table and an instrument — and **not one reading**. The instrument was
> built on a day the phone was not attached and has never been run.
>
> **Two conditions close this phase**, and they are the whole list:
>
> 1. **Clipboard readings 1–5 recorded in `docs/testing.md`** with their controls
>    (`docs/phase-5-clipboard-proposal.md` §2), and then whichever feature the pre-registered table
>    names for the answer that comes back — built, and proven on the device.
> 2. **Defect 57's branch produced once** — an undecodable `MediaStore` row — or the defect
>    consciously carried into Phase 6 as a numbered deferral rather than as an unfinished sentence.
>
> **Contacts is not one of them.** It shipped and was proven in Phase 4; see *The contacts line, and
> why it is already served*.

This is the summary a person reads before deciding whether Phase 6 can open. The evidence behind
every claim is in `docs/testing.md` in dated sections; the defect index is `docs/defects.md`; the
contract is `docs/protocol.md`.

---

## What passes, and what proved it

| Feature | Phone | Mac | Proven by |
|---|---|---|---|
| **Photo/video browser** — `media.buckets`, `media.list`, `media.thumb` | done | done | Slice 2, 2b — 149 albums, 35,755 items, paging to exhaustion on a 16,369-item album |
| **`media.original`** and the first bulk client | done | done | Slice 3 — bytes on 42503, digests compared both ends, `photos` advertised the moment the fourth verb and the served channel arrived together |
| **Resume**, digest-first | done | done | Slice 4 — 52 MB cut at 26,476,544 bytes, three independently computed whole-file digests agreeing |
| **`fs.*` reads, `fs.delete`, pull** | done | done | Slice 5 — all six verbs; first `verified: true` in this project; `CHECKSUM_MISMATCH` branch run on a deliberately flipped byte |
| **The phone's Folders screen** | done | — | Slice 6 — all four states on hardware, including one produced by deleting a folder under its live grant; a real grant taken through a release-shaped path |
| **The Mac's Files pane** | — | done | Slice 7 — `M2` and `M4` measured live and differing four ways, each difference deleted in turn and the guard shown red |
| **Push**, the phone as receiver | done | done | Slice 8 — 24 MB cut in half, re-offered at the phone's own `12058624`, `verified: true`; defect 56 found and closed here |
| **`Download/ConnectSuite`**, grant-free | done | done | Slice 9 — a root of its own, proven with **both** media grants revoked and restored |
| **The aimed picker and quick-pick chips** | done | — | Slice 9 — `EXTRA_INITIAL_URI` measured honoured, a bad aim measured to degrade to the parent |
| **Drag to Finder** | — | done | Slice 9 — copy-then-drag, with the ordering stated to the user rather than hidden behind a spinner |
| **The `fs.*` contract** | — | — | `docs/protocol.md` → Files, including `fs.thumb` |
| **The `media.*` contract** | — | — | Slice 10 — moved into `docs/protocol.md` → Photos, and guarded so the next one cannot go missing |
| **Contacts** | done | done | **Phase 4**, contacts pane run 2026-08-28, and `nameFor` firing on an inbound ring in step 70 |

Suite at this point: phone **294** tests, Mac **192**, plus 14 guard fixtures under `scripts/`,
`tsc --noEmit` clean, 0 failures anywhere, `gradle exit: 0` on a `--rerun-tasks` run.

---

## What is untestable or unproven — each with the control that says so

**This is the section that matters most in a close-out**, because every row here is a thing that
would otherwise be read as proven. Each carries what would make it a reading, not just what is
missing.

| # | Not proven | The control, or why there is none |
|---|---|---|
| 1 | **Clipboard, entirely.** Background read, its accessibility-grant control, the observer callback, and the background write | The instrument exists and has never been run. Reading 1 (foreground read of our own marker) is the precondition and the run stops without it; reading 4 (the same run with the service **off**) is the only thing that says reading 3 was about the grant; `--es mode verify` is what separates a refusal from a stimulus that never arrived. **Until then this repo knows nothing about clipboard on this device** |
| 2 | **The frame-cap *refusal* path on a real socket** | Unit-test-only since slice 1, and named as such then. The only way to emit an over-cap frame on a real socket is a peer built to do it — a second client whose purpose is to violate a rule our own writer refuses to break. The **accept** path was exercised on a real socket in slice 3, which is the half that could be |
| 3 | **`fs.list`'s id tiebreak on real data** | `tieBoundaries: 0` over 16,377 real entries: 33 pages, ids distinct, sums reached — and **not one page boundary fell inside a tie group**, so that run proves the pager advances and proves nothing about the tiebreak. Only the shuffle unit test can see it. Published as 0 deliberately; the contrast is `media.list`, where 6 of 32 boundaries landed in a tie group and carried 10 photographs |
| 4 | **Defect 57's branch** — a row that exists and cannot be rendered | Never observed. It has to be manufactured: truncate a file's bytes under its `MediaStore` entry and confirm `media.thumb` says `NOT_FOUND` for a row `media.list` still returns. Fixing it without producing it would be writing against a state nobody has seen |
| 5 | **Defect 33** (Phase 3, carried) — `InputFailure.PhoneLocked` | *Not runnable as written on this hardware.* Locking the phone stops MediaProjection before any input can be attempted, so the canvas is dead before the sentence the step asks for could exist. The failure path is unit-tested and correct; the route to it is unreachable here. An observation about the step, not an open item |
| 6 | **Defect 30's no-thread half** | One send to a number with **no** thread. The absence must be proven in `mms-sms/conversations` **and** `content://sms` first — orphaned `sms` rows outlive a deleted conversation, which is what cost step 71 its no-thread case |
| 7 | **Every hardware reading in this repo came from one SM-S938B** | `docs/single-device-audit.md` marks each finding **contract**, **AOSP/Mainline**, **vendor** or **unknown, single-device**. Two to carry: the SAF picker is Google's and **Play-updated**, so the wall can move under a running install with no OS upgrade; and the `DUAL_APP` user 95 control that several permission readings lean on is Samsung-only |
| 8 | **`media.*` under a revoked grant mid-request** | The Files pane's `ROOT_NOT_GRANTED` was produced live by revoking a folder while the Mac held it; the equivalent for photos — revoking *Photos and videos* mid-listing — was never run. The refusal path is unit-tested and the `fixHint` names the right switch, but nothing has watched the pane react |

---

## Deferred and open, by number

| # | State | What it is, in one line |
|---|---|---|
| **17** | deferred | The Mac holds one phone structurally. Felt the first time anyone attaches two |
| **30** (half) | open | The no-thread send. No code pending; row 6 above is the precondition |
| **33** | deferred | Package ids in user-visible strings on the **phone** side. The wire half is done — `docs/protocol.md` now carries the package-id rule for both `fs.*` and `media.*` |
| **38** | deferred | `onAudioInfoChanged` not overridden. Its test note must survive: check `playbackInfo.playbackType`, and test with the phone's own volume keys — `volume_set` from the Mac goes through `onCommand` and makes a broken build look fixed |
| **51** | open | The after-send SMS retry logs an `E` and counts a `dropped` for messages the observer then delivers. Reporting only. Two triggers need two counters; do **not** raise the retry budget |
| **52** | open — **fix on next touch of the mirror** | Three drop causes into one counter, and the third — a frame past `MAX_FRAME` — increments nothing, so the mirror's only correctness fault is absent from its own `droppedFrames`. The `oversize` counter comes first |
| **53** | open | Two of the Mac's four call `refused` increments log nothing. One question, four reasons: it needs lines, not more counters |
| **57** | open — **new, this phase** | `media.thumb` answers `NOT_FOUND` both for a photo that is gone and for one that is there and could not be rendered. Reporting only; the Mac's behaviour is already right for both causes |

**Documentation debt, counted rather than remembered.** `scripts/check-protocol-spec.mjs` prints it
on every commit: `clip.push`, `clip.request`, `clip.history` (blocked on §2's reading — deliberate),
`apps.list`, `apps.launch`, `apps.icon` (Phase 7, no handler on either side), `battery.state`,
`net.state` (unscheduled, no handler, no capability). Eight of 62 types, each with its reason, and an
entry that becomes specified without leaving the list **fails** the check.

---

## The contacts line, and why it is already served

The roadmap lists contacts under Phase 5. **It shipped in Phase 4** and is proven there:
`ContactsFeature` serves `contacts.list` and `contacts.get` on the phone, `ContactsClient` and the
contacts pane are on the Mac, `contacts` is specified in `docs/protocol.md`, and the pane was run on
2026-08-28. The Phase 4 close-out records it as done in its own table.

It sits in Phase 5's row because that row groups *everything that moves a file or a string* — the
grouping is about permissions and channels, not about work outstanding. Nothing in this repo names a
contacts feature that is missing: search runs on the phone (deliberately, so a number stored in a
different format still matches), a contact opens in full, photos come with `withPhoto`, and the cache
clears on disconnect.

**So the honest statement is: Phase 5's contacts scope is served, and clipboard is the phase's only
remaining feature.** If someone wants contact *editing* or *creation*, that is a new feature with no
proposal, no protocol names and no argument written for it — it would need all three, and it is not
what this row meant.

---

## What Phase 6 inherits, and what it must not assume

1. **The serverless-process window.** A process started by the platform rebinding the notification
   listener installs every feature and never starts `LinkService`. `scripts/link-up.sh` detects it;
   nothing fixes it. That is Phase 6's, by name.
2. **Defect 52 is owed by whoever next opens `mirror-module`** — not deferred, and not Phase 6's to
   schedule; it lands on the next touch for any reason.
3. **Nothing in the current build fails dangerously if a single-device verdict is wrong**
   (`docs/single-device-audit.md` §4). The one place a vendor assumption is asserted to a user as
   fact is the Folders screen's `Download` wall copy, and its refuser is Play-updated.
4. **The transfer path is the most-exercised code in the phase and its riskiest failure is closed
   but recent.** Defect 56 — a truncated push committed as the finished file — is guarded by
   `FsArrivalTest`, shown red three ways. Anything Phase 6 does to reconnect logic runs through that
   path.

---

## What this phase learned, and where each lesson is enforced

| Lesson | Enforced by |
|---|---|
| A green pager needs a **clock** beside it — every check this project had ever asked of a pager passed while `limit` bounded the frame and never the work | `CLAUDE.md`, and defect 55's record; the per-directory snapshot that fixed it is also the consistent view the cursor always assumed |
| **A probe that reports its stimulus without measuring it** can hide the bug it was built to find — 12 MB "delivered", zero arrived, and a truncated push being committed underneath | `CLAUDE.md`; the half-close in the push probe; `FsArrivalTest` |
| **A guard that fails is usually right.** Raising its number to fit new code is how it stops guarding | `FsDeleteGuardTest`, two *named* calls rather than a count of four |
| **A refusal and a cancellation are the same `null`** — nothing may be explained after a pick, so the wall is standing copy | `pickMessage` returning `null`, shown red |
| **A state that cannot be reached must not be drawn** beside states that can; and where both are reachable, they differ four ways | `FoldersScreen`'s exhaustive `when`; the Files pane's four differences, each deleted in turn |
| **The DOM is an instrument** and gets a control before the reading | `scripts/probe.mjs` and its scan — no `Runtime.evaluate` outside it |
| **A type named in the contract and specified nowhere is a payload two implementations agree about silently** | `scripts/check-protocol-spec.mjs` + the commit hook — new this phase, and it found two gaps nobody was looking for |

---

## Can Phase 6 open?

**Not yet, and the reason is one feature rather than a list.** Clipboard has never been measured on
this device; until reading 3 and its control are recorded, this repo cannot say whether the feature
it has specified is the feature that is possible. Everything else in Phase 5 is on the device.

The work is small and it is not a booking: no second person, no second handset, no scheduled call.
One phone, one `adb`, two runs of a probe that already exists — and then whichever product the
pre-registered table names.
