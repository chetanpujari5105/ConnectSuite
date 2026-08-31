# Ground truth before step 70 — 2026-08-30

A read-only census taken before arming anything, because `docs/RESUME.md` is dated 2026-08-29 00:50
and several of its load-bearing facts have moved. Nothing here was armed, reinstalled or dialled;
the phone was read only. Sections 1-7 answer the questions as asked. Sections **8** and **9** were
not asked for and are recorded because they came up while checking sections 1 and 5, and both change
what the next sitting should do.

**This file is a snapshot, not a plan.** `docs/RESUME.md` is deliberately left stale so the gap is
visible; it should be rewritten against this document, not before it.

---

## 1. Option 4 — implemented, uncommitted

Two files, both **modified but not committed**:

- `sync-module/.../v2/CallNumberRules.kt:134` — `shouldCorrectCard(before, after, episodeLive)`, the
  pure predicate: `episodeLive && after.isNotBlank() && after != before`.
- `sync-module/.../v2/CallWatcher.kt:309-333` — the wiring, inside the
  `ACTION_PHONE_STATE_CHANGED` receiver, immediately after the existing `number taken / not taken`
  log line.

**The event it fires on:** the `PHONE_STATE` broadcast itself, at the moment `EXTRA_INCOMING_NUMBER`
changes the field — not a timer, not the state transition. It re-resolves `ContactsFeature.nameFor`
and re-pushes `MessageType.CALL_INCOMING` for the same `callId`, and bumps `episodesCorrected` which
is logged against `episodes` as the denominator.

**Tests: 4, all green.** `CallNumberRulesTest` now holds 13 cases, of which four are option 4's —
verified from the JUnit XML, not by counting `@Test`:

```
:sync-module:testDebugUnitTest — 13 tests, 0 failures, 0 errors
   ok the card is corrected when the number arrives during the ring
   ok a broadcast that changed nothing does not re-publish the card
   ok a number arriving after the call ended draws no card
   ok a still-blank number corrects nothing
```

The honest limit: those four cover the **predicate**. The `CallWatcher.kt` wiring — that the push
actually happens, with the resolved name — has **zero** tests, because it is Android-coupled. It has
never run on a phone.

---

## 2. Not on the phone — the installed build predates it

```
$ adb shell dumpsys package com.chetan.connectsuite.debug | grep -E "versionCode|lastUpdateTime"
    versionCode=1 minSdk=29 targetSdk=36
    lastUpdateTime=2026-08-29 10:01:54
```

That is the defect-42 instrumentation build — the same fingerprint the decision brief names as the
one it measured on. Option 4 is in the working tree, written today, never built into an APK.
**Plainly: the installed build predates option 4.**

What installing costs, from `docs/RESUME.md:38` and the preconditions table:

- `READ_CALL_LOG` and `READ_PHONE_STATE` runtime grants — survive reboot, **do not survive a
  reinstall** (precondition 2).
- The notification-listener binding, and with it the `remote` capability that
  `MediaSessionManager.getActiveSessions` is gated on.
- The AccessibilityService enablement — cannot be re-granted programmatically; a hand walk through
  Settings.
- `Watching PHONE_STATE` re-registers, which resets the `since start` counters — precondition 5 says
  expect `1 of 1`, not continuity.

**The snapshot/restore script does not exist.** `scripts/` holds exactly five files
(`check-defects.sh`, `hooks/`, `step70-gate.mjs`, `step70-gate.test.mjs`, `step70-watch.mjs`).
`git log --all` finds no file ever named snapshot or restore, and the only match for "snapshot"
anywhere in `docs/` or `scripts/` is `docs/testing.md:6000`, about a UI default state. If you
remember one from the previous session, it was never committed.

---

## 3. Defects 36, 42, 45, 28

