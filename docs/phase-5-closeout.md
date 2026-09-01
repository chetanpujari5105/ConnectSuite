# Phase 5 close-out ledger — files, photos, clipboard, contacts

> ## ✅ **PHASE 5 IS CLOSED — 2026-09-02.** Phase 6 may open.
>
> **Both conditions are met, and here is each one against its own wording.**
>
> **1. Clipboard readings 1–5, with their controls, and the feature the pre-registered table names
> for the answer that came back — built and proven on the device.**
> The readings are `docs/testing.md` → **Slice 11**: reads refused **90 of 90** with the
> accessibility service bound and **60 of 60** with it disabled, over clips proven readable with
> focus half a second earlier; the listener silent across 12 samples; **writes unrestricted**. The
> decision table's answer for that reading was *a foreground-only send from the phone and an
> unrestricted one to it* — which is what shipped, and then went further than the table asked:
> **Slice 12** put an undo behind the Mac's auto-apply and gave the phone a setting, **Slice 13**
> made the Mac's send automatic with a watcher. Every branch is proven on hardware, including the
> phone's auto-apply, which is **in daily use** rather than merely demonstrated.
>
> **2. Defect 57's branch produced once, or carried into Phase 6 as a numbered deferral.**
> **Carried, deliberately, as the second option the condition offers.** The branch was never
> produced: manufacturing an undecodable `MediaStore` row means truncating a file's bytes under its
> own entry on someone's real phone, and nothing on this device has produced one naturally in a
> phase of use. It is **deferral 57**, its fix direction and its wrong-fix are in `docs/defects.md`,
> and it is a *reporting* defect — the Mac already drops errored ids into a `missing` set and stops
> asking, which is right for both causes. It is not an unfinished sentence and it does not block
> Phase 6.
>
> **What Phase 5 also leaves behind, which is worth more than any of its features:** four
> enforcement points where there were two — `check-clip-echo.mjs` and `check-renderer-views.mjs`
> joined `check-defects.sh` and `check-protocol-spec.mjs` — and five new entries in `CLAUDE.md`'s
> control table, one of which (**the instrument supplying its own input**) invalidated a
> conclusion this ledger had already recorded as measured.
>
> **The single-device caveat is unchanged and now matters more.** Every hardware reading in this
> phase came from one SM-S938B. `docs/single-device-audit.md` §4 is the list of which findings are
> AOSP, which are Samsung, and which are honestly unknown — and Phase 6 is the phase where that
> stops being a footnote, because battery management is the most vendor-specific surface on Android.

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
| **The clipboard wall** — measured, not inherited | — | — | Slice 11 — 90/90 and 60/60 refusals against a focused control; the AccessibilityService exception does **not** operate on this device |
| **Clipboard, both directions** | done | done | Slices 11–13 — the phone sends on focus, the Mac watches its own clipboard; both auto-apply paths and both notification shapes proven on hardware |
| **The echo interlock** | done | done | Slice 12–13 — each side driven against an adversarial peer that echoes everything forever; five mutations, each visible in its own test |
| **The concealed-clipboard check** | — | done | Slice 13 — measured through `NSPasteboard`, which overturned Slice 12's conclusion: `has`, never `read` |
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

## The gate sweep — asked for after the clipboard reading, 2026-09-01. **Reported, not fixed**

The clipboard reading exposed a gate guarding a rule this device does not implement. The question
that follows is whether there are others, and the honest answer needs a distinction the contract does
not currently draw.

**Class A — the grant *is* the mechanism.** Revoke it and the API is not refused, it is unreachable:
there is no `dispatchGesture` without an AccessibilityService, and no `StatusBarNotification` without
a bound listener. These cannot fail the way clipboard did.

| Gate | Status |
|---|---|
| `input` / `ACCESSIBILITY_SERVICE` | Structural. Also the one gate whose *effect on advertisement* is observed — the running-check caught a granted-but-unbound service on 2026-08-27 |
| `notifications` / `NOTIFICATION_LISTENER` | Structural, and observed end to end: a revoke propagated to the Mac in **16 ms** (2026-08-28) |

**Class B — a policy gate.** A separate subsystem holds the rule and refuses us. Every one of these
models a platform behaviour **this project has never seen operate**:

| # | Gate | What has never been observed |
|---|---|---|
| 1 | **`remote` / `NOTIFICATION_LISTENER`** | **The twin of the clipboard finding, and the reason this sweep was worth running.** The claim is that `MediaSessionManager.getActiveSessions` requires a notification-listener component to name itself with. It is documentation-derived, exactly as the clipboard sentence was, and it has never been tested — **because our own gate prevents the call.** With the listener off, `remote` is not advertised, so `getActiveSessions` is never reached, so the premise is untestable through the product. If the rule is wrong in either direction, the symptom is a media remote that is greyed out for no reason, and nothing in this repo could tell |
| 2 | `photos` / the two permission alternatives | The refusal branch is implemented and `docs/testing.md` records it as **drawn-but-unobserved** in as many words. Slice 9 did revoke both media grants — but to prove the *push* needed none, not to watch photos refuse |
| 3 | `sms` (3 permissions), `calls` (4), `contacts` (1) | Exercised only in the **granted** direction, every time. `docs/testing.md` says contacts' `PERMISSION_DENIED` is *"reachable with `pm revoke`"* — reachable, not reached. The calls four-permission split, the one that closed a real defect, was **reasoned** from what each verb calls and never watched to fail |
| 4 | `mic` / `RECORD_AUDIO` | The gate cannot decide anything: `requests = emptySet()` makes the capability unadvertisable whatever the permission says, so this is a lock on a door with no room behind it. Never exercised, and not exercisable |

**The structural finding, which is bigger than any row above: a gate makes its own premise
untestable.** `clipboard` was never advertised, so nothing in the shipping path ever called
`getPrimaryClip`, so the rule the gate models was never exercised — for an entire phase. The only
thing that could test it was a probe that went **around** the gate, which is what `ClipProbeActivity`
is. `remote` sits in that position today, and any future capability gated on a documented refusal
will too.

**Not fixed, deliberately, and the reason is the same discipline that produced the finding.** Three
of the four rows are testable with `pm revoke` in minutes — but a revoke run is a hardware sitting
with controls of its own (the fourth row of `CLAUDE.md`'s table is a `dumpsys` count that lies about
grant state), and doing it badly would replace *unobserved* with *wrongly observed*, which is worse.
Row 1 is the one worth a sitting on its own.

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
