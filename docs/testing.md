# ConnectSuite acceptance tests

One section per phase. A phase is not done until every step here passes on real hardware
(Samsung phone on One UI, MacBook on the phone's hotspot and on a home router).

---

## Before any step that flips a Settings switch — confirm the toggle landed

**Read this first. Every step below that says "grant", "revoke", "turn on" or "turn off" in Settings
begins here.**

One UI has more than one screen per permission, and the wrong one is the one you reach by the
obvious route. On 2026-08-28 a single step (43) was attempted **four times** against the wrong
switch; each attempt looked successful on the phone, and nothing downstream said otherwise. The
cost was most of a morning and three rounds of "it didn't happen".

The confirmation is one command and one second. **A toggle that produces no log line did not
happen — do not run the rest of the step.**

```sh
adb shell "run-as com.chetan.connectsuite.debug tail -3 files/logs/link.log"
```

| Switch | Right screen | Expected within ~1s of the toggle |
|---|---|---|
| **Notification access** (`notifications`, `remote`) | Settings → Apps → ⋮ → Special access → **Notification access**<br>`am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS` | off → `[notif] Notification listener detached; notifications capability is off`<br>on → `[notif] Notification listener attached to the link` |
| **Accessibility** (`input`) | Settings → **Accessibility** → Installed apps → **ConnectSuite Input**<br>`am start -a android.settings.ACCESSIBILITY_SETTINGS` | off → `[input] Accessibility service disconnected`<br>on → `[input] Accessibility service connected` |
| **Runtime permissions** (`sms`, `calls`, `contacts`, …) | the app's own permission dialog, or App info → Permissions | `[caps] Capabilities now: …` naming the new set |

Each of the first two is followed by `[caps] Capabilities now: …` and, on the Mac,
`[link] Capabilities changed: …` — measured at **16-17ms** behind the phone on 2026-08-28, so if
the Mac has not moved within a second or two, the phone did not either.

### The lookalikes, and the one-glance tell

| Looks like | Actually writes | Tell it apart by |
|---|---|---|
| **Notification access** ✅ | `enabled_notification_listeners` | Short list of **companion** apps — Galaxy Buds, Android Auto, Link to Windows |
| Notifications → App notifications ❌ | that app's `importance` | **Every installed app**, alphabetical, hundreds long |
| App info → Notifications ❌ | that app's `importance` | Reached from the app's own info page; the toggle is about *showing* notifications |
| **Accessibility → Installed apps** ✅ | `enabled_accessibility_services` | Lists only apps declaring an `AccessibilityService` |
| Accessibility's Vision / Hearing / Interaction sections ❌ | assorted Samsung settings | Samsung's own features, not third-party services |

**"Access" is about what an app may *read*. "Notifications" on an app's own page is about what it
may *show*.** They are opposites, and only the first is what any step here means.

The fingerprint of having pressed the wrong one:

```sh
adb shell dumpsys notification --noredact | grep "AppSettings: com.chetan.connectsuite"
#   … importance=NONE userSet=true   <- the *posting* switch was turned off; irrelevant to reading
```

### Why this is a preamble and not a footnote

The confirmation is more useful than the screen names, because it does not depend on remembering
which screen is which, on One UI's menu tree staying put, or on the person running the step having
read the table above. It is the same rule as the positive control in CLAUDE.md, applied to an
action rather than a query: **prove the thing you just did had the effect you think it had, before
building anything on top of it.** A toggle believed-but-unverified is a negative result believed
without a control.

---

## Where to look when a step fails

**A pass is what the logs say, not what the pane looked like.** Both paths, ready to paste.

### The two logs

```sh
# Phone — live tail. Debug builds only; the app id carries a .debug suffix.
adb shell run-as com.chetan.connectsuite.debug tail -f files/logs/link.log

# Phone — dump the whole thing
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log

# Mac — live tail
tail -f ~/Library/Application\ Support/connectsuite-desktop/logs/connectsuite.log
```

The Mac log is also in the app's own Connection health panel, which is usually faster than
finding the file.

### The greps that answer most questions

```sh
# What is the phone advertising, and when did it last change?
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log | grep '\[caps\]' | tail -20

# What did the Mac think it was told?
grep 'Phone advertises' ~/Library/Application\ Support/connectsuite-desktop/logs/connectsuite.log | tail -5

# One feature's whole story — swap the tag: notif, sms, calls, contacts, remote, mirror, input
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log | grep '\[notif\]' | tail -30

# Every refusal, with its tally
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log | grep -E ' W | E ' | tail -30

# The two that mean a prevented harm rather than a refused convenience. Any hit is worth chasing.
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log | grep REFUSED
```

### Checking a grant, rather than believing a toggle

A capability needs **three** things and the log names which is missing. When a step turns on
granting or revoking access, verify the setting itself rather than the switch you just tapped —
a Settings screen can read as off while the secure setting says otherwise:

```sh
# Notification listener — empty output means the grant is OFF
adb shell settings get secure enabled_notification_listeners | tr ':' '\n' | grep -i connectsuite

# Accessibility service — same
adb shell settings get secure enabled_accessibility_services | tr ':' '\n' | grep -i connectsuite

# Runtime permissions
adb shell dumpsys package com.chetan.connectsuite.debug | grep -E 'READ_SMS|SEND_SMS|CALL_PHONE|ANSWER_PHONE|READ_CONTACTS|READ_CALL_LOG|READ_PHONE_STATE'
```

**A grant is not a running component.** These two are separate facts and they disagree routinely —
reinstalling the APK tears down a bound `NotificationListenerService` or `AccessibilityService`
while the secure setting goes on naming it. To tell them apart:

```sh
# Bound? `app=null` on the ServiceRecord means the system wants it and nothing is attached.
adb shell dumpsys activity services com.chetan.connectsuite.debug | grep -A 3 NotificationMirrorService | grep -E 'ServiceRecord|app='

# The platform's own live list. Absent here means not delivering, whatever the setting says.
adb shell dumpsys notification | sed -n '/Live notification listeners/,/^    [A-Z]/p' | grep -i connectsuite
```

If a capability is dark and you expected it lit, the phone log says which of the three gates is
open, by name:

```sh
adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log | grep -E 'not granted|not bound|not built yet|is off'
```

## Running the two sides

Phone:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:installDebug
```

Open the app, go to the **Mac** tab. The card should say "Listening for your Mac" and list the
three ports. The persistent notification says the same thing.

Mac:

```bash
cd desktop && npm install && npm start
```

The old ADB mirror is still available for comparison with `npm run start:legacy`
(`LEGACY_ADB_MIRROR=1`). It is not part of any v2 acceptance test.

Unit tests: `./gradlew :core:testDebugUnitTest` and `cd desktop && npm run typecheck`.

## Phase 1 — transport, pairing, auto reconnect

| # | Step | Pass condition |
|---|------|----------------|
| 1 | Fresh install both sides. On the Mac the pairing card shows a QR code. On the phone tap **Mac → Scan pairing code** and scan it. | Phone shows "Paired with <mac name>"; the Mac's state pill turns to "Connected to <phone name>" within a few seconds. |
| 2 | Quit both apps. Reopen both. | They reconnect with no scan and no typed IP. The HUD's "Found via" says `last-known` or `gateway`. |
| 3 | Turn the phone's Wi-Fi off, wait 10s, turn it back on. | The Mac reconnects within 30 seconds; the HUD shows the backoff counting down, not a frozen "connected". |
| 4 | Close the MacBook lid for 2 minutes, then open it. | Reconnect within 5 seconds of wake (`powerMonitor` resume triggers an immediate retry — the log line is `Immediate retry: system resumed`). |
| 5 | Put the Mac on the phone's hotspot, where the AP drops multicast. Confirm `dns-sd -B _connectsuite._tcp` finds nothing. | The Mac still connects; the HUD says "Found via: gateway". |
| 6 | Point a second, unpaired Mac at the phone's IP (`npm start` on another machine, or delete `paired` from the store and try to connect without scanning). | The phone refuses the TLS handshake. Phone log (`filesDir/logs/link.log`) shows `Refused <ip>`; the Mac reports "not paired yet" and never reaches the handshake. |
| 7 | Swipe the phone app away from Recents while the Mac is connected. | **The link survives.** `LinkService` is `stopWithTask="false"` + `START_STICKY`, so removing the task does not stop the service: the three listeners stay bound and the Mac never sees a missed pong. |
| 8 | Reboot the phone. Do not open the app. | Within 3 minutes the service is running, all three ports are listening again, and the Mac reconnects on its own. |
| 9 | With the phone on battery and the screen off, leave the link idle for 10 minutes. | No disconnect, no heartbeat loss. The Mac logs nothing at all for the whole window. |
| 10 | Read the battery level either side of test 9. | Drain over the 10-minute idle window is recorded. Needs the phone **physically unplugged** — see the note below. |

Test 7 replaces an earlier "force stop the app and confirm it restarts" step, which is not
achievable and never was: **force stop sets `FLAG_STOPPED`**, and from that state Android will not
deliver broadcasts, run jobs, or let `START_STICKY` restart anything until the user launches the
app by hand. That is documented platform behaviour, not a defect, and no amount of WorkManager
changes it. Swipe-from-Recents is the restart-survival case that *is* meaningful, and it is the one
users actually perform.

Two consequences worth keeping straight, because they look similar and are not:

- **Swipe from Recents** — the task goes, the service stays. The link holds.
- **Force stop** — the process goes and stays gone. The Mac correctly reports the dead link
  (three missed pongs, ~15s), and nothing reconnects until the app is opened manually.

### Recorded run — 2026-08-25, Samsung SM-S938B (One UI, Android 16) + MacBook Pro

Tests 8, 9 and 10 were run unattended against the phone on its own hotspot.

| # | Result | Evidence |
|---|--------|----------|
| 8 | **PASS** — 109s | `sys.boot_completed` at 42s; all three listeners bound and `LinkService` foregrounded by 109s, with no app launch. Phone log: `10:27:09 [server] Listening on 42501/42502/42503, 1 paired device(s)`. Mac reconnected at 10:27:13. |
| 9 | **PASS** — 600s, 0 drops | Screen asleep (`mWakefulness=Dozing`), battery simulated unplugged. The Mac wrote **no link lines at all** for the full 10 minutes — no `Disconnected`, no `Heartbeat lost`. |
| 10 | **Not measurable while tethered** | 79% → 80%. `dumpsys battery unplug` only tells the OS it is unplugged; `USB powered: true` throughout, so the phone kept charging and the level rose. A real drain figure needs the cable physically out. |

Test 8 passing deserves a caveat: **there is no `BOOT_COMPLETED` receiver in this build.**
`RECEIVE_BOOT_COMPLETED` is declared in `app/src/main/AndroidManifest.xml` but nothing listens for
it, and `START_STICKY` does not survive a reboot. The service came back anyway, which means it is
being restarted by One UI's own app-restart behaviour rather than by anything this app does. That
is not a guarantee on other devices or other OEMs. Treat test 8 as passing *on this handset* and
add a real boot receiver before relying on it.

#### Two harness bugs that produced false results first

Recorded because both are easy to repeat and one of them looks exactly like a product failure:

1. **Counting sockets without filtering state.** `/proc/net/tcp6` was grepped for the three ports
   without checking `st == 0A`, so a healthy link counted **4** — three listeners plus the Mac's
   ESTABLISHED control connection — and tripped a "link dropped" check that expected 3.
2. **Polling adb during the soak.** With the battery simulated as unplugged, One UI suspends the
   USB data link; polling `adb` every 60 seconds through that suspend/resume churn killed the
   Wi-Fi control connection at ~90s and read as a genuine Doze failure. The phone's own log showed
   the service alive the whole time and only the TCP connection torn down. Re-running with the
   **Mac** as the sole observer — it watches over Wi-Fi and does not care about USB — gave a clean
   600s pass. Observe an idle-soak from the side that is not attached to the thing under test.

## Phase 2 — screen mirroring

| # | Step | Pass condition |
|---|------|----------------|
| 1 | Connect the Mac. Open the phone's **Mac** tab. | "Available to the Mac" lists `mirror`. It appears only because `MirrorFeature.install()` registered `mirror.start`/`mirror.stop` **and** assigned `videoChannelSink` — both halves of the contract in `CapabilityContract.kt`. |
| 2 | On the Mac, press **Start mirroring**. Tap "Start now" on the phone. | The phone screen appears on the Mac's canvas within ~2s. `mirror-stats` counts frames and shows a plausible fps. |
| 3 | Press **Start mirroring**, then tap **Cancel** on the phone's prompt. | The canvas shows "Screen capture was denied on the phone." with the hint to try again. Not a blank rectangle. |
| 4 | Start mirroring, then lock the phone with the power button while the prompt is up, without answering it. | "Screen capture was denied on the phone." (`PERMISSION_DENIED`). **The same sentence as tapping Cancel, and that is correct** — see below: the platform answers the request rather than destroying the prompt, so the phone is not told the difference and must not invent one. |
| 4a | Start mirroring from the Mac, and while the prompt is up start mirroring again from the phone's Mirror tab. | The first request ends with "The screen capture prompt closed before it was answered." — this is the only route to `ConsentDismissed` that a user can actually take. |
| 5 | With the phone locked, ask the Mac to start mirroring. | "The phone is locked, so it cannot start screen capture." |
| 6 | While mirroring, open a banking app or play DRM video. | "The phone is showing content that Android blocks from being captured…". Frames resume when you leave that app — this is the one failure that does not end the session. |
| 7 | While mirroring, force stop the app from Settings. | The Mac reports the dead link within ~15s and the canvas says why. No silent freeze on the last frame. |
| 8 | Revoke a permission a capability depends on while connected. | The matching chip in the Mac's Capabilities card goes grey within a few seconds, without a reconnect. **Moved to Phase 3 as steps 21 and 22**, against the accessibility switch — the first revocable grant behind an advertised capability this build has ever had. Contacts, the original subject, is not advertised and never was. |
| 9 | Disconnect the Mac while mirroring. | Video stops, the canvas explains that the link dropped, and the video socket is closed rather than left holding a dead session token. |
| 10 | While mirroring, rotate the phone to landscape, wait 5s, rotate back. | The Mac's canvas follows the rotation: landscape content fills a landscape canvas, with no letterboxing and **no second consent prompt on the phone**. The HUD's Capture line transposes and Rotation reads 90°, then back. Each turn costs one keyframe, not a restart. |
| 12 | While mirroring is **live and delivering frames**, lock the phone with the power button. | The canvas says "Screen capture was stopped on the phone." Android revokes the projection at the keyguard, so this is a legitimate end to the session and must read as one — a named reason, not a freeze on the last frame. Distinct from test 4, where the lock lands while the *prompt* is up and nothing has been granted yet. |
| 11 | Mirror for 60s of ordinary use (scroll a list, open an app). Read the HUD's latency figures. | Three figures, each a number rather than `—`: the total median capture-to-paint (with its peak), the phone → Mac half, and the Mac → painted half. The total stays under 150ms on the same Wi-Fi, and the two halves sum to roughly it. A total that never leaves `—` means the clock anchor never arrived, which is a defect, not a slow link. |
| 13 | With the phone **unlocked** and ConnectSuite backgrounded, press **Start mirroring** on the Mac. The phone posts its "open the app" notification; ignore it and lock the phone. Wait out the 30s consent timeout. | The reason names the lock: the phone is locked and no prompt was ever shown, so "The phone did not answer the screen capture prompt within 30 seconds" describes something that did not happen. **Known to fail as of 2026-08-26** — see below. |
| 14 | Mirror, stop the session, wait, then trigger any failed start (test 5 is the easiest). Look at what is *under* the overlay. | The canvas carries nothing from the previous session. The overlay's scrim is 82% opaque, not opaque, so a frame left underneath stays legible — a phone screen from minutes ago readable beneath "The phone is locked" contradicts the sentence on top of it. **Known to fail as of 2026-08-26** — see below. |
| 15 | While mirroring, change **Capture** on the Mac (e.g. 1080p → Native). | The picture changes resolution with the session intact and **no second consent tap** — `mirror.config` rebuilds the encoder under the same MediaProjection. **Known to fail as of 2026-08-26** — it restarts the session and re-prompts. |
| 16 | While mirroring, rotate to landscape and back, and read the rotation the HUD reports during the return. | Each turn announces exactly one rotation, and the angle announced matches the geometry announced with it. **Fixed in code 2026-08-26, not yet re-run on hardware.** The phone now re-reads the display until the angle and the metrics are consistent with each other before announcing either. Re-run this alongside Phase 3 step 24, which is what made it matter. |
| 17 | Start mirroring, then disconnect the Mac. Leave the phone alone and watch its log. | Capture stops on the phone within a second or two of the control session ending: no encoder ticking, no live MediaProjection, no "your screen is being recorded" notification left standing. **FIXED and verified on hardware 2026-08-26** — see the result row below. |
| 18 | Leave a mirrored, then idle, link alone on a quiet network for 10 minutes with the phone locked. | No `Heartbeat lost` and no `idle timeout`. Phase 1 test 9 passed this over 10 minutes; a drop was seen on 2026-08-26 at `07:23` after heavy adb traffic and is unexplained. **Unconfirmed** — may be observation churn rather than a defect. |
| 19 | Read the HUD's first-frame figure across two runs where the consent tap took visibly different times. | The figure is a pipeline measurement and does not move with how fast the user taps. **Known to fail as of 2026-08-26** — it is measured from `requestedAt` and is dominated by human reaction time. |

**Test 13 is a known failure, and it is the same bug as test 5's.** `MirrorEngine.start` now checks
the keyguard before the foreground branch, so a phone locked *at the moment of the request* is
reported correctly. `onConsentTimeout` (`MirrorEngine.kt:821`) does no such check: it fires 30
seconds after an `awaiting-foreground` request and reports `ConsentTimeout` regardless of what the
phone is doing by then. If the user locked the phone while the notification sat unanswered, the
sentence blames them for ignoring a prompt that was never on screen, and its hint sends them to open
an app they cannot reach without unlocking first.

Both are one class of defect: **a state read at the wrong moment producing a confident wrong
sentence.** The fix is the same shape — read the keyguard where the message is chosen, not where it
is convenient — and is deliberately deferred until Phase 2's run is complete, so that the remaining
tests are measured against one build rather than several. Defects 13 and 15 are scheduled after
Phase 3 (input) works — see the roadmap in CLAUDE.md.

**Test 14 — the last frame is never cleared, and only half of that is deliberate.** Observed while
recording test 5, and again during test 7: the canvas still showed a dimmed frame from a session that had ended 14 minutes
earlier, underneath a fresh "The phone is locked" overlay.

The dimming *is* deliberate. `.mirror-overlay` is a separate element with
`background: rgba(16, 16, 20, 0.82)` (`renderer/styles.css:149`), and the overlay is designed to sit
over live pixels: `SECURE_SURFACE` leaves the session running, and `mirror.ts:405` takes the overlay
down on any painted frame, not just a session's first. For that case a frame underneath is correct.

The frame surviving a session *boundary* is not designed, it is simply never undone. Nothing in the
renderer clears the canvas — the only write to `canvas.width` (`mirror.ts:392`) is on a decoded
frame whose size changed, so the pixels persist until some later session happens to overwrite them.
A failed start therefore inherits whatever the last successful one left behind.

Two reasons to fix it rather than to bless it:

1. **It contradicts the message.** "The phone is locked, so it cannot start screen capture" is
   displayed over a readable picture of that phone's screen.
2. **It is stale by an unbounded amount.** 14 minutes here; there is no upper limit.

Fix shape: clear the canvas when a session ends for a non-transient reason — deliberately *not* on
`SECURE_SURFACE`, which is exactly the case the translucent scrim exists for. Deferred with test 13
until Phase 2's run is complete, for the same reason: one build for the remaining measurements.

**Test 4 originally expected `ConsentDismissed` and that expectation was wrong about the platform.**
It was rewritten on 2026-08-26 after being measured rather than being recorded as a failure, because
what it asserted was not something Android permits. The detail is in the recorded run below; the
short version is that locking the phone with the consent dialog on screen delivers RESULT_CANCELED
through `onActivityResult`, exactly as Cancel and back do, so `ConsentDenied` is the honest report.
4a was added to cover the path that does still reach `ConsentDismissed`.

Every failure above is one of the eight in `MirrorFailure.kt`, and each has its own sentence.
`MirrorContractTest` asserts they stay distinct — a duplicate reason string fails the build.

**Numbering.** This file is authoritative for test numbers. Where a number here disagrees with one
quoted in a commit message, an issue, or `docs/status.md`, this table wins and the other reference
is the one to correct. 10 and 11 are new as of 2026-08-25 and were appended rather than inserted so
that every number already used in writing keeps pointing at the same step. 12 was appended on
2026-08-26 for the same reason: it is printed above 11 in the table for readability but numbered
after it, so nothing already written down renumbers.

**Test 10 was recorded as a known failure and is now implemented.** It was written to the behaviour
mirroring should have rather than to what the code did, which is why it needed no rewriting when the
behaviour arrived — only the "known to fail" note came off. `MirrorEngine` registers a
`DisplayManager.DisplayListener` on the default display, sends `mirror.rotate` with the new width,
height and rotation, and then swaps the encoder under the *existing* `VirtualDisplay` with
`resize` + `setSurface`. `displayChangeFor` decides which of the three things a `DisplayListener`
callback is: a resize, an announcement only (a 180° turn — same pixels, different way up), or
nothing at all (brightness, refresh rate, HDR).

Test 11 has the plumbing it needs already: `ping`/`pong` carries the phone's `monoUs` from the same
monotonic clock that stamps each frame's PTS (`ControlSession.kt`, the `PING` branch), and
`desktop/src/renderer/mirror.ts` anchors the two clocks against it to turn a PTS into a
capture-to-paint figure. Median and peak are what the HUD shows; single-frame numbers are too noisy
to read anything into.

The three figures are separate because the halves fail for different reasons and are fixed in
different places. Each frame carries the `Date.now()` stamp taken in the **main process** as the
bytes landed, so **phone → Mac** is the phone's encoder plus the network, and **Mac → painted** is
this Mac's IPC, WebCodecs and canvas. A single total of 180ms says the mirror feels slow; 30ms and
150ms says which machine to look at.

#### What the total is not

**The total is capture-to-paint. It is not end-to-end input latency, and must never be quoted as
one.** Two real overheads sit outside it, one at each end, and neither is something this app can
observe:

- **Touch-to-composite on the phone**, ahead of the measurement. The PTS stamp comes from the
  encoder's input Surface, which is the moment SurfaceFlinger had already composited the frame.
  Everything before that — touch dispatch, the foreground app's own draw, composition — happens in
  another process, upstream of anything we are handed. Android gives a non-system app no per-frame
  figure for it; `FrameMetrics` reports our own window's draw, not the mirrored app's.
- **Present-to-photon on the Mac**, behind the measurement. The clock stops at
  `context.drawImage(...)`. After that the pixels go to Chromium's compositor, the GPU,
  WindowServer and finally the panel. Neither WebCodecs nor Electron exposes a present-to-photon
  timestamp, and `requestAnimationFrame` would only time our own callback, not light leaving the
  screen.

Measuring either honestly needs instrumentation outside both apps: a high-speed camera filming
phone and Mac in the same shot, which is how scrcpy's published latency figures are obtained, or a
photodiode rig. **Until someone does that, no number in this file is an input-latency number.** A
reader comparing our total against a vendor's end-to-end figure is comparing two different
quantities, and the vendor's will be the larger one for reasons that have nothing to do with this
code.

### Phase 2a — consent on Android 16 (background activity starts blocked)

Android 16 blocks activity starts from a backgrounded app. `startActivity` does not throw when it
happens; the start is dropped and `ActivityTaskManager` logs `Background activity launch blocked!`.
The first hardware run of step 2 hit exactly this: the consent prompt never appeared, none of the
seven failures could fire because all of them were reported from *inside* the prompt, and the Mac
sat on a blank canvas until its 60 second request timeout. These steps cover the route that
replaced it.

| # | Step | Pass condition |
|---|------|----------------|
| 2a | Press **Start mirroring** on the Mac with ConnectSuite **backgrounded** on the phone (home button, screen on). | The Mac's canvas says within ~2s that ConnectSuite is in the background and to open it and tap Start mirroring. A heads-up notification appears on the phone. No 60 second wait, and no blank canvas. |
| 2b | Tap that notification. | The app opens **on the Mirror tab**, which shows "<Mac> is waiting for you". Tapping **Start mirroring** raises the system consent prompt. After "Start now", frames appear on the Mac. |
| 2c | Repeat 2a and ignore both the notification and the phone for 30 seconds. | The Mac shows "The phone did not answer the screen capture prompt within 30 seconds." with the hint to open the app and tap Start mirroring (`CONSENT_TIMEOUT`). The phone's notification is withdrawn and the Mirror tab shows the same sentence under "Last error". |
| 2d | Press **Start mirroring** on the Mac with the app already **in the foreground** on the phone. | The consent prompt appears immediately, with no notification and no detour through the Mirror tab. |
| 2e | With a Mac connected, open the phone's Mirror tab and tap **Start mirroring** with nothing outstanding from the Mac. | Consent is asked for on the phone and the Mac starts showing frames — the phone reaches the Mac through the same `mirror.state: running` event, with no `mirror.start` involved. |
| 2f | Open the Mirror tab with no Mac connected. | The **Start mirroring** button is disabled and the line beneath it says why. The tab no longer claims mirroring "arrives in the next update". |
| 2g | Watch the desktop log across any of the above. | `mirror.start acknowledged in <n>ms as "<state>"` appears with n well under 2000, followed by a `Phone mirror state:` line per phase. A start that is never acknowledged now logs a reason instead of nothing. |

The property these pin down: **`mirror.start` never blocks on a human.** It acks with a phase
inside 2 seconds and every later phase is a `mirror.state` event, so the canvas always has a
current sentence on it. Consent itself is bounded by the phone's own 30 second deadline rather
than by whatever timeout the Mac happens to use.

### Recorded run — 2026-08-25, Samsung SM-S938B (One UI, Android 16) + MacBook Pro

| # | Result | Evidence |
|---|--------|----------|
| 2 | **PASS** | `mirror.start acknowledged in 12ms as "requesting-consent"`, then `starting`, then `running`. Phone: consent granted 16:29:57.734 → `Mirror session started` 16:29:57.908, capture `1080x2340 @450dpi`, video socket open 36ms later. From tap to picture: **209ms**. |
| 2a | **PASS** | `mirror.start acknowledged in 17ms as "awaiting-foreground"` with the full sentence on the canvas. No 60 second wait. |
| 2b | **PASS** | Opening the app and tapping **Start mirroring** carried the same request through `requesting-consent` → `starting` → `running` at `1440x3120 cap 2160`. |
| 2f | **PASS** | Mirror tab with a Mac connected reads "Ready to mirror" with **Start mirroring** enabled. The "arrives in the next update" line is gone. |
| 2g | **PASS** | Both acks are two orders of magnitude inside the 2000ms budget, and every phase after them is its own `Phone mirror state:` line. |

### Recorded run — 2026-08-26, Samsung SM-S938B (One UI, Android 16) + MacBook Pro

Both sides on the build installed at 11:51:40 that day. The rotation work was confirmed present in
the *installed* artifact rather than assumed from the build directory: the APK was pulled back off
the device and `classes7.dex` checked for `swapEncoder`, `onDisplayGeometryChanged`,
`displayChangeFor`, the `mirror-display` thread name, and the `VirtualDisplay` `resize` /
`setSurface` / `registerDisplayListener` references.

| # | Result | Evidence |
|---|--------|----------|
| 3 | **PASS** | Canvas: "Screen capture was denied on the phone." with "Start mirroring again and tap Start now on the phone." beneath it; the HUD's Last error row read `PERMISSION_DENIED` with the same sentence. Immediate, no hang. Phone: `11:56:15.289 W [mirror] Screen capture consent denied` → `Mirror failed: consent-denied`. Mac: `06:26:15.281 W [video] Mirror failed on the phone: Screen capture was denied on the phone.` Reproduced twice (11:56:15 and 11:56:35). |
| 4 | **First attempt not a valid run; second attempt PASS against the rewritten step** | Attempt 1: consent was *granted* before the lock (`11:59:25.244 Screen capture consent granted`), so the prompt was never the thing dismissed — that run exercised step 12. Attempt 2 (`12:10:50.241` and `12:11:14.204`, both `mirror.start ... app is foreground`, nothing tapped on the prompt, power pressed): `Screen capture consent denied` → `PERMISSION_DENIED`, twice. That is now the documented expectation. |
| 12 | **PASS** (observed while attempting 4) | Locking a live session gave "Screen capture was stopped on the phone." on the canvas — a named reason, not a freeze on the last frame. Phone: `Projection stopped by the system or the user` → `Mirror stopped: screen capture was stopped on the phone`. Mac: `06:29:29.366 I [video] Phone mirror state: stopped`. The session had delivered 83 frames over ~3.9s beforehand. |
| 5 | **PASS** — after a fix; first attempt failed | Canvas: "The phone is locked, so it cannot start screen capture." with "Unlock the phone, then start mirroring again." beneath. Phone: `12:57:27.091 W [mirror] mirror.start … while the phone is locked` → `Mirror failed: phone-locked`. Mac: `07:27:27.104 mirror.start acknowledged in 28ms as "stopped"` then `07:27:27.107 W [video] Mirror failed on the phone: The phone is locked…` — 3ms apart. The first attempt reported the *backgrounded* sentence instead; see the ordering note below. |
| 2 (regression) | **PASS** | Re-checked on the fixed build because the lock check was inserted ahead of the foreground branch: `12:44:45.744 mirror.start …; app is foreground` → consent granted at +3.3s → `Mirror session started`, capture 2340x1080, video channel attached. The reorder did not disturb the foreground path. |
| 6 | **PARTIAL** — resume works, detection does not fire | Home restored frames immediately and unaided: counter went `475 frames · no frames arriving` → `598 frames · 30 fps`, picture correct. But no `SECURE_SURFACE` sentence ever appeared in the banking app after well over 10s, and the Mac log is **empty for the whole 110s session** (`07:36:59` started → `07:38:49` stopped). Cause unresolved — see below. Cosmetic: the caption is missing, the feature is not broken. |
| 11 | **PASS** | Total median 7ms capture-to-paint (peak 115ms), phone → Mac 4ms, Mac → painted 3ms — three real numbers, the halves summing to the total, two orders of magnitude inside the 150ms budget. 0 frames dropped on the phone, 2.1 Mbps, 60s of continuous Instagram scrolling with no visible lag. First frame 4079ms — **not a pipeline figure**, see below. |
| 10 | **PASS** | Two rotations, two encoder swaps, no session restart between them: `13:33:45.177 Encoder swapped (rotation to 270°): now 3120x1440` and `13:33:56.407 … now 1440x3120`, with no `Mirror session started` in between. Landscape filled the canvas, portrait returned correctly, and no consent prompt was raised by either turn. Run was at Native (1440x3120 cap 2160). Two separate defects were exposed by the same session — tests 15 and 16 below. |
| 7 | **PASS** — detected in well under 15s | `08:11:24.573 I [link] Disconnected: phone closed the connection`, then `Retrying in 1000ms`. Canvas named the reason and the state pill went to reconnecting with a 1s countdown. Detection was the socket close, **not** the heartbeat — see below. Second sighting of test 14: the frozen last frame sat under the message. |
| 9 | **PARTIAL** — Mac half passes, phone half does not | Mac: `08:16:19.438 Disconnected: user disconnected` → `08:16:19.442 Video socket closed: the control link dropped`, 4ms later, named reason, canvas correct. Phone: **the mirror session kept running for 36 seconds after the Mac left** — see test 17. Third sighting of test 14. **Re-run 2026-08-26 13:58 after the test 17 fix: PASS on both halves** — the phone now tears down inside 38ms. |
| 8 | **NOT RUNNABLE on this build** | Not a skip: there is no permission-gated capability to revoke. `mirror` is the only capability ever advertised, and `Capabilities.kt:113-115` adds it with **no permission gate at all** ("Mirroring needs no up-front permission: MediaProjection consent is asked per session"). Revoking Contacts changes nothing — `READ_CONTACTS` is not even granted, and `contacts` has no registered handlers so it is not advertised either. See below. |
| 17 | **PASS** — fixed and verified | Mac pressed Disconnect at `13:58:19`. Phone: `13:58:19.333 [mirror] Control session with Chetans-MacBook-Pro ended; stopping capture` → `13:58:19.368 Projection stopped by the system or the user` → `13:58:19.371 Mirror stopped: the Mac disconnected` — **38ms** end to end, ahead of `13:58:19.374 [control] Session … ended: peer closed the connection`. Zero `Encoded +N frames` lines after the stop; the session's four ticks sum to **28 frames**, matching the Mac's frozen counter exactly. `link.log` has written nothing since — verified at `14:04:10`, **5m 51s** of silence against the 1 minute the step asks for. Notification `id=3001` (`channel=mirror_capture`) is absent from the live `dumpsys notification` list, and `MirrorService` is absent from `dumpsys activity services` altogether — only `ConnectionService` (1001) and `LinkService` (2001) remain foreground, as they should. |

**Test 15 — changing the resolution restarts the session and costs a second consent tap.** The
design says otherwise in as many words (`main.ts`: "a resolution cap change rebuilds it. Either way
the phone keeps its MediaProjection, so raising the cap mid-session costs the user nothing — no
second consent tap"), and `MirrorEngine.reconfigure()` implements exactly that, logging
`Resolution cap X -> Y; rebuilding encoder`.

That path is never taken. `renderer/renderer.ts:180` calls `mirror.start({ maxResolution: … })`, not
`mirrorConfig`, so every resolution change arrives at the phone as a fresh `mirror.start`:

```
13:33:15.381 mirror.start while already running; restarting
13:33:15.406 Mirror stopped: restarted by the Mac
13:33:19.032 Mirroring started from the phone for Chetans-MacBook-Pro
13:33:22.246 Screen capture consent granted        ← the second tap
```

`mirrorConfig` exists on the bridge (`renderer.ts:38`) and nothing calls it for resolution, so
`reconfigure()`'s in-place rebuild is unreachable from the UI. Worse on Android 16: the teardown
leaves the app backgrounded, so the restart lands in `awaiting-foreground` and the user has to go to
the phone and tap Start before the consent prompt even appears.

**Test 16 — the return rotation announces a stale angle.** Coming back to portrait:

```
13:33:56.345 Display rotated to 270°: capture 1440x3120   ← 270 with portrait geometry
13:33:56.407 Encoder swapped (rotation to 270°): now 1440x3120
13:33:56.408 Display rotated to 0°: capture 1440x3120     ← corrected, 63ms later
```

`onDisplayGeometryChanged` read fresh metrics but a stale `rotationOf(displayManager)`, so the swap
was labelled with the outgoing angle. A second callback corrects it without a second swap, so the
frame count is right and only the reported angle is briefly wrong — cosmetic, and it self-heals in
63ms.

**Deferred with 13 and 14 on the day; fixed at the top of Phase 3, before any input code.** The
reasoning that made it cosmetic — nothing consumes the angle — stopped being true the moment
coordinates started being mapped against the geometry announced beside it.

The fix is not "read the rotation after the metrics". The two are read from one `Display` object
already, and re-ordering them would only move the race. What was missing is that the phone had no
way to *notice*: portrait metrics at 270° is an impossible pair, and nothing checked. It does now —
`readingIsConsistent` compares the reported angle against the reported shape, using the natural
orientation established when capture started, and `settledReading` re-reads for up to 150ms until
they agree. Two identical reads would not have been enough as a test: the bad state persisted for
63ms, so two reads inside it agree with each other and are both wrong.

#### Test 8 cannot be exercised until a second capability exists

The step assumes at least one advertised capability is permission-gated. On this build none is:

- `mirror` is the **only** capability that can ever be advertised, because it is the only one whose
  handlers are registered (`MirrorFeature` is the sole caller of `LinkServer.register`).
- `mirror` has **no permission half**. `Capabilities.kt:113-115` adds it unconditionally, correctly:
  MediaProjection consent is per-session, so there is no up-front grant to revoke.

So no revocation a user can perform in Settings can change the advertised set, and
`capabilities.changed` — the mechanism every Phase 4 feature depends on for live capability updates
— **has never travelled over a real socket.** It is covered by `CapabilityContractTest`,
`EmptyCapabilitiesTest` and `MirrorContractTest` at the unit level only.

The one hardware path that would exercise it is the implementation half rather than the permission
half: `MirrorFeature.uninstall` drops the handlers and the sink, which should take `mirror` off the
list and emit `capabilities.changed`. That was reachable only via `LEGACY_ADB_MIRROR`, which no
longer exists — the flag and the v1 path were deleted on 2026-08-26 (see the cleanup section). With
`mirror` now installed unconditionally, `uninstall` has no runtime trigger at all, so this half is
unreachable until a second feature gives `capabilities.changed` something to say.

**Test 8 becomes a Phase 3 entry test** — corrected on 2026-08-26, having first been assigned to
Phase 4 on the assumption that notifications would be the next revocable grant. Input is: it is
gated on the accessibility switch, which the user can flip in Settings with the Mac connected, and
that makes the step run exactly as written and a phase earlier. It is Phase 3 steps 21 and 22.

Recording this as "not runnable" rather than "untested" is the point — the step was written against
a design where capabilities are permission-derived, and the contract work replaced that. The step
outlived its assumption.

**Test 17 — the phone keeps capturing after the Mac disconnects.** This is the most serious thing
Phase 2 found, and it was invisible from either UI. When the control session ends the phone tears
down nothing:

```
13:46:19.429 [control] Session with Chetans-MacBook-Pro ended: peer closed the connection
13:46:20.454 [mirror]  Encoded +1 frames (0.5/s, +2334 B)      ← still encoding
13:46:22.694 [mirror]  Video socket closed by the Mac: Broken pipe
13:46:20…54 [control]  Dropped mirror.stats: the session is closing   ← every 2s, 18 times
13:46:55.236 [mirror]  mirror.start while already running; restarting  ← only now does it stop
```

For **36 seconds** the MediaProjection stayed live, the encoder kept consuming CPU and battery
encoding frames with nowhere to send them, and the stats ticker kept firing into a closed socket.
It ended only because the Mac reconnected and issued a new `mirror.start`. Had nobody reconnected,
it would have carried on indefinitely — capturing the user's screen with no consumer and no Mac.

The cause is a missing wire, not a broken one. `LinkServer.onSessionEnded` (`LinkServer.kt:297`)
updates link state and nothing else; `MirrorFeature.install` registers handlers and a video-channel
sink but no session-ended hook, so `MirrorEngine` never learns that `owner` is gone. Its `stop()` is
correct and complete — nothing calls it.

Fix shape: have `MirrorFeature` observe session end and call `MirrorEngine.stop()` when the ending
session is the one that owns the live capture. Note this is the same defect class the video socket
already handles correctly on the Mac side, which is why only one half of test 9 failed.

**Fixed and verified on hardware, 2026-08-26.** The wire was added where the fix shape said to put
it: `LinkServer.sessionEndedSink` (`LinkServer.kt:109`, fired from `onSessionEnded` at `:322`),
assigned by `MirrorFeature.install` (`MirrorFeature.kt:67`) and cleared on uninstall (`:123`), into
`MirrorEngine.onSessionEnded` (`MirrorEngine.kt:358`). It is scoped with `if (owner !== session)
return`, so an unrelated peer dropping cannot kill a live capture. It also calls
`MirrorService.stop()` after `stop()` — `stop()` releases the projection and the encoder but not the
foreground service that hosts them, and without that second call the recording notification outlives
the capture it announces.

The verification run, same log, 12 minutes after the failing one:

```
13:58:18.779 [mirror]  Encoded +1 frames (0.5/s, +1909 B)          ← last tick
13:58:19.333 [mirror]  Control session with … ended; stopping capture
13:58:19.368 [mirror]  Projection stopped by the system or the user
13:58:19.371 [mirror]  Mirror stopped: the Mac disconnected
13:58:19.374 [control] Session with … ended: peer closed the connection
                        ← end of file; nothing further at 14:04:10
```

38ms from session end to teardown, against 36 seconds before. Three things worth keeping:

- **The teardown now precedes the control-layer close line.** `[mirror]` finishes at `.371`, the
  `[control]` session-end line lands at `.374`. The feature hook runs inside session teardown rather
  than racing it.
- **The frame counters corroborate each other.** The four `Encoded` ticks of the session sum to 28;
  the Mac's canvas froze at "28 frames". Neither side lost or invented a frame at the boundary.
- **Absence was checked in the system, not just the log.** A quiet log only proves the logger is
  quiet. `dumpsys notification` shows `id=3001` / `channel=mirror_capture` gone from the live
  Notification List (it survives only in `Notification attention state` history and in
  `PackagePreferences` channel config), and `dumpsys activity services` shows no `MirrorService`
  record at all — the service is destroyed, not merely detached from the foreground. Those are
  system facts that hold whatever our logging does.

The old failure and the new pass sit in the same `link.log` and can be diffed directly: the failing
run at `13:46:19` has **17 `Encoded` ticks / 22 frames over 33 seconds** after its control session
ended, and **no** `stopping capture` or `Mirror stopped` line — it ended only when the Mac's
reconnect issued a fresh `mirror.start` at `13:46:55`. The bug's signature was the *absence* of
those two lines; the fix's signature is their presence.

#### Test 7 — 15 seconds is the worst case, not the normal one

Force stop kills the process, and the kernel closes its sockets cleanly on the way out. The Mac sees
the FIN and tears down immediately; the heartbeat never enters into it. The two paths are separate
in the code and produce different log lines, so a run can always be told apart afterwards:

- `link.ts:304` — the socket close handler, reason **"phone closed the connection"**. No warning
  line precedes it.
- `link.ts:453` — the heartbeat, which logs **`Heartbeat lost: no pong in 15s`** first and only then
  disconnects.

Test 7's log has the first with no `Heartbeat lost` line anywhere before it, so this was a clean FIN
detected in well under a second.

**So the ~15s figure in the step is the ceiling for a *silent* death** — the phone losing Wi-Fi, going
out of range, or wedging without closing its sockets — and not what a user experiences when an app
is force stopped or quits. Both paths end in a named reason on the canvas, which is what the test is
really asserting; only the latency differs, by more than an order of magnitude.

#### The frame-rate open question from test 11 is closed: it was the content

This session settles it. In portrait on Chrome before rotating, the encoder sustained **60.0, 59.5,
60.0, 60.5 fps**, with bursts to **108 and 115 fps** while scrolling — this panel runs at 120Hz and
the pipeline follows it. There is no cap in our encoder.

The **0 fps and 2 fps** read in landscape were equally real, not a rolling-window artifact: the
phone encoded **+1, +2, +0, +1, +0** frames across those ticks. A static Chrome page composites
nothing, so nothing is captured. Test 11's ~19.5 fps mid-fling was Instagram's own render rate, not
our ceiling.

#### Test 11 — first-frame is dominated by a human, and the frame rate is content-bound

**The 4079ms first frame is 94% consent tap.** `mirror.start` went on the wire at `07:50:35.865`
and consent was granted at `07:50:39.659` — **3794ms of somebody reaching for a phone**. The
pipeline after that is `starting` → `running` → socket → first painted frame in roughly **285ms**,
which is the same order as test 2's 209ms. The two numbers were never comparable: test 2 measured
tap-to-picture, this measures asked-to-picture.

Worth knowing rather than fixing today: the HUD's first-frame figure is taken from `requestedAt`,
the moment the phone was asked (`main.ts`), which is necessarily *before* the user has answered the
prompt. So it is a human-reaction-time measurement wearing a latency label, and it cannot be
compared against test 2, against a vendor number, or across two runs where the user tapped at
different speeds. Splitting it into consent time plus pipeline time would make it mean something.

**The frame rate is the content, not the encoder and not the Mac.** Over the busiest 60 seconds of
scrolling the phone encoded **836 frames — 14.4 fps** at 1.10 Mbps, against a configured 60fps
8Mbps. The Mac's HUD read 17 fps on its ~4s rolling window with **0 dropped on the phone**. A Mac
painting at or above what the phone encodes is a Mac that is not dropping anything. This closes the
loose end from test 6: an fps well below 60 is normal and expected, because a VirtualDisplay only
produces a frame when something is composited.

That said, 14 fps during *continuous* scrolling is lower than the content alone should explain, and
the encoder config is not obviously at fault (`KEY_FRAME_RATE` 60, `KEY_LATENCY` 1,
`VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR`). It cost nothing here — 7ms latency, no visible lag — so it is
recorded as an open question, not a defect.

#### The stats lines alternate, and it is real

Every other 2s tick reported ~1-3 frames and the one between it ~38-40, for 90 consecutive ticks.

This was first written up as an instrumentation artifact — plain `var` counters read across threads
without `@Volatile`. **That was wrong: `encodedFrames`, `encodedBytes`, `lastPtsUs` and `lastMonoUs`
were already `@Volatile`.** Only `lastKeyframeBytes`, added at the same time as this logging, was
missing it; it has it now. The alternation is not a measurement error.

What it matches is the shape of somebody scrolling: flick, read, flick, read. ~39 frames in the 2s
containing a fling, ~1 in the 2s spent looking at what landed. Sixty seconds of Instagram is exactly
that rhythm, and this phone's panel drops its refresh rate hard when nothing moves. The tick
interval was steady at ~2.004s throughout, so the windows themselves are not drifting.

That leaves the open question sharper rather than answered: during the *active* windows the encoder
managed ~19.5 fps, not 60. Whatever is capping it is capping it mid-fling, when the content
genuinely is changing every frame.

#### Test 6 — why the cause is still open, and what was added to close it

Two observations from the run point at different failures and cannot both be right: the status bar
kept rendering with the clock advancing (frames were arriving), while the HUD read "no frames
arriving" (they were not). A frozen scrollbar mid-screen — transient UI that only shows during a
scroll — fits the second reading.

Three candidates, all consistent with a detector that never fired:

1. **Live but partially black.** FLAG_SECURE is per-window and the status bar is a separate,
   non-secure system window, so Android composites it normally over a blacked-out app. Keyframes
   then carry real content and exceed the 2000-byte threshold, and the detector correctly declines.
2. **Stalled.** No new buffers, no encoder output, canvas frozen on the last decoded frame.
3. **Near-stall.** A blacked-out static app composites almost nothing, so the encoder nearly stops:
   the Mac's ~4s rolling fps window empties and says "no frames arriving" while the occasional
   frame still gets through and the clock still visibly ticks. Reconciles both observations.

**The detector cannot see cases 2 or 3 by construction.** `evaluateForSecureSurface` is called from
one place — inside the encoder's output-buffer path (`ScreenEncoder.kt:294`). No output, no call. Its
run-of-3-keyframes rule also assumes continuous encoding: at a 2s I-frame interval it needs 6
seconds of it, which is the assumption a near-stall breaks. And there is no stall watchdog anywhere
in `mirror-module` or `core`, while the Mac's "no frames arriving" is a HUD string
(`renderer/renderer.ts:218`), not a reported failure. **A stalled stream is silent on both sides.**

Nothing was changed in the detector, because choosing a threshold before knowing which of the three
happened is guessing. What was added is the missing instrumentation: `emitStats` now writes one line
per 2s tick while capture is live —

```
Encoded +117 frames (58.5/s, +241893 B) last keyframe 18422B
```

— which distinguishes all three on the next run, and settles whether an fps below the configured 60
is the encoder or the content. It resets its baseline on an encoder swap, so a rotation reports a
new baseline rather than a negative delta.

#### Test 5 first failed because the lock was checked too late, and what fixed it

`MirrorEngine.start` branched on `AppForeground.visibleActivity()` alone. A locked phone has no
visible Activity, so it took the `AWAITING_FOREGROUND` arm and was described as *backgrounded* —
and the keyguard check that would have caught it lives in `MirrorConsentActivity.onCreate`, on the
branch a locked phone never reaches. The fix reads the keyguard in `start()`, ahead of the
foreground branch, and acks before failing so the Mac's request cannot hang: the reason then
reaches the canvas as an ordinary mirror error, the same route consent-denied takes.

`isKeyguardLocked`, not `isDeviceLocked` — the latter is false for a swipe-only keyguard, which
would put those phones straight back on the misleading branch.

The two sentences are not interchangeable and that is the whole point of the fix: one tells you to
unlock the phone, the other tells you to open an app you cannot reach until you have.

#### Locking the phone cannot produce `ConsentDismissed`, and test 4 was wrong to expect it

Test 4 as originally written asserted that locking the phone while the consent prompt is up would
report `ConsentDismissed`. It reports `ConsentDenied`. The log says which code path ran, with no
ambiguity, because the two strings exist at exactly one place each in the source:

- `Screen capture consent denied` — `MirrorConsentActivity.kt:67`, the `else` branch of
  **`onActivityResult`**, i.e. a result came back and it was not `RESULT_OK`.
- `Screen capture prompt dismissed without an answer` — `MirrorConsentActivity.kt:77`, inside
  **`onDestroy`** guarded by `resultDelivered == false`.

Both power-button attempts logged the first and neither logged the second. **`onActivityResult`
received `RESULT_CANCELED`.** Locking the screen does not destroy the prompt out from under the
request; the platform *answers* the request, and the answer is indistinguishable from Cancel.

So the phone genuinely cannot tell "the user refused" from "the screen locked", and it should not
pretend to. `ConsentDenied` is the honest report of what it was told. The class comment on
`MirrorConsentActivity` claimed the opposite — it named screen-locking as the motivating case for
the split — and has been corrected, as has the `fixHint` on `ConsentDismissed`, which used to read
"keep the phone awake until the prompt appears" and pointed at the one cause that cannot produce it.

#### `ConsentDismissed` is not dead code — but its only real firing was a bug

It has fired exactly once in the whole log, on 2026-08-25 at 16:56:18.208, and reconstructing that
moment turned up a defect worth more than the test did:

```
16:56:17.683 I [mirror] Mirroring started from the phone for Chetans-MacBook-Pro
16:56:18.208 W [mirror] Screen capture prompt dismissed without an answer
16:56:18.208 W [mirror] Mirror failed: consent-dismissed — The screen capture prompt closed before it was answered.
16:56:20.330 W [mirror] Screen capture consent denied
16:56:20.335 I [mirror] Screen capture consent granted
16:56:23.987 I [mirror] mirror.start from Chetans-MacBook-Pro; app is foreground
16:56:27.455 I [mirror] Display 3120x1440 @600dpi -> capture 3120x1440 @600dpi (cap 2160)
```

`MirrorConsentActivity` had **no `android:configChanges`**, so rotating the phone with the prompt up
destroyed and recreated it. `onDestroy` ran with no result delivered, reported `ConsentDismissed`,
and — via `deliver` — consumed the single `pending` callback. The two results that arrived 2 seconds
later, a denied and a granted **5ms apart**, therefore had nowhere to go and were both discarded.
The user had to start over at `16:56:23.987`. That the session which finally succeeded captured at
`3120x1440` is the confirmation: the phone was in landscape by then, so a rotation is exactly what
happened.

Fixed by declaring `orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden|uiMode|density`
on the activity, which keeps the one instance alive across a turn. It is a transparent shim with no
layout, so there is nothing for it to re-lay-out anyway. **This mattered before test 10 could be
trusted**: rotation during consent was previously a spurious failure plus a dropped grant.

The remaining live route to `ConsentDismissed` is `MirrorConsentActivity.request` superseding a
pending callback when a second request arrives while one is outstanding — reachable by starting from
the Mac and then from the phone's Mirror tab, which is what step **4a** now covers. So the failure is
worth keeping; what was wrong was the story attached to it, not its existence.

#### "83 frames · 0 fps" — the counter was right, the pairing was not

Reading the HUD after that session showed `83 frames · 0 fps` and `0 painted · 0 received`, which
looks like broken fps arithmetic and is not. `framesDecoded` is **cumulative and survives the end of
a session**; `fps` and `received` are **live rates over a 3-second trailing window**. The session had
stopped, so the window had emptied and both rates were correctly zero next to a frame count that
correctly still read 83.

Correct, and still the wrong thing to show: a rate of zero is a measurement, and "frames are
arriving at zero per second" is not a state that exists. Both rate paths now return **null** rather
than zero when there is no recent traffic — `VideoClient.stats` in the main process and
`MirrorView.stats` in the renderer — and the HUD renders null as an em dash. The frames line reads
`83 frames · no frames arriving` instead of pairing a live zero with a stale total. Bitrate already
rendered `—` for this case, so it was the odd one out rather than the model.

Worth keeping in mind while reading any later run: **every rate on the HUD describes the last three
seconds, and every total describes the session.** A dash means "not measurable right now", never
"zero".

#### The latency split works, but that run is not test 11

The same session produced 16ms total, 13ms phone → Mac, 3ms Mac → painted, peak 25ms, 0 dropped, at
1080x2340. Internally consistent — the halves sum to the total — and enough to confirm the
instrumentation works end to end, which is genuinely useful to know before running the real thing.

It is **not** a test 11 result, and should not be quoted as one:

- **The session was ~3.9 seconds**, not the 60s the step calls for.
- **The phone's screen was near-static** (the Mirror tab). A VirtualDisplay only produces frames when
  content changes, which is why 83 frames over 3.9s is ~21fps and not 60. Latency measured on a
  static screen says nothing about latency under the load test 11 exists to apply — the step says
  "scroll a list, open an app" for that reason.
- **The clock anchor had barely arrived.** `mirror.stats` carries it every 2 seconds, so a 3.9s
  session saw one or two, and the offset had no time to average out its own round-trip asymmetry.

**Test 3 was run on the phone-initiated path, not the Mac-initiated one.** The phone logged
`Mirroring started from the phone for Chetans-MacBook-Pro` and there is no
`mirror.start acknowledged` line on the Mac for either attempt, so the session came from the Mirror
tab rather than from the Mac's Start mirroring button. The property the step exists to pin down
still held, and arguably held harder: with no outstanding `mirror.start` there is no reply to carry
the failure, so the reason reached the canvas purely as an `error` event. What that run did *not*
exercise is the ack-then-event correlation by `requestId` — which test 2d and the 2026-08-25 run of
test 2 already cover. Worth re-running from the Mac if the correlation path ever changes.

#### The defect that made the first retest look like a Mirror-tab bug

Tapping **Start mirroring** on the phone killed the process, four times out of four, with
`android.os.NetworkOnMainThreadException` — `MirrorEngine.publish` → `ControlSession.event` →
`Framing.writeFrame`, straight off a Compose click handler.

`ControlSession.send` wrote to the TLS socket **on whatever thread called it**. That was invisible
while every caller was a message handler running on `Dispatchers.IO`, and became fatal the moment
the phone got a UI that talks to the Mac. It was never specific to the Start button: the consent
result callback (`fail`, and the `starting` phase on the *success* path) also runs on the main
thread, so the crash sat in front of tests 3, 4 and 2e as well.

Fixed by giving each session a single-threaded sender: `send` encodes on the caller's thread and
queues the write, so it is safe from anywhere and still ordered. Two details that are part of the
fix rather than incidental to it — a closing session drains its queue for up to a second first, so
the paths that send an error frame and immediately throw still get the reason onto the wire; and a
write that fails only names the disconnect when nothing better has named it already, so
"service stopping" is not overwritten by "send failed: Socket closed".

The general rule this leaves behind: **`ControlSession.send` is callable from any thread, and
nothing else in `core/link` is.**

#### A separate failure found while the session was up, since fixed

Changing the resolution cap on a running session tears the session down:

```
Mirror failed on the phone: The phone's H.264 encoder would not start (virtual display: Don't
re-use the resultData to retrieve the same projection instance, and don't use a token that has
timed out. Don't take multiple captures by invoking MediaProjection#createVirtualDisplay multiple
times on the same instance.)
```

`MirrorEngine.reconfigure` rebuilt the encoder on a `maxResolution` change and deliberately kept
the `MediaProjection` across the rebuild, on the stated assumption that one projection "stays valid
for as many virtual displays as we care to create". **That assumption was false on Android 14+**:
one `MediaProjection` permits exactly one `createVirtualDisplay`. The comment saying otherwise was
actively misleading — it read as documentation of a guarantee that did not exist — and has been
replaced with what is true.

The wall is real, but the choice it appeared to force — ask for consent again on every resolution
change, or refuse mid-session resolution changes by name — was a false one. Neither was needed.
`VirtualDisplay.resize(w, h, dpi)` and `VirtualDisplay.setSurface(surface)` are both public API,
and neither calls back into the `MediaProjection`. So the session keeps its one virtual display for
its whole life and only the encoder behind it is replaced: build the new encoder, take its input
Surface, `resize`, `setSurface`, start it, request a sync frame, then stop the old one. The
one-display-per-projection rule is never approached and there is no second consent tap.

The same mechanism is what made test 10 (rotation) implementable, since a turn is a resize like any
other. The failure did behave correctly on the way out — it reached the Mac as a sentence and closed
the video socket — so it was only ever `mirror.config` that was broken, not the Phase 2 rule about
naming causes.

**What still needs a human.** MediaProjection consent cannot be granted from adb (CLAUDE.md
platform wall: every capture start needs a fresh tap on Android 14+), so every step that ends in
"Start now" — 2, 3, 4, 6, 10, 11, 2b, 2d, 2e — needs a person holding the phone. 10 and 11 need one
for a second reason as well: nobody can rotate a phone or scroll a list over adb in a way that
measures anything. What can be checked
without one: 2a, 2c and 2f reach their pass conditions with no tap at all, which is the point of
them; they are the paths that used to produce silence.


## Phase 2 close-out — 2026-08-26

Phase 2 is **closed.** Mirroring works end to end on hardware, the one High-severity defect (17) is
fixed and verified, and six defects — all Medium or below, none of them blocking — are carried
forward into Phase 3. Three steps were never run. This section is the handover; the tables above
are the evidence.

### Passing on hardware

2, 2a, 2b, 2f, 2g, 3, 4, 4a-as-rewritten, 5, 7, 10, 11, 12 — and 2 re-run as a regression after the
lock-ordering fix. The core is proven: consent on Android 16, capture, encode, transport, rotation
with in-place encoder swaps, latency of 7ms median capture-to-paint, and a named reason on every
failure path that was exercised.

### Deferred, each with a number and a known-fail entry

| # | What | Severity |
|---|---|---|
| 15 | Changing the resolution restarts the session and costs a second consent tap | Medium — contradicts the documented design; `reconfigure()` is unreachable from the UI |
| 13 | Consent timeout blames the user for ignoring a prompt that was never shown | Medium — same class as the test 5 bug, wrong sentence with confidence |
| 6 | `SECURE_SURFACE` never fires; cause is stall vs near-stall, now instrumented | Low — cosmetic, resume works |
| 14 | Frozen last frame readable under the overlay, unbounded staleness | Low — seen three times, contradicts the message on top of it |
| 19 | HUD's first-frame figure is human reaction time wearing a latency label | Low — misleading, not wrong |
| 18 | One unexplained idle drop on a quiet link | Unconfirmed — may be observation churn |

**16 left this table on 2026-08-26, at the top of Phase 3.** It was filed Low/cosmetic on the
grounds that nothing consumed the angle and it self-healed in 63ms. Phase 3 consumes it: a
coordinate mapped against a geometry announced with the wrong angle lands somewhere the user did
not click, silently. Promoted to a correctness dependency and fixed before any input code was
written — the phone now re-reads the display until the angle and the metrics agree, and every
coordinate additionally carries the geometry stamp it was computed against so that the residual
window is refused rather than delivered. See the Phase 3 section, "Test 24 has three guards".

**17 was fixed and verified on hardware before Phase 3 opened**, which is why it is no longer in
the table above. It was the one blocker, and it stayed a blocker under either reading of what came
next: the legacy-ADB deletion touches session ownership, and Phase 3's input injection binds a
second consumer to the same live session. A v2 session that outlives its owner is exactly the state
that makes both hard to reason about. It was also a privacy defect on its own terms. See the test 17
section above for the fix and the verification run.

13 and 15 are the next two, both being wrong-sentence-with-confidence defects of the kind Phase 2
kept producing.

### Untested, and why

| # | Step | Why it was skipped | Risk carried |
|---|---|---|---|
| 1 | Mac tab lists `mirror` | Time. The Mac logged `Phone advertises: mirror` on every one of the day's connections, which exercises the same contract from the other side | Low — the capability contract is also covered by `MirrorContractTest` |
| 4a | Start from the Mac, then from the phone, to reach `ConsentDismissed` | Time | Low — the only untested one of the eight `MirrorFailure` reasons |
| 8 | Revoke a grant while connected; the chip greys without a reconnect | Not runnable on the Phase 2 build — no advertised capability had a revocable permission | Medium — capability *changes* mid-session are untested on hardware, and `capabilities.changed` is the mechanism Phase 4 features will rely on. **Now Phase 3 steps 21 and 22.** |

**8 becomes runnable in Phase 3.** It was filed as "not runnable" because `mirror` is the only
advertised capability and it has no permission gate to revoke. `input` does: it is gated on the
AccessibilityService grant, which the user can toggle in Settings while connected — exactly the
shape the step was written for. Run it the moment `input` is advertised. Everything in Phase 4
depends on capability changes being observed live, and this is the cheapest place to prove it.

### Method notes worth keeping

- **Do not launch the app under test with `adb shell monkey`.** It injects a pseudo-random event
  alongside the launch. No recorded result was contaminated — the timeline was audited against every
  invocation — but `am start -n` injects nothing and costs the same.
- **Stage the phone's state and verify it immediately before the step, not before the session.**
  Test 5 was run twice against a phone that had been woken in between, producing two invalid runs
  before a valid one.
- **A result is what the log says, not what the canvas looked like.** Test 9 read as a clean pass
  from the UI and was hiding test 17; test 10 read as "no second consent prompt" and was hiding
  test 15.

## Cleanup — legacy ADB mirror removed, 2026-08-26

Not a phase. A tidy-up run immediately after the Phase 2 close-out, on the reasoning that
`LEGACY_ADB_MIRROR` had been default-off all along: every hardware result recorded above was already
the v2 path with the flag branch compiled but never executed, so deleting unused code could not move
a runtime acceptance result. No acceptance step was re-run, and none needed to be — the risk of this
change is build-level (manifest merge, resource and module wiring), not behavioural, so the
verification is a build, the unit suite, and the link coming up.

**Deleted.** Android: `mirror/adb/` (5 files, 722 lines), `mirror/session/` (`MirrorSession` 594,
`ControlMessage` 84), `mirror/ui/` (`MirrorRoute` 449, `MirrorViewModel` 172, `SetupWizard` 189,
`MirrorSurface` 85), tests `AdbMessageTest` and `SpsParsingTest`. The whole `:mirror-server` module
(821 lines of Java) and its `settings.gradle.kts` include, plus the `serverDex` configuration, the
`CopyServerDexTask` and the `androidComponents` asset wiring in `mirror-module/build.gradle.kts`.
The flag itself: the `buildConfigField` in `app/build.gradle.kts`, the branch in
`AppNavigation.kt`, `desktop/legacy/` (9 files), and `start:legacy` in `desktop/package.json`.
`desktop/entry.js` is now a direct `require`.

**Two tests were nearly swept up with the legacy code, and both are v2.** They lived in the
non-v2 test package purely by where they were first written:

- `MirrorContractTest` (20 tests) — imports `v2.*` throughout.
- `TransparentHelperNameTest` (1 test) — guards the string by which `AppForeground` names
  `MirrorConsentActivity`, because `:core` cannot depend on `:mirror-module`. If that string rots,
  the consent shim is recorded as the screen the user is on, the next request launches from an
  Activity that is already finishing, and Android 16 drops it as a background start — back to
  exactly the Phase 2a hang.

Both were moved to `mirror/v2/` and repackaged rather than deleted. **Package location is not
evidence of what a test covers**; read the imports. This is the same trap as test 9 reading like a
clean pass while hiding test 17.

### Verification

| Check | Result |
|---|---|
| `:app:assembleDebug` | **BUILD SUCCESSFUL** |
| Unit suite | **50 tests, 0 failures, 0 skipped** — mirror-module 21 (both moved tests ran under `…mirror.v2`), core 29 |
| `npm run build` / `tsc --noEmit` | Clean, no errors |
| Phone comes up | `Mirror feature installed; capabilities now: [mirror]` → TLS on 42501/2/3 → `Listening on 42501/42502/42503, 1 paired device(s)` → `Registered as ConnectSuite Samsung SM-S938B`. Trust store survived the reinstall. |
| Listener accepts TLS | `openssl s_client` to 42501: TLS 1.3, `TLS_AES_256_GCM_SHA384`, phone presents `CN=81744ed3-…`, matching `paired.deviceId` in the Mac's store. |
| Client auth still enforced | Same probe, no client cert → phone rejects with `PEER_DID_NOT_RETURN_A_CERTIFICATE`. `needClientAuth=true` intact. |

**Not covered:** the paired `hello`/`hello.ack` exchange. The Mac's private key is encrypted with
Electron `safeStorage` and cannot be used outside the app, and the Mac was not auto-reconnecting
because the previous disconnect was user-initiated — which is correct behaviour, not a fault. One
press of Connect closes this gap.

**Watch for on the next run:** `mirror-server` was an asset-producing module, so a stale
`build/` or `.gradle` cache can still hold its dex. A clean build is the check if anything looks odd.

## Phase 3 — input injection

Numbering continues from Phase 2. Written 2026-08-26 as the phase opened; none of these has been
run on hardware yet.

**Every step needs a person holding the phone.** Not for the reason Phase 2 did — there is no
consent prompt here — but because the grant this phase depends on is a switch in Settings that
cannot be flipped from adb without granting a service the ability to control the device, and
because "the tap landed where I clicked" is not a thing a log can assert.

| # | Step | Pass condition |
|---|------|----------------|
| 20 | With the accessibility service **off**, mirror the phone and click the canvas. | The canvas says the phone is not accepting taps, and names Settings > Accessibility > Installed apps > ConnectSuite Input. The six action buttons are disabled and the note under them says the same thing. **No silent no-op** — a dead click on a picture of a phone is indistinguishable from a phone that ignored you. |
| 21 | **Confirm the toggle landed first — expect `[input] Accessibility service connected`.** With the Mac connected, turn the service **on** in Settings. Do not reconnect. | The Mac's `input` chip goes live within a second or two. This is **deferred test 8, finally runnable** — see below. |
| 22 | **Confirm the toggle landed first — expect `[input] Accessibility service disconnected`.** Turn it **off** again, still connected. | The chip greys within a second or two, again without a reconnect. The other half of test 8. |
| 23 | Mirror at **1080p**, click a specific small target (a settings row, a keyboard key). Then switch Capture to **Native** and click the same target. | It lands on the target at both caps. Two caps rather than one because a single hardcoded ratio passes at whichever resolution it was written against; only two prove the scale chain. |
| 24 | While mirroring, rotate the phone and click the canvas **immediately**, inside the first second. | It lands where clicked, **or** the canvas says the click was worked out against a screen shape the phone has left and to click again. Never a tap somewhere else. This is defect 16's new consequence, and there are three guards behind it — see below. |
| 25 | Drag across the canvas: pull down the notification shade, or swipe between home screens. | One continuous stroke on the phone. The shade follows the pointer; it does not jump, and it is not a row of taps. |
| 26 | Click into a text field on the phone, then type on the Mac with the canvas focused. Include Backspace and Return. | Characters appear one at a time; Backspace removes the last one; Return performs the field's action. The documented semantics — append, via `ACTION_SET_TEXT` — are what actually happens. Autocorrect and the composing underline are absent, which is the platform limit, not a fault. |
| 27 | Press each of the six buttons: Back, Home, Recents, Notifications, Quick settings, Lock screen. | Each performs its action on the phone. There is no seventh button, and **there must never be a power one**. |
| 28 | While mirroring, open a banking app so the canvas goes black, then click on it. | The refusal is the *same sentence* the mirror already put on the canvas about blocked content — one wall, one explanation. Then press **Back** while the screen is still blanked: **it works**, because Back is how the user leaves the app that blanked it. |
| 29 | With the service enabled, read the Mac's Capabilities card. | `input` is lit. **`clipboard` is not.** Its permission half opens with the accessibility service and it has no handlers, so the two-gate contract must keep it un-advertised. A regression here means the contract has been bypassed. |
| 30 | With the canvas focused, press a key that cannot exist on a phone: volume up on a Mac keyboard, or an arrow key. | A sentence naming the wall — no app on Android can synthesise a key press — rather than nothing happening. Pressing it again says the same thing; it is never worth retrying and never claims it might work later. |
| 31 | Press and hold on the canvas for about a second over an app icon. | A long press on the phone: the icon's context menu opens. There is no separate long-press message — the gesture's duration is the user's own. |
| 32 | Scroll a long list with the trackpad. | The list scrolls, at a rate that feels like a finger rather than like a burst of taps. A fast two-finger flick produces continuous movement, not a stutter — wheel events are coalesced into one gesture per 60ms window on the Mac. |
| 33 | Lock the phone, then click the canvas. | "The phone is locked, so it will not accept taps or typing." Not a refused gesture, and not silence. |

### One defect found before the run, by reading rather than by tapping

Step 20 would have failed on the first attempt, and not for a trivial reason. Input refusals were
being written to `.mirror-overlay` — the same element that carries "the phone is locked" and
"screen capture was denied". That overlay is taken down by **any painted frame**, deliberately:
it is what makes a secure surface recoverable when the picture comes back. But an input refusal
happens *while frames are still flowing*, so at 60fps the message would have appeared for one
frame — about 16ms — and been wiped. The user clicks, nothing happens, and nothing says why.

That is precisely the silent no-op step 20 exists to catch, so the step was doing its job before it
was run. Fixed by giving input its own `.mirror-notice`, anchored to the bottom of the stage, on a
6-second timer and untouched by the frame path. The two messages are different kinds of thing —
"there is no video" versus "that action did not happen" — and sharing one element for both was the
mistake.

### Test 8 is runnable here, and 21/22 are it

Test 8 was deferred out of Phase 2 as **not runnable**, which was the honest verdict rather than
laziness: it needs an advertised capability whose permission can be revoked from Settings while
connected, and `mirror` — the only capability that could be advertised — has no permission half at
all. MediaProjection consent is per-session, so there is nothing to revoke.

`input` is exactly the shape the step was written for. Its permission half is the accessibility
grant: a switch in Settings, revocable at any moment, with the Mac still connected. Steps 21 and 22
are test 8's two halves against that switch, and running them is the **first time
`capabilities.changed` will have travelled over a real socket**. It is covered at the unit level by
`CapabilityContractTest`, `EmptyCapabilitiesTest`, `MirrorContractTest` and now `InputContractTest`,
and by nothing else.

That matters beyond this phase. Every Phase 4 feature is gated on a runtime grant the user can
withdraw — notification access, SMS, call log, contacts — and all of them rely on this one
mechanism to grey a pane out live. If it does not work, the failure surfaces as a Mac that offers
features the phone can no longer perform, which is precisely the class of bug the capability
contract exists to prevent.

The mechanism is `ConnectSuiteInputService.onServiceConnected` and `onUnbind` calling
`LinkServer.refreshCapabilities()`. `onUnbind` calls it twice, a second later as well, because
Settings can unbind the service before it writes the secure setting that `CapabilityDetector`
reads — and a single early call would leave `input` advertised over a service that is gone.

### Test 24 has three guards, and it is deliberate that there are three

A tap that lands in the wrong place is the worst thing this phase can do. It is silent: no error,
nothing on either screen, and the user simply sees the phone do something they did not ask for. So
the window between the phone turning and the Mac knowing it turned is covered three times over.

1. **The phone announces an angle and a geometry that agree.** This is defect 16's fix. The reading
   is re-taken until the rotation is consistent with the metrics, for up to 150ms — see
   `settledReading` in `MirrorEngine.kt` and `DisplayReadingTest`. Without it the phone spent 63ms
   telling the Mac something impossible.
2. **Every coordinate carries the stamp it was computed against, and a mismatch is refused.** Guard
   1 narrows the window; it cannot close it, because a message is already in flight when the phone
   turns. The stamp changes on any resize *and* on a 180° turn, which resizes nothing but reflects
   every coordinate. `ScreenGeometryRegistryTest` and `InputGeometryTest` pin both.
3. **The Mac refuses to send while its canvas is behind.** `mirror.rotate` arrives on the control
   channel *before* the new parameter sets arrive on the video channel, so for ~100ms the canvas
   still shows the old picture while the geometry it would map against is the new one. The ids
   would agree and guard 2 would pass. The renderer blocks clicks until it has painted a frame
   since the turn.

Guard 1 alone was the original plan and it is not enough. Guard 2 alone would fire constantly and
train the user to ignore it. The phase brief asked for one or the other; both are here because a
day of Phase 2 results kept showing clean-looking passes hiding real defects, and one guard on the
worst failure mode in the phase is thin.

### What can be checked without a person

| Check | How |
|---|---|
| The scale chain | `InputGeometryTest` — centre, origin, far corner, native capture, landscape, out-of-frame, and whole-path refusal |
| Stamp minting and rejection | `ScreenGeometryRegistryTest`, and the verify cases in `InputGeometryTest` |
| Defect 16's discriminator | `DisplayReadingTest`, using the exact reading the phone produced on 2026-08-26 |
| The capability contract, including clipboard staying off | `InputContractTest` |
| That there is no power action, and that refused keys explain themselves | `InputActionsTest` |
| That a gesture which completes is acked and not refused, and one that never answers still times out | `GestureDispatchTest` — defect 18's regression guard, and the only test that follows a *success* out to the value the Mac receives |
| The service is declared correctly | `:app:assembleDebug` — a missing `BIND_ACCESSIBILITY_SERVICE` or `accessibilityservice` meta-data fails the manifest merge |

None of that proves a tap lands where it was clicked. Only step 23 does, and only on hardware.

### Step 23 — run 2026-08-27, **PASS at both caps**

The first numbered Phase 3 step to run, and the one the whole phase was blocked on: until defect 18
was fixed every gesture came back refused, so "did it land on the target" had no observable answer.

Driven end to end through the real chain — a mouse event dispatched into the renderer, its
`pointerup` handler, `pointAt`'s canvas→frame transform, the geometry stamp, IPC to main,
`input.tap` over the control socket, and `dispatchGesture` on the phone. Nothing was injected
further down; `adb` was used only to set the phone's screen up and to read the result.

Target: the **"Sounds and vibration"** row of the Settings home list — display (573, 2655) of
1440×3120, with "Modes and Routines" 210px above it and "Notifications" 210px below, so a
one-row miss is unmistakable.

| Cap | Capture | Canvas CSS box | Click point on canvas | Phone opened | Phone log |
|---|---|---|---|---|---|
| 1080p | 1080×2340 | 227×492 | (90.36, 418.66) | **Sounds and vibration** | `Gesture landed in 77ms (71ms stroke, 571ms budget)` · `input.tap delivered — 1 delivered / 0 refused` |
| Native | 1440×3120 | 227×492 | (90.36, 418.66) | **Sounds and vibration** | `Gesture landed in 76ms (73ms stroke, 573ms budget)` · `input.tap delivered — 2 delivered / 0 refused` |

**Why the two caps are the point, concretely.** The CSS box is *identical* in both rows — 227×492
either way, because the aspect ratio did not change — while the frame behind it went from 1080 wide
to 1440. So the canvas→frame scale changed by a third and the click point did not. A ratio
hardcoded against whichever resolution it was written for would have passed one row and missed by
about a third of the screen on the other. Both landed on the same row.

Switching caps did **not** re-prompt for consent: `Mirror reconfigured: {"maxResolution":2160}` and
`Mirroring started: 1440x3120 cap 2160`, with no new MediaProjection dialog — the same in-place
encoder swap Phase 2's test 10 established for rotation.

Note the budget figures in the log — 571ms and 573ms — are the new `durationMs + 500`. Both
gestures used about 3ms of the 500ms grace.

**Still unrun:** steps 20–22 and 24–33. Step 23 was taken first because it is the one that gates
reading any of the others.

### Phase 3 step results — run 2026-08-27

Driven end to end through the real chain (renderer pointer/key handlers → `pointAt` → IPC → control
socket → `dispatchGesture`). `adb` was used only to set the phone's screen up, to read results, and
to operate the Settings switch — never to inject the input under test.

| # | Result | Evidence |
|---|--------|----------|
| 20 | **PASS** | Notice named `Settings > Accessibility > Installed apps > ConnectSuite Input`; all six action buttons disabled; the note under them said the same thing; phone untouched. Nothing was sent — the Mac gates on the un-advertised capability, so the phone never saw it. |
| 21 | **PASS** | `input` chip lit **109ms** after Allow, no reconnect (last connect 09:35:12, service bound 09:39:27). Flipped with the real Settings switch. |
| 29 | **PASS** | `input` lit, `clipboard` dark — its permission half is open but it has no handlers, and the two-gate contract holds. Every other capability grey. |
| 24 | **FAIL** → defect 19 | Never a tap in the wrong place, but a press straddling the turn produced neither a tap nor a sentence. Reproduced twice. Fixed. |
| 25 | **PASS** | Notification shade followed the pointer as **one** `input.swipe` (550ms stroke, landed in 553ms), not a row of taps. |
| 31 | **PASS** | Notion's context menu opened; arrived as a single `input.tap` of **1005ms** — no separate long-press message, the duration is the user's own. |
| 32 | **PASS** (after defect 21) | 20 wheel events over 627ms coalesced to **9** `input.scroll` messages; list scrolled **down** for a downward wheel, from the top of Settings to General management. First run failed: see defect 21. |
| 26 | **PASS** | Typed `soundxx` one character at a time, two Backspaces left `sound`, Enter ran the search → "Results (6)". Autocorrect and composing absent, as documented. |
| 27 | **PASS** | All six performed: Back (search results → search), Home (launcher), Recents (RecentsActivity), Notifications (shade, verified visually), Quick settings (panel, verified visually), Lock screen (`isKeyguardShowing` false → true). Exactly six buttons; **no power button** — asserted against the rendered markup, not just the eye. |
| 30 | **PASS on substance**, see defect 22 | `The phone cannot press "arrowup" — an accessibility service cannot synthesise key presses, and that is a platform limit rather than a missing feature.` Identical on the second press; never claims it might work later. Same for `audiovolumeup`. The sentence arrives wrapped in Electron IPC plumbing — defect 22. |
| 28 | **PARTIAL** → defect 23 | The refusal *is* the mirror's sentence — both come from `SecureSurfaceMessage`, verified live on a Knox `ConfirmLockPassword` screen. Back **worked** while blanked and left the app. But the mirror never put that sentence on the canvas at all: the canvas was solid black (0 of 2534 sampled pixels non-black) with `mirror-overlay` hidden throughout, and the blank-frame detector took **~60 seconds** to fire. |
| 33 | **NOT RUNNABLE as written** | Locking the phone stops MediaProjection before any input can be attempted. The canvas shows `Screen capture was stopped on the phone.` and the click that follows reaches a dead canvas. `InputFailure.PhoneLocked` is correct and unit-tested, but on this hardware the mirror dies first, so the sentence the step asks for is unreachable by this route. Recorded as an observation about the step, not a pass. |
| 22 | **PASS** | `input` chip greyed at **117ms**, phone logged `Capabilities now: mirror`, and the Mac's connect count was unchanged — no reconnect. |

**Test 8 is now closed in both directions**: 109ms to light, 117ms to grey, neither needing a
reconnect. That is the first time `capabilities.changed` has travelled over a real socket, and every
Phase 4 feature depends on the same mechanism.

**Deviation, stated plainly.** Step 21 flipped the real Settings switch. Step 22 wrote the same
secure setting directly, because the Switch node is `clickable="false"` (its parent row takes the
tap) and repeated blind tapping had already caused enough trouble for one day. The system binds and
unbinds the service identically either way, and step 21 had already exercised the switch itself.


### Defect 19 — a press that straddles a rotation is dropped in silence — **fixed 2026-08-27**

**Found by step 24.** Severity: Medium. Never a tap in the wrong place — the worst failure mode
held — but neither of the step's two allowed outcomes happened either.

Press the canvas, let the phone turn while the button is still down, release. `mirror.rotate`
arrives in between and nulls `this.drag` (`mirror.ts:293`), which is **right**: finishing that
stroke would send it through coordinates the user never dragged across. `onPointerUp` then hits
`if (!drag) return` and vanishes. No tap, no sentence, nothing on the canvas.

Reproduced twice: pointer down on the old shape, rotate, pointer up 600ms later → `input.tap
delivered` unchanged, notice `null`.

Guard 3 (`awaitingFreshFrame`) *does* speak, but it is cleared by the next painted frame, so at
60fps its window is about one frame and the path a user actually hits during a turn is this silent
one.

**Fixed** by making the cancellation say so — `cancelledByTurn` is set when a live drag is
discarded, and pointer-up shows "The phone turned while you were pressing, so that was not sent."
Two sibling silent returns went with it: `pointAt() == null` in `onPointerDown` and in `onWheel`
now each carry a sentence. `onPointerMove`'s silent return is left alone on purpose — dropping one
sample of a path is not a user-visible action, and the pointer-up still speaks.

### Defect 20 — queued input lands in whatever app is in front when it finally dispatches — **fixed 2026-08-27**

**Found the expensive way.** Severity: **High**, and it is the only defect in this phase that has
already had a consequence off the screen: during step 32 a queued gesture landed on the launcher
home screen, hit a one-touch contact-dial shortcut, and **placed a real call**, which then re-dialled
twice more as the rest of the queue drained. The call was ended and the input path cut at both ends.

It needs no test harness to happen. A user scrolls the mirror, a notification takes focus or the
phone switches app, and the gestures still queued behind the one in flight arrive at a screen nobody
aimed at. The coordinates are still perfectly *valid* for whatever is now in front — which is what
makes a late gesture dangerous rather than merely useless. Nothing else in the chain notices:
[GeometryStale](#) catches a coordinate aimed at a screen *shape* the phone has left, and there was
nothing at all for a coordinate aimed at an *app* it has left.

**Fixed in both halves, because each covers what the other cannot.**

1. **The phone drops it.** `InputFeature` captures the foreground package when a coordinate message
   arrives; `ConnectSuiteInputService.dispatch` re-reads it *inside* the gesture lock — the wait for
   the gesture ahead is exactly the window in which focus can change — and refuses with
   `InputFailure.ForegroundChanged`, naming both apps. The read is `rootInActiveWindow.packageName`,
   pulled on demand: `accessibilityEventTypes` stays empty, nothing is streamed to us, one field is
   compared and discarded. The rule is `foregroundGuard` in `GestureDispatch.kt`, and not knowing
   what is in front loses the guard rather than refusing the gesture — ignorance is never a reason
   to say no to input the user did make.
2. **The Mac does not send it.** `InputClient.STALE_MS = 400`: anything that has waited longer than
   that behind other input is thrown away with a sentence rather than dispatched. Chosen against the
   phone's measured dispatch times — 63ms a tap, 103ms a scroll, 203ms a swipe — so a normal burst of
   coalesced wheel events still gets through in order, and an order of magnitude under the 9s request
   timeout, because a gesture stops being *meaningful* long before a phone stops answering.

### Defect 21 — every scroll went the wrong way, and a test said it should — **fixed 2026-08-27**

**Found by step 32.** Severity: High for the feature — scrolling is one of the six things input does,
and it did the opposite of what was asked, every time.

`docs/protocol.md` says `dx`/`dy` are "the distance the **content** should move, so a downward wheel
gesture is a negative `dy`". One line further down the same section it said the phone turns that into
a stroke to `(x - dx, y - dy)`. Those two sentences contradict each other: a finger drags content
*with* it, so the finger's displacement **is** the content's, and the minus inverted every scroll.
`InputGeometry.scrollEnd` implemented the formula, not the sentence.

Proved on hardware rather than argued: with the Settings list **at the top**, a wheel **up** scrolled
it **down** — past Sounds and vibration into Display, Battery, Wallpaper, Security. And a wheel
*down* on the same list did nothing at all, twenty scrolls delivered, because it was trying to scroll
up past the top. Both observations only fit the inverted formula.

**What let it through is worth more than the bug.** The suite *did* have a direction test —
`a scroll moves the finger opposite to the content` — and it asserted the inversion. Its own comment
contradicted itself inside one sentence: "a finger travelling down; the end point is therefore above
the start". So this is not defect 18's blind spot, where nothing tested the path. It is the opposite
failure: something tested it and encoded the wrong model, and the wrong model was written in three
places (spec prose, spec formula, test name) of which two agreed with each other.

**Fixed** in `InputGeometry.scrollEnd` (`+` not `-`), in `docs/protocol.md`, and in the test, which
is now `a scroll moves the finger with the content, not against it` and carries the reason it
changed. Three more direction cases were added alongside it, including horizontal and clamping.

### Defect 22 — the phone's sentence arrives wrapped in Electron plumbing — **fixed 2026-08-27**

**Found by step 30.** Severity: Low, but it touches every refusal the user will ever read.

What the canvas shows:

```
Error invoking remote method 'input-key': Error: The phone cannot press "arrowup" — an
accessibility service cannot synthesise key presses, and that is a platform limit rather than a
missing feature.
```

`InputClient.send` throws `new Error(sentence)` in the main process, and `ipcRenderer.invoke`
re-wraps anything thrown across the bridge with `Error invoking remote method '<channel>': Error: `.
So the careful sentence the phone composed — the whole point of locked decision 6, and of
`input.ts`'s own comment that "the phone's own sentence … is what the user needs to read" — is
delivered with nine words of IPC internals in front of it.

Every phone-originated input refusal is affected: steps 24, 26, 28, 30 and 33 all show it. Step 20's
message is clean only because it is generated in the renderer and never crosses the bridge.

**Fixed** as described: nothing on the input path throws across the bridge any more. `InputClient`
resolves with `InputResult` — `{ ok: true }` or `{ ok: false, reason, fixHint, code }` — declared in
`desktop/src/shared/protocol.ts`, and `MirrorView.deliver` is the one place that turns a result into
something on the canvas. Stripping the prefix with a regex was considered and rejected: it works
today and breaks the first time Electron rewords the wrapper.

Three things fell out of it that are worth recording, because none was the headline:

- **A rejection now means something.** It can only be the IPC channel itself failing, which is a
  Mac-side plumbing fault, and `deliver` names it as one rather than letting it read like a
  sentence the phone composed.
- **The hint stopped being a clause.** `reason` and `fixHint` travel as separate fields and are
  rendered as two lines, so nothing joins them into a sentence the phone did not write. The related
  `…typing yet.On the phone: Settings > …` was the *element's* `textContent` running two block
  children together — how the acceptance harness reads the canvas, not how it looks on screen. Both
  overlay and notice now go through one `paint()` helper that separates them for a string read too.
- **The Mac was keeping half a tally.** `input.ts` logged every refusal and no delivery — the exact
  shape defect 18 hid in, on the other side of the link. It now carries
  `N delivered / M refused since launch` on both lines, matching `InputFeature.tally()` on the
  phone, and the Mac's own refusals (not connected, queue full) are counted and logged too rather
  than returning silently.

**Acceptance**: repeat step 30. The canvas must show the phone's sentence and nothing before it —
no `Error invoking remote method`, no `Error:`. Repeat step 20 and read the notice's `textContent`,
not just the pixels: the two sentences must be separated.

### Defect 23 — the secure-surface message is erased by the black frames it is explaining — **fixed 2026-08-27**

**Found by step 28.** Severity: Medium. This is defect 18's family — a wall with no words on it.

On a Knox `ConfirmLockPassword` screen the capture is fully blanked: keyframes collapse to 511 bytes
and the canvas is solid black (0 of 2534 sampled pixels above 12/255). The Mac's log carries the
right sentence. The canvas carries nothing — `mirror-overlay` stayed hidden the entire time.

The cause is one line doing two jobs. Every painted frame runs:

```ts
this.awaitingFreshFrame = false;
if (!this.overlay.hidden) this.clearOverlay();
```

and its comment explains why: clearing on any painted frame "makes SECURE_SURFACE recoverable on
this side… the sentence about blocked content has to come off the canvas the moment there are pixels
again". That reasoning is sound for every other overlay and exactly wrong for this one, because a
blanked secure surface *keeps producing frames* — black ones. So the message is wiped about 16ms
after it is set, by the very frames it describes. It is the same mistake the input refusals hit
before the run, which is why they were moved to `.mirror-notice`; the mirror's own message was left
on `.mirror-overlay`.

**Second, smaller problem in the same step**: detection took roughly **60 seconds**. FLAG_SECURE
gives no callback, so `BlackFrameDetector` infers it from `run = 3` consecutive keyframes under
2000 bytes — and keyframes are seconds apart. For a minute the user has a black rectangle and no
explanation at all, then gets one that is erased before they can read it.

**Fixed as a rule, not as three patches.** Defects 18, 19 and 23 in one phase were all the same
silent no-op, and 23 is the third time the *overlay-clearing rule itself* produced one. Patching the
secure-surface call site would have left the rule saying the wrong thing and waited for a fourth.

The old rule was one line in the decoder's output callback: **any painted frame takes the overlay
down.** It is a decision about what a reason means, made in the one place that cannot know what the
reason says. The new rule is that **every reason declares what would end it**, and one function
decides:

| `OverlayEnds` | Means | Ended by |
|---|---|---|
| `pixels` | there is no picture yet — starting, awaiting consent, waiting on the first frame | any painted frame |
| `content` | there *is* a picture and Android is refusing to let the Mac see it | real content only |
| `session` | this session is over — stopped, denied, decoder dead, link dropped | nothing; only a new `start()` |

`showReason` takes it, `overlayEndedBy(evidence)` applies it, and the frame path reports evidence
instead of making a decision. Two things follow that the old code got wrong in opposite directions:

- **A secure surface is no longer erased by its own black frames.** Its overlay is `content`, and
  black frames are only `pixels`.
- **`Mirroring stopped.` is no longer erasable by a frame still in flight.** That was the same
  latent bug, never observed, and it would have been the fourth.

Two independent things now count as `content`, deliberately, because a stuck overlay over a live
picture is the same silent failure with the sign flipped: the phone re-sending `mirror.state:
running` (now written into `docs/protocol.md` as a retraction, not a duplicate), and a keyframe on
the Mac too large to be blank. `main.ts` also passes `transient` down with `mirror-stopped` — it is
the only place that knows a `SECURE_SURFACE` leaves the session running, and the renderer had been
inferring it from the frame stream, which is precisely what cannot work here.

**The 60-second lag was the detector being starved by the thing it detects.** A blanked screen is
usually a *still* screen: Android draws nothing, the VirtualDisplay queues almost no buffers, the
encoder emits almost no output, and the three keyframes `BlackFrameDetector` needs took ~60s against
a configured interval of 2s. So `BlankProbe` asks for a sync frame when output collapses instead of
waiting for one — a run of blank-sized *delta* frames is not evidence (a still screen with content
looks identical) but it is a cheap cue to go and take the measurement that is. Cost is bounded on
the case where the probe is wasted: a probe that comes back large backs off for 5s, longer than the
configured keyframe interval, so a still screen costs strictly *fewer* keyframes than a moving one.

The numbers — 8 tiny frames, 700ms between probes, 5s backoff — are chosen against the measured 60
seconds and are **not tuned**. That is why the report line now carries `Secure surface after {lag}ms
of blank output … probes N → B blank, C content`: the lag it actually achieves, and the split that
says whether the probes are earning their keyframes. Pick the next numbers from that log, not from
this paragraph.

**Acceptance**: repeat step 28. On the Knox `ConfirmLockPassword` screen the sentence must appear
**and stay** while the canvas is black; leaving the app must take it down. Check the phone log for
the lag figure — it should read seconds, not tens of seconds. Then a case step 28 never covered:
leave the phone on a still screen with real content on it for a minute and confirm the log shows
probes resolving to `content` with no runaway keyframe requests.

### Defect 17 — the Mac holds one phone, and refuses the other one forever

**Found 2026-08-26 by switching phones, not by a step.** No numbered test covers this because
every test so far assumed one phone.

`desktop/src/main/store.ts` declares `paired: PairedPhone | null` — a single object. The Mac holds
exactly one phone, structurally. Two behaviours follow, and the second is the worse one.

**It does not evict, it refuses.** `link.ts:427` only writes the slot when it is empty
(`if (!store.get('paired'))`), and `link.ts:258-266` rejects any phone whose fingerprint does not
match the stored one, before the handshake. So a second phone cannot connect *at all* while the
first is paired. Scanning the QR on the new phone does not help: the phone learns to trust the
Mac, and the Mac still refuses the phone. The only route is **Forget**, which clears `paired` and
`lastAddress` together (`main.ts:466-467`), followed by a fresh scan. Switching back is the same
cycle again. There is no "switch phone".

**The refusal is a silent retry loop.** Discovery keeps finding the unpaired phone — over mDNS it
answers on the same network as the paired one — so the Mac connects, mismatches, and destroys the
socket mid-handshake, on the reconnect backoff, indefinitely. Observed on the S25 while the Mac
was paired to the Realme:

```
08-26 23:46:10.124 W [server] Refused 10.173.69.92 :: SSLHandshakeException: connection closed
08-26 23:46:42.181 W [server] Refused 10.173.69.92 :: …
08-26 23:47:16.238 W [server] Refused 10.173.69.92 :: …
08-26 23:47:50.333 W [server] Refused 10.173.69.92 :: …
08-26 23:48:24.378 W [server] Refused 10.173.69.92 :: …
```

Every ~34s, from 23:46 until the re-pair at 23:50:37. The phone logs it as
`SSLHandshakeException: connection closed`, because the Mac tears down the socket after reading
the certificate and the phone cannot tell "wrong phone" from a hostile client. So the phone
accumulates handshake failures that look like an attack and are actually the user's own Mac, and
the Mac's own reason string — "is not the paired phone (certificate mismatch)" — is written only
to the Mac's log, on a candidate that is not the one it settles on.

This violates decision 6. The condition is diagnosable on both ends and is reported as neither a
reason nor a prompt on either.

**Not fixed.** Three things would close it, in increasing order of cost:

1. Stop the retry loop. A fingerprint mismatch against a *known* phone is not a transient failure
   and must not be retried on the backoff — mark that address as the wrong phone for the session
   and say so once.
2. Say it out loud. The Mac knows the name of the phone it is refusing; "this is Samsung SM-S938B,
   not the paired Realme RMX3870 — Forget to switch" is one sentence and the whole of the fix from
   the user's side.
3. Make `paired` a list. The phone side already does this: `trusted_devices` is a Room table keyed
   by `deviceId` and `TrustStore` caches a *set* of fingerprints, so a phone happily trusts many
   Macs. The one-device limit is purely the desktop's, and it is a schema change plus a picker,
   not an architecture change. `LinkClient` holds a single socket (`link.ts:43`) and `main.ts:218`
   constructs one, so *connecting* to two at once is a larger job than *remembering* two.

Until then the workaround is a second instance with its own data dir — both the paired slot and
the Mac's TLS identity live under `app.getPath('userData')` (`store.ts`, `identity.ts:29`), and
there is no `requestSingleInstanceLock`, so the two do not collide:

```bash
cd desktop && npm start -- --user-data-dir=/tmp/connectsuite-s25
```

That second instance is a different Mac to both phones: its own identity, its own QR, its own
paired slot.

### Defect 18 — every successful gesture is reported as a timeout, because success *is* the timeout value

**Found 2026-08-27 by instrumenting `dispatch`, after 197 refusals in `link.log` with no matching
success line to divide them by.** Severity: **High.** It is the whole of the Phase 3 blocker —
steps 23 through 25, 31 and 32 cannot be read while it stands.

**Gestures were never broken.** They have worked from the first dispatch. What is broken is the
sentence the phone says about them.

`ConnectSuiteInputService.dispatch` reads:

```kotlin
withTimeoutOrNull(budget) {
    suspendCancellableCoroutine<InputFailure?> { ... }   // resumes with null on SUCCESS
} ?: InputFailure.GestureRefused("it did not finish within ${budget}ms")
```

The block's success type is `InputFailure?`, where `null` means *the gesture completed*.
`withTimeoutOrNull` also returns `null`, meaning *the block never finished*. The two nulls are the
same null, `withTimeoutOrNull` returns `T?` and cannot tell them apart, and the elvis on the end
converts every success into a refusal. There is no path through this function that can ack.
`input.tap`, `input.swipe` and `input.scroll` fail **100% of the time, structurally** — not
flakily, not under load, not on this phone.

The three real failure paths were fine the whole time, which is exactly why the log looked
consistent: `onCancelled`, the `!accepted` branch and the `catch` all resume with a **non-null**
`InputFailure`, so they survive the elvis untouched. Only success was destroyed.

#### What the probe showed

A `HandlerThread` arm and the existing `null` arm, alternating within one session, with the
ceiling raised to 15s so "late" and "never" were separable:

```
probe#1 start arm=null-handler duration=60ms caller=DefaultDispatcher-worker-3 mainLooperQueue=idle
probe#1 dispatchGesture returned true after 4ms
probe#1 onCompleted after 65ms arm=null-handler on=main
probe#1 TIMED OUT after 66ms arm=null-handler (no callback of either kind)