| # | `docs/defects.md` status | Evidence line it carries |
|---|---|---|
| **36** | **fixed, awaiting step 70** (`defects.md:52`) | precedence verified by step 69; `testing.md:5190` — *"No `call.reject` was sent for `c3`; the Mac's counter reads `0 acted on`."* The `type=5` + `missed` pair seen was the **phone**-rejected case, documented as correct, not 36. |
| **42** | **fixed** — outgoing verified, inbound unit-tested only (`defects.md:58`, section heading at `:234` still reads *open (reopened 2026-08-29)*) | `c1` blank vs `c2` showing `+919900000002 (Contact B)` against platform row `+918200000005`. Outgoing on hardware 2026-08-29. |
| **45** | **open** (`defects.md:61`, section `:267`) | Heading still reads *"`EXTRA_INCOMING_NUMBER` never arrives on Android 16"* with a correction paragraph beneath it. **This is the register's stale row** — the brief is decided, the register is not. |
| **28** | **closed**, 2026-08-28, three copies found (`defects.md:44`) | `testing.md:6156` — 10 enumerated functions (was 7), `notifications.ts` touches `.package` nowhere, 10 tests pass. Its *class* is open elsewhere as **defect 46** (`renderer/remote.ts:134`, `main/remote.ts:185`). |

---

## 4. `docs/phase-4-closeout.md` — Phase 4 still open

Line 3: *"Phase 4 is **not closed, and the reason changed**."* It lists as remaining, in order
(lines 120-131):

1. Defect 42's inbound half — **since done.**
2. Defect 45 — decide between `CallScreeningService` / `InCallService` / platform wall.
   **Decided in the brief, not reflected here.**
3. Then step 70, "which will need one ring to prove 35c and 36 together."

It also carries `35c FAILED` and `36 Still untested`, and one instruction now contradicted by the
brief: **"Do not ask anyone for another ring."**

---

## 5. Live renderer DOM — all five selectors resolve

Queried over CDP on 9222 against `dist/renderer/index.html`. Control first: 1688 elements, 106 ids,
226 buttons, `innerWidth === outerWidth === 1440` (not zoomed).

| Selector | Found? |
|---|---|
| `#call-live` | **found** (1) |
| `#call-live .call-who` | **found** (1) |
| `#call-live .muted.small` | **found** — but **2 match**, not 1 |
| `#call-answer` | **found**, in the ringing state only |
| `#call-reject` | **found** (1) |

Two qualifications, both established by driving the pane rather than reading the source:

- `#call-answer` returned **0** on first read. That is state, not rot — `calls.ts:162` builds it only
  when `state === 'ringing'`. I drove `calls.call` to `ringing` synthetically (renderer only, no
  IPC, no phone), got `#call-answer` → 1 with status `Ringing` and reject labelled `Reject`, then
  restored the prior object exactly. Also confirmed `hidden` is still how the card hides:
  `calls.call = null` → `className: "call-live hidden"`.
- `.muted.small` matching **2** is a real fragility. The second is the Bluetooth audio note
  (`calls.ts:182`). `querySelector` takes the first, which is still the status line, so the watcher
  reads correctly today — but it is one DOM-order change away from reading "Audio stays on the
  phone…" as the call status, and the gate would then refuse every card.

---

## 6. `scripts/check-defects.sh`

```
check-defects: 30 numbered rows, all with records; open defects all carry a fix direction
exit 0
```

It checks existence, not status wording — so it passes while 45 reads `open` in the register and
`decided` in the brief.

---

## 7. Uncommitted

```
 M docs/decision-45-inbound-caller-id.md
 M scripts/step70-gate.mjs
 M scripts/step70-gate.test.mjs
 M scripts/step70-watch.mjs
 M sync-module/.../v2/CallNumberRules.kt
 M sync-module/.../v2/CallWatcher.kt
 M sync-module/.../v2/CallNumberRulesTest.kt
?? Mac app UI mockups (1)/2026-08-30_…Claude.md
```

396 insertions. `step70-gate.mjs` gained `isBlankInboundCard` and an opt-in `--allow-blank-number`
waiver; its test file went 8 → **14** cases, all passing.

---

# 8. c13 — the seventh episode, and what it costs the "every time" claim

**Not asked for. Found while checking whether the Mac's card was synthetic.**

## What it was and when

`c13` is an inbound episode that began at **19:14:41.873 today**, twenty-five minutes before this
census was taken and **after `docs/decision-45-inbound-caller-id.md` was written**. It is therefore
absent from that document's table of six, which is the only reason the table reads as unanimous.

## The readings it produced, in full

