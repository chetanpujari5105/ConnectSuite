# Mac mutations — Camera v2 app wiring (2026-10-04)

`mac-mutations.py` applies one mutation, runs the named test file with `node --test`, prints the exit code
and every red test, and restores the source in a `finally`. `mac-mutations-run.txt` is the run, verbatim,
including the second run of MW2/MW3 after the fix below. The wiring and view tests passed on their first
run, so this is their proof that they can fail.

| | Mutation | Red on |
|---|---|---|
| MW1 | `webcam.state` not bound | 12 integration tests — everything past the request |
| MW2 | `resume` bound as a shutdown event | **first run: green** → after the fix: *resume and unlock are not bound* |
| MW3 | `lock-screen` not bound | **first run: green** → after the fix: the lock-screen test and *not bound* |
| MW4 | quit does not reap the bridge | the REAL-bridge quit test, the quit test, *no orphan* |
| MW5 | the session ending not bound | the disconnect test |
| MW6 | a packaged build honours the development switch | the plan test |
| MW7 | Ask ignores the chosen camera | the refusal/Ask-again test (asks `back`) |
| MW8 | the pane asks the phone on mount | three view tests |
| MW9 | Stop while running sends nothing | the phases test |

**Why MW2 and MW3 survived first:** the power-event tests iterated over the production table
`WEBCAM_POWER_EVENTS`. Deleting an entry deleted its test; adding a wrong entry added a test that passed.
The test read its expectation from the thing under test — `CLAUDE.md`'s *second expression of the rule*,
inverted. The contract's three events are now written in the test, and the table is asserted equal to them.
