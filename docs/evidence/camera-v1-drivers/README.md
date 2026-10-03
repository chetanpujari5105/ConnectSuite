# Camera v1 hardware drivers — the scratch versions, kept as they ran

These are the drivers the 2026-10-02 Camera sittings actually ran, copied **byte for byte** on
2026-10-03 from the session scratchpad
`/private/tmp/claude-501/-Users-chetan-Desktop-ConnectSuite/7cdb5592-6b3d-4567-bdbe-8b79546b0880/scratchpad/`,
so that the code behind each recorded result outlives `/tmp`. **They are evidence, not tools.** Do not
run them: they hard-code paths, the peer name and the 2026-10-02 log formats. The maintained driver is
`scripts/camera-driver.mjs` with its core `scripts/camera-driver-core.mjs`, and the fixtures that hold
every fault below are `scripts/camera-driver-core.test.mjs`.

| Version | Sitting (`docs/testing.md`) | What it got wrong, and what replaced it |
|---|---|---|
| `r1/` | 19:41 first supervised sitting | no deadline: the approved 60 s ran 164.5 s. The core now arms a cap that presses the real Stop |
| `r2/` | 21:33 retry (expired unanswered) | the recorder's `at` key collided with a caller's and crashed after the end. The recorder now owns its keys |
| `r3/` | 22:10 session (PASS) | the tested core's first version; held |
| `r4/` | 22:38 batch, case A **NO READING** | read the last 40 phone-log lines, took the 22:10 session's `attached` as this one's, armed the cap at the request. Reads are now from a byte offset taken before the request |
| `r5/` | 22:53 retry, case A **NO READING** | held; Home came after the cap, so the deadline Stop ended it |
| `r6/` | 23:14 timed Home, scripted procedure **NO READING** | the owner's Home came first; the report gave the product's ending without saying the scripted action never ran. The core now reports `no-reading:ended-before-action` |

**What was not copied, and why:** the runs' own outputs (`caseA.json`, `phone-after.txt`, `*.tsv`,
`*.log`, `dry.json`, an `installed.apk`, and doc snapshots) are left where they are. They hold device
dumps and logs beyond the camera lines, and their substance is already recorded in `docs/testing.md`.
They are **not durable** — `/tmp` is cleared on reboot. `scratch-manifest.sha256` lists all 65 files in
that directory with their SHA-256, as they stood on 2026-10-03, so a later copy can be checked against
it. Whether to keep the raw outputs anywhere is the owner's decision.

No result recorded from these runs is changed by this copy: the NO READINGs stay NO READINGs.
