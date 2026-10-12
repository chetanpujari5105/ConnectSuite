# Pre-registered acceptance bounds — Camera supervised sessions, 2026-10-03

Written before any request. Builds: phone `98187d17…` (installed 13:16:37), Mac `dist` built 13:17 from
`ad8dd55` (pid 28482). Instruments: `scripts/camera-driver.mjs --execute --case plain` (unchanged; owns the
one request, the stream id, the fresh log cursor, the 20 s cap, the 60 s watch from the end) beside the
scratch `actor.mjs` (owns only the timed presses below; gated at the moment of acting on the Mac's state for
the same stream id; never requests, never retries). Clocks: the phone and the Mac are compared only within
each endpoint.

## Stop conditions (both sessions) — any one ends the sitting, no retry

- a driver gate refuses, or the driver outcome is anything but `ended-by-stimulus`;
- the request is not approved inside the driver's 40 s window, or expires;
- the driver's deadline (20 s cap) fires, a safe shutdown occurs, or an emergency stop is sent;
- the actor exits non-zero or refuses an action (its gate failed);
- the instrument does not install or does not dispose;
- an unexpected camera client, capture, request or transfer appears on either end;
- a protected artifact or a phone snapshot differs afterwards.

## Session 1 — normal smoke (switch + Mac Stop)

| # | Bound |
|---|---|
| S1-1 | Exactly one request (`requestsPressed: 1`); the 32-hex id read from the Mac's `requesting` state within 5 s |
| S1-2 | The Mac goes `live` for that id; the cap is armed from the Mac's state (`anchorSource` = Mac state), never from a phone line |
| S1-3 | Real preview: at the pre-Stop gate, sampled canvas pixels lit > 0, stage visible, instrument `draws` > 0 with the newest draw < 1 s before the gate |
| S1-4 | Phone (fresh lines only, prefix-8): `running: first frame … from the back camera` |
| S1-5 | Switch sent once at live + 5 s (±1 s); Mac facing `front` within 6 s; phone `switch confirmed: first frame … from the front camera`; Mac `switch confirmed: frames now from the front camera` |
| S1-6 | Stop pressed once at live + 15 s (±1 s) by the actor; anchor-to-end ≤ 20 s; `fallbackStops` empty |
| S1-7 | Picture cleared: at Stop + 0.3 s the state is not `live`, the stage is hidden and the sampled canvas has 0 lit pixels |
| S1-8 | Released: our package absent from `Active Camera Clients` by Stop + 3 s; phone `stopped: STOPPED_BY_MAC`; every `Camera released … N released of M bound` line has N = M |
| S1-9 | Reasons: Mac `ended: stopped-by-mac`, headline *Camera off*; phone `STOPPED_BY_MAC` |
| S1-10 | Counts: the Mac's ending line carries `received here, drawn, not drawn here`; the phone's `sent / dropped`. Buffered vs continued: instrument draws after Stop = 0 at +1, +3 and +10 s; any frame received after Stop must be counted *not drawn*, and the camera client list must already be empty |
| S1-11 | 60 s watch (driver, from the end): no sample shows our package in the camera clients or the pane `live`/`requesting`; Mac `camera.request sent` stays at 1; no fresh phone `tapped`/`attached`/`bound` after the Stop |
| S1-12 | The instrument installs once and disposes (`disposed (2 wrapper(s), counters removed)`) |

Not claimed by S1: the late-bind race (169), blocked notifications (171's NONE/NOTIFICATION routes), the
undrawable-frame branches (172's size-mismatch/undecodable) — this is a production-wiring smoke test.

## Session 2 — case D, tray Disconnect / Connect (only if Session 1 fully passes)

| # | Bound |
|---|---|
| S2-1 | Idle and session checks retaken; one request; live for its id |
| S2-2 | At live + 5 s (±1 s), with `camera` the only visible section, the tray's *Disconnect* (title `● CS`) clicked once by name |
| S2-3 | Mac: state leaves `live` within 1 s; `ended` reason `disconnected-here`; headline *Disconnected from this Mac*, sentence *"You disconnected this Mac from your phone, so the camera stopped."*; stage hidden, 0 lit pixels |
| S2-4 | Phone: `stopped: MAC_DISCONNECTED` for this prefix (sentence in source: *"The connection to the Mac ended, so the camera stopped."*); `Camera released` for this prefix; camera clients without our package within 15 s |
| S2-5 | Only after S2-4: the tray's *Connect* (title `○ CS`) clicked once; `[link] Connected to` in the Mac log within 30 s; no pairing step; trust store unchanged afterwards |
| S2-6 | 60 s from the confirmed reconnect: never our package in camera clients; 0 Mac `[camera]` lines and 0 `camera.request`; 0 phone `[camera]` lines; 0 transfer lines (`[bulk]`, `[share]`, `[files]` other than listings) on either end; pane not `requesting`/`live` |
| S2-7 | Driver outcome `ended-by-stimulus`, capture ≤ 20 s, no fallback stop, instrument disposed |
