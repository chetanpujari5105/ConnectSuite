# Phase 6 — background reliability on One UI

> **Status: open, no code written.** This is the brief, and it answers one question before anything
> else: **what can this handset actually prove.** Phase 6 is the first phase where
> `docs/single-device-audit.md` stops being a footnote — battery management is the most
> vendor-specific surface on Android, and every reading this project holds comes from one SM-S938B.

## 0. The finding that has to come first, because it invalidates the obvious experiment

**This device is already exempt from battery optimisation, so it cannot measure the default state.**

```
$ adb shell dumpsys deviceidle whitelist | grep connectsuite
user,com.chetan.connectsuite.debug,11011
$ adb shell am get-standby-bucket com.chetan.connectsuite.debug
5                                    # EXEMPTED
```

The control, so the first line is not read as a lookalike: there are **10** `user,` entries on this
device and ours is one of them, listed beside Samsung's own launcher and Notes. It is not a
system entry, not a temporary allowance, and not an artefact of `adb`.

And it is **not an accident** — `OnboardingScreen.kt:258` asks for it and the exemption was granted.
That is the intended state, which reframes the phase:

- The question is **not** *how do we survive battery optimisation*. It is **what still breaks while
  exempt** — because Samsung's Device Care runs a second set of restrictions on top of AOSP's, and
  because a person can revoke the exemption at any time.
- Every run measured on this handset as-is describes the **exempt** path. Any claim about the
  unexempt path needs the exemption removed first and restored after, which is a change to somebody's
  own phone and belongs in §1.

**This is exactly the fault the control table keeps recording**: the instrument's own state
contaminating the reading. A Phase 6 that starts by running the app overnight and reporting "it
survived" would be reporting the exempt case as the general one.

## 1. What needs your hands, and why each one cannot be automated

| # | What | Why it needs you |
|---|---|---|
| **H1** | **Decide whether the unexempt path is in scope at all.** If it is, the exemption has to come off this phone for a measured window and go back on | It is your device and your battery. `dumpsys deviceidle whitelist -pkg` can do it from adb, but doing it to somebody's phone without asking is the force-stop lesson with a different command |
| **H2** | **Samsung Device Care's own restriction lists** — *Sleeping apps*, *Deep sleeping apps*, *Put unused apps to sleep* | Not reachable from `adb` in any documented way. The state lives in `com.samsung.android.sm`'s private storage; it is a Settings UI toggle and reading it means looking at the screen. Two taps on this session have already landed in a private conversation, so this one is yours |
| **H3** | **An unplugged overnight run** — the only thing that produces a real `batterystats` figure | The phone must be off the cable and untouched for hours. Nothing about that is automatable, and the reading is worthless with `adb` holding it awake |
| **H4** | **A reboot** | Cheap, but disruptive to whatever you are doing. §2 explains why this one matters more than it looks |
| **H5** | **Whether a second device is worth acquiring**, and which | §3. A Pixel converts more `unknown` rows than any other single purchase |

## 1a. What H1 actually costs — measured 2026-09-03, decision still open

The brief asks for H1 without saying what it costs, which makes it unanswerable. This section is the
costing. **Nothing here has been done to the phone; every command below is quoted, not run.**

### The current state, re-read after the 11:16 reboot

```
dumpsys deviceidle whitelist | grep connectsuite  →  user,com.chetan.connectsuite.debug,11011
am get-standby-bucket com.chetan.connectsuite.debug  →  5   (EXEMPTED)
dumpsys deviceidle whitelist | grep -c '^user,'   →  10    ← the control: ours is one of ten
```

### Can it be put back? Yes, three independent ways, and one caveat that matters

| Route | Command or path | Notes |
|---|---|---|
| **adb** | `dumpsys deviceidle whitelist +com.chetan.connectsuite.debug` | The `+`/`-` syntax is in *this build's own* `dumpsys deviceidle -h`, not inherited from documentation |
| **Settings UI** | Apps → ConnectSuite → Battery → **Unrestricted** | No computer needed |
| **The app itself** | `SpecialAccess.requestIgnoreBatteryOptimizations` fires `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` from onboarding; `AppPermissions.isIgnoringBatteryOptimizations` reads the true state back | The same prompt that granted it originally |