probe#2 start arm=bg-handler duration=60ms ...
probe#2 dispatchGesture returned true after 3ms
probe#2 onCompleted after 64ms arm=bg-handler on=cs-gesture-cb
probe#2 TIMED OUT after 65ms arm=bg-handler (no callback of either kind)
```

Five for five, both arms. The callback arrives, on the expected thread, and is then reported as a
timeout **one millisecond later** — against a 15,000ms ceiling. The word "TIMED OUT" in that line
is the probe's own mislabel, printed for the same reason the shipping code prints it: it is reading
`outcome == null` and cannot see which null it has.

End to end, with no Mac and nobody holding the phone: a probe tap at (718, 1743) on the Settings
list moved `topResumedActivity` to `com.android.settings/.SubSettings`. The tap landed. They have
all been landing.

#### The three hypotheses, and why the log had already ruled them out

- **The `null` handler is the bug.** No. The background-`Handler` arm behaves identically
  (`probe#2`). It could not have been the cause in any case: `onPerformGestureResult` is delivered
  on the service's main looper *first* and only then re-posted to the handler you pass, so a
  blocked main thread would swallow both arms and a healthy one delivers both. The handler
  argument changes which thread `onCompleted` *runs* on, never whether it arrives.
- **`onCompleted` fires late rather than never.** No. 61–65ms for a 60ms tap: duration plus about
  four milliseconds of overhead.
