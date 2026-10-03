# Case A with a timed Home — acceptance bounds, written before the request (2026-10-02)

The K1–K9 bounds of `r5/acceptance-A.md` (SHA-256 `8d45f50d…`) apply unchanged, with the stimulus now the
driver's ONE `KEYCODE_HOME`, sent ~5 s after the Mac shows THIS stream live. Added for this attempt:

**Instrument (a breach is NO READING; stop):**
- I1–I5 as before (the cap armed only on this stream's own start; fresh phone lines only; prefix-8 labelled;
  uncertainty is a safe shutdown; approval separate from the cap);
- I6 Home is sent at most once, and only if the Mac's state at that moment is `live` for this exact id;
- I7 the reopen is a single `am start -a MAIN -c LAUNCHER -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity`
  (the resolved launcher activity; no -S, no clear-task flags), sent only after K3 and K4 hold.

**Product (a breach is FAIL; no reopen, no retry):**
- A1 Home ends capture: the activity history shows `CameraActivity` PAUSED/STOPPED and the launcher RESUMED
  (phone clock) AFTER the Home was sent (Mac pane live for this id at that moment), and the phone logs
  `stopped: LEFT_SCREEN` for this stream's prefix — not `STOPPED_BY_MAC` / `STREAM_CLOSED`, and the driver
  pressed no Stop;
- A2 the Mac clears its picture (canvas 0 × 0) and its final reason is `left-screen`, worded as the camera
  screen leaving the phone's display; no raw token, no network advice;
- A3 release within 10 s of the Mac's end; 0 draws after the Mac's `ended:` line; S, R, N reported (buffered
  vs continued);
- A4 from the CONFIRMED reopen, 60 s: no camera client, our camera-event count constant, no fresh phone
  `[camera]` line beyond the session's, no Mac `camera.request sent` beyond the one, the pane never live —
  no reused consent, no capture, no new request.

If Home does not end capture, the 20 s deadline presses the real Mac Stop: the case is FAIL, with no reopen.