**The caveat, and it is the only genuinely sharp edge: the removal persists across boots.** This
build's help text draws that distinction itself — `except-idle-whitelist` says *"changes made using
this won't be persisted across boots"* and plain `whitelist` says no such thing. So **rebooting is
not an escape hatch**; if the phone is left unexempt and forgotten, it stays unexempt.

**One inference, flagged rather than asserted:** bucket `5` is *derived* from the whitelist — that is
P6's finding, which is why `am set-standby-bucket … 5` is refused. Re-adding to the whitelist is
therefore expected to restore `EXEMPTED`, and it is one command to confirm (`am get-standby-bucket`)
rather than something to assume.

### What stops working while unexempt

Only while the phone is **actually in Doze** — screen off, off charger, stationary, for a while.
**While the phone is in use, nothing changes.** A foreground service keeps the process alive; it does
not exempt it from Doze's network restrictions, and a `PARTIAL_WAKE_LOCK` is ignored for a non-exempt
app in deep idle. So, from what this app is built out of:

| | Expected while idle and unexempt |
|---|---|
| Control socket | stalls; the heartbeat (`PING_INTERVAL_MS = 5_000`, `MISSED_PONGS_BEFORE_DEAD = 3`) declares the link dead ~15 s after the network is suspended |
| Notification mirroring, SMS, call events | stop arriving on the Mac |
| Clipboard **Mac → phone** | stops — it is a push, and the push has nowhere to land |
| Recovery | on screen-on/unlock, and it depends on **the Mac's** reconnect, because P4 records that the phone has no screen-off or connectivity handling of its own |

**These are predictions from the code, not readings — producing them is the point of the experiment.**

### The real risk, and it is not the exemption

**Samsung's Device Care may add the app to *Sleeping apps* while it is unexempt**, and that is a
*separate* list (H2) which the exemption does not govern and which restoring the exemption does not
necessarily clear. It is a Settings UI toggle, readable and removable by hand, but it is the one
outcome where undoing H1 does not undo everything H1 caused. Check H2's screen before and after.

### RUN 2026-09-03 — and the caveat travels with the result

**No difference detected**, exempt vs unexempt, over a 150 s forced deep-Doze window — **and the
standby bucket was `ACTIVE` throughout, never `RARE` or `RESTRICTED`.** Those two clauses are one
finding and neither may be quoted without the other. Removing the whitelist removes the Doze
exemption; it does not make the app unused, and the harsh restrictions live in the low buckets.
**Unexempt and unexempt-and-neglected are different experiments; only the first ran**, and P6 — the
cheap route to the second — is withdrawn, so the second has no route on this handset that does not
leave the phone degraded for days. `docs/testing.md` → Phase 6 Slice 8.

Two things settled in passing: P6's inference is now measured (removing the row dropped the bucket
5 → 10, restoring it put it back to 5 with no bucket command issued), and the probe itself was
**asserting the condition it was measuring** — `doze-probe.sh` hard-coded "EXEMPT PATH" and would
have printed it over the opposite. It reads the whitelist at run time now.

**H2 remains unanswered.** It was asked for on 2026-09-03 and the reply came back as an unfilled
template, so neither branch of it is recorded here. Nothing in this repo knows whether ConnectSuite
is in Device Care's *Sleeping apps* lists, before H1 or after — which is the one outcome undoing H1
does not undo.

### The recommendation: bound it to ~30 minutes, not overnight

**H1 does not need an overnight run, and should not have one.** This phone is a daily driver and the
clipboard path is in daily use; a night of degraded linking is a real cost for a reading that can be
taken in half an hour.

P2 already produced deep Doze **on demand** on the exempt path with `dumpsys deviceidle force-idle`,
which makes the unexempt run a direct A/B against an existing measurement rather than a fresh
experiment. Shape: read H2's screen, remove the exemption, force idle, take the reading with the
§0 caveat inverted in every line of it, `unforce`, restore the exemption, confirm the bucket is back
at 5, re-read H2's screen.

**And the overnight question is separate and belongs on the exempt path anyway** (H3), because exempt
is what ships. Measuring battery cost unexempt would answer a question about a configuration no user
of this app is in.

## 2. What this handset can prove on its own

All of these are runnable with the phone attached and no second device. **Ordered by what they would
change**, not by how easy they are.

### P1 · The boot gap, and it needs no device at all — **built 2026-09-02**