```
19:14:41.873  Call c13 ringing number withheld by the platform — 1 of 13 episodes with a number
19:14:42.041  PHONE_STATE RINGING: number absent, episode live — not taken — 31 with / 32 without
19:14:42.041  PHONE_STATE RINGING: number absent, episode live — not taken — 31 with / 33 without
19:14:56.173  PHONE_STATE OFFHOOK: number absent, episode live — not taken — 31 with / 34 without
19:14:56.173  PHONE_STATE OFFHOOK: number absent, episode live — not taken — 31 with / 35 without
```

Four broadcasts, **every one `number absent`**. No `Call c13 ended` line follows, and the log has no
entry of any kind after 19:14:56.173.

## The control that makes this discriminating

Each `PHONE_STATE` transition on this device is delivered **twice**, at an identical millisecond.
On every other episode the pair splits — the first copy carries no extra, the second does:

```
c9   18:27:15.784  RINGING: number absent,  episode live — not taken
c9   18:27:15.791  RINGING: number present, episode live — taken        (+8 ms)
```

For c13 **both copies of both transitions read absent**. So this is not the log failing to
distinguish present from absent — the same instrumentation, on the same build, in the same process,
separated the two paths correctly for c9-c12 minutes earlier. It is a genuine non-arrival.

There is a second, independent control: the platform's own call log has **no row for 19:14** at all.
Newest three rows, read this sitting:

```
Row: 0 _id=11710, number=+918800000004, type=1, date=1788097183428, duration=25   → 19:09:43 (c12)
Row: 1 _id=11709, number=+917200000008, type=1, date=1788096405068, duration=51   → 18:56:45 (c11)
Row: 2 _id=11708, number=+918800000004, type=3, date=1788095321940, duration=0    → 18:38:41 (c10)
```

So c13 produced `PHONE_STATE` RINGING **and** OFFHOOK and yet left no call-log row. Whatever it was,
it was not an ordinary completed cellular call, and that is itself the most likely reason no number
came with it.

## What it changes

**About defect 45: the measurement is 6 of 7, not 6 of 6, and the brief's wording is now wrong.**
`docs/decision-45-inbound-caller-id.md` says the extra *"lands during the ring, every time, within
~110 ms"* and *"on all six episodes measured"*. Both need correcting — not softening, correcting,
with c13 as a seventh row reading *no arrival*. The failure mode this project keeps writing rules
about is a count without its denominator; six arrivals with the one non-arrival left off the table
is the same shape.

**About the decision itself: nothing.** Option 4 was chosen because it costs no grant, no role and
no onboarding, and because it degrades honestly. c13 is exactly the degradation working:
`shouldCorrectCard` returns false when the number never arrives, no correction is published, and the
card stays `Unknown number` — which is the true answer. The test named *"a still-blank number
corrects nothing"* is c13's case, already green. **c13 weakens the brief's prose, not its
conclusion.**

**About 35c:** it lowers the confidence that a single ring will pass. If the ring behaves like
c9-c12 it passes; if it behaves like c13 the card stays blank and 35c fails for a reason that is now
*documented rather than mysterious*. That is a materially better failure than 2026-08-29's, but it
is still a failure, and step 70 should be armed knowing one episode in seven has looked like this.

**About 36: nothing at all.** 36 is derived from the state transition and the reject flag and has
never needed the number. c13 is silent on it.

---

# 9. Defect 47 — an episode that never ends leaves a live card on the Mac forever

**Not asked for. Found because the Mac's card was showing a call that had been over for 25 minutes,
which I first mistook for leftover synthetic data. It is not synthetic; it is `c13`.**

Severity: **Medium.** Nothing is destroyed and no wrong call can be hung up (see *Can it block a
reject click*, below, which is the part that could have been much worse and is not). What it costs
is a Mac that states something false about the phone, indefinitely, with no path back.

## What gets stuck

Two things, in two processes:

1. **`CallWatcher`'s episode.** `callId` and `state` are cleared in exactly one place —
   `CallWatcher.end()` (`CallWatcher.kt:433`), reachable from exactly one caller: the
   `CALL_STATE_IDLE` branch of `onState` (`CallWatcher.kt:391`). No IDLE, no `end()`, and the
   watcher believes an episode is live forever.
2. **The Mac's card.** `CallClient.current` (`desktop/src/main/calls.ts:64`) is documented as *"Set
   by `call.incoming`, cleared by `call.ended`"* and that is literally exhaustive — `onEnded` is the
   only writer of `null`.

## What leaves it stuck

