# The second device — moto g34 5G, and what it can settle

**Opened 2026-09-05.** The first handset other than the SM-S938B this project has ever run on.
`docs/single-device-audit.md` §6 asked for exactly this and named four things it would buy, in
priority order. This file is the record of what was predicted, then what was read.

```
model    moto g34 5G       (fogos / fogos_g)
serial   ZA222JT75K
release  Android 15        sdk 35        ← meets minSdk 29; below our targetSdk/compileSdk 36
build    V1UGS35H.75-14-9-3-1-3 / 38456a-a80bd5   user / release-keys
patch    2026-07-01        (vendor patch identical: 2026-07-01)
soc      QTI SM6375 "holi" — arm64-v8a
screen   720x1600 @ 280dpi
users    0 (owner) · 11 "Vault Profile" (VAULT_PROFILE, a profile of 0, DISABLED)
gms      15_202510
```

---

## §1. PRE-REGISTERED PREDICTIONS — written 2026-09-05 before any behavioural reading

Recorded before the measurements so a surprise is visible as a surprise. Each row names the
direction expected **and what it would mean if it went the other way**, because a prediction with
no consequence attached is a guess that will be rewritten to match whatever came back.

| # | Audit row | Prediction | If it goes the other way |
|---|---|---|---|
| P1 | Storage root not grantable (§3.A) | **REFUSED here too.** Same component: `com.google.android.documentsui`, `/data/app`, Play-updated | The refusal is version- or vendor-conditional, and the Folders screen's wall copy is asserting a fact to users that is false on some devices |
| P2 | `Download` itself not grantable (§3.A) | **REFUSED here too**, same basis | Same as P1, and worse — this is the row the `Download/ConnectSuite` design is built around |
| P3 | Folders *inside* `Download` grantable | **GRANTABLE here too** | The grant-free destination design loses its escape hatch |
| P4 | `EXTRA_INITIAL_URI` honoured; bad aim degrades to parent (Slice 9) | **Honoured** | The quick-pick chips are aiming at nothing on a third of the market |
| P5 | An OEM overlay on DocumentsUI | **None from Motorola.** Expect Google's own mainline RRO only | A vendor RRO would mean the picker's *behaviour* is negotiable per-device, not just its version |
| P6 | Defect 50 — `mms-sms/conversations` answers a **bound** `date < ?` with an empty cursor (§3.C) | **DOES NOT REPRODUCE.** The provider here is stock `TelephonyProvider`, not `SecTelephonyProvider`. Verdict moves `unknown` → **vendor (Samsung)** | If it reproduces on stock AOSP, it is a *platform* behaviour and the audit's headline provenance argument is weaker than it looks |
| P7 | Battery exemption out of the box (phase-6-brief §0) | **NOT exempt.** The Samsung was already exempt and contaminated Phase 6's central experiment. This device should give the unexempt reading Phase 6 could not take at all | If it ships exempt, the unexempt case has *no route on this device either* and stays unsettled |
| P8 | Standby bucket | **ACTIVE** immediately post-install, on a device being actively driven | A fresh install landing in a worse bucket is a vendor behaviour worth naming |
| P9 | A vendor background-restriction surface beyond AOSP | **Present** — `com.motorola.batterycare` is installed, with an `appside` overlay | Absence would make this a near-stock control for One UI |
| P10 | A Samsung-`DUAL_APP`-style **full** clone user | **ABSENT.** User 11 is a *profile* (parentId=0), flagged `VAULT_PROFILE`, and disabled. So §3.E's "user 95 reads false" permission control **does not exist here** and those readings need a different control | If a full clone user exists, §6.3 is not settled |
| P11 | Package visibility R2 — packages enumerated **with** the `<queries>` block | **All launcher packages, ratio 1.0**, as on the Samsung (123/123) | A shortfall on near-stock means our `<queries>` block is incomplete rather than Samsung being permissive |
| P12 | R2 **without** the block | **Sharply fewer** — self plus a handful | No difference would mean the block is not load-bearing and defect 28's fix is untested |
| P13 | Defect 55 — `fs.list` per-page cost, unfixed | **Same O(n)-per-page shape, different constant.** SM6375 is a far slower SoC than the S25 Ultra's, so if a comparably large directory exists here the unfixed cost should be **worse than 490 s**, and the snapshot fix should still give a large multiple | A flat cost per page would mean some providers *do* honour limit, and the fix is unnecessary there |
| P14 | DocumentsUI version | Expected to differ from the Samsung's 17 — it is Play-updated per §6.4 | Identical versions would waste the chance to test §6.4's expiry-date claim |

