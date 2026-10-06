# S4 and the pairing wording — mutations (2026-10-06)

Each mutation re-opens one gap; files restored by SHA-256 afterwards. Mac runs: `ipcAuth.test.ts`,
`ipcWiring.test.ts` (the real `main.ts` handlers), `ipcPolicy.test.ts`, `shareWindowBinding.test.ts`.

| Mutation | Red tests |
|---|---|
| G1 trust any sender | 2 — unknown/destroyed/replaced/subframe/wrong page (guard); unknown/subframe/replaced (real handlers) |
| G2 no role check | 4 — role refusal (guard); float/receive cannot Forget/pair/SMS (real); fs-send; pairing |
| G3 no payload check | 2 — invalid payload, guard and real handlers |
| G4 subframes allowed | 2 — guard and real handlers |
| G5 fs-drag without a grant | 1 — produced files only |
| G6 fs-send without a grant | 1 — picked or dropped only |
| G7 a stale receive window acts on any offer | 2 — newer offer refused; unknown offer refused |
| G8 the float preload gains `smsSend` | 3 — policy agreement; nothing personal; exact 25 methods |
| G9 reveal-saved by existence only | 1 — produced files only |

Phone (`ConnectStageTest`):

| Mutation | Red test |
|---|---|
| W1 the old precedence: any connected session reads as success after a scan | *a different Mac connected while this one is verifying is not success* |
| W2 any Mac's verified pairing counts as this scan's | *only a verified pairing of THIS Mac, after the scan, is Paired* |

**Instrument note.** W2's first form did not compile, and Gradle served the previous run's results file,
which named W1's test. The harness prints each results file's age; the re-run printed `0s old` and the
right test. Recorded because a `failures=1` from a build that never compiled is exactly the stale-artifact
row in `CLAUDE.md`.
