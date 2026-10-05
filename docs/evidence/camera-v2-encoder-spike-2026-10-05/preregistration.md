# Camera v2 encoder spike, second run — pre-registration (written 2026-10-05, BEFORE any reading)

**Uncommitted evidence.** One supervised run, approved 2026-10-05. Runbook: `docs/camera-v2-encoder-spike.md`
(scope §2, route §3, gates §5, sitting §6, criteria §7, retention §8), unchanged.

## The verdict — unchanged, pinned by hash

PASS / FAIL / NO READING is `verdict()` in `scripts/webcam-spike-core.mjs`, **scorer version 2** (`d1cb5e0`,
SHA-256 `301499b9425c83fd7a0e679bc17bad2048bd9bdb656efba327e34d5cfdf07090`), driven by
`scripts/webcam-spike-driver.mjs` (SHA-256 `6663cb6bff60b161c6fdd5a8ba7e9a385b7056fd930d09fbc194354e651f6000`).
Every criterion and bound in runbook §7 as written; **no threshold changes and no reclassification of a
missing reading after the result.** A missing counter is a missing reading, never a zero.

## Additionally reported — never judged

By `diag-readout.mjs` in this directory, whose rules are fixed here, before the run:

| Reading | Counters | Pre-registered rule |
|---|---|---|
| overflow, and where | `diag.overflow.events`, `diag.overflow.first.{atReceived,sinceLiveUs,gopIndex,inFlightUs,decodesBefore}` | 0 events = "no overflow in this run", a useful reading and **not** proof burst recovery is solved. `decodesBefore 0` = before any completed decode (startup case) |
| cause class | `diag.arrival.maxPerFrame`, `first.inFlightUs` | burst = ≥ 5 AUs inside one 33.3 ms interval; slow service = first overflow's in-flight > 33.3 ms; both / one / neither named as such. What delayed the AUs into a burst is **not** measured by anything here and is reported as unknown |
| recovery | `diag.recovery.{count,maxUs,maxRefused,unrecovered,open}`, `gate.awaitingKeyframe` | reported |
| preparation | `diag.prepare.{count,maxUs,waitMaxUs,discarded,failed}` | reported |
| first frame | `diag.firstFrame.sinceLiveUs` | reported |
| decode / compose | `diag.{decode,compose}.{count,firstUs,totalUs,maxUs,overBudget}`, `diag.service.*`, `diag.queueWait.maxUs`, `maxWaiting` | **aggregates only — first, mean, max, over-budget count.** The bridge records nothing per frame by design, so no percentile distribution exists to report |
| arrival | `diag.arrival.{maxGapUs,maxPerFrame}` | reported |
| broken chain | `diag.chain.decodedAfterFailure` (+ flushed, stale, resets) | must be 0; anything else is a defect finding reported beside the verdict, never a verdict change |
| route | `route.address` + `route -n get` + `networksetup` (driver) | the exact interface and hardware port; **USB video is never assumed** — adb over USB carries no camera data (runbook §3) |
| accounting | `received`, `accepted`, `gate.*`, the six terminal dispositions, `pending` | the scorer judges it; the readout restates it |

## Binaries (identities recorded before the run)

`desktop/native/SidekickCamera/.build/release/`, rebuilt 2026-10-05 from the clean tree at `a16cee8`
(Swift identical to `0e584b7`):

| | SHA-256 |
|---|---|
| `sidekick-camera-decode-probe` | `331cc7bbbd1288ede94afeacdf9c5a3d4cfdbd0bae09e5ae2bee54f798aa644e` |
| `sidekick-camera-bridge` | `39011e9743d787571944347f6adabc7bde60a0973f2a764fbdc50ef2f07d4401` |
| `sidekick-camera-extension` (built, never loaded) | `74fe37adbce20df9998b8c2e82eed1d159a83e86fb52b5601786c9171587709a` |

Replaced (2026-10-04 17:06/17:07 build): probe `6c9b0162…`, bridge `7e644d32…`, extension `e887ac23…`.
The probe was checked to be the new code (its exit line carries `prepare … first frame … after decode
failures`) and to write nothing to its working directory. Electron main's `parseStatus` accepted 60/60
real A+B counts records (≤ 104 keys) and a 115-key worst case (BridgeCore 64 + every probe key 51), and
refused 129 (control). The Mac runner (`desktop/dist`) is byte-identical to `HEAD`'s compiled source,
130 of 130 files.
