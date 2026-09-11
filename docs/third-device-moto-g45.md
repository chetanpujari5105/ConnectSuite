# The third device — moto g45 5G, and what it settles

**Opened 2026-09-08.** It was brought in as *"a second device, non-Samsung"*. It is the **third**,
and the distinction is the first finding in this file.

```
model    moto g45 5G       (fogos_gp / fogos)
serial   ZN4222NSN6
release  Android 15        sdk 35        ← below our targetSdk/compileSdk 36
build    V1UGS35H.75-14-9-3-1-3 / 38456a-a80bd5   user / release-keys
patch    2026-07-01        (vendor patch identical)
soc      QTI SM6375 "holi" — arm64-v8a
screen   720x1600 @ 280dpi (override 306)
users    0 (Owner) ONLY — no clone user, no profile, not even the g34's Vault Profile
gms      15_202510
```

---

## §0. It is not the g34, and the pin said so before anything was installed

`docs/second-device-moto-g34.md` records a **moto g34 5G, serial ZA222JT75K**, run 2026-09-05.
This handset is **ZN4222NSN6, moto g45 5G**. `scripts/target-device.sh` refused it twice — once
unlabelled, once when asked for `moto` — and printed what was attached instead. That refusal is the
OPPO guard doing exactly the job it was written for: **the right *kind* of phone was on the bus and
it was not the phone the readings would have been attributed to.** It is registered as a **new**
label `moto45`; `moto` still means the g34, so the two can never be merged by a later reader.

### The caveat that governs every row below

**The build fingerprint is identical to the g34's** — `V1UGS35H.75-14-9-3-1-3/38456a-a80bd5`, same
`fogos` device codename, same patch level, same SoC. So for anything decided by the **Motorola
system image**, this device is a **replicate of the g34, not an independent sample**. Two Motorolas
running one build are one reading of that build.

Where it *is* independent: **`com.google.android.documentsui` is versionName 17 here and was 16 on
the g34** — Play-updated, so the SAF rows below are a genuinely new picker version and match the
Samsung's 17. And the multi-user configuration differs (the g34 had a disabled `VAULT_PROFILE`
user 11; this has user 0 alone), which is what makes §1 cleaner here than there.

---

## §1. Reading 1 — the readings whose control was Samsung's `DUAL_APP` user 95

**The short answer: exactly one reading loses its control, the control was for an ambiguity Samsung
itself created, and on a single-user device the ambiguity does not exist — so nothing needs to
replace it.** That is a different and better answer than *"those readings are now weaker"*.

### What user 95 was actually doing

`docs/single-device-audit.md` §3.E and `docs/testing.md` (~line 7670) use *user 95 reads `false` on
everything* to confirm **the grant landed on the copy under test**. On the SM-S938B,
`dumpsys package` prints the `runtime permissions:` block **once per user** — 0, 95 `DUAL_APP`,
150 Secure Folder — so `grep 'READ_SMS: granted='` returns three lines, and `docs/testing.md`
~8945 records that this **nearly produced a wrong reading**: the dump prints `granted=true` *and*
`granted=false` for one permission name.

### Measured here, before and after granting

| | moto g45 5G | SM-S938B |
|---|---|---|
| `User N:` sections in our package's dump | **1** (`User 0:`) | 3 (0, 95, 150) |
| rows per permission (`READ_SMS: granted=`) | **1** | 3 |
| runtime permissions listed (control: dump is real) | 28 declared, 14 runtime | — |

So the disambiguation control is **not lost leaving a hole — the thing it disambiguated is absent.**
A single-user device cannot produce the two-row output the control existed to read correctly.

### What carries the weight instead — and all four are device-independent

These were doing the real work on the Samsung too; user 95 was only resolving Samsung's own extra
rows. Demonstrated on this device after `pm grant`:

1. **A positive control in the same dump** — `READ_SMS: granted=true` beside the permission under
   test, same package, same user. Proves the query can see a granted permission.
2. **The discriminator** — `READ_MEDIA_VISUAL_USER_SELECTED` separates *Select photos* from full
   access. Both `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` read `true` here, so this is full access.
3. **The `USER_SET` flag** — present on all 14, evidence a grant was *acted on* rather than
   defaulted. This is the flag whose **absence** proved "no grant" on the Samsung's first attempt.
