# Resume here — written 2026-09-11, end of the mirror sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Nothing is committed.** `git status` is the inventory. This sitting touched the Mac renderer, one
> phone module, one core service, four scripts, and six documents.
>
> **The headline: the mirror was never broken.** It has never produced a frame in any surviving log,
> and the cause was not in this repo — the app had been **background-restricted by One UI**, so it
> could not hold the foreground service `MediaProjection` requires, and Android revoked the
> projection 107-116 ms into every attempt. Lifting one app op produced a **6 min 33 s session at
> ~100 fps** on the first tap. See defects 100 and 102.

## 0 · One-line state

Four mirror problems were reported; §3 (fit) is **fixed and verified on 1 of 3 ratios**, §1 (the
float) is **diagnosed and untouched**, §4 (latency) is **diagnosed and untouched**, §2 (float input)
is **unstarted**. Three defects were found that nobody was looking for (101, 102, 103), one of which
had been eating the evidence for the others.

## 1 · What changed in the tree

| area | file | what |
|---|---|---|
| Mac renderer | `src/renderer/captureFit.ts` **+ test** | new: `captureAspect`, `containedPicture`, `pointInCapture` — the picture-fitting rule, red-first proven |
| | `src/renderer/mirror.ts` | `pointAt` maps against the **picture**, not the element; `applyCaptureAspect()` on all three writers of `this.capture` |
| | `src/renderer/styles.css` | stage takes `--capture-aspect` from the stream; both Phase 2 legacy rules deleted; hairline moved to an inset shadow so `aspect-ratio` is not fighting a border |
| | `src/renderer/index.html`, `renderer.ts` | `#mirror-stage` id, script tag, constructor arg |
| Mac main | `src/main/input.ts` | every gesture logs **where it was aimed** and the geometry stamp — its absence is why defect 99 could not have been found from a log |
| phone | `mirror/v2/MirrorService.kt` | **instrument only** for defect 100, and it returned nothing — see §4 |
| phone | `core/service/ConnectionService.kt` | `.distinctUntilChanged()` — defect 101 |
| scripts | `adb-pinned.sh`, `adb-count.sh` **+ test** | new enforcement points — see §3 |
| docs | `defects.md`, `testing.md` (Slices 37, 38), `mirror-diagnosis-2026-09-09.md`, `fourth-device-vivo.md`, `third-device-moto-g45.md`, `CLAUDE.md` | |

`npm test` 623 pass · all six commit hooks green · `check-defects` 87 rows.

## 2 · The defects, in the order they matter

- **100 · the mirror never survived its own start** — *not a code defect.* Consent granted 8/8, token
  issued, display created, encoder running — then the foreground service is stopped at 106-116 ms and
  the projection goes with it. Cause is **102**. Proven by lifting the op: 6 min 33 s, 196 stats
  ticks, ended by a deliberate stop.
- **102 · the app cannot tell it has been background-restricted** — **open, and the most important
  one.** `RUN_ANY_IN_BACKGROUND: ignore` on the S25 while 6 of 8 comparable apps read allow.
  `SUPPORT_BG_AD_RESTRICTION_BY_AI=1`; the only other restricted app is the other one its owner
  rarely opens. Fix is one call — `ActivityManager.isBackgroundRestricted()` — beside the other
  probes in `Capabilities.kt`, surfaced as an `unavailable` reason with a deep link. **Wrong fixes
  are named in the register.**
- **103 · `LinkService` believes it is foreground forever** — open. `isForeground` set at `:244`,
  never reset; the guard at `:108` then skips the re-claim for the life of the process. Defect 97's
  shape on the phone. `MirrorService` recovered by itself because it calls `startForeground`
  unconditionally — that is the fix shape.
- **101 · notification churn** — **fixed and measured both ways.** 15 posts/min → `READING 0 of 186`
  in a settled window, with a positive control that a *real* change still posts.
- **99 · the fit** — **fixed; verified on the S25 only.** Live session, real rotation, box
  560 × 258.5 landscape, letterbox **0 px**, 8425 frames at 119 fps.

## 3 · Two new enforcement points, and why prose was not enough

- **`scripts/adb-pinned.sh`** — the serial never passes through the caller. A `2>&1` merged the pin's
  stderr banner into the value, `adb -s ""` failed, and a `||` fallback printed a confident false
  claim about the owner's battery state. The control table already named that failure; **a table is
  consulted by someone who already suspects a problem, and nobody suspects one while capturing a
  serial they have captured twenty times.** Removing the value from the call site is the fix — the
  same reasoning as the status island's single writer.
- **`scripts/adb-count.sh` + 5 fixtures** — a tally that ran over nothing cannot be reported as a
  count of zero. It caught a bad pattern in the first reading it was used for: `42 of 133` beside a
  control of `0 of 133` — without the denominator, a false regression.

## 4 · What was tried and did not work — do not repeat

- **Overriding `Service.stopForeground`** to name the caller. It is **`final`**. Cannot be done.
- **Process-importance sampling** as a substitute: a visible Activity reports `IMPORTANCE_FOREGROUND`
  (100), which outranks and masks `IMPORTANCE_FOREGROUND_SERVICE` (125). 120 samples, all 100, no
  reading. **The instrument is still in `MirrorService` and still returns nothing while the app is on
  screen** — remove it or leave it, but do not read it as a negative.
- **`am start-foreground-service`** to test defect 103 — refused, `exported=false`.

## 5 · Two claims I published and then withdrew

Both are corrected in place with the retraction visible rather than tidied away:

- *"The reference device was already wrong (~20:9, 1.6px bars)"* — **withdrawn.** The SM-S938B is
  1440×3120 = exactly 19.5:9. It came from a **stale canvas backing store** read off a days-old app
  instance. The box matched the reference handset perfectly, which is a cleaner reason for a phase of
  invisibility than bars too small to see.
- *"A provisional background-start allowance, withdrawn when the launch transition settles"* —
  **withdrawn.** The stop event carries `PROC_STATE_TOP`, so nothing had left the foreground. It was a
  correlation confirmed two-for-two on a 4 ms lag, and **a correlation confirmed twice is not a
  mechanism** — now a row in the control table.

## 6 · Where to pick up

1. **The fit run is 1 of 3.** vivo (2.22963) and moto g45 (2.22222) are **installed, launched, not
   paired**. Both need a pairing, and **defect 17** makes that a swap that costs the S25. The g34
   shares the g45's build fingerprint, so the two Motorolas are one image.
2. **Defect 102's cross-vendor question needs days, not commands.** Baselines are recorded on both
   non-Samsung handsets on their install date: ours unset, 8 of 8 controls unset, on both. Re-read the
   same two lines after several days of neglect. Samsung is currently the only vendor that writes the
   op at all.
3. **Then §1** — the float's start contract and rate limit, with the observability fixed first
   (the keyframe path logs nothing at either end, and there is still no evidence a single
   `mirror.keyframe` has ever produced an IDR). **Take the A/B latency reading before fixing**: it
   cannot be taken afterwards.
4. **Then §4's anchor**, which must be fixed before any latency number is published again, and
   **then §2**.

## 7 · Device state left changed

- **S25: `RUN_ANY_IN_BACKGROUND` is `allow`** — deliberately left, at the owner's instruction. The
  original (`ignore`) is recorded in defect 102 and saved at
  `scratchpad/hw/appop-original.txt`.
- **vivo and moto g45**: app installed and launched once; nothing else touched; not paired.
- The S25's phone log is the only one with mirror history worth keeping — it is quoted in Slice 38
  rather than left on the device.