**What this device cannot settle, stated up front so no reading is over-claimed:**

- It has **Google's** DocumentsUI, like the Samsung. So P1–P4 can confirm the behaviour across two
  vendors *and* two picker versions, and **cannot** distinguish "Google's picker refuses this" from
  "every picker refuses this". A device shipping a non-Google picker is still owed.
- It is **Android 15 / SDK 35**, not 16 / 36. Any difference found is confounded between vendor and
  platform version, and every row below that turns up a difference has to say so.
- One handset per vendor is still one handset per vendor. "Motorola does X" is not established by
  a moto g34 any more than "Samsung does X" was established by an S25 Ultra.

---

## §2. IDENTITY AND PROVENANCE — read 2026-09-05, no device state changed

`docs/single-device-audit.md` §2's method — *ask which package implements the thing you measured and
where its APK lives* — re-run on this handset. **This is the table §6.2 asked for.**

| Behaviour | moto g34 5G | SM-S938B | Same? |
|---|---|---|---|
| SAF **picker** | `com.google.android.documentsui` — `/data/app`, versionName **16**, versionCode 361521000, targetSdk **36**, updated **2026-04-13** | same package — `/data/app`, versionName **17**, targetSdk 37, updated 2026-07-16 | **Same origin, different version.** Both Google, both Play-updated |
| …factory copy underneath | `/system/priv-app/DocumentsUIGoogle`, versionName **15**, targetSdk 35 | not recorded | — |
| …**overlay** | `com.google.android.overlay.modules.documentsui` — `/product/overlay/GoogleDocumentsUIOverlay.apk`, **Google's own mainline RRO**, enabled. **No Motorola overlay targets DocumentsUI** (63 Motorola overlays present, none aimed at it) | not recorded | **No OEM overlay here** |
| `MediaStore` | `com.google.android.providers.media.module` — `/apex/com.android.mediaprovider/…@361521100` | same package, same APEX path | **Same** |
| SAF tree provider | `com.android.externalstorage` — `/system/priv-app/ExternalStorageProvider/` | same path | Same name; both in a vendor-built image |
| **Telephony provider** | `com.android.providers.telephony` — **`/system/priv-app/TelephonyProvider/TelephonyProvider.apk`** | **`/system/priv-app/SecTelephonyProvider/SecTelephonyProvider.apk`** | **DIFFERENT — this is the important row.** Stock name *and* stock APK here; Samsung's build behind the same name there |
| Contacts / call log | `com.android.providers.contacts` — **stock AOSP** | `com.samsung.android.providers.contacts` — **Samsung's** | **DIFFERENT** |
| Dialer / in-call | `com.google.android.dialer` — Google's, `/data/app`, Play-updated. No separate in-call package | `com.samsung.android.dialer` + `com.samsung.android.incallui` | **DIFFERENT** |
| Vendor background manager | `com.motorola.batterycare` (+ `batterycare.overlay`, `batterycare.overlay.appside`, a settings RRO) | One UI battery manager | Different vendor implementations of the same category |
| Multi-user | user 11 `Vault Profile`, flags `VAULT_PROFILE`, **a profile of user 0**, disabled. `com.motorola.securevault`. App Clone exists as overlays (`com.motorola.android.overlay.appclone`) but no clone user is provisioned | users 0, **95 `DUAL_APP`** (full), **150 Secure Folder** | **DIFFERENT — P10 confirmed.** No full clone user |

