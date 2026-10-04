# Phone mutations — Camera v2 W2 (2026-10-04)

`phone-mutations.py` applies one mutation at a time to the source, **deletes the previous test results**,
runs `:camera-module:testDebugUnitTest`, prints the gradle exit code and the age of the result files it
read, lists every red test, and restores the source in a `finally`. `phone-mutations-first-run.txt` is the
first full run, verbatim.

The webcam tests were written after the code, so these runs are their proof that they can fail.

| | Mutation | Red on |
|---|---|---|
| MB1 | a tap after the deadline still opens | expiry; late permission answer |
| MB2 | a P-frame may announce `running` | first IDR announces running; ladder reconfiguration |
| MB3 | `failure` produces `stopped-by-mac` (the pre-correction wording) | stop causes; closed-set detail; re-attribution; the shared vocabulary fixture |
| MB4 | the arbiter does not hold its lock | the 300-round concurrent request race |
| MB5 | the writer evicts the oldest AU (Camera v1's JPEG rule) | both backpressure tests |
| MB6 | a capture that comes up late is bound | all four late-callback / release-once tests |
| MB7 | SPS/PPS not prepended to MediaCodec's IDRs | the assembler; the phone-stream golden; its structure |
| MB8 | thermal stops only above critical | the injected thermal boundary |
| MB9 | a second claim attaches | the claim conditions |
| MB10 | release builds install | the release gate |
| MB11 | an unknown failure detail is trusted | the closed-set detail test |
| MB12 | a malformed stop leaves the camera running | the malformed-stop test |
| MB13 | a switch keeps the generation | switch; reconfiguration; capture core; the phone-stream golden and structure |
| MB14 | Camera v1's engine ignores the arbiter's answer | **first run: green.** The coexistence test re-implemented the engines' wiring instead of calling it. Fixed by giving the decision one home (`CameraUseArbiter.admitCamera` / `admitWebcam`), called by both engines and the test. Re-run: red on the source scan only — the line that passes the answer into the machine lives in an Android singleton no JVM test can construct, and the test says so |
| MB15 | no discontinuity stamped at a switch | the phone-stream golden and structure |
| MB16 | the arbiter tells Camera v1 the camera is free | the arbiter's answers; the race; webcam-refuses-v1 |
| MB17 | the arbiter forgets Camera v1 | v1-refuses-webcam; the arbiter's answers; the race |

### A finding the mutation run produced that no mutation was aimed at

In the first run, MB6 (capture core) also reddened *the Mac hanging up … ends the stream once*, a writer
test the mutation cannot touch. Run alone it failed **8 of 8** times; inside the full suite it had passed.
Cause: the test settled on `!isOpen` and then asserted the close callback had run, but the writer clears
`open` before it calls back — a predicate over two clocks that settled on one (`CLAUDE.md` → *A predicate
over two independent clocks must settle on both*). The writer is correct; the test now waits for both, and
passed 6 of 6 isolated re-runs.
