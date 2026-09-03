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

## 2a. What is left, sorted by what it needs — 2026-09-03

Written after H1, defect 64's close and defect 80's wiring, because §2's ordering was made before any
of them ran.

### Needs nothing but a keyboard — no device state changed, no permission, no waiting

| | |
|---|---|
| **77** | `BOOT` and `QUICKBOOT` share one reason name, so a `BOOT:` line cannot be told from an unprotected broadcast. Two enum values and a log string |
| **52, 53, 51** | Counter and logging defects: one `dropped` counter for three causes in `VideoChannel` and a third that never reaches it; two of the Mac's four call refusals move a counter without leaving a line; the after-send retry reports a loss it does not suffer. All three are the denominator rule, unfixed in three places |
| **69, 71** | Onboarding copy — a permission whose own copy is about a different feature, and *Sync* naming two different things. `app/src/test` exists now, so these are testable where defect 65's was not |
| **33** | Package ids in sentences people read. `AppLabels.of` is the route; the work is enumerating every place a raw id reaches a string |

### Needs this handset, and nothing else

| | What it needs |
|---|---|
| **80's start half** | Revoke the listener grant, `am crash` the process so `PACKAGE_REPLACED` cannot fire either, and watch whether `ACCESSIBILITY_BIND` starts the link. Same shape that closed 64. ~2 minutes, notification mirroring off for the length of it |
| **57** | **Newly cheap, and the deferral reasoning has expired.** It was deferred because producing an undecodable `MediaStore` row meant truncating a real photo on somebody's phone. It does not: `Download/ConnectSuite` is a grant-free root of our own, so a deliberately-corrupt JPEG can be *written* there rather than an existing file damaged. Nothing of the owner's is touched |
| **38** | A volume change on the phone never reaches the Mac. One handset, one observer |
| **30's other half** | One send to a number with no thread, proving the absence in `mms-sms/conversations` **and** `content://sms` first — orphaned rows outlive a deleted conversation |
| **P4** | Screen off, wait, screen on. Blocked only on a power-button press, which is a moment of attention rather than an unsolved problem |

### Needs the owner's eyes or an unattended night

| | |
|---|---|
| **H2** | Device Care's *Sleeping apps* / *Deep sleeping apps*. **Asked 2026-09-03 and still unanswered** — the reply arrived as an unfilled template, so neither branch is recorded. No adb surface exists; it is a screen |
| **H3** | An unplugged overnight run. It is also the only route to **P3**, whose three instruments disagree and which therefore still quotes no aggregate |
| **The unexempt-and-neglected experiment** | H1's banner. No route on this handset that does not leave the phone degraded for days, since P6 is withdrawn |

## 3. What genuinely requires a second device

Only these, and the list is deliberately short — most Phase 6 questions are answerable here.

| | Why one handset cannot answer it |
|---|---|
| **Separating Samsung's battery manager from AOSP's Doze** | They are two mechanisms acting on the same process at the same time on this device. Every observation is their sum. No amount of care on one phone decomposes it — a Pixel does it in one run |
| **Whether any fix we write is a fix or a Samsung-shaped workaround** | A mitigation tuned against Device Care may be a no-op elsewhere or actively wrong. This is the one that makes Phase 6 different from Phases 1–5: earlier phases' vendor assumptions all failed *safely* (`docs/single-device-audit.md` §4), and a reliability fix that only works on one OEM fails **silently and everywhere else** |
| **Whether the `DUAL_APP` control generalises** | Several permission readings used *user 95 reading `false`* as their control. That user is Samsung-only. Any Phase 6 permission reading needs a different control on a stock device, and we cannot write that control without seeing one |

### Revised 2026-09-03: there is a Realme on the desk, and it answers two of the three

The table above was written when the second device was hypothetical. It is not, and the honest
reading is that **a Realme answers rows 2 and 3 well and row 1 not at all** — so the Pixel
recommendation below stands for a different reason than it was made for.

| Row | Does a Realme settle it? |
|---|---|
| **Separating Samsung's battery manager from AOSP's Doze** | **No.** ColorOS/realme UI runs its own aggressive battery management. Two heavily-skinned devices give two sums, not a decomposition. Swapping One UI for ColorOS changes which vendor is confounding the reading, not whether one is |
| **Whether a fix is a fix or a Samsung-shaped workaround** | **Yes, and it is the whole reason to have a second device.** This is not decomposition and should not be sold as it: two skins do not separate vendor from AOSP. What they do is answer the only question Phase 6's value actually rests on — **two skins agreeing makes a behaviour general; two skins disagreeing names the vendor.** Every reliability fix in this phase is currently a hypothesis about one handset, and this row is what converts each one into either a fix or a One UI workaround. It does not need the second device to be a Pixel, and it is worth more than the AOSP baseline it is often confused with |
| **Whether the `DUAL_APP` control generalises** | **Yes.** User 95 is Samsung's. A Realme has its own clone feature under a different id, or none, and either answer retires the control |

**And it unblocks a defect the second-device list never mentioned: 17.** *The Mac holds one phone
structurally and refuses the second rather than evicting it* — deferred since Phase 4 for want of a
second phone. It is not a battery question at all, and it is the single most concrete thing a second
handset buys.