**The telephony row alone settles what §6.2 said one command would settle**, and it settles it in
the direction the audit predicted: the Samsung's `mms-sms` provider is Samsung's code, and this one
is not. That is *provenance*, not behaviour — §2's own warning is that **a package name is not
provenance**, and the inverse holds too: a stock path is not a promise of stock behaviour. P6 is
still a measurement to be taken, not an inference to be drawn from this table.


---

## §3. THE READINGS — moto g34 5G (ZA222JT75K), 2026-09-05

**Every row names its handset**, because the point of `docs/single-device-audit.md` is that findings
stop being attributed to "Android" when they are about one vendor. Where a row says *both*, it means
the same behaviour was read on the SM-S938B and on this device, by the same probe, and **not** that
it is a property of Android.

### 3.1 SAF picker — P1–P5. **The block this device was brought in to settle.**

Caller: `com.chetan.connectsuite.debug` at `targetSdk=36`, through `SafProbeActivity`. A
shell-launched intent has no calling package and would be a different client, which is defect 50's
rule and the reason the probe exists. Evidence: `docs/evidence/saf-probe-moto-2026-09-05/README.md`.

| # | Reading | moto g34 5G | SM-S938B | Control |
|---|---|---|---|---|
| P1 | **Root of internal storage refused** | **CONFIRMED.** `USE THIS FOLDER` (`button1`) `enabled=false`, with `Can't use this folder` / `To protect your privacy, choose another folder`. 13 folders listed normally | same | 167 nodes in the dump; `CREATE NEW FOLDER` reads `enabled=true` in the **same dump** |
| P2 | **`Download` itself refused** | **CONFIRMED.** Same button `enabled=false`, same two strings, breadcrumb `moto g34 5G › Download` | same | 164 nodes; `CREATE NEW FOLDER` `enabled=true` in the same dump |
| P3 | **A folder inside `Download` is grantable** | **CONFIRMED.** `enabled=true`, and **no refusal message at all** | same | 47 nodes. This is the discriminator: the *same* button one level deeper reads `true`, which is what makes P1/P2's `false` a refusal rather than a dead control |
| P4a | `EXTRA_INITIAL_URI` honoured for a folder that exists | **CONFIRMED.** Aimed at `Download` → landed in `Download`; aimed at `Pictures` → landed in `Pictures` | same | Two different targets, each landing where aimed, rules out "it ignores the extra and we got lucky" |
| P4b | A bad aim **degrades to the parent** | **NOT CONFIRMED — this is the surprise.** See §3.2 | recorded as parent-degradation | — |
| P5 | No Motorola overlay on DocumentsUI | **CONFIRMED.** 63 Motorola RROs on this device, **none targeting DocumentsUI**. The only overlay is Google's own mainline `com.google.android.overlay.modules.documentsui` | not recorded | `cmd overlay list` returns 63 Motorola entries, so the query works and the absence is an absence |

