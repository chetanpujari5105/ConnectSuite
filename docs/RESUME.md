# Resume here — step 70, written 2026-08-29 00:50

> ## ✅ SUPERSEDED — step 70 ran and PASSED on 2026-08-31 13:43
>
> Everything below this box was written to get one ring arranged. **The ring happened and both
> defects closed**: 36 (`Call c7 ended rejected after 8197ms`, platform control `type=5`) and 35c
> (card read `Chetan` / `Ringing · +919800000001`). 42's inbound half and 45 closed with them —
> option 4 has corrected 7 of 7 episodes, 16–535 ms into the ring.
>
> The full record is `docs/testing.md`, "Step 70 — PASSED". The command that ran it was
> `node scripts/step70-watch.mjs 9800000001 9 --hold=8 --allow-blank-number --require-correction`.
>
> **Nobody needs to be asked to ring this phone again.** The preconditions, the stale-overnight
> table and the line to give the second person are all kept below as the record of how it was set
> up, and none of them is a live instruction any more.

> ## Superseded in part, 2026-08-29 morning — read this box first
>
> **Step 70 ran and 35c FAILED.** The ring came in at 09:52 before the watcher was armed and was
> decisive; **nobody needs to be asked to ring again for 35c.** It exposed defect **45** — the
> mechanism 35c depends on has never worked here — and reopened defect **42**, whose inbound half is
> now fixed and shipped.
>
> **Defect 45 is an open product decision, deliberately not taken.** The brief is
> `docs/decision-45-inbound-caller-id.md`. It needs one reading from the new `PHONE_STATE`
> instrumentation, which the next real inbound call produces at no cost to anyone.
>
> **Step 70 should be re-scoped to defect 36 alone** — 36 never needed the caller's number and is
> provable on today's build with one ring. The step-70 mechanics below (the watcher, the gate, the
> one line to give the second person, the order of reads) all still stand for that.
>
> **Phase 4 stays open. Phase 5 stays shut.**

One thing is outstanding and it needs a second person for about thirty seconds. Everything else in
Phase 4 is closed. **Do not open Phase 5** until step 70 has run.

Written because step 67 passed on hardware and went unrecorded for a full sitting, and a session
that ends at 00:50 with "we'll do it tomorrow" is the same failure with a longer gap.

**Phase 5 preparation happened after this note was first written, and none of it is implemented.**
`docs/phase-5-proposals.md` holds four prose pieces and a box of decisions already taken — read that
box before writing any Phase 5 code, and do not start until step 70 has run. `docs/protocol.md` is
deliberately unmodified.

---

## The state as of tonight

| | |
|---|---|
| Build fingerprint | the load-bearing fact is the APK below, not a commit hash — hashes go stale every sitting |
| Phone build under test | `lastUpdateTime=2026-08-30 20:26:26` — the option-4 build. **Corrected 2026-08-30: `adb install -r` does *not* reset grants.** Tested on this device — all 11 runtime grants stayed `granted=true`, the notification-listener and accessibility strings were intact, `accessibility_enabled=1`, nothing needed restoring. The old wording described a full uninstall. **What `-r` *does* cost is the server** — see the row below |
| After any `install -r` | **the phone comes back fully granted and serverless.** The process restarts via the notification-listener rebind and installs every feature — the capability log reads `calls,contacts,input,mirror,notifications,remote,sms`, which is the most reassuring line in the file — while `LinkService` never runs and no port is bound. Nothing in the app's output says so. Start it by name: `adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity`, then confirm with **`scripts/link-up.sh`** (exit 0), which is the only thing in the repo that catches this. Observed 2026-08-30 20:26; it is `LinkServer.kt:163`'s scenario |
| Mac | rebuilt and relaunched 00:46 with `--force-renderer-accessibility --remote-debugging-port=9222` |
| Phone suite | 175 tests, 0 failures |
| Mac suite | 55 tests, 0 failures, `tsc --noEmit` clean |
| Outstanding | **step 70 only** — it proves defect **36** and defect **35c**, the last two things in Phase 4 not verified on hardware |

Defects 31, 34, 35 (outgoing), 37, 40, 41, 42, 43 are closed. **17, 30, 32, 33, 38, 39 and 44** are
open with fix directions in `docs/defects.md` — 44 was added on 2026-08-29 and is the newest.
`scripts/check-defects.sh` will tell you if that list has drifted from the register; trust it over
this sentence.

---

## What to do, in order

### 1. Bring both sides up — neither survives the night