- **The gesture is never dispatched.** No. `dumpsys accessibility` reports `capabilities=33` =
  `CAN_PERFORM_GESTURES | CAN_RETRIEVE_WINDOW_CONTENT`, and `MotionEventInjector` is live on
  display 0. `dispatchGesture` returned `true` on all 197 logged gestures — the `!accepted` branch
  has never once fired.

#### The 2100ms budget was never a measurement

`GESTURE_GRACE_MS = 2_000` plus the gesture's own duration is what the refusal string interpolates,
so "it did not finish within 2100ms" is a **constant**, printed without anything having been timed.
The spread in the log — 2060, 2074, 2102, 2157, 2771 — is the spread of the Mac's held-pointer
durations, not of the phone's dispatch times. Nothing in Phase 3 has ever measured how long a
gesture takes.

Now it has: **61–65ms for a 60ms tap on an S25 Ultra, idle.** The grace is roughly thirty times
what the mechanism needs. A number set from measurement belongs here, taken under mirroring load
rather than idle, and 2000ms is not it.

#### The refusal count had no denominator, and that is why this took 197 gestures to find

`InputFeature.refuse` logs; `InputFeature.answer`'s success branch does not. A log that records
only failures cannot distinguish "input is completely broken" from "input mostly works", and this
defect is the case where those two look identical from the outside. **`answer` must log the
success path too** — one line per gesture with the elapsed time — independently of the fix above.

