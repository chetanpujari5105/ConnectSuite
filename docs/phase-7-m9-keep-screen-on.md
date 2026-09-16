# M9 — *Keep screen on* while mirroring

> **Written 2026-09-15, and it implements nothing.** M9 was the fifth item in a batch of five; the
> other four shipped and are on hardware. This one stopped at the pre-registration, and the reason is
> the point of the file: **the mechanism is unknown on this handset, and the outcome of building it
> blind is a toggle that reports success and does nothing.**
>
> `CLAUDE.md` names that outcome twice — it is row 4 of the `apps.*` table, *"a verb that returns
> success and does not launch is worse than an absent one, and it is the outcome every automated
> check would call a pass"* — and it is the reason `MessageType` has no `APPS_LAUNCH`. A *Keep screen
> on* switch that the platform ignores is the same object with a different label, and it is worse
> than M9 staying unbuilt, because an unbuilt row is honest and a dead switch is a lie the user
> re-tests every session.

## 1 · What M9 is, and what it is not

`docs/design-departures.md` → **M9**: an Advanced toggle in the Mirror pane, *"Keep screen on"*,
**not drawn**, **unbuilt**, with the note *"Nothing on the wire. Not a wall — the phone can hold a
wake lock while a session is running."*

**It is the phone's screen.** M9 sits between M6 (*Phone screen off*) and M8 (*Show touches*), which
are both phone-side, and the whole Advanced group is about the device being mirrored.

**There is a Mac-side feature that sounds identical and is a different thing** — keeping *this Mac*
awake while mirroring, via Electron's `powerSaveBlocker`. It is real, it is worth building, and
**calling it M9 would be `CLAUDE.md`'s "true sentence about the wrong one of two paths"**: everyone
who checked would find a working mechanism and stop. If it is built it gets its own row.

## 2 · Why this is a measurement and not a build

The phone's screen is kept awake by one of two mechanisms, and **neither is obviously available to
this app**:

| | Mechanism | Why it may not work here |
|---|---|---|
| A | `PowerManager.SCREEN_BRIGHT_WAKE_LOCK` / `FULL_WAKE_LOCK` | **Deprecated since API 17**, with the docs pointing at B instead. Still accepted by `newWakeLock`, so it fails — if it fails — *silently and at runtime*, which is the worst of the three ways an API can be gone |
| B | `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` | Needs a **visible Activity**. `MirrorService` is a foreground service with no window, and `MirrorConsentActivity` finishes as soon as consent is collected. There is no window to set the flag on |
| — | What exists today | `LinkService` holds a **`PARTIAL_WAKE_LOCK`** (`LinkService.kt:203`). That keeps the **CPU** awake and says nothing about the screen. Nothing in this repo has ever held a screen lock |

Two further reasons the answer cannot be taken from documentation:

- **This is One UI.** `docs/single-device-audit.md` exists because vendor behaviour has already
  diverged from AOSP twice in this project, and Phase 6 is an entire phase about Samsung's power
  management doing something the documentation does not describe. A screen wake lock is squarely
  inside the subsystem One UI modifies most.
- **Every hardware reading in this repo came from one SM-S938B.** Whatever comes back is a
  single-device reading and must be recorded as one.

## 3 · The pre-registered decision table

**Written before the reading, so nothing can be rationalised afterwards.** Four outcomes; two of them
produce no feature.

| | Reading | The product |
|---|---|---|
| **1** | `SCREEN_BRIGHT_WAKE_LOCK` is granted **and** the screen demonstrably stays on past the timeout | **Build it, and build it unconditionally** — no toggle. M9's own row says *"or simply doing it unconditionally while mirroring, which is arguably the right behaviour anyway"*, and a mirror session whose subject goes dark is a broken mirror, not a preference. The notification already says the screen is being recorded |
| **2** | Granted, screen stays on, **but only while an Activity of ours is foreground** | **No feature.** Mirroring's whole point is that the phone is in your bag. A toggle that works only when you are holding the phone is the silent no-op wearing a condition |
| **3** | `newWakeLock` throws, or the lock is refused | **No feature, and M9 becomes a wall** — recorded in `docs/design-departures.md` beside M6 and M8 with the reading that made it one |
| **4** | Granted, **and the screen turns off anyway** | **No feature, and the sharpest outcome to catch.** The lock is held, `dumpsys` lists it, every log line says success, and the screen is off. This is the row every automated check passes. It must be decided by watching the screen, not by reading the lock |

**Row 4 is why the criterion below is a screen state and never a wake-lock listing.** `CLAUDE.md`'s
registration-versus-execution rule, in its purest form: *"the receiver is running" is not "the branch
fired"*, and *"the lock is held"* is not *"the screen is on"*.

## 4 · The reading, as commands

Needs the user's hands once, for the MediaProjection consent tap — that cannot be automated and
`CLAUDE.md` says so. Everything else is below.

```sh
# 1. Shorten the timeout so a trial is a minute rather than ten. It is 600000 on this device now;
#    put it back afterwards — this is a state change, so it goes through the pin.
scripts/adb-pinned.sh samsung shell settings get system screen_off_timeout      # control: 600000
scripts/adb-pinned.sh samsung shell settings put system screen_off_timeout 30000

# 2. Start a mirror session from the Mac and tap consent on the phone.

# 3. The CONTROL, and it comes first: with no screen lock held, the screen must actually go off.
#    Without this, "the screen stayed on" cannot be told from "the timeout never fired".
scripts/adb-pinned.sh samsung shell dumpsys power | grep -E 'mWakefulness|Display Power'

# 4. Then with the lock. The verdict is `mWakefulness=Awake` and `state=ON` a minute after the last
#    touch — NOT the presence of a row in the wake lock list, which is row 4 of the table above.
scripts/adb-pinned.sh samsung shell dumpsys power | grep -A5 'Wake Locks'

# 5. Put the timeout back.
scripts/adb-pinned.sh samsung shell settings put system screen_off_timeout 600000
```

**The control in step 3 is not optional.** A run that never let the screen time out would report
"the screen stayed on" for a build with no lock in it at all, which is this repo's most-repeated
instrument fault and would certify row 4 as row 1.

## 5 · What would be built, on row 1

`MirrorService` already brackets the exact window: `onStartCommand` → `onDestroy` is *"while pixels
are being captured"*, which is precisely the interval the screen should stay on. The lock is
acquired beside `startForeground` and released in `onDestroy`, and it follows defect 61's rule —
**re-acquire before the timeout rather than repairing a lapse** — because a screen lock that lapses
for nineteen minutes is a mirror that went black and came back, and the user is not in the room.

Counters go on the same line as their denominator, per the logging rule: acquires beside releases,
and the held duration beside the session duration.