The proximate cause is that the phone emitted `RINGING` and `OFFHOOK` for c13 and then **nothing** —
no IDLE from the `TelephonyCallback`, no IDLE from the broadcast receiver, and no further log line of
any category after 19:14:56.173. Both listeners are registered in-process and stop together, so the
readings are consistent with the app process going away between OFFHOOK and IDLE. That is the same
territory as the serverless-process window `docs/phase-4-closeout.md` hands to Phase 6; this defect
is about the *consequence*, which is Phase 4's and is fixable independently.

What makes the consequence permanent is a design gap on both sides, and this is the part worth
fixing rather than the process death:

- **The phone never says "no call".** `CallFeature.replayTo` (`CallFeature.kt:117-123`) sends
  `call.incoming` when there is a live call and **returns silently when there is not**:
  `val live = CallWatcher.current() ?: return`. A reconnecting Mac holding a stale card is told
  nothing, so it keeps it.
- **The Mac's refresh does not reconcile.** `refreshCurrent()` (`renderer/calls.ts:116`) calls
  `bridge.callCurrent()` → `ipcMain.handle('call-current', () => calls.currentCall())`
  (`main/main.ts:733`) → `return this.current`. It re-reads **the Mac's own cache**. There is no
  request that asks the phone what is actually happening, so no amount of refreshing can clear it.

The one path that does clear it is `setAdvertised(false)` (`renderer/calls.ts:94-101`), which blanks
the pane when the `calls` capability stops being advertised. That it has not fired is why the card
is still on screen.

## How it presents on the Mac

Read live from the renderer this sitting:

```json
{ "call": { "callId": "c13", "number": "", "startedAtMs": 1788097481871, "state": "active" },
  "who": "Unknown number" }
```

Drawn as: headline **`Unknown number`**, status **`In progress`**, one **`Hang up`** button, and the
Bluetooth audio note. No `#call-answer`, because the state is `active` and not `ringing`. It is
indistinguishable, on screen, from a real call in progress — there is no age, no timestamp and no
staleness indicator on the card.

## Can it block a reject click?

**No, and the reason is a deliberate design that is worth not breaking.**

**Provenance, because this one is easy to mistake for a reassuring assumption: it was verified by
reading the refusal path, not inferred from the card's behaviour.** I expected the opposite — that a
stale card's `Hang up` could reach `telecom.endCall()` and drop whatever call was live at the time,
which is the step-70 accident's shape. The three layers below were each read in source and are cited
by line; no click was made, and none is needed to establish them, because the refusal happens before
`endCall` is reached (`CallFeature.kt:222` and `:226` both `return refuse(...)` above the
`runCatching { telecom.endCall() }` at `:236`). This is step 61's protection doing work nobody asked
it to do today.

Three layers already stand between a stale card and somebody's real call:

1. The Mac **always sends the `callId` it is showing** and never uses the protocol's "omitted id
   means the call in progress" shape. The file comment at `main/calls.ts:20-34` explains why: this
   is step 61's lesson, that a card outliving its call turns an omitted id into *"reject whatever is
   ringing now, which may be a different person entirely."*
2. The phone refuses on `CallWatcher.currentState() == null` with `NothingRinging`
   (`CallFeature.kt:222-224`).
3. If an episode *is* live but is a different one, `matchesRequestedCall` refuses with
   `DifferentCall` (`CallFeature.kt:226`).

So pressing `Hang up` on the c13 card cannot end a later, real call. It produces a refusal with a
sentence, which is the designed outcome — the same path the `--stall-call-ended` debug switch
(`main/calls.ts:101-107`) exists to exercise on purpose. **The blast radius here is a false
statement on screen, not a dropped call.**

The narrower question for step 70: the stale card does not block the watcher either. `onIncoming`
sets `this.current = call` unconditionally (`main/calls.ts:87`), so the next real `call.incoming`
**replaces** c13 rather than queuing behind it. Until then `scripts/step70-watch.mjs` reads
`status="In progress"`, and the gate refuses it and says so — that exact card is already one of the
14 fixtures in `step70-gate.test.mjs`: *"REFUSE the call it actually hung up on 2026-08-29"* shares
its shape, and the console line reads `SKIPPING a live card, not touching it — state is "In
progress", not Ringing`.

## Reproducible, or a one-off?

