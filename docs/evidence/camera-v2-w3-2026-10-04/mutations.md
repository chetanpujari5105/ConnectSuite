# W3 mutations — 2026-10-04

Each mutation reinstates one specific defect in the production file, runs the named suite with a
120 s hard timeout, reads the fresh TAP file (its age is printed), restores the file and verifies the
restoration by SHA-256. Runner: `mutate.mjs`. Definitions: `mutations.json`.

## First pass (20)

- **M1** — a spent/asked episode may ask again: SURVIVED; exit 0, counts {'pass': 37, 'fail': 0}, TAP age 0.0 s, ran 0.2 s, restored=True
- **M2** — the last consumer leaving does not stop the session: RED on the named test; exit 1, counts {'pass': 34, 'fail': 3}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: multiple consumers: no second request; only the last one leaving stops — at once, before any ack
  - red: a no-consumers ending does not spend anything: the next episode asks again
  - red: rapid consumer changes during an ack: one request in flight, withdrawn no-consumers, then one for the newest episode
- **M3** — AUs forwarded before running (before the bridge is told the session is live): RED on the named test; exit 1, counts {'pass': 34, 'fail': 3}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: request → approval → frames → Stop: one request, socket only after the tap, AUs only after running, stop first
  - red: Ask phone with no consumer: allowed, and the session is stopped no-consumers as it goes live
  - red: AUs held before running are bounded at 4 with the keyframe rule
- **M4** — socket closed before webcam.stop is written: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: request → approval → frames → Stop: one request, socket only after the tap, AUs only after running, stop first
- **M5** — a closed socket's bytes still reach the bridge: SURVIVED; exit 0, counts {'pass': 37, 'fail': 0}, TAP age 0.0 s, ran 0.2 s, restored=True
- **M6** — re-ask after a reconnect inside a spent episode: RED on the named test; exit 1, counts {'pass': 29, 'fail': 8}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: no phone connected: a consumer episode sends nothing, and a later reconnect does not ask for it
  - red: declined spends the episode: consumer changes inside it ask nothing more
  - red: expired spends the episode: consumer changes inside it ask nothing more
  - red: stopped-on-phone spends the episode: consumer changes inside it ask nothing more
  - red: left-screen spends the episode: consumer changes inside it ask nothing more
  - red: capture-failed spends the episode: consumer changes inside it ask nothing more
  - red: too-hot spends the episode: consumer changes inside it ask nothing more
  - red: disconnect and reconnect: ended without a wire stop, consent not reused, no automatic re-request
- **M7** — the main → bridge bound removed: RED on the named test; exit 1, counts {'pass': -1, 'fail': -1}, TAP age 114.9 s, ran 120.1 s, restored=True
  - red: REAL bridge, hung (SIGSTOP): AUs stay bounded at 4 with the keyframe rule, and Stop escalates past the ignored shutdown and reaps it
  - red: no orphan: every child these tests spawned is gone
- **M8** — no SIGKILL escalation: RED on the named test; exit 1, counts {'pass': -1, 'fail': -1}, TAP age 99.9 s, ran 120.0 s, restored=True
  - red: STAND-IN: a bridge ignoring SIGTERM is SIGKILLed and reaped
  - red: no orphan: every child these tests spawned is gone
