# Pre-registered acceptance — Camera Session 2, case D (tray Disconnect / Connect), 2026-10-03

Written before the request. It refines S2-1…S2-7 of `acceptance-2026-10-03.md` (`c3304cb7…`), which is left
unchanged. Builds: the installed APK `98187d17…` (13:16:37) and the running Mac pid 28482, with no rebuild,
reinstall or relaunch. Instruments: `scripts/camera-driver.mjs --execute --case plain` (unchanged; it owns the
request, the stream id, the fresh phone-log cursor, the 20 s cap with the real Stop as its fallback, and a
60 s watch from the end) beside `actor.mjs disconnect` (its tray actions run through `osascript` → System
Events → `menu bar 2` of pid 28482, by item name). Clocks are compared only within each endpoint.

## Stop conditions — any one ends the sitting, with no retry or repair

- a driver gate refuses; the outcome is anything but `ended-by-stimulus`; the deadline fires; a safe
  shutdown or an emergency stop occurs;
- the request is not approved inside the 40 s window;
- the actor refuses or fails any step (gate, tray result, release confirmation, reconnect confirmation),
  or its report is not written;
- the instrument does not install or dispose;
- a product check below fails, or an unexpected request, capture or transfer appears.

## Bounds

| # | Bound |
|---|---|
| D-1 | Exactly one request (`requestsPressed: 1`; the Mac's `camera.request sent` once after the start offset); the 32-hex id from the Mac's `requesting` state |
| D-2 | Live for that id; the cap anchored on the Mac's state; the phone's fresh `running: first frame … from the back camera` |
| D-3 | At live + 5 s (±1 s), the actor's gate holds: `live`, the same id, `camera` the only visible section, the picture lit. The tray result is `clicked Disconnect` with title `● CS`, exactly once. The visible sections are still `["camera"]` afterwards, and nothing navigates |
| D-4 | Mac: the state leaves `live` within 1 s, as `ended` / `disconnected-here`. The stage is hidden with 0 lit sampled pixels, and the instrument shows 0 draws after the Disconnect. The pane reads *Disconnected from this Mac* and *"You disconnected this Mac from your phone, so the camera stopped."* (the Mac's DOM). The log has `ended: disconnected-here` and `[link] Disconnected: tray` |
| D-5 | Phone, fresh lines with this prefix: **`stopped: MAC_DISCONNECTED`**, then `Camera released (closed) … N released of N bound`; `Active Camera Clients` without our package within 15 s. The phone's sentence is established **from its log reason and the source mapping only** (`CameraWire.kt` → *"The connection to the Mac ended, so the camera stopped."*). No phone-screen wording is claimed unless the owner reports it. A `STREAM_CLOSED` ending (the stream socket's close seen first, nothing to re-attribute it) would be recorded as **not as pre-registered** |
| D-6 | Only after D-4 and D-5: the tray result is `clicked Connect` with title `○ CS`, exactly once. A **new** `[link] Connected to Samsung SM-S938B` line appears within 30 s. Afterwards there are no pairing lines and the trust store is unchanged |
| D-7 | 60 s from the confirmed reconnect: our package never in the camera clients; 0 Mac `[camera]` lines and 0 `camera.request`; 0 phone `[camera]` lines (no reused consent, no new request, no capture); 0 transfer lines (`[bulk]`, `[share]`, non-listing `[files]`) on either end; the pane never `requesting` or `live` |
| D-8 | Driver: `ended-by-stimulus` with reason `disconnected-here`, anchor-to-end ≤ 20 s, no fallback stop, instrument installed once and disposed |
| D-9 | Afterwards: phone perms, bindings, prefs, trust and receive folder, and all 65 protected Mac artifacts, identical to the pre-session snapshot (except a relaunch-free run should not touch `sidekick.json`; any change is reported) |

Not claimed: the macOS menu integration is proven only by this live run. Its local checks used an
injected tray (`window.__fakeTray`), not System Events.
