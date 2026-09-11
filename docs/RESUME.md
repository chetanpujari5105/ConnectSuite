# Resume here — written 2026-09-11, end of the detection sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Everything is committed.** Two commits: `61e70b8` is the whole of the previous (mirror) sitting,
> which had run a full day with no revert point; `881b14b` is this one.
>
> **The headline: the restriction has a name now, and the mirror has nine.** Defect 102's detection
> is built and defect 104 — eight hand-written stop sentences, two of them three words apart — is
> fixed. What is *not* done is the reading: `isBackgroundRestricted()` has never returned `true` on
> any device in this project, and that gap is written into the register and Slice 39 rather than
> implied.

## 0 · One-line state

Defects **102** (detection) and **104** (stop sentences) are built, tested and committed; **99**'s
hardware half is **pre-registered and not run** because no phone is on the bus; **103**, **§1** (the
float) and **§4** (latency) are untouched and all three have a stated precondition.

## 1 · What changed in the tree

| area | file | what |
|---|---|---|
| phone · core | `link/BackgroundRestriction.kt` **new** | the copy (pure, no Android symbol) **and** `BackgroundRestrictionReading`, the single home for `ActivityManager.isBackgroundRestricted()` |
| | `link/CapabilityContract.kt` | `Contract.needsForegroundService` (mirror only), `blockedByBackgroundRestriction`, `advertisable`'s fourth gate **with no default** |
| | `link/Capabilities.kt` | `CapabilityStatus.backgroundRestricted`, the reason branch, `CapabilityHold` + `heldBackSummary` |
| phone · app | `link/LinkRoute.kt` | the restriction card, **at rest** above Advanced, deep link to App info |
| phone · mirror | `v2/MirrorStopReason.kt` **new** | nine reasons, each with an `Actor`; `stop()` takes one instead of a `String` |
| | `v2/MirrorEngine.kt` | eight call sites converted; `onStop` derives; `fail()` stops writing one field three times |
| scripts | `mirror-fit-probe.mjs` **new** | the live fit instrument — reads the stream's shape by **two** routes |
| docs | `defects.md` (102 rewritten, **104** added), `testing.md` (Slices **39** and **40**), this file | |

Phone suite **442 tests, 0 failures** (from 431, **of which one was failing** — see §4). Mac suite
**623**, untouched this sitting. All ten commit hooks green. `:app:assembleDebug` clean.

## 2 · The defects, in the order they matter

- **102 · the app cannot tell it has been background-restricted** — **detection built, reading
  unproven.** Detection only, as the register specified: **no retry** (each start buys another
  allowance and another withdrawal) and **no second prompt for the battery exemption** (a different
  switch this app already holds). Both wrong fixes have tests that go red when the copy drifts
  toward them. The gate reaches **`mirror` and nothing else**, which is a measurement — with the op
  set for twelve hours every other capability answered normally.
- **104 · eight stop sentences, two three words apart** — **fixed.** *"Stopped on the phone."* was a
  person tapping Stop; *"Screen capture was stopped on the phone."* was Android revoking, and it was
  the only thing the app said through all eight deaths of defect 102. `onStop` carries no reason at
  any SDK level this app compiles against — checked against `android.jar` 36 **and** 36.1 — so the
  reason is derived from the restriction reading, and there is deliberately no third member for
  *"the user tapped Stop in the shade"* because it is indistinguishable from an unexplained revoke.
- **99 · the fit** — fixed, verified on the **S25 only**, and the second ratio is **pre-registered
  and not run**. See §3.
- **103 · `LinkService` believes it is foreground forever** — **untouched.** Still the sharpest
  cheap fix left: `MirrorService` is the worked example in the same codebase, and it is why lifting
  the restriction fixed the mirror and did nothing for the link.

## 3 · Where to pick up, and every item's precondition

1. **The fit on the g45. Pre-registered in `docs/testing.md` → Slice 40; the phone is not on the
   bus.** `adb devices` is empty as of the end of this sitting. The run is
   `scripts/mirror-fit-probe.mjs moto45` against a live session, then a **physical** rotation, then a
   tap near a short edge. Six outcomes are written down, and **rows 4 and 5 are the expensive ones**
   — row 4 (`--capture-aspect` never written) would reopen 99 and make Slice 37's four green rows a
   measurement of the stylesheet and not of the feature.
   **Precondition: the swap.** Defect 17 means pairing the g45 costs the S25's pairing, and the S25
   must be re-scanned afterwards. The vivo (2.22963) is 0.3% from the g45 and is **not** covered by
   a g45 reading — it stays owed.
2. **Defect 102's own reading.** One command each way, with its control, in Slice 39 §7. The op was
   restored to `allow` on the S25 at the owner's instruction, so nothing here has ever seen this
   call return `true`. The control is the *second* command: the card must **go away**.
3. **Defect 103.** No precondition beyond a build — but its runtime confirmation is blocked
   (`am start-foreground-service` is refused, `exported=false`), so the fix lands as a static change
   with its verification owed, and that should be said in the commit rather than discovered later.
4. **§1, the float.** Precondition: **take the A/B latency reading first** — it cannot be taken
   afterwards. The keyframe path logs nothing at either end and there is still no evidence a single
   `mirror.keyframe` has ever produced an IDR.
5. **§4's anchor**, which must be fixed before any latency number is published again, and **then
   §2**.

## 4 · One thing found that nobody was looking for

`ProtocolNamespaceTest > every feature message names a real capability` had been **red on this
branch** since O4 added `MessageType.STORAGE_STATE` without its system-set exemption. It was
committed in `61e70b8` along with everything else, red, and found only because this sitting ran the
phone suite.

**The reason it survived is worth more than the fix.** The commit that added the type ran `npm test`
in `desktop/` and not the phone's suite — which is `CLAUDE.md`'s defect-65 entry with the modules
the other way round. That entry says *a module contributing zero tests is invisible in a total*;
this is the sibling failure — **a module whose suite is not run is invisible in a green**.

## 5 · One test I wrote, watched pass, and threw away

The first guard for 104 asserted that no two stop sentences were *too alike*, by word-set overlap.
It looked rigorous and it **passed with the exact defect sentence restored** — because the sibling
sentence had been reworded in the same change, so the pair was no longer close while the defect was
back.

Similarity was a proxy. The rule is **attribution**: a stop Android caused must name Android and
must not say *you*. That is an `Actor` on the type now, and mutation **M7** — which restores
*"Screen capture was stopped on the phone."* — goes red on it. Twelve mutations, twelve red; the
table is in Slice 39 §5.

## 6 · Device state

- **Nothing is on the bus.** `adb devices` empty, daemon started, `target-device.sh` refusing
  correctly.
- **S25: `RUN_ANY_IN_BACKGROUND` is `allow`**, deliberately, at the owner's instruction. The original
  (`ignore`) is in defect 102 and at `scratchpad/hw/appop-original.txt`. **Setting it back is the
  stimulus for §3.2** and is one command.
- **vivo and moto g45**: installed and launched once, **not paired**, nothing else touched.