**What P1–P3 are now, and what they are still not.** They hold on **two vendors and two DocumentsUI
versions** (16 here, 17 there), which is stronger than the audit's `AOSP / Mainline, versioned by
DocumentsUI` verdict was entitled to be from one device. They are still **not** established as
"every Android device", because **both handsets run Google's DocumentsUI**. A device shipping a
non-Google picker is still owed, and the Folders screen's wall copy still rests on that gap.

The audit's §6.4 worry is now measured rather than hypothesised: the two devices carry **different
versions of the deciding component** — 16 vs 17 — and behave identically. That is evidence the
refusal is stable across the Play-updated range seen so far, and it is *not* a guarantee about
version 18.

### 3.2 The surprise: a bad aim does not degrade to the parent here

Aiming at `Download/ConnectSuite`, **which does not exist on this device**, the picker opened in
**`DCIM`** — not in `Download` (the parent, which is what the SM-S938B reading records) and not at
the storage root.

Three hypotheses, two of them **ruled out by measurement**:

| Hypothesis | Test | Result |
|---|---|---|
| It degrades to the **parent** | aim at `Download/ConnectSuite` | landed in `DCIM`, not `Download`. **Ruled out** |
| It restores the **last visited** location | aim at `Pictures` (landed there), back out, re-aim at the bad target | landed in `DCIM`, **not** `Pictures`. **Ruled out** |
| It returns to the folder we hold a **grant** on | released every persisted grant (`pm clear`, grant rows 1 → 0, verified), re-aimed | still `DCIM`. **Ruled out** |

**Still live, and not settled here:** DocumentsUI's own default landing folder, or the last
**successfully granted** folder remembered inside *DocumentsUI's* data (which `pm clear` on our
package does not touch). DCIM was the folder granted at 14:58:54, so both remain consistent with
every reading above.

**The stimulus that would separate them, named rather than guessed:** grant a folder that is *not*
`DCIM`, then re-aim at a non-existent target. If it follows the new grant it is last-granted; if it
returns to `DCIM` it is a default. **It was not run**, because each cycle takes a fresh persisted
grant on a folder belonging to a person who is not the developer, and the answer does not change any
product decision — see below.

**What this does and does not cost the product.** The quick-pick chips' constraint — *no chip may
point inside `Download`* — was derived from parent-degradation walking the user into `Download`'s
refusal. On this handset that mechanism does not exist, so the constraint is **not load-bearing
here**; it remains correct and remains necessary for the Samsung. The honest statement is that the
constraint is right on both devices **for different reasons on each**, and the audit's flat sentence
*"a bad aim degrades to the parent"* is a **single-device reading that this device contradicts** and
must stop being written as general.

### 3.3 Battery and Doze — the row Phase 6 could not settle at all

**P7 — CONFIRMED, and this is the reading Phase 6 had no route to take.** Read **before first
launch**, which matters because launching is what contaminates it:

```
notLaunched=true  stopped=true            ← never run; the reading is genuinely out-of-the-box
deviceidle whitelist: NOT present         ← NOT exempt
standby bucket: 50 (NEVER)
```

**Controls, both directions.** Absence: the whitelist returned **110 entries** and a known positive
(`com.android.vending`) was among them, so "not in the whitelist" is an absence in a working query
rather than an empty read. Discrimination: `am get-standby-bucket` returned **5** for two other
packages against our **50**, so the command distinguishes values.

`phase-6-brief.md` §0 records that the SM-S938B was **already exempt**, so the obvious experiment
there measured the wrong path. **This handset ships un-exempt**, and that is the missing control.

**Bucket 5 = EXEMPTED, established by correlation rather than assumed:**

| package | bucket | in doze whitelist |
|---|---|---|
| `com.android.vending` | 5 | yes |
| `com.motorola.bug2go` | 5 | yes |
| `com.linkedin.android` | 10 | no |
| `com.whatsapp` | 40 | no |
| `com.twitter.android` | 40 | no |

**P8 — NOT confirmed, and the reason is worth more than the prediction.** Predicted `ACTIVE` after
launch. Measured **5 (EXEMPTED)**, because between the two readings our package acquired a doze
whitelist entry:

```
user,com.chetan.connectsuite.debug,10902     ← the "user" section, not system-excidle
user rows: 4 before the install → 5 after
```

**Nothing in this session asked for it.** The only route in our code is
`Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, reachable only from `OnboardingScreen`,
which was never launched; `SafProbeActivity` contains no battery code. **The phone was being
operated by its owner throughout** — task history shows the launcher active 5 s and Settings 4 s
before the reading, and the DCIM grant at 14:58:54 was a human tap, not ours. The exemption was
almost certainly granted by that person through Settings.

So **P8 has no reading**, and saying so is the finding. This is `phase-6-brief.md` §0's failure with
the source moved outside the experiment: there the instrument's own state contaminated the reading,
here **a third party changed the state mid-run**. The pre-launch P7 numbers stand because they are
timestamped before the contamination and carry their own controls; everything measured after it is
confounded and is not recorded as a result.

**P9 — CONFIRMED with a qualification that cuts against expectation.** `com.motorola.batterycare`
v2.0.0.127, `/system_ext/priv-app/BatteryCare`, holding `WRITE_SECURE_SETTINGS`. But:

```
packages with RUN_ANY_IN_BACKGROUND: mode=ignore  →  0     (device-wide)
mentions of our package in the batterycare dump   →  0     (control: dump is 419 lines)
```

