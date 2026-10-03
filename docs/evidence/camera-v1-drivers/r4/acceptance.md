# Camera lifecycle batch — acceptance bounds, written before any request (2026-10-02)

Clocks: phone lines are ordered on the phone's clock, Mac lines and the page instrument on the Mac's.
No phone timestamp is compared with a Mac timestamp. Camera-service events carry whole seconds only.

## Common to every case (each must hold, or the case FAILS)

| # | Check | Bound | Instrument |
|---|---|---|---|
| K1 | Consent | the phone's `Start camera tapped` precedes its `Camera bound`; no camera-service CONNECT for our package before the request | phone log; `dumpsys media.camera` |
| K2 | Capture cap | anchor → end ≤ 20 s on the Mac clock. A deadline Stop means the case's stimulus never ended capture: the case is **NO READING**, and the batch stops | driver report |
| K3 | Camera release | our package absent from `Active Camera Clients` within 10 s of the Mac seeing the end; the camera service's last DISCONNECT for our package stamped no later than the second after the phone's `stopped` line | `dumpsys media.camera` |
| K4 | Stream end | phone: one `Camera stream closed: S sent / D dropped` and one `stopped: <REASON>`. Mac: one `ended:` line | both logs |
| K5 | Picture cleared | Mac canvas 0 × 0 at the first pane read after the end (≤ 0.5 s), and still 0 × 0 at every later read | pane reads |
| K6 | No post-end draw | 0 instrument draws stamped after the Mac's `ended:` line | instrument + Mac log, same clock |
| K7 | Buffered vs continued | S (phone sent), R (Mac received), N (drawn) reported; S − R is in flight at the end, R − N not drawn. Continued capture would show as a camera client or new draws, and must be absent | logs, instrument |
| K8 | No restart, no reused consent | for 60 s after the return: no camera client, our camera-event count constant, no new phone `[camera]` line, no Mac `camera.request sent`, the pane never live | driver samples |
| K9 | Truthful wording | no raw reason token, no network advice, and the reason below | Mac pane, phone screen, logs |

## Per case

| Case | Stimulus | Phone reason | Mac reason and sentence | Return |
|---|---|---|---|---|
| A | owner presses Home ~5 s after live | `LEFT_SCREEN` | `left-screen` — *"…camera screen left your phone's display."* | owner reopens Sidekick |
| B | owner locks the phone ~5 s after live | `LEFT_SCREEN` (the contract lists the screen locking) | `left-screen`, as A | owner unlocks, reopens Sidekick |
| C | driver clicks **Overview** in the nav at anchor + 5 s | `STOPPED_BY_MAC` | `stopped-by-mac` — *"You stopped the camera from this Mac."* | driver routes back to Camera; no request pressed |
| D | driver presses the tray's **Disconnect** at anchor + 5 s | `MAC_DISCONNECTED` (log only; nothing is sent) | Mac log `ended: disconnected`. **No sentence may say the phone disconnected** — the Mac's Disconnect ended it | driver presses the tray's **Connect**, once; no re-pair |

D also requires, during the 60 s after the reconnect: no `[bulk]` or `[share]` line.

**Prediction recorded before the run, from the code:** after the reconnect, the Mac pane's `disconnected`
ending reads *"Your phone disconnected, so the camera stopped."* (`endedCopy`). If it does, D **fails K9**
on wording, whatever else passes.

## Stop rules

Any FAIL, any capture continuing, a deadline exceeded, or an unexplained change: stop the batch.
End capture through the approved Stop control, preserve evidence, no next case, no repair. One request
per case; no retry.
