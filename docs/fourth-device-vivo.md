# The fourth device profile — a vivo, and what it can settle

**Opened 2026-09-08.** Brought in as *"third device, a Vivo"*. It is the **fourth device to carry a
profile** and, by the record below, the **fifth or sixth handset this project has touched**. §0
settles the count before anything else, because the last two device files each opened by correcting
the one before them and the correction has never actually stuck.

```
model    (unread — the device was unauthorized when this section was written)
serial   137354726800049
```

---

## §0. The count is wrong in three files, and this is the third time it has been corrected

`docs/second-device-moto-g34.md` opens: *"The first handset other than the SM-S938B this project has
ever run on."* **That is false.** `docs/evidence/second-device-2026-09-02/readings-rmx3870.md`
records a **realme RMX3870 (realme P1 5G)** installed on, paired, and read on **2026-09-02** — three
days earlier — including an install reading, a full `§3.E` permission control, a Phase 6 battery
block and a three-handset provenance sweep. `docs/third-device-moto-g45.md` §0 then corrected the
g34 to "third" without noticing the realme either.

The full list, by first reading:

| | Device | Android | What it gave | In `target-device.sh`? |
|---|---|---|---|---|
| 1 | **SM-S938B** (Samsung) | 16 / 36 | primary; every reading before 2026-09-02 | **yes** — `samsung` |
| 2 | **OPPO CPH1859** (realme 1) | 28 | the near-miss install; a provenance column — **`MtkDocumentsUI` v9, frozen in `/system/priv-app`** | **no** |
| 3 | **realme RMX3870** (realme P1 5G) | **16 / 36** | install, `§3.E` control, Phase 6 battery, provenance | **no** |
| 4 | **moto g34 5G** | 15 / 35 | SAF P1–P5, battery, package visibility | yes — `moto` |
| 5 | **moto g45 5G** | 15 / 35 | SAF, clipboard, `PROCESS_TEXT`, Phase 6 partial | yes — `moto45` |
| 6 | **this vivo** | ? | this file | **no** — to be registered before any write |

**Two devices this repo has already taken readings from are not in the pin.** The guard exists to
stop a reading being attributed to the wrong handset, and it cannot name the realme or the OPPO at
all. That is not a hypothetical: the RMX3870's readings are the ones most likely to be confused with
this device's, because both are **BBK-family** phones (realme/OPPO/OnePlus/vivo share a corporate
parent and, historically, parts of the ROM).

**Why the realme matters more than either moto for this device's comparisons.** It is **Android 16 /
SDK 36**, the same platform version as the SM-S938B. Both motos are **Android 15 / SDK 35** *and
share one build fingerprint* (`V1UGS35H.75-14-9-3-1-3`, same `fogos` codename, same SoC, same patch)
— so for anything decided by the Motorola system image the two motos are **one reading, not two**.
The comparison set is therefore three independent system images, not five.

---

## §1. PRE-REGISTERED PREDICTIONS — written 2026-09-08 23:0x, **before the device was authorized**

Written while `adb` reported `137354726800049 unauthorized` and **not one property had been read** —
not the model, not the Android version, nothing. This is the only moment such a list is honest.
Each row names the expected direction **and what the other direction would mean**, because a
prediction with no consequence attached gets rewritten to match whatever comes back.

### The storage wall (question 3)

| # | Prediction | If it goes the other way |
|---|---|---|
| **V1** | Storage root **REFUSED** | The wall is version- or vendor-conditional and the Folders screen asserts a falsehood to some users |
| **V2** | `Download` itself **REFUSED** | Worse than V1 — the `Download/ConnectSuite` design is built on this row |
| **V3** | A folder **inside** `Download` **GRANTABLE** | The grant-free destination loses its escape hatch |
| **V4** | `EXTRA_INITIAL_URI` **honoured** for a folder that exists | The quick-pick chips aim at nothing here |
| **V5** | The bad-aim fallback is **a fourth distinct behaviour** — parent (S25), `DCIM` (g34), `Download`/last-visited (g45). I predict it does **not** match any of the three | A match with one of them would be the first replication that sentence has ever had, and would be worth more than another distinct value |
| **V6** | **The picker is Google's `com.google.android.documentsui`, Play-updated from `/data/app`** | **This is the row with the most upside in the whole file.** A **non-Google picker** — `MtkDocumentsUI`, a vivo fork, anything in `/system/priv-app` and frozen — settles **N6**, the gap every device file has had to leave open. The CPH1859 proves such pickers exist in this corporate family |

### Phase 6's fixes (question 2)

