# Camera v2 encoder spike, second run — 2026-10-05 12:48 IST (owner-supervised, once) · **PASS** · uncommitted

Pre-registered before any reading: `preregistration.md` and `diag-readout.mjs` (hashes in
`preregistration.sha256`, re-verified after the run). Verdict: scorer v2, unchanged. Report: `report.json`
(driver-written, sanitized at write; no whole session id, no token, no Mac name). Diagnostics:
`diag-readout.txt`. Snapshots: held privately, hashes in `snapshots.pointer.md`.

**Binaries.** `.build/release` rebuilt from `a16cee8` (Swift = `0e584b7`): probe `331cc7bb…`, bridge `39011e97…`.
Phone APK `b0ad2a47…` = the local build after the last phone-side commit (`0f9fb01`); not reinstalled.
`desktop/dist` = `HEAD`'s compiled source, 130/130 files.

**The run.** Final gates passed (thermal **1, light** — below the runbook's *moderate*). One request, rear
camera, the owner's tap. `running` 803 ms and the first AU 820 ms after `starting` reached the Mac. Planned
Stop at 15,002 ms; `stopped-by-mac` in 14 ms; camera released 1,364 ms after; probe exit 0; 60,002 ms
observed, 23 samples, nothing after. No emergency Home. Route: `10.180.2.216` via **`en0`, Wi-Fi** —
adb over USB carried no camera data.

**28 of 28 scored criteria PASS**: IDR+SPS/PPS first; 8 IDR + 417 P = 425 decoded; 0 failures, 0 malformed;
header = running = SPS = decoded = 1920×1080 (coded 1088); accounting 425 = 425 + 0, all 425 to the sink.
Reported: 29.94 fps; IDR 1,999–2,032 ms; `c2.qti.avc.encoder` hardware; High 4.0; rotation 0; 10.05 Mbit/s
at the Mac; 0 drops at every stage.

**Defect 177 readings (never judged):** **no overflow** — a useful reading, not proof that burst recovery is
solved. Stage high-water **3 of 4**, though one 33.3 ms interval carried **5 AUs** and the largest arrival
gap was 122 ms. Preparation 1, 43.9 ms, frame waited 0, discarded 0, failed 0. First frame 118.0 ms after
`session-live`. Decode first 97.1 ms (session creation; the only frame over budget), mean 4.44 ms; compose
first 2.8 ms, mean 2.18 ms, max 12.6 ms; service max 99.9 ms; queue wait max 70.3 ms. `decodedAfterFailure`
0. Aggregates only: the bridge records nothing per frame.

**Defect 177 stays OPEN. What this run does not establish:**
- the 2026-10-04 overflow's field cause — this run **did not reproduce** it;
- that burst recovery is solved — generated tests show a burst of ≥ 5 AUs during the first frame still
  overflows on every build, and recovery is still up to one IDR interval (~2 s);
- anything about the decode-failure branch — **not exercised** (0 decode failures);
- anything about rotation 1 (this run's rotation was 0, the earlier run's 1) or about long sessions —
  this was a 15 s run, and one run.

The 2026-10-04 run's verdict stays **FAIL**, and its post-hoc re-score stays a separate record.

**Restored.** Spike launch quit through its named *Quit Sidekick* menu item (SIGTERM had not quit the
previous app in 35 s); relaunched 12:51:08 with no switches: no `DEBUG SWITCHES`, `webcam not advertised`,
`webcam` absent from the negotiated set, no bridge, no probe, 0 states/claims/requests. Phone: no camera
client, projection `null`, thermal 0, link 3/3. Snapshots identical except `sidekick.json` (same hash and
size; the launch rewrites it).