**Honestly: observed once, and I will not claim more than that.** Within the 45 log lines captured
this sitting, episodes `c9`, `c10`, `c11` and `c12` each carry a `Call cN ended …` line and `c13`
alone does not — so **1 of 5** in the observed window. I did not re-read the whole log to count
earlier occurrences, because doing so was outside this pass.

What *is* structural rather than incidental, and needs no second sighting to be true: the two gaps
above. `replayTo` returning silently on no-call, and `call-current` answering from the Mac's own
cache, mean that **any** missed `call.ended` is permanent — whatever causes it. The trigger may be
rare; the irrecoverability is unconditional.

## Fix direction

Make the phone able to say *no call*, and make the Mac ask. `replayTo` should send an explicit
"nothing in progress" on connect rather than returning, and `call-current` should be a round trip to
the phone with the Mac's cache as the fallback when the link is down — at which point a reconnect
repairs the card by itself and the process-death trigger stops mattering.

**The wrong fix to avoid: a timeout on the card.** Expiring a live card after N seconds is the
timer-shaped fix this codebase has rejected four times (36 shipped it, 37 declined it, 39 tempts it,
45 names it), and here it would blank the card during a genuinely long call — c11 ran 54.8 s and c12
ran 36.9 s this evening. The card should be cleared by a fact arriving, never by a clock.

**And the second wrong fix: reading the call log to decide whether a call is still live.** That is
defect 36's shipped wrong fix wearing a new hat, and c13 is the counter-example that proves it —
c13 has no call-log row at all, so a log-based liveness check would have called it dead for the
right answer by luck and would call a real in-progress call dead for the wrong reason.

## Register

Not yet added to `docs/defects.md` — this file is the record until it is. It takes **47**; the
register holds 30 numbered rows ending at 46, and `scripts/check-defects.sh` passes at 30, so 47 is
free.

---

# 10. The exclusion, and the near-miss that was not a near-miss

**Found by inspection on 2026-08-30, before any ring was spent and before anything went wrong.**
Nobody clicked twice. The hole was found by counting peer sessions before arming, and it is written
down here because the cheap moment to fix a rule with no enforcement point is the sitting in which
you notice it has none — `CLAUDE.md`'s last section exists because the force-stop warning was broken
four sections after it was written, by its own author, on the same day.

## What had no enforcement

`CLAUDE.md` says the reject is *"one click on `#call-reject`. Never two; it is not an arming
control."* Until today that was enforced by nobody:

- `scripts/step70-watch.mjs` took no lock, wrote no pidfile, and checked for no other instance.
- CDP on 9222 accepts any number of simultaneous clients.

Two watchers would both attach, both read the same `Ringing` card, **both pass the gate** — the gate
decides *which* call may be acted on, not *who* may act — and both click. At the time of the count
there were nine live peer sessions, one of them a background agent whose stated purpose was to click
a call control.

## What now exists

`scripts/step70-exclusion.mjs` + `scripts/step70-exclusion.test.mjs`, wired into the watcher **above
the `fetch`**, so a refusal costs nothing and touches nothing — no socket to the renderer, no adb,
no phone.

- **Lock:** `/tmp/connectsuite-step70-watch.lock`, taken with `O_EXCL` so the check and the claim are
  one operation rather than a read and a write that two watchers can interleave inside. Carries the
  holder's pid, start time and expected number. Released on `exit`, `SIGINT`, `SIGTERM`, `SIGHUP`.
  A lock whose owner is dead is stale and taken over loudly, so a Ctrl-C does not wedge the next run.
- **CDP client count:** `lsof -nP -iTCP:9222`, counting *distinct processes* on `ESTABLISHED` rows,
  excluding the listener and the caller. Refuses to arm if anything else is attached.
- **Unprovable is not zero:** if the count cannot be taken, that is a refusal, not a pass — with an
  opt-in `--skip-cdp-check` waiver that is printed beside the action, never the default. Same shape
  as the gate's `--allow-blank-number`.
- Exit code **5**, and the refusal always ends `Nothing was armed and the phone was not touched.`

## Proven, not asserted

Eight fixtures and eight controls in `step70-exclusion.test.mjs`, all passing. **Shown to fail:**
the lock clause was disabled and four fixtures went red, including the one named for the hole
(`a second watcher, with the first one still alive`) and the control `the refusal must name the pid
holding the lock`; the clause was then restored and all pass again. A test that cannot fail reads as
evidence and is not.

