# Phone mutations — Camera v2 wiring and mirror coexistence (2026-10-04)

`phone-mutations.py` applies one mutation, deletes the previous results of camera-module, mirror-module
and app, runs their unit tests, prints the gradle exit code and the age of the result files it read, lists
every red test, and restores the source in a `finally`. `phone-mutations-run.txt` is the run, verbatim.

| | Mutation | Red on |
|---|---|---|
| MP1 | the mirror gate ignores the webcam | `MirrorAdmissionTest` (Gradle stopped at the mirror module, so `:app` did not run this time — 24 result files, not 46) |
| MP2 | the mirror gate decides outside the shared lock | the 300-round webcam-vs-mirror race (`CaptureCoexistenceTest`) |
| MP3 | `CaptureWiring.connect` never tells the mirror about the webcam | the race; *a webcam request open — a new mirror start is refused* |
| MP4 | a mirror being admitted does not count as busy | `MirrorAdmissionTest` busy; the race; *counts as busy before its first phase* |
| MP5 | the webcam's handlers registered before the gate | both wiring tests and the gate-order scan |
| MP6 | the webcam claim is not taken | the wiring tests (advertisement follows the sink) and the scan |
| MP7 | `MirrorEngine.start` not gated | the start-routes source scan **only** — `MirrorEngine` needs a `Context` and a `ControlSession`, so the line that calls the gate is held by reading the source; the gate itself is exercised above |

Fresh after the runs: phone **1,342 / 0** (core 233, camera-module 180, mirror 65, sync 624, input 52, app
188); Camera v1's own classes **108 / 0** on the phone and **78 / 0** on the Mac (`cameraView.test.ts`,
`camera*.test.ts`).