```bash
# phone: starts LinkService, which nothing else does
adb shell monkey -p com.chetan.connectsuite.debug -c android.intent.category.LAUNCHER 1

# Mac: the two flags are not optional — without --force-renderer-accessibility Chromium
# exposes one opaque AXGroup, and without the debugging port the watcher cannot read the card
cd desktop && ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222
```

Give it ~40 s and confirm `Listening on 42501/42502/42503` on the phone and
`Connected to Samsung SM-S938B` on the Mac.

### 2. Re-verify the preconditions that went stale (next section)

### 3. Arm the watcher, then ask for the ring

```bash
node scripts/step70-watch.mjs 8800000004
```

It waits up to nine minutes. **Start it before they dial.** Read
`node scripts/step70-gate.test.mjs` first if you want to see what it will and will not click — it
refuses anything that is not `Ringing` carrying `8800000004`, logs every card it declines, and
re-checks immediately before the click.

### The one line to give them

> **"Call me once, let it ring, and don't hang up until I say."**

That is all of it. They do not answer, wait for a tone, listen for anything, or call twice. It must
be a real handset — 35c turns on the platform filling `EXTRA_INCOMING_NUMBER`, which does not happen
for a simulated call. Number: **8800000004**.

### 4. The order of reads, which the watcher enforces but you should know

1. **Read the card first** — headline and second line. This is 35c and it exists only while the call
   is live.
2. **One click** on `#call-reject`. Never two; it is not an arming control.
3. **`call.ended`** — this is 36's answer. The `call.reject delivered (…)` line is **not** the
   disposition; it says so itself since defect 40.
4. **`content://call_log/calls`** — `type=5` for their number, this minute. This is 36's control.

---

## Which of the eight preconditions are stale by morning

The build is the same. The link will not be up and the counters will have moved, so five of the
eight must be re-read and three can be carried forward with a one-line check.

| # | Precondition | Tonight's reading | By morning |
|---|---|---|---|
| 1 | link up, 3 ports bound | 3 bound, connected 00:46 | **STALE — re-establish.** Neither the phone's `LinkService` nor the Mac survives the night. |
| 2 | `READ_CALL_LOG` granted | `granted=true` | **carry forward**, but re-check in one line. Runtime grants survive reboot; they do not survive a reinstall, which is why the build must not be reinstalled. |
| 3 | `Watching PHONE_STATE for the inbound number` | present 00:41:13 | **STALE, and it is the one with a trap — see below.** |
| 4 | call-log tail noted | `type=2, +919800000001, date=1787944374680` | **STALE — re-note.** Any real call overnight changes the newest row, and this row is what makes the step 70 row identifiable as *new* rather than assumed to be. |
| 5 | episode denominator | `1 of 2 episodes with a number` | **STALE, and the expected value changes.** These are `since start` counters on the phone process. A fresh process resets them, so tomorrow the ring should produce `1 of 1`, **not** `2 of 3`. Read the actual pre-ring value and expect it to increment by one; do not carry tonight's arithmetic. |
| 6 | caller is in contacts as `Contact D` | `Row: 574 display_name=Contact D, data1=8800000004` | **carry forward**, one-line re-check. It is the basis of the strict 35c clause, so confirm it rather than assume it — a contact edited overnight would silently weaken the test back into the disjunction it used to be. |
| 7 | nothing live, nothing armed, 173 buttons | live card hidden, `#call-dial` reads `Call`, input empty | **STALE — re-read.** New Electron process. The button count is the enumeration control for "`#call-reject` is absent"; take it fresh rather than quoting 173. |
| 8 | `calls: available`, `contacts: available` | both available, 12 chips, 7 on | **STALE — re-read.** Depends on the link being up and the notification listener bound in the new process. |

### The trap in precondition 3, which is worth reading twice

`Watching PHONE_STATE for the inbound number` is logged **once per process, at feature install**.
Tonight's line is still in `files/logs/link.log`, and a `grep` over the whole file will find it and
read as a pass tomorrow morning — for a process that may not have registered the receiver at all.

That is a false positive of exactly the shape this project keeps recording: a query that cannot tell
its target from a lookalike, answering confidently. **Check it within tomorrow's process window**,
e.g. filter the log to today's timestamps after the app was launched, and take the failure line's
count as the control in the same read:

```bash
adb shell "run-as com.chetan.connectsuite.debug cat files/logs/link.log" | grep -c "Could not watch PHONE_STATE"   # must be 0
```