4. **A second, independent client** — the app's own `checkSelfPermission`, which is the only one
   that reads through the shipping call path (defect 50's rule).

**And one replacement that is structural rather than a control: scope the query.** `pm grant --user 0`
and reading the `User 0:` section by name disambiguates *by construction* on any device, multi-user
or not. A control that resolves an ambiguity is weaker than a query that cannot be ambiguous.

**Nothing else in the repo depends on user 95.** `docs/testing.md` ~10984 and ~13089 mention it as
*context* (the clone inflates a package count; `am get-current-user` → 0), not as a control.

---

## §2. Reading 2 — Phase 6's fixes, and what is a Samsung-shaped workaround

### 2.1 Crash recovery — works, **but not by the route anyone would assume**

```
pid before  19635          am crash          pid after 28740   ← process genuinely replaced
scripts/link-up.sh:  OK 1. ServiceRecord isForeground=true
                     OK 2. 42501/42502/42503 all LISTEN under uid 10368
                     OK 3. 1 control session(s) ESTABLISHED
```

Defect 62's question — *does a crash leave the phone serverless* — answers **no** here.

**The route is the finding.** The phone's own log names it:

```
16:14:49.788 [autostart] ACCESSIBILITY_BIND: 1 paired device(s), link not running — starting LinkService
```

**`ACCESSIBILITY_BIND`, not `START_STICKY`.** This device has **no notification-listener grant**, so
`LISTENER_REBIND` — the route that beat the boot path by 3.9 s on the Samsung (defect 64) — cannot
compete here. A *different* bound-service rebind won instead, and it won for the same structural
reason: the system rebinds our `AccessibilityService`, that bind starts the link, and it gets there
first. `ACCESSIBILITY_BIND` appears **11 times** in this session's log, 10 of them
`already listening — nothing to do`.

So the answer to *is anything we built a Samsung-shaped workaround*: **the fixes are not
Samsung-shaped, but the evidence for them was.** Defect 64's competing-route problem is not about
the notification listener; it is about **bound services in general**, and this device demonstrates a
second member of that class. `CLAUDE.md`'s own enumeration already names the category — *"a bound
service (accessibility, notification listener, any `AccessibilityService`/`NotificationListenerService`
the system binds)"* — and this is the first time a non-listener member has been observed **winning**.

**The case still untested on any device**: a phone with **neither** grant, where no rebind route
exists and recovery must fall to `START_STICKY` alone — the route with no call site that reports
itself `UNKNOWN`. That configuration is ordinary for a user who declines both prompts.

### 2.2 Boot receiver — **not taken**, and this device is the best place to take it

Not run: it requires a reboot, and the phone's owner was not asked. **This handset offers the
cleanest version of defect 64's experiment that has existed**, because the competing route is absent
by default rather than by revocation:

- no notification-listener grant → **no `LISTENER_REBIND`**;
- revoke accessibility as well → **no `ACCESSIBILITY_BIND`**, leaving `BOOT` as the only route.

Neither the SM-S938B nor the g34 could isolate that. **Caveat to state before anyone runs it**: this
device has a secure lock screen, so `BOOT_COMPLETED` is only delivered after the first unlock.

### 2.3 Wake lock (defect 61) — held and re-armed, the 60-minute claim **unproven**

```
PARTIAL_WAKE_LOCK 'ConnectSuite:link' ACQ=-8m28s603ms LONG (uid=10368 pid=28740)
```

`pid=28740` is the **post-crash** process, so the lock was re-acquired by the new process rather
than orphaned. What is **not** shown is the thing defect 61 is about — that the lock re-arms
**before** its 60-minute timeout rather than being repaired after a lapse. That needs ~1 hour of
idle observation and was not run. Recording the reading it needs: a sample at **t+59m** showing an
`ACQ` age that has **reset**, not one at t+61m showing a lock that exists.

---

## §3. Reading 3 — the storage wall. **It holds.**

Full evidence and controls: `docs/evidence/saf-probe-moto45-2026-09-08/`.

| # | Reading | moto g45 5G | Control in the same dump |
|---|---|---|---|
| P1 | Storage root | **REFUSED** — `button1 enabled=false`, `Can't use this folder` | `CREATE NEW FOLDER` `enabled=true`; 8 entries list normally; 124 nodes |
| P2 | `Download` itself | **REFUSED** — same button, same strings | `CREATE NEW FOLDER` `enabled=true`; 70 nodes |
| P3 | Inside `Download` | **GRANTABLE** — `enabled=true`, **no refusal node at all** | the same button one level deeper reads `true` |
| P3b | `Movies` (ordinary top-level) | **GRANTABLE** | a second independent grantable case |
| P4a | `EXTRA_INITIAL_URI` for an existing folder | **HONOURED** | landed exactly where aimed |

**The wall now holds on three handsets, two vendors, two DocumentsUI versions (16 and 17).** It is
still **not** established as "every Android device": all three run **Google's** DocumentsUI, so the
gap the g34 file named is unchanged. A non-Google picker is still owed.

**One thing that did not replicate, in a third direction.** Aiming at the *storage root* URI landed
in `Download`; a launch with no initial URI landed in `Movies`. The SM-S938B recorded *"a bad aim
degrades to the parent"*; the g34 landed in `DCIM` and ruled out parent-degradation, last-visited and
last-granted. Here, last-visited is **not** excluded. Three devices, three behaviours, and the only
safe statement is the one the g34 file already makes: **that sentence is a single-device reading and
must stop being written as general.** The chip constraint it produced (*no chip may point inside
`Download`*) remains correct on all three, for different reasons on each.

---

## §4. Reading 4 — the clipboard wall. **It is the platform, not Samsung.**

`ClipProbeActivity`, `watch` mode, over a **foreign** clip (a URL placed by Chrome's own share-sheet
`Copy`, 523 chars — the stimulus came from outside our app, so this is not a round-trip).

| Run | accessibility service | focused control read | backgrounded samples | platform denials naming us |
|---|---|---|---|---|
| moto g45 5G | **enabled and Bound** | works — 523 chars | **0 readable / 60 refused** | **60** |
| moto g45 5G | **off** (`Bound services:{}`) | works — 523 chars | **0 readable / 60 refused** | **60** |
| SM-S938B | enabled and bound | works — 57 chars | 0 of 90 | 90 |
| SM-S938B | disabled | works — 92 chars | 0 of 60 | 60 |

**Identical across two vendors.** The refuser here is AOSP's own `ClipboardService`:

```
E ClipboardService: Denying clipboard access to com.chetan.connectsuite.debug,
                    application is not in focus nor is it a system service for user 0
```

— not Samsung's `SemClipboardToastController`, which is what wrote the Samsung's denials. So
`CLAUDE.md`'s inherited sentence — *background clipboard reads are blocked since Android 10 **unless
the app has an enabled AccessibilityService or is the default IME*** — is **false on stock Android
too**, and now measured that way rather than inferred from the Samsung. `CapabilityContract` gating
`clipboard` on `ACCESSIBILITY_SERVICE` is gating on a rule that operates on **neither** device.

### Two instrument faults, both caught before they became findings

1. **The first run reported `stopped=control-failed`** — *nothing readable even with focus*. The
   clipboard was empty: `input text` had silently not landed in the Settings field, so my "copy"
   never happened. Without the probe's built-in known-positive this would have been written up as
   *0 readable / 60 refused* — **a true-looking confirmation of the expected answer, produced by a
   missing stimulus.** Independently corroborated: Chrome's selection toolbar showed no `Paste`.
2. **The first "accessibility off" run was not off.** `settings put secure enabled_accessibility_services ""`
   was rejected — the string survived and `Bound services` still named our service, though
   `accessibility_enabled` flipped to 0. The probe's own `ENV accessibilityServiceOfOurs=true` line
   is what exposed it. `settings delete` worked; the control was re-run. **An instrument that
   reports its own state is what separated a control from a duplicate.**

---

## §5. Reading 5 — the `PROCESS_TEXT` switch. **Stock has no allowlist at all.**

| | moto g45 5G | SM-S938B |
|---|---|---|
| Our entry visible after install | **YES — immediately, no setup** | **NO** — invisible until switched on by hand |
| Gating surface | **none found** | `SecProcessTextManageAppsFragment` — *"Select apps to show in the contextual menu"*, **every row off by default** |
| Where it appears | Chrome, **overflow** (`⋮`) — `Select all · Ask Gemini · Read aloud · Send to Mac · Search in Truecaller…` | overflow, once enabled |
| Toolbar classification | **PLATFORM** (`Define · Cut · Copy · ⋮`) | PLATFORM |

`PROCESS_TEXT` resolvers on this device: **5 activities, 3 enabled** — TalkBack, **ours**, Truecaller
(googlequicksearchbox and Yandex present but `enabled=false`). Ours registered and enabled on
install, with no user action.

Searched for a Samsung-equivalent gate and found none: no key in `secure`, `global` or `system`
settings matching `process_text|selection|clipboard|text_action` (the single hit,
`pai_selection_page_complete`, is the preload-app installer and unrelated).

**Consequence for onboarding, stated because it is invisible from either device alone:** the
"Send to Mac" feature needs **an extra manual step on Samsung and none on stock**. Any copy that
describes the setup is therefore true of at most one of them — the exact shape of defect 63's
*"a true sentence about the wrong one of two paths"*.

---

## §6. The capability walk — advertised vs functioning

Advertised on connect: `apps, calls, clipboard, contacts, files, mirror, photos, sms` — **8**,
against the S25's 10. `notifications` and `remote` are absent because Notification access was never
granted; the app names that reason rather than failing silently, which is decision #6 working.

| Capability | Advertised | Functioning? | The reading |
|---|---|---|---|
| apps | yes | **WORKS** | `apps.icon → 52 made / 0 failed / 52 served from cache, over 52 apps listed`; `apps.open.ask ok` |
| photos | yes | **WORKS** | `media.thumb → 120 made / 0 gone / 0 undecodable` |
| contacts | yes | **WORKS** | `contacts.list → 45 rows`; 9 delivered / 6 refused (`no-such-contact`, a real refusal with a reason) |
| sms | yes | **WORKS** | `sms.threads → 50 threads, hasMore=true`; `sms.messages thread 62 → 50 messages` |
| calls | yes | **WORKS** | `call.log → 50 entries, 41 with a contact name, hasMore=true` |
| files | yes | **WORKS, thin** | `fs.list roots → 2 root(s): downloads:connectsuite, app:files` — both grant-free; no SAF tree granted, so 0 entries. Correct for a fresh install |
| input | flapping | **WORKS** | `38 delivered / 10 refused` — tap, swipe, scroll, global |
| mirror | yes | **BLOCKED, correctly** | `awaiting-foreground — ConnectSuite is in the background on the phone and Android will not let it show the screen capture prompt from there` — a named platform wall, not a silent failure |
| clipboard | yes | **PARTIAL — see defect below** | `clip.push` 2 of 2 **not applied**, Mac says *"the phone did not say why"* |
| notifications, remote | **no** | n/a | `missing Notification access` — named |

**`apps` units check, per `CLAUDE.md`'s rule:** launcher **ACTIVITIES** 52, launcher **PACKAGES** 52,
app reported **52 packages** — ratio **1.0**, so the `<queries>` block is load-bearing on a second
Motorola too. Note the two units **coincide** at 52, exactly as they did at 109 on the g34: a person
comparing the wrong units gets the right answer here and learns nothing. That is a reason to state
the unit, not to check the number.

---

## §7. The defect list, sorted by the distinction that was asked for

### A. Genuinely OEM-conditional — behaves differently on Samsung vs stock

| # | What | Direction |
|---|---|---|
| **A1** | **`PROCESS_TEXT` needs a manual per-app switch on One UI and nothing on stock.** Any onboarding sentence about "Send to Mac" is wrong on one of the two platforms unless it names which | Samsung is the restrictive one; stock users need no setup |
| **A2** | **The `EXTRA_INITIAL_URI` fallback differs on all three handsets** — parent (S25), `DCIM` (g34), `Download` (g45, last-visited not excluded). The audit's flat sentence *"a bad aim degrades to the parent"* is a single-device reading | Already flagged by the g34 file; a third device makes it unarguable |
| **A3** | **The permission-dump control (user 95) is Samsung-only** — and so is the two-row ambiguity it existed to resolve. An auditor reproducing those readings on stock will find the control missing and may read that as a failure | Documented in `single-device-audit.md` §3.E; now measured on a device with one user |

### B. Not OEM-specific — found here, present everywhere, masked on the S25

| # | What | Why it was invisible until now |
|---|---|---|
| **B1** | **`clip.push` reports "the phone did not say why" when the phone did say why.** The phone logs `clip.push ← Mac: 1829 bytes, **held for a tap** — 0 of 1 applied / 0 refused-unfocused / 0 refused-sensitive / 0 refused-too-large`. Auto-apply is off by default on the phone — correct, designed behaviour — but the Mac renders that correct outcome as an *absent reason*. A reason exists at one end and is reported missing at the other | The S25 has auto-apply **on**, so this path never ran there. It is a **reporting** defect, not a transport one — the same shape as defect 57's `NOT_FOUND` covering two facts |
| **B2** | **`input` capability flaps between available and unavailable** on every accessibility rebind, emitting paired `Capabilities changed` lines seconds apart. The reason string (*"granted in Settings, but Android has not started the service… turn the switch off and on again"*) is accurate but appears transiently during a normal rebind | Only visible when the accessibility service is toggled, which the S25 runs never did in a connected session |

### C. Not defects — platform walls behaving as designed

- The clipboard background-read refusal (§4) — **the platform, on both vendors**. What *is* wrong is
  the inherited sentence in `CLAUDE.md` claiming an AccessibilityService lifts it, and
  `CapabilityContract` gating on that rule.
- The SAF refusals (§3) — three handsets agree.
- `mirror: awaiting-foreground` — MediaProjection cannot prompt from the background; named correctly.

---

## §8. Not taken, and what each needs — stated so nothing reads as settled

| # | Reading | Why not | The stimulus it needs |
|---|---|---|---|
| **N1** | **Boot receiver** (§2.2) | needs a reboot; owner not asked | one reboot with the notification listener ungranted **and** accessibility revoked — leaving `BOOT` as the only route. Unlock required after reboot (secure lock screen) |
| **N2** | **Wake lock 60-minute re-arm** (§2.3) | needs ~1 hour idle | a sample at **t+59m** showing a **reset** `ACQ` age |
| **N3** | **`START_STICKY` alone** | both rebind routes were present | a device with neither notification nor accessibility grant |
| **N4** | **Defect 50** — bound `date < ?` on `mms-sms/conversations` | **now takeable and not taken.** The provider is stock `TelephonyProvider`, and `READ_SMS` is granted; `sms.threads` returned 50 with `hasMore=true`, which exercises the pager's **first** page only | consecutive pages, counted, on this handset — the precondition `CLAUDE.md` sets for any provider pager. It would move defect 50 from `unknown, single-device` to a verdict |
| **N5** | **Defect 55** — `fs.list` per-page cost | no SAF tree granted, so no large directory reachable | a persisted grant on a ~16k-entry directory, with elapsed time reported per page |
| **N6** | **A non-Google DocumentsUI** | not available | any device shipping a non-Google picker. Unchanged since the g34 |

---

## §9. Two contaminations to record, because both changed state mid-experiment

1. **The phone was paired with the Mac at 15:57 by its owner, during the run** — via mDNS, which
   requires a QR scan. It is why §6 exists at all. It is also the g34's P8 failure repeating: a third
   party changing device state inside a measurement window. Nothing in §1–§5 depends on it (all were
   taken before, or are independent of, the link), and §6 is *about* the link, so no row here is
   invalidated — but the sequence is recorded rather than tidied away.
2. **I created and removed `Download/SafProbe0908`** for P3, and granted 14 runtime permissions,
   enabled/disabled/re-enabled the accessibility service, and set `stayon true`. The
   notification-listener grant was **deliberately left alone** to keep N1 available.

---

## Installed and baselined 2026-09-10, **not paired**

Brought up as the third handset of the fit run (defect 99). The pin named it `moto45` unprompted and
did not confuse it with the g34 — the distinction §0 above was written about.

```
model     moto g45 5G        motorola
release   Android 15         sdk 35        patch 2026-07-01
panel     720 x 1600 @280dpi (override 306)   →  2.22222
```

```
packages matching connectsuite   READING 0 of 421   →   READING 1 of 422
runtime grants                   READING 14 of 383 lines match granted=true
standby bucket                   50 (NEVER)  →  10 (ACTIVE, after one launch)
```

**Not paired**, for defect 17's reason: the Mac holds one phone and pairing this one costs the S25.

### The defect 102 baseline — three vendors now, and Samsung is the outlier

| handset | ours | 8 third-party controls |
|---|---|---|
| SM-S938B (One UI, sdk 36) | **`ignore`** | **2 of 8 `ignore`**, 6 allow or unset |
| vivo V2141 (sdk 34) | unset | **8 of 8 unset** |
| **moto g45 (sdk 35)** | **unset** | **8 of 8 unset** |

On both non-Samsung handsets the op has **never been written for any app sampled**. Samsung writes
it, and wrote it for the two apps its owner opens least — one of which is ours.

**This is a baseline, not yet a finding.** Both non-Samsung apps were installed today, so neither has
been unused for anything; the restriction Samsung applied took an app it had watched go quiet. The
reading that matters is the same two lines after several days of neglect, and it cannot be bought
with effort — only with time. Recorded on the install date so the comparison exists to be made.

### What is still owed here

The **fit reading** on a 2.22222 panel, which needs a pairing and therefore the swap defect 17
forces. 720×1600 is the ratio closest to the vivo's 2.22963 and furthest from the box's old
hard-coded 2.16667 — and the g34 shares this build fingerprint, so the two Motorolas are one image
and this one stands for both.
