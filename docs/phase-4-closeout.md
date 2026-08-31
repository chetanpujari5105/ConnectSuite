# Phase 4 close-out — notifications, calls, SMS/MMS, contacts, media remote

> ## ✅ **PHASE 4 IS CLOSED — 2026-08-31, after step 71.**
>
> Every feature in its scope is proven on the device, and the two defects this file last listed as
> *open, code only* — **44** and **46** — are both closed with evidence. **Phase 5 may open.**
>
> What remains is carried forward deliberately and named in *What Phase 5 inherits*: three
> **deferred** defects (17, 33, 38) and two **open** ones (**30**'s no-thread half, **51**). None
> blocks Phase 5 and none is a hardware booking.

Closed out **2026-08-31** after step 71, against `docs/defects.md` as it stands. The version before
this one was written earlier the same day and could not yet answer its own last question: it said
44 and 46 were open, and that Phase 5 could not open until they were. Both are now closed, and
step 71 also closed 39 and half of 30 — and found **51** while doing it.

**Phase 4 has no hardware work left, and no second person is needed for anything in it.**

The evidence behind every claim here is in `docs/testing.md`, in dated sections. The index is
`docs/defects.md`. This file is the summary a person reads before deciding whether Phase 5 can open.

---

## What shipped

| Feature | Phone | Mac | Proven by |
|---|---|---|---|
| Notification mirroring + reply | done | done | steps 42-49b, 52 |
| SMS / MMS threads | done | done | steps 55, 58, 58a, 65, 66, **68**, **71** — send in both directions, thread paging, and a first message to a bare address |
| Call events, dialing, answer/reject | done | done | steps 60-63, **69**, **70** |
| Contacts | done | done | contacts pane run, 2026-08-28; and `nameFor` firing on an inbound ring in step 70 |
| Media remote | done | done | steps 64, 66, **67** |

Four Mac panes landed on 2026-08-28 and the Mac gained its first test suite the same day, after six
of the phase's defects turned out to be Mac-side.

---

## Step 70 — ran and passed, 2026-08-31 13:43

One inbound cellular call from a second handset, held 8 s, one reject on `#call-reject`.

| | |
|---|---|
| **36** | `Call c7 ended rejected after 8197ms` — **`rejected`, not `missed`.** Control: the platform's own row `_id=11717, type=5 (REJECTED), +919800000001`. Our disposition and Android's agree on the same call |
| **35c** | card read `who="Chetan"`, `status="Ringing · +919800000001"` — number **and** resolved contact on an inbound ring |
| **42** (inbound) | `c7` drew its own caller, three minutes after `c6` from the same number and after `c5` from a different one. The card carries the current episode's number, which is the whole of 42 |
| **45** | closed by option 4 — **7 of 7 episodes corrected**, arrival offsets **16 ms to 535 ms** |

The gate was exercised in both directions across two days: it aborted at exit 4 on 2026-08-30 when
a card changed under it, and authorised this one after re-checking the same predicate immediately
before the click. A gate that has only ever refused is not yet known to be a gate.

---

## Step 71 — the SMS sitting proven on hardware, 2026-08-31

Three messages: one typed on the handset, one sent from the Mac into a thread that already existed,
one sent from the Mac to a bare address. No second person, no ring, ~15 minutes.

| | |
|---|---|
| **44** | handset keyboard → `sms.sent pushed after 1 lookup(s) (provider change, row 22212)`, Mac drew `sms.sent in thread 594 **to** Chetan` while its own `sent` counter still read **0**. Control: two inbound messages on the same thread minutes later read `**from**` — same handler, opposite preposition, so the classification is real |
| **39** | thread 594 open, **17 → 18 drawn**, outbound, **without leaving the thread** — which is the entire defect, whose symptom was a thread short by one until you navigated away and back. Exactly one copy: the append and the later refresh did not both add it |
| **30** (half) | Mac addressed `9850850263` with no thread id; phone answered `to 1 verified recipient(s)`; the pane opened **thread 593, the one the phone named**, not one it invented. The *no-thread* half was not exercised and stays open — see below |
| **51** (new) | found by reading the trigger column rather than the event: all three pushes say `provider change`, none says `after send`. The after-send retry lost 2 of 2 and logged an `E` claiming a loss that did not happen |

**The run's two premises were both wrong and both caught before a message was spent** — the handset
send had not actually happened (newest sent row was three days old), and the "new" number already
had a thread with two messages in it. The second is the instructive one: that send would have
succeeded, drawn, and looked exactly like a pass for the half of defect 30 it cannot test.

---

## Verification state of every defect this phase touched

**Closed — fixed and proven:**

| # | Closed by | The evidence in one line |
|---|---|---|
| 27 | 2026-08-28 | the unavailable reason recomputes with the set that produced it |
| 28 | 2026-08-28 | app names resolved, not package ids — a third copy found by enumerating |
| 29 | 2026-08-28 | the call log reads the right key; 50 entries, four distinct types drawn |
| **31** | **step 67** | `[remote]` states 466 → 591 while `delivered` stays frozen at 29 |
| **34** | **step 68** | row drawn from the push while the pane's own note still read the pre-send count |
| **35** | **steps 69 + 70** | outgoing `Dialling · +919800000001`; inbound `Chetan` / `Ringing · +919800000001` |
| **36** | **step 70** | `ended rejected`, with the platform's `type=5` row as the control |
| **37** | hardware, link down | `Capabilities now: …,notifications,remote,…` 1 ms after the listener attached |
| **40** | hardware | the reject ack explains the `answered` that follows instead of denying it |
| 41 | hook fixtures | the force-stop hook no longer denies prose that documents it |
| **42** | 2026-08-29 + **step 70** | outgoing on hardware; inbound on `c7` |
| 43 | `calls.test.ts` | the `from ,` string defect 35 was named for |
| **45** | **step 70**, by option 4 | 7 of 7 corrected, 16–535 ms — the extra arrives, just after the card is published |
| 48 | exclusion fixtures | two locks at two paths reconciled to one; four fixtures shown to fail |
| 49 | `lsof` fixture + 3 controls | one CDP client no longer counted as two |
| **32** | hardware, 2026-08-31 | the pager pages: 50 → 89 → 126 → 158 → 183, every entry distinct |
| **39** | **step 71** | 17 → 18 drawn in an open thread, without reopening it |
| **44** | **step 71** | a message typed on the handset arrives, with the direction word as the control |
| **46** | fixtures + the running app | one `shared/appLabel.ts` seam; enumerating found **five** sites where the record said three, and all four user-visible ones were wrong |
| **50** | hardware, 2026-08-31 | the conversations view answers a *bound* selection argument with an empty cursor — found by probing a bound whose correct answer was "everything" |

**Withdrawn:**

| # | Why |
|---|---|
| **47** | Not a defect. Its trigger episode `c13` was an incoming **WhatsApp video call**, answered, active 67 m 47 s — `dumpsys telecom` gives start, end, owning app and `LOCAL` termination. The Mac's card was true the whole time. The control the record leaned on (*no platform call-log row*) could not tell a phantom from a self-managed call, which is the failure the register now carries as its lesson |

**Open, and carried past the phase boundary on purpose:**

| # | What it is, and why it does not block Phase 5 |
|---|---|
| **30** (half) | The explicit-address path is closed on hardware. What is untested is a first message to a number with **no** thread — the run's chosen number turned out to have one. **No code is pending**; what is missing is one send to a genuinely thread-less number, with the absence proved in both `mms-sms/conversations` *and* `content://sms` first, since orphaned rows outlive a deleted conversation |
| **51** | The after-send retry logs an `E` and increments `dropped` for messages the observer then delivers — 2 of 2. Reporting only; nothing is lost, and 39 and 44 are closed on drawn evidence. Defect 40's shape, one feature over. Fix is two counters for two triggers, **not** a larger retry budget |

**Deferred out of Phase 4, with fix directions recorded:** 17, 33, 38.

---

## What Phase 5 inherits, and what it must not assume

- **The SMS group is done, and it went the way the proposals predicted.** 30, 32, 39 and 44 shipped
  in one sitting and were proven in the next; only **one** of them needed the wire, exactly as
  `docs/phase-5-proposals.md` §1 said. What Phase 5 inherits from it is not work but two facts:
  `sms.sent` exists and is the model for any future "the phone changed something" event, and its
  payload is built by the **same builder** as `sms.received` so the two shapes cannot drift — the
  cheapest possible guarantee that defect 34 does not recur.
- **`before` is still a bare millisecond timestamp on all three pagers.** Rows sharing a
  millisecond can be skipped at a page boundary. The answer is decided (optional `beforeId`, a
  documented total ordering) and deliberately **not** smuggled into Phase 4; it is a protocol change
  across `sms.threads`, `sms.messages` and `call.log`, and it is Phase 5's to make. The shipped
  pagers are no worse than each other.
- **Defect 38's test note must survive** — check `controller.playbackInfo.playbackType` before
  claiming a fix, and test with the phone's hardware volume keys, never `volume_set` from the Mac,
  which pushes through `onCommand` and makes a broken build look fixed.
- **Defect 17 is a Mac storage shape** — one paired slot, structurally. Felt the first time anyone
  tests two phones; workaround is a second instance with `--user-data-dir`.
- **A protocol asymmetry, read in source and never observed** — `CallFeature.replayTo`
  (`CallFeature.kt:120`) returns silently when no call is live, so a reconnecting Mac is told what
  *is* happening and never what is *not*; and `call-current` (`main.ts:733` → `calls.ts:81-82`)
  answers from the Mac's own cache rather than asking the phone. Together they mean a missed
  `call.ended` could not be repaired by any reconnect or refresh. **No instance has ever been seen**
  — this is a paragraph for `docs/protocol.md` when the call namespace is next revised, not a
  defect, and it is written down here so it is not rediscovered as one.
- **The serverless-process window is not fixed and is Phase 6's.** A process started by the platform
  rebinding the notification listener installs every feature and never starts `LinkService`.
  Reproduced again on 2026-08-30 after `adb install -r`: capabilities read
  `calls,contacts,input,mirror,notifications,remote,sms` with no port bound. Defect 37's fix keeps
  the capability set correct through such a window; nothing makes the server come up.
  **`scripts/link-up.sh` now detects it** — three readings, uid-matched — which is detection, not a
  fix.

---

## What this phase learned, and where each lesson is enforced

Prose was not enough in any of these cases; each has an enforcement point or is explicitly marked as
lacking one.

| Lesson | Enforced by |
|---|---|
| Never drive the UI by coordinates when a named target exists | practice in steps 67-70 — every Mac interaction by element id over CDP, every phone interaction by `adb` and named component |
| Prove the query returns a known positive before a negative becomes evidence | controls recorded beside every result in `docs/testing.md` |
| A check that does not gate the action is decoration | `scripts/step70-gate.mjs` + `step70-gate.test.mjs`; observed refusing and authorising on hardware |
| A rule that matters needs an enforcement point | `scripts/hooks/no-force-stop.sh` (+ fixtures), `scripts/check-defects.sh` via `hooks/defects-in-sync.sh` |
| One click, and only one — exclusion between sessions | `scripts/step70-exclusion.mjs` + 8 fixtures; defects 48 and 49 came out of building it |
| `Listening on` is written once per `onCreate`; its absence is not evidence | **`scripts/link-up.sh`** — `createTime` + `LISTEN` under the app's uid + an `ESTAB` peer |
| A registration line is not an execution line | `--require-correction`, which makes the proof a pass criterion rather than a precondition; `isCorrectionFor` checks it is *this* call |
| **Verify a mechanism through the same client the product uses** — defect 50: the shell inlines its literal, the app binds a `?`, and the provider answers only one of them | **not a hook, and the closeout says why**: no unit test can see one OEM's provider, and a grep would guard the single line already fixed. Enforced as a precondition on the *claim* — a pager is recorded on consecutive counted pages on hardware, never on its control rendering. `CLAUDE.md`, control-rule section, fifth entry |
| **A `--rerun-tasks`-less Gradle run is not a test run** | caught in step 71: `testDebugUnitTest` reported up to date and the result XML predated the sitting. The suite line in `docs/testing.md` now names the flag it was taken with |

---

## Can Phase 5 open?

**Yes. Phase 4 is closed.** Every feature in its scope is proven on the device, and the condition
this file carried until today — 44 and 46 — is discharged: 46 by fixtures and the running app on
2026-08-31, 44 on hardware in step 71.

**What is deliberately left behind, so nobody re-derives it as a blocker:** 17, 33 and 38 are
deferred with fix directions; 30's no-thread half and 51 are open. All five are small, none needs a
second person, and none touches the transport Phase 5 is about to claim. They are listed here rather
than closed silently, because the failure this repo keeps guarding against is a finding that lives
in a transcript instead of a file.

**The one standing caution for Phase 5's first act:** it claims `bulkChannelSink`. That was the
reason Phase 5 was gated on step 70 — a failed ring must not be debugged through a transport change
— and the gate has served its purpose. Phase 5's decisions are recorded in
`docs/phase-5-proposals.md`; nothing there is implemented, and `docs/protocol.md` is still
deliberately unmodified.