**Not one package on this device is background-restricted through the AOSP app-op.** Whatever
BatteryCare does, it is not implemented as `RUN_ANY_IN_BACKGROUND`, so an app checking that op would
conclude this device restricts nothing. Whether it enforces by another route is **unmeasured** — it
needs a backgrounded service left overnight, which is the Phase 6 experiment and was not run here.

**P10 — CONFIRMED.** No Samsung-`DUAL_APP`-style full clone user. User 11 is `Vault Profile`, flags
`VAULT_PROFILE`, `parentId=0`, **disabled**. App Clone exists only as RROs with no user provisioned.
So `docs/single-device-audit.md` §3.E's control — *user 95 reads `false` on everything* — **does not
exist on this device**, and §6.3 is settled: permission readings here need a different control.

### 3.4 Package visibility — P11 and P12, with the R3 control the Samsung run never had

`AppsProbeActivity`, A/B/A across a manifest change, each build verified in the **merged manifest**
rather than in the source:

| Build | `<queries>` in merged manifest | R2 packages | known-present control |
|---|---|---|---|
| with the block | 1 | **109** | 3 of 3 |
| **block removed** | **0** | **3** | **2 of 3 — probe's own control went red**, Chrome invisible |
| restored | 1 | **109** | 3 of 3 |

**P11 confirmed** (109 of 109, ratio 1.0) and **P12 confirmed** (3 of 109, 0.028). The `<queries>`
block is **load-bearing on a second vendor**; defect 28's fix is not Samsung-specific permissiveness.
The probe's KDoc explicitly warned that an un-controlled healthy count *"may be this OEM being
permissive rather than the manifest working"* — that control has now run.

**Ground truth was recounted in the app's unit**, per CLAUDE.md's units rule:

```
launcher ACTIVITIES : 109      ← the wrong unit to compare
launcher PACKAGES   : 109      ← the unit the app counts
installed packages  : 474
```

**And here the units trap is invisible, which is more dangerous than when it bites.** On the
SM-S938B the two numbers were 244 and 123, and comparing them invented a 45% visibility gap. On this
handset **every launcher package publishes exactly one launcher activity**, so the two counts
coincide at 109 — a person comparing the wrong units would get **the right answer** and learn
nothing. A units error that cannot be detected on the device in front of you is a reason to state
the unit rather than to check the number.

**Instrument fault found, not fixed:** `AppsProbeActivity` prints
`ground truth from adb (2026-09-02): 244 launcher-resolvable, 615 installed` as a **hardcoded
constant from the SM-S938B**. On this device the real figures are 109 and 474, so the probe's own
banner is wrong by 2.2× and would be read as a catastrophic visibility gap by anyone trusting the
line beneath the reading. It is the stale-denominator failure of defect 78 with the number frozen in
source. **It is left as-is and recorded here** rather than patched mid-run, because changing an
instrument between its two halves is how an A/B comparison stops being one.

### 3.5 Not taken, and why — stated so nothing is read as settled

| # | Reading | Why not | What it needs |
|---|---|---|---|
| **P6** | **Defect 50** — does `content://mms-sms/conversations` answer a **bound** `date < ?` with an empty cursor? | The provider here is stock `TelephonyProvider`, **not** `SecTelephonyProvider` (§2), which is the provenance §6.2 asked for — but **provenance is not behaviour**, and §2's own rule is that a package name is not provenance. Taking the reading means granting `READ_SMS` and paging a **third party's real message threads**, which was not authorised and is not proportionate to the question | The same probe on a device whose owner is the developer. Until then defect 50 stays **`unknown, single-device`** — the stock-APK path is suggestive, not a result |
| **P13** | **Defect 55** — `fs.list` per-page cost | Needs a persisted grant on a directory of ~16k entries, which on this handset is the owner's `DCIM`, and a full paging run over their photo filenames | A large directory on a device we own. Note the *number* was never portable — the audit already says the fix is portable and the 490 s is not |
| **P8** | Standby bucket after launch | Confounded by a third party mid-run (§3.3) | A device nobody else is holding |