End to end, against the live Electron on 9222:

```
--- a second watcher, with a LIVE pid (28715) holding the lock ---
REFUSING TO ARM. The step 70 watcher will not start:
  - another step 70 watcher is already armed: pid 28715, started 2026-08-30T19:58:00,
    expecting …8800000004. … Stop it, or delete /tmp/connectsuite-step70-watch.lock …
Nothing was armed and the phone was not touched.
=== exit 5 ===

--- lock free, but one CDP client attached to 9222 ---
REFUSING TO ARM. The step 70 watcher will not start:
  - 1 other client is attached to port 9222 — a DevTools window, another session, or a second
    watcher. Any of them can click #call-reject on the same ring. …
=== exit 5 ===

live count with nothing attached: 0
```

The last line is the control: a check that reports a client when there is none, and also when there
is one, is not discriminating. It reads 0 and 1 correctly.

## Two bugs found in the exclusion itself while proving it

Recorded because both are the class of thing this file is supposed to catch, and both were caught by
running the check rather than reading it:

1. **Two lock paths exclude nothing.** Two sessions independently added a lock in the same hour —
   this one at `os.tmpdir()` (on macOS a per-user `/var/folders/…` path), the other at `/tmp`. Two
   watchers, one per implementation, would each take "their" lock and both arm. Reconciled to one
   implementation at `/tmp/connectsuite-step70-watch.lock`, which is also the path the refusal names
   and therefore has to be one a person can find.
2. **The client count overstated itself.** The first version counted `lsof` rows and halved them, on
   the assumption that each loopback connection appears twice. It does — but one CDP client holds
   *two* connections, a keep-alive socket for `GET /json` and the WebSocket, so a single attached
   watcher was reported as **"2 other clients are attached"**. A refusal that overstates its own
   evidence is precisely the defect shape this project files. Now counts distinct pids, with the
   real captured `lsof` output as a fixture and three controls: one client holding two sockets reads
   as 1, a bare listener reads as 0, and the caller is excluded from its own count.

---

# 11. The second terminal's account, on the record

**Superseded in part by `docs/testing.md`, "Step 70 — the arming sitting" (2026-08-30). Read the
retraction there before using anything in this section about `c13`.**

A background session, `Step 70 defect 36 phone test [bb9391]`, was found alive and was asked what it
had done and intended, before being stood down. **It was this project's own user, in a second
terminal** — established by the user directly on 2026-08-30, not inferred here. It has been told so
and has stood down for good. Its two judgement calls were correct: it refused a second-hand
reassignment of the ring, and escalated the question to its own user rather than accepting it from
a peer session. Its runs are therefore this project's runs, and its answer settles two things that
would otherwise have been attributed by guesswork.

**It armed a watcher three times and clicked once — on a synthetic element, not the app's.**

| Run | Time | Outcome |
|---|---|---|
| a | 18:55:36 | rehearsal against an injected card; `CallsView` re-rendered and wiped the injection, watcher timed out 18:56:36. **No click.** |
| b | 18:59:24 | rehearsal with an injector holding a synthetic card present; matched, held 6 s, **clicked at 18:59:31** on an injected `#call-reject` it had created, whose only listener incremented a window global. **No reject reached the phone.** |
| c | 19:06:07 | the real arm, pid 34699. Matched real episode **c12** at 19:09:43.938, held, and at 19:10:02.305 **ABORTED with exit 4 without clicking**, because the pre-click re-check read `In progress`, not `Ringing`. |

**Run c is hardware evidence for the gate and should be read as such.** The 2026-08-29 accident was
a watcher that read the card six times and clicked anyway. Here the same situation arose on a real
call — the card changed underneath the watcher when c12 was answered at +11.4 s — and the gate's
re-check immediately before the irreversible call refused it. That is `CLAUDE.md`'s *"a check that
does not gate the action is decoration"* working on live hardware, against the exact failure it was
written for. It cost nothing and nobody had to arrange it.

