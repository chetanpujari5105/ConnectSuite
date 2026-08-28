# Phase 4 close-out — notifications, calls, SMS/MMS, contacts, media remote

Status as of **2026-08-29**. Phase 4 is **complete except for step 70**, which needs a second person
to place one inbound call and is the last evidence 35c and 36 are waiting on.

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

**Fixed in code, awaiting step 70 — the only thing standing between here and a closed phase:**

| # | What step 70 must show |
|---|---|
| **35c** | the inbound card's headline is the caller's name or number, and the second line is `Ringing · +…` — both were blank on the run that found it |
| **36** | `call.ended cN rejected`, with `type=5` in `content://call_log/calls` as the control |

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

## Step 70 — the one thing left

Preconditions were re-verified against the **post-37, post-40 build** installed at 00:11 on
2026-08-29, not carried forward from before the rebuild. See `docs/testing.md` for the readings and
the exact sequence to give the second person.