The phone log rotates at ~512 KB (`link.log` was 71 KB tonight, `link.log.1` full), so tonight's
evidence may age out. That is fine — it is all written up in `docs/testing.md`.

---

## What a pass looks like, and the one clause that is stricter than it was

**35c** — the headline must read **`Contact D`**, not the number.

The step as first written said "their name if they are in contacts, else their number", which passes
either way and therefore tests less than it appears to. They *are* in the book, so the disjunction
collapses. The bare number is now a **failure**: `ContactsFeature.nameFor` is called once per episode
from `CallWatcher.begin`, and a number-only headline on a caller who is in contacts means that
lookup did not fire — a working feature reporting success while the integration contacts was pulled
forward into Phase 4 to enable is dead.

- phone: `Call cN ringing from 8800000004 (Contact D)` — the parenthesised name is the lookup's output
- Mac card headline: `Contact D`; second line: `Ringing · 8800000004`
- neither may be `Unknown number`, and the second line may not end at `Ringing · ` with nothing after

**36** — `call.ended cN rejected after Ns` on the Mac, with `type=5` in the platform call log for the
same number and minute. `rejected` on the Mac with no `type=5` would mean the flag is being set on
episodes that were not rejected — a different bug wearing the right answer.

**The negative control is already satisfied off-device** and does not need a second ring: step 69
exercised the `answered` branch against a live call on 2026-08-28, and the phone-side test
`every other disposition still answers, and answered outranks rejected` covers all four branches.
Ask for **one** ring.

---

## After it passes

1. Mark 35c and 36 closed in `docs/defects.md` with their evidence.
2. Update `docs/phase-4-closeout.md` — it currently says Phase 4 is not closed.
3. Run `scripts/check-defects.sh` before committing; the commit hook runs it anyway.
4. Then, and only then, Phase 5 — see below.

---

## Phase 5, when it opens — what is already decided

**Do not start before step 70.** Its first act claims `bulkChannelSink`, and a failed ring must not
be debugged through a transport change. That is the whole reason for the gate.

Everything below is in `docs/phase-5-proposals.md`, which was reviewed on 2026-08-29. **These are
decisions, not options** — the arguments are in the file; do not re-litigate them, and do not
implement an alternative without saying why the recorded reasoning is wrong.

| Decided | What |
|---|---|
| **`sms.sent` as an event**, ack left alone | The ack keeps meaning "the radio accepted this". One event closes **39 and 44** together. |
| **The delay-before-re-fetch is rejected** | Three reaches for the same wrong shape (36 shipped it, 37 declined it, 39 named it) is enough. It stays written down. |
| **The `before` cursor: option (a)** | Optional `beforeId`, ordering `dateMs DESC` then `id DESC` byte-wise, backward compatible. Chosen because it is the only option that can advance *inside* a shared timestamp; the others stall unboundedly. Applies to `sms.threads`, `sms.messages` and `call.log`. |
| **Bug 6 at 1 MB** | Separate small header cap, write-side enforcement in `Framing`, no resync, denominator on the refusal line. |
| **The package-id rule** | Now in `CLAUDE.md` beside the gate rule, not only in the proposal. |

**The finding that changes the size of the SMS work:** only **one** of 30/32/39 needs a protocol
change. The phone already implements `sms.send` with no `threadId` (defect 30 is a Mac with no
recipient field) and already pages threads by `before` (defect 32 is a missing button). So the SMS
sitting is one protocol change plus two Mac features.

**Defect 44 is new and must not be folded into 39.** Same symptom, different cause: 39 is a race the
Mac loses against its own provider read and is fixable on the Mac alone; 44 is that nothing observes
outgoing rows at all, and no Mac-side retry can invent an event it is never sent. The tempting wrong
fix — enrich the ack and stop — closes the visible half and leaves the phone's keyboard diverging
from the Mac forever.

**Suggested order inside Phase 5:** `sms.sent` first (it closes 39 and 44, and 30/32 can proceed in
parallel), then Bug 6's caps before `fs.*` has a first consumer, then the package-id rule written
into `docs/protocol.md` as `fs.*` and `media.*` are specified, then the transfer itself — borrowing
v1's absolute offsets, adaptive chunking, streaming digest and offer/accept, and none of its
transport.

## If it fails

Do not write code against 35c before diagnosing. The first branch to check is precondition 2 —
`READ_CALL_LOG` — which exists precisely to separate "the fix does not work" from "the permission
that feeds it is off". The `EXTRA_INCOMING_NUMBER` extra is populated only for a receiver holding it.