#### Fixed 2026-08-27

1. **Success is no longer representable as null.** `GestureDispatch.kt` introduces
   `GestureOutcome` — `Completed` or `Failed(InputFailure)` — and `awaitGestureResult`, which owns
   the `withTimeoutOrNull` call. The block's success type has no null inhabitant, so the helper's
   own `null` can now mean one thing and the type system enforces it. `dispatch` maps the outcome
   back to the `InputFailure?` the feature layer expects, at a point where the two meanings are
   still distinct.
2. **Successes are logged, at the same volume as failures.** `dispatch` writes
   `Gesture landed in 63ms (60ms stroke, 560ms budget)` on every completed gesture, and
   `InputFeature.answer`/`refuse` now carry a running tally — `412 delivered / 3 refused since
   start` — on *both* kinds of line, so either one answers "has any of this ever worked" on its
   own.
3. **`GESTURE_GRACE_MS` is 500ms, down from 2000ms, and is now a measurement.** See below.

#### The budget, measured

184 gestures on the S25 Ultra (Android 16) with mirroring running at 1080p60 and two 120Hz list
flings saturating the display underneath, across four stroke lengths:

| stroke | n | overhead median | p95 | max |
|---|---|---|---|---|
| 60ms | 57 | 3ms | 10ms | 13ms |
| 100ms | 81 | 4ms | 14ms | 20ms |
| 200ms | 32 | 8ms | 17ms | 20ms |
| 400ms | 11 | 14ms | 17ms | 17ms |
| **all** | **184** | **4ms** | **15ms** | **20ms** |

Zero failures in that run. Zero cancellations in the 197 real gestures logged before it. Idle, with
mirroring up and a quiet screen, 25 taps ran 61–64ms for a 60ms stroke — a 1–4ms overhead.

**500ms is 25× the measured maximum.** The headroom is not for the dispatch, which needs about
twenty milliseconds; it is for the *delivery*. The platform hands the result to the service's main
looper before anything else touches it, so a main-thread stall — a GC pause, a recomposition storm
— delays the callback however fast the gesture itself was. Half a second absorbs a stall that would
already be visible as jank and refuses past that.

Erring generous is deliberate and asymmetric. Too tight tells the user a tap failed when it landed,
which is this defect's exact class of lie and cost two days. Too loose only delays whatever is
queued behind a genuinely stuck gesture — and at the protocol's 5s maximum the total is 5.5s, still
inside the Mac's own 9s request timeout (`InputClient.TIMEOUT_MS`), so the two ends cannot end up
disagreeing about which of them gave up.


## What the unit suite cannot see

Written after defect 18, which passed **85 of 85 unit tests** while every gesture on hardware came
back to the Mac as a refusal. That is not a gap that more of the same tests would have closed, so
it is worth being precise about the shape of it.

**The suite tests values. It does not test seams.** Every test in this repo takes a function,
hands it an input, and checks the output: `InputGeometryTest` on coordinates, `InputActionsTest` on
the action lists, `CapabilityContractTest` on the advertised set, `DisplayReadingTest` on one
recorded display reading. All of them are correct and all of them still pass. Defect 18 lived in
none of those functions. It lived in the *join* between `withTimeoutOrNull`, which signals "no
answer" by returning null, and a success value that was itself null — two pieces that are each
right and that mean opposite things by the same token.

Three properties of that class of bug, each of which the suite is blind to by construction:

- **It is in the glue, not the parts.** No unit under test was wrong. The composition was.
- **It hides in a type, not in a branch.** Coverage tooling would have reported the line as
  covered — the elvis was *executed* on every gesture. It just executed for the wrong reason.
- **It only exists at the end of the chain.** The bug was in the value the Mac would be *sent*.
  Every test stopped one call short of that, at the value some helper returned.

So the rule this leaves behind: **for any path whose failure would be invisible, one test must
follow a success all the way to the value the other end receives.** Not the geometry, not the
enum, not the intermediate — the actual answer that goes on the wire. `GestureDispatchTest` is that
test for input: `a completed gesture becomes an ack, not an error` asserts on the `InputFailure?`
that `InputFeature.answer` would branch on, and its sibling `a gesture that never answers is
reported as a timeout` pins the other side so that a "fix" cannot simply make refusal unreachable.
Both were confirmed to fail against the defective code before the fix went in.

**Still not covered, and still needing a person:** whether a tap lands where it was clicked. The
suite can prove the phone answers honestly about a gesture. Only step 23 proves the coordinate was
right.


## Where to look when a step fails

- Phone: `adb shell run-as com.chetan.connectsuite.debug cat files/logs/link.log`, or the
  "Last disconnect" line on the Mac card. `LinkLog.init` now runs in `ConnectSuiteApp.onCreate`,
  so lines written at process start (including `Mirror feature installed`) reach this file rather
  than only logcat.
- A consent prompt that never appears: `adb logcat -b events | grep -i "Background activity"`.
  A line naming `MirrorConsentActivity` means the start was dropped by the system — check that the
  app had a visible Activity, because that is the only condition under which it is launched.
- Mac: `~/Library/Application Support/connectsuite-desktop/logs/connectsuite.log`, also shown in
  the app's Connection health panel.
- Every disconnect path sets a reason string; if a log line says just "closed", that path is
  missing its reason and should be fixed rather than guessed at.

---

# Phase 4 — notifications, SMS, calls, contacts, media remote

**Opened 2026-08-27.** Scope settled against three documents that disagreed with each other: it is
`CLAUDE.md`'s Phase 4 **plus contacts**, moved forward from Phase 5 because an SMS thread list and a
call log are columns of phone numbers without it. `docs/status.md`'s Phase column follows a
different numbering and is not the plan; see the staleness box at the top of that file.

## State: the phone is built, the Mac is not

Everything below runs on the phone today and **nothing on the Mac drives it yet** — `renderer.ts`
renders capability chips for all twelve names, and only `mirror` and `input` have a pane. So the
steps in this section are split into two halves, and only the first half is runnable now.

That split is deliberate rather than an accident of where the work stopped. `docs/protocol.md` is
the contract and had **no Phase 4 payloads in it at all** — five capabilities' worth of message
names in a list and not one section describing what they carry. Writing that first, then the phone,
then the Mac, is the order `CLAUDE.md` mandates ("Change it there first, then both sides"), and it
is the order that lets the phone half be tested against the spec rather than against the client
that happens to exist.

## What can be tested now, with no Mac client

These use the phone's own log (`link.log`) and the capability chips the existing Mac build already
renders. None of them needs a Phase 4 pane.

| # | Step | Expect |
|---|------|--------|
| 34 | Fresh install, no runtime permissions granted, connect a Mac. | All five Phase 4 chips grey. Phone log lists each with a reason: `permission not granted`, never `not built yet` — the handlers are registered from app start, which is what makes the difference between "turn this on" and "this build cannot". |
| 35 | **Confirm the toggle landed first** (see the preamble). Grant notification access in Settings while connected. | `notifications` **and** `remote` light together, with no reconnect. Two capabilities, one grant — that is the whole reason the media remote is in this phase. |
| 36 | **Confirm the toggle landed first.** Revoke notification access while connected. | Both grey again, live. Log shows `Notification listener detached`. |
| 37 | Grant Contacts only. | `contacts` lights. `sms` and `calls` stay grey — they need their own grants and do not borrow this one. |
| 38 | Grant SMS (all three permissions arrive as one group). | `sms` lights. Before 2026-08-27 this was impossible: `SEND_SMS` was declared in no manifest in the repo, so the capability could never be true no matter what the user tapped. |
| 39 | Grant Phone + Call logs. | `calls` lights **only** when all four of `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE`, `ANSWER_PHONE_CALLS` are granted. Granting only the two read permissions must leave it grey — a green chip with `call.dial` unable to work is the failure this gate exists for. |
| 40 | On a device with no SIM, grant everything. | `sms` and `calls` chips follow the permissions, but a `sms.send` or `call.dial` returns `NO_TELEPHONY` with a sentence that does **not** send the user to a permissions screen they have already granted. |
| 41 | With notification access on, post a notification, then connect a Mac. | The phone log shows `Replayed N active notifications`, with N matching the shade. A replay of zero on a full shade is the bug this line exists to expose. |

## Notifications — runnable now (Mac pane landed 2026-08-27)

**Before any of these: install the new APK.** The phone build that was on the device during
development advertises only `input, mirror`; the Phase 4 features are in the debug APK built from
this tree. A Mac connected to the old build correctly shows no Notifications card at all, which is
step 42's control case rather than a bug.

`./gradlew assembleDebug` then install `app/build/outputs/apk/debug/app-debug.apk`. On the Mac,
`npm start` in `desktop/`.

| # | Step | Expect |
|---|------|--------|
| 42 | **Confirm the switch is really off first.** Connect with notification access **off**. | No Notifications card on the Mac at all — hidden, not greyed. The capability chip is grey and says which permission is missing, by name. An empty list and an ungranted permission look identical, so the card is absent rather than empty. |
| 43 | **Confirm the toggle landed first — no `Notification listener attached` line means the wrong screen; see the preamble.** Grant notification access in Settings while connected. | Card appears within a second, no reconnect. `notifications` **and** `remote` chips light together — one grant, two capabilities. **PASS by adb 2026-08-28** (16ms end to end, both directions); the by-hand half is unresolved after five attempts and is a One UI question, not ours — see below. |
| 44 | Post several notifications on the phone, then connect a Mac that was not running. | Every one already on the shade appears immediately — the replay-on-connect contract. Phone log: `Replayed N active notifications`, N matching the shade. A replay of zero on a full shade is the bug that line exists to expose. |
| 45 | Read the note under the heading. | `N showing, M of them can be replied to from here.` Both numbers — a count of notifications with no count of replyable ones says nothing about whether reply works. |
| 46 | Reply to a notification from an app that offers inline reply (Slack, Messages). | Reply appears in the app exactly as one typed on the phone would — it goes through the app's own `RemoteInput` and `PendingIntent`, not a simulation. |
| 47 | Look at a notification from an app with no inline reply (most apps). | **No Reply button drawn at all.** `canReply` is false on the wire and the pane honours it. Showing a reply box that always fails is the most common way a companion app lies about notifications. |
| 48 | Press Send on an empty reply box. | Refused on the Mac with "An empty reply was not sent.", and nothing crosses the link. An empty message appears in someone else's conversation and cannot be taken back. |
| 49 | An app whose action button is secretly a reply field. | That action is **not drawn as a button** (`isReply` filters it out); the Reply button is how it is reached. If one is forced through, the phone answers `NO_REPLY_ACTION` rather than sending an empty message. |
| 50 | Dismiss a notification from the Mac. | Gone from the Mac immediately and gone from the phone's shade. |
| 51 | Take a notification off the phone (`cmd notification snooze`), with `stallRemoved` on so the Mac's row goes stale, then act on that row. | **Dismiss succeeds silently** — `onDismiss` is deliberately not gated on `find(key)`, because dismissing something already gone is the outcome the user asked for. **Reply and action return `NOT_FOUND`** with a sentence, since those go through `ready()`. Either way the pane **never greys out** — `NOT_FOUND` means "refresh", not "this feature is broken". Rewritten 2026-08-28: the original expected a refusal on Dismiss, which would have recorded correct behaviour as a failure. |
| 52 | Start typing a reply, and let another notification arrive from the same app. | The draft survives the re-render. Drafts are keyed by notification, not held on the DOM element, precisely because the list rebuilds on every event. |
| 53 | Pull the Wi-Fi, or quit the phone app. | The list empties and the card hides. A notification set that outlives its connection is a set of things that may already have been dealt with — clicking one would produce `NOT_FOUND`, and a list you cannot trust is one people stop reading. |
| 54 | A media-player or navigation notification. | Shown, dimmed. The phone deliberately does not filter these — a phone deciding what the user may see on their own Mac has stopped being a mirror — so the Mac de-emphasises instead of hiding. |

## What still needs a Mac pane, and is therefore not yet runnable

Recorded now so they are not re-derived later. Each names the contract clause it is checking.

| # | Step | Expect |
|---|------|--------|
| 55 | Open a thread with 500+ messages and scroll back. | Pages of ≤200, `hasMore` true until the end. No 16 MiB frame, ever. |
| 56 | Open a thread containing an MMS with a photo. | Text parts shown as the body, and the Mac **shows that an attachment exists** rather than presenting the text as the whole message. `hasAttachments` true. Attachments are not delivered — that is Phase 5's bulk channel. |
| 57 | Read an MMS thread with `before` paging. | Correct page boundaries. `mms.date` is epoch **seconds** and `sms.date` is milliseconds; getting this wrong returns the whole thread while looking like it worked. |
| 58 | Send an SMS from the Mac, including one over 160 characters. | One message sent, one message reported. Long body split by `divideMessage`, not failed at the radio. |
| 58a | **The send rule.** Open thread A, then force a send carrying thread A's id and thread B's number. | Refused with `RECIPIENT_MISMATCH`, naming both numbers, and **nothing sent to anyone**. This is the only step in the suite guarding an outcome that cannot be undone: a message delivered to the wrong person is visible to somebody who was never meant to see it. The phone log carries an `e:` line, not a `w:` — every other refusal is a feature declining, this one is a prevented harm. |
| 58b | Send to a thread whose recipients the provider cannot read (an MMS-only conversation). | Refused, not sent. "We could not check" must never resolve to "send it anyway". |
| 58c | Send to a contact stored as `+1 555-123-4567` from a thread that records `5551234567`. | **Sends.** The rule must not be so strict that ordinary formatting makes the feature unusable — a false mismatch costs a retry, and one that happens every time costs the feature. |
| 59 | Receive an SMS while connected. | `sms.received` arrives with the contact's name when contacts is granted, and with the bare number when it is not — never blank. |
| 60 | Ring the phone, then reject from the Mac. | `call.incoming` on the Mac; reject ends it; `call.ended` with disposition `rejected`. |
| 61 | Let the Mac's incoming-call card go stale (call ends), then click Reject on it. | Refused with `NO_ACTIVE_CALL` and the "already finished" sentence. **It must not reject the next call that comes in** — silently retargeting an action to a different person is the call-feature equivalent of a tap landing in the wrong app. |
| 62 | Answer a call from the Mac. | Call answers **on the phone**, and the Mac says so. There is no audio path and there never will be — `CAPTURE_AUDIO_OUTPUT` is system-only. See `docs/permissions.md`. |
| 63 | Dial from the Mac. | Mac confirms before sending. The call is placed immediately; there is no dialler screen to cancel on, because nobody is holding the phone. |
| 64 | Play music, then use the Mac's transport controls. | State card follows within a second. Progress bar runs between updates from the `positionMs`/`positionAtMs` pair rather than freezing. |
| 65 | Press Next in an app that does not allow it. | Refused by name — `FEATURE_UNAVAILABLE` saying that app does not allow it — rather than silently doing nothing. A remote that does nothing is the failure this project keeps ruling out. |
| 66 | Stop all playback, then press play on the Mac. | `NO_MEDIA_SESSION`, and an empty remote card rather than an error state. Nothing playing is a normal condition, not a failure. |

## Automated coverage that landed with the phone half

- `ProtocolNamespaceTest` (`:core`) — every message type maps to a real capability, exhaustively
  over `MessageType`. It found two mismatches (`clip`/`clipboard`, `fs`/`files`) that had been
  missed when the mapping was written by eye, which is the argument for it being exhaustive rather
  than a list of remembered cases.
- `Phase4ContractTest` (`:sync-module`) — each feature registers exactly what its capability
  contract requires, every handled type reports its own capability as the failing feature, the five
  together make every Phase 4 capability advertisable, none needs an unserved side channel, and
  every failure sentence is a distinct sentence rather than a code.

## Step 42 run — 2026-08-27 23:22, and what it exposed

Ran after the capability running-gate (`Capabilities.kt`) and the log timezone fix landed, with
both sides rebuilt and the APK reinstalled first. The three earlier attempts were read against
pre-fix binaries, which is why they were unreadable rather than failing.

| Half of the expectation | Result |
|---|---|
| Capabilities on the wire | **PASS.** `2026-08-27T23:22:30.576+05:30 I [link] Phone advertises: input, mirror` — no `notifications`, no `remote`. Phone, 129ms earlier: `[notif] No replay for Chetans-MacBook-Pro: notification access is off`. |
| Card absent, not empty | **PASS by construction.** `renderer.ts` calls `notifications.setAdvertised(false)` and `NotificationsView` hides the card outright. |
| Chip names the missing permission | **FAIL — defect 24.** |

### The timezone fix is what made this run readable

Both logs now write ISO-8601 local time with an explicit offset, from `core/.../link/LinkLog.kt`
and `desktop/src/main/logger.ts`. Before this the Mac wrote UTC with a `Z` and the phone wrote bare
local time with no zone at all, so comparing one line from each needed arithmetic — and three
consecutive step 42 attempts were judged against a Mac line that turned out to predate the fix
under test. The two logs now read straight across:

```
2026-08-27T23:22:30.447+05:30  phone  [control] Handshake complete with Chetans-MacBook-Pro
2026-08-27T23:22:30.576+05:30  Mac    [link]    Phone advertises: input, mirror
```

`LinkLog`'s `SimpleDateFormat` was also shared across the control, video and bulk socket threads
and formatted on the *calling* thread. `SimpleDateFormat` is not thread safe, so concurrent
formatting corrupts the one field the two logs are lined up on. The event time is now captured as a
`Date` at the call site and formatted on the single `link-log` writer thread.

### The accessibility service rebinds itself after a reinstall; the notification listener does not

`Capabilities.kt` claimed both Settings-toggle components stay down after a reinstall until the
user toggles them by hand. That holds for the `NotificationListenerService` — `dumpsys activity
services` showed `app=null` on its ServiceRecord while `enabled_notification_listeners` still named
it — and does **not** hold for the `AccessibilityService`.

Two consecutive `:app:installDebug` runs on SM-S938B (One UI, Android 16):

| Install | Process start | `Accessibility service connected` | Capabilities after |
|---|---|---|---|
| 1 | 23:13:15.282 | 23:13:15.311 (+29ms) | `input,mirror` |
| 2 | 23:19:02.883 | 23:19:02.923 (+40ms) | `input,mirror` |

No user action either time. The running-gate stays correct for both components because it *asks*
the owning module through `requireRunning` rather than assuming — but the comment was wrong in the
expensive direction, pointing a user at a switch that had already rebound. Narrowed 2026-08-27.

Kept here because it is not derivable from the code: what the gate does and what the platform does
are different facts, and only the first one is in the repo.

### Defect 24 — the capability chip explains nothing, and a comment says it does — **fixed 2026-08-28**

**Found by step 42.** Severity: Low on its own, but it invalidates half of step 42's expectation,
and the same gap covers steps 34 and 37-39.

Step 42 expects the grey chip to say which permission is missing, by name. It cannot. The chip is
built in `desktop/src/renderer/renderer.ts`:

```ts
chip.className = `cap${on ? ' on' : ''}`;
chip.textContent = capability;
```

The text is the bare capability name — `notifications` — and nothing else. The sentence that names
the missing permission is `CapabilityStatus.reason`, computed on the phone, and it reaches the
phone's `link.log` and its diagnostics screen only. It is **never put on the wire**: `hello.ack`
and `capabilities.changed` both carry `capabilities` as a bare `string[]`, so the Mac knows the
names of what is on and has no reason for anything that is off.

The part that hides this is a comment in the same file, two lines above the notifications pane:

> the pane exists only where the phone has promised the feature. Unlike the mirror it is hidden
> outright rather than greyed, because an empty list and an ungranted permission look identical and
> **the capability chip already explains the second one**.

The chip does not explain it. The decision to hide the card is right; the stated justification for
it is false. That is the shape that survives review, because the conclusion reads as supported.

Note this is *not* fixed by the permission relabelling done the same day
(`missing NOTIFICATION_LISTENER` → `missing Notification access`). That improved the string on the
phone; the defect is that the string never crosses the link.

**Fixed 2026-08-28**, with defect 26, since both rewrite the same five lines.

The protocol change came first, as the rules require: `hello.ack` and `capabilities.changed` now
carry `unavailable: [{name, reason}]` beside `capabilities` — see `docs/protocol.md`,
"`unavailable` — the other half of the list". The field is optional on the wire, so an older phone
still handshakes and the Mac simply shows a name with no reason.

- **Phone** — `ControlSession.unavailableJson()` filters `capabilities.diagnostics()` to the ones
  that are not `advertised` and emits each with its existing `CapabilityStatus.reason`. Nothing new
  is computed; the sentence was always there and stopped at the phone's edge.