> **Done, with one half proven and one half owed.** `LinkBootReceiver` takes `BOOT_COMPLETED`,
> `QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED`; the last of those fired for real on `adb install -r`
> and had the link listening 1.5 s later. The boot half cannot be produced from a laptop —
> `BOOT_COMPLETED` is protected, `adb root` is refused on this production build — so it is H4's to
> confirm. `docs/testing.md` → Phase 6 Slice 1 carries the readings, including two that changed the
> design: `FGS_BOOT_COMPLETED_RESTRICTIONS` is live for this package (so a boot start claims
> `connectedDevice` only, never `dataSync`), and the start that succeeded was granted under
> `PROC_STATE_BFGS` rather than under the battery allowlist §0 predicted.

The original finding, kept because the enumeration is the useful part:


`RECEIVE_BOOT_COMPLETED` is declared in `app/src/main/AndroidManifest.xml:35`. **Nothing receives
it.** The control: two `<receiver>` elements exist in the whole project, both in
`sync-module/src/main/AndroidManifest.xml`, and neither carries a `BOOT_COMPLETED` filter.

So **the link does not come back after a reboot** — the phone binds the sockets, and after a restart
nothing binds them until somebody opens the app. This is the same shape as `adb install -r` leaving
the app serverless, which `CLAUDE.md` already documents, arriving by a second route nobody had
written down. It is a static finding, it needs no measurement, and H4 is only needed to *confirm* it
rather than to discover it.

It is also the first Phase 6 defect: a declared permission with no implementation is the manifest
version of a message type in the inventory and specified nowhere, which is what
`check-protocol-spec.mjs` exists for.

### P2 · Doze, forced rather than waited for — **run 2026-09-02, exempt path, link intact**

> Three minutes of `deep=IDLE` with all listeners bound, the control session established, and — the
> control that matters, because `ESTABLISHED` is a socket record and not a live session — a
> phone-originated notification delivered to the Mac 16 s into deep idle. Caveat unchanged and
> load-bearing: whitelisted apps are exempt from Doze's network restrictions.


`dumpsys deviceidle force-idle` produces deep Doze on demand. Current state reads `ACTIVE` for both
deep and light, so there is a live baseline to compare against. What it answers: whether the control
socket survives a Doze transition, whether the heartbeat (`PING_INTERVAL_MS = 5_000`,
`MISSED_PONGS_BEFORE_DEAD = 3`) detects the death, and how long the Mac takes to notice.

**The exemption caveat from §0 applies to every word of it.** Whitelisted apps are exempt from Doze
network restrictions, so a clean pass here proves the *exempt* path and nothing else — and that must
be written beside the result, not discovered later.

### P3 · What the service actually costs while it is behaving — **partly run 2026-09-02; no aggregate is quotable yet**

> Three instruments give three different answers about the same wakelock and the reconciliation is
> not established, so this project quotes none of them. Only `dumpsys power`'s live elapsed hold is
> unambiguous and it is now sampled by `scripts/link-night-watch.sh`. Structural finding, needing no
> aggregate: the lock is never re-armed after its own timeout (defect 61).


`dumpsys batterystats --charged com.chetan.connectsuite.debug` after a plugged run gives wakelock
durations and wake counts. It will not give a trustworthy mAh figure while charging — that needs H3 —
but the **wakelock hold time** is the number that matters most and it is readable now.
`LinkService.kt:101` takes a `PARTIAL_WAKE_LOCK` named `ConnectSuite:link`; nobody has ever looked at
how long it is held or whether it is released on every path.

### P4 · The reconnect edges the Mac already has, from the phone's side — **blocked, not deferred**

> Turning the screen off and on needs a key event, and key events are input. Under a session
> instruction not to send input to the phone this is one sentence of permission away, not a device
> limitation. In the meantime `scripts/link-night-watch.sh` waits, read-only, for the screen-off that
> happens anyway.


The Mac reacts to `powerMonitor` `resume` and `unlock-screen` and to interface changes
(`main.ts:619-628`). The phone has **no equivalent** — no screen-off handling, no connectivity
callback, `START_STICKY` and nothing else. Measurable: turn the screen off, wait, turn it on, and
read how the link recovers and how long it takes.

### P5 · The kill this project already knows how to do safely — **run 2026-09-02, and it is less safe than this says**

