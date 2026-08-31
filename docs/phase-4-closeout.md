# Phase 4 close-out — notifications, calls, SMS/MMS, contacts, media remote

Rewritten **2026-08-31**, against `docs/defects.md` as it stands. The previous version was dated
2026-08-29 and every claim in its status sections has since moved: it said 35c had failed, 36 was
untested, 45 was a new High, 42 was reopened, and step 70 still needed arranging. All five are now
closed. It also carried the instruction *"Do not ask anyone for another ring"*, which is discharged
rather than contradicted — the ring happened.

**Phase 4 has no hardware work left.** Every feature in its scope is proven on the device. Two code
defects remain open and neither needs a phone in anyone's hand.

The evidence behind every claim here is in `docs/testing.md`, in dated sections. The index is
`docs/defects.md`. This file is the summary a person reads before deciding whether Phase 5 can open.

---

## What shipped

| Feature | Phone | Mac | Proven by |
|---|---|---|---|
| Notification mirroring + reply | done | done | steps 42-49b, 52 |
| SMS / MMS threads | done | done | steps 55, 58, 58a, 65, 66, **68** |
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

**Withdrawn:**

| # | Why |
|---|---|
| **47** | Not a defect. Its trigger episode `c13` was an incoming **WhatsApp video call**, answered, active 67 m 47 s — `dumpsys telecom` gives start, end, owning app and `LOCAL` termination. The Mac's card was true the whole time. The control the record leaned on (*no platform call-log row*) could not tell a phantom from a self-managed call, which is the failure the register now carries as its lesson |

**Open — code, no hardware, no second person:**

| # | What it needs |
|---|---|
| **44** | An `sms.sent` event. `SmsFeature` pushes exactly one event (`SMS_RECEIVED`, from the inbound broadcast); `registerContentObserver` appears **nowhere** outside `Capabilities.kt`, so nothing watches outgoing rows. Needs: a protocol addition, a `ContentObserver` on the sent mailbox, defect 34's bounded retry, and a Mac handler. Verified by typing one SMS on the handset — the phone alone, nobody else involved |
| **46** | One pure resolver in `src/shared/` returning `{ label, isPackageFallback }`, with `renderer/remote.ts:134` and `main/remote.ts:185` composing a marking clause instead of interpolating `appName ?? package ?? '…'`. Both sites are unchanged and two other sites in the same file already do it correctly. Mac-only, fully unit-testable, no device at all |

**Deferred out of Phase 4, with fix directions recorded:** 17, 30, 32, 33, 38, 39.

---

## What Phase 5 inherits, and what it must not assume

- **Three SMS defects travel together** — 30, 32, 39 — one sitting's work sharing one protocol
  decision about what `sms.send` accepts and what its ack carries. **44 belongs with them**: 39 is a
  race the Mac loses against its own provider read, 44 is a mechanism that does not exist, and
  fixing 39 alone leaves the phone's keyboard diverging from the Mac forever. `docs/protocol.md`
  changes first.
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

---

## Can Phase 5 open?

**Not yet, and the remaining condition is small and specific.** 44 and 46 are Phase 4's own scope
and neither needs a device in anyone's hand: 46 is Mac-only and unit-testable today; 44 is a
protocol addition plus a `ContentObserver`, verified by typing one SMS on the handset.

Phase 5's decisions are recorded in `docs/phase-5-proposals.md` and nothing there is implemented.
Its first act claims `bulkChannelSink`; `docs/protocol.md` is deliberately unmodified.