- **Mac** — `link.ts` keeps `unavailable` beside `capabilities`, clears **both** in `teardown()`
  (defect 25's discipline, applied to the new field as it was added rather than after it bites),
  and logs both halves on one line.
- **Renderer** — the reason is rendered into the chip, which is defect 26's fix.

Verified on hardware at 10:32 after installing the new build. The Mac's own chips now read:

```
mirror: available
input: unavailable, missing Accessibility
notifications: available
sms: unavailable, missing SMS
calls: unavailable, missing Call logs, Phone
files: unavailable, not built yet — waiting on fs.delete, fs.list, …, bulk channel unserved
photos: unavailable, not built yet, and missing Photos
```

The false comment above the notifications pane is now true: the chip does explain it.

### Defect 26 — a capability chip's state is a colour and nothing else — **fixed 2026-08-28**

**Found by the step 53 re-run.** Severity: Low as a bug, but it is an accessibility defect in
shipped UI, not only a testing inconvenience. Sibling of defect 24 — same chip, different half:
24 is that a grey chip does not say *why*, 26 is that nothing but a sighted look says *whether*.

`renderer.ts:141-145` builds each chip as an inline `<span>` carrying the capability name as its
only text, with on/off expressed as a class the stylesheet colours:

```ts
chip.className = `cap${on ? ' on' : ''}`;
chip.textContent = capability;
```

Chromium collapses an inline span with a text child into a single `AXStaticText`, and the class
list does not survive that collapse — it does survive on the block elements around it
(`class=card`, `class=notif-title`, `class=pillconnected`), which is what makes the gap easy to
miss. Confirmed by dumping the tree in both states: the `id=caps` block is byte-identical with
three capabilities lit and with none.

Two consequences, and the first is the one that matters:

- **A screen reader announces `mirror, input, notifications, sms, …` and stops.** Every capability
  sounds available. The pane whose entire job is "what the phone can do right now" conveys none of
  that without colour vision, and the colours are green-on-grey.
- Any assertion about chip state has to come from the DOM instead of the accessibility tree, which
  is why the step 53 re-run needed a DevTools port for one of its seven probes.

**Fixed 2026-08-28**, with defect 24, in the same five lines.

Each chip now appends a `.visually-hidden` span carrying the state and — once defect 24 put it on
the wire — the phone's reason: `mirror: available`, `input: unavailable, missing Accessibility`.
Hidden text rather than `aria-label` because an `aria-label` on a generic inline element is not
reliably announced; hidden text is ordinary content and always is. The CSS uses the clip-rect
idiom, **not** `display: none` or `visibility: hidden` — both of those remove the node from the
accessibility tree, which is the exact failure being fixed. Unavailable chips also get a `title`
so a mouse user sees the same sentence, which is a supplement and not the mechanism.

Verified through the tree it was invisible to. The `id=caps` block, which used to be byte-identical
in both states, now reads:

```
AXStaticText | name=mirror                              | value=mirror
AXStaticText | name=: available                         | value=: available
AXStaticText | name=input                               | value=input
AXStaticText | name=: unavailable, missing Accessibility | value=: unavailable, missing Accessibility
```

Colour is no longer carrying the meaning alone.

### Step 43 — run 2026-08-27 23:32, **PASS (granted via adb, not by hand)**

Granted notification access while the link was live, by writing the same secure setting Settings
writes (`cmd notification allow_listener …/NotificationMirrorService`) rather than by tapping. The
setting is the thing both the `ContentObserver` and the listener bind off, so this exercises the
same path; tapping it by hand remains the stricter UI check.

| Time | Side | Line |
|---|---|---|
| 23:32:12.3 | — | grant written |
| 23:32:12.492 | phone | `[notif] Notification listener attached to the link` |
| 23:32:12.731 | phone | `[caps] A Settings toggle changed; re-checking capabilities` |
| 23:32:12.736 | phone | `[caps] Capabilities now: input,mirror,notifications,remote` |
| 23:32:12.865 | Mac | `[link] Capabilities changed: input, mirror, notifications, remote` |

- **Both capabilities lit together** — `notifications` and `remote` from the one grant, which is
  the reason the media remote sits in this phase.
- **No reconnect.** Zero `Connected to` / handshake / retry / disconnect lines on the Mac between
  the 23:22:30 connect and the change. The update rode the existing session.
- **565ms end to end**, against an expectation of "within a second".
- The `ContentObserver` belt is what fired first (`A Settings toggle changed`), which is the signal
  that had no backstop before it was moved out of `InputOnboardingCard`.

Notifications then flowed immediately, with the denominator the log rule asks for:

```
23:32:24.716 I [notif] posted com.techmash.playo — 1 showing, 1 posted / 0 removed since launch
23:32:32.570 I [notif] removed — 1 showing, 3 posted / 1 removed since launch
```

**Card confirmed present** by screenshot of the Mac window at 23:37, with the note reading
`1 showing, 0 of them can be replied to from here` — both numbers, which is step 45's contract.

**Caveat on method, and it is the reason this is not a full sign-off.** The grant was written with
`cmd notification allow_listener`, not by tapping Settings. That exercises the secure setting, the
`ContentObserver` and the bind, which is everything downstream of the tap — but not One UI's own
permission screen, which is where an OEM-specific confirmation step would show up if there is one.
Step 43 should be repeated by hand once before Phase 4 closes.

Not covered: the capability chips themselves, which sit above the window's scroll position. Whether
`notifications` and `remote` are lit is established by the `capabilities.changed` line, not by
having been seen.

### Step 44 — run 2026-08-27 23:42, **PASS on the replay contract**

Method, all by adb with the Mac process killed first, so this is a genuine "Mac that was not
running" rather than a reconnect:

1. `pkill` the Electron app; phone logged `Session … ended: peer closed the connection` at 23:38:51.
2. Posted three notifications with `cmd notification post`.
3. Counted the shade from `dumpsys notification`'s `Notification List` — **7 records**.
4. `npm start`.

| Time | Side | Line |
|---|---|---|
| 23:42:23.751 | phone | `[notif] Replayed 7 active notifications to Chetans-MacBook-Pro` |
| 23:42:23.765 | phone | `[control] Handshake complete with Chetans-MacBook-Pro` |
| 23:42:23.931-.932 | Mac | seven `[notif] posted …` lines, ending `7 showing, 7 posted / 0 removed since launch` |

**7 replayed, 7 counted, 7 arrived.** All seven crossed in under 2ms. The replay-of-zero this step
exists to expose did not happen.

Note the replay is logged *before* `Handshake complete` — the queue is filled as part of completing
the handshake rather than after it, so there is no window where the Mac is connected with an empty
list it might render as "no notifications".

#### The count is not the number a person would give you, and step 44 should say so

`getActiveNotifications()` returned seven records, one of which is a One UI **group summary**:

```
pkg=com.android.shell id=0 tag=0|com.android.shell|g:Aggregate_NormalNotificationSection
```

That is not an independent notification. It is the header the platform synthesises to collapse the
other `com.android.shell` entries, and the phone replays it because it is genuinely in the active
set. So "N matching the shade" is ambiguous exactly where it matters: a person counting rows on the
phone would say six, or fewer once the group collapses, and would read `Replayed 7` as a bug.

This is not a defect in the replay — it replays what the platform reports, which is correct. It is
an underspecified acceptance criterion, and the failure mode is a false FAIL on a working feature.
Two things to settle before Phase 4 closes:

- whether the Mac's list should hide group summaries (a summary row has no body of its own and will
  render as a near-empty entry), and
- whether `Replayed N` should count them, or report `N active (M summaries)` so the number can be
  reconciled against the shade without anyone doing this dumpsys exercise again.

#### Method caveat

A local-shell quoting mistake made the first three posts collapse onto one tag — `adb shell cmd
notification post -t 'Step 44 one' step44a …` reaches the device already word-split, so `-t` took
`Step`, the tag became `44`, and each post replaced the last. The residue is the `tag=44` record in
the count above. Quote the whole remote command instead: `adb shell "cmd notification post …"`.

## Steps 45-54 — run 2026-08-28 00:12-00:28, by adb and Mac UI automation

Driven end to end without hands: `adb` for the phone, macOS Accessibility (System Events) for the
Mac window. Two notes on method, because both changed what could be tested:

- **The Mac was restarted as `npx electron . --force-renderer-accessibility`.** Chromium builds no
  accessibility tree unless it detects an assistive client, so `System Events` saw one opaque
  `AXGroup` and nothing else. With the flag every button and label is addressable by name, which
  turns "click near these coordinates" into "press the button belonging to this row".
- **Coordinate clicking was tried first and must not be.** A blind `click at {453, 827}` was read as
  "the click did not register" when the phone log actually showed
  `notif.action delivered (action 0 on com.samsung.android.app.smartcapture)` — it had pressed
  *Share* on a screenshot notification and opened a share sheet on the phone. The click landed; the
  row had moved under it. The list re-renders on every incoming notification, so any coordinate
  captured from a screenshot is already stale by the time it is used.

| # | Result | Evidence |
|---|---|---|
| 45 | **PASS** | Note reads `8 showing, 0 of them can be replied to from here. 1 group header hidden.` Both numbers, plus the reconcilable third. |
| 46 | **Needs hands on the phone** | No app on the device posted an inline-reply notification during the run; `cmd notification post` cannot create a `RemoteInput`. Needs a real Slack/Messages message. |
| 47 | **PASS** | Full button enumeration of the pane: `Share, Edit, Delete, Dismiss, Dismiss, Dismiss, Dismiss, Dismiss`. No `Reply` button anywhere, against `0 of them can be replied to`. |
| 48 | **Blocked by 46** | No reply box exists to press Send on. |
| 49 | **Blocked by 46** | Needs an app whose action is secretly a reply field. |
| 50 | **PASS** | Posted `step50`, pressed its own Dismiss, phone logged `notif.dismiss delivered (dismiss) — 3 delivered / 0 refused since start`, Mac logged `notif.dismiss ok`, tag gone from `dumpsys` **Notification List** and the Mac count fell 7→6. |
| 51 | **Not runnable as written** | See below. Superseded 2026-08-28: runnable via `snooze` + `stallRemoved`, and the step's own expectation was wrong — see the debug-switches section at the end. |
| 52 | **Blocked by 46** | Needs a replyable notification to hold a draft. |
| 53 | **FAIL on the second clause** | The list empties; **the card does not hide**. Defect 25 — fixed and re-run **PASS** 2026-08-28 09:50, see the end of this file. |
| 54 | **Partial** | The `ongoing` rule is real — `.notif-row.ongoing { opacity: 0.62 }` — and the ongoing charging notification renders dimmed rather than hidden. A true media-player notification was not produced: `input keyevent 126` resumed nothing. |

### Step 51 cannot be run by hand, and that is worth knowing before someone tries

It asks for a click that *races* `notif.removed`. The Mac clears the row about 100ms after the
phone drops it, and there is no way from adb to remove a notification and press the Mac's button
inside that window — `cmd notification` has no cancel subcommand at all (only `snooze`), and a
person cannot swipe a phone and click a Mac faster than the link. The `NOT_FOUND` path it targets
is real and worth testing; testing it needs `notif.removed` stalled deliberately, which means a
debug switch rather than a manual step. Recorded rather than marked failed, because nothing is
known to be wrong with it.

**Decided 2026-08-28:** the debug switch gets built rather than leaving the step unrunnable — but
after 46, 48, 49 and 52 pass. Those four are all blocked on the same missing thing, a real
inline-reply notification from an app that can post a `RemoteInput`, and they test the feature
itself; step 51 tests an error path behind a race. Build the stall switch once the feature is known
to work, so the switch is not the thing under suspicion when the test finally runs.

### Defect 25 — the Mac keeps offering a phone it is not connected to — **fixed and verified 2026-08-28**

**Found by step 53.** Severity: Medium. It presents a false statement and an actionable button.

`LinkClient.teardown()` in `desktop/src/main/link.ts` clears the session token, the pending map,
the reader and the socket. It does **not** clear `this.capabilities`, which is assigned in exactly
two places — the handshake (`link.ts:420`) and `capabilities.changed` (`link.ts:363`). So the last
known capability set outlives the connection that justified it, and every consumer keyed on it
stays as it was. Confirmed on a live disconnect at 00:22:31 (`Disconnected: user disconnected`):

- The **Notifications card stays visible**, and because the list did empty it renders
  `Nothing on the phone’s notification shade right now.` That is a claim about the phone's shade
  made while nothing is connected to the phone. Step 53's own reasoning is that a list you cannot
  trust is one people stop reading; an empty list captioned as fact is worse than a hidden card.
- The **capability chips stay lit** — `mirror`, `notifications` and `remote` still green with the
  header reading `Disconnected`. (`input` was already grey, having dropped before the disconnect,
  which is what made the stale set visible rather than uniform.)
- **`Start mirroring` and `Stop` are still enabled**, confirmed through the accessibility tree as
  `Start mirroring=enabled:true, Stop=enabled:true` while disconnected. This is the part with real
  bite: the comment above that very line says the button is enabled "only while the phone
  advertises `mirror`. Anything else would offer the user an action the phone has already said it
  cannot perform." Disconnected, the phone has not said anything at all.

**Fixed** by the one line in `teardown()` (`desktop/src/main/link.ts:531`): `this.capabilities =
[]`, cleared beside `this.sessionToken = null`, with a comment saying why so the next person does
not read it as redundant. It is unconditional rather than guarded on the phase, because a teardown
from any phase invalidates the same claim. The status emit that follows is already there —
`setPhase()` on the connected/handshaking path — so every consumer sees the empty set on the same
tick it sees `Disconnected`.

The reason it was not caught is that every check reads `status.capabilities` and none of them reads
the phase beside it. A regression test asserting the set is empty after a teardown is still worth
having and is **not** written: `desktop/` has no test runner at all (no framework in
`package.json`, `npm` scripts are `build`, `start`, `typecheck`), and standing one up is a bigger
decision than this defect should make on its own. Recorded here so it is chosen deliberately rather
than forgotten — the next feature to gate on capabilities will inherit this exactly.

**Verified on hardware 2026-08-28 09:50** — card gone from the accessibility tree, all 12 chips
grey, `Start mirroring` and `Stop` both `AXEnabled=false`, list empty, and every probe back to its
connected value after `Retry now`. Full run and its positive control in the step 53 re-run section
at the end of this file. **Closed.**

### Force-stopping the phone app costs the accessibility grant — 2026-08-28

Running step 53 by `adb shell am force-stop com.chetan.connectsuite.debug` had a consequence the
step does not mention and that no one should rediscover by accident.

| Event | Time | Result |
|---|---|---|
| `am force-stop` | 2026-08-27 00:19:43 | `[input] Input feature installed; accessibility service is off; capabilities now: [mirror]` — no `Accessibility service connected` followed, unlike both reinstalls |
| Next connect | 2026-08-28 09:45:11 | `Phone advertises: mirror, notifications, remote` — `input` absent |
| Grant checked | 2026-08-28 09:47 | `settings get secure enabled_accessibility_services` → **`null`** |

The whole list is empty, not just our entry — positive control: the same query returns the full
list on a healthy device, and `enabled_notification_listeners` still names our component, so this
is a real absence rather than a broken query.

So the three cases are all different and none generalises:

| Event | Notification listener | Accessibility service |
|---|---|---|
| Reinstall (`installDebug`) | torn down, does **not** rebind; grant kept | rebinds unaided within 40ms (2 of 2) |
| Force-stop (`am force-stop`) | grant kept | does not rebind, and the **grant is cleared** |

This is gate 1 failing, not gate 2, and it is unrepairable from this side: an `AccessibilityService`
cannot be granted programmatically, which is a locked platform wall. **A person has to re-enable
ConnectSuite Input under Settings → Accessibility.** Until they do, every `input` step is
untestable — and the cost was paid by a test method chosen for convenience, not by the feature.

Prefer `pkill`-equivalents that do not force-stop, or drop the link instead: the Mac's own
`Disconnect` button exercises the same "link dropped" contract, which is how defect 25 was found,
and costs nothing.

## Step 53 re-run — 2026-08-28 09:48-09:52, closing defect 25

Run against the rebuilt Mac app carrying the `teardown()` fix. **PASS on both clauses**, and on the
three extra assertions defect 25 added.

### Method, and why it is better than the first run's

Two things the 2026-08-28 00:12 run did not have:

- **The AX tree exposes `AXDOMIdentifier` and `AXDOMClassList`.** System Events can read arbitrary
  attributes — `value of attribute "AXDOMIdentifier" of e` — so every element is addressable by its
  DOM id (`mirror-start`, `notif-card`, `caps`) instead of by visible name or position. Names
  collide and move; ids do not. This is the named-target rule made cheap, and it is how every
  assertion below is anchored.
- **Chip state is read from the DOM over the DevTools protocol** (`--remote-debugging-port=9222`,
  `Runtime.evaluate`), because the AX tree cannot express it. See the finding below. The port is
  test instrumentation and observes only; the one button press in this run went through
  `AXPress` by name.

### Positive control, taken first

Not "the card is gone" but "the query that would have found the card still finds everything else".
Connected, 09:48:

| Probe | Connected |
|---|---|
| AX tree size | 290 lines, 44 `AXButton` |
| `id=notif-card` | present, `class=card` |
| `id=mirror-start` | `name=Start mirroring`, **`enabled=true`** |
| `id=state` | `class=pillconnected`, `Connected to Samsung SM-S938B` |
| DOM chips | `mirror=lit, notifications=lit, remote=lit`, 3/12 lit (`input` grey — the accessibility grant is still cleared, see the force-stop note above) |
| DOM rows | 18, note reads `18 showing, 0 of them can be replied to from here. 5 group headers hidden.` |

### The disconnect, 09:50:12

Phone app quit; Mac logged `Disconnected: phone closed the connection` and went to `reconnecting`.

| Probe | Before | After | Step 53 clause |
|---|---|---|---|
| `id=notif-card` in AX tree | present | **absent entirely** | *the card hides* — **was the FAIL** |
| DOM `notif-card.hidden` | `false` | `true` | same, from the other side |
| DOM rows | 18 | **0** | *the list empties* |
| `id=mirror-start` `AXEnabled` | `true` | **`false`** | defect 25 |
| `id=mirror-stop` `AXEnabled` | `true` | **`false`** | defect 25 |
| DOM chips lit | 3/12 | **0/12** | defect 25 |
| `id=state` | `class=pillconnected` | `class=pillerror`, `Reconnecting in 8s` | — |
| AX tree size | 290 lines / 44 buttons | 141 lines / 18 buttons | the 26 missing buttons are the rows' own `Dismiss` |

The card's absence is sound because the same dump still returned `mirror-start`, `mirror-stop`,
`caps`, `state` and 18 other buttons. An empty tree would have proved nothing.

**Recovery checked too**, because a fix that clears state and never restores it would pass every
assertion above: `Retry now` pressed by `AXPress` on its accessibility name, reconnected 09:51:21,
and all seven probes returned to the connected column exactly.

### Finding — capability chips are colour-only, and invisible to the accessibility tree

Not what step 53 was looking for, and worth its own entry. In both dumps the `id=caps` block is
**byte-identical**:

```
AXGroup      | id=caps | class=caps
AXStaticText | name=mirror        | value=mirror
AXStaticText | name=input         | value=input
AXStaticText | name=notifications | value=notifications
…
```

Three lit and zero lit produce the same tree. The chip is an inline `<span class="cap on">`, which
Chromium collapses into a bare `AXStaticText` — the class list survives on block elements
(`class=card`, `class=notif-title`) but not here. So the lit/grey distinction exists **only as a
colour**, which means it is unavailable to a screen reader as well as to a test. Filed as defect 26.

### Method note — this run used `am force-stop`, which the section above says not to

`adb shell am force-stop com.chetan.connectsuite.debug` is how the phone was quit, four sections
after writing down that it clears the accessibility grant and to prefer the `Disconnect` button.
It cost nothing this time only because the grant was already `null` from the 00:19:43 force-stop
and `input` was already grey at the 09:38 handshake — verified before and after, both `null`, with
`enabled_notification_listeners` still naming our component as the positive control. The advice
stands and the next run should use `Disconnect`.

## Step 43 by hand — attempted 2026-08-28 10:07-10:29, **not captured**

Recorded as not-yet-run rather than passed or failed, because the transition step 43 tests was
never observed. The grant is on; the *change* is what the step is about.

### What was set up

A sampler (`step43.tsv`) read `enabled_notification_listeners` from the phone and the Mac's own
belief about it — phase, lit chips, card shown/hidden, row count — on one line every 2 seconds, so
neither number could be read without the other. 202 samples, 10:21:24 to 10:28:36.

### What it recorded

Nothing changed. Every one of the 160 data rows before the run was stopped reads identically:

```
grant=on  ours=1  samsung_control=2  phase=connected  chips=mirror+notifications+remote  card=shown
```

No `Capabilities changed` on the Mac in the whole window, and the phone's `link.log` was **not
written at all** between 09:51:21 and the end of the run — same size, same mtime — while the Mac
took 322 notification posts over the same period.

### The one change that was seen, and why it is not enough

Two spot reads **before** the sampler started did show the grant absent — 10:15:54 and 10:16:26,
both `0` — with our component present again by 10:18. The query behind those zeros was
positive-controlled after the fact (same pipeline: `1` for our component, `2` for the Samsung
control), so the zeros were real: the listener genuinely left the setting and came back.

But neither side logged that either. If that window was the by-hand toggle, then **revoking
notification access while connected is invisible to both the phone and the Mac** — defect 25's
mirror image, capabilities outliving the grant rather than the connection. That is a serious enough
claim to need the transition captured with timestamps rather than inferred from two spot reads
32 seconds apart, which is exactly what the sampler was for and exactly what it did not catch.

**Still to do:** one more off/on with the sampler running, and the phone's `[caps]` lines and the
Mac's `Capabilities changed` beside it. Until then step 43 has no by-hand result and the
2026-08-27 adb-granted one is the only evidence there is.

## Steps 46, 48, 49, 52 — still blocked, and now for a known reason — 2026-08-28

Not "no replyable notification appeared". The reason is specific and fixable:

```
AppSettings: com.whatsapp (10403)   importance=NONE userSet=true
AppSettings: com.whatsapp (9510403) importance=NONE userSet=true
```

**WhatsApp's notifications are switched off at the OS level on this device**, on both the main and
the secondary (dual-messenger) profile, and `userSet=true` says a person turned them off rather
than it being a default. So a message can arrive, be unread, and still post nothing to the shade —
which is what happened. The Mac's own list confirms it: 4 rows, `System UI / Shell / Android System
/ Google Play services`, no WhatsApp.

A grep for `RemoteInput` in `dumpsys notification` returned 2 hits and **both were false**:
`android.remoteInputHistory=null` on unrelated notifications. There is no reply action anywhere on
the shade. Worth writing down as the second time in one day a bare `grep -c` nearly became
evidence — the first is in the step 51 note above.

**To unblock:** Settings → Apps → WhatsApp → Notifications → allow, then send a fresh message from
another device and leave it unopened. Opening the chat clears the notification, which is why the
first attempt left nothing behind.

### Also still off: the accessibility grant

`enabled_accessibility_services` is `null` and `accessibility_enabled` is `0` as of 10:29 — nothing
is enabled, not merely our service. `input` is therefore grey (the chip now says
`input: unavailable, missing Accessibility`, which is defect 24 and 26 doing their job). Not needed
for 43 or 46-52; needed for every `input` step after them.

## The force-stop rule is now a hook, not a paragraph — 2026-08-28

The section above ("Force-stopping the phone app costs the accessibility grant") was written on
2026-08-28 and broken the same day, four sections later, by its own author, running the exact
command it names. It cost nothing only because the grant was already gone.

`scripts/hooks/no-force-stop.sh`, wired to `PreToolUse` in `.claude/settings.json`, now refuses
`am force-stop` on this project's package and answers with the reason and the alternatives
(`Disconnect` on the Mac, `am kill`, or Wi-Fi off). Other packages are untouched. Verified by
running the blocked command: it was denied before reaching the device.

The reasoning stays here in prose, because a hook can carry a sentence but not an argument. The
general lesson — a rule worth writing down needs an enforcement point, or it is a rule about
memory — is in CLAUDE.md.

## The Mac gets a test suite — 2026-08-28

`cd desktop && npm test`. `node --test` with `tsx`, one dev dependency (`tsx`), no config file, no
runner-specific syntax — `import { test } from 'node:test'`.

Added because the count was 0 against the phone's ~300, and the defect ledger says where the bugs
are: **19, 22, 23, 24, 25 and 26 were every one of them Mac-side.** Phases 4 and 5 add four more
panes to that side.

### What the first two tests are, and why those two

They are the two the last four defects pointed at directly.

| File | Guards | Tests |
|---|---|---|
| `src/shared/session.test.ts` | Defect 25 — the Mac kept offering a phone it was not connected to | 3 |
| `src/renderer/chips.test.ts` | Defect 26 — a chip's state was a colour and nothing else | 4 |

### Both were shown to fail before they were kept

A test that cannot fail is the same shape as an empty accessibility query: it reads as evidence and
is not. So each defect was reintroduced and the suite run again:

| Mutation | Result |
|---|---|
| `clearedSession()` returns `capabilities: ['mirror', 'notifications', 'remote']` | **2 fail** — "a cleared session holds no claim the connection made", "each cleared session gets its own arrays" |
| `chipLabel()` returns the bare capability name | **2 fail** — "an available capability says so, not just in green", "the label starts with the capability name" |

Restored, 7/7 pass. `tsc --noEmit` clean.

### Two seams were opened to make this possible, and both are improvements on their own

Neither test could reach its target as the code stood, and the fix in both cases was to make the
code testable rather than to mock Electron. `link.ts` imports `store.ts`, which builds an
`electron-store` at module load and needs `app.getPath()`; `renderer/` is deliberately module-free
so the CSP-locked page can load it as a plain script.

- **`src/shared/session.ts`** — `sessionToken`, `capabilities` and `unavailable` moved out of
  `LinkClient`'s field list into one `SessionScoped` object, cleared by `clearedSession()`.
  `teardown()` is now a single assignment. **This, not the assertion, is what stops defect 25
  recurring:** the original fix added the missing line and left the next field exactly as easy to
  forget — and `unavailable` was added the same day. Grouping them makes a half-cleared session
  unrepresentable. The rule for membership is "is this still true once the socket closes?"; address
  and device name are deliberately not in it, since they survive a drop and are what the reconnect
  aims at.
- **`src/renderer/chips.ts`** — `chipLabel()` split out of `renderer.ts` as its own plain script,
  loaded by `index.html` before `renderer.js`. It stays a plain script (no `export`) because an
  `export` makes tsc emit module preamble that the CSP-locked page cannot run; a
  `typeof module !== 'undefined'` shim at the bottom is what `node --test` picks up, and is a
  no-op in the browser. The renderer now takes the whole sentence from the one function, so the
  page and the test cannot disagree about what a chip says.

### Known gap

Test files are in `tsconfig.json`'s `exclude`, which keeps `dist/` clean but means `tsc --noEmit`
does not typecheck them — `tsx` strips types, it does not check them. A type error in a test shows
up as a runtime failure rather than a compile error. Acceptable for two files; revisit with a
second tsconfig if the suite grows past a handful.

There is no CI in this repo yet. `npm test` is the command it will run when there is.

### Step 43's screen — the exact One UI path, and the two screens it is not

Written after **four** attempts at step 43 toggled something that was not the listener grant. This
is not a user error worth shrugging at: three One UI screens use the word "notification" about the
same app, two of them have a toggle next to our app's name, and only one writes the setting that
governs whether ConnectSuite can read the shade.

**The right screen.** Title **"Notification access"** — a flat list of *apps that want to read
notifications* (on this device: Air command, Android Auto, ConnectSuite, Galaxy Buds, Link to
Windows, NotiStar, …). Reach it by either route:

- **Settings → Apps → ⋮ (top right) → Special access → Notification access**
- or `adb shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`

It resolves on this device to `com.android.settings.Settings$NotificationAccessSettingsActivity`.
It writes `Settings.Secure.enabled_notification_listeners`, which is the one URI
`Capabilities.startWatching()` observes and the one the whole `notifications`/`remote` pair hangs
off.

**The two lookalikes, and how to tell them apart at a glance:**

| Screen | Activity | Writes | Tell |
|---|---|---|---|
| **Notification access** ✅ | `Settings$NotificationAccessSettingsActivity` | `enabled_notification_listeners` | The list is short and contains **Galaxy Buds, Android Auto, Link to Windows** — companion apps, not every app on the phone |
| App notifications ❌ | `Settings$NotificationAppListActivity` → `Settings$AppNotificationSettingsActivity` | that app's `importance` | The list is **every app you have installed**, alphabetical, hundreds long |
| App info → Notifications ❌ | `Settings$AppNotificationSettingsActivity` | that app's `importance` | Reached from the app's own info page; the toggle sits under a heading about *showing* notifications |

The distinction in one sentence: **"Notification access" is about what an app may *read*; "App
notifications" is about what an app may *show*.** They are opposites, and the wrong one is the one
you reach by the obvious route.

**How to know within one second which one you pressed** — the phone's own log:

```
adb shell "run-as com.chetan.connectsuite.debug tail -3 files/logs/link.log"
```

The right screen produces, immediately:

```
[notif] Notification listener detached; notifications capability is off
[caps] Capabilities now: mirror
```

The wrong screen produces **nothing in the link log at all**, and notifications keep arriving on
the Mac — which is exactly the signature seen on 2026-08-28 at 11:19-11:20: a toggle pressed, no
`[notif]` or `[caps]` line, and a System UI notification timestamped 11:19 still reaching the Mac.
A listener that is still delivering has not been revoked.

**The fingerprint the wrong screen leaves**, for anyone diagnosing this after the fact:

```
adb shell dumpsys notification --noredact | grep "AppSettings: com.chetan.connectsuite"
  AppSettings: com.chetan.connectsuite.debug (11011) importance=NONE userSet=true