> `am crash` produced two different outcomes from the same command 49 seconds apart: a silent kill,
> and a modal *Application Error* dialog with the process alive. `START_STICKY` restarted
> `LinkService` after the first and **not** after the second — leaving the phone alive, granted and
> serverless (defect 62). Answers this section's question in both directions: yes it rebinds its
> ports when it restarts, and no it does not always restart. `docs/testing.md` → Phase 6 Slice 2.


`am kill` does nothing to a foreground service and `am crash` works while printing a misleading
permission refusal — both recorded in `docs/RESUME.md`, both learned the hard way, both reusable
here. That gives a **process-death** experiment that does not need Samsung to kill anything and does
not touch the forbidden `force-stop`. It answers: does `START_STICKY` actually bring `LinkService`
back, and does it bind its ports when it does — which the install-serverless finding suggests it may
not.

### P6 · Standby bucket movement over time — **withdrawn 2026-09-02: it is not reversible**

> `am set-standby-bucket <pkg> 5` is refused — *"Cannot set the standby bucket to 5"*. `EXEMPTED` is
> derived from the deviceidle whitelist and cannot be set, so the shell can move the bucket out of it
> and has no command that puts it back. The paragraph below calling this "reversible in one command"
> is wrong and is kept only so the correction has something to point at. **H1 is therefore the only
> route to the unexempt path**, and it is a decision about somebody's own phone.


`am get-standby-bucket` reads `5` (EXEMPTED) now. `am set-standby-bucket` can move it to `RARE` or
`RESTRICTED` to simulate what an unexempt, unused install looks like — without touching the
whitelist, so it is reversible in one command and does not change the phone's real posture. **This is
the cheapest approximation of H1** and should be run before asking for H1 at all.

## 3. What genuinely requires a second device

Only these, and the list is deliberately short — most Phase 6 questions are answerable here.

| | Why one handset cannot answer it |
|---|---|
| **Separating Samsung's battery manager from AOSP's Doze** | They are two mechanisms acting on the same process at the same time on this device. Every observation is their sum. No amount of care on one phone decomposes it — a Pixel does it in one run |
| **Whether any fix we write is a fix or a Samsung-shaped workaround** | A mitigation tuned against Device Care may be a no-op elsewhere or actively wrong. This is the one that makes Phase 6 different from Phases 1–5: earlier phases' vendor assumptions all failed *safely* (`docs/single-device-audit.md` §4), and a reliability fix that only works on one OEM fails **silently and everywhere else** |
| **Whether the `DUAL_APP` control generalises** | Several permission readings used *user 95 reading `false`* as their control. That user is Samsung-only. Any Phase 6 permission reading needs a different control on a stock device, and we cannot write that control without seeing one |

**The recommendation, since it will be asked:** a cheap Pixel, not a second Samsung. §2 of the audit
established that this device's DocumentsUI is **Google's, Play-updated** while its telephony provider
is **Samsung's behind an AOSP package name** — so "Samsung vs AOSP" is already known to cut
differently per component, and only a non-Samsung device separates them.

## 4. The order to do it in

1. **P1** — no device, no permission, already true. Write the defect.
2. **P6** then **P2** then **P5** — all reversible, all on this handset, all with the §0 caveat stated
   in every result.
3. **P4** — needs the screen off and on, which is a moment of your attention rather than your hands.
4. **H2** and **H3** — the two that need you, once the automatable readings have narrowed what to
   look for.
5. **H1** only if §2 leaves a question that P6 could not approximate.
6. **H5** last, informed by what actually turned out to be unknown rather than by this document's
   guess.

## 5. What this brief does not claim

- ~~**No measurement has been taken yet** beyond the four `dumpsys` reads in §0 and the static
  manifest finding in P1.~~ **Stale as of 2026-09-02 and struck 2026-09-03.** P1, P2, P3, P5 and P6
  all carry results now — see each one's blockquote, and `docs/testing.md` → Phase 6 Slices 1 and 2.
  What remains a plan is **P4** (blocked on one sentence of permission to send input), **H1-H3, H5**,
  and the whole of §3. The struck sentence is kept because it is the same failure this brief is about
  catching: a summary written once and not revisited while the sections above it moved.
- **The §0 exemption reading is one device's.** It says nothing about what a fresh install looks like
  on a phone whose owner declined the onboarding prompt — which is a real user and is not represented
  by anything measured here.
- **`docs/protocol.md` is untouched by this phase so far**, and should stay that way unless a
  reliability fix needs a wire change. If one does, it goes in the contract first.
