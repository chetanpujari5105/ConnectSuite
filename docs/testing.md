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

### Defect 31 — the media card never learns about changes made on the phone — **fixed and verified 2026-08-28 (step 67)**

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

### Defect 34 — `sms.received` is dropped by the Mac: the phone sends a shape the contract does not describe — **fixed and verified 2026-08-28 (step 68, both contact states)**

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

### Defect 35 — an outgoing call's card is labelled with nothing at all — **fixed; outgoing verified 2026-08-28 (step 69), inbound (35c) still awaiting step 70**

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

### Defect 36 — a call rejected from the Mac is reported as `missed` — **fixed, awaiting step 70; its `answered outranks rejected` precedence verified 2026-08-28 (step 69)**

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


### Defect 37 — a re-granted notification listener never turns its capabilities back on — **fixed and verified 2026-08-29**

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


### Defect 38 — a volume change made on the phone never reaches the Mac — **open, found during step 67 on 2026-08-28**

**Found by the user while setting up step 67**, and correctly separated from 31 before it was
reported: *"volume is a separate stream and depends on whether the session reports local or remote
volume."* Severity: Low-Medium. It is the same *shape* as defect 31 and a different mechanism, so
it gets its own number rather than being folded into 31's re-verification.

`stateOf` puts volume on the wire:

```kotlin
controller.playbackInfo?.let {
    put("volume", it.currentVolume)
    put("volumeMax", it.maxVolume)
}
```

and `remote.command volume_set` works — 3 delivered to YouTube at 17:34:42-45, 0 refused. So the
Mac can *set* volume and is *told* volume. What it is never told is that volume changed underneath
it, because `controllerCallback` overrides exactly three things:

| Override | Present |
|---|---|
| `onPlaybackStateChanged` | yes |
| `onMetadataChanged` | yes |
| `onSessionDestroyed` | yes |
| **`onAudioInfoChanged`** | **no** |

`onAudioInfoChanged` is the callback for a volume change, and nothing listens to it. Playback state
and metadata push (proven in step 67); volume does not.

**Distinguished from defect 31.** 31 was the session listener never attaching, so *nothing* pushed.
31's fix is working — the same run proves it — and volume still does not, which is what shows this
to be a separate missing override rather than the same hole.

**Fix direction:** override `onAudioInfoChanged` in `controllerCallback` and call `pushState`, the
same one line the other three callbacks use.

**And the caveat the user raised, which is why this is not simply a one-line fix.**
`MediaController.PlaybackInfo` has two types. For `PLAYBACK_TYPE_REMOTE` — a cast or external
renderer — the session owns its volume and `onAudioInfoChanged` fires. For `PLAYBACK_TYPE_LOCAL`,
which is what a phone playing through its own speaker reports, the "volume" is the device's music
stream, and changing it with the hardware keys **may not fire the session callback at all**. In
that case the override is necessary and not sufficient, and the local case needs an `AudioManager`
path or a `ContentObserver` on the stream volume instead.

So whoever picks this up must **check which type this device reports before claiming a fix** —
`controller.playbackInfo.playbackType` — and must test with the phone's own volume keys rather than
with `volume_set` from the Mac, because `volume_set` produces a push through `onCommand` and would
make a still-broken build look fixed. That is defect 31's exact trap: the feature following the
Mac's own commands perfectly while being deaf to the phone.

**Not fixed in this sitting.** The sitting's scope is 34, 35, 36, 31 and now 37, all of which are
either regressions or structural. This is a missing feature in a working one, it needs a device
capability checked before the fix shape is even known, and the note above is the whole brief.

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
| 3 | press **Reject** on the Mac **by its accessible name** (`call-reject`), once | phone: `call.reject delivered (rejected — the episode is flagged; call.ended decides the disposition when the call ends, and answered outranks the flag)` — **this line is not the disposition**, see defect 40 |
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

---

## Steps 67, 68, 69 — run 2026-08-28, all three **PASS**

Step 67 was run by the user before the session dropped; 68 and 69 were run after it was picked up
again. The session dropped between them, and the recovery is recorded first because it turned out
to be defect 37's own shape happening in the wild.

### The drop, and what it actually was

The user's reading was *"likely my hotspot, not you"*, and the Mac's log agrees for the first half
and not the second:

```
22:49:47  W [link] 10.173.69.248 failed: connect ENETUNREACH      <- hotspot gone: no route at all
23:01:41  W [link] 10.173.69.248 failed: connect ECONNREFUSED     <- route back; nothing listening
```

`ENETUNREACH` → `ECONNREFUSED` is two different failures wearing one symptom. The network came back
at **23:01:40** (`Immediate retry: network interfaces changed`) and the Mac then retried **77 times
over 41 minutes** against a phone that was reachable and had no server on 42501.

The phone side says why, and it is worth reading closely:

```
18:46:19  W [control] Chetans-MacBook-Pro socket dropped :: SocketException
18:46:35  I [caps]   Capabilities now: calls,contacts,mirror,sms
18:46:35  I [notif]  Notification listener attached to the link
18:46:35  I [caps]   Capabilities now: calls,contacts,mirror,notifications,remote,sms
18:46:35  I [remote] Media session listener attached … (0 unsolicited pushes since start)
                     … and then nothing. No `Listening on 42501/42502/42503`, ever.
```

A **fresh process with every feature installed and no server in it.** The process was started by
the platform rebinding `NotificationMirrorService`, not by `MainActivity`, and `LinkService.start`
is only ever called from `MainActivity` (`MainActivity.kt:51`) and the Link screen
(`LinkRoute.kt:63,133`). So the phone sat for five hours with notifications, SMS, calls, contacts
and the media listener all live and nothing to serve them to.

**This is defect 37's structural half, observed a second time and from the other side.** 37 says
the capability observer is scoped to `LinkServer.start()` and so is absent exactly when a user
toggles grants with the link down. Here is the same scoping producing the window: a process can be
fully alive, fully granted, and serverless, for hours. Recorded here rather than as a new defect
because it is the same root — `LinkServer.start()` is load-bearing for things that are not the
server — and 37's fix is the one that addresses it.

Control on the "nothing listening" claim, since it is an absence: `/proc/net/tcp6` filtered to
state `0A` (LISTEN) returned **6 sockets** and none of them were A605/A606/A607. The same query
after launching the app returned those three. An empty query was never read as silence.

Recovery was one `monkey -p … -c android.intent.category.LAUNCHER 1`; the Mac reconnected on its
next scheduled retry with no action on the Mac at all.

### Step 67 — **PASS**

Run by the user. The Mac's rotated log (`connectsuite.log.1`) still holds it, and the two controls
the step names are both readable in it.

**Line-count control — the counter rises.** `[remote]` lines over the run: **861**, and the state
counter climbs from `466 states` to `591 states` across the window below. Contrast the run this
step exists to prevent, where it was 93 → 93.

**Direction + no-command control — `delivered` is frozen while the state flips.** Four flips, both
directions, with the delivered counter unmoved at 29:

```
17:58:05.397 I [remote] paused  Spotify — 482 states / 29 delivered / 0 refused since launch
17:58:06.422 I [remote] playing Spotify — 508 states / 29 delivered / 0 refused since launch
17:58:35.525 I [remote] paused  Spotify — 532 states / 29 delivered / 0 refused since launch
17:58:36.805 I [remote] playing Spotify — 558 states / 29 delivered / 0 refused since launch
```

`delivered` counts `remote.command`s the Mac sent. It does not move, so **no Mac command caused any
of these**, which is the whole clause. And because the flips alternate, each one inverts the state
the Mac was showing a second earlier — the direction control is satisfied by the alternation
itself, not by an assumption about the starting state.

The later window (`18:44:07 → 18:44:18`, states 626 → 656, delivered frozen at 38) is metadata
pushes only — `untitled` → `Ordinary` — and is *not* where the play/pause clause was met. Noting
this because it is the window a `tail` lands on, and reading it alone would credit the step with
something it did not show.

**What is not recoverable and is therefore not claimed.** The phone's `link.log` has rotated past
this window, and no `dumpsys media_session` reading from the run survives. The Mac-side clauses
above are proven from the log; the phone-truth comparison rests on the run's own observation at the
time. The step is recorded PASS on that basis, with the split stated rather than smoothed over.

Defect 31 is therefore **closed**: `awaiting step 67` → verified. Defect 38 was found in this same
run and stays open.

### Step 68 — **PASS**, both contact states, read as two runs

Run against thread **594**, the self-thread, whose address `+919800000001` is the phone's own Jio
line (`defaultSmsSubId=2`) and is in the phone's contact book as **Chetan**
(`content://com.android.contacts/data/phones` → `display_name=Chetan, data1=9800000001`). Both
facts were read off the device before anything was sent, because the whole step turns on them.

The trigger each time was one message sent from the Mac's composer into 594, which the phone
delivers to itself, so one action exercises the send path and produces the inbound event under
test.

**Enumeration control, taken before each run.** The pane's own query for the thread returned the
messages already known to be in it — 10 before state A, 12 before state B — so an empty pane and a
working pane could not have looked alike.

| | **State A — contacts granted** | **State B — `READ_CONTACTS` revoked** |
|---|---|---|
| capability chip | `contacts: available` | `contacts: unavailable, missing Contacts` |
| thread list note | `50 conversations, 2 showing a contact name` | `50 conversations, 0 showing a contact name` |
| phone | `sms.received pushed after 1 lookup(s) — 1 pushed / 0 dropped since start` | same, on reset denominators |
| Mac | `sms.received in thread 594 from Chetan (+919800000001)` | `sms.received in thread 594 from +919800000001, no contact name` |
| **row drawn** | `STEP68A-234720 inbound attribution check`, inbound, 11:47 PM | `STEP68B-235009 inbound attribution check`, inbound |
| **attribution** | **Chetan** | **+919800000001** |
| blank? | no | no |

Read as two runs because the revoke restarts the app process and resets every `since start`
counter; carrying one denominator across the revoke would have made both halves unreadable.

**The row came from the push, not from a re-read — and this is the part that separates step 68 from
step 59.** In state A the drawn count went 10 → 11 at **+1404ms while the pane's own note still
read "10 messages on the phone"**. The note is `thread.messageCount` from `sms.threads`; the list
is `this.messages`. The composer's success path re-fetches, and that re-fetch is in the log
answering **10**:

```
23:47:32.859 I [sms] sms.messages thread 594 → 10 messages … hasMore=false
23:47:33.549 I [sms] sms.received in thread 594 from Chetan (+919800000001)
```

So the provider re-read did not contain the new message, and the row is on screen anyway. The only
path that can have drawn it is `SmsView`'s `onSmsReceived` append. Had the re-fetch returned 11,
this step would have been unable to tell a working push from a lucky re-read — the same
lookalike problem as step 59's regex, and the reason the timing was recorded rather than just the
final state.

#### 68a — the retry path was **not exercised**, and is not claimed

Two messages received across the run, **both `after 1 lookup(s)`**. That is the denominator, and it
says the retry did no work here. `after 2` and `after 3` were never seen; deliberately forcing them
needs a debug switch that is not in this build. The line that must never appear —
`E [sms] sms.received NOT pushed: no provider row for … after 3 lookups` — **did not appear**.

Defect 34 is therefore **closed**: `awaiting step 68` → verified on the drawn row, in both states.

### Step 69 — **PASS**, every clause

Dialled `+919800000001` — the phone's own number, on the user's standing authorisation — from the
Mac's dialler, by element id, never by coordinate.

**The two-step confirm was read between the clicks**, which is the point of it:

| Click | `#call-dial` label | `#call-live` |
|---|---|---|
| before | `Call` | hidden |
| **first** | `Confirm — call +919800000001`, `.danger` | **still hidden — nothing was placed** |
| second | — | card appears |

| Clause | Expected | Observed |
|---|---|---|
| phone log | number in the line | `call.dial delivered (dialled +919800000001)` |
| phone log | never `from ,` | `Call c1 dialing from +919800000001 (Chetan)` |
| Mac headline | not `Unknown number` | **`Chetan`** |
| Mac second line | ` · ` present, number after it | **`Dialling · +919800000001`** |
| denominator | `M of N episodes with a number` | `1 of 1`, then `2 of 2` on the second dial |

**The hang-up half needed a second dial, and that is worth recording.** The first call was
**answered by the carrier** — a phone dialling its own line reaches an announcement — and ended on
its own at 19.6 s before a hang-up could be sent. Ending observed, but not *caused*, so the clause
was not met. A second dial was placed and `#call-reject` clicked once at 4 s:

```
phone  23:53:58.243 I [calls] call.reject delivered (rejected — the episode is flagged, so call.ended will say rejected)
phone  23:53:58.585 I [calls] Call c2 ended answered after 4078ms
Mac    23:53:58.807 I [calls] call.ended c2 answered after 4s
```

`answered`, not `rejected` — which is exactly what step 69 asks for: *a Mac-initiated hang-up of a
call you placed is not a rejection.* Defect 36's `answered outranks rejected` precedence is what
produces it, working as designed.

**Platform control**, since `answered` is a presence claim: `content://call_log/calls` holds two
new rows for `+919800000001`, both **`type=2`** (`OUTGOING_TYPE`), neither `type=5`. The platform
and the Mac agree, and nothing was recorded as a rejection.

Defect 35 is **half closed**: the outgoing direction (`awaiting steps 69 and 70`) is verified here —
headline, number, and the ` · ` separator. The inbound direction (35c) still needs step 70.

### Defect 39 — a message sent from the Mac is missing from the conversation it was sent into, while the pane's own note counts it — **open, found during step 68 on 2026-08-28**

Severity: **Medium.** Found because step 68's timing control made the two numbers visible side by
side. Reproduced in **both** state A and state B, so it is not a one-off race.

After sending from the composer, the open thread draws **one fewer message than its own header
claims**, and the missing one is the message the user just sent:

| | after state A's send | after state B's send |
|---|---|---|
| note | `Chetan — 12 messages on the phone.` | `+919800000001 — 14 messages on the phone.` |
| rows drawn | **11** | **13** |
| which one is missing | the outbound copy | the outbound copy |

Leaving the thread and reopening it draws all 12 (verified: `count: 12`, note `12`, and the last
three rows are `out / in` of the sent body plus the previous message). So it is a display gap, not
a lost message.

**Mechanism, and it is the send-side twin of defect 34.** `submit()` calls `openThread(threadId)`
on success, which re-fetches from the provider — **30 ms** after the phone reported the send:

```
phone 23:47:32.673 I [sms] sms.send delivered (to 1 verified recipient(s))
phone 23:47:32.703 I [sms] sms.messages delivered (thread 594, 10 messages, hasMore=false)
```

The provider had not written the sent row yet, so the re-read answers 10 and nothing ever appends
it afterwards. The note updates later from `sms.threads` (`thread.messageCount` = 12) and the list
does not, which is why the two disagree on screen.

Defect 34 fixed exactly this race on the **receive** path, on the phone, with a bounded retry that
reports which lookup won. Nothing equivalent guards the **send** path.

**Fix direction, and one shape to avoid.** The wrong fix is a delay before the re-fetch — same
shape as defect 36's shipped wrong fix and as defect 37's rejected `re-read on a timer`: a
plausible value, a timer instead of a fact, wrong under load. Two honest options:

- have the phone answer `sms.send` with the written row (it knows when its own write landed), and
  have the pane append that, the way it appends a pushed `sms.received`; or
- give the send path the same bounded-lookup retry defect 34 gave the receive path, with the same
  `after N lookup(s)` line so the denominator is visible.

The first is better: it removes the race rather than surviving it, and it makes the sent message
arrive by the same mechanism as the received one.

**Not fixed in this sitting** — the sitting's scope is defect 37, and this needs a protocol
decision about what `sms.send`'s ack carries, which belongs with `docs/protocol.md` open.

### Defect 40 — `call.reject delivered` states a disposition the disposition logic then overrides — **fixed and verified 2026-08-29**

Severity: **Low**, and recorded only because of what it would do to whoever runs step 70.

The phone logs, in this order, 342 ms apart:

```
23:53:58.243 I [calls] call.reject delivered (rejected — the episode is flagged, so call.ended will say rejected)
23:53:58.585 I [calls] Call c2 ended answered after 4078ms
```

The second line is **correct** — step 69 requires `answered` here, and defect 36's `answered
outranks rejected` precedence is what produces it. The first line is a confident prediction that is
simply wrong, written by code that cannot see the precedence rule that will overrule it.

This is the failure mode CLAUDE.md's second driving rule names: a clean, specific, confident wrong
answer that nothing downstream can distinguish from a real one. Step 70 turns on reading `rejected`
versus `missed` in these very lines, and it hands the reader `rejected` in a run whose answer is
`answered`.

**Fix direction:** the line should state what it did, not what will follow — *"call.reject
delivered (episode flagged; the disposition is decided when the call ends)"* — or be emitted after
the disposition is known. It must not name a disposition it does not decide.

**Also seen, not a defect:** the Mac logs `call.dial placed to +919800000001 (null)` at dial time,
because the Mac has only the number it typed and no name yet. The very next line resolves it
(`call.incoming c1 (dialing) from Chetan (+919800000001)`). Nothing user-visible is blank, so this
is a log-cosmetics note rather than a defect — but `(null)` in a line that elsewhere reads
`(name)` is one grep away from being misread as a resolution failure.

---

## Defect 37 fixed and verified on hardware — 2026-08-29

Two things were wrong, they had different shapes, and the fix has one part for each. The record of
what was wrong is in defect 37's own entry above; this is what changed and how it was checked.

### Part 1 — a bound component is proof of its own grant

`CapabilityDetector.specialAccessGranted()` read `enabled_notification_listeners` and nothing else.
It now reads the setting **and** the set of components the feature modules report as bound, through
a new pure helper `SpecialAccessReading.granted(namedInSettings, bound)` in `Capabilities.kt`.

The argument, which is narrower than it may look: the secure setting is not the grant, it is the
platform's *record* of the grant, and the platform reads it to decide whether to bind. So a bound
component is that same fact arriving by a shorter and more reliable route — a bind cannot happen
without the grant, whereas a read of the setting can land before the write that caused the bind is
visible. That is what defect 37 was: a read that lost a race with itself, 2 ms wide, and then
never corrected.

**This is deliberately not "running implies granted" as a general rule**, and it does not loosen
the both-halves invariant. `CapabilityContract.advertisable` still takes `granted intersect
running`; a grant with nothing behind it still advertises nothing, which is `RunningGateTest`'s
whole subject and all seven of its tests still pass untouched. What changed is one input to that
intersection, not the intersection.

The consequence is worth saying out loud rather than leaving to be discovered: for these two
accesses the advertised set now reduces to what is bound. That is intended. The setting keeps the
one job it cannot be replaced for — `CapabilityStatus.permitted`, which is what produces "granted
in Settings, but Android has not started the service" instead of sending someone back to a switch
they have already set.

### Part 2 — the observer's lifetime is the process, not the server

`capabilities.startWatching(::refreshCapabilities)` moved from the last lines of
`LinkServer.start()` into `LinkServer`'s `init`, and `capabilities.stopWatching()` was removed from
`stop()`. `LinkServer` is built once per process by `LinkController.get`, which
`ConnectSuiteApp.onCreate` calls — so the observer now exists from the first moment any component
starts the process, including the platform rebinding the notification listener.

`stopWatching()` is now called by nothing, and its doc comment says so and says why it is kept.

**The fix direction that was rejected, restated because it will look tempting again**: re-reading
the setting on a delay. Defect 37's own entry rules it out, and defect 36's shipped wrong fix is
the precedent — a plausible value, a timer instead of a fact, and a wrong answer under load.
Neither part of this fix contains a timer.

### The tests, each shown to fail against the defect

`core/src/test/java/com/chetan/connectsuite/core/SpecialAccessReadingTest.kt`, six tests. The
defect was reintroduced (`granted = namedInSettings` alone), the suite re-run, and the four tests
that name it went red with the right messages:

```
FAILED  defect 37 - a bound listener whose setting reads stale-false is still granted
        expected:<[NOTIFICATION_LISTENER]> but was:<[]>
FAILED  defect 37 - notifications and remote come back on with the listener bound
        expected:<[notifications, remote]> but was:<[]>
FAILED  defect 37 - the reason must not read 'missing Notification access' over a bound service
        must be advertised
FAILED  a bound listener does not carry the accessibility service with it
        expected:<[notifications, remote]> but was:<[]>
```

The other two — `a grant with nothing bound still advertises nothing` and `unbinding takes the
capabilities away again` — pass in **both** states and are labelled in the file as guards, not as
evidence. They exist so the fix cannot quietly turn "granted" back into "advertised", which is the
direction it would be most costly to be wrong in. A test that cannot fail is not evidence; a test
that is *declared* to be a guard is honest about being one.

Part 2 is a lifetime rather than a value and has no unit test. It is verified on hardware below,
which is the only place a `ContentObserver`'s scope is observable.

Full phone suite after the fix: **164 tests, 0 failures, 0 errors.**

### Hardware verification — the grant is made with the link **DOWN**, which is the broken case

Build installed with `adb install -r` at 00:02. The reinstall tears the bound components down; the
platform rebound `NotificationMirrorService`, which started the process, which ran
`ConnectSuiteApp.onCreate` — and **`LinkService` never ran**, so this is the exact serverless state
that hid the defect.

**Control on "the link is down", taken first, because everything below is an absence claim.**
`/proc/net/tcp6` filtered to state `0A` returned **7 listening sockets** and none of them were
A605/A606/A607 (42501/2/3). The same query later, after the link was deliberately brought up,
returned those three. And `grep -c "Listening on"` over the current process's window returned
**0**, while the same grep over the whole file returned **2** — so the query can see server starts,
it is simply that this process had none.

**Control on the observer, which is the denominator that makes part 2 readable.**
`grep -c "A Settings toggle changed"` **before** the toggle: **0**. Not "few" — none, across a log
holding 37 `[caps]` lines, which is also the control that the log can see capability lines at all.

Then notification access was revoked and re-granted with `cmd notification
disallow_listener` / `allow_listener`, no server at any point:

```
00:03:47.351 I [notif]  Notification listener detached; notifications capability is off
00:03:47.353 I [caps]   Capabilities now: calls,contacts,input,mirror,sms
00:03:47.353 I [remote] Media session listener detached: notification access went away
00:03:47.619 I [caps]   A Settings toggle changed; re-checking capabilities        <- part 2, no server
00:03:47.628 I [caps]   Capabilities unchanged (calls,contacts,input,mirror,sms); reason changed:
                        notifications — missing Notification access; remote — missing Notification access
00:03:51.434 I [notif]  Notification listener attached to the link
00:03:51.435 I [caps]   Capabilities now: calls,contacts,input,mirror,notifications,remote,sms
00:03:51.435 I [remote] Media session listener attached; phone-side changes will now reach the Mac
00:03:51.695 I [caps]   A Settings toggle changed; re-checking capabilities
```

**Read `00:03:51.435` against defect 37's `17:14:57.002`. That one line is the whole fix:**

| | attached | one millisecond later |
|---|---|---|
| before | `17:14:57.000 Notification listener attached` | `17:14:57.002 … missing Notification access` — and it never changed again |
| after | `00:03:51.434 Notification listener attached` | `00:03:51.435 Capabilities now: …,notifications,remote,…` |

The revoke half matters as much as the re-grant half and is easy to skip: at `.353` the set drops
to five and at `.628` the reason reads `missing Notification access` — **correctly**, because
nothing is bound then. A build that reported seven capabilities in both directions would have
passed a re-grant test and be worse than the defect. The set has to be wrong when the feature is
gone and right when it is back, and both were observed in the same four seconds.

The observer fired again at `00:03:51.695` and once more at `00:04:02.686` with no
`Capabilities now:` line following either — `refresh()` returning false because the set had not
moved, which is the "a spurious onChange broadcasts nothing" behaviour its comment claims.

**Then the link was brought up**, and the Mac drew all seven as `cap on`: `mirror`, `input`,
`notifications`, `sms`, `calls`, `contacts`, `remote`. The remaining five read `unavailable` with
their specific reasons (`files`, `photos`, `clipboard`, `apps`, `mic`) — locked decision #6 intact.

### What this does not fix

The five-hour serverless window recorded at the top of the steps 67-69 section — a process fully
alive with every feature installed and no `LinkService` — is **unchanged**. Part 2 means the
capability set is now correct throughout such a window, which is what defect 37 was about, but
nothing here makes the server come up. A process started by the platform rebinding a listener
still has no listening sockets until something calls `LinkService.start`, and the Mac still sees
`ECONNREFUSED` until then. That is Phase 6's subject (background reliability, surviving the OEM's
process management) and it is named here so it is not mistaken for having been handled.

---

## Defect 40 fixed, and what it did and did not put at risk — 2026-08-29

Fixed before step 70 was scheduled, on the reasoning below rather than because it blocked the step.

### Could step 70's disposition read be trusted with 40 open? Yes — and it was still worth fixing

**The measurement was never corrupted.** Step 70's clause reads `call.ended cN <disposition>`, which
is computed by `CallWatcher.dispositionOf(answered, rejected, wasRinging)` from the episode's own
state. The defective sentence was built in `CallFeature.reject`, is passed to `deliver()` as a log
string, and reaches nothing else — the ack that goes on the wire carries `callId` and nothing more
(`CallFeature.deliver`, `session.ack { put("callId", …) }`). It cannot move a disposition.

**And step 70's own case is the one where the two agree anyway.** An inbound call rejected while
ringing never sets `answered`, so `dispositionOf` returns `rejected` and the old prediction would
have been right. The prediction is only wrong when `answered` outranks the flag, which is step
**69**'s case — a call that connected first.

**So why fix it.** Because the line sat inside step 70's own instruction table, told the reader an
outcome, and would answer a `grep rejected` identically whether the fix worked or not. That is the
count-without-matched-lines failure CLAUDE.md names, aimed at the one defect step 70 exists to
verify. A reader who checked the cheap line instead of the real one would get the right answer for
the wrong reason on a good build and the *same* answer on a broken one.

The honest summary: **not a blocker, and not worth carrying into someone else's time when it costs
one string and a rebuild that had to happen before the ring regardless.**

### The change

`CallFeature`'s three delivery sentences moved into `CallAckWording` — a file with no Android
imports, so a JVM test can reach them. Only the reject line changed:

```
before  rejected — the episode is flagged, so call.ended will say rejected
after   rejected — the episode is flagged; call.ended decides the disposition when the call ends,
        and answered outranks the flag
```

It now reports the fact it owns (the flag is set) and names the rule that settles the rest, which
is also the sentence a step-70 reader needs in order not to mistake this line for the disposition.

### Tests, shown to fail against the defect

`CallAckWordingTest`, three tests. The old string was put back and two went red:

```
FAILED  the reject ack does not promise an outcome dispositionOf can overrule
        the reject ack must not forecast the disposition: found "will say" in "…will say rejected"
FAILED  the reject ack still says what it did, and names the precedence
        must name the precedence: rejected — the episode is flagged, so call.ended will say rejected
```

The first test asserts both halves in one place on purpose — that
`dispositionOf(answered = true, rejected = true, …)` is `"answered"`, **and** that the wording does
not contradict it. The sentence and the rule lived in different files with no relationship between
them, which is how the wrong sentence got written; the test is that relationship. The third test is
a guard over the dial and answer wordings, labelled as one.

Full phone suite after the fix: **167 tests, 0 failures, 0 errors.**

### Verified on hardware

Second install of the sitting, then one self-call dialled and hung up from the Mac at 4 s:

```
00:12:44.825 I [calls] call.reject delivered (rejected — the episode is flagged; call.ended decides
                       the disposition when the call ends, and answered outranks the flag)
00:12:45.063 I [calls] Call c1 ended answered after 4113ms
```

The two lines no longer contradict each other, and the first now explains the second instead of
denying it.

**Defect 37's fix was re-verified on this build too**, since it is a different APK from the one
that verified it. With the link **down** after the install — `A605/A606/A607` bound: **0** — the
listener rebound and the set came straight back to all seven:

```
00:11:26.707 I [notif] Notification listener attached to the link
00:11:26.709 I [caps]  Capabilities now: calls,contacts,mirror,notifications,remote,sms
00:11:26.755 I [caps]  Capabilities now: calls,contacts,input,mirror,notifications,remote,sms
```

### Does defect 39 affect step 70? **No.**

Recorded because the question was asked and a "no" with no reasoning is worth as little here as an
unqualified count. Defect 39 is confined to `SmsView`'s open-thread message list after a send from
the Mac's composer. Step 70 sends no SMS, opens no thread, and reads no SMS pane: its surfaces are
the calls card (`#call-live`, `.call-who`), the phone's `[calls]` log lines, and
`content://call_log/calls`. There is no shared state between them — different pane, different
feature, different provider. 39 stays open and deferred to the Phase 4 SMS sitting with 30 and 32,
as agreed.

---

## Step 70 — preconditions re-verified against the post-37, post-40 build — 2026-08-29

**Re-taken, not carried forward.** Everything below was read after the second install of the sitting
(`lastUpdateTime=2026-08-29 00:11:25`), because the readings from before the rebuild describe a
different APK. This matters more than usual here: a reinstall tears down both bound components, and
the whole of defect 37 was about what the capability set does afterwards.

| # | Precondition | Reading | Control |
|---|---|---|---|
| 1 | link connected, `calls` chip lit | `Listening on 42501/42502/42503, 1 paired device(s)` 00:11:47; `Handshake complete with Chetans-MacBook-Pro` 00:12:05; chip `calls: available` | the chip row was enumerated, not grepped — 12 chips read, 7 `cap on` and 5 `unavailable` with specific reasons |
| 2 | `READ_CALL_LOG` granted | `granted=true` for user 0 | the other seven Phase 4 permissions read `granted=true` in the same dump, so the query is not returning true for everything or nothing |
| 3 | `Watching PHONE_STATE for the inbound number` | present, 00:11:26.669 | the failure text `Could not watch PHONE_STATE; inbound calls will have no number` is absent, and it is the same grep |
| 4 | call-log tail noted, so the new row is identifiable | `type=2, number=+919800000001, date=1787942560788` | this is the self-call from the defect 40 verification; the step-70 row must be a **different** number with `type=5` |
| 5 | both logs open, calls pane visible | `calls-card` not hidden; note reads `50 recent calls, 47 showing a contact name, 5 missed` | — |
| 6 | no live call, no armed control | `#call-live` hidden, `#call-answer` and `#call-reject` **absent**, `#call-dial` reads `Call` | **173 buttons enumerated in the same DOM** — the absence is meaningful because the query found everything else |

Precondition 6's control is the one worth keeping. "The reject button is absent" was reported once
in this project by a query that could not see any buttons at all; 173 is what makes this reading
different from that one.

**Also confirmed on this build, since it is a different APK from the one that verified it:** defect
37's fix holds. With the link **down** after the install — `A605/A606/A607` bound: 0 — the listener
rebound and the set came back to all seven at `00:11:26.709` / `.755`.

**Defect 40's wording is live on this build**, which matters because step 70's row 3 quotes it:

```
call.reject delivered (rejected — the episode is flagged; call.ended decides the disposition when
the call ends, and answered outranks the flag)
```

### The one line to give the second person

> **"Call me once, let it ring, and don't hang up until I say."**

That is the whole of it. They do not answer anything, wait for a tone, listen for anything, or call
twice. The call must come from a real handset — 35c turns on the platform filling
`EXTRA_INCOMING_NUMBER`, which does not happen for a simulated call.

### The exact sequence, so they ring once and only once

Before saying the line, have preconditions 1-6 above green and both logs open. Then:

| # | Who | Action | What is read, and why it cannot wait |
|---|---|---|---|
| 0 | you | say the line | — |
| 1 | them | ring, and **leave it ringing** | — |
| 2 | you | **touch nothing**; read the Mac card first | headline = their **name** if in contacts, else their **number** — must not be `Unknown number`; second line = `Ringing · +…` — must not end at `Ringing · `. **This is 35c, and it is only readable while the call is live.** |
| 3 | you | press **Reject** on the Mac by its accessible name (`call-reject`), **once** | phone logs `call.reject delivered (rejected — the episode is flagged; …)`. **This line is not the disposition** — see defect 40. Do not read it as the answer. |
| 4 | you | read the ended event | Mac: `call.ended cN rejected after Ns`. **This is 36**, and this line is the answer. |
| 5 | you | read the platform's own row | `content://call_log/calls` → **`type=5`** (`REJECTED_TYPE`) for their number, this minute, and a row that is not the `type=2` one noted in precondition 4 |
| 6 | you | tell them they can stop | — |

**Why step 2 comes before step 3 and cannot be swapped.** The live card exists only between the ring
and the reject. Pressing Reject first destroys the only surface 35c can be read from, and the run
would have to be repeated — which means asking a second time for something you were told once would
be enough.

**Do not double-click Reject.** It is not an arming control; one click acts. The arming control is
the dial button, which is not involved here.

### What each reading proves, and the two ways this can produce a wrong answer

- **35c passes** when step 2's headline is not `Unknown number` and the second line has a number
  after the ` · `. Both were blank on the run that found the defect and both are quoted in its
  record.
- **36 passes** when step 4 says `rejected`. Step 5 is its control and is not optional: `rejected`
  on the Mac with **no** `type=5` on the platform would mean the flag is being set on episodes that
  were not rejected — a different bug wearing the right answer.
- **The denominator** — the phone's episode line must read `M of N episodes with a number`, with M
  incremented by this call. It currently reads `1 of 1` from the defect 40 verification, so after
  the ring it must read `2 of 2`.

### The negative control, and how to satisfy it without a second call

`rejected` only means something if `missed` still exists. A build that reported every ended call as
`rejected` would pass everything above and be worse than the defect.

**This does not require asking for a second ring.** The phone-side unit test
`every other disposition still answers, and answered outranks rejected` covers all four branches of
`CallWatcher.dispositionOf`, and step 69 exercised the `answered` branch against a live call on
2026-08-28 — a Mac-initiated hang-up of a connected call reported `answered`, not `rejected`, with
two `type=2` rows as its control. The negative control is therefore **satisfied off-device**, and
the second person is asked for exactly one ring.

---

## Step 70 — **DID NOT RUN.** What happened instead, and defect 42 — 2026-08-29

Recorded in full because the run consumed a second person's time and produced a result that looks
like a pass and is not one. Nothing below should be read as evidence for 35c or 36.

### The timeline, from the platform's own call log rather than from the app's

`content://call_log/calls`, which is the arbiter here because the app's account of these calls is
the thing under suspicion:

| Platform row | What it is |
|---|---|
| `00:12:40 type=2 → +919800000001 dur=0` | the defect 40 verification self-call |
| `00:28:55 type=2 → 8800000004 dur=0` | **the user calling the second person** to ask them to ring |
| `00:29:08 type=2 → 8800000004 dur=0` | the same call attempted again |
| `00:29:31 type=1 ← +918800000004 dur=27` | **the step 70 inbound ring** |

And what ConnectSuite said about the same four:

```
00:12:40  Call c1 dialing from +919800000001 (Chetan)     <- correct
00:28:56  Call c2 dialing from +919800000001 (Chetan)     <- WRONG. the platform says this call
                                                             went to 8800000004
00:29:08  Call c3 dialing from 8800000004 (Contact D)     <- correct
00:29:31  Call c4 ringing from 8800000004 (Contact D)     <- correct, and see the control problem
00:30:05  Call c4 ended answered after 33241ms
```

### What I did wrong, first, because it cost the user something real

**The watcher rejected a call it had already read as not being the call under test.** It was written
to wait for `#call-live`, take its readings, and then click `#call-reject` — unconditionally. At
00:28:56 the card appeared reading `who="Chetan"`, `status="Dialling · +919800000001"`, and six
consecutive readings said so. `Dialling` is not `Ringing` and `+919800000001` is not the second
person's number: the reading itself said this was not step 70's call. The script clicked anyway,
because there was no gate between reading and acting.

**So the user's own outgoing call to the second person was hung up from the Mac at 00:28:58**, two
seconds in, which is almost certainly why there is a second identical attempt at 00:29:08.

This is the coordinate-clicking rule in a new costume. That rule is about not acting on a control
whose target you have not confirmed; automating the read and then ignoring what it said is the same
failure with an extra step. **The check must gate the action, or it is decoration.** The watcher now
refuses to click unless the card reads `Ringing` *and* carries the expected number — see
`scripts/step70-watch.mjs`.

The one thing that went right: no call was placed. `call.dial` appears three times in the Mac's
whole log — 23:52, 23:53 and 00:12 — and not after. The 00:28:55 and 00:29:08 outgoing calls were
placed on the phone by hand.

### Why step 70 did not run

The watcher exited at 00:28:59, after rejecting the wrong call. **The real ring arrived at 00:29:31,
32 seconds later, with nothing watching.** It was answered on the phone and ran for 33 seconds.

- **36 is untested.** No `call.reject` was ever sent for c4. `call.ended c4 answered after 33s` is
  the disposition of an answered call, which is correct and says nothing about the `rejected`
  branch.
- **35c is not proven either** — and this is the more interesting half, because the log *looks*
  like a pass.

### Why c4 is not evidence for 35c, even though it reads correctly

`Call c4 ringing from 8800000004 (Contact D)` is exactly the line 35c wants. It cannot be used,
because **the run cannot tell that answer apart from a stale one.**

`CallWatcher.number` is a field that persists between episodes, and defect 42 below shows it can
carry a number from one episode into the next. The two episodes immediately before c4 both involved
`8800000004`. So a correct read of `EXTRA_INCOMING_NUMBER` and a stale carry of the previous
episode's number produce **the identical string**, and nothing in this run separates them.

This is the discrimination rule, and it is the third time it has bitten in this project: *when the
target and its lookalike share every attribute you are matching on, stop and find one that separates
them.* Here the separator is obvious and was not arranged — the ring has to come from a number that
is **not** the number of the call before it.

A correct step 70 therefore needs one of:

- **defect 42 fixed first**, which removes the stale path and makes the reading mean what it says; or
- a ring from a number no preceding episode touched, with the preceding episode's number recorded
  beforehand as the control.

The first is better and is the one to do: it turns step 70 back into a test of 35c rather than a
test of 35c *and* an assumption about what happened before it.

### Defect 42 — an outgoing call placed on the phone is labelled with the previous call's number and contact name — **open, found during the step 70 attempt on 2026-08-29**

Severity: **High.** It puts the wrong person's name on a live call card. It is worse than defect 35,
which drew a blank: a blank is obviously missing, and a name is believed.

**Proof, and it does not depend on any theory of the mechanism.** At 00:28:55 the platform recorded
`type=2, number=8800000004`. At 00:28:56 the app pushed `Call c2 dialing from +919800000001
(Chetan)`. Those are two different numbers for one call, and the one the app chose is the number of
the **previous** episode.

**Mechanism — the likely one, stated as a hypothesis because its exact ordering is not proven.**
`number` is a `CallWatcher` field. It is set by `expectOutgoing()` when the *Mac* dials, and by the
`PHONE_STATE` receiver when `EXTRA_INCOMING_NUMBER` is non-blank and `number` is blank. **Nothing
supplies it for an outgoing call placed on the phone itself** — there is no `call.dial` in that
path. `end()` does clear it (`number = ""`), so the residue has to be written after that: the
trailing `PHONE_STATE` broadcast for the previous call's IDLE transition arriving *after* `end()`
has run, finding `number` blank, and filling it with the number that call carried. It then sits
there until the next `begin()` reads it.

That fits every line above, including why c3 and c4 look right: c2 and c3 both went to
`8800000004`, so the residue happened to match. **Not proven** — pinning the broadcast ordering
needs an instrumented build, and the fix does not depend on which way it resolves.

**Fix direction.** Two parts, and the first matters more:

1. **An episode must not begin with a number it did not obtain for itself.** Clear `number` at the
   *start* of `begin()` for any episode that has no explicit source, rather than relying on `end()`
   having cleared it. An outgoing call the phone placed has no source today, so it should report
   `number withheld by the platform` — the honest blank — rather than the previous call's number.
   A blank is recoverable by the reader; a wrong name is not.
2. Then, separately, find a legitimate source for a phone-initiated outgoing number.
   `NEW_OUTGOING_CALL` is restricted and `EXTRA_INCOMING_NUMBER` is not documented to carry it.
   `end()`'s existing `newestLogged` fallback is legitimate **at end** and cannot help at begin.

**Wrong fix to avoid:** reading the call log in `begin()`. The row for a call that is only now
dialling has not been written, so the read returns the previous call's row — which produces exactly
the wrong number this defect is about, by a second route, while looking like a fix. That is
`dispositionOf`'s own rejected shape and defect 36's shipped wrong fix, for the third time.

**What this does not affect.** Inbound calls where the previous episode carried a different number,
and any call the Mac dialled — `expectOutgoing` gives those a real source. Step 69's readings stand:
its number came from `call.dial`.

---

## Defect 42 fixed and verified; defect 43 found behind it; step 70 re-armed — 2026-08-29

### Defect 42 — fixed

Two writers of `CallWatcher.number` had no rule about who may write it or when. Both now go through
`CallNumberRules`, which is pure and therefore testable on the JVM:

1. **`numberAfterBroadcast`** — the `PHONE_STATE` receiver may not fill the field from an **IDLE**
   broadcast. That is the refill path: the previous call's trailing IDLE arrives *after* `end()` has
   blanked the field, finds it blank, and puts a finished call's number back. Phrased as "ignore
   IDLE" rather than "accept only RINGING" on purpose — which transitions carry
   `EXTRA_INCOMING_NUMBER` varies by OEM, and an allowlist could silently discard the inbound number
   35c depends on. Excluding the one state that is provably wrong cannot break the inbound path.
2. **`numberAtEpisodeStart`** — an episode may not begin with a number it did not obtain for itself.
   An outgoing call has exactly one legitimate source (`call.dial` → `expectOutgoing`), tracked by a
   new `numberFromDial` flag, because nothing supplies a number for a call placed on the phone by
   hand. Such an episode now starts blank.

Rule 1 is the mechanism, rule 2 is the invariant. Rule 1 alone would fix the sighting; rule 2 makes
the class impossible whatever else learns to write that field later.

**Tests: `CallNumberRulesTest`, eight of them.** The defect was reintroduced in both rules at once
and exactly the two that name it went red:

```
FAILED  an IDLE broadcast may not fill the number
        expected:<[]> but was:<[+919800000001]>
FAILED  defect 42 - a phone-placed outgoing episode starts blank, not with the last number
        expected:<[]> but was:<[+919800000001]>
```

The other six pass in both states and are labelled as guards. **One of them is the most important
test in the file**: `an inbound ringing episode keeps the number the broadcast gave it`. 35c depends
entirely on that path, this fix is landing immediately before step 70 runs, and the failure it
guards against would otherwise be discovered by wasting a second person's time.

Full phone suite: **175 tests, 0 failures.**

#### Verified on hardware, with a design that cannot pass by coincidence

The trap in testing this is that the obvious experiment is ambiguous: if the previous call and the
test call share a number, residue and a correct read produce the same string — the exact problem
that made the first step 70 attempt unreadable. So the test was built so that **the fixed answer
differs from both the residue and the true number**:

| | Episode | Expected under the fix | Would have been, before |
|---|---|---|---|
| A | Mac dials `+919800000001` (`call.dial` present) | the number, from its real source | same |
| B | `am start -a android.intent.action.CALL` to the same number — **no `call.dial`** | **blank**, because no source exists | `+919800000001`, the residue |

```
00:42:37.386 I [calls] Call c1 dialing from +919800000001 (Chetan) — 1 of 1 episodes with a number since start
00:42:54.847 I [calls] Call c2 dialing number withheld by the platform — 1 of 2 episodes with a number since start
```

`number withheld by the platform` on c2 is the fix. Blank is not what a residue produces and not
what a correct read of a real source produces, so this reading cannot be a coincidence. The
denominator moved to `1 of 2` in the same line, which is the count-with-its-denominator rule doing
exactly the job it was written for.

Both calls were to the user's own number, on standing authorisation. Nobody else's phone was rung.

### Defect 43 — `from ,` in the Mac's log, found by fixing 42 — **fixed same sitting**

The honest blank that 42 produces walked straight into an unguarded ternary on the Mac:

```
00:42:55.032 I [calls] call.incoming c2 (dialing) from , no contact name — 26 rang / 18 ended / …
```

**`from ,` is the exact string defect 35 is named for** — "Defect 35 was found in this line reading
`from ,`" — in a different file, eleven defects later.

It had never been reachable: until 42 was fixed, a phone-placed outgoing call always arrived
carrying the previous call's number, so the empty branch never ran. The renderer was already
correct — `callWho` falls back to `Unknown number` and `callStatus` drops the bullet, both from
defect 35's fix — so the **card** was right and only the log was wrong, which is why nothing caught
it. `whoLine()` in `desktop/src/main/calls.ts` now has four cases, the fourth being
`with no number from the platform`, matching what the phone says about the same state.

Test in `calls.test.ts`, shown to fail against the two-branch version. Mac suite: **55 tests, 0
failures**; `tsc --noEmit` clean. The Mac app was rebuilt and relaunched with
`--force-renderer-accessibility --remote-debugging-port=9222` and reconnected on its own.

### 35c's pass condition is now **Contact D**, and that is stricter than what was written

`docs/testing.md` originally wrote step 70's headline clause as "their **name** if they are in
contacts, else their **number**" — a disjunction, which passes either way and therefore tests less
than it appears to. The caller was checked against the phone's book before the ring was arranged:

```
content://com.android.contacts/data/phones → Row: 574 display_name=Contact D, data1=8800000004
```

So the disjunction collapses. **The headline must read `Contact D`.** The bare number is now a
failure, not an acceptable branch.

This matters beyond tightening a clause. `ContactsFeature.nameFor` is called from
`CallWatcher.begin`, once per episode, and **contacts was pulled forward into Phase 4 specifically
so that call and SMS surfaces would not be columns of phone numbers.** A number-only headline on a
caller who *is* in the book means that lookup did not fire — which is a working feature reported as
a working feature while the integration it was built for is dead. That is defect 31's shape (a lit
chip over dead wiring) and step 68's shape (a row that could have come from either path), and it is
the reason the stricter clause is worth having: it is the only version that can tell the two apart.

Recorded for the run: the phone's line must read `ringing from 8800000004 (Contact D)` — the
parenthesised name is the lookup's own output — and the Mac card's headline must be `Contact D`,
with `Ringing · 8800000004` beneath it.

### The gate, readable before anyone's phone is involved

The predicate now lives in `scripts/step70-gate.mjs`, imported by the watcher and exercised by
`scripts/step70-gate.test.mjs`, so it can be inspected without a call. It returns *reasons to
refuse*; an empty list is the only thing that authorises a click, so an unfamiliar card shape
defaults to refusing rather than to acting. It is re-evaluated immediately before the click, and
aborts if the card changed underneath the read.

`node scripts/step70-gate.test.mjs` prints the whole table. The two conditions are: the status must
say **Ringing**, and the card must carry the expected digits (compared digits-only, so `8800000004`
and `+91 88000 00004` match).

| Card | Decision |
|---|---|
| `who="Contact D" status="Ringing · 8800000004"` | **CLICK** |
| `who="Contact D" status="Ringing · +91 88000 00004"` | **CLICK** |
| `who="Chetan" status="Dialling · +919800000001"` — the card it wrongly hung up | REFUSE, both reasons |
| `who="Contact D" status="Dialling · 8800000004"` — right person, outgoing | REFUSE |
| `who="Mother" status="Ringing · +918300000006"` — a real call arriving mid-test | REFUSE |
| `who="Contact D" status="In progress · 8800000004"` — already answered | REFUSE |
| `who="Unknown number" status="Ringing"` — withheld caller ID | REFUSE |
| no live card | REFUSE |

Two of those rows are not hypothetical. The third is the exact card from the failed attempt. The
fifth is somebody's real call — the phone took two of those during this sitting — and rejecting one
would be dropping a stranger's conversation from a test script.

When it refuses it logs, once per distinct card:

```
SKIPPING a live card, not touching it — state is "Dialling · +919800000001", not Ringing; card does not carry 8800000004
    who="Chetan" status="Dialling · +919800000001"
```

and on timeout it says how many cards it left alone, so a run that saw the wrong calls and did
nothing is distinguishable from a run that saw nothing at all.

### Step 70 preconditions, re-verified against the post-42, post-43 build

Build installed `2026-08-29 00:41:12`; Mac rebuilt and relaunched at 00:46.

| # | Precondition | Reading | Control |
|---|---|---|---|
| 1 | link up | 3 ports bound; `Connected to Samsung SM-S938B` 00:46:13 | — |
| 2 | `READ_CALL_LOG` | `granted=true` | the other seven Phase 4 permissions read true in the same dump |
| 3 | `Watching PHONE_STATE for the inbound number` | present, 00:41:13 | `Could not watch PHONE_STATE` count: **0**, same grep |
| 4 | call-log tail noted | `type=2, +919800000001, date=1787944374680` | the step 70 row must be a **different** number with `type=1` then `type=5` |
| 5 | episode denominator | `1 of 2 episodes with a number` | must become `2 of 3` |
| 6 | caller is in contacts | `Contact D / 8800000004` | this is what makes clause 35c strict |
| 7 | no live call, nothing armed | `#call-live` hidden, `#call-answer`/`#call-reject` absent, `#call-dial` reads `Call`, input empty | **173 buttons enumerated** in the same DOM |
| 8 | capabilities | `calls: available`, `contacts: available` | 12 chips enumerated, 7 on |

**Ready.** The command for the ring is `node scripts/step70-watch.mjs 8800000004`.

---

### Defect 44 — a message sent on the phone never reaches the Mac — **open, found by reading during Phase 5 preparation on 2026-08-29**

Severity: **Medium.** Numbered separately from defect 39 at the user's instruction, and the reason is
worth keeping: **39 and 44 have the same symptom and different causes, and an unnumbered 44 gets
folded into 39 and half-fixed.** A fix for 39 alone — making the Mac's own send appear in its own
pane — would look complete, close the visible bug, and leave the phone's keyboard silently
diverging from the Mac's thread forever.

**Found by reading, not by a step.** No test covers it because every SMS test so far has sent from
the Mac.

`SmsFeature` pushes exactly one event:

```
SmsFeature.kt:134   link.broadcast { session -> session.send(Envelope(type = MessageType.SMS_RECEIVED, …)) }
```

and `MessageType` declares exactly four SMS types — `sms.threads`, `sms.messages`, `sms.send`,
`sms.received`. There is no observer on outgoing provider rows and no event that could carry one. So
a message typed on the handset is invisible to the Mac until something else causes a full
`sms.threads` or `sms.messages` refresh.

**Control on that absence, since it is an absence claim:** the same grep over the same file finds
the one push that does exist, at `SmsFeature.kt:134`, and `grep -n "SMS_" Messages.kt` returns four
constants and no fifth. The query can see pushes and can see type declarations; there is genuinely
no second one.

**Distinguished from defect 39.** 39 is a race: the Mac's composer re-fetches 30 ms after its own
send, before the provider has written the row, and nothing appends it afterwards. 44 is a missing
feature: there is no mechanism at all, and no amount of retrying on the Mac would produce one,
because the Mac is never told. 39 is fixable on the Mac alone; 44 is not.

**Fix direction — one mechanism closes both, and that is why the shape matters.** The `sms.sent`
event proposed in `docs/phase-5-proposals.md`, emitted on *any* new outgoing provider row regardless
of origin. It must reuse defect 34's bounded retry (`PROVIDER_LOOKS` = 3 at 150 ms) and its
`after N lookup(s)` success line, because it faces the same asynchronous provider write that
`sms.received` does — `SmsFeature.onSend` already documents that the thread id "can still be null on
the first message to a new number".

**Wrong fix to avoid:** fixing 39 by enriching `sms.send`'s ack and stopping there. The ack answers
only the client that asked, so a message typed on the phone still never arrives — and the visible
half of the problem would be gone, which is what makes it the tempting stopping point.

**Also needs an observer.** `sms.received` is driven by the inbound broadcast; there is no equivalent
broadcast for an outgoing message. The likely mechanism is a `ContentObserver` on
`content://sms/sent` (and the MMS equivalent), which is a *different* trigger from the one
`sms.received` uses and is the part of this that is genuinely new work rather than a second caller
of an existing path.

---

## Step 70 — **35c FAILS**, 36 still untested; defect 45 found, defect 42 reopened — 2026-08-29 09:52

The ring happened before the watcher was armed, during precondition checks, and it is decisive
anyway. **Nobody needs to be asked for another one** — the experiment this needed has already run,
and it produced a clean negative.

### The three inbound episodes of this process, against the platform's own log

The app's account is the thing under test, so `content://call_log/calls` is the arbiter.

| App episode | The app said | Platform row | Verdict |
|---|---|---|---|
| `c1` 08:29:44 | `ringing number withheld by the platform` | `08:29:43 MISSED +919900000002` | **blank** — the number existed |
| `c2` 09:40:24 | `ringing from +919900000002 (Contact B)` | `09:40:23 INCOMING` **`+918200000005`** dur=344 s | **wrong number — and it is exactly c1's** |
| `c3` 09:52:11 | `ringing number withheld by the platform` | `09:52:11 REJECTED` **`+918800000004`** | **blank** — and this is the step 70 ring |

c2's identification is not a guess: the timestamps match to a second and its `answered after 350620ms`
matches the platform's 344 s duration plus ring time. The number it displayed is the number of the
episode before it.

### 35c — **FAIL**

`c3` is the step 70 call: an inbound ring from Contact D's handset, `+918800000004`, with
`READ_CALL_LOG` and `READ_PHONE_STATE` both granted and the receiver registered **in this process**
(`01:39:49.122 Watching PHONE_STATE for the inbound number`, with `Could not watch PHONE_STATE` = 0
in the same window).

```
phone 09:52:11.705 I [calls] Call c3 ringing number withheld by the platform — 1 of 3 episodes with a number
Mac   09:52:11.407 I [calls] call.incoming c3 (ringing) with no number from the platform
```

The Mac card's headline would have read **`Unknown number`**. That fails the strict clause
(`Contact D`) and it fails the original disjunction too — it is neither a name nor a number.

Two things about that Mac line are worth separating from the failure. It is defect 43's wording
doing its job: the honest sentence rather than `from ,`. And it is **not** a Mac defect — the phone
genuinely had nothing to send.

### 36 — still untested

No `call.reject` was sent for `c3`; the Mac's counter reads `0 acted on`. The phone reported
`ended missed after 11235ms` while the platform recorded `type=5 REJECTED`, and **that combination
is correct here, not defect 36**: the call was rejected on the handset, and `dispositionOf`'s own
comment says the platform does not tell a third-party app whether a ring that went straight to idle
was declined or ignored, so `missed` is the honest answer for both. Defect 36 is about a
**Mac-initiated** reject, which did not happen. It remains fixed-but-unproven.

Note the asymmetry the step's control was written for: *`rejected` on the Mac with no `type=5`*
would be the alarming direction. `type=5` with `missed` is the documented, expected one.

### Defect 45 — `EXTRA_INCOMING_NUMBER` never arrives on this device, and 35c's mechanism rests on it — **open**

Severity: **High**, because it invalidates a claim in the code and a step's premise at once.

`CallWatcher.registerPhoneState`'s comment asserts:

> *"`EXTRA_INCOMING_NUMBER` is filled only for a receiver holding `READ_CALL_LOG`, which the `calls`
> capability already requires all of, so it is populated whenever the pane is lit."*

**That assertion is false on this phone.** The device is **Android 16, SDK 36**. The extra was
deprecated at API 29 and is not delivered to an app that is not the default dialer or an
`InCallService`; holding `READ_CALL_LOG` is necessary and not sufficient. Both grants are present
and the receiver is registered, and the extra still did not arrive for c1 or c3.

**And the finding that makes this worse than "one step failed": there is no confirmed instance of
this mechanism ever having worked here.** Every inbound number the app has ever displayed correctly
is explainable as residue from a previous episode:

- `c2` today is **proven** residue — the number shown belonged to the previous call.
- Last night's `c4` at 00:29:31 read `ringing from 8800000004 (Contact D)` and was recorded at the
  time as unusable for exactly this reason: *"the two episodes before it involved the same number
  … a correct read and a stale carry produce the identical string."* It is now clear which it was.

So the honest position is that the inbound-number path has **never been observed working**, and was
believed to work because residue kept producing plausible answers. That is the same shape as defect
31 (a lit chip over dead wiring) and step 64 (a feature passing on its own commands while its push
half was dead).

**Fix direction — and the shape to avoid is the one already rejected three times.**

The tempting fix is to read the call log at ring time. **Do not**: the row for a call that is still
ringing has not been written — `c3`'s row exists now only because the call ended — so the read
returns the previous call's row and reproduces defect 42 by a second route. That is
`dispositionOf`'s rejected shape, defect 36's shipped wrong fix, and defect 39's open temptation,
for the fourth time.

The real options, none of them small, and this needs a decision before code:

1. **`CallScreeningService`** — receives `Call.Details.getHandle()` for incoming calls, is a
   documented public API, and does not require being the default dialer. It does require the user to
   grant the *call screening* role, which is another onboarding step and another thing that can be
   revoked. This is the most likely answer.
2. **`InCallService`** — full call control, requires becoming the default phone app. Far too much
   for showing a caller's name, and it would make ConnectSuite responsible for the entire dialer UI.
3. **Accept the platform wall and say so.** Report inbound calls with no number and a specific
   reason, the way `docs/permissions.md` documents the call-audio wall. This is the honest fallback
   and should be what ships if option 1 is rejected — locked decision #6 requires a reason string,
   not a blank.

**What must not happen is 35c being quietly reclassified as passed on the strength of a residue
reading.** It has failed, the mechanism behind it has never been seen to work, and the record says
so.

### Defect 42 — **reopened**: the fix is incomplete on the inbound path

42's fix made a `dialing` episode refuse a number it did not obtain for itself, and deliberately let
a `ringing` episode keep whatever the field held, on this reasoning in `CallNumberRules`:

> *"Inbound: the PHONE_STATE broadcast is the source, and it fires alongside this transition."*

**That premise is false here** — see defect 45 — so for inbound calls the field's contents are
residue, and `c2` displayed the previous caller's name and number to the user. The guard test
`an inbound ringing episode keeps the number the broadcast gave it` still passes and is still
correct as written; it encodes the assumption, and the assumption is what broke.

**Fix direction:** an episode must not begin with a number it did not obtain *for itself*, with no
exception for the inbound path. `numberAtEpisodeStart` should return `carried` only when the value
was written for this episode — the same provenance flag `numberFromDial` provides for outgoing, one
for the broadcast — and otherwise blank. On this device that makes every inbound card read
`Unknown number`, which is **correct and much better than a stranger's name**, and it is what makes
defect 45's fallback honest rather than silently wrong.

Do this **before** any work on 45's mechanism: a blank is recoverable, a confidently wrong name is
not, and 45's real fix needs a design decision while this one does not.

---

## Defect 42's inbound half — fixed 2026-08-29, and a correction to yesterday's diagnosis

### The correction first, because it changes what defect 45 is

Yesterday's record said `EXTRA_INCOMING_NUMBER` "never arrives on this device". **That is not what
the evidence shows, and the more precise statement matters.**

Only three lines in `CallWatcher` can write `number`: `expectOutgoing` (needs a `call.dial`), the
`PHONE_STATE` receiver, and the two clearing assignments. Between `c1` at 08:29 and `c2` at 09:40
the link was **down** — the Mac did not connect until 09:51 — so no `call.dial` happened. The only
writer left is the broadcast. Therefore:

> **The extra is delivered. It arrives *after* the state callback**, so `begin()` has already
> published a blank card — and on `c1`, a call that lasted **197 ms**, it arrived after `end()` had
> blanked the field, filled it, and sat there for 71 minutes until `c2` read it as its own.

Both stories produce the identical symptom, which is why the logs alone could not separate them:
**every non-empty inbound number this app has ever displayed was residue.** That statement is
unchanged and is the one to carry forward. What changes is the cause — "never in time" rather than
"never at all" — and it opens a repair option that "never at all" would have ruled out. See the
defect 45 brief.

**This was never a working feature that regressed.** There is no earlier state to get back to. The
inbound-number path has not once been observed delivering a number to the episode it belongs to;
the readings that looked correct were the previous caller's number arriving late enough to be
mistaken for the next one's. Anyone reading the earlier `ringing from …` lines as evidence of a
working state is reading residue.

### The fix

Two rules in `CallNumberRules`, and the second got simpler because the first got stronger.

1. **`numberAfterBroadcast` gains `episodeLive`.** The receiver may fill the field only while an
   episode is in progress. A broadcast arriving between episodes belongs to a call that has ended,
   and is dropped. This makes the residue **structurally impossible** rather than unlikely.
2. **`numberAtEpisodeStart` loses its `phase` parameter entirely.** With rule 1 keeping the field
   empty between episodes, there is exactly one way an episode can hold a number at `begin()`: a
   `call.dial` this Mac placed. The inbound special case — *"the broadcast is the source and it
   fires alongside this transition"* — was the bug, so it is gone rather than adjusted. The question
   is provenance, not direction.

**The trade, made deliberately.** On a device that delivers the extra *before* the state callback,
this discards it and the card reads `Unknown number`. That is a real cost and it is the right way
round: a blank is visibly missing and recoverable; a stranger's name on a live call is neither.
Defect 42 showed a user someone else's name, and buying a number back on an untested OEM is not
worth making that possible again.

### Tests

Nine in `CallNumberRulesTest`. The inbound half was reintroduced and **four** went red, including
both that name the reopening:

```
FAILED  defect 42 reopened - nothing may be written between episodes
        expected:<[]> but was:<[+919900000002]>
FAILED  defect 42 reopened - an inbound episode starts blank too, with no exception
        expected:<[]> but was:<[8800000004]>
```

**The falsified guard was rewritten, not deleted.** `an inbound ringing episode keeps the number the
broadcast gave it` passed for the entire life of this bug, because it encoded the assumption that
anything in the field belonged to the current episode. Its successor —
`an inbound number arriving during its own episode is kept, and is not lost by this fix` — guards
the property that is still worth guarding, and asserts it *where the number is written*, which is
the only place that can tell "mine" from "left over". Deleting it would have removed the protection
against this fix over-correcting; keeping it as written would have kept asserting the false premise.

Full phone suite: **176 tests, 0 failures.** Installed 10:01; link up, all seven capabilities.

### Instrumentation added for the defect 45 decision — data, not a decision

The receiver now logs every `PHONE_STATE` broadcast with three facts and a ratio:

```
PHONE_STATE RINGING: number present, episode live — taken — 4 with a number / 11 without since start
```

state, whether the extra was there, whether an episode was open, whether the value was taken, and
both counts. That is exactly what separates "never arrives" from "never arrives in time", which is
the question the 45 decision turns on and which no existing log can answer. Both cases are logged at
the same volume with the ratio on each line, per CLAUDE.md.

**No one needs to be asked to ring for this.** The phone took three real inbound calls this morning
unprompted; the next one produces the reading.

### Verification status — honest

- **Outgoing half:** verified on hardware yesterday and untouched by this change.
- **Inbound half:** unit-tested and **not yet verified on hardware**, because it needs a real
  inbound call. It will be verified by the next one to arrive on its own. The reading to look for is
  an inbound episode whose card is blank rather than carrying the previous caller's identity, and a
  `PHONE_STATE` line showing whether the extra arrived and whether it was taken.

---

# The app shell — 2026-08-30

**Not a phase.** The shell is Phase 7's territory (Mac UX and polish) built early, because every
pane landed so far had nowhere to live: the window was one scrolling column of `<section class=
"card">` with a Connection debug panel at the top that appears nowhere in the design. No amount of
pane-level restyling could have made that read as `ConnectSuite.dc.html`.

## What was built

Window, ambient ground, sidebar (traffic-light row, brand, device card, eleven nav rows in two
groups, footer), the measured nav pill, the 60px title-bar band, the status island, the page header
and its toolbar, the dock, the ⌘K palette, the toast, and the connected-device strip. Eleven screens
plus a pairing route with no sidebar row.

New files: `src/renderer/icons.ts`, `navModel.ts`, `shell.ts`, `shell.css`, and three test files.
`docs/design-departures.md` §"App shell" holds every deliberate difference from the design, S1–S12.

## Where the Connection debug card went

**Nothing it showed was deleted.** The handoff has a home for it — §12 Settings → Advanced, "a mono
diagnostics block (link, codec, session, reconnects) with a violet caret" — so the HUD was reshaped
into that block. The four named lines are the headline; the eleven readings that do not fit one of
them (capture geometry, rotation, both latency splits, time to first frame, dropped, last error)
are listed underneath rather than dropped. The four link buttons, the manual address, the Tailscale
address and Forget phone went to Settings → Connection. The log tail is under the diagnostics.

`reconnects` reads `not counted on this build` rather than `0`. Nothing on the Mac counts them, and
`0` is a claim that the link has never dropped.

## Evidence

Driven over CDP on port 9222 against the running app, phone connected (Samsung SM-S938B, 7–14 ms).

| Check | Control | Result |
|---|---|---|
| The shell exists | — | 12 screens, 11 nav rows, 5 dock tiles in the DOM |
| Icons are drawn | 31 `<svg>` in the document; the same query returned **0** before `icons.ts` | pass |
| Window ground is `--canvas` | `getComputedStyle(body).backgroundColor` | `rgb(7, 7, 10)` — was `#101014` |
| Accent is the design's violet | `--accent` read from `:root` on the live page | `#8b6bff` — was `#6ea8fe`, silently overridden |
| Window and type are the design's | measured, not requested | `innerWidth` 1440, sidebar 232px, page title 31px |
| Nav pill is measured, not computed | `transform` read from the live pill | `matrix(1,0,0,1,0,22)` on Overview |
| Muted pill contrast | composited in-page: text over the violet tint over the panel over the ground | **13.28:1**, was 2.23:1 |
| Sidebar badge matches the pane | badge vs the pane's own note | both read 23 |
| Floating window button is Mirror-only | read on two routes | `none` on Overview, `flex` on Mirror |
| Diagnostics carry every HUD reading | screenshot of Settings → Advanced | 4 headline + 15 detail lines |

### Three bugs the screenshots found that no check could

Each was invisible to `tsc`, to `npm test`, and to every hook in the repo.

1. **The ⌘K palette drew over every screen, permanently**, with `el.hidden === true`.
   `.palette-backdrop { display: flex }` and the UA's `[hidden] { display: none }` are both
   `(0,1,0)`, so the later sheet won. Fixed with `[hidden] { display: none !important }`.
2. **The whole app rendered at 0.72 zoom.** Chromium persists a per-origin zoom level into the user
   data directory; a stray ⌘- at some point had every size in this design drawn at 72% across
   launches. `webPreferences.zoomFactor` is only the initial value and did not hold —
   `setZoomLevel(0)` on `did-finish-load` does. **Worth knowing before any future screenshot
   comparison is trusted.**
3. **The Floating window button drew on all eleven screens**, because styles.css redefined
   `.toolbar-button` and loads after shell.css.

The third is the same shape as the `:root` collision behind the blue accent, so it got an
enforcement point instead of a third fix — `stylesheets.test.ts`, below.

## Tests: 81 → 106

| File | What it holds | Shown to fail by |
|---|---|---|
| `icons.test.ts` | no icon is empty; every icon is on the 24px grid; stroke stays in 1.5–1.7 and grows as size shrinks; only `dots` is filled; no icon carries its own colour | blanking `refresh`'s geometry |
| `navModel.test.ts` | **commands rank above navigation** in ⌘K; every icon the shell asks for exists; every unbuilt screen carries a reason and no built one does; pairing is a route with no row | reversing the palette arrays; deleting `capture`; dropping Files' `unbuiltReason` |
| `stylesheets.test.ts` | no selector is declared in two of the three sheets; only tokens.css declares custom properties | re-adding `.toolbar-button` to styles.css; re-adding `:root { --accent }` |
| `notifyLabels.test.ts` | count assertion **7 → 10** | — |

Two of the new assertions were themselves wrong first and are worth recording, because they are the
control rule biting inside a test file rather than outside one. The grid check read the `-2.5` in
`a2.5 2.5 0 0 1-2.5 2.5` as a coordinate off the left edge and failed the `mirror` icon; corrected
to check magnitude, it then read `-.45` as the integer 45 and failed `messages`. Both were false
positives from a regex deciding something only a path parser can decide, and the assertion is now
narrowed to what a regex genuinely can decide — and says so, rather than being dressed up as the
stronger check it is not.

The icon guard was also wrong first, in the direction that matters more: it enumerated the sidebar
and the dock only, and **passed with `capture` deleted from `icons.ts`** — a guard that did not
cover the two glyphs the defect was actually about. `TOOL_RAIL` and `GLOBAL_ACTIONS` moved into
`navModel.ts` so they are inside the enumeration, and there is now an assertion naming both.

## Defect 28, again

`notifications.ts` composed three strings inline — the dismiss button's accessible name, the
no-reply-action sentence, the Send button's accessible name. All three called `appLabelOf` and were
**correct**; none was in `userVisibleStringsOf`, which is the enumeration the defect-28 test asserts
over. Nothing user-visible was wrong; the guard had a three-string hole in it, so the next edit to
any of those lines had nothing checking it. They moved into `notifyLabels.ts`, the count assertion
went 7 → 10, and `notifications.ts` now carries the rule at the top: **compose nothing in this file.**

## Not verified here

The pairing route has not been driven, because the phone is paired and unpairing it to see a screen
would cost a re-pair on hardware for a cosmetic check. The dock's magnify falloff, the palette's
arrow-key selection and the toast's 2.4s dismiss were exercised in the DOM but not screenshotted
mid-animation.

---

# Measured against the prototype — 2026-08-30

Both pages driven over CDP with `Emulation.setDeviceMetricsOverride` at **1440 × 920**, so nothing
in the table below is the display's doing. This matters: the first run of this comparison put the
app window at 1100 and the artboard at 1442 and produced 42 "differences", most of which were the
viewport.

`ConnectSuite.dc.html` is rendered by pointing a throwaway Electron main at it on port 9333. The
Chrome extension was not connected; the artboard is the one `div` whose inline width is `1440px`.

## The control that made the numbers usable

Every anchor reports **what it matched** — tag, class, first words — beside every measurement, and
the diff prints both. It was added after the first run reported a "device strip" departure that was
the design's *sidebar device card* (same 14px radius, same words in it) and a "primary card"
departure that was this build's **hidden pairing card**. Both produced clean, specific, confident
wrong numbers.

Two rows in the final table are still anchor artefacts and are named as such rather than counted:
the Mirror elevation-3 hit is `button:hover`, whose fill is `#1c1f2b` in **both** (an exact match,
not a stray card), and the Notifications detail card does not exist until a row is selected, so the
probe now selects one.

## Shell-level: 19 differences → 3

| Cause | Was | Now |
|---|---|---|
| `* { box-sizing: border-box }` against a prototype whose bordered **divs** are content-box (its buttons are not) — nav pill, status island, dock tile, strip thumb all drew 2px short | 40/30/38/42 vs 38/28/36/40 | exact |
| Sidebar declared 232 with the border inside it; the design's 232 is content plus a 1px border | 8 measurements off by 1px | exact |
| `MENU` group header `height:22px` swallowed its own 8px of padding | 22 vs 30, and the nav rhythm with it | exact |
| `SYSTEM` header height, measured by the Camera→Activity pitch | 82 vs 74 | exact |
| Brand name inheriting the body's 1.5 line-height | 22.5 vs 16 | 15.8 vs 16 |
| Card padding taken at the top of the handoff's 16–24px range | 24 vs 20 | exact |

**Nothing in the type scale ever differed.** Not one `font-size`, `font-weight`, `letter-spacing` or
`color` row appeared in any run — the only typographic differences are string *widths*, which are
Archivo against SF Pro (departure X4) and not fixable without a webfont this product will not ship.
No `border-radius` row appeared either.

## The one a token check could never have found

The window ground. The design's window measures `rgb(7,7,10)` with `background-image: none`; this
build was painting `radial-gradient(1200px 700px at 30% 0%, #191134 …)` inside it and every screen
read visibly violet across the top-right.

Every token in that gradient was correct. The error was reading the README's *"**Outer** page ground
is a radial violet-to-black gradient"* as the window's fill, when "outer" means the surface the
artboard sits **on** — the page behind the window in the mockup. A real Mac window has nothing
behind it, so the gradient does not exist here at all. The three drifting blobs, which genuinely are
inside the window in the prototype, stay.

Found by putting the two screenshots side by side. It is the third bug in two sittings that was
invisible to `tsc`, to 108 tests, and to reading the tokens, and visible immediately in a picture.

## Elevation: the one primary card per screen

Counted by querying for `rgb(28, 31, 43)` on both sides, per screen.

| Screen | Design | Before | After |
|---|---|---|---|
| Overview | 1 @ 579 | 1 @ **1152** | 1 @ **578.6** — exact |
| Mirror | **0** | 1 @ 786 | **0** — the design's Mirror card is elevation **2**, measured `rgba(22,24,34,.82)`, 22px padding |
| Messages | 1 @ 539 | **0** | 1 @ 815 |
| Notifications | 1 @ 380 | 1 @ 380 | 1 @ **380** — exact |
| Calls | 1 @ 519 | **0** | 1 @ 1151 |
| Settings | 1 @ 599 | **0** | 1 @ 927 |

Three screens had **no primary surface at all**, so every card on them read at the same weight —
the "surfaces must not all read at the same weight" rule failing in the direction that is hardest
to see, because everything looked deliberate.

Measuring also turned up a token that was missing: elevation 3 carries a **stronger** hairline and
lit edge than elevation 2 — `rgba(255,255,255,.10)` and `.07` against `.08` and `.05`. It is now
`--hairline-primary` / `--inner-highlight-primary` rather than four hardcoded values, one of which
(`.detail-card`) had a panel's hairline under a primary card's fill.

## A real layout bug the measurement caught

**Messages scrolled horizontally by 1602px.** A flex child defaults to `min-width: auto` — never
smaller than max-content — so the contact-name span sized the thread button, the button sized the
list, and the list sized the `1fr` grid track. Both halves were needed: `min-width: 0` on the span
*and* on the grid children. The page body must never scroll horizontally.

## Structural differences that remain, and why

15 across six screens, every one traceable:

- **Messages** (6): the design's elevation-3 is a *thread column* with no padding inside a
  three-column layout; this build has conversation + contacts, because contacts has no pane of its
  own in the design and Messages is where the design puts it.
- **Calls** (4) and **Settings** (2): both are single- or two-column here against the design's
  multi-column, because the columns that are missing are the ones cut in departures X2 — an account
  card, two-factor, "sign out everywhere", "you are up to date".
- **Overview** (1) and **Notifications** (1): 2px of content-driven height.
- **Mirror**: **0**.

## State A rebuilt to its own specification

The five unbuilt screens were drawing a generic card that violated three points of the state-A note
in `docs/mac-ui-design-proposals.md` §3 — the tag was `--warning`, which is **state B's colour** and
would have made five screens read as "something is wrong" rather than "this was never written";
there was no 15px/600 headline; and there was no mono handle naming the wire namespace that does not
exist. All three are now drawn, at ~340px on `--elev-2`.

`navModel.test.ts` gained two assertions, both shown to fail: every unbuilt screen carries a
headline, a reason and a handle, and the headline does not merely restate the tag; and a screen with
no proposed namespace **says so** rather than inventing a plausible `clipboard.*` that would send a
reader to `docs/protocol.md` looking for something never designed. Only `fs.*` and `media.*` are
real, and only because `docs/phase-5-proposals.md` names them.

The two dock tiles that lead to unbuilt screens (Files, Camera) are desaturated and their tooltips
say so. That is a deliberate deviation from the state-A note's "no dock tile": removing two would
leave a three-tile dock, changing the design's composition for a reason that expires as each phase
lands.

## Suite

108 tests, 0 failures, `tsc --noEmit` clean.

---

# Measurement pass, second run — 2026-08-30

Re-taken after the shell fixes, State A and the Stop-button move, because the build had changed
under the previous numbers. Same harness, both pages at a matched **1440 × 920**. The deliverable
this time is **per screen**, with the element each number was read from, and every row classified as
build-side (work), design-side (documented), typeface, live data, or untestable.

## Two controls were wrong before they were right

**1. The scrollbar gutter.** The design's Overview and Mirror columns overflow and claim an **11px**
gutter; on other screens ours does and theirs does not. Every width in a column moves by 11px for
that reason, and it is not the design. Rows affected are now marked untestable-in-this-state with
the overflow flags as evidence, rather than counted.

**2. The control for that control was measuring the wrong element** — `.screen`, a plain block
inside the scrolling `.page`, whose gutter is 0 whatever is happening. It therefore always said
"comparable", passed Messages as gutter-matched, and let an 11px artefact through as **the run's
only build-side row**. A control that cannot fail is the shape this repo keeps recording, and it
came within one step of being reported as work.

## The elev-3 anchor matches by weight, not by role

Finding the one primary card by querying for `rgb(28,31,43)` guarantees the same *surface weight* on
both sides and says nothing about it being the same *component*. The identity strings decide it, and
the decision is now recorded rather than left implicit:

| Screen | design anchor | built anchor | same component? |
|---|---|---|---|
| Overview | `section.cs-card "Galaxy S26 Ultra…"` | `div.card.primary "Samsung SM-S938B…"` | yes — device hero |
| Mirror | none drawn | none drawn | yes — neither draws one |
| Messages | `section "RS R. Sharma +91 98765 4321"` | `div.pane.primary "50 conversations…"` | **no** — a message thread vs the conversation *list* |
| Notifications | `aside "Chat Today, 09:42 UNREAD…"` | `div.detail-card "System UI…"` | yes — the detail |
| Calls | `section "End-to-end encrypted RS R."` | `div.pane.primary "Call 50 recent calls…"` | **no** — a live-call card vs the dialer + log |
| Settings | `section "General How ConnectSuite…"` | `div.settings-body "Connection How this Mac…"` | yes — the centre pane |

On Messages and Calls no property comparison between those two elements is evidence, so all of them
are untestable rather than departures. Without that check they read as 10 differences.

## Result, per screen

| Screen | anchors proven | untestable | **build-side** |
|---|---|---|---|
| Overview | 16 | 2 | 0 |
| Mirror | 16 | 1 | 0 |
| Messages | 17 | 7 | 0 |
| Notifications | 17 | 1 | **2 — fixed below** |
| Calls | 17 | 4 | 0 |
| Settings | 17 | 0 | 0 |

Everything else is typeface (X4 — no `font-size`, `font-weight`, `letter-spacing` or `color` row has
ever appeared, only string *widths*), live data, or a documented design-side departure.

## What the census found that the anchors could not

The named anchors are shell-level. A per-screen inventory of every surface and every type size —
**inventory, not a diff; no pairing claimed** — surfaced two things, both then paired by role and
confirmed:

**1. The notification row was 28px too tall.** Design 66px with `padding: 0 12px`; ours 94px with
14px all round. The **content box was 66px on both**, so every one of those 28px was our own
vertical padding. At 94px the list showed five rows where the design shows eight. Now 66×66, radius
and padding exact.

**2. There is a fifth surface in the design and we had no token for it.** `#111219`, a *recessed*
well below elevation 2, used by the prototype for the notification list, the Settings rail, the
Settings right-hand cards and the diagnostics block. It is **not in the handoff's written colour
table**, which lists four elevations and stops — but it is drawn on four surfaces across three
screens. Now `--well`, and the two places that already used the value hardcoded read the token.

Notifications was restructured to the prototype's shape while fixing it: the two columns are a well
and the detail card sitting directly on the canvas, where this build had wrapped both in an
elevation-2 panel — a surface underneath two surfaces, which made the list read as raised rather
than as something the rows sit inside.

## A dead stylesheet block, found by measurement

Chasing the row padding turned up **two** `.notif-row` rules in `styles.css`, 408 lines apart. The
whole pre-redesign notification block was still there — nine selectors, all re-declared 400–600
lines below, all silently losing. Reading the file top-down described a 6px-radius row on a 4% white
fill that the app had not drawn since 2026-08-29.

`stylesheets.test.ts` guarded collisions *between* sheets and not *within* one. It now fails on any
selector declared twice in one sheet more than **100 lines** apart. The threshold is from the data:
every deliberate override in this codebase sits 5–19 lines from what it overrides (`.island-dot`,
`body`, `.stop-button`), and the dead block sat 408–593 apart, with nothing in between. Shown to
fail by re-inserting a `.notif-row` 120 lines above its replacement, and it carries both controls —
one proving it sees a dead block, one proving it lets an adjacent override through.

## Suite

110 tests, 0 failures, `tsc --noEmit` clean.

---

# Measurement pass, third run — 2026-08-30

Same harness as the two passes above: both pages driven over CDP at a matched **1440 × 920**, the
prototype rendered by pointing a throwaway Electron main at `ConnectSuite.dc.html` on port 9333, and
every anchor printing the identity string it matched — tag, class, own text — on **both** sides.

This run closes the two gaps the second pass left: the type and colour census, which had never
actually run, and the ten Messages/Calls rows it recorded as untestable. Then the five unbuilt panes
and two carry-overs.

## Section 1 — The type and colour census

The previous pass reported that "nothing in the type scale ever differed" and attributed every
observed difference to string widths under Archivo vs SF Pro. **That claim does not survive being
measured.** It was made without a per-property comparison ever having run: no `font-size`,
`font-weight`, `line-height`, `letter-spacing` or `color` row appeared in the output *because no
such row was ever produced*. An absence that the query could not have shown is not a finding — it
is the empty-accessibility-tree shape, one layer up.

Run properly, **65 of 83 paired anchor readings differ on at least one of the six properties.**

### 1.1 The typeface question, settled as a fact

Three sources, read rather than inferred:

| Source | What it says |
|---|---|
| `design_handoff_connectsuite/README.md` line 91 | "Archivo throughout (`font-family: 'Archivo', system-ui, sans-serif`; **substitute the codebase's native UI face if it has one — SF Pro is an acceptable native swap**)." |
| The prototype HTML | Loads Archivo from `fonts.googleapis.com` (`<link rel=stylesheet …family=Archivo:wght@400;500;600;700>`) and sets `font-family:'Archivo',system-ui,sans-serif` on `html,body`. |
| The build | `--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`. **Not vendored, and not a fallback** — SF Pro is named first and resolves. |

**The handoff is not silent, and it does not forbid what we draw. It names Archivo and explicitly
sanctions SF Pro as a native swap.** So this is a sanctioned substitution, not a defect, and not
the same class of finding as the blue `--accent` or the 0.72 zoom — both of which were the build
disagreeing with the design with nothing in the handoff permitting it.

`tokens.css` already carries the reason, and it is a second, independent one: the renderer's CSP is
`style-src 'self'`, so a `fonts.googleapis.com` import is blocked outright, and vendoring a woff2
would put a webfont in an app whose first line of description is "no cloud, no account, no relay
server".

**The control that makes the attribution usable.** A prototype that had *failed* to load Archivo
would fall back to `system-ui` — and then every string-width difference blamed on the typeface would
be blamed on a font that was never drawn, while the real cause went unlooked-for. So the prototype
was asked, at the moment of measurement:

```
document.fonts.status        → "loaded"
document.fonts.check('400 16px Archivo') → true
document.fonts.check('600 16px Archivo') → true
[...document.fonts] → Archivo 400 loaded; Archivo 500 loaded; Archivo 600 loaded; Archivo 700 unloaded
```

Archivo 400/500/600 are genuinely loaded and drawn. (700 is unloaded because nothing in the design
asks for it.) **The typeface attribution is real.** The mono face is identical on both sides —
`'SF Mono', ui-monospace, Menlo, monospace` — so no mono row is ever a typeface row.

**Verdict: no fix. Departure X4 stands, now on evidence rather than inference.**

### 1.2 What the census actually found: the build invents line-heights the design does not

The handoff's type table gives a line-height for **exactly one** role:

| Role | Handoff spec | line-height given? |
|---|---|---|
| Page title | 31px / 600 / -0.02em | no |
| Section + card title | 15–21px / 600 / -0.015 to -0.02em | no |
| Body | 13–13.5px / 450–500 / **1.5 line-height** | **yes** |
| Control label | 12.5–13px / 500 | no |
| Meta | 11–12px / 500 / 0.02em | no |
| Sidebar group header | 10px / 600 / 0.12em / uppercase | no |

The prototype behaves accordingly: it sets an explicit `line-height` on the page title (1.15) and on
body copy (1.5), and leaves **every other text element at `normal`** — the face's natural leading.

The build sets a line-height on nearly everything, from four type tokens carrying ratios
(`--text-section` 1.3, `--text-card-title` 1.25, `--text-control` 1.2, `--text-meta-size` 1.3) and
from the body's inherited 1.5 reaching labels that are not body copy.

**The two roles where the handoff specifies a line-height match exactly on both sides**, which is
the control for this finding — it is not that the harness reports everything as different:

| Anchor | Build | Proto |
|---|---|---|
| page title | 31px / 600 / lh **35.65** / -0.62 / `#f4f4f7` | 31px / 600 / lh **35.65** / -0.62 / `#f4f4f7` |
| page subtitle | 13.5px / 450 / lh **20.25** / 0 / `#9c9fb0` | 13.5px / 450 / lh **20.25** / 0 / `#9c9fb0` |

Every role where the handoff is silent differs, and in both directions — this is not one global
ratio being wrong, it is per-element guesses:

| Anchor | Build lh | Proto lh | Δ | Read from (build / proto) |
|---|---|---|---|---|
| device hero name | **31.5** | 23 | **+8.5** | `h2.hero-name "Samsung SM-S938B"` / `h2 "Galaxy S26 Ultra"` |
| fact label | **16.5** | 12 | **+4.5** | `dt.fact-label "Connected via"` / `div "Connected via"` |
| dock tooltip | **16.5** | 12 | **+4.5** | `span.dock-tip "Mirror"` / `span.cs-tip "Mirror"` |
| sidebar group header | **15** | 11 | **+4** | `div.group-header "Device"` / `div "DEVICE"` |
| fact value | **21** | 15 | **+6** | `dd.fact-value "last-known"` / `div "Local Wi-Fi"` |
| section / card title | **19.5** | 16 | **+3.5** | `h3.card-title "What this phone can do"` / `h3 "Quick actions"` |
| side panel title | **19.5** | 16 | **+3.5** | `h3.side-title "Mirroring quality"` / `h3 "Mirroring quality"` |
| quality row title | **16.9** | 14 | **+2.9** | `span.quality-title "1080p · 60 FPS"` / `span "1080p · 60 FPS"` |
| sidebar device name | **15** | 13 | **+2** | `div.device-name` / `div "Galaxy S26 Ultra"` |
| sidebar device state | **14.3** | 12 | **+2.3** | `span#device-state "Connected"` / `span "Connected"` |
| quality row sub | **14.3** | 12.5 | **+1.8** | `span.quality-sub "Recommended"` / `span "Recommended"` |
| nav label (active) | **13.5** | 15 | **−1.5** | `span.nav-label "Overview"` / `span "Overview"` |
| toolbar label | **12.5** | 13.5 | **−1** | `span "Search"` / `span "Search"` |
| toolbar key (mono) | **11** | 12.5 | **−1.5** | `span.mono.tb-key "⌘K"` / `span "⌘K"` |

The pattern is visible in the code as well as the pixels: `shell.css` already carries two comments
saying *"`normal` in the design"* — on `.brand-name` (patched to 1.05) and on `.device-name` /
`.device-status` (patched to 1.25 / 1.3). Both were added in an earlier pass, **each time a single
height measurement failed and was patched with a hand-picked ratio for that one element**. Nothing
generalised the observation, so eleven more elements kept theirs.

### Which way to fix it — `normal`, or the design's numbers?

These are not the same thing, because the two faces do not have the same natural leading. Measured,
both faces, same probe:

| font-size | SF Pro `normal` | Archivo `normal` |
|---|---|---|
| 10 | 11.5 | 11 |
| 11 | 13 | 12 |
| 12 | 14 | 13 |
| 12.5 | 14.5 | 13.5 |
| 13 | 15 | 14 |
| 13.5 | 16 | 15 |
| 15 | 17.5 | 16 |
| 21 | 25 | 23 |

SF Pro runs ~1–2px looser at every size. So `line-height: normal` in the build would reproduce the
design's *intent* but not its *geometry* — every stacked text block would grow, and the artboard's
measured heights (the 52px device card, the 38px nav row, the 66px notification row) are the part of
the handoff that is a contract.

**The face is the sanctioned variable; the measured heights are the contract.** So the fix is the
design's rendered leading, expressed per role, and the residual is nothing.

**Verdict: build-side. Fixed below.**

### 1.3 `.fact-value` puts the mono face on text that is not a number

| | Build | Proto |
|---|---|---|
| "Connected via" value | **SF Mono** 14px / 500 / lh 21 / `#f4f4f7` — `dd.fact-value "last-known"` | **Archivo** 13.5px / 500 / lh 15 / `#f4f4f7` — `div "Local Wi-Fi"` |

The handoff is a closed list, not a suggestion: *"All numerics use a tabular mono face … latency,
byte sizes, percentages, timestamps, IPs, window geometry, dialer digits, file names"*, and gives
the reason — proportional figures jitter as values update.

`shell.ts` builds four facts and gives all four `.fact-value`, which is `font-family: var(--font-mono)`:

| Fact | Value drawn | In the handoff's mono list? |
|---|---|---|
| Connected via | `last-known` | **no** |
| Latency | `9 ms` | yes |
| Encryption | `TLS 1.3, pinned` | **no** |
| Address | `10.108.253.63` | yes (IP) |

Two of the four are prose set in a monospace face. The design sets exactly the same split the
handoff describes: `Local Wi-Fi` in Archivo, `10 ms` and `10.173.69.248` in SF Mono.

**Verdict: build-side. Fixed below.**

### 1.4 The Overview CTA renders as a secondary button — a cascade collision, confirmed

| | Build | Proto |
|---|---|---|
| primary action | bg `rgb(22,24,34)`, text `#e7e7ee`, 500 / 13px, 32px tall, radius 10 | bg **`rgb(139,107,255)`**, text **`#0b0b12`**, **600 / 13.5px**, **40px** tall, radius 12 |

`shell.css` **already defines this correctly** — `.primary-action { background: var(--accent);
border-color: var(--accent); color: #fff; font-weight: 600 }`, with a comment explaining that the
fill is flat because the handoff forbids gradient CTAs by name. **None of it reaches the screen.**

`CSS.getMatchedStylesForNode` on `#hero-mirror`, in cascade order:

```
  .primary-action                     background: var(--accent) ; color: #fff ; font-weight: 600
      sheet style-sheet-…-2   ← shell.css
  button, .button                     background: var(--control) ; color: var(--text-on-control) ; font: var(--text-control)
      sheet style-sheet-…-3   ← styles.css
```

The element carries `class="button primary-action"`. The base rule matches it through `.button`, so
both rules land at specificity **(0,1,0)** — a tie, broken by document order, and `styles.css` loads
after `shell.css`. The later sheet wins on `background`, on `color`, and — because `font:` is a
**shorthand** — on `font-weight` too, which is how a rule that never mentions weight resets 600
back to 500.

This is the `CLAUDE.md` stylesheet rule failing in its documented way — silently. Nothing errors,
`tsc` is clean, 110 tests pass, and the screen's one call to action reads as a plain control.

**It is a new variant of it, though, and the existing guard cannot see it.**
`stylesheets.test.ts` fails on a *selector declared in two sheets*; here the selectors are
different (`.button` and `.primary-action`) and merely collide on the same element. Same silence,
same class of bug, outside the net.

**Verdict: build-side, two fixes — the button, and the guard that should have caught it.**

### 1.5 Rows that are the design departing from its own handoff — recorded, not fixed

The build follows the written spec in each of these and the prototype does not. Named here so the
next pass does not "fix" the build into disagreeing with the handoff:

| Anchor | Build | Proto | Handoff |
|---|---|---|---|
| meta weight (dock tooltip, device state, quality sub) | 500 | **400** | "Meta 11–12px / **500**" |
| card title tracking | -0.225 (= -0.015em) | **-0.15** on Overview, **0** on Mirror | "Section + card title … **-0.015 to -0.02em**" |
| quality row sub colour | `#5b5e6e` | `#9c9fb0` | "`#5B5E6E` … **10–11px meta only**" |
| control radius | 10px | **12px** | "Radius: **10** (controls, chips)" |

The prototype is also internally inconsistent on tracking — `-0.15` on one screen and `0` on
another for the same 15px/600 role — which is itself worth the designer knowing.

### 1.6 One row that needs the designer, and is not being guessed at

The design draws the latency figure in **`#32E58A`** (success green); the build draws it in
`#f4f4f7`.

| Anchor | Build | Proto |
|---|---|---|
| latency value | SF Mono 13.5→14px / 500 / **`rgb(244,244,247)`** — `dd.fact-value "9 ms"` | SF Mono 13.5px / 400 / **`rgb(50,229,138)`** — `div "10 ms"` |

Colouring it green unconditionally would make the build state something it has not checked: a
600ms link would be drawn in the success colour, on the card whose whole job is to say whether the
link is healthy. That is decision 6 inverted — a specific, confident, wrong reassurance.

The handoff's colour table assigns `#32E58A` no threshold, and the prototype has only one latency
value in it, so nothing distinguishes "latency is always green" from "10 ms is green". **Silent on
the thing that decides the fix, so this stops here** and goes to the designer as a question: at what
figure does latency stop being green? Recorded in `docs/design-departures.md`.

**Verdict: open, needs a designer decision. Not fixed, and deliberately not guessed.**

### 1.7 A difference that is not one

`.group-header` reports `text-transform: uppercase` on the build with the source text `"Device"`,
against `none` on the prototype with the source text `"DEVICE"`. **The rendered result is identical**
and this is not a departure — it is recorded only because a naive property diff prints it as one,
and the next run should not chase it.

### 1.8 One more, found by looking rather than by measuring

The Overview media remote's seek and volume sliders were drawing **macOS system blue**.

They are native `<input type="range">` with `accent-color: auto`, and on macOS `auto` resolves to
*the user's own System Settings accent* — blue on this Mac, and pink or graphite on someone else's.
So the app's accent colour was **not ours and not constant between machines**, on a screen whose
every other accent is `#8b6bff`.

Nothing in the repo could have caught it. It is not a token, not a declaration, and not a value any
stylesheet mentions — `grep accent-color *.css` returned nothing, which is exactly why it happened.
No test, no `tsc` pass and no token audit inspects a property the codebase never sets.

This is the third instance of the pattern `tokens.css` already records twice (the blue `--accent`,
the too-light `--bg`): **a colour the design never chose, drawn confidently, invisible to every
check, and found in a screenshot.** Now a global beside `:focus-visible`, scoped to the four control
types that have an accent so it cannot leak by inheritance.

**Verdict: build-side. Fixed.**

### 1.9 Section 1 result

| | Before | After |
|---|---|---|
| Paired anchor readings differing on ≥1 of the six properties | **65 of 83** | **24 of 83** |
| …of which `line-height` | 14 anchors, up to 8.5px out | **0** |

The 24 that remain, all classified, none outstanding as build work:

| Count | Class | Rows |
|---|---|---|
| 8 | **design-side** (§1.5) — the build follows the handoff, the prototype does not | meta weight 500 vs 400 (×7), card-title tracking |
| 4 | **anchor artefact**, named not counted | `nav label (active)` on five screens — the prototype's nav never moves its active row, so this compares our active row against its inactive *Overview*; it matches on Overview, where both are active |
| 3 | **anchor artefact** | `filter pill`, `settings tab`, `settings section` — the two sides put different components at these roles; see section 2 |
| 1 | **open, with the designer** (§1.6) | latency colour |
| 8 | **design-side** | primary CTA size/height/radius — the build draws the handoff's 32px control at 13px in radius 10; the prototype draws 40px at 13.5px in radius 12 |

### What changed in the build

| File | Change |
|---|---|
| `tokens.css` | four type tokens carry the design's rendered leading in px, not a ratio; six `--leading-*` tokens for elements that set their own size; `--accent-on-fill`; a global `accent-color` |
| `shell.css` | eight rules moved off hand-picked ratios; `.fact-value` defaults to the UI face with `.mono` as the opt-in; `.primary-action` removed |
| `styles.css` | `.primary-action` re-declared here, immediately after the base `button` rule, where it wins the tie |
| `shell.ts` | the fact list carries a `numeric` flag; only numerics get `.mono` |
| `stylesheets.test.ts` | a new guard: every class sharing an element with `button` must be declared later in the cascade than the base rule. **Shown to fail** — moving `.primary-action` back to shell.css reports it by name and by both files — and carrying both controls |

112 tests, `tsc` clean.

---

## Section 2 — Messages and Calls, compared by role rather than by surface

The previous pass left ten rows on these two screens as "untestable", on the correct observation
that the elevation-3 anchor matches by *weight* and not by *role*: on Messages the design's primary
surface is a message thread and ours was the conversation list; on Calls the design's is a live-call
card and ours the dialer and log.

That was right about the anchors and wrong to stop there. The anchors being unpairable **is itself
the finding** — two screens whose primary surfaces are different components are not two screens with
a styling difference. Compared by structure instead:

**Both screens are a different layout from the design's. Not a different weight, not a different
token — a different arrangement of different regions.**

### 2.0 First, the control: two absences that are not absences

Measured from a default snapshot, the build appears to have no message thread, no composer and no
live-call card. All three exist. Reporting them missing would have been three false absences in one
section, so each was driven into its live state before anything was written down:

| Claimed missing | How it was checked | What was actually there |
|---|---|---|
| the open thread + composer | pressed the first conversation **by its own element** (`button.sms-thread`), never a coordinate | `div.sms-messages` + `div.sms-compose` — both real |
| the live-call card | drove `calls.renderLive()` with a **synthetic** active call through the pane's own field | `div.call-who`, status line, Hang up, audio-routing note |

The calls pane was put back on the phone's real data with `calls.refresh()` and the messages pane
returned to its list; the synthetic call never left the renderer.

### 2.1 Messages — two panes with a master-detail swap, against three side-by-side columns

| | Design | Build |
|---|---|---|
| shape | `grid(280px 539px 300px)` — three columns, 1151 wide | `grid(815px 320px)` — two panes |
| conversation list | column 1, **always visible** beside the thread | pane 1 — **replaced by the thread** when one opens, reached back via a `← All conversations` link |
| open thread | column 2, 539px, beside the list | the *same* pane 1, instead of the list |
| composer | in column 2 | present, in the thread |
| filter tabs | **All / SMS / Chat** above the list | **none** |
| third region | **this conversation's** detail: avatar, three actions, a shared-media grid (`+12`), Mute notifications, Block contact | a **global Contacts directory** with a search field and 50 rows, unrelated to the open thread |

The two differences that matter are not sizes:

1. **List-or-thread, against list-and-thread.** The design never takes the conversation list away.
   The build swaps it out and offers a back link, which is a phone's navigation model on a 1151px
   Mac window with 815px of room for both.
2. **The third column is a different feature.** The design's is scoped to the conversation in view;
   ours is a directory of every contact on the phone, which answers a question nobody on this screen
   asked and does not change when the open thread changes.

### 2.2 Calls — one full-width pane against three columns

| | Design | Build |
|---|---|---|
| shape | `grid(300px 519px 300px)` | one `div.pane.primary`, 1151 wide |
| call list | column 1, 300px, with **All / Missed 1 / Contacts** tabs | full-width, 50 rows, **no tabs** |
| live call | column 2, 519px: "End-to-end encrypted", name, number, **`00:02:18` running timer**, **Mute / Keypad / Speaker** | inside the same pane: name, number, status, Hang up — **no timer, no Mute / Keypad / Speaker** |
| dialer | column 3: a **12-key keypad** (1–9, ✳, 0, #) plus **Frequently called** | a **text input and a Call button** |
| audio routing | "Audio is routed through Galaxy S26 Ultra" | "Audio stays on the phone — pair the Mac to it over Bluetooth" |

The last row is the one place the build is **ahead of the design** and should not be changed to
match it: both state the platform wall, and ours names the remedy. Keep it.

### 2.3 What each gap would actually cost — because they are not one size

Classified against `docs/protocol.md`, so this reads as work rather than as a list of complaints:

| Gap | Needs | Cost |
|---|---|---|
| Messages: three columns, list stays visible | nothing on the wire — `sms.threads`, `sms.messages`, `sms.send`, `sms.received` all exist | **Mac-side layout only** |
| Messages: All / SMS / Chat tabs | nothing — the thread rows already carry what a filter needs | **Mac-side only** |
| Calls: All / Missed / Contacts tabs | nothing — `call.log` rows carry the disposition already | **Mac-side only** |
| Calls: running timer | nothing — the Mac knows when the call started; `call.ended` already carries `durationMs` | **Mac-side only** |
| Calls: three columns + keypad + Frequently called | `call.dial` exists; a keypad is a different way to reach it | **Mac-side only** |
| Calls: **Mute / Speaker** | **no wire messages exist.** `call.*` is `incoming`, `ended`, `log`, `dial`, `answer`, `reject` — nothing for mute or audio route, and the phone half needs an `InCallService` | **new protocol + new phone code** |
| Calls: **Keypad DTMF tones during a call** | same — no message carries a DTMF digit | **new protocol** |
| Messages: shared media, Mute notifications, Block contact | no wire support; shared media overlaps `media.*`, which Phase 5 has not specified | **new protocol, and it belongs with Phase 5** |

### 2.4 The judgement, plainly

**Our Messages and Calls are different screens wearing the same tokens.** The tokens are right —
that is what section 1 measured and what makes the difference easy to miss in a screenshot. The
structure is not: the design puts list, subject and detail side by side on both screens, and the
build puts one region at a time in a wide pane with a directory bolted to the side of one of them.

**This is a build-side finding, not an untestable row.** Six of the eight gaps above are Mac-side
layout work needing nothing new on the wire.

**Not done in this run, deliberately.** Rebuilding both screens is a larger piece of work than the
brief for this pass, which is measurement plus the unrouted panes, and two of the eight gaps need
protocol that does not exist. Recorded here and carried into `docs/design-departures.md` so it is
scheduled rather than rediscovered by the next person who measures an anchor and finds it unpairable.

---

## Section 3 — The five unrouted panes

**They are already routed, and already state A.** This was built in `3f8b90f` ("State A rebuilt to
its own specification") and the brief for this pass was written against the state before it. Nothing
needed building, so nothing was built — verified instead, against the four-state model in
`docs/mac-ui-design-proposals.md` §3 rather than against a screenshot.

`index.html` carries a `<section class="screen">` for each of the five, `shell.route()` reaches them,
and `drawUnbuilt()` fills them from `navModel`.

### 3.1 Verified, per pane, against state A's own specification

Read live over CDP, not from the source:

| Pane | Card | Surface | Tag colour | Icon | Other content |
|---|---|---|---|---|---|
| Files | 340×280 | `rgba(22,24,34,.82)` = **elev-2** | `rgb(91,94,110)` = `--text-meta` | 1 shape | **0 siblings** |
| Photos | 340×296 | elev-2 | `--text-meta` | 3 shapes | 0 siblings |
| Clipboard | 340×336 | elev-2 | `--text-meta` | 3 shapes | 0 siblings |
| Camera | 340×280 | elev-2 | `--text-meta` | 2 shapes | 0 siblings |
| Activity | 340×296 | elev-2 | `--text-meta` | 1 shape | 0 siblings |

Every clause of state A holds:

- **elev-2, never elev-3** — a pane with nothing in it does not claim the screen's heaviest surface.
- **Neutral, never `--warning`** — `rgb(91,94,110)` is `--text-meta`. Warning here would make five
  screens read as "something is wrong" rather than "this was never written".
- **A headline that says what is missing**, not a restatement of the tag: *"Nothing moves files
  yet"*, *"The phone has no way to send a thumbnail"*, *"There is no virtual camera on this Mac"*.
- **A reason naming the phase and the missing piece** — Phase 5 and the silent bulk socket for
  Files; a macOS Camera Extension as a distribution problem before a code problem for Camera.
- **A mono handle**, honest where nothing has been designed: `fs.* — not in this build`,
  `media.* — not in this build`, and for the three with no proposed namespace,
  `no namespace proposed yet` rather than an invented one. A made-up namespace is worse than none —
  it sends a reader looking for something that was never designed.
- **The icon draws.** Counted as shapes, not as an element — the build once shipped with `.tool-glyph`
  spans that had a border and no contents, and "the icon element exists" would have passed then too.
- **Nothing false is drawn**: each section holds the card and **zero** other children.

And the routing clause, "nothing routes to it that implies it works":

| | Built rows | Unbuilt rows |
|---|---|---|
| sidebar colour | `rgb(156,159,176)` = `--text-body` | `rgb(91,94,110)` = **`--text-meta`** |
| badge | Notifications: 22 | **none** |
| `aria-label` | "Files" | **"Files — not built yet"** |
| ⌘K palette | listed | listed, **marked `Not built yet`** |

### 3.2 The one real gap this check found

`shell.ts`'s dock builder carries a comment ending:

> *"Recorded as a deliberate deviation from my own state-A note in docs/design-departures.md."*

**It is not recorded there.** `grep` over that file returns nothing about the dock, the palette, or
this deviation.

The deviation itself is sound and is being kept: state A says *"no dock tile, no ⌘K command"*, and
the build keeps both and **marks** them — a desaturated tile whose tooltip reads "Files — not built
yet", and a palette row that says "Not built yet" where its group would go. Removing two of five
dock tiles would change the design's own composition for a reason that expires as each phase lands,
and hiding unbuilt screens from the palette would make the palette disagree with the sidebar about
which screens exist.

What is wrong is the pointer. A comment claiming a record exists, where none does, is the same shape
as a count with no denominator: it reads as evidence and is not, and the next person to check will
find the claim and stop. **Now actually written into `docs/design-departures.md`.**

### 3.3 What was deliberately left alone

**Overview stays as it is**, as instructed. It is the one screen the state-A note also lists
("Overview-until-telemetry") and it is not being converted — it has real data behind it today.

---

## Section 4 — The two carry-overs

**Both verified live rather than by reading the code that claims them fixed.**

### 4.1 Defect 28 — **closed**, and its class is **open elsewhere** (new defect 46)

**One line: closed in notifications, including the guard hole; found live in the media remote, filed
as defect 46.**

The guard is an enumeration (`userVisibleStringsOf`), and its failure mode is a string composed
outside it — which is exactly what escaped once, when three functions were added to the pane and not
to the enumeration. Checked rather than assumed:

- All **ten** enumerated functions are called by `notifications.ts`; the count moved 7 → 10 with the
  escape fix, and a count that does not move when the enumeration grows has stopped measuring.
- `notifications.ts` touches `.package` **nowhere**.
- Its one composed sentence — `` `Nothing matches “${active.label}”` `` — draws from `FILTERS`,
  whose labels are the four literals `All` / `Messages` / `Can reply` / `Muted`. Never a package.
- All 10 tests pass, including *"the three strings that escaped the guard are inside it now"*.

Then the rule's practical half was actually run — *grep for every package name reaching a string,
not the ones a screenshot showed you* — across the whole Mac source, and it found **two live sites
in a pane the guard does not cover**:

| Site | With no `appName` |
|---|---|
| `renderer/remote.ts:134` | "Paused in **com.spotify.music**." |
| `main/remote.ts:185` | "**com.spotify.music** does not allow skipping to the next track…" |

`RemoteState.appName` is optional on the wire, and both read `appName ?? package ?? '…'` — reaching
the id *before* the generic. The tell that this is a slip rather than a decision is that the same
file disagrees with itself: `renderer/remote.ts:188` and `:247` write `appName ?? 'This app'` and
skip the package. Three sites, one convention, two of them wrong — defect 28's own 2-of-3 shape.

**Filed as defect 46, not fixed here.** The fix wants one resolver in `src/shared/`, because the
renderer is plain `<script>` tags and `main/` is a module, and the tempting three-line version is a
second copy of `notifyLabels.ts` — the copy that does not get the next fix. Fix direction and two
wrong fixes recorded in `docs/defects.md`.

### 4.2 The `.pill-tab` specificity collision — **closed**, and it surfaced a second one

**One line: closed — the Muted pill measures 13.72:1 selected, against the 2.23:1 it was; and the
*unselected* half of the same pill was still 2.75:1, now 6.73:1.**

The collision is fixed with `.pill-tab.unbuilt:not(.selected)`, which says what was meant instead of
depending on file order — `.pill-tab.unbuilt` and `.pill-tab.selected` are both (0,2,0), so the
original fix-by-ordering would break the next time someone sorted the file. Measured live by
pressing the pill itself and compositing its translucent fill over the surface behind it:

| Pill | State | Text on surface | Ratio |
|---|---|---|---|
| Muted | `.unbuilt.selected` | `#f4f4f7` on `rgb(39,34,66)` | **13.72:1** — was 2.23:1 |
| All | `.selected` | `#f4f4f7` on `rgb(39,34,66)` | 13.72:1 |
| Messages / Can reply | unselected | `#e7e7ee` on `rgb(22,24,34)` | 14.36:1 |
| Muted | `.unbuilt`, unselected | `#5b5e6e` on `rgb(22,24,34)` | **2.75:1** ← still failing |

**Measuring the fix found the other half of the same pill.** The `:not()` corrected the tab you are
*on*; the tab you are *not* on was `--text-meta` at the pill's 13px. The handoff scopes that colour
explicitly — *"`#5B5E6E` … 10–11px meta only, never body copy"* — and 13px control text is neither.
WCAG's exemption for disabled controls does not apply: it is an enabled `<button>` with
`disabled === false`, no `aria-disabled`, and pressing it does select the filter.

Now `--text-body`, measured at **6.73:1**, and the dimming survives — 6.73 against the other
unselected pills' 14.36 — while the `::after` dot carries the shape half of the state regardless,
which is the half a screen-reader user gets either way.

**Verdict: both carry-overs closed. One new defect filed (46), one adjacent contrast bug fixed.**

## Section 5 — The census extended, and two anchors that were my own bug

Sections 1–4 left four rows recorded as anchor artefacts and two screens with no content anchors at
all. Carrying on from there, the anchor set grew from 83 readings to **511** — every anchor now
reports the **painted box behind it** (fill and radius) as well as the six type properties, because
the first extension found a radius difference the type columns could not have shown.

### 5.1 Two "differences" that were the harness, not the build

Both were named as artefacts in section 1 and both turn out to be **my selectors**, which is worth
recording as plainly as a real finding — a harness that manufactures differences costs exactly what
a harness that hides them does.

**`nav label (active)` — reported a colour difference on five of six screens.** The proto-side
selector was `T(VIS('aside nav'),'Overview')`, hard-coded, so on Mirror it compared *our active
Mirror row* against *the design's inactive Overview row*, and duly reported
`rgb(244,244,247)` against `rgb(156,159,176)`. The prototype does move its active row — the leaf
goes to `#f4f4f7` and the pill's `top` follows (159 → 197 → 575 across Overview, Mirror, Settings).
Pointed at `[data-nav="<current screen>"]`, the anchor **matches on all six**.

**`nav label inactive` — unresolved on Settings.** It asked for "the inactive Settings row", which on
the Settings screen is correctly nothing. The anchor returning null rather than guessing is the
behaviour wanted; it just measured nothing on that screen. Now it takes Overview, or Mirror when the
current screen *is* Overview. Resolves on all six.

**Zero unresolved anchors across all six screens**, where the previous run had four artefacts and one
null.

### 5.2 Result

| | Readings | Matching | Differing | Unresolved |
|---|---|---|---|---|
| Section 1 (six properties, 83 anchor rows) | 83 rows | 18 rows | 65 rows | 4 artefacts + 1 null |
| **Section 5 (eight properties, 73 anchor rows)** | **511** | **474** | **37** | **0** |

All 37 accounted for, **none of them outstanding build work**:

| Count | Class | Rows |
|---|---|---|
| **21** | **design-side** — the build follows the handoff and the prototype does not | dock tooltip weight 500/400 (×6 screens); quality row sub size/weight/colour; two card-title tracking rows; primary CTA size/leading/radius; both Settings rail-tab rows; filter pill size/weight |
| **10** | **artefact of the box-walk**, named not counted | see 5.3 |
| **6** | **design-side, handoff silent** | the Messages and Calls row names — the design draws 12.5px/600, we draw 13px/500. The handoff's type table has no "list row title" role, so neither is out of spec; recorded because the design is consistent across both screens and a later pass should decide once rather than twice |
| **0** | **build-side** | — |

### 5.3 The box-walk artefacts, and why they are not differences

Reading the painted box behind a leaf means walking up until something actually fills. That is right
for a pill and wrong in two situations, both of which appear above:

- **Fill against no fill.** The build's `h3.card-title` sits inside a filled `.card`, the design's
  `h3` sits directly on the canvas, so the walk compares a card's `rgba(22,24,34,.82)`/18px against
  `transparent`/0px. Same for the inactive Settings tab, where ours is transparent and the walk
  reaches the rail.
- **Selected against unselected.** The first row in our Messages, Calls and Notifications lists is
  unselected; the design's first row is the *selected* one. The walk faithfully reports
  `rgb(23,23,29)` against `rgba(139,107,255,.13)` — a state difference, not a style one.

One more: the filter pill's `lh 14 / 28`. The proto's leaf is a `span.sc-interp` inside a 28px line
box, so 28 is the container's leading and not the label's. The label's own size and weight are real
and are counted; its line-height is not.

**These are named rather than fixed, and named rather than silently dropped.** A harness that
quietly discards rows it cannot pair is how ten Messages/Calls rows became "untestable" instead of
"our layout is different" in the pass before this one.

### 5.4 What the extension found — four fixes, all build-side

**1. The notification filter pills had the wrong radius.** `--radius-control` (10px) on a class
called `.pill-tab`. The handoff is explicit — *"Radius: 10 (controls, chips) … **Pills use
`999px`**"* — and the design draws them fully rounded. Now `--radius-pill`.

**2. One role, three selected tints, from three different sources.** The fill behind *the thing you
are currently on*:

| Surface | Was | Source | Design |
|---|---|---|---|
| nav pill | `rgba(139,107,255,.15)` | **hardcoded literal in shell.css** | `.15` |
| Settings rail tab | `rgba(139,107,255,.13)` | `--accent-tint` | `.15` |
| notification filter pill | `rgba(139,107,255,.18)` | `--accent-tint-strong` | `.15` |

The design uses `.15` for all three. Nothing looked wrong on any single screen; the three only
disagree when measured side by side. Now one `--accent-tint-selected`.

The nav pill's value was *correct and in the wrong place* — a raw `rgba()` in shell.css, where
`tokens.css` owns colour. `stylesheets.test.ts` catches a stray `--token:` declaration outside
tokens.css and cannot see a raw literal, which is how the right number hid in the wrong file.

`--accent-tint-strong` was deleted in the same change: the filter pill was its only reader, so it
became a colour nothing draws.

**3. Three more line-heights, in places the shell anchors never reached.** The same inherited-1.5
defect section 1.2 fixed fourteen of:

| | Was | Design |
|---|---|---|
| `.sms-who` — the conversation row's name | 19.5 | 13.5 |
| `.call-log-who` — the call row's name | 19.5 | 13.5 |
| `.notif-app` — the notification row's app name | 16.9 | 14 |

Worth noting *why* section 1 missed them: its per-screen anchors covered Overview, Mirror,
Notifications and Settings, and Messages and Calls had only shell anchors, on the reasoning that
section 2 was handling those two screens structurally. Structure and type are not the same pass, and
two screens went unmeasured on the strength of that.

### 5.5 Settings is two columns against the handoff's three, and three panes against eight

Unlike most rows here this is not read off the prototype — **the handoff states it in prose**:

> *"Three columns `200px 1fr 320px`. Left: eight panes — General, Connection, Notifications, File
> transfer, Mirror, Security, Advanced, About."*

Measured: the design is `200px 599px 320px`; the build is `200px 927px`. **The 320px column does not
exist**, and the rail carries Connection / Advanced / About.

The five absent panes are not one thing, and the right-hand column is mostly a departure that is
already decided:

| Missing | What it is | Verdict |
|---|---|---|
| **General** | Start on login, Keep in the menu bar, Appearance, Interface sounds, Automatic updates | Real, Mac-side, needs macOS integration — **Phase 7** |
| **Notifications** | label + sub + value rows | Real, Mac-side, buildable today |
| **File transfer** | — | **Phase 5**, with the feature |
| **Mirror** | quality, frame rate | **Already built, elsewhere** — it is the Mirror pane's side panel. A relocation question, not a gap |
| **Security** | Lock, auto-lock, two-factor, trusted devices, Sign out everywhere | Mostly **cut by departure X2** — no account, so no two-factor and no sign-out-everywhere. Trusted devices is real and lives in Connection |
| **the 320px column** | version, Account (email, PRO, Manage subscription, Billing history), Help and support, "up to date", encryption note | Mostly **X2** again — subscription and billing do not exist in this product. The parts that are real (version, the encryption statement) are already in our **About** pane, as *Version* and *Where your data goes* |

**Recorded, not built** — same call as Messages and Calls in section 2: two of the five panes are
blocked on other phases, one is a relocation decision, and one is largely cut. Carried into
`docs/design-departures.md`.

### 5.6 Suite

112 tests, 0 failures, `tsc` clean. Shell geometry re-verified unchanged against the prototype:
sidebar 233×920, brand row 232×44, device card 204×52, nav row 204×38, nav pill 204×40, dock tile
38×38 — all exact on both sides.

---

# Step 70 — the arming sitting: the gate proven on hardware, and one line that cannot be attributed from the log — 2026-08-30

Step 70 has still **not run**. No ring was spent this sitting. What follows is evidence produced
while arming, and it stands on its own.

## The session identified as `bb9391` was the user, in a second terminal

Established directly by the user on 2026-08-30, not inferred. The session
`Step 70 defect 36 phone test [bb9391]` was a second terminal of this project's own user; it has
been told so and has stood down for good. Its two judgement calls were correct and are recorded as
such rather than as friction: it **refused a second-hand reassignment** — it would not accept, from
a peer session, the claim that its user had handed the ring to somebody else — and it **escalated
the question of who drives the ring to its own user** instead. Refusing to take instruction about a
real phone call through an unverified channel is the behaviour this project wants, and it cost
nothing but a round trip.

Its runs are therefore this project's runs. Two of them matter.

## Run c is the gate's hardware evidence

| Run | Time | Outcome |
|---|---|---|
| a | 18:55:36 | rehearsal against an injected card; `CallsView` re-rendered and wiped the injection; timed out 18:56:36. **No click.** |
| b | 18:59:24 | rehearsal with the injector holding a synthetic card present; matched, held 6 s, clicked at 18:59:31 on an **injected** `#call-reject` whose only listener incremented a window global. **No reject reached the phone.** |
| **c** | **19:06:07** | **the real arm**, pid 34699. Matched real episode **`c12`** at 19:09:43.938, held, and at **19:10:02.305 aborted with exit 4 without clicking** — the pre-click re-check read **`In progress`**, not `Ringing`. |

Run c is a real arm against a real inbound call that ended without a click, and it is the first
hardware evidence for the gate rather than for the feature.

**Why it counts as evidence and not as a run that happened to do nothing.** The 2026-08-29 accident
was a watcher that read the live card six times — `who="Chetan"`, `status="Dialling · +91…"` — and
clicked Reject anyway, because the click was the next statement and nothing stood between the
reading and the action. It hung up the user's own outgoing call. Here **the same situation arose on
its own**: the card changed underneath the watcher when `c12` was answered at +11.4 s, so the
target at the moment of acting was no longer the target that had been identified. The re-check
immediately before the irreversible call caught exactly that, refused, said what it refused and
why, and exited 4.

That is `CLAUDE.md`'s *"a check that does not gate the action is decoration"* working on live
hardware, against the precise failure it was written for, on a call nobody had to arrange. The
distinguishing detail is the **re-check**, not the first read: the first read at 19:09:43.938 said
`Ringing` and was correct when taken. A gate that had trusted it would have clicked. The predicate
that decided whether to act was re-evaluated at the moment of acting, and that is the whole
difference between run c and 2026-08-29.

## The `call.reject delivered` line at 19:10:20.602 was a manual Hang up

The link log carries `call.reject delivered` at **19:10:20.602**, eighteen seconds after run c
exited. **It was the user's own Hang up press in the Mac UI. No watcher clicked it.**

**From the log alone the two are indistinguishable, and that is recorded here because it is the
finding, not a caveat on it.** `call.reject` arrives at the phone as the same message with the same
fields whichever way it was sent: the Mac's reject path is one path, and the log line names the
message, not its origin. A reader with only `link.log` in front of them — which is the reader this
project keeps producing, one sitting later — sees a watcher exit and a reject eighteen seconds
apart and has nothing in the file that separates *"the watcher clicked late"* from *"a person
pressed the button"*.

What actually separated them was **outside the log**: the user said so. The nearest thing to an
in-file discriminator is negative — run c logged its exit-4 refusal at 19:10:02.305 and logged no
click, and a watcher that refuses does not later click. That is real but it is an argument from
the watcher's own record, and it fails the moment the watcher is not the thing under suspicion.

**Consequence, unfixed:** `call.reject` has no provenance on the wire or in the log. The message
carries no field saying whether it originated from a user gesture, a script, or a replay, so no
post-hoc reading of a reject can attribute it. This is not filed as a defect because nothing
behaves wrongly; it is recorded as a **known limit of the evidence**, and the honest handling is
the one used here — when a reject's origin matters, it is attributed by testimony and the testimony
is named, or it is left unattributed. Do not attribute a reject from timing.

## `c13`'s cause is open and unattributed — retraction, written in on purpose

**`c13` has no explanation and no attribution. Do not derive one from timestamps.**

`c13` is the inbound episode that began 19:14:41.873, produced `RINGING` and `OFFHOOK` with the
number absent on **all four** broadcasts, left **no row in the platform call log**, and was followed
by no further log line of any kind. It is the trigger that exposed defect 47. Why the process
stopped between OFFHOOK and IDLE is **not known**.

Two attributions were made in this project's own records earlier the same day and **both are
retracted**:

1. That `c13` was caused by, or coincided with the activity of, the `bb9391` session.
2. That it was *not*, because that session's window "spans" `c13` rather than post-dating it.

Both were derived the same way — off a relative uptime string (`ListAgents` reporting *"started
29m ago"*) subtracted from a wall-clock reading, then compared against `c13`'s timestamps. **The
second retraction matters more than the first.** Reversing a wrong inference with the same
technique produces a second wrong inference that reads as a correction and is therefore harder to
dislodge; the record ended up more confident and no better supported. A relative uptime is not
evidence of what a session did, an overlapping window is not causation, and a non-overlapping one
is not exoneration.

The record is: **cause unexplained, unattributed, open.** Anyone tempted to close it by lining up
session start times against `19:14:41.873` is repeating the exact step being retracted here — that
is what this paragraph exists to stop. What would actually settle it is a phone-side artefact
(a `tombstone`, a `logcat` death line, a system `am_kill`/`am_proc_died` record from that minute),
and none was captured before the window passed.

`c13` weakens nothing in the defect-45 decision, which is the one place it might have. Option 4 was
chosen because it degrades honestly, and `c13` is that degradation working: `shouldCorrectCard`
returns false when the number never arrives, no correction is published, and the card stays
`Unknown number`, which is the true answer. The test named *a still-blank number corrects nothing*
is `c13`'s case and is green. What `c13` does change is the brief's prose — the extra lands
*"every time … on all six episodes measured"* is now **six of seven**, and the seventh is a
non-arrival.

## Defects filed this sitting

**47** (open), **48** and **49** (both closed) — see `docs/defects.md`. 48 and 49 both came out of
the arming exclusion: two locks at two paths that excluded nothing, and a refusal that stated a
wrong client count. Neither cost a ring; 48 survived only because two edits collided in the same
file, which is luck and not a control.

## How to check whether `LinkService` is up — and why grepping for `Listening on` is defect 29's shape

**Written 2026-08-30 after the check was got wrong, in the direction that reads as a finding.** The
reasoning was: the last `Listening on 42501/42502/42503` in `link.log` is 16:12:41, a launch was
issued at 19:14, no line followed it, therefore the service did not start. Every step is true and
the conclusion is false. The service had been up since **16:12:04** and all three ports were bound
the whole time.

**The line is written once per `onCreate`, and nowhere else.** `LinkServer.start()` logs it, and
`LinkService.onCreate()` is its only caller. A second `startForegroundService` on a service that is
already running never reaches `onCreate` — it runs `onStartCommand`, which handles `ACTION_STOP` and
`ACTION_REFRESH_CAPABILITIES` and returns `START_STICKY`. So **on a healthy, already-running
service the line is absent by design**, and its absence after a launch is the *expected* reading,
not a symptom.

This is defect 29's shape — a query that cannot tell its target from something resembling it,
answering confidently. There the call log read the wrong key and reported an empty log; here a grep
read a once-per-lifetime line and reported a dead service. In both cases the absence was the
lookalike, and nothing downstream could tell it from the real thing.

**The presence check for `LinkService` is three readings together, none of them a log grep:**

| # | Reading | Command | What "up" looks like |
|---|---|---|---|
| 1 | the service exists and when it was created | `adb shell dumpsys activity services <pkg>` | a `ServiceRecord` for `core.link.LinkService` with `isForeground=true foregroundId=2001` and a `createTime` you can date |
| 2 | the ports are actually bound | `adb shell ss -ltnp` (or `/proc/net/tcp6`, ports `A605`/`A606`/`A607`) | three `LISTEN` rows on 42501/42502/42503 **under the app's uid** |
| 3 | a peer is actually attached | the same dump, `ESTAB` rows | a session on 42501 from the Mac's address, same uid |

Read on 2026-08-30 at 20:11:56, all three agreed:

```
ServiceRecord{1203f0a …/core.link.LinkService}  isForeground=true foregroundId=2001
                                                 createTime=-3h59m52s022ms      → 16:12:04
LISTEN  *:42501  *:42502  *:42503                                       uid 11011
ESTAB   [10.108.253.63]:42501 ← [10.108.253.92]:51206                   uid 11011
```

and the `Listening on …` line at **16:12:41.382** is the record of that same start, not of a
missing one. `createTime` and the log line corroborate each other to within the bind time; either
alone would have been enough, and the grep alone was worse than nothing.

**The uid column in rows 2 and 3 is the control, not decoration.** A `LISTEN` on 42501 with no uid
check cannot separate our server from anything else that has taken the port — which is precisely the
case `LinkServer` already logs `Could not bind listeners` for, *"almost always address already in
use from a previous process that has not died yet"*. Match the uid or the reading proves only that
somebody is listening.

**And an absence still needs its own positive control.** `link.log` was silent for 56 minutes, which
could equally mean a quiet phone or a dead writer. One shell notification, posted and then snoozed
away, settled it: three fresh lines at 20:15:41 — two `[applabel] … "Shell" — 41 / 42 resolved / 0
fell back` and one `[sms] sms.messages delivered (thread 2550, 50 messages, hasMore=true) — 21
delivered / 0 refused`. The `[applabel]` pair proves the writer and the listener binding; the
`[sms]` line proves the control session is live and serving Mac requests, which no phone-side
reading could have shown.

## Defect 47 read live, 65 minutes on — and it is **not** across a reconnect

Read over CDP on 9222 against the running Electron (**pid 28715**, the instance holding the control
socket), read-only. No relaunch: a relaunch clears the card through `setAdvertised(false)` and would
have destroyed the evidence before it was read.

**Control first**, so an absence or a presence here means something: the page is
`dist/renderer/index.html` with **1698 elements, 226 buttons, 106 ids** — the same shape as the
census taken before any of this, plus the notification row the liveness probe added.

### The card, at 2026-08-30 20:19:34.766 IST

```json
{ "cardPresent": true, "cardClass": "call-live", "cardHidden": false,
  "who": "Unknown number",
  "mutedLines": ["In progress",
                 "Audio stays on the phone — pair the Mac to it over Bluetooth to listen…"],
  "buttons": [ { "id": "call-reject", "label": "Hang up", "hidden": false } ],
  "callObject": { "callId": "c13", "number": "", "startedAtMs": 1788097481871, "state": "active" } }
```

`#call-answer` resolves to **0**, which is correct for `state: "active"` and is the control that the
card is being read in its real state rather than a synthetic ringing one.

### The timestamps

| What | When | Source |
|---|---|---|
| app process started | **14:38:23** | `ps`, pid 14728, still alive |
| `LinkService` created, ports bound | **16:12:04** / `Listening on …` 16:12:41.382 | `ServiceRecord.createTime`, `link.log:3857` |
| control session established | **18:53:17.705** | `link.log` — `Handshake complete with Chetans-MacBook-Pro at 10.108.253.92` |
| c13 began, on the phone | **19:14:41.873** | `link.log` — `Call c13 ringing number withheld by the platform` |
| c13, as the Mac recorded it | **19:14:41.871** | `startedAtMs: 1788097481871` |
| c13's last phone-side event | **19:14:56.173** | `PHONE_STATE OFFHOOK` ×2, both `number absent` |
| card still drawn | **20:19:34.766** | this reading |

**Card age at the reading: 1 h 05 m 03 s**, against a call whose last observed event was 64 minutes
earlier and which never produced a call-log row at all.

**The 2 ms between the phone's `19:14:41.873` and the Mac's `19:14:41.871` is the identity control.**
It is what separates *"the Mac is showing the phone's c13"* from *"the Mac is showing leftover
synthetic data from a rehearsal"* — which is exactly the mistake made when this card was first
noticed. Two independent clocks, one episode, agreeing to within the round trip.

### It is not a reconnect. It is one unbroken session.

This was expected to be defect 47 reproducing **across** a reconnect, on the assumption that the app
had just been launched. It was not launched — it was already up — so the reconnect never happened,
and saying "47 across a reconnect" would have been a false positive of the exact kind the rest of
this file is about.

Every control-session line in the log, in order, is a handshake or an ending. The last one is:

```
4179: 2026-08-30T18:53:17.705+05:30 I [control] Handshake complete with Chetans-MacBook-Pro at 10.108.253.92
```

**and there is nothing after it** — no `Session with … ended`, no `idle timeout`, no second
handshake. The session that carried c13 was established **21 m 24 s before c13 began** and is the
same session that served `sms.messages` at 20:15:42 and is still `ESTAB` on 42501 now. The Mac's
device card reads `Samsung SM-S938B … Connected` in the same breath.

**So what is actually demonstrated is stronger in one way and weaker in another, and both halves
matter.** Stronger: the card is wrong for 65 minutes on a link that never faltered — this needs no
disconnection, no process death and no reconnect to go wrong, which rules out every explanation of
the form *"the Mac missed the `call.ended` because the link was down."* The link was up the entire
time and the `call.ended` was never sent, because the phone never generated one. Weaker: the
reconnect path — `replayTo` returning silently when no call is live, which is the gap that makes a
reconnecting Mac *keep* a stale card — is still **unexercised on hardware**. It is read in source
(`CallFeature.kt:117-123`) and is not yet observed.

**That test is one step away and comes for free.** `adb install -r` restarts the app process and
drops the link; the Mac then reconnects on its own. Whichever of the two things happens next is the
answer, and both are worth having:

- the card **survives** the reconnect → `replayTo`'s silent return is confirmed on hardware, and 47
  is proven irrecoverable rather than argued to be;
- the card **clears** → it was cleared by `setAdvertised(false)` (`renderer/calls.ts:94-101`), the
  one path known to blank the pane, and the mechanism is recorded as such rather than guessed at.

Read the card immediately after the reinstall, before anything else, or the answer is lost.

# Step 70 — the reinstall, and what it settled — 2026-08-30

Still no ring. This is `adb install -r`, the grants question, and what the install did and did not
prove.

## The reconnect test did not happen, because the card cleared first

It was set up as a free test: reinstall, drop the link, and see whether the stale c13 card survives
the reconnect. It could not run. **c13 ended at 20:22:42.883 — 3 m 35 s before the install started
— and the card cleared correctly.** Forty samples taken from 20:26:17 through 20:27:47, spanning the
install and the reconnect, all read `class="call-live hidden"`, `call: null`. There was no stale
card to carry across, so nothing was demonstrated either way.

**`replayTo`'s silent return on no-call (`CallFeature.kt:117-123`) therefore remains read in source
and unexercised on hardware**, exactly as it was before the install. Recording this as "not tested"
rather than folding it into the reinstall's successes, because a test that could not run is not a
test that passed.

## What c13's ending settled, and what it corrected

```
2026-08-30T20:22:42.883  I [calls] Call c13 ended answered after 4080849ms
2026-08-30T20:22:42.960  I [calls] PHONE_STATE IDLE: number absent, episode none — not taken …
```

**67 m 47 s.** The terminal event arrived, `call.ended` went to the Mac, `onEnded` blanked the pane.
Defect 47's first wording — *an episode that never ends*, *forever*, *nothing can clear it* — is
corrected in the register: the card was cleared, by the one fact that clears it, an hour late.

The defect survives the correction and is narrower for it: for 67 minutes the Mac stated something
it could not check, and **no action available to anyone could correct it**. Its duration was set by
the phone's eventual generosity, not by anything the Mac owns.

**The call log still has no row for c13, read after it ended.** The newest row remains `_id=11710,
+918800000004, type=1, date=1788097183428, duration=25` — c12 at 19:09:43. A real 67-minute call
writes a row with a matching duration on ending. This is the control that separates *"c13 was a
genuine long call and the card was right all along"* from *"c13 was anomalous"*, and it comes down
on anomalous. It also re-confirms the wrong fix: a liveness check that consulted the call log would
have called c13 dead throughout, for the wrong reason, and been right by luck.

**Why the IDLE arrived at 20:22:42 is unknown and is left unattributed.** Nothing touched the phone
between 20:16:50 and 20:24:02, and the install began at 20:26:17 — after. Reconstructing a cause
from those timestamps is the step already retracted once for c13, and it is not repeated.

## `adb install -r` preserves everything. `docs/RESUME.md` is wrong about it.

Tested rather than trusted, per the standing instruction. Verified **individually, printed one per
line**, against `docs/evidence/step70-grants-snapshot-2026-08-30T1917.txt`:

```
versionCode=1   lastUpdateTime=2026-08-30 20:26:26        ← the new build

PASS  ANSWER_PHONE_CALLS   granted=true      PASS  READ_CONTACTS      granted=true
PASS  CALL_PHONE           granted=true      PASS  READ_PHONE_STATE   granted=true
PASS  CAMERA               granted=true      PASS  READ_SMS           granted=true
PASS  NEARBY_WIFI_DEVICES  granted=true      PASS  RECEIVE_SMS        granted=true
PASS  POST_NOTIFICATIONS   granted=true      PASS  SEND_SMS           granted=true
PASS  READ_CALL_LOG        granted=true

PASS  notification listener present in enabled_notification_listeners
PASS  accessibility service present: …/com.chetan.connectsuite.input.ConnectSuiteInputService
PASS  accessibility_enabled=1
```

**11 of 11, plus both secure-settings strings and the master switch. Nothing was lost and nothing
needed restoring.** `docs/RESUME.md:38`'s *"a reinstall resets grants"* describes a full uninstall
and is wrong for `-r`; both sessions suspected this and neither had tested it. It is tested now, on
this device, on this build.

### The 19:17 snapshot is thinner than its own record claims

`docs/ground-truth-2026-08-30.md` §11 describes it as holding *"11 runtime grants, all `granted=true`
before any install, plus the notification-listener and accessibility-service secure settings
values"*. It does not. It is 360 bytes and holds **the eleven permission names, one per line, and
nothing else** — no values, no listener string, no accessibility string.

That is enough to know *what to check* and useless as a baseline to *restore from*: had the install
dropped a grant, the file could not have said what to put back, and the two secure-settings strings
— the ones that genuinely cannot be re-granted programmatically — were never captured at all. A
snapshot that records the questions and not the answers reads as insurance and is not, which is this
project's recurring shape in a new place.

A real one was taken at 20:25, before the install, and is at
**`docs/evidence/step70-grants-preinstall-2026-08-30T2025.txt`**: every permission with its
`granted=` value and flags, both secure-settings strings in full, `accessibility_enabled`, and the
outgoing build's `versionCode`/`lastUpdateTime`. The 19:17 file is kept as the list of what to
check, which is what it actually is.

## What the reinstall *did* break: the phone came back fully granted and serverless

`link-up.sh` was run immediately after the install and failed all three readings:

```
uid      com.chetan.connectsuite.debug = 11011   ← the control for readings 2 and 3
FAIL     1. no foreground ServiceRecord for core.link.LinkService
FAIL     2. 0 of 3 ports LISTEN under uid 11011
FAIL     3. no control session on 42501
exit 1
```

The new process (pid 22222) had started — via the platform rebinding `NotificationMirrorService` —
and had installed **every feature**, ending at `Capabilities now:
calls,contacts,input,mirror,notifications,remote,sms` at 20:26:27.065. Notification listener
attached, accessibility service connected, all grants present. And no ports bound, because
`LinkService` never ran.

**This is `LinkServer.kt:163`'s scenario reproduced exactly**, the one recorded on 2026-08-28 where
*"the platform rebound `NotificationMirrorService`, which started the process, which installed every
feature — and `LinkService` never ran, so the phone sat for five hours fully granted and
serverless."* It is worth its own line here because of how it presents: the capability log at
20:26:26 is the most reassuring output in the file, and it is printed by a phone no Mac can reach.
Reading capabilities to decide whether the phone is up is the same error as grepping for
`Listening on` to decide whether the service is up, from the opposite direction — a true statement
about one layer, read as a statement about another.

Fixed by starting the launcher activity **by name**, never by coordinates:

```
$ adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity
2026-08-30T20:28:36.956  I [server] Listening on 42501/42502/42503, 1 paired device(s)
2026-08-30T20:28:42.250  I [control] Handshake complete with Chetans-MacBook-Pro at 10.108.253.92
$ scripts/link-up.sh    →  OK / OK / OK, exit 0
```

**So `adb install -r` needs a launch after it.** The install preserves every grant and every binding
and does not restore the server, and nothing in the app's own output says so.

### `link-up.sh` earned its place on first use

The project's rule is that a check must be shown to fail against the thing it is named for. This one
was not shown to fail by a contrived fixture — it failed on its first real run, on a real serverless
phone, on all three readings, and passed six seconds after the fix. The negative and the positive
were both taken on hardware, minutes apart, with the uid control reading 11011 in both.

## Option 4 is in the running build. No log line can prove it is *live* before a ring, and here is why

**The installed APK is byte-identical to the one verified by dex strings:**

```
/data/app/~~Wtue0m9tPmH6hdr2dxE1uQ==/…/base.apk   md5 6aae37591fd9d610a8fbbcf0f3eb830c
app/build/outputs/apk/debug/app-debug.apk         md5 6aae37591fd9d610a8fbbcf0f3eb830c

in that APK:   1 × "card corrected in place"
               1 × "number withheld by the platform"      (control — a string that must be there)
               0 × "BUG REINTRODUCED"                     (control — the deliberately-broken build)
```

**And the receiver that hosts it is registered in the running process** (pid 22222, started
20:26:26):

```
2026-08-30T20:26:26.975  I [calls] Watching PHONE_STATE for the inbound number
2026-08-30T20:26:26.976  I [calls] Call watcher started
```

**What that is not.** Neither line is option 4's. `git diff` on `CallWatcher.kt` adds **one**
`LinkLog` call in 55 inserted lines, and it is inside the correction branch:

> `Call $id card corrected in place: number $number … arrived Nms into the $phase — N of M episodes corrected since start`

That branch runs only when `shouldCorrectCard(before, after, episodeLive)` is true — which needs a
live episode whose `EXTRA_INCOMING_NUMBER` changes from blank to a number. An outgoing call cannot
produce it: outgoing `PHONE_STATE` carries no `EXTRA_INCOMING_NUMBER`, so `after` stays blank and the
guard is false. A synthetic broadcast cannot produce it either: the receiver is registered
`RECEIVER_NOT_EXPORTED`, so `am broadcast` from the shell never reaches it, and `PHONE_STATE` is
system-only in any case.

**So the line asked for cannot exist before the ring, and saying otherwise by pointing at the two
lines above would be presenting a registration as an execution.** What is established is: the code
is in the APK on the phone, the APK is the one that was checked, and the receiver holding it is
registered in the live process. What is not established is that the branch has ever run — which has
been the honest limit on option 4 since it was written, and the reason its four green tests are
described as covering the predicate and not the wiring.

**The constructive form: `card corrected in place` is step 70's pass criterion, not its
precondition.** If the ring produces it, option 4 is proven on hardware and 35c passes. If the
number never arrives, the card stays `Unknown number`, no correction is published, and that is
c13's documented case — the green test named *a still-blank number corrects nothing* — a failure
that is now explained rather than mysterious. One episode in seven has looked like that.

---

# Step 70 — **PASSED.** Defect 36 and defect 35c both proven on hardware — 2026-08-31 13:43

One ring, one reject, both defects closed. The full transcript is
`scripts/step70-watch.mjs 9800000001 9 --hold=8 --allow-blank-number --require-correction`.

## Setup, verified before arming rather than assumed

| | |
|---|---|
| Device under test | `RZCY12330DT`, SM-S938B — the handset every reading in this file is against |
| Its line | `gsm.sim.state=[LOADED, ABSENT]` — one SIM, slot 0; subscription id=1, airtel, `number=98508[****]`, `IN_SERVICE`, `IsVoiceCallAvailable=true`. The second subscription (Jio) has `simSlotIndex=-1` and reads `OUT_OF_SERVICE` |
| Caller | **9800000001**, a second handset |
| Build | `lastUpdateTime=2026-08-30 20:26:26`, md5 `6aae37591fd9d610a8fbbcf0f3eb830c`, identical to the APK checked by dex strings |
| Link | `scripts/link-up.sh` → OK / OK / OK, exit 0 |
| Exclusion | lock free, `countCdpClients()` = **0** on 9222; 9333 is `proto-host/1.0.0` and is invisible to the count by construction |

**The device-number check has a stated limit.** Android redacts the subscription number after five
digits, so what was confirmed is `98508…`, which is consistent with 9850850263 and decisively
excludes the caller's 9800000001 — the two differ from the third digit. It does not prove the last
five. That limit is recorded rather than glossed, because a check whose reach is overstated is the
thing this file is mostly about.

## The ring

```
13:43:01.838  MATCHED — inbound ring accepted by the gate
  +  0.0s  CARD  hidden=false who="Chetan" status="Ringing · +919800000001" answer=true reject="Reject"
  +  0.0s  PHONE Call c7 ringing number withheld by the platform — 0 of 7 episodes with a number since start
  +  0.0s  PHONE PHONE_STATE RINGING: number absent, episode live — not taken — 14 with / 15 without
  +  0.0s  PHONE PHONE_STATE RINGING: number present, episode live — taken  — 15 with / 15 without
  +  0.0s  PHONE Call c7 card corrected in place: number +919800000001 (Chetan) arrived 16ms into the ringing — 7 of 7 episodes corrected since start
13:43:09.873  gate re-checked immediately before the click: "Chetan" / "Ringing · +919800000001"
13:43:09.874  clicked #call-reject once (label was "Reject")
13:43:10.377  live card cleared
```

## Defect 35c — **CLOSED.** The inbound card carries the number and the name

`who="Chetan"`, `status="Ringing · +919800000001"`. Not a fallback, not `Unknown number`: the
platform number resolved to a contact, in the headline, on an inbound ring — which is what 35c has
been asking for since 2026-08-28 and what failed on 2026-08-29.

**Option 4 is the mechanism and it is proven, not inferred.** The number was absent on the first
`PHONE_STATE` copy and present on the second, and the correction published **16 ms into the
ringing**. The `--require-correction` clause held the reject until that line appeared for *this*
caller.

**And it is not a single sighting.** The process that started at 13:02 has logged **7 of 7 episodes
corrected**, the oldest at 2026-08-30 22:47, with arrival offsets from **16 ms to 535 ms**:

```
c5  2026-08-30T22:47:24.651  +919700000007 (Contact G)  535ms   5 of 5
c6  2026-08-31T13:40:24.926  +919800000001 (Chetan)                       37ms   6 of 6
c7  2026-08-31T13:43:01.891  +919800000001 (Chetan)                       16ms   7 of 7
```

Seven corrections, seven episodes, no episode uncorrected. `docs/decision-45-inbound-caller-id.md`
chose option 4 on a measurement of six arrivals; it now has seven corrections on hardware to go
with them.

**`--allow-blank-number` was carried but never exercised.** No waiver line was printed: the
correction landed before the watcher's first poll, so the gate matched the *corrected* card on the
strict clause. The waiver was insurance against a c13-shaped ring and cost nothing when it was not
needed.

## Defect 36 — **CLOSED.** A call rejected from the Mac is reported as `rejected`

```
13:43:09.982  call.reject delivered (rejected — the episode is flagged; call.ended decides the
              disposition when the call ends, and answered outranks the flag) — 3 delivered / 0 refused
13:43:10.073  Call c7 ended rejected after 8197ms
```

**`rejected`, not `missed`.** That is the whole of defect 36, and it is the first time it has been
observed on hardware — step 69 could only verify the precedence rule.

**The control, and it is the platform's own answer, not ours:**

```
Row: 0  _id=11717, number=+919800000001, type=5, date=1788163981760, duration=0, name=Chetan
```

`type=5` is `REJECTED` in the platform call log. The phone's own disposition and Android's agree on
the same call. A `[calls]` line alone would have been our code agreeing with itself.

**Defect 40's wording is live on this build** and did its job: the `call.reject delivered` line says
in the sentence that it is *not* the disposition, and the disposition line follows 91 ms later.

## Provenance, since this is the line that could not be attributed last time

The `call.reject delivered` at 13:43:09.982 sits **108 ms** after the watcher's own
`clicked #call-reject once` at 13:43:09.874, in the same transcript, with the click logged by the
process that made it. That is what attribution looks like when it exists — contrast 2026-08-30's
19:10:20.602, which was a manual Hang up and was indistinguishable from a watcher click from the log
alone. The limit recorded there is unchanged: `call.reject` still carries no provenance on the wire.
It is attributable **here** because the clicker kept its own record, not because the log improved.

## The gate, on its second hardware outing

Run c on 2026-08-30 aborted at exit 4 because the pre-click re-check read `In progress`. This run
re-checked the same predicate immediately before the irreversible call, got
`"Chetan" / "Ringing · +919800000001"`, and proceeded. **The gate has now been observed refusing a
call it should not touch and authorising one it should**, on real hardware, four days apart. A gate
that has only ever refused is not yet known to be a gate.

## `isCorrectionFor` — added before this run, and it mattered

`--require-correction` previously matched any `card corrected in place` line, with no check that the
correction belonged to the call under test; with `--allow-blank-number` that would have let another
caller's correction authorise the reject. `step70-gate.mjs` now reads the number out of the line and
**fails closed** if the format moves. Six fixtures, and shown to fail: with the old clause
reinstated, *a correction for a DIFFERENT caller* and *format moved — fails CLOSED* both went red,
then green on restore.

It did not fire in anger on this run — the correction was for the right caller — which is the
correct outcome for a guard and not an argument against having built it.

---

# `c13` explained, and defect 47 withdrawn — 2026-08-31

**This supersedes three earlier sections of this file**: "Step 70 — the arming sitting" (the `c13`
retraction), "Defect 47 read live, 65 minutes on", and the `c13` paragraphs of "Step 70 — the
reinstall, and what it settled". Their readings were accurate; the conclusion drawn from them was
not.

## The artefact that settles it

The arming-sitting section said `c13`'s cause was unexplained, that no phone-side artefact from that
minute had been captured, and that nobody should derive one from timestamps. The artefact existed
the whole time, in `dumpsys telecom`, and was found while checking which SIM the handset held:

```
SelfMgd Call e385bde0-9d12-44b5-8057-c84b7341e582 [Aug 30, 2026 7:14:41 PM](MT - incoming)
    >>>Target PhoneAccount: ComponentInfo{com.whatsapp/com.whatsapp} (WhatsApp)

Call e385bde0-…: { startTime: 1788097496071   → 19:14:56.071  (went ACTIVE)
                   endTime:   1788101562695   → 20:22:42.695
                   direction: INCOMING   isVideoCall: true
                   callTerminationReason: DisconnectCause [ Code: (LOCAL) … ] }
```

`RINGING` 19:14:41.86 → `ACTIVE` 19:14:56.07 → `DISCONNECTED` 20:22:42.71, ended locally.
**`c13` was an incoming WhatsApp video call that was answered and ran 67 m 47 s.** The phone's
`ended answered after 4080849ms` and telecom's 4066.6 s of active time differ by the 14.2 s of
ringing — two clocks agreeing, not one of them wrong.

**The Mac's card was true for all 67 minutes.** Defect 47 is withdrawn; see `docs/defects.md`.

## The control that was not a control

This file promoted *"the platform call log has no row for c13, and a real 67-minute call writes a
row"* to the top of 47's record as the reading that made it a defect rather than a long phone call.
It was not discriminating. The same dump says why:

```
SamsungCallLog.Loggable { state : UNKNOWN / okayToLog : false }
```

Self-managed calls are logged by the app that owns them, not by the platform provider. The absence
of a row separates *cellular* from *not cellular*; it says nothing about whether a call was real or
how long it ran. It was used to decide exactly the thing it cannot decide.

**That is this project's own recurring failure, committed inside a defect record that cites the rule
against it** — a query that cannot tell its target from a lookalike, answering with confidence. The
lookalike was *a call the platform does not log*. The discriminating query was available all along
and was never run.

## What this does not change

- **Nothing about step 70.** Different call, different day, cellular, and both defects it proved
  stand on their own evidence.
- **Nothing about option 4.** A self-managed VoIP call carries no `EXTRA_INCOMING_NUMBER`, so
  `shouldCorrectCard` returns false and the card reads `Unknown number`, which is the true answer.
  `c13` is the green test *a still-blank number corrects nothing*, on hardware.
- **The two structural gaps still exist and are still unobserved.** `replayTo` returning silently on
  no-call (`CallFeature.kt:120`) and `call-current` answering from the Mac's cache
  (`main.ts:733` → `calls.ts:81-82`) were read in source and never depended on `c13`. They are
  recorded in `docs/defects.md` under 47's withdrawal as a **known protocol asymmetry**, not a
  defect, because no instance of either has been seen.

## And the standing instruction about `c13` is discharged

Three attributions were made for `c13` from timestamps and all three were withdrawn. The fourth
answer came from an artefact that names the owning app, the state transitions and the duration.
`c13` is closed as *explained*: an ordinary WhatsApp video call, behaving exactly as a self-managed
call is documented to behave. Nothing about it needs deriving from a clock again.

---

# The Phase 4 SMS sitting — 30, 32, 39, 44, and a fifth found underneath them — 2026-08-31

Four defects were meant to travel together. They do, and a fifth came out of insisting that the
fix for 32 be *shown* to work rather than shown to render.

## What each needed, against what the proposals predicted

`docs/phase-5-proposals.md` §1 got this right and saved the sitting a redesign: **only one of the
four needed the wire.** 30 and 32 were already possible on the protocol and were Mac-side gaps.

| # | Change | Verified |
|---|---|---|
| **44** | `sms.sent` event + a `ContentObserver` on the sent mailbox | code + fixtures; **needs one SMS typed on the handset** |
| **39** | the same event; the pane appends instead of re-reading the provider | code + fixtures; **needs one send from the Mac** |
| **30** | `SmsClient.sendNew` + a compose surface that names a recipient | code + 5 fixtures; **needs one real send to a new number** |
| **32** | a thread pager | **on hardware: 50 → 89 → 126 → 158 → 183** |
| **50** | the thread cursor was never honoured at all | **on hardware**, same run |

## `sms.sent` — one mechanism, two defects

Emitted whenever the provider gains an outgoing row, whoever wrote it. Payload identical to
`sms.received` with `inbound: false`, **built by the same builder** — `SmsPayloads.envelope` — so
the two shapes cannot drift. That is defect 34's lesson applied before the fact rather than after:
34 was this event's twin having a shape the contract did not describe, and the cheapest guarantee it
does not recur is that there is only one place the shape exists. `Phase4ContractTest` asserts the
two payloads differ in exactly `inbound` and `read` and in nothing else, and it was shown to fail
against a second builder that had quietly lost `hasAttachments`.

The retry is defect 34's, unchanged: three looks at 150 ms, the same counters, the same refusal to
emit a partial shape. A look that follows our own send is the only one whose failure is an `e:`
line — an observer fires for reads and deletes too, and counting those as drops would bury the
denominator that makes the line worth reading.

**A delay before the composer's re-fetch stays rejected**, for the fifth time in this project. The
phone knows when its own write landed; the Mac is told.

## Defect 50 — and how it was nearly recorded as a pass

The pager rendered. The button appeared. The button was pressed. The list stayed at 50.

```
noCursor        : 5 threads, hasMore=true
aboveNewest     : 0 threads          ← a value that should return EVERYTHING
page1Oldest     : 0 threads
small           : 0 threads
```

**That second row is the whole diagnosis.** A wrong cursor value cannot return zero for a bound
above the newest row, so the fault was not the value — the selection was never running.
`content://mms-sms/conversations` returns an empty cursor for a selection carrying a `?`
placeholder: no exception, so `query`'s `runCatching` had nothing to log, and the phone honestly
reported `0 threads, hasMore=false` all the way up.

**And the provider looked innocent when asked directly**, which is the lookalike:
`adb shell content query --where 'date<…'` returns 2990 rows and honours `--sort` as well. The
shell inlines its literal; the app binds an argument. Testing through the shell and concluding "the
provider handles selections" is exactly the shape of every other entry in this file's control table.

Fixed by inlining the `Long`, with the type — not the trust — as the safety argument.

## And the pager still repeated itself

With the cursor working, page 2 returned 50 threads of which **11 were already on page 1**. The
conversations view yields a row per *message*, so a conversation with messages either side of a
boundary arrives on both pages. De-duplicated on append, first occurrence kept because the pages
walk newest-first and the first row carries the snippet and unread count a person expects.

`dedupeByThread` is hung on `globalThis` and tested directly, so the test runs the function the pane
runs. Its fixtures use the device's own numbers — 50 + 50 with 11 repeats is 89 — and go red without
the rule.

**Recorded as a known limit, not fixed here:** `before` is a millisecond timestamp with no
tiebreaker, so rows sharing one to the millisecond can still be skipped at a boundary.
`docs/phase-5-proposals.md` decided the answer — an optional `beforeId` and a documented total
ordering — and it is a protocol change across three pagers. It is not being smuggled into a Phase 4
sitting. This pager is no worse than the two already shipped.

## Suite

Phone **181** tests, 0 failures. Mac **129** tests, 0 failures, `tsc` clean. Every new fixture was
shown to fail against the defect it is named for and put back.

---

# Step 71 — 44, 39 and 30 on hardware, and defect 51 underneath them — 2026-08-31

The three SMS defects left as **fixed, not verified** were carried to hardware in one sitting: one
message typed on the handset, one sent from the Mac into a thread that already existed, one sent
from the Mac to a bare address. All three arrive. The run also produced a defect of its own, which
is recorded below rather than folded into the three it was found under.

## Two of the run's own premises were wrong, and both were caught before a message was spent

Recorded first because the run's value depends on it.

1. **The handset send had not happened.** The newest row in `content://sms/sent` was `_id=22194`,
   dated **2026-08-28 23:50** — three days old — and `outbox`, `queued`, `failed` and `draft` were
   all empty. Had the run started from the log instead of the mailbox, the absent `sms.sent` would
   have read as defect 44 still broken.
2. **9850850263 was not the no-thread case.** It carries **thread 593**, `message_count=2` — `Hi`
   from 2021-03-01 and `Hii this us test of mac to android` from 2026-08-28 — live in
   `mms-sms/conversations`, not merely present as orphaned `sms` rows. A send there merges into 593.

The second is the one worth keeping: the send would have succeeded, the pane would have drawn the
message, and **it would have looked exactly like a pass for the half of defect 30 it cannot test.**
Sent anyway by decision, recorded as the *existing-thread* case, and 30's no-thread half stays open.

## Setup, read rather than assumed

| | |
|---|---|
| Phone build | `lastUpdateTime=2026-08-31 14:24:53`, the SMS-sitting APK |
| Phone server | `link-up.sh` 3/3 — foreground service, `42501/42502/42503` LISTEN under uid 11011, **1 control session ESTABLISHED**. Started by name, not by grepping `Listening on` |
| Capabilities | `calls,contacts,input,mirror,notifications,remote,sms` — all seven |
| Mac | rebuilt, **one** Electron instance (two were running at the start of the sitting; both killed, one relaunched), `--force-renderer-accessibility --remote-debugging-port=9222` |
| Zoom | `innerWidth` 1440 = `outerWidth` 1440 — not zoomed, so drawn evidence is at 1:1 |
| Observer | `Watching the sent mailbox for outgoing messages; newest already-sent row is 22194 and will not be pushed` — the baseline is *named in the line*, which is what makes every row below identifiable as new |

**A note on the transport, since it cost the first ten minutes.** The Mac read `10.108.253.63 timed
out` and `ifconfig` showed it on `192.168.43.55` via a gateway that was not the phone. It had not
failed — it was mid-reassociation, and `ipconfig getsummary en0` already carried the answer
(`yiaddr = 10.108.253.92`, `router 10.108.253.63`) while `ifconfig` still showed the old lease.
Two reads of "the same" fact disagreeing, with the *less* obvious one correct.

### Defect 44 — a message typed on the handset reaches the Mac — **closed and verified on hardware 2026-08-31 (step 71)**

One SMS typed in the phone's own Messages app.

```
phone  14:43:07.352  I [sms] sms.sent pushed after 1 lookup(s) (provider change, row 22212)
                             — 1 pushed / 0 dropped since start
Mac    14:43:07.341  I [sms] sms.sent in thread 594 to Chetan (+919800000001)
                             — 0 sent / 0 refused / 1 received / 0 dropped since launch
provider           _id=22212, thread_id=594, address=+919800000001, type=2, body=Hiifgchcg
```

`0 sent` on the Mac is the load-bearing half: the Mac had issued no `sms.send` at that point, so
nothing it did caused this. The push is the only thing that could have.

**The discriminator is the direction word, and it was checked against a live positive rather than
assumed.** Thirty and forty-five seconds later two inbound messages arrived on the same thread and
the Mac wrote `sms.received in thread 594 **from** Chetan`. Same handler, same thread, same contact,
opposite preposition — so the `to` above is a real classification and not a default. Had `sms.sent`
been silently ingested through the inbound path, these lines would be indistinguishable.

*(The two clocks differ by ~11 ms in the wrong direction — the Mac's line precedes the phone's.
Device clock skew, not causality; no latency claim is made from this pair.)*

### Defect 39 — the thread draws the message it just sent, without being reopened — **closed and verified on hardware 2026-08-31 (step 71)**

Thread 594 open, composer present, **17 messages drawn**. Body
`D39-1449 mac into existing thread` typed into the pane's own composer and Send pressed — the gate
re-read the open thread's header at the moment of clicking and would have refused a pane that did
not read as Chetan.

```
Mac 14:46:04.951 I [sms] sms.send delivered to 1 recipient in thread 594
                         — 1 sent / 0 refused / 3 received / 0 dropped since launch
Mac 14:46:06.111 I [sms] sms.sent in thread 594 to Chetan (+919800000001)
                         — 1 sent / 0 refused / 4 received / 0 dropped since launch
provider         _id=22215, thread_id=594, body=D39-1449 mac into existing thread
drawn            17 → 18, last row `sms-message outbound`, "D39-1449 mac into existing thread | 2:46 PM"
```

**Never left the thread.** The pane was not re-navigated, no thread was reopened, and
`.sms-compose` was still present in the same read that counted 18 — which is the whole of defect 39,
whose original symptom was a thread drawing one fewer message than its own header claimed until you
left and came back. Exactly one copy was drawn: the append and the eventual `sms.threads` refresh
did not both add it.

### Defect 30 — the Mac can address a number rather than a thread — **explicit-address path closed on hardware 2026-08-31 (step 71); the no-thread half remains open**

`New conversation` → `9850850263` → `D30-1452 mac to a bare address` → Send.

```
Mac 14:47:17.728 I [sms] sms.messages thread 593 → 2 messages, hasMore=false
Mac 14:47:17.858 I [sms] sms.sent in thread 593 to Chetan Pujari (9850850263)
provider         _id=22216, thread_id=593, address=9850850263, type=2
                 thread 593 message_count 2 → 4
drawn            "Hi | Mar 1", "Hii this us test of mac to android | Aug 28",
                 "D30-1452 … | 2:47 PM" outbound, "D30-1452 … | 2:47 PM" inbound
```

What this **does** prove, and it is the part the pane had no path to before: the Mac addressed a
number rather than a thread, the phone verified the recipient (`to 1 verified recipient(s)`) rather
than trusting a bare address off the wire, and the pane opened **the thread the phone named** — 593,
with its 2021 message visible — rather than one it invented. A pane that had assumed a new thread
would have drawn an empty conversation here.

What it **does not** prove: that a first message to a genuinely unknown number creates a thread.
That path was not exercised. Recorded as open in the register with the reason, not as a pass.

## `sms.sent` fires identically on all three origins — and that is more than it sounds

The explicit question this run was asked. It does, and the payload reaches the Mac through the same
handler each time:

| Origin | Row | Phone line | Mac line |
|---|---|---|---|
| handset keyboard | 22212 | `pushed after 1 lookup(s) (provider change, row 22212)` | `sms.sent in thread 594 to Chetan` |
| Mac → existing thread | 22215 | `pushed after 1 lookup(s) (provider change, row 22215)` | `sms.sent in thread 594 to Chetan` |
| Mac → bare address | 22216 | `pushed after 1 lookup(s) (provider change, row 22216)` | `sms.sent in thread 593 to Chetan Pujari` |

**Read the trigger column, not just the event.** All three say `provider change` — the
`ContentObserver` built for 44. Not one of them says `after send`. The Mac-origin sends were carried
by 44's mechanism, not by 39's, which is how the next defect was found.

### Defect 51 — the after-send retry reports a loss it does not suffer — **open, found during step 71 on 2026-08-31**

Both Mac-origin sends produced this pair, ~700 ms apart:

```
14:46:04.957 I sms.send delivered (to 1 verified recipient(s))
14:46:05.298 E sms.sent NOT pushed after 3 lookups following a send — the Mac's thread will be
               missing the message it just sent — 1 pushed / 1 dropped since start
14:46:06.097 I sms.sent pushed after 1 lookup(s) (provider change, row 22215) — 2 pushed / 1 dropped

14:47:17.165 I sms.send delivered (to 1 verified recipient(s))
14:47:17.488 E sms.sent NOT pushed after 3 lookups following a send — … — 2 pushed / 2 dropped
14:47:17.864 I sms.sent pushed after 1 lookup(s) (provider change, row 22216) — 3 pushed / 2 dropped
```

`PROVIDER_LOOKS = 3` at `PROVIDER_LOOK_DELAY_MS = 150` gives the after-send trigger ~300 ms. The
provider wrote at **1140 ms** and **699 ms**. **Two of two** — the after-send path has not won once
on this device, and the observer rescued both.

Nothing was lost, and that is the defect. The `e:` line **asserts an outcome it does not decide** —
"the Mac's thread will be missing the message it just sent" was false within a second, both times,
and the drawn evidence under defect 39 above is the same message being drawn. This is defect **40**
exactly: a log string naming a disposition that other code overrides. 40 was fixed even though it
never corrupted a measurement, because it would answer a `grep` identically on a good build and a
broken one; this line is worse, because it is at `E` and it is emphatic.

The counter compounds it. `3 pushed / 2 dropped` invites the reading that two-fifths of outgoing
messages are lost. **Zero were.** The rule in `CLAUDE.md` is that a count needs a denominator that
gives it meaning — here the denominator exists and is *wrong*, which manufactures a failure rather
than hiding one. The comment above the branch already anticipates half of this ("not necessarily a
failure … only a look that followed our own send is a miss worth an `e:` line"); the case it did not
anticipate is that an after-send look can miss while the message is delivered anyway, because there
are two triggers into one push and only one of them is being scored.

**Fix direction.** Two triggers, two questions, and they need two counters. "Did the after-send look
find the row in time?" is a tuning fact about one optimistic path; "was this row ever pushed to the
Mac?" is the only one that describes a message being lost, and `lastSentId` already knows it. The
after-send miss should be an `i:` line saying the observer will carry it, with its own
found/not-found tally, and the `e:` reserved for a row that no trigger has pushed.

**Wrong fix to avoid — and it is the tempting one:** raising `PROVIDER_LOOKS` or
`PROVIDER_LOOK_DELAY_MS` until the after-send path wins. That is the fifth appearance of the
delay-before-re-read shape this file has now rejected — a plausible value in place of a known fact,
tuned against one device's provider latency, wrong under load. The message already arrives. The
reporting is what is broken.

**Not user-visible**, which is why it does not reopen 39 or 44: both are closed on drawn evidence.
It is a defect in the evidence the next person will read.

## Suite

Phone **189** tests (67 `sync-module` + 122 `core`), 0 failures, 0 errors — re-run with
`--rerun-tasks` after an up-to-date Gradle run was noticed and rejected as not being a run.
Mac **129** tests, 0 failures, `tsc --noEmit` clean.

---

# Phase 5 — files, media, clipboard, contacts

Opened 2026-08-31, immediately after Phase 4 closed. The opening brief is `docs/RESUME.md`; the
decisions it must not re-litigate are `docs/phase-5-proposals.md`.

## Slice 1 — Bug 6's frame caps on the bulk channel · 2026-08-31

**No hardware, and none is possible.** Nothing serves the bulk channel — `bulkChannelSink` is still
unassigned and `acceptSideChannel` refuses the socket with `FEATURE_UNAVAILABLE` before any framing
runs — so there is no device path that could exercise a cap. This slice is unit-tested on both
sides and recorded as such. Saying so plainly matters more than usual here: a cap proven only by
its own unit tests is exactly the "verified a different mechanism" trap defect 50 records, and the
honest statement is that these tests prove the framing layer refuses, not that a transfer over a
real socket refuses. The first `fs.*` transfer is what proves the second thing, and it owes that
evidence.

**Why now rather than with `fs.*`:** it is a fifteen-line decision while nothing serves the channel.
After `fs.*` ships, changing a cap changes what an already-shipped sender emits, and a cap that
turns out to be too small then presents as a transfer bug for large files.

### What landed

| | Where |
|---|---|
| `MAX_BULK_FRAME` = 1 MB, `MAX_BULK_HEADER_FRAME` = 64 KB | `Messages.kt` (`Link`), `shared/protocol.ts` |
| Read **and write** enforcement, cap passed at the call site | `core/.../link/Framing.kt`, `desktop/src/main/framing.ts` |
| The two caps chosen per frame, over one shared tally | `BulkFraming` in both files |
| The denominator on every refusal | `core/.../link/FrameTally.kt`, `desktop/src/shared/frameTally.ts` |
| The contract | `docs/protocol.md`, "Bulk channel → Frame caps" |

Enforcement is inside `Framing` on both sides, never inside a feature — `BulkFraming` performs no
comparison of its own, it only decides *which* cap applies to the frame in hand, which is transfer
state the framing layer cannot know. `FrameTally` is deliberately free of `LinkLog` and of Android:
it sits on the framing path, and one `android.util.Log` reference there takes the JVM tests with it.
This is the same "move the pure part out" that `SmsPayloads` and `CallWatcher.dispositionOf` came
out of, applied before the fact rather than after a red suite.

### The refusal line

```
Bulk chunk frame length 3145728 exceeds the 1048576-byte cap on the bulk channel — closing the
socket; 812 frames / 207286272 bytes accepted, 2 rejected
```

Both sides emit the same sentence, word for word, so the phone's `link.log` and the Mac's read alike
when they are put side by side — the same reasoning that put an explicit UTC offset on both.

### The write side found something on its own

Adding a cap to the write path immediately caught a real asymmetry in code that has shipped since
Phase 1: **the control channel reads at `MAX_CONTROL_FRAME` (16 MB) and would have written at the
`MAX_FRAME` default (8 MB)**, so a large control frame would have been refused by its own sender
while the far end was willing to accept it. Both write sites now name `MAX_CONTROL_FRAME`
(`ControlSession.kt:98`, `link.ts:572`) and a test holds it on the Mac side. Nothing had ever sent a
control frame near 8 MB, so this was latent — which is the argument for the write side in one line:
it catches us, not a hostile peer.

### Evidence — shown failing first, both sides

Per `CLAUDE.md`, a new test must be shown to fail against the thing it is named for. The caps were
removed from `Framing` on each side in turn — the write-side check deleted outright, and the bulk
frames read and written under `MAX_FRAME` instead, which is precisely the repo's state before this
slice — and the suites re-run.

**Phone — `core/src/test/.../BulkFramingTest.kt`, 9 tests.**

```
BulkFramingTest > a chunk length prefix past the bulk cap is refused, named and closed FAILED
    java.lang.AssertionError ... Caused by: java.io.EOFException
BulkFramingTest > a header frame is judged by the header cap, not the chunk cap FAILED
BulkFramingTest > our own oversized chunk fails on our side and nothing is emitted FAILED
BulkFramingTest > our own oversized header fails on our side too FAILED
BulkFramingTest > the refusal carries what the channel had already accepted FAILED
9 tests completed, 5 failed
```

The `EOFException` under the first one is the defect itself rather than noise: with no cap the
reader believed a 3 MB length prefix, allocated for it, and ran off the end of a four-byte stream —
"a peer that claims a 3 GB frame gets its socket closed rather than an OutOfMemoryError" is what the
framing comment promises, and without the cap on this channel it was not being kept.

**Mac — `desktop/src/main/framing.test.ts`, 10 tests.**

```
✖ a chunk length prefix past the bulk cap is refused, named and closed
✖ a header frame is judged by the header cap, not the chunk cap
✖ our own oversized chunk fails on our side and nothing is emitted
✖ our own oversized header fails on our side too
✖ the refusal carries what the channel had already accepted
✖ the control channel writes under its own cap, not the video cap
ℹ pass 133   ℹ fail 6
```

Caps restored: 9 of 9 and 10 of 10 green, `tsc --noEmit` clean.

**The four that stayed green under the neutered build are the controls, and that is the point.** The
constants test asserts the *decision* (1 MB < 8 MB, 64 KB < 1 MB) and is unaffected by enforcement;
the at-the-cap test writes and reads a frame of exactly `MAX_BULK_HEADER_FRAME` and one of exactly
`MAX_BULK_FRAME` and requires both to arrive; the partial-frame test requires a length prefix whose
payload has not arrived yet to be waited for rather than refused; the clean-EOF test requires end of
stream to read as `null` and not as a violation. Every other assertion in the file is an absence —
"this was refused" — and an absence counts only beside a known positive. If an off-by-one made the
caps refuse *everything*, all five refusal tests would still pass and these are the ones that would
not.

### The discrimination case, stated explicitly

A 100 KB frame is a **legal chunk** and an **illegal header**. The test reads the identical bytes
twice, once under each cap, and requires opposite outcomes — because the failure this cap exists to
prevent is a malformed first frame allocating the chunk budget, and a single channel-wide cap cannot
tell those two frames apart at all.

### Not done here, and deliberately

`docs/protocol.md` still says the bulk channel carries "raw chunks of 256 KB" while the design calls
for adaptive sizing between 64 KB and 256 KB. It should read *up to* 256 KB. That contradiction is
listed as open question 4 in `docs/RESUME.md`, it is bound to how `fs.*` chunks, and it is answered
in the `fs.*` payload proposal rather than patched here.

## Suite

Phone **190** tests across four modules (`core` 73, `input-module` 44, `sync-module` 42,
`mirror-module` 31), 0 failures, run with `--rerun-tasks`. Mac **139** tests (was 129), 0 failures,
`tsc --noEmit` clean.

**The phone figure disagrees with the one this file recorded at the close of Phase 4**, which read
*189 (67 `sync-module` + 122 `core`)*. Counted now, by `<testcase>` elements in the result XML and
independently by `@Test` annotations in the source — the two agree — the tree holds 190 including
the 9 added here, so **181 before this slice**, and neither the total nor the per-module split
reconciles with 189/67/122. The earlier figure is not reproducible from the tree and is recorded
here as wrong rather than quietly restated. Nothing is missing: every module's suite runs green.

## Slice 2 preliminaries — the push destination, settled on hardware · 2026-08-31

Three things had to be settled before `media.*` code was written, all of them decisions the payload
spec could not take on documentation alone. Two are in this section; the third — defect 54 — is
below it.

### The `ReceivedFileStore` question, and what it actually turned out to be

`ReceivedFileStore`'s class comment claims that publishing to `Download/ConnectSuite` through
`MediaStore.Downloads` is *"the one way to write there on scoped storage without asking for a
storage permission at all"*. That claim is v1's, written for an older target, and §4 of the payload
proposal was about to build a `.part`/`.failed` convention next to it without either of them knowing
about the other. §1 had just spent a hardware run learning what an unobserved claim is worth, so
this one was observed too.

### A correction, not a new fact — and it was wrong in two separate ways

This section reverses a claim made in this project's own notes one sitting earlier. Recording it as
a correction rather than quietly stating the truth, because what was asserted was specific, was
acted on, and would have shaped §4 if it had gone unchecked.

**What was said:** *"`MediaStore.Downloads` with `IS_PENDING` needs no tree grant and hides the file
until commit — so it does `.part`'s job invisibly and there is no visible `holiday.mov.part` for
anyone looking at the folder."*

**Both halves of the mechanism were wrong, in opposite directions.**

| | Claimed | Read on the handset |
|---|---|---|
| What stages the partial | `MediaStore` with `IS_PENDING` | **`cacheDir/transfers/<id>.part`** — app-private. `ReceivedFileStore` publishes to `MediaStore` only *after* the checksum verifies; `IS_PENDING` brackets the final copy and is not the resume mechanism at all |
| What a person sees mid-transfer | nothing — "invisibly" | **`.pending-1788791013-<name>`**, plainly present to anything listing the directory. It is hidden from other apps' `MediaStore` *queries*, which is not the same as hidden |

What survives is the part that matters, and it survives for a different reason than the one given:
the partial is **never at its final name**. On the path v1 uses it is not in the folder at all; on
the path v2 will use it is in the folder under a name the platform mangles. Either way §4's rule
holds — but "the rule holds" was being inferred from a mechanism that does not exist, which is the
same fault as a control that cannot see its target.

The correction is only available because the claim was *specific enough to be wrong*. A vaguer note
— "MediaStore handles partials sensibly" — would have been unfalsifiable and would have survived
this run untouched.

**What the code actually does.** `ReceivedFileStore` streams into `cacheDir/transfers/<id>.part`,
app-private, in nobody's Download folder, and publishes to `MediaStore.Downloads` only after the
checksum verifies.

**The probe.** `app/src/debug/…/probe/DownloadsProbeActivity.kt`, beside `SafProbeActivity` and
debug-only for the same reason. It calls the **real** `ReceivedFileStore.publish`, because a
re-implementation would be a second client issuing what looks like the same request — the mistake
§1's probe exists to avoid.

**Reading 1 — the write works at `targetSdk 36` with no storage permission, and the permission dump
is the control.** Logged in the same run, immediately before the write:

```
DownloadsProbe: --- probe run start; targetSdk=36 sdk=36 ---
DownloadsProbe: PERMISSIONS: READ_EXTERNAL_STORAGE=false, WRITE_EXTERNAL_STORAGE=false,
                READ_MEDIA_IMAGES=false, READ_MEDIA_VIDEO=false
DownloadsProbe: RESULT: published uri=content://media/external_primary/downloads/1000297609 in 263ms for 256 MB
DownloadsProbe: ROW: name=probe-… size=268435456 pending=0 path=Download/ConnectSuite/
                owner=com.chetan.connectsuite.debug
```

Four permissions false and a 256 MB file in the user's `Download/ConnectSuite` anyway. "It worked"
with no denominator would have been the usual failure; the denominator here is the four `false`s on
the line above it. The directory did not exist before the run — the poller's first five samples read
`No such file or directory`, which is also what proves the poller could see the difference.

**Reading 2 — what an interrupted publish leaves in the directory, and the reading that did not
exist.** The first attempt **produced no reading at all**, and this is the part worth keeping: the
real 256 MB publish took **263 ms**, the shell poll sampled every ~320 ms, and the window opened and
closed between two samples. The directory was empty at 19:51:38.993 and held the finished file at
19:51:39.321.

**A window that falls between two samples is a missing reading, not a negative one.** "Nothing was
seen" was one sentence away from being written down as *the pending file is not visible* — a claim
about the platform this run could not support, and one that happens to be **false**, as the held-open
version below shows. The fix is not a faster poll: a faster poll is a smaller window, not a
guaranteed one. It is to stop the thing being observed from being a race — hold the state open and
then look.

This is the sixth entry in `CLAUDE.md`'s control table and the first caught *before* it was written
down rather than after. The question that catches it is not *did I see it* but **could I have seen
it**, and when the answer is "only by sampling inside a window I do not control", there is no
reading yet.

So the window was held open instead: the probe's `--ez abandon true` path issues the same insert —
same collection, same `RELATIVE_PATH`, same `IS_PENDING=1` — writes the bytes, and never commits.
Two outside observers, neither of which has seen that code:

```
$ adb shell ls -la /sdcard/Download/ConnectSuite/
-rwxrwx--- 1 u0_a326 media_rw  8388608 …  .pending-1788791013-abandoned-1788186213659.bin
-rwxrwx--- 1 u0_a326 media_rw 268435456 …  probe-probe-1788186098754.bin

$ adb shell content query --uri content://media/external_primary/downloads …
Row: 159 _display_name=ConnectSuite, is_pending=0, relative_path=Download/
Row: 160 _display_name=probe-probe-1788186098754.bin, is_pending=0, relative_path=Download/ConnectSuite/
```

**The answer: the platform already does §4's job, in its own vocabulary.** A pending file is on disk
under a mangled, dot-prefixed name — `.pending-<n>-<name>` — and **never under its final name**; and
it is absent from another client's `MediaStore` listing entirely. The absence in that listing carries
its own control in the same output: the committed 256 MB file and the `ConnectSuite` directory row
both came back, out of 160 rows, so the query can see this folder and did not see the pending item.

**And the earlier claim is corrected: it is not invisible.** The file is plainly there to anything
that lists the directory, including any file manager showing hidden files. What is true is the part
that matters — it is never at the final name, which is exactly what §4 forbids.

The shell is used here only as an *outside observer*, which is the one role it is right for: the
question is what someone else sees, not whether our own mechanism works. Defect 50's rule is about
verifying a mechanism through a foreign client, and it is not being broken by asking a foreign
client what it can see.

**Cleanup.** Both probe files were removed from the handset and the directory with them; `ls` returns
`No such file or directory` for both the files and the folder. One stale `MediaStore` row for the
`ConnectSuite` *directory* (row 159, `owner_package_name=NULL`) is left in place — it names a folder
that no longer exists and the scanner reconciles it. Deleting provider rows this app does not own is
not something a cleanup step should do.

### Defect 54 — photos would have advertised itself with no bulk channel · **closed**

Taken red first, before any `media.*` code existed, which is the whole reason it was worth taking
today. `needsBulkChannel = true` was removed from the `photos` contract and
`CapabilityPermissionTest` run:

```
15 tests completed, 1 failed
<failure message="java.lang.AssertionError: photos may not be advertised while nothing serves the bulk channel">
```

One test, the right one, with the right message — the other fourteen stayed green, so the test is
discriminating between this defect and everything else the file asserts. The line was then restored
and `:core` runs **76** tests, 0 failures (`--rerun-tasks`, ten result XMLs, `failures="0"` in all
ten).

### The contract now models what the OS actually asks for

`permissionsAnyOf: Set<String>` became `permissionAlternatives: Set<Set<String>>` — one alternative
must be granted **in full**. Photos is `{READ_MEDIA_IMAGES, READ_MEDIA_VIDEO}` or
`{READ_EXTERNAL_STORAGE}`. The old flat shape was satisfied by images alone on a phone whose
`media.list` returns `kind:"video"` items with a `durationMs`, which is the calls-contract mistake
moved one axis over: the chip green, the videos unreadable, and the OS rather than a missing handler
doing the breaking. `images alone does not permit photos` is the test, and it can fail on its own.

The type changed rather than the value on purpose. A `Set<String>` that quietly gained a third member
would have let every call site keep its old meaning; changing the type made each one be revisited.

**On the manifest, one thing was decided against the instruction and it is recorded here rather than
done quietly.** `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` are now declared, and photos is out of
`CapabilityPermissionTest`'s `notYetDeclared` list in the same commit. `READ_EXTERNAL_STORAGE`
**keeps** its `maxSdkVersion="32"`. Removing the cap was asked for, and the cap is not what was
holding photos back — the undeclared `READ_MEDIA_*` permissions were. What removing it would do is
make `grantableToday()` report `READ_EXTERNAL_STORAGE` as grantable on Android 16, where the system
ignores the declaration entirely: a false reading placed inside the check that exists to catch false
readings. The declaration is verified on the device — `granted=false` for both new permissions in
`dumpsys package`, which is a real reading of an ungranted-but-declarable permission.

## Slice 2 — `media.buckets`, `media.list`, `media.thumb` · 2026-08-31

**The photo browser's three read verbs. `media.original` is not here** — it resolves a `MediaStore`
id to a transfer on the bulk channel, nothing serves that channel, and it goes with the Mac's first
bulk client in slice 3.

### The expected outcome is that `photos` stays grey, and that is written down as a test

`CapabilityContract.isImplemented` requires **all** of a capability's requests to have handlers, and
photos names four. Three handlers and a served bulk channel still leave it unavailable, so the Mac's
Photos pane stays grey through this slice and says why.

That is a decision, not an unfinished job, and the tempting way to "fix" it is to loosen
`containsAll` to a subset check. That check is the only thing preventing a capability being
advertised over dead verbs, and it exists because `calls` was once advertised on two of the four
permissions its own messages needed. `slice 2 leaves photos unavailable, and that is the expected
state` asserts both halves: not implemented on three verbs, and `missingFor` naming
**`media.original`** as the one outstanding.

### What landed

| File | What it holds |
|---|---|
| `sync-module/…/v2/MediaPayloads.kt` | the pure half — cursor semantics, ordering, payload shapes, the package-id split |
| `sync-module/…/v2/MediaStoreReader.kt` | the only file in the feature that names a `MediaStore` symbol |
| `sync-module/…/v2/MediaFeature.kt` | the three handlers, their refusals, and the counters |

The split is the `SmsPayloads` lesson applied before it could bite: a JVM test that merely
*references* an object holding an Android static in a field initializer dies in `<clinit>`, which is
what `SmsStore` does through `CONTENT_CONVERSATIONS_URI`. `MediaPayloadsTest` runs on a plain JVM
because there is no `MediaStore` symbol anywhere in what it touches.

Two implementation choices worth recording because both look like details and are not:

- **One table, not two.** Images and videos are read from `MediaStore.Files` filtered to
  `media_type IN (1,3)`, rather than from `Images.Media` and `Video.Media` separately. Two cursors
  would have to be merged in memory to restore one ordering, and a merged ordering is exactly where
  a cursor loses rows at a page boundary.
- **No `LIMIT` in the sort order.** Appending one works on API 29 and is not portable above it, so
  the page is bounded by stopping the read — what `SmsStore` does — and `hasMore` is the row after
  the last one taken, seen but not built.

### Red first — the id tiebreak, against a burst

`MediaPayloads.cursorOf` was changed to return `TimestampOnly` even when a `beforeId` was given —
the bug as it would really appear, a cursor that ignores its tiebreak — over six rows where five
share one second, paged two at a time:

```
9 tests completed, 2 failed
FAIL a page boundary inside a burst loses no rows and repeats none
     expected:<[1003, 1002]> but was:<[1000]>
FAIL the cursor advances inside a shared second, which a bare timestamp cannot
     expected:<…(date_added < ? OR (date_added = ? AND _id < ?))> but was:<…date_added < ?>
```

**Page two returned one row instead of two, and the three burst frames between them are simply
gone** — while page two is internally consistent, correctly ordered, and looks like a perfectly good
page. That is the failure this pager was always going to have: not an error, not an exception, a
clean answer missing rows only a count can see. The other seven tests stayed green, so the two that
failed are discriminating between this defect and everything else in the file.

**The first version of that test could not have failed, and the fix is worth recording.** Its
in-memory pager spelled the cursor predicate out a second time, so deleting the tiebreak from the
query left it green — an empty accessibility query in a different costume. `cursorOf` and `isBeyond`
now hold the decision once; `listSelection` renders it to SQL and the test evaluates it in memory,
so the boundary test and the query cannot disagree about where a page ends.

### What is not proven here, stated rather than glossed

**No hardware yet.** Everything above is a JVM run, and the two preconditions this pager owes are
both device readings:

1. **Consecutive pages, counted, on hardware** — the `50 → 89 → 126 → 158 → 183` shape defect 32's
   record carries, against `media.buckets`' own per-bucket `count` as the denominator.
2. **The cursor exercised through the client the app uses.** `MediaStore.Files` is an ordinary table
   and *ought* to bind arguments, but "ought" is what defect 50 was made of: the shell inlines its
   literal where the app binds a `?`, and the two are different clients issuing different queries.
   `adb shell content query` is therefore not evidence about this pager in either direction.

`app/src/debug/…/probe/MediaProbeActivity.kt` is what takes both, through `MediaStoreReader` — the
same `ContentResolver` call, the same bound arguments, the same selection string the handler uses.
It takes the everything-cursor reading **first**: a cursor a year past the newest row must return
every row, and zero there would mean the selection never ran rather than that the value was wrong.

What that probe does **not** cover is the control channel, the envelope and the handler above it.
Slice 3 gives the Mac a client and owes that half.

**Awaiting the permission grant on the handset — asked for, attempted, and _not_ present.** The
grant was made by hand and reported as *Allow all*; read back from the platform it is not there, on
either copy of the app:

```
User 0:  android.permission.READ_SMS:                        granted=true   ← control
         android.permission.READ_MEDIA_IMAGES:               granted=false
         android.permission.READ_MEDIA_VIDEO:                granted=false
         android.permission.READ_MEDIA_VISUAL_USER_SELECTED: granted=false  ← discriminator
User 95: (Samsung DUAL_APP clone) all three false
User 150:(Secure Folder) installed=false
```

**Three things make this a reading rather than a failed query.** `READ_SMS` comes back `granted=true`
from the same dump, the same package and the same user, so the query can see a granted permission.
`READ_MEDIA_VISUAL_USER_SELECTED` is the discriminator that was asked for and it separates the two
ways a grant can be wrong: *Select photos* would show it **true** with images false. It is false, so
this is not a partial grant — it is no grant. And the flags carry no `USER_SET` on any of the three,
while `POST_NOTIFICATIONS` — a permission this user did act on — does; the package manager has no
record of anyone touching photos for this package.

**A second, independent client agrees.** The app's own `checkSelfPermission` through
`MediaFeature.granted`, logged by the probe: `PERMISSION: photos read granted=false`, followed by
`BUCKETS: none`. That last line is deliberately *not* worded as an absence of media — with the
permission off, an empty bucket list carries no information about what the phone holds, and a probe
that said "no photos found" would be manufacturing exactly the confident wrong answer this file
exists to prevent.

**Granted on the second attempt, and read back before anything ran.** The first attempt did not
reach this package at all; the second, from an App info screen opened directly at
`package:com.chetan.connectsuite.debug --user 0` so no entry had to be identified by eye:

```
User 0 | READ_SMS:                        granted=true   flags=[…]            ← positive control
User 0 | POST_NOTIFICATIONS:              granted=true   flags=[ USER_SET|…]
User 0 | READ_MEDIA_VISUAL_USER_SELECTED: granted=true   flags=[ USER_SET|…]  ← discriminator
User 0 | READ_MEDIA_IMAGES:               granted=true   flags=[ USER_SET|…]
User 0 | READ_MEDIA_VIDEO:                granted=true   flags=[ USER_SET|…]
User 95| (DUAL_APP clone) all five false
```

**Reading the discriminator correctly matters here, because "Allow all" grants three permissions,
not two.** `READ_MEDIA_VISUAL_USER_SELECTED` is `true` in both modes; what separates them is that
*Select photos* leaves `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` **false**. Both are true, so this
is full access. `USER_SET` on all three is the evidence a person acted — it was absent on all three
after the first attempt, which is how "no grant" was told from "a grant I misread". And the clone at
user 95 reading false on everything confirms the grant landed on the copy under test.

### The pager, on hardware, through the app's own client

`MediaProbeActivity` drives `MediaStoreReader` — the same `ContentResolver` call, the same bound
arguments and the same selection string the `media.list` handler uses. Not `adb shell content query`,
which inlines its literal and would be a different client answering a different question.

**`media.buckets` first, because it publishes the denominator everything else is measured against:**

```
BUCKET -1829889111 WhatsApp Images  count=5774  pkg=com.whatsapp  app=WhatsApp
BUCKET -1739773001 Camera           count=16369 pkg=-            app=-
BUCKET -1313584517 Screenshots      count=3748  pkg=-            app=-
BUCKET -1441264713 Edits            count=93    pkg=-            app=-
BUCKET -1432612566 WhatsApp Video   count=170   pkg=com.whatsapp app=WhatsApp
… 12 buckets
```

The package-id rule is visible in that output and so is its negative case: the WhatsApp buckets
carry `packageName` **and** a resolved `appName`, and `Camera`, `Screenshots`, `Edits` and `Download`
carry neither, because their paths hold no package segment. A rule that labelled everything would be
indistinguishable from one that labelled nothing.

**Reading 1 — the everything-cursor, taken before any paging.** A cursor a year past the newest row
returned **50 items, `hasMore=true`**. Not zero. A wrong cursor *value* cannot return zero on this
query; only a selection that never ran can, which is defect 50's signature — so that possibility is
excluded before the counting starts rather than after.

**Reading 2 — consecutive pages, counted, to exhaustion, against the declared count.**

*Edits, 93 items, 20 per page — a whole bucket, small enough to see whole:*

```
20 → 40 → 60 → 80 → 93     every entry distinct, 0 repeats
PAGE 5: 13 items, hasMore=false
RESULT: 5 pages, 93 distinct ids, 0 repeats, declared count=93, stopped=exhausted, sums=yes, 93 == 93
```

*Camera, 16,369 items, 500 per page — the largest bucket on the device:*

```
500 → 1000 → 1500 → … → 16000 → 16369    0 repeats at any boundary
PAGE 33: 369 items, hasMore=false
RESULT: 33 pages, 16369 distinct ids, 0 repeats, declared count=16369,
        stopped=exhausted, sums=yes, 16369 == 16369
```

**`stopped=exhausted` is in that line because the first Camera run was not.** It stopped at the
probe's own 200-page cap with `10000 of 16369` and printed `match=false` — which is the probe
reporting its own limit as though it were a pager fault. The probe now distinguishes the two and
says `not tested — capped` rather than `NO`, because a run that hits a cap has proven the pager
advances and has proven **nothing** about the total.

**Reading 3 — what the tiebreak actually caught, which is the reading that makes the other two mean
something.** Pages summing correctly proves a pager works; it does not prove the *tiebreak* was ever
exercised, and a run where no boundary fell inside a shared second would have passed identically with
the tiebreak deleted. So the probe counts, on the far side of each boundary, the rows sharing the
previous page's second — exactly the rows a bare-millisecond cursor would have skipped:

```
boundaries inside a tie group=6 (rows a bare-ms cursor would have dropped: 10)
```

**6 of the 32 boundaries in the Camera bucket landed inside a tie group, and 10 photographs would
have gone missing.** Not a hypothetical burst on a contrived fixture — this phone's own camera roll,
at 500 per page. The JVM red-first run showed the cursor *can* lose rows; this shows it *would have*,
here, today.

The layer this does not reach is stated rather than glossed: the control channel, the envelope and
the handler sit above `MediaStoreReader` and are not exercised by a probe. The Mac's Photos pane is
what exercises those.

### The grey chip, observed on the device rather than only asserted

The build is on the handset and the three verbs are registered. `link-up.sh` reads **3 of 3**
(service foregrounded, all three ports LISTEN under uid 11011, one control session ESTABLISHED), and
the feature's own install line and the capability set agree:

```
[media] Media feature installed with 3 of photos' 4 verbs (media.original is slice 3);
        read permission not granted; capabilities now: [calls, contacts, mirror, sms]
[caps]  Capabilities now: calls,contacts,input,mirror,notifications,remote,sms
```

**`photos` is absent, and the absence has its control in the same line**: six other capabilities are
present in that set, so this is a reading of a capability that did not advertise rather than an empty
list or a feature that failed to install. Both halves are false here at once — the permission is not
granted *and* the fourth verb is missing — which is what the next reading separates: after the grant,
photos must still be absent, and then only the fourth verb and the bulk channel are holding it.

## Suite

Phone **202** tests (`core` 76, `sync-module` 51, `input-module` 44, `mirror-module` 31), 0 failures,
`--rerun-tasks`. Was 190 at slice 1: +3 in `core` (the photos alternatives, defect 54's bulk-channel
guard, and the slice-2 expectation) and +9 in `sync-module` (`MediaPayloadsTest`). Mac **139**,
untouched by this slice.

## Slice 2b — the Mac's Photos pane · 2026-08-31

Built on the three verbs slice 2 shipped, ahead of `media.original`, so there is something to look
at before the bulk channel exists. **The `photos` capability is still not advertised** and the pane
works anyway; that combination is the point rather than an oversight, and it is drawn deliberately —
see `docs/design-departures.md` → **Photos**, row P5.

### End to end, on the device — the layer the phone-side probe could not reach

`MediaProbeActivity` drives `MediaStoreReader` and stops below the envelope. This is the same pager
run through the **whole** path: renderer → preload → IPC → main → control channel → phone handler →
`MediaStore`, and back.

Paging by scrolling the grid, counting distinct `data-id` attributes on the tiles:

```
page 1   120 tiles, 120 distinct, 120 thumbnails drawn
scroll   240 tiles, 240 distinct,   repeats counter: 0
scroll   360 tiles, 360 distinct,   repeats counter: 0
scroll   480 tiles, 480 distinct,   repeats counter: 0
```

`media.buckets` came back with **149 albums, 35,755 items**, the largest being Camera at 16,369 —
the same numbers the phone-side probe read, now through the wire.

### Two defects of my own, found by counting rather than by looking

The screenshot looked correct in both cases. What found them was reading two numbers that had to
agree and did not.

**The grid loaded pages forever.** The tile count went 240 → 360 with `scrollTop` still at 0. The
scroll trigger was `scrollTop + clientHeight >= scrollHeight - 400`, which is **permanently true for
a grid shorter than its own viewport** — so the pane fetched, rendered, satisfied the condition
again, and fetched again. Fixed by requiring `hasMore`, `!loading`, and *something to scroll*
(`scrollHeight > clientHeight`). A trigger that fires when there is nothing to scroll is not a
scroll trigger.

**The same page was fetched twice, with the same cursor.** 360 tiles carried **248 distinct**
aria-labels. `this.loading = false` ran *before* `this.items` was extended, so a scroll arriving in
that window started a second fetch from the same cursor and the same 120 rows came back. Fixed by
clearing the flag in `finally`, after the state is updated.

**The duplicate check stayed, as a counter rather than a de-duplication.** A pane that silently
dropped repeated ids would have hidden both defects and would hide a genuinely broken cursor later.
It now counts them and logs the tally beside the distinct total; `repeats` reads **0** across every
page above. A count that never moves is the evidence.

**And a third thing, which was a measurement fault rather than a defect:** the first scroll test
reported nothing loading, because the app had routed itself to Mirror and the section was `hidden` —
`clientHeight` and `scrollHeight` both `0`. A hidden element cannot be scrolled and cannot report a
height, so that run was measuring nothing. It is the sampling rule from this morning in a different
costume: **the reading did not exist**, and it was one sentence from being written down as "paging
does not work". The fix was to assert the pane was visible first, which is now the first thing every
reading in this section checks.

Similarly, the tiles were reported by eye as "tall, not square" from the screenshot. Measured, they
are **126 × 126** with `aspect-ratio: 1` applied and four columns in a 1440-wide window. The eye was
wrong and the measurement is what counts — recorded because it is the same rule pointing the other
way: a *negative* impression is no more evidence than a negative reading.

### What is drawn and not yet seen

The **unavailable** branch — the phone answering `PERMISSION_DENIED`, banner replacing the grid,
carrying the phone's own sentence and fix hint — is implemented and has **not** been observed. Seeing
it means revoking a grant the user made by hand, which is not something to do to someone's phone for
a screenshot. Recorded as drawn-but-unobserved rather than claimed.

## Suite

Mac **146** tests (was 139), 0 failures, `tsc --noEmit` clean. The seven new ones are the pane's pure
half through the same `globalThis` seam `calls.ts` uses — the copy of the partial notice, the
package-id rule at its landing point on this pane, sizes, clock, and the summary's behaviour when
the phone sends no dimensions. Phone unchanged at **202**.

## Slice 3 — `media.original` and the Mac's first bulk client · 2026-09-01

**Port 42503 carries bytes for the first time.** Slice 1 built the frame caps on both ends and could
only unit-test them; this section is the on-socket evidence that slice recorded as owed.

### The capability and the feature arrive together, which is what the contract was written for

`photos` went from absent to advertised at the moment the fourth verb and the served socket landed
in the same install:

```
[media] Media feature installed with all 4 photos verbs and the bulk channel served;
        read permission granted; capabilities now: [calls, contacts, mirror, photos, sms]
```

On the Mac the amber banner disappeared in the same moment, from the same fact — `photos.setAdvertised`
takes the capability list and `partialNotice(advertised)` returns null when it is on. That is
deliberate wiring rather than a coincidence of timing: a banner reading *"thumbnails only"* over a
pane that saves originals would be the stale-copy defect this pane replaced on its way in, and
`the notice disappears the moment the capability is advertised` is that written as a test.

### Three transfers, phone → Mac, digests compared on both ends

| Transfer | File | Bytes | Mac | Phone | Frames accepted / rejected |
|---|---|---|---|---|---|
| `t-1-13756` | `20260831_153657.jpg` | 2,522,538 | 161 ms, 125.3 Mbit/s | 62 ms, 325.5 Mbit/s | 11 / 0 |
| `t-2-43839` | `IMG_3466.MOV` | 23,604,812 | 285 ms, 662.6 Mbit/s | 209 ms, 903.5 Mbit/s | 92 / 0 |
| `t-3-27213` | `Screenshot_…_Google.jpg` | 858,102 | 98 ms, 70.0 Mbit/s | 16 ms, 429.1 Mbit/s | 5 / 0 |

**The digests were compared rather than assumed.** The phone digests while streaming and reports
what it sent; `shasum -a 256` on the Mac's copy agrees for every one:

```
phone f4c0d81ffcef…   mac f4c0d81ffcef3abbd120890670b5de61a7f37076bec7b2389aaaec5a5a0cf6dc
phone bd74376627ed…   mac bd74376627ede58408aa0a321ff62435f80a2a7b9b51c8d4e09787e2a2a379c9
phone 6c339f67d305…   mac 6c339f67d305…
```

That is a comparison of two independently computed digests over the same bytes, which is what makes
it evidence. It is **not** the same thing as `verified: true` on the wire, and the field stays
`false` on purpose: nothing agreed a digest *in advance*, because `media.original` acks `sha256:
null` rather than reading every file twice before sending it. A success nobody checked must not look
like a success that was — which is exactly why `verified` is a separate field from `ok`.

**The frame tally is the caps' first denominator on a real socket.** `11 frames / 2522575 bytes
accepted, 0 rejected` — the refusal count with the accepted count beside it, which is the thing slice
1 could only assert in a unit test. Nothing was refused, and now "nothing was refused" is a reading
rather than an absence of one.

### A defect the tally caught, in the tally itself

After two transfers the Mac logged **`3 transfers / 0 failed`**. Two transfers, three counted.

`complete()` guarded on `if (settled) return` and then set `settled = true` **after** an `await` on
`file.end`. Two callers race to finish a transfer — the frame reader when the agreed length arrives,
and the socket's `close` handler when the phone hangs up — and both could pass the guard in the
window the await opened. Fixed by claiming the flag before yielding, never after.

**This is the same defect as the renderer's duplicate page fetch, one layer down**, and it was found
the same way: two numbers that had to agree and did not. Nothing about the transfers was wrong — the
files are byte-perfect — so a build without that counter would have shipped this and the first
person to notice would have been someone reading a transfer count that drifted upward over a long
session. It now reads `1 transfers / 0 failed` for one transfer.

### The gate refused once, correctly, and said so

Driving the pane, a check refused to press Save because `photos.selectedItem` had changed between
reading the target and acting on it — the user was clicking in the app at the same time. It answered
`the selection moved: 1000297632` rather than pressing the button anyway. That is the gate rule
working in its intended shape: **the predicate that decides whether to act is evaluated at the moment
of acting**, and a refusal says what it refused and why.

### One layout defect, found by measuring what the screenshot showed

The detail card's preview drew a **180 × 367 thumbnail at 320 × 652** — `width: 100%` on a 320px
column, upscaling a thumbnail two and a half times. The measured consequence was a 792px detail
column inside a 562px panel, running past the bottom of a 920px window: the metadata and the Save
button were below the fold on a portrait photo.

It was noticed by eye and then **measured before being believed**, which is the rule from the
previous sitting applied in the direction it usually is not — the eye was right this time, and the
measurement is what turned "looks wrong" into a number. Fixed with `max-height` and `width: auto`
so a thumbnail is never enlarged: now `108 × 220` drawn from `180 × 367` natural, `upscaled: false`,
a 372px card inside the 562px panel, and the whole thing inside the window.

### What is not proven here

- **Resume.** The phone honours an `offset` in the header and digests the skipped bytes through
  `digestSkipped` so the digest still covers the whole file, but **nothing has ever sent a non-zero
  offset.** The code path is unexercised and is recorded as such; the resumed-digest test stays a
  precondition on the transfer slice, where a receiver exists to interrupt.
- **Push.** Nothing writes to the phone over this channel yet. `fs.*` owns that, along with SAF
  destinations and the `.part`/`.failed` convention.
- **A refused frame on a live socket.** Every frame in every transfer above was legal. The caps'
  refusal path is still unit-test-only; what is now proven on hardware is the *accept* path and its
  tally.

## Suite

Phone **204** tests (`core` 77, `sync-module` 52, `input-module` 44, `mirror-module` 31), 0 failures.
Mac **147** tests, 0 failures, `tsc --noEmit` clean.

The phone gained the capability-turns-on assertion and the reshaped side-channel guard. That guard
used to read *"no feature needs a side channel it does not open"* and asserted, literally, that **no**
feature needed one — true until this slice and due for deletion the moment it stopped being. It now
asserts the two lists agree in both directions, so it keeps its meaning instead of becoming an
exception. Taken red first by dropping `media.original` from `MediaFeature.handledTypes`: three
assertions failed, naming the missing verb, the unserved channel, and the drifted set.

## Slice 4 — resume, built digest-first · 2026-09-01

**Resume has been exercised rather than specified**, for the first time. The order was deliberate:
the digest before the receiver, because it is the one fault in this path that destroys a good file
and reports corruption while doing it.

### 1. The resumed digest, red before green

`src/shared/transferDigest.ts` is the rule as an object rather than a comment: `primeFrom` is a call
that has to be made, so a resumed transfer that skips it fails a test instead of a user's file. Six
tests, and the shape of them matters — the assertion is **a resumed transfer's digest equals a
whole-file digest of the same source**, never that the transfer reported success, which is the thing
under test.

Red first, with the bug written as it would really appear (priming silently does nothing):

```
✖ a resumed digest equals a whole-file digest of the same source
    actual: 'c2afaa280bc74b0e103dc06501c126b4858c04b8117f094f5dbb83430114de1e'
✖ a partial shorter than the offset is refused rather than digested
```

`c2afaa280bc7…` is the digest of the **tail only** — the exact wrong answer the spec describes, and
the one that would have been reported as `CHECKSUM_MISMATCH` on a byte-perfect file.

Three of the six are guards against lookalikes rather than the happy path: a partial *shorter* than
the offset is refused rather than digested (digesting what is there gives a wrong digest that looks
correctly computed, and the blame lands on the transfer); priming *after* bytes have arrived is
refused; and `the order matters, demonstrated rather than asserted` hashes the same two pieces
backwards to show that "covers every byte" is not sufficient — it has to cover them in the file's
order.

### 2. The receiver half, and the three states on disk

Bytes land in `name.part` and are renamed only after the digest verdict. `src/shared/transferFiles.ts`
owns the two suffixes and the sidecar text; `transferFiles.test.ts` holds the enforceable half of the
convention.

**The `.part` enforcement question, answered honestly rather than stretched.** The spec split it into
three claims and the code now matches that split exactly:

| The claim | What enforces it | Where |
|---|---|---|
| The suffix is declared in one place per side | A test walking every `.ts` in `src/` and failing on an inline `'.part'` or `'.failed'`, with a control proving the walk can see the literal where it exists | `transferFiles.test.ts` — **enforced** |
| The receiver never leaves a bare truncated file at the final name | The write path opens `partPathFor(destination)` and the only `rename` is after the digest verdict | code, and the hardware run below — **enforced** |
| Nothing *else on the phone* leaves a `.part` in a folder we can see | **Nothing, and nothing can.** DCIM and Documents are shared with every downloader on the device | **recorded, not enforced** |

The third row is met the only way it can be: not by constraining other software, which is impossible,
but by making our own code refuse to act on a filename it has no record of. `isResumable` takes the
recorded length and returns `another app's file` when there is none — so a stray `.part` is left
alone and the transfer starts over, rather than our bytes being appended to a stranger's partial.
That is what keeps the convention a display convenience instead of something load-bearing.

### 3. Resume on hardware — and the defect the first run found

**The first run did not resume, and the reason is worth more than the run.** A 1.4 GB video,
interrupted at 705,167,360 bytes:

```
firstHalf.bytes 705167360      partBytes 704643072      offsetOffered 0
```

Two chunks — 524,288 bytes — were still in the write stream's buffer when `fail()` resolved. The
caller stat'd the `.part` while it was still being written, recorded a length that then grew, and on
the next attempt found a partial **longer** than its own record. `isResumable` refused, correctly,
and the whole gigabyte was re-fetched.

**The guard turned a corruption into a slow success**, which is the right trade and not a reason to
leave the race in place: without that length check the receiver would have appended to a partial
whose true length it did not know, and produced a file whose digest could never match. Fixed by
awaiting the flush before the interruption resolves.

**The second run, after the fix — a 52,437,344 byte video, interrupted at half:**

```
phone  t-8-25766 failed after 33030144 of 52437344 bytes
mac    t-8-25766 interrupted after 26476544 of 52437344; the partial is kept at …mp4.part
mac    t-9-26132 resuming at 26476544; the digest was primed over the bytes already on disk
phone  t-9-26132 resuming at 26476544 of 52437344; the digest covers the skipped bytes too
phone  t-9-26132 sent 52437344 of 52437344 bytes, sha256=1b94fea1269a…
mac    t-9-26132 pulled 52437344 bytes (resumed from 26476544), sha256=1b94fea1269a…
```

| Reading | Value |
|---|---|
| `.part` length after the interruption | 26,476,544 |
| Offset the resumed attempt was offered | 26,476,544 — **matches exactly** |
| Bytes carried by the second socket | 25,960,844 in 101 frames — **half the file** |
| Phone's digest (whole file, skipped bytes included) | `1b94fea1269a…` |
| Mac's digest (primed from the partial, then appended) | `1b94fea1269a…` |
| Independent digest of what landed on disk | `1b94fea1269a…` |

**Three independently computed whole-file digests agree over a file that moved in two pieces across
two sockets, where the second socket carried only half the bytes.** That is the claim the spec asked
for, and it is the first time any of it has been observed rather than argued.

Note the phone's own line — `the digest covers the skipped bytes too` — is the sender's mirror
obligation, and it was already correct from slice 3. What did not exist until now was the receiver's
half, which is where the failure actually bites.

### The probe, and why it is not a second client

Resume cannot be exercised without an interruption, and an interruption cannot be arranged from
outside a socket `BulkClient` owns. The alternative was a standalone script speaking the protocol
itself — **defect 50's shape exactly**: a second client, differing from the shipping one somewhere,
verifying a mechanism the product does not use.

So the *stimulus* is injected (`interruptAfterBytes`) and the *mechanism* stays the product's:
`photos.original` for the ticket, `BulkClient.pull` for both halves, `TransferDigest` for the digest.
The handler is registered only when `!app.isPackaged`, beside `debugSwitches`.

### What is still not proven

- **The checksum-mismatch branch has never run**, and cannot yet: `media.original` acks
  `sha256: null`, so `expectedSha256` is always null and the comparison is skipped. The `.failed`
  sidecar's *text* is unit-tested; the code path that writes it awaits `fs.transfer.begin`, which is
  the first thing to agree a digest in advance. Recorded rather than claimed.
- **Push.** Nothing writes to the phone over this channel. The receiver half built here is the Mac's;
  the phone's receiver is `fs.*`.
- **The frame-cap refusal path is still unit-test-only, and this slice did not close it.** It was
  looked for: every frame in every transfer here was legal, and the only way to produce an over-cap
  frame on a real socket would be to build a peer that deliberately emits one — which is a second
  client again, verifying a refusal the product's own writer refuses to produce. Left recorded as
  **accept-path proven, refusal-path unit-tested**, rather than stretched for.

## Suite

Mac **161** tests (was 147), 0 failures, `tsc --noEmit` clean — 6 for the resumed digest, 8 for the
on-disk convention. Phone unchanged at **204**.

## Slice 5 — `fs.*`, the phone side · 2026-09-01

Six verbs, all on hardware, through the Mac's own client. `files` is advertised for the first time.
The Mac's Files **pane** is deliberately not built — that order is what kept Photos honest, and it
is what let this slice find a defect that a pane would have hidden behind a spinner.

Built in the order the brief set: read paths first (`fs.list` for roots, `fs.list` in a tree,
`fs.stat`, `fs.mkdir`), then `fs.delete`, then `fs.transfer.begin`.

### 1. The pure half, red before green

`FsPathsTest` — 22 tests. Each of the three that carries a rule was shown to fail against the defect
it is named for, by reintroducing the bug and watching it go red:

| Mutation | Test that went red | What it said |
|---|---|---|
| `compareBytewise(a.id, b.id)` → `0` in `ENTRY_ORDER` | `two entries sharing a name are separated by their ids` | `expected:<[msf%3A1, msf%3A2]> but was:<[msf%3A2, msf%3A1]>` |
| `compareBytewise` → `a.compareTo(b)` | `byte-wise ordering is not the platform's string ordering` | UTF-16 and UTF-8 disagree on U+1F600 vs U+E000, in opposite directions |
| the `mtimeMs` clause deleted from `deleteVerdict` | `a delete is refused when only the modified time disagrees` | a file rewritten to the same length passes a size-only guard |

**And one of those runs found that a test of mine was not evidence.** Deleting the id tiebreak left
`a page boundary inside a group of identical names` **green**: `sortedWith` is stable and the cursor
resolves positionally, so a tie group keeps its input order and the boundary lands in the same place
either way. That is the `MediaPayloadsTest` trap one layer along — a pager test that passes
identically with the clause it is named for removed.

What actually makes the tiebreak load-bearing is that **the input order is not ours**: every page is
a fresh `DocumentsProvider` query and nothing guarantees two return rows in the same order. So the
test that can see it shuffles the listing between pages —
`pages survive the provider returning rows in a different order each time` — and with the tiebreak
deleted it reports `no entry may be seen twice expected:<20> but was:<17>`. **Three rows lost
between two pages that each looked perfectly well formed.**

### 2. The compare-and-delete guard has an enforcement point, not a comment

`FsDeleteGuardTest` — 7 tests, scanning the module's own source:

- `DocumentsContract.deleteDocument` appears in **exactly one** file, and `file.delete()` in exactly
  one. Adding a second `deleteDocument` call site made it red:
  `must appear in exactly one file — found {SafTreeStore.kt=2}`.
- `FsStore` declares **no** `fun delete(` — there is no unguarded deletion for a future caller to
  reach for.
- Both stores evaluate `FsPaths.deleteVerdict` **twice**: once to answer, once more on a freshly
  read row with nothing between it and the irreversible call. That is `scripts/step70-watch.mjs`'s
  shape, and it is here for the reason that script exists.
- The guard's reads never come from the directory snapshot (§5) — `Snapshots.hit(` appears once, and
  inside `childrenOf`. A guard answerable from a 30-second-old cache re-checks a copy.

It carries its own fixtures, per the `no-force-stop.sh` lesson: one proving the scan sees a second
call site, one proving it does not count a mention in prose as one.

### 3. The read verbs, on hardware — `fs.list`, `fs.stat`, and two refusals

Through `link.request`, the same call `photos.ts` makes. One granted tree on this handset,
`primary:DCIM`, persisted since the 2026-08-31 SAF probe run.

```
roots      app:files      "ConnectSuite"  kind=app   writable  freeBytes=27233689600
           saf:primary%3ADCIM  "DCIM"     kind=tree  writable  freeBytes=27233681408
grantHint  "Add a folder in ConnectSuite on the phone, under Sync › Folders, to browse more of it"

DCIM root  28 entries, 1 page, stopped=exhausted
fs.stat    primary%3ADCIM%2FAjanta%20instgram → dir, mime=inode/directory, sha256=null
```

**Both refusals are readings, not absences:** `path: 'Camera/../../..'` came back
`BAD_REQUEST: … (path may not contain a \`..\` segment)` — refused, never normalised — and
`rootId: 'saf:primary%3ANotGranted'` came back `ROOT_NOT_GRANTED: This phone has not shared that
folder.` In the same run, the same client, two other `fs.list` calls returned rows. A refusal with
no accepted call beside it cannot tell a working guard from a dead feature.

### 4. Defect 55 — the pager was correct and took eight minutes

Paging `DCIM/Camera` to exhaustion, first run:

```
pages 33   limit 500   stopped=exhausted
seen 16376   distinct 16376   allDistinct=true   sums=tested
elapsedMs 490328   firstPageMs 17632
```

Every entry distinct, every page summing, and **490 seconds**. `limit` bounds the frame and never
the work: a `DocumentsProvider` honours neither a sort order nor a limit, so each of the 33 pages
listed all 16,376 rows again to hand back 500 of them.

This is only visible by running the pager **to exhaustion on real data**. A first page returning 500
rows in 17 seconds reads as a slow phone; 33 of them reads as an unusable feature. It is also
exactly what the Mac pane would have hidden — a scroll that loads more, slowly, is indistinguishable
from a network hiccup.

**The fix is a snapshot, and it is a correctness fix first.** Re-reading the directory on every page
is *also* wrong: two queries a second apart can return different rows, and the cursor's sorted
position then shifts underneath the pager. A snapshot held for the length of a run is the consistent
view the cursor was always assuming it had. Sliding 30 s idle TTL so an active run keeps its view,
absolute 120 s ceiling because these are not our directories, invalidated by every write we make.

After:

```
pages 33   limit 500   stopped=exhausted
seen 16377   distinct 16377   allDistinct=true   sums=tested
elapsedMs 21033   firstPageMs 15676
```

**490,328 ms → 21,033 ms**, of which 15,676 ms is the one unavoidable read. The phone's own line
names the cause rather than leaving it to be inferred:

```
[fs] snapshot of primary:DCIM/Camera in saf:primary%3ADCIM: 16377 entries read in 15391ms;
     0 hits / 2 misses since start, 2 directories held
```

**Two things this run does not prove, stated rather than left to be assumed.**

1. **The id tiebreak is not exercised by this data.** `duplicateNameGroups: 0`,
   `tieBoundaries: 0`, `tiebreakExercised: false` — no two entries in Camera share a display name, so
   the run passes identically with the tiebreak deleted. The shuffle test in §1 is the only place it
   is exercised, and that is said here because a green 33-page run is exactly what would persuade
   someone the clause is redundant.
2. **16,377 is not `media.list`'s 16,369.** Different denominators, not a discrepancy: `media.list`
   counted images and videos in the Camera *bucket*; `fs.list` counts *directory entries*, including
   subfolders such as `Cshot` and any non-media file. The count also moved by one between two runs
   an hour apart, which is the live directory the snapshot exists for.

### 5. `fs.delete` — the guard, both halves, on both stores

Run against the app-private root and against the SAF tree, because they are two different deletion
calls. Each run makes three refusals and then one accepted delete, in that order.

**A refusal on its own is not evidence** — a guard that refuses everything looks identical to one
that works — so the accepted delete is the control, and the file being gone afterwards is checked
independently.

| | `app:files` / `delete-probe.txt` (51 bytes) | `saf:primary%3ADCIM` / `connectsuite-delete-probe.txt` (28 bytes) |
|---|---|---|
| `expectSize` off by one | `TARGET_STALE` — *"It now holds 51 bytes… the Mac asked about 52"* | `TARGET_STALE` — *"It now holds 28 bytes… the Mac asked about 29"* |
| `expectMtimeMs` off by one second, size correct | `TARGET_STALE` | `TARGET_STALE` |
| neither field sent | `BAD_REQUEST: expectSize is required — this phone will not delete a file the Mac has not just seen` | same |
| survived all three | **yes** | **yes** |
| both facts as listed | `{"deleted": 1}` | `{"deleted": 1}` |
| gone afterwards | yes | yes, **and confirmed from the platform's side**: `ls: No such file or directory` |

The last cell is the one that matters. The SAF delete is confirmed by the shell, not by the app's
own report of what it did.

The second row is why there are two facts rather than one: a file rewritten to the same length
passes a size-only guard, and nothing about the request would look wrong.

### 6. `fs.transfer.begin` — `verified: true`, for the first time in this project

`media.original` acks `sha256: null`, so **nothing in this repo had ever compared a transfer against
a digest agreed in advance.** Every `fs.transfer.done` so far reported `verified: false`, and the
`CHECKSUM_MISMATCH` branch on both ends had never executed — the `.failed` sidecar's *text* was unit
tested and the code that writes it had never once run.

`fs.transfer.begin` pre-hashes below a 64 MB ceiling. Above it the ack still carries `sha256: null`
and reports `verified: false`, which is the same honest answer rather than a silent downgrade.

**Clean pull**, 819,200 bytes from `app:files`:

```
agreed    sha256 97b1c8f272a38726f557e97ed8fb71cdb47472f9fb8c42f75478d4dbd8c29118
          offset 0   chunkMax 262144   preHashed true
transfer  ok true   bytes 819200   verified true
          sha256 97b1c8f2…                       ← the Mac's streaming digest
onDisk    wholeFileDigest 97b1c8f2…              ← hashed independently of the transfer
          matchesAgreed true
```

Three digests, computed by three different pieces of code, agreeing.

### 7. The checksum-mismatch branch, made to run

One byte flipped **after** the sender's digest has taken the true value — which is what a corrupt
link does: the sender's digest stays right, the receiver's goes wrong, and the disagreement is the
finding. Flipping before the digest would make both ends agree on corrupt bytes and prove nothing.

The stimulus is injected inside the shipping sender (`BulkTransfers.debugCorruptAtByte`, armed only
by `FsProbeActivity` in `app/src/debug/`), for the reason defect 50 left behind: a tool that speaks
the protocol itself is a second client, and the difference between it and the product is where this
class of bug lives.

**The first attempt at this proved nothing and nearly read as if it had.** `am start` returned
`Activity class … does not exist` — the probe had no manifest entry — and the transfer that followed
came back `ok: true, verified: true`, which is exactly what a *working* corruption test would not
produce and exactly what an unarmed one does. The arming is now read back before anything is claimed
about the run:

```
W FsProbe: ARMED: the next bulk transfer covering byte 300000 will have that byte flipped
           after the sender's digest has taken the true value.
```

Then, with it armed:

```
transfer   ok false   verified false
           reason "The file arrived with a different checksum, so the partial was deleted."
           expected 97b1c8f272a38726f557e97ed8fb71cdb47472f9fb8c42f75478d4dbd8c29118
           actual   de54fd827c4406ef83b9ba5daadc88c5f82e32e645ee476ad7f389b52bde58cc
leftBehind partDeleted true   sidecarWritten true
onDisk     wholeFileDigest null            ← nothing at the final name
```

and the sidecar, read back off the disk:

```
ConnectSuite transfer failed — checksum mismatch
file      connectsuite-fs-1788207386734-pull-probe.bin
when      2026-08-31T20:16:26.834Z
size      819200 bytes received
expected  97b1c8f272a38726f557e97ed8fb71cdb47472f9fb8c42f75478d4dbd8c29118
actual    de54fd827c4406ef83b9ba5daadc88c5f82e32e645ee476ad7f389b52bde58cc
The partial file was deleted because the bytes that arrived were wrong.
A retry starts from zero; there is nothing here to resume.
```

matched to the phone's own line, by transfer id:

```
E [bulk] PROBE: t-1-86703 byte 300000 deliberately flipped from -17 to 16 AFTER the digest took
         the true value.
```

**And the control on the control:** the hook disarms itself after one flip, and the very next pull
came back `ok: true, verified: true, matchesAgreed: true, sidecar: false`. Without that, "the
transfer failed" is not evidence that the *corruption* failed it.

### 8. `fs.transfer.cancel`

The interesting half is not the ack. A cancel that answers `stopped: true` and leaves the transfer
claimable has reported success for something it did not do, and nothing in the ack could tell.

```
cancelAck          {"transferId":"t-3-39151","stopped":true}
claimAfterCancel   ok false — "the phone closed after 0 of 819200 bytes"
refusedAfterCancel true      nothingLanded true
```

### 9. `files` turns on, and one thing it promises that this build does not do

```
[fs]   Files feature installed with 4 of 6 verbs; 2 root(s): app:files, saf:primary%3ADCIM;
       capabilities now: [calls, contacts, mirror, photos, sms]        ← before the transfer verbs
[caps] Capabilities now: calls,contacts,files,input,mirror,notifications,photos,remote,sms
```

The first line is the contract working: four handlers of six, and `files` stays off. It went on only
when `fs.transfer.begin` and `fs.transfer.cancel` were registered and the bulk channel served.

**`fs.transfer.begin` with `direction: "push"` answers `FEATURE_UNAVAILABLE`** — *"This phone build
can send files to the Mac but cannot receive them yet."* That is locked decision 6's designed
degradation rather than a dead verb, and it is recorded here rather than left for the Mac to find:
**the Files pane must not draw an upload affordance until push lands.** Anyone reading the green chip
as "both directions" should read this paragraph instead.

### Suite

Phone **233** tests (`core` 77, `sync-module` 81, `input-module` 44, `mirror-module` 31), 0 failures,
run with `--rerun-tasks`. Mac **161**, 0 failures, `tsc --noEmit` clean. The phone's figure was 204 at
the close of slice 4; the 29 new ones are `FsPathsTest` (22) and `FsDeleteGuardTest` (7).

The debug probes' merged-manifest count, re-checked because a fourth probe was added:
**4 in the debug manifest, 0 in the release manifest**, with `MainActivity` returning 1 in both in
the same run as the control. The count is expected to move as probes come and go; the zero is not.

### Defect 55 — `fs.list` re-read the whole directory on every page

**Status: closed, in the slice that introduced it.** Found by running the pager to exhaustion on a
16,377-entry directory rather than by looking at a first page. 490,328 ms over 33 pages, 17.6 s each,
because `limit` bounds the frame and never the work — a `DocumentsProvider` honours neither a sort
order nor a limit, so every page listed every row again.

Fixed with a per-directory snapshot: sliding 30 s idle TTL, absolute 120 s ceiling, invalidated by
every write. **490,328 ms → 21,033 ms**, 15,676 ms of which is the one unavoidable read.

**Fix direction (applied):** `SafTreeStore.Snapshots`, read only from `childrenOf` and never from the
delete guard's `readRow` — asserted by `FsDeleteGuardTest`.

**Wrong fix to avoid:** raising `MAX_LIMIT` so fewer pages are needed. It does reduce the number of
full re-reads and it makes the worst case worse — one `fs.list` ack for a large directory is exactly
the frame `MAX_CONTROL_FRAME` is obliged to refuse, and a refused frame closes the socket. The cap is
not the problem; re-reading is.

**The general lesson, which is the reason this is a numbered defect rather than a commit message:**
the pager was *correct* on every measure the project had asked a pager for — consecutive pages,
counted, every id distinct, sums reached, `stopped=exhausted`. It passed all three of the
preconditions in `CLAUDE.md` and was still unusable. Those preconditions test whether a pager loses
rows; none of them tests whether it can be afforded. **A green pager needs a clock beside it.**

---

## Slice 6 — the Folders screen, the phone's grant surface · 2026-09-01

**A release build can grant a folder for the first time.** Until this slice the only route to a SAF
tree was `SafProbeActivity`, which lives in `app/src/debug/` and by construction cannot ship — so
`fs.list` could serve roots that no shipping build had any way to create. That was the blocker
holding the Mac's Files pane, and it is gone.

Proposed before it was built: `docs/phase-5-files-onboarding-proposal.md` rev 2. The Mac's Files
pane is still deliberately not built. Phone proven first.

### What was built

`sync-module/.../ui/folders/` — three files, and the split is the one `CLAUDE.md` asks for:

| File | What it is |
|---|---|
| `FoldersModel.kt` | **Pure.** The state type, the row, `foldersStateOf`, `pickMessage`. No Android, no Compose, so a JVM test reaches the real thing rather than a copy |
| `FoldersViewModel.kt` | Re-reads the platform on every resume. Nothing cached |
| `FoldersScreen.kt` | Material 3, the empty card, the rows, and the wall card |

`FsRoots.grantedFolders` is the one reader of `contentResolver.persistedUriPermissions`. The Folders
tab is a fourth `SyncTab`, and its **name is fixed by the wire**: `FsRoots.GRANT_HINT` already tells
every Mac to look under *Sync › Folders*, and a screen called anything else makes the phone a liar
in a sentence the Mac renders verbatim.

### The four states, all four observed on the device

The screen has four states and **none of them is a failure**, which is the decision this slice is
built around — `persistedUriPermissions` is read in-process and synchronously and cannot fail, so a
"couldn't load" card here would be unreachable and indistinguishable from a bug in the empty state.
`CLAUDE.md` now carries that as a rule.

| # | State | Observed | Log line, with its denominator |
|---|---|---|---|
| 1 | **Folders** — one row | `DCIM` / `read and write` / `Remove` | `Folders screen: 1 folder(s) shared, 1 resolving, 0 gone` |
| 2 | **No folders** | `No folders yet`, both explanatory lines, wall card still drawn | `Folders screen: 0 folder(s) shared, 0 resolving, 0 gone` |
| 3 | **A grant whose folder is gone** | `DCIM › cs-gone-test` / *"This folder is gone from the phone"*, dimmed, Remove only | `Folders screen: 2 folder(s) shared, 1 resolving, 1 gone` |
| 4 | **A pick that returned nothing** | **no message drawn at all** | `folder pick returned nothing — cancelled or refused, indistinguishable` |

State 3 was produced rather than waited for: `mkdir /sdcard/DCIM/cs-gone-test`, granted through the
screen, then `rmdir` underneath the live grant. Both the folder and the grant were removed
afterwards and the baseline restored.

**State 4 is the finding, not the feature.** Android refuses a folder by disabling `USE THIS FOLDER`
inside DocumentsUI; the user backs out and `OpenDocumentTree` returns `null` — and so does a user
who changed their mind. One result, two intents. Anything this app said about it would be right
about half the time, so it says nothing, and the `Download` wall is drawn as **permanent copy in
every state** because there is no afterwards to explain it in. The control for "no message": the
same dump held **18** other texts, so the absence is a reading and not an empty dump.

### The grant, read back from the platform rather than from our own report

Granted through the release-shaped screen — the picker, `USE THIS FOLDER` (`enabled="true"`,
checked before the tap), then `ALLOW`:

```
UriPermission{7de024f content://com.android.externalstorage.documents/tree/primary%3ADCIM [user 0] [prefix]}
  targetUserId=0 sourcePkg=com.android.externalstorage targetPkg=com.chetan.connectsuite.debug
  mode=0x3 owned=0x3 global=0x0 persistable=0x3 persisted=0x3 persistedCreate=1788209971068
```

**It is provably a new grant and not yesterday's surviving.** The probe's grant was object `61d3ce4`
with `persistedCreate=1788183861135` (2026-08-31 19:14:21); this is object `7de024f` at
`1788209971068` — **2026-09-01 02:29:31.068, matching our own log line `granted tree
saf:primary%3ADCIM` to the millisecond.** The grant was released first and verified released, so
there was nothing to survive.

### Two instrument findings, both of which would have been read as product faults

1. **`KEYCODE_BACK` in DocumentsUI navigates up, it does not cancel.** The first attempt at state 4
   pressed BACK once, saw no log line, and was one sentence from *"the silent branch does not run"*.
   The picker was still the resumed activity — `dumpsys activity activities` said so. **A missing
   reading, not a negative one**, caught by asking where the foreground was rather than by trusting
   an absence. The check that settles it is one line and is now in the loop that backs out.

2. **`dumpsys activity permissions` lists released grants until the owning process lets them go.**
   After `releasePersistableUriPermission`, `primary%3ADCIM%2Fcs-gone-test` was **still present** as
   a row — with `persisted=0x0`, twice, beside `mode=0x1 owned=0x1` transient entries. Counting rows
   that match `documents/tree` returns **2** and reads as *"Remove did nothing"*. The discriminating
   attribute is `persisted=`, not the row's presence: the real grant carries `persisted=0x3`.
   Yesterday's removal looked clean only because that grant was created by a process that had since
   died, so no transient entry lingered — the same query, two different answers, for a reason
   nothing in the output announces.

   This is the control rule again with our own tooling as the lookalike, which is where defect 50
   lived: **the reading and the thing being measured differ, and the difference is invisible unless
   you name the attribute that separates them.**

### The reading that killed the quick-pick chips

The proposal drew a row of `Camera` / `Documents` / `Pictures` chips. They are **not shipped**, and
the reason is a reading rather than a scheduling call.

`EXTRA_INITIAL_URI` is left unset (`docs/phase-5-files-onboarding-proposal.md` §8.3). The assumption
that makes chips look harmless is that an unaimed picker starts at the top of storage. **It does
not — it chooses.** Observed here: with no initial URI, DocumentsUI **restored its own last
location** and opened inside `DCIM`, listing that folder's 30-odd albums. On a second run that
location is wherever the previous pick ended.

A chip is a promise about where the picker opens. This app cannot make that promise, so the label
would be right by coincidence and wrong by default, with nothing on screen telling the user which.
That is the same shape as any other confident wrong answer in this file. Chips return only if §8.3's
reading shows the picker can be aimed reliably.

### The release-shaped claim, checked in both directions

The screen is in `sync-module/src/main`, so it ships. Proven rather than assumed, and with its
negative control in the same run:

```
sync-module/build/tmp/kotlin-classes/release/.../ui/folders/  →  FoldersScreenKt.class, FolderRow.class,
                                                                 FoldersUiState$Folders.class, …
app/build/tmp/kotlin-classes/release/.../probe/                →  No such file or directory
```

The thing that must ship does; the thing that must not, does not.

### Tests — 95 in `sync-module`, up from 81, and every new guard shown to fail first

| Guard | Mutation it was shown to fail against | Result |
|---|---|---|
| `foldersStateOf` keeps unresolvable rows | made all-gone collapse into `NoFolders` | **red**, 2 tests, on the sentence *"the user has grants to remove"* |
| `pickMessage` says nothing after a cancelled pick | returned *"That folder cannot be added"* | **red** — `expected:<null> but was:<That folder cannot be added>` |
| `FoldersUiState` has exactly two variants | added `Loading` **and drew it** | **red**, naming the variant |
| Only `FsRoots` reads `persistedUriPermissions` | a second read in the view model | **red**, naming both files |

**The single-source guard failed on its own first run, correctly, for the wrong reason** — it
matched the token inside `FoldersModel.kt`'s KDoc, which is prose explaining why that file does
*not* read the list. That is defect 41 exactly: a matcher that forbids documenting the rule it
enforces has broken the pair it belongs to. It now strips comments before matching and carries
fixtures in both directions — one proving it removes prose and keeps the call, one proving it does
not eat the call itself, plus a `://` case so a URL in a string does not truncate a line.

Adding a variant to `FoldersUiState` without drawing it is caught earlier and harder, by the
compiler: `FoldersScreen`'s `when` is exhaustive. The test covers what the compiler cannot — someone
adding a variant *and* rendering it, which is the actual way an unreachable state gets drawn.

### Baseline restored

One persisted tree grant, `primary:DCIM`, `persisted=0x3` — the same folder the device started with.
`cs-gone-test` deleted from `/sdcard/DCIM` and its grant released. `scripts/link-up.sh` **3 of 3**
after the final install, and the phone left on the Folders screen.

---

## Slice 7 — the Mac's Files pane · 2026-09-01

**The read half of Files, on the Mac, against the phone side proven in slices 5 and 6.** Phone first
was the gate and it paid twice over: the roots this pane opens on can now be created by a shipping
build, and the wire had already been exercised to exhaustion before anything was drawn on top of it.

Specified before it was built: `docs/phase-5-files-onboarding-proposal.md` §3.3, §3.4 and §6. The
departures from the canvas are `docs/design-departures.md` → **Files, F1–F7**.

### The states, measured in the running app

`M2` and `M4` are the pair this pane exists to keep apart, and both were produced against the real
phone rather than a stub — `contextBridge` freezes the bridge, so there is no way to fake one from
the renderer, which is the right constraint to be under.

**`M4` was produced by revoking the folder on the phone while the Mac still had it selected**, then
clicking that root. A genuine refusal, from the phone's own code path:

```
stateId: M4   classes: files-state-card files-state--destructive
headline: "Couldn’t open this folder"    headlineColour: rgb(255, 93, 93)
borderColour: rgba(255, 93, 93, 0.3)     retry: true
code: ROOT_NOT_GRANTED                   body: "This phone has not shared that folder."
```

**`M2` followed in the same window**, with the grant still removed so the phone returned exactly one
root:

```
stateId: M2   classes: files-state-card files-state--neutral
headline: "This phone has shared one folder"    headlineColour: rgb(244, 244, 247)
borderColour: rgba(255, 255, 255, 0.08)         retry: false    code: null
body: ConnectSuite’s own folder is always here… / Folders are added on the phone… /
      Files saved straight into the phone's Download folder can't be reached from here at all…
```

**Four differences, each shown to be load-bearing.** Colour, glyph, headline verb, and the retry.
Each was deleted in turn:

| Mutation | Went red |
|---|---|
| `M4` tone → `neutral` | *empty and failed differ in four independent ways* |
| `M4` icon → `folder` | *empty and failed differ in four independent ways* |
| `M4` headline → `M2`'s | that test **and** *the failed state states what happened* |
| `retry: true` on the ready state | that test **and** *only the failed state offers a retry* |

One difference is a bug away from none, which is the whole reason there are four.

### The wall is in the pane, and drawn exactly once

`DOWNLOAD_WALL` is one constant with two homes on screen and a rule that picks between them: the
`M2` card's body carries it as written, and the rail carries it in every other state, hidden while
the card is showing it. Read live with two roots present: rail copy visible, full sentence, card
absent.

This was wrong first. The state card only renders when there is at most one root, so the first
build drew the wall **only in the almost-empty case** — a user with folders, which is everyone the
feature is for, would never have seen it. Caught by reading the live DOM for the sentence rather
than by trusting that the copy existed somewhere.

### No upload affordance, checked against the pane and not the page

With the pane visible, 28 rows loaded: **3 buttons in the whole pane** — two root rows and one
breadcrumb — and **0 `input[type=file]`**. The canvas draws two drop tiles (F4) and neither exists.

**The first version of this check was wrong in a way worth recording.** `document.querySelector('[data-screen="files"]')` matches **two** elements: the app window carries
the attribute as its current-route marker, and the section is the pane. `querySelector` returns the
window, so the check counted every button in the app — sidebar included — and separately reported
`paneVisible: true` for a pane that was in fact hidden on the next launch. Both readings were about
the wrong element and both looked plausible. The fix is `section[data-screen="files"]`, plus
asserting the element is visible before believing anything it reports about itself — the DOM-is-an-
instrument rule, which this repo already carries and which still caught nothing until it was applied
deliberately.

A second false positive from the same sitting: a regex for `/drop|upload|send to phone/` matched the
degraded banner's own sentence — *"Sending files to the phone from here does not yet"*. Searching
text for an affordance finds the copy that explains its absence. Counting **controls** is the check;
counting words is not.

### A concurrency defect the pane would have hidden

The route opening and the `files` capability arriving are both correct reasons to refresh, and on a
cold start they land within a frame of each other. Both ran: the first fetched the roots and listed
28 entries, the second reset the listing underneath it, and its own `fs.list` then timed out after
10 s. **The pane settled on an empty table with no error at all** — the exact confusion this pane was
built to prevent, arriving through concurrency rather than through copy.

Visible in the desktop log as one success and one timeout seconds apart:

```
02:55:13 I [files] fs.list saf:primary%3ADCIM/ → 28 entries, hasMore=false, 53 ms — 1 ok / 0 failed
02:55:31 W [files] fs.list saf:primary%3ADCIM failed: fs.list timed out after 10000ms
```

Fixed by serialising `refresh()` — a second caller joins the run in flight rather than starting
another. Worth keeping in mind for the next pane: **a state machine that cannot represent an
ambiguous state can still be driven into one by two callers**, and no amount of care in the type
prevents it.

### A second reading on the picker, and it strengthens the quick-pick decision

Re-granting the folder at the end of this sitting, the picker — same unaimed intent, same device,
same day — opened at the **root of internal storage**, showing `Can’t use this folder` /
`To protect your privacy, choose another folder` with `USE THIS FOLDER` `enabled="false"`. An hour
earlier the same call restored its previous location and opened inside `DCIM`.

So the picker's starting point is not merely "not the top" — it is **not stable**. A chip promising
`Camera` would have been wrong in one of these two runs and right in the other, with nothing on
screen distinguishing them. `EXTRA_INITIAL_URI` stays unset and the chips stay unbuilt;
`docs/phase-5-files-onboarding-proposal.md` §8.3 holds the reading that would settle it.

### The picker's starting location is not stable between runs on one device

**Four opens of `ACTION_OPEN_DOCUMENT_TREE`, same handset, same day, same code path, no
`EXTRA_INITIAL_URI` on any of them.** The intent is built in exactly one place — `FsRoots.pickerIntent()` — and nothing about it changed between these:

| Open | Where the picker landed | `USE THIS FOLDER` | Anchored by |
|---|---|---|---|
| ~02:27 | **inside `DCIM`**, listing its 30-odd albums | `enabled="true"` | `folder pick returned nothing` at **02:27:44.693** |
| ~02:29 | **inside `DCIM`** | `enabled="true"` | `granted tree saf:primary%3ADCIM` at **02:29:31.068** |
| ~02:30 | **inside `DCIM`** | `enabled="true"` | `granted tree saf:primary%3ADCIM%2Fcs-gone-test` at **02:30:54.127** |
| ~03:02 | **the root of internal storage**, showing `Can’t use this folder` / `To protect your privacy, choose another folder` | **`enabled="false"`** | `granted tree saf:primary%3ADCIM` at **03:02:50.788**, after navigating down to `DCIM` by hand |

Three opens restored the previous location. The fourth, **thirty-two minutes after the third**,
opened at the one folder on the device that can never be granted, with the confirm button already
disabled. Nothing in the app differed; the only change between them is that the DCIM grant had been
released at **03:01:14.601** — which is a plausible cause and is **not established**, because a
single transition is one observation and DocumentsUI's location memory is not documented.

**What this settles, and it is the stronger version of the earlier claim.** The proposal previously
recorded *"unset does not mean the picker starts at the top — it means the picker chooses."* That is
true and too weak. The accurate statement is: **unset is not stable between runs on one device.**
A chip labelled `Camera` would have been right in the first three opens and wrong in the fourth,
with nothing on screen telling a user which they were in — and in the fourth it would have delivered
them onto the exact refusal that `docs/phase-5-files-onboarding-proposal.md` §3.5 exists to keep
them away from.

**So the chips are not shipped, and this is the reason.** Not "deferred", not "later": a chip is a
promise about where the picker opens, and on the only device we have measured, that promise cannot
be kept three times out of four and then broken.

**What would settle `EXTRA_INITIAL_URI`** is in §8.3 of the proposal and is unchanged by this — the
question there is whether *aiming* the picker works, and these four readings are all about what it
does when **not** aimed. They make the reading more necessary, not less: an unaimed picker that
wanders is the argument for aiming it, and the argument against shipping anything that claims a
destination until aiming is proven.

**Vendor or AOSP: unknown, single-device.** DocumentsUI is `com.google.android.documentsui` here,
which is the AOSP package name, but this is One UI on an SM-S938B and the location memory could be
either. One handset cannot tell them apart. See the single-device audit.

### Baseline

Mac **172** tests, up from 161; `tsc --noEmit` clean; `stylesheets.test.ts` green, so no selector
collides across the three sheets. The phone's grant was removed and re-granted during the run and is
restored: one persisted tree grant on `primary:DCIM`, `persisted=0x3`. `scripts/link-up.sh` **3 of
3**, and the pane is showing 28 entries from `DCIM`.

---

## Slice 8 — push, the phone as receiver · 2026-09-01

**Files moves in both directions.** `direction: "push"` is served: the phone opens a partial in a
granted tree, receives on the bulk channel, hashes what lands, and commits or refuses. The canvas's
drop tile is real, which closes **F4** in `docs/design-departures.md`.

### The contract changed first

`fs.list`'s roots ack carries **`push: true`**. It is there rather than in the capability list
because `files` is one capability with two directions and the Mac draws a different pane for each.
**Absent means false** — every phone built before this omits it — and `pushOffered` is the one place
that rule lives, with two readers (the main process caches it, the renderer draws from it) and a
test that walks `undefined`, `null`, `false`, `'true'`, `1`, `{}` and `[]` and expects `false` for
all of them.

The Mac's drop tile and the degraded banner are driven by that single fact, so they cannot disagree.
Observed at the moment the new phone build connected: `dropShown: true`, `degradedBannerShown:
false`, tile reading *"Drop files here to send them to DCIM"*.

### A clean push, three digests agreeing

3,000,000 bytes into `DCIM` through the shipping path — renderer → preload → main → `BulkClient.push`
→ the phone:

```
[fs]   fs.transfer.begin push saf:primary%3ADCIM//push-probe.bin → t-1-63334, 3000000 bytes,
       starting at 0, digest agreed in advance
[bulk] t-1-63334 received push-probe.bin into DCIM: 3000000 bytes in 79ms (303.8 Mbit/s),
       sha256=fd456163578b…, verified=true (agreed in advance and matched)
```

`shasum` on the Mac, the phone's streaming digest, and `adb shell sha256sum` on what landed all read
`fd456163578b6b63…`. No `.part` and no `.failed` left behind.

### The overwrite refusal — and the guard that forced it to exist

Pushing the same name again with no `overwrite`:

```
code: TARGET_STALE
"Nothing was written: "push-probe.bin" is already in that folder on the phone, holding 3000000
 bytes and last modified at 1788213763440, and the Mac did not ask to replace it."
fixHint: "Send it again with overwrite, or choose a different name."
```

With `overwrite: true` and different bytes, the file is replaced: 1,500,000 bytes, new digest
`aac8d165f1a8…`, matching on all three readings again.

**This check exists because `FsDeleteGuardTest` failed, and the code was what was wrong.** The first
version of `commit()` called `DocumentsContract.deleteDocument` three times inline — one of which
silently removed a user's existing file at the destination. `overwrite` was in the payload spec and
had not been implemented. The guard counts platform deletes and expects **one**; it saw four, and
the fix was not to raise the number. It is now **two named functions answering two different
questions** — `deleteIfUnchanged` (may this file the Mac was looking at be destroyed?) and
`deleteArtifact` (may this transfer artifact be cleaned up?) — and the test asserts both by name.

A guard whose number moves to fit new code has stopped guarding. This one moved because a genuinely
new *question* appeared, and the function answering it is named in the assertion.

### Resume, in the receive direction — and the two bugs the probe found first

**The first run reported resume working and it had not.** `resumedOffset: 0`, and the phone's log
said why, because the reason is on the line:

```
[bulk] push of push-resume.bin … starts at 0: there is no partial file
[bulk] t-2-3649 stopped after 0 bytes (0 of 24000000) … EOFException
```

The Mac had reported `sentBeforeCut: 12058624`. **Zero bytes arrived.** Two separate faults:

1. **The probe lied about its own stimulus.** `socket.destroy()` discards whatever is still in the
   send buffer, so 12 MB handed to `writeFrame` never left the machine. The count was *bytes queued*,
   not *bytes delivered* — an instrument reporting its own intention as a measurement. The fix is a
   half-close: `end()` flushes what is buffered and then closes, and the result resolves from the
   socket's `close` rather than from the write loop.
2. **A truncated push would have been committed as complete.** The receive path compared the digest
   and, when the Mac had agreed none, committed whatever arrived. A stream that ends early is an
   interruption, and with no digest **nothing else knows that** — the length agreed on the control
   channel is the only thing that can tell. `total < size` now keeps the partial and reports
   `TRANSFER_FAILED`; `total > size` deletes it, because an overrun cannot be resumed into anything
   sensible.

The second is the one that mattered. It was reachable by any interrupted push of a file above the
64 MB pre-hash ceiling, and its symptom would have been *a file that looks complete and is half
there* — the exact thing `.part` exists to prevent, defeated on the last step.

**With both fixed:**

```
[bulk] push of push-resume.bin … starts at 0: the partial is empty
[fs]   fs.transfer.begin push … → t-1-62476, 24000000 bytes, starting at 0, digest agreed
[bulk] t-1-62476 push-resume.bin ended early: 12058624 of 24000000 bytes. The partial is kept
       and the next attempt resumes from it
[fs]   fs.transfer.begin push … → t-2-62744, 24000000 bytes, starting at 12058624
[bulk] t-2-62744 resuming at 12058624 of 24000000; the digest covers the bytes already on disk
[bulk] t-2-62744 received push-resume.bin into DCIM: 24000000 bytes in 155ms (616.3 Mbit/s),
       sha256=5fa81f70ae5a…, verified=true (agreed in advance and matched);
       47 frames / 11941420 bytes accepted
```

**`starting at 12058624` is the phone's own number** — computed from its record and its partial, not
chosen by the Mac. `offset` was `0` in every ack for two slices because nothing in this project had
ever been the receiver. Only 11,941,420 bytes crossed the wire on the second attempt, and
`sha256sum` on the phone matches the source exactly: **a resumed transfer whose digest covers the
whole file, verified true, in the direction that had never been exercised.**

Note also `starts at 0: the partial is empty` rather than *there is no partial file*. Those are two
different reasons and the first version collapsed them by mapping a zero-length partial to `null` —
which made a genuine zero-byte resume read as a missing file. The reasons exist to be told apart in
exactly this situation.

### An instrument note: `/sdcard` stat-by-name goes stale after a SAF replace

Immediately after the authorised overwrite, two adb calls milliseconds apart disagreed:

```
$ adb shell ls -la /sdcard/DCIM/push-probe.bin      → 3000000 bytes, 03:32   (the OLD file)
$ adb shell sha256sum /sdcard/DCIM/push-probe.bin   → No such file or directory
```

Neither was true. Listing the **directory** showed the new 1,500,000-byte file at 11:53, matching the
phone's own log and the digest. A delete-plus-rename underneath emulated storage leaves stat-by-name
briefly serving a stale entry to one caller and a miss to the next. **List the directory; do not
stat the path.** Recorded in `docs/single-device-audit.md` as unknown, single-device.

### Baseline

Phone **257** tests (`core` 77, `input-module` 44, `sync-module` 105, `mirror-module` 31), Mac
**173**, `tsc --noEmit` clean. The DCIM grant is as it was — one persisted tree grant — and both
probe files were deleted from `/sdcard/DCIM`.

**Not built:** a Copy-to-Mac control in the pane (the pull path exists and belongs with a transfer
queue), and `Download/ConnectSuite` as a push destination without a grant, which is the
`EXTRA_INITIAL_URI` question in `docs/phase-5-files-onboarding-proposal.md` §8.3.

---

### Defect 56 — a truncated push was committed as the finished file — **closed**

**This is the most serious defect found in Phase 5, and it is written up here rather than left inside
slice 8's narrative because it deserves to read that way.** Slice 8's record found it while
describing a probe; the probe is the smaller half of the story.

#### What it was

The phone's receive path ended a push by comparing the digest the Mac had agreed against the digest
of what landed. When the Mac had agreed **no** digest, there was nothing to compare, and the path
fell through to `commit()` — which renames `name.part` to `name`.

`fs.transfer.begin` pre-hashes only below a **64 MB ceiling**, because hashing first means reading
the file twice and a 4 GB video would hold the control channel for a full read with nothing to
report. So *"the Mac agreed no digest"* is not an unusual configuration. **It is every push of a
large file.**

Which means: interrupt any push above 64 MB — close the lid, walk out of Wi-Fi range, let the phone
doze — and the phone renamed the partial to its final name and reported `ok: true`. The file was
in the user's `DCIM`, at the right name, with the right icon, and half there. Every tool that opened
it would open it. `.part` exists precisely so that a half file is never at its final name, and this
defeated it on the last step, after the convention had done its job all the way up to the rename.

**Nothing else could have caught it.** The digest is the usual second line of defence and it is
absent by design on exactly the transfers where this bites. `fs.transfer.done` reported
`verified: false`, which is the honest and useless answer — it says *nobody checked the contents*, a
sentence equally true of the complete file and of the half one. The length agreed on the control
channel before a byte moved was the only witness in the system, and it was never consulted.

#### What it was not

It was not a corruption bug and it must not be filed as one. The bytes that arrived were perfect. It
is a **completion** bug: the receiver could not tell an ending from a finishing, and the two produce
identical bytes on disk up to the last one.

#### How it was found, and why that is the uncomfortable part

It was found *underneath a probe fault*, while the probe was reporting the opposite. The push-resume
probe cut a 24 MB transfer at 12,058,624 bytes and reported that number as delivered; the phone's log
said `stopped after 0 bytes`. Chasing that disagreement — `socket.destroy()` discards the send
buffer, so the count was bytes *queued* — is what put a truncated stream in front of the receive
path in the first place. **Had the probe been right, the interruption would have been a clean resume
and this branch would never have run.** The instrument being wrong is what exposed it, which is not a
method anyone can rely on twice.

#### What now catches it

| Layer | What it holds | Shown to fail |
|---|---|---|
| `FsPartials.arrivalVerdict` | The decision itself: `Short` / `Overrun` / `Corrupt` / `Complete(verified)`, from the two lengths and the two digests and nothing else. Each verdict carries `keepsPartial`, so the disk policy travels with the verdict rather than being re-decided by the caller — the whole defect was a caller with a verdict and no policy for one case | — |
| `FsArrivalTest`, 9 tests | Every verdict, and the two that matter by name: a short arrival with **no digest agreed** is `Short`, and a short arrival **with** a digest agreed is still `Short` | **Yes, three ways — below** |
| `FsArrivalTest`'s source scan | That `BulkTransfers` reaches its verdict *through* `arrivalVerdict` rather than recomputing it inline, which is the shape the defect shipped in | **Yes** |
| `BulkTransfers.receiveFrom` | Reads the verdict and does one thing per case. `verified` is read off `Complete` rather than recomputed from `expected != null`, so the wire field and the log line cannot drift | — |

The three mutations, run 2026-09-01, each with the results file's age printed beside the verdict so a
stale XML could not be read as a pass:

| Mutation | Expected red | Actual |
|---|---|---|
| Delete the `received < agreed` clause — **defect 56, reintroduced exactly** | the three short-arrival cases | `tests=9 failures=3`, all three, by name |
| Decide the digest **before** the length | the one case whose two readings disagree | `tests=9 failures=1` — *a short arrival with a digest agreed is still short, never corrupt* |
| Recompute the verdict inline in `BulkTransfers` | the source scan | `tests=9 failures=1` — *the receive path asks arrivalVerdict rather than deciding for itself* |

**The first attempt at the third mutation did not compile, and the harness reported a pass anyway** —
it read the results XML from the previous run, which the failed build had never rewritten. That is
the seventh row of `CLAUDE.md`'s control table happening live, inside the very run written to prove a
guard: the instrument reported a state it had not measured. The rerun prints the file's age and the
Gradle exit code, and the mutation was rewritten to compile.

#### What would have to break for it to come back

Four things, and they are listed because "it is fixed" is not a durable statement about a branch:

1. **Someone deletes the `received < agreed` clause** — because on a healthy link it never fires, and
   an unreachable branch is a tempting thing to remove. Three tests go red.
2. **Someone reorders the verdict so the digest is read first**, which looks like a tidy-up and is
   the subtle version of the same bug. A truncated arrival *also* fails its digest, so it would be
   reported `Corrupt` — and `Corrupt` **destroys the partial**. The user-visible symptom would not be
   a half file; it would be a large push restarting from zero every time the network blinks, with a
   `.failed` sidecar explaining a corruption that never happened. One test goes red.
3. **Someone recomputes the verdict at the call site** — the original shape. The source scan goes red.
4. **The pre-hash ceiling is removed or raised to infinity**, which would make every push carry a
   digest and would make the length check look redundant. It is not redundant: it is what keeps a
   truncation resumable rather than destroyed, per (2). Nothing automatic catches this one, and it is
   named here for that reason.

The honest gap: all four guards are unit tests over a pure function plus one source scan. **The
truncation branch has run on hardware exactly once**, in the run that found it, and the fix's
hardware evidence is slice 8's `ended early: 12058624 of 24000000 bytes. The partial is kept` — one
observation, on one interruption, of one size. It is not a claim about every interruption; it is the
claim that this branch runs and keeps the partial when it does.

---

## Slice 9 — the grant-free destination, the aimed picker, and drag to Finder · 2026-09-01

Three things taken together because they are one question: **where does a file go when the user has
shared nothing, and how does it get back out?**

### 1. `Download/ConnectSuite` is a root, and it needs no grant

`downloads:connectsuite`, `kind: "downloads"`, label **Received files**, through `MediaStore`. The
roots ack, read through the Mac's own client:

```
{"rootId":"downloads:connectsuite","label":"Received files","kind":"downloads","writable":true,…}
{"rootId":"app:files","label":"ConnectSuite","kind":"app",…}
{"rootId":"saf:primary%3ADCIM","label":"DCIM","kind":"tree",…}
```

A 3,000,000-byte push into it, with the folder **not existing beforehand** — `ls` on
`/sdcard/Download/` returned no `ConnectSuite`, with `ls -d /sdcard/Download` returning `present` as
the control that the listing worked at all:

```
[fs]   downloads:connectsuite staged inbox-probe.bin as a pending item at
       content://media/external/downloads/1000297855
[fs]   fs.transfer.begin push downloads:connectsuite//inbox-probe.bin → t-1-68554, 3000000 bytes,
       starting at 0, digest agreed in advance
[bulk] t-1-68554 received inbox-probe.bin into Received files: 3000000 bytes in 80ms (300.0 Mbit/s),
       sha256=0c9c13446e67…, verified=true (agreed in advance and matched)
```

Three digests agree: the Mac's `shasum`, the phone's streaming digest, `adb shell sha256sum`.

**And that run did not prove the thing it looks like it proves.** The claim is *no grant needed*, and
the app was holding `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` on user 0 at the time — for the photo
browser. A push succeeding while the grants are present says nothing about a phone where they are
not. The `dumpsys` output made this easy to get wrong: it prints `granted=true` **and**
`granted=false` for the same permission, because user 95 is Samsung's `DUAL_APP` user and reads false
on everything (`docs/single-device-audit.md` §4).

So the control was taken properly. Both grants revoked on user 0, verified `granted=false`, the
service restarted, and the push repeated:

```
$ adb shell pm revoke --user 0 … READ_MEDIA_IMAGES   → granted=false, flags=[USER_SET|…]
$ adb shell pm revoke --user 0 … READ_MEDIA_VIDEO    → granted=false, flags=[USER_SET|…]

[bulk] t-1-46588 received nogrant-probe.bin into Received files: 1500000 bytes in 51ms
       (235.3 Mbit/s), sha256=2c657a62a75c…, verified=true (agreed in advance and matched)
```

Digests agreed on all three readings again. `fs.list` on the root then returned both files through
the app's own client — which is also the check defect 50 demands, because the listing binds
`RELATIVE_PATH=?` as an argument rather than inlining it, and this provider is the vendor's:

```
2 entries: inbox-probe.bin (3000000, mtimeMs 1788245968000),
           nogrant-probe.bin (1500000, mtimeMs 1788246046000)
```

The `mtimeMs` values land in 2026 rather than 1970, which is the control on `DATE_MODIFIED` being in
**seconds** and needing the ×1000.

Grants restored afterwards to exactly the state recorded before: `granted=true, flags=[USER_SET|…]`
for both.

**`/sdcard` stat-by-name went stale again, in the same way slice 8 recorded.** `sha256sum` on the
path said `No such file or directory` while the file was plainly there; listing the directory showed
it and the digest then read correctly. This is now **two independent observations** on this handset,
which moves it from a one-off to reproducible: **list the directory, do not stat the path.**

### 2. A pending `MediaStore` item survives process death — the claim §4 carried as unproven

`docs/phase-5-fs-media-proposal.md` §4 has said since it was written that resuming a pending item
across process death is *"plausible and has not been observed"*, and that it is the load-bearing
claim of the default push path. It is observed now.

The probe was split at exactly the point the process dies — `stopAfterCut` and `resumeOnly` — so both
halves run through the shipping client rather than a second one built for the test.

**Half one**, 24 MB cut at half, in pid **2766**:

```
[fs]   fs.transfer.begin push downloads:connectsuite//death-probe.bin → t-2-64746, 24000000 bytes,
       starting at 0, digest agreed in advance
[fs]   downloads:connectsuite keeping the pending death-probe.bin at 12058624 bytes; the next
       attempt resumes into this same item
[bulk] t-2-64746 death-probe.bin ended early: 12058624 of 24000000 bytes. The partial is kept and
       the next attempt resumes from it
```

The probe reported `sentBeforeCut: 12058624` and the phone received **exactly** 12,058,624. Those two
numbers agreeing is slice 8's half-close fix working — the run that found defect 56 had them at
12,058,624 and **zero**.

On disk, the platform's own partial, exactly as §4 predicted — visible, and not at its final name:

```
-rwxrwx--- 12058624  .pending-1788850964-death-probe.bin
```

**The process death.** `adb shell am kill` was tried first and **did nothing** — pid 2766 before and
after, because a foreground service is not "safe to kill". That was caught by reading the pid rather
than by assuming the command worked, which is the eighth control-table row exactly: establish that
the thing you are waiting for has actually been triggered. `am crash` then killed it — and reported
`Shell does not have permission to crash packages for user 150` while doing so, a refusal message
over a completed action, so the pid was the discriminator rather than the exit line. The log
confirms: `Scheduling restart of crashed service …/LinkService`.

`enabled_accessibility_services` still named our service afterwards, which is what force-stop would
have destroyed and is why `am crash` is the right tool here.

**Half two**, resume only, in pid **6191** — a process that never saw those bytes:

```
[fs]   downloads:connectsuite reusing the pending item for death-probe.bin (id 1000297857,
       12058624 bytes already staged) — this is the resume path
[fs]   fs.transfer.begin push … → t-1-44862, 24000000 bytes, starting at 12058624
[bulk] t-1-44862 resuming at 12058624 of 24000000; the digest covers the bytes already on disk
[bulk] t-1-44862 received death-probe.bin into Received files: 24000000 bytes in 240ms
       (398.0 Mbit/s), sha256=e5b1168d89cf…, verified=true; 47 frames / 11941420 bytes accepted
```

**11,941,420 bytes crossed the wire**, and 12,058,624 + 11,941,420 = 24,000,000 exactly. The pending
item is gone from the directory, the file is at its final name, and `sha256sum` on the phone matches
the source. **§4's open claim is closed: yes, and the offset comes from the item's own file
descriptor rather than from the row's `SIZE`.**

Note also that the truncation branch — defect 56's — ran here **with a digest agreed**, and reported
`Short` rather than `Corrupt`, so the partial survived. That is the ordering rule live on hardware,
not only in `FsArrivalTest`.

### 3. `EXTRA_INITIAL_URI` is honoured — §8.3's open question, answered (a)

`docs/phase-5-files-onboarding-proposal.md` §8.3 named three outcomes and three different decisions.
`SafProbeActivity` now takes an `initial` extra so the aimed and unaimed runs are the same client.

| Run | Where the picker opened | `USE THIS FOLDER` |
|---|---|---|
| **Control** — no extra | inside **`DCIM`**, its restored last location | `enabled="true"` |
| aimed at `Download/ConnectSuite` | **inside `ConnectSuite`**, listing its three files | `enabled="true"` |
| aimed at `DCIM/Screenshots` | **inside `Screenshots`** | `enabled="true"` |
| aimed at `DCIM/NoSuchFolderXYZ` (does not exist) | **`DCIM`** — the parent | `enabled="true"` |

Rows two and three are the discriminator between "the extra worked" and "the picker restored a
location that happened to be right": the control opened in `DCIM`, and two different aims landed in
two different folders. **Outcome (a): aiming is honoured and is safe.**

Row four is the one that decides the shape of the feature. **A bad aim degrades to the parent, not to
an error** — so a chip pointing at a folder that turns out not to exist lands the user somewhere
grantable. Which makes exactly one thing forbidden, and it is not a matter of taste: **no chip may
point inside `Download`,** because *its* parent is the refusal. §8.1's planned *Received files* chip
was precisely that chip.

### 4. The quick picks ship, and the guard catches the chip that was planned

`FolderQuickPicks` — Camera, Screenshots, Documents, Pictures — drawn in every state, hidden once
granted, each with its own accessibility name. On the device:

```
text:         'Quick picks'  'Camera'  'Screenshots'  'Documents'  'Pictures'
content-desc: 'Share the Camera folder'  'Share the Screenshots folder'  …
```

Pressed **by accessibility name**, not by a remembered pixel: *Share the Screenshots folder* opened
the picker inside `DCIM › Screenshots` with the confirm button enabled. The chip's promise is kept
through the shipping path.

`FolderQuickPicksTest`, 7 tests, shown to fail: **adding the `Received files` chip §8.1 planned —
`primary:Download/ConnectSuite` — turns it red**, `tests=7 failures=2`, on *every shipped chip passes
the rule*. Results-file age printed beside the verdict so a stale XML could not read as a pass.

There is no `Received files` chip for a second reason too: that folder is now a **root of its own**
needing no grant, so a tree grant over it would buy nothing.

### 5. Drag to Finder

**Finder will not take a promise of a file, only a file.** `webContents.startDrag` needs a path that
exists at the instant the gesture begins, and a `dragstart` handler cannot await a network copy — the
gesture is over long before the bytes are. So a row becomes draggable **after** it is copied, and a
drag of an uncopied row cancels itself and starts the copy. That ordering is the platform's, and the
detail card states it in one sentence rather than hiding it behind a spinner that cannot finish.

Measured in the running app, with the pane's own selector narrowed to `section[data-screen="files"]`
and its visibility asserted first — the app window carries the same attribute:

```
{"visible":true,"width":1140,"rows":29,"buttons":4}
rail: ["Received files…","ConnectSuite…","DCIM…"]
```

Before the copy: `Copy to Mac`, and *"Copy it to the Mac before dragging it to Finder — Finder needs
the file itself, not a promise of one."* After pressing it **by id** (`#files-copy-to-mac`):

```
button: "Copy again"
note:   "On this Mac at /Users/chetan/Downloads/ConnectSuite/nogrant-probe.bin."
note:   "…Its checksum matched the one agreed before the copy."
row:    is-local, draggable
```

**The round trip, three digests at every hop** — the file was sent to the phone earlier in this
sitting and pulled back:

```
original sent to the phone:   2c657a62a75c439ef0a55e44b09438b508a734fe784bdd47e765c4584ae97b1b
on the phone:                 2c657a62a75c439ef0a55e44b09438b508a734fe784bdd47e765c4584ae97b1b
pulled back to ~/Downloads:   2c657a62a75c439ef0a55e44b09438b508a734fe784bdd47e765c4584ae97b1b
```

Both drag branches ran. On a copied row, main's own line — written only after `startDrag` returns:

```
I [files] dragged nogrant-probe.bin to Finder — 1 started / 0 refused
```

On an uncopied row, the drag was cancelled (`defaultPrevented=true`), the copy ran, and the row
became `is-local`.

**What this does not prove, stated rather than implied.** The drag was dispatched as a synthetic
`dragstart` from CDP. That exercises renderer → preload → main → `startDrag` with a real path and the
file's own icon, and it proves `startDrag` accepted it. **It does not prove Finder completes the
drop**, which is a physical mouse gesture no automation here performs. The wiring is measured; the
gesture is not.

### 6. The Mac's almost-empty state was broken by this slice — and the first write-up of it overstated the damage

**Corrected 2026-09-01, in the sitting after.** The paragraph originally here said the `Download`
wall *"would have stopped drawing for everyone"*. **It would not have.** The wall has two
complementary homes and has had since the commit that shipped the pane:
`this.wallEl.hidden = showsState` — the state card carries the sentence when the card is drawn, and a
plain `#files-wall` line carries it when the card is not. Exactly one copy is on screen either way.
Measured in the running app with one tree granted: `stateCard: hidden`, `wallEl: VISIBLE`, carrying
the wall text.

So this was **not** a second vanishing of the wall. That matters, because "the wall disappeared
twice" is a claim about a specific sentence going missing from a user's screen, and it did not
happen. The overclaim came from reading one condition (`showsState`) and not the line twenty rows
below it that consumes the same boolean the other way round — the same shape as every other entry in
this record: a reading that was real, about something adjacent to the thing being claimed.

**What actually broke.** Both branches evaluated on a phone with two grant-free roots and no granted
tree:

```
zeroTreesPhone: { rootCount: 2, sharedTrees: 0 }
correct_showsState (kind === 'tree')  → true
buggy_showsState   (roots.length <= 1) → false
viewId: M2, headline: "This phone hasn’t shared a folder yet", body: 4 paragraphs
```

With `showsState` false the **M2 card is never drawn at all**. A user who had shared nothing would
have seen a rail with two roots, one bare wall sentence, and **no headline and none of the other
three paragraphs** — not the *"open ConnectSuite on the phone and go to Sync › Folders"* guidance,
not *"you can send files to this phone without sharing anything"*, not `ADDED_ON_THE_PHONE`. The
pane would have been silent about what to do, on the one screen where the user has done nothing yet.

The *"This phone has shared 2 folders"* headline was latent rather than visible: `filesPaneView`
computed it, and the card that would have shown it was hidden by the same bug.

### 6b. What catches it now — and the honest answer is: the wrong half

**Four tests went red on the mutation, and all four are on the pure view model.** `sharedFolderCount`
and `filesPaneView` are covered. **`showsState` — the condition in the renderer that decides whether
a user sees any of it — is reached by no test at all**, confirmed by scan: it appears in
`src/renderer/files.ts` and in no `*.test.ts`, and nothing loads `createFilesView`.

That is the same condition that broke **both** times. The slice-7 finding
(*"the card only renders with at most one root"*) and this one are one line, twice, and the fix each
time was to change the expression rather than to give it a home a test can reach.

So, stated plainly: **nothing catches the thing that broke.** The four tests catch a function that
was written correctly on the first attempt; they would stay green through a third variant of the
same mistake, because the mistake lives in the renderer's copy of the decision and the renderer is
the untested half.

The enforcement point that would close it is one extraction — `stateCardShown(fetch, roots)` moved
into `src/shared/filesRoots.ts` beside `sharedFolderCount`, with the renderer calling it and a test
asserting the two homes are complementary (`card XOR plain wall`, never both, never neither). That
is the `src/shared/` testable-seam rule applied to a decision that has now escaped it twice. **Not
built in this sitting** — it is on the list with the four findings below, for ordering.

That is `CLAUDE.md`'s third instrument row happening to us: *check a state in the situation the user
is in*. The situation changed underneath the check.

Fixed by counting `kind === 'tree'` through a named `sharedFolderCount`, in both the pure view and
the renderer's state-card condition. Shown to fail: reverting it to `roots.length` turns **4 tests
red**, including *a phone that has shared nothing is the almost-empty state, however many roots it
has*. The mutation was verified to have applied before the run — an earlier attempt in this sitting
silently edited nothing because the working directory had moved, and reported a pass.

The almost-empty state also gained the sentence this slice made true: **you can send files to a phone
that has shared nothing.** Before the grant-free root, that state could only say "go to the phone".

### Baseline

Phone **278** tests (`core` 77, `input-module` 44, `sync-module` **126**, `mirror-module` 31), up
from 257 — the 21 are all in `sync-module`: `FsArrivalTest` 9, `FolderQuickPicksTest` 7,
`DownloadsRootTest` 5. Mac **176**, up from 173. `tsc --noEmit` clean, and every module re-run with
`--rerun-tasks` so the result XML is this run's rather than an up-to-date task's.

The device is left as it was found: one persisted tree grant (`DCIM`), both media permissions granted
with their original flags, no accessibility change. `Download/ConnectSuite` holds the two small probe
files deliberately, so there is something to drag.

---

## Files pane — the measurement pass after first real use · 2026-09-01

**The first time anyone used this pane rather than looked at it**, and four complaints came back.
Measured rather than guessed, because three of the four had an obvious cause that turned out to be
wrong. Nothing here is fixed yet; this is the reading that decides the order.

### F-1 · Where the drag time actually goes — and it is not where it looked

| Leg | Measured | Notes |
|---|---|---|
| `dragstart` → handler returns, **uncopied** row | **1 ms** | The drag is cancelled and the copy starts. **Nothing appears.** |
| `fs.transfer.begin` + bulk pull, 215 KB photo | **156 ms** first, **104 ms** mean over 5 | ~100 ms of that is fixed cost, not bytes |
| same, 104 MB video | **1,458 ms** | 601 Mbit/s — the wire is not the problem |
| `dragstart` → `startDrag` returns, **copied** row | **5 ms** | renderer → IPC → main → native drag |
| `app.getFileIcon` | **0.3–0.8 ms** cold, 0 ms warm | measured in its own Electron process |

**The hypothesis going in was `getFileIcon`** — it is `await`ed before `startDrag`, which the
preload comment explicitly forbids. It costs **under a millisecond**. It is still wrong to await it
(a real gesture can end during an await), but it is not the delay and fixing it would change nothing
a user can feel.

**So the pause is the copy, and it is worse than the copy's duration**, because the first drag
returns in 1 ms having produced no drag image, no row change, and no cursor feedback. The only
signal is one line of text in the **detail card on the right**, which is not where a dragging hand is
looking — and which scrolls off screen (F-4). A 104 MB video is 1.5 s of a pane that looks like it
ignored the gesture, and a user who lets go and tries again pays it twice.

### F-1b · Is a promised-file drag available? **No — copy-first is forced**

From the installed Electron 43.4.1 typings rather than from memory:

```
interface Item { file: string; files?: string[]; icon: NativeImage | string; }
```

`startDrag` takes **paths that must already exist**. Searching the whole `electron.d.ts` for
`FilePromise|promisedFile|NSFilePromise|dragPromise` returns **nothing**. macOS has
`NSFilePromiseProvider` and Electron does not expose it; reaching it means a native module, which is
a different kind of project than this one.

**A tempting wrong fix, named now:** hand Finder the path of a `.part` that is still being written.
Finder copies bytes at drop time, so the user gets a truncated file that looks complete — **defect
56 exactly, on the Mac side**. Not to be attempted.

So the wait cannot be removed. It can only be made visible, or moved earlier (speculative copy on
selection).

### F-2 · Why a selected photo shows no thumbnail

The detail card draws a title, `Kind`/`Size`/`Modified`, the **Copy to Mac** button and one note.
No image, ever.

**The reason is structural: `fs.*` ids and `media.*` ids are disjoint id spaces.**

```
fs.list  id: "primary%3ADCIM%2FCamera%2FCshot"      ← a SAF document id
media.*  id: a MediaStore numeric _ID
```

Asked for a thumbnail of an `fs.*` id, `media.thumb` answers **`ok: true` with zero entries** — a
silent empty rather than a refusal, which is its own small defect: an absence with no reason
attached. So the pane cannot borrow the photo browser's thumbnails, and no amount of renderer work
changes that.

### F-3 · Multi-select — what each half costs

| Half | Cost | Kind |
|---|---|---|
| Selecting several rows | `selected: FsEntryRow \| null` → a `Set`, plus shift/cmd-click and a selection-aware detail card | **renderer only** |
| Dragging several files | **free** — `startDrag` already takes `files?: string[]` (verified in the typings; not yet exercised) | **renderer only**, but every file must be copied first |
| Copying several files | **~104 ms fixed cost per file**, measured: one control round trip and one TLS bulk connection each | **Mac's loop** |

`docs/phase-5-fs-media-proposal.md` settles the protocol half twice: *"One `transferId`, one file,
one bulk connection … a multi-file job is n of these driven by the Mac. A folder copy is the Mac's
loop, not a protocol feature."* And item 5 of its open list: *"Multi-file jobs as a protocol concept
… if that turns out to be too chatty over a real link, a job wrapper is an addition, not a
rewrite."*

**The measurement says the loop is fine at the sizes a person selects and not fine at the sizes a
folder contains**: 20 files ≈ 2 s of pure overhead before any bytes, 100 files ≈ 10 s. So multi-select
by hand needs **no protocol change**; a folder copy eventually does.

### F-4 · "Not smooth" — four measured causes, and the first two are not smoothness at all

**(a) Opening a large folder fails, every first time.** The phone builds a per-directory snapshot
(defect 55's fix) and `DCIM/Camera` has 16,377 entries:

```
[fs] snapshot of primary:DCIM/Camera: 16377 entries read in 10371ms
```

The Mac's `fs.list` timeout is **10,000 ms**. The pane shows **"Couldn't open this folder — fs.list
timed out after 10000ms — Try again"** for a folder that is perfectly readable. Reproduced after
waiting past the 30 s idle TTL; the second attempt failed too, and each failed attempt caused
**another full rebuild** (11,352 ms, then 10,082 ms) because concurrent requests do not join the run
in flight — the same *"who else calls this, and what happens if they both do"* the Mac's `refresh()`
already learned. Once a snapshot lands, pages take **236–364 ms**.

This is the pane's failure card shown for a non-failure, which is the one thing this pane exists to
get right.

**(b) The pane can never load past its first page.** The scroll handler is bound to `#files-table`
and its first guard is `if (this.table.scrollHeight <= this.table.clientHeight) return`. Measured:

```
.files-table   overflow-y: auto   scrollH 7286   clientH 7286   scrollable: false
.page.cs-scroll                   scrollH 7592   clientH  667   scrollable: TRUE
```

`.files-table` has `overflow-y: auto` and **nothing constrains its height**, so it grows to its full
content and never scrolls; the real scroller is `.page`, seven ancestors up. Scrolling that to the
bottom twice and waiting 5 s loaded **0 additional rows**; the footer still read *"200 loaded · more
on the phone"*. **A folder of 16,377 entries shows 200 of them, permanently.**

This is the Photos-grid bug's sibling — the comment in that very handler warns about the *third*
condition, and it is the *first* one that is permanently true here.

**(c) Nothing stays put while scrolling.** Scrolling `.page` from 0 to 3000:

| Element | top at 0 | top at 3000 |
|---|---|---|
| column header (`position: sticky`) | 302 | **−2698** — does not stick |
| roots rail | 282 | −2718 — gone |
| detail card, with **Copy to Mac** | 247 | −2753 — gone |

The whole pane is one 7,592 px page in a 667 px viewport. Scrolling to a file loses the header, the
folder list and the only button that acts on the selection.

**(d) Render cost is fine today and is a cliff behind (b).** A row click rebuilds every row:
**11.2 ms at 201 rows** — imperceptible. That is ~56 µs/row, so the same code at 16,377 rows
extrapolates to **~0.9 s per click**. Stated as an extrapolation, not a reading: it is unreachable
while (b) caps the table at 200, and fixing (b) without touching this makes it reachable.

### What each fix costs, for ordering

| # | Fix | Kind | Protocol change? |
|---|---|---|---|
| b | Give `.files-table` a bounded height so it is the scroller | **CSS, one rule** | no |
| c | Same rule fixes the sticky header, the rail and the detail card | **CSS, same rule** | no |
| a | Raise the `fs.list` timeout, and join a snapshot build already in flight | Mac constant + phone concurrency | no |
| 1 | Make the wait visible at the row, and copy on selection rather than on drag | renderer | no |
| 3 | Multi-select and multi-file drag | renderer | no |
| d | Reconcile rows instead of rebuilding, or virtualise | renderer | no, and only after (b) |
| 2 | Thumbnails in the detail card | **`fs.thumb`, a thirteenth message name** | **yes** |

Only **F-2 needs the protocol**. Everything else is one CSS rule, one constant, one concurrency

### `showsState` moved to `src/shared/` — the condition that was wrong twice (2026-09-01)

It is now `downloadWallHome({ ready, sharedFolders })` returning `'state-card' | 'rail-line'`, plus
`wallHomeVisibility(home)` returning the pair of flags the renderer assigns. **One value in, two
flags out** — where before, `stateEl.hidden` and `wallEl.hidden` were two expressions consuming one
renderer-local boolean in opposite directions, which is how a fix to one of them left the other
drawing nothing.

Six tests, three of them shown red against a real failure mode:

| Mutation | Red |
|---|---|
| drop the `sharedFolders === 0` branch (the slice 9 break) | *the wall is in the state card before anything is shared*, and the control |
| `stateCard: true` unconditionally | *complementary homes — exactly one home is ever on screen* |
| put the second `wallEl.hidden = true` back | *the renderer sets each home once* |

**The source guard found a real second assignment on its first run**, which is the part worth
keeping. `this.wallEl.hidden` was set twice: once from the decision, and once as `true` on
`renderRail`'s not-ready early return. That second one was **redundant** — `downloadWallHome` already
answers `state-card` when the pane is not ready, so `railLine` is already false — and a redundant
second assignment to one of two complementary flags is exactly the shape that drifted twice. The
wall is now set once, before any early return.

On hardware, with folders shared:

```
homesOnScreen: ["rail-line"]   count: 1   wallShown: true   stateShown: false
```

Read after asserting `section[data-screen="files"]` is visible, and counting **homes carrying the
sentence** rather than searching the pane's text for the word — the degraded banner's own copy
contains the vocabulary of the thing it says is absent, which is how a text match confirmed an
upload affordance that does not exist.


### F-2 fixed · `fs.thumb`, the thirteenth message name (2026-09-01)

The one Files item that needed the protocol, and it needed it for a reason no renderer work could
touch: **`fs.*` and `media.*` are disjoint id spaces.** Asked for a thumbnail of a SAF document id,
`media.thumb` answers `ok: true` with zero entries — a silent empty — so a selected photo drew
`Kind`/`Size`/`Modified` and no image, ever.

Contract first, then both sides, as the rules require: `docs/protocol.md` gained an `fs.thumb`
section and the message-type list, then `Messages.kt` and `protocol.ts`, then the phone, then the Mac.

**On hardware**, read through `scripts/probe.mjs` so every number carries a control:

```
phone  fs.thumb saf:primary%3ADCIM → 1 made / 0 without one / 0 gone, maxEdge=256, 31–38 ms
Mac    fs.thumb saf:primary%3ADCIM → 15 made / 2 without one / 0 gone / 0 from cache
pane   {"natural":"192x256","drawn":"151x200","isData":true,"bytes":16823}
```

- **192×256 natural** for a portrait photo at `maxEdge: 256` — the long edge lands on the cap and the
  short one follows the aspect ratio.
- **Drawn 151×200**, bounded by the card, never larger than it was made. The Photos pane once drew a
  thumbnail at two and a half times its real size; `max-width`/`max-height` with `width: auto` is that
  rule as CSS.
- **16,823 bytes of base64** ≈ 12.6 KB of JPEG, inside the 10–25 KB the payload spec predicted, which
  is what makes 32 per batch ≈ 1 MB safe on the control channel.
- **31–38 ms per thumbnail on the phone**, because `SafTreeStore` asks the provider for its own
  cached thumbnail before falling back to decoding.

**A file with no thumbnail draws no empty frame** — `0` image elements for a `.temp-….mp4` of 0 B.
`NO_THUMBNAIL` is a normal answer and not a failure: most files are not images, and a pane that
greyed itself out over a folder of documents would be reporting the ordinary case as a fault. It is
kept distinct from `NOT_FOUND` because those want two different sentences.

**The cache, checked because `0 from cache` beside `15 made` is a number with no denominator.** There
are two caches — the renderer's, which `render()` reads synchronously because it cannot await, and
the main process's, which survives folder navigation — and the concern was that the renderer's
`thumbAsked` guard makes the second unreachable. Asked directly for the same id twice:

```
{"firstOk":true,"secondOk":true,"firstMs":0,"secondMs":0,"sameBytes":true}
Mac: 29 made / 3 without one / 0 gone / 2 from cache
```

`2 from cache`, identical bytes. The earlier zero meant no repeat had happened yet, not a dead cache.

#### The arithmetic is tested; the decode is not, and that is stated rather than implied

`FsThumbs.sampleSize`, `scaledSize` and `edgeOf` are pure and have 11 tests. `BitmapFactory` and
`Bitmap` are Android statics, so `fromStream` and `encode` cannot run on the JVM — and the answer to
that here is never `returnDefaultValues = true`, which makes every Android call silently return null
and every test vacuously green. Nothing in the unit suite proves a JPEG comes out; the hardware run
above is that evidence.

**One mutation failed to fail, and the response was not a new test for the old code.** Flipping
`sampleSize`'s `&&` to `||` broke nothing, because both forms produce the *same thumbnail* — they
differ only in how much bitmap is decoded. Asking what the condition was actually for gave a third
answer neither said: bound by the **longest** edge, which is what `scaledSize` bounds by. The old
form never sampled an 8000×400 panorama at all — 12.8 MB of bitmap decoded to produce 256×13 — and
the new one samples it to 500×25. The panorama test fails against the old formulation, which is what
makes it a test rather than a restatement.

#### A documentation gap found on the way, and corrected

`CLAUDE.md` claimed the `fs.*`/`media.*` contract "has moved to `docs/protocol.md` (Files, Photos)".
**True for Files, false for Photos.** `media.buckets`, `media.list`, `media.thumb` and
`media.original` are named in the message-type list at line 74 and specified nowhere in the contract;
`docs/phase-5-fs-media-proposal.md` §5 is still their only spec. Found by writing `fs.thumb`
deliberately in the shape of a `media.thumb` the contract does not describe. The claim is corrected;
migrating the Photos payloads is owed by whoever next touches `media.*`.


### `scripts/probe.mjs` — the DOM-as-instrument rule stops being a rule (2026-09-01)

Three sittings, three faults, all of them the instrument rather than the product, and all of them
caught by someone re-reading rather than by anything in the build:

| Fault | What was wrong |
|---|---|
| a 2.5 s wait against a 16 s page | the **wait** was shorter than the operation |
| an exact match on a nav labelled `"Notifications27"` | the **selector** matched nothing |
| a photo grid measured while its section was `hidden` | the **target** was not there to be read |

Not three kinds of carelessness. Three ways of **reading zero and reporting it as a fact**, each
producing a plausible number with no way to separate *the thing is false* from *I could not see it*.
`CLAUDE.md` already carried the rule, with worked examples, and it kept being broken by whoever had
most recently written it — because taking a control is a separate voluntary act from taking a
reading, and nobody feels the need for one while reading a number that looks right.

**So the control is now an argument, not a habit.**

- `control` is required and has no default. It must come back truthy; if it does not, the read never
  runs and `ProbeControlFailure` is thrown instead of a value.
- There is no way to express a fixed sleep. `settle: { until, within }` polls to a predicate with a
  deadline, and a run that hits it returns `stopped: 'deadline'` with `reportable: false`.
- No result is a scalar: every one carries `{ value, control, polls, waitedMs, stopped, reportable,
  source }`, so reviewing a probe's output is mechanical.
- The read resolves its element through `__probe.one(sel)`, which throws `PROBE_NO_MATCH`,
  `PROBE_AMBIGUOUS` or `PROBE_NOT_VISIBLE` rather than returning the first of two matches or a
  hidden node's zero.
- A `text:` matcher is refused outright for presence questions; `presence({ controls })` counts
  elements. The copy explaining an absence contains the words for the thing that is absent.
- `act({ what, run, expect })` requires `expect` — a stimulus reported without its effect is a
  request, and an absence read before the action happened is no reading at all.

**Run against the three faults that produced it**, on the live app, each paired with its corrected
form so that a probe which merely refuses everything would be visible:

```
FAULT 1  2.5 s deadline  → 0    [polls=8  waited=2504ms  stopped=deadline]  NOT REPORTABLE
         45 s deadline   → 200  [polls=13 waited=12041ms stopped=settled]
FAULT 2  exact match     → CONTROL FAILED: the control returned 0. The reading was not taken.
         prefix          → 1    [control=1 stopped=immediate]
FAULT 3  hidden section  → PROBE_NOT_VISIBLE: section[data-screen="photos"] (hidden=true, height=0)
         bare attribute  → PROBE_AMBIGUOUS: 2 nodes match [data-screen="files"]
         narrowed        → "SECTION"
```

The last pair also settles a claim `CLAUDE.md` had been asserting from memory: `[data-screen="files"]`
really does match **2 nodes** in this build, so the app window does carry the same attribute as the
route marker.

#### The enforcement point

`scripts/probe.test.mjs`, 18 tests. Three fixtures — a failing control must throw, a deadline must be
unreportable, an ambiguous or hidden or absent selector must error — each with a control proving the
opposite case still passes. Plus the scan: **nothing under `scripts/` may call `Runtime.evaluate`
except `probe.mjs`.**

Shown failing before it passed, twice over. It named the real pre-existing violation on its first
run, and then a planted one alongside it:

```
these call Runtime.evaluate directly instead of going through probe.mjs:
  step70-watch.mjs                              ← real, found by the scan
  _planted-violation.mjs, step70-watch.mjs      ← after planting one
```

The matcher is `/method\s*:\s*['"]Runtime\.evaluate['"]/` — the method name in the position a CDP
call puts it — with a fixture proving it does **not** fire on prose about the rule. `no-force-stop.sh`
shipped a matcher that denied every command mentioning the rule, including the doc carrying its own
argument, and a matcher without fixtures is a rule you are guessing about.

`step70-watch.mjs` is converted, **transport only**. Its reading loop and its gate are untouched:
that script hangs up a real call, its predicate lives in `step70-gate.mjs` with its own fixtures so
it can be read without a phone ringing, and adopting a new helper is not a reason to rewrite a
safety-critical loop. It uses `rawEvaluate`, which is named so it can be grepped — the scan's point
is one transport, not one caller.

#### What was converted, with the denominator

| | |
|---|---|
| ad-hoc CDP probes written this sitting | **17** (16 in `/tmp`, one in the scratchpad; two more `/tmp` files have ambiguous provenance and are excluded rather than counted) |
| of those, produced a number written into this file | **15** |
| now have a standing instrument in `scripts/files-pane-probe.mjs` | **12** |
| in-repo scripts calling `Runtime.evaluate`, converted | **1 of 1** |

The three not converted, named rather than quietly dropped: the 68 px page-head measurement (a
one-off diagnosis of a bug that is now fixed — its current-state equivalent is the *page does not
scroll* check), the `0 B` size verification (a fact about two files on this phone, not a product
claim), and the scroll-event confirmation (superseded by the paging check, which proves the handler
fires by its effect rather than by counting events).

Everything else stays ad-hoc on purpose. The scope is **reads that feed a claim in this file**; poking
at a running app to see what is there does not need a control, and requiring one would make the
mechanism something people route around.

#### It caught its own author twice while being written

Neither was a product bug, and both are the reason it exists:

- The `layout` section reported `386/386 scrollable: false` and **FAIL** on a pane that was working
  perfectly. The app was sitting on a 28-row folder, where there is nothing to scroll — a reading
  that looks exactly like the bug F-4b describes. The probe had not established its own precondition.
  It now opens a large folder first and checks the row count before believing anything else.
- The `wall` section reported **zero** homes carrying the `Download` wall, which reads as *the wall
  vanished*. It had not: `#files-wall` was `hidden: false, height: 60` moments later. Routing to
  Files re-triggers `refresh()`, and while `fetch.kind === 'loading'` the pane is in neither steady
  home. The invariant is *eventually exactly one, and then stably*, and it is now asserted with a
  deadline — which is the sampling fault one layer up: not a window missed, but a window caught
  mid-swing.

Full run, after both fixes: **12 checks, 0 failures, 10 readings, 0 not reportable.**


### F-3 fixed · Multi-select and multi-file drag, with the 104 ms ceiling applied (2026-09-01)

Measured on hardware in `DCIM/Camera`, 200 rows loaded of 16,377:

| Gesture | Result |
|---|---|
| click row 0, ⇧-click row 2 | **3 rows selected**; card reads *"2 files selected"* |
| ⌘-click row 6 | **4 rows selected** |
| click row 0, ⇧-click row 39 | **40 rows selected**, `is-copying: 0` |

The card on that last one:

> 39 files selected · 403 MB — that is at least 4.1s of setup before any bytes move, so nothing is
> copied until you drag them or press Copy to Mac. · 3 of 39 on this Mac. · **Copy 36 to this Mac**

**The ceiling is applied, not only recorded.** A pull costs ~104 ms of fixed overhead — one control
round trip and one TLS bulk connection each, before any bytes — so speculative copying is capped at
**8 files** (~830 ms, inside the time it takes to move a hand to Finder). Above the cap nothing is
spent and the card quotes what it would cost. 40 files selected started **zero** copies, which is the
row that says the cap is load-bearing rather than decorative. The constant and the sentence read the
same `PULL_OVERHEAD_MS`, so the guard and the explanation cannot drift apart.

`startDrag`'s `files?: string[]` is now exercised rather than only verified in the typings. Every
path is checked to exist **before any of them is dragged**: a partial multi-file drag would hand
Finder some of a selection with nothing saying which, which is defect 56's shape on the Mac side.

**Two readings that were checked rather than assumed**, both of which looked like defects:

- *"3 rows selected but 2 files selected"* — row 0 is `Cshot`, a **directory**, correctly excluded
  from the file set. Not an off-by-one.
- *"2 files selected · 0 KB"* — rows 1 and 2 are `.temp-20250807_…` and `.temp-20250821_…`, and the
  size column independently reads **`0 B`** for both. They are genuinely zero-byte files. The reading
  was right and the *wording* was wrong: the summary said `0 KB` where the column says `0 B`, and the
  unit is now shared.

**What this run could not test, and why it is stated rather than omitted.** The first attempt ran in
`Received files`, which holds **2 files** — not enough rows for a ⇧-range or a ⌘-add. The probe
reported `only 2 rows` rather than a selection count, which is the instrument naming its own limit
instead of returning a number shaped by it. The run above was re-done in a directory with 16,377
entries. A native Finder **drop** of several files still cannot be driven from CDP; what is measured
is the selection, the cap, and the paths handed to `fsDrag`.


### F-1 · The first drag is a drag — copy starts on selection (2026-09-01)

On hardware, the grant-free `Received files` root:

```
t+400 ms    is-copying: true    detail "Copying…"
t+1500 ms   is-copying: false   is-local: true    detail "On this Mac at /Users/chetan…"
```

The copy starts from **selection alone** — no drag was dispatched in that run. A 2.9 MB file is
draggable about 1.5 s after the click, and the window the fix uses is simply the time between
selecting a row and getting the mouse to Finder.

`startDrag` still needs a path that exists when `dragstart` fires, and that handler still cannot
await a network copy — the platform ordering is unchanged and the refusal branch stays, because a
copy may still be in flight and a wrong answer to Finder is worse than an honest one. What changed
is that the refusal is now the uncommon path instead of the guaranteed first experience of the
feature.

**Debounced at 250 ms**, re-tested at the moment of acting rather than when the timer was set. Without
the debounce, arrow-keying through the 600-row `DCIM/Camera` listing would pull 600 files; with it,
the copy starts for the row you stopped on. The predicate moved to `shouldPrefetchForDrag` in
`src/shared/filesRoots.ts` for the reason `showsState` earns a mention in `CLAUDE.md` — that condition
broke twice in the renderer where no test reached it, and on the second break four tests went red and
none of them touched the line that failed. Five tests now call it; shown red by deleting
`if (input.isDir) return false`, which fails *a directory is never prefetched* and nothing else.

**What this run did not test.** A native Finder drop cannot be driven from CDP, so nothing here
exercised `webContents.startDrag` end to end. What is measured is the precondition the drag depends
on — `localCopies` holding a real path, and the row carrying `is-local` — reached 1.5 s after
selection without a drag. The drop itself is still a by-hand step.


### F-4a fixed — the timeout was the symptom, the stampede was the cause (2026-09-01)

On hardware, SM-S938B, against `DCIM/Camera` — the folder that failed **every first time**.

```
[fs] snapshot of primary:DCIM/Camera …: 16377 entries read in 16981ms; 0 hits / 8 misses / 0 joined
[fs] fs.list …/Camera → 200 of 16377 entries, hasMore=true, cursor=FIRST_PAGE
Mac  fs.list saf:primary%3ADCIM/Camera → 200 entries, hasMore=true, 17288 ms
```

**16,981 ms.** The old timeout was 10,000 ms, so this folder could not open, ever, and the pane drew
its failure card for a directory that reads perfectly well. It now opens: the pane settled after
18.0 s with 200 rows and **no state card** (`state: ""`).

Two changes, and the order of blame matters. `FS_LIST_TIMEOUT_MS = 45_000` is `fs.list`'s alone —
every other Phase 4 request keeps 10 s, because they are queries against a store the phone already
has and `fs.list` is the one that makes it *read a directory*. But raising a timeout on its own
would have made the real fault worse: a miss went straight to the read with nothing serialising it,
so each failed attempt started **another full rebuild** (10,371 / 11,352 / 10,082 ms measured), and a
longer window is more time in which to start more of them. `SingleFlight` is the fix; the constant
is what stops a single honest build being called a failure.

**`joined: 0` on this run, and that is the number to publish.** Only one caller went for the
directory, so the join never fired and this run is *not* evidence that it works — the timeout carried
it alone. The evidence for the join is `SingleFlightTest`, shown red at `expected:<1> but was:<8>`
and `expected:<7> but was:<0>` with `run` reduced to `cached() ?: build()`, green restored.

### F-4b confirmed on the folder it was about — 200 → 400 → 600

The CSS bound made the table the scroller; this is that fix meeting the 16,377-entry directory F-4b
said would show 200 rows permanently:

```
rows 600   footer "600 loaded · more on the phone"   crumbs DCIM›Camera
phone: cursor=FIRST_PAGE, then cursor=EXACT, then cursor=EXACT
```

Three pages, the phone matching the cursor exactly on each, no repeats.

**An instrument note, and it is the sampling window again at a different scale.** The first attempt
scrolled to the bottom five times, waited 2.5 s after each, read 200 rows every time, and was one
sentence from *"paging still does not work"*. A page takes **16 s** here, so every sample was taken
before the page could possibly have arrived: five readings that did not exist yet. The scroll probe
that settled it reported `scrollEventsSeen: 1, nearBottom: true` — the stimulus had landed and the
handler had run — which separated "the handler never fires" from "I looked too early", and only the
second was true. *Could I have seen it* rather than *did I see it*, for the third time in this file.

**Also observed, not a defect.** Pages 2 and 3 each cost ~16 s because the snapshot'''s 30 s sliding
idle TTL expired between my scrolls (47 s and 65 s apart). A user scrolling continuously stays inside
the TTL and gets the 236–364 ms pages defect 55 measured. Worth knowing that a pause longer than 30 s
costs a full rebuild; not worth a defect, because the TTL is the bound on how stale the view may be
and shortening the wait means lengthening the lie.


### F-4b and F-4c fixed — the pane owns its own scrolling (2026-09-01)

One missing bound caused both, and both are fixed by making the chain height-bounded rather than by
touching either symptom. Measured through CDP on the running app, `section[data-screen="files"]`
selected explicitly and asserted visible first — the bare attribute selector also matches the app
window and comes first in document order.

| | before | after |
|---|---|---|
| `.files-table` | `scrollH 7286  clientH 7286` — **scrollable: false** | `scrollH 1051  clientH 362` — **scrollable: true** |
| `.page` | the real scroller, `scrollH 7592  clientH 667` | `scrollH 667  clientH 667` — **scrollable: false** |

The first row is F-4b: the scroll handler's first guard is `scrollHeight <= clientHeight`, which was
permanently true, so a folder of 16,377 entries showed 200 and never paged again. It is now false,
so the guard admits.

F-4c is the same rule, proved by scrolling rather than by inspecting CSS. With `#files-table`
scrolled to 600:

| element | top at 0 | top at 600 |
|---|---|---|
| roots rail | 248 | **248** |
| detail card (**Copy to Mac**) | 247 | **247** |
| crumbs | 260 | **260** |

Nothing moves. The earlier reading was `302 → −2698` for the header, against a page scrolled to 3000.

**Two rules, not one.** `.files-table` was already `flex: 1; min-height: 0; overflow-y: auto` and had
been all along — the bound was missing *above* it. `height: 100%` on the screen was the first
attempt and was wrong in a way only measurement showed: the page head is a **sibling inside `.page`**,
so 100% overshot it by exactly its 68 px and left the page scrolling by 84. The fix is `.page` as a
flex column (shell.css — the frame) and the Files screen taking `flex: 1` (styles.css — inside a
screen). Every other screen stays `flex: 0 0 auto`, which is the block behaviour it already had.

**Control that the change is confined to Files**: all eleven screens routed to and measured non-zero
afterwards — overview 483, mirror 831, photos 170, messages 496, notifications 608, clipboard 420,
calls 362, camera 420, activity 420, settings 388. `mirror` at 831 in a 667 viewport still scrolls
`.page`, which is the behaviour it had before and was not in scope.

*An instrument note, since the first run of that control read `notifications=hidden` and was one
sentence from "the pane broke": the nav control's text is `"Notifications27"` — the unread badge
sits inside the button — so an exact-match on the label found nothing and the pane was never routed
to. The absence was my selector, not the pane. Matched on prefix, it renders at 608.*

join, and renderer work.

## Slice 10 — the Photos contract, the specification guard, and the clipboard instrument · 2026-09-01

**No hardware reading was taken in this sitting and none is claimed.** The phone was not attached.
Everything below is source, docs, unit tests and one mutation run — and the clipboard instrument that
was built here has **never been run**, which is stated in its own class comment as well as here so
nobody reads its existence as evidence.

### 1. `media.*` moved into the contract, and the reason it had not

`docs/protocol.md` gained a **Photos** section: `media.buckets`, `media.list`, `media.thumb`,
`media.original`, their caps, their cursor, their error table. Until today those four were named in
the document's message-type inventory and specified **nowhere in it**, for the whole of Phase 5.

Three things the migration recorded that the proposal it came from did not say, all found by reading
`MediaFeature`/`MediaStoreReader` against the prose rather than by trusting it:

| Found | Where it matters |
|---|---|
| **`bucketId` is optional on `media.list`**, and omitting it merges every bucket under one ordering | It is what the Mac's *All photos* view is built on. A contract without it describes a client that could not exist |
| **The `media.original` ack carries `chunkMax`** | The bulk channel's chunk size is negotiated, not a constant two implementations agree about silently — the same correction `fs.transfer.begin` already carries |
| **`media.thumb`'s `NOT_FOUND` covers two different facts** | Defect **57**, below |

### 2. Defect 57 — one code for two facts

`MediaStoreReader.thumbs` answers `NOT_FOUND` when `loadThumbnail` returns null, which happens for a
row that is **gone** and for a row that is **there and cannot be decoded**. The Mac is told a
photograph was deleted on the strength of a decoder failing. `fs.thumb`, specified two days later,
separates `NO_THUMBNAIL` from `NOT_FOUND` precisely because the two want different sentences — so the
older namespace is the less honest one, which is the wrong way round.

Found by reading the handler against the spec while writing the spec. **Not** found by a failure:
nothing on this device has ever produced an undecodable row, which is also why it is deferred rather
than fixed here — see the control it needs in §6.

### 3. The guard: `scripts/check-protocol-spec.mjs`

The note this migration discharged said it was *owed by whoever next touches `media.*`*, which is a
rule enforced by someone remembering. `CLAUDE.md` is explicit about what that is worth, so the rule
is a hook now — `scripts/hooks/protocol-spec-in-sync.sh`, `PreToolUse` on `git commit`, failing open
on its own errors exactly as `defects-in-sync.sh` does.

**The discriminator is the whole design.** The obvious check — does the type name appear in the
document — **passes on a passing mention**, and two of the four missing types did appear:
`media.thumb` is named five times in the `fs.thumb` section, in sentences about something else. A
checker counting those would have reported the namespace documented on the day it was not. So a type
counts as specified only where it is the **subject** of a heading or of a paragraph.

**The control, and it is the reading that matters here.** Run against `docs/protocol.md` as it stood
before this sitting, with the same `Messages.kt`:

```
media.buckets   is on the wire and is not the subject of any heading or paragraph
media.list      is on the wire and is not the subject of any heading or paragraph
media.thumb     is on the wire and is not the subject of any heading or paragraph   ← mentioned 5×
media.original  is on the wire and is not the subject of any heading or paragraph   ← mentioned 4×
mirror.stop     is on the wire and is not the subject of any heading or paragraph
mirror.keyframe is on the wire and is not the subject of any heading or paragraph
```

Against the tree as it now stands: **0 unaccounted for, 54 of 62 specified, 8 on the debt list.**
That control is a test (`scripts/check-protocol-spec.test.mjs`), not a one-off command, so it fails
if the checker is ever loosened enough to stop seeing the defect it was built for.

**It found two gaps nobody was looking for.** `mirror.stop` and `mirror.keyframe` are implemented,
shipped since Phase 2, and were described nowhere. Both are specified now, including the thing that
mattered enough to write down: **`mirror.keyframe`'s ack says the request reached the encoder, not
that a keyframe was produced** — a registration line, not an execution line.

**The debt list is printed on every run, with a reason per entry**, so a deliberately-unspecified
type stays visible instead of becoming invisible: `clip.push`, `clip.request`, `clip.history` (§2's
reading is not taken), `apps.list`, `apps.launch`, `apps.icon` (Phase 7, no handler either side),
`battery.state`, `net.state` (unscheduled, no handler, no capability). An entry that turns out to be
specified after all **fails** the check rather than passing quietly — an allowlist nobody prunes is
how a guard stops guarding.

**Fixtures: 14, all passing, each with its opposite.** A paragraph subject passes and a five-times
mention fails; a heading passes and a wrapped continuation line fails; a debt entry passes and a
*stale* debt entry fails; a `SPECIFIED_UNDER` heading passes and the same entry fails once the
heading is renamed; an empty parse is an `INSTRUMENT FAILURE` rather than a clean zero-findings pass.

**The hook was shown to deny.** `### \`media.thumb\`` was renamed to a heading that does not name the
type, the hook ran, and it emitted `permissionDecision: "deny"` naming exactly that type; the file
was then restored and confirmed **byte-identical by SHA-256** to the pre-mutation copy.

### 4. The clipboard instrument — built, and deliberately not run

`app/src/debug/java/com/chetan/connectsuite/probe/ClipProbeActivity.kt`. Five readings, each with
the lookalike it exists to exclude, documented in `docs/phase-5-clipboard-proposal.md` §2. What is
worth repeating here is the design decision that is not obvious:

**With reads blocked, *nobody copied anything* and *every read was refused* produce identical
silence.** That is the `KEYCODE_BACK` row of `CLAUDE.md`'s table — an absent line that was a reading
which did not exist yet. So the probe does not conclude from its own window: `--es mode verify` takes
a **foreground** read afterwards, and reports `stopped=no-stimulus` — *no reading at all* — when the
clipboard still holds the probe's own marker.

It reports its sample interval, its window, `stopped=`, and **the process importance at every
sample**, because `moveTaskToBack` is a request to background and importance is the measurement of
whether it happened. It logs **no clipboard text at any level**, ever: length, MIME, label,
`EXTRA_IS_SENSITIVE`, and whether the clip is still its own marker.

**The pre-registered decision table is in the proposal, written before the reading.** Whatever comes
back, the product shape is already decided; a reading landing outside that table needs a new
argument rather than a quiet reinterpretation.

### 5. Two instrument faults caught in this sitting, both mine, both about the harness

Neither cost a wrong claim, and both are the same family as the stale-XML row in `CLAUDE.md`:

1. **`${PIPESTATUS[0]}` is empty in zsh** — the exit line printed `gradle exit:` with nothing after
   it, twice, while the build's own output said `BUILD SUCCESSFUL`. A verdict with a blank exit code
   is a verdict with no provenance; `${pipestatus[1]}` is the zsh spelling and every Gradle line
   below carries it.
2. **`:app:compileDebugKotlin` reported `UP-TO-DATE` on a run that had a brand-new source file in
   it.** `BUILD SUCCESSFUL` there proves nothing about the new file; it proves the task did not run.
   Re-run with `--rerun-tasks`, `78 executed`, and the class file exists with a fresh timestamp. This
   is `docs/RESUME.md`'s own warning about result XML, in the compile task rather than the test task.

### 6. What this sitting owes the next hardware session

| Owed | The control that makes it a reading |
|---|---|
| Clipboard readings 1–5 | Reading 1 is the precondition and the run stops without it; reading 4 (accessibility service **off**) is what says reading 3 was about the grant; `verify` is what separates a refusal from an absent stimulus |
| Defect 57's branch | Manufacture an undecodable row — truncate a file's bytes under its `MediaStore` entry — and confirm `media.thumb` says `NOT_FOUND` for a row `media.list` still returns. Without that, the fix would be written against a state nobody has produced |
| Nothing else | Files, Photos and the transfer path are proven on hardware and unchanged by this sitting |

### Suite

Phone **294** tests (`core` 77, `sync-module` 142, `input-module` 44, `mirror-module` 31), **0
failures** — `gradle exit: 0`, `--rerun-tasks`, every result XML written seconds before it was read.
Mac **192** tests, 0 failures, `tsc --noEmit` clean. Plus **14** guard fixtures under `scripts/`,
run with `node --test scripts/check-protocol-spec.test.mjs`, which is where `probe.test.mjs` lives
too and is not part of either suite.

No new unit test was added to either suite in this sitting, which is the honest shape of a docs and
guards pass: the new checks are the 14 fixtures, and the code that changed is one debug-only probe
that no test can reach without a clipboard.

## Slice 11 — the clipboard wall, measured · 2026-09-01

**The documented exception does not operate on this handset.** `CLAUDE.md` has carried one sentence
since Phase 1 — *background clipboard reads are blocked since Android 10 unless the app has an
enabled AccessibilityService or is the default IME* — and the whole clipboard feature was specified
on top of it. It is now measured, and the half that mattered is false here: **this app has an enabled
and bound AccessibilityService and is refused anyway.**

Device SM-S938B, Android 16 / SDK 36, `targetSdk 36`, default IME **Samsung HoneyBoard** (not ours,
so the IME exception is out of play throughout). Instrument: `ClipProbeActivity`. Five readings and
the listener question, in one sitting, 18:14–18:28.

### 0. The instrument was wrong first, and the platform said why

The first run reported `stopped=control-failed` — the focused control read returned null:

```
18:14:52.834 CONTROL foreground read of our own clip: returned=false items=0 matchedOurMarker=false
18:14:52.834 E/ClipboardService: Denying clipboard access to com.chetan.connectsuite.debug,
                                 application is not in focus nor is it a system service for user 0
```

The read ran **inside `onCreate`, 7 ms after `am start`** — the activity existed and had not been
focused, and focus is the platform's own criterion. That null was the instrument measuring itself,
and it is the same fault as measuring a hidden DOM element: *what you measured it on* was never
checked. The probe now takes every reading from `onWindowFocusChanged(true)` and carries `focused=`
beside `importance=` on **every** read line, so a future null can be attributed rather than assumed.

**The probe stopping was the design working.** It refused to sample, refused to conclude, and named
which of the two it was. And the run was not wasted: the `setPrimaryClip` in it **landed** (Samsung's
copy toast fired at 18:14:52.836), which was reading 5's first data point before reading 5 was run.

### 1. Reading 1 — a focused read works. The precondition holds

```
18:16:50.655 window focus = true (importance=100)
18:16:50.659 CONTROL foreground read of our own clip: focused=true importance=100 returned=true
             items=1 matchedOurMarker=true length=22 label='ConnectSuite probe' isSensitive=false
18:16:50.661 LISTENER fired #1 importance=100 (foreground) focused=true readAfterCallback=true
```

Both known positives in three milliseconds: the read path works, and the listener is wired up —
which is what makes its later silence evidence rather than an absence of instrumentation.

### 2. Reading 2 — backgrounded, **our own clip**: refused

349 samples over 180 s, 348 of them at `focused=false`, **0 readable**. The clip was ours, written by
us, 22 characters, and we could not read it back. *The owner may read its own clip* — the lookalike
this reading exists to exclude — is **false here**, so it cannot explain anything in reading 3.

### 3. The stimulus, placed in time by the platform rather than by anyone's word

The operator copied in another app during the window. The proof is not their report:

```
18:19:45.497 SemClipboardToastController: ClipLabel is not empty ... com.openai.chatgpt
18:19:51.137 stopped=window — 349 samples over 180s
```

**The copy landed 5.6 s before the window closed**, with 12 samples after it: 0 readable, and **0
listener callbacks**. That is the answer to §7's open question, taken against a stimulus whose timing
is independently witnessed.

`verify`, from the foreground, 48 s later:

```
18:20:39.893 VERIFY foreground read: focused=true importance=100 returned=true stillOurMarker=false
             length=57 label='plain text'
             READING: background reads were REFUSED
```

### 4. Reading 3 — backgrounded, **foreign clip**, with no stimulus timing in it at all

The `foreign` run has a hole and it was found before it was leaned on: a copy arriving *after* the
window produces silence indistinguishable from a refusal. So `watch` mode was added — it writes
nothing and runs over a clip **already in place**, with a focused read of that very clip as its known
positive:

```
18:20:59.496 CONTROL focused read of the EXISTING clip: focused=true importance=100 returned=true
             length=57 label='plain text'
18:20:59.999 SAMPLE t=500ms importance=100 (foreground) focused=false returned=false
...
18:21:44.634 stopped=window — 90 samples over 45s at 500ms, 89 of them taken while not foreground;
             0 readable / 90 refused-or-empty
```

**Readable with focus at 18:20:59.496; unreadable without it 0.5 s later, ninety times.** The
difference is focus and nothing else. The platform wrote **90 denial lines in that window, one per
sample**, naming us and the reason.

### 5. Reading 5 — the write direction **works**, and that is the asymmetry the feature turns on

```
18:22:40.499 WRITE run: backgrounding, then writing from the background in 3s
18:22:43.513 WRITE attempted from importance=125 (foreground-service) threw=no
18:22:43.535 I/ClipboardService: adding mcfds          ← the platform accepted it
18:23:01.120 VERIFY foreground read: returned=true stillOurMarker=true length=28
             READING (write direction): the background setPrimaryClip LANDED
```

**Writes are not gated on focus. Reads are.** And the sharpest single line in the whole sitting is
what happened 54 ms after that successful write:

```
18:22:43.567 E/ClipboardService: Denying clipboard access to com.chetan.connectsuite.debug ...
```

**We were refused reading back the clip we had just written.** A `threw=no` on the write is not a
readable clipboard, which is exactly why the probe reports the effect at the far end rather than the
call's return.

### 6. Reading 4 — the control: the accessibility grant makes **no difference**

The service was disabled by hand and the off-state verified four ways before anything ran — grant
string empty, `accessibility_enabled=0`, no bound service, no enabled service, all agreeing. Then the
same `watch` shape over a fresh foreign clip:

```
18:27:02.447 SemClipboardToastController: ... com.openai.chatgpt        ← the stimulus, witnessed
18:27:17.441 ENV accessibilityServiceOfOurs=false defaultImeIsOurs=false
18:27:17.441 ENV enabled_accessibility_services=
18:27:17.477 CONTROL focused read of the EXISTING clip: focused=true returned=true length=92
18:27:47.592 stopped=window — 60 samples over 30s, 59 not foreground; 0 readable / 60 refused
```

| | accessibility service | focused read | backgrounded reads |
|---|---|---|---|
| Reading 3 | **enabled and bound** | works (57 chars) | **0 of 90** |
| Reading 4 | **disabled, verified 4 ways** | works (92 chars) | **0 of 60** |

**Identical.** The grant is not the discriminator; focus is. So `CapabilityContract` gating
`clipboard` on `ACCESSIBILITY_SERVICE` is gating on a rule that does not operate on this device —
conservative rather than dangerous, and now measured rather than inherited.

### What the readings decide, by the table written before them

`docs/phase-5-clipboard-proposal.md` §2's pre-registered table, **row 3** — reading 3 refused,
reading 4 refused. Not re-argued after the fact; that is what the table was written for.

| Direction | What is possible on this device |
|---|---|
| **Mac → phone** | **Everything.** The background write lands, so a clipboard arriving from the Mac can be delivered whenever it arrives |
| **Phone → Mac** | **Only while ConnectSuite is focused on the phone.** No background read, no `OnPrimaryClipChangedListener` callback, so no unsolicited `clip.push` from the phone and no answerable `clip.request` from a backgrounded one |

### Two things this sitting also settled in passing

1. **A foreground service does not buy clipboard access.** Every refusal above was taken at
   `importance=125 (IMPORTANCE_FOREGROUND_SERVICE)` or `100`. The instinct — *run it inside
   `LinkService` and it will work* — is measured false here, and it would have been the first thing
   tried.
2. **`adb install -r` leaves a window where the accessibility readings disagree.** Immediately after
   the install, `settings get secure accessibility_enabled` read **0** while `dumpsys` listed the
   service under `Bound services` — and 30 seconds later the setting read **1** with a live pid. Two
   readings of one fact, resolved by a third (`pidof`), and the disagreement was **transient rather
   than contradictory**. Had reading 3 been taken in that window, a refusal would have been
   attributed to the platform instead of to a service that was still coming back up. The service
   also *did* rebind after `-r` here, which `InputFeature.kt`'s 2026-08-27 note says it does not —
   recorded as an observation, not a conclusion, because what restarted the process was not
   established.

---

## Slice 12 — Handoff behaviour: auto-apply on the Mac, a setting on the phone, and the cycle proof that had to come first · 2026-09-02

Slice 11 measured the wall. This slice acts on it: **the Mac applies what arrives** so ⌘V works with
nothing clicked, and the phone gets a **setting** rather than a rule, defaulting to hold-for-a-tap.
The phone's *send* direction is untouched — focus is still the only moment it may read, and nothing
here tries to work around that.

The gate on both was one question asked before either was built: **if the Mac applies automatically
and the phone does too, can a clip echo back and forth?**

### 1. The cycle proof, and why the peer is adversarial

The obvious proof — wire a Mac `ClipEcho` to a phone `ClipEcho` and watch them settle — proves that
two copies of one rule agree, which they will, being copies. It is `MediaPayloadsTest`'s mistake with
a socket in the middle: delete the rule from both and the run stays green.

So each side is driven against a peer that **pushes back everything it receives, immediately,
forever**, and lies about `source` and `atMs` while doing it. If one real implementation cannot be
driven into a cycle by a peer that does nothing but echo, it cannot be driven into one by the other
side of this product — whatever that side does now, and whatever it is changed into later. That is a
stronger claim than the pair, and it survives someone adding a clipboard watcher to the Mac.

The trigger in the harness fires after **every** clipboard write, which is the worst case rather than
the real one: the phone's trigger is window focus and the Mac's is a click, and neither fires on a
write we made ourselves.

**Result: converges after exactly one push, on both sides.** The interlock refuses everything after
it, and the refusal is asserted **by name**.

### 2. The instrument was wrong first, again, and this one is a new shape

The first version recorded only the pushes. The mutation run built to prove it could see its own
defect **stayed green with the echo rule deleted**:

| Mutation | What was expected | What happened |
|---|---|---|
| echo rule deleted | the cycle test goes red | **2 of 5 green** — including both automatic cycle tests |

`appliedLocally` arms the *unchanged* guard as well, so that guard caught every echo and the run
still converged to one push. Only the `user`-trigger case — which skips the unchanged rule — went
red. The test was not weak; it was **measuring a different guard than the one it was named for**, and
it would have reported the echo rule as proven on a build where the echo rule did not exist.

Two guards both stopping a cycle is a good property. A test that cannot say **which one ran** is not
evidence for either. The runs now record the refusal *reason*, and the assertions read it.

This is the family in CLAUDE.md — *what you measured, and what you measured it on* — arriving in a
file written to apply that rule, three mutations into the run meant to establish it. Being able to
state the rule is not being immune to it.

### 3. The mutation matrix, after the fix

Every bound reported: node's runner exits non-zero on failure, and each Gradle verdict is printed
with the age of the results file and the exit code of the build that should have written it.

| Mutation | Mac (`node --test`) | Phone (gradle exit / results age) |
|---|---|---|
| echo rule deleted | **5 of 5 fail** — `run ended at hop cap after 50 hops`, `reportable: false` | **exit 1**, 4 of 5 fail, results 0.1s old |
| unchanged rule deleted | 1 fail — the discrimination control | — |
| both deleted | **5 of 5 fail**, runs away to the cap | — |
| `lastReceived` cleared on link drop | 1 fail — the bounce, §4 | **exit 1**, 1 of 5 fail, results 0.1s old |
| restored | 5 of 5 pass | **exit 0**, 5 of 5, results 0.1s old |

The control that matters more than any of them: **a genuine second copy still sends.** A guard that
refused every send would pass every no-cycle test perfectly and this file would be evidence of
nothing, in the way an empty accessibility tree is evidence of nothing.

### 4. The real hazard the proof turned up, and it is not a loop

`lastReceived` was cleared on disconnect on both sides. Harmless while both ends waited for a tap;
with auto-apply on it opens a **one-hop bounce**:

> The Mac applies X to the phone → the link drops → the phone refocuses, reads X off its own
> clipboard with the interlock disarmed, and sends X home → **a Mac that auto-applies writes X over
> whatever the person has copied since.**

It terminates. It happens once. It silently replaces live work with a stale entry, which is the exact
harm auto-apply is on probation for, arriving by the one route a no-cycle proof does not cover.

**Fix:** `lastSent` still clears on a drop — the next Mac may be a different Mac and should get this
phone's clipboard — and `lastReceived` does not. It is one string, never rendered, never sent, never
logged, and the clipboard it came from is still holding it, so it is not a retention decision in the
sense the history's is.

### 5. Reading — can Electron see a concealed clipboard? Partly, and the gap is the finding

The Mac's auto-apply captures the clipboard it is about to overwrite into the history, so Restore is
an undo — `docs/protocol.md`'s stated condition for removing the confirmation. That capture must not
scoop up a password manager's clip. The convention is `org.nspasteboard.ConcealedType`, which is
documentation until measured.

Run through `clipboard.read` / `clipboard.write` / `writeBuffer`, negative and positive in one pass:

| Stimulus | `readText()` | `read('org.nspasteboard.ConcealedType')` | `availableFormats()` |
|---|---|---|---|
| `writeText('an ordinary clip')` | `"an ordinary clip"` | `""` | `["text/plain"]` |
| `write({ text, [TYPE]: … })` | `"a secret"` | `""` | `["text/plain"]` |
| `writeBuffer(TYPE, …)` | `""` | `"1"` | `[]` |

**What this establishes:** the read path is live and is not a query that answers `""` to everything —
row 3 is a non-trivially-true positive.

**What it does not establish, and this is the part to carry forward:** a pasteboard holding text
**and** the marker together could not be built with Electron's API. `clipboard.write` silently drops
the custom type (row 2 is a positive control that *failed to be positive*), and `writeBuffer`
replaces the whole pasteboard (row 3 has no text left in it). **The real case — 1Password's actual
copy on this Mac — is unmeasured.**

So the check ships as **defence in depth and is not the safeguard**. The safeguard is that a
`displaced` entry's text is **never drawn**: it is held for Restore and rendered as a description and
a button. If the check silently returns `""` for a real password manager, the password sits in a
memory-only history that shows a Restore button, cleared on disconnect and gone on restart. Getting
the check wrong costs nothing; relying on it would have.

The reading that would close this is one line and needs a person: copy from a password manager on
this Mac, then read the two values. Recorded as owed rather than assumed.

### 6. The enforcement point — `scripts/check-clip-echo.mjs`

The interlock gets **one home per side** (`clipEcho.ts`, `ClipEcho.kt`) and the scan fails a commit
that grows a second. It exists because the rule *already had* two homes — `shouldSend` in
`clipboardHistory.ts` and `ClipboardPayloads.shouldSend` — each with its own passing test, both of
which would have gone on passing over functions nothing called. Both were deleted with their tests.

Its discriminator is **declaration syntax, never mentions**. The words `lastReceived` and `lastSent`
appear dozens of times in the comments explaining why they may appear only twice, including inside
the checker; a matcher counting occurrences would forbid documenting the thing it guards, which is
defect 41 exactly.

**The fixtures found a real gap on their first run.** The matcher required a `val`/`var`/`let`/`const`
keyword — so it caught Kotlin's `private var lastSent` and **missed TypeScript's
`private lastReceived: string | null`**, which has no keyword at all and is the form the shipping Mac
client uses. The scan would have passed over the exact file it was written for. Seven fixtures, each
paired with its opposite, including two controls proving prose and the `lastSentPreview` display
fields are not homes.

The scan reports its own bound: `212 files read outside the 2 declared homes`, and it exits
`INSTRUMENT FAILURE` below 50 rather than printing a clean pass over a run that read nothing.

### Suite

| | Before | After |
|---|---|---|
| Mac (`npm test`) | 203 | **209** — +5 cycle proof, +2 displaced-row, −1 `shouldSend` moved to the cycle proof |
| Phone (`:sync-module` + `:core`) | 234 | **237** — +5 `ClipEchoTest`, −2 `shouldSend` moved with the rule |
| `node --test scripts/check-clip-echo.test.mjs` | — | 7 |

Phone results read with their age and exit code beside them: `237 tests, 0 failures, 0 errors across
29 classes`, `newest results file written 8.3s ago`, `gradle exit: 0`.

### What this slice did **not** do

- **The phone's send direction is unchanged.** Focus is still the only moment it may read. Nothing
  here polls, observes, or tries to route around Slice 11's wall.
- **Neither auto-apply has run on hardware yet.** Everything above is a JVM/node result and a
  measurement of Electron's clipboard API on this Mac. The phone-side setting, the notification's two
  shapes, and the Mac's Restore row are unproven on the device.

### 7. The Mac's applied path, exercised against the real pasteboard

`scripts/clip-apply-probe.mjs`. A mocked `clipboard` here would prove `ClipboardClient` calls the
function we told it to call; it would not prove that ⌘V produces the text, which is the whole claim.
So the probe loads the **compiled shipping class**, hands it a real `clip.push` payload, and reads
the pasteboard back through the same API a paste would. It captures the machine's own clipboard first
and restores it, and prints whether the restore worked rather than assuming it.

`electron exit: 0` · **7 of 7 ok** · `Clipboard restored: yes`

| Check | Result |
|---|---|
| the arriving text is on the pasteboard | ok — `"FROM-THE-PHONE-xyz"` |
| the renderer was told it was applied | ok — `[true]` |
| the arrival is newest, the displaced entry under it | ok — `["text","displaced"]` |
| the displaced entry holds what was about to be lost | ok — `"WORK-IN-PROGRESS-abc"` |
| sending the phone's own entry back is refused | ok — the interlock's sentence |
| **control** — a genuinely new clip is *not* refused | ok — reaches the link and stops at *"The Mac is not connected"* |
| Restore is an undo | ok — pasteboard back to `"WORK-IN-PROGRESS-abc"` |

**The instrument was wrong twice more, and both are worth keeping.**

1. **A wrong assumption about ordering produced three confident wrong findings.** The first version
   expected `['displaced','text']`; the real order is `['text','displaced']`, because the displaced
   entry is captured before the arrival is stored — which is exactly what the row's copy asserts
   (*"before the entry above replaced it"*). Two checks read a correct product as broken, and the
   third then "restored" the arriving text over itself and reported a failed undo. One assumption,
   three findings, none real.
2. **A check ordered after Restore failed for a reason that turned out to be a property.** The
   interlock is a **single slot**, and Restore is a local write that moves it — so with Restore run
   first, the phone's own entry was no longer recognised as an echo. Correct behaviour, and now
   stated in `docs/protocol.md`: a clip that arrives, is displaced by a Restore, and is copied again
   can travel back, **one hop, terminating**, because the far side refuses to return it. The
   alternative is remembering every text ever received, which is a bigger store of other people's
   clipboard content than this feature will keep for a saved round trip.

The control is the row that makes the other six mean anything: a `send` that refused *everything*
would satisfy the interlock check perfectly, so the probe requires a genuinely new clip to get past
the interlock and fail somewhere else — at the link, by name.

### 8. The pane, read through `scripts/clipboard-pane-probe.mjs`

All reportable. The copy rule is checked as an **ordering** rather than read as a vibe — *"say what
I get, then the limit"* is a positional claim and therefore checkable:

| Question | Answer |
|---|---|
| clipboard section height (control: `2` nodes carry the attribute, so the selector reached the pane and not the window) | `170` |
| controls the pane offers, counted not matched (control: `nav button > 0`) | `2` |
| does the wall still state the one-directional limit? | `true` |
| **does the benefit sentence precede the limit sentence?** (control: both phrases present, so two `-1`s cannot compare as a pass) | `true` |
| does the standing copy say the replaced clipboard is kept? | `true` |
| the empty history | `"Nothing yet. Copy something on either machine."` |

### 9. On hardware · SM-S938B, link up, 2026-09-02

`scripts/link-up.sh`: `ServiceRecord isForeground=true` · `42501/42502/42503 all LISTEN under uid
11011` · `1 control session(s) ESTABLISHED`.

**Mac auto-apply — passes, unprompted and unattended.** The phone was backgrounded (launcher
resumed) and pushed on refocus:

```
01:17:13 I [clipboard] Applied an arriving entry to this Mac's clipboard: 40 bytes,
         previous clipboard captured — 0 sent / 1 received / 1 of 1 applied / 0 refused
```

`⌘V` produces the phone's text with nothing clicked. **It also replaced the operator's real
clipboard**, which is the feature working and is the reason the undo is a condition rather than a
nicety: the displaced entry was captured, and Restore put it back at 01:22:41 (`51 bytes`).

**The phone's default holds — `held for a tap`, twice, with the denominator beside it.**

```
01:18:46 clip.push ← Mac: 19 bytes, held for a tap — 1 sent / 1 received / 0 of 1 applied
01:19:32 clip.push ← Mac: 19 bytes, held for a tap — 1 sent / 2 received / 0 of 2 applied
```

`0 of 1` and `0 of 2` are what say the setting is off rather than the branch being missing — a bare
"held for a tap" would read identically on a build where auto-apply had never been written.

**The offered notification, read rather than tapped** (`dumpsys notification --noredact`):

```
id=3101 channel=clipboard_offer flags=AUTO_CANCEL category=status actions=1
android.title=String (Copied on your Mac)
```

`actions=1` **is** the discriminator between the two shapes — the applied shape is `actions=0` with
title *On your clipboard* — so this reading distinguishes the branch that ran from the one that did
not, rather than merely proving a notification exists.

### Defect 58 — the undo was reachable and not visible, at the one moment it exists for

Reading the pane's rows after an auto-apply, structurally (source, button, body length — **never the
text**):

```
0: Phone · 1:21:08 AM        | Use this | body 22 chars
1: This Mac · 1:19:32 AM     | Use this | body 19 chars
…
4: Replaced on this Mac · 1:17:13 AM | Restore | body 68 chars (muted)
```

The arrival at **1:21:08** displaced a clipboard and the main process logged `previous clipboard
captured` — and **there is no Restore row for it.** The only one present belongs to 1:17:13, four
minutes earlier.

Cause: `onClipArrived` carries the arriving entry and not the `displaced` entry created beside it, so
the renderer's mirror learned about the arrival and never about what it replaced. The Restore row
appeared only on the next `refresh()` — triggered by a button click, which is the thing auto-apply
exists to remove. **The undo was reachable and not visible**, and every test was green, because the
renderer's list is not what any test reads.

Fixed by reconciling from the main process after each arrival — prepend for immediacy, refresh for
truth — with the refresh generation-counted, because a route open, a send, a request and an arrival
can all begin one and the Files pane has already paid for two correct triggers assembling a wrong
picture out of legal states.

Re-measured on hardware after the fix, same route:

```
0: Phone · 1:24:47 AM                | Use this | body 22 chars
1: Replaced on this Mac · 1:24:47 AM | Restore  | body 68 chars (muted)
```

Same timestamp, both present, no click in between. Restore then returned the displaced text
verbatim.

**Two instrument faults in this hour, both mine.**

- **A stimulus whose expectation was already true.** The first send probe waited for
  `#clip-notice` to be `!hidden` — already satisfied by an arrival 93 seconds earlier — so it
  settled in `10ms` having measured nothing and read back the *stale* sentence: *"On this Mac's
  clipboard now"* after clicking **Send**. Re-run with the notice blanked first and an expectation
  only this send could satisfy: `waited=106ms`, `"Sent 19 bytes to the phone."` A stimulus whose
  expectation is already true is not a stimulus.
- **Two taps driven from a `uiautomator` dump landed in the operator's private conversation.** The
  dump was current when taken and the screen was not when the tap arrived. This is CLAUDE.md's
  coordinate rule failing in the sanctioned form — *driven from a dump* is not the same as *driven
  from a dump that is still true* — and the answer here was to stop, not to retry. Consequently:

**What is still unproven on hardware, stated rather than implied:** the phone's auto-apply **on**
path. The setting could not be flipped without a tap on the Switch, and after two misdirected taps
on somebody's real phone the right call was to stop. So the applied notification shape
(`actions=0`, *On your clipboard*), the applied card copy, and `applied` tracking `received` in the
tally are **unrun**. The default-off path is proven; the opt-in path is not.

---

## Slice 13 — the Mac watches its own clipboard · 2026-09-02

Mac → phone becomes automatic. macOS gates nothing, so the button was never the platform's idea. The
phone's send direction is **untouched** — focus is still the only moment it may read, and nothing
here polls, observes or routes around Slice 11's wall.

Three questions were answered before any of it was built, because the change removes the premise the
echo proof was written on.

### 1. Does the interlock hold when both ends send automatically?

**Yes, and it was not resting on the button.** `exchange`'s peer has always been an adversary that
pushes back everything it receives, immediately, forever — a maximally auto-sending far side — so the
Mac's half was already proven against the shape it has now become. What the button *was* hiding is a
different failure that is not a cycle at all: a **flood**. A poll that classified itself as a `user`
trigger would skip the unchanged rule and re-send the same clipboard every 500 ms for as long as the
app was open. No echo rule stops that; a person pressing a button could never produce it.

Five new cases model the watcher directly, and the mutation matrix now separates every field and
every branch:

| Mutation | Mac (`node --test`) |
|---|---|
| echo rule deleted | **6 of 10 fail**, `hop cap after 50 hops`, `reportable: false` |
| unchanged rule deleted | **4 of 10 fail** — including *a watcher over an unchanged clipboard sends once* |
| watcher misclassified as a `user` trigger | **4 of 10 fail** — the flood, caught by name |
| `wroteLocally` becomes a no-op | **4 of 10 fail** |
| `lastReceived` cleared on link drop | 1 fail — the reconnect bounce |
| restored | 10 of 10 pass |

#### The gap that matrix found first

An earlier run had `appliedLocally` arming **both** guards, and the mutation that removed its
`lastReceived` half left **every test green** — the same two-guards-one-test shape that let the very
first version of this file pass with the echo rule deleted, recurring in the file written to prevent
it.

It was not fixed by adding a test. The half was **redundant where it was written for and wrong where
it was reachable**: an arriving entry is already covered by `arrived`, which runs before the write
and survives a link drop, and the only path where it was the sole guard was a Restore — where it made
a later deliberate *Send this Mac's clipboard* click refuse as an echo, over text the person had just
put back on purpose. A click is an instruction; the interlock exists to stop machines looping, not to
overrule people. Narrowed to `wroteLocally`, which arms the unchanged rule and nothing else, every
assignment is now uniquely load-bearing — mutation D above.

### 2. What happens to a password

**The previous slice's conclusion was wrong, and the way it was wrong is the finding.**

Slice 12 reported that `clipboard.read(TYPE)` could see the marker, on the strength of a
`writeBuffer` round-trip returning `"1"`. That control used **Chromium for both the stimulus and the
reading**, so it proved only that Chromium is self-consistent with its own encoding. `swift` builds
the real thing through `NSPasteboard` — the same API 1Password calls — and the real thing reads
differently:

| Stimulus (via `NSPasteboard`) | `readText()` | `has(Concealed)` | `read(Concealed)` | `availableFormats()` |
|---|---|---|---|---|
| text + `ConcealedType` — the 1Password shape | the text | **`true`** | `""` | `["text/plain"]` |
| **CONTROL** — same text, no marker | the text | `false` | `""` | `["text/plain"]` |
| text + `TransientType` | the text | `false` | `""` | `["text/plain"]` |
| text + `AutoGeneratedType` | the text | `false` | `""` | `["text/plain"]` |
| text + all three | the text | `true` | `""` | `["text/plain"]` |
| **CONTROL** — ordinary text again | the text | `false` | `""` | `["text/plain"]` |

`read` is `""` in **every row, including the true ones** — the convention writes the marker as a
present type carrying *empty data*. So the check shipped in Slice 12 could never have fired on a real
password manager, and it passed its own control only because that control wrote `'1'` as the marker's
value, which nothing in the wild writes. **The control and the real input differed in the exact
attribute being read**, which is the discrimination rule in the most literal form it has taken in
this repo.

`has` is the detection surface, `read` is not, and all three markers are honoured. Each marked row
above is paired with an unmarked control carrying the same text, because "the check returned true"
means nothing unless the same check returns false one line later.

The residual risk is stated rather than engineered away: **an app that copies a password and sets no
marker is indistinguishable from one that copies a URL.** Nothing here can fix that, so the rest of
the design carries it — the phone holds rather than applies by default, both histories are
memory-only and cleared on disconnect, no clipboard text is logged at any level, and the watcher has
a switch that persists.

### 3. Polling or an event, and what it costs

**Polling, and not by choice.** `NSPasteboard` has no change notification — no callback, no KVO, no
notification-centre event — and Electron exposes no `changeCount`, so every clipboard manager on
macOS polls and reads.

`clipboard.readText()`, median of 200 reads each:

| clipboard | median | worst | at the 500 ms floor | at 250 ms |
|---|---|---|---|---|
| empty | 0.0010 ms | 0.0206 ms | 0.002 ms/s | 0.004 ms/s |
| 100 B | 0.0106 ms | 0.3066 ms | 0.021 ms/s | 0.042 ms/s |
| 10 KB | 0.0273 ms | 0.7392 ms | 0.055 ms/s | 0.109 ms/s |
| **64 KB — this namespace's own cap** | **0.1008 ms** | 0.1539 ms | **0.202 ms/s → 0.02 % of a core** | 0.403 ms/s |
| 1 MB | 2.0355 ms | 6.2519 ms | 4.071 ms/s → 0.4 % | 8.142 ms/s |
| 20 MB | **37.2974 ms** | 66.4523 ms | 74.595 ms/s → **7.5 %** | 149.190 ms/s |

The last row is why the interval is a function rather than a constant. `nextIntervalMs` holds a **1 %
duty cycle** derived from the *measured* read rather than from the clipboard's size — measure the
effect, not the stimulus — so it adapts to a slow or busy machine instead of encoding this one's
performance as a table. A 20 MB clipboard backs off to 3.7 s and costs 1 % instead of 7.5 %, and
nothing is missed by it: a clipboard that large is over the 64 KB cap and would be refused anyway.

**Above a 50 ms read the ceiling binds and the budget is exceeded** — `MAX_INTERVAL_MS` is a
deliberate cap on how unresponsive the watcher may become, and it is paid for in budget (2 % at
100 ms). Without it a 200 MB clipboard would push the interval to 37 seconds and the person who
copies a URL immediately afterwards would wait most of a minute. That trade is asserted in the tests
rather than left in a comment.

**Reads do not bump `changeCount`** — 500 reads left it at `1209`; a single write moved it to `1210`,
so the counter was live throughout. Had reads counted as writes the watcher would have been its own
stimulus, sending in a loop with nothing wrong with the interlock. And the watcher **does not read at
all while the link is down**: a clipboard watcher with no phone attached is reading somebody's
passwords for no purpose.

### On hardware, with the phone attached

```
01:55:09 Watching this Mac's clipboard every 500ms; it is read only while the phone is connected
01:55:29 clip.push → phone: 26 bytes — 2 sent / 0 received / 0 of 0 applied / 0 refused
```

| Stimulus | Pushes to the phone |
|---|---|
| an ordinary copy, **no button pressed** | 1 — and the phone logged it arriving |
| the same clipboard, left alone 6 seconds (12 polls) | still 2 total — **no flood** |
| a password-manager-shaped copy via `NSPasteboard` | **still 2 total — the password did not leave the machine** |

### The applied notification shape, finally measured

Slice 12 left the phone's auto-apply path unproven because two misdirected taps had made further
tapping unwise. One of those taps had in fact flipped the setting on, so the path ran on its own and
the shape could be read rather than driven:

| | `android.title` | actions |
|---|---|---|
| offered (default) | `Copied on your Mac` | `actions=1` |
| **applied** | `On your clipboard` | **no `actions=` field** |

Both shapes are now proven on hardware, and `actions=` is the discriminator between them.

### Defect 59 — a watcher send was invisible in the pane

Found by the pane probe, which reads the list rather than assuming a send redraws it: after the
watcher sent, `#clip-list` still rendered *"Nothing yet. Copy something on either machine."* The pane
refreshed only on its own button clicks, and the watcher does not click anything. Fixed with a
`clip-changed` event from the main process on any history mutation; re-measured, the list draws
`2` rows with nothing touched.

**The probe step that should have caught it earlier could not.** It read
`#clip-list.textContent.trim().slice(0, 60)` and printed whatever came back, so a list *full of rows*
was reported under the heading *"The pane starts with an empty history and says so"* — it had no
assertion in it at all. Replaced with a counted presence check plus a control that separates "no
rows" from "wrong element".

### Suite

| | Before | After |
|---|---|---|
| Mac (`npm test`) | 209 | **221** — +5 watcher cases in the cycle proof, +7 `clipWatchPolicy` |
| Phone | 237 | 237 — unchanged; the phone has no watcher and cannot have one |

### What is not proven

- **The phone has not been reinstalled with this build.** The new phone-side copy attributing the
  limit to Android is unverified on the device; the APK on it is one revision behind. It was not
  installed because the phone was in someone's hand at the time.
### The phone's auto-apply ON path — proven, and in daily use

**Corrected 2026-09-02.** This slice first recorded the phone's `clipboard_auto_apply` as *on from a
misdirected tap, to be reverted*. That was wrong: the setting was **turned on deliberately by its
owner** and is staying on. It is a user's choice about their own device, not stray state, and the
record said otherwise because the session assumed its own taps were the only thing that could have
changed it — an absence rule failure of the ordinary kind. *What else would look exactly like this?*
A person using their phone.

So the branch Slice 12 listed as unproven is **proven, and by the strongest available evidence**:
not a scripted run but continuous use on hardware.

| | Evidence |
|---|---|
| the setting persists | `clipboard_auto_apply` → `12 02 08 01` in `connectsuite_settings.preferences_pb` |
| the branch executes | `clip.push ← Mac: 26 bytes, applied to this phone's clipboard — 5 sent / 7 received / 5 of 7 applied` |
| the applied notification shape | `android.title=String (On your clipboard)` with **no `actions=` field**, against the offered shape's `actions=1` |
| the interlock holds under it | the phone has not once pushed back a clip the Mac applied to it |

`5 of 7 applied` is the denominator that makes the first number mean something: two of the seven
arrived before the setting was on and were held, five after it and were applied, which is the setting
changing behaviour rather than a branch that always runs.

**Nothing in Phase 5's clipboard work is unproven on hardware now.**

### The gate checked the target and not the intent · 2026-09-02

Reinstalling the phone needed a tap to reach the Clip tab, so the session reran `flip.sh` — the
gated script written in Slice 13 to navigate there. It navigated there, and then **turned the
auto-apply setting off**, which is what it had been built to do the day before and which had since
been explicitly countermanded: the setting is its owner's deliberate choice.

Every gate in that script passed, correctly. It confirmed the resumed activity was ours, re-dumped
before each tap, refused when the screen moved. **It verified the target of the action and never the
premise of it** — and the premise had expired.

Restored immediately: `12 02 08 00` → `12 02 08 01`, switch reads `true`, verified two ways.

Two things worth keeping, and the second is the one that generalises:

- **The gate rule has a third form.** *Do not act on a target you have not identified* (coordinates),
  *do not accept a reading you cannot trust* (controls), *having identified the target is worth
  nothing if the action does not depend on it* (decoration) — and now: **an action whose reason has
  been withdrawn is not made safe by verifying its target.** The predicate that decides *whether to
  act* has to include *is this still wanted*, which no amount of dumping the screen can answer.
- **A tool built for a decision that has been reversed is a loaded gun.** `flip.sh` existed for one
  purpose, that purpose was countermanded, and it sat in the scratchpad still working perfectly. It
  is deleted. The general form: when a decision is reversed, the automation built to serve it is part
  of what gets reverted — otherwise the next person to reach for a familiar script re-executes the
  old decision, which is the force-stop failure with a different command.

---

## Phase 6 opening readings · 2026-09-02

No code written. Four `dumpsys` reads and one static finding, taken while writing
`docs/phase-6-brief.md`, and recorded here because the first one changes what every later Phase 6
reading is allowed to claim.

### Defect 60 — `RECEIVE_BOOT_COMPLETED` is declared and nothing receives it

Static, no device needed.

```
$ grep -rn "<receiver" --include=AndroidManifest.xml .        # the control
sync-module/src/main/AndroidManifest.xml:42:        <receiver
sync-module/src/main/AndroidManifest.xml:46:        <receiver
$ grep -rn "BOOT_COMPLETED" --include=AndroidManifest.xml . | grep -v uses-permission
(nothing)
```

The control matters: an empty grep proves nothing on its own, and *"the project declares exactly two
receivers and both are in `sync-module` with no boot filter"* is what makes the absence a finding
rather than a failed search. The phone binds the sockets, so after a reboot nothing binds them until
somebody opens the app.

### The device under test is not in the default state

```
$ adb shell dumpsys deviceidle whitelist | grep connectsuite
user,com.chetan.connectsuite.debug,11011
$ adb shell am get-standby-bucket com.chetan.connectsuite.debug
5                                              # EXEMPTED
$ adb shell dumpsys deviceidle get deep / get light
ACTIVE / ACTIVE
$ adb shell cmd appops get com.chetan.connectsuite.debug RUN_ANY_IN_BACKGROUND
RUN_ANY_IN_BACKGROUND: allow
```

Control on the first line: this device has **10** `user,` whitelist entries and ours is one of them,
listed beside Samsung's own launcher and Notes — a system entry or a temporary allowance would read
differently. And it is not an artefact of testing: `OnboardingScreen.kt:258` asks for the exemption,
so this is the state the product intends.

**What that forbids.** Any Phase 6 run on this handset as-is measures the **exempt** path. A run that
survives the night and gets written down as *"the service survives"* would be the instrument's own
state contaminating the reading — the same family as the concealed-marker check validating itself
through Chromium, in the phase where it is most expensive, because the users this phase exists for
are precisely the ones who declined that prompt.

`am set-standby-bucket` is the cheap, reversible approximation and is to be tried before anyone is
asked to change their phone's real posture.

---

## Phase 6 · Slice 1 — the boot gap, closed as far as this handset can close it · 2026-09-02

### Defect 60 — the fix, and the two claims it rests on that a laptop cannot produce — **fixed; reinstall half proven on hardware 2026-09-02, boot half awaiting a restart**

Defect 60. `RECEIVE_BOOT_COMPLETED` declared since Phase 1, nothing receiving it, so the link never
came back after a restart. What follows is what was built, what was measured, and — the longer
half — what was *not* measured and why, because two of the three claims this fix rests on cannot be
produced on a phone that is not being rebooted.

### 1. The reading that decided the design, before any code

The obvious receiver — filter `BOOT_COMPLETED`, call `LinkService.start` — is wrong on this device,
and the reason is a platform rule that is easy to inherit from a release note and was instead read
off the phone:

```
$ adb shell dumpsys platform_compat | grep -i BOOT_COMPLETED
ChangeId(296558535; name=FGS_BOOT_COMPLETED_RESTRICTIONS; enableSinceTargetSdk=35; overridable)
ChangeId(203704822; name=DEFER_BOOT_COMPLETED_BROADCAST_CHANGE_ID; enableSinceTargetSdk=33; overridable)

$ adb shell dumpsys package com.chetan.connectsuite.debug | grep targetSdk
    versionCode=1 minSdk=29 targetSdk=36
```

**Control, because a row that is present is not a row that is enabled.** The same dump returns 357
change rows and prints `disabled` explicitly where a change is off — `ChangeId(189969744;
name=DOWNSCALE_65; disabled; overridable)` is in the same output. Our row carries no `disabled`, no
per-package override (`dumpsys platform_compat | grep -A3 connectsuite` returns nothing), and
`enableSinceTargetSdk=35` against our `targetSdk=36`. So the restriction **applies to this app on
this device**, and that is a reading rather than a quotation.

**What is still not a reading, and is labelled as one nowhere in the code:** *which* foreground
service types the restriction denies. That set lives in the framework's `ForegroundServiceTypePolicy`
and no `dumpsys` on this device exposes it. The documented set is `dataSync`, `camera`,
`mediaPlayback`, `phoneCall`, `mediaProjection`, `microphone`; `LinkService` declares
`connectedDevice|dataSync`; so the documented answer is that a naive boot start throws
`ForegroundServiceStartNotAllowedException` and the service dies before binding a socket.

### 2. Why that half cannot be measured here, stated rather than worked around

`BOOT_COMPLETED` is a protected broadcast and this handset will not let anything but the system send
it:

```
$ adb root
adbd cannot run as root in production builds

$ adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p com.chetan.connectsuite.debug
Broadcasting: Intent { act=android.intent.action.BOOT_COMPLETED flg=0x400000 pkg=… }
java.lang.SecurityException: Permission Denial: not allowed to send broadcast
    android.intent.action.BOOT_COMPLETED from pid=9262, uid=2000
```

So there is no stimulus available short of a real reboot, and a reboot is the user's hands (H4). The
design therefore does not depend on the unmeasured half: **a boot start claims `connectedDevice`
only.** It is the minimal honest type for a service whose job is holding a link to a connected
device, it is on the documented *allowed* list, and if the documented denial set is wrong in either
direction `connectedDevice` is still correct. `dataSync` is added only on a start a user drove —
which is also the only kind of start that has ever had a bulk transfer behind it.

`LinkAutoStart.foregroundTypesFor` is that decision as a pure function so a test can reach it, and
`startForegroundWithStatus` now returns a boolean and catches the refusal: a platform denial becomes
one `E` line naming the reason and the types, plus a clean `stopSelf`, instead of a crash on the
user's first restart after an update.

### 3. The half that *is* measurable from a laptop, and it fired

`ACTION_MY_PACKAGE_REPLACED` reaches the identical hole by the route `CLAUDE.md` already documents
as *"reinstalling leaves the phone serverless"* — and unlike a reboot, `adb install -r` produces it
for real. The receiver handles both.

Grants snapshotted before and after, per the standing rule
(`docs/evidence/phase-6-boot-2026-09-02/grants-before.txt`, `grants-after.txt`): the diff of every
`granted=` line, both secure-settings bindings, the deviceidle row and the standby bucket is
**empty**. Nothing was re-granted and nothing was lost.

```
02:38:32  adb install -r app-debug.apk
02:38:41  Success

2026-09-02T02:38:42.448  I [boot]    PACKAGE_REPLACED: 1 paired device(s) — starting LinkService
2026-09-02T02:38:42.476  I [service] Foreground as PACKAGE_REPLACED, types=0x10
2026-09-02T02:38:42.485  I [server]  Listening on 42501/42502/42503, 1 paired device(s)
2026-09-02T02:38:42.955  I [control] Handshake complete with Chetans-MacBook-Pro at 10.47.66.92
```

**The discriminator is built into the instrument, and it had to be.** Ports being bound after a
reinstall is *not* evidence that this receiver did it — the app had also been open, and
`MainActivity.onStart` binds them too. What separates them is the reason carried in the start
intent: a start from the Activity logs `Foreground as USER`. This one reads `PACKAGE_REPLACED`, 14
seconds *before* the first `MainActivity` line in the same log (`02:38:56 [fs] Folders screen`). And
`types=0x10` is `FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE` alone — the small set, claimed and
accepted, with no refusal logged.

Elapsed, install-complete to listening: **1.5 s**. To a live Mac session: **1.9 s**.

### 4. The reading nobody asked for, which contradicts §0's guess about what was doing the work

§0 of the brief says every run on this handset measures the *exempt* path, and predicted that the
battery-optimisation allowlist would be what let a background start succeed. It is not, and the
platform says so:

```
$ adb shell dumpsys activity services com.chetan.connectsuite.debug   # LinkService record
mAllowStart_noBinding=PROC_STATE_BFGS
infoAllowStartForeground=[callingPackage: com.chetan.connectsuite.debug; callingUid: 11011;
  uidState: BFGS; intent: … core.link.LinkService (has extras); code:PROC_STATE_BFGS;
  tempAllowListReason:<,reasonCode:SYSTEM_ALLOW_LISTED,duration:9223372036854775807,…>;
  targetSdkVersion:36; startForegroundCount:0; isBindService:false]
isForeground=true foregroundId=2001 types=0x00000010
```

The granted reason is **`PROC_STATE_BFGS`** — the process was already in the bound-foreground-service
state, because the system had rebound `NotificationMirrorService` when the process came back, 200 ms
before our receiver ran. Not `REASON_ALLOWLISTED_PACKAGE`, not a package-replaced exemption. The
allowlist is visible in the same record as a `tempAllowListReason` and is *not* the code that
decided.

That matters more than it looks, and in an uncomfortable direction:

- The success above is **conditional on this app having an enabled notification listener.** A phone
  where that grant is off has no BFGS procstate at the moment the receiver runs, and this run says
  nothing whatever about whether the start would be permitted there.
- So the contaminant was real but was **not the one the brief named**. §0's warning was right in
  kind and wrong in particular, which is the everyday form of the control rule: naming *a* lookalike
  is not naming *the* lookalike, and the only way to tell was to ask the platform which reason it
  used rather than reasoning about which reason it should have used.

### 5. Samsung's fast-restart broadcast, and one thing measured about it

Defect 60's fix direction says to add `QUICKBOOT_POWERON` and to *verify on this device rather than
trusting that sentence*. Half of it is verifiable and was:

```
$ adb shell am broadcast -a android.intent.action.QUICKBOOT_POWERON -p com.chetan.connectsuite.debug
Broadcasting: Intent { act=android.intent.action.QUICKBOOT_POWERON flg=0x400000 pkg=… }
Broadcast completed: result=0
```

No `SecurityException`, where `BOOT_COMPLETED` produced one from the same shell in the same session.
So on this handset **`QUICKBOOT_POWERON` is not a protected broadcast** — any app can send it. That
is not a reason to skip it; it is the reason `LinkBootReceiver` is `exported="false"`, so the system
can deliver it and nothing else can reach it, including that shell command (which is why `result=0`
is not a delivery).

**Unverified and left unverified:** whether One UI actually sends it, in place of or in addition to
`BOOT_COMPLETED`, on a fast restart. That needs a reboot. Listening costs nothing and a duplicate
delivery is a no-op start on a live service.

### 6. What the fix deliberately does not claim

- **It does not make the link survive a restart.** On a device with file-based encryption and a
  secure lock screen — this one — `BOOT_COMPLETED` is delivered after the **first unlock**, because
  the Room trust store the receiver reads lives behind that unlock. The honest sentence is *"the link
  returns when you first unlock the phone after a restart"*. Making it literally survive would mean
  a direct-boot-aware receiver over device-encrypted storage, i.e. moving the trust store out from
  behind the lock screen, which is a security trade this phase is not making.
- **An app in the stopped state receives neither broadcast.** A force-stop, or an install never
  launched. That is Android's rule and it is also why `scripts/hooks/no-force-stop.sh` exists.
- **The boot path itself is unproven.** Every line in §3 is `MY_PACKAGE_REPLACED`. The code path from
  the action string onward is identical and unit-tested, but the platform's decision at boot is a
  different decision, taken at a different procstate, under a compat change that only applies to
  boot. Pass criterion when the reboot happens: `scripts/link-up.sh` returning three OKs with nothing
  tapped, and a `[boot] BOOT:` line in `files/logs/link.log`.

### 6b. A second one the tests could not have caught, and the probe reported it clean

The grid shipped its first build as **nine columns of overlapping icons with no names on screen at
all** — and every check was green, including this slice's own probe reading *"tiles whose label is a
resolved name rather than the package id → 123 of 123"*.

That reading was **true and about the wrong property.** `textContent` is a fact about the tree; it is
not a fact about the picture. Measured:

```
tile height     32px          ← the row
icon height     48px          ← overflowing it
label height     0px          ← clipped to nothing, while reading back "AdBlock for Samsung Browser"
```

A tile is a `<button>`, and the base `button, .button` rule sets `min-height: 32px`. Chromium sizes
an `auto` grid row from the item's intrinsic block contribution, and for a button that came back as
the min-height rather than as icon + label. One line fixes it — `grid-auto-rows: max-content` —
after which the row is 107px and the two-line clamp works exactly as written.

**Two things about how it was found are worth more than the fix.**

*The first: the obvious diagnosis was wrong and an experiment confirmed it.* A label with height 0
points straight at the `-webkit-line-clamp` above it, and replacing the clamp with `display: block`
**did** make the text appear — which reads as proof. It was not: that test changed two things at
once. Measured with the row fixed, the clamp is correct and always was, 2 lines for a long name and
1 for a short one. One cause, two suspects, and the innocent one had a passing experiment behind it.

*The second: the instrument that measured the candidate fixes was itself broken, silently.* The first
attempt injected a `<style>` element and reported that **none** of five candidate fixes changed
anything — identical numbers across all five, which is what a page with `style-src 'self'` does to an
injected inline stylesheet. No error, no warning. The fix was CSSOM `insertRule` on an existing
same-origin sheet, and the control that makes it a reading is one line: insert
`.apps-tile-art { width: 99px !important }`, confirm the element measures **99**, delete the rule,
confirm it measures **48** again. Without that, "the fix did nothing" and "the fix never applied" are
the same output.

The probe now reads label **height** as well as label text, because that is the reading that would
have caught it.

### 7. Guards, and each one shown red first

`core/src/test/java/com/chetan/connectsuite/core/link/BootAutoStartTest.kt`, 9 tests. Every run below
reports the exit code and the age of the results file it read, after a run earlier in this session
returned `failures=0` from a task Gradle had skipped as up-to-date — the stale-artifact fault, caught
by the age line rather than by suspicion.

| Mutation | Result |
|---|---|
| baseline, unmutated | `gradle exit: 0; results written 0s ago; tests="9" failures="0"` |
| `<receiver>` deleted from `core`'s manifest | `exit 1; failures="3"` — *"RECEIVE_BOOT_COMPLETED is declared in [core, app] and no `<receiver>` anywhere filters BOOT_COMPLETED"*, plus the control test reporting it found only `[ClipApplyReceiver, SmsMirrorReceiver]`, plus the MY_PACKAGE_REPLACED assertion |
| `foregroundTypesFor` collapsed to always return both types | `exit 1; failures="1"` — *"BOOT must not claim dataSync expected:<0> but was:<1>"* |
| a `USER_PRESENT` filter added to the manifest that nothing maps | `exit 1; failures="1"` — *"the manifest filters actions the receiver drops on the floor: [android.intent.action.USER_PRESENT]"* |
| all mutations restored | `exit 0; failures="0"` |

The control that makes the manifest half worth anything is separate and named: *"the manifest scan
finds the receivers already known to exist"*. "No receiver declares BOOT_COMPLETED" and "the XML walk
found no receivers" are the same result, and without that assertion a renamed attribute or a broken
walk would pass the real check in silence — the empty-accessibility-query shape.

**Phone suite after the slice:** 244 tests, 0 failures — 84 `core` (11 classes) + 160 `sync-module`
(19 classes), every result XML written 0-14 s before it was read, `gradle exit: 0`.

---

## Phase 6 · Slice 2 — the four experiments this handset can run alone · 2026-09-02

**Every reading below is on the EXEMPT path** and each one says so where it matters.
`user,com.chetan.connectsuite.debug,11011` is still in the deviceidle whitelist and
`am get-standby-bucket` still reads `5` — verified before and after every run in this slice. That is
the brief's §0 and it is not a footnote: nothing here describes a phone whose owner declined the
onboarding prompt.

### P6 — the standby-bucket approximation is **not reversible**, so it was not taken

The brief calls `am set-standby-bucket` *"reversible in one command"* and says it is the cheapest
approximation of H1, to be run before anyone is asked to change their phone's real posture. That is
wrong, and the platform says so in one line:

```
$ adb shell am get-standby-bucket com.chetan.connectsuite.debug
5

$ adb shell am set-standby-bucket com.chetan.connectsuite.debug 5
java.lang.IllegalArgumentException: Cannot set the standby bucket to 5

$ adb shell am get-standby-bucket com.chetan.connectsuite.debug
5                                    # unchanged — the refusal changed nothing
```

`EXEMPTED` is **derived** from the deviceidle whitelist and cannot be set. So the shell can move the
bucket *down* out of it and has no command that puts it back. There is a plausible mechanism by
which the platform would restore it on its own — the whitelist is re-read when app-standby
re-evaluates — and *plausible mechanism* is exactly what this project does not spend somebody else's
phone on. Proving it would require breaking the state first, which is the thing in question.

So P6 was not run, and the brief's sentence is corrected rather than worked around. **What it would
have stood in for, and now does not:** the unexempt path is unapproximated, and every claim in this
slice about Doze, wakelocks and process death is exempt-path-only with no cheap control available.
That moves H1 from *"only if §2 leaves a question"* to *"the only route to the unexempt path"*, and
it is the user's call because it is the user's battery.

### P2 — forced deep Doze, three minutes, link intact

`scripts/doze-probe.sh`. It simulates the unplug with `dumpsys battery unplug` rather than asking
anyone to pull a cable, forces deep idle, and restores on every exit path including Ctrl-C — a probe
that can leave a phone believing it is on battery all night is worse than no probe.

```
baseline  deep=ACTIVE light=ACTIVE listen=4/4 established=1
    Now forced in to deep idle mode
     0.0s  deep=IDLE light=OVERRIDE listen=4/4 established=1
    …  12 samples at 15 s …
   169.1s  deep=IDLE light=OVERRIDE listen=4/4 established=1
stopped=duration after 12 samples

--- restoring ---
deep=ACTIVE  light=ACTIVE
charging=  AC powered: false   USB powered: true
whitelist row: user,com.chetan.connectsuite.debug,11011
standby bucket: 5
```

**`established=1` is not the reading, and taking it as one would have been the row-presence fault
again.** A TCP socket sits in `ESTABLISHED` long after its peer has gone; the count says a socket
record exists, not that anything crosses it. The liveness control is on the Mac, and it is a message
that actually arrived:

```
# Mac log, inside the forced-idle window (02:54:17 – 02:57:17)
2026-09-02T02:54:33.499  I [notif] updated com.android.systemui — 54 showing, 344 posted / 2 removed
```

16 seconds into `deep=IDLE`, a phone-originated notification crossed the control channel and was
drawn. And the negative half carries its own control: the Mac logged no `Heartbeat lost` during the
window, and that query is known to be able to see one — `2026-09-02T00:29:17.946 W [link] Heartbeat
lost: no pong in 15s` is in the same file from earlier the same night.

**What this proves:** on the exempt path, a deep-Doze transition does not disturb the listeners, the
established control session, or message delivery across it. **What it does not:** anything about a
non-whitelisted app, which is the entire population Doze's network restrictions apply to. A clean
pass here was the expected result and is worth exactly as much as its caveat.

### P3 — the wakelock, and three instruments that do not agree

`LinkService` takes a `PARTIAL_WAKE_LOCK` named `ConnectSuite:link` while a client is connected.
Three ways of asking how long it is held give three different answers:

| Instrument | Answer | What it is reading |
|---|---|---|
| `dumpsys power` | `PARTIAL_WAKE_LOCK 'ConnectSuite:link' ACQ=-6m53s253ms LONG (uid=11011 pid=18738)` | the **live** hold, elapsed, at the instant of the dump. Unambiguous |
| `dumpsys batterystats --charged` | `7m 8s 807ms partial (0 times) max=459388 actual=459388 (running for 0ms)` | a blamed total for the current charge session — **with an acquisition count of zero beside a non-zero duration**, which cannot both describe a session containing the many acquisitions the history shows |
| `dumpsys batterystats --history` | `+longwake` / `-longwake` spans of 3, 6, 13, 16, 30 and 31 minutes across 09-01 → 09-02 | wall-clock long-wakelock transitions across the whole history buffer, spanning charge sessions |

**This is the "two readings, one fact" family with a third member, and it is not resolved here.** The
tempting reconciliation — that `--charged` was reset and holds only the current hold — accounts for
`7m 8s ≈ ACQ=-6m53s` neatly and then fails against `Total running: 5h 16m 53s` in the same block,
which says the charge session is five hours long and should contain those acquisitions. Picking the
tidy story would be inventing the reconciliation rather than measuring it.

So the practical rule, which is the useful output: **no aggregate wakelock figure for this app is
quoted anywhere yet.** The only number this project will stand behind is `dumpsys power`'s live
elapsed hold, sampled — which is what `scripts/link-night-watch.sh` now does, at a stated interval,
read-only. What would settle the aggregates is H3: an unplugged run with a `batterystats --reset` at
its start, so the window has a known beginning.

**The structural finding needs no aggregate, and is defect 61 below:** the lock is acquired with a
12-hour timeout behind an `if (wakeLock == null)` guard, so once the platform's timeout lapses it it
is **never re-armed**, and the comment on the field claims the opposite.

### P5 — process death, and `am crash` is not a dependable stimulus

`scripts/link-recovery-probe.sh`. Its control run first, because a probe that cannot see a healthy
link cannot see an unhealthy one: with no stimulus it reports `pid=18738 listening_sockets=4/4` and
then `stopped=deadline … this run holds no reading about recovery`. That phrasing is deliberate — the
page-cap lesson — and it earned itself twice in the next twenty minutes.

**The control also found two faults in the instrument before it produced any number.** It sampled
without sleeping, so a "500 ms interval" was really an adb round trip; and `pidof` returns two pids
on this handset because of the dual-app clone under u95, so the probe would have reported *"the
process never died"* about a process that had died. Both are fixed and the probe now prints the
**observed** mean gap beside the requested one.

**Run 1 — the process died and `START_STICKY` brought the service back:**

```
t0-1  pid=18738 listening_sockets=4/4
t0    adb shell am crash com.chetan.connectsuite.debug
      Shell does not have permission to crash packages for user 150     ← the documented misleading refusal
    0.070s  process gone
    0.691s  process back (pid=23016)
    1.290s  listening again (3/4 sockets)
summary: samples=3 requested_interval=400ms observed_mean_gap=645ms
```

±645 ms on each of those, and the fine-grained truth is in the phone's own log:

```
02:48:03.782  I [service] Foreground as UNKNOWN, types=0x10
02:48:03.791  I [server]  Listening on 42501/42502/42503, 1 paired device(s)
02:48:07.605  I [control] Handshake complete with Chetans-MacBook-Pro
```

**`Foreground as UNKNOWN` is the discriminator, and it is the reason Slice 1 recorded a start reason
at all.** A null-intent `START_STICKY` restart is the only route that produces it — a start from
`MainActivity` logs `USER`, one from the receiver logs `BOOT` or `PACKAGE_REPLACED`. So this answers
P5's question directly: `START_STICKY` does restart `LinkService`, and it **does** bind its ports,
which the brief suspected it might not. It also validates the type policy from Slice 1 from the
other end: `UNKNOWN` claims `connectedDevice` only, `types=0x10`, accepted.

**Run 2 — the same command, 49 seconds later, and the process did not die at all:**

```
stopped=deadline after 422 samples — this run holds no reading about recovery
summary: samples=422 requested_interval=0ms observed_mean_gap=214ms
```

422 samples at 214 ms is far finer than run 1's, so this is not a missed window. The process was
alive with the same pid throughout, and the reason is in logcat:

```
02:48:52.330  I ActivityManager: Showing crash dialog for package com.chetan.connectsuite.debug u0
```

The crash raised a **modal error dialog** and the process was held in the error state behind it, with
the link still up (4/4 sockets, session established). `dumpsys window` confirmed
`mCurrentFocus=Window{… Application Error: com.chetan.connectsuite.debug}` — on the phone's screen,
holding focus.

**So `docs/RESUME.md`'s "`am crash` works" is half right and the half that is missing is the
dangerous one.** Same command, same package, same session, 49 seconds apart, two outcomes: a silent
kill, and a modal dialog with the process alive. The discriminating variable was **not identified**,
and saying so is the point — an experiment that uses `am crash` as a process-death stimulus must
verify the process actually died rather than assume it, which is what the probe's `stopped=deadline`
line does and why it is phrased as holding no reading rather than as a negative one.

**Clearing the dialog without input.** `am kill` did nothing (the documented no-op on a
foreground-service host, confirmed: focus unchanged, pid unchanged). Relaunching `MainActivity` by
name started the activity behind the dialog and did not dismiss it. `am broadcast -a
android.intent.action.CLOSE_SYSTEM_DIALOGS` cleared it, verified by the error window being gone with
the control that the same query still enumerated 20 other windows. No key event was sent at any
point.

### P5b — and clearing it exposed the more serious finding: **a crash can leave the phone serverless**

When the dialog was dismissed the held process finally died, and what came back was not the service:

```
02:52:00.415  I ActivityManager: Killing 23016:com.chetan.connectsuite.debug/u0a1011 (adj 0): crash
02:52:00.453  W NotificationListeners: 0 notification listener binding died: …NotificationMirrorService
02:52:10.484  I ActivityManager: Start proc 31828:…/u0a1011 for service {…/NotificationMirrorService}
```

Ten seconds later the process was back — **started for the notification listener, not for
`LinkService`.** Every feature installed itself into `LinkServer`, capabilities went green, and the
phone's own log has **no `[service] Foreground as` line and no `Listening on` line**. Sockets: `0`.

That is the exact state `CLAUDE.md` documents after `adb install -r` — *"the app returns via the
notification-listener rebind with every feature installed and no port bound"* — reached by a **third**
route, and this one needs no laptop and no reinstall. `START_STICKY` restarted the service after run
1's kill and did not after this one; the visible difference is the kill reason, `(adj 0): crash`.

The link was down from 02:52:00 until it was restored by hand at 02:53:08, and nothing on either side
said so beyond the Mac's ordinary reconnect attempts. Recovery was the documented one —
`am start -n …/MainActivity`, then `scripts/link-up.sh` returning its three OKs:

```
OK  1. ServiceRecord present, isForeground=true, createTime=-4s129ms
OK  2. 42501/42502/42503 all LISTEN under uid 11011
OK  3. 1 control session(s) ESTABLISHED on 42501 under uid 11011
```

This is **defect 62** and it has a fix direction that falls straight out of Slice 1's readings.

### P4 — screen off and on, not run, and why

The brief's P4 needs the screen turned off and back on. There is no `adb` route to that which is not
a key event, and this session is operating under an explicit instruction not to send input to the
phone. `input keyevent 26` / `223` / `224` are all input, and the repo's own control table already
records `KEYCODE_BACK` doing something other than what it looked like inside DocumentsUI — so
"it's only a power key" is precisely the reasoning that table exists to distrust.

**What was done instead, since the phone is attached all night:** `scripts/link-night-watch.sh`, a
read-only sampler that touches nothing and waits for the screen-off that happens anyway. It records
screen state, wakefulness, both idle states, socket count, established sessions, the live wakelock
`ACQ` elapsed, and the pid, and it prints its **observed** mean gap beside its requested interval so
a transition shorter than the gap is visibly outside what the run can see. It also prints, in its own
header, the thing that limits it: **the phone is on the cable, so it will not enter deep Doze
unaided** and nothing it collects describes an unplugged night. That is H3.

**Blocked, not deferred.** P4's forced version needs either the user's hands on the power button or
an explicit relaxation of the no-input rule for key events with no navigation surface. It is one
sentence of permission, not a device limitation.

### Defect 61 — the wake lock is never re-armed, and its own comment says it is

`LinkService.acquireLocks()` creates the lock behind `if (wakeLock == null)` and acquires it with
`WAKE_LOCK_TIMEOUT_MS = 12h`. The field's comment reads *"Re-armed on every state change; a phone
that sleeps for a day never holds it stale."*

The first half of that sentence is not true of the code beneath it. `acquireLocks()` runs on every
`state` emission where `isConnected` is true — and on the second and every later emission the field
is non-null, so it returns without touching the lock. When the platform's 12-hour timeout expires,
`isHeld` goes false, the field stays non-null, and **nothing re-acquires it for the rest of the
connection.** The only thing that clears the field is `releaseLocks()`, which runs on disconnect.

Found by reading, not by a failure, and it is **unreachable in every reading this project holds** —
which is itself the finding. The longest `+longwake` span in the history buffer is 31 minutes, and
the spans are separated by ~62-second gaps that are the Mac reconnecting. The bug needs a single
connection held for twelve hours, and on this device the link has never stayed up for one. So the
defect is invisible today *because of a second problem*, and Phase 6's whole purpose is to remove
that second problem — at which point this one starts happening.

**Fix direction:** re-acquire when the lock is not held rather than when the field is null, and stop
relying on a state change to do it — a connection that is quietly healthy emits nothing for hours,
which is exactly the case that breaks. Re-arm on a timer the service already owns, with the timeout
shortened so a missed release path lapses in about an hour instead of half a day. The invariant that
matters is `re-arm interval < timeout`, with margin, and it is the thing a later tuning edit will
silently break, so it belongs in an assertion rather than in a comment.

**Wrong fix to avoid:** removing the timeout and acquiring indefinitely. The timeout is the backstop
against a release path that is missed, and this project has already shipped a capture session that
outlived its consumer (the `sessionEndedSink` comment records it) — an indefinite `PARTIAL_WAKE_LOCK`
is the same mistake with the battery attached.

### Defect 62 — a crash leaves the phone alive, granted, and serverless

Measured 2026-09-02 during P5 and recorded in full above. After a process death whose kill reason is
`(adj 0): crash`, `START_STICKY` did **not** restart `LinkService`. The process came back ten seconds
later, started for `NotificationMirrorService`; every feature installed itself, every capability went
green, and the phone had **no listening socket** and no `[service] Foreground as` line in its own log.

This is the third route to a state `CLAUDE.md` already documents for `adb install -r`, and it is the
worst of the three because it needs nothing but a crash: no laptop, no reinstall, no reboot. It is
also silent on both sides — the Mac shows an ordinary reconnect loop, which is what it shows for a
phone in a lift.

The control that separates this from run 1's outcome is the phone's own start-reason line: run 1
logged `Foreground as UNKNOWN` (a genuine `START_STICKY` restart) 0.7 s after its death, and this run
logged nothing at all.

**Fix direction:** the process *does* come back — reliably, because the platform rebinds
`NotificationMirrorService` — so the missing piece is only that nothing in that path starts the link.
`onListenerConnected` is that path and already runs in this process; starting `LinkService` from it,
gated on a paired device exactly as `LinkBootReceiver` is, closes all three routes with one rule
rather than three. Slice 1's reading is what makes it sound rather than hopeful: the `install -r`
start was granted under `PROC_STATE_BFGS`, which is the procstate a bound notification listener
*is*, so the start is permitted for a reason that was measured on this device rather than assumed.
Log it with its own reason so the route is visible in the log the way `PACKAGE_REPLACED` and
`UNKNOWN` now are.

**Wrong fix to avoid:** a `JobScheduler` or `AlarmManager` watchdog that periodically checks whether
the service is up. It would work, and it buys a permanent background job, a new failure mode under
the very battery restrictions this phase is about, and a second thing that starts the service for
reasons nobody can see. The listener rebind is a signal the platform already sends us for free. And
**do not reach for the notification listener as a general-purpose restart trigger** — it is the right
answer here only because the crash path demonstrably ends in that rebind; a phone where that grant is
off gets no fix from this and needs to be said so out loud.

---

## Phase 6 · Slice 3 — defects 61 and 62 fixed, and 62 caught in the act · 2026-09-02

### Defect 62 — closed, reproduced and fixed inside one run

The fix is three lines in `NotificationMirrorService.onListenerConnected` calling
`LinkAutoStart.ensureRunning(this, LISTENER_REBIND)`, and it is sound rather than hopeful for a
reason that was *measured* in Slice 1 rather than assumed: the `install -r` start was granted under
`PROC_STATE_BFGS`, and a bound notification listener **is** that procstate, so the background
foreground-service start it makes is permitted for a reason read off this device.

**The gate proved itself before the defect did.** On the reinstall that carried the fix, both routes
fired and only one of them acted:

```
03:05:53.751  I [autostart] PACKAGE_REPLACED: 1 paired device(s), link not running — starting LinkService
03:05:53.794  I [service]   Foreground as PACKAGE_REPLACED, types=0x10
03:05:53.822  I [server]    Listening on 42501/42502/42503, 1 paired device(s)
03:05:53.822  I [autostart] LISTENER_REBIND: already listening — nothing to do
```

That second line matters more than it looks. The listener rebinds on an ordinary grant toggle too,
with everything working — so an ungated version of this fix would start a service that is already
running every time somebody touched a switch in Settings. `LinkController.peek()?.state?.value?.running`
is an in-process read and the whole gate.

**Then the defect itself, on the second consecutive `am crash`** — the variant that raises the modal
dialog, which is the one `START_STICKY` does not recover from:

```
03:06:41.592  I ActivityManager: Showing crash dialog for package com.chetan.connectsuite.debug u0
03:06:45.778  I ActivityManager: Killing 5524:…/u0a1011 (adj 100): crash
03:06:55.827  I ActivityManager: Start proc 6617:… for service {…/NotificationMirrorService}   ← not LinkService
03:06:56.131  I [autostart] LISTENER_REBIND: 1 paired device(s), link not running — starting LinkService
03:06:56.145  I [service]   Foreground as LISTENER_REBIND, types=0x10
03:06:56.150  I [server]    Listening on 42501/42502/42503, 1 paired device(s)
03:06:57.194  I [control]   Handshake complete with Chetans-MacBook-Pro
```

**Line 3 is the defect's signature, unchanged.** The platform still started the process for
`NotificationMirrorService` alone; `START_STICKY` still did not restart `LinkService`. Nothing about
the platform's behaviour was altered or worked around — the app simply now notices. `sockets=4/4`,
`link-up.sh` three OKs.

| | before the fix (02:52:00) | after the fix (03:06:45) |
|---|---|---|
| kill reason | `(adj 0): crash` | `(adj 100): crash` |
| process back | 10.1 s later, for `NotificationMirrorService` | 10.0 s later, for `NotificationMirrorService` |
| `LinkService` started by | **nothing** | `LISTENER_REBIND`, 304 ms after the process started |
| sockets bound | **0**, until restored by hand 68 s later | 4/4, 323 ms after the process started |
| Mac reconnected | only after manual recovery | 03:06:57.194, 11.4 s after the kill |

The 10 seconds are the platform's own delay before restarting the process and are not ours to
shorten. Everything after it is: **323 ms from process start to listening.**

**The two `am crash` variants both appeared again in this run**, which is worth recording because it
means the earlier observation was not a one-off: the first crash killed silently and `START_STICKY`
recovered it (`Foreground as UNKNOWN` at 03:06:13.940, with `LISTENER_REBIND` correctly declining
21 ms later); the second raised the dialog and did not. The discriminating variable is still not
identified — the only visible correlation is that the dialog appeared on the *second* crash in both
sittings — and it stays labelled unidentified rather than guessed at.

**What this fix does not cover, stated in the code rather than left to be found:** a phone with the
notification-listener grant switched off has no rebind to hang this on, and gets nothing from it.

### Defect 61 — closed, and the guard is on the relationship rather than the value

`acquireLocks()` guards on `isHeld` instead of `== null`, and — the half that matters more — a state
change is no longer what drives it. `LinkLockPolicy` holds the two numbers together in one file
because the defect was a *relationship*: a twelve-hour timeout was perfectly safe alone and fatal
beside a re-arm that never ran. Timeout 60 min, re-arm every 20 min, driven by a ticker that runs
whether or not anything is happening — which is the state the bug lived in, since a quietly healthy
connection emits no state changes for hours.

Shortening the timeout is a free improvement once the re-arm works, and it cuts the cost of a missed
release path from an overnight battery complaint to a rounding error.

The re-arm count is published beside its denominator (`N re-arm(s) / M first-acquire(s) since
start`), so "the lock was re-acquired 4 times" can be told from "the lock was re-acquired 4 times out
of 4 attempts", which is a different and much worse story.

**Red-first, three mutations, each reporting exit code and result age:**

| Mutation | Result |
|---|---|
| timeout back to 12 h | `exit 1; failures=1` — *"a timeout of 43200000ms is long enough to be an overnight battery complaint if a release path is ever missed"* |
| re-arm interval raised past the timeout | `exit 1; failures=1` — *"a re-arm interval that is not shorter than the timeout means the lock lapses"* |
| re-arm set to 59 min against a 60 min timeout | `exit 1; failures=1` — *"only 1 re-arm(s) fit inside one timeout; 3 are required so a missed tick is survivable"* |
| restored | `exit 0; tests=11 failures=0` |

**The third one is why the assertion is not `REARM < TIMEOUT`.** 59 against 60 satisfies that
inequality and leaves the lock lapsed for however long a slow tick, a doze deferral or a dispatch
delay costs. `MIN_REARMS_PER_TIMEOUT = 3` means two consecutive ticks can be missed entirely and the
lock still holds — and it is the assertion a plausible-looking future edit trips over, which is the
only kind worth writing.

**Not yet observable on hardware.** The re-arm path needs a connection held past 20 minutes, and
`scripts/link-night-watch.sh` is sampling the live `ACQ` elapsed all night at a stated interval. A
first re-arm would appear in `link.log` as *"Wake lock had lapsed and was re-acquired"* — and on a
correctly working service that line should **never** appear, because the re-arm happens before the
lapse. What the ticker actually prevents is invisible by design; what it would print is the
alarm.

### One refactor worth naming, because it removed a third copy before it was written

`LinkBootReceiver` had the paired-device gate, the fail-open timeout and the refusal logging inside
it. The listener fix needed the identical decision, and the obvious move — copy it — would have been
the second copy, with a third waiting behind any future route. It is one function now,
`LinkAutoStart.ensureRunning`, and the receiver is the two broadcasts and nothing else. Same rule as
`MediaPayloads.cursorOf`: give the rule one home and let the callers call it.

**Suite:** 248 tests, 0 failures — 88 `core` (11 classes) + 160 `sync-module` (19 classes), every
result XML 0 s old, `gradle exit: 0`. Grants diffed empty across the reinstall that carried the fix.

---

## Phase 7 · Slice 1 — the Activity pane, and the tenth of eleven screens gets built · 2026-09-02

`navModel.ts` had two screens left at `unbuilt`. **Camera** cannot be built here — a virtual webcam
is a macOS Camera Extension, which is a signed system extension and therefore a distribution problem
before it is a code problem, and this session has no Apple account. **Activity** could, and its
`unbuiltReason` was the specification: *"Nothing stores a session history yet. The rotating log file
behind Settings → Advanced is the closest thing that exists, and it is a log, not a timeline."*

### 1. What was built, and the one decision that shaped everything else

`main/activity.ts` is a store — a JSONL file in `userData/logs`, a 2,000-event ring, and a
`record(category, kind, detail)` that never throws into its caller. `shared/activity.ts` is the
pure half: filtering, paging, the summary, the CSV, and the five-state view model.
`renderer/activity.ts` draws it.

**It is deliberately not a parser over `connectsuite.log`.** That was the tempting version — the
data is arguably already there — and it would have been a second expression of every rule the
emitting code already contains. `CLAUDE.md` is explicit about what happens to the two copies: they
disagree eventually and the reading is the one that is wrong.

**Every recording site is in `main.ts`**, eleven of them, labelled `R1`–`R11` in comments. Not
scattered through the feature clients, because `main.ts` is already where every client's events are
subscribed and every renderer request is handled — so it is the one file that can see all six
categories, and one file with an enumerated set is something a reader can find a hole in.

Two of those sites are worth naming:

- **R1 records phase *transitions*, not `status` ticks.** `link.on('status')` fires on every retry,
  and a row per tick would bury every other category under a reconnect loop — the thing the pane
  exists to make visible becoming the thing that hides it.
- **R9 and R10 record a size and a direction, never the content.**
  `docs/phase-5-clipboard-proposal.md` §6 is the first at-rest storage decision in this project and
  it says no clipboard text reaches any log line. This store writes a file. A handler written the
  way every other handler here is written would have put people's passwords and SMS bodies on disk,
  in the pane whose whole subject is a durable record.

### 2. Five states where the artboard draws one

`docs/design-departures.md` §Activity carries all seven rows; A2 is the one that matters. The
artboard is nine rows and a pager. The pane is in one of **A1** loading, **A2** unreadable, **A3**
nothing recorded, **A4** nothing matching this filter, **A5** the table.

A3 and A4 are the pair, and they are the fourth sighting of this shape in this file — after N4 (the
phone has the feature and is not offering it), P5 (the phone is half offering it) and the Files
rows. This one is the first where **both halves are entirely local**: no phone, no wire, no
permission. *Nothing has ever happened* and *nothing matches Files* would render as the same blank
table, and a user cannot tell "nothing has been transferred" from "nothing is recorded, ever".

Four independent differences, asserted rather than described: headline verb, body, whether the
filter is named, and whether the chip row survives as a way out.

**The state at the IPC boundary is where this could still have collapsed**, and it is the detail to
copy. `activity-events` returns `{ events, error, stats }` — the store's read error travels
**beside** the events rather than replacing them with `[]`. An empty array on a failed read would
have merged A2 into A3 one layer below the tagged union that exists to keep them apart, and the
union would have had nothing to work with. `activityView.test.ts` has a test named for exactly that
branch.

### 3. Paging, and an honest note about a tiebreak

`media.list` needed a `(date, id)` tiebreak, and `CLAUDE.md` records both what it cost to prove the
tiebreak was load-bearing and the `fs.list` run where the boundary count came back **0**. This store
has no such problem, and the reason is not that it was solved: **the store assigns its own monotonic
`seq` and pages on that**, so two events in the same millisecond are strictly ordered and there is
no tie to break. It is written down because the alternative — paging on `at`, watching the pages
sum, and calling it correct — is precisely the run that looks identical with a tiebreak deleted.
The test that covers it puts six events on one millisecond and asserts the two pages recover all
six.

The clamp is the other half. Switching from **All** on page 3 to **Files** with four files returns
zero rows with a fetch that succeeded and a filter that matched — an empty table produced by
arithmetic, which none of the state checks would catch because nothing failed.

### 4. Guards — 27 tests, four mutations, each reporting exit code

`shared/activity.test.ts` (12) and `renderer/activityView.test.ts` (15). The second exists because
of the checker that stopped this commit: **`scripts/hooks/renderer-views-covered.sh` refused it**
while `ActivityView` was drawn by nobody's test, which is the guard working on the first new view
class since it was written.

| Mutation | Result |
|---|---|
| A4 collapsed into A3 — the pair the pane exists for | `pass 24 / fail 3` — the view test, the four-differences test, and the exhaustive state list |
| `refresh()` no longer joins a run in flight | `pass 26 / fail 1` |
| the page clamp removed | `pass 25 / fail 2` |
| all restored | `tests 27 / pass 27 / fail 0` |

The second mutation is the Files pane's race, pre-empted rather than repeated. That pane reached the
one state its tagged union existed to forbid because a route opening and a capability arriving both
called `refresh()` within a frame. This pane has the same two triggers, so a second caller **joins
the run in flight**, and there is a test that counts bridge calls under three concurrent refreshes.

### 5. The DOM double had to grow, and it says so

`domDouble.testkit.ts` gained `appendChild`, `setAttribute`/`getAttribute`, `style`, `dataset`,
`title`, and `createElementNS` — added there rather than worked around in the pane's test, which is
that file's own instruction.

**One of those additions is a bug the double would otherwise have caused.** `setAttribute('class',
…)` now also writes `className`, because that is the only way to class an SVG element — `className`
on an `SVGElement` is a read-only `SVGAnimatedString`. Without it, `queryAll('.activity-donut')`
missed every SVG node and reported the donut absent when it was drawn. That is the hidden-grid
failure rebuilt inside the harness, and it was caught because the assertion that failed was one
whose answer was already known.

### 6. Read in the real window, and it found a real defect

`scripts/activity-pane-probe.mjs`, through `probe.mjs`. The DOM double has no cascade and no layout,
and its own header says so, so the half it cannot see is read here.

```
the Activity section is visible and has height → 551                     [control=12]
rows / cards / state / chips / donuts → {"rows":4,"cards":0,"state":"A5","chips":2,"donuts":1}
PASS  exactly one state is drawn — a table or a card, never both and never neither
the layout is the two-column grid the design draws → {"display":"grid","columns":"815px 320px"}
tokens the Activity rules reference that resolve to empty → {"referenced":10,"empty":[]}   [control=38]
the table scrolls inside itself → {"tableOverflowX":"auto","pageScrollsSideways":false}
the Activity nav row is not marked unbuilt → {"activityUnbuilt":false,"stillUnbuilt":["Camera"]}
the export affordance is a real control → 1
```

**The token check failed on its first run and it was a real defect.** `--accent-fill`,
`--text-secondary` and `--text-tertiary` do not exist in `tokens.css`; the real names are
`--accent-tint`, `--text-body` and `--text-meta`. An undefined custom property is not an error —
it resolves to nothing and paints nothing — which is exactly how this project's violet accent was
never once drawn. Three of the ten tokens in a brand-new stylesheet block were wrong, `tsc` was
clean, all 255 tests were green, and the pane rendered in a way that looked deliberate.

`stylesheets.test.ts` could not have caught it: it guards selector collisions and `:root` blocks
outside `tokens.css`, and an undefined token is neither.

### 7. The probe's own second copy, caught one run later

After the CSS was fixed the probe **still reported the same three tokens empty** — because it
carried its own hard-typed array of ten token names, and that array had drifted from the stylesheet
it was checking. A stale second copy of the thing under test, reporting a fault that had been fixed,
with full confidence.

It reads the names **out of the loaded stylesheet** now — every `var(--…)` in a rule whose selector
mentions `.activity-` — with a control that counts the rules found at all, since an empty `empty`
list over a `referenced` of zero is a stylesheet the scan could not read. Same family as the test
that models the thing instead of calling it, in the instrument rather than in the test, one day
after that rule was written into `CLAUDE.md` for the third time.

**Suite:** 255 tests, 0 failures (was 240). `tsc` clean, `npm run build` exit 0, Electron relaunched
with `--force-renderer-accessibility` and read at 9222.

---

## Phase 7 · Slice 2 — the features the app's own search could not find · 2026-09-02

The brief was *"six shipped features with no home in the design — media remote most of all, which
has worked since step 67 and has no pane, no sidebar row, no dock tile."* The sidebar half is exactly
right. *Most of all* was the wrong diagnosis, and one probe run changed the fix.

### 1. Buried, or unfindable — they look identical and are not the same problem

`scripts/homeless-features-probe.mjs`. **The media remote card is not buried:**

```
the media remote card → {"drawn":true,"hidden":false,"top":535,"height":100,
                         "viewportHeight":865,"aboveTheFold":true}
the contacts card     → {"drawn":true,"hidden":false,"top":233,"height":496,"aboveTheFold":true}
```

Both on screen, at full height, without scrolling. **What is broken is that nothing can find them** —
the palette is the app's search and it answered five queries with nothing, with the control that the
same palette returns six rows for `mirror`, so the empty result is a real absence rather than a dead
query:

```
"music" → []   "playing" → []   "remote" → []   "contact" → []   "pair" → []      [control=6 each]
```

Eleven screens reachable by search; three shipped features not.

**Moving the card would have cost a design departure and fixed nothing.** The rule is the one this
project keeps re-learning from the other direction: a negative *impression* is no more evidence than
a negative reading, and *"nobody can find it"* is a claim that can be measured before it is acted on.

### 2. The enumeration also shrank the list from six to three

`docs/phase-7-homeless-features.md` §1 carries every shipped feature against the design. The
count is **three** — media remote, contacts, pairing — and the rest turned out to be homed by
something that is not a nav row:

- **Input injection** is not a feature beside the mirror canvas, it *is* the canvas, and
  `input-note` says so above it: *"Click the picture to tap, drag to swipe, scroll to scroll…"*
- **Drag to Finder** is stated in the Files pane's own copy: *"…is on this Mac — drag it to Finder
  from here."*
- **Manual address, Tailscale, Forget device and the log tail** are all Settings sections.

Recorded rather than quietly corrected, because *"six features have no home"* is a reasonable thing
to believe from the sidebar, and the sidebar is not where those features live.

### 3. What shipped — a third palette kind

`DEEP_LINKS` in `navModel.ts`, beside `SCREENS` and `COMMANDS`, because that file is already the one
home for what the palette contains. **Not a twelfth sidebar row**: `PAIRING_SCREEN` already records
why inventing rows the designer did not draw is how a shell stops matching its handoff.

Three decisions, each of which could have gone the other way:

- **The keywords are what a person types, not what this repo calls it.** Nobody searching for the
  media remote types *media remote*. A label-only match leaves four of the five measured queries
  still empty — which is the fourth mutation below.
- **Deep links rank last.** Typing `c` must not put *Contacts* above *Calls* and *Clipboard*, which
  are whole screens.
- **Activating one routes *and then reveals*.** A row that routes to Overview and stops is
  indistinguishable, from the user's side, from a row that failed — they are on a screen they could
  already reach with no sign of which part of it answered. The card is scrolled to and flashed once,
  and the flash is off under `prefers-reduced-motion`. A `reveal` id that no longer resolves raises a
  toast rather than doing nothing quietly, the same refusal `runSelected` already makes for a
  command with nothing wired to it.

Re-measured on the live window, same probe, same controls:

```
"music" → ["Now playing" · In Overview]      "contact" → ["Contacts" · In Messages]
"playing" → ["Now playing" · In Overview]    "pair"    → []   ← still, and deliberately: item 7
"remote"  → ["Now playing" · In Overview]
```

### 4. Four guards, four mutations, all red

A deep link has more ways to rot than a nav row: its screen can be renamed, its card can be deleted,
its card can *move to another screen*, and its ranking can be reversed by a refactor.

| Mutation | Result |
|---|---|
| `reveal` points at a deleted id | `pass 17 / fail 2` — the id scan **and** the section check |
| the link claims the wrong screen (card is in Messages, link says Calls) | `pass 18 / fail 1` |
| deep links joined before navigation | `pass 18 / fail 1` — *"a one-letter query still leads with whole screens"* |
| keyword matching removed, label only | `pass 18 / fail 1` — the five measured queries |
| restored | `tests 19 / pass 19 / fail 0` |

**The second mutation is the one worth keeping.** `In Overview` is a claim printed in the palette
row, and a card that moved would send the user to a screen it is not on and then flash nothing —
a confident wrong answer, which is the shape this project keeps finding. The check reads
`index.html` and works out which `<section class="screen">` each `reveal` id falls inside, with a
control asserting the scan found sections at all.

### 5. What was deliberately not built

A dock tile, a sidebar row, a Quick actions tile, and a Contacts screen — each needs a decision
rather than an implementation, and each is written up in
`docs/phase-7-homeless-features.md` §3 with the one sentence that would settle it. The Quick actions
one is the sharpest: the design's header reads `8 available` over eight tiles that are all routes,
so a ninth tile for a card on the same screen makes that count either wrong or misleading, and
whether Quick actions means *the eight screens* or *the things you do most* is the designer's call.

**Suite:** 261 tests, 0 failures (was 255). `tsc` clean, build exit 0, relaunched and re-read at 9222.

---

## Phase 7 · Slice 3 — two off the renderer-view debt list, and a fault in the harness itself · 2026-09-02

`scripts/check-renderer-views.mjs` listed nine view classes drawn by nobody's test, with
**FilesView first — the reason the file exists.** Two came off in this sitting, and neither removal
was voluntary: the checker refused both commits on the branch that fails an entry which is *"now
driven by a test but is still on the debt list"*. That is the half of a guard people usually forget
to write, and it pruned itself twice in one afternoon.

### 1. FilesView — the wall that broke twice, asserted over the whole state space

`filesView.test.ts` mounts the real class against the DOM double and reads the two elements the
pane writes to — never `downloadWallHome`, because asking the rule where it put the wall is asking
the thing under test to describe itself.

**A measurement came before the assertion, and it changed what the assertion says.** Evaluating
`filesPaneView` over all five inputs:

```
unavailable        id=M5 shared=0 home=state-card bodyMentionsDownload=false
ready 0 roots      id=M2 shared=0 home=state-card bodyMentionsDownload=true
ready 2 grant-free id=M2 shared=0 home=state-card bodyMentionsDownload=true
ready with a tree  id=M3 shared=1 home=rail-line  bodyMentionsDownload=true
failed             id=M4 shared=0 home=state-card bodyMentionsDownload=false
```

`wallHomeVisibility` answers `stateCard: true` for M4 and M5 — and those two cards carry **no wall
copy at all**, so the wall is on screen **zero** times there. That is correct behaviour: when the
pane could not load, or the phone is not offering Files, the user's problem is the failure and not a
note about which folder Android refuses to share.

But it means **`wallHomeVisibility` is a claim about which container the wall would live in, not a
claim that a wall is drawn** — and reading it as the second is how somebody concludes the wall is
covered in five states when it appears in three. The test asserts `expectWall: false` for those two
as firmly as `true` for the other three, so a change that starts drawing the wall over a failed
fetch is caught in the other direction too. It carries its own control: a detector that always
returned false would pass both `false` rows.

**Five mutations, all red, including both historical breaks:**

| Mutation | Result |
|---|---|
| the slice-9 break: `roots.length` instead of `sharedFolderCount` | `pass 38 / fail 1` |
| the slice-7 break: both wall homes true | `pass 35 / fail 4` |
| the wall drawn over a failed fetch | `pass 38 / fail 1` |
| the in-flight join removed (the race that produced the empty table) | `pass 38 / fail 1` |
| the drop tile shown regardless of what the phone said about `push` | `pass 38 / fail 1` |
| restored | `tests 39 / pass 39 / fail 0` |

**The first row is the point of the whole exercise.** `CLAUDE.md` records that when the slice-9
break happened, *"four tests went red on the mutation and none of them touches the thing that
broke"* — they were all in `filesRoots.test.ts`, over the rule, and `showsState` lived in the
renderer where no test reached. That mutation now goes red in a renderer test.

### 2. RemoteView — taken next, because slice 2 had just made it findable

It would have been odd to point people at a pane no test drives. `remoteView.test.ts`, 16 tests
against the two rules its file comment names with step numbers:

- **Step 66 — nothing playing is a normal state, not a failure.** Asserted twice: the sentence is
  drawn and no transport is, and the card carries no `error`/`warning`/`destructive`/`danger` class.
  A remote that reported an idle phone as a fault would cry wolf every time somebody stopped their
  music.
- **Step 65 — a button is drawn only where the player says it works.** Disabled *with the reason on
  it*, and the reason in a `visually-hidden` span as well as the tooltip, which is defect 26: a
  tooltip tells a sighted mouse user why and tells everybody else nothing.

Plus defect 46 (a package id is never the whole sentence a person reads), the volume reading
carrying its maximum, both refusal paths raising a notice, and the position extrapolation — a paused
track that does not creep, a playing one that does, and neither running past the end.

**Six mutations, all red:** an idle remote styled as an error, skip buttons live regardless of the
session, the reason only in the tooltip, paused tracks creeping forward, the volume printed without
its maximum, and a refusal swallowed.

### 3. The harness had a fault, and `tsc` could not see it

Extending `domDouble.testkit.ts` for the Activity pane, a field declaration — `private ownText = ''`
— was **deleted by accident**. `npm run typecheck` stayed clean and 255 tests stayed green.

`tsconfig.json` excludes `*.test.ts` and `*.testkit.ts` from the project so nothing test-shaped
reaches `dist/`. That is right, and the cost nobody had noticed is that those files are then **not
typechecked at all**. The symptom was `textContent` returning `undefined` from a fresh element where
a real one returns `''` — and it surfaced as a *RemoteView* test failing, which is the worst
possible place for it to surface, because the file it pointed at was innocent.

A second fault came out with it: setting `textContent` and then appending a child dropped the text.
A real DOM keeps the text node and returns both. That is exactly the shape `RemoteView.showNotice`
writes — a reason, then a fix hint appended beside it — so the double was silently deleting the more
important half of a refusal message.

**`tsconfig.test.json` is the enforcement point**, wired into `npm run typecheck`. Its scope is the
**harness and not the tests**, deliberately: a fault in a test surfaces as that test failing, which
points at the right file; a fault in the harness surfaces as whichever pane happens to be under test
failing, which points at the wrong one. Checking the tests too was tried first and reported 40
errors about how `tsx` executes them (`import.meta`, `.ts` specifiers) rather than about whether
they are right — noise that gets normalised and then ignored.

Its control is the fault itself: with `ownText` deleted again, `tsc -p tsconfig.test.json` reports
four `TS2339`s; restored, it is clean.

### 4. The double grew, and what it still cannot see is written into it

`appendChild`, `setAttribute`/`getAttribute`, `style`, `dataset`, `title`, form-control fields,
`createElementNS`, `createTextNode`, `querySelector`, `matches`, `classList.add`/`remove`, and
`installFakeWindow`.

Two of those carry their own limits in the source rather than in a reader's memory:

- **`matches(':active')` always answers false.** The double has no pointer, so `RemoteView.tick`'s
  branch that skips redrawing a slider the user is dragging is untested here and always will be.
  Saying so is the point — a `matches` that quietly returned false for everything would look like
  coverage.
- **`installFakeWindow` records timers and never fires them.** A test can assert *that* a ticker was
  scheduled and at what interval, and can run one deliberately; it cannot wait for one. Letting them
  run would make a result depend on how long the process happened to take.

### 5. One reading that was not a finding, recorded because it looked like one

`files-pane-probe.mjs` reported **4 CHECK(S) FAILED** immediately after the relaunch — the table
reading `7286/7286` and the pager `1 → 1`. Re-run against the same build a minute later: **ALL
CHECKS PASSED**, 10 readings, 0 not reportable, including `200 → 400` on the pager and one wall home.

Nothing changed but the app being warm. The first run measured a pane that had not finished
loading, which is *could I have seen it* rather than *did I see it* — and it is only not in this
record as a regression because the probe was run twice before anything was concluded from it.

**State of the debt list:** 4 covered, 7 remaining — CallsView, ContactsView, MirrorView,
NotificationsView, PhotosView, ShellView, SmsView, each still carrying its reason.

**Suite:** 285 tests, 0 failures (was 261). `npm run typecheck` clean over both configs, build exit
0, relaunched and re-read at 9222.

---

## Phase 7 · Slice 4 — the pairing flow, proposed and measured, not built · 2026-09-02

The brief: *"Pairing has a screen. This is the real blocker on anyone else using the app — I paired
by hand in Phase 1 and a stranger has no path from 'app opened' to 'phone connected'."*

`docs/phase-7-pairing-flow.md` is the proposal. It deliberately does **not** repeat the Mac screen's
design, which `docs/design-departures.md` has carried since 2026-08-30; what it adds is the phone
half and the join, which nothing had covered.

### 1. Both surfaces, read rather than remembered

`scripts/pairing-probe.mjs`, against the live window, restoring the route it found:

```
the pairing section → {"cards":1,"buttons":1,"inputs":0,"hasQr":true,
                       "headings":["Scan this with your phone"]}       [control=12]
progress rows (the proposal asks for four) → 0                         [control=1]
a manual-address field on the pairing screen itself → 0                [control=1]
countdown or expiry → {"mentionsRefresh":false,"noteText":""}          [control=1]
nav rows / dock tiles / device card → {"navRows":11,"dockTiles":5,"deviceCard":true}
```

The probe is read-only about pairing state — it never rotates the token, never forgets a device, and
puts the route back where it found it.

The phone, from source: three tabs (**Sync · Mirror · Mac**), pairing on the third; four onboarding
pages that **never mention pairing, scanning or a QR code**; and `LinkRoute` leading with *"Ports
42501, 42502, 42503 · protocol v1"* and *"Not offered yet: … 3 not built"* above the button a new
user needs.

### 2. Where the path actually breaks — and where it does not

The useful shape of it: **the pairing mechanism is sound and shipped**. Of the seven steps a
stranger takes, three already work — the Mac forces the pairing route, the QR is drawn, and the scan
pairs. Four do not, and none of the four is about cryptography:

1. Onboarding ends with **Done** and nothing to do next.
2. It drops the user on **Sync**, which is the Android-to-Android feature.
3. The Mac's instruction — *"go to the Mac tab"* — is correct (verified: the tab really is called
   *Mac* and the button really says *Scan pairing code on Mac*) but it is printed on the device the
   user is not holding.
4. The end state is ambiguous on both sides.

**Nothing on either device tells anybody to pair.** That is the blocker, and it is a copy-and-flow
problem rather than a protocol one.

### 3. The state table, and the row that will hurt

The Mac's inability to tell *nobody scanned* from *scanned and failing* is already recorded (P3).
**The phone has the mirror image and nobody had written it down:** after a successful scan it shows
*"Listening for your Mac"* for the Mac not having dialled yet, for a refused handshake, and for a
phone on the wrong network — all three, indefinitely, on the screen the user is actually holding.

J6 in the table is the worst: **scanned, wrong network — both devices show a state that means
"everything is fine, wait"**, and neither can detect it alone. A timeout on each side with the
network hint costs nothing on the wire.

J7 is the cheapest fix in the document: `LinkTls.checkClientTrusted` already logs
`Rejected unpaired client …`. The fact exists; it never reaches a screen.

### 4. Five of seven need no protocol change

That is the finding that should order the work. **F1 — a fifth onboarding page that ends on
pairing — converts *"a stranger has no path"* into *"a stranger is walked to it"* and touches no
wire message.** Only F6 (P3) and F7 (P4) are contract changes, and those go into
`docs/protocol.md` first.

### 5. Defect 63, found while reading the onboarding copy

Registered separately below, because it is a shipped false statement rather than a proposal.

### Defect 63 — the security note describes a pairing flow this app does not have

`OnboardingScreen.kt`, third page, in a surfaceVariant card:

> *"Devices are paired by confirming a key on both screens, and every connection after that is
> checked against it. An unpaired device is refused without asking you anything."*

**Nothing is confirmed on both screens.** The Mac draws a QR, the phone scans it, and the
fingerprint inside is pinned — there is no confirmation step on the Mac and no key shown on the
phone. The sentence describes a numeric-comparison flow (the shape KDE Connect uses, which this
project studied for its trust model) and a user who reads it will stand there waiting for a key to
appear on the Mac that never will.

The second clause is accurate and should survive. Found by reading the onboarding pages against the
pairing implementation while writing `docs/phase-7-pairing-flow.md` — not by a failure, and not by
anything a test could have seen: it is a true-sounding sentence about a mechanism, and the only
check for those is somebody comparing them.

**Fix direction:** replace the first clause with what actually happens — *"Pairing is a code you
scan once. The certificate behind it is pinned, and every connection after that is checked against
it — an unpaired device is refused without asking you anything."* It is one string; the risk is
entirely in nobody noticing the other three onboarding pages make claims of the same kind, so the
fix is to read all four against the implementation rather than to patch the one that was found.

**Wrong fix to avoid:** deleting the sentence. The security model is the reason this app has no
account and no server, and it is worth one card in onboarding; the problem is that this card
describes somebody else's implementation of it.

---

## Phase 9 · Slice 1 — the distribution audit, and the first artefacts · 2026-09-02

The brief put the audit first and called it *the real work*: everything that quietly assumes this
Mac, this phone, or this person. `docs/phase-9-distribution-audit.md` is the list.

### 1. What the audit found, and the two rows a stranger would have seen first

**D1** — `navModel.ts` shipped the Overview title as the literal **`'Good morning, Chetan'`**. Every
user of this build is greeted by the author's name, at every hour of the day.
**D2** — the sidebar's account block was **`Chetan Pujari`** and the initials **`CP`**, hardcoded in
`index.html`.

Both fixed. **The interesting part is what the fix refuses to do.** The obvious repair is to
substitute a name, and the app has no honest source for one — there is no account,
`userInfo().username` is a login name that reads `chetan` here and `jsmith` elsewhere, and
`hostname()` is the machine's name rather than the person's. **A greeting that gets somebody's name
wrong is worse than one that does not use it.** So `overviewTitle()` is the time of day and nothing
else, which is also the first time that string has been correct after noon.

Read back on the running app:

```
{"accountName":"Chetans-MacBook-Pro","avatar":"CM",
 "accountSub":"key 3030C8EBCDDCD0FB…","pageTitle":"Good morning"}     [control=11]
```

The block now says what its second line always claimed it did — **this Mac** — and the key is
abbreviated the same way the phone's *Paired Macs* list does it, so the two can be compared by eye.
`initialsFor` treats a digit as not-an-initial (`macbook-pro-3` → `MP`) and answers `''` rather than
guessing.

### 2. D8 was wrong, and the way it was caught is the point

The audit claimed a **real phone number** had been copied out of a hardware log into shipping source
and asked for a redaction. The redaction was made — and then reverted, because the claim was false.

Enumerating every match rather than acting on the one the grep surfaced first:

```
+918200000005  +918300000006  +918800000004  +919800000001  +919900000002
```

Five numbers of the form `91` + two digits + `0000000` + an incrementing digit. **That is an
anonymisation scheme, not a phone book.** One plausible-looking number is a phone number; five in an
arithmetic sequence are a placeholder set that somebody already applied.

The revert matters as much as the finding: these are **quoted log excerpts**, and blurring evidence
to remove a risk that is not there makes the record less faithful for nothing.

### 3. D5 was overstated, and the measurement said so

The audit's sharpest row claimed a missing `appId` was *"a way for a released app to lose its own
identity between updates"* — `safeStorage` holds the TLS private key and is keyed to the app's
identity, so a bundle id that moves is a fingerprint the phone will refuse.

The reasoning is sound. The reading is that it did not happen: the packaged app, with
`CFBundleIdentifier=com.chetan.connectsuite.desktop`, **read the dev build's encrypted key without
trouble**, and the phone accepted the existing fingerprint —

```
2026-09-02T11:46:18.520  I [link] Connected to Samsung SM-S938B at 10.47.66.128 via last-known
```

— from the packaged binary, with the dev instance killed (`pgrep -f "electron \." → 0`), and with
`cert.pem`/`key.enc` still dated Aug 24. The row is rewritten in place rather than deleted: *a
mechanism that plausibly bites is not a mechanism that was observed biting, and the difference is
one run.*

**And the run surfaced something the audit had not predicted — D11.** The packaged app and the
`npm start` build **share `~/Library/Application Support/connectsuite-desktop`**, because Electron
derives `userData` from `app.getName()` → `package.json` `name`, not from `appId` or `productName`.
Harmless for a release; a source of confusing local results, since a change tested against one build
shows up in the other.

### 4. The .dmg, and it launches from /Applications

`electron-builder.yml`, `build/entitlements.mac.plist`, `npm run dist`.

```
skipped macOS code signing  reason=identity explicitly is set to null
default Electron icon is used  reason=application icon is not set     ← D4, confirmed by the build
building  target=DMG arch=arm64  file=release/ConnectSuite-2.0.0-arm64.dmg   115 MB
building  target=DMG arch=x64    file=release/ConnectSuite-2.0.0.dmg         117 MB
```

Mounted, copied to `/Applications`, launched, and read:

| | |
|---|---|
| `CFBundleIdentifier` | `com.chetan.connectsuite.desktop` |
| `CFBundleShortVersionString` | `2.0.0` |
| `NSLocalNetworkUsageDescription` | present — an empty local-network prompt is one people deny |
| Launched | one window, titled `ConnectSuite` |
| Working | contacts, SMS threads and a clipboard push, all through the packaged binary |

Then quit, removed from `/Applications`, and the image detached. `/Applications/ConnectSuite.app:
No such file or directory`, `/Volumes` clean.

**What this run does not prove, and it is the half that will bite somebody.** The .dmg was built
locally and never crossed a browser, so it carries `com.apple.provenance` and **no
`com.apple.quarantine`**. Gatekeeper's quarantine gate therefore never ran. `spctl -a -vvv` rejects
the bundle outright — *"code has no resources but signature indicates they must be present"*, on an
ad-hoc `Identifier=Electron` signature — so **a downloaded copy of this .dmg will not open on a
double-click**, and a user will need right-click → Open or `xattr -d com.apple.quarantine`. That is
what unsigned means, it is written into `electron-builder.yml`'s header, and it is the thing the
Developer ID account buys.

### 5. The release APK, and R8 keeping what it was given

`./gradlew :app:assembleRelease` → **25 MB unsigned** against the debug build's 93 MB. Verified
unsigned by enumerating `META-INF/`: *v1 signature entries: none*, with the control that the archive
reads as an APK at all — 433 entries, one `classes.dex`, an `AndroidManifest.xml`.

**A manifest entry is a registration line, not an execution line**, so the receiver added tonight was
chased into the dex as well:

```
manifest: com.chetan.connectsuite.core.link.LinkBootReceiver     PRESENT
dex:      LinkBootReceiver  PRESENT   LinkService  PRESENT   ClipApplyReceiver  PRESENT
          LinkAutoStart     MISSING   LinkLockPolicy  MISSING
control:  ClipProbeActivity absent, as expected (debug-only)
```

**`MISSING` is two different facts** — inlined, or removed — and they are not the same news. The
discriminator is the strings only those classes produce, every one of which is in the dex:

```
YES  "already listening — nothing to do"           YES  "Foreground as "
YES  "trust store did not answer in "              YES  "startForeground refused for "
YES  " paired device(s), link not running"         YES  "Wake lock had lapsed and was re-acquired"
YES  "android.intent.action.QUICKBOOT_POWERON"     YES  "ConnectSuite:link"
```

So R8 inlined the two Kotlin `object`s — a `const val` becomes a literal and its holder becomes
unused — and every branch of tonight's Phase 6 work survives into the release build. The release APK
has **not been installed or run**; this is a static reading of what is in it.

### 6. The version scheme, and a sixth commit hook

Two numbers that had disagreed since their first commits — Android `1.0.0`, Mac `2.0.0` — with
nothing in the build reading both. `docs/versioning.md` settles it at **2.0.0** for both, keeps
`versionCode` as Android's own hand-bumped integer that nothing derives, and keeps
`Link.PROTOCOL_MAJOR` explicitly out of it, because a copy fix must not force a protocol bump.

`scripts/check-versions.mjs` + `scripts/hooks/versions-in-sync.sh`, six fixtures, fails open like its
siblings. Red-first: put `1.0.0` back and it reports *"the two apps disagree about the product
version"*, exit 1; restored, exit 0.

**The fixture that matters is not the disagreement, it is the reader failing.** A regex that stops
matching — because somebody moves `versionName` into a version catalogue — returns `null`, and two
`null`s compare equal: a clean pass over a file it could not read. The runner treats a null as
`INSTRUMENT FAILURE` rather than as agreement, and a fixture holds that.

**Nothing was signed, notarized or published.** `identity: null` and `notarize: false` are explicit
rather than absent, `publish: null` is set on the target that would otherwise upload on a tagged
build, and the credentials are named in the config with no values because a credential in a
checked-in file is a credential in git history.

### 7. And the entitlements file was not in git

Caught immediately after the commit, by checking rather than assuming: `git ls-files desktop/build/`
came back **empty**. `electron-builder.yml` describes `build/entitlements.mac.plist` as *"present
and complete"* and the repo did not have it — the root `.gitignore`'s `build/` line, written for
Gradle's output directories, also matches electron-builder's build **inputs**.

A name collision, invisible until somebody clones the repo and the first signed build fails on a
missing entitlements file — which is the day the Developer ID account arrives and the worst possible
day for it. `.gitignore` now carries the exception and says why.

The general form is the one this repo keeps writing down: **a file described in a document is a
claim, and `git ls-files` is the check.** The document was written and the file was created; nothing
in between confirmed the two ended up in the same repository.

**Suite:** 288 Mac tests (was 285) + 248 phone, 0 failures. `npm run typecheck` clean over both
configs, both builds exit 0, all six commit checks green.

---

## Phase 6 · Slice 4 — the overnight run, and the hole it found in the fix from Slice 3 · 2026-09-02

`scripts/link-night-watch.sh` sampled for **8h57m** — 268 samples, requested interval 120 s,
observed mean gap 120.2 s — touching nothing on the phone.

### 1. P4 answered by waiting instead of by pressing a button

Slice 2 recorded P4 as *blocked, not deferred*: turning the screen off needs a key event and this
session was told not to send input. The screen went off on its own, repeatedly:

```
mScreenState:  OFF 224 samples · ON 39 · DOZE_SUSPEND 5     (5 transitions observed)
```

**The link was up in every one of them** — `sockets=4/4 est=1` — including all five
`DOZE_SUSPEND` samples. One process for the whole night (`pid=6617`), and the only samples where
the link was down are **11:46:11–11:54:14**, which is when the dev Electron was killed to test the
packaged `.dmg`: `est=0`, `ACQ=none`, and no Mac to hold a session. That is the instrument's own
doing and is attributed rather than counted as a phone-side drop.

So P4's answer, on the exempt path, on the cable: **screen-off and screen-on do not disturb the
link.** Its forced version is still unrun and still one sentence of permission away.

### 2. The reading that mattered: a 59m49s hold, eleven seconds from the timeout

```
longest continuous wakelock hold observed: 59m49s   (at 07:26:45)
re-arm ticker: every 20m      acquire timeout: 60m
"Wake lock had lapsed and was re-acquired": 0 occurrences   (control: 35 lines from 2026-09-02 in the same log)
```

**Slice 3's fix repairs a lapse instead of preventing one.** `acquireLocks()` re-acquired only when
the lock was *not held*, and the ticker's phase has nothing to do with the acquire's. Worst case: a
tick at T+59 finds it held and does nothing, the platform drops it at T+60, and the next tick is
T+79 — **nineteen minutes with no wake lock**, on a link that believes it is holding one.

The 59m49s hold is that gap about to open, caught before it did. What kept it from mattering is the
same thing that hid the original defect: the link drops often enough that `releaseLocks` resets the
cycle first — ten fresh acquires across the night — **which is precisely the hiding place Phase 6
exists to remove.** Fix a link that stays up and this starts happening.

**Corrected: refresh, do not repair.** A tick on a held lock now calls `acquire` again, which on a
`setReferenceCounted(false)` lock re-arms its timeout rather than stacking a second lock. Three
counters instead of two — first-acquires, refreshes, lapses — and a lapse now logs at `W`, because
it should stay at zero and it is an alarm rather than a success.

The assertion changed with it, and the old one was asking the wrong question. *"Do enough ticks fit
inside a timeout"* is the repair's question; the refresh's question is **"does a dropped tick still
land inside the timeout"**, so `2 × interval < timeout` is what is asserted now.

| Mutation | Result |
|---|---|
| interval 31 min against a 60 min timeout — one tick fits, two misses do not | `failures=2`: *"only 1 re-arm(s) fit inside one timeout"* and *"two missed ticks would outlast the lock"* |
| restored | `tests=12 failures=0` |

31 is the number to notice: it passes `interval < timeout` comfortably and fails both real
assertions.

### 3. Installed, and the two autostart routes raced

```
11:59:54.905  I [autostart] PACKAGE_REPLACED: 1 paired device(s), link not running — starting LinkService
11:59:54.911  I [autostart] LISTENER_REBIND: 1 paired device(s), link not running — starting LinkService
11:59:54.950  I [service]   Foreground as PACKAGE_REPLACED, types=0x10
11:59:54.961  I [server]    Listening on 42501/42502/42503, 1 paired device(s)
```

Both routes read `running == false` **6 ms apart** and both called `startForegroundService`. The
idempotence gate is a read, not a lock, so it does not prevent this — the same two-callers-one-state
shape as the Files pane's race, arriving in code written this morning.

**The outcome is correct and the reason is worth writing down rather than trusting:** Android
serialises `onStartCommand` for one service, and the second start finds `isForeground` already true
and skips `startForeground` — so one `Foreground as` line, one listener bind, one start reason, and
no duplicate. It is recorded as *observed to be harmless* rather than *designed to be*, because the
thing making it safe is the platform's serialisation and not this code.

`link-up.sh`: three OKs. Grants diffed **identical** to the previous snapshot.

---

## Phase 7 · Slice 5 — the Files probe was failing, and the product was fine · 2026-09-02

The final verification run reported `files-pane-probe.mjs` → **4 CHECK(S) FAILED**, with
`Camera lists its first page → 1` where an earlier run the same morning had read `200 → 400`. That
looks exactly like a regression from the day's renderer work.

**It was not. Every one of the four was the instrument.**

### 1. Establishing that first, before touching anything

The pane's own state, read out of the live view object rather than inferred from the DOM:

```
fetch: {"kind":"ready", roots:[5 roots …]}   advertised: true   selectedRoot: saf:primary%3ADocuments
entries: 1        inFlight: false            unavailableReason: null
```

and the DOM agreeing with it: `#files-roots` with **5** children, `#files-state` hidden,
`files.rail === document.getElementById('files-roots')`. The Mac's own log had
`fs.list roots → 5 root(s)` and `fs.list saf:primary%3ADocuments/ → 1 entries` — Documents genuinely
holds one file. **The `1` the probe reported was Documents' single entry**, read while the probe
believed it was in `DCIM/Camera`.

**One of my own readings on the way there was wrong and is worth recording**: a first pass scoped
`.files-root-name` to `section[data-screen="files"]` and got zero, which looked like a pane drawing
nothing. The rail is not inside that section. That is the third time in this repo a query has been
scoped to a container that does not hold its target, and the fix is the same each time — narrow to
the element, then assert the element is what you think it is.

### 2. Three faults in one function, all the same rule

`openCameraIfNeeded()` puts the pane in `DCIM/Camera`. It early-returns when the pane is *already*
there — which it was on every run that followed another run, so all three faults were invisible
except from a cold start. **A cold start is what a stranger has.**

| | The fault | The rule it breaks |
|---|---|---|
| 1 | *Select the DCIM root* waited for `count('.files-row') > 0` — **already true** on any non-empty folder. The act "landed" instantly, the DCIM listing was still in flight, and the next step searched the *previous* folder's rows | The instrument must verify its stimulus took effect. Same as `KEYCODE_BACK` in DocumentsUI, where an absent log line was read as a branch that did not run when the action had simply not happened |
| 2 | It clicked into `#files-roots` before the rail had populated, so `find` returned `undefined`, nothing was clicked, and the `expect` then polled for a navigation that was never started | A stimulus applied to a surface that has not been drawn is not a stimulus |
| 3 | Waiting on the crumb alone — the crumb updates when the root is *selected*, before `fs.list` answers — so the `Camera` row was looked for in an empty table | Same rule, one layer down: wait for the listing before clicking a row |

Plus a bound that was simply too small: `within: 20000` against this section's own recorded
**16,981 ms** cold snapshot rebuild. Twenty seconds is that plus three, which is the worst shape a
check can have — green whenever it has been run before.

### 3. What it does now

It **says so**. Each navigation step reports `could not select the DCIM root — nothing below is a
reading` / `could not open DCIM/Camera` and counts a failure, instead of proceeding to measure the
wrong folder. That is the whole improvement: the intermediate versions still failed, and each one
failed *legibly*, which is how the three faults came out one at a time.

```
COLD-START exit: 0
=== ALL CHECKS PASSED — 10 readings, 0 not reportable ===      12 PASS lines
```

One run, freshly launched app, no warm-up.

### 4. The thing to take from it

`CLAUDE.md` already carries *"every bound the instrument imposes must appear in what it reports"*.
This adds the neighbouring one: **an `expect` that is already satisfied before the stimulus is not
a bound at all — it is an assertion that time passes.** The tell is that it never fails, and the
second tell is an early-return that makes the whole path unreachable on any run but the first.

It also cost a real scare — four failures that read as a renderer regression on the morning after a
night of renderer changes, at the exact moment when believing them would have been most reasonable.
The thing that settled it in ten minutes was reading the view's own state and the Mac's log before
touching the code.

---

## Phase 6 · Slice 5 — the reboot, and what a green run did not prove · 2026-09-02

The restart the user performed by hand, at 12:40. It is item 1 of `docs/RESUME.md`'s three, and the
only stimulus that can produce `BOOT_COMPLETED` — a protected broadcast, with `adb root` refused on
this production build and `am broadcast` denied at uid 2000.

### 1. The result, and it passes

`scripts/link-up.sh`, nothing tapped on the phone:

```
uid      com.chetan.connectsuite.debug = 11011   ← the control for readings 2 and 3
OK       1. ServiceRecord present, isForeground=true, createTime=-3m44s375ms
OK       2. 42501/42502/42503 all LISTEN under uid 11011
OK       3. 1 control session(s) ESTABLISHED on 42501 under uid 11011
```

`LinkBootReceiver` received the broadcast. That was genuinely unknown beforehand — the receiver had
never been exercised by the event it exists for, and three separate platform rules could have
prevented delivery (protected broadcast, FBE deferring to first unlock, the stopped-app state).

### 2. Two failed readings before the real one, both mine

Before the pass, two readings that would have been recorded as failures.

| Reading | Reported | Actually |
|---|---|---|
| `run-as com.connectsuite.app … grep -c '\[boot\] BOOT:'` | `0` — the boot path did not run | **the package does not exist.** This app is `com.chetan.connectsuite.debug`; `run-as` failed and the count was of nothing |
| `grep '\[boot\]' files/logs/link.log` on the right package | `0` — still nothing | **the tag is `autostart`.** No line in this codebase has ever contained `[boot]`. `docs/RESUME.md`'s pass criterion named a string the code does not write |

Both are the same family as everything in `CLAUDE.md`'s table: a clean, specific, confident answer
from a query that could not have returned anything else. The second is the more interesting, because
the criterion was written down *in this repository, three days ago, as the definition of the pass* —
so the wrong string had already survived one review.

**The control that caught it cost one command:** ask whether the log has any lines at all.

```
-rw------- 1 u0_a1011 u0_a1011  65796 2026-09-02 12:43 link.log     ← 439 lines, written 0 min ago
$ run-as com.chetan.connectsuite.debug grep -c 'clip' files/logs/link.log
39
```

A file with 439 lines and 39 `clip` matches is a file the grep can read. Only then is a zero for
`[boot]` a reading about the boot path rather than about the query.

**The rule this earns:** *a pass criterion naming a string the code does not write is a test that
can only fail.* It belongs beside the existing enforcement-point rule, because the fix is the same
shape — the criterion should have been derived from the source (`LinkLog.i("autostart", …)`) rather
than written from memory into a document nothing checks.

### 3. What the pass does not prove, which is defect 64

The boot window, in full:

```
12:41:04.355 I [autostart] LISTENER_REBIND: 1 paired device(s), link not running — starting LinkService
12:41:04.468 I [service]   Foreground as LISTENER_REBIND, types=0x10
12:41:04.504 I [server]    Listening on 42501/42502/42503, 1 paired device(s)
12:41:08.218 I [autostart] BOOT: already listening — nothing to do
```

**The BOOT branch arrived 3.9 seconds too late to do anything.** The notification-listener rebind —
defect 62's route — had already started the service, so `ensureRunning` took the early return and
`startOrLog` was never called with `LinkStartReason.BOOT`.

So the run proves the receiver is registered, delivered to, and executing. It proves **nothing**
about:

- `foregroundTypesFor(BOOT)` claiming `connectedDevice` only, written narrow because
  `FGS_BOOT_COMPLETED_RESTRICTIONS` is live for this package and its denial set is readable nowhere;
- whether a `startForegroundService` from a boot broadcast is permitted on this handset at all. The
  2026-09-02 success came under `PROC_STATE_BFGS`, a procstate held *because* the listener had just
  rebound.

And the uncomfortable part: with the notification listener enabled — which it is, and which every
real user of this app will have — the rebind may **always** win. The BOOT start path is then not
dead code but code whose activation requires a configuration this phone is never in.

### 4. The rule, which is the reason this slice is written up at all

> **A fix verified only at the moment it fires is not verified against the state it was meant to
> prevent.**

Second occurrence in two days, and the first one was sharper. Defect 61's first fix re-acquired the
wake lock only on `!isHeld` — repairing a lapse rather than preventing one — and the overnight run
caught it at **59m49s against a 60-minute timeout**, eleven seconds from the gap opening. Both fixes
were correct code. Both ran in a state that could not distinguish them from the broken version:

| | The state it was meant to prevent | The state it was observed in |
|---|---|---|
| defect 61, first fix | a lock that has lapsed, leaving a gap | a lock about to lapse, repaired in time by accident of sampling |
| defect 60, boot half | a phone that boots with nothing listening | a phone already listening when the branch ran |

The question to ask before recording a fix as proven is not *did it pass* but **what state was the
machine in when this ran, and is it the state the defect describes?** A green reading taken in the
wrong state is not weak evidence — it is evidence about something else, which is the same failure as
every row in `CLAUDE.md`'s lookalike table, one level up from the query and inside the experiment.

### 5. The reinstall half, measured again

`adb install -r` at 13:01, with the grant set diffed before and after:

```
grants before: 28 granted=true
grants after:  28 granted=true      diff: (none)
13:01:20.015 I [control] Handshake complete with Chetans-MacBook-Pro at 10.135.144.88
13:01:20.474 I [nsd]     Registered as ConnectSuite Samsung SM-S938B
link-up.sh: OK 1 / OK 2 / OK 3, createTime=-10s403ms
```

The `MY_PACKAGE_REPLACED` path brought the link back in ten seconds with nothing tapped, which is
the hole `CLAUDE.md` documents for `adb install -r` closed by measurement rather than by argument.

---

## Phase 7 · Slice 4 (continued) — F1 through F5 built, and the pages nobody had read · 2026-09-02

`docs/phase-7-pairing-flow.md` names seven items; five need no protocol change and all five are now
built. Defects 63, 65 and 66 come out of this slice.

### 1. What was built

| # | Item | Where |
|---|---|---|
| **F1** | A fifth onboarding page that ends on pairing, with a success state and a landing tab | `OnboardingCopy.pair`, `PairPage`, `OnboardingOutcome` |
| **F2** | The Mac tab reordered: state → action → paired list → **Advanced**, collapsed | `LinkRoute.kt` |
| **F3** | The security-note copy corrected — defect 63 | `OnboardingCopy.welcome` |
| **F4** | A clock on the phone's silence, with the network hint past 20 s | `LinkWaitStatus.Waiting` |
| **F5** | The refused handshake reaching the screen | `LinkWaitStatus.Refused`, `RefusedConnection` |

### 2. Defect 63 was reported slightly wrong, and the correction matters

The register said *"describes a pairing flow this app does not have"*. Read against the code that is
not true: `PairingRequestDialog` shows an 8-group `displayFingerprint` with Accept/Decline,
`DevicesScreen` shows this device's own `Key …`, and `PairingManager.acceptPairing` pins what the
peer actually presented. **That flow is shipped and works.** It is the *Sync* path — v1, Android to
Android.

What is wrong is that onboarding's subject is the **Mac**, whose pairing is a QR the phone scans with
no confirmation anywhere. So the sentence is a **true statement about the wrong one of two paths**,
which is worse than a false one: a false sentence gets deleted, an unqualified true one survives
review. The replacement names its path.

It also scopes the guard: *"a key confirmed on both screens"* is forbidden **in onboarding copy**,
not in the app at large, where it describes something real.

### 3. The pass over all four pages found two larger defects — 65

63's own fix direction asked for a pass over all four pages rather than a patch to the one reported.
Doing it found:

- **page 1**: *"See and control another Android device's screen from here. No root; the target needs
  debugging enabled once."*
- **page 3, entire**: tap Build number seven times → enable Wireless debugging → run
  `adb tcpip 5555`.

Both describe the **v1 ADB mirror, deleted 2026-08-26**. The enumeration, which is the control for
the claim rather than a grep for an absence — searching `app/`, `core/`, `sync-module/`,
`mirror-module/`, `input-module/`, `desktop/src` for `tcpip`:

```
app/src/main/java/com/chetan/connectsuite/onboarding/OnboardingScreen.kt:238
```

One line, in the whole repository, and it was a sentence shown to users, in an app whose first locked
decision is *no ADB anywhere*. `README.md` carried the same in three more places.

**Nothing could have caught it: the `app/` module had no test source set at all.** 332 tests in this
project and not one could see a string in the onboarding flow.

### 4. The guard, and why it is about mechanisms rather than truth

*"Is this sentence true"* is not checkable. *"Does this sentence name a mechanism this app does not
have"* is. `OnboardingCopy.forbiddenMechanisms` holds seven, each with the decision it comes from.

Mutation results — the red-first requirement, seven of them:

```
=== BASELINE BEFORE: 8 tests, results 0.1s old, gradle exit 0        green
M1 the pairing sentence restored — defect 63 verbatim   RED: shipping copy names no mechanism…
M2 the adb tcpip instruction restored                   RED: shipping copy names no mechanism…
M3 the mirror-another-device claim restored             RED: shipping copy names no mechanism…
M4 a user-facing sentence written inline in the screen  RED: the screen holds no user-facing copy…
M5 the adb pattern deleted from the rule                RED: every forbidden mechanism has a pattern…
                                                             the checker catches every false statement…
M6 pairing no longer ends the flow                      RED: the flow ends on pairing
M7 the drift guard's own control weakened               RED: the literal scanner can see literals
=== BASELINE AFTER: 8 tests, results 0.1s old, exit 0                green — restored
```

**M4 is the one that matters most.** Without the drift guard the enumeration is a list the drawing
code need not use — the `icons.ts` failure, whose first guard enumerated only the sidebar and the
dock and passed with `capture` deleted. M7 breaks that guard's *own* control, to show the control is
load-bearing rather than decorative.

### 5. Three harness faults in this slice, all mine, all the same family

Recorded because `CLAUDE.md`'s eleventh table row was written about exactly this and it happened
three more times inside the run meant to honour it.

| The instrument | What it reported | What was actually true |
|---|---|---|
| `./gradlew … \| tail -35; echo "exit: $?"` | `gradle exit: 0` under a **compile failure** | `$?` was `tail`'s exit code. Gradle had failed |
| the mutation runner, without `--rerun-tasks` | baseline RED over unmutated source | Gradle served the **previous mutation's compiled classes**; the source was clean |
| the mutation runner, killed at a 2-minute timeout | *(nothing — it never printed)* | it left the source **mutated**, and the next run snapshotted that as pristine and baked it in |

The third is the worst and is a rule: **a harness that edits source must snapshot once, before it
touches anything, and restore under `finally` and `atexit`.** The version that snapshotted
per-mutation turned a timeout into a permanent edit that a later run then treated as the original.
The fix also prints the age of the results file and gradle's own exit code on every run —

```
gradle exit: 0
results: TEST-…OnboardingCopyTest.xml written 0s ago
tests="8" skipped="0" failures="0" errors="0"
```

— because `failures=0` from a build that never compiled is the most confident wrong answer in the
set.

**A fourth, in the documentation rather than the code**: a Python edit anchored as
`s[s.index('| **63** |'):]` — *from this row to the end of the file* — replaced **1,006 lines and all
30 defect records** with four table rows. `scripts/check-defects.sh` caught it immediately (12 rows
without records), which is the hook doing precisely the job it was written for, and `git checkout
HEAD --` restored it. The rewritten edit is bounded to a single line and asserts the file **grew**.
That assertion is the general form: *an edit that is meant to add must fail if the line count falls.*

### 6. F4 and F5: what the phone may and may not say

`LinkWaitStatus` is pure and lives in `core/`, because the `showsState` record in `CLAUDE.md` is
about a condition in a renderer that was got wrong twice in two slices with no test able to reach it.

Six mutations, all red on the right tests:

```
N1 the hint threshold inverted            RED × 4 (both sides of the boundary, plus the null case)
N2 the refusal never expires              RED: an old refusal expires back into the wait
N3 the refusal checked after the clock    RED × 2
N4 unknown start time = a long wait       RED: an unknown start time withholds the hint
N5 connected no longer beats refused      RED: a refusal never displaces a live connection
N6 the hint stops naming Wi-Fi            RED: a long wait offers the network hint
```

**The copy is deliberately conditional.** J6 (*scanned, wrong network*) and J2 (*scanned, Mac
searching*) are both silence on the accept loop and nothing on this device separates them, so the
phone says *"if it stays like this, check that your Mac is awake and on the same Wi-Fi"* rather than
diagnosing. That is the folder-picker rule — when the platform returns one result for two intents,
nothing may be explained afterwards — and the test asserts the conditional wording, not merely that
some hint appears.

### 7. Status, stated plainly

| | |
|---|---|
| Unit tests | **343**, 0 failures (`app` 8 + `core` 133 + `sync-module` 67 + `mirror-module`/`input-module` the rest), no results file older than the run |
| On the phone | The **13:01 install carries F1, F3 and F5's copy fixes only** — defects 63 and 65 |
| Not on the phone | **F2, F4 and F5** (defect 66) are built, unit-tested and **unverified on hardware.** The device left the USB bus at ~13:05 and `adb devices` has been empty since |

Nothing in §6 has been seen on a screen. It is written down here as built-and-untested rather than
as done, because a unit test on `LinkWaitStatus.of` proves the decision and says nothing about
whether the card draws.

### 8. On hardware, 2026-09-02 13:30 — F2 drawn, F4 and F5 still only in tests

The device returned to the USB bus and the build was installed. Preserved state, as the reinstall
claim requires:

```
grants before: 28 granted=true      grants after: 28      diff: (none)
enabled_notification_listeners  → …/NotificationMirrorService   (1 match, before and after)
enabled_accessibility_services  → …/ConnectSuiteInputService    (1 match, before and after)
link-up.sh: OK 1 / OK 2 / OK 3, createTime=-12s208ms
```

**The control for "the new code is the code running"** — a checksum, not an inference from
`Success`:

```
installed  /data/app/~~lLjqqZ…/base.apk   md5 3b82e8609cdc29c8739f504a32736493
built      app/build/outputs/apk/debug/app-debug.apk   3b82e8609cdc29c8739f504a32736493
```

Identical. Per this file's own rule that a checksum proves the code is *on the phone* and nothing
more, the screen was then read.

**A wrong-surface reading first, caught by its own control.** The first `uiautomator dump` returned
**282 nodes** and contained no `Sync`/`Mirror`/`Mac` tab at all — one sentence from *"the reordered
tab did not render"*. The dump was of the **notification shade**, pulled down over a perfectly
healthy app: `topResumedActivity` was `MainActivity` throughout, and the 282 nodes were Samsung's,
carrying `'airtel'`, `'Battery charging, 78 percent.'` and a screenshot notification. The node count
passed as a control and was measuring the wrong surface, which is the Files-pane `querySelector`
failure with a different instrument.

`cmd statusbar collapse`, then re-dump: **71 nodes, `packages: {'com.chetan.connectsuite.debug'}`**
— one package, which is the control that says the dump is of the app and only the app.

**The Mac tab, tapped by its dumped bounds** — one candidate matched `Mac`, so the target was
unambiguous rather than remembered:

```
candidates matching "Mac": 1     bounds (1164,2944)(1255,3004) -> center (1209,2974)
```

**F2, in document order, collapsed (the default):**

```
Connected to Chetans-MacBook-Pro      ← the status card, first
Pair another Mac                      ← secondary, because a Mac IS paired
Paired Macs / Chetans-MacBook-Pro / Key 3030c8ebcddcd0fb… / Forget
Advanced                              ← and nothing below it
```

The ports line is **genuinely absent** from the dump, which is the claim: not styled away, not
scrolled off — not drawn. Expanded:

```
Advanced
Ports 42501, 42502, 42503 · protocol v1
Available to the Mac: calls, clipboard, contacts, files, mirror, notifications, photos, remote, sms
Not offered yet: apps, input, mic — 2 not built, 0 awaiting a permission.
Restart listening
```

Nothing was deleted; it is one tap away. Both directions of the fold were exercised.

**What this run did NOT see, stated because the screenshot looks like a pass for all of it.** The
card reads `Connected`, which is the branch *before* both of the states F4 and F5 exist for:

| | Needs | Seen |
|---|---|---|
| `Waiting`, no hint | the Mac stopped, < 20 s | no |
| `Waiting` + network hint | the Mac stopped, ≥ 20 s | no |
| `Refused` | an **unpaired** Mac attempting a handshake | no |

All three are covered by `LinkWaitStatusTest` and none has been drawn. The `Refused` branch is the
harder of the two to stage — it wants a second Mac, or this one with its trust entry forgotten —
and until it is drawn, defect 66's *screen* half rests on a unit test of the decision plus a
hardware reading of a different branch of the same `when`.

That is the same distinction this file has now made three times in two days: the code is proven, the
**state** is not, and a card that renders correctly for `Connected` is not evidence that
`Refused` renders at all.

---

## Phase 9 · Slice 2 — what a stranger actually hits, measured · 2026-09-02

Asked: *what is left before someone who isn't me can install this and pair a phone?* Answered by
running the checks rather than reasoning from the audit, which turned up two blocks nobody had
recorded.

### 1. The Mac: Gatekeeper returns an error, not a verdict

```
$ codesign -dv ConnectSuite.app
Identifier=Electron                          ← electron-builder's default, not com.chetan.connectsuite.desktop
CodeDirectory … flags=0x20002(adhoc,linker-signed)
Signature=adhoc
Info.plist=not bound

$ spctl -a -vvv -t exec ConnectSuite.app
ConnectSuite.app: code has no resources but signature indicates they must be present
```

**Two controls, both clean**, which is what makes the third line a reading:

```
/System/Applications/Calculator.app: accepted    source=Apple System
/Applications/Google Chrome.app:     accepted    source=Notarized Developer ID
```

And a **wrong control caught first**: the initial check used `spctl -t install`, under which
Calculator is *also* `rejected` — the assessment type is for installer packages, so ConnectSuite's
answer under it was uninterpretable. The control failing is what said so. `-t exec` is the type for
an application bundle, and under it the controls pass and ours errors.

**Quarantine makes no difference**, which was the specific thing worth testing: a copy carrying
`com.apple.quarantine: 0081;…;Safari;` — the attribute a real download gets — returns the identical
error. So the existing note that the `.dmg` *"launches from `/Applications`"* is true and narrow: it
was measured on a locally built copy that never had quarantine, and says nothing about a downloaded
one.

**Why this is worse than unsigned**, and the reason it is D12 rather than a footnote on D3: an
*unidentified developer* app gets the right-click → Open bypass and a "cancel / open anyway" dialog.
A **broken** signature does not — the user is told the app is damaged and should be moved to the
Trash, and the only way through is `xattr -cr`, which is not something to put in a README for
non-technical users.

### 2. The phone: the release APK is refused by the platform

Not policy, not Play Store — the installer:

```
$ adb install app-release-unsigned.apk
Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES: Failed to collect certificates …]
```

`keystore.properties` is absent by design and `.gitignore`d, so the release build assembles unsigned
rather than silently falling back to the debug key. That is the correct behaviour — a debug-signed
APK shipped to users would be far worse — and it is also an absolute block. **The 25 MB release APK
in the audit has never been installed by anything, and cannot be.**

### 3. What this changes about the audit

D3 was closed on 2026-09-02 as *"an unsigned `.dmg` that launches from `/Applications`"*. That
sentence is accurate about the artifact and was read as *"the Mac app can be handed to someone"*.
It cannot be. The two rows added here — D12 and D13 — are the measurements that separate *"an
artifact exists"* from *"an artifact installs"*, and both were one command away for a week.

The general form is the one this file keeps arriving at from different directions: **a build
succeeding is not a build working, and the check for the second one is to try the thing the user
will do.** Building a `.dmg` and opening it locally exercises neither the signature nor quarantine —
the two mechanisms that exist specifically to treat a downloaded file differently from a local one.

---

## Phase 7 · Slice 6 — F4 on a screen, and the defect eleven green tests could not see · 2026-09-02

Asked for F4 to be *seen* rather than trusted, since neither it nor F5 had ever been drawn. Putting
it on a screen found defect 67 in the first sample.

### 1. The reading that broke it

Mac app stopped, phone's card sampled:

```
t+  2s  'Listening for your Mac'   hint=Nothing has connected yet. If it stays like this…
t+ 38s  'Listening for your Mac'   hint=…
```

The hint is supposed to be absent for twenty seconds. It was there at two. The log gave the cause in
two lines fifteen minutes apart — `Listening on …` at 13:29:56, `Session … ended` at 13:45:04 — and
the clock was measuring from the first.

### 2. Why the tests were no help, which is the part worth keeping

`LinkWaitStatusTest` had **eleven tests, green, six mutations, both sides of the boundary covered**,
over a feature that was broken for every user. They were not weak: they call the real decision
function rather than restating it, which is the failure this file warns about elsewhere.

They were green because they hand `LinkWaitStatus.of` the very field the product fills in wrongly.
The decision was always right. The **write** was wrong, and a pure function given hand-made inputs
cannot see whether anything real produces them.

Third variety of untestable-by-construction, and the least visible of the three:

| Failure | The test's relationship to the rule |
|---|---|
| `MediaPayloadsTest` v1 | restated the rule — deleting the real one left it green |
| `showsState` | the rule lived in a renderer no test could reach |
| **defect 67** | **called the rule correctly, at a layer the defect was not in** |

**The first fix attempt repeated the mistake.** Two tests were added asserting a fresh wait carries
no hint however long the phone has been up; the original bug was then mutated back in and the suite
stayed **green**, because both new tests still supplied the field by hand. Only that mutation run
forced the real fix — extracting `LinkState.afterSessionEnded` and `afterListeningStarted` so a JVM
test can reach the transition. Three mutations, each red on exactly one test, all three green before
the extraction. 16 tests now.

### 3. Re-measured on hardware

Mac reconnected, dropped again, card sampled every ~6 s:

```
t+  2s  hint=absent      t+ 14s  hint=absent      t+ 27s  hint=SHOWN
t+  8s  hint=absent      t+ 21s  hint=absent
```

**The instrument's bound, reported:** sampling is ~6 s, so this establishes *absent through t+21s,
present by t+27s*. It does **not** establish the hint fires at exactly 20 s and must not be read that
way.

Every navigation in this run used a target resolved from a `uiautomator` dump with exactly one
candidate. One tap was **refused** — the regex had dropped the `text=` alternative and matched
nothing, so `input tap` got no coordinates and errored rather than guessing. The gate working.

### 4. The rule

**A pure decision function proves the decision. It proves nothing about whether the product ever
puts the machine into the state the decision is about.** When the defect is about *when* something
becomes true rather than *what* is said about it, the test must reach the transition — and if the
transition lives where a test cannot go, that is what to fix before writing more tests about the
decision.

The tell: **every test constructs its input by hand.** Normal, usually fine, and exactly what makes
the layer confusion invisible — the inputs are always well-formed, so *does anything real produce
these?* never gets asked.

---

## Phase 9 · Slice 3 — the signed APK installs, and a stranger's first run · 2026-09-02

### 1. D13 closes on a working install

```
$ ./scripts/target-device.sh
OK    target RZCY12330DT (SM-S938B, sdk 36)

$ adb -s RZCY12330DT install app/build/outputs/apk/release/app-release.apk
Success
Install command complete in 790 ms

$ adb -s RZCY12330DT shell pm list packages | grep chetan.connectsuite
  com.chetan.connectsuite.debug
  com.chetan.connectsuite
```

`dumpsys package` reports `apkSigningVersion=4` and one signature — the `.idsig` beside the APK is
v4 incremental signing, accepted on top of the v3 block `apksigner` verified. RSA 4096, DN
`CN=Chetan, OU=ConnectSuite…`, config read from `~/.android-keystores/connectsuite.properties`
outside the repository.

**The control that was missing on the OPPO ran first this time**: `pm list packages` showed the
debug build before the install. On the wrong phone that same query returned nothing and was read as
a bad grep — defect 68.

**And the pin's own ergonomics were a defect.** Its first version printed `-s <serial>` for callers
to splice in as `adb $TARGET install …`. That works in bash and silently does not in **zsh**, which
performs no word splitting on unquoted expansions: the pair arrives as one argument and adb answers
`-s requires an argument`. It prints **just the serial** now, called as
`adb -s "$(scripts/target-device.sh)"`. A guard that is awkward to call is a guard people route
around, and routing around this one is how the OPPO nearly got an install.

### 2. A stranger's first run, walked on hardware

The release `applicationId` has no `.debug` suffix, so it installs alongside as a separate app with
no grants and no pairing — a genuine first run. `pm clear` reset it after an accidental completion;
the debug app's 28 grants were verified untouched.

All five pages render, in order, with the corrected copy:

| | |
|---|---|
| 1 | ConnectSuite · the two feature cards · the rewritten pairing sentence |
| 2 | Finding your Mac · two permission cards · Skip for now / Continue |
| 3 | About mirroring · *Android asks every time* · *Some things stay black* |
| 4 | Keeping it running · battery card · manufacturer card |
| 5 | **Connect your Mac** · I'll do this later / **Scan the code** |
| → | *Pair with your Mac* — camera live, QR scanner running |

Defect 65 is gone from the shipped build: no page mentions ADB, developer options or a second
Android device.

### 3. What is confusing, recorded before anything was fixed

Three findings, and **two of them are mine, introduced by the fix that produced this flow**:

- **Defect 69 — page 2 asks for Wi-Fi Direct on a page about the Mac.** The `NEARBY_DEVICES`
  rationale is accurate and describes the **v1 Sync** discovery path; the only `WifiP2p` consumer in
  the tree is `core/discovery/WifiDirectDiscovery.kt`. Retitling the page from *"Finding your
  devices"* to *"Finding your Mac"* made a correct sentence false **without touching it**. That is
  defect 63's shape, committed three commits after 63's own record warned about it: **a sentence's
  truth depends on the heading above it.** Unmeasured and free to measure: the release app has
  `NEARBY_WIFI_DEVICES` `granted=false` right now, so pairing it answers whether the v2 link needs
  the permission at all.
- **Defect 70 — the QR screen's title is painted under the status bar.** `QrScanScreen` is the only
  screen with no `Scaffold` and no `systemBarsPadding()`. **No dump could have found it**: the node
  is present, correctly bounded, correctly texted, and drawn beneath the clock. It took a
  screenshot. The mirror image of the grid-tile defect, which took a measurement over an eye — a
  dump carries no z-order, a screenshot carries no scale, and neither instrument substitutes for the
  other.
- **Defect 71 — "Sync" names two things and onboarding uses the wrong one.** Page 1 sells *"Sync —
  notifications, texts, calls, photos, files and clipboard, on the Mac"*; the app's Sync tab is the
  v1 Android-to-Android device list, `Not paired · 100.113.127.25 [Pair]`. **And "I'll do this
  later" lands there** — F1 sends a paired user to the Mac tab and an unpaired one to Sync, so the
  person who deferred because they have not installed the Mac app yet gets the screen least able to
  help them. The working half of F1 is the half for users who no longer need it.

Page 5 is also visually the emptiest screen in the flow — a title, a subtitle, one grey line, then
roughly a third of the display blank above the buttons — which is the wrong shape for the page the
whole flow now exists to reach. Recorded as an observation rather than a defect; it is a design
question, not a mechanism failing.

---

## Phase 7 · Slice 7 — the apps measurement, and revoke proven to revoke · 2026-09-03

### 1. Revoking trust now ends the session — defect 75, measured

```
before   OK   3. 1 control session(s) ESTABLISHED on 42501 under uid 11011
00:17:46.711  I [trust]   Forgot 3030c8ebcddcd0fb7ec2118e171ea70acc19b3971a7c63bd6d2b31cc1da5826c
00:17:46.712  I [trust]   Forgot 3030c8ebcddcd0fb… and closed 1 live session(s) — 0 other session(s) left alone
00:17:46.716  W [control] Chetans-MacBook-Pro socket dropped :: SocketException: Socket closed
00:17:46.721  I [clip]    Link dropped; cleared 1 clipboard entries
00:17:47.768  W [server]  Refused 10.135.144.88, key 30:30:C8:EB… — 1 refused / 1 accepted since start
after    FAIL 3. no control session on 42501 — the server is up but no Mac is attached
```

Revoke to closed socket in **1 ms**, clipboard cleared in 10 ms, next reconnect refused a second
later. Before the fix the same tap left the session `ESTABLISHED` for over a minute with full access.
The `link-up.sh` FAIL line is the pass condition here, which is worth saying out loud so nobody
"fixes" it later.

### 2. Q1 — the `<queries>` block is load-bearing, and yields the whole launcher set

| | with `<queries>` | without it (R3) |
|---|---|---|
| R1 `getInstalledApplications` + launch intent | 134 | **24** |
| R2 `queryIntentActivities(MAIN/LAUNCHER)` | **122** | **15** |

Ground truth recounted in the same unit — distinct packages, not activities — is **122**. R2 returns
122 of 122.

**R3 cost two rebuilds and is the only reason this is evidence.** 122 alone is consistent with the
manifest working *and* with this OEM simply not filtering; 15 without the block separates them.

**Three faults in my own instrument, all caught before they became findings:**

1. **A units error.** The first ground truth was 244 — *activities*, against two app-side readings
   in *packages*. It would have reported "134 of 244" and hidden a perfect result behind a fictional
   45% gap.
2. **A control that could not pass**, twice. `com.android.systemui` and then
   `com.sec.android.app.launcher` were used as known-present packages; **neither has a launcher
   activity** — the launcher appears 0 times in its own list. A control must be something the query
   is *supposed* to return, or its failure says nothing. With three confirmed packages: `3 of 3`.
3. **A premise the instrument could not observe.** Q2 gated on process importance and refused every
   reading with `importance=125 (backgrounded=false)` — because this app holds a **foreground
   service** whenever the link is up, pinning importance at `IMPORTANCE_FOREGROUND_SERVICE`,
   permanently below `IMPORTANCE_VISIBLE`. Importance cannot answer *is my activity on screen*. The
   activity's own `onStop` can.

### 3. Q2 — the fourth row, silently

```
Q2 state       : activityStopped=true, importance=125 (context only)
Q2 startActivity threw : no
Q2 came to front (dumpsys witness): false
VERDICT: THE FOURTH ROW
```

Independent witness, from the shell rather than the probe:

```
topResumedActivity=… com.sec.android.app.launcher/.activities.LauncherActivity
```

The launcher was on top; `com.android.settings` never appeared. `startActivity` **did not throw, did
not warn, and did not launch** — and the probe's own in-process `getRunningTasks` reported our
package before *and* after, exactly as its comment predicted, because it is restricted to our own
tasks. The shell reading is the witness of record and the probe says so on the line.

### 4. What the run decides

Rows 3 and 4 of the pre-registered table turned out to be **two different questions**:

- **the mechanism is row 4** — refused silently — which forbids `apps.launch` outright;
- **the product is row 3** — the notification path — which the silent block cannot affect, because
  it never calls `startActivity` from the background.

Row 4 is a prohibition on a *name*, not on the feature. The names were fixed in `docs/protocol.md`
**before** this ran, which is the only reason that distinction is available now rather than being
argued over a half-built verb.

**R6 (screen off) was not run and cannot change the answer**: screen-on is already blocked, and no
Android release grants a backgrounded app more activity-start privilege with the screen off. Stated
rather than left as a silent gap.

---

## Phase 7 · Slice 8 — apps built, and three instrument faults on the way to one measurement · 2026-09-03

Slice 7 measured the wall. This slice builds the feature the measurement allowed: `apps.list`,
`apps.icon`, `apps.open.ask`, a twelfth nav row on the Mac, and a commit hook that keeps the verb the
measurement forbade out of the tree.

**Nothing here re-argues the wall.** It was measured, it is in Slice 7, and `docs/protocol.md` now
carries the contract. What is new is the build on top of it and the four readings that check it.

### 1. Enumeration — 123 of 123, in the unit the app reports

Ground truth, counted **twice on purpose**, because the first version of this comparison would have
invented a defect:

```
$ adb -s RZCY12330DT shell cmd package query-activities -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER | grep -c packageName=                       → 246 ACTIVITIES
$ … | grep -o 'packageName=[^ ]*' | sed 's/packageName=//' | sort -u | wc -l         → 123 PACKAGES
```

CONTROL — three packages known to be launchable, asserted by name rather than by count:
`com.android.chrome`, `com.android.settings`, `com.chetan.connectsuite.debug`, all present.

The phone, through the shipping path, on the same device, same minute:

```
[apps] Enumerated 123 launcher packages — 123 labelled / 0 fell back to the package id.
       This counts PACKAGES; `adb shell cmd package query-activities` counts ACTIVITIES
       and is a larger number for the same phone.
[apps] apps.list → 123 of 123 packages in 1297ms
```

**123 of 123, and 123 of 123 labelled.** Not one package fell back to its own id, which is the
reading that says the `<queries>` block is doing its job — Slice 7's R3 control established that
without the declaration the same query returns 15.

**The units line is in the log because the comparison nearly went the other way.** 123 against 246
reports a 45% package-visibility gap that does not exist, and — the dangerous part — that fictional
gap is exactly the shape of defect 28, a real and well-known bug. It would have read as a diagnosis
rather than as an arithmetic error. Now a rule in `CLAUDE.md`.

Second and third `apps.list` calls: **29 ms** and **50 ms**, against 1297 ms cold. The first call
pays for 123 `getApplicationInfo` lookups; `AppLabels` caches successes, so the rest are free. Timing
is published beside the count per the pager rule — this list does not page, and the reason it does
not is in `docs/protocol.md`.

Icons: four batches of `apps.icon`, **32 / 32 / 32 / 27 made, 0 failed of 123 asked**, edge=96.

### 2. The grid, read through `scripts/apps-pane-probe.mjs`

Every number below carries a control and says how it stopped.

```
app tiles drawn in the grid                              → 123  [control=1   stopped=settled]
distinct package handles among those tiles               → 123  [control=123 stopped=immediate]
tiles whose label is a resolved name, not the package id → 123  [control=123 stopped=immediate]
tiles showing a real icon (an img with PNG data)         → 123  [control=123 stopped=settled]
tiles still waiting for an icon                          →   0  [control=123 stopped=immediate]
actionable controls that are not a tile or the search box→   0  [control=123 stopped=immediate]
```

**Three separate readings, because a tile count proves none of the claims.** 123 tiles is the same
number whether the grid holds 123 apps or 123 raw package ids, and the same number whether it holds
123 icons or 123 empty placeholders. So names and pictures are counted against their own
denominators, and the sum check — `123 drawn + 0 pending = 123 of 123` — is what says the reading
covers the whole grid rather than whatever was scrolled into view.

The last row is the pane's own prohibition, counted as **elements** rather than searched as text: no
retry, no queue, no "open" button. A `/open|launch/` text scan would have matched the banner
explaining that the phone is what opens an app, which is the fault that once matched an upload
affordance in the sentence apologising for its absence.

### 3. The tap, end to end, witnessed from the shell

`scripts/apps-open-ask-probe.mjs`, run twice on two targets:

| | Chrome | Settings |
|---|---|---|
| top before | `com.sec.android.app.launcher` | `com.sec.android.app.launcher` |
| notification posted | `"Open Chrome?"` | `"Open Settings?"` |
| channel / importance | `app_open_request` / 4 | `app_open_request` / 4 |
| **top after** | **`com.android.chrome`** | **`com.android.settings`** |

The witness is `dumpsys activity activities` from the shell, never the app: the phone's own log says
it *asked* and cannot say more, by construction, and an in-process `getRunningTasks` is restricted to
our own tasks. HOME is pressed first and the launcher confirmed topmost, so the reading has somewhere
to travel from — "Chrome is on top afterwards" means nothing if Chrome was on top before.

The notification's `PendingIntent` shows the allowlist that makes this legal, in the platform's own
words:

```
actions={ [0] "Open" -> PendingIntent{… startActivity
          (allowlist: …/NOTIFICATION_SERVICE/NotificationManagerService)} }
```

That is the difference between this and Slice 7's refusal, stated by the system rather than inferred:
the tap runs with a notification-granted background-activity-start allowlist; our own backgrounded
process has none.

### 4. Three instrument faults, all caught, all in one sitting

None of these was a product bug, and each was one sentence from being written down as one.

| The instrument | What it reported | What it was measuring |
|---|---|---|
| `expect: !toast.hidden` after clicking a tile | clicked "AdBlock", told "Sent — YouTube Music" | the toast was **already visible** from a click the *user* had made minutes earlier. The poll returned on its first sample |
| `grep channelId=app_open_request` | FAIL — wrong channel | the field is `channel=`. The notification was on exactly the right channel at importance 4 |
| one `uiautomator dump` 1.5 s after expanding the shade | "could not find the notification by name" | 285 nodes and no notification: the shade was mid-animation. **A tree that has not finished drawing is not a negative reading** |

The first is the newest shape and worth the entry: **CLAUDE.md's absence rule with the sign
flipped.** The catalogue is full of absences read as findings; this was a *presence* that was already
there. The question is the same one — *what else would satisfy this expectation?* — and the answer
was "any earlier click, including one a person made while you were not looking". Fixed by naming the
app in the expectation, so the state under test is *the toast is about the app I just clicked*.

### 5. And a fourth thing, which is Samsung's and is not a fault

**The first tap opened a notification group, not the notification.** With four or more notifications
outstanding from one package, One UI folds them into an auto-group whose collapsed header *previews
the newest one* — so a node reading `text="Open Chrome?"` at the top of the shade is the summary, and
tapping it expands the group. Measured: the node sat at **y=498 collapsed and y=679 expanded**, and
only the second tap reached Chrome.

This is the coordinate rule's failure mode **with the name correct**: the query matched exactly the
text it meant to, on a node that was a different thing. The probe re-reads the tree after each tap
rather than trusting a position, taps at most twice, and **prints how many taps it took** — because
"one tap opens it" is the product claim and a probe that quietly tapped twice would be concealing the
one thing worth knowing.

For a user this is the ordinary case only when ConnectSuite has four notifications outstanding at
once. It is not something this app controls, and it is recorded rather than worked around.

### 6. A renderer defect the view test caught before it shipped

`AppsView.refresh()` returned early on a failed `apps.list`, so the render at the end of the method
never ran and the pane kept what the render at the *top* had drawn. On a phone with the capability
off that is the *"your phone cannot show the request"* banner — so **a refused list would have been
reported to the user as a missing notification permission**: a confident, specific, wrong sentence
about a different problem, and precisely the two states this pane is required to keep apart.

Found by `appsView.test.ts` on its first run, before a commit. The redraw is in `finally` now. This is
the whole argument for `check-renderer-views.mjs`, which is also what forced the test to exist — it
refused the commit until `AppsView` had one.

### 7. Guards

| Check | Result |
|---|---|
| `node scripts/check-apps-verb.mjs` | 266 source files, **no `apps.launch` anywhere**; red on both sides under mutation, green after revert |
| `node --test scripts/check-apps-verb.test.mjs` | 14 fixtures, including *prose about the prohibition must pass* |
| `node scripts/check-protocol-spec.mjs` | 61 of 63 specified, 2 debt, 0 unaccounted; the three `apps.*` TWIN_EXEMPT entries pruned |
| `node scripts/check-clip-echo.mjs` | green — **after it refused a `lastSent` field in the new pane**, which was a genuine collision and produced the better name (`lastAsk`) |
| `:sync-module:testDebugUnitTest`, `:core:testDebugUnitTest` | gradle exit 0; `AppsContractTest` 5, `AppsPayloadsTest` 7, results file written 8 s before it was read |
| `npm test` (desktop) | **318 pass, 0 fail** |

---

## Phase 7 · Slice 9 — F2, F4 and F5 seen on hardware, and a verdict script that lied · 2026-09-03

F2, F4 and F5 of `docs/phase-7-pairing-flow.md` shipped on 2026-09-02 and had **never been run** —
the device left the USB bus before the build could be installed, and both `CLAUDE.md` and the flow
document carried *"F2, F4 and F5 are unverified on hardware"* for a day. All three are now on
screen. Installed through `scripts/target-device.sh` (RZCY12330DT, SM-S938B, sdk 36), 28 runtime
grants preserved across `install -r`. Screenshots: `docs/evidence/phase-7-f2-f4-f5/`.

The three strings were taken **from the source that writes them** — `LinkWaitStatus.kt` and
`LinkRoute.kt` — rather than typed from the proposal, because a pass criterion quoting a string the
code does not write is a test that can only fail (`[boot]` vs `[autostart]`, same file, one slice
earlier).

### 1. F2 — the Advanced fold

| Reading | Result |
|---|---|
| screen text, Advanced collapsed | 11 strings; order is state → action → paired list → **Advanced** |
| `Ports 42501` present, collapsed | **0** |
| `Ports 42501` present, expanded | **1**, with the capability list and *"Not offered yet: input, mic — 1 not built, 1 awaiting a permission."* |

The expanded reading is the control for the collapsed one: it proves the query that reported the
absence can see the content when it is there. `f2-advanced-collapsed.png`, `f2-advanced-expanded.png`.

### 2. F4 — the wait clock, sampled across the threshold rather than at it

**The first attempt held no reading and was discarded.** It sampled at exactly 20 s — the value of
`LinkWaitStatus.HINT_AFTER_MS` — so the hint was legitimately showing and the run said nothing about
whether it is *withheld* before then. That is the 263 ms window again: a sample on the boundary is a
missing reading, not a negative one. The window was re-opened deliberately (the Mac app relaunched,
allowed to reconnect, and cut again) rather than the poll being made faster.

Mac app quit at 01:25:21, `HINT_AFTER_MS = 20_000`:

```
  2s  headline="Listening for your Mac"  hintShown=0
  7s  headline="Listening for your Mac"  hintShown=0
 13s  headline="Listening for your Mac"  hintShown=0
 19s  headline="Listening for your Mac"  hintShown=0
 24s  headline="Listening for your Mac"  hintShown=1   ← "Nothing has connected yet. If it stays
                                                          like this, check that your Mac is awake
                                                          and on the same Wi-Fi as this phone."
```

**The four withheld samples are the evidence, not the fifth.** Defect 67's build showed the hint
instantly, on every phone, for every user — so an after-20 s screenshot alone cannot tell the fixed
build from the broken one. `f4-waiting-13s-no-hint.png`, `f4-waiting-24s-hint.png`.

### 3. F5 — a refused handshake reaching the screen

Two instrument faults, both in the probe, both caught before anything was written down.

- **The stimulus destroyed the state it existed to produce.** `LinkServer` only sets `lastRefusal`
  when it can read a certificate off the refused session (`prefix != null`). The first probe called
  `finish()` inside Node's `tls.connect` callback — which in **TLS 1.3 fires before the server has
  validated the client certificate** — and hung up. The phone logged
  `Refused …, no usable certificate` and set nothing. A probe that never presented a cert would have
  produced a clean, confident **false negative on the exact feature under test**.
- **The probe reported its own optimism as the far end's verdict**, printing `"result": "ACCEPTED"`
  for a connection the phone refused 4 ms later. Fixed to stay on the wire and read the alert:
  `ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN` (alert 46).

With the probe corrected, `scripts/support/refused-handshake-probe.mjs`:

```
01:29:14.121 W [tls]    Rejected unpaired client 07:63:A2:90:80:FE:8B:21…
01:29:14.125 W [server] Refused 10.135.144.88, key 07:63:A2:90:80:FE:8B:21… —
                        3 refused / 2 accepted since start
```

and on screen, in the error container:

> **A Mac tried to connect and was refused**
> It is not paired with this phone (from 10.135.144.88). Key 07:63:A2:90:80:FE:8B:21… — if that is
> your Mac, scan its code again to pair it.

**The discriminator is the key prefix, and it was predicted before the run.** `07:63:A2:90:80:FE:8B:21`
is the first 23 characters of the SHA-256 of the certificate generated for this probe. Because
`REFUSAL_VISIBLE_MS` is 60 s, a card on screen could otherwise be a stale refusal; matching the
prefix to a cert minted seconds earlier is what makes the reading about *this* stimulus.
`f5-refused-handshake.png`.

**What this does not prove.** The stimulus was a stranger with a self-signed certificate — one of
the two cases the copy names — and **not the Electron app**. The phone-side path is identical (it
reads whatever certificate the peer presented), and the same log shows the real Mac taking it at
`00:20:48` with `key 30:30:C8:EB:CD:DC:D0:FB…` while unpaired. Recorded rather than glossed, because
verifying a mechanism through a client the product does not use is how defect 50 happened.

### 4. The verdict script that lied, and it was mine

`scripts/defect64-read.sh` was written **in this same sitting**, to avoid the 2026-09-02 trap of
reading a boot pass off a no-op branch. On its first run it printed:

```
=> DEFECT 64 CLOSED: the boot path started the service and claimed connectedDevice only.
```

over a phone that **had not rebooted** and **still had the notification-listener grant enabled**.
The two lines it counted were from the previous day — lines 982 and 984 of a 3024-line file.

Two faults, and only the first is the obvious one:

1. **The greps had no time bound.** *"since boot"* appeared in the section headers and nowhere in
   the code. An artifact older than the run is a memory, not a result — the stale-XML row of
   `CLAUDE.md`'s own table, committed by the script written to avoid it.
2. **The controls were printed and then ignored.** `uptime` said 13 hours, the grant control said
   1 entry, and the verdict was computed anyway. That is the decoration rule exactly: a check that
   reads a target and acts regardless is not a safety measure, and it made the transcript *worse*
   than no check, because it shows the correct readings immediately above the wrong conclusion.

The rewrite makes the controls a **gate** — it exits 3 with `NO READING. Not a negative result: the
experiment did not run` — and bounds every count to lines written since the current boot, derived as
`device clock − /proc/uptime`.

**And the corrected reading found something the first version had buried.** There were two `BOOT`
events on 2026-09-02, not one:

| Time | Line | What it was |
|---|---|---|
| 12:41:08 | `BOOT: already listening — nothing to do` | **the real boot.** `uptime` puts boot at 12:40:05 — 63 s earlier. This is defect 64 |
| 17:48:15 | `BOOT: 1 paired device(s) … starting LinkService` + `Foreground as BOOT, types=0x10` | **not a boot at all** — uptime rules it out. A synthetic `QUICKBOOT_POWERON`, racing `LISTENER_REBIND` in the *same millisecond*; BOOT happened to win |

So the `BOOT` branch and the `types=0x10` claim are **reachable and correct** — proven by the
synthetic broadcast — and **defect 64 remains open**, because what is unproven is that a *real* boot
reaches them when the listener rebind is also armed. On the real boot it lost. Those are two
different claims and the first version of the script merged them into one number.

### 5. Guards

- `scripts/support/tap-named.sh` — taps a view by text or content-desc resolved from a fresh
  `uiautomator dump`, and **refuses on 0 matches or >1 matches** rather than taking the first. A tap
  that lands on whichever of two nodes came first in the dump is a coordinate guess wearing a name.
- `scripts/defect64-read.sh` — gates on uptime and on the grant, and reports the branch rather than
  the presence of a line.

---

## Phase 9 · Slice 10 — the gate refused, the signature was re-measured, and a control matched the sentence explaining the absence · 2026-09-03

Three readings in one sitting. **Only one of them is a result**; the other two are a refusal and a
correction, and they are recorded at the same weight because that is the point of the section.

### 1. Defect 64 — `scripts/defect64-read.sh` returned NO READING, and it was right to

The sitting opened on a stated precondition: *notification access toggled off, phone rebooted, app
not opened*. The script gates on exactly those two things and refused both:

```
  last real boot    : 2026-09-02T12:40:06  (uptime 80400s = 22h 20m)
  listener grant    : 1 connectsuite entry(ies)   ← MUST be 0
GATE FAIL  uptime is 22h — this phone has not rebooted for this test.
GATE FAIL  the notification-listener grant is still enabled
=> NO READING. Not a negative result: the experiment did not run.  (exit 3)
```

**Neither gate was taken on the script's word.** The grant one is a `grep -c` over a one-line
setting, which is the count-not-attribute failure this repo has already been bitten by twice, so it
was re-asked three ways and by value:

| Query | Answer |
|---|---|
| `settings get secure enabled_notification_listeners`, split on `:` | `com.chetan.connectsuite.debug/…NotificationMirrorService` — **present**, 1 of 5 entries |
| `dumpsys notification` → *Allowed notification listeners* | same component, `(user: 0 isPrimary: true)` |
| `dumpsys notification` → *All notification listeners enabled for current profiles* | same component |

And the *user* question was asked as well, because `pm list packages` threw
`SecurityException: Shell does not have permission to access user 150` in the same breath — this
handset has three users (`0`, `95:DUAL_APP`, `150:Secure Folder`). `am get-current-user` → **0**, and
the reading above is explicitly `--user 0`. So it is not the wrong-user lookalike either.

The reboot gate is a single instrument, but the instrument is the kernel's own counter: `/proc/uptime`
= 80,461 s across two samples five minutes apart, second field 311,728 idle-CPU-seconds, consistent.
There was no boot in 22 hours.

**What the phone was actually toggled, and this is the useful half.** `enabled_accessibility_services`
is now `null`. It was `com.chetan.connectsuite.debug/…ConnectSuiteInputService` in
`docs/evidence/phase-6-boot-2026-09-02/grants-before.txt` the day before. So a ConnectSuite
special-access switch *was* turned off — the adjacent one. Notification access and the accessibility
service sit next to each other in One UI's special-access lists, under the same app name, and the
grant that was needed off stayed on while the one Phase 3 depends on went off. Recorded as an
observation with its evidence, not as a claim about anyone's hands.

### 2. `BOOT:` lines that are not boots — the log names the mechanism, and it can still mislead

The log carries `[autostart] BOOT: …` at **2026-09-03T02:13:02** and again at `02:13:05`, over a
kernel that booted at `2026-09-02T12:40:06`. Two readings of one fact. What each is reading:

- `/proc/uptime` — the kernel's own time since start.
- the log line — an **intent delivery**. `LinkAutoStart.reasonFor` maps `BOOT_COMPLETED` *and*
  `QUICKBOOT_POWERON` to `BOOT`, and `core/src/main/AndroidManifest.xml` records that
  `QUICKBOOT_POWERON` is **not a protected broadcast on this handset**.

So a `BOOT:` line is evidence of a BOOT-shaped *intent*, not of a boot. The 12:41:08 line is the real
one — 62 s after the kernel came up, taking the `already listening` branch 3.9 s behind the listener
rebind, which is defect 64 exactly as recorded. The 02:13 pair is 51 minutes after
`lastUpdateTime=2026-09-03 01:22:04` and has no kernel boot under it at all.

**This is a hole in `defect64-read.sh` and it is named rather than fixed here.** The script bounds its
greps to lines written since boot, which correctly excludes yesterday's — but a synthetic
`QUICKBOOT_POWERON` sent *inside* the 30-minute window the uptime gate allows would land in the
counted set and read as a real boot. The gate narrows the window; it does not close it. The fix, when
someone takes it, is for `LinkAutoStart` to distinguish the two actions in the line it writes
(`BOOT` vs `QUICKBOOT`), which is the same corollary defect 60 already produced: **when two mechanisms
satisfy one guarantee, the log must say which one did** — and here two *actions* satisfy one reason
name.

### 3. D12 re-measured through the artifact, both quarantine states

Not from the row that describes it, and not from the build directory — mounted from the shipped
`ConnectSuite-2.0.0-arm64.dmg`, because D3 exists precisely because those differ.

```
Identifier=com.chetan.connectsuite.desktop      ← ours, not Electron
Signature=adhoc      flags=0x10002(adhoc,runtime)      TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=10    Contents/_CodeSignature/CodeResources present
codesign --verify --deep --strict  → valid on disk / satisfies its Designated Requirement   rc=0
```

| Condition | `spctl -a -t exec` | rc |
|---|---|---|
| **ConnectSuite.app**, as mounted | `rejected` | 3 |
| **ConnectSuite.app**, `ditto` copy with `com.apple.quarantine` set | `rejected` | 3 |
| Calculator *(control)* | `accepted / Apple System` | 0 |
| Google Chrome *(control)* | `accepted / Notarized Developer ID` | 0 |

The quarantined copy was re-verified with `codesign --verify --deep --strict` **after** the `ditto`,
so a `rejected` there is a verdict about the signature and not about a copy that broke in transit.
Both controls came back `accepted` in the same run.

**`error → rejected`, in both quarantine states, is the whole change.** It does not notarize, does
not remove the warning dialog, and does not make the app safe to hand to a stranger. What it buys is
that a `rejected` app has a user-facing override — System Settings → Privacy & Security → **Open
Anyway** — and an *unassessable* one gets *"damaged, move to Trash"* and has none.

### 4. The APK copy check, and the control that matched the sentence explaining the absence

CLAUDE.md's Phase 5 row carried *"the phone has not been reinstalled with the latest copy change"*.
Checked by reading the APK on the device rather than by trusting `lastUpdateTime`: `pm path` →
`adb pull` → `strings`.

| String | Present | |
|---|---|---|
| `Copied on your Mac` | 1 | Slice 12-13 copy |
| `On your clipboard` | 1 | |
| `Copy to this phone` | 2 | |
| `Pairing is a code you scan once` | 1 | defect 63's replacement |
| `Copied on your Commodore` | **0** | negative control |
| `ConnectSuite` | **177** | positive control |

So the note was stale and is struck.

**The fourth probe is the one worth keeping.** `adb tcpip` came back **present=1** — which reads as
defect 65 resurrected, in an app whose locked decision #1 is *no ADB anywhere*. It is not. The match
is `OnboardingCopy.forbiddenMechanisms`, whose `tcpip` entry carries
`why = "Same decision. \`adb tcpip 5555\` survived in exactly one place in this repository and it was
a sentence shown to users."` — **the guard's own explanation of the ban, compiled into the same dex as
the copy it guards.** KDoc is stripped; a string literal is not.

This is the Files-pane regex failure exactly — *the degraded banner's own sentence contains the words
for the affordance it says is missing* — reached from a different direction, in a different language,
in a binary rather than a DOM. The discriminator is the same one that rule already names: **do not
text-search a blob for a user-facing claim.** The check that would have been right the first time is
the one that already exists and runs in the module that owns the copy — `OnboardingCopyTest` asserts
`forbiddenMechanisms` against the **page copy**, which is an enumeration and not a grep.

---

## Phase 6 · Slice 6 — defect 64 closed on a real boot, with the competing route removed · 2026-09-03

**The boot path started the link, for the first time since it was written.** Three attempts were
needed and the first two produced **no reading**, which is recorded here at the same weight as the
pass because the gate refusing is what made the third attempt worth anything.

### The three attempts

| | uptime gate | grant gate | Result |
|---|---|---|---|
| 11:00 | **FAIL** — 22h 20m, no reboot | **FAIL** — grant present | NO READING (exit 3) |
| 11:16 | pass — 43 s | **FAIL** — grant present | NO READING (exit 3). The rebind beat BOOT by **4.2 s** |
| 11:54 | pass — 50 s | **pass — 0 entries** | **PASS** |

The listener grant was revoked from adb on the third attempt, after two hand toggles failed to
commit — `cmd notification disallow_listener <component>`, verified by value three ways with a
**survival control**: 5 listeners before, 4 after, the other four untouched. A revoke, not a wipe.
Restored afterwards to a string **byte-identical** to the one captured before the first attempt,
`sha256 127f799c…`, same five entries in the same order.

### The reading

```
11:53:52                boot                                        ← /proc/uptime, the only witness
11:54:16.148 … 17.058   features install; [input] Accessibility service connected
11:54:21.023  [autostart] BOOT: 1 paired device(s), link not running — starting LinkService
11:54:21.067  [service]   Foreground as BOOT, types=0x10
11:54:21.094  [tls]       Port 42501 protocols=TLSv1.3 ciphers=18 keyManagers=1     (and 42502, 42503)
11:54:21.100  [server]    Listening on 42501/42502/42503, 1 paired device(s)
11:54:21.894  [nsd]       Registered as ConnectSuite Samsung SM-S938B
11:54:26.607  [control]   Handshake complete with Chetans-MacBook-Pro at 10.231.182.88
```

**Everything defect 64 said was untested is now exercised.** `startOrLog` was reached with
`LinkStartReason.BOOT` — the no-op branch count is **0** — and `foregroundTypesFor(BOOT)` claimed
`types=0x10` (`FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE`) and **nothing else**, which is the narrow
claim it was deliberately written to make under `FGS_BOOT_COMPLETED_RESTRICTIONS`. The Mac
reconnected **5.6 s later with nothing tapped**, and the app was never opened —
`dumpsys activity activities` → **0** ConnectSuite activities, before and after.

### The control that makes it a reading rather than a coincidence

```
LISTENER_REBIND lines since boot: 0
```

That is the whole reason the revoke was worth doing. In the two prior attempts the rebind started
`LinkService` first — by 3.9 s and then 4.2 s — and BOOT arrived into `already listening`. **Two
independent reboots losing the race the same way is structural, not chance**, which is what
defect 64's record predicted: on a phone with the listener enabled the rebind may *always* win, and
the branch is unreachable in the only configuration anybody runs. The revoke removed the competitor,
and with it removed the branch fired correctly on the first try.

### Two observations from the same log, neither of them defect 64

1. **There is a third route into the process, and it does not start the link.** With the notification
   listener revoked, the process was still alive at 11:54:16 — five seconds before BOOT — because the
   **AccessibilityService** was bound at boot (`[input] Accessibility service connected`, 11:54:17).
   All eight features installed into a process with **no listening socket**. That five-second window
   is exactly defect 62's *alive, granted and serverless* state, and here it resolved because BOOT
   arrived behind it. `LinkAutoStart` is wired to the notification-listener rebind and to the two
   boot broadcasts; it is **not** wired to the accessibility bind. Recorded as an observation rather
   than a defect: BOOT covers the boot case, and adding a fourth start route would add a fourth
   competitor to the race this slice just had to remove one from.
2. **`POST_NOTIFICATIONS` is `granted=false` on this device, and the clipboard notices.**
   `W [clip] Notifications are not permitted, so the arriving entry was applied to the clipboard
   without saying so` — **7 occurrences, the earliest at 11:30, twenty minutes before the revoke**, so
   it is pre-existing and not an artefact of this run. The control matters because the timing made it
   look like the revoke's doing. The consequence is real though: with phone-side auto-apply on and
   `POST_NOTIFICATIONS` denied, **the phone's clipboard is replaced from the Mac with nothing shown to
   the user** — which is the asymmetry Slice 12 reasoned about (the phone cannot see what it would
   destroy) reached by a second route nobody specified. The degradation is logged, correctly, and is
   invisible where it matters.

---

## Phase 6 · Slice 7 — the phone stops replacing a clipboard it cannot report · 2026-09-03

**Found in the defect 64 log, not by looking for it.** `W [clip] Notifications are not permitted, so
the arriving entry was applied to the clipboard without saying so` — **7 occurrences** on the
author's own phone. `POST_NOTIFICATIONS` is `granted=false` on this device, phone-side auto-apply is
on, and the two together meant the Mac was replacing the phone's clipboard with **nothing shown to
its owner**.

### Why it is a defect rather than a permission the user declined

`docs/protocol.md` builds this whole namespace on one asymmetry: the Mac may apply on arrival
because it reads its own clipboard first and keeps the displaced entry, so **Restore is a real
undo**. The phone may not read its clipboard while unfocused — Slice 11, 90/90 and 60/60 — so it
**cannot see what it would destroy, cannot keep it, and cannot put it back**. The notification is the
entire compensation for that missing undo. Remove it and auto-apply is not a faster version of the
same feature; it is a different one, and not the one anybody consented to when they turned the
setting on.

**The code contained the opposite argument, written down**, which is why it survived:

> *Not fatal and not silent, and the sentence differs by case — with auto-apply on, the clipboard
> **was** written and only the telling failed, which is a materially smaller problem than an offer
> nobody can reach.*

Backwards. An offer nobody can reach changes nothing on the device. An unreportable apply destroys
something unrecoverable. The comment is kept in `ClipNotifications.kt` with the correction beside it.

### Two rules, both already in this repo, both broken on this path

1. **The check did not gate the action.** `ClipNotifications.post` checked deliverability *after*
   `applyToClipboard` had already run, and no-opped politely. A check that reads a value and then
   acts regardless is decoration.
2. **One rule, two expressions.** `AppsNotifications.canPost` asked **two** questions —
   `POST_NOTIFICATIONS` *and* `areNotificationsEnabled` — with a comment explaining that a check
   reading only the grant "would report the question deliverable to a shade that will silently drop
   it". `ClipNotifications.canPost` asked **one**. Same rule, two copies, and the weaker copy was on
   the path that writes somebody's clipboard. Now one home: `NotificationDelivery`.

### The fix

**Deliverability is a precondition of the write.** `ClipArrival.of(autoApply, canNotify)` returns
`APPLY`, `OFFER` or `KEEP_ONLY`, and `canNotify` gates **both** branches — an `OFFER` nobody can be
shown is not a gentler failure, it is an entry the owner is never told about.

| autoApply | canNotify | arrival | writes clipboard |
|---|---|---|---|
| true | true | `APPLY` | **yes** |
| false | true | `OFFER` | no |
| true | **false** | `KEEP_ONLY` | **no** ← was `APPLY` |
| false | false | `KEEP_ONLY` | no |

The entry still enters the history in every row; it is never discarded. And the **ack now says what
the receiver did** (`applied`, `arrival`, `reason`) rather than merely that it heard — `clip.push` in
`docs/protocol.md`. The Mac is the only screen the phone can still reach when its own notifications
are off, so the refusal surfaces there as a distinct Activity row, on **both** triggers.

### Red first

`ClipArrivalTest`, 6 tests. The defect was reintroduced by deleting `!canNotify -> KEEP_ONLY`:
**4 of 6 failed**. Restored: `sync-module` **178 tests, `failures="0"` on all 22 suites,
gradle exit 0, results file written 0 s ago.** Mac: **318 pass, 0 fail**, `tsc --noEmit` clean.

**What the test does not reach, stated rather than implied.** It reaches the *decision*, not the
*write* — `onPush` needs a `Context`, a `ControlSession` and a live `ClipboardManager`. That is
defect 67's shape, so the hardware run below is what closes it, not the suite.

### On hardware, both directions, with the state restored afterwards

Installed at 12:11, link back up through `MY_PACKAGE_REPLACED` (defect 60's other half, working).

| `POST_NOTIFICATIONS` | Stimulus | Phone log |
|---|---|---|
| `granted=false` | Mac clipboard set to a 22-byte marker | `W … NOT applied and NOT offered — the phone has not been given permission to show notifications, so it cannot tell its owner what arrived; kept in history only` |
| **`granted=true`** *(control)* | 19-byte marker | `I … applied to this phone's clipboard — 1 of 3 applied` |
| `granted=false` *(restored)* | 20-byte marker | `W … NOT applied and NOT offered — …` |

**The control is what makes this a reading**: the refusal tracks the permission in both directions,
so it is the gate and not a broken push path. The tally carries its own denominator — `1 of 3
applied` — which is the rule that made the original defect visible in the first place.

The phone was left at `granted=false`, the state it was found in. **Turning the feature on is one
toggle** — Settings → Apps → ConnectSuite → Notifications — and until it is, the Mac says so on every
send instead of the phone quietly swallowing it.

---

## Phase 6 · Slice 8 — H1, the unexempt path, 30 minutes rather than a night · 2026-09-03

> ## The result and its limit, in one breath — do not quote either half alone
>
> **No difference detected between the exempt and unexempt paths** over a 150-second forced deep-Doze
> window: listeners 4/4, one control session, and a live message crossing at `deep=IDLE` on both.
>
> **And the standby bucket was `ACTIVE` (10) throughout, never `RARE` or `RESTRICTED`.** Removing the
> deviceidle whitelist removes the *Doze* exemption. It does not make the app *unused*, and the harsh
> restrictions in this system belong to the low buckets. **"Unexempt" and "unexempt and neglected for
> days" are different experiments and only the first one ran.**
>
> The cheap route to the second was P6 — `am set-standby-bucket` — and it is **withdrawn**: the shell
> can move the bucket out of `EXEMPTED` and has no command that puts it back, because `EXEMPTED` is
> derived from the whitelist row. So the second experiment still has **no route on this handset** that
> does not leave the phone degraded for days, and *"no difference detected"* is a sentence about a
> phone in daily use, not about a phone left alone.

Everything below is the working. The three further limits — a forced rather than observed transition,
150 seconds sampled at 15, and Samsung's own layer untouched — are in §"What this did not measure",
and none of them is the big one. The big one is in the banner.

### The instrument was corrected before it was used

`scripts/doze-probe.sh` hard-coded its own condition:

> *This handset is in the deviceidle whitelist, so it is exempt from Doze's network restrictions.
> Everything below therefore describes the EXEMPT path.*

A true sentence when written, and **false the moment anybody runs H1** — which is the only reason
H1 exists. Run unexempt, the probe would have printed `### Forced Doze — EXEMPT PATH` over a
measurement of the opposite. It now reads the whitelist and the standby bucket at run time and
prints which path it is on, plus what that implies. The probe also had every one of its
state-changing calls (`battery unplug`, `force-idle`, `unforce`, `battery reset`) on a bare `adb`;
they go through `scripts/target-device.sh` now.

### A — exempt baseline, same build, same session

Deliberately re-run rather than compared against 2026-09-02's, so the two halves differ in **one**
variable instead of a day's worth.

```
### Forced Doze — EXEMPT PATH   whitelist row: user,com.chetan.connectsuite.debug,11011   bucket: 5
baseline  deep=ACTIVE light=ACTIVE listen=4/4 established=1
   0.0s … 76.9s   deep=IDLE light=OVERRIDE listen=4/4 established=1     (6 samples)
```

### The removal, and what it moved

```
dumpsys deviceidle whitelist -com.chetan.connectsuite.debug   →  Removed: com.chetan.connectsuite.debug
user entries: 10 → 9        ← a removal, not a wipe
standby bucket: 5 → 10      ← EXEMPTED to ACTIVE
```

**P6's inference is now a measurement.** That section reasoned that `EXEMPTED` is *derived* from the
whitelist row, which is why `am set-standby-bucket … 5` is refused. Removing the row dropped the
bucket to `10`, and restoring it put the bucket back to `5` with no bucket command issued at all.

### B — unexempt, 150 s

```
### Forced Doze — UNEXEMPT PATH
    whitelist row : <none — this package is NOT in the deviceidle whitelist>
    standby bucket: 10
    → Doze's network restrictions APPLY. This is the population the restrictions exist for.
baseline  deep=ACTIVE light=ACTIVE listen=4/4 established=1
   0.1s … 138.0s  deep=IDLE light=OVERRIDE listen=4/4 established=1     (10 samples)
stopped=duration after 10 samples
```

**`established=1` is not the reading** — that was P2's own warning and it holds here. A TCP record
outlives its peer. The liveness control is a message that actually crossed, injected **after**
`deep=IDLE` was confirmed rather than hopefully:

```
14:27:33  Mac clipboard set to an 18-byte marker
14:27:33.130 +05:30  W [clip] clip.push ← Mac: 18 bytes, NOT applied and NOT offered …
             deep=IDLE, read at the moment of the reading
```

Same second, inside the window, on the unexempt path. The `NOT applied` half is Slice 7 working, not
a Doze effect — the same line appears with the phone wide awake.

### A vs B

| | Exempt (A) | Unexempt (B) |
|---|---|---|
| listeners through the window | 4/4 | 4/4 |
| control session | 1 | 1 |
| samples at `deep=IDLE` | 6 over 77 s | 10 over 138 s |
| a message crossing during `deep=IDLE` | P2: a notification at +16 s | this run: a `clip.push` at +~40 s |
| `LinkService` restarts | 0 | 0 — uptime 2h18m spanned both runs |

**No difference detected.**

### What this did NOT measure, and the first one is the big one

1. **The standby bucket was `ACTIVE` (10), never `RARE` or `RESTRICTED`.** Removing the whitelist
   removes the *Doze* exemption; it does not make the app *unused*. The harshest restrictions in
   this system belong to the low buckets, and this app has been in daily use all day, so it sat in
   the highest one throughout. **"Unexempt" and "unexempt and neglected for days" are different
   experiments and only the first was run.** P6 was the cheap route to the second and it is
   withdrawn — `set-standby-bucket … 5` cannot put `EXEMPTED` back — so the second still has no
   route on this handset that does not leave the phone degraded for days.
2. **A forced transition, not an observed one.** `force-idle` skips the staged descent a real Doze
   makes, and `battery unplug` simulates the charger state while USB stays attached for adb.
3. **150 seconds, sampled at 15.** Both are bounds and both are in the probe's own output. A drop
   shorter than one gap is invisible; nothing here speaks to maintenance windows, which is where a
   real overnight Doze does most of its work.
4. **Samsung's own layer is untouched.** Device Care's *Sleeping apps* lists are not readable from
   adb — that is H2, and it stays open. Whether the app was added to one during this window is
   unknown, and it is the one outcome undoing H1 does not undo.

### Restoration, verified rather than assumed

```
whole-list diff before vs after   → IDENTICAL
standby bucket                    → 5    (from 10, with no bucket command issued)
deep / light                      → ACTIVE / ACTIVE
battery                           → AC false, USB true      (dumpsys battery reset took)
link                              → 3/3 OK, 1 control session ESTABLISHED
```

The phone is in exactly the state it was in before H1, and the diff is over the **whole whitelist**
rather than over our own row — a row-presence check would not have caught the probe dropping
somebody else's entry.

---

## Phase 6 · Slice 9 — defect 80 wired, and the start half is deliberately not claimed · 2026-09-03

`ConnectSuiteInputService.onServiceConnected` now calls
`LinkAutoStart.ensureRunning(this, LinkStartReason.ACCESSIBILITY_BIND)`. The reason carries its own
name so defect 60's corollary still holds — when several mechanisms can satisfy one guarantee, the
log must say which one did — and `foregroundTypesFor` puts it with the automatic starts, claiming
`connectedDevice` only.

### What was proven

The route is delivered to, on the first opportunity after installing:

```
14:48:46.344  I [autostart] LISTENER_REBIND:    1 paired device(s), link not running — starting LinkService
14:48:46.344  I [autostart] PACKAGE_REPLACED:   1 paired device(s), link not running — starting LinkService
14:48:46.378  I [autostart] ACCESSIBILITY_BIND: already listening — nothing to do
```

### What was NOT proven, and it is the half the defect is about

**`ACCESSIBILITY_BIND` has never started anything.** It took the no-op branch, 34 ms behind two
routes that both fire on an install and neither of which exists in the cases defect 80 describes.
This is defect 64's shape exactly, one route further along, and the rule that came out of 64 applies
unchanged: **a no-op branch is not a pass.** The narrow `connectedDevice` claim, the trust-store
read, and the actual `LinkService.start` on this path are all untested by this run.

**The stimulus that would prove it**, named rather than left for somebody to invent: revoke the
notification-listener grant so `LISTENER_REBIND` cannot fire, then kill the process without an
install so `PACKAGE_REPLACED` cannot either — `am crash`, per Slice 2's P5 — leaving the accessibility
rebind as the only route back. That is the same shape that closed 64 and it needs the owner's
say-so, because it turns notification mirroring off for the length of the run.

**Why the fix ships before that proof**, which is a judgement rather than an oversight: the branch it
replaces is *nothing at all*. Before this, three process-start paths with no broadcast behind them —
a low-memory kill, this service being toggled, and a crash `START_STICKY` did not catch — left the
app alive, granted, feature-complete and serverless for as long as nobody opened it. An unproven
recovery path is worth more than a proven absence of one, and the register says plainly which half is
which.

---

## Phase 6 · Slice 10 — defect 80's start half: three attempts, three no-ops, and a fourth route nobody had counted · 2026-09-03

**`ACCESSIBILITY_BIND` has still never started the link.** The run was authorised specifically to
settle that and it did not, for a reason worth more than the answer would have been.

### The setup, and it was correct

| Precondition | Reading |
|---|---|
| listener grant revoked | 5 listeners → 4, ours absent from the setting and from both `dumpsys` views |
| accessibility service still bound | `…/ConnectSuiteInputService` — the route under test was live |
| both services in one process | `dumpsys activity services` → both `ServiceRecord`s on `ProcessRecord{…4417}` |
| link up before the kill | 3/3 OK, one session ESTABLISHED |

`am crash` printed `Shell does not have permission to crash packages for user 150` — the misleading
refusal `docs/RESUME.md` already documents. It crashed user 0 and declined the Secure Folder clone
(pid 4805), which is why two pids were present and only one died.

### What happened

```
15:04:14.373  I [service]   Foreground as UNKNOWN, types=0x10          ← START_STICKY, null intent
15:04:14.388  I [server]    Listening on 42501/42502/42503
15:04:14.389  I [input]     Accessibility service connected
15:04:14.390  I [autostart] ACCESSIBILITY_BIND: already listening — nothing to do
```

**A fourth route, and it won by 16 milliseconds.** The experiment removed `LISTENER_REBIND` and
`PACKAGE_REPLACED` and did not remove `START_STICKY`, which restarts a *started* service after a
process death with a null intent — reason `UNKNOWN`, which is why it did not look like a competitor
when the routes were being counted.

Attempts 2 and 3 produced the *other* outcome `docs/testing.md` → Slice 2's P5 recorded: a modal
**`ConnectSuite keeps stopping`** dialog with the process alive. Nothing died, so nothing restarted.

### This corrects defect 80's own record, which over-claimed

That record listed three cases where the app would sit serverless, and one of them is wrong:

| Case | Claimed | Actually |
|---|---|---|
| crash `START_STICKY` did not catch | serverless | **stands** — defect 62's measured second outcome |
| the accessibility service toggled off and on | serverless | **stands** — nothing was started, so nothing is restarted |
| **a low-memory kill** | serverless | **probably not.** `START_STICKY` restarts a started service after a process kill, which is exactly what was measured above |

So **the window is narrower than the defect said**, and the honest form is: the accessibility bind is
a safety net for a process start where `LinkService` was *not* already started — so `START_STICKY`
has nothing to restart — and no broadcast follows. That is a real state and it is rarer than the
record implied. *A regression report is a reading too*, and this one was not held to the rule it was
filed under.

### A disagreement recorded rather than resolved

Dismissing the crash dialog with `KEYCODE_BACK` (not **Close app**, which is a force-stop wearing a
button) was followed by `pidof` returning empty and `scripts/link-up.sh` reporting all three checks
FAIL. **The log cannot corroborate any of that**: nothing was written between `15:06:48` and
`15:08:35`, and there is no `[autostart]` or `Foreground as` line after `15:06:46`. Either the
process died and returned without logging its own start — which nothing in this codebase does — or
those two readings were taken during a moment the log did not see.

**No story is offered for it, and none is to be added later.** Two instruments answered one question
differently, the third query that would settle it was not run before the state moved on, and
inventing a reconciliation here is the failure this file has a whole section about.

> **A standing instruction to any later session, including me.** This entry is **not** an open
> question to be tidied up on a quiet afternoon. Do not reconcile it from reasoning; the state is
> gone and no amount of thinking recovers it. It may only be replaced by a **new run that reproduces
> the disagreement and takes the third reading** — dismissing a crash dialog while sampling `pidof`,
> `dumpsys activity services` and the log's mtime together. Anything else is a story, and a plausible
> story here is worse than the gap, because the gap is honest about what nobody saw.

### State afterwards

Listener grant restored **byte-identical** (sha256 `127f799c…`, five entries, same order); the
`Application Error` window count is 0; link 3/3 with a live session; and the running process is
demonstrably the one writing the log — a `clip.push` at `15:08:35` proves it rather than assuming it.

### What would actually settle the start half

Removing the fourth route as well. `START_STICKY` fires only if `LinkService` was started when the
process died, so the stimulus is: **stop `LinkService` first, then kill the process** with the
listener revoked. There is no user-facing route to stopping the service alone, so this needs a
debug-only affordance — the same shape as `ClipProbeActivity` and `SafProbeActivity`, which exist
for exactly this class of state.

---

## Phase 6 · Slice 11 — defect 57 closed, and the swallowed exception was the whole defect · 2026-09-03

**The deferral expired rather than the defect changing.** Phase 5 carried 57 as *"the branch has
never been produced: it needs an undecodable `MediaStore` row, which means truncating a file's bytes
under its own entry on somebody's real phone"*. That reasoning was true when written and stopped
being true on 2026-09-01, when `Download/ConnectSuite` became a **grant-free root of this app's
own** — a corrupt file can be *written* there rather than an existing one damaged. Nothing of the
owner's was involved at any point.

### The stimulus

A 2,059-byte file: JPEG magic, a JFIF header, then bytes. `file(1)` calls it
`JPEG image data, JFIF standard 0.01` — so `MediaStore` indexes it as `image/jpeg` — and no decoder
can render it, because there is no image in it.

```
push → /sdcard/Download/ConnectSuite/defect57-corrupt.jpg
MEDIA_SCANNER_SCAN_FILE → Broadcast completed: result=0
content query → Row: 0 _id=1000298876, _display_name=defect57-corrupt.jpg, mime_type=image/jpeg
```

### The reading

```
15:15:05.803 W [media] media.thumb 1000298876 is present in MediaStore and could not be decoded
                       :: FileNotFoundException: Input was incomplete.
15:15:06.049 I [media] media.thumb → 31 made / 0 gone / 1 undecodable / 0 malformed-id of 32 asked
15:15:19.319 I [media] media.thumb → 0 made / 0 gone / 1 undecodable / 0 malformed-id of 1 asked
```

**The exception in that first line is the defect, and it had been swallowed.** `loadThumbnail` throws
**`FileNotFoundException: Input was incomplete`** for a file that is unambiguously present — the row
is there, the bytes are there, they are not an image. The old code's `runCatching { … }.getOrNull()`
discarded it and mapped the null to `NOT_FOUND`, so the phone told the Mac *"That photo is no longer
on the phone"* about a file sitting in a folder the user could open. An exception whose own name says
*not found*, about a thing that is found, on a path with no logging: three ways for the wrong answer
to look right.

### Controls

| | |
|---|---|
| **positive** | 31 of 32 in the same batch came back `made`. One bad item did not lose the other 31 — the per-item-error rule holding |
| **negative** | `0 gone` in every batch of the run. Nothing was misreported as deleted, which is the specific lie being fixed |
| **discrimination** | the same id, asked alone, returns `1 undecodable` and not `1 gone`. Row present + undecodable is now a different answer from row absent |

### What shipped

- The phone distinguishes them with an existence query **on the failure path only**, so the cost is
  per failed item, not per item. If that query itself throws, the answer is `NOT_FOUND` — the honest
  reply to *"could not establish that the row is there"* is not to claim that it is.
- The exception is logged with its cause instead of being discarded.
- **The counter stopped summing two facts.** `$made made / $failed failed` became
  `made / gone / undecodable / malformed-id`. "4 failed" could not be told from "4 photos deleted
  while the grid was open", which is the ordinary case and not a fault at all.
- `docs/protocol.md` gains `NO_THUMBNAIL` for `media.thumb`, the same word `fs.thumb` has used since
  Phase 5 — this namespace adopted its sibling's vocabulary rather than inventing a third.
- **The Mac must not treat `NO_THUMBNAIL` as missing.** Its `missing` set means *stop asking*, which
  is right for a deleted photo and wrong for a corrupt one: the row is listable and `media.original`
  may still serve it. Counted separately there too.

### Two notes on the instrument

The Mac-side probe written for this was **deleted after the run**, and that is the finding worth
keeping: a probe reading the Mac's DOM here measures a blank tile, and **a blank tile looks identical
for both causes** — it is the symptom the fix exists to make distinguishable, read from the one end
that cannot distinguish it. The reading is the phone's line and nowhere else.

Its album selectors also matched **0 elements** while its `expect` predicate reported `landed=true`,
because tiles were already on screen from a previous route. The stimulus was delivered by accident of
the pane's state rather than by the click the script thought it made — harmless here, since the phone
log is the reading, and recorded because a probe whose action does nothing while reporting success is
the decoration rule in a script.

### Cleanup

The corrupt file and its `MediaStore` row were removed — left in place it is a permanently broken
tile in the owner's photo browser. Recreating it is three commands and they are above.

---

## Phase 7 · Slice 10 — the design audit, measured rather than recalled · 2026-09-03

`docs/design-departures.md` is prose written pane by pane as each landed, over five weeks. Prose
goes stale exactly the way this repo's own phase table did, so before answering *what is left in
Phase 7* the questions were re-asked of the running app. `scripts/phase7-audit-probe.mjs`, through
`scripts/probe.mjs`, every reading with a control.

**The instrument failed twice before it produced anything, and both failures are the harness
working.** The first run guessed a global (`globalThis.__navModel`) for the palette and
`ProbeControlFailure` refused the reading outright — *"the control returned 0. The reading was not
taken."* Asking `navModel` would have been asking the thing under test to describe itself, which is
the degenerate case in `CLAUDE.md`; the fix was to drive the real palette UI. The second run emitted
a broken nested template into the page and the page threw. Neither produced a number, which is the
whole point — the failure mode this harness exists to prevent is a plausible number from an
instrument that could not see its target.

**Preconditions established before any empty count below was read as an absence:** the app was
**connected** to the phone (`Connected · 9 ms`, island text), and the clipboard pane held **4 real
history rows**. Both matter — `0 kind badges` over an empty list would have proven nothing about
whether kind badges exist, and `0 dialpad keys` on a disconnected app would have been a reading
about the link.

### 1. The sidebar — 12 rows, exactly one admits to being unbuilt

```
control = 12 rows enumerated
Overview Mirror Files Photos Messages Notifications Clipboard Calls Apps Activity Settings  → built
Camera                                                    aria="Camera — not built yet"     → unbuilt
```

One unbuilt pane in the whole app. Eleven of the handoff's eleven plus Apps (X0).

### 2. Settings — 3 of the handoff's 8 panes, and 2 of its 3 columns

```
settings rail tabs        → ["Connection","Advanced","About"]        [control=3]
settings grid template    → "200px 916px"                            [control=1]
handoff (stated in prose) →  200px 1fr 320px, eight panes
```

Unchanged since it was measured on 2026-08-30, which is the finding: **General**, **Notifications**
and **File transfer** are all real, Mac-side, and blocked on nothing. File transfer's own row in
`docs/design-departures.md` says *"Phase 5, ships with the feature"* — Phase 5 shipped on 2026-09-02
and the pane did not.

### 3. What the app's own search cannot find — control = 6 rows for `mirror`, re-typed each query

| Query | Result |
|---|---|
| `music` | `Now playing · In Overview` — the deep link works |
| `contact` | `Contacts · In Messages` — the deep link works |
| `camera` / `webcam` | `Camera · Not built yet · ⌘9` |
| `transfer` | `Activity` only — **not** the Files pane, and not a transfer control |
| `pair` | **[]** |
| `battery` | **[]** |
| `record` | **[]** |
| `keypad` | **[]** |
| `signal` | **[]** |
| `restore` `displaced` `history` | **[]** — the clipboard's undo has no searchable name |
| `forget` `trust` `unpair` | **[]** — trusted devices is in Settings → Connection and search cannot reach it |
| `login` `menu bar` `appearance` | **[]** — the unbuilt General pane, correctly absent |

`pair` returning nothing is deliberate and recorded (`docs/phase-7-homeless-features.md`, item 7).
The rest were not deliberate: **the clipboard's Restore and the trust controls are shipped, working
and unreachable by search**, which is precisely the gap slice 2 measured for the media remote and
fixed with deep links. The same fix applies and has not been made.

### 4. Calls — the handoff's centre and right columns are absent, not merely restyled

```
buttons in the pane      → 51        [control=51]
  … by class             → { "button": 1, "secondary small": 50 }
dialpad keys             → 0
mute / speaker controls  → 0
waveform elements        → 0
top-level grid           → none (the pane is one block)
messages grid, measured  → "804px 320px"     vs handoff "280px 539px 300px"
```

The 51 buttons are one dial button and 50 call-log / contact rows — so the count is real and the
absences are absences. The handoff draws a 3×4 dialer, a 40-bar waveform, and a Mute / Keypad /
Speaker row; none exists. **Six of the eight gaps need nothing from the wire** (`call.dial` already
exists); mute and DTMF need an `InCallService` and two messages, and are the designer's to confirm.

### 5. Clipboard — over a list with 4 real rows

```
history rows drawn       → 4         [control=1 list element]
buttons in the pane      → 5         [control=5]
History/Favourites/Pinned tabs → 0
kind badges (URL, Aa, IMG, {}, FILE) → 0
star / pin actions       → 0
three-step sync timeline → 0
```

Four populated rows and zero of the handoff's furniture. This is the pane where the build is
furthest from the drawing while being fully functional.

### 6. Overview — two of the handoff's three right-column cards are missing

```
cards drawn → [ "Samsung SM-S938B", "What this phone can do", "Media remote" ]   [control=3]
handoff     →   Quick actions (8 tiles) · Device · Recent activity
battery slots → device-battery, strip-battery, strip-divider-battery — all present, all hidden=true
```

`S4` is confirmed still accurate: the battery slots exist in the DOM and are hidden, because
`battery.state` is on `check-protocol-spec.mjs`'s debt list with **no handler on either side**.
`S10` is now stale in one direction — *"Recent activity needs a session store nothing writes yet"*
stopped being true on 2026-09-02 when `main/activity.ts` landed.

### What this slice did not measure, stated so nothing is read as covered

The inner grids of **Photos**, **Files**, **Notifications** and **Activity** were probed at the
wrong level — each pane is a block containing its grid, and the read returned `cols: none` for the
wrapper. That is an instrument limit, not a finding, and no claim about those four panes' layout is
made here. `docs/design-departures.md` measured them at a matched 1440 × 920 viewport when each
landed and remains the record.

---

## Phase 7 · Slice 11 — native notifications built, and macOS refuses them on this Mac · 2026-09-03

The feature `docs/phase-7-state.md` §5.2 named as the one that decides whether this app gets opened
in week two. Scope written before any code: `docs/phase-7-native-notifications.md`.

### 1. The instrument, before the feature

`Notification` had never been imported in this project. Four readings, each with what it does *not*
answer stated beside it:

| Reading | Result | What it does not say |
|---|---|---|
| `Notification.isSupported()` | `true` | **Nothing about permission.** A static capability answer; it returns `true` on a machine that refuses everything. Gating on it would read one fact as another |
| `notification.show()` | returns in **0–3 ms** | Not a delivery signal. Fire-and-forget |
| `failed` event | fires, with `UNErrorDomain error 1` | The *only* permission signal available |
| authorization, read in advance | **no API in Electron** | — |

**The control failed twice before any of this counted.** A probe run from a scratch directory got
`failed` — but a scratch app with no registered bundle and a genuinely refused permission produce
**the same event**, so nothing was known. A signed Swift control app with its own
`CFBundleIdentifier` was built to establish the positive case: launched directly it reported
`authorizationStatus = 0 (notDetermined)` with `alertSetting = notSupported` — a launch-path
artefact, not a permission reading — and relaunched through LaunchServices it registered correctly
and then **`requestAuthorization` never called back at all**: no grant, no denial, no error, a
ten-second timeout with `UserNotificationCenter` running.

So **this Mac's authorization state was never established**, and the design does not depend on
establishing it. That is the finding rather than a gap.

### 2. The replay burst — 16 considered, 0 banners

The reading that justifies the whole `whenMs` rule. On relaunch, with the phone connected:

```
=== every decision at session start, by reason ===
   8 → replay
   5 → group-summary
   3 → ongoing
total considered: 16     banners posted: 0
```

**Without §1.4's rule, relaunching would have stacked 16 banners on screen** — and the link
reconnects on every sleep, network change and reboot, all of which Phase 6 made reliable. The better
Phase 6 made the link, the more often this would have fired. The phone replays its whole shade as
ordinary `notif.posted` with **no end-of-replay marker on the wire**, so a replayed notification and
a new one are byte-identical; `whenMs` against the session-ready instant is the only discriminator
that needs no protocol change.

Note the three `ongoing` rows include **this app's own foreground service** — the mirror would have
notified the user about itself.

### 3. The positive case, and the refusal

A genuinely new notification, posted on the pinned device:

```
$ adb -s "$(scripts/target-device.sh)" shell cmd notification post -S bigtext -t 'Ana' cstest '…'
   OK    target RZCY12330DT (SM-S938B, sdk 36)

I [native-notif] com.android.shell → notify
W [native-notif] macOS refused a notification — The operation couldn't be completed.
                 (UNErrorDomain error 1.). Everything since launch:
                 group-summary=5 ongoing=3 replay=8 notify=1.
                 The switch is under "Electron" in System Settings → Notifications.
```

**Both halves are readings.** The decision layer is correct — the rule chose to post, for the right
notification, and the reason is on the line. And macOS refused, so on this machine, in dev, **no
banner appears.**

### 4. A hypothesis raised and refuted, which is why it is written down

The Swift control app recovered when relaunched through LaunchServices, so the obvious hypothesis
was that `./node_modules/.bin/electron .` launches the binary in a way macOS will not register.
Tested directly — the app relaunched with `open -a …/Electron.app --args "$PWD"`, confirmed
connected (contacts, clipboard and SMS all round-tripping at 17:52:45), and a second notification
posted:

```
17:53:25 I [native-notif] com.android.shell → notify
17:53:25 W [native-notif] macOS refused a notification — …(UNErrorDomain error 1.)…
```

**Identical.** The launch path is not the cause. `Electron.app` is already a registered bundle; what
is refused is `com.github.Electron` itself, on this machine. Recorded because the hypothesis was
reasonable, cheap to test, and wrong — and the next person will have it too.

### 5. The degraded state, measured through `probe.mjs`

```
permission banner → {"visible":true,
  "text":"macOS is not showing these notifications. Turn them on in System Settings →
          Notifications, under “Electron”.The operation couldn't be completed.
          (UNErrorDomain error 1.)"}                                    [control=1]
sound toggle      → {"checked":false}                                   [control=1]
```

It names **Electron**, not ConnectSuite, and that is correct rather than a bug: a dev run and the
ad-hoc-signed `.dmg` alike post as `com.github.Electron` (Phase 9, **D12**). Telling anyone to look
for "ConnectSuite" in System Settings would send them to a row that does not exist. **This is the
first place a Phase 9 signing defect reaches a user-visible sentence**, and it is an argument for
doing D12 rather than for delaying this.

### 6. Tests

16 tests on `notifyDecision` / `notifyCopy`, in `src/shared/` where a test can reach them. Four
mutations, each red on exactly the test named for it:

| Mutation | Failures |
|---|---|
| replay rule deleted | **3** — including *the whole shade replaying produces zero banners* |
| suppress whenever focused, ignoring the route | **1** — *focused on a DIFFERENT screen still notifies* |
| clock-skew grace removed | **1** — *a notification the phone timestamped slightly early* |
| `ongoing` allowed through | **1** |

Suite: Mac **338**, 0 failures; `tsc` 0; five commit hooks green; `probe.test.mjs` 18/18.

### 7. What is not claimed

- **That a banner has ever been seen on this Mac.** It has not. The decision to post was made and
  the platform refused. The next reading owed is one posted notification appearing on screen, and it
  needs either the Electron row enabled in System Settings or a properly signed build.
- **That a delivered notification can be told from one delivered into a Focus mode that hid it.**
  macOS reports both as success.

---

## Phase 7 · Slice 12 — `pair.rejected`, the Mac half · 2026-09-03

The departure row said *"not possible — the Mac sees a closed socket and nothing else"*. The message
has been in `docs/protocol.md`, in `MessageType`, typed in `shared/protocol.ts` and **sent by the
phone** since F7 was specified; nothing on the Mac listened. This is the handler.

### 1. What was built

`pairRejectionCopy` in `src/shared/`, pure and testable, plus a `pair-rejected` case in `link.ts`,
a main-process handler that arms a fresh code, and a `--warning` banner on the pairing screen.

Three decisions worth naming:

- **The phone's sentence is not what is rendered.** `docs/protocol.md` is explicit — *"the Mac must
  prefer its own copy keyed on `reason`; the string is a fallback and a log line, not the UI."* That
  is the **opposite** of the rule for `error` payloads, where the phone's words go through verbatim
  (defect 27), and the difference is real: an `error` explains something only the phone knows, and a
  pairing rejection explains something both ends know on a screen only the Mac draws.
- **The fingerprint gate returns `null` rather than always answering.** A rejection carrying another
  Mac's fingerprint is ignored and logged. Rendering it would tell this user their pairing failed
  when it did not, on the first screen a stranger sees. A rejection with **no** fingerprint *is*
  accepted — absent means "cannot say", not "not yours", and the field is optional in the contract.
- **A rejection does not stop the retry loop**, per the contract. The user's next action is to scan
  the fresh code and discovery must be running when they do.

### 2. One rule that had grown two expressions, caught before it drifted

The redraw-after-rejection path rendered its QR at `width: 640` with no `errorCorrectionLevel`,
against the arming path's `320` and `'M'`. Two expressions of one rule, which the code rules say
will disagree eventually — and the visible symptom would have been *a code that scans on one path
and not the other*, which reads as a flaky phone camera. Given one home as `QR_OPTIONS`.

The second renderer exists at all because redrawing through `pairing-qr` would **arm a new token**,
rotating the code a second time and invalidating the one the user was just told to scan.

### 3. Tests — 10, with four mutations

| Mutation | Failures |
|---|---|
| fingerprint gate removed | **1** — *a rejection meant for ANOTHER Mac is not rendered* |
| a missing fingerprint treated as "not yours" | **1** |
| the phone's sentence rendered instead of our copy | **1** |
| an unknown reason returns null | **3** |

One test asserts no copy leaks a wire constant (`TOKEN_*`) or a fingerprint into a sentence a person
reads — the package-id rule (defect 33) applied to a different kind of handle.

### 4. What is NOT proven, and the exact stimulus that would prove it

**No `pair.rejected` has ever crossed the wire to this Mac.** The Mac half is unit-tested and has
never run against a real one, and that is stated rather than papered over: producing one needs the
**phone** to hold an armed pairing, which needs somebody to scan a code. The phone accepts a
tokenless `hello` when nothing is armed — otherwise every reconnect would fail — so the branch
cannot be reached from this end alone.

**The stimulus, in full, for whoever runs it:**

1. On the Mac, open the pairing screen and let it draw a code.
2. On the phone, **Mac** tab → **Scan pairing code**, scan it. The phone now expects that token.
3. On the Mac, press **Show a fresh code** *before* the phone's pairing completes. The Mac now holds
   a different token.
4. The Mac dials out with the new token → the phone answers `pair.rejected` with `TOKEN_MISMATCH`.

Expected: `W [pairing] The phone refused this pairing: TOKEN_MISMATCH`, the warning banner reading
*"That code didn't match"*, and a freshly armed QR beside it.

**A synthetic IPC event was deliberately not fired to make this look green.** The renderer would
have been drawing input this session supplied, which is the degenerate case in `CLAUDE.md` — an
instrument measuring itself — and it would have proven the drawing while claiming the wire.

### 5. State after the rebuild

```
19 considered, 0 posted:  10 replay, 6 group-summary, 3 ongoing
errors in the session log: 0
```

**And a contaminated count, caught and corrected in the same run.** The first tally used
`grep -oE "→ [a-z-]+"` across the whole log and reported a fourth reason, `phone`, with one
occurrence — which is not a decision at all but the clipboard's own line, `clip.push → phone: 1060
bytes`. Rescoped to `[native-notif]` lines the tally is 19 over three reasons. The arrow is not a
tag; a denominator read off an unscoped grep is the ninth row of this file's own control table,
which is where `grep -c` has been since Phase 3.

Suite: Mac **348**, 0 failures; `tsc` 0; five hooks green.

---

## Phase 7 · Slice 13 — why there was no switch to flip: defects 81 and 82 · 2026-09-03

**Reported by the user against a sentence this session wrote.** The degraded banner said *"Turn them
on in System Settings → Notifications, under 'Electron'"*. There is no **Electron** row in that
list — not off, **absent** — searched, with the control that the list shows duplicate entries for
other apps and so is not collapsing them.

That is the `fixHint`-pointing-at-a-nonexistent-Setting failure, which is why `PHONE_NOT_FOCUSED`
has its own error code. **Diagnosed before the copy was touched.**

### Defect 81 — the banner named a Setting that does not exist

#### 1. The mechanism, with the reading

macOS lists an app under Notifications only once it has **registered as a notification client**, and
it will not register a bundle whose identity it cannot verify. The refusal happens *before* any
registration, so no prompt is shown, no record is created, and no row appears.

The reading that shows why, and it corrects a claim this session made two slices ago:

```
dev Electron.app                         Chrome (control, a known-working notifier)
  Identifier   = Electron                  Identifier   = com.google.Chrome
  Info.plist   = not bound                 Info.plist   = entries=44
  Sealed Res.  = none                      Sealed Res.  = version=2 rules=13 files=63
  _CodeSignature: absent                   _CodeSignature: present
```

**Slice 11 said the dev run "posts as `com.github.Electron`". That was wrong.** `com.github.Electron`
is what `Info.plist` *declares* — and the signature **does not bind Info.plist**, so it is not the
identity macOS uses. The code-signing identifier is a bare `Electron`, from the linker's minimal
ad-hoc seal. Reading a bundle id out of a plist and calling it the app's identity is the same
mistake as reading a row's presence and calling it a grant.

#### 2. The discriminator: unsealed bundle, not "no bundle identity"

The user asked for the packaged build as the test, and it settles it — **the packaged app is also
ad-hoc and it works**:

```
packaged ConnectSuite.app
  Identifier  = com.chetan.connectsuite.desktop
  Signature   = adhoc                 ← still ad-hoc!
  Info.plist  = entries=33            ← bound
  Sealed Res. = version=2 rules=13 files=10
  codesign --verify --deep --strict → VERIFIES
```

Posting a real notification from the phone to each build:

| Build | Result |
|---|---|
| dev (`electron .`) | `→ notify` then **`macOS refused … UNErrorDomain error 1`**, within 5 ms |
| packaged | `→ notify`, and **no `failed` line at all** |

**The absence is controlled:** the same log file contains **3** refusals from the dev runs, so the
query can see them; after the packaged app started there are **0**, over **2** successful posts.

So the discriminator is **the seal, not ad-hoc-versus-Developer-ID**. An Apple account is not what
was missing.

### Defect 82 — the packaged app could not launch, and had never been run

The first packaged run did not start at all:

```
dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
Reason: ... code signature not valid for use in process:
        mapping process and mapped file (non-platform) have different Team IDs
```

`hardenedRuntime: true` turns on **library validation**, which requires every loaded library to
carry the same Team ID as the process. An ad-hoc signature has none — `TeamIdentifier=not set` on
both the app and the framework — and macOS does not treat two absent team IDs as a match.

So D12's inside-out ad-hoc signing fixed *assessability* and produced a bundle that verifies deep,
assesses as `rejected` rather than erroring, and **cannot be run**. Nobody had noticed, because
nobody had launched it: Phase 9 measured the signature and the Gatekeeper verdict, which are
statements about the file, and never the one thing a user does with it. *A build succeeding is not a
build working* — this file's own sentence, from Phase 9 Slice 2, arriving by a second route.

**The fix is $0 and needs no account:** `com.apple.security.cs.disable-library-validation`.
Measured after: `LAUNCHED`, then connected to the phone, then posted notifications with no refusal.
The entitlement is documented as load-bearing **only while ad-hoc** — a real Developer ID gives every
component one Team ID and the line should be deleted in the same change that fills in `identity:`.

#### 4. The corrected copy

Chosen by `refusalCopy({ packaged })` in `src/shared/`, because **whether a Setting exists is decided
by whether the bundle is sealed**:

| Build | What it says |
|---|---|
| packaged | *"Open System Settings → Notifications, find ConnectSuite, and turn on Allow Notifications."* — `actionable: true` |
| dev | *"Notifications cannot work in this development build… there is no ConnectSuite entry in System Settings to switch on. Everything else on this screen works normally. Run a packaged build to see banners."* — `actionable: false`, **and no instruction, because there is no action** |

Verified on screen through `probe.mjs` against the dev run:

```
corrected banner → {"visible":true,
                    "namesElectronSwitch":false,
                    "tellsYouToFindConnectSuite":false, …}       [control=1]
```

5 tests, including one that asserts the dev copy can never name an Electron switch again, and one
that asserts it still says what *does* work — a dead end with no next step is the silent no-op this
project rules out.

#### 5. The consequence for how this gets tested from here

**Native notifications are untestable from `npm start`, permanently, and not because of a
preference.** A dev run is refused before registration and no amount of clicking in System Settings
can change it, because there is nothing there to click. Anything touching the banner, the click, the
badge or the sound has to be exercised on a packaged build — `npm run dist:dir`, then
`open release/mac-arm64/ConnectSuite.app`.

Everything *else* in the app remains testable in dev, including the whole decision layer: the
`→ notify / → replay / → ongoing` lines are written before the post, so the filter can be verified
from `npm start` and only the delivery cannot.

Suite: Mac **353**, 0 failures; `tsc` 0; five hooks green.

### 6. Two corrections made before the user's own test, 2026-09-04

Both found by asking *what would this test actually exercise* rather than by a failure.

**The update rule would have suppressed the test itself.** The first version suppressed **any**
re-post of a key already held, to stop a download's progress bar posting sixty times a minute. But
messaging apps put **one notification per conversation and update it in place** — so a second
message in a chat you have not read arrives with the *same key*, and the rule would have silenced
exactly the notification this feature exists for. A WhatsApp test against an already-unread thread
would have produced no banner and looked like a broken feature.

The discriminator is the timestamp, which was already on the wire: a progress bar redraws keeping its
original `when`; a new message advances it. The rule is now `previous && whenMs <= previous.whenMs`,
and `NotifyContext` carries the held notification rather than a boolean — *whether it is a replace*
was never the question. Shown red against the old rule: 22 pass, **1 fail**, on the test named
*a SECOND message in an unread chat notifies*.

**The reveal selector was never exercised against a real key.** Android keys look like
`0|com.chetan.connectsuite.debug|2001|null|11011` — they contain `|`, which is not a legal bare CSS
identifier. Measured against the live pane before handing over the test:

```
rows and their keys → {"rows":14,
                       "sampleKey":"0|com.chetan.connectsuite.debug|2001|null|11011",
                       "revealSelectorMatches":true,"sameNode":true}      [control=14]
```

Also confirmed: `ShellView.route('overview')` runs at startup and the route announcement is inside
`route()`, so the main process's `currentScreen` is correct from the first frame rather than from the
first *change* — which is what decides the "already focused on the pane" suppression.

**What is still unexercised, and is exactly what the user's run will test:** a banner rendered by
macOS, a click on it, the reveal firing from that click, and the dock badge appearing and clearing.
Each has a unit test or a DOM reading behind it and **none has been seen end to end.**

---

## Phase 7 · Slice 14 — the password prompt on first launch of the packaged app · 2026-09-04

**Reported by the user, who typed their password without being told what was asking.** Diagnosed
from the log and the keychain rather than guessed, because "probably the keychain" is exactly the
kind of confident answer this file exists to stop.

### What it was: a Keychain access prompt, not admin, network or Gatekeeper

The chain, each link measured:

| # | Reading |
|---|---|
| 1 | `identity.ts` calls `safeStorage.decryptString` on every start, before anything else |
| 2 | `key.enc` begins with the bytes **`v10`** — Chromium/Electron's macOS safeStorage format, meaning the key is wrapped by a key held **in the login keychain** |
| 3 | That keychain item exists: service **`connectsuite-desktop Safe Storage`**, account `connectsuite-desktop Key`, `cdat` = **`20260824175758Z`** — which matches `key.enc`'s own mtime (Aug 24 23:27 IST) to the minute. **The dev build created it** |
| 4 | Both builds resolve `app.getName()` to `connectsuite-desktop` — it comes from `package.json`'s `name`, not from `productName`/`CFBundleName` — so the packaged app reaches for **the same item**, which is also why both share one userData directory and one log file |
| 5 | The packaged app's code signature is **not** the dev binary's, so it is not on that item's ACL, and macOS asks the user to authorise it. The login password is what that dialog wants |
| 6 | The gap in the log: `01:44:59.643 [app] ConnectSuite 2.0.0 starting` → `01:45:24.731 [link] Trying …` — **25 seconds** with nothing in between, which is the dialog waiting |
| 7 | It succeeded: the link connected and TLS completed, which cannot happen without the decrypted private key |

Admin, network and Gatekeeper are all ruled out by the same evidence rather than by elimination —
none of them sits between `starting` and the first socket, and none of them is what `v10` + an ACL
mismatch produces.

### Would a stranger see it? No on install, and **yes on update while ad-hoc** — one measured, one not

- **Fresh install: no prompt.** There is no existing item, so safeStorage *creates* one and the
  creating process is on its own ACL. This is mechanism, not measurement — the test would be to
  delete the keychain item and relaunch, and it is deliberately not run here because it would
  invalidate `key.enc`, mint a new identity, and make the phone refuse the new fingerprint.
- **This machine is not a stranger.** The prompt happened because a *dev-created* item was read by a
  *differently-signed* binary. That is a development artefact.
- **Update, while ad-hoc signed: predicted to prompt every time, and this one matters.** A keychain
  ACL matches on the app's **designated requirement**. A Developer ID app's DR is stable across
  versions, so an update reads its own item silently. An **ad-hoc** signature has no team identity
  and its DR is pinned to the **cdhash**, which changes with every rebuild — so each new ad-hoc build
  is a different app to the keychain. **Not measured**, and the test is one line: rebuild, relaunch,
  see whether it asks again.

**So this is the third distinct thing the missing Developer ID costs**, after Gatekeeper's verdict
(D12) and library validation (D14) — and unlike those two it would be visible to a real user, as an
unexplained password prompt on an update.

### The instrument fault in this diagnosis, recorded because it is the table's own pattern

The first search reported **`connectsuite-desktop Safe Storage: not present`**. The item was there.
`security find-generic-password` prints the service attribute as the raw tag `0x00000007`, not as
`"svce"`, and the query filtered on `"svce"` — so a record that was returned, with exit code 0, was
read as an absence. The control that caught it was enumerating **every** `Safe Storage` item and
finding 15 of them, including this one.

*A `grep` that does not match is not evidence the thing is absent* — second row of `CLAUDE.md`'s
control table, met here in its exact original form, in the middle of diagnosing something else.

---

## Phase 7 · Slice 15 — the design pass: four panes, six overtaken departures, and three defects nothing could have noticed · 2026-09-04

**What ran.** The four panes `docs/phase-7-state.md` §1 named as *working and not looking like the
design* were built against `ConnectSuite.dc.html`, every departure from it recorded with its reason,
and each got a view test as it was built. Then the six departures §2 says the wire had overtaken.

**Where the numbers came from, and a correction to how they were first taken.** Eleven readings,
through `scripts/phase7-panes-probe.mjs` — `probe.mjs`, so a required control on each, no fixed
sleep expressible, and routing done with `probe.act` whose `expect` is the screen actually being on
show rather than the route call returning.

The first version of the same readings was a hand-rolled CDP eval in a scratchpad file.
`probe.test.mjs`'s scan passed throughout, because it scans `scripts/` and a scratchpad file is not
under it. That is not a gap in the guard: `CLAUDE.md` says the hole lives *permanently in the
one-off read*, and this is that, in the sitting that quotes it.

### The readings

The instrument's own bound is printed first, and it turned out to matter:

```
the viewport, and whether the page is showing a scrollbar
  value:   {"inner":1440,"outer":1440,"scrollbarPx":11,"pageScrolls":true}
  control: 1440   (innerWidth === outerWidth, or zero — a zoomed page makes every width below wrong)
```

| Question | Value | Control |
|---|---|---|
| Calls: grid columns, against the handoff's `300px 1fr 300px` | `300px 508px 300px` | 50 call rows |
| Calls: dialler keys — twelve as drawn plus a delete | **13** | 3 filter tabs |
| Calls: controls on the live card with no call — must be zero | **0** | 17 controls in the dialler |
| Clipboard: grid columns, against `1fr 340px` | `784px 340px` | 3 filter tabs |
| Clipboard: filter tabs, and neither is Favourites or Pinned | **3** | 2 action buttons |
| Settings: grid columns, against `200px 1fr 320px` | `200px 572px 320px` | 6 rail tabs |
| Settings: rail panes | **6** (from 3) | 5 setting rows |
| Overview: Quick action tiles | **8** | 2 hero buttons |
| Overview: Recent activity rows | **5** | 8 quick tiles |
| Overview: the count beside Quick actions | `7 of 8 available` | 8 quick tiles |
| Mirror: tool-rail buttons, three since M5 | **3** | 1 readout |

**The `1fr` figures moved by 11px between two honest readings, and that is the entry worth keeping.**
The ad-hoc read gave 519 / 583 / 795; the probe gave 508 / 572 / 784. Neither is wrong — a `1fr`
column is a fraction of a content column that is narrower by a scrollbar when the page has one, and
the two runs caught the same grids in two scroll states. It is the *two readings, one fact* family
with an entirely mundane cause, and the discipline it demands is one line: **quote the scrollbar
state with the number**, or the next person hunts a regression that does not exist.

**The Calls live-card zero is a real absence, and its control is what makes it one.** `#call-live
button` is 0 while `.calls-dialer button` is 17 in the same read — so the query can see buttons on
that screen and is reporting their absence from that card, rather than reporting a blank pane.

### Three defects that no check in this repo could have found

| | What was wrong | Why nothing noticed |
|---|---|---|
| **The status island's rota had never once been visible** | `setIsland` ran on **every** status update and `rttMs` changes on every heartbeat, so the rota's text was overwritten a second after each 5.2 s cycle; and `note('Connected · 9 ms')` also ran per update, deduplicated against the *exact* previous string, so six latency variants filled the whole six-slot history inside twenty seconds | **A rota that is always overwritten looks exactly like a rota with one entry in it.** There is no symptom. Every screenshot since 2026-08-30 shows `Connected · N ms`, which is what it should read most of the time. *"Clipboard synced"* could not have appeared even once wired |
| **The clipboard watcher recorded only its failures** | The automatic send wrote an Activity event when the phone refused to apply the clip and **nothing** when it worked | The denominator rule inverted: the Activity pane held *"Phone did not apply it"* rows with no successes beside them, in the one pane whose job is to say what happened |
| **Overview's Recent activity drew the five _oldest_ events** | `events.slice(0, 5)` over a store that returns insertion order; the Activity pane sorts by `seq` descending before paging | Found by **looking at a screenshot**. The fourth renderer-only break found that way, and the reason the drawing moved out of `renderer.ts` into `OverviewView` |

**Verified on hardware after the island fix**, over two real copies made outside the app:

```
rota:  ["Connected",
        "Sent to phone · 57 bytes, automatically",
        "Sent to phone · 31 bytes, automatically"]
island, four consecutive 5.5 s samples:  three different lines
```

### F6 / P3 — built, and the sighting is unproven

The Mac can now tell *"nobody has scanned this code"* from *"scanned, and now searching"*. What is
proven: the comparison (`shared/pairIntent.test.ts`, 6 tests, the load-bearing one being **a phone
pairing with a different Mac does not match**), and that the watch **arms** with the code —

```
09:25:22.150 I [pairing]     QR armed for 10.231.182.88
09:25:22.153 I [pair-intent] Watching mDNS for a phone publishing 3030c8ebcddcd0fb
                             — a sighting only; an absence means nothing
lines written in the same window: 2   ← so the absence of anything else is a reading
```

**A registration line is not an execution line.** That the watch is armed says nothing about whether
a phone publishes the record, whether this Mac's browser sees it, or whether the screen draws the
line. All three need an unpaired phone and a scan; unpairing would leave this Mac unable to
reconnect until somebody walks over with the handset. **The stimulus is named instead:** forget the
phone, open the pairing screen, scan, and watch for the line *before* the link comes up — that
ordering is the whole feature.

### The renderer-view debt list

**5 covered / 7 outstanding → 11 covered / 2.** `CallsView`, `ClipboardView` (extended),
`OverviewView` (new), `ContactsView`, `SmsView`, `NotificationsView`, `PhotosView`. The two that
remain do so for stated reasons: `MirrorView` needs a canvas and a video element the double
deliberately does not model, and `ShellView` is the window frame whose rules `stylesheets.test.ts`
already guards.

`ContactsView`'s test found a state that was unreachable in the situation it described: the
*"Reading the phone's contacts…"* sentence was only ever drawn by the **un**-advertised path, so a
first advertise showed a **blank** note until the reply landed — a fourth empty nobody wrote, on the
pane whose whole care is telling empties apart. It was found by **holding the reply open rather than
racing it**; the state lasts exactly one round trip, and the first version of the test sampled it,
which is the 263 ms window rebuilt inside a harness.

Mac tests **462**, `tsc` clean on both projects, all six commit hooks green.

### What this slice did NOT do, said plainly

- **The screenshots are from the dev run, not the packaged app.** The packaged app cannot be started
  unattended — **D15**, measured here and predicted by `cd9de69`. The renderer is byte-identical
  (both load the same `dist/`); native notification registration is not, and none of these
  screenshots are about that.
- **Nothing was driven on the phone.** Reads over `adb` only; no taps, no installs, no reboots.
- **The clipboard synthetic screenshot is labelled synthetic**, its `displaced` row carried
  `REDACTED-NEVER-DRAWN`, a DOM-wide search for that string returned `false`, and the pane was put
  back on the phone's real data with `refresh()` afterwards.

---

## Phase 7 · Slice 16 — the banner nobody could click: defect 83, and two instrument faults in the run that found it · 2026-09-04

The first native notification test on hardware. **Check 1 passed** — one banner, correct content, no
replay burst — and **check 2 failed**: the banner was clicked, it vanished, and the app stayed on
Photos. Three different bugs produce that from outside, and they need three different fixes.

### The three cases, and the reading that chose between them

| | The case | How it would show |
|---|---|---|
| 1 | the click never reached the main process | nothing anywhere — **the click handler wrote no log line** |
| 2 | it reached main, the route did not happen | app stays put |
| 3 | it routed, the reveal found no row | app lands on Notifications, nothing highlighted |

Case 3 was excluded outright by the user's own observation (the app stayed on Photos). Cases 1 and 2
were separated by the **Dock badge**, which is upstream of everything else the handler does:

```js
native.on('click', () => {
  this.unseen.delete(n.key);   // ← first statement
  this.refreshBadge();         // ← app.setBadgeCount(unseen.size)
  this.reveal(n.key);          // ← show, focus, then send('reveal-notification')
});
```

| Reading | Value | Control, same run |
|---|---|---|
| `AXStatusLabel` on the Dock's ConnectSuite item, 10:20 | **1** | Finder → `missing value` |
| same, 10:23 | **3** | Finder → `missing value` |
| `→ notify` decisions since 10:14 | **3** — 10:14:04.726, 10:22:23.050, 10:22:37.705 | 27 in the whole file, all sessions |

Badge equalled posts at both readings. `unseen` is decremented only by the click handler, by a
phone-side removal, or by `markAllSeen` (focused **and** on Notifications — the app was on Photos
throughout). `unseen.delete` cannot throw. **Case 1: the closure never ran.**

The renderer half was then measured *by parts* in the packaged build, since the IPC hop cannot be
injected over CDP — this proves what the handler would have done, not that it ran:
`shell.route('notifications')` landed in **44 ms** (`stopped: settled`, so not a blocked no-op);
**32** rows carried a `data-key`; and **32 of 32** keys re-found their own row through the handler's
`CSS.escape` selector shape — including a WhatsApp key carrying `+`, `/`, `=` **and an embedded
newline**, which was a fourth candidate wearing the same symptom.

### The mechanism: lifetime, and the discriminator that chose it

Two candidates, neither ruled out by the above: the `Notification` instance is unretained
(`const native = …` is local, and a collected instance takes its listeners with it), or macOS never
delivered the click to an ad-hoc-signed process launched outside LaunchServices.

The discriminating stimulus was a banner clicked **within a second** rather than after minutes. It
came back as: the window came to the front and switched to Notifications **by itself**, from
minimised, with the Dock untouched — reported by the user, and corroborated in the log by a
`com.whatsapp → already-visible` decision at 11:15:47.919, a line reachable only through
`windowFocused && currentScreen === 'notifications'`.

**Young banner delivered, old banner lost. The mechanism is object lifetime.**

### Two instrument faults in this run, both mine, neither a product bug

- **The badge baseline was invalidated before the first banner posted.** The link dropped at
  10:31:31 (`no pong in 15s`) and reconnected at 11:09:18; the notification set is cleared on
  disconnect, which cleared `unseen` and the badge with it. The promised 3 → 4 arithmetic was dead
  on arrival, and the `missing value` the probe read six seconds after the banner was not a reading
  about any click.
- **The control was the wrong shape.** Finder returns `missing value` for `AXStatusLabel` too, so
  once ConnectSuite read `missing value` a broken query and an empty badge gave the same answer. A
  negative control cannot distinguish those; it needed **something with a badge in the same run**.
  The earlier readings of `1` and `3` were sound for exactly this reason and the later one was not,
  which is the whole distinction.

Both are this file's own table with the instrument on the wrong end, and the second is the
`CLAUDE.md` control rule broken by the person who had just quoted it.

### Defect 83 — the fix, and what it costs

`LiveNotifications<T>` in `src/shared/` holds **the unseen keys and their banner handles in one
container**, because two containers holding one lifetime is defect 67's shape: the invariant would
live in writes inside a class that needs Electron, where no test can reach it. The badge is
`live.size`; retention is the same map. Released on click, on phone-side removal, and on
`markAllSeen`; a re-post under a held key hands back the superseded banner, which is closed rather
than left on screen unclickable.

**The residual is chosen, not missed:** a banner still showing when its key leaves is no longer
protected. Releasing the reference makes the instance collectable rather than destroying it, so a
click on it becomes a race with the collector. Holding the handle longer means holding it until
macOS reports the banner closed, and Electron's `close` is not guaranteed on macOS — a bounded
silence against an unbounded leak in an app meant to run all day.

**5 tests, shown red first.** The mutation is the two-container version this replaces — `release`
returning the handle without deleting it. Four tests stay green and the invariant test fails at the
first release, which is the point: the four describe the decision, the fifth describes the state.

### Also in this build

- **The click handler logs.** `click <package> — handle held | HANDLE ALREADY RELEASED …, N still
  unseen — C clicked / P posted since launch`, written **before** the work, so a click that arrives
  and then throws still leaves evidence that it arrived. This diagnosis depended on inference from a
  number with four writers; it will not again.
- **`createWindow()` now precedes `loadIdentity()`** (D15). It does not remove the Keychain prompt —
  only a stable designated requirement does — it removes the *hung-with-no-window* symptom that made
  a 4m40s block read as a crash. Verified in the shipped `app.asar`, not the source:
  `main.js:466 createWindow()` immediately above `main.js:467 loadIdentity()`.
- **The clock-skew claim is deleted rather than repaired.** Two comments said the measured skew was
  logged every session; the file held **10** `Session ready` lines and **0** skew lines. Nothing on
  the wire carries the phone's clock at the instant the cutoff is armed, so `CLOCK_SKEW_GRACE_MS` is
  a judgement with no reading behind it, and now says so.

Mac tests **467**, `tsc` clean on both projects.

### The verdict, on hardware

**Defect 83 is closed.** A banner that had been sitting **several minutes** was clicked, and the app
routed and revealed the row. That is the pass criterion as written above and it is deliberately not
the young-banner click, which already worked with the bug in place — a fix observed only in the
state where the bug does not bite is not a fix that has been observed.

**Fix 3 confirmed in the same launch**: the window is visibly behind the Keychain dialog, where
before there was no window at all. It does not remove the prompt and was never going to.

### Still not claimed

Checks 3 (the badge clearing when the pane is focused) and 4 (no banner while sitting on that pane)
are untested on this build. `already-visible` was observed once at 11:15:47.919 — but on the
*previous* binary, as a side effect of the click diagnosis rather than as a test, and a decision
observed in passing is not a check that was run.

### Defect 84 — eleven banners from one notification, found while waiting for check 3

Filed before checks 3 and 4 were run, deliberately: a defect found while waiting for something else
is the one that gets lost when the thing you were waiting for arrives.

Since the 11:51:27 launch, `com.jio.myjio` was **posted once and updated 119 times**. Its 119 updates
were decided as **88 `ongoing`, 21 `update`, 11 `notify`** — eleven native banners, for one
notification, in roughly three and a half minutes.

**The pane's row count went 38 → 39 across the entire burst.** That is the number that matters: it
proves this is one row being redrawn rather than a flood of arrivals, and without it eleven banners
is indistinguishable from eleven messages.

The control, in the same window, taken by looking at the lines rather than trusting a count:

```
com.whatsapp     posted=4  updated=3
com.jio.myjio    posted=1  updated=119
```

### The mechanism needs both halves — either one alone suppresses nothing

- **`whenMs` was measured against a messaging app and is correct for it.** `UPDATE` fires only when
  `whenMs <= previous.whenMs`, and the rule's own comment states the reasoning: *"A progress bar
  keeps its original `when`; a new message advances it."* That is true of WhatsApp, which is why one
  conversation's second message must banner. **Jio advances `when` on every tick**, so each tick
  reads as a new message and the rule declines to suppress it.
- **The `ongoing` flag flaps on the same key.** 88 of the ticks carried `ongoing: true` and were
  suppressed correctly. The leak is precisely the frames where `ongoing` read **false** *and* the
  timestamp had advanced — 11 of them.

Neither fact produces the defect alone. A key that advanced `when` but stayed `ongoing` would be
silent; a key that flapped `ongoing` without advancing `when` would be caught by `UPDATE`. This is
the `REPLAY` failure — a burst of banners about something already known — arriving through a door
`REPLAY` does not cover.

### Fix direction, and what is not a fix

A **per-key cooldown** is the obvious candidate, and it is a **product judgement rather than a bug
fix**: it decides how soon one key may banner twice, which is a question about what a person wants,
not about what the code got wrong. It is not being written inside a defect fix.

**No package allowlist solves this**, and this is the sharper half. The correct answer for
`com.jio.myjio` is *sometimes* — the same key legitimately banners when it carries a real message and
must not when it is ticking. A list of "important apps" cannot express *sometimes*, is wrong for
everybody but its author, and fails silently in the direction of not telling you things, which is
the failure this whole feature exists to remove. `nativeNotify.ts` already refuses an allowlist for
that reason and the refusal stands.

### Checks 3 and 4 — both pass, and the residual appeared between them

```
12:06:20.797  com.whatsapp → notify                     ← badge 1 → 2 (jio's key still unseen)
12:07:06.882  pane is in front — 2 marked seen, …       ← badge = missing value
12:07:14.390  click com.whatsapp — HANDLE ALREADY RELEASED (seen, removed, or lost), 0 still unseen
                                                          — 2 clicked / 13 posted since launch
12:07:18.423  com.whatsapp → already-visible            ← no banner
```

**Check 3 passes on both halves**, and the line is the half that matters. The badge clearing is
corroboration; `pane is in front — 2 marked seen` is what separates `markAllSeen` from the three
other things that clear that number, and it was written precisely because yesterday's diagnosis had
to infer the clearer from a badge with four writers. Positive control for the badge attribute in the
same run: it read `1` and `2` during the burst before clearing, so `missing value` here is an empty
badge rather than a blind query — the fault that cost the first discriminator.

**Check 4 passes**: `→ already-visible` at 12:07:18 with the pane focused, and no banner. "No banner"
is an absence, so the decision line is the evidence — every other route to silence (`replay`,
`ongoing`, `group-summary`, `update`, a macOS refusal) writes its own distinct line, and none of them
is on this one.

**The line between them is defect 83's documented residual, occurring in ordinary use eight seconds
after the release** — and it corrects the wording. The click was **delivered**: the handler ran, the
tally advanced to `2 clicked / 13 posted`, and `reveal` was called. Releasing the reference does not
destroy the instance, it makes it collectable, so the residual is *a race with the collector*, not
*unclickable*. Both the code comments and defect 83's row said "stops being clickable" and now say
what happened. A later click in the same sitting logged `handle held, … 3 clicked / 14 posted`, which
is the protected path for contrast.

---

## Phase 7 · Slice 17 — the clipboard pane's silence, and four trigger routes measured · 2026-09-04

**Reported by the user, and the report was right about the symptom and right to refuse the obvious
diagnosis.** They copied `guvgu` on the phone, pressed ⌘V on the Mac, got the Mac's own last clip,
looked at the Clipboard pane, saw nothing, and concluded the feature was broken. Then they opened
ConnectSuite on the phone and it arrived immediately.

That is Slice 11's wall behaving exactly as measured, and they said so: **do not fix the wall.** What
they filed instead is a UI defect — *the pane gave me no way to tell "nothing has arrived because
Android won't let it" from "nothing has arrived because something is wrong"* — which is the same
shape as nobody-scanned versus scanned-and-failing (F6/P3), and the same shape as the Files pane's
empty-versus-failed, the thing an entire proposal revision was written to separate.

### 1. What the pane says right now, read from the running app

Read through `scripts/probe.mjs` against the **packaged** build on :9222 (`release/mac-arm64`), which
is what the user was looking at. `scripts/clipboard-pane-probe.mjs` **passes every check it has**,
and that is the first finding rather than a reassurance:

```
does the phone-side block still state the one-directional limit? → true
does the limit name Android as its owner, and deny being unfinished work? → "true,true,true,true"
All reportable.
```

The copy exists, and it is good copy. `#clip-wall-phone` reads, in full:

> The other direction is Android's rule, not an unfinished feature. Android forbids every app from
> reading the clipboard while it is in the background — no Android app can do what an iPhone does
> here, and ConnectSuite is not an exception to it. So the phone can only send its clipboard while
> ConnectSuite is open on screen: copy on the phone, open ConnectSuite there, and it arrives.

**It names the owner, denies being unfinished work, and gives the recipe. And the user did not read
it, because it is not where they were looking.** Geometry, same run, `innerWidth === outerWidth`
(unzoomed) and the pane visible:

| Element | top | bottom | height | on screen |
|---|---|---|---|---|
| `#clip-list` — what they read | 399 | 829 | — | **100%** |
| `#clip-wall-phone` — the explanation | 828 | 1001 | 173 | **37 px, 21%** |

The wall **begins one pixel before the list ends**, in the right-hand `aside`, below the Mac-direction
wall that occupies the visible part of that column. In an 865 px window, 136 of its 173 px are below
the fold. The screenshot is `docs/evidence/phase-7-clipboard-silence-2026-09-04/clipboard-pane.png`
and the bottom of the right column is mid-sentence in the *other* wall.

**The left column — the whole of it, chrome only — is 299 characters and says nothing about the
limit:**

```
All 13 | From phone 1 | From this Mac 12 | Clear all
Send this Mac's clipboard | Ask the phone for its clipboard | Send what I copy automatically
On this Mac's clipboard now — ⌘V to paste.
13 of 20 entries, in memory only — cleared when the phone disconnects, gone when this app
restarts, never written to disk.
```

`mentionsAndroid: false`, `mentionsOpenOnScreen: false`. And `#clip-notice` — **the one live status
strip in the column the user was reading, not hidden, updating** — said
*"On this Mac's clipboard now — ⌘V to paste."*, which is the direction that works. `namesPhoneDirection:
false`.

So the pane's only live state is about Mac → phone, and the phone → Mac explanation is standing copy
in the other column, below the fold. **Nothing on that screen is wrong. The user still could not
answer their question from it**, and there is no state in the pane that would have differed had the
link been genuinely broken.

One more reading, because it sharpens the defect rather than softening it: `guvgu` **was in the
list** — drawn as `Gucgu · Phone · 12:15:32 PM` — and the filter tab read **`From phone 1`**. The
pane already counts the two directions separately. It has the number and does not use it to say
anything.

#### Two instrument faults in this run, both caught by their controls

- **The row selector.** `[data-clip-row], li` returned **0 rows** while `clipboard-pane-probe.mjs`
  read **13** the same moment. Rows are `#clip-list > *`. A zero from a wrong selector is the second
  entry in `CLAUDE.md`'s table wearing a CSS costume, and it was caught only because a second
  instrument had already counted the same thing.
- **A text search over a pane whose content is user data.** Asking `.clip-panel` whether it
  *mentions Android* returned **true** — over **32,569 characters**, of which 32,270 are thirteen
  rows of the user's own clipboard history. The pane's own chrome is 299 characters and does not
  mention it. This is *searching for a forbidden thing finds the sentence forbidding it*, with a new
  source for the lookalike: **not the prose about the claim, but the user's data flowing through the
  thing being measured.** A clipboard pane will match any word, given a user who copied it. The fix
  is one line — clone the node, remove `#clip-list`, then search — and the chars are printed beside
  the verdict so a hit over 32k can never again be read as a hit over the copy.

### 2. Is there a cheaper trigger than opening the app? Four routes, measured

`ClipTriggerProbe.kt` — debug-only, `app/src/debug/`, four routes, each reporting `focused=` and
`importance=` on its read line so the answer is attributable rather than deduced.

**Why this was measured and not computed.** Slice 11 established the discriminator — focus, not the
accessibility grant, not foreground-service importance — and from it every row below can be
*deduced*. That deduction is right, and it is not a measurement; the last load-bearing platform claim
this project inherited rather than measured (the accessibility exception) turned out not to operate
on this handset at all.

| # | Route | `focused` | `importance` | clipboard read | platform denial |
|---|---|---|---|---|---|
| 1 | notification action → **broadcast** | false | 125 | **refused** — `returned=false items=0` | yes, same millisecond |
| 2 | quick-settings **tile** `onClick` | false | 125 | **refused** — `returned=false items=0` | yes, same millisecond |
| 3 | notification action → **activity** | true | 100 | **1,623 characters** | — |
| 4 | **`ACTION_PROCESS_TEXT`** | — | 100 | *never asked* — text was in the Intent | — |

**The control is routes 1 and 3 in one four-second window, over one clipboard**: 0 characters
unfocused at 12:50:03.617, 1,623 characters focused at 12:50:05.864, and again at 12:50:07.920. Same
app, same device, same clip. The difference is focus and nothing else, which is Slice 11's finding
reproduced against three new entry points.

```
12:50:03.617 READ route=notification-broadcast focused=false importance=125 returned=false items=0 threw=no
12:50:03.617 E/ClipboardService: Denying clipboard access to com.chetan.connectsuite.debug,
                                 application is not in focus nor is it a system service for user 0
12:50:05.864 READ route=notification-activity  focused=true  importance=100 returned=true  items=1 length=1623
```

`threw=no` on both refusals is worth its own line: **the refusal is silent at the API.**
`primaryClip` returns null and raises nothing, so a handler written with `runCatching { … }
.getOrNull()` would see no failure to log — defect 57's shape, on a path where the platform is
writing an `E` line about us at the same millisecond.

**So: for reading the clipboard, a focused activity is the only route on this device.** Routes 1 and
2 are the cheap ones and both are refused. That is the answer to the question as asked, and it is
recorded as a stop.

#### Route 4 is not a way around the wall — it never approaches it

`ACTION_PROCESS_TEXT` puts an entry in the **text-selection floating toolbar**, beside Copy. The
selected text arrives in `EXTRA_PROCESS_TEXT`; the clipboard is never consulted, so no rule about
reading it applies. Measured:

```
12:47:24.079 ARMED route=sink action=android.intent.action.PROCESS_TEXT
             textArrivedInIntent=true intentTextLength=31
```

31 characters, the exact length of the string sent. And it **resolves on this handset** — 11 packages
answer `PROCESS_TEXT`/`text/plain`, ours among them, and the other ten are shipping apps that use
this exact mechanism for the same reason:

```
ai.perplexity.app.android   com.anthropic.claude    com.openai.chatgpt      com.deepseek.chat
com.adobe.reader            com.truecaller          com.samsung.android.samsungpass
com.samsung.android.spay    com.samsung.android.app.interpreter
com.google.android.googlequicksearchbox
```

That list is the control: an empty result would have meant a manifest that did not take, and a list
containing only us would have meant a mechanism nobody uses.

**A third instrument fault, and it produced a clean zero.** The first resolver query ran as
`adb -s "" …` — `scripts/target-device.sh` prints its `OK target …` line on **stderr** and the serial
on stdout, and `awk '{print $3}'` over the merged stream yielded an empty string. It reported
**0 PROCESS_TEXT resolvers**, which reads exactly like *the intent-filter did not take*. The control
that catches it is the one already in this file: a count that should be non-trivially greater than
zero, checked before the count that matters.

### 3. What this does and does not license

**Measured:** a focused activity is the only route that can read the clipboard here (routes 1-3);
`ACTION_PROCESS_TEXT` delivers text without reading it and resolves on this device (route 4).

**Not measured, and not claimed:** whether a `PROCESS_TEXT` entry actually *appears* in the selection
toolbar of the apps the user copies from. The intent resolves — that is a statement about the package
manager, and a **registration line is not an execution line**. Several apps use custom text-selection
toolbars and some suppress third-party entries; the toolbar also caps its visible items. The stimulus
that would settle it is one long-press-and-select in three apps the user actually copies from, and it
needs their hands. Route 4 is therefore recorded as **permitted, sighting unproven, stimulus named**
— the same status F6/P3 carries, and for the same reason.

### Defect 85 — the Clipboard pane cannot say why nothing arrived

**The pane has no state for the one thing that is always true about the phone direction.** Its only
live strip, `#clip-notice`, is about Mac → phone; the Android explanation is standing copy 828 px
down the *other* column, 21% on screen. A user who copies on the phone, looks, and sees nothing gets
the same picture whether Android refused the read, the link is down, or the app has crashed — and
the user who filed this concluded, reasonably, that the feature was broken.

**Why every existing check passed over it.** `clipboard-pane-probe.mjs` asserts the copy is **in the
DOM** and it is. Nothing in this repo measures *where* a sentence is relative to the thing it
explains, and the pane's own view test constructs its state by hand — the field a test supplies is
never the field a layout gets wrong. This is `showsState` again: a correct string in a place no user
in that state is looking.

**Fix direction.** The pane already computes the number it needs — the filter tab reads `From phone
1` — so this is a placement and a state, not new plumbing. Put a phone-direction line in the **left
column**, beside `#clip-notice` and subject to the same liveness, saying when the phone last sent and
that it can only send while open; and make it distinguishable from a broken link the four ways the
Files pane separates empty from failed, since here both are reachable.

**The wrong fix is to move the wall copy up, or to make it bigger.** The defect is not that the
sentence is too small — it is that the pane has *no state* for the phone direction, so the sentence
has to be permanent, and a permanent sentence is one a user reads once and stops seeing. The second
wrong fix is a banner that appears when nothing has arrived: nothing-has-arrived is the resting state
of a working feature, and a warning that is usually wrong is one people learn to ignore.

**The related finding, not a defect.** Route 4 above is the only measured way to make the trigger
cheaper, and it is a different feature rather than a fix to this one.

---

## Phase 7 · Slice 18 — defect 85 fixed, and the cheap trigger built · 2026-09-04

### 1. The live line, proven at the geometry the report came from

`src/shared/clipPhoneState.ts` — four states as a tagged union, differing four independent ways.
The pair that must never converge is **`waiting` against `offline`**: working-and-quiet against
broken-and-quiet, which is what drew one picture.

| state | tone | icon | headline | action |
|---|---|---|---|---|
| `waiting` | `ready` | ● | Ready for anything you copy on the phone | *none* |
| `received` | `done` | ✓ | Arrived from the phone *just now* | *none* |
| `offline` | `warning` | ✕ | Not connected to your phone | Reconnect |
| `unavailable` | `warning` | ⚠ | Your phone is not offering its clipboard | Check the phone |

**`waiting` is not a warning, and that is the design constraint rather than a styling choice.**
Nothing-has-arrived is the resting state of a working feature, so a banner there would show almost
always and be right almost never. It has its own tone, an affirmative verb, and **no action** —
offering a Retry would assert a problem that does not exist.

**Proven at 1440 × 865, unzoomed, in a window with a populated list** — the report's own geometry:

```
#clip-phone-state   top=360  bottom=438   100% on screen,  above the list (listTop=438)
#clip-wall-phone    top=769               55% on screen,   and that is fine now
left-column chrome  299 → 492 chars       namesAndroid=true, namesTheRecipe=true
```

All four states were driven and screenshotted at that size (`state-*.png`); each read back 100% on
screen with its four fields distinct. The three broken/synthetic ones are **labelled synthetic** —
`setLinkState` was called directly and the pane put back on the phone's real status afterwards, with
the restored read printed. `received` is **not** synthetic: it was produced by a real send in §2.

**This needed a third instrument, and that is the finding rather than an aside.**
`clipboard-pane-probe.mjs` passes all nine of its checks over the *unfixed* pane, because it asks
whether the copy is in the DOM and it was — at 21% on screen. The new view tests run against a DOM
double with **no layout at all**. Neither layer can see a defect about *where* something is, so
`scripts/clipboard-silence-probe.mjs` reads rectangles from a real window and every check is
*is it inside the viewport*, never *is it in the document*.

**Three mutations, red on exactly the right tests:** `waiting` sharing a tone with the broken states
(3 red), the broken states dropping their action (2 red), and dating the line by the phone's clock
instead of this Mac's (1 red).

#### The failure that no test could see, and it shipped for an hour

The first version of `clipPhoneState.ts` used `export function`. `tsc` emits CommonJS, the renderer
loads `shared/*.js` as **plain `<script>` tags**, and the module died on its first line:

```
EXC: ReferenceError: exports is not defined
    at describeClipPhone (dist/shared/clipPhoneState.js:85:17)
    at ClipboardView.drawPhoneState (dist/renderer/clipboard.js:438:22)
```

**484 tests green, and the line had never once drawn.** The tests reach the module through `tsx`,
which is a path the renderer never takes — verbatim `CLAUDE.md`'s rule about `SmsStore` and defect
50, *a test that reaches the thing by a path the app never takes can pass forever over a feature
that has never worked*. It was found the way defect 67 was: by opening the page and reading the
console. The file's header now carries it, because the `export` keywords are the obvious thing for
someone to "tidy" back in.

### 2. `ACTION_PROCESS_TEXT` — the cheap trigger, built and proven end to end

`SendSelectionActivity` (app) + `SelectionSend` (sync-module, the pure decision). The gesture is
**long-press → "Send to Mac"**, in the same toolbar as Copy.

**It never touches the clipboard, which is the whole point.** The text arrives in
`EXTRA_PROCESS_TEXT`, so the background-read rule is not circumvented — it is not engaged. Slice 17
measured that rule against three other entry points and all three were refused.

End to end, phone backgrounded, nothing on screen:

```
phone  13:22:49.030 [clip] clip.push → Mac via selection: 31 bytes from Shell
                          — 1 sent / 1 received / 1 of 1 applied / 0 refused-unfocused …
phone  13:22:49.030 [clip] selection route: action=…PROCESS_TEXT from=com.android.shell
                          chars=31 readOnly=false → Sent
Mac    13:22:49.092 [clipboard] Applied an arriving entry to this Mac's clipboard: 31 bytes,
                          previous clipboard captured — 6 sent / 1 received / 1 of 1 applied
$ pbpaste
selection-route-end-to-end-1347
```

**`pbpaste` is the reading, not the log line** — the far end, measured, rather than the stimulus
reported. And the pane flipped to `received` / `done` / *"Arrived from the phone just now"* in the
same run, which is the one state §1 could not produce synthetically.

Two controls on the resolution:

- **11 packages** answer `PROCESS_TEXT`/`text/plain` on this device, ours among them, and the other
  ten are shipping apps (ChatGPT, Claude, Perplexity, DeepSeek, Adobe Reader, Truecaller, Samsung
  Pass, Samsung Pay, Interpreter, Google). An empty list would have meant a manifest that did not
  take; a list containing only us would have meant a mechanism nobody uses.
- **Exactly one of our activities** answers it. The debug probe's filters were removed once the real
  feature shipped — two activities answering one intent puts *two* ConnectSuite entries in the
  user's selection toolbar. Counting `grep -c connectsuite` said **12**; counting *activities* said
  **1**. That is the units rule, on the same day it was written about, in the same file.

`SelectionSendTest` — 8 tests. The ordering tests pass **throwing** functions for the later guards,
so a guard that runs when it should not takes the test down rather than returning a coincidentally
equal answer. The mutation that matters — moving the `NoLink` guard below the echo rule, which would
make a disconnected phone answer *"that already came from your Mac"* — goes red on exactly one test.

### 3. The copy went stale the hour the feature shipped, and nothing could have flagged it

The `waiting` recipe originally read *"copy on the phone, then open ConnectSuite there"*. True when
written; **the wrong one of two paths** as soon as `SendSelectionActivity` landed, which is defect
63's shape exactly — a second implementation of something the product already had, leaving every
existing sentence about the first quietly ambiguous. The sentence stayed accurate, stayed tested,
and described the slower route as though it were the only one.

Rewritten to name both, toolbar route first because it is the cheaper gesture, and there is now a
test asserting **every route the product has appears in the copy a waiting user reads** — so a third
way to send fails it until somebody decides whether it belongs in the sentence.

### 4. Unproven, with the stimulus named

**Whether "Send to Mac" appears in the selection toolbar of apps the user actually copies from.**
The intent resolves — that is a statement about the package manager, and a registration line is not
an execution line. Some apps use custom selection toolbars, some suppress third-party entries, and
the toolbar caps its visible items. The stimulus is one long-press in three real apps, and it needs
the user's hands.

---

## Phase 7 · Slice 19 — the toolbar entry was drawn all along, behind a Samsung switch · 2026-09-04

The user hand-tested Slice 18's `ACTION_PROCESS_TEXT` entry in WhatsApp, Chrome and a plain text
field and **did not see it in any of them**. Two questions came back: is it drawn at all, and is it
behind the overflow rather than absent.

**It is drawn, it was never absent, and the reason it did not appear is neither of the two things
the question offered.** One UI ships `ACTION_PROCESS_TEXT` as an **opt-in, per-app switch that is
off by default**, in a Settings screen reached only from inside the selection toolbar itself.

### The control is what makes this a platform finding rather than our bug

The toolbar in Chrome's omnibox, before anything was changed:

```
✨ | Cut | Copy | Paste | Translate | ⋮
⋮ → Share · Undo · Clipboard · Manage apps
```

**Zero third-party entries** — no ChatGPT, no Claude, no Perplexity, no us — against **fourteen
activities** that answer `PROCESS_TEXT`/`text/plain` on this device. The absence is not ours; it is
everybody's, which is the enumerate-the-whole-surface control doing its job. Had only our entry been
missing, this would have been a defect.

`Manage apps` opens `com.samsung.android.settings.display.SecProcessTextManageAppsFragment` —
*"Select apps to show in the contextual menu"* — and every row in it read `checked=false`:

| Row | switch |
|---|---|
| Google · Ask Gemini | false |
| Samsung Pass · Save to Samsung Pass | false |
| Perplexity · Ask Perplexity | false |
| Adobe Acrobat · Add to Acrobat PDF Spaces | false |
| Adobe Acrobat · Create PDF in Acrobat | false |
| Claude · Ask Claude | false |
| **ConnectSuite · Send to Mac** | **false** |
| DeepSeek · Ask DeepSeek | false |
| ChatGPT · Ask ChatGPT | false |
| Samsung Wallet · Pay with Pix | false |
| Truecaller · Search in Truecaller | false |

**Our row is present, correctly labelled, and off — like all ten others.** So the manifest, the
intent-filter and the `android:label` were all right; nothing in the app could have made it appear.

### Then the causal step, one variable at a time

Ours switched on, neighbours left off (`Ask Claude: false`, `Send to Mac: true`, `Ask ChatGPT:
false`), and a fresh selection raised in the same field:

```
first row   ✨ | Cut | Copy | Paste | Translate | ⋮      ← still not here
⋮        →  Share · Undo · Clipboard · Send to Mac · Manage apps
```

**So the answer to the second half of the question is yes: behind the overflow, not on the first
row.** The framework orders every `PROCESS_TEXT` item at `MENU_ITEM_ORDER_PROCESS_TEXT_INTENT_ACTIONS`,
after Cut/Copy/Paste/Share/Select-all — and this phone has ten of them competing, with ours ninth in
resolution order.

Then the real gesture, in a real foreign app:

```
13:57:54.121 [clip] clip.push → Mac via selection: 28 bytes from Chrome — 4 sent / 11 received …
13:57:54.121 [clip] selection route: action=…PROCESS_TEXT from=com.android.chrome chars=28 → Sent

Mac pbpaste, before:  MAC-CLIPBOARD-BEFORE-THE-TAP
Mac pbpaste, after:   probeselectiprobeselectionon
```

`from=com.android.chrome`, resolved through `AppLabels` to **Chrome** — the first end-to-end run of
this feature driven by a tap on the real toolbar rather than by `am start`.

### Three instrument faults, and the first two are the same one twice

- **`uiautomator dump` cannot see the floating toolbar.** Four consecutive dumps returned 36–64
  nodes with **no Cut, no Copy, no Paste** — and the toolbar was on screen throughout, as a
  screenshot showed. Every one of those was a *missing* reading, and the first was one sentence from
  *"the toolbar does not appear"*. The control is the rule already in this file: the dump must return
  the items you know are there before its silence about a third one means anything. It never did, so
  it never held a reading. **A screenshot was the only instrument that could see this surface.**
- **`input keycombination 113 29` (Ctrl+A) selects without raising the toolbar.** The stimulus was
  reported as applied and the thing it was supposed to produce never existed — the sixth row of
  `CLAUDE.md`'s table, where the window never opened rather than closing between samples.
- **`sort -u` over the resolver list destroyed the ordering**, which is the one property that decides
  whether an item lands on the first row or in the overflow. It was re-run unsorted, and only then
  was ours locatable at 9 of 14. A sort is a transformation the instrument imposes, and it belongs in
  the same category as a page cap: it must appear in what the instrument reports.

### The state this run left on the device

**`Send to Mac` is switched ON for this handset** and the other ten rows were left untouched. That
is a change to the user's phone made in the course of proving the mechanism, and it is recorded here
rather than left for someone to find.

---

## Phase 7 · Slice 20 — position is not ours to influence, and which apps can reach the entry · 2026-09-04

### 1. Can we move the entry? Three levers, all measured, all dead

| Lever | Measured | Result |
|---|---|---|
| `android:priority="999"` on the intent-filter | declared, built, installed, re-queried | **recorded as `priority=0`.** Position unchanged — still 9th, between Claude and DeepSeek |
| an `android:icon` on the activity | vector added, installed, overflow screenshotted | **not drawn.** The One UI overflow is text-only for every item, built-ins included |
| a shorter label | — | **cannot matter.** The entry is in a text-only vertical list; length changes no position |

**The control on priority is the strongest part:** across all twelve `PROCESS_TEXT` filters on this
device — Google, Samsung ×3, Adobe ×2, Claude, DeepSeek, ChatGPT, Truecaller and ours —
`priority=` is **`0` twelve times out of twelve**. Nobody holds a non-zero one, including us after
declaring 999. The platform clamps third-party filter priority; it is not a lever anyone is winning.

**And the first row is full before any app is considered.** Measured across four apps:

```
Chrome omnibox   ✨ Cut Copy Paste Translate            ⋮
Telegram search     Cut Copy Paste Translate            ⋮
Google Keep         Cut Copy Paste Translate Share Undo Clipboard ⋮
Gmail search        Cut Copy Paste Translate Share Undo Clipboard ⋮
```

Seven built-ins at maximum width. `PROCESS_TEXT` items are ordered *after* all of them by the
framework, so **no app entry reaches the first row on this phone** — not ours, not ChatGPT's. With
exactly one app entry enabled it still went to the overflow.

**So the answer is nothing, and nothing was shipped.** The priority attribute was reverted and the
icon deleted rather than left in the manifest: a declared-but-clamped value reads to the next person
as a lever that works, which is the dead-config failure this repo already records.

**The one case this cannot speak to:** a phone with few enough `PROCESS_TEXT` apps that an entry
reaches the first row, where an icon might then be drawn. Unmeasurable here — this handset has ten.
`docs/single-device-audit.md`.

### 2. Which apps can reach it — the category, measured

`scripts/selection-toolbar-probe.sh`, one app at a time. Three outcomes, and the third is the one an
ad-hoc run loses: **PLATFORM** (Cut/Copy/Paste present), **CUSTOM** (a toolbar without them), and
**NO READING** (no toolbar, or no text field found — the stimulus did not land).

| App | Field | Verdict |
|---|---|---|
| Chrome | omnibox | **PLATFORM** — and `Send to Mac` delivered from here, 28 bytes, Slice 19 |
| Telegram | search | **PLATFORM** |
| Google Keep | search | **PLATFORM** |
| Gmail | search | **PLATFORM** |
| Instagram, X | first screen | **NO READING** — no `EditText` on the launch screen |
| Samsung Notes | first screen | **NO READING** — same |
| **WhatsApp** | — | **NO READING — behind a biometric lock.** Needs a human finger |

**Every app that uses a standard text field got the platform toolbar.** No app in this run drew its
own. That is four for four, and it is *not* a proof that none does — the three `NO READING` rows are
missing readings, not passes.

**The probe cannot classify, and says so.** `uiautomator dump` **cannot see the floating toolbar**
(Slice 19), so the script drives the stimulus and captures a frame for a person to read. A script
that guessed a verdict from a tree structurally incapable of containing the answer would be the
decoration rule with a shell prompt.

#### The instrument fault in this slice, and it produced a false CUSTOM

The probe's first version long-pressed the **centre** of the text field. On a short string that is
empty space past the end of the text, so the long-press selected nothing and raised no toolbar —
and Telegram came back looking like an app with no selection toolbar at all. It has the ordinary
one. Pressing 70 px inside the left edge, where typed text actually starts, produced
`Cut Copy Paste Translate ⋮` immediately. **A stimulus aimed at the wrong pixel is a missing
reading**, and it presented as a finding about the app.

### 3. The fix for defect 86, on hardware

`ClipboardCopy.kt` — strings out of the composable so they can be enumerated, the `OnboardingCopy`
shape and the same reason. Rendered on the device, all four steps in walking order:

```
Send text without opening this app
Select text anywhere on this phone and you can send it straight to your Mac …
1. Select some text in any app and let the little toolbar appear.
2. Tap the three dots at the end of that toolbar.
3. Tap Manage apps.
4. Turn on ConnectSuite — the row says Send to Mac.
After that, Send to Mac is in the same three-dot menu whenever you select text. It will not
appear next to Copy — this phone keeps that first row for its own buttons.
Your phone ships this switched off for every app that offers it, not just this one.
```

The step order is load-bearing and tested: the switch is reachable **only from inside the selection
toolbar**, so a list opening with *"go to Settings"* would send people where the destination does not
exist. That mutation goes red on two tests. Also tested: the *not next to Copy* line, without which
the setup reads as having failed; and that the copy says **"your phone"** rather than *"Android"*,
because the screen is `com.samsung.android.settings.*` and one handset is not the platform.

**And the Mac's copy was wrong again, in the same place, for a new reason.** The `waiting` recipe led
with the toolbar route as the cheaper gesture — written before defect 86 was known, so it promised a
gesture that does not exist until a four-tap setup nobody has heard of. It now leads with the route
that always works and qualifies the other with *"once it is set up on the phone"*. That is the third
version of this sentence, and the second time it was the **wrong one of two paths**.

---

## Phase 7 · Slice 21 — the reachable set, and the wall under it · 2026-09-04

**The user finished the toolbar table by hand, and it closes the question.**

| App | Surface | What appeared |
|---|---|---|
| WhatsApp | message bubble | **its own bar** — emoji reactions, no Cut/Copy/Paste |
| Telegram | message bubble | **its own bar** |
| Telegram | search field | platform toolbar (measured here, Slice 20) |
| Chrome | omnibox | platform toolbar — **and `Send to Mac` delivers from the overflow** |
| Gmail, Keep | search fields | platform toolbar |

**The wall, in one sentence: an app that draws its own selection UI cannot be reached by
`ACTION_PROCESS_TEXT`, because those items are inserted by the framework's `Editor` into the
*platform* action mode, and an app that never starts one is not a place the entry can exist.**

It is the app's choice, there is no API that would change it, and there should not be — an app's own
long-press UI is its own. Recorded in `CLAUDE.md` under *Platform walls*, **not** as a defect: no
version of this app fixes it, which is the test that separates the two.

**Nothing is being built for the unreachable apps.** Opening ConnectSuite on the phone stays the
path there. That is one gesture, it always works, and the clipboard screen already says so.

### The one case still untested, with the prediction written before the test

The WhatsApp **compose box** — a text field the user typed into, not a message bubble. Written down
in advance so the reading cannot be rationalised afterwards, which is the pre-registration rule this
repo uses for anything whose answer would otherwise be easy to explain either way.

**Expected: the platform toolbar, with `Send to Mac` present in the `⋮` overflow.** The compose box
is an `EditText` subclass and WhatsApp adds *formatting* items to it (bold, italic, strikethrough,
monospace) rather than replacing the menu — adding to the platform action mode keeps `Editor`'s
`PROCESS_TEXT` insertion intact.

Three outcomes, and what each would mean:

| What is seen | Reading |
|---|---|
| `Cut Copy Paste …` **and** `Send to Mac` in the `⋮` | as predicted. WhatsApp is reachable in its compose box and unreachable in its bubbles — **one app, both sides of the wall**, which is the sharpest illustration of it |
| `Cut Copy Paste` **but no** `Send to Mac` anywhere in the `⋮` | WhatsApp adds its items *and* prunes the menu (`menu.removeItem`). Still the wall, still not a defect — but it would mean an app can be selectively hostile to third-party entries while keeping the platform ones, which is worth knowing and is **not** something the four apps measured here do |
| WhatsApp's own bar again, with no Cut/Copy/Paste | the compose box is custom too, and WhatsApp is simply unreachable everywhere |

**A crowded overflow is expected either way** and must not be read as absence: WhatsApp's formatting
items land in the same menu, so `Send to Mac` may sit below them and need a scroll. Slice 19's rule
applies — `uiautomator dump` cannot see this surface, so the instrument is a screenshot and a person.

---

## Phase 7 · Slice 22 — defect 84 fixed: a per-key cooldown, sized by a signal the phone already sends · 2026-09-04

### The door neither existing guard stands in

`com.jio.myjio`, one key, three and a half minutes: **posted once, updated 119 times**, decided as
**88 `ongoing` / 21 `update` / 11 `notify`**. Eleven native banners for one notification.

`ONGOING` catches ticks that declare themselves persistent. `UPDATE` catches re-posts whose
timestamp stood still. Jio **advances `when` on every tick** *and* **flaps `ongoing` on the same
key**, so the eleven leaks are exactly the frames where the flag read false with an advanced
timestamp — and both guards are correct: `UPDATE`'s rule was measured against a messaging app, where
a second message in one conversation *must* banner.

### The fix, and why a single number was not it

A per-key cooldown, with the **window chosen by whether the key has ever been `ongoing` in this
session** — the phone's own word about its own notification, not our opinion about its package.

| | Window | Why |
|---|---|---|
| event-shaped (never `ongoing`) | `EVENT_COOLDOWN_MS` **20 s** | a burst typed in one breath is one banner; a genuine follow-up a minute later is its own |
| status-shaped (seen `ongoing`) | `STATUS_COOLDOWN_MS` **10 min** | against Jio's measured cadence of a banner roughly every 19 s |

One number for every app cannot work: short enough to leave a chat responsive is too short to
quieten a ticker, and long enough for a ticker silences the second message in a conversation.

**There is still no package allowlist.** `nativeNotify.ts` refuses one and that refusal stands —
a curated list of important apps is wrong for everybody but its author and fails silently in the
direction of not telling you things. This asks the same question of every key.

#### The objection this design had to survive

A download posts progress as `ongoing`, then posts *"Download complete"* on **the same key**, not
ongoing — a real event, on a key that is status-shaped by the rule above. Does the ten-minute window
eat it?

**No, because the cooldown is armed by a banner and never by a post.** Progress ticks decide
`ONGOING`, which never banners, so they arm nothing; the completion is the first banner that key has
produced and it goes out. Jio is the opposite case — it *does* banner, so its first one arms the
window and the other ten are held. There is a test for exactly this, and it goes red under the
mutation that arms the window on every post.

### What is proven, and by what

Driven through the **real** decision and the **real** store together, in the shape `consider` uses:

| Sequence | Result |
|---|---|
| Jio's measured shape — one key, `ongoing` flapping, `when` advancing, 19 s apart, 30 posts | **1 banner**, was 11 |
| the control from the same run — a chat key, never `ongoing`, three messages 2 min apart | **3 banners**, untouched |
| three messages 3 s apart on one chat key | **1 banner** |
| 20 `ongoing` progress ticks then one completion | **1 banner** — the completion |

**Three mutations, each red on exactly the right tests:** removing the gate (the defect itself) reds
the Jio and burst tests; asking whether the **last** post was ongoing rather than **ever** reds the
store's session test — and that is the mutation that matters, because a ticker *flaps*, so the
last-post question lets every other frame through; arming the window on every post rather than on a
banner reds three, including the download completion.

Suite **500**, from 488.

### Unproven on hardware, with the stimulus named

**The `cooldown` branch has not fired on this device.** Ninety seconds of live traffic after the
build decided `39 replay / 10 group-summary / 7 ongoing` and **zero `notify`** — so there was no
banner to hold, and the zero is a **missing reading rather than a pass**. The control says why:
`com.jio.myjio` is present in the phone's shade (3 records of 55) but is **not currently ticking**;
the 119-update burst happened while it was active, and it is not producible on demand.

A registration line is not an execution line, so this is recorded the way F6/P3 is: **built, tested,
unproven in the field.** The stimulus is any app that advances `when` while flapping `ongoing` —
Jio's next active period. The evidence when it comes will be self-announcing: the suppression logs
its window kind, how many it has held and how many have posted, so a `cooldown` line in
`link.log` beside a stable banner count is the pass.

---

## Phase 7 · Slice 23 — defect 84's mechanism corrected, and was it us? · 2026-09-04

### The correction, and it came from the user rather than from any log

Defect 84 was written up as *a ticker flapping its `ongoing` flag* — a notification misbehaving.
**It was not.** Jio was playing music, and playback really was stopping and restarting: eleven
genuine new playback sessions, each with a fresh timestamp, each correctly not `ongoing` in the gap.
**The notification told the truth eleven times.**

Nothing in the log could have said this. `88 ongoing / 21 update / 11 notify` on one key is
identical whether the flag is flapping dishonestly or the music is genuinely restarting — the two
hypotheses produce **byte-identical** evidence, and the one on the table got written down. What
separated them was a person who knew what the phone was doing at the time.

**It does not change the fix, and the reason is worth keeping.** `ONGOING` catches posts that
declare themselves persistent; `UPDATE` catches re-posts whose timestamp stood still. A session that
genuinely stops and restarts is **neither** — so both guards are *right* to let it through, and the
thing that has to say no is a rule about how often one key may interrupt somebody. The cooldown is
that rule. What changed is what it is: **a rate limit on a truthful notification, not a guard
against a lying one** — and a truthful notification is exactly the kind to be careful rate-limiting.

### Then the question nobody asked: was it us?

We hold a wake lock, run a foreground service, and Phase 6 changed service lifetime. If ConnectSuite
disturbs playback on the phone, that is a real defect and Jio would have been blamed for months.

#### What is established, positively

**1. This app links no audio API at all.** Every audio symbol in the entire Kotlin source:

```
RemoteFeature.kt:231  AudioManager.ADJUST_RAISE   ← inside remote.command "volume_up"
RemoteFeature.kt:232  AudioManager.ADJUST_LOWER   ← inside remote.command "volume_down"
```

No `requestAudioFocus`, no `AudioFocusRequest`, no `MediaPlayer`, no `SoundPool`, no `AudioRecord`,
no `AudioPlaybackCaptureConfiguration`, no `setAudioSource`. **An app that never requests audio focus
cannot take it from another app** — that is structural, not an absence in a log. Mirroring is
video-only: there is no audio-capture configuration anywhere in `mirror-module`.

**2. Every media action we can take writes a log line, and no path escapes it.** Read rather than
assumed: in `RemoteFeature.handleCommand` every `transport.*()` call sits inside one `when` whose
result flows to a single `LinkLog.i("remote", "remote.command $action delivered …")`. The only early
returns are the `Unsupported` / `BadRequest` branches, which return **before** touching the
controller. So "no line" genuinely means "no action".

**3. The log covers the window, and it is empty of us.** Control first: `link.log` holds **10 lines**
timestamped `11:5x` on 2026-09-04, so a zero in it is a reading rather than a gap.

| | |
|---|---|
| burst window | handshake `11:51:48.763` → about `11:55` |
| `remote.command` sent to anything in that window | **0** — the nearest are nine to Spotify at `09:xx`, two hours earlier |
| `notif.action` sent to `com.jio.myjio` in that window | **0** |
| the only Jio action we have **ever** sent | `11:56:31.624` — **4m43s after the handshake, and after the burst ended** |

That last row is stated rather than buried: we did press an action on a Jio notification once, and
it was after the eleven banners, not among them. It is the feature doing what somebody asked.

#### What is **not** established, and will not be

**The direct audio-focus record for that window no longer exists.** `logcat` has rolled: **0 lines**
match `^09-04 11:5` across all buffers. So the reading that would have shown focus changing hands at
11:51–11:55 cannot be taken now, by anyone, and no amount of care recovers it. Anything below is
weaker than that reading would have been.

**The control the user asked for — the same pattern in windows when ConnectSuite was not running —
cannot be taken retrospectively** for the same reason. It would need either notification history
that is not kept, or a forward experiment against an intermittent event.

The live audio-focus stack was read and ConnectSuite appears **0 times in a 1611-line
`dumpsys audio`** — but the stack was **empty** at the time, because nothing was playing, so that
zero is a weak reading and is recorded as one rather than counted as evidence.

#### A sufficient alternative cause, standing on the device right now

```
am get-standby-bucket com.jio.myjio               → 40   (RARE)
am get-standby-bucket com.chetan.connectsuite     →  5   (EXEMPTED)
dumpsys deviceidle whitelist | grep -iE jio\|connectsuite
                                                  → user,com.chetan.connectsuite.debug,11011
                                                    (Jio is not on it)
```

**Jio sits in the RARE bucket with no battery-optimisation exemption, on the One UI handset whose
battery manager this project spent an entire phase surviving.** Phase 6 exists because this device
kills backgrounded apps that lack an exemption; our app needed one and got it, and Jio has not got
one. That is a complete explanation for music stopping and restarting, and it requires nothing of
ours to be true.

It is a **standing condition, not a measurement of that window** — bucket `40` today is not proof of
bucket `40` at 11:51 — so it is offered as a sufficient alternative cause rather than as the
established one.

### The verdict, with its limits attached

**ConnectSuite cannot have taken audio focus from the music, because it never asks for it — that is
structural and holds for every window, including the ones nobody logged.** Within the burst window
we sent the phone no media command and no Jio action of any kind, in a log proven to cover it. The
one Jio action we have ever sent was 4m43s later.

What remains genuinely open is narrower than *"was it us"* and should be stated in its own words:
**no reading exists of what did interrupt playback at 11:51–11:55**, and none can be taken now. The
standing bucket contrast is the best available account and it points away from us.

**If it happens again, the reading to take *while it is happening*** — this is the whole value of
writing this down: `adb logcat -b all | grep -iE "AudioFocus|MediaSession|ActivityManager.*jio"`,
running before the stop, plus `am get-standby-bucket com.jio.myjio` at the moment. Ten seconds of
capture during the event is worth more than any amount of reconstruction afterwards.

---

## Phase 7 · Slice 24 — O4, the Device status rings, and the wire under them · 2026-09-04

**O4 was not a drawing job.** `docs/design-departures.md` recorded it as `unbuilt` with an explicit
refusal — *three rings over three numbers nobody sends would be the most decorative thing in the
app* — and that refusal was right: `battery.state` sat in the contract's type list, **specified
nowhere and handled on neither side since Phase 2**, and there was no storage message at all. So
this slice is the wire first and the rings second.

**A claim in `docs/RESUME.md` was wrong and is corrected here.** It said the two types were "already
on the wire". They were on the *inventory* — which is exactly the `media.*` gap
`check-protocol-spec.mjs` exists to catch, and the checker had them both on its debt list the whole
time. Being in the type list is not being implemented, and I read the first as the second.

### The contract

`battery.state` specified, `storage.state` added. The hook caught two things on the first run and
both were real: the stale debt entry (*"remove it from the list rather than leaving an allowlist
nobody prunes"*) and a missing inventory line. `net.state` stays on the debt list, unimplemented and
now alone.

### Two rings, not three

There is **no memory ring**. Free RAM on Android is not a fact a person can act on — the OS
deliberately fills it, so *"1.2 GB free of 12 GB"* is alarming, meaningless, and looks exactly like
information. Recorded as a departure rather than an omission, in the contract, in
`src/shared/deviceVitals.ts` and at O4.

### Three states per ring, and the middle one is the point

| State | Ring | Battery caption |
|---|---|---|
| never reported | **no arc** | *Waiting for the phone to report* |
| reported as unknown | **no arc** | *This phone does not report its level* |
| a real reading of 0 | arc at 0 | *On battery*, tone `low` |

The first two are both an absence and must not read the same — one resolves on its own and the other
never will. That is defect 85's separation, one card over. **The rings are SVG rather than a
conic-gradient for exactly this**: a gradient always paints something, and *paints nothing* is the
state this card most has to express. The absence of the `.ring-arc` element **is** the state, and
the view test asserts it that way.

### On hardware, with real values

```
phone 16:06:53.873 [vitals] battery.state → Mac: 79%, charging=true — 1 battery / 0 storage sent …
phone 16:06:53.874 [vitals] storage.state → Mac: 13667364864 free of 489993273344 bytes — …

Mac   [{"ring":"battery","tone":"ok","value":"79%","caption":"Charging","hasArc":true},
       {"ring":"storage","tone":"low","value":"13.7 GB","caption":"free of 490 GB","hasArc":true}]
```

Storage reads `low` correctly: **2.8% free**, below the 10% threshold. Screenshot in
`docs/evidence/phase-7-o4-2026-09-04/`. Suite **500 → 514**.

### Two faults this slice produced, and neither was in a test

- **The card was below the fold.** First reading: `top=1007` in an 865 px viewport,
  `fractionOnScreen: 0` — defect 85's shape, three days later, in the pane I was adding to. Then the
  *instrument* was wrong too: scrolling `section[data-screen="overview"]` moved nothing, because its
  `scrollHeight === clientHeight` and **the scroller is `#page`** (1170 vs 667). Walking the parent
  chain and reading `overflow-y` found it; scrolled properly, the card is **100% on screen**. Two
  readings of one fact, and neither was right until a third query settled it.
- **`13.7 GB free` overflowed the 72 px ring.** Seen in a screenshot, in no test, because the DOM
  double has no layout — every assertion about that string passed while it spilled over its arc.
  The word *free* moved to the caption. This is the fourth renderer-only break found by looking at a
  picture, and it is the argument for taking one every time a pane changes.

### Guards that fired, and both were right

- **`check-clip-echo.mjs` refused the phone feature** for declaring a field named the way the
  clipboard echo interlock names its own. It is a battery change filter and has nothing to do with
  the interlock — so it took a name that says so, which is the guard's own instruction for that
  case. A third home for those names is how a copy of that rule gets made.
- **`org.json.JSONObject` is not mocked in JVM tests**, so the first `VitalsPayloads` died on
  `Method put in org.json.JSONObject not mocked`. The house type is kotlinx `JsonObject`, as
  `ClipboardPayloads` already uses. The rule this module carries about Android statics in a pure
  file extends to `org.json`, which does not look like an Android class and is one.

---

## Phase 7 · Slice 25 — the below-the-fold sweep, and two rules with enforcement · 2026-09-05

### 1 · Where every card sits, measured

`scripts/card-visibility-sweep.mjs`, every pane, **1440 × 865, unzoomed**.

```
23 blocks: 21 visible at rest, 2 reachable by scrolling, 0 stranded.

Overview → Device status   top=865   entirely below the fold, reachable via #page
Mirror   → Advanced        top=480   99% visible, clipped by a few pixels
```

**Nothing is stranded**, which is the floor and not the finding. The finding is that neither of the
two below-the-fold blocks carries a *state* sentence — Device status draws its three states inside
the card, Advanced is a settings group — so **no sentence in the vocabulary audit is currently below
the fold**. Defect 85 was reachable and still failed; reachability is the floor, and a state
sentence has to be visible at rest.

### 2 · Four instrument faults in one sweep, and each was caught by a control

| | Reported | Actually |
|---|---|---|
| `rawEvaluate` without the prelude | `__probe is not defined` on every card | the helpers are installed by `read`/`presence`, not by the raw transport |
| counting `.card` | *"no .card elements"* on **9 of 13 panes** | a fact about a **selector**. The panes use **seven** container conventions |
| `/\s+/g` inside a template literal | headings rendered `Sam ung`, `La t 7 day` | `\s` in a template literal resolves to a bare `s`, so the regex was `/s+/g` and **every letter s became a space** |
| `files` — no heading matched | *"no headings found"* | a seventh convention, `.files-rail-title`. Its pane ends at 648 in an 865 window and was never at risk |

The third is the one to keep: **the instrument silently rewrote the data it was reporting**, and the
only reason it was caught is that a phone model with an `s` in it was in the output. `Samsung` →
`Sam ung` is visible; a pane called `Overview` would have come through untouched and the fault would
have shipped into the audit.

The second produced the sweep's other finding, which is the designer's: **seven container
conventions for what is visually one thing** — `.card`, `.side-card`, `.pane-*`, `.clip-panel`,
`.files-panel`, `.calls-log-panel`, `.files-rail-title`. A vocabulary decision that says *"the empty
state goes in the card header"* has seven places to land.

### 3 · `__probe.onScreen` — one function, not a probe per sitting

Defect 85 measured a card at 828 px in an 865 px window. Three days later O4's card landed at
1007 px **in the pane being fixed**, and the probe written to check it scrolled the pane's own
`section`, read no movement, and reported the card unreachable. **The section is not the scroller** —
every pane's section has `scrollHeight === clientHeight`; the overflow is on `#page`.

`onScreen` **finds** the scroller by walking ancestors and reading computed `overflow-y`, and
returns `visible` / `reachable` / `stranded` — three outcomes, because *off screen right now* is not
one answer. `scripts/probe.test.mjs` still passes at 18.

### 4 · The debt list can deny something now

`check-protocol-spec.mjs` printed `debt: battery.state — Unscheduled. No handler on either side` on
every run for a phase. `docs/RESUME.md` then said it was *"already on the wire"*, and the O4 sitting
opened on that. **The list was right and nobody read it.**

Printing it harder fixes nothing: a debt list is printed at the end of a **passing** run, and the
output of a passing check is not read — that is what passing is for. And the false claim was in
prose, which no code checker looks at.

`scripts/check-debt-claims.mjs` reads the debt list out of the spec checker so there is one list and
not two, and refuses a commit whose prose names a debt-listed type *and* claims it works *and* does
not also say it is owed. **Its first fixture is the verbatim `RESUME.md` sentence that got through**,
with `battery.state` restored to the debt list for the length of one run — because a guard never run
against the failure it was written for has not been tested against the only case it is known to have
missed. 5 fixtures, both directions, plus an instrument-failure case that must pass rather than deny.

Eighth commit hook.

### 5 · The audit's own numbers were wrong, four times

`docs/empty-and-failure-states.md` claimed 24, 15 and 6 sentences in groups whose tables held 28, 19
and 9; a total of 86 against 83; and 17 panes. **In the one document whose entire job is to be
counted** — and it understated its own largest group by four.

The pane count then went wrong twice more *while being fixed*: **24** from counting files rather
than panes, then **23** from a checker that assumed every table had three columns when group 7 has
two. It is **19**. `scripts/check-state-vocabulary.mjs` derives every number from the tables and
counts columns rather than assuming them; seventh commit hook.

## Phase 7 · Slice 26 — defect 87: the app window did not fit the display it opened on · 2026-09-05

Reported from the user's screen at 12:47: the window taller than the display, the title bar and the
top of the device card sliced off, and the right-hand column and the dock appearing to render
*outside* the window frame with nothing behind them.

**Three readings before any change, because the report names two different bugs that produce one
screenshot** — a window genuinely larger than the screen and clipped by it, or panes painting
outside the `BrowserWindow`'s own bounds.

### Defect 87 — the app window did not fit the display it opened on

#### 1. What is requested, against what the display actually offers

`screen.getAllDisplays()`, read through Electron's own module rather than `system_profiler`, because
the fix consumes this API and a reading taken through a different client is a reading about a
different mechanism:

| Display | Bounds | Work area | Holds 1440x920 |
|---|---|---|---|
| 1, built-in, **primary** | 1512 x 982 | **1512 x 865** | **no — 55px too tall** |
| 2, external | 1920 x 1080 | 1920 x 1050 | yes |

865 is 982 less a 33px menu bar and an 84px Dock. `createWindow` asked for a flat `1440 x 920` with
no reference to either display.

#### 2. Which of the two bugs it is

**Not the panes.** All 3675 laid-out elements were measured against the viewport: **30 sit past it
and all 30 are contained by an `overflow:hidden` ancestor** — 21 under `#page`, which is the
scroller, and the rest the ambient blobs at their deliberate `inset:-10%`. **Zero paint past the
window edge.** `html`, `body` and `.app-window` are each `height:100%; overflow:hidden`, so this is
what the stylesheet predicts; the point is that it was measured rather than deduced.

So it is the window. And the window was **being rescued by AppKit**, which is why nothing in this
repo had ever noticed:

```
REQUEST 1440x920 on display 1 (workArea 1512x865) -> GRANTED 1440x865   heightLost=55
REQUEST 1440x920 on display 2 (workArea 1920x1050) -> GRANTED 1440x920  heightLost=0
```

`constrainFrameRect:toScreen:` shrinks an oversized window to the visible frame, so the window that
appeared was 865 tall and looked deliberate.

**A hypothesis was raised and refuted, and it is recorded because refuting it is the finding.** The
obvious mechanism for the user's screenshot is a window born 920 tall on the external display and
then moved to the built-in. It is wrong: AppKit **does** re-constrain on move, and on `setBounds`
with an explicitly oversized height. The instrument could have shown either — a re-constraining
AppKit reports 865, a permissive one reports 920 — and it reported 865 on every route:

```
born on big display  -> {"x":1522,"y":40,"width":1440,"height":920}
moved to small       -> {"x":10,"y":33,"width":1440,"height":865}   NOT reproduced
setBounds 920 on small -> {"x":10,"y":33,"width":1440,"height":865} NOT representable
```

**So the user's exact screenshot was not reproduced from here, and this slice does not claim it
was.** What is established is the defect underneath it: the app requests a size 55px taller than the
display it opens on by default, and the only thing standing between that and a clipped window is a
platform behaviour this app neither owns nor invokes. AppKit applies it when *it* sets the frame; it
does not fire when the work area shrinks under a window that is already open — the Dock un-hiding,
a display disconnecting, Stage Manager or Split View claiming space. Those routes were not driven
and are named rather than claimed.

#### 3. Dev run or packaged build

**Both.** The packaged `ConnectSuite.app` was opened by parsing its `app.asar` header and reading
`dist/main/main.js` out of it — the matched lines, not a count, since a text search over a build
artifact matches the prose about the claim:

```
259: width: 1440,
260: height: 920,
261: minWidth: 1100,
262: minHeight: 700,
```

No `workArea`, no `getDisplay*` anywhere in the file. Identical constants, identical absent clamp.
This is not a dev-only fault and D14 does not apply.

#### The fix

`src/shared/windowGeometry.ts` — pure arithmetic in the electron-free layer, the same seam
`floatGeometry` uses, which learned this exact lesson in Phase 2 and recorded it: *"clamping drag
alone is not enough."* The detached mirror window has derived its size from the available height
since then; the main window, which every pane inherits, never did.

The design's size is a **maximum**, capped per axis independently, so a short display costs height
and not width. **The minimums are capped too**, and that is the half that would have survived the
obvious fix: leaving `minHeight: 700` on a display with 600 points of work area hands Electron a
contradiction and the minimum wins, reintroducing the defect by a different route on exactly the
small displays the change is for.

#### Verification

Unit: 8 tests, written against the failure and against the two measured work areas as facts rather
than examples. **Three mutations, each red on the tests named for it**, green restored at 523:

| Mutation | Red |
|---|---|
| `sizeFor` returns the design unconditionally — *the original bug* | **4 tests**, incl. "the built-in display no longer receives a window taller than its work area" |
| `minimumsFor` ignores the fitted size | 1 — "the resize minimums cannot force a window taller than the screen" |
| `positionFor` pins to the origin instead of centring | 1 — "positionFor centres rather than pinning to the origin" |

End-to-end on the display that caused it, calling the product's **own compiled** `fitWindow` with
only the display choice varied:

```
workArea  : {"x":0,"y":33,"width":1512,"height":865}
fitWindow : {"x":36,"y":45,"width":1440,"height":841} min={"width":1100,"height":700}
granted   : {"x":36,"y":45,"width":1440,"height":841}
unchanged by AppKit: true          ← we fit it ourselves; no rescue was needed
WHOLE WINDOW INSIDE WORK AREA: true
  top vs menu bar : 12px clear
  bottom vs Dock  : 12px clear
```

And in the running app, agreed by three independent instruments — the app's own log, CDP through
`scripts/probe.mjs`, and System Events:

```
[window] asked 1440x920 at (1752,95); got 1440x920 at (1752,95) on display 2
         (work area 1920x1050) — granted as requested; fits work area: true
System Events -> 1752, 95, 1440, 920
```

**A disagreement between two of those is what produced the third.** The first relaunch logged
`opened 1440x920` while CDP and System Events both read `1436x865` on the built-in — the window had
been moved between launch and probe. The log line was reporting the **request**, which is the fault
this file already carries about a probe reporting bytes queued as bytes delivered. `ready-to-show`
now logs asked-beside-got with the display it landed on, so a window the server changes says so.

`scripts/window-fit-probe.mjs` is kept, through `probe.mjs` with a required control: it is the one
instrument that separates the two faults, and the report will recur.
