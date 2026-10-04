# Encoder spike preparation — mutation record (2026-10-04, local only, no device)

Each mutation reinstates the one defect a test is named for, runs that test alone, and is restored.
Harness: two scratch scripts (not kept); the mutated lines are below verbatim in intent.

| # | Mutation | Test run | Result |
|---|---|---|---|
| MS1 | the claim names another session (`'0'×32`) | the spike: one request… | RED |
| MS2 | the hard-cap timer removed (cap would ride on the planned Stop) | the hard cap is independent | RED |
| MS3 | socket destroyed before `webcam.stop` is written | a stream main cannot frame… | RED |
| MS4 | a second run allowed | it runs once per launch | RED |
| MS5 | the Use-as-webcam busy check dropped | preconditions are named no-readings | RED |
| MS6 | request sent although the probe never said ready | no request is sent unless the probe is ready | RED |
| MS7 | packaged builds pass the wiring gate | wiring: no IPC channel… | **GREEN first** — the probe resolver refuses packaged too, and the test checked only the outcome. Each gate now asserted by its own reason → RED |
| MS8 | the renderer chooses the camera | wiring: …back-camera only | RED |
| MS9 | the token written into a log line | the spike: one request… | RED |
| MC1 | `running`'s size not compared | FAIL: running reports another size | RED |
| MC2 | the emergency Home does not fail the run | FAIL: the driver had to press Home | RED |
| MC3 | the owner's Stop/Home folded into FAIL | NO READING is its own outcome | RED |
| SW1 | SPS horizontal cropping ignored | theReaderAgreesWithVideoToolbox… | **GREEN first** — every fixture width was a multiple of 16. 1272×720 and 360×640 added → RED |
| SW2 | SPS vertical cropping ignored | theReaderAgreesWithVideoToolbox… | RED |
| SW3 | emulation-prevention bytes kept | emulationPreventionBytes… | RED |
| SW4 | header-vs-SPS mismatch not counted | aHeaderThatDisagrees… | RED |
| SW5 | VideoToolbox bypassed (a blank buffer counted as decoded) | bytesVideoToolboxCannotDecode… | **GREEN first** against the 1080p stream test (same size as the fake). A garbage-slice test added → RED |
| SW6 | the probe's lifetime bound not armed | itEndsByItself… | first **HUNG** (no watchdog in the test; leftover test children killed by hand). 8 s watchdog added → RED |
| SW7 | the probe does not count itself as a consumer | aRealSessionIsDecodedCounted… | RED |

Fresh full runs after all of the above: Swift 99 / 0 (26 suites), Mac 1,660 / 0, phone 1,342 / 0,
scripts 259 / 0; both typechecks clean; every guard OK.