- **M9** — an unknown status op accepted: RED on the named test; exit 1, counts {'pass': 3, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: anything off-contract is malformed output — and a spent reader stays spent
- **M10** — ready's producer identity ignored (fail open): RED on the named test; exit 1, counts {'pass': -1, 'fail': -1}, TAP age 114.5 s, ran 120.0 s, restored=True
  - red: no producer identity in this build: fail closed — no request, automatic or asked
  - red: REAL bridge under the controller: no device, no identity — nothing asked of the phone, and quit reaps it
  - red: no orphan: every child these tests spawned is gone
- **M12** — a stale generation forwarded: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: replacement sessions and stale generations: only the current session, connection and generation count
- **M13** — the whole session id in the log: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: the log names sessions by an 8-character prefix and never carries a token, a whole session id or frame bytes
- **M14** — the last-consumer stop deferred (a linger): RED on the named test; exit 1, counts {'pass': 34, 'fail': 3}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: multiple consumers: no second request; only the last one leaving stops — at once, before any ack
  - red: a no-consumers ending does not spend anything: the next episode asks again
  - red: rapid consumer changes during an ack: one request in flight, withdrawn no-consumers, then one for the newest episode
- **M15** — a late ack after Cancel is not withdrawn: RED on the named test; exit 1, counts {'pass': 34, 'fail': 3}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: Cancel during the ack: nothing opens, and the late ack is withdrawn with the cancel's cause
  - red: Ask phone during a withdrawal waits for it, then sends exactly one request
  - red: rapid consumer changes during an ack: one request in flight, withdrawn no-consumers, then one for the newest episode
- **M16** — stdout's record type not checked: SURVIVED; exit 0, counts {'pass': 4, 'fail': 0}, TAP age 0.0 s, ran 0.1 s, restored=True
- **M17** — older peer: negotiated ext ignored: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: an older phone (no capability, or no negotiated ext) gets no webcam.* at all, and the pane says update
- **M18** — a session approved with no consumer is fed: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: Ask phone with no consumer: allowed, and the session is stopped no-consumers as it goes live
- **M19** — pre-live holding unbounded: RED on the named test; exit 1, counts {'pass': 36, 'fail': 1}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: AUs held before running are bounded at 4 with the keyframe rule
- **M20** — stream reader length cap removed: RED on the named test; exit 1, counts {'pass': 8, 'fail': 1}, TAP age 0.0 s, ran 0.1 s, restored=True
  - red: a length over 2 MiB is refused from the header alone, before any body is buffered
- **M21** — no-ready timeout removed: RED on the named test; exit 1, counts {'pass': -1, 'fail': -1}, TAP age 109.7 s, ran 120.0 s, restored=True
  - red: STAND-IN: a bridge that never says ready is stopped as failed
  - red: no orphan: every child these tests spawned is gone

Notes on the first pass:

- **M1 survived and is explained, not fixed.** The episode guard (`asked`/`spent`) is reached only from
  the 0 → ≥1 edge and from one deferred call after a withdrawal; no input calls it twice in one episode,
  so removing it changes nothing reachable. M6 shows it carrying the rule the moment a second caller
  exists (re-ask on reconnect): 8 tests red.
- **M5 survived because it removed one of two guards** (the per-frame `this.session !== s` check also
  stops a closed socket's bytes). Re-run as M5b with both removed: red.
- **M16 survived because the fixture was weak**: a control record whose body was not a valid status
  failed on the op, not the type. The fixture is now a valid status body under the control type; red.
- **M7, M8, M10, M21 ran to the 120 s runner timeout** (counts -1, TAP 100+ s old): a child the mutated
  code failed to reap kept the test process alive, and three children were left running (a SIGSTOPped
  bridge, the SIGTERM-ignoring stand-in, the silent stand-in). They were verified by command line and
  killed, and `webcamBridge.test.ts` now SIGKILLs any child whose exit it has not seen, in `after()`.
  Re-run below: complete counts, fresh TAP, no orphans.

## Second pass (re-runs)

- **M5b** — a closed socket's bytes still reach the bridge (both guards removed): RED on the named test; exit 1, counts {'pass': 32, 'fail': 5}, TAP age 0.0 s, ran 0.2 s, restored=True
  - red: request → approval → frames → Stop: one request, socket only after the tap, AUs only after running, stop first
  - red: disconnect and reconnect: ended without a wire stop, consent not reused, no automatic re-request
  - red: suspend: webcam.stop shutdown at once, nothing forwarded after, the episode spent
  - red: lock-screen: webcam.stop shutdown at once, nothing forwarded after, the episode spent
  - red: user-switch: webcam.stop shutdown at once, nothing forwarded after, the episode spent
- **M16** — stdout's record type not checked: RED on the named test; exit 1, counts {'pass': 3, 'fail': 1}, TAP age 0.0 s, ran 0.1 s, restored=True
  - red: anything off-contract is malformed output — and a spent reader stays spent
- **M7** — the main → bridge bound removed: RED on the named test; exit 1, counts {'pass': 12, 'fail': 2}, TAP age 0.0 s, ran 5.3 s, restored=True
  - red: REAL bridge, hung (SIGSTOP): AUs stay bounded at 4 with the keyframe rule, and Stop escalates past the ignored shutdown and reaps it
  - red: no orphan: every child these tests spawned is gone
- **M8** — no SIGKILL escalation: RED on the named test; exit 1, counts {'pass': 12, 'fail': 1}, TAP age 0.0 s, ran 20.3 s, restored=True
  - red: STAND-IN: a bridge ignoring SIGTERM is SIGKILLed and reaped
  - red: no orphan: every child these tests spawned is gone
- **M21** — no-ready timeout removed: RED on the named test; exit 1, counts {'pass': 12, 'fail': 2}, TAP age 0.0 s, ran 10.4 s, restored=True
  - red: STAND-IN: a bridge that never says ready is stopped as failed
  - red: no orphan: every child these tests spawned is gone
- **M10** — ready's producer identity ignored (fail open): RED on the named test; exit 1, counts {'pass': 48, 'fail': 3}, TAP age 0.0 s, ran 5.6 s, restored=True
  - red: no producer identity in this build: fail closed — no request, automatic or asked
  - red: REAL bridge under the controller: no device, no identity — nothing asked of the phone, and quit reaps it
  - red: no orphan: every child these tests spawned is gone

## Swift: M11

`sidekick-camera-bridge/main.swift`: `ready` reports `deviceInstalled: true` unconditionally.

- Swift `BridgeProcess.aSessionWithNoInstalledDeviceIsEndedAtOnceAndNothingIsFed`: RED
  (`r.records.first?["device"] → "installed" == "not-installed"`).
- TS `REAL bridge: ready is the first record…` and `REAL bridge under the controller…`: RED.
- Source restored by SHA-256 and rebuilt; the full Swift suite then ran green (78/0).
