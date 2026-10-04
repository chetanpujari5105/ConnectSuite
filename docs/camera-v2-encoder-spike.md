# Camera v2 — the Samsung encoder spike (runbook)

**Status, 2026-10-04: prepared, not run.** The tooling below is built and tested against generated
fixtures only. **Nothing in this document has executed against a device.** Running it needs the separate
approvals in §4, and the sitting itself (§6) is one more.

## 1. The one question

> Can the SM-S938B's real **Camera2 → MediaCodec** output be received on this Mac and **decoded
> correctly by VideoToolbox**, before Sidekick Camera (the extension) exists?

Everything Camera v2 has proven so far used a Mac's VideoToolbox *encoder* standing in for the phone's
(`docs/fixtures/webcam-phone-stream-v1.hex`). This sitting replaces the stand-in with the real encoder,
and nothing else. It does **not** test the extension, a meeting app, a switch, coexistence, endings
other than the planned Stop, heat, or duration.

## 2. Scope of the first sitting, fixed in advance

| | |
|---|---|
| Requests | **one** — the Mac's runner refuses a second per launch, the driver calls it at most once |
| Approval | **the owner's own Start camera tap** on the phone. Nothing taps for them |
| Camera | **back** (rear), fixed in main — the renderer cannot choose |
| Anchor | both Mac timers start when **Electron main receives** the phone's `webcam.state starting` (Mac clock, `Date.now()`). That is *after* the owner's tap by an unmeasured phone + network delay; it is never called the tap time, and no Mac time is compared with a phone time. The phone's PTS is used only against itself (fps, IDR spacing) |
| Planned Stop | **15 s** after that receipt, Mac → `webcam.stop` `person` |
| Hard cap | **20 s** after the same receipt, on its **own** `setTimeout` in Electron main, armed in the same handler as the Stop |
| Emergency | the driver's, independent of the Mac: if our package still holds a camera **25 s** after the driver itself first saw the spike's `capturing` phase (its own Mac-side poll, so later than main's anchor), one `KEYCODE_HOME` through the pin — recorded, and it **fails** the run |
| Observation | **60 s** after the stop, sending nothing; camera clients sampled every 2 s |
| Not in it | camera switch, mirror / Camera v1 coexistence, lifecycle endings, heat run, a second attempt |

## 3. The route, stated correctly

There are **two** links to the phone in this sitting and they must not be confused:

| Link | Carries | Transport |
|---|---|---|
| **adb over the USB cable** | the APK install, the launcher start, `run-as` log reads, `dumpsys` reads, the emergency Home | USB debugging. **No camera data crosses it.** |
| **ConnectSuite's link** | `webcam.request` / `state` / `stop` on 42501, the access units on 42502 | **TLS 1.3, Mac connects out to the phone's address on the local network** (decision #2), pinned to the paired phone's fingerprint |

The 42502 socket goes to whatever address the control session holds. **The runbook does not assume Wi-Fi.**
The report records it: Electron main writes `route.address` (the address the pinned socket opened to),
and the driver resolves the Mac interface for it with `route -n get` + `networksetup
-listallhardwareports` (both read-only). Expected: `en0`, *Wi-Fi*. USB tethering is **not** used and not
approved (B9); if the route reads anything other than the Wi-Fi interface, the reading is still valid
but the report says which route carried it. Before concluding anything about the network, read
`ipconfig getsummary en0`, not `ifconfig` (step 71's lookalike, `CLAUDE.md`).

## 4. Every build, install and instrumentation change — each its own approval

### 4.1 Already done, code only (this commit)

| Change | Where | Why |
|---|---|---|
| **Decode probe** — the bridge's real `BridgeCore` (gate → VideoToolbox decode → compose) into a sink that counts and discards; an independent SPS reader; header / SPS / decoded dimensions read at the three stages; a 150 s self-exit bound | `desktop/native/SidekickCamera/Sources/WebcamProbe/`, `…/sidekick-camera-decode-probe/` | the headless decoder. Never packaged, never resolved by the production controller |
| **Spike runner** — one `webcam.request` (`trigger: "person"`, back), the exact-session claim on v1's pinned opener, AUs to the probe, the 15 s Stop and 20 s cap, 60 s observation, a report of integers | `desktop/src/main/webcamSpike.ts`, wired in `main.ts` | the production controller refuses every request without Sidekick Camera, and **is not changed** |
| `webcamSpike` debug switch | `desktop/src/main/debugSwitches.ts` | arms the runner; needs `webcamDev` too; ignored packaged |
| Preload `webcamSpikeCurrent` / `webcamSpikeRun` / `onWebcamSpike` | `desktop/src/preload.ts` | the channels exist only when armed; there is **no button** |
| Phone capture line names the **encoder** (`codec.name`, hardware flag), the **AE range** chosen and the number of encoder-capable sizes | `camera-module/.../webcam/WebcamCamera2.kt` | "selected configuration versus target" needs the encoder's identity, which no line said |
| Driver + pre-registered verdict | `scripts/webcam-spike-driver.mjs`, `scripts/webcam-spike-core.mjs` | §6–§7 |

What is **not** changed: `WebcamController`'s gates (Sidekick Camera installed **and** a producer
identity, both false today), `resolveBridgeExecutable` (no override), the bridge executable, the
extension, `ext.webcam`'s advertisement rule, the phone's consent, deadlines and claim rules, the
deferred development preview (still not built — nothing draws a frame).

### 4.2 Needs approval before the sitting (none done)

| # | Action | Command | Changes |
|---|---|---|---|
| A1 | Build the Swift release products (bridge **and** probe) | `cd desktop/native/SidekickCamera && swift build -c release` | `.build/release/` only. Required: `ext.webcam` is advertised only when the bridge is at its one path, and the runner needs the probe at its own |
| A2 | Build the phone debug APK | `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug` | `app/build/` only |
| A3 | **Install it on the pinned phone** | `scripts/adb-pinned.sh samsung install -r app/build/outputs/apk/debug/app-debug.apk` | the phone's Sidekick. `-r` keeps grants and both secure-settings bindings (Phase 4 banner) and leaves the phone **serverless** |
| A4 | Start the phone's service and prove it | `scripts/adb-pinned.sh samsung shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity` then `scripts/link-up.sh` | launcher start; read-only check |
| A5 | **Build the Mac app into `desktop/dist`** | `cd desktop && npm run build` | overwrites the running app's `dist` (memory: *desktop/dist is the running app*) |
| A6 | **Quit the running Sidekick** (pid 28482 today, from `dist`) and **relaunch in development** | `cd desktop && CONNECTSUITE_DEBUG_SWITCHES=webcamDev,webcamSpike ./node_modules/.bin/electron . --force-renderer-accessibility --remote-debugging-port=9222` | the Mac app. Its log must then say `webcam 1 ADVERTISED` and `encoder spike ARMED` |
| A7 | After the sitting: quit the development launch and relaunch the ordinary app without switches | as A6, with no `CONNECTSUITE_DEBUG_SWITCHES` | restores normal state |

A3 and A6 are the two that change something the owner uses. A5 alone changes the running app's
renderer for new windows. None of them signs, activates or installs anything on the Mac.

**Not needed and not approved:** any signing, the extension, `/Applications`, System Settings, SIP or
`systemextensionsctl`, tethering, a Meet/Zoom call, deletion of anything.

## 5. Gates (read-only) — `node scripts/webcam-spike-driver.mjs --dry-run`

Run after A1–A6, before the sitting. It sends nothing and presses nothing. It refuses (NO READING,
exit 5) unless **all** hold:

- the Mac's runner says `armed`, phase `idle`, not spent (read from the page via `scripts/probe.mjs`,
  with the nav rows as control);
- Sidekick is the resumed activity on the pinned SM-S938B; unlocked, awake, no call;
- thermal status below *moderate* (`dumpsys thermalservice`);
- `dumpsys media.camera` is readable and our package holds **no** camera;
- the phone log can be stat-ed (inode and size taken here, before anything).

Also read by hand once, and written into the record: `scripts/target-device.sh samsung` (the pin),
`scripts/link-up.sh`, and the Mac log lines for `webcam 1 ADVERTISED` and `encoder spike ARMED`.

## 6. The sitting — `node scripts/webcam-spike-driver.mjs --execute --report <new file> --owner-present`

The owner holds the phone, back camera pointed at something **non-personal** (a wall, a desk). Nothing
of the picture is kept, but the owner should still choose the scene.

| t | Who | What |
|---|---|---|
| 0 | driver | marks the phone log (inode + size); calls `window.connect.webcamSpikeRun()` **once** |
| 0 | Mac | spawns the decode probe; waits for its `ready`; only then sends `webcam.request {facing: back, trigger: person}` |
| ≤ 2 s | phone | acks `awaiting-approval` with the `sessionId`; shows *"<Mac> is asking to use this phone's camera as a webcam"* |
| owner | phone | **Start camera** (and, only if Android asks, the camera permission). Unanswered for 30 s → `expired`, NO READING |
| tap | phone → Mac | `webcam.state starting`. Mac arms the 15 s Stop and the 20 s cap, opens the pinned socket, writes the claim `<token> webcam <sessionId>` |
| ≤ 10 s | phone → Mac | first AU (IDR + SPS + PPS), `running` with the selected size beside the 1920 × 1080 / 30 target |
| …15 s | Mac | AUs framed, forwarded to the probe (4-AU bound), decoded, composed, discarded |
| 15 s | Mac | `webcam.stop {cause: person}` written, **then** the socket destroyed, then the probe told; no waiting for the ack |
| ≤ 2 s | phone | `stopped: stopped-by-mac`; camera, encoder, surface released |
| | Mac | probe drained, final counts, reaped |
| +60 s | both | observation: no state, no AU, no capture line, no camera held |
| end | driver | resolves the route, writes the report (refuses to overwrite), prints the verdict |

The owner may end it at any time by pressing Stop or Home on the phone. That is recorded as the phone's
ending and the verdict is **NO READING**, not a failure.

## 7. Pre-registered criteria

Written and tested before any reading exists (`scripts/webcam-spike-core.mjs` → `verdict`,
`webcam-spike-core.test.mjs`). Three outcomes, never folded together.

### 7.1 NO READING — the question was not asked

A gate failed; the run was not armed; the owner declined or did not answer in 30 s; the phone refused
(`CAMERA_BUSY`, no camera, not negotiated); the probe did not start; the link dropped; a lifecycle event
(sleep, lock, quit) ended it; the owner pressed **Stop** or **Home** on the phone before 15 s; the phone
log rotated mid-run; the driver's 150 s overall deadline passed.

### 7.2 PASS — every one of these, each with the reading that met it

**Identity and claim**
1. One session id acked; the phone logged the stream **attached** for that session's 8-hex prefix.
2. Exactly one `running`, and every AU header's generation is 1.

**Timing (bounds, measured from `starting`)**
3. `running` within **10 s**; the first AU on the Mac within **10 s**.

**The bitstream — real SPS / PPS / IDR and P-frames**
4. The first AU to arrive is an **IDR carrying SPS and PPS**.
5. SPS and PPS reached the decoder, and the probe's SPS reader read every SPS.
6. **≥ 2 IDR** and **≥ 60 P-frames** decoded; **≥ 75** frames decoded in all (5 s at the ladder's
   lowest rung, 15 fps).
7. **Zero** decode failures; **zero** malformed AUs (main's framing, the gate, `stream-rejected`).

**VideoToolbox decoding, coded versus decoded**
8. The AU header's size = `running`'s size = the SPS's **cropped** size = the **decoded** buffer's size;
   no per-AU mismatch counted; one size throughout. The SPS's **coded** (macroblock) size is reported
   beside it — 1920 × **1088** for 1080p is expected, not a fault.
9. The phone's capture line selected the same size the stream carried.
10. Accounting: every AU the probe received is accepted or dropped with a cause, every accepted AU ends
    decoded / dropped at the decode bound / failed, and nothing is pending.

**Stop and release**
11. The **planned** Stop ended it, at **14.5–16.5 s** (so never the 20 s cap).
12. The phone's `stopped` is `stopped-by-mac` within **2 s** of the stop being written, and its log says
    `STOPPED_BY_MAC` for this session.
13. Our package is gone from `dumpsys media.camera` within **5 s** of the stop.
14. The decode probe exited **0** and was reaped.

**No subsequent capture**
15. A full **60 s** observation; **0** states for the session after its `stopped`, **0** for any other
    session, **0** AUs after the stop; our package holding a camera in **0** of ≥ 10 samples; **0**
    capture lines after the stop.
16. The driver did **not** press the emergency Home.

### 7.3 FAIL

Anything in 7.2 not met, with the run not a NO READING. A phone-side `capture-failed`, `camera-in-use`
or `too-hot` before 15 s is an answer, and the answer is **FAIL**.

### 7.4 Reported, never judged

Measured fps (from the phone's own PTS) beside the **30 fps target**; the IDR interval min/max beside
the **2 s target**; the selected size beside **1920 × 1080**; coded size; profile/level; encoder name,
hardware flag, AE range, encoder-capable sizes; ladder rungs refused; rotation; sequence gaps and
discontinuities; Mac-side arrival bitrate; drops at each stage. **A rung below the target is not a
failure**: it is the phone's answer, reported as such (contract: never rounded up).

## 8. What is kept, and what never is

- **Never** recorded, written or retained: a raw frame, an access unit, an H.264 byte, a pixel, a
  screenshot, a screen recording, the session token, the whole session id. The probe writes nothing to
  disk (its process test runs it in an empty directory and asserts it stays empty).
- **Kept** in the report: integers from the probe and from main; timings; the session id's first 8
  characters; the phone's closed-set reasons; the phone's `[webcam]` log lines **for this session**, with
  the Mac's device name replaced by `<peer>`; camera-client samples (package names); the route.
- The report goes in `docs/evidence/camera-v2-encoder-spike-<date>/` and is committed only with the
  owner's approval.

## 9. What a PASS does not prove

Anything about Sidekick Camera, the extension, CoreMediaIO, a meeting app, the far-end tile; the front
camera; a camera switch; any ending but the planned Stop; anything past 15 s (heat, bitrate stability,
battery); a second Samsung or any other phone. Those are the deferred V2–V5 readings and W4/W5.

## 10. The tooling and what proved it (generated fixtures only)

| Piece | Tests | Real / stood in |
|---|---|---|
| SPS reader | agrees with **VideoToolbox's own SPS parse** on 7 real parameter sets (Baseline and High; 1080p, 720p, 540p, 1272 × 720, 360 × 640 — the last two crop horizontally); emulation-prevention; unreadable → nil | real VT encoder and VT format description |
| Probe pipeline | 60 real 1080p High AUs: 60 decoded, 2 IDR / 58 P, all four sizes agree, coded 1088, IDR spacing, invariant; a header disagreeing with its own SPS is counted; garbage slices are decode **failures**, never frames; nothing decoded after the session ends; a generation not starting with an IDR is **rejected** | real `BridgeCore`, real VT decode |
| Probe executable | real H.264 through the built binary: decoded, counted, **nothing written** to its working directory; exits by itself at its lifetime bound (watchdog at 8 s) | the built `sidekick-camera-decode-probe` |
| Spike runner | the phone-writer fixture's real H.264 through the **built** probe: one request, the exact claim, the planned Stop written before the socket closes, 6/6 decoded, no token or whole id in report or log; once per launch; preconditions as named no-readings; no request without a ready probe; the cap independent of the Stop; decline, expiry, refusal, malformed, the phone's Home, late and foreign states, link loss; every wiring gate with its own reason; back camera only | stand-in phone and socket (labelled); real probe |
| Verdict | a generated PASS; a lower rung still PASS; 25 single-criterion FAILs; NO READING kept apart; the Kotlin still writes every phone line the parser reads; the driver's bounds equal the runner's. And the verdict run on the **real** runner report from the test above: every bitstream, size and accounting criterion passes on it | generated reports + one real |

**Red-first:** 9 runner mutations (MS1–MS9), 3 verdict mutations (MC1–MC3), 7 probe mutations
(SW1–SW7), each red on the test named for it. Three were green first and each exposed a real gap, fixed
before this was written: **MS7** (a packaged build is refused twice — by the wiring and by the probe
resolver — and the test checked only the outcome), **SW1** (every fixture width was a multiple of 16, so
horizontal cropping was never exercised), **SW5** (nothing fed the probe bytes VideoToolbox refuses, so a
probe that counted frames without decoding them passed). **SW6** first *hung* rather than failed — the
lifetime test had no watchdog of its own; it now terminates the child at 8 s.