**The AOSP half has a cheaper answer than a Pixel for several questions: an emulator.** A stock AOSP
system image is a free, disposable, resettable control for anything that does not need real hardware
— standby buckets and Doze transitions, the boot receiver, package visibility, and in particular
**DocumentsUI's folder refusal**, which `docs/single-device-audit.md` §6.4 flags as the one wall in
this app with an expiry date nobody controls. It cannot answer: real battery draw, Samsung's Device
Care, telephony and SMS through a real provider, MediaProjection throughput, or anything about a
vendor skin.

So the shape is three instruments, not two: **this Samsung** for the product, **the Realme** for
*is this vendor-specific*, and **an emulator** for *is this AOSP*. A Pixel remains the right purchase
if one is ever made, but it is now the third priority rather than the first.

**Before the Realme is used for anything, two readings about the instrument itself:** its Android
version against `minSdk 29` — defect 68 was a release APK aimed at an SDK 28 stranger and only an
accident stopped it — and `scripts/target-device.sh` teaching, since every write in this repo pins
serial *and* model and it currently knows one phone.

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

---

## 6. What Phase 6 can honestly claim, and what stays hypothesis — 2026-09-03

Written to be quoted. The first table is what this handset settled; the second is what it cannot, and
the second is not a to-do list — several rows have **no route on this device at all**, which is a
different and more important statement than "not done yet".

### Claimable, on one SM-S938B running One UI on Android 16

Each of these was observed on hardware with a control, and each carries the single-device caveat
`docs/single-device-audit.md` sets out.

| | What is claimable | What proved it |
|---|---|---|
| **The link returns after a restart** | `BOOT_COMPLETED` reaches `LinkBootReceiver`, `startOrLog` runs, `connectedDevice` is claimed and nothing else, ports bind, the Mac reconnects with nothing tapped | Slice 6, with `LISTENER_REBIND lines since boot: 0` as the control |
| **…and after an app update** | `MY_PACKAGE_REPLACED` does the same | Slice 1, and again on every install this phase |
| **A deep-Doze transition does not drop the link** | listeners 4/4, one session, and a **message that actually crossed** at `deep=IDLE` | P2 (exempt) and Slice 8 (unexempt, bucket `ACTIVE`) |
| **A crash does not leave the phone serverless** | `START_STICKY` restarts `LinkService`; where it does not, the listener rebind covers it | defect 62, and Slice 10 measured `START_STICKY` winning by 16 ms |
| **The wake lock does not lapse** | re-armed before its timeout rather than repaired after | defect 61, overnight |
| **The phone does not silently overwrite a clipboard it cannot report** | refused at `granted=false`, applied at `granted=true`, refused again after restoring | Slice 7, both directions |
| **`media.thumb` tells a corrupt photo from a deleted one** | `31 made / 0 gone / 1 undecodable` on a deliberately corrupt file | Slice 11 |

### Hypothesis, and why — the rows with no route are marked

| | Why it is not settled | Route on this device? |
|---|---|---|
| **Whether any Phase 6 fix is a fix or a One UI workaround** | This is the load-bearing one. Every row above is one vendor's behaviour. Two skins agreeing makes a behaviour general; disagreeing names the vendor — and nothing here has a second skin | **None.** Needs a second device, and the Realme is gone |
| **The unexempt *and neglected* case** | H1 removed the Doze exemption; it did not make the app unused, so the bucket stayed `ACTIVE` and the harsh restrictions of `RARE`/`RESTRICTED` were never reached | **None.** P6 is withdrawn: the shell can leave `EXEMPTED` and cannot return to it |
| **Samsung's own battery layer** | Device Care's *Sleeping apps* lists are not readable from `adb` — H2 — and were **asked for and never answered**, so this repo does not know whether the app is in them, before H1 or after | Owner's eyes only |
| **Battery cost** | needs an unplugged night (H3), which is also the only route to **P3**, whose three instruments disagree and which therefore quotes no aggregate | Owner's time |
| **Defect 80's start half** | `ACCESSIBILITY_BIND` has fired three times and started the link zero times, each time behind a faster route | Yes — stop `LinkService`, then kill, with the listener revoked. Needs a debug affordance |
| **Doze as it actually happens** | every Doze reading is `force-idle`: a forced transition with USB attached, not an observed descent through the staged states with maintenance windows | Partly — H3 |
| **Defect 17, two phones** | the Mac refuses a second phone rather than managing them | **None.** One phone |

### The sentence to ship with

> **Phase 6's fixes are proven on one Samsung handset and are hypotheses everywhere else.** The boot
> path, the Doze survival, the wake lock and the crash recovery were each observed with a control on
> an SM-S938B running One UI on Android 16. None has been seen on a second vendor, on stock Android,
> on a phone in a low standby bucket, or on a phone left alone overnight. Battery management is the
> most vendor-specific surface on Android, so the gap between "works here" and "works" is wider in
> this phase than in any before it.

**That sentence is the deliverable, not an apology for one.** A reliability phase that shipped
claiming more would be making exactly the error the rest of this repository is written to avoid — and
unlike a wrong reading, a fix tuned to one OEM fails **silently, everywhere else**, which is the one
failure mode nothing in the build can catch.