```

`importance=NONE userSet=true` means a person turned off the app's ability to **post**
notifications. It has no bearing on reading them, and it is not what step 43 tests. (The same field
is why WhatsApp posted nothing earlier in the day: `com.whatsapp importance=NONE userSet=true`.)

**So step 43 reads, unambiguously:** with the link connected, open Settings → Apps → ⋮ → Special
access → **Notification access**, toggle **ConnectSuite** off, confirm the phone logs
`Notification listener detached` within a second, then toggle it back on and time the round trip.
If no log line appears, you are on the wrong screen — stop and check the title says "Notification
access" and the list is short.

### Defect 28 — a notification row can be labelled with a raw package name — **fixed and verified 2026-08-28**

**Found while checking the shade for step 54, 2026-08-28.** Severity: Low-Medium. Cosmetic, but the
label is the app's *identity* in a list someone scans, and `com.google.android.apps.messaging`
where it should say `Messages` is the difference between a pane that reads like a phone and one
that reads like a log.

`NotificationRelay.appNameFor()` resolves the label through `PackageManager.getApplicationInfo`
and falls back to the raw package name:

```kotlin
}.getOrDefault(packageName)
```

**No manifest in the repo declares a `<queries>` element**, and `targetSdk` is 36. Under Android
11+ package visibility, `getApplicationInfo` throws `NameNotFoundException` for a package the app
cannot see, so the fallback fires and the package name is what crosses the wire.

Observed both ways on the same notification within one session — `Messages | AZ-AIRTEL-S` before
the 11:41 reinstall, `com.google.android.apps.messaging | AZ-AIRTEL-S` after it. That
inconsistency is the part not yet explained: static visibility rules should not change across a
reinstall, so either something else grants the lookup transiently or the failure is intermittent
for another reason. **Cause is strongly indicated but not proven** — the missing `<queries>` and
the silent fallback are facts; that they are the whole story is not.

Two candidate fixes, and the choice matters:

- Declare `<queries>` for the packages we need, which is awkward here because a notification
  mirror does not know the set in advance.
- Take the label from the notification itself where it carries one, and treat the package name as
  the last resort it already is — no new permission, and it works for exactly the apps that
  actually post.

`QUERY_ALL_PACKAGES` would work and should be avoided: it is a Play-policy flagged permission and
this is not a launcher.

The silent fallback is its own small lesson — `getOrDefault(packageName)` turns a permission
problem into a cosmetic one and logs nothing, so it survived until someone happened to read the
list twice.

### Defect 27 — the reason for an unavailable capability goes stale the moment it is wrong — **fixed and verified 2026-08-28**

**Found by the revoke test on 2026-08-28.** Severity: Medium. The capability is correct; the advice
attached to it is not.

Revoke notification access on a live link and the Mac reports `notifications` and `remote` as
unavailable — right — with the reason:

> granted in Settings, but Android has not started the service — this happens after the app is
> reinstalled or force-stopped; turn the switch off and on again to rebind it

It was not reinstalled and it is not granted. The sentence sends someone to toggle a switch that is
already off.

Two causes compound:

1. **The recompute races the setting.** It is triggered by the listener's own detach callback
   (`11:02:24.958`), and at that instant `running` is already false while `permitted` still reads
   true from the secure setting, so `CapabilityStatus.reason` takes the `!running` branch. The
   `ContentObserver` fires 255ms later with a consistent view.
2. **The corrected reason never ships.** By the time the observer re-checks, the capability *set* is
   unchanged (`mirror` either way), so no second `capabilities.changed` is emitted and the Mac keeps
   the first sentence for the whole time the grant is off.

Cause 2 is the more general bug and it arrived with defect 24's fix: `unavailable` is part of the
payload, but the decision to send that payload is still made by comparing capability *names*. A
reason that changes while the name set does not is invisible to the Mac.

**Fixed 2026-08-28, before Phase 5**, because every remaining feature has grant states that move
without the name set moving — a permission granted while the component behind it is still down is
the same absent capability with the opposite remedy. This is the grant-versus-running confusion of
defects 18 and 21 reached from a fourth direction.

- `AdvertisedState` (names + reasons) and `advertisementChanged()` are new, in
  `core/.../link/AdvertisedState.kt`. `refresh()` calls exactly that function, so a reason that
  moves on its own is a change and clients are notified.
- `Capabilities.unavailable()` is now the single source of the reason map: `refresh()` compares it
  and `ControlSession.unavailableJson()` sends it, so what the phone notices and what it puts on
  the wire cannot disagree.
- A reason-only change is **logged at the same volume as a name change**, naming the sentence that
  replaced the old one — `Capabilities unchanged (mirror); reason changed: notifications — …`. That
  case used to be silent, which is what let this sit.

**Cause 1 is now self-correcting rather than separately fixed.** The racing recompute still takes
the `!running` branch at the instant of detach, but the `ContentObserver`'s re-check 255ms later
now *counts* as a change and ships the corrected sentence. A wrong reason lasts 255ms instead of as
long as the grant is off. Fixing the race itself is worth doing on its own merits and is not
needed for the user-visible defect.

**Tested** — `core/src/test/.../AdvertisedStateTest.kt`, 5 tests. Mutation-checked: reverting
`advertisementChanged` to `previous?.names != current.names` fails "a reason changing on its own
counts as a change" and "a reason appearing or disappearing counts". Restored, 58/58 pass.

**Verified on hardware 2026-08-28 11:42**, and the mechanism is visible in the log:

| Time | Event |
|---|---|
| 11:42:20.927 | `[notif] Notification listener detached` |
| 11:42:20.929 | `[caps] Capabilities now: mirror` — the racing recompute, still carrying the stale reason |
| 11:42:21.194 | `[caps] A Settings toggle changed; re-checking capabilities` |
| **11:42:21.199** | **`[caps] Capabilities unchanged (mirror); reason changed: notifications — missing Notification access; remote — missing Notification access`** |
| 11:42:21.219 | Mac: second `Capabilities changed`, now with the corrected reasons |

The wrong sentence lasted **272ms** instead of as long as the grant was off, and the Mac's chips
read `missing Notification access` for the whole revoked window on every probe from +3s to +18s.
The bolded line is the one that did not exist before the fix — the correction was computed and
discarded.

One thing the fix makes visible that was previously silent: feature installation at startup now
emits four or five reason-only lines as each module registers
(`reason changed: input — missing Accessibility`, `… contacts — missing Contacts`, …). Each is a
genuine change and the volume is a handful of lines per launch, but if it ever becomes noise the
answer is to coalesce the install sequence, not to go back to dropping the changes.

## Steps 43, 46, 48, 49, 52 — run 2026-08-28 10:48-11:10

| # | Result |
|---|---|
| 43 | **Still not captured by hand.** Second attempt, 335 valid samples, no transition observed. |
| 46 | **PASS** on the link contract. |
| 48 | **PASS.** |
| 49 | **PASS** on both clauses, with one path found unreachable. |
| 52 | **PASS**, with a deviation on how the re-render was triggered. |

### Step 43 — the sampler ran, and there was still nothing to see

10:48:15 to 11:01:23, sampling the phone's grant and the Mac's belief about it every ~2.2s.

- **335 samples with a verified-working query. Grant `on` in all 335. Zero revocations.**
- The Mac's columns — chips, card, row count — come over the DevTools protocol and do not touch
  adb. They show three chips lit and the card shown for the entire window.

That second point is what makes this conclusive rather than merely unobserved: the revoke test below
shows the Mac reacts within **16ms**, and the sampler looked every 2.2s. A toggle would have been
caught by the Mac columns even if adb had missed it.

#### The control column earned its place

At 11:00:26 the samples began reading `ours=0` — grant absent. They also read `control=0`, and the
control is a component certain to be present. Both zero is the signature of a dead query, and adb
had in fact dropped the device (`adb: no devices/emulators found`); it returned at 11:01:23. Without
that column those 27 rows would have been a revocation, timestamped and plausible, and this file
would now contain a defect that does not exist.

Filtered on `control==2`, genuine revocations in the run: **0**.

### Revoking access while connected is **not** invisible — no defect, question closed

The open question from the previous run — whether a revoke propagates, defect 25's mirror image —
is settled, and the answer is that it works. Driven by adb (`cmd notification disallow_listener`
then `allow_listener`), so this is **not** step 43; it is the diagnostic step 43 was meant to
provide.

| Time | Side | Line |
|---|---|---|
| 11:02:24.958 | phone | `[notif] Notification listener detached; notifications capability is off` |
| 11:02:24.963 | phone | `[caps] Capabilities now: mirror` |
| 11:02:24.974 | Mac | `[link] Capabilities changed: mirror (11 unavailable: …)` — **16ms behind the phone** |
| 11:02:25.218 | phone | `[caps] A Settings toggle changed; re-checking capabilities` |
| 11:02:43.996 | phone | `[notif] Notification listener attached to the link` |
| 11:02:44.258 | phone | `[caps] Capabilities now: mirror,notifications,remote` |
| 11:02:44.275 | Mac | `[link] Capabilities changed: mirror, notifications, remote (9 unavailable: …)` — **17ms** |

The Mac's UI followed within the 3s sampling interval in both directions: chips dropped to `mirror`
alone, notifications card hidden, list emptied — then all three restored. Defect 25's fix is doing
the same work for a revoked grant that it does for a dropped connection.

Both halves of defect 24's field are visible in those log lines, doing the job they were added for.

#### Finding — the reason is computed at the instant of change and then goes stale (defect 27)

During the revoked window the Mac's reason for `notifications` and `remote` read:

> granted in Settings, but Android has not started the service — this happens after the app is
> reinstalled or force-stopped; turn the switch off and on again to rebind it

The grant had just been **revoked**. The correct sentence is "missing Notification access". The
recompute is triggered by the detach callback at `…24.958`, and at that instant the listener is
already down (`running=false`) while the secure-setting read still says granted (`permitted=true`)
— so `CapabilityStatus.reason` takes the `!running` branch. The `ContentObserver` fires 255ms later
and re-checks, but the capability *set* is unchanged by then, so no second `capabilities.changed`
goes out and the stale sentence stands for as long as the grant is off.

Severity: Medium. It is not a wrong capability, it is wrong advice — it tells someone to toggle a
switch off and on when the switch is already off and needs turning on. Filed as **defect 27**.

### Step 46 — PASS

Replied to the self-sent WhatsApp message (`WhatsApp / Chetan / "6dyf"`), chosen because the other
five replyable rows were real contacts and a group. Text sent: `Step 46 reply sent from the Mac`.

| Time | Side | Line |
|---|---|---|
| 11:07:36.754 | phone | `[notif] notif.reply delivered (reply to com.whatsapp) — 1 delivered / 0 refused since start` |
| 11:07:36.767 | Mac | `[notif] notif.reply ok` |

Mac notice `Replied to WhatsApp.`, and the row left the list — which is what WhatsApp does with its
own notification once a reply is delivered through the `RemoteInput`.

**Not independently verified:** that the message is in the chat. The evidence is the delivered
`PendingIntent` and WhatsApp's own consumption of the notification; reading WhatsApp's message store
is not something this test can do. Worth one glance at the phone before Phase 4 closes.

### Step 48 — PASS

Send pressed on an empty box, before anything was typed into it.

- Mac notice: `An empty reply was not sent.`
- **Nothing crossed the link** — no `notif.reply` on the Mac, none on the phone, and the phone's
  counter still read `0 refused` afterwards. The guard is on the Mac and the link stayed quiet.

### Step 52 — PASS, with a deviation

Draft `draft survives step 52` typed into the reply box, then the list forced to rebuild (12 → 13
rows). Afterwards: **reply box still open, draft intact, and the caret still in it**
(`document.activeElement === input`) — the last of which is what the code comment calls out as the
difference between preserving a draft and preserving a usable one.

**Deviation:** the rebuild was triggered by a `com.android.shell` post, not by a second WhatsApp
notification. None arrived in the 100s the run waited for one. The rebuild is app-agnostic —
`render()` empties and refills the container on every event — so the code path is identical, but
the literal wording of the step ("from the same app") was not met.

### Step 49 — PASS on both clauses, and one path is unreachable

**49a — the reply action is not drawn as a button.** Checked across all 6 replyable notifications by
counting rather than by name (see the method note): drawn buttons must equal the Mac's own Reply,
plus the non-`isReply` actions, plus Dismiss.

| Row | phone actions | drawn | expected |
|---|---|---|---|
| WhatsApp / You | `Reply[isReply], Mute` | Reply, Mute, Dismiss = 3 | 1+1+1 = 3 |
| WhatsApp / Coding Club India | `Reply[isReply], Mark as read, Mute` | 4 | 1+2+1 = 4 |
| WhatsApp / Acko India | same | 4 | 4 |
| WhatsApp / Star Health | same | 4 | 4 |
| WhatsApp / Ajay Choudhar | same | 4 | 4 |
| WhatsApp / YesMadam | same | 4 | 4 |

6 of 6 exact. No `isReply` action reached the action bar.

**49b — forcing one through.** `window.connect.notifReply(key, text)` called directly on a
notification with no reply action (System UI's charging notification), with non-empty text so the
step 48 guard could not be what stopped it. Refused:

```
{ ok: false,
  reason: "System UI does not offer a reply on that notification, so there is nothing for the
           phone to type into.",
  fixHint: "Open the app on the phone to answer this one." }
