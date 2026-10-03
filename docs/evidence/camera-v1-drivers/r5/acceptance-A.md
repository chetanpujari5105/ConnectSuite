# Case A retry — acceptance bounds, written before the request (2026-10-02)

These are the 22:34 bounds (`r4/acceptance.md`, SHA-256 `92b7f9b3…`), unchanged, applied to case A only,
plus the repaired driver's own rules.

**Driver rules (instrument checks — a breach is NO READING and stops the attempt):**
- I1 the capture timer arms only on the Mac's own state showing THIS attempt's full stream id in
  `connecting` or `live` (minus 500 ms); never on the request or a phone line;
- I2 phone lines are read only from the byte offset recorded with the log's inode before the request;
  a rotation or truncation stops the attempt;
- I3 phone lines are matched to this stream by their 8-character prefix only, and labelled `prefix-8`;
- I4 a fresh line for another stream, or capture evidence with no Mac start within 2 s, is a safe
  shutdown;
- I5 the 20 s cap runs from the anchor; approval has its own 40 s window.

**Product checks (a breach is FAIL):**
- K1 the phone's `Start camera tapped` for this prefix precedes `Camera bound` (phone clock); no camera
  event for our package before the request;
- K2 anchor → end ≤ 20 s (Mac clock); a deadline Stop means Home did not end capture → NO READING;
- K3 our package absent from `Active Camera Clients` within 10 s of the Mac seeing the end;
- K4 phone: one `Camera stream closed: S sent / D dropped` and one `stopped: LEFT_SCREEN` for this prefix;
  Mac: one `ended:` line for this stream;
- K5 Mac canvas 0 × 0 at the first read after the end and at every later read;
- K6 0 instrument draws stamped after the Mac's `ended:` line;
- K7 S, R, N reported (S − R in flight at the end; R − N not drawn); no continued capture;
- K8 60 s from the owner's reopen: no camera client, our camera events constant, no fresh phone
  `[camera]` line, no new Mac `camera.request sent`, the pane never live;
- K9 phone `LEFT_SCREEN`; Mac final reason `left-screen` with *"…camera screen left your phone's
  display."*; no raw token, no network advice.
