# App launching — the measurement, then the payload

> **Written 2026-09-02. §2 RAN ON HARDWARE 2026-09-03 — the results are in §2.4 and they decide the
> feature.** The verb names were fixed in `docs/protocol.md` *before* the measurement, deliberately,
> so a refusal could not be absorbed into a verb that promises more than the platform allows.
>
> **Outcome in one line: `apps.launch` will never be implemented; `apps.open.ask` is the feature.**
>
> `apps.list`, `apps.launch` and `apps.icon` have been named in `docs/protocol.md`'s message-type
> inventory since Phase 2 and implemented nowhere. They are on the Reference behaviour list, and app
> launching is the largest absent feature in the product.
>
> This document is deliberately shaped like `docs/phase-5-clipboard-proposal.md` rather than like
> `docs/phase-5-fs-media-proposal.md`: **the wall comes first and the payload comes second**, because
> two platform questions decide what the feature *is*, and neither has been answered on this device.
> The clipboard proposal earned that shape — its §2 wall turned out to be measurable and the answer
> changed the product. Designing a payload on top of an assumption is how `media.*` ended up
> specified nowhere for a phase.

## 0. What is already decided, by code that exists

Two decisions are made and must not be re-opened by this feature.

### 0.1 `<queries>`, not `QUERY_ALL_PACKAGES` — already chosen, with a reason

`sync-module/src/main/AndroidManifest.xml` already declares:

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent>
</queries>
```

It was added for **defect 28** — Android 11+ package visibility hid almost every app from
`getApplicationInfo`, so notification rows were labelled `com.google.android.apps.messaging` where
*Messages* belonged. Its comment records the alternative and why it was refused: `QUERY_ALL_PACKAGES`
is flagged by Play policy for anything that is not a launcher or a security tool, and the
launcher-intent set *is* the right set rather than a lesser one.

**That is exactly the set `apps.list` wants.** An app worth launching from a Mac is an app with a
launcher icon, by definition. So the visibility question may already be answered — **and "may" is
the word §2.1 exists to remove.**

### 0.2 A package id is a handle, never the only thing a user reads

`CLAUDE.md`'s rule, from defects 28 and 33. `apps.*` will meet package ids in more places than any
namespace so far: the list, the launch request, the icon request, every error `message`, and the
Mac's own logs. Resolution goes through `AppLabels.of`, always, including when it fails — it returns
the package name as its honest fallback and **counts** the fallback, so "12 fallbacks" can be told
from "12 of 12 fallbacks".

## 1. The two questions that decide the feature

| | Question | Why it decides the shape rather than the details |
|---|---|---|
| **Q1** | What can the app actually enumerate? | If the launcher-intent `<queries>` yields the real launcher set, `apps.list` is a straightforward list. If it is filtered further, the Mac shows a partial list of the user's apps with no way to say what is missing — a different product |
| **Q2** | Can the phone launch an app while ConnectSuite is backgrounded? | If not, `apps.launch` cannot be a remote-control verb at all. It becomes *"tap this notification to open Instagram"*, which is a different feature with a different name |

**Q2 is the clipboard shape and it is the one that will hurt.** The clipboard's wall was that a
backgrounded app may not *read* the clipboard, and the pre-registered decision was that a refusal
makes it a foreground-only feature — *a different product, and that is decided already*. Here the
equivalent is worse: **a verb that returns success and does nothing** is the specific failure mode to
design against. `startActivity` from a blocked background context does not always throw; on some
Android versions it logs and returns, and the Mac would draw a success.

## 2. The measurement, with its controls

**Nothing below §2 may be built first.** The instrument is `AppsProbeActivity`, debug-only, in the
shape of `ClipProbeActivity` and `SafProbeActivity` — an activity because Q2's answer depends on
process state, which a unit test cannot have.

### 2.1 Q1 — what can we enumerate?

Ground truth from the platform, measured 2026-09-02 on the SM-S938B (adb sees everything; the app
sees a filtered view, and the gap between them is the whole question):

```
$ adb shell pm list packages                     → 615 packages installed
$ adb shell pm list packages -3                  → 112 third-party
$ adb shell cmd package query-activities \
    -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER          → 244 launcher-resolvable