```

The outcome the step asks for — refused, nothing sent, a sentence a person can act on — holds.

**But the refusal came from the Mac, not the phone.** Nothing crossed the link: no Mac log line, and
the phone's counter still read `1 delivered / 0 refused since start` afterwards. The phone's own
`NO_REPLY_ACTION` guard exists (`NotificationFeature.kt:437` and `:456`) and is **unreachable from
the Mac UI**, because the main process refuses first. That is defence in depth and the right order
— but it means the phone-side branch is untested by this route, the same shape as step 51's
`NOT_FOUND`. Both want the same thing: a debug switch that lets a request past the Mac's guard.

#### Method note — a naive match produced six confident FAILs

The first 49a check compared the phone's `isReply` action *title* against the drawn button labels
and reported all six rows as leaking. They were not. The Mac draws **its own** Reply affordance,
whose label is `one.replyLabel ?? 'Reply'` — the same word — and both it and the action buttons
carry `className = 'secondary small'`, so neither label nor class separates them. Only the count
does.

Third time in one day that a naive match nearly became evidence, after the empty AX query at step 47
and the `grep -c remoteinput` that returned two `remoteInputHistory=null` lines. The pattern is the
same each time: a check that cannot tell the thing it is looking for from something that resembles
it, reporting with full confidence.

## Step 43 — **PASS by adb**, by-hand half unresolved — closed 2026-08-28

### What is proven

The app's reaction to notification access changing on a live link, in **both** directions,
measured end to end:

| Time | Side | Line |
|---|---|---|
| 11:02:24.958 | phone | `[notif] Notification listener detached; notifications capability is off` |
| 11:02:24.963 | phone | `[caps] Capabilities now: mirror` |
| 11:02:24.974 | Mac | `[link] Capabilities changed: mirror (11 unavailable: …)` — **16ms** |
| 11:02:43.996 | phone | `[notif] Notification listener attached to the link` |
| 11:02:44.258 | phone | `[caps] Capabilities now: mirror,notifications,remote` |
| 11:02:44.275 | Mac | `[link] Capabilities changed: mirror, notifications, remote (9 unavailable: …)` — **17ms** |

Card hidden then shown, chips dropped to `mirror` then restored, list emptied then replayed, no
reconnect in either direction. That is every clause step 43 and step 36 assert, on hardware.

Driven by `cmd notification disallow_listener` / `allow_listener`, which writes the same secure
setting One UI's switch writes and is the setting the `ContentObserver` watches.

### What is not proven, and why it is not ours

**Whether One UI's own Notification access switch writes `enabled_notification_listeners` on this
device.** Five by-hand attempts across a morning, the last two on the verified-correct screen
(`Settings$NotificationAccessSettingsActivity`, confirmed foreground via `dumpsys window`),
produced:

- no change in `enabled_notification_listeners` across **250 continuous samples**, 11:22:44 to
  11:31:29, with the control component reading present in every one;
- not one line in the phone's `link.log`, which still ended at 11:07:36 afterwards;
- notifications continuing to arrive on the Mac throughout — a listener that is still delivering
  has not been revoked.

The app cannot be the cause of any of that: it is downstream of a setting that never moved, and
when the setting *does* move it reacts in 16ms. Two possibilities remain, both on the platform side
of the line — One UI's confirmation dialog for turning access off may not have been completed, or
the device writes this grant somewhere the public secure setting does not reflect. Neither is
actionable from this repo.

**Recorded as PASS by adb with the by-hand half unresolved.** Not marked failed, because nothing is
known to be wrong with the feature; not marked fully passed, because One UI's screen was never
observed to drive it.

### The one thing to carry forward

If a user ever reports "I granted notification access and the Mac never noticed", **the first
question is whether the grant was written at all**, not what the app did with it:

```sh
adb shell settings get secure enabled_notification_listeners | tr ':' '\n' | grep connectsuite
adb shell "run-as com.chetan.connectsuite.debug tail -3 files/logs/link.log"
```

A grant present with no log line is our bug. A grant absent after the switch was pressed is theirs.
The five attempts here were all the second kind and cost most of a morning to establish, which is
why the confirmation is now the preamble to every toggle step in this file.

## Steps 42 and 44 — closed 2026-08-28

### Step 42 — **PASS**

Access revoked by adb, then `Disconnect` and `Connect` pressed on the Mac by accessibility name, so
the handshake itself happened with the grant absent:

```
phase            = connected
notif-card hidden = true
mirror: available
notifications: unavailable, missing Notification access
remote:        unavailable, missing Notification access
```

Every clause holds: the card is **absent rather than empty**, and the chip now names the missing
permission — which is the half of step 42 that could not pass before defect 24 put the reason on the
wire. This is also the clearest confirmation that a fresh handshake computes the reason correctly:
`missing Notification access`, not the stale "granted in Settings, but Android has not started the
service" of defect 27, because there is no detach race on a cold handshake.

### Step 44 — **PASS**, and its two open questions are settled

The replay itself was never in doubt; what was open was the acceptance criterion, because the
platform's group summaries made "N matching the shade" ambiguous. Both questions raised on
2026-08-27 have been answered **in the implementation**, and today's logs show it:

| Question | Answer, as shipped |
|---|---|
| Should the Mac's list hide group summaries? | **Yes.** The note reads `… 1 group header hidden` — hidden from the list, counted in the note. |
| Should `Replayed N` count them? | **No — it reports both.** `[notif] Replayed 23 active (5 summaries) to Chetans-MacBook-Pro` |

Both numbers, each beside the thing that gives it meaning, so the count reconciles against the shade
without anyone repeating the `dumpsys` exercise. Step 44's expectation should be read as
`Replayed N active (M summaries)`, N + M matching `getActiveNotifications()`, N matching what a
person counts on the shade.

## The debug switches, and steps 49b and 51 — 2026-08-28

Two error paths in the notification pane were real, worth testing, and unreachable from the UI
because the Mac's own guards refuse first. Both are now reachable, on purpose and only on purpose.

### `desktop/src/main/debugSwitches.ts`

```sh
CONNECTSUITE_DEBUG_SWITCHES=stallRemoved,bypassReplyGuard npm start
```

| Switch | Opens | For |
|---|---|---|
| `stallRemoved` | swallows `notif.removed` instead of applying it, so rows go stale on purpose | step 51's race, which no human can win |
| `bypassReplyGuard` | lets a reply past the Mac's `canReply` refusal | step 49's `NO_REPLY_ACTION`, which the Mac otherwise pre-empts |

Off unless **named** — a truthy value does not turn them on, and an unknown name turns nothing on
and says so. `main.ts` reads them at startup so an `on` switch appears in the log's second line:

```
W [debug] DEBUG SWITCHES ON: stallRemoved, bypassReplyGuard — guards are weakened, this is not a normal run
```

A quietly disabled guard is worse than no guard, because the next confusing result gets blamed on
the feature. 6 tests in `debugSwitches.test.ts`, mutation-checked against the obvious wrong
implementation (any truthy value enables everything): 3 fail, restored, 13/13 pass.

### Step 49b — **PASS**, the phone's own refusal now reached

`bypassReplyGuard` on, reply sent to a live notification whose app offers no reply action:

```
ACK  { ok: false, code: "NO_REPLY_ACTION",
       reason: "That notification from com.android.shell does not offer a reply, so there is
                nothing for the phone to type into." }
phone  W [notif] notif.reply refused: no-reply-action — 3 delivered / 1 refused since start
```

All three checks in the chain are now exercised: the renderer hides the box, the Mac refuses the
request, and the phone refuses it too.

### Step 51 — **its premise is wrong, and the code is right**

The step asks for a Dismiss on a stale row to "return a sentence, not a silent no-op". It does not,
and it should not. `onDismiss` is **deliberately not gated on `find(key)`**:

> Dismissing something already gone is the outcome the user asked for, and refusing a dismiss
> because the notification vanished half a second earlier would be a refusal the user cannot act on
> and does not want.

Confirmed on hardware: with the row genuinely stale — `cmd notification snooze` removed it from the
phone's active set, `stallRemoved` kept it in the Mac's — a dismiss returned `{ok: true}` and the
phone logged `notif.dismiss delivered`. That is correct behaviour and step 51 as written would have
recorded it as a failure.

**`NOT_FOUND` belongs to `reply` and `action`**, which go through `ready()`. Both verified against
the same stale key:

```
notif.reply  -> { ok: false, code: "NOT_FOUND", reason: "That notification is no longer on the phone…" }
notif.action -> { ok: false, code: "NOT_FOUND", … }
phone  W [notif] notif.reply refused: gone  — 3 delivered / 2 refused since start
phone  W [notif] notif.action refused: gone — 3 delivered / 3 refused since start
```

And the clause that matters most held: **the pane never greyed out** — card still shown, all three
chips still lit. `NOT_FOUND` means "refresh", not "this feature is broken".

**Step 51 should be rewritten** as: dismiss on a stale row succeeds silently (idempotent, by
design); `reply` or `action` on a stale row returns `NOT_FOUND` with a sentence, and the pane stays
up. Recorded rather than edited in place, so the change of expectation is visible.

#### Method note — `snooze` is the phone-side removal that adb has

`cmd notification` has no cancel subcommand, which is what made step 51 "not runnable as written"
in the first place. It does have `snooze --for <ms>`, which takes the notification out of the active
set — a real `onNotificationRemoved` — and `unsnooze` puts it back. That is the instrument this
step needed all along.


## Four Mac panes land: contacts, media remote, SMS, calls — 2026-08-28

Built in that order, which is neither the roadmap's nor `docs/protocol.md`'s. The order is by what
each one unblocks: contacts first because step 59's second state and every "name or number" clause
in the SMS and call panes depend on it, and calls last because it is the only feature that needs
another person on a schedule.

Each pane is a main-process client (`src/main/`), a renderer view (`src/renderer/`), an entry on
the preload bridge, and a card in `index.html`. The notification pane from 2026-08-27 is the
template and the rules it established — hidden not greyed, a refusal is a value not a rejection,
counts carry their denominator — are followed rather than re-derived.

### Granting by adb, which is the whole recipe

The five attempts this morning were spent on a Settings screen, and none of it was necessary. Every
runtime permission this phase needs can be granted from the terminal, and the app can be made to
notice without touching Settings at all:

```sh
adb shell pm grant --user 0 com.chetan.connectsuite.debug android.permission.READ_CONTACTS
# ...and any of READ_SMS SEND_SMS RECEIVE_SMS READ_CALL_LOG READ_PHONE_STATE CALL_PHONE ANSWER_PHONE_CALLS

# The grant alone changes nothing the Mac can see. This is the second half:
adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity
```

**Why the second command is required.** `Capabilities.startWatching` registers a `ContentObserver`
on two `Settings.Secure` URIs — `enabled_accessibility_services` and `enabled_notification_listeners`
— and on nothing else. Android broadcasts nothing when a *runtime* permission is granted, so a
`pm grant` lands silently and the capability set is never recomputed. `MainActivity.onResume` calls
`LinkService.refreshCapabilities`, so bringing the activity forward is the re-check. It works
whether or not the app is already foregrounded.

**What does not work, and why**, so nobody spends the afternoon on it: `LinkService` is
`android:exported="false"` (`core/src/main/AndroidManifest.xml:36`), so the direct route is refused:

```
$ adb shell am start-service -n .../LinkService -a com.chetan.connectsuite.link.REFRESH_CAPS
Error: Requires permission not exported from uid 11011
```

**Verify from the log, never from the Settings screen.** One line on the phone settles it:

```sh
adb shell "run-as com.chetan.connectsuite.debug cat files/logs/link.log" | grep 'Capabilities now' | tail -1
```

Observed, in order, each ~1s after its `am start`:

| After granting | Phone log |
|---|---|
| `READ_CONTACTS` | `Capabilities now: contacts,input,mirror,notifications,remote` |
| the three SMS permissions | `…,remote,sms` |
| `READ_CALL_LOG` + `READ_PHONE_STATE` only | `Capabilities unchanged (…); reason changed: calls — missing Phone` |
| `CALL_PHONE` + `ANSWER_PHONE_CALLS` | `Capabilities now: calls,contacts,input,mirror,notifications,remote,sms` |

The Mac saw the first of those 66ms later: `I [link] Capabilities changed: contacts, input, mirror,
notifications, remote`.

**A gap this exposes, not fixed here.** Because the observer watches only those two Settings URIs,
a runtime permission granted from the system permission screen is also noticed only on the next
`onResume`. In the by-hand flow that is invisible — the user returns to the app and it re-checks —
but a user who grants in Settings and never comes back leaves the Mac's chip grey over a permission
that is in fact granted. Recorded here rather than fixed, because it is the phone's design and
this session's scope was the Mac.

### Steps that fell out of the grants

| Step | Result |
|---|---|
| 37 — grant Contacts only | **PASS.** `contacts` lit; `sms` and `calls` stayed grey with their own reasons (`missing SMS`, `missing Call logs, Phone`). |
| 38 — grant SMS | **PASS.** `sms` lit. |
| 39 — `calls` needs all four | **PASS, both halves.** The two read permissions alone left it grey and narrowed the reason to `missing Phone` — a green chip over a `call.dial` that cannot work is exactly what the gate prevents. Adding the other two lit it. |

### One debug switch per pane, built with the pane — and one pane that needed none

`CONNECTSUITE_DEBUG_SWITCHES` now names five:

| Switch | Opens | For |
|---|---|---|
| `stallRemoved` | swallows `notif.removed` | step 51 |
| `bypassReplyGuard` | lets a reply past `canReply` | step 49 |
| `bypassRemoteGuard` | sends a transport command the state says is impossible | steps **65 and 66** |
| `forceRecipientMismatch` | sends `sms.send` whose addresses disagree with its `threadId` | step **58a** |
| `stallCallEnded` | swallows `call.ended`, so the call card goes stale | step **61** |

`bypassRemoteGuard` covers two steps because it is one guard: `RemoteClient.command` refuses both
"this session cannot skip" (65) and "there is no session" (66) before anything crosses the link.

**Contacts got no switch, and that is the finding rather than an omission.** Its refusal paths were
checked one at a time for reachability: `PERMISSION_DENIED` is reachable with `pm revoke`,
`NOT_FOUND` by deleting a contact on the phone and clicking the row the Mac still shows — no race
to win, because the contact list has no push events to outrun — and `BAD_REQUEST` is unreachable
only in the sense that the pane never sends a bad limit, which is not a path worth opening. Nothing
in contacts has the shape steps 51, 61, 65 and 66 share: a correct Mac-side guard standing in front
of a phone-side refusal. So the budget bought four switches, not five.

`forceRecipientMismatch` substitutes `+15550100`, a documentation-reserved number, rather than a
real one. It is the only switch that weakens a guard over an outcome that cannot be undone, so a
phone that wrongly *accepted* the mismatched pair would still not deliver a message to a person.

### Two guards written as signatures rather than as comments

Both are structural, because the alternative was a comment asking callers to be careful:

- **`SmsClient.send(threadId, body)` takes no recipient.** The send rule requires that the Mac
  never take the recipient from whichever thread the UI has open; it resolves the addresses from
  the thread rows the client itself received. The renderer is the layer most likely to be stale, so
  it is the layer that cannot name a recipient at all. `smsSend` on the preload bridge has the same
  shape, and the compose box has one input.
- **`callAnswer()` / `callReject()` take no arguments.** `call.answer` and `call.reject` accept an
  omitted `callId` meaning "the call in progress", and this client never uses that shape — it sends
  the id of the call it is *showing*. On a stale card the omitted form would reject **whoever is
  ringing now**, which is step 61's clause that actually matters and the one the phone can only
  catch if the Mac names the call.

### Defect 29 — the call log read the wrong key, and reported an empty log — **fixed 2026-08-28**

`CallClient.log` extracted its rows from `calls`; `docs/protocol.md` and the phone both use
`entries`. `rows()` answers a missing key with an empty array, so there was no error, no warning
and nothing to debug — the Mac drew *"There are no calls in the phone's log"* against a phone
holding 1,999 of them.

**What caught it was the two logs disagreeing about one event**, which is the whole argument for
logging a count on both sides of a request:

```
phone  I [calls] call.log → 50 entries, hasMore=true — 1 delivered / 0 refused since start
Mac    I [calls] call.log → 0 entries, 0 with a contact name, hasMore=true
```

`0 entries, hasMore=true` is contradictory on its face, and that is what made it worth looking at.
Note what would have hidden it: inferring `hasMore` from the page length, which would have produced
a perfectly consistent and perfectly wrong "no calls, and nothing more".

Before treating the zero as evidence, the control was taken first, per the rule one section up:

```
$ adb shell content query --uri content://call_log/calls --projection "_id" | wc -l
1999
```

Fixed by reading `entries`. Three tests added, and the fix reverted to watch them fail: the key
test, a test that a reply keyed `calls` is **not** leniently accepted (so the two sides cannot
quietly diverge again), and one pinning `hasMore` as the phone's rather than inferred. Mac now
reports `50 entries, 43 with a contact name`, reconciling with the phone.

The other three list clients were checked for the same class of error and are correct
(`contacts`, `threads`, `messages`) — each verified by returning real rows rather than by reading
the code.

### A poll introduced and removed in the same hour

The first cut of the remote's connect-time `remote.state` request was written as
`if (status.phase === 'connected')` inside the status handler. `status` is re-emitted on every
heartbeat because `rttMs` changes, so that was a request **every five seconds** — a poll, in the
one client whose design note says it does not poll. Caught by its own tally line climbing at a
steady rate with nothing happening: `1 states`, `2 states`, `3 states`, five seconds apart.

Now fired on one edge only, and not the obvious one. Not on connect, because the phone already
replays `remote.state` to each session as it becomes ready (`RemoteFeature.addSessionReadyListener`)
— confirmed by an unsolicited state arriving before the request in the log. The remaining edge is
`remote` becoming advertised while already connected, which is the one the phone does *not* cover:
`RemoteFeature.attachSessionListener` runs inside `install()` and returns early unless the
notification listener is already bound, so a grant made mid-session can light the capability
without attaching the media listener behind it. A `remote.state` request is answered from
`stateOf()` directly and works either way.

### What was verified against the phone, and how

Driven through Electron's remote debugging port (`--remote-debugging-port=9222`) by element id and
class — no coordinates, per the rule. Every check took its control first.

| Check | Control | Result |
|---|---|---|
| Contacts pane loads | 8 cards enumerated, 7 visible, pairing card correctly hidden | **PASS** — 50 rows, `hasMore=true`, note names the page and the sort order |
| Contacts search by name | the same box returns 50 with an empty query | **PASS** — `aadesh` → 2 |
| Contacts search by number | as above | **PASS** — `9637671580` → 1 |
| Contacts empty state | as above | **PASS** — "No contact on the phone matches …", not a blank pane |
| Contact expands with photo | row opened by its named button | **PASS** — labelled fields, photo, `aria-expanded="true"` on the open row only |
| SMS thread list | 50 threads from the wire | **PASS** — 50 drawn, 635 unread, 45 badges |
| ~~**Step 59, both states**~~ **(mislabelled — see defect 34)** | see below | This row measured `sms.threads` attribution, **not** `sms.received`. The measurement stands (1 row drew `contactName`, 49 drew `addresses[0]`, **0 matched neither**) but it is not step 59, which is about the received *event*. Step 59 **FAILS** — see defect 34. |
| SMS thread opens | 3 messages, 2 in / 1 out | **PASS** — composer has exactly **one** input, and no recipient field |
| Step 56 — MMS attachment marker | `kind` and `hasAttachments` populated on all 176 messages read | **NOT RUNNABLE** — 20 threads, 176 messages, zero MMS on this phone |
| Step 66 first half — nothing playing | remote card visible, not hidden | **PASS** — "Nothing is playing on the phone.", empty body, no error styling |
| Call log | `content://call_log/calls` holds 1,999 rows | **PASS after defect 29** — 50 entries, 43 named, 9 missed, four distinct types drawn |
| No live call ⇒ no live controls | 50 log rows present in the same DOM | **PASS** — `#call-answer` and `#call-reject` absent, live card hidden |

**Step 59's discrimination, which the first probe got wrong.** The first check classified a row as
"showing a name" with `/^[+0-9 ()-]+$/` against the drawn label, and reported six of six as names —
against a wire that said only **one** thread had a `contactName`. Indian SMS senders are
alphanumeric shortcodes (`AA-AAAAAA-A`), so the regex could not separate a contact name from a
sender id and said so confidently. The discriminator that works compares the drawn label against
the two fields it could have come from: `drawnEqualsContactName: 1`, `drawnEqualsAddress: 49`,
`drawnMatchingNeither: 0`. The last number is step 59's actual expectation — never blank — and it
is the only one of the three the bad probe could not have produced.

**Step 56's control matters more than its result.** "No MMS found" and "the field is not populated"
are the same empty answer. Both fields came back populated on every message read —
`kind: {"sms": 176}`, `hasAttachments: {"false": 176}` — so the absence is a fact about this
phone's inbox, not a dead field. The rendering path is built and remains untested against real data.

### Not yet run, and what each needs

- **Steps 64, 65, 66 (second half)** — need something playing. 65 and 66 need
  `CONNECTSUITE_DEBUG_SWITCHES=bypassRemoteGuard`.
- **Step 58, 58a, 58b, 58c** — need a real send. 58a needs `forceRecipientMismatch`.
- **Steps 60, 61, 62, 63** — need a call. 61 needs `stallCallEnded`.
- **Step 55, 57** — need a thread of 500+ messages and an MMS respectively; the largest thread
  scanned here held far fewer, and there are no MMS.

### An armed Call button, found rather than caused

Midway through the run the dial button read `Confirm — call +91…` with a number in the box that
this session never typed. It is the two-step confirm having done its job: someone clicked **Call**
once while exploring the new pane, and the second click — the one that places a real call — had not
happened. Disarmed by dispatching an `input` event, which is the designed withdrawal path and keeps
the typed number.

Worth recording because it is the first evidence the confirm earns its place. There is no dialler
screen to cancel on and nobody holding the phone: a one-click Call button would have placed that
call. The pane also withdraws the confirmation whenever the number is edited, so a pending confirm
cannot survive into a different number.

### Test suite

45 → **48 tests**, `npm test` in `desktop/`. New files: `contacts.test.ts` (9), `sms.test.ts` (11),
`calls.test.ts` (13, three of them defect 29's). Every new test was mutation-checked — the defect
it is named for reintroduced, the test watched to go red, the code restored:

| Mutation | Caught by |
|---|---|
| `contacts.list` sends a `before` | 2 tests |
| empty query sent as `query: ""` | 1 |
| `hasMore` inferred from page length (contacts, calls) | 2 |
| the name cache survives a disconnect | 1 |
| the Mac reimplements the phone's number matching | 1 |
| a send falls back to the last-listed thread | 1 |
| unreadable recipients send anyway | 1 |
| paging replaces the thread map instead of merging | 1 |
| recipients outlive the link | 1 |
| the mismatch probe leaves the reserved number range | 1 |
| `forceRecipientMismatch` does nothing | 1 |
| `call.answer`/`reject` omit the `callId` | 3 |
| any `call.ended` blanks the card | 1 |
| a call with no id is drawn | 1 |
| a stale card survives `NO_ACTIVE_CALL` | 1 |
| `stallCallEnded` does nothing | 1 |
| `call.log` reads `calls` instead of `entries` | 2 |

`debugSwitches.test.ts` was restructured rather than extended. Its six assertions each spelled out
the whole switch object, so adding the third switch broke all six with six identical diffs — noise
burying the one question worth asking, which is whether the new switch defaults to off. That
question now lives in a single test that pins the known names; every other test derives its
expectation from the module. Adding the fourth and fifth switches each touched exactly one line.

One test was added that the restructure made possible: `bypassReplyGuard` and `bypassRemoteGuard`
differ by two letters, and a matcher written with `startsWith` or `includes` would enable one from
a typo of the other. Mutation-checked against exactly that implementation.

## Defect 28 closed, and a third copy nobody had found — 2026-08-28

Fixed before the media-remote steps rather than after, because step 64 *is* the card showing the
playing app's name: the defect would have landed on the first hardware step of the run.

### The fix

A `<queries>` element in `sync-module/src/main/AndroidManifest.xml`, matching the launcher intent:

```xml
<queries>
    <intent>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent>
</queries>
```

Not `QUERY_ALL_PACKAGES`, which would also work and is Play-policy flagged for anything that is not
a launcher or a security tool. An app with a launcher icon is exactly the set that posts
notifications and holds media sessions, so the narrow filter is the right set rather than a lesser
one. Confirmed present in the merged manifest before installing, since a `<queries>` that failed to
merge and one that did not exist look identical from the app's side.

`EXTRA_SUBSTITUTE_APP_NAME` was tried as a second source and **removed**: the constant is not in
the public SDK, and setting it requires `SUBSTITUTE_NOTIFICATION_APP_NAME`, which is
signature-or-privileged. No ordinary app can set it, so it would have been a hidden-API dependency
bought for nothing. It cost one failed compile to find out, which is cheaper than shipping it.

### There were three copies, not two

`appNameFor` existed byte-for-byte identically in `NotificationRelay` and `RemoteFeature`, and a
third sat on the v1 Android-to-Android path in `NotificationMirrorService`. The third was found
only *after* the first two were fixed, by grepping for the leftover pattern rather than by
remembering it existed.

That is the argument for `AppLabels.kt` being a file rather than two careful edits: **a duplicated
helper is fixed as many times as somebody happens to grep, and the count is never obviously
complete.** All three now call one function. The v1 copy was rerouted rather than left — it is the
same bug, and leaving it would have made the new file's own claim false.

### The fallback is kept and no longer silent

A package with no launcher icon still resolves to its own name, which remains the honest answer.
What changed is that `getOrDefault(packageName)` — which turned a visibility problem into a
cosmetic one and logged nothing — is now a `w:` line carrying the ratio, per CLAUDE.md:

```
W [applabel] No label for <pkg>; showing the package name — 7 resolved / 3 fell back since start
```

Successful lookups are cached; **failures deliberately are not**. Visibility can change under the
app, and a cached failure would pin a package name into the pane for the life of the process — the
same defect with a longer fuse.

### Proof on hardware

Rebuilt, installed with `adb install -r`, app foregrounded. Phone log:

```
I [applabel] com.android.systemui resolves to "System UI" — 1 resolved / 0 fell back since start
I [applabel] com.whatsapp resolves to "WhatsApp" — 3 resolved / 0 fell back since start
I [applabel] com.google.android.googlequicksearchbox resolves to "Google" — 5 resolved / 0 fell back
I [applabel] com.samsung.android.app.smartcapture resolves to "Samsung capture" — 7 resolved / 0 fell back
```

**7 resolved / 0 fell back.** The denominator is the point: "7 resolved" alone would not distinguish
this from a run where seven worked and thirty did not.

On the Mac, over the live link, with the control taken first — 20 notifications drawn, so the query
had something to be wrong about:

| Probe | Result |
|---|---|
| notifications drawn (control) | 20 |
| `appName === package` | **0** |
| `appName` matching a package-id shape | **0** |
| distinct labels | System UI, ConnectSuite, WhatsApp, Android System, Google, StackUp, Samsung capture |

The `appName === package` check is the discriminating one: a label that still equals its own package
id is the defect, and it is the one comparison that cannot be satisfied by a lookalike.

**The reinstall inconsistency in the original report is now explained.** The observation was
`Messages | AZ-AIRTEL-S` before a reinstall and `com.google.android.apps.messaging | AZ-AIRTEL-S`
after it, which "static visibility rules should not change across a reinstall" made puzzling. They
do not — but the *cache* did. Labels resolved while a package was still visible survived in
process memory and kept rendering correctly until the process was replaced. The reinstall did not
change visibility; it cleared the memory that was hiding the failure.

### An adb win: the notification listener does not need Settings either

Recorded here because `docs/testing.md` has five attempts' worth of the opposite. A reinstall drops
the notification-listener grant, and it can be restored from the terminal:

```sh
adb shell cmd notification allow_listener \
  com.chetan.connectsuite.debug/com.chetan.connectsuite.sync.notifications.NotificationMirrorService
```

Verified with `adb shell settings get secure enabled_notification_listeners`. All eight runtime
permissions survived `adb install -r` untouched, so the whole grant surface for Phase 4 is now
reachable without opening Settings once.

### Defect 30 — the Mac cannot start a new SMS conversation — **open, deferred again 2026-08-28**

**Found 2026-08-28 while planning step 58.** Severity: Medium. Not a bug in what is built; a hole
in what is built.

`SmsClient.send(threadId, body)` resolves its recipients from the thread rows it already holds and
refuses any thread it has not listed. The phone independently refuses a send carrying a `threadId`
with no `addresses` (`SmsFeature.kt:173-177`). Both refusals are correct and are the send rule
doing its job — see the send-rule section in `docs/protocol.md`, clause 2.

The consequence is that **there is no path to a conversation that does not already exist.** The
pane has no compose-new affordance, `send` has no signature that accepts a bare address, and
`docs/protocol.md` clause 5 explicitly allows the shape that would support it — *"`threadId` may be
omitted only for a genuinely new conversation, where `addresses` is the only source of truth and
there is nothing to disagree with"* — which this build does not implement.

So the protocol already anticipated this and the Mac has not caught up. That is the honest framing:
not a defect in the send rule, an unimplemented branch of it.

**Deferred, not fixed.** Building a compose-new flow mid-hardware-run is scope creep, and the
guard it would have to relax is the one guard in Phase 4 protecting an outcome that cannot be
undone. It deserves its own sitting, with its own tests, and with the `threadId`-omitted shape
implemented deliberately rather than by loosening the existing path.

Whoever picks it up: the danger is implementing it by making `send` tolerate a missing thread,
which would reopen the exact hole clause 2 closes. The correct shape is a *separate* entry point
that takes addresses and no `threadId`, so the two cases cannot be confused by a caller.

**Deferred again 2026-08-28**, deliberately and explicitly, when 34, 35, 36 and 31 were fixed in
one sitting. It was left out because it is the only one of the seven that is a *feature* rather
than a repair: nothing it touches is currently wrong, and the guard it must relax is the one guard
in Phase 4 protecting an outcome that cannot be undone. The fix direction above is unchanged and
is the whole brief — a separate entry point taking addresses and no `threadId`.

## Step 46 — **PASS**, closed 2026-08-28

Open for two sessions as "the reply crossed the link, but nobody confirmed it arrived in the app".
Closed by reading the phone rather than the Mac, which is the only side that can settle it.

**What was found.** WhatsApp's self-chat, via `uiautomator dump` — no coordinate guessing, the
message located by its own node:

```
text   : 'Step 46 reply sent from the Mac'
bounds : [449,2236][1362,2344]
sibling: text='11:07 AM'  desc='Read'
```

**The control, for a presence claim.** Per the rule, a presence is judged on what matched, not on
a count: the matched node is quoted above in full. The surrounding surface was checked too — the
dump held 4 `message_text` nodes and 109 nodes overall, so the query was reading a live chat rather
than a single lucky hit.

**The discrimination that actually closes it.** "The text is in the chat" does not prove the *Mac*
put it there; anybody could have typed that sentence on the phone. Two independent facts do:

| Fact | Source |
|---|---|
| `notif.reply delivered (reply to com.whatsapp) — 1 delivered / 0 refused` at **11:07:36** | phone `link.log` |
| the message carries **11:07 AM** | WhatsApp UI dump |
| the row is **outgoing** — right-aligned at x=449 and carrying a delivery `status` of `Read`, where the incoming row in the same chat sits at x=63 with no status | WhatsApp UI dump |

Same minute, same package, and the row has the shape only a sent message has. An inline reply
delivered through the notification's own `RemoteInput` and `PendingIntent` appears exactly this
way — as a message from the account, indistinguishable from one typed on the phone, which is the
point of using the app's own reply action rather than simulating one.

**Step 46 therefore passes on the clause that matters**: *"Reply appears in the app exactly as one
typed on the phone would."*

### Defect 31 — the media card never learns about changes made on the phone — **fixed 2026-08-28, awaiting step 67**

**Found during step 64, 2026-08-28.** Severity: Medium. The remote works; it is only ever *right*
about state the Mac itself caused.

`RemoteFeature.attachSessionListener` registers the `OnActiveSessionsChangedListener` and the
controller callback that produce every unsolicited `remote.state`. It runs **inside `install()`**
and returns early when `available(context)` is false — that is, when the notification listener is
not bound. It is never retried. So on any run where the app starts before notification access is
granted, the push path is silently absent for the life of the process.

That is exactly what a reinstall produces, and the phone said so at the time:

```
15:35:07 I [remote] Media remote installed; listener is not bound; capabilities now: [calls, contacts, mirror, sms]
```

`cmd notification allow_listener` re-enabled the grant a moment later, `remote` began being
advertised, and the capability chip lit — over a feature whose push half was already dead. **The
capability is honest about the grant and silent about the wiring behind it**, which is the same
shape as a green chip over a `call.dial` that cannot work, one gate up.

**Proof, with the control taken first.** The phone was made to change state with no Mac command in
play, using media key events rather than the UI:

| | Phone (truth, `dumpsys media_session`) | Mac (belief) | Mac `[remote]` log lines |
|---|---|---|---|
| before | `PAUSED(2)` | `playing: false` | 93 |
| after `KEYCODE_MEDIA_PLAY` | **`PLAYING(3)`** | **`playing: false`, "Paused in Spotify."** | **93** |

The line count is the control that makes the divergence mean something: it is unchanged, so this is
not a slow push or a dropped frame — **no push was ever sent**. The first half of the test, pausing
on the phone, was deliberately not treated as evidence: the Mac already believed "paused", so
agreement there would have been a coincidence rather than a result.

**Why step 64 still passes.** The step asks that the card follow *the Mac's transport controls*,
and it does — 16 commands, 0 refused, worst command-to-card latency 5.0 ms against a 1000 ms
budget. Every one of those pushes comes from the explicit `pushState(context)` at the end of
`onCommand`, which does not go through the session listener at all. That is why the feature looks
completely healthy from the Mac side and is half-wired underneath.

**The fix is small and is not being made mid-run.** `NotificationFeature` already knows the moment
the listener binds — it is what flips the capability — so `attachSessionListener` needs calling
again from there, and `install()` needs to stop being the only place it can happen. Deferred to its
own sitting with the same reasoning as defect 30: a change to the phone's session wiring wants its
own build, its own reinstall, and its own re-verification of the grant surface, not a rebuild in
the middle of a hardware run that is measuring something else.

**Workaround while it stands:** reconnect the link. The phone replays `remote.state` to each
session as it becomes ready (`addSessionReadyListener`), which is a different path and works — it
is what populated the card for step 64 in the first place.

### Defect 32 — the SMS pane cannot reach a conversation older than its first page — **open, deferred again 2026-08-28**

**Found 2026-08-28 setting up step 58.** Severity: Low-Medium. Honest, and still a dead end.

`sms.threads` is requested with `limit: 50` and the pane draws what comes back, newest first. When
`hasMore` is true the note says so — *"Older conversations are not shown."* — which is the honest
thing to print and is exactly where it stops: **there is no affordance to load the next page.**
`loadOlder` exists for messages *within* a thread and has no counterpart for the thread list
itself.

Found the way gaps like this usually are, by needing it. Step 58 was to be run by sending to the
user's own number. The self-thread does exist:

```
Row: 18198  thread_id=594, address=919800000001, type=1, date=1614582239661   → 2021-03-01
```

with **18,198 of 22,167 messages newer than it**. So it sits thousands of rows below a 50-row
first page, the pane cannot page down to it, and `SmsClient.send` correctly refuses a thread it has
not listed — the send-rule guard doing its job on a thread that is real and simply unreachable.

Note this is a *different* hole from defect 30, and the two together are worse than either alone:
30 says a conversation that does not exist cannot be started, 32 says one that does exist cannot be
reached if it is old. Between them, the set of conversations the Mac can send to is exactly "the
50 most recent".

**Deferred.** The fix is a pager on the thread list — `before` is already in the protocol and
already implemented on the phone (`sms.threads` takes it), and `SmsClient.listThreads` already
accepts it and already merges rather than replaces, which was tested for this reason. It is a
renderer affordance and nothing more, but it is not being added mid-run.

**Workaround, used for step 58:** send one SMS to the number from the phone, which moves its thread
to the top of the list where the pane can see it.

**Deferred again 2026-08-28**, alongside 30 and 33, while 34/35/36/31 were fixed. Left out because
it is renderer work with no phone half, so it does not need — and cannot share — the APK build that
sitting was for. The fix direction is unchanged and is already half-built: `before` is in the
protocol, the phone implements it on `sms.threads`, and `SmsClient.listThreads` already merges
rather than replaces. What is missing is the affordance.

### Step 65 — **PASS**, run against Previous rather than Next — 2026-08-28

**The deviation, and why it is not a weaker test.** Step 65 asks for Next in an app that does not
allow it. No session on this device advertises a missing `SKIP_TO_NEXT`. Read live and stable
across three samples two seconds apart:

| Session | `actions` | `SKIP_NEXT` | `SKIP_PREV` |
|---|---|---|---|
| `com.spotify.music` | 404403 | allowed | allowed |
| `com.sec.android.app.music` | 2481023 | allowed | allowed |
| `com.google.android.youtube` | 8615 | **allowed** | **NOT allowed** |

So Next-as-written is **untestable on this device**, and the control above is what proves it rather
than an assumption. YouTube forbidding `SKIP_TO_PREVIOUS` exercises the identical guard: the same
`RemoteFailure.Unsupported`, the same `FEATURE_UNAVAILABLE`, the same three-layer chain, differing
only in which bit of `PlaybackState.actions` is read.

A first pass at this decoded a **stale** bitmask — `404403` hardcoded from an earlier read while the
live value had momentarily become `141827` mid-track-change, which would have reported "Spotify
forbids skip" and been wrong. Reading it live, three times, is what caught it. A bitmask copied out
of a previous command's output is a remembered pixel by another name.

**All three layers of the guard, exercised:**

1. **Renderer.** The Previous button is drawn `disabled`, carrying its reason in the accessible
   name rather than in colour alone (defect 26's rule):
   `" — unavailable: YouTube does not allow skipping to the previous track from a remote."`
2. **Main process.** `RemoteClient.command` refuses on `canSkipPrevious === false`. Reached by
   calling `window.connect.remoteCommand('previous')` directly, past the disabled button — the same
   technique step 49b used — with `bypassRemoteGuard` on so the request could continue.
3. **Phone.** Answered:
   `{ ok: false, code: "FEATURE_UNAVAILABLE", reason: "com.google.android.youtube does not let anything skip to the previous track from outside the app." }`

**The positive control, taken in the same breath.** A refusal proves nothing if every command is
failing, so an *allowed* command went over the same channel to the same session at the same moment:

```
previous     -> { ok: false, code: FEATURE_UNAVAILABLE }
play_pause   -> { ok: true }      <- control
play_pause   -> { ok: true }      <- control
```

1 refused / 2 delivered. The refusal is specific to the action, not to the link.

**Card correctness noted in passing.** Before the reconnect the card said Spotify; after it, YouTube
— defect 31 demonstrating itself again, since the phone's switch to YouTube produced no push.

### Defect 33 — the phone names packages where it means apps, in sentences users read — **open, deferred again 2026-08-28**

**Found inside step 65's own result, 2026-08-28.** Severity: Low-Medium. Same family as defect 28,
different mechanism, and not fixed by 28's fix.

Defect 28 was `appNameFor` failing to resolve a label. This is the opposite: sites that never asked
for a label at all. The failure constructors interpolate the raw package straight into the sentence:

```kotlin
class Unsupported(what: String, packageName: String) : RemoteFailure(
    reason = "$packageName does not let anything $what from outside the app.",
)
```

Known sites, all of them user-facing:

| Site | Call sites |
|---|---|
| `RemoteFailure.Unsupported` | 3 — next, previous, seek |
| `NotificationFailure.NoReplyAction` | 2 |
| `NotificationFailure.IntentRefused` | 2 |
| the target-stale sentence, `"$seen" but ${sbn.packageName} now has "$now"` | 1 |

**This was already in the record and went unread.** Step 49b's own recorded pass, from earlier the
same day, quotes the phone answering:

> `reason: "That notification from com.android.shell does not offer a reply, so there is nothing
> for the phone to type into."`

It was recorded as a pass — correctly, since the step was about the refusal code — and the package
name sat in the quoted sentence with nobody reading it as a defect. Evidence in hand is not the
same as evidence read.

**Mostly invisible in normal use, which is why it will survive.** The Mac composes its own sentence
from the card's `appName` and refuses first, so a user sees "YouTube does not allow…". The phone's
version surfaces only when the Mac's guard is bypassed or its card is stale — exactly the moments
when the Mac's copy is the thing not to be trusted.

**Deferred**, with 30, 31 and 32: it is a phone change wanting its own build, reinstall and grant
re-verification, not a rebuild in the middle of a run measuring something else. The fix is to pass
`AppLabels.of(context, packageName)` at each site, which now exists precisely for this.

**Deferred again 2026-08-28.** This one *could* have ridden the 34/35/36/31 build — it is a phone
change and that sitting produced a phone build — so the reason it did not is worth stating rather
than leaving as an omission. It is eight call sites across three files with no test that would go
red for any of them, in sentences a user sees only when the Mac's own guard has been bypassed. Put
into a build whose four other changes each needed a specific hardware step, it would have added
surface to re-verify and nothing to measure. The fix direction is unchanged: `AppLabels.of` at all
eight sites listed in the table above, and it wants a test that a failure sentence contains no
`.`-separated package-shaped token, or it will regress the same way twice.

### Step 66 — **PASS** — 2026-08-28

**Control first.** "Nothing is playing" is only evidence if something was playing a moment earlier.
`dumpsys media_session` reported **3 sessions with a playback state** before, and **0** after the
three media apps were stopped. Note that a *paused* session still counts — `activeController` falls
back to `sessions.first()` — so all three had to go, not only the playing one.

| Clause | Result |
|---|---|
| phone answers `NO_MEDIA_SESSION` | **PASS** — `{ ok: false, code: "NO_MEDIA_SESSION", reason: "Nothing is playing on the phone, so there is nothing to control." }` |
| empty remote card, **not** an error state | **PASS** — card visible, note "Nothing is playing on the phone.", body empty, notice hidden, no error styling |
| the feature is not marked broken | **PASS** — the `remote` chip stayed lit before and after the refusal |

Reached with `bypassRemoteGuard`, because the Mac refuses a transport command with no session
before it can cross the link. Worth noting what that means for a real user: with the switch off
there is no way to reach this path at all, since an inactive card draws **no transport buttons**.
That is the step's own expectation satisfied structurally rather than by a message — there is
nothing to press, so there is nothing to be refused.

#### Method note — the no-force-stop hook fired on prose, not on a command

Writing the paragraph above was refused by `scripts/hooks/no-force-stop.sh`, because the heredoc
carrying it contained the phrase the hook matches. The three real stops in this step were on
`com.google.android.youtube`, `com.spotify.music` and `com.sec.android.app.music` — third-party
packages, correctly allowed — and the blocked call executed no `adb` at all.

A false positive, and a cheap one: the cost was rewording a sentence, and the failure mode is the
safe direction. Recorded because the hook's own section in this file argues that a rule needs an
enforcement point, and this is what living with one looks like — it will occasionally catch you
writing *about* the thing it guards. Worth tightening only if it starts costing more than a
rewrite; matching a command's argument vector rather than its raw text would do it.

### Defect 34 — `sms.received` is dropped by the Mac: the phone sends a shape the contract does not describe — **fixed 2026-08-28, awaiting step 68**

**Found during step 58, 2026-08-28.** Severity: **High.** Inbound SMS never reaches the Mac's pane.
This is the one Phase 4 defect that breaks a feature outright rather than degrading it.

`docs/protocol.md` specifies the event as *"carrying exactly one `messages[]` entry plus its
`threadId`"*:

```json
{"threadId":"42","messages":[{"id":"…","address":"…","body":"…","inbound":true, …}]}
```

`SmsStore.receivedPayload` builds it **flat** instead — `threadId`, `address`, `body`, `dateMs`,
`inbound`, `read`, `kind`, `hasAttachments`, `contactName` all at the top level, with no `messages`
array and no `id`. `SmsClient.onReceived` reads `rows(payload, 'messages')[0]`, finds nothing, and
drops the event with a line:

```
phone  I [sms] sms.received pushed (2 since start) — 9 delivered / 0 refused since start
Mac    W [sms] Dropped an sms.received with no thread or no message
```

**Both sides logged, and that is the only reason this was caught** — exactly as with defect 29. The
phone says it pushed; the Mac says it dropped. Either line alone reads as normal.

**Who is wrong.** `CLAUDE.md` is explicit that `docs/protocol.md` is the contract and that changes
go there first, then to both sides. The doc and the Mac agree; **the phone does not implement the
documented shape.** The fix belongs on the phone: wrap the message object in a `messages` array and
add the `id`. The Mac must *not* be made lenient — that is precisely the leniency defect 29's second
test exists to forbid, and it would leave the two sides permanently disagreeing about a shape while
appearing to work.

A second, smaller thing in the same function: `threadId` is deliberately omitted when the provider
has not yet written the row (`threadIdFor(context, address)?.let { … }`), with a comment explaining
that an absent id is more honest than a fabricated one. That reasoning is sound, but the Mac's
`onReceived` requires `threadId` and drops the event without one, so the honest omission is also
unhandled. Whoever fixes the shape should decide what the Mac does with a thread-less received
message rather than leave it dropping silently — showing it against the address is the obvious
answer, since the address is always present.

**Step 59 fails on this.** *"Receive an SMS while connected → `sms.received` arrives with the
contact's name when contacts is granted, and the bare number when it is not — never blank."* The
event never arrives at all, so neither state can be observed.

**A correction to this file.** An earlier row in the steps-45-54 table recorded "Step 59, both
states — PASS" on the strength of 50 thread rows attributing correctly (1 by `contactName`, 49 by
`addresses[0]`, 0 by neither). That measurement is real and still stands, but it measured
`sms.threads`, **not** `sms.received` — a different message, a different code path, and not what
step 59 asks about. The row has been struck through and corrected in place rather than deleted, so
the mistake stays visible. It is the same error class this file keeps recording: a query that
could not tell its target from something resembling it, answered confidently.

## Steps 58, 58a, 58b, 58c — run 2026-08-28

Run against the user's own number, so one step exercises the send path and the receive path.
Reaching the thread at all needed the workaround from defect 32: the self-thread existed but sat
thousands of rows below the pane's 50-row first page, so an SMS sent from the phone moved it to
position 0.

### Step 58 — **PASS**, both halves

| Half | Evidence |
|---|---|
| ordinary send | provider rows `_id=22183 type=2` (sent) and `_id=22184 type=1` (delivered back), same body. Phone: `sms.send delivered (to 1 verified recipient(s))` |
| **over 160 characters** | body **329 chars = 3 GSM segments**, and the provider holds **1 sent row and 1 inbox row, not 3 of each** |

The second row is the clause: *one message sent, one message reported*. `divideMessage` split it for
the radio and it reassembled into a single provider row on both sides. Counting the rows is what
distinguishes that from three separate messages, which is the failure the step exists to catch.

### Step 58a — **PASS**, and nothing reached the radio

`forceRecipientMismatch` on, so the Mac sent thread 594 paired with the reserved probe number.

```
{ ok: false, code: "RECIPIENT_MISMATCH",
  reason: "That message was not sent: it named +15550100 but that conversation is with
           +919800000001, 919800000001.",
  fixHint: "Nothing was sent to anyone. …" }
```

**The refusal names both numbers**, which is the clause — only the user can tell which of the two
is the stranger.

**Severity, checked on both sides.** The step requires an `e:` line, because every other refusal in
this project is a feature declining and this one is a prevented harm:

```
phone  E [sms] REFUSED a send that would have gone to the wrong recipient: thread 594 holds
                +919800000001,919800000001 but the request named +15550100
phone  W [sms] sms.send refused: recipient-mismatch — 16 delivered / 1 refused since start
Mac    E [sms] sms.send REFUSED as a recipient mismatch in thread 594 — nothing was sent to anyone.
```

Note the `w:` line beside the `e:` one carries the ratio, so the severity and the denominator are
both present.

**Nothing was sent — proven, with the control first.** The provider was read whole and counted:

| Query | Rows |
|---|---|
| **CONTROL** — provider rows parsed | **22,175** |
| **CONTROL** — rows for the step-58 sends that *did* go | **4** (2 sent, 2 received) |
| rows containing the 58a body | **0** |
| rows addressed to `+15550100`, ever | **0** |

The two control rows are what make the two zeros mean something: the same query, over the same
data, finds four messages it should find. Without them "0 rows" is indistinguishable from a query
that cannot see the provider at all — which it briefly was, when `ugrep`'s `-c` returned empty
strings and the first attempt at this table printed three blanks. Counting in Python fixed it.

### Steps 58b and 58c — **untestable through the Mac, covered by the phone's suite**

Neither is reachable from this build: `SmsClient.send` takes no addresses, so the Mac cannot
construct a send whose recipients are unreadable (58b) or differently formatted (58c). That is the
send rule working as designed and it is also what puts these two out of hardware reach.

Both are covered by `SmsSendRuleTest` in `:sync-module`, **run for this record: 11 tests, 0
failures**:

| Step | Test |
|---|---|
| 58b | `a thread whose recipients cannot be read is refused, not trusted` |
| 58c | `the same number written two ways is one recipient` · `normalisation strips formatting and nothing else` |
| — | `two numbers that merely end alike are two numbers` — the over-lenient direction 58c must not cause |

Recorded as **untestable-with-proof plus automated coverage**, not as deferred: the behaviour is
verified, on the side that implements it, and the reason hardware cannot reach it is a guard this
project put there on purpose.

## Steps 63 and 61 — run 2026-08-28, both **PASS**

Run together on one call, which is possible because an *outgoing* call raises a card:
`CallWatcher` maps off-hook-without-prior-ringing to `begin(server, "dialing")` (`CallWatcher.kt:156`).
That is what makes 61 runnable without a second person.

### Step 63 — **PASS**

Two clicks, one call. The first click armed and placed nothing (`callPlaced: false`, button read
`Confirm — call +919800000003`); the number was confirmed with the user before the second click.

```
Mac    I [calls] call.dial placed to +919800000003 — 0 rang / 0 ended / 1 acted on / 0 refused
phone  I [calls] call.dial delivered (dialled) — 7 delivered / 0 refused since start
phone  I [calls] Call c1 dialing (1 episodes since start)
```

The card appeared within 3.5s in state `dialing`, the notice read "Calling +919800000003 from the
phone.", and the button **disarmed itself back to `Call`** after use — a confirmation that stayed
armed would be a second call waiting to happen.

### Step 61 — **PASS**

```
16:18:54.413  W [calls] stallCallEnded: swallowing call.ended for c1 — the card is now stale on purpose
16:18:58.098  W [calls] call.reject refused by the phone for c1: There is no call to reject —
                        the phone is not ringing and no call is in progress.
                        — 1 rang / 0 ended / 1 acted on / 1 refused since launch
```

**The clause that matters is `for c1`.** The request named the call the card was showing. The
protocol allows an omitted `callId` meaning "the call in progress", and this client never sends
that shape — which is the entire mechanism by which a stale Reject cannot land on somebody else's
call.

**Honest limit on this run.** The step's second clause — *"It must not reject the next call that
comes in"* — was **not** demonstrated on hardware, because no second call existed to be wrongly
rejected. What was demonstrated is the mechanism that prevents it: the id is sent, and the phone
refused on that id. The retargeting itself is covered by `calls.test.ts`
(`a stale card rejects the call it shows, not the one now ringing`), mutation-checked against the
omitted-id implementation, where it fails. Recorded this way rather than claiming the hardware run
proved something it did not.

The pane also behaved correctly afterwards: the `NO_ACTIVE_CALL` refusal took the stale card down,
so the same dead id cannot be clicked again, and the call log reloaded (`50 entries, 43 with a
contact name`).

### Defect 35 — an outgoing call's card is labelled with nothing at all — **fixed 2026-08-28, awaiting steps 69 and 70**

**Found inside step 63's own log line, 2026-08-28.** Severity: Low-Medium.

```
I [calls] call.incoming c1 (dialing) from , no contact name
```

Note `from ,` — the number is the empty string. Android reports no identity for an *outgoing* call
through `PHONE_STATE`, so `CallWatcher` has nothing to put there, and the phone sends `number: ""`.

The Mac then draws it blank. `CallsView.renderLive` uses
`this.call.contactName ?? this.call.number ?? 'Unknown number'`, and `?? ` does not catch an empty
string — `"" ?? x` is `""` — so the fallback chain that exists precisely to prevent a blank label
walks straight past it. This is the same "never blank" rule the SMS pane enforces for step 59, and
it fails here for a reason step 59 could not have caught: an *empty* value rather than an absent one.

Both halves want fixing, and they are independent:

- **Mac:** the fallback must test for emptiness, not just nullishness. A one-line change, and it
  makes the pane honest against any phone.
- **Phone:** `call.dial` knows the number it just dialled and could pass it into the episode, so a
  Mac-initiated call could show who is being called rather than "Unknown number". A genuinely
  unknown inbound number would still fall back.

Fixing only the Mac turns a blank into "Unknown number", which is honest but poor: the Mac dialled
that number seconds earlier and is the one machine that certainly knows it.

## Step 60 — **PARTIAL** — 2026-08-28

Run on a real inbound call from a second person, with `stallCallEnded` confirmed disarmed by
reading the running process's environment (`ps eww`, 53 vars readable, `HOME` found by the same
grep, `CONNECTSUITE_DEBUG_SWITCHES` absent) rather than by trusting the log.

| Clause | Result |
|---|---|
| `call.incoming` on the Mac | **PASS** — `c3`, `state: "ringing"`, card shown with both `call-answer` and `call-reject` drawn |
| reject ends it | **PASS** — clicked by name; phone logged `call.reject delivered (rejected)`; card cleared in **609 ms** and the live card hid itself |
| `call.ended` with disposition **`rejected`** | **FAIL** — the Mac received `call.ended c3 **missed** after 0s` |

The audio disclaimer was drawn on the card as intended: *"Audio stays on the phone — pair the Mac to
it over Bluetooth to listen through the Mac."*

### Defect 36 — a call rejected from the Mac is reported as `missed` — **fixed 2026-08-28, awaiting step 70**

Severity: Medium. The action succeeds and is then described wrongly, which is worse than a visible
failure: the call log the user reads afterwards disagrees with what they did.

`CallWatcher` derives the disposition from the state transition alone — a call that was `ringing`
and became idle without being answered is recorded as `missed`. It has no way to know a
`call.reject` was the cause, because `CallFeature.onReject` calls `telecom.endCall()` and never
tells the watcher that it did.

**The platform had the right answer and was not asked.** Android's own call log recorded the same
call as `type=5`, which is `CallLog.Calls.REJECTED_TYPE`:

```
16:33:45  type=5  number=+919800000003      <- platform: REJECTED
Mac       call.ended c3 missed after 0s     <- ConnectSuite: missed
```

That contrast is the whole defect, and it is only visible because both were read.

**Fix direction:** `CallFeature.onReject` should mark the episode as rejected before ending it —
a flag on `CallWatcher` set at the moment the reject is issued and consumed by `end()`, mirroring
the `answered = phase == "dialing"` flag that already exists there for the outgoing case.

**The wrong fix** is to read the disposition back out of the call log after the fact. It looks
authoritative — the platform's own value — and it is a race: `call.ended` is emitted from the state
transition, and the provider row may not be written yet, so it would work in testing and return
`missed` or nothing under load. The watcher knows why the call ended at the moment it ends; that is
where the fact belongs.

> **The wrong fix was not hypothetical. It had shipped.** Noted on 2026-08-28 while deleting it.
>
> `CallWatcher.loggedDisposition(context)` was already in the tree, called from `end()`'s
> `wasRinging` branch, doing exactly what the paragraph above forbids: a fresh
> `CallLogStore.entries(context, 1, null)` mapping `"rejected" -> "rejected"` and everything else
> to `"missed"`. It was reachable, it ran on every rejected call, and **`missed` is what it
> returned on hardware** — the row was not written yet, so it read the previous call or nothing
> and fell through its own `else`.
>
> This matters for how the defect reads. It was recorded as "the watcher has no way to know a
> `call.reject` was the cause", which is true of the *transition* and reads as though nobody had
> tried. Somebody had, with the answer that looks right, and the failure is the more interesting
> one: a value taken from the platform's own records, correct in every offline test, wrong at the
> only moment it is consulted. A racy read does not fail loudly — it returns a plausible answer,
> which is why it survived a code review and a hardware run.
>
> It is deleted, not repaired. `dispositionOf(answered, rejected, wasRinging)` is pure, takes no
> `Context`, and cannot reach a provider. `newestLogged` stays, because reading the *number* from
> the log at the same moment is safe — the fallback only has to be right eventually, and a wrong
> number shows as an unknown caller rather than as a false fact about what the user did.

### Defect 35, widened — the call card has **no number in either direction**

Recorded first against an outgoing call, where Android genuinely supplies no identity. The inbound
call proves it is broader than that:

```
Mac    I [calls] call.incoming c3 (ringing) from , no contact name
card   who: ""    lines: ["Ringing · ", …]
log    16:33:45  type=5  number=+919800000003        <- the platform had it
```

So an **inbound** ringing call also arrives with `number: ""`, and the card renders blank — while
the platform's call log holds the number, and `READ_CALL_LOG` and `READ_PHONE_STATE` are both
granted. This is not "Android will not say"; it is the phone not asking.

> **Correction, made while fixing this on 2026-08-28.** The sentence that stood here said the
> number arrives "through `TelephonyCallback`/`onCallStateChanged`'s number parameter only for a
> caller holding `READ_CALL_LOG`". **There is no such parameter.**
> `TelephonyCallback.CallStateListener.onCallStateChanged(int)` — the API 31+ path this app
> registers, and the only one that runs above API 30 — takes a state and nothing else. A session
> reading the original sentence would go looking for an argument that does not exist, find the
> deprecated `PhoneStateListener.onCallStateChanged(int, String)` overload that does take one,
> and wire up a listener that never fires on this device.
>
> The real path is the `android.intent.action.PHONE_STATE` broadcast's `EXTRA_INCOMING_NUMBER`,
> which the platform fills only for a receiver holding `READ_CALL_LOG` — which the `calls`
> capability already requires, along with the other three. That is what the fix registers, at
> runtime in `CallWatcher.start` rather than in the manifest.
>
> The correction is left in place rather than swapped for the right sentence, because the wrong
> one was written confidently from a plausible memory of the deprecated API and would be written
> again the same way.

Both halves of the earlier note still hold, and the inbound case adds a third:

- **Mac:** the fallback must test emptiness, not nullishness — `"" ?? x` is `""`, which is why
  `contactName ?? number ?? 'Unknown number'` produces a blank rather than the fallback it was
  written for.
- **Phone, outgoing:** `call.dial` knows the number it dialled and should pass it into the episode.
- **Phone, inbound:** the number must be read where the platform will give it, so `contactName`
  resolution through `ContactsFeature.nameFor` has something to resolve — the whole reason contacts
  was pulled forward into this phase.

**The wrong fix** is Mac-only. It turns a blank into "Unknown number" on every call, which reads as
honest and is in fact a regression in disguise: it hides a phone-side data gap behind a plausible
label, and the contacts integration — the thing this phase moved a feature forward to enable —
silently never fires.

## Steps 62 and 55 — run 2026-08-28, both **PASS**

### Step 62 — **PASS**

Real inbound call from a second person, answered from the Mac by its named button.

| Clause | Result |
|---|---|
| answers **on the phone** | **PASS** — phone: `call.answer delivered (answered — audio stays on the phone)` |
| the Mac says so | **PASS** — card moved `ringing → active` in **614 ms**; card cleared when the call ended 18.7 s later |
| disposition | **PASS** — `call.ended c7 **answered** after 5s` |
| platform control | `type=1 (INCOMING) dur=3s` and `dur=18s` — the calls genuinely connected |

**This is the contrast that proves defect 36's fix direction.** `answered` is reported correctly
because `CallWatcher` already carries a flag for that path (`answered = phase == "dialing"`, plus
the ringing→offhook transition). `rejected` is reported as `missed` because it has no equivalent
flag. The mechanism that works for one is exactly the mechanism missing for the other.

The card was captured as drawn while ringing — both buttons present, and the audio disclaimer
below them. `cardWhileActive` came back empty in the probe output only because it was read after
the loop exited, by which time the call had ended; that is a probe artifact and not a finding.

### Step 55 — **PASS**

Thread `1401`, chosen by counting the provider: **2,117 messages**, one of 4 threads over 500 and
16 over 200, out of 2,804 threads and 22,175 messages.

| Clause | Result |
|---|---|
| pages of ≤200 | **PASS** — `limit: 500` refused with `BAD_REQUEST`, *"limit must be between 1 and 200"* |
| `hasMore` true until the end | **PASS** — 4 consecutive pages, all `count: 200`, all `hasMore: true` |
| paging actually advances | **PASS** — oldest timestamp strictly decreasing: 1670509415286 → 1661768921003 → 1649168376242 → 1635330750915 |
| no 16 MiB frame | **PASS** — the cap makes one unconstructable |

The third row is the one that matters and is easy to omit: four pages of 200 with `hasMore: true`
would look identical if `before` were ignored and the same first page returned each time. The
strictly decreasing timestamps are what distinguish real paging from a loop.

### Step 54 — remains **PARTIAL**

The `ongoing` dimming rule is proven (`.notif-row.ongoing { opacity: 0.62 }`, charging notification
renders dimmed rather than hidden). A true media-player notification was still never captured: at
the close of this run the shade held **25 notifications across 6 categories with 6 ongoing** — so
the field is alive — but `categoriesPresent` was `call, sys, none, service, msg, reminder`, with no
`transport` entry, because the media apps had been stopped for step 66 and not relaunched.

Recorded as partial rather than passed. The control is the 25-notification enumeration: the query
can see the shade, and there is genuinely no media notification in it.


## Fix sitting — defects 34, 35, 36 and 31 — 2026-08-28

One Android build, four defects, plus two Mac files. Nothing else was touched and **Phase 5 was not
started.** Defects 30, 32 and 33 stay deferred with their fix directions unchanged — see their own
sections, each now marked *deferred again 2026-08-28*.

Two records were corrected in place rather than rewritten, both quoted in their own sections: the
mechanism 35c was blamed on (`TelephonyCallback` has no number parameter), and the fact that
defect 36's *wrong fix* was already shipped in the tree rather than hypothetical.

### What changed

| Defect | Phone | Mac |
|---|---|---|
| **34** | `SmsStore.receivedPayload` builds the contract shape — `{threadId, messages:[{id, …}]}` — from a **single** provider query returning `_ID` and `THREAD_ID` together. `SmsFeature.onReceived` is now `suspend` and looks **3× at 150 ms** for the row before giving up, and **refuses to push at all** if it never appears. The pure builder moved to a new `SmsPayloads` object. | The drop path stays strict. Its log line splits into three causes with the tally beside it. |
| **35** | `call.dial` hands its number to `CallWatcher.expectOutgoing` **before** placing the call; a runtime `PHONE_STATE` receiver supplies the inbound one; `contactName` is resolved once per episode. The three hardcoded `put("number", "")` sites collapse into one `incoming()` builder. | `firstNonEmpty` replaces `??` in both the live card and the log rows, and the status line drops its ` · ` when there is no number. |
| **36** | `CallWatcher.rejectRequested`, set by `CallFeature.onReject` before `endCall()` and cleared if it throws. `loggedDisposition` **deleted**. `dispositionOf` is pure and ordered `answered → rejected → missed → declined`. | — |
| **31** | The media-session listener is held in a field, is idempotent, and is attached from `NotificationMirrorService.onListenerConnected` beside the capability refresh — and detached on disconnect so a regrant re-attaches. | — |

### Tests added, and each shown to fail against its defect

The rule is that a new test must be watched going red against the bug it is named for. All five
were, by reintroducing the defect and reverting:

| Test | Reintroduced defect | Result |
|---|---|---|
| `sms received carries its message inside a messages array` | flat payload restored | `AssertionError: sms.received must carry a messages[] array` |
| `a call rejected from the Mac is reported as rejected, not missed` | `rejected ->` branch removed | `ComparisonFailure: expected:<[reject]ed> but was:<[miss]ed>` — **the exact symptom from step 60** |
| `an empty number falls through to Unknown number, as ?? never did` | `??` chain restored | red |
| `whitespace is empty, because a card of spaces is still blank` | same | red |
| `the status line drops its separator when there is no number` | unconditional `${label} · ${number}` restored | red |

**And the controls held.** `a real number or name still wins over the fallback` and `the status
line keeps its separator when there is one` stayed **green** through both reintroductions. A
fallback that fires for everything would satisfy the first three tests perfectly and be a worse
pane than the blank; the controls are what separate "fixed" from "always says Unknown number".

Two more phone tests exist purely as controls and were never expected to move:
`every other disposition still answers, and answered outranks rejected` pins all four branches, so
"rejected now works" cannot be bought by breaking `answered` or `missed`.

Suite totals after the fix: **158 phone unit tests, 0 failures** (`core` 58, `sync-module` 25,
`mirror-module` 31, `input-module` 44) and **54 Mac tests, 0 failures**, up from 48 — the six new
ones are the five above plus `firstNonEmpty is the rule the rest of the pane can reuse`.

### A note on where the two new test seams came from

Both were forced by the same wall, on both sides of the link, and it is worth recording because it
will happen again.

`Phase4ContractTest` could not call `SmsStore.receivedEnvelope` at all: `SmsStore` holds
`Telephony.MmsSms.CONTENT_CONVERSATIONS_URI` in a field initializer, so a JVM unit test merely
*referencing* the object throws `ExceptionInInitializerError` off the Android stubs. The first run
of the new test failed that way rather than on its assertion. The answer was not
`returnDefaultValues = true` — which would have made every Android call in the module silently
return null — but moving the pure builder to `SmsPayloads`, an object with nothing Android in it.

`CallWatcher.dispositionOf` is `internal` and pure for the identical reason.

This is `CLAUDE.md`'s Mac rule — *prefer making the code testable over mocking Electron* — turning
out to apply unchanged on the phone, with `Telephony` in the place of Electron. `src/shared/` and
`SmsPayloads` are the same idea.


### Defect 37 — a re-granted notification listener never turns its capabilities back on — **open, found blocking step 67 on 2026-08-28**

**Found by the user reading a caps line, not by the step it interrupted.** Severity: **High.** Two
working features are advertised as unavailable, and nothing ever corrects it.

Revoking and re-granting notification access — precondition 2 of step 67, the case defect 31's fix
exists for — leaves the phone advertising five capabilities when seven are live:

```
17:14:50.163 I [notif]  Notification listener detached; notifications capability is off
17:14:50.169 I [caps]   Capabilities now: calls,contacts,input,mirror,sms
17:14:50.170 I [remote] Media session listener detached: notification access went away
17:14:57.000 I [notif]  Notification listener attached to the link
17:14:57.002 I [caps]   Capabilities unchanged (calls,contacts,input,mirror,sms); reason changed:
                        notifications — missing Notification access; remote — missing Notification access
17:14:57.003 I [remote] Media session listener attached; phone-side changes will now reach the Mac
```

Read `.002` against `.000` and `.003`. The listener **is** bound and the media-session listener
**is** attached — defect 31's fix working exactly as designed — and the capability line says
`missing Notification access` for both. **This is defect 31 inverted**: 31 was a lit chip over dead
wiring, this is a dark chip over live wiring. Both are the capability set disagreeing with reality,
and a user sees a greyed pane over a feature that works.

**It is stuck, not slow.** Nothing corrected it in the 3 minutes 6 seconds to the next reading, and
the setting the detector reads was correct the whole time:

```
$ adb shell settings get secure enabled_notification_listeners
  com.chetan.connectsuite.debug/…NotificationMirrorService      <- position 1, exact prefix match
```

`CapabilityDetector.isNotificationListenerEnabled()` splits that string on `:` and matches
`packageName + "/"`. A fresh read returns **true**. The value it acted on at `.002` did not.

**The control, taken because this is an absence claim.** The log holds **107** `[caps]` lines and
**71** `Capabilities now:` lines, so the query can see capability lines; this is not an empty
window read as silence. The last one is `.002` and there is no later one.

#### Why nothing corrected it — the part that makes this its own defect

`CapabilityDetector.startWatching` registers a `ContentObserver` on
`enabled_notification_listeners` for precisely this case; its own comment calls itself the belt to
the lifecycle callback's braces. It logs `A Settings toggle changed; re-checking capabilities` when
it fires. **It has fired 15 times in this log, and not once in this process** — the last was
`14:01:44`, and the process started at `17:05:40`.

Because it is registered from **`LinkServer.start()` and nowhere else** (`LinkServer.kt:188`), and
the server was not running:

```
$ grep "Listening on" link.log | tail -1     -> 15:35:24, before the 17:05 reinstall  (control: 14 such lines exist)
$ ports 42501/42502/42503 bound              -> none
```

So the belt is scoped to the link being up, and a user toggling grants in Settings is most likely
to be doing it precisely when it is **not** up. That is the defect, and it is structural rather
than a race.

**Two findings, and only the second is pinned.**

1. *Not pinned:* why the explicit `refreshCapabilities()` at `.002` read stale, ~2 ms after
   `cmd notification allow_listener` wrote the setting. A read-after-write race on the settings
   provider is the obvious candidate and is **not proven here**. It is also not the important half:
   a race that self-heals costs nothing.
2. **Pinned:** there was no backstop to self-heal it, because the observer does not exist outside
   `LinkServer.start()`. This is why a millisecond race became a permanent wrong answer.

**Fixed in this sitting**, decided 2026-08-28 after it was found. It is not deferred with 30, 32
and 33, and the reason is Phase 6: that phase measures recovery after the service dies, which is
precisely the window where a capability granted with the link down goes permanently stale. Shipping
37 into Phase 6 means measuring recovery through a broken detector — the same argument that put 34
on the phone rather than making the Mac lenient.

**Fix direction:**

- Move `startWatching` out of `LinkServer.start()` so the observer's lifetime is the process, not
  the server's. It is two URIs and no polling; its own comment already argues it is free.
- Have `NotificationMirrorService.onListenerConnected` refresh from the **bound service's own
  state** (`NotificationRelay.isListening()`, which was already true at `.000`) rather than from a
  secure setting that may not have landed. The service being bound is the stronger fact — the
  setting is what the platform used to decide to bind it.
- Do **not** fix this by re-reading the setting on a delay. That is the same shape as defect 36's
  shipped wrong fix: a plausible value, a timer instead of a fact, and a wrong answer under load.

**Workaround until the fix lands, and also the unblock for step 67:** start the link. `LinkServer.start()` calls
`capabilities.refresh()` and then `startWatching`, so bringing the server up both recomputes the
set correctly and installs the observer for the rest of the process.

**Step 67 could not run while this stood** — no server was bound, so there was no Mac session to
observe a push arriving at. Recorded here rather than as a step 67 failure, because step 67 has not
yet been given a chance to fail.

---

## Re-verification steps 67-70 — to run on hardware

Ordered so that the three that need only one person come first. **Step 70 needs a second person**
and is the only one that does; see its own note for what to ask them for, once.

Grant surface after `adb install -r`: all eight Phase 4 permissions still show a `granted=true`
row on this device. Note the dump also shows `granted=false` rows for a second user profile the
shell cannot query (`SecurityException: Shell does not have permission to access user 150`), so
**this reading is not on its own sufficient** — step 67's first line is the phone's own capability
log, which is the authoritative control for every step below it.

### Step 67 — a phone-side media change reaches the Mac with no reconnect and no Mac command first

**This is defect 31's exact dead path, and the one step 64 could not see.** Step 64 passed at 16
commands / 0 refused with 5.0 ms worst latency over a feature whose push half was dead, because
every push it measured came from the command handler. So this step forbids the thing that made
step 64 healthy.

**Preconditions, in order — none of them optional:**

1. Connect the link, then read the phone's own log for `Media session listener attached; phone-side
   changes will now reach the Mac (N unsolicited pushes since start)`. If instead it says *"not
   attached yet: notification listener is not bound"* and never follows with the attach line, the
   fix did not take and nothing below is worth running.
2. **Confirm the harder case, which is the one that was broken.** Revoke notification access, watch
   for `Media session listener detached`, then re-grant it and watch the attach line appear a
   second time. The bug was that this only ever ran at install; a single attach at startup proves
   the easy path only.
3. Start a media app and let the card populate.

**Then, and this is the whole step: touch nothing on the Mac.**

| | How |
|---|---|
| **Change state on the phone only** | `adb shell input keyevent KEYCODE_MEDIA_PLAY` (or pause, whichever inverts the current state). A key event, not the phone's UI — a tap is a coordinate guess, and the media app's own buttons move. |
| **Read the phone's truth** | `adb shell dumpsys media_session`, `PLAYING(3)` vs `PAUSED(2)` |
| **Read the Mac's belief** | the card's `playing` and its note text, by accessible name |

**Both controls are required, because the last run of this produced a clean wrong answer:**

- **Line-count control.** Record the Mac's `[remote]` log line count **before and after**. Last
  time it was **93 → 93** across a state change, which is what proved no push was sent rather than
  a slow one. A pass needs the count to *rise* on the phone-side change alone.
- **Direction control.** Do **not** start from a state the Mac already believes. Last time the
  pause half of the test was discarded for exactly this: the Mac already read "paused", so
  agreement proved nothing. Invert the state the Mac is currently showing.

**Pass** requires: `[remote]` line count rises, the card's `playing` flips to match
`dumpsys media_session`, and **no `remote.command` was sent** — check the Mac's log for the absence,
with the enumeration control (the same window must still show the other `[remote]` lines it always
shows, or you are reading an empty log and calling it silence).

**Then, and only then, the regression check:** press one transport button on the Mac by its
accessible name and confirm step 64's path still works. Never double-click an armed control — the
dial button is the confirming one and is not involved here, but the same rule applies to any
button whose first click arms.

### Step 68 — an inbound SMS reaches the pane

**The clause is that the message is drawn in the Mac's SMS pane**, not that the phone emitted the
right shape. The phone emitting a correct-looking payload is what step 59 was previously credited
with and is precisely the evidence that was not enough: defect 34 lived between a phone that logged
a successful push and a Mac that logged a silent drop, and **only both logs together found it.**

**Both sides logged is the method, not a nicety. Have both open before the message arrives.**

Send one SMS to the phone. Then:

| Layer | Expected | Where |
|---|---|---|
| phone | `sms.received pushed after 1 lookup(s) — N pushed / 0 dropped since start — …` | phone `link.log` |
| Mac | `sms.received in thread <id> from <name or number> — …` | Mac `link.log` |
| **Mac pane** | **the message body is drawn as a row in the thread**, located by its own text | renderer |
| attribution | a name with contacts granted, the bare number without — **never blank** | the drawn row |

The third row is the step. The first two are how you will know *where* it broke if the third fails,
which is the entire lesson of this defect.

**Control for the pane check.** A row found is a presence claim, so judge it on what matched, not
on a count: quote the matched row. And enumerate the thread first — the same query must return the
messages you already know are in it, or an empty pane and a working pane look identical.

**Run it twice, in both contact states**, since step 59 asks for both and has never actually been
observed on the received event:

- with `READ_CONTACTS` granted, from a number that is in contacts → row shows the **name**
- with it revoked, or from a number that is not → row shows the **number**
- neither state may draw a blank

#### 68a — the retry path, and how to be honest about it

The fix looks for the provider row up to three times at 150 ms. **The success line says which look
won**, which is the point: `pushed after 1 lookup(s)` is the common case, and `after 2` or `after 3`
means the retry is doing real work.

**This is not reachable on demand.** The race depends on whether the platform's write beats a
broadcast delivered at priority 500, and nothing here can force the losing order. So:

- **Do not** report the retry as verified because a message arrived. Every message arriving on the
  first look exercises none of it.
- **Do** record the observed distribution across however many messages the run produces — e.g.
  "6 received, all `after 1 lookup(s)`" — which is a denominator, and states plainly that the retry
  path was **not exercised** rather than implying it passed.
- The `E [sms] sms.received NOT pushed: no provider row for … after 3 lookups` line is the one that
  must **never** appear. If it does, the retry is too short and that is a finding with its own
  number, not a step failure.

If you want the retry deliberately exercised, that is a code change (a debug switch forcing the
first N lookups to miss), not something to fake on hardware. It is not in this build and is not
claimed to be.

### Step 69 — an outgoing call's card carries the number the Mac dialled

One person. Dial a number **you own** — the second phone, or a speaking-clock service — from the
Mac's dialler.

⚠️ **The dial button arms on the first click and places the call on the second.** Click it once,
read the armed label, then click once more. Never double-click it. `call.dial` places the call
immediately; there is no dialler screen to cancel on and nobody holding the phone.

| Clause | Expected |
|---|---|
| phone log | `call.dial delivered (dialled +…)` — the number is now *in the line*, which it was not before |
| phone log | `Call cN dialing from +… (Name)` or `from +…, no contact name` — **never** `from ,` |
| Mac card headline | the name, or the number — **not** `Unknown number`, because the Mac dialled it and knows |
| Mac card second line | `Dialling · +…` — with the ` · ` present, which is the control for step 70's version of this |
| denominator | the phone's episode line reads `M of N episodes with a number since start` |

Hang up from the Mac and confirm `call.ended cN …` — the disposition here will be `declined` or
`answered` depending on whether it connected, **not** `rejected`; a Mac-initiated hang-up of a call
you placed is not a rejection.

### Step 70 — one inbound ring, proving 35c and 36 together — **needs a second person**

**This is the only step that needs anyone else, and one ring covers both defects.** Do not schedule
two calls. The number must be a real one from a real handset — 35c's whole point is that the
platform fills `EXTRA_INCOMING_NUMBER`, and that does not happen for a simulated call.

**Before they call — the preconditions, all on your side:**

1. The link is connected and the `calls` chip is lit.
2. `READ_CALL_LOG` is granted. Confirm it; without it the extra is empty by design and this step
   measures nothing. This is the control that distinguishes "the fix does not work" from "the
   permission that feeds it is off".
3. The phone's log shows `Watching PHONE_STATE for the inbound number`. If it instead shows
   `Could not watch PHONE_STATE; inbound calls will have no number`, stop — 35c cannot pass and
   you would be spending someone's time to learn that.
4. Note the current call-log tail (`adb shell content query --uri content://call_log/calls
   --projection "type:number:date" --sort "date DESC" ...`, one row) so the new row is identifiable
   as new rather than assumed to be.
5. Have the Mac's calls pane visible and both logs open.

**The exact sequence to give them — one sentence:** *"Call me once, let it ring, and don't hang up
until I say."* That is all. They do not need to answer anything, wait for a tone, or call twice.
You will reject it from the Mac while it is still ringing.

**What you do, in order:**

| # | Action | Reads |
|---|---|---|
| 1 | let it ring, do not touch the phone | Mac card appears |
| 2 | **read the card before pressing anything** | headline = their **name** if they are in contacts, else their **number**; second line = `Ringing · +…` — this is 35c |
| 3 | press **Reject** on the Mac **by its accessible name** (`call-reject`), once | phone: `call.reject delivered (rejected — the episode is flagged, so call.ended will say rejected)` |
| 4 | read the ended event | Mac: `call.ended cN **rejected** after Ns` — this is 36 |
| 5 | read the platform's own row | `type=5` (`REJECTED_TYPE`) for the same number and minute |

**The pass conditions, and what each proves:**

- **35c** — step 2's headline is **not** `Unknown number` and the second line is **not** `Ringing · `
  with nothing after it. Both were blank on the last run and both are quoted in defect 35's record.
- **36** — step 4 says `rejected`. Last run it said `missed` while row 5 said `type=5`, and that
  contrast *is* the defect. **Read row 5 anyway**: it is the control. `rejected` on the Mac with no
  `type=5` on the platform would mean the flag is being set on episodes that were not rejected,
  which is a different bug wearing the right answer.
- **The denominator** — the phone's episode line must read `M of N episodes with a number`, with M
  incremented by this call.

**The negative control, which costs nothing extra and closes 36 properly.** After they hang up,
ask them to ring **once more** only if you want it — otherwise let the next real call do it: a call
you let ring out untouched must still report `missed`. `rejected` is only meaningful if `missed`
still exists; a build that reports every ended call as `rejected` would pass step 70 as written
above and be worse than the defect. If you would rather not ask for a second ring, the phone-side
unit test `every other disposition still answers, and answered outranks rejected` covers all four
branches and this control can be recorded as satisfied off-device.

**What step 70 does not need**: an answered call. Step 62 already passes and the `answered` branch
is untouched by this fix — it is the mechanism that was copied, not changed.
