# TypeScript mutations — W3 corrections A1 and A2 (2026-10-04)

Red-first: before the implementation, 12 of the new or changed tests failed (`ts-red-first.tap`). One
new test passed before the implementation — *a stream-rejected naming another or an ended session
cannot stop the replacement* — because nothing handled `stream-rejected` at all; it guards against a
wrong implementation rather than a missing one, so MT1 below is its proof that it can fail.

| | Mutation | Red on |
|---|---|---|
| MT1 | `stream-rejected` handled without comparing its `sessionId` to the current session's | *a stream-rejected naming another or an ended session cannot stop the replacement* (only) |
| MT2 | `failure()` returns `{cause:'shutdown'}` — the wire as it was before the correction | 8 tests: expiry, bridge crash, producer refused, malformed stream, stream-rejected (×2), the closed-set sweep, socket-open failure |
| MT3 | `parseStatus` accepts any string as a `violation` | *anything off-contract is malformed output* (the exception-text case) |

Sources restored after each; `git diff --stat` afterwards showed only the intended changes.