```

**244 is the number the app must be compared against**, and it is not obvious which of the three the
platform will hand us.

The reading, through the client the product uses:

| Reading | Query | The lookalike it excludes |
|---|---|---|
| **R1** | `getInstalledApplications(0).filter { getLaunchIntentForPackage(it) != null }.size` | This is the **existing product code** in `SyncSettingsViewModel.loadInstalledApps`, not a new query. A fresh probe would be a different client — the rule from defect 50 |
| **R2** | `queryIntentActivities(MAIN/LAUNCHER)` count | Whether the two enumeration routes agree. If they disagree, that is a finding in itself and the third query decides |
| **R3** | R1 with the `<queries>` block **temporarily removed** | The control. If R1 is unchanged without the declaration, the declaration is not what makes it work, and the reading proves nothing about visibility |

**R3 is the control that makes R1 and R2 evidence.** Without it, a healthy-looking count could be
the platform being permissive on this OEM build rather than the manifest doing its job — and the
first Play-flagged install would find out.

**Report the misses, not just the count.** `244 visible` is one number; `244 of 244` is a reading.
If the app sees fewer, the probe prints **which packages are missing**, because *"12 fewer"* and
*"the 12 that happen to be Samsung's"* are different findings.

### 2.2 Q2 — may we launch from the background?

`DEFAULT_RESCIND_BAL_FG_PRIVILEGES_BOUND_SERVICE` and three sibling BAL changes are **live for this
package**, read from the device rather than a release note:

```
$ adb shell dumpsys platform_compat | grep BAL_
ChangeId(261072174; name=DEFAULT_RESCIND_BAL_FG_PRIVILEGES_BOUND_SERVICE; enableSinceTargetSdk=34)
ChangeId(296478951; name=DEFAULT_RESCIND_BAL_PRIVILEGES_FROM_PENDING_INTENT_CREATOR; enableSinceTargetSdk=35)
ChangeId(244637991; name=DEFAULT_RESCIND_BAL_PRIVILEGES_FROM_PENDING_INTENT_SENDER; enableSinceTargetSdk=34)
```

`targetSdk` is 36, so all of them apply. **This project has already been bitten by the same wall
once**: `MirrorScreen`'s class comment records that *"Android 16 blocks background activity starts,
so a `mirror.start` arriving while the app is backgrounded cannot raise the system capture prompt by
itself"*, and the answer there was a notification the user taps.

**There is no prior art for launching a *third-party* app.** Both `getLaunchIntentForPackage` calls
in the tree — `ConnectionService.launchAppIntent` and `LinkService`'s notification — launch **our
own** app through a `PendingIntent` a person taps. Neither is a background start and neither
generalises.

The readings, each in a named process state, because the answer is a function of state:

| Reading | State | What is being separated |
|---|---|---|
| **R4** | ConnectSuite foreground | The control. If a launch fails *here* the probe is broken, not the platform |
| **R5** | Backgrounded, screen on, `LinkService` in the foreground with `connectedDevice` | The real case. This is what `apps.launch` would run in |
| **R6** | Backgrounded, screen **off** and locked | The other real case, and the one users will actually hit |
| **R7** | Via a posted notification the user taps | The known-good fallback, and the shape the feature degrades to |

**Each reading records three things, not one:** whether `startActivity` threw, whether the activity
actually came to the front (read from `dumpsys activity activities`, not inferred), and what
`logcat` said. That triple exists because the failure being designed against is **success returned
and nothing launched** — the first two disagreeing *is* the finding.

### 2.3 The pre-registered decision table

Written **before** the readings, so nothing can be rationalised afterwards.

| R5 / R6 outcome | What `apps.launch` is | What ships |
|---|---|---|
| Launch works backgrounded, screen on **and** off | A remote-control verb | `apps.launch` launches. The Mac's app grid is a launcher |
| Works screen on, blocked screen off | A verb with a stated precondition | `apps.launch` launches when it can and returns **`PHONE_LOCKED`** otherwise — an existing code, not a new one. The Mac says *"unlock your phone to open apps from here"* before the user tries |
| Blocked in both | **Not a launch verb.** A notification the user taps | Renamed in the contract. `apps.launch` posts a notification — *"Open Instagram?"* — and returns an ack meaning *asked*, never *opened*. The Mac's copy says *"sent to your phone"* |
| Returns success and does not launch | **The feature does not ship** | A verb that lies is worse than an absent one. It becomes a documented platform wall in `CLAUDE.md` beside the others, and `apps` stays unadvertised |

**The fourth row is the one this table exists for.** It is the outcome that looks like success to
every automated check and fails only in the user's hand.

## 3. The payload sketch — conditional on §2, and not to be built first

Written thin on purpose. The shape below assumes row 1 or 2; rows 3 and 4 change it.

- **`apps.list`** — request `{}`, response `{ apps: [{ package, label, versionName?, updatedMs }], count }`.
  `label` is required and comes from `AppLabels.of`; `package` is the handle. Paged the way every
  other list in this contract is, with the boundary count published beside the totals (`CLAUDE.md`'s
  tiebreak rule) — 244 entries is one page in practice and the pager must still be proven on
  consecutive pages rather than on its first.
- **`apps.icon`** — request `{ packages: [..] }`, response one entry per package with base64 PNG or a
  per-item `error`, exactly like `media.thumb`: one missing icon must not lose the other 31.
  Icons are adaptive on this device (`AppIconSolution` appears in the platform log), so the probe
  must record what `getApplicationIcon` returns for an adaptive icon before a size is fixed.
- **`apps.launch`** — request `{ package }`. Response depends entirely on §2 and is **not specified
  here**.

**Deliberately absent:** uninstalling, force-stopping, clearing data, and anything that changes an
app's state. This namespace reads and it opens. `scripts/hooks/no-force-stop.sh` exists because
force-stopping was harmful when *we* did it deliberately.

## 4. What this deliberately does not decide

- **Whether the Mac's app list is a grid, a palette entry, or both.** A design question, and the
  palette already carries deep links (`docs/testing.md` → Phase 7 Slice 2).
- **Whether launching is offered while mirroring.** Launching an app *and* seeing it are obviously
  complementary; whether that is one gesture or two is a product decision.
- **Whether work-profile apps appear.** `pm list packages` reported a `SecurityException` for user
  150 on this device (Secure Folder), so the answer is probably "no, and the platform will not even
  tell us they exist". Worth one reading, not worth a design until then.

## 5. Why nothing is built

Because §2 has not run, and the honest reason is in the table in §2.3: **two of the four outcomes
produce a different feature, and one produces no feature at all.** Writing `apps.launch` first would
mean writing the version that assumes the best row, and this project's own record says what happens
then — `media.*` sat in the inventory unspecified for a phase, and the clipboard's wall was inherited
from documentation for two phases before anyone measured it and found it measurable.

The instrument is one debug activity and the readings are an afternoon. The feature on top of them is
a week. Doing them in that order is the only part of this document that is not negotiable.

---

## 2.4 The results, 2026-09-03, on the SM-S938B

### Q1 — enumeration: the `<queries>` block does the work, and it yields everything

| | with `<queries>` | **without it (R3 control)** |
|---|---|---|
| R1 `getInstalledApplications` + launch intent | **134** | **24** |
| R2 `queryIntentActivities(MAIN/LAUNCHER)` | **122** | **15** |

Ground truth, recounted in the same unit: `adb shell cmd package query-activities … | sort -u` →
**122 distinct packages**. R2 returns **122 of 122**. Package visibility filters *nothing* from the
launcher-intent route once the block is declared.

**R3 is what makes that a reading rather than a hope.** Without the declaration the same two queries
return 24 and 15 — so the manifest is doing the work, and this is not an OEM being permissive. That
control was worth the two rebuilds it cost.

**R2 is the query `apps.list` should use.** R1's extra 12 are non-system packages with *no launcher
activity* — Samsung Pass, InCallUI, Traceur, the accessibility services — which R1 admits because
its filter is `!SYSTEM || hasLaunchIntent`. They are not apps a person launches, and listing them
would put twelve rows on the Mac that do nothing when clicked.

**The earlier figure of 244 was a units error, mine.** `query-activities` returns *activities*;
both app-side readings return *distinct packages*. Comparing them would have reported the app
seeing "134 of 244" and hidden a perfect result behind a fictional 45% gap.

**Two control failures before the control worked**, both the same mistake: `com.android.systemui`
and then `com.sec.android.app.launcher` were used as known-present packages, and **neither has a
launcher activity** — the launcher appears 0 times in its own list. A control must be something the
query is *supposed* to return; an absence that is correct behaviour is not a control, it is a second
fault in the instrument. With three confirmed packages it reads `3 of 3`.

### Q2 — background launch: the fourth row, silently

```
Q2 state       : activityStopped=true, importance=125 (context only)
Q2 startActivity threw : no
Q2 came to front (dumpsys witness): false
VERDICT: THE FOURTH ROW — startActivity returned normally and nothing came to the front.
```

Independent witness, from the shell rather than the probe:

```
$ adb shell dumpsys activity activities | grep topResumedActivity
topResumedActivity=… com.sec.android.app.launcher/.activities.LauncherActivity
```

The launcher was on top. `com.android.settings` never appeared. **`startActivity` did not throw, did
not warn, and did not launch.**

**The instrument caught its own premise being wrong, twice.** The first version gated on process
importance and refused every reading with `importance=125 (backgrounded=false)` — because this app
holds a **foreground service** whenever the link is up, pinning importance at
`IMPORTANCE_FOREGROUND_SERVICE`, permanently below `IMPORTANCE_VISIBLE`. Importance cannot answer
*is my activity on screen*; the activity's own `onStop` can, and does. And the probe's in-process
`getRunningTasks` reported our own package before **and** after, because it is restricted to our own
tasks since Android 5 — which the probe's own comment predicted, and which is why the shell reading
is the witness of record.

### Which row, and what ships

The table's rows 3 and 4 turned out to be **two different questions**, and the run answers both:

- **The mechanism is row 4** — blocked *silently*. That forbids `apps.launch` outright. A verb built
  on this returns success and does nothing, which is the one outcome that ships no feature.
- **The product is row 3** — the notification path. `apps.open.ask` is unaffected by the silent
  block, because it never calls `startActivity` from the background at all.

Row 4 is therefore a **prohibition on a name**, not on the feature. Splitting them is the correction
this table needed: it conflated *how the platform refuses* with *what we should build*, and only the
first is a measurement.

**R6 (screen off) was not run separately.** It cannot change the answer: the screen-on case is
already blocked, and no Android release grants a backgrounded app *more* activity-start privilege
with the screen off. Stated rather than left as a silent gap.
