# ConnectSuite wire protocol v1

This file is the contract. Change it here first, then `core/src/main/java/com/chetan/connectsuite/core/protocol/Messages.kt` and `desktop/src/shared/protocol.ts`.

## Framing

Every message on every channel: 4-byte big-endian length, then payload.
Control channel payload is UTF-8 JSON. Video and bulk payloads are binary.

Maximum accepted frame length is 16 MiB on the control channel and 8 MiB elsewhere; a longer
length prefix is treated as a protocol error and the socket is closed.

## Control channel (42501)

Envelope: `{"v":1,"id":"<uuid>","type":"<string>","ts":<epoch_ms>,"payload":{...}}`

Requests carry `id`. Responses echo it back with type `ack` or `error`.
Events are unsolicited and carry a fresh `id`.

### Handshake

- `hello` (Mac to phone): app version, protocol version, device name, cert fingerprint
- `hello.ack` (phone to Mac): same fields, plus session token and capability list

Capability list example: `["mirror","notifications","sms","calls","contacts","files","photos","clipboard","remote","apps","mic"]`
The Mac greys out any UI whose capability is absent. Capabilities are derived from granted
permissions, checked at handshake time and re-sent as a `capabilities.changed` event whenever a
permission changes.

#### `unavailable` — the other half of the list

`hello.ack` and `capabilities.changed` both carry a second field beside `capabilities`:

```json
{
  "capabilities": ["mirror", "notifications", "remote"],
  "unavailable": [
    { "name": "input", "reason": "missing Accessibility access" },
    { "name": "sms",   "reason": "missing SMS" },
    { "name": "apps",  "reason": "not built yet — waiting on apps.list, apps.launch" }
  ]
}
```

`capabilities` is what is on. `unavailable` is every capability that is not, each with the phone's
own one-line explanation — `CapabilityStatus.reason`, the same sentence the phone's diagnostics
screen shows. The two together name every capability in the contract exactly once, so the Mac can
assert that and log a warning if a phone ever sends a set that does not add up.

**This exists because a name with no reason is not actionable.** The Mac knew which capabilities
were off and had nothing to say about why, so its UI could only grey a chip and hope the user
guessed which of eleven Settings screens to open. The reason was computed on the phone all along
and never crossed the link (defect 24). The list is sent whole rather than diffed: it is a dozen
short strings, and a diff would be more protocol than the payload is worth.

`unavailable` is **optional on the wire** and defaults to empty. A phone that does not send it is
not a protocol error — the Mac renders exactly what it did before, a name with no reason — which
is what keeps this a minor-version addition rather than a break.

Reason strings are for a person to read and are **not** a stable API: do not switch on them, do not
parse them. Switch on `name`.

`hello` is rejected with `PROTOCOL_MISMATCH` when the major version differs. The Mac's TLS
certificate fingerprint must already be in the phone's trust store or the TLS handshake itself
fails before `hello` is read.

### Message types