| # | Prediction | If it goes the other way |
|---|---|---|
| **V7** | **NOT battery-exempt out of the box**, read *before first launch* | If it ships exempt, the unexempt case has no route here either and stays unsettled (the S25's contamination, repeated) |
| **V8** | Standby bucket read **pre-launch**; predicted worse than `ACTIVE` | The g34's P8 was destroyed by a third party granting an exemption mid-run. Both readings here are taken before launch or not recorded |
| **V9** | **A vendor background manager that actually uses the AOSP app-op.** Motorola's BatteryCare showed **0** packages at `RUN_ANY_IN_BACKGROUND: mode=ignore` device-wide. I predict vivo is **non-zero** | A zero here would make "vivo is the most aggressive" folklore rather than measurement, and would be the more interesting result |
| **V10** | **Crash recovery works, by a *rebind* route rather than `START_STICKY`** — `LISTENER_REBIND` on the S25, `ACCESSIBILITY_BIND` on the g45 | A recovery with **neither** grant present would finally exercise `START_STICKY` alone — the route with no call site that reports itself `UNKNOWN` (**N3**, untested on any device) |
| **V11** | The boot receiver is **not** reachable for a clean reading unless both bind routes are absent | Same structure as defect 64. If vivo's background management *blocks* the boot broadcast outright, that is a genuinely new failure and not a race |

### The clipboard wall (question 4)

| # | Prediction | If it goes the other way |
|---|---|---|
| **V12** | **0 readable / N refused while backgrounded, with the accessibility service both on and off** — i.e. the wall is the **platform**, as the g45 established against the S25 | A device where an AccessibilityService *does* lift it would vindicate `CLAUDE.md`'s inherited sentence and `CapabilityContract`'s gate, both of which currently look wrong |
| **V13** | The refuser is **AOSP `ClipboardService`** (`Denying clipboard access… not in focus`) | A **vivo-named** refuser would make the *denial* vendor code over identical behaviour — the `SecClipboardToastController` pattern a second time, which is worth recording even though the outcome matches |
| **V14** | The foreground control **reads a foreign clip** placed by another app's share sheet | If the control fails, there is **no reading** — the g45's fault 1, where an empty clipboard produced a true-looking `0 readable` |

### `PROCESS_TEXT` (question 5)

| # | Prediction | If it goes the other way |
|---|---|---|
| **V15** | **Genuinely uncertain, and recorded as uncertain.** Samsung has a per-app allowlist (`SecProcessTextManageAppsFragment`, every row off); stock has none. vivo customises the selection toolbar heavily, so I will not call this | Either answer is a real result. What must not happen is the answer being written up as though it had been expected |
| **V16** | If a gate exists it is **not** discoverable by settings-key search alone — the g45 searched `secure`/`global`/`system` for `process_text\|selection\|clipboard\|text_action` and a Samsung-style gate would not necessarily appear there either | A gate found by key search would make that search a reusable probe rather than a one-off |

### The user-95 replacement (question 1)

| # | Prediction | If it goes the other way |
|---|---|---|
| **V17** | **A clone user probably exists.** FuntouchOS ships an app-clone feature; the CPH1859 had user **999 `multiApp`**, the S25 user **95 `DUAL_APP`**, the RMX3870 and both motos had none | If a clone user exists, the *ambiguity* user 95 created returns — `dumpsys package` prints `runtime permissions:` once per user, so `granted=` appears more than once for one permission and a naive grep gets a coin flip |
| **V18** | The replacement control is **the RMX3870's**, not the g45's: a **pre/post pair on user 0** — 0 of N granted immediately after install, N of N after the grant. Same user, two times | The g45's answer ("on a single-user device the ambiguity does not exist, so nothing needs to replace it") **does not transfer to a device that has a clone user.** If V17 holds, the g45's reasoning is the wrong one to reuse here |

---

## §2. What this device cannot settle, written before it is asked to

- **One handset per vendor is still one handset per vendor.** "vivo does X" will not be established
  by one phone any more than "Samsung does X" was by an S25 Ultra.
- If it runs **Google's** DocumentsUI, the SAF rows confirm across a fourth vendor and still **cannot**
  distinguish *"Google's picker refuses this"* from *"every picker refuses this"*. N6 stays open.
- Any Android-version difference from the SM-S938B/RMX3870 (16/36) is **confounded** between vendor
  and platform version, and every row that turns up a difference has to say so.
- Nothing here can speak to a **second** vivo, a different FuntouchOS major version, or a China-ROM
  build, which is where vivo's background management differs most from the global ROM.

---

## §3. The provenance table — **the state BEFORE this device**, so its contribution is a visible delta

The request this device was brought in for is *"for every wall and every fix in the record, say
whether it is platform behaviour, one vendor's, or still unknown."* That table is below, built from
the **four** handsets that have yielded readings. It is written **before** the vivo is read so that
what the vivo changes can be seen as a change rather than absorbed into a table that was always
going to say this.

Verdict vocabulary is `docs/single-device-audit.md` §1, with one column added that the audit does
not have and needs: **how many independent system images the claim rests on.** Both motos share one
build fingerprint, so they count as **one**.

Independent images available: **S25 (One UI, 16/36)**, **RMX3870 (realme UI, 16/36)**,
**moto g34+g45 (one Motorola build, 15/35)**, **CPH1859 (ColorOS, 28)** — provenance only, almost
nothing behavioural.

### A. The walls

| Wall | Verdict now | Images | What it actually rests on |
|---|---|---|---|
| **SAF: storage root not grantable** | **Google's DocumentsUI, v16–v17** — *not* "Android" | **3** (S25, RMX3870, g34/g45) | Identical `button1 enabled=false` + both refusal strings, each with an enabled sibling control in the same dump. **All four run Google's picker.** The CPH1859 carries **`MtkDocumentsUI` v9, frozen** and the wall was **never measured on it** — the one non-Google picker in the record went unread |
| **SAF: `Download` itself not grantable** | same | **3** | same |
| **SAF: folder inside `Download` grantable** | same | **3** | `enabled=true`, no refusal node, one level deeper — the discriminator that makes the two above refusals rather than dead controls |
| **`Android/data` + `Android/obb` unreachable** | **contract** | n/a | Platform contract; never in doubt |
| **`EXTRA_INITIAL_URI` honoured** | **Google's DocumentsUI** | **3** | Landed where aimed on every device tested |
| **"A bad aim degrades to the parent"** | **FALSE as written — withdrawn** | 3, and **all three disagree** | parent (S25) · `DCIM` (g34) · `Download`, last-visited not excluded (g45). Three images, three behaviours. The constraint it justified (no chip inside `Download`) survives on all three **for a different reason on each** |
| **Background clipboard reads blocked while unfocused** | **PLATFORM** | **2** (S25, g45) | 0 readable / 60–90 refused, accessibility **on and off**, on both. Refuser is AOSP `ClipboardService` on the moto and Samsung's `SemClipboardToastController` on the S25 — **same behaviour, vendor-specific denier** |
| **…"unless the app has an enabled AccessibilityService or is the default IME"** | **FALSE on both devices tested** | **2** | Inherited from documentation, never measured until the g45. `CapabilityContract` still gates `clipboard` on `ACCESSIBILITY_SERVICE` — a gate on a rule that operates on neither device |
| **`ACTION_PROCESS_TEXT` unreachable in apps drawing their own selection UI** | **contract** | 1 (S25) | An app that starts no platform action mode is not a place the entry can exist. Structural, not measured-per-device |
| **`PROCESS_TEXT` visibility requires a per-app switch** | **ONE VENDOR (Samsung)** | **2** | Samsung: `SecProcessTextManageAppsFragment`, every row off by default. Motorola: visible immediately, no setup, 5 resolvers / 3 enabled. **Onboarding copy about "Send to Mac" is true of at most one of them** |
| **No key injection / `performGlobalAction` is all of `input.global`** | **contract** | n/a | `INJECT_EVENTS` is signature-level. Not a device question |
| **AccessibilityService cannot be granted programmatically** | **contract** | n/a | Same |
| **MediaProjection consent not cacheable** | **contract** | 1 | Android 14+ contract |
| **FLAG_SECURE → black frames** | **contract** | 1 | Enforced by Android |
| **Call audio cannot be streamed** | **contract** | n/a | `CAPTURE_AUDIO_OUTPUT` is system-only |

### B. The Phase 6 fixes — this is where the record is thinnest

| Fix | Verdict now | Images | The honest state |
|---|---|---|---|
| **60/64 — boot receiver starts the link** | **UNKNOWN beyond the S25** | **1** | Closed on the S25 only, and only after revoking the listener grant to remove the competing route. **Never run on any other device.** The g45 was prepared for the cleanest version of it and it was not taken (N1) |
| **62 — a crash does not leave the phone serverless** | **works on 2 images, by two different routes** | **2** (S25, g45) | S25 recovered via `LISTENER_REBIND`; g45 via **`ACCESSIBILITY_BIND`**. The *fix* is not Samsung-shaped; the *evidence* for it was. **`START_STICKY` alone has never been exercised on any device** (N3) |
| **61 — wake lock re-arms before its 60-minute timeout** | **UNKNOWN beyond the S25** | **1** | S25 measured at 59m49s against 60 minutes. On the g45 the lock was seen **held and re-acquired by the post-crash process** — which is not the same claim. Needs a t+59m sample showing a reset `ACQ` age (N2) |
| **79 — the phone will not overwrite a clipboard it cannot report** | **UNKNOWN beyond the S25** | **1** | Not re-run anywhere |
| **57 — `media.thumb` tells corrupt from deleted** | **UNKNOWN beyond the S25** | **1** | Not re-run anywhere |
| **28 — the `<queries>` block is load-bearing** | **2 images, with an A/B/A control** | **2** (S25, g34) | g34: with block **109/109**, without **3**, restored **109**. Not Samsung permissiveness |
| **50 — bound `date < ?` returns an empty cursor** | **still `unknown, single-device`** | **1** | The g34 has stock `TelephonyProvider` (provenance) but the reading was not authorised; the g45 and RMX3870 each got **page one only**, which this repo's own precondition says is not evidence. **A provenance argument standing in for a measurement, for a week** |
| **55 — `fs.list` per-page cost** | **UNKNOWN beyond the S25** | **1** | Needs a persisted grant on a ~16k directory; never available elsewhere |
| **One UI's battery manager kills backgrounded FGS** — *the premise of Phase 6* | **NOT COMPARABLE YET** | 1 vendor claim, 1 counter-image | Motorola's BatteryCare exists and restricts **0 packages device-wide** via `RUN_ANY_IN_BACKGROUND`. Whether it kills a backgrounded service is **unmeasured** — it needs the overnight run nobody has done on any second device |
| **Battery exemption out of the box** | **vendor-conditional, measured** | **3** | S25 **exempt** (contaminating Phase 6's central experiment) · RMX3870 **exempts itself during onboarding** · g34 ships **un-exempt** — the only clean unexempt reading, then lost to a third party mid-run |

### C. The shape of the gap, stated plainly

**Every wall in section A rests on 2–3 images. Almost every fix in section B rests on one.** That
asymmetry is the finding: this project has tested its *understanding of the platform* on several
devices and its *own reliability work* on almost none — and section B is the half that
`CLAUDE.md` warns "fails silently everywhere else" when tuned to one OEM.

The single most valuable reading available anywhere in this table is **not** on this vivo. It is
**N1 on the moto g45** — the boot path, on a handset where the competing route is absent by default
rather than by revocation. It is one reboot.

---

## §4. THE RUN ORDER — reprioritised 2026-09-08, still before any reading

§3 was written as a survey. Read back, it carries an instruction, and the instruction **reverses
the order this run was going to take**:

> The walls fail safely and the fixes fail silently. Every wall rests on 2–3 images; almost every
> Phase 6 fix rests on one. So re-run **our own fixes** ahead of re-confirming platform facts we
> already have three images for. **If the run only has time for one half, take that half.**

That is now the order. It is written here, before the device has answered anything, because an
order chosen after the readings is not an order — it is a rationalisation of whatever happened to
work.

### The consequence nobody should have to rediscover

The walls in §3.A are the rows this device was *interesting* for. Deprioritising them is **not**
saying they are settled — V1–V5 stay in §1 and get taken if time allows. It is saying that a fifth
confirmation of a wall that already holds on three images is worth less than a **first**
confirmation of a fix that holds on one.

### Order

| | What | Why here | Blocking cost |
|---|---|---|---|
| **1** | **§5 — the picker's origin.** One command, before anything else | It is a **branch**, not a reading. If this device ships a **non-Google DocumentsUI**, the SAF wall jumps from "worth less than a fix" to **the single most valuable reading available on any device**, and the order below inverts. One command decides which run this is | seconds |
| **2** | **62 — crash recovery**, and *which route* served it | Cheapest fix reading. Two images so far, by two different routes. A third image with **neither** grant would finally exercise `START_STICKY` alone (N3, never run anywhere) | minutes, no consent beyond install |
| **3** | **Defect 50, reading A** — the bound selection | The instrument now exists (`SmsProbeActivity`). Needs `READ_SMS` and a phone with messages. **Reads no message content**, which is what makes it proportionate here | one grant |
| **4** | **60/64 — the boot path** | The fix with the thinnest evidence in the repo: **one image, and only after revoking a grant to clear the route.** If this device has neither bind route by default it is as clean as the g45's prepared N1 | a reboot + unlock — **owner's consent** |
| **5** | **79 / 57** — clipboard-overwrite refusal, `media.thumb` corrupt-vs-deleted | One image each. Both need the link up, so both need a QR pair | pairing |
| **6** | **61 — the wake lock's 60-minute re-arm** | One image. Passive but long: a sample at **t+59m** showing a **reset** `ACQ` age, not one at t+61m showing a lock that exists | ~1 hour idle |
| **7** | **V1–V5, the SAF wall** | Only if §5 says Google's picker. Otherwise this is item 1 | minutes |
| **8** | **55 — `fs.list` per-page cost** | Needs a persisted grant on a ~16k directory, i.e. somebody's photos. Lowest priority and highest intrusion | a grant on real data |

### The reading this order cannot reach, said plainly

**N1 on the moto g45 outranks every row above** and is not on this device. The g45 is prepared for
it — no notification-listener grant, so revoking accessibility leaves `BOOT` as the only route —
and that preparation is not portable: it is a property of that handset's current grant state, and
re-establishing it here costs the same reboot plus an install. Deprioritising the walls does not
conjure that reading onto the vivo. It stays owed, and it stays one reboot.

---

## §1. Identity, read 2026-09-10 — and the pin's unverified claim was right

§0 above was written while the device was unauthorized and recorded the model as **unread**, with the
pin carrying `V2141` on somebody's say-so. It is read now, and the pin's model check confirms it
rather than being trusted:

```
serial    137354726800049
model     V2141              ← target-device.sh checks this against the device and agreed
vendor    vivo               device 2141
release   Android 14         sdk 34        patch 2025-03-01
panel     1080 x 2408 @440dpi
```

**sdk 34 is a third OS version in this repo** — 36 on the Samsung, 35 on both Motorolas, 34 here —
and the first below the two the SAF and clipboard work was measured on.

### The panel is the point, and it is a third distinct ratio

| handset | panel | height ÷ width |
|---|---|---|
| SM-S938B | 1440 × 3120 | **2.16667** — exactly 19.5:9, the ratio defect 99's box hard-coded |
| moto g34 · g45 | 720 × 1600 | **2.22222** |
| **vivo V2141** | 1080 × 2408 | **2.22963** |

Three ratios, none of them equal. This is the handset that can falsify the fit fix, which is why it
went first.

**And it settles a mistake made against the Samsung.** Defect 99's slice first claimed the reference
device was *itself* ~20:9 with 1.6px bars, inferred from a stale 480×1070 canvas backing store. It is
19.5:9 exactly. `480 × 1070` is what a 480-capped capture of a **1080×2408** panel gives — this
device's geometry, from a phone that had never run the app. Where that frame came from is unresolved;
what is resolved is that a decoded frame is evidence about whatever produced it, and nothing in the
reading said what.

## §2. Installed 2026-09-10, deliberately **not paired**

```
packages matching connectsuite   READING 0 of 345   →   READING 1 of 346
runtime grants                   READING 14 of 327 lines match granted=true
standby bucket                   50 (NEVER, never opened)  →  10 (ACTIVE, after one launch)
```

Not paired, and that is a decision rather than an omission: **defect 17** — the Mac holds one phone
structurally and refuses the second rather than evicting it — so pairing this device costs the S25
pairing that the day's mirror work depends on. The install alone starts the clock in §3; the fit
reading waits for a sitting that can afford the swap.

## §3. The defect 102 baseline — a reading that cannot be taken on demand

Defect 102 is One UI restricting **this app specifically** (`RUN_ANY_IN_BACKGROUND: ignore`) because
it judged the app unused. Whether other vendors do the same is the obvious next question and **it
cannot be answered by a command today**: a freshly installed app has not been unused for anything.
It needs time, not effort — which is why the baseline is recorded now, on the day of install.

**Today, on this vivo:**

| | |
|---|---|
| ours | **unset** — the op has never been written, i.e. default allow |
| 8 third-party apps incl. WhatsApp, PhonePe, Messenger, Docs | **8 of 8 unset** |
| `app_standby_enabled` | 1 |
| `battery_tip_constants` | `app_restriction_enabled=true` |

**The contrast with the Samsung is already informative.** There, 2 of 8 sampled apps had the op
*explicitly set to `ignore`* — ours and the other app the owner rarely opens. Here **nothing at all
has been written**, for any app. So Samsung actively writes this op and vivo, so far, does not.

**What would make this a finding rather than a first data point:** re-read the same two lines after
this app has sat unopened for several days. If ours goes to `ignore` while the eight controls stay
unset, defect 102 reproduces on a second vendor. If it stays unset while the app is equally
neglected, the restriction is Samsung's and the onboarding copy can say so.
