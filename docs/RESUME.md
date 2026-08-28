# Resume here — step 70, written 2026-08-29 00:50

One thing is outstanding and it needs a second person for about thirty seconds. Everything else in
Phase 4 is closed. **Do not open Phase 5** until step 70 has run.

Written because step 67 passed on hardware and went unrecorded for a full sitting, and a session
that ends at 00:50 with "we'll do it tomorrow" is the same failure with a longer gap.

---

## The state as of tonight

| | |
|---|---|
| Last commit | `f0c6286` |
| Phone build under test | `lastUpdateTime=2026-08-29 00:41:12` — **do not reinstall**; a reinstall resets grants and bindings and invalidates the preconditions below |
| Mac | rebuilt and relaunched 00:46 with `--force-renderer-accessibility --remote-debugging-port=9222` |
| Phone suite | 175 tests, 0 failures |
| Mac suite | 55 tests, 0 failures, `tsc --noEmit` clean |
| Outstanding | **step 70 only** — it proves defect **36** and defect **35c**, the last two things in Phase 4 not verified on hardware |

Defects 31, 34, 35 (outgoing), 37, 40, 41, 42, 43 are closed. 17, 30, 32, 33, 38, 39 are deferred
with fix directions in `docs/defects.md`.

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
4. Then, and only then, Phase 5. Its shape is in the close-out: start with the protocol decision for
   **30/32/39**, which all three share, and fold **33** in wherever `fs.*` and `media.*` put a
   package id into a user-visible string.

## If it fails

Do not write code against 35c before diagnosing. The first branch to check is precondition 2 —
`READ_CALL_LOG` — which exists precisely to separate "the fix does not work" from "the permission
that feeds it is off". The `EXTRA_INCOMING_NUMBER` extra is populated only for a receiver holding it.