Notifications: `notif.posted`, `notif.removed`, `notif.reply`, `notif.action`, `notif.dismiss`
SMS: `sms.threads`, `sms.messages`, `sms.send`, `sms.received`, `sms.sent`
Calls: `call.incoming`, `call.ended`, `call.log`, `call.dial`, `call.answer`, `call.reject`
Contacts: `contacts.list`, `contacts.get`
Clipboard: `clip.push`, `clip.request`, `clip.history`
Files: `fs.list`, `fs.stat`, `fs.mkdir`, `fs.delete`, `fs.transfer.begin`, `fs.transfer.progress`, `fs.transfer.done`, `fs.transfer.cancel`
Photos: `media.buckets`, `media.list`, `media.thumb`, `media.original`
Mirror: `mirror.start`, `mirror.stop`, `mirror.config`, `mirror.keyframe`, `mirror.stats`, `mirror.state`, `mirror.rotate`
Input: `input.tap`, `input.swipe`, `input.scroll`, `input.key`, `input.text`, `input.global`
(back/home/recents/notifications/quick-settings/lock-screen — **not** power; see [Input](#input-42501))
Apps: `apps.list`, `apps.launch`, `apps.icon`
Media remote: `remote.state`, `remote.command`
System: `battery.state`, `net.state`, `ping`, `pong`, `error`, `capabilities.changed`

#### Namespace rule

**No two capabilities may share a message prefix.** An `error` reports the feature it belongs to,
and the Mac greys out the pane with that name — so a shared prefix greys out the wrong pane: a
failing photo thumbnail would disable the media remote, and a failing transport command would
disable the photo browser. The media remote used to be `media.state`/`media.command`, colliding
with the photo browser's `media.*`; it is `remote.*` for that reason and the capability is named
`remote` to match.

**`feature` is always a capability name, never a message prefix.** It used to be
`envelope.type.substringBefore('.')`, which is only the same thing when the two are spelled
identically. `mirror` and `input` are, which is why nothing had gone wrong; **five** of the
remaining features are not, and a `feature` matching no capability greys out nothing at all — so a
feature failing every request looks, on the Mac, exactly like a feature that is fine.

| Prefix | Capability |
|---|---|
| `notif` | `notifications` |
| `call` | `calls` |
| `clip` | `clipboard` |
| `fs` | `files` |
| `media` | `photos` |
| `mirror`, `input`, `sms`, `contacts`, `remote`, `apps` | *(same name)* |

The mapping is `FeatureOf.of(type)` in `core/.../protocol/FeatureOf.kt`, checked exhaustively over
`MessageType` by `ProtocolNamespaceTest`. It returns **null** for the system messages — `hello`,
`ping`, `ack`, `error`, `capabilities.changed`, `battery.state`, `net.state` — because those are
not a feature and naming one would grey out a pane because the heartbeat hiccuped.

This replaces the "known exception, not yet fixed" that stood here against the photo browser. It
was fixed before Phase 4's handlers rather than after, because Phase 4 ships the first two message
namespaces (`notif.*`, `call.*`) whose prefix is not their capability.

### Heartbeat

The Mac sends `ping` every 5 seconds; the phone answers `pong` echoing the request `id`. Three
missed pongs (15 seconds) count as a dead link on the Mac. The phone drops a control connection
that has sent nothing for 30 seconds.

`pong` carries `{"monoUs":<phone CLOCK_MONOTONIC microseconds>}`. It is the phone's
`System.nanoTime()/1000` — deliberately the same clock that stamps video frame PTS, which is what
makes the two comparable. The Mac estimates the offset between the two machines the usual way
(`offset = macRecvMs - rtt/2 - monoUs/1000`) and uses it to turn a frame's PTS into a local
arrival deadline. Without it a frame's PTS is a number from another machine's clock and says
nothing about latency.

## Video channel (42502)

Client sends the session token as the first frame, then reads only.

The token frame uses the standard 4-byte length prefix. **Everything after it does not**: video
frames carry their own 13-byte header, whose length field is the frame's only length. Writing both
would put the length on the wire twice, and the earlier wording left that ambiguous.

```
byte  0      flags     bit 0 = keyframe, bit 1 = config (SPS/PPS)
bytes 1..8   PTS       microseconds, big endian, unsigned
bytes 9..12  length    payload bytes, big endian
bytes 13..   payload   H.264 Annex B
```

The config frame (csd-0) is sent immediately on connect and again on **every geometry change** —
a `mirror.config` resolution change or a `mirror.rotate`. Each one comes from a new encoder and so
carries new parameter sets, always ahead of the first frame at the new size and with an IDR
immediately behind it. A Mac that treats the first config frame as the session's only one will show
nothing after the first rotation.

A video socket that connects mid-session is replayed the retained config frame and then sent a
fresh keyframe, so it can start decoding without waiting out a GOP. The retained frame is dropped
for the moment a swap is in flight rather than served stale: parameter sets describing the previous
geometry are worse than none.

Frames are dropped rather than queued when the Mac cannot keep up: a late frame in a live mirror
has no value, and an unbounded queue trades a brief stutter for latency that never recovers.
Non-keyframes are shed first, because dropping a keyframe strands the decoder until the next one.

### Starting a session

`mirror.start` and `mirror.config` payload, every field optional:

```json
{"maxResolution":1080,"bitrate":8000000,"frameRate":60,"keyframeInterval":2}
```

`maxResolution` is a cap on the **short edge** in pixels, not a resolution to capture at. The
phone reads its own display, scales to fit the cap with the aspect ratio preserved, and rounds
both edges to even numbers for the encoder. A 1440x3120 panel with the default cap captures
1080x2340; the same cap on a 1080p phone changes nothing. The Mac never sends `width`/`height` —
only the phone knows its panel, and a Mac-chosen geometry is how you get a stretched picture.

The default is **1080**, which is a deliberate under-request rather than the panel's native size:
a native VirtualDisplay on a 1440p phone produces a bitrate a phone hotspot cannot carry. Raise it
once the link is known to hold.

`mirror.start` **acks immediately** — within 2 seconds, before consent is asked for and long
before a frame exists — and the ack carries only the state the request has entered:

```json
{"state":"requesting-consent","message":"Asking for screen capture permission on the phone.","fixHint":"Tap \"Start now\" on the phone."}
```

Everything after that arrives as `mirror.state` events. This is deliberate: consent is a human
tapping a phone, and a request that stays open across it cannot tell "the user is reaching for
the phone" apart from "the phone will never answer". A fast ack plus events can, and a Mac that
blocks on the ack until a picture appears is the bug that produced a blank canvas for a minute.

The capture geometry that used to be in this ack is now in the `mirror.state` event for
`running`, which is the first moment it is actually known.

`mirror.config` changes bitrate on the live encoder. A change to `maxResolution` cannot be done
that way — MediaCodec cannot be resized in place — so the phone builds a **new encoder** and points
its **existing VirtualDisplay** at it, with `VirtualDisplay.resize` and `VirtualDisplay.setSurface`.

The MediaProjection is never touched, and the display is never recreated. That is not an
optimisation, it is the only thing that works: on Android 14+ one MediaProjection permits exactly
one `createVirtualDisplay`, so a second one fails with *"Don't take multiple captures by invoking
MediaProjection#createVirtualDisplay multiple times on the same instance"* and ends the session.
Both `resize` and `setSurface` are public API on `VirtualDisplay` and neither calls back into the
projection, so the restriction is never approached — **and the user is never asked for consent a
second time.**

The order on the phone is load-bearing and is spelled out in `MirrorEngine.swapEncoder`: build the
new encoder and take its input Surface, stop counting the old encoder's frames, `resize`,
`setSurface`, start the new encoder, request a sync frame, and only then stop the old one.

A new config frame (SPS/PPS) therefore follows every resolution change, ahead of the first frame at
the new size, with an IDR immediately behind it. **The Mac must reconfigure its decoder whenever a
config frame arrives**, not only on the one at connect: the parameter sets describe a different
geometry and a decoder still configured for the old one produces nothing.

### `mirror.state`

An event from the phone whenever the mirror session changes phase. It is the only thing that says
a session is progressing, so the Mac drives its canvas from these and never from a timer:

```json
{"state":"awaiting-foreground","message":"...","fixHint":"...","requestId":"<the mirror.start id>"}
```

| `state` | Meaning | Terminal |
|---|---|---|
| `awaiting-foreground` | ConnectSuite is backgrounded on the phone, so Android will not let it show the consent prompt. The phone has posted a notification; the user must open the app and tap **Start mirroring**. | no |
| `requesting-consent` | The system screen-capture prompt is on the phone's screen now. | no |
| `starting` | Consent granted; the capture service and encoder are coming up. | no |
| `running` | Frames are flowing. Carries the capture geometry — see below. | no |
| `stopped` | The session ended. `message` says why. | yes |

`running` carries what was actually captured, which is not necessarily what was asked for:

```json
{"state":"running","width":1080,"height":2340,"dpi":450,"bitrate":8000000,"frameRate":60,
 "maxResolution":1080,"rotation":0,"geometryId":1}
```

`geometryId` is the stamp every coordinate-bearing input message must echo — see
[Input](#input-42501). It is an opaque counter, minted by the phone, that changes whenever
**anything a touch coordinate depends on** changes: the capture width, the capture height, or the
rotation. A 180° turn changes it even though the pixel dimensions are identical, because a tap
computed before that turn maps to the point-reflected place after it.

**The Mac opens the video socket when `running` arrives**, not when `mirror.start` acks. Opening
it on the ack would race the consent prompt, and on Android 16 it would open a socket for a
session that had not been permitted yet and might never be.

Because `running` is an event rather than a reply, a session started **from the phone** — the user
taps Start mirroring in the Mirror tab with a Mac connected but no `mirror.start` outstanding —
reaches the Mac through the same path, with no `requestId`.

**`running` is also sent again to retract a `SECURE_SURFACE`**, and that is not a duplicate: it is
the only signal that a blanked screen has stopped being blanked. Frames never stopped — only their
content did — so nothing else marks the end, and the Mac needs it because it cannot infer the end
from the frame stream: a blanked surface keeps producing frames, black ones. A Mac that treats
arriving frames as proof of recovery erases the sentence explaining the black rectangle about 16ms
after it appears, which is defect 23. The phone therefore says so explicitly, and a `running` that
arrives while frames are already decoding means *content is back*.

`awaiting-foreground` is the Android 16 path and is not an error: nothing has failed and the user
can still complete it. It becomes `CONSENT_TIMEOUT` if 30 seconds pass with no answer.

### `mirror.stats`

An event from the phone every 2 seconds while a session is live:

```json
{"encodedFrames":120,"encodedBytes":1974210,"droppedFrames":0,"ptsUs":81234567,"monoUs":81236000,
 "width":1080,"height":2340,"bitrate":8000000,"frameRate":60}
```

`droppedFrames` is counted **on the phone**, in `VideoChannel`, where frames are shed when the Mac
falls behind. The Mac cannot count what was never sent to it, so a HUD without this event shows
zero drops on a link that is dropping every other frame.

`ptsUs`/`monoUs` are the PTS of a recently encoded frame and the phone's monotonic clock reading
for that same frame. The pair is what lets the Mac map any frame's PTS onto its own clock and
measure capture-to-paint latency; re-sending it every 2 seconds also corrects for drift between
the two clocks over a long session.

### `mirror.rotate`

An event from the phone when its display turns, carrying the geometry it now captures at:

```json
{"width":2340,"height":1080,"dpi":450,"rotation":90,"geometryId":4}
```

`rotation` is degrees clockwise — 0, 90, 180 or 270 — as the phone's own display reports it.
`geometryId` is the new stamp, and it is the reason this event matters to more than the HUD:
every `input.tap`/`swipe`/`scroll` carries the id it was computed against, and the phone refuses
any that names a stamp it has left. See [Input](#input-42501).

**The angle and the geometry in one event always agree**, because the phone reads them as one
settled measurement and re-reads until the two are consistent with each other. They did not agree
until 2026-08-26: `getRealMetrics` returned the new shape while `Display.getRotation()` still
reported the outgoing angle, and the pair was announced 63ms before a second callback corrected
it (defect 16 in `docs/testing.md`). That was cosmetic while only a HUD read the angle. It stopped
being cosmetic when input started mapping coordinates against the geometry announced beside it.

**Phone to Mac only.** There is no handler for it on the phone and there must not be one: the Mac
cannot turn a phone, so a `mirror.rotate` in the other direction could only be the Mac claiming a
rotation that had not happened, after which the geometry it drew would stop matching the geometry
the encoder produced. `MirrorContractTest` asserts it is never registered as a request.

The phone sends it from a `DisplayManager.DisplayListener` on the default display, and then swaps
the encoder by exactly the mechanism `mirror.config` uses — `VirtualDisplay.resize` plus
`setSurface`, projection untouched, no second consent tap. Two details follow from that:

- **The event goes out before the surface swap**, so it reaches the Mac on the control channel
  while the new parameter sets are still being produced on the video channel. A Mac that instead
  sized its window from the first frame of the new geometry would paint one frame of the wrong
  shape first.
- **A 180° turn is announced but not resized.** The pixel dimensions are identical, so an encoder
  swap would cost an IDR for a picture of the same shape; the event still goes out because a HUD
  reading 90 with the phone at 270 is wrong.

A `DisplayListener` also fires for brightness, refresh rate and HDR changes. Those change neither
the geometry nor the rotation and produce no message at all — see `displayChangeFor` in
`ScreenEncoder.kt`, which is what the phone decides with.

`mirror.screenoff` is **not implemented**, which is why it is absent from the type list above. It
needs a system-signed permission this app cannot hold. The constant stays in `MessageType` because
`MirrorContractTest` asserts it is never registered — an unimplemented type with a name is easier
to keep honest than one that only exists in prose.

### When mirroring cannot start or cannot continue

Every failure is reported on the **control** channel as an `error` with `feature: "mirror"`, never
by simply not sending frames. The Mac shows the `message` verbatim in place of the video. The
paths, each with its own reason string:

| Cause | `code` |
|---|---|
| Consent prompt answered "no" | `PERMISSION_DENIED` |
| Consent prompt closed unanswered | `PERMISSION_DENIED` |
| Consent unanswered for 30 seconds | `CONSENT_TIMEOUT` |
| Phone locked | `DEVICE_LOCKED` |
| FLAG_SECURE content on screen | `SECURE_SURFACE` |
| Encoder would not start | `ENCODER_FAILED` |
| Encoder died mid-stream | `ENCODER_FAILED` |
| Video socket token invalid | `UNAUTHORIZED` |

The codes repeat; the messages do not. `SECURE_SURFACE` is the only one that does not end the
session — the user walks out of the banking app and frames resume. Because it does not end the
session it is the only one that has to be **retracted**, which the phone does by sending
`mirror.state: running` again; see [`mirror.state`](#mirrorstate). Everything else in this table
ends the session, so the reason stays on the Mac's canvas until a new one starts.

Detecting it is inference, not a callback — Android offers none. The phone judges a run of three
keyframes under 2000 bytes as blank, and, because a blanked screen is usually a *still* screen that
feeds the encoder almost nothing, asks for a sync frame when output collapses rather than waiting
for the encoder's own keyframe schedule. Without that the three keyframes took ~60 seconds to
arrive on hardware.

## Input (42501)

Input rides the control channel. Every message is a request: the phone answers `ack` with an empty
payload, or an `error` with `feature: "input"` and a sentence the Mac shows verbatim. Nothing here
is fire-and-forget — a tap that did not happen must say so, because the user is looking at a
picture of a phone that did not respond and has no other way to find out why.

The whole feature is an `AccessibilityService`. That is not an implementation detail, it is the
shape of the contract: everything below is something `dispatchGesture`, `performGlobalAction` or
`ACTION_SET_TEXT` can genuinely do, and nothing below is anything else.

### What input cannot do, permanently

These are platform walls, not unfinished work. They are written here so that nobody re-adds them
to the type list later on the strength of the name.

- **There is no power button.** `performGlobalAction` offers `GLOBAL_ACTION_POWER_DIALOG`, which
  opens the power *menu*; it does not press the power key. An earlier draft of this file listed
  `input.global` as "back/home/recents/power" and that line was wrong. Pressing power, volume, or
  any other hardware key needs `INJECT_EVENTS`, which is a signature-level permission held only by
  apps signed with the platform key. This app will never hold it. **Do not add a power action.**
  The power menu itself is also deliberately absent: it is one accidental click away from powering
  off the phone that the Mac is connected to, and there is no route back over the network.
- **There are no keycodes.** `input.key` cannot carry a `KeyEvent`. The same `INJECT_EVENTS` wall
  applies, and it applies to every key equally — there is no subset of keycodes an accessibility
  service may synthesise. `input.key` is therefore limited to text editing on the focused field
  and to aliases of the global actions below, listed exhaustively under
  [`input.key`](#inputkey). A key outside that list is answered `UNSUPPORTED_KEY`, by name, and
  is never silently dropped.
- **Text is set, not typed.** The only route into a text field is `ACTION_SET_TEXT`, which
  replaces the field's contents in one operation. There is no keystroke, so IME composing state,
  autocorrect, and per-character `TextWatcher` behaviour are all lost. Password fields commonly
  refuse the action outright.
- **Nothing reaches the keyguard.** A locked phone refuses gestures, and the phone answers
  `DEVICE_LOCKED` rather than dispatching into a lock screen the Mac cannot see anyway.

### The coordinate contract

Touch coordinates are in **capture-frame pixels** — the exact `width`/`height` the phone announced
in `mirror.state: running` or in the most recent `mirror.rotate`. Origin is the top-left of the
captured frame. The phone scales them to its real display itself, because the capture is a scaled
copy of the panel and only the phone knows the panel.

The chain has three links and they are three different numbers:

```
Mac canvas (CSS px, letterboxed)      ← the renderer's problem, and it stops here
  → decoded frame dimensions          ← may be macroblock-padded above the capture size
    → capture frame (this contract)   ← what the wire carries
      → real display pixels           ← the phone's problem, and it starts here
```

The Mac's renderer converts a click on its canvas into the capture frame — it is the only thing
that knows how large the picture is drawn — and **stops there**. It never computes a display
coordinate, never holds a socket, and sends the result to the main process as an intent. The main
process owns the wire, the ordering and the rate limit; the phone owns the last link in the chain.
Nothing on the Mac ever maps canvas straight to display.

**Every coordinate-bearing message carries the geometry it was computed against:**

```json
{"geom": {"id": 7, "width": 1080, "height": 2340}}
```

`id` is the `geometryId` from the `mirror.state`/`mirror.rotate` that announced that geometry.
The phone compares all three fields against what it is capturing right now and **refuses a
mismatch** with `GEOMETRY_STALE`. It does not clamp, scale, or best-guess: a tap mapped against a
screen shape the phone has left is a tap in the wrong place, and a tap in the wrong place on
someone's phone is the worst thing this feature can do. A refusal the user can see and repeat is
strictly better.

Two independent guards stand behind that, and both are needed:

1. **The phone announces an angle and a geometry that agree.** The reading is taken as one settled
   measurement and re-read until the rotation is consistent with the metrics — see `mirror.rotate`
   above and defect 16 in `docs/testing.md`.
2. **The stamp is checked on arrival.** Guard 1 narrows the window in which the Mac can compute
   against something stale; it cannot close it, because the Mac's message is already in flight
   when the phone turns. Only the check on arrival covers that, and only guard 1 keeps the check
   from firing constantly on a correctly-behaving Mac.

A 180° turn produces no resize — the pixel dimensions are identical — but it does mint a new
`geometryId`, because the picture is now upside down relative to the coordinates the Mac last
computed.

Coordinate-bearing input requires a **live capture session**: without one there is no capture
frame to be in the space of, and the answer is `FEATURE_UNAVAILABLE` naming that. `input.text`,
`input.key` and `input.global` carry no coordinates and work with or without a mirror.

### `input.tap`

```json
{"x":540,"y":1200,"durationMs":60,"geom":{"id":7,"width":1080,"height":2340}}
```

`durationMs` is optional and defaults to 60. Anything from 1 to 5000 is accepted; a long press is
this message with `durationMs: 600`, not a message of its own.

### `input.swipe`

One continuous stroke through two or more points — a drag, a fling, or a two-point swipe:

```json
{"points":[{"x":540,"y":1800},{"x":540,"y":900}],"durationMs":220,
 "geom":{"id":7,"width":1080,"height":2340}}
```

Between 2 and 100 points; `durationMs` 1..5000, default 200. The whole path is one
`GestureDescription.StrokeDescription`, which is what makes it a drag on the phone rather than a
row of taps. A Mac that sent one `input.swipe` per pointer-move event would produce neither: only
one gesture may be dispatched at a time, so the rest would be refused. **The Mac coalesces a drag
into one message on pointer-up.**

### `input.scroll`

A wheel or trackpad scroll at a point. `dx`/`dy` are in capture-frame pixels and describe the
distance the *content* should move, so a downward wheel gesture is a negative `dy`:

```json
{"x":540,"y":1200,"dx":0,"dy":-600,"durationMs":100,
 "geom":{"id":7,"width":1080,"height":2340}}
```

The phone turns this into a stroke from `(x, y)` to `(x + dx, y + dy)`, clamped to the frame —
plus, because a finger drags the content with it, so the finger's displacement *is* the content's.
(This line read `(x - dx, y - dy)` until 2026-08-27 and was defect 21: it inverted every scroll.) It
is a swipe underneath, because an accessibility service has no scroll primitive that works on an
arbitrary view — `ACTION_SCROLL_FORWARD` needs a scrollable node and silently does nothing on
anything else.

### `input.text`

```json
{"text":"hello","mode":"replace"}
```

`mode` is `replace` (default) or `append`. Both are one `ACTION_SET_TEXT` on the focused editable
node; `append` reads the field's current contents first and sets the concatenation. Neither is
typing — see the walls above.

Answers `NO_EDITABLE_FOCUS` when nothing editable has input focus, which is the common case when
the user has not tapped into a field first. `text` is capped at 4096 characters.

### `input.key`

```json
{"key":"backspace"}
```

The complete accepted set, and there will not be more:

| `key` | What it does |
|---|---|
| `backspace` | Removes the last character of the focused editable field, via `ACTION_SET_TEXT` |
| `enter` | `ACTION_IME_ENTER` on the focused editable field — Android 11+ only |
| `back`, `home`, `recents`, `notifications`, `quick_settings`, `lock_screen` | Exactly the matching `input.global` action |

The aliases exist because a Mac keyboard has an Escape key and a user expects it to go back; they
are not a second mechanism. Anything else — a letter, an arrow, volume, power, a raw keycode —
answers `UNSUPPORTED_KEY` with the reason. Typing letters is `input.text`, not `input.key`.

`enter` on Android 10 answers `UNSUPPORTED_KEY` naming the OS version: `ACTION_IME_ENTER` did not
exist before API 30 and there is no substitute.

### `input.global`

```json
{"action":"back"}
```

| `action` | `performGlobalAction` constant |
|---|---|
| `back` | `GLOBAL_ACTION_BACK` |
| `home` | `GLOBAL_ACTION_HOME` |
| `recents` | `GLOBAL_ACTION_RECENTS` |
| `notifications` | `GLOBAL_ACTION_NOTIFICATIONS` |
| `quick_settings` | `GLOBAL_ACTION_QUICK_SETTINGS` |
| `lock_screen` | `GLOBAL_ACTION_LOCK_SCREEN` |

That is the whole list. `power` is not on it and must not be added — see the walls above.

### When input cannot be delivered

| Cause | `code` |
|---|---|
| The accessibility service is not enabled | `PERMISSION_DENIED` |
| Coordinates stamped with a geometry the phone has left, or outside that frame | `GEOMETRY_STALE` |
| No capture session, so there is no coordinate space | `FEATURE_UNAVAILABLE` |
| The system refused or cancelled the gesture | `GESTURE_FAILED` |
| No editable field has focus | `NO_EDITABLE_FOCUS` |
| A key or global action that cannot exist | `UNSUPPORTED_KEY` |
| The phone is locked | `DEVICE_LOCKED` |
| The phone is showing content Android blocks from capture | `SECURE_SURFACE` |

`SECURE_SURFACE` is deliberately the same code, and the same sentence, that the mirror uses for a
blanked frame. The user is looking at a black rectangle; input refuses for the reason the
rectangle is black, in the words already on their screen, rather than inventing a second
vocabulary for the same wall. It is the one input failure that is not the Mac's fault and not
worth retrying — the user leaves the banking app and both come back at once.

## Phase 4 features (42501)

Notifications, SMS, calls, contacts and the media remote all ride the control channel. They share
four conventions, stated once here rather than five times below.

**Requests and events.** A message the Mac sends is a request: the phone answers `ack` with the
payload described, or `error`. A message the phone sends unprompted is an event and is never
answered. Which is which is stated per message.

**Lists are paged, newest first.** Every list request takes `limit` (default 50, maximum 200) and
an optional `before` cursor — an epoch-milliseconds timestamp — and returns items strictly older
than it. The reply carries `hasMore`, so the Mac never has to infer the end of a list from a short
page. Paging exists because a phone with 40,000 SMS in one thread will otherwise put all of them
into one 16 MiB control frame and fail the frame-length check rather than the query.

**No binary in JSON, with two bounded exceptions.** App icons and contact photos are not carried
by these messages. `notif.posted` names the app and does not picture it; `contacts.list` says
`hasPhoto` and does not send one. The exceptions are `contacts.get`, which may return one photo as
a base64 PNG capped at 64 KiB because it is one contact fetched on demand, and nothing else.
Bulk image delivery is the bulk channel's job and belongs to Phase 5 with the photo browser.

**Replay on connect, rather than a `list` request.** A Mac that connects mid-session has missed
every event since the phone booted. For notifications and calls the phone therefore replays its
current state as ordinary events immediately after `hello.ack` — every active notification as a
`notif.posted`, a ringing call as a `call.incoming`. There is deliberately no `notif.list`: the
replay covers the only case a list request would serve, and it keeps the state the Mac holds
event-sourced from exactly one place.

### Notifications

Capability `notifications`, gated on the notification-listener grant, which the user gives in
Settings and can revoke there. Errors report `feature: "notifications"` — not `"notif"`; see
[the namespace rule](#namespace-rule).

`notif.posted` — **event**, phone to Mac. One live notification.

```json
{"key":"0|com.slack|1234|null|10123","package":"com.slack","appName":"Slack",
 "title":"Ada Lovelace","text":"the build is green","subText":"#engineering",
 "whenMs":1756300000000,"category":"msg","ongoing":false,"clearable":true,
 "groupKey":"0|com.slack|g|null|10123","isGroupSummary":false,"canReply":true,"replyLabel":"Reply",
 "actions":[{"index":0,"title":"Mark as read"},{"index":1,"title":"Reply","isReply":true}]}
```

`key` is Android's `StatusBarNotification.getKey()` and is the only identifier any other message
accepts. It is opaque, it is not stable across a reboot, and the Mac must treat it as a token to
hand back rather than as something to parse.

An update to a notification arrives as another `notif.posted` with the same `key`. The Mac
replaces rather than appends — Android has no separate "changed" event, and a progress bar that
ticks once a second would otherwise become sixty rows.

`ongoing` marks the ones that cannot be dismissed and usually should not be shown as news: the
media player, the navigation banner, our own foreground-service notice. The Mac decides what to do
with them; the phone does not filter, because a phone deciding what the user may see is how a
mirror stops being a mirror.

`isGroupSummary` is `Notification.FLAG_GROUP_SUMMARY`: the header row the platform synthesises to
collapse several notifications from one app. It carries no title and no text of its own, so a Mac
that draws it renders a row with an app name, a timestamp, a Dismiss button and nothing else —
observed on One UI 2026-08-27 as `Shell · 11:41 PM · Dismiss`, an empty card in a list read every
day.

It is **sent, not filtered**, for the same reason `ongoing` is: the phone reports the shade and the
Mac decides. The Mac hides these rows. Any count a person might reconcile against the shade has to
say how many were hidden — `Replayed 7 active (1 summary)` on the phone, `6 showing, 1 summary
hidden` on the Mac — because a number that cannot be reconciled makes a working feature look
broken, which is exactly what happened when this was found.

`notif.removed` — **event**. `{"key":"..."}`, and nothing else. The reason is not sent because
Android's is not reliable enough to act on.

`notif.reply` — **request**. `{"key":"...","text":"on it","seenTitle":"Ada Lovelace"}` → `ack {}`.

`notif.action` — **request**. `{"key":"...","index":0,"seenTitle":"Ada Lovelace"}` → `ack {}`.
`index` is the position in the `actions` array of the `notif.posted` that announced it.

`notif.dismiss` — **request**. `{"key":"..."}` → `ack {}`. Dismisses on the phone too; that is the
point. No `seenTitle`: dismissing the wrong notification is recoverable and dismissing one that has
already gone is the outcome the user wanted anyway.

#### The target rule

**A reply or an action names what the Mac was looking at, and the phone refuses if that is not what
is there now.** `seenTitle` is the `title` from the `notif.posted` the Mac drew the row from.

A notification key is not a stable handle on a *conversation*. It is
`user|package|id|tag` — and an app that reuses one notification id for whatever arrived most
recently keeps the same key while the conversation behind it changes. Well-behaved messaging apps
mint an id per conversation and are unaffected; enough apps do not that this cannot be assumed. So
the Mac can be showing a row for Ada while the notification at that key is now about Grace, and
firing its `RemoteInput` sends the user's reply into Grace's conversation. Nothing in the
`PendingIntent` path can detect that on its own: the intent is always correctly bound to whatever
notification currently holds it, which is precisely the problem.

This is [`input`'s coordinate contract](#the-coordinate-contract) one layer up, and it is refused
the same way. A tap stamped with a screen shape the phone has left is refused rather than scaled
against the current one, because a tap in the wrong place on someone's phone is the worst thing
that feature can do. A reply fired at a notification the app has replaced is refused rather than
sent, because a reply in the wrong conversation is the worst thing *this* feature can do — and
unlike the tap, it is visible to somebody else and cannot be taken back.

The discriminator is the title rather than the post time, deliberately. Post time changes on every
update, **including a new message in the same conversation**, which is the single most likely thing
to happen while somebody is typing a reply — refusing there would break the common case to guard
the rare one. The title is the conversation's identity and is what the user is reading.

Its limits, stated rather than implied: two conversations with the same title are not told apart,
and a notification with no title at all cannot be checked. Both are allowed through. This closes a
mechanical failure — one id reused for many conversations — and is not a defence against an app
that sets out to defeat it.

| Cause | `code` |
|---|---|
| Notification listener access not granted | `PERMISSION_DENIED` |
| The notification has been dismissed | `NOT_FOUND` |
| The notification at that key is now a different conversation | `TARGET_STALE` |
| Reply asked for on a notification with no inline reply | `NO_REPLY_ACTION` |
| `index` outside the action list | `BAD_REQUEST` |
| The app's `PendingIntent` refused to fire | `FEATURE_UNAVAILABLE` |

Replying uses the notification's own `RemoteInput`, so it reaches the app exactly as a reply typed
on the phone would. **Not every messaging app offers one**; `canReply` says so per notification and
the Mac must not show a reply box when it is false. That is the single most common way a companion
app lies to a user about notifications, and `NO_REPLY_ACTION` exists so it fails loudly if the flag
is ever missed.

### SMS

Capability `sms`, gated on `READ_SMS`, `RECEIVE_SMS` **and** `SEND_SMS` together — see
`docs/permissions.md` for why all three, and for the Play policy this carries.

`sms.threads` — **request**. `{"limit":50,"before":1756300000000}` →

```json
{"threads":[{"threadId":"42","addresses":["+15551234567"],"snippet":"see you at six",
             "dateMs":1756299000000,"unread":2,"messageCount":318,
             "contactName":"Ada Lovelace"}],
 "hasMore":true}
```

`contactName` is present only when the `contacts` capability is also granted; without it the Mac
shows the number, which is honest rather than empty.

`sms.messages` — **request**. `{"threadId":"42","limit":50,"before":...}` →

```json
{"threadId":"42","messages":[
  {"id":"9911","address":"+15551234567","body":"see you at six","dateMs":1756299000000,
   "inbound":true,"read":true,"kind":"sms","hasAttachments":false}],
 "hasMore":true}
```

`sms.send` — **request**. Two shapes, and only two:

```json
{"threadId":"42","addresses":["+15551234567"],"body":"on my way"}
{"addresses":["+15551234567"],"body":"..."}
```

→ `ack {"threadId":"42","recipients":1}`.

#### The send rule

**A send names both the thread and every recipient, and the phone refuses the pair if they do not
agree.** This is a rule, not a recommendation, and it binds both sides:

1. **The Mac must send `addresses` on every `sms.send`.** A send with `threadId` and no `addresses`
   is refused with `BAD_REQUEST`. There is no shape of this message where the phone works out who
   the recipient is on its own.
2. **The Mac must never take the recipient from whichever thread the UI has open.** It resolves the
   recipient from the thread it is *sending into* — the `addresses` of the `sms.threads` row, or
   the `address` of the message being replied to — and sends that value. A number read off the
   currently-visible pane is not a resolved recipient; it is a guess that happens to be right most
   of the time.
3. **The phone verifies before sending.** When both `threadId` and `addresses` are present, it
   reads the thread's real recipients out of the provider and compares. A mismatch is refused with
   `RECIPIENT_MISMATCH` and **nothing is sent to anyone**, including the addresses that did match.
4. **Comparison is by normalised digits**, not by string equality: `+1 555-123-4567` and
   `5551234567` are the same recipient and must not be refused as different ones. Normalisation
   strips everything that is not a digit and compares the last 7 digits or the whole number,
   whichever is shorter, which is the same rule the platform's own `PhoneLookup` uses.
5. **`threadId` may be omitted only for a genuinely new conversation**, where `addresses` is the
   only source of truth and there is nothing to disagree with.

The reason this is a rule is that Phase 4 is the first phase where a bug loses data rather than
annoying someone. Every failure before this one is recoverable by clicking again: a tap in the
wrong place can be undone, a mirror that goes black comes back. **A message delivered to the wrong
person cannot be taken back**, it is visible to someone who was never meant to see it, and the user
finds out from the other person. Two independent facts that must agree, checked on the side that
holds the truth, is the cheapest guard that actually closes it — a Mac that has drifted (a stale
thread list, a pane switched between composing and sending, an off-by-one in a list index) sends a
pair that does not agree, and the phone stops it.

Note which side does the checking. The Mac cannot verify this: its thread list is a copy, and a
copy is exactly what goes stale. The phone reads the provider at send time.

A long body is split into parts by the phone using `SmsManager.divideMessage`; the Mac sends one
message and is told about one message. The ack is sent when the radio reports the last part
*sent*, not delivered — delivery reports are optional, carrier-dependent, and waiting for one
would hang the request on networks that never send them.

`sms.received` — **event**, carrying exactly one `messages[]` entry plus its `threadId`.

**Both are required, and a phone that cannot supply them sends nothing.** The inbound broadcast can
arrive before the provider has written the row, so the message id and thread id may not exist yet;
the phone retries the lookup and, if it still has neither, **drops the event on its own side with
an `e:` line** rather than emitting a partial shape. A receiver must therefore treat an
`sms.received` with an empty or absent `messages[]`, or no `threadId`, as a **malformed event from
a misbehaving or outdated peer** — drop it, log it with its cause, and do not attempt to
reconstruct a message from top-level fields. Being lenient here is how the two sides came to
disagree about this event's shape for two sessions while both logged success (defect 34).

`sms.sent` — **event**, payload **identical to `sms.received` with `inbound: false`**.

```json
{"threadId":"42",
 "messages":[{"id":"9912","address":"+15551234567","body":"on my way",
              "dateMs":1756299100000,"inbound":false,"read":true,
              "kind":"sms","hasAttachments":false}]}
```

Emitted whenever the provider gains an outgoing row — **whether the send came from this Mac,
another client, or the phone's own keyboard**. Every rule stated for `sms.received` above applies
unchanged: exactly one entry plus its `threadId`, both required, the same bounded retry when the
provider write has not landed, and **drop it rather than emit a partial shape**. A receiver treats a
malformed one the same way, for the same reason.

`read` is `true`: a message the user sent has by definition been seen by them.

**Why an event and not a richer ack on `sms.send`.** An ack reaches only the client that asked, so a
message typed on the handset would still never appear — that is defect 44, and it cannot be fixed
on the Mac at all. It also keeps the ack meaning exactly one thing, *"the radio accepted this"*,
rather than a statement that can be both late and wrong. And it survives more than one client:
when a phone serves two Macs, an ack reaches one and the other's thread silently diverges.

Defect **39** — the message a Mac just sent missing from the thread it was sent into — is closed by
the same event, because the pane appends it the way it appends an inbound one instead of re-reading
the provider before the row exists. **A delay before that re-read is explicitly rejected** and has
been four times in this project: it substitutes a plausible value for a known one. The phone knows
when its own write landed and says so.

`sms.send`'s request shape, its ack, and the recipient rule above are **unchanged** by this.

**MMS is partial, on purpose, and says so.** `kind` is `"sms"` or `"mms"`, and for an MMS the
`body` is its text parts joined. Attachments are reported by `hasAttachments` and are **not
delivered** by these messages: fetching an image out of `content://mms` is a bulk transfer, and the
bulk channel belongs to Phase 5. A Mac must show that an attachment exists rather than presenting a
text-only MMS as if it were whole. Sending an MMS is not supported at all; `sms.send` to a group
thread sends SMS to each address.

| Cause | `code` |
|---|---|
| Any of the three SMS permissions not granted | `PERMISSION_DENIED` |
| No telephony radio, or no SIM | `NO_TELEPHONY` |
| Thread or message id no longer exists | `NOT_FOUND` |
| Empty body, no `addresses`, `limit` out of range | `BAD_REQUEST` |
| `addresses` do not match the thread named by `threadId` | `RECIPIENT_MISMATCH` |
| The radio accepted and then failed the send | `SEND_FAILED` |

`RECIPIENT_MISMATCH` is its own code rather than a `BAD_REQUEST` because the two mean opposite
things to whoever reads the log afterwards. `BAD_REQUEST` is a malformed message. This one is a
**well-formed message that would have gone to the wrong person**, and it is the only error in this
protocol that reports a prevented harm rather than a refused convenience. It should be rare enough
that any occurrence is worth investigating on the Mac.

### Calls

Capability `calls`, gated on `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE` **and**
`ANSWER_PHONE_CALLS` — all four, because the capability promises all four verbs. Errors report
`feature: "calls"`, not `"call"`.

**Call audio never leaves the phone.** `CAPTURE_AUDIO_OUTPUT` is system-only, and recording a call
through an AccessibilityService violates Play policy. Answering from the Mac answers the call *on
the phone*; the user talks through the phone, or through a headset, or pairs the Mac to the phone
over Bluetooth as an audio device. This is a platform wall, it is in `CLAUDE.md`, and no message
here will ever carry audio.

`call.incoming` — **event**. `{"callId":"c17","number":"+15551234567","contactName":"Ada Lovelace",
"startedAtMs":1756300000000,"state":"ringing"}`. `state` is `ringing`, `active` or `dialing`.
Replayed on connect if a call is in progress.

**`number` is always present and may be the empty string.** A private caller, an OEM that declines
to fill the platform's extra, or an outgoing call the Mac did not place will all produce `""`.
`contactName` is absent rather than empty when there is no name. A Mac must therefore fall back on
**emptiness, not nullishness** — `"" ?? x` is `""`, and a chain written as
`contactName ?? number ?? 'Unknown number'` draws a blank card for every one of those cases
(defect 35). Any separator between a label and the number belongs to the number: with no number
there is no ` · ` either.

`call.ended` — **event**. `{"callId":"c17","number":"...","durationMs":42000,
"disposition":"answered"}`. `disposition` is `answered`, `missed`, `rejected` or `declined`
(`declined` meaning the other end hung up first).

`call.log` — **request**. `{"limit":50,"before":...}` →

```json
{"entries":[{"id":"5521","number":"+15551234567","contactName":"Ada Lovelace",
             "type":"missed","dateMs":1756298000000,"durationMs":0}],
 "hasMore":true}
```

`type` is `incoming`, `outgoing`, `missed`, `rejected`, `blocked`, `voicemail`, or `unknown` for a
call type a future Android version adds that this build does not recognise. `unknown` is on the
wire deliberately: mislabelling a new type as `incoming` would put a wrong fact in a call log, and
a row the Mac shows plainly as unrecognised is better than a row that is confidently wrong.

`call.dial` — **request**. `{"number":"+15551234567"}` → `ack {"callId":"c18"}`. This places the
call immediately; it does not open the dialler with the number typed in. A Mac must therefore
confirm before sending it, because there is no second chance on the phone.

`call.answer` — **request**. `{"callId":"c17"}` → `ack {}`. `callId` may be omitted to mean "the
one that is ringing"; if it is supplied and does not match, the request is refused rather than
applied to whatever is ringing now.

`call.reject` — **request**. Same shape. Ends a ringing call; on an active call it hangs up.

| Cause | `code` |
|---|---|
| Any of the four call permissions not granted | `PERMISSION_DENIED` |
| No telephony radio, or no SIM | `NO_TELEPHONY` |
| Nothing ringing, or the named call has ended | `NO_ACTIVE_CALL` |
| A call-log id that no longer exists | `NOT_FOUND` |
| Missing or unparseable number | `BAD_REQUEST` |
| Telecom refused the action | `FEATURE_UNAVAILABLE` |

### Contacts

Capability `contacts`, gated on `READ_CONTACTS`.

`contacts.list` — **request**. `{"limit":200,"query":"ada","since":1756000000000}` →

```json
{"contacts":[{"id":"c-88","displayName":"Ada Lovelace","hasPhoto":true,
              "numbers":[{"value":"+15551234567","label":"mobile"}],
              "emails":[{"value":"ada@example.com","label":"work"}]}],
 "hasMore":false}
```

`query` matches the display name and any number, and is the phone's job because it has the
indexes. `since` returns only contacts changed after that time, so a Mac that has synced once
refreshes cheaply instead of pulling the whole book.

Note that `contacts.list` is the one list that is **not** ordered newest first — it is ordered by
display name, because that is the only order a person can navigate. `before` is not accepted;
`limit` and `since` are the paging.

`contacts.get` — **request**. `{"id":"c-88"}` or `{"number":"+15551234567"}` → one contact, plus
optionally `"photo":"<base64 PNG>"` when the caller passes `"withPhoto":true` and one exists. The
photo is capped at 64 KiB; a larger one is downscaled by the phone rather than refused.

Lookup by `number` is what makes the other features legible — an SMS thread and a call log carry
numbers, and this is how they become names. Matching is by normalised digits with the country code
made optional, the same rule Android's own `PhoneLookup` uses.

| Cause | `code` |
|---|---|
| `READ_CONTACTS` not granted | `PERMISSION_DENIED` |
| No contact with that id or number | `NOT_FOUND` |
| Neither `id` nor `number` supplied | `BAD_REQUEST` |

### Media remote

Capability `remote`. Gated on the **notification-listener** grant, not on a permission of its own:
`MediaSessionManager.getActiveSessions` requires it. That is the whole reason the media remote is
in the same phase as notifications — one grant, two features, asked for once.

`remote.state` is both a request and an event. The Mac may ask for it, and the phone pushes it
unprompted whenever playback changes — a new track, a pause, a different app taking the session.

**Request**: `{}` → the state below. **Event**: the same payload, unsolicited.

```json
{"active":true,"package":"com.spotify.music","appName":"Spotify","playing":true,
 "title":"Gymnopédie No. 1","artist":"Erik Satie","album":"Trois Gymnopédies",
 "durationMs":213000,"positionMs":48000,"positionAtMs":1756300000000,
 "canSeek":true,"canSkipNext":true,"canSkipPrevious":true,"volume":7,"volumeMax":15}
```

`positionMs` is paired with `positionAtMs` — a reading of the phone's wall clock taken alongside
it — for the same reason `mirror.stats` pairs `ptsUs` with `monoUs`: a position with no timestamp
is stale the instant it is sent, and a Mac drawing a progress bar from it would have to guess how
stale. With the pair it can run the bar itself between updates.

`active` is false when nothing holds a media session, and the rest of the fields are then absent.
That is a normal state and not an error; the Mac shows an empty remote, not a failure.

`remote.command` — **request**. `{"action":"play_pause"}` → `ack {}`.

| `action` | Effect |
|---|---|
| `play`, `pause`, `play_pause`, `stop` | transport |
| `next`, `previous` | track |
| `seek` | needs `"positionMs"`; refused with `BAD_REQUEST` without it |
| `volume_up`, `volume_down` | one step on the session's own stream |
| `volume_set` | needs `"volume"`, in the range the state reported |

Commands go to the session the state describes. An app that declares it cannot skip — `canSkipNext`
false — is not sent a skip; the request is refused rather than dropped into a session that will
ignore it, because a remote that silently does nothing is the failure this project keeps ruling
out.

| Cause | `code` |
|---|---|
| Notification listener access not granted | `PERMISSION_DENIED` |
| Nothing is holding a media session | `NO_MEDIA_SESSION` |
| An action the session says it does not support | `FEATURE_UNAVAILABLE` |
| `seek` with no `positionMs`, `volume_set` out of range, unknown action | `BAD_REQUEST` |

## Bulk channel (42503)

Client sends session token, then a JSON header frame:
`{"transferId":"...","offset":<bytes>}`
then raw chunks of **up to** 256 KB. Progress is reported on the control channel, not here.

**The header names the transfer and nothing else.** Everything about *what* is moving — size, name,
mime, digest — was agreed on the control channel when the `transferId` was issued, by
`media.original` and by `fs.transfer.begin`. Repeating those fields here would be a
second copy of the same facts, free to disagree with the first, and the shorter header is what makes
the 64 KB cap comfortable rather than tight.

**Chunks are *up to* 256 KB, not exactly 256 KB.** The last chunk of any file is short, and the
design calls for adaptive sizing between 64 KB and 256 KB on a slow link. `chunkMax` is carried in
the `media.original` and `fs.transfer.begin` acks so the number is negotiated rather than a constant two implementations have
to agree about silently. (This sentence used to read "raw chunks of 256 KB", which the first short
final chunk would have violated — open question 4 in `docs/RESUME.md`, now closed.)

**Resume: the header may carry a non-zero `offset`.** The sender seeks there to *send* from, and its
digest still covers the whole file, from byte 0 — those are two different positions and conflating
them makes every resumed transfer report `CHECKSUM_MISMATCH` on a file that is perfectly correct.
The receiver has the mirror obligation: read its own partial back through the digest before appending.
**Resume was observed on 2026-09-01** — a 52 MB video interrupted at 26,476,544 bytes, resumed from
exactly that offset, with three independently computed whole-file digests agreeing. See
`docs/testing.md` → Slice 4.

### Frame caps

Every frame on this channel is length-prefixed like every other channel, and this channel has **two
caps**, both enforced on the read side *and* the write side by both peers:

| Frame | Cap | Constant |
|---|---|---|
| The JSON header | **64 KB** | `Link.MAX_BULK_HEADER_FRAME` / `MAX_BULK_HEADER_FRAME` |
| Every chunk | **1 MB** | `Link.MAX_BULK_FRAME` / `MAX_BULK_FRAME` |

**1 MB is deliberately smaller than the 8 MB `MAX_FRAME` the video channel uses.** This channel
moves chunks, and the largest legitimate chunk is 256 KB. A frame bigger than a chunk is not a
bigger transfer — it is a peer that has lost sync or is lying. `MAX_FRAME` is sized for a video
keyframe, and inheriting it here would let a peer make the other end allocate 8 MB per frame to move
256 KB of payload: 32x the memory for no capability. The header is capped far lower again, for the
same reason the session-token frame is capped at 128 bytes — a malformed first frame must not be
able to claim the payload budget on a connection that has proved nothing beyond its token.

**A frame past its cap closes the socket.** It is not resynchronised and not skipped: a length
prefix is either right or the stream is desynchronised, and there is no third case worth guessing
at. This is the rule the video channel has followed since Phase 2. The refusal names which cap was
exceeded, the offending length, and the frames and bytes the channel had already accepted — a
refusal count with no denominator cannot distinguish the first frame of a broken channel from the
ten-thousandth frame of a transfer that has moved 2 GB.

The write side is capped too, and it catches a different fault: the read side catches a peer that
has lost sync, the write side catches an adaptive chunk size that has run away on *this* end, before
it becomes a frame the far end has to close the socket over.

## Files (42501, with bytes on 42503)

Capability `files`. Eight types, and they address a **`(rootId, path)` pair — never a bare absolute
path.** The reasoning, the platform wall it starts from and the rejected alternatives are in
`docs/phase-5-fs-media-proposal.md`; this is the contract.

### The wall this namespace is built on

**There is no path-based view of the phone's shared storage, and there is not going to be one.**
Scoped storage is not optional at `targetSdk 36`, so `fs.*` browses **SAF trees the user granted**,
one folder at a time. Observed on hardware (SM-S938B, Android 16, through our own package, because
the restriction is applied against the *calling* package):

- the **root of internal storage** cannot be granted;
- **`Download` itself** cannot be granted, though folders **inside** it can;
- `Android/data` and `Android/obb` are unreachable by any route, for any app.

`MANAGE_EXTERNAL_STORAGE` would lift the first two and is **deliberately not requested**. The
consequence a Mac must be able to state rather than let a user discover: **a file sitting directly in
`Download/` can never be reached by this app.**

### Roots — `fs.list` with no `rootId`

There is no `fs.roots`. The inventory is fixed at twelve names, and adding a thirteenth to answer a
question the existing one already answers is how a namespace bloats.

```json
request  {}
ack
{"roots":[
  {"rootId":"downloads:connectsuite","label":"Received files","kind":"downloads","writable":true,
   "freeBytes":27233689600},
  {"rootId":"app:files","label":"ConnectSuite","kind":"app","writable":true,
   "freeBytes":27233689600},
  {"rootId":"saf:primary%3ADCIM","label":"DCIM","kind":"tree","writable":true,
   "freeBytes":27233681408}],
 "push":true,
 "grantHint":"Add a folder in ConnectSuite on the phone, under Sync › Folders, to browse more of it"}
```

**`push` says whether this phone will receive files**, and it is here rather than in the capability
list because `files` is one capability with two directions and the Mac draws a different pane for
each. **Absent means false**, which is what every phone built before push shipped means, so a Mac
must treat a missing field as "no" rather than as "unknown". A Mac must not draw an upload
affordance — a drop target, an upload button, a menu item — unless this is `true`.

`rootId` is opaque to the Mac and stable across sessions — it is **derived from the tree URI**, not
assigned, so nothing has to store it and a revoked grant disappears on its own.

`kind` is `downloads` | `app` | `tree` | `all`. This build serves the first three; **`all` is
reserved and unused**, held open so that all-files access, if it is ever added, is one more root
rather than a protocol change. **A Mac must handle a `kind` it does not recognise by showing the
root with its label and no special treatment, never by discarding it.**

**Two roots are present on every phone, before anything is granted:**

| `kind` | What it is | Why it is always there |
|---|---|---|
| `downloads` | `Download/ConnectSuite`, through `MediaStore` | **Needs no permission of any kind.** It is where a push with no folder shared lands, so a fresh install can receive a file before the user has picked anything |
| `app` | the app's own private folder | The one root that cannot fail — no grant, no provider, no user |

An empty roots array would be indistinguishable from a phone with nothing on it. These two plus a
`grantHint` say both things at once: the feature works, and there is more that has not been shared.

**A Mac counting shared folders must count `kind == "tree"`, never the length of this array.** The
two roots above are not folders the user shared, and reading the array length as "how much has been
shared" reports two on a phone that has shared nothing — which on this Mac made the pane's
almost-empty state unreachable and took the `Download` wall off screen with it.

**The `downloads` root is flat and has no subdirectories.** `MediaStore` cannot represent an empty
directory — a folder there exists only as the relative path of a file inside it — so `fs.mkdir`
against this root refuses with `BAD_REQUEST` and `fs.list` on any path below it answers
`NO_SUCH_ENTRY`. That is the platform, not a simplification: a `fs.mkdir` that returned an entry
would be describing a folder that will not be in the next listing.

**It lists this package's own contributions only.** Without storage permission — which this app
deliberately does not ask for — a `MediaStore` query returns what ConnectSuite put there. A file the
user moves into `Download/ConnectSuite` by hand is really there and will not appear in `fs.list`. A
Mac must not present this root as a complete view of that directory.

`grantHint` is a sentence for a person, present only when more could be granted — which under SAF is
almost always. **It is not parsed**, the same standing the capability `unavailable` strings have.

### `fs.list` inside a root

```json
request  {"rootId":"saf:primary%3ADCIM","path":"Camera","limit":200,
          "afterName":"IMG_2041.jpg","afterId":"msf%3A1000012345"}
ack      {"rootId":"saf:primary%3ADCIM","path":"Camera","hasMore":true,
          "entries":[{"id":"msf%3A1000012345","name":"IMG_2041.jpg","dir":false,
                      "size":3874112,"mtimeMs":1756298000000,"mime":"image/jpeg"}]}
```

**`name` is always the real path component** and is what the Mac sends back to navigate. Where a
component is a package id *and an app by that name is actually installed*, `packageName` and
`displayName` go beside it — never instead of it. Prettifying `name` would break navigation: the
path is data, only the label is a sentence.

**`id` is the phone's stable handle** — a SAF document id or a relative path, percent-encoded. It is
what `fs.stat`, `fs.delete` and `fs.transfer.begin` name, so a rename between two calls produces a
`NOT_FOUND` rather than acting on a different file with the same name.

**`path` is `/`-separated, relative to the root, and may not contain a `..` segment.** The phone
refuses one with `BAD_REQUEST` rather than normalising it: normalising an escape attempt and then
serving the result is how a traversal gets served politely.

**Ordering is `dir` descending (folders first), then `name` ascending compared byte-wise, then `id`
ascending byte-wise.** The cursor is the `(afterName, afterId)` pair from the last entry received.
Byte-wise means **UTF-8 bytes**, not the platform's string comparison — UTF-16 and UTF-8 order
supplementary characters differently, and two ends that agree on "byte-wise" while one uses its
language's `compareTo` will land the cursor in different places for any name containing an emoji.

The `id` tiebreak is load-bearing even though display names look unique: a `DocumentsProvider` does
not guarantee unique display names, and — the part that actually decides it — **the row order is not
ours.** Every page is a fresh provider query, and without a total ordering the tie group sorts
differently on page two than on page one.

**`limit` is capped at 500 and defaults to 200.** An `fs.list` ack is a control frame; an uncapped
listing of a 100,000-file directory builds a frame the far side is obliged to refuse, and a refused
frame closes the socket — so the symptom would be *"this folder disconnects the app"*.

**A cursor whose entry has vanished is resolved approximately, and it over-returns on purpose.** The
page then starts at the first entry after it, with the vanished entry assumed to have been a folder,
so the failure is a repeated row and never a gap. A repeat is cosmetic; a skipped row is a file the
user cannot see and has no way to discover.

**The phone snapshots a directory for the length of a paging run.** This is a correctness property,
not only a speed one: re-reading between pages lets the cursor's sorted position shift underneath the
pager. Sliding 30 s idle TTL, 120 s absolute ceiling, dropped by any write the phone makes. It cannot
see a change made by anything else on the device, and nothing can — these are not our directories.

### `fs.stat`

```json
request  {"rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345"}
ack      {"id":"msf%3A1000012345","name":"IMG_2041.jpg","dir":false,"size":3874112,
          "mtimeMs":1756298000000,"mime":"image/jpeg","sha256":null}
```

`sha256` is `null` unless the phone already holds one and is **never** computed here: digesting a
4 GB video to answer a stat would block the control channel for a minute with nothing able to report
progress. A directory reports `size: 0` and `mime: "inode/directory"`.

### `fs.mkdir`

```json
request  {"rootId":"saf:primary%3ADCIM","path":"Camera","name":"trip"}
ack      {"id":"msf%3A1000012500","path":"Camera/trip"}
```

Creates one directory, not a chain. `name` may not contain `/`.

### `fs.delete` — compare-and-delete

```json
request  {"rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345",
          "expectSize":3874112,"expectMtimeMs":1756298000000}
ack      {"deleted":1}
```

**`expectSize` and `expectMtimeMs` are required, and a mismatch refuses the delete with
`TARGET_STALE`.** They are the facts the Mac last saw in `fs.list`; the phone holds the truth and
checks them **at the moment of acting** — it re-reads the row immediately before the delete, with
nothing between the check and the call.

They are required rather than optional-with-a-default, because a default would be a way to ask for an
unconditional delete and no such request exists. The phone offers no unguarded deletion internally
either.

This is the same shape as the SMS recipient rule — *both facts named, verified on the side that holds
the truth, nothing done on a mismatch* — and it is `TARGET_STALE` for the same reason `sms.send` has
`RECIPIENT_MISMATCH`: **it reports a prevented harm rather than a refused convenience.** Any
occurrence is worth investigating on the Mac.

Two facts and not one: a file rewritten to the same length passes a size-only guard, and nothing
about the request would look wrong.

`deleted` is a count so a future recursive delete has somewhere to report; today it is `0` or `1`.
**Directory deletion is not part of this protocol** — a directory is refused.

> **A note on the name.** `docs/phase-5-fs-media-proposal.md` calls this `STALE_TARGET`.
> `ErrorCode.TARGET_STALE` has existed since Phase 4 with this meaning word for word, and shipping
> both would put two codes whose names are anagrams, and whose meanings are identical, into one
> protocol — a Mac switching on one would silently miss the other and nothing would ever fail
> loudly. The protocol's bar for a new code is *the Mac reacts differently*, and here it does not.
> The existing name wins; the proposal's is the deviation.

### `fs.transfer.begin`

```json
request  {"direction":"pull","rootId":"saf:primary%3ADCIM","id":"msf%3A1000012345"}
ack      {"transferId":"t-8f21","direction":"pull","size":3874112,"mtimeMs":1756298000000,
          "name":"IMG_2041.jpg","mime":"image/jpeg",
          "sha256":"97b1c8f2…","offset":0,"chunkMax":262144}
```

`direction` is from the **Mac's** point of view: `pull` moves phone → Mac, `push` moves Mac → phone.
**Both directions are served.** A phone that does not serve `push` answers `FEATURE_UNAVAILABLE` and
says so in the roots ack's `push` field; a Files pane must not draw an upload affordance unless that
field is `true`.

A push request names where the file is going rather than what it is:

```json
request  {"direction":"push","rootId":"saf:primary%3ADCIM","path":"Camera",
          "name":"holiday.mov","size":214748364,"sha256":"6f3b…"}
ack      {"transferId":"t-9c04","direction":"push","size":214748364,"name":"holiday.mov",
          "sha256":"6f3b…","offset":1048576,"chunkMax":262144}
```

**`sha256` on a push is the Mac's digest, agreed before a byte moves**, and it is optional. Null is
answered honestly with `verified: false` on `fs.transfer.done` rather than refused — a transfer
nobody could check is a real outcome and must not be dressed as a checked one.

**`offset` on a push is the phone's answer and is the whole point of the field.** It is computed
from the transfer record and the partial on disk together, never from the filename: a `.part` with
no record of ours beside it is another app's file and the phone starts from zero rather than
appending to it. See *What is left on disk* below.

**`sha256` is non-null when the phone pre-hashed**, which it does below a 64 MB ceiling. That is what
makes `verified: true` reachable at all — `media.original` acks `null` because hashing before sending
reads the file twice, and a large file would hold the control channel for the length of a full read
with no progress to report. Above the ceiling this ack also carries `null` and the transfer reports
`verified: false`, which is the honest answer rather than a silent downgrade.

**`offset` is the resume point and is decided by the receiver**, the side that knows what it already
holds. On a `pull` that is the Mac, which sends the offset it wants in the **bulk header**, so this
field is `0`. On a `push` the phone is the receiver and the offset it already has belongs here.

**One `transferId`, one file, one bulk connection.** A folder copy is the Mac's loop over *n* of
these, not a protocol feature.

### `fs.transfer.progress` — event, phone → Mac

```json
{"transferId":"t-8f21","bytes":52428800,"total":214748364,"bytesPerSecond":11534336}
```

Throttled to at most one every 250 ms, **plus a final one at completion that is never throttled**.

**A file that finishes inside one window emits exactly one event: the final one.** Most transfers on
a LAN — a photo, a screenshot, a PDF — complete in well under 250 ms, so **the common case is a
transfer with no intermediate progress at all.** A Mac that waits for a stream before believing a
transfer started would show every small file as stalled. A transfer is live from its
`fs.transfer.begin` ack, not from its first progress event, and **no progress events is a normal,
successful shape** meaning fast, never stuck.

Fraction and ETA are not sent. The Mac derives them: a fraction with no bytes beside it is a number
with nothing to check it against.

### `fs.transfer.done` — event

```json
{"transferId":"t-8f21","ok":true,"bytes":214748364,"elapsedMs":18400,
 "verified":true,"sha256":"97b1c8f2…"}
```

**`verified` is a separate field from `ok`, and this is deliberate.** A transfer that completed with
no digest to compare against is a *success that was not verified*, and collapsing it into `ok: true`
means the one case worth knowing about looks identical to the one that was checked. It is true only
when a digest was agreed **before** the transfer and the one computed while streaming matches it.

**On a checksum mismatch the receiver deletes the partial** — *a corrupt file is worse than a missing
one; drop the partial so a retry is clean* — and leaves a `name.failed` sidecar in its place. See the
on-disk convention below.

### `fs.transfer.cancel` — either side

```json
request  {"transferId":"t-8f21","reason":"user"}
ack      {"transferId":"t-8f21","stopped":true}
```

**The partial is kept** as `name.part` with its record intact, and the next `fs.transfer.begin` for
the same file resumes from it. That is the opposite policy from a checksum mismatch, and the
difference is the point: an interrupted partial is a resumable artifact, a checksum-failed partial is
corrupt. Two states that both look like half a file on disk and want opposite treatment.

A cancelled `transferId` can no longer be claimed by a bulk socket.

### What is left on disk, on both sides

| State | On disk | Means |
|---|---|---|
| In flight, or interrupted | `holiday.mov.part` | Bytes are good as far as they go. **Resumable.** |
| Verified complete | `holiday.mov` | Done. Any stale `.part` and `.failed` for this name are removed. |
| Checksum mismatch | `holiday.mov.failed`, and **no** `.part` | The bytes were wrong and have been deleted. **Retry from zero.** |

**Partials are never visible at their final name.** Without that, *a corrupt file is worse than a
missing one* is enforced for the checksum case and quietly broken for every interruption.

**A `.part` is a display convenience and must never be load-bearing.** These are not our
directories — a granted tree is `DCIM` or `Documents`, shared with every downloader on the device,
all of which write `.part` files as a matter of course. Anything that decides to append to, delete or
overwrite consults the transfer **record**, not the filename. A `.part` with no record of ours beside
it is a stranger's file and is left alone.

**`fs.list` returns `.part` and `.failed` entries like any other file** rather than hiding them.
Hiding them would put the Mac's rendering and the phone's directory into disagreement about what is
there, and it means the convention survives a Mac that has never heard of it.

### When a file operation cannot be done

| Cause | `code` |
|---|---|
| The root is not one the phone has been granted | `ROOT_NOT_GRANTED` |
| The tree was shared read-only, or the provider refused a write | `PERMISSION_DENIED` |
| The file, directory or id no longer exists | `NOT_FOUND` |
| `expectSize`/`expectMtimeMs` disagree with the file on disk | `TARGET_STALE` |
| The receiver has no room | `NO_SPACE` |
| Digest mismatch on arrival; the partial was deleted | `CHECKSUM_MISMATCH` |
| The socket dropped, a read failed, a write failed | `TRANSFER_FAILED` |
| A `..` segment, `limit` out of range, a missing required field, a `/` in a mkdir name | `BAD_REQUEST` |
| `direction: "push"` against a phone that only pulls | `FEATURE_UNAVAILABLE` |
| A push whose destination folder was shared read-only | `PERMISSION_DENIED` |
| A push larger than the free space the phone reports | `NO_SPACE`, refused **before** the socket opens |

**`ROOT_NOT_GRANTED` is not `PERMISSION_DENIED`.** `PERMISSION_DENIED` greys out the pane, which is
right when a capability has no grant at all and **wrong** here: the feature works, the user has added
two folders, and the Mac asked about a third. The response is an "add this folder on the phone"
affordance, not a dead pane.

**`NO_SPACE` is not `TRANSFER_FAILED`.** Retrying fixes a `TRANSFER_FAILED` and cannot fix this one.
Only the user can, and they need to be told which side is full.

**`CHECKSUM_MISMATCH` is not `TRANSFER_FAILED` either**, for the opposite reason: retrying *is* worth
it, the partial has already been deleted so a retry is clean, and it says something a generic failure
does not — the bytes moved and were wrong, which is a different fault from bytes that never moved.

## Session tokens

`hello.ack` carries a 32-byte random token, hex encoded. The video and bulk sockets must present
it as their first frame within 10 seconds of connecting or they are dropped. A token dies with
its control connection.

## Pairing

The Mac renders a QR code; the phone scans it. Payload:

```json
{"host":"<mac ip>","fp":"<mac cert sha256>","token":"<one time token>","name":"<mac name>"}
```

`fp` is colon-separated uppercase hex of the SHA-256 over the DER certificate. The phone stores
`fp` in its trusted-device table and thereafter accepts TLS only from peers whose certificate
fingerprint is in that table. `token` is single-use and expires 5 minutes after the QR is drawn;
it is presented in the `hello` payload as `pairToken` on the first connection after a scan.

## Discovery

The phone registers `_connectsuite._tcp` on port 42501 with TXT records `name`, `model`,
`proto`, `id`. The Mac tries, in order, each with a 2 second timeout: the last known IP, the
default gateway IP, mDNS, then manual entry.

## Errors

```json
{"type":"error","payload":{"code":"PERMISSION_DENIED","feature":"sms","message":"...","fixHint":"Open Settings > Apps > ConnectSuite > Permissions"}}
```

Codes: `PERMISSION_DENIED`, `FEATURE_UNAVAILABLE`, `SECURE_SURFACE`, `ENCODER_FAILED`,
`DEVICE_LOCKED`, `CONSENT_TIMEOUT`, `GEOMETRY_STALE`, `GESTURE_FAILED`, `NO_EDITABLE_FOCUS`,
`UNSUPPORTED_KEY`, `TRANSFER_FAILED`, `PROTOCOL_MISMATCH`, `UNAUTHORIZED`, `BAD_REQUEST`,
`NOT_FOUND`, `NO_REPLY_ACTION`, `NO_TELEPHONY`, `SEND_FAILED`, `NO_ACTIVE_CALL`,
`NO_MEDIA_SESSION`, `TARGET_STALE`, `ROOT_NOT_GRANTED`, `NO_SPACE`, `CHECKSUM_MISMATCH`

`feature` is a **capability name** — see [the namespace rule](#namespace-rule) — or absent for the
system messages, which belong to no feature.

The four added for input are described under [Input](#input-42501). They exist as separate codes
rather than as `FEATURE_UNAVAILABLE` with different sentences because the Mac reacts differently
to each: `GEOMETRY_STALE` is retryable immediately, `NO_EDITABLE_FOCUS` needs the user to tap a
field first, and `UNSUPPORTED_KEY` is never worth retrying at all.

The seven added for Phase 4 are described under [Phase 4 features](#phase-4-features-42501), and
exist for the same reason. Two are worth naming here because they are the ones most easily
collapsed into something vaguer:

- **`NOT_FOUND` is not `FEATURE_UNAVAILABLE`.** The feature works; the item is gone. A Mac that
  gets `FEATURE_UNAVAILABLE` greys out a pane, which is exactly the wrong response to a
  notification the user dismissed on the phone half a second ago. The right response is to refresh
  the list.
The three added for files are described under [Files](#files-42501-with-bytes-on-42503) and exist
for the same reason — `ROOT_NOT_GRANTED` is an "add this folder" affordance where
`PERMISSION_DENIED` would grey the pane out, `NO_SPACE` is the one failure a retry cannot fix, and
`CHECKSUM_MISMATCH` is the one where a retry is *worth* it because the partial is already gone.
`TARGET_STALE` is reused rather than duplicated as `STALE_TARGET`; the note under `fs.delete` says
why.

- **`BAD_REQUEST` is a fault on the Mac's side**, and the only code here that is. Nothing the user
  can do affects it and nothing the phone can do fixes it; it is in the protocol so that a Mac bug
  looks like a Mac bug in the log rather than like a phone that has stopped working.
