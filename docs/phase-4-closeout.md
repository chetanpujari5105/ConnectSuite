# Phase 4 close-out — notifications, calls, SMS/MMS, contacts, media remote

Status as of **2026-08-29**. Phase 4 is **not closed.** Step 70 was attempted and **did not run**;
35c and 36 remain unproven, and the attempt turned up **defect 42**, which has to be fixed before a
re-run can mean anything. See the last section.

The evidence behind every claim here is in `docs/testing.md`, in dated sections. The defect index is
`docs/defects.md`. This file is the summary a person reads before deciding whether Phase 5 can open;
it is deliberately short on narrative and specific about what is proven and what is not.

---

## What shipped

| Feature | Phone | Mac | Proven by |
|---|---|---|---|
| Notification mirroring + reply | done | done | steps 42-49b, 52 |
| SMS / MMS threads | done | done | steps 55, 58, 58a, 65, 66, **68** |
| Call events, dialing, answer/reject | done | done | steps 60-63, **69**; **70 outstanding** |
| Contacts | done | done | contacts pane run, 2026-08-28 |
| Media remote | done | done | steps 64, 66, **67** |

Four Mac panes landed on 2026-08-28 (contacts, media remote, SMS, calls) and the Mac gained its
first test suite the same day, after six of the phase's defects turned out to be Mac-side.

---

## Verification state of every defect this phase touched

**Closed — fixed and proven on hardware:**

| # | Closed by | The evidence in one line |
|---|---|---|
| 27 | 2026-08-28 | the unavailable reason recomputes with the set that produced it |
| 28 | 2026-08-28 | app names resolved, not package ids — and a third copy found by enumerating |
| 29 | 2026-08-28 | the call log reads the right key; 50 entries, four distinct types drawn |
| **31** | **step 67** | `[remote]` states 466 → 591 while `delivered` stays frozen at 29 |
| **34** | **step 68** | row drawn from the push while the pane's own note still read the pre-send count |
| **35** (outgoing) | **step 69** | headline `Chetan`, second line `Dialling · +919800000001` |
| **37** | hardware, link down | `Capabilities now: …,notifications,remote,…` 1 ms after the listener attached |
| **40** | hardware | the reject ack now explains the `answered` that follows instead of denying it |
| 41 | hook fixtures | the force-stop hook no longer denies prose that documents it |

**Fixed in code, still unproven — and now blocked behind defect 42:**

| # | What step 70 must show | State after the 2026-08-29 attempt |
|---|---|---|
| **35c** | the inbound card's headline is the caller's name or number, and the second line is `Ringing · +…` | the phone logged `Call c4 ringing from 8800000004 (Contact D)`, which is the right answer — but the two episodes before it involved the same number and defect 42 shows a number can carry over, so the run **cannot tell a correct read from a stale one** |
| **36** | `call.ended cN rejected`, with `type=5` in the call log as the control | **untested.** No reject was sent; the call was answered on the phone and ran 33 s |

**Open and blocking:** **42** — an outgoing call placed on the phone is labelled with the previous
call's number and contact name. High severity on its own (it puts the wrong person's name on a live
card), and it is what makes step 70 unreadable: while a number can carry between episodes, a correct
`EXTRA_INCOMING_NUMBER` read and a stale carry produce the same string.

**Deferred out of Phase 4, with fix directions recorded:** 17, 30, 32, 33, 38, 39. See
`docs/defects.md`; each carries its fix direction and, where one exists, the wrong fix to avoid.

---

## What Phase 5 inherits, and what it must not assume

- **Three SMS defects travel together** — 30 (cannot start a conversation), 32 (cannot reach a
  thread past the first page), 39 (a sent message is missing from the thread until reopened). They
  are one sitting's work and share one protocol decision: what `sms.send` accepts and what its ack
  carries. `docs/protocol.md` changes first.
- **Defect 38 has a test note that must survive** — check `controller.playbackInfo.playbackType`
  before claiming a fix, and test with the phone's own hardware volume keys, never with `volume_set`
  from the Mac. `volume_set` pushes through `onCommand` and makes a broken build look fixed.
- **Defect 17 is a Mac storage shape, not a Phase 4 feature** — one paired slot, structurally. It
  will be felt the first time anyone tests with two phones, and the workaround is a second instance
  with `--user-data-dir`.
- **The serverless-process window is not fixed and is Phase 6's** — a process started by the
  platform rebinding the notification listener runs `ConnectSuiteApp.onCreate`, installs every
  feature, and never starts `LinkService`. Observed for five hours on 2026-08-28. Defect 37's fix
  keeps the *capability set* correct throughout such a window; nothing makes the server come up.

---

## Two rules this phase produced, both now enforced rather than documented

Both are in CLAUDE.md as prose, and prose was not enough in either case.

1. **Never drive the UI by coordinates when a named target exists.** Written after a blind click
   pressed **Share** on a screenshot notification and opened a share sheet on the user's phone — the
   second coordinate-guessed click to do something unintended. Every Mac interaction in steps 67-69
   was driven by element id over the DevTools protocol, and every phone interaction by `adb`.
2. **Before a negative result becomes evidence, prove the query returns a known positive.** Three
   confident wrong answers in one day produced it. Every check in this phase's later steps carries
   its control, and they are recorded beside the results: the 173-button enumeration behind
   "`#call-reject` is absent", the 7-listening-socket enumeration behind "the link is down", the
   `grep -c "Listening on"` returning 0 in the window and 2 over the file.

The enforcement points that now exist: `scripts/hooks/no-force-stop.sh` (with fixtures in
`no-force-stop.test.sh`), and `scripts/check-defects.sh` wired through
`scripts/hooks/defects-in-sync.sh` so a commit cannot leave the defect register and the evidence
disagreeing. The second one exists because step 67 went unrecorded for a full sitting and nothing
in the build could tell.

---

## Step 70 — what is actually left, after the 2026-08-29 attempt

The attempt is written up in full in `docs/testing.md`. The short version:

1. **The watcher rejected a call it had already read as the wrong one.** It waited for the live card,
   read it six times — `Dialling · +919800000001`, which is neither `Ringing` nor the second person's
   number — and clicked Reject anyway, because nothing gated the action on the reading. That hung up
   the user's own outgoing call to the second person. The gate now exists
   (`scripts/step70-watch.mjs`) and refuses to click unless the card reads `Ringing` **and** carries
   the expected number.
2. **The real ring arrived 32 seconds later with nothing watching**, was answered on the phone, and
   ran 33 seconds. 36 was never exercised.
3. **Defect 42 was found**, and it is the reason a re-run needs sequencing rather than just another
   ring.

**Order for the next attempt, and the first item is not optional:**

1. Fix **defect 42** — clear `number` at the start of an episode that has no source of its own, so a
   phone-placed outgoing call reports the honest blank instead of the previous call's name. This is
   what makes step 70's reading mean what it says.
2. Rebuild, install, and re-verify preconditions against *that* build.
3. Then ask for the one ring, driven by `scripts/step70-watch.mjs 8800000004`.

If the second person cannot be asked again soon, the alternative that preserves the control without
fixing 42 first is a ring from a number **no preceding episode touched**, with the preceding
episode's number recorded beforehand. That is strictly worse: it makes the result depend on
remembering to arrange it.