**It also settles the `call.reject delivered` line at 19:10:20.602.** That line sits in the log 18
seconds after the watcher exited and reads, to anyone reading the log alone, like the watcher's
click. It was **the user's own manual Hang up in the Mac UI**, confirmed by the user. From the log
alone the two are **indistinguishable** — `call.reject` carries no provenance on the wire or in the
log, so no reading of a reject can attribute it after the fact. Recorded as a known limit of the
evidence in `docs/testing.md`: when a reject's origin matters it is attributed by named testimony,
never by timing.

**On c13: RETRACTED, in both directions. c13's cause is open and unattributed.**

This paragraph originally attributed c13 to this session's activity window, and was then rewritten
to *un*-attribute it on the grounds that the window "spans" c13 rather than post-dating it. **Both
readings are withdrawn, and the second is the one that mattered** — it was produced by the same
technique as the first (a relative uptime string, `ListAgents`'s *"started 29m ago"*, subtracted
from a wall clock and compared against c13's timestamps), so it read as a correction while being
exactly as unsupported. A relative uptime is not evidence of what a session did; an overlapping
window is not causation and a non-overlapping one is not exoneration.

**Do not re-derive an attribution from the timestamps in this file.** Reconstructing session windows
against `19:14:41.873` is the step being retracted, not a way around it. What would settle c13 is a
phone-side artefact from that minute — a tombstone, a `logcat` death line, an `am_proc_died` record
— and none was captured before the window passed. The full retraction, and why it is written in
rather than left as a silent edit, is in `docs/testing.md`, "Step 70 — the arming sitting".

## Correction to §2 — a grants snapshot did exist, as session scratch

§2 reported that no snapshot/restore script exists in the repo. **That remains true of the repo** —
`scripts/` holds five files and `git log --all` finds none ever named snapshot or restore. But the
peer session had taken one by hand at 19:17, into its own scratch directory, where it would have
been deleted with the job. It is now preserved at
`docs/evidence/step70-grants-snapshot-2026-08-30T1917.txt` (360 bytes).

**Correction, 2026-08-30 20:25 — this sentence originally described that file as holding "11 runtime
grants, all `granted=true`, plus the notification-listener and accessibility-service secure settings
values". It holds none of that.** Opened and counted before the install, it is eleven permission
*names*, one per line, and nothing else: no `granted=` values, no listener string, no accessibility
string. Enough to know what to check, useless as a baseline to restore from — and the two
secure-settings strings, the ones that cannot be re-granted programmatically, were never captured.

A real snapshot with values was taken at 20:25, immediately before `adb install -r`, at
**`docs/evidence/step70-grants-preinstall-2026-08-30T2025.txt`**. See `docs/testing.md`, "Step 70 —
the reinstall, and what it settled".

Both sessions agree on the gap and on its shape: this is a one-off `dumpsys` read into a temp file,
not a script. **Recorded as a gap with nothing filling it.**

**And a correction to §2's cost estimate — since VERIFIED on this device, 2026-08-30 20:26:**
`adb install -r` preserves runtime grants and both secure-settings strings. All 11 grants read
`granted=true` after the install, the listener and accessibility strings were intact and
`accessibility_enabled=1`; nothing needed restoring. The *"a reinstall resets grants"* line in
`docs/RESUME.md` describes a full uninstall and is wrong for `-r`. What the install *does* cost is
the server: the process came back via the notification-listener rebind with every feature installed
and `LinkService` never running — fully granted and serverless until the launcher activity was
started by name. So the snapshot is insurance, and the right move after installing is
to **re-read all three sources and verify each individually**, rather than restoring blind or
assuming loss.

## The APK

Built **2026-08-30 19:15:45** at `app/build/outputs/apk/debug/app-debug.apk`, from the same
uncommitted working tree described in §1 and §7. The peer verified option 4 is *in* it by dex
strings rather than by trusting the build: `card corrected in place` = 1, control
`number withheld by the platform` = 1, and `BUG REINTRODUCED` = 0 — the last confirming the
deliberately-broken version used to watch the test go red is not the one in the APK. 180 phone
tests, 0 failures.

## What could not be done

`TaskStop` cannot reach a peer session — it addresses only tasks this session spawned, and returned
`No task found` for both the name and the ref. The peer stood itself down voluntarily (nothing
installed, nothing armed, no watcher running, lock released) and escalated the question of who
drives the ring to its own user rather than accepting a reassignment second-hand, which is the
correct call. **Eight interactive peer sessions remain alive and cannot be stopped from here.**
