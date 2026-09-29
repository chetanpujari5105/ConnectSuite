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
- `hello` and `hello.ack` may each carry `ext` — see [Extensions](#extensions-ext)

Capability list example: `["mirror","notifications","sms","calls","contacts","files","photos","clipboard","remote","apps","mic","share"]`
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
    { "name": "apps",  "reason": "missing Notifications" }
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

#### `limited` — on, but only in part

`hello.ack` and `capabilities.changed` carry a third field, for a capability that **is** in
`capabilities` and works only in part:

```json
{
  "capabilities": ["photos", "files"],
  "unavailable": [],
  "limited": [
    { "name": "photos", "reason": "Some photos allowed — only the photos and videos chosen on the phone are shared. Change the selection on the phone, in Set up Sidekick." }
  ]
}
```

Today it has one member: `photos` when the person chose Android 14's **Allow limited access**
(defect 139). The four `media.*` verbs answer, and `MediaStore` returns exactly the items they
picked — so the capability is on, and a pane that showed the library as complete would be wrong.
The phone sends the same sentence its Set up Sidekick screen means by *Some photos allowed*; both
read one state (`MediaAccess`: full, selected, or none).

The three states, as the Mac sees them:

| Phone's access | `capabilities` | `unavailable` | `limited` |
|---|---|---|---|
| full | has `photos` | — | — |
| selected only | has `photos` | — | `photos` with its reason |
| none | — | `photos` with its reason | — |

A name appears in `limited` only if it is also in `capabilities`. Like `unavailable`, `limited` is
**optional on the wire** and defaults to empty: an older phone sends nothing and the Mac shows the
capability as whole, which is what it did before. The reason is for a person; switch on `name`.
A change between full and selected-only moves no name, so the phone re-sends `capabilities.changed`
whenever `limited` changes, exactly as it does when a reason in `unavailable` changes (defect 27).

`hello` is rejected with `PROTOCOL_MISMATCH` when the major version differs. The Mac's TLS
certificate fingerprint must already be in the phone's trust store or the TLS handshake itself
fails before `hello` is read.

### Message types

Notifications: `notif.posted`, `notif.removed`, `notif.reply`, `notif.action`, `notif.dismiss`
SMS: `sms.threads`, `sms.messages`, `sms.send`, `sms.received`, `sms.sent`
Calls: `call.incoming`, `call.ended`, `call.log`, `call.dial`, `call.answer`, `call.reject`
Contacts: `contacts.list`, `contacts.get`
Clipboard: `clip.push`, `clip.request`, `clip.history`
Files: `fs.list`, `fs.stat`, `fs.thumb`, `fs.mkdir`, `fs.delete`, `fs.transfer.begin`, `fs.transfer.progress`, `fs.transfer.done`, `fs.transfer.cancel`
Photos: `media.buckets`, `media.list`, `media.thumb`, `media.original`
Mirror: `mirror.start`, `mirror.stop`, `mirror.config`, `mirror.keyframe`, `mirror.stats`, `mirror.state`, `mirror.rotate`
Input: `input.tap`, `input.swipe`, `input.scroll`, `input.key`, `input.text`, `input.global`
(back/home/recents/notifications/quick-settings/lock-screen — **not** power; see [Input](#input-42501))
Apps: `apps.list`, `apps.icon`, `apps.open.ask` — see [Apps](#apps-42501). There is deliberately **no**
`apps.launch`; the measurement that removed it, and the guard that keeps it removed, are in that section
Media remote: `remote.state`, `remote.command`, `remote.artwork`
Microphone: `mic.start`, `mic.stop`, `mic.state` — see [Microphone](#microphone-42501-with-audio-on-42504)
Share: `share.offer`, `share.respond`, `share.cancel`, `share.saved` — see [Share](#share-42501);
`share.saved` belongs to version 2, built on both sides and unreachable while both advertise 1
Envelope and handshake: `hello`, `hello.ack`, `ack`, `error`, `pair.rejected`
System: `ping`, `pong`, `capabilities.changed`, `battery.state`, `storage.state`, `net.state`

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
| `mirror`, `input`, `sms`, `contacts`, `remote`, `apps`, `mic`, `share` | *(same name)* |

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
{"state":"requesting-consent","message":"Android is asking for screen-sharing permission on the phone.","fixHint":"Approve screen sharing on your phone."}
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

### `mirror.stop` and `mirror.keyframe`

`mirror.stop` — **request**, Mac to phone. `{}` in, an empty ack out. It stops the encoder and the
foreground service, and it **acks whether or not a session was running**: the Mac's idea of the
session state can lag a phone that has already ended one — a `SECURE_SURFACE` refusal, a revoked
projection, a rotation that failed to swap — and turning that lag into an error would report a
failure for a stop that succeeded in every sense the user cares about.

`mirror.keyframe` — **request**, Mac to phone. `{}` in, an empty ack out. It asks the live encoder
for a sync frame, which is what a Mac sends when its decoder has been reset or has been fed a stream
it cannot resolve into a picture.

**The ack says the request reached the encoder, not that a keyframe was produced.** The frame, if
one is produced, arrives on the video channel afterwards; a Mac that treats this ack as the picture
being fixed has confused a registration line for an execution line. With no session running there is
nothing to ask, and the ack is still empty and still not a promise.

### `mirror.state`

An event from the phone whenever the mirror session changes phase. It is the only thing that says
a session is progressing, so the Mac drives its canvas from these and never from a timer:

```json
{"state":"awaiting-foreground","message":"...","fixHint":"...","requestId":"<the mirror.start id>"}
```

| `state` | Meaning | Terminal |
|---|---|---|
| `awaiting-foreground` | Sidekick is backgrounded on the phone, so Android will not let it show the consent prompt. The phone has posted a request notification; the user taps it, reads Sidekick's request screen and chooses **Continue** (Android's prompt follows) or **Decline**. | no |
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

`ptsUs` and `monoUs` are **two different moments of one frame**, and the distinction is the whole
value of the pair:

| field | the instant it names | stamped by |
|---|---|---|
| `ptsUs` | the display pipeline composited the frame — **capture** | the Surface |
| `monoUs` | `System.nanoTime()` at `dequeueOutputBuffer` — **after encoding** | the encoder loop |

Both are on the phone's monotonic clock, so **`monoUs - ptsUs` is that frame's encode duration** and
the two are stage boundaries rather than an anchor pair. The Mac uses `ptsUs` as the capture instant
directly and `clockOffsetMs` (from the pong estimator, not from here) to reach its own clock.

This paragraph used to read *"the phone's monotonic clock reading for that same frame"*, which named
no moment at all — and the Mac accordingly anchored *capture* to `monoUs` and published totals with
the encode stage subtracted, 44% of the figure on the one handset measured. Defect 108.

Re-sending every 2 seconds also corrects for drift between the two clocks over a long session.

**A consumer must not assume the timebases match.** They do on the SM-S938B (measured: 17.7 ms and
15.4 ms of encode lag), and a phone that rebases PTS to zero would make `monoUs - ptsUs` an uptime.
Capture time is then not knowable on the phone at all — nothing observes a frame before the encoder
returns it — and the honest report is a pipeline measured from encoder output and **said to be**.

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
| Declined on Sidekick's own request screen, before Android's prompt was shown | `PERMISSION_DENIED` |
| Consent prompt answered "no" | `PERMISSION_DENIED` |
| Consent prompt closed unanswered | `PERMISSION_DENIED` |
| Consent unanswered for 30 seconds | `CONSENT_TIMEOUT` |
| Phone locked | `DEVICE_LOCKED` |
| FLAG_SECURE content on screen | `SECURE_SURFACE` |
| Encoder would not start | `ENCODER_FAILED` |
| Encoder died mid-stream | `ENCODER_FAILED` |
| Video socket token invalid | `UNAUTHORIZED` |

The codes repeat; the messages do not. **No message or `fixHint` quotes a button of Android's
prompt** — Android and the phone's maker word it, and it differs (the SM-S938B reads *Next* then
*Share screen*); the phone says *approve screen sharing* and leaves the label to the phone
(`ConsentCopyTest`). `SECURE_SURFACE` is the only one that does not end the
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
the phone*; the user talks through the phone, or through a headset paired to the phone. **Pairing
the Mac itself as that headset does not work, and this document used to say it did** — both ends
advertise the HFP *audio gateway* role, so they bond and share no audio profile at all (measured
both ends 2026-09-14; the mechanism and the one unproven route are in `CLAUDE.md`). This is a
platform wall and no message here will ever carry audio.

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

#### `artworkKey` and `output`

Two fields were added to the state on 2026-09-16, both because the Mac's Now Playing card is built
around them.

`artworkKey` is a stable id for the current track's art — absent when the session has none. It is
**not** the art. The bytes come from `remote.artwork` below, and the split is the point: the state
is pushed on every play, pause and position jump, and a 33 KB base64 image on each of those is the
head-of-line blocking on the `ping` channel that `media.thumb`'s batch cap exists to bound. A key is
a few dozen bytes and changes only when the art does.

`output` is where the phone is sending its audio, and it is an object rather than a string:

```json
"output": {"name": "Chetan's AirPods Pro", "kind": "bluetooth"}
```

`kind` is one of `bluetooth`, `headphones`, `speaker`, `unknown`, and it exists because it picks the
icon. A Mac choosing that icon by substring-matching the name would be the lookalike failure this
project keeps recording — *"Living Room speakers"* and *"AirPods Pro"* both match a naive rule and
only one of them is Bluetooth. **The phone classifies, because the phone is the end that knows.**
The whole object is absent when no route could be named, which is a different state from a route
named `unknown`: the first means *we could not ask*, the second means *we asked and it is something
we have no icon for*.

**`output` is a readout and there is no verb to change it.** Nothing in this contract switches the
phone's audio route, and nothing should imply one can — a chevron on a chip that cannot open
anything is an affordance that lies. Android's own output switcher is an activity, and a
backgrounded `startActivity` on this handset is refused **silently** (Phase 7 Slice 8), so the route
to it, if it is ever wanted, is `apps.open.ask`'s shape — a notification the user taps — and not a
verb that returns `ack {}` having done nothing.

### `remote.artwork`

```json
request  {"key":"a3f19c4e","maxEdge":256}
ack      {"key":"a3f19c4e","mime":"image/jpeg","width":256,"height":256,"data":"/9j/4AAQ…"}
```

**Base64 JPEG on the control channel**, for the reason [`media.thumb`](#mediathumb) and
[`fs.thumb`](#fsthumb) both give and neither repeats here: a bulk socket for one small image is a
second transfer state machine serving something that is not a transfer.

One image, not a batch, and that is the difference from its two siblings. They serve grids; this
serves the one track that is playing, at most once per track change. A cap would be bounding a
request that is already bounded by there being exactly one of it.

- **`maxEdge` defaults to 256 and is capped at 512**, refused outside 32–512, exactly as
  `media.thumb` is. `width` and `height` are the **produced** bitmap's, not the request's.
- **The key is echoed in the ack.** A track can change while the request is in flight, and a Mac
  that painted whatever came back would hang the previous album's cover on the new song. Echoing it
  lets the Mac drop a reply it no longer wants, which is a decision it cannot make from the bytes.
- **A session with no art answers `NO_ARTWORK`**, which is not an error and not `NOT_FOUND`. Plenty
  of media sessions carry no artwork at all — a podcast app, a browser tab, a game — and that is a
  normal condition rather than a failed lookup. The Mac draws its own fallback and says nothing.

| Cause | `code` |
|---|---|
| Notification listener access not granted | `PERMISSION_DENIED` |
| Nothing is holding a media session | `NO_MEDIA_SESSION` |
| The session holds no artwork, or the key is stale | `NO_ARTWORK` |
| `key` missing, or `maxEdge` outside 32–512 | `BAD_REQUEST` |

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

**Resume: the header may carry a non-zero `offset`.** The sender starts *sending* at that offset, and
its digest still covers the whole file, from byte 0 — those are two different positions and conflating
them makes every resumed transfer report `CHECKSUM_MISMATCH` on a file that is perfectly correct.
The receiver has the mirror obligation: read its own partial back through the digest before appending.

**How the phone reaches the offset, as built (corrected 2026-09-25):** it does **not** seek. It opens
the source as an `InputStream`, and `BulkTransfers.digestSkipped` **reads and hashes every byte before
the offset** before sending the first new one. So a resume costs a full re-read of the prefix on the
phone — no network, but proportional to the offset, and for a provider that fetches remotely it means
fetching the prefix again. If the source is shorter than the offset, that loop stops early without an
error; the receiver's length check is what catches it.

**Where resume exists today, and where it does not** (corrected 2026-09-25):

| Transfer | Resume | Status |
|---|---|---|
| `media.original` pull, driven by the Mac's **debug** resume probe | yes | **Observed 2026-09-01** — a 52 MB video interrupted at 26,476,544 bytes, resumed from exactly that offset, three independently computed whole-file digests agreeing (`docs/testing.md` → Slice 4). Below the 64 MB pre-hash ceiling, so digest-checked |
| `fs.transfer.begin` **pull** from the Mac's Files pane (the product path) | **no** | `FilesClient.pull` never passes a transfer record to `BulkClient.pull`, so `isResumable` always refuses, the pull starts at 0, and any existing `<name>.part` is deleted first (defect 151) |
| `fs.transfer.begin` **push** to the phone | implemented (the phone chooses the offset from its Room record) | not re-measured for this correction |
| Share (`share:` roots) | **no** — offset 0 only, enforced by `BulkClaim` | as built |

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

### `fs.thumb`

```json
request  {"rootId":"saf:primary%3ADCIM","ids":["msf%3A1000012345","msf%3A1000012399"],"maxEdge":256}
ack
{"thumbs":[
  {"id":"msf%3A1000012345","mime":"image/jpeg","width":256,"height":192,
   "data":"/9j/4AAQSkZJRgABAQ…"},
  {"id":"msf%3A1000012399","error":"NO_THUMBNAIL"}]}
```

**A thirteenth message name, and the only Files item that needed one.** Everything else the Files
pane wanted was a CSS rule, a constant, a concurrency join or renderer work. This is different
because it is not a rendering problem: **`fs.*` ids and `media.*` ids are disjoint id spaces**, and
no amount of Mac-side work bridges them.

```
fs.list  id: "primary%3ADCIM%2FCamera%2FIMG_2041.jpg"   ← a SAF document id
media.*  id: "1000012345"                                ← a MediaStore _ID
```

Asked for a thumbnail of an `fs.*` id, the Files pane saw **`ok: true` and an empty map** — a silent
empty, which is an absence with no reason attached and exactly the shape this project keeps writing
rules about. So the pane could not borrow the photo browser's thumbnails, and a selected photo drew
`Kind`/`Size`/`Modified` and no image, ever.

**That sentence used to say the *wire* answered with zero entries, and it was wrong by one layer.**
On the wire `media.thumb` answers one item per id and every one of them carries
`error: "BAD_REQUEST"`, because a SAF document id is not a number. It is the Mac's client that drops
errored ids from the map it returns, so the emptiness is the client's and the reason existed all
along one layer below it. Corrected here on 2026-09-01 while `media.*` was written into this
contract: a claim about a protocol has to name which end it was read at.

**Why a separate type rather than teaching `media.thumb` a second id space.** The same reason
`media.original` is not `fs.transfer.begin` with a media id: two mutually exclusive addressing modes
in one type means an error table that has to explain which fields go together, and a caller that can
form a request no handler can serve. One type, one addressing mode. `fs.thumb` carries `rootId`
because every `fs.*` id is only meaningful inside a root, and that is precisely the difference from
`media.thumb`, whose ids are global to the device.

**The shape deliberately mirrors `media.thumb`** — batched ids, `maxEdge`, base64 in the ack, a
per-item `error` — because a photo grid and a file listing have the same need and two different
answers to it would be a difference with no reason behind it. The caps carry over unchanged and for
unchanged reasons:

- **`ids` is capped at 32 per request.** 32 × ~33 KB ≈ 1 MB, well inside `MAX_CONTROL_FRAME`. The cap
  bounds head-of-line blocking on the channel that also carries `ping`.
- **`maxEdge` is capped at 512.** Above that it is a preview, not a thumbnail, and it belongs on the
  bulk channel like the original.
- **A per-item `error`, never a failed ack.** One unreadable file in a batch of 32 must not lose the
  other 31.

**`NO_THUMBNAIL` is a normal answer, not a failure.** Most files are not images: a `.txt`, an `.apk`
and a directory have no thumbnail and never will, and a pane that treats that as an error would grey
itself out over a folder of documents. It is distinct from `NOT_FOUND` (the id is gone) and from
`PERMISSION_DENIED` (the root's grant was revoked), because those three want three different
sentences on screen. A directory is always `NO_THUMBNAIL`; it is never an error to ask.

**Bytes on the control channel, for the same reason `media.thumb` puts them there.** A listing needs
many thumbnails within a second of a folder opening; a bulk socket per tile is absurd and a bulk
socket for the batch is a second transfer state machine serving something that is not a transfer. A
thumbnail is small by construction, and one that is not is a bug in thumbnail generation that should
be visible as one.

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

**`sha256` is non-null when the phone pre-hashed**, which it does at or below a 64 MiB ceiling. That is
what makes `verified: true` reachable at all — `media.original` follows the same rule since 2026-09-29
— because hashing before sending reads the file twice, and a large file would hold the control channel
for the length of a full read with no progress to report. Above the ceiling this ack also carries `null` and the transfer reports
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

> **As built (corrected 2026-09-25): this paragraph and the *Resumable* row below describe the design,
> and on the Mac they hold only for the debug resume probe.** When the phone receives a push, it keeps a
> record and resumes. When the Mac receives a pull from its Files pane, it passes no record, so its
> `<name>.part` is deleted and the next pull starts from byte 0 (see *Resume* under the bulk channel,
> and defect 151).

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

## Clipboard (42501)

Capability `clipboard`. Three types, and **the namespace is asymmetric because the platform is** —
that asymmetry is stated here rather than discovered at runtime, because a Mac that assumes symmetry
draws an affordance the phone can never serve.

### The wall, measured rather than inherited

Observed on hardware (SM-S938B, Android 16, `targetSdk 36`, 2026-09-01 — `docs/testing.md` →
**Slice 11**):

- **An app cannot read the clipboard unless it is focused.** Not backgrounded, not from a foreground
  service, not while holding an enabled and bound AccessibilityService, and not even to read back a
  clip it wrote itself 54 ms earlier. The platform says so on every attempt:
  `Denying clipboard access to <package>, application is not in focus nor is it a system service`.
- **`OnPrimaryClipChangedListener` does not fire while unfocused.** A real copy in another app,
  witnessed by the platform's own log, produced zero callbacks across 12 samples.
- **Writes are unrestricted.** `setPrimaryClip` from a backgrounded process lands and is readable
  afterwards.

The AccessibilityService exception this project inherited from documentation **does not operate on
this device**: the same run refused 90 of 90 reads with the service bound and 60 of 60 with it
disabled, over clips proven readable with focus half a second earlier.

So:

| Direction | State |
|---|---|
| **Mac → phone** | Works whenever the link is up. The phone is not required to be on screen |
| **Phone → Mac** | **Only while ConnectSuite is focused on the phone.** No unsolicited push, no observer, no answerable request from a backgrounded phone |

**A Mac must carry that as standing copy, before the first request**, not as the explanation of a
failure. It is not the `Download` wall's problem — the refusal here is unambiguous and does get its
own error — but a person should not learn the shape of a feature by tripping over it.

### `clip.push` — event, either side

The sender's clipboard changed and it is telling the other side.

```json
{"kind":"text","text":"https://example.com/a-thing","atMs":1788246046000,
 "source":"phone","appName":"Chrome","package":"com.android.chrome"}
```

- **`kind`** is `text`, `empty` or `sensitive` in this build. A receiver meeting a `kind` it does not
  know shows the entry as *something this end cannot display yet* and **keeps its place in the
  history** — never discards it, never renders it as empty text.
- **`package` never appears without `appName`.** The package-id rule: a package id may be a machine
  handle and never the only thing a person reads. Both are **optional** — a clipboard does not always
  name an owner — and when the owner is unknown the fields are *absent*, never `"unknown"`.
- **`atMs`** is the sender's clock. It orders that side's history and is trusted for nothing else.
- **`source`** is `phone` or `mac`, so a receiver can tell a real change from its own echo.

**From the phone this is only ever sent while the app is focused**, which in practice means the
moment a person brings ConnectSuite to the front after copying something. That is not a limitation of
this design, it is the only moment the phone is permitted to look.

**From the Mac it is sent the moment anything is copied**, by a watcher rather than a button —
macOS gates nothing, so the button was never the platform's idea. The asymmetry in this namespace is
therefore total: one side sends on every copy, the other on a focus event, and each is doing the
most its platform allows. The button remains as a manual override, and the two are **different
triggers with different rules** — see *The echo*.

**The watcher polls, because macOS offers nothing else.** `NSPasteboard` has no change
notification — no callback, no KVO, no notification-centre event — and Electron exposes no
`changeCount`, so every clipboard manager on the platform polls and reads. Measured cost, at the
500 ms floor: 0.02 % of one core at this namespace's own 64 KB cap. A read does **not** bump
`changeCount`, which is what stops the watcher being its own stimulus.

**An arriving entry is applied on the Mac and offered on the phone**, and the asymmetry is a
measurement rather than a preference. It was *offered on both* in the first build, with the note that
revisiting it meant adding an undo rather than removing the confirmation. That is what happened.

- **The Mac applies immediately.** ⌘V works with nothing clicked, which is the whole point of the
  feature. It can afford to because it reads its own clipboard first and keeps what it is about to
  overwrite as a local `displaced` entry, so **Restore is the undo the condition demanded**. That
  entry is never sent, never received, and its text is never drawn — it is the one entry in the
  history nobody chose to add, and on macOS it may be a password manager's clip.
- **The phone offers, unless its owner has said otherwise.** `SettingsStore.clipboardAutoApply`, off
  by default. Not caution: **the phone cannot build the same undo.** It may not read its clipboard
  while unfocused — the wall this whole namespace is shaped around — so it cannot see what it would
  destroy, cannot keep it, and cannot put it back. What it destroys is often unrecoverable for the
  same reason: a clip copied while ConnectSuite was backgrounded was never read, so it is not in the
  phone's history either.

**The phone will not replace a clipboard it cannot tell you it replaced.** Auto-apply has no undo —
that is the whole of the paragraph above — and the notification is the entire compensation for it. So
deliverability is a **precondition of the write**, checked before it, not a courtesy attempted after:
if `POST_NOTIFICATIONS` is not granted, or notifications for the app are switched off in Settings,
an arriving entry is **kept in the history and not applied and not offered**, whatever the setting
says. Both conditions are checked, because the second can be turned off without any permission dialog
ever appearing.

This was measured rather than reasoned into existence: on the development handset
`POST_NOTIFICATIONS` was `granted=false` with auto-apply **on**, and seven entries were written to
that phone's clipboard with nothing shown to its owner (`docs/testing.md` → Phase 6 Slice 7). The
code had a comment arguing the opposite — that an unreportable *apply* was a smaller problem than an
*offer* nobody could reach — which is backwards: an offer nobody reaches changes nothing on the
device, and an unreportable apply destroys a clip the phone cannot read back, cannot keep and cannot
restore.

**The `clip.push` ack therefore says what the receiver did, not merely that it heard.**

```json
{"applied": false, "arrival": "KEEP_ONLY",
 "reason": "the phone has not been given permission to show notifications, so it cannot tell its owner what arrived"}
```

- **`applied`** — whether the receiver's own clipboard was written. Always present.
- **`arrival`** — `APPLY`, `OFFER` or `KEEP_ONLY`. `OFFER` means a notification is on screen and the
  owner has not tapped it yet; `KEEP_ONLY` means nothing was shown and nothing was written.
- **`reason`** — present only when something could not be delivered, and it is a sentence for a
  person rather than a code. The two causes carry **different sentences**, because a revoked runtime
  grant and a switched-off channel send somebody to different screens.

**A sender must not report `applied: false` as success.** The push succeeded and the entry is in the
receiver's history, so the transfer is not an error — but "sent to phone" is a true sentence about
delivery and a false one about what the person wanted, and this namespace has already been bitten
once by an ack that meant *asked* while its caller read *done*. The Mac surfaces it as a distinct
Activity row on both triggers, the watcher's and the button's.

Same platform question, opposite answers, and the reason is one measurement rather than two
opinions.

### What the Mac's watcher will not send

A watcher sees every copy somebody makes all day, and some of those are passwords. macOS has a
convention for saying so, and **all three of its markers are honoured**:
`org.nspasteboard.ConcealedType`, `org.nspasteboard.TransientType`,
`org.nspasteboard.AutoGeneratedType`. A marked clip is not sent, not entered in the history and not
logged — the same treatment `sensitive` gets from the phone, arrived at from the other end.

**The marker is detected with `has`, never with `read`, and the difference is not a style
preference.** The convention writes the marker as a **present type carrying empty data**, so a value
check returns false for every real password-manager clip ever written. Measured against a pasteboard
built by `NSPasteboard` rather than by Chromium round-tripping its own encoding
(`docs/testing.md` → Slice 13):

| | text | marker | `has(marker)` | `read(marker)` |
|---|---|---|---|---|
| the 1Password shape | present | present | **`true`** | `""` |
| the same text, no marker — the control | present | absent | `false` | `""` |

**The residual risk is stated rather than engineered away.** An app that copies a password and sets
no marker is indistinguishable from one that copies a URL, and nothing on this side can change that.
The rest of the design carries it: the phone holds arriving entries rather than applying them by
default, both histories are memory-only and cleared on disconnect, no clipboard text is logged at
any level, and the watcher has a switch.

### `clip.request` — either side

*Send me what you have now.* Answered with the same body as `clip.push`, or with an explicit empty:

```json
request  {}
ack      {"kind":"empty","atMs":1788246046000}
```

**Three answers, kept apart on purpose**, because collapsing any two of them tells a person something
untrue:

| Situation | Answer |
|---|---|
| There is text and it may be sent | `kind: "text"` with the body above |
| The clipboard holds nothing | ack `kind: "empty"` — a **success**, not an error |
| The clipboard holds something an app flagged sensitive | ack `kind: "sensitive"`, with **no `text`** |
| The phone is not focused, so it may not look | error `PHONE_NOT_FOREGROUND` |

**`sensitive` is not `empty`.** A password manager's clip is *there*; saying the clipboard is empty
would be a Mac telling its user something false about their own phone. `EXTRA_IS_SENSITIVE` is
honoured absolutely: the text is never read into a payload, never entered into a history, and never
logged.

**`PHONE_NOT_FOREGROUND` is not `PERMISSION_DENIED`**, and the distinction is sharper here than
anywhere else in this protocol: **there is no permission to grant.** A `PERMISSION_DENIED` greys the
pane and points a `fixHint` at a Settings screen that cannot help, which is worse than useless — it
sends somebody to look for a switch that does not exist. The Mac's response to this code is one
sentence — *open ConnectSuite on the phone* — and a retry that becomes meaningful the moment they do.

### `clip.history` — either side

The last *n* entries the responder holds, newest first, same body per entry.

```json
request  {"limit":20}
ack      {"entries":[…],"hasMore":true}
```

**No cursor, and that is a decision.** The history is capped at 20 entries and fits one frame; a pager
over 20 rows would be the fourth pager in this repo and the first three each cost a defect (32, 50,
55). `hasMore` exists to say *the cap is doing something* and is never to be paged on.

### The history, and what it is allowed to be

**Memory only, on both sides, and nowhere else.** Not Room, not a file, not `electron-store`. A
clipboard history that survives a reboot is a file full of other people's passwords.

- **20 entries per side**, **64 KB of text each**. Duplicates collapse to the most recent occurrence.
- **Cleared on disconnect** — the rule the contact and thumbnail caches already follow — and gone on
  restart. A restart is a clear.
- **Sensitive entries never enter it.**
- **The 64 KB cap is refused, never truncated.** A silently truncated clipboard entry is a corrupt
  paste with the same *looks complete* symptom as defect 56's truncated push, and the refusal names
  the cap.
- **No clipboard text is logged at any level, on either side.** `LinkLog` writes to a rotating file;
  a handler written the way every other handler in this repo is written would put people's passwords
  on disk. What is logged is `kind`, length, whether the sensitive flag was set, the resolved app
  label, and the counters with their denominators.

**Deleting is local by construction.** No message in this namespace deletes anything on the other
side, so a *Clear* button clears the side it is on and says so. Two things it cannot reach and both
are stated to the user rather than left to be discovered: the OS keeps its own clipboard history
(One UI's, and whatever pasteboard manager a Mac has installed), and an entry already pasted is out.

### The echo

One slot plus two writers is an echo waiting to happen, and auto-apply is what makes it a real
hazard rather than a theoretical one: **before it, a cycle needed a person to press a button once per
hop, which is not a cycle.** The interlock was a nicety and is now the thing the feature rests on.

**The rule is about what to send, not about what to accept: a side never pushes an entry whose text
is identical to the last entry it received.** The receiving side cannot tell an echo from somebody
genuinely copying the same string twice, so the decision has to be made where the knowledge is.

A second rule sits beside it and is **not** the same rule: an *automatic* trigger does not re-send an
unchanged clipboard. It does not stop an echo, and the two are kept apart by name — collapsing them
hides which one is doing the work, which is how a proof of the first can pass over its deletion.

**That second rule stopped being a nicety when the Mac got a watcher.** A button is pressed by a
person and a poll fires twice a second: without the unchanged rule the Mac would re-send the same
clipboard every 500 ms for as long as the app was open. That is not a cycle and no echo rule would
stop it — it is a flood, and it is the failure the button was hiding. So a *trigger* is part of the
send call on both sides: `user` skips the unchanged rule because somebody who presses a button twice
means it, and `automatic` never does.

Both values are written by the receive path and read by the send path, which are two callers — so
their concurrency is stated, not merely their type. A tagged union prevents an ambiguous state; it
does nothing about two callers racing to set an unambiguous one.

**On a link drop, the last-sent value clears and the last-received value does not.** The next Mac may
be a different Mac and should get this phone's clipboard, so clearing last-sent is right. Clearing
last-received opens a one-hop bounce that is not a cycle and is worse than one for being invisible:
the Mac applies X to the phone, the link drops, the phone refocuses and reads X off its own clipboard
with the interlock disarmed, sends X home, and a Mac that auto-applies writes X over whatever the
person copied in the meantime. It terminates, it happens once, and it destroys live work.

**Both ends now send automatically, which removes the premise the first version of this argument
rested on** — *a cycle needs both ends to send on a clipboard change, and the Mac's send is a
button*. The proof did not rest on the button: its peer has always been an adversary that pushes
back everything immediately and forever, which is a maximally auto-sending far side. It was re-run
against the new shape and the interlock holds unchanged.

**No cycle is possible, and it is proven rather than argued.** `desktop/src/shared/clipEcho.test.ts`
and `ClipEchoTest` each drive one real implementation against an **adversarial peer** that pushes
back everything it receives, immediately, forever, and lies about `source` and `atMs` while doing it.
Wiring the two real implementations together would prove only that two copies of one rule agree,
which they will, being copies. The runs converge after exactly one push, the refusal is asserted **by
name** so the wrong guard cannot carry the result, and the harness reports `stopped: 'hop cap'` with
`reportable: false` when it does not converge — an instrument that ends a run must not report its own
ending as the finding.

**The interlock is one slot, and that is a stated limit rather than an oversight.** A local write
moves it — including a Restore — so a clip that arrives, is displaced by a Restore, and is then
copied again *can* travel back. That is **one hop and it terminates**, because the far side's own
interlock refuses to return it. The alternative is remembering every text ever received, which is a
larger store of other people's clipboard content than this feature is willing to hold in exchange
for a saved round trip. It was found by putting the checks in the wrong order in
`scripts/clip-apply-probe.mjs` and is recorded there beside the ordering it needs.

`source` is deliberately **not** load-bearing here. It is a receiver-side field, the interlock is a
sender-side decision, and a peer controls what it claims. The adversarial fixture that rewrites it
exists to keep it that way.

### Images and rich text

**Out of scope in this build, and `kind` is what says so** rather than the field being absent. A
copied image is arbitrarily large, arrives as a `content://` URI whose provider may not outlive the
read, and carrying it means either a size cap that silently truncates somebody's work or a transfer
with a progress UI — which is Files, which exists. A receiver meeting an unknown `kind` from a later
build must show it as unrenderable and keep it, never render it as empty text.

## Photos (42501, with bytes on 42503)

Capability `photos`. Four types, addressing **`MediaStore` ids that are global to the device** — no
root, no path, no grant per folder. The arguments are in `docs/phase-5-fs-media-proposal.md` §5;
this is the contract, and where the two disagree this wins.

**This namespace was named in the message-type list for a full phase and specified nowhere.** It was
found on 2026-09-01 while `fs.thumb` was written deliberately in the shape of a `media.thumb` the
contract did not describe, and `scripts/check-protocol-spec.mjs` exists so that the next one is
caught by the build rather than by somebody noticing.

**`photos` is gated on `{READ_MEDIA_IMAGES, READ_MEDIA_VIDEO}` (API 33+) *or* `{READ_EXTERNAL_STORAGE}`
below it — one alternative granted in full, never a mixture.** Images alone is refused, because
`media.list` returns videos through the same list and a browser with every video silently missing is
worse than one that says it has no permission. Errors report `feature: "photos"`, never `"media"`.

**None of the Files wall applies here.** `MediaStore` is the surface the platform still serves by
query, which is why the photo browser was buildable before a single folder had been granted. The
converse is the part to remember: **`media.*` cannot see a file that is not in `MediaStore`**, and
`fs.*` cannot address one by its `MediaStore` id. The two id spaces are disjoint and nothing bridges
them — see [`fs.thumb`](#fsthumb).

### `media.buckets`

```json
request  {}
ack
{"buckets":[
  {"bucketId":"-1739773001","bucketName":"Camera","count":16369,
   "newestMs":1756298000000,"coverId":"1000012345"},
  {"bucketId":"-1829889111","bucketName":"WhatsApp Images","count":5774,
   "newestMs":1756100000000,"coverId":"1000009912",
   "appName":"WhatsApp","packageName":"com.whatsapp"}]}
```

`bucketId` is the handle and `bucketName` is what a person reads. Where the bucket's relative path
carries a package segment — `Android/media/com.whatsapp/WhatsApp Images` — `packageName` and
`appName` are sent **together**, resolved through `AppLabels.of` including when it fails. Neither
appears without the other, and a bucket whose path holds no package segment carries neither: a rule
that labelled everything would be indistinguishable from one that labelled nothing.

**`count` is not decoration and must be kept.** It is the denominator `media.list`'s pages have to
sum to, and the only number on this feature that can tell a working pager from one that stalls after
its first page.

**There is no cursor and no `limit`.** A bucket list is bounded by the number of folders on the
device, not by the number of photographs — 149 albums over 35,755 items on the handset this was
measured on. But **the phone reads every visual row to build it**: the count and the cover are
aggregated in memory over one ordered scan, because `MediaStore` strips a `GROUP BY` appended to the
sort order and `QUERY_ARG_SQL_GROUP_BY` is honoured unevenly across OEM providers. So this request
costs time proportional to the *library*, not to the answer, and a Mac must not send it on a timer.

### `media.list`

```json
request  {"bucketId":"-1739773001","limit":200,
          "before":1756298000000,"beforeId":"1000012345"}
ack
{"bucketId":"-1739773001","hasMore":true,
 "items":[
  {"id":"1000012345","kind":"image","mime":"image/jpeg","size":3874112,
   "width":4032,"height":3024,"dateMs":1756298000000,"durationMs":null,
   "ownerPackage":"com.whatsapp","ownerAppName":"WhatsApp"}]}
```

**`bucketId` is optional, and omitting it is a real mode rather than a degenerate one: every bucket,
merged under one ordering.** That is what the Mac's *All photos* view is, and it is why there is no
`media.list` for one bucket and a second type for all of them. The ack echoes `bucketId` only when
the request carried one, so an "all" page cannot be mistaken for a page of a bucket named `null`.

`id` and `coverId` are **strings on the wire** because a `MediaStore` id outruns a JavaScript safe
integer. `kind` is `image` or `video`; `durationMs` is null for an image; `width` and `height` are
null when the provider has not filled them in, which is a real and ordinary state for a file written
by another app.

**`limit` defaults to 200 and is capped at 500**, refused with `BAD_REQUEST` outside 1–500. The cap
is the frame, not the work: `MAX_CONTROL_FRAME` is what an uncapped listing would breach, and a
breached frame closes the socket.

**The cursor is `before` + `beforeId`, ordering `dateMs` descending then `id` descending**, and on
this pager the tiebreak carries the common path rather than an edge case. `MediaStore.DATE_ADDED` is
in **seconds** while every timestamp on this wire is in milliseconds, so converting a cursor back
puts *every row in that whole second* into the tie group — a burst of camera frames or a bulk import
shares a second by construction, not by bad luck. Measured on the handset: 6 of Camera's 32 page
boundaries fell inside a tie group, carrying 10 photographs a bare-millisecond cursor would have
dropped.

**A `before` sent without a `beforeId` is answered, and it is answered lossily.** The phone falls
back to `date_added < s`, which skips the rest of the second the previous page ended in; it logs the
degradation rather than hiding it. That shape exists so an older Mac pages instead of looping
forever, and it is **not** what our own client sends: a Mac echoes back the last item it received,
both fields, untouched. Inventing a cursor or rounding a timestamp here is how a page boundary starts
skipping rows inside a burst.

**A `media.list` with no `before` at all is the diagnostic whose correct answer is *everything*.**
Its pages must sum to the bucket's declared `count`. Zero rows from that request cannot be produced
by a wrong cursor *value*; only by a selection that never ran, which is defect 50's signature. Send
it first, before any tuning.

### `media.thumb`

```json
request  {"ids":["1000012345","1000012399"],"maxEdge":256}
ack
{"thumbs":[
  {"id":"1000012345","mime":"image/jpeg","width":256,"height":192,
   "data":"/9j/4AAQSkZJRgABAQ…"},
  {"id":"1000012399","error":"NOT_FOUND"}]}
```

**Base64 JPEG on the control channel, batched and bounded**, for the reason [`fs.thumb`](#fsthumb)
repeats: a grid needs hundreds of thumbnails within a second of the pane opening, a bulk socket per
tile is absurd, and a bulk socket for the batch is a second transfer state machine serving something
that is not a transfer. A thumbnail is small by construction — a 256 px JPEG is 10–25 KB, about 33 KB
base64 — and one that is not is a bug in thumbnail generation that should be visible as one.

- **`ids` is capped at 32 per request**, refused with `BAD_REQUEST` above it and for an empty array.
  32 × ~33 KB ≈ 1 MB, well inside `MAX_CONTROL_FRAME`. The cap bounds head-of-line blocking on the
  channel that also carries `ping`.
- **`maxEdge` defaults to 256 and is capped at 512**, refused below 32 or above 512. Above 512 it is
  a preview, not a thumbnail, and it belongs on the bulk channel like the original.
- **A per-item `error`, never a failed ack.** One deleted photo in a batch of 32 must not lose the
  other 31. `width` and `height` are the **produced** bitmap's, not the request's — the phone fits
  inside `maxEdge` and preserves the aspect ratio, so a 4:3 photo at `maxEdge: 256` comes back
  256 × 192.

**The per-item errors are `BAD_REQUEST`, `NOT_FOUND` and `NO_THUMBNAIL`** — the same three
`fs.thumb` uses, and deliberately the same words:

| | Means | The sentence it is for |
|---|---|---|
| `BAD_REQUEST` | the id is not a number | the caller asked wrongly — an `fs.*` id, most likely |
| `NOT_FOUND` | **no `MediaStore` row with that id** | *"That photo is no longer on the phone."* |
| `NO_THUMBNAIL` | the row is there; the bytes would not decode | *"This one cannot be previewed"* — the file is still on the phone |

**`NOT_FOUND` used to cover both of the last two, and that was defect 57.** `loadThumbnail` answers
identically whether the row is gone or the row is there over bytes that will not decode, so a
corrupt photo was reported as a deleted one — which is not a smaller version of the truth, it is the
sentence that makes somebody stop looking for a file sitting in front of them. The phone now
distinguishes them with an existence query **on the failure path only**, so the cost is paid per
failed item rather than per item. If that query itself fails the answer is `NOT_FOUND`, because the
honest response to *"we could not establish that the row is there"* is not to claim that it is.

**A receiver must not treat `NO_THUMBNAIL` as a missing item.** Dropping such an id from a cache and
never asking again is right for `NOT_FOUND` and wrong here: the photo exists, it is listable, and
`media.original` may well succeed on it even though no thumbnail can be made.

**Asked for an `fs.*` id, every item comes back `BAD_REQUEST`** — a SAF document id is not a number —
and the Mac's client drops errored ids from the map it returns, which is why the Files pane observed
an empty answer rather than a refusal. The wire says something; the client's map says nothing. Both
are true about different layers, and neither is a reason to teach this type a second id space.

### `media.original`

```json
request  {"id":"1000012345"}
ack      {"transferId":"tf-Q3v9aP0kT7mR2xW8yB4nZc","size":3874112,"mime":"image/jpeg",
          "name":"IMG_2041.jpg","sha256":"9f86d08188…","chunkMax":262144}
```

**This is not a fifth transfer mechanism.** It resolves a `MediaStore` id to a transfer and hands
back a `transferId` that runs on the bulk channel exactly as `fs.transfer.begin`'s does —
`fs.transfer.progress` reports it, `fs.transfer.done` completes it, `fs.transfer.cancel` cancels it,
and `chunkMax` is negotiated in this ack for the same reason it is negotiated there. The only thing
it does that `fs.*` cannot is address a `MediaStore` id.

Deliberately **not** `fs.transfer.begin` with a media id: that would give `begin` two mutually
exclusive addressing modes and an error table that has to explain which fields go together. One
type, one addressing mode, one shared execution.

**`sha256` follows `fs.transfer.begin`'s rule: non-null when the phone pre-hashed, which it does at or
below the 64 MiB ceiling** (changed 2026-09-29; until then it was always `null`). Above the ceiling it is
`null`, because hashing before sending reads the file twice and a 4 GB video would stall this ack for a
full read; the transfer then reports **`verified: false`**, which says plainly that nothing compared the
bytes against a digest agreed in advance. The Mac passes a non-null value to its pull and reports
`verified` from the comparison. **Backward-compatible both ways:** an older Mac ignores the field and an
older phone sends `null` — either way the result is the old `verified: false`, never a false `true`.

### When a photo request cannot be answered

| Cause | `code` |
|---|---|
| The photos permission alternative is not granted in full | `PERMISSION_DENIED`, with a `fixHint` naming the phone's *Photos and videos* toggle |
| The media id no longer exists | `NOT_FOUND` |
| `limit` outside 1–500, `ids` empty or over 32, `maxEdge` outside 32–512, a missing or non-numeric `id`, a control session with no token | `BAD_REQUEST` |

**The permission `fixHint` names the switch, not the permission.** Android 13 splits this into two
grants and shows the user a single *Photos and videos* toggle, so telling somebody to grant
`READ_MEDIA_VIDEO` describes a screen that does not exist on their phone.

There is no `ROOT_NOT_GRANTED` here and there never will be: this namespace has no roots.

## Microphone (42501, with audio on 42504)

Capability `mic`, gated on `RECORD_AUDIO`. **The phone's microphone, heard on the Mac** — the phone
captures, the Mac plays it into a virtual input device so any Mac app can select it.

This namespace did not exist until 2026-09-14. `Capability.MIC` has been in `Messages.kt` and
`protocol.ts` since Phase 4 with **no messages behind it**, and `CapabilityContract.kt` said so in
as many words: *"there is no wire protocol to carry it, so it can never be honestly advertised
until one is designed."* This section is that design.

### Audio is PCM, and that is a decision rather than a default

Frames carry **signed 16-bit little-endian PCM**, 16 kHz mono by default. Not Opus, though this
handset has an encoder for it (`c2.android.opus.encoder`, measured 2026-09-14), and not AAC.

Three reasons, in order of weight:

1. **The Mac's consumer is a realtime audio driver.** The far end of this stream is an
   `AudioServerPlugIn` whose IO callback runs on a realtime thread with a hard deadline. Decoding a
   compressed frame *inside* that callback is the one thing such a thread must not do. PCM straight
   through removes the question.
2. **It is a LAN.** 16 kHz mono S16LE is 32 KB/s — 256 kbit/s. The mirror uses H.264 because video
   is three orders of magnitude larger; audio has no such problem, and paying codec latency to save
   bandwidth nobody is short of is a bad trade.
3. **It deletes a failure class.** There is no encoder, so there is no `ENCODER_FAILED` here, no
   codec-specific config frame, and no second implementation of a decoder on the Mac that can
   disagree with the encoder.

`mic.start` may negotiate `sampleRate` and `channels`; a phone that cannot honour the request says
so in the ack rather than silently resampling, because a silent resample is a difference the Mac
cannot see.

### Why this is a new channel (42504) and not an existing one

This **extends locked architecture decision #2**, which names three ports. It is an addition, not a
contradiction, and the reasoning is written here so it is reviewable rather than assumed.

| Channel | Why the mic does not belong on it |
|---|---|
| **Control (42501)** | JSON. Audio would have to be base64 — a third more bytes, on the channel every other feature's latency depends on |
| **Video (42502)** | Mirror's, and single-purpose. A mic stream must work with mirroring **off** |
| **Bulk (42503)** | Transfer-framed (`transferId`, `offset`, resume). **Its frames must never be dropped**; a live mic's frames must be dropped when late. Putting both on one socket means one of the two policies is wrong for whatever is using it, and a five-minute mic stream would sit in front of a file transfer |

The drop policy is the sharp one. Bulk exists to deliver every byte eventually; audio exists to
deliver the *current* byte or nothing. Those are opposite obligations and they cannot share a
queue.

**Port 42504, and the same authorisation as the others**: the client sends the session token as the
first frame, then reads only.

### The frame

The token frame uses the standard 4-byte length prefix. **Everything after it does not** — audio
frames carry their own 13-byte header, whose length field is the frame's only length. This is
deliberately the same shape as the video channel's header, so one reader implementation serves both.

```
byte  0      flags     bit 0 = discontinuity (first frame of a run, or after a gap)
bytes 1..8   PTS       microseconds, big endian, unsigned
bytes 9..12  length    payload bytes, big endian
bytes 13..   payload   PCM S16LE, interleaved if stereo
```

**PTS is `System.nanoTime()/1000`** — the same monotonic clock as video PTS and as `pong`'s
`monoUs`, which is what lets the Mac place audio against video and against its own clock. A
different clock here would make the number unusable for exactly the thing it exists for.

**A frame is 20 ms of audio** — 320 samples, 640 bytes at 16 kHz mono; 50 frames per second. Short
enough that a dropped frame is inaudible as anything but a click, long enough that per-frame
overhead is under 2%.

**The discontinuity bit is not decoration.** The Mac's driver must insert silence for a gap rather
than butting two runs together, and it cannot infer a gap from PTS alone without assuming the
phone's frame cadence is exact. The phone sets it whenever the previous frame it *sent* is not the
previous frame it *captured*.

Frames are dropped rather than queued when the Mac cannot keep up, for the same reason the video
channel drops them.

### `mic.start`

**Request, Mac → phone.** `{"sampleRate":16000,"channels":1}` — both optional.

The ack carries what the phone will actually send, which may not be what was asked:
`{"sampleRate":16000,"channels":1,"frameMs":20,"format":"s16le"}`. **The Mac configures its device
from the ack, never from its own request.**

Capture starts only after the ack. A phone that cannot start capture answers `error`, not an ack
followed by silence — see the table below.

### `mic.stop`

**Request, Mac → phone.** No payload. Idempotent: stopping a stopped mic is an `ack`, not an error.

The phone also stops on its own when the audio socket closes, because a stream nobody is reading is
a microphone held open for no one — and holding `RECORD_AUDIO` open shows a permanent microphone
indicator in the status bar, which is a privacy claim on the user's screen that must be true.

### `mic.state`

**Event, phone → Mac.** `{"state":"running"|"silenced"|"stopped","reason":"<string>"}`.

Sent on every transition, and replayed on connect when a mic session is live. `reason` is a
user-visible sentence, chosen by the phone, and the Mac shows it verbatim.

`silenced` is the interesting one and it has its own section.

### What happens when another app holds the microphone

**This is the part that would otherwise ship as a silent lie.**

Android 10 and later allow concurrent capture, resolved by priority. When something with a stronger
claim takes the microphone — a phone call, an assistant, a foreground app with a higher-priority
audio source — our `AudioRecord` **is not stopped and does not error. It keeps returning buffers of
zeros.**

So the default behaviour of the obvious implementation is to stream perfect silence, indefinitely,
while every counter on both sides reports a healthy session. On the Mac that is indistinguishable
from a quiet room, which is precisely the lookalike this project keeps writing rules about: a
reading that is confident, specific, and wrong.

**It is detectable, and the detection is the feature.** `AudioManager.registerAudioRecordingCallback`
delivers `AudioRecordingConfiguration.isClientSilenced()` — `since="29"`, which is exactly our
`minSdk`, so there is no fallback path to maintain.

On silencing the phone **stops sending frames** and sends
`mic.state: silenced`. It does not send zeros with a flag, because a frame that arrives is a frame
the Mac's driver will play, and the honest representation of "we are not being given audio" is the
absence of audio plus a sentence saying why.

When the silencing ends the phone sends `mic.state: running`, sets the discontinuity bit on the
next frame, and resumes. Like `SECURE_SURFACE` in mirroring, this is a state that **retracts
itself** rather than ending the session.

**The counters follow this file's denominator rule:** `mic.state: silenced` carries the frames sent
in the run so far, so "silenced after 0 frames" (never worked) is distinguishable from "silenced
after 14,000 frames" (worked, then something took the mic).

### When the microphone cannot be supplied

Every failure is an `error` on the **control** channel with `feature: "mic"`, never silence on
42504.

| Cause | `code` |
|---|---|
| `RECORD_AUDIO` not granted | `PERMISSION_DENIED`, with a `fixHint` naming the phone's *Microphone* toggle |
| Another app holds the mic at `mic.start` time | `MIC_UNAVAILABLE` |
| `AudioRecord` would not initialise | `CAPTURE_FAILED` |
| `AudioRecord` died mid-run | `CAPTURE_FAILED` |
| Audio socket token invalid | `UNAUTHORIZED` |
| `sampleRate` not in 8000–48000, `channels` not 1 or 2 | `BAD_REQUEST` |

**`MIC_UNAVAILABLE` and `silenced` are the same platform condition at two different moments**, and
they are deliberately reported differently: refusing to start is an `error` the Mac shows in place
of the feature, while losing the mic mid-run is a `mic.state` that retracts. Collapsing them would
mean either failing a live session that will recover, or acking a session that never starts.

**There is no `DEVICE_LOCKED` here.** The microphone is readable with the screen off — that is the
whole point of a background capture service — and inventing a lock state we never enter would be an
unreachable state drawn beside reachable ones.

### The Mac's side is not in this contract, and here is the boundary

The wire ends at 42504. What the Mac does with the PCM — an `AudioServerPlugIn` presenting an
input-only device, fed from the main process — is a *local* concern and is specified in
`docs/mac-audio-routes.md`, not here. The rule that matters for this file: **the driver never owns
the socket.** The main process reads 42504 and hands PCM to the driver; a realtime audio callback
does not do networking.

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

### `pair.rejected` — phone to Mac

Sent immediately before the phone closes a connection whose `hello` carried a pair token it would
not accept. The Mac is showing a QR code at that moment and, without this, learns only that a socket
closed — which is indistinguishable from the network dropping.

```json
{"type":"pair.rejected","payload":{
  "reason":"TOKEN_EXPIRED",
  "fingerprint":"AB:CD:EF:01:23:45:67:89",
  "message":"The pairing code expired. Show a fresh one on the Mac and scan it again."}}
```

| `reason` | What happened | What the Mac does |
|---|---|---|
| `TOKEN_EXPIRED` | The QR was scanned, but more than `PAIR_TOKEN_TTL_MS` passed before the Mac connected | Draw a fresh code automatically and say the old one timed out |
| `TOKEN_MISMATCH` | A token was presented and is not the armed one | Draw a fresh code and say the scan did not match — a stale QR was still on screen somewhere |
| `TOKEN_MISSING` | A pairing is armed for this fingerprint and the `hello` carried no token at all | Same as mismatch. Usually an older Mac build |

`fingerprint` is the **connecting Mac's own** fingerprint as the phone computed it, so a Mac can tell
a rejection meant for it from one it is merely observing. `message` is a complete sentence for a
person, and the Mac must prefer its own copy keyed on `reason` — the string is a fallback and a log
line, not the UI.

**This message is only reachable when TLS succeeded**, which means the certificate was already
pinned. A Mac that is not paired at all fails during the handshake and there is no channel to send
anything on; the phone shows *that* case on its own screen instead. The two are different failures
and neither substitutes for the other.

**The Mac must not treat a rejection as a reason to stop retrying.** The user's next action is to
scan the fresh code, and the discovery loop has to be running when they do.

### Pairing intent in the discovery record

`_connectsuite._tcp` carries one further TXT attribute, present **only** between a successful scan
and the pairing completing or expiring:

```
pair=<first 16 lowercase hex characters of the scanned Mac's fingerprint, colons removed>
```

It exists to separate two states that are otherwise one picture on the Mac: *nobody has scanned the
code* and *somebody scanned it and the Mac has not connected yet*. A Mac showing a QR browses for
its own fingerprint prefix in this attribute; finding it proves a scan happened, which is a fact the
Mac has no other way to learn — the phone is the listener, so before it accepts a connection there
is nothing to observe.

**Its absence proves nothing, and the Mac's copy must say so.** mDNS is the third discovery path
precisely because it is the least reliable one: Samsung's hotspot AP drops multicast, some routers
filter it, and a phone on a different network is invisible by construction. So:

- **present** → the Mac may state, as a fact, that the phone scanned the code;
- **absent** → the Mac may say only that it has not seen a scan *yet*, and must offer the same
  network hint the phone offers. It may **never** render absence as "nobody scanned".

This is the asymmetry the pairing screen is built around, and it is deliberate: a positive signal is
trustworthy and a negative one is not. Sixteen hex characters is 64 bits of the fingerprint — ample
to identify which Mac is expected, and not the fingerprint itself, which is pinned rather than
advertised.

## Apps (42501)

**Built 2026-09-03, on the measurement in `docs/phase-7-apps-proposal.md` §2.4 and not on the shape
anybody wanted.** Three verbs: `apps.list`, `apps.icon`, `apps.open.ask`. There is no launch verb in
this namespace and there will not be one — see [The verb that does not exist](#the-verb-that-does-not-exist).

### `apps.list`

**Request** `{}`. No cursor, no limit, and that is a decision rather than an omission — see below.

**Response**

```json
{
  "apps": [
    { "package": "com.instagram.android", "label": "Instagram", "updatedMs": 1756900000000, "versionName": "312.0.0" }
  ],
  "count": 122,
  "total": 122
}
```

`label` is required, always present, and resolved through `AppLabels.of`. Where the lookup fails the
label *is* the package id — that fallback is correct and must not be "fixed" — and the entry then
carries `labelIsFallback: true` so the Mac can draw it in the mono face as the handle it is. This is
`CLAUDE.md`'s package-id rule expressed in the payload: a package id may be a machine handle and may
never be the only thing a person reads.

**`count` and `total` are two different numbers and both are sent.** `count` is what is in this
response; `total` is what the phone enumerated before the 1000-package cap. They are equal in every
real case and they differ visibly if the cap ever bites. A list that silently returns its first
thousand rows is the 200-page probe cap wearing a wire format — the Mac would draw the instrument's
bound and read it as the phone's contents.

**Why there is no pager.** Every other list in this contract pages, and this one does not, because
the source is an in-memory `PackageManager.queryIntentActivities` call rather than a cursor over a
provider: there is nothing to hold a position in, and a second page would re-run the whole query.
More to the point, a pager here could never be *proven*. `CLAUDE.md` requires a pager to be recorded
on consecutive pages counted on hardware, with the boundary count published beside the totals — and
122 entries is one page, so no boundary ever lands anywhere and the run would prove exactly nothing.
The `fs.list` sweep is the worked example: 33 pages, sums reached, `tieBoundaries: 0`, and no
evidence whatever about the tiebreak. A cap with an honest `total` is a bound that reports itself; an
unexercised pager is a bound that does not.

**The set is the launcher set.** `queryIntentActivities(MAIN/LAUNCHER)`, deduplicated to distinct
packages — 122 on the handset this was measured on. The `<queries>` block in
`sync-module/src/main/AndroidManifest.xml` is what makes that visible, and it was measured with its
own control: with the block removed the same query returns **15**. `QUERY_ALL_PACKAGES` is refused on
Play-policy grounds and the launcher set is the right set rather than a lesser one — an app worth
opening from a Mac is an app with a launcher icon, by definition.

**A units warning, because it has already cost a fictional defect.** `adb shell cmd package
query-activities` counts **activities** (244 here); every app-side reading counts **distinct
packages** (122). One package can publish several launcher activities. Comparing the two produces a
45% visibility gap that does not exist.

### `apps.icon`

**Request** `{ packages: [...], maxEdge?: 96 }` — at most **32** packages per request, `maxEdge`
between 24 and 192.

**Response** one entry per package, in request order, each carrying either the image or its own
`error`:

```json
{ "icons": [
  { "package": "com.instagram.android", "mime": "image/png", "width": 96, "height": 96, "data": "iVBOR…" },
  { "package": "com.example.gone", "error": "NOT_FOUND" }
] }
```

The same shape as `media.thumb` and for the same reason: one missing icon must not lose the other 31.
PNG rather than JPEG because launcher icons have transparency and an adaptive icon composited onto an
opaque background is a different picture from the one on the phone's home screen.

### `apps.open.ask`

**Request** `{ package }`. **Response** `{ asked: true }`.

**The ack means the question was asked, and nothing else.** There is no field reporting whether the
app opened, because this phone does not know and will not learn: what opens it is a person tapping a
notification, in their own time, or not at all. A client that wants to display *opened* has to be
told it cannot, and the absence of anywhere to read it from is how it is told.

The phone posts a high-importance notification — *Open Instagram?* — naming the Mac that asked. The
launch happens from that tap, in the user's own hands, which is a foreground activity start and is
permitted. Nothing in this namespace calls `startActivity` from the background.

Errors:

| Code | When |
|---|---|
| `NOT_FOUND` | The package has no launcher activity, or is not installed. The Mac's list is stale; refresh it |
| `NOTIFICATIONS_BLOCKED` | Notifications from ConnectSuite are turned off, so there is nowhere to put the question. **Not** `PERMISSION_DENIED`: the list and the icons still work, and grey­ing the pane would hide a working grid because the thing it opens has no doorbell |
| `BAD_REQUEST` | No `package` in the payload |

### The verb that does not exist

**There is no `apps.launch`, and its absence is enforced rather than intended.**

Both names were written into this contract *before* the measurement ran, deliberately, so that a
refusal could not be absorbed into a verb promising more than the platform allows:

| Type | Would have shipped when | What its ack would have meant |
|---|---|---|
| `apps.launch` | The phone can start an activity while ConnectSuite is backgrounded | **The app came to the front.** A remote control |
| `apps.open.ask` | It cannot | **The phone asked its user.** A notification was posted; a person may tap it, or not |

Measured on the SM-S938B, 2026-09-03, with ConnectSuite backgrounded and the screen on:
`startActivity` for `com.android.settings` **threw nothing, logged nothing, and did not bring the app
to the front** — `dumpsys activity activities` still named the launcher as `topResumedActivity`. That
is the proposal's fourth row, the one outcome every automated check calls a pass and which fails only
in a user's hand.

So `apps.launch` is **not implemented, not advertised, and not defined**. The constant is absent from
`MessageType` rather than present and unregistered, because an unused constant is one autocomplete
away from a handler.

**The name is where the lie would live.** A verb called `apps.launch` whose ack means *asked* invites
the next person to build a remote control on top of it: a grid that dims a tile on click, a retry
when "the launch failed", a queue of pending launches. Every one of those is reasonable against the
name and wrong against the behaviour, and renaming afterwards does not undo it, because by then the
callers exist.

**The enforcement point is `scripts/check-apps-verb.mjs`**, wired to `PreToolUse` on `git commit`. A
rule that only one of two names may ever ship is a rule enforced by someone remembering, and
`CLAUDE.md` is explicit about what that is worth. The guard refuses the wire literal `"apps.launch"`
and any `APPS_LAUNCH` identifier anywhere in shipping source on either side — while leaving *prose*
about it alone, which is the discriminator that keeps it from forbidding the paragraph you are
reading. Its fixtures are in `scripts/check-apps-verb.test.mjs`.

## Device vitals (42501)

Two unsolicited pushes behind the Overview pane's **Device status** card. Neither is a request: the
phone sends them when a session becomes ready and again when the value changes, the same shape as
`remote.state`.

They exist because the card could not honestly be drawn without them. `battery.state` sat in this
document's type list, **specified nowhere and handled on neither side, since Phase 2** — and
`docs/design-departures.md` → O4 refused to draw the card over it: *three rings over three numbers
nobody sends would be the most decorative thing in the app*. That refusal stands and this is what
lifts it.

### `battery.state`

Phone to Mac, unsolicited. Sent on session ready, and on every change the phone observes.

```json
{ "level": 72, "charging": true, "capacityUnknown": false }
```

- `level` — integer 0-100, or **`null`** when the platform reports `BATTERY_PROPERTY_CAPACITY` as
  absent. It is nullable because a device that cannot report it exists, and a `0` in that case would
  be a full-looking empty ring rather than an unknown one.
- `charging` — `true` while plugged in *or* charging wirelessly.
- `capacityUnknown` — `true` when `level` is null, stated as its own field rather than left for the
  reader to infer from a null. **The Mac must draw the two differently**, which is the same rule the
  Files pane's empty-versus-failed separation follows.

### `storage.state`

Phone to Mac, unsolicited. Sent on session ready, and at most once a minute thereafter.

```json
{ "freeBytes": 41231908864, "totalBytes": 511000000000 }
```

Both are of the **shared** volume, not the app's private directory — a person reading "12 GB free"
means their phone, not this app's sandbox. Either may be **`null`** if the platform refuses, and
null is not zero.

**There is no memory ring, and there is not going to be one.** The design draws three; this ships
two. Free RAM on Android is not a fact about a phone that a person can act on — the OS deliberately
fills it, so "1.2 GB free of 12 GB" is alarming and meaningless, and a number that looks like
information and is not is the decoration this project rules out everywhere else. Recorded as a
departure in `docs/design-departures.md` → O4 rather than left as an omission somebody will "fix".

## Extensions (`ext`)

`hello` (Mac → phone) and `hello.ack` (phone → Mac) may each carry one optional field, `ext`: an
object mapping an extension name to the highest version of it that this peer implements.

```json
hello      {"protocolVersion":1, …every existing field…, "ext":{"share.file":1}}
hello.ack  {"protocolVersion":1, …every existing field…, "ext":{"share.file":1}}
```

On `hello`, `share.file` means *this Mac can receive and answer a one-file share offer*; on
`hello.ack`, *this phone can make one*. **The version says how far:** `1` is offer and decline only;
`2` is the one-file transfer as well (see [Share → Version 2](#version-2--the-transfer)). `3`, several pending offers, is **advertised by development builds (the debuggable phone and the unpackaged Mac) and by no release build** until the owner approves it, and the separate `share.stream` for large files is **proposed and not implemented** (see [Version 3](#version-3--several-pending-offers-development-builds-since-2026-09-29-release-gated-on-the-owner)).
Because the negotiated version is `min(mine, theirs)`, a transfer can start only when **both**
peers advertise `2`. Parsing is identical on both sides:

1. `ext` absent, `null`, or not a JSON object → `{}`. Not an error.
2. A key the peer does not recognise → ignored.
3. A value that is not an integer ≥ 1 → that key is absent; the rest of `ext` is still read.
4. An extension is negotiated only when **both** sides advertise it, at `min(mine, theirs)`.
5. The result is fixed for the session and is not changed by `capabilities.changed`.
6. `protocolVersion` keeps its meaning; a major mismatch is refused with `PROTOCOL_MISMATCH` before
   `ext` is read. `ext` never changes the major version.

The cases are `docs/fixtures/ext-negotiation.json`, read by both sides' tests, so the two parsers
cannot drift apart unnoticed.

### The production promise: the `share.ask` extension, separate from the wire version

The `share.file` key says which **messages** a peer implements. It cannot say whether a Mac that implements
version 2 will receive an **ordinary** file, because the only Mac that has ever advertised 2 is the
synthetic-only development receiver, which declines every ordinary offer `not-available` at once. A
phone reading `share.file: 2` therefore cannot tell *"this Mac will ask a person"* from *"this Mac is
a test rig"*. `share.ask` is that distinction, and it is its own key so the answer never has to be
inferred from a version number.

| Side | `share.ask: 1` means |
|---|---|
| `hello` (Mac) | **every** ordinary version-2 offer on this session is held on the card for a person's Accept; nothing accepts it automatically; it is received into the configured receive folder only after the destination check; and this build can clean up its own temporary files in that folder (parent-identity-scoped ledger). A synthetic-only development Mac **never** advertises it |
| `hello.ack` (phone) | this phone makes an **ordinary** share offer — one a person chose in the Android share sheet — **only** on a session where `share.ask` is negotiated and `share.file` is negotiated at 2 |

Negotiation is rule 4, unchanged: present only when both sides advertise it. **The phone's ordinary
Send is enabled exactly when `share.file` = 2 and `share.ask` ≥ 1 are both negotiated on the live
session.** Every other combination — no session, no `ext`, `share.file` 1, `share.file` 2 without
`share.ask`, `share.ask` without `share.file` 2 — leaves Send disabled with a reason, and no offer is
made. The debug synthetic probe does not need `share.ask`; it is not an ordinary share.

**Active since `cb7e982` (Mac) and `cd9d95d` (phone), 2026-09-25.** The Mac's gate
(`shareActivation.ts`, `shareAskActivation`) requires two recorded readiness facts, both now **true**,
and it is closed whenever the development gate is open (the two are mutually exclusive). With
`share.ask` open the receiver's allowlist is **empty** whatever the environment says (`receiverMode`,
`f39f3bd`): every offer waits for a person's click.

1. **the synthetic end-to-end run (slice 3e) has passed on hardware**;
2. **temporary-file cleanup is scoped to the receive folder by parent identity** — the design in
   `docs/phase-7-share-3e-runbook.md` §11, **built in `5e20963` and reviewed 2026-09-25**. Without
   it a production transfer would create partials in the person's folder that no sweep may delete.

Each flips only in the commit that records its evidence. **The phone has a twin fact,**
`Extensions.PRODUCTION_TRANSFER` — whether it advertises `share.file: 2` to every trusted Mac rather
than only to one armed debug handshake. Without it a production Mac still negotiates `min(1, 2) = 1`
and ordinary Send cannot enable. It is **true** since `cd9d95d`, pinned by a test. The phone advertises `share.ask: 1`
unconditionally: the promise is about what the phone will *not* do, so making it costs nothing.
The cases are `docs/fixtures/share-ordinary-send.json`, read by both sides' tests.

### How long a waiting offer lives: the `share.wait` extension (PROPOSED 2026-09-29 — development builds only; release gated on the owner)

**The value is a number of minutes, not a version.** It is the longest a peer will let one share offer
wait for a person's Accept or Decline. Rule 4 is unchanged — negotiated only when both advertise it, at
`min(mine, theirs)` — and for a limit, the minimum of two limits is exactly the agreement wanted.

| Negotiated `share.wait` | A waiting offer lives |
|---|---|
| absent (either side older, or the policy off) | **10 minutes — exactly as before this key existed** |
| any value | `clamp(value, 10, 30)` minutes: never shorter than today, **never longer than 30, never indefinite** |

What changes on each side when it is negotiated at `w` minutes (`W = clamp(w, 10, 30)`):

- **Phone:** `share.offer.expiresAtMs = sent + W`; its own expiry timer, `share.cancel{expired}` at that
  moment and the deletion of the staged copy follow unchanged. A caller may shorten `W`, never lengthen it.
- **Mac:** an offer is valid only if `expiresAtMs ∈ (now, now + W + 5 min skew]`; the Mac's own expiry is
  `min(expiresAtMs, received + W)`. With `share.wait` absent, `W = 10`, so a 30-minute offer from a
  mis-built phone is refused `malformed-offer` (*expiresAtMs is too far ahead*) — **it fails closed**.
- **Both, visibly:** a waiting card says *"Waits for your answer until HH:MM. After that it expires and
  nothing is saved."* (Mac) and *"… if nobody does by HH:MM, the offer expires and its prepared copy is
  deleted."* (phone). A clock time, not a countdown: a card is redrawn only when its offer changes, and a
  countdown would go stale.

**What it does not change:** per-file consent; nothing moves before Accept; the phone's per-copy staging
budget (a waiting offer still holds its staged copy for its whole wait); cleanup on expiry, decline,
cancel, disconnect and restart; an **accepted** offer's separate queue lifetime (Version 3 §3, 60
minutes, provisional); `share.file` negotiation. An offer already expired is never extended — the wait is
fixed when the offer is made.

**Who advertises it:** `share.wait: 30` is sent only beside a transfer — by the Mac only beside
`share.ask` — and only by a **debuggable phone** (not while `holdV2` reproduces an older phone) or an
**unpackaged Mac**. A release build advertises it only once the owner flips
`Extensions.WAIT_RELEASE` (phone) and `SHARE_WAIT_RELEASE` (Mac); both are `false`.

The cases are `docs/fixtures/share-wait.json`, read by both sides' tests (`ShareWaitTest`,
`shareWait.test.ts`).

## Share (42501)

One file from the phone's share sheet to the Mac. The phone offers; the Mac answers; nothing moves
before the Mac answers.

**Both versions are implemented.** Version 1 is offer, decline and cancel, with no transfer: a Mac of
version 1 validates each offer and declines it with `not-available` — a protocol stub, not a person's
decision, and a phone must never render it as one. **Version 2, the transfer, is implemented on both
sides and advertised by both** (phone `cd9d95d`, Mac `cb7e982`), after the synthetic end-to-end run
passed on hardware (`docs/testing.md` → slice 3e).

The capability is `share` (prefix and name agree). At version 1 its contract is the two requests the
phone handles, `share.respond` and `share.cancel`; version 2 adds `share.saved` and a served bulk
channel. The design and its evidence are `docs/phase-7-share-proposal.md` rev 2 and
`docs/phase-7-share-plan.md`, and the slice 3 review findings F1–F10 are recorded in
`docs/testing.md` → *Feature A slice 3 review*.

### `share.offer` — event, phone → Mac

```json
{"offerId":"s-Q3v9aP0kT7mR2xW8yB4nZc","rootId":"share:s-Q3v9aP0kT7mR2xW8yB4nZc",
 "from":"Galaxy S25 Ultra",
 "item":{"itemId":"0","name":"IMG_2041.jpg","mime":"image/jpeg","size":3874112,
         "sha256":"97b1c8f2…(64 lowercase hex)"},
 "expiresAtMs":1790000600000}
```

| Field | Rule |
|---|---|
| `offerId` | `s-` + 22 base64url characters (128 random bits). Never reused |
| `rootId` | exactly `share:` + `offerId` |
| `from` | the phone's device name, 1–128 characters |
| `item` | one object, never an array: `itemId` is `"0"`; `name` is 1–255 UTF-8 bytes; `mime` is `type/subtype`, ≤ 127 characters; `size` is an integer 0 … 2^53−1, the exact byte count of the phone's private copy; `sha256` is 64 lowercase hex of that copy |
| `expiresAtMs` | when the phone stops honouring the offer: sent + 10 minutes |

**Only sent when `share.file` is negotiated on that session, and at most one offer per session is
live.** (At version 3, at most 10 — PROVISIONAL; see Version 3.) The file is already staged privately on the phone; the offer never refers to anything else.

**The Mac validates before anything else**, in this order, and declines with the first failure:
`not-negotiated` (no `share.file` on this session); `malformed-offer` (any field above out of
rule, `rootId` ≠ `share:` + `offerId`, or `expiresAtMs` not in (now, now + 15 min] by the Mac's
clock — 10 minutes plus 5 of clock skew); `busy` (another offer from this session is still live).
A second offer carrying an `offerId` already seen in this run of the Mac is a **replay**: it is
logged and **not answered** — the first was answered once, and a second answer would contradict
it. The Mac's own expiry for an offer is `min(expiresAtMs, received + 10 min)`.

### `share.respond` — request, Mac → phone

```json
request  {"offerId":"s-…","decision":"decline","reason":"not-available"}
ack      {"offerId":"s-…","state":"declined"}
```

`reason` is one of `not-available`, `not-negotiated`, `malformed-offer`, `busy`, `user`,
`folder-unavailable`, `insufficient-space`, `unsupported-destination`. A version-1 Mac sends only the
first four; the rest belong to version 2 (a person's decision, and the destination checks). **There is no `expired`
decline**: an offer nobody answered *expires* (`share.cancel`), and is never shown as declined.

`decision: "accept"` is valid only when `share.file` is negotiated at **2**. At version 1 a phone
answers it with `BAD_REQUEST` (`feature: "share"`, *"this phone cannot send files yet"*), and the offer
stays live until it is declined, cancelled or expires; a Mac must not send it at version 1. The
version-2 accept is described under [Version 2](#version-2--the-transfer).

Errors, all with `feature: "share"`: `NOT_FOUND` for an unknown `offerId`, an offer made on a
different session, or one already answered, cancelled or expired — indistinguishable on purpose, so
one session cannot probe another's offers; `BAD_REQUEST` for a missing or malformed field, an
unknown `decision`, or an unknown `reason`. **An offer is answered once.**

### `share.cancel` — either side

```json
phone → Mac, event    {"offerId":"s-…","reason":"user" | "expired" | "staging-lost"}
Mac → phone, request  {"offerId":"s-…","reason":"user"}
ack                   {"offerId":"s-…","stopped":true}
```

The phone sends `expired` itself at `expiresAtMs` if the offer is still live. The Mac sends the
request when a person presses **Cancel** (a starting or running transfer) or **Give up** (a failed
attempt waiting for a Retry) in the receive window (since 2026-09-25); the phone handles it in every
live state, with the same `NOT_FOUND` rules as `share.respond`. A published offer is never cancelled.

The phone sends `staging-lost` when the copy it prepared for the offer is gone or is no longer the
offered length (Android may clear an app's cache at any time): when a pull begins (the
`fs.transfer.begin` is answered `NOT_FOUND`), when the copy changes under the read (its digest is
checked as it streams), **when an Accept arrives** (the `share.respond` is answered `NOT_FOUND`, never
`accepted`, so nothing is pulled), and **while the offer waits** — offered, accepted and queued, or
failed inside its Retry window — on a periodic look at the held copy. The event and a `NOT_FOUND`
reply may reach the Mac in either order; the offer ends the same way. It is the phone losing its copy,
not anyone cancelling, and a Mac says so rather than "Cancelled". A `staging-lost` offer is never
saved: nothing can pull it, and no `share.saved` is accepted for it.

### What is left behind

Every end of an offer — declined, expired, cancelled by either side, or the session ending — deletes
the phone's staged copy. At version 1 there is no retry, so nothing is retained after an offer ends.
An offer does not survive its session: on a disconnect both sides drop it without a message.

### Old peers

| Pair | What happens |
|---|---|
| New phone, old Mac (no `ext` in `hello`) | `share.file` is not negotiated, so the phone sends no offer and says so. It never waits for an answer that cannot come |
| Old phone, new Mac | no `ext` in `hello.ack`, so no offers arrive; an offer that did arrive would be declined `not-negotiated` |
| Both at version 1 (implemented) | `share.file` = 1: offer, `not-available` decline, cancel. No transfer |
| One at 1, one at 2 | negotiated `1`. The version-2 peer behaves as version 1: the Mac never sends `accept` and the phone refuses one. **No transfer starts** |
| Both at 2 | negotiated `2`: the transfer below |
| Both at 2, Mac without `share.ask` (the synthetic-only development receiver) | the phone's **ordinary** Send stays disabled — it would be declined `not-available` at once. Only the debug synthetic probe offers |
| Both at 2 and both advertise `share.ask` (this build, both sides) | ordinary Send enabled; every ordinary offer waits for a person's Accept on the Mac's card |
| A phone with no `share.ask` (older build), Mac with it | not negotiated: that phone makes no ordinary offer. The Mac would ask a person regardless — its promise does not depend on the phone's |
| Both new, and the Mac never answers | the phone's offer expires at `expiresAtMs`: it sends `share.cancel{expired}` and deletes the staged copy. Nothing waits indefinitely |

### Version 2 — the transfer

Everything in this section applies only when `share.file` is negotiated at **2**. Both halves are
built (the phone in slice 3c, the Mac in 3d), the synthetic end-to-end run passed on the SM-S938B on
2026-09-25 (0 B and 4 KiB saved and verified, an unlisted 100 KB offer refused), and **both ends
advertise 2** — the phone to every trusted Mac, the Mac with `share.ask` (production, Ask) or, in a
development run with all three switches, synthetic-only.

**Ask by default, on the Mac.** A valid version-2 offer is held for a person's decision; nothing
accepts an ordinary offer. The one non-human accept is the development switch `shareAcceptProbe`. It
accepts an offer only if its **SHA-256 is on an allowlist the tester supplies**
(`CONNECTSUITE_SHARE_ACCEPT_SHA256`, the digests of the probe's seeded synthetic bytes) **and** it
carries the probe's name (`sidekick-offer-probe-<n>.bin`) and type (`application/octet-stream`). The
name and type are chosen by the sender and prove nothing on their own. An empty list accepts nothing.
The switch defaults off and is forced off in a packaged build. For synthetic tests the development switch
`shareDevReceive` receives into `<userData>/dev-share-receive/` instead of the configured folder; it
too is forced off in a packaged build.

**The Mac advertises `share.file: 2` only through one fail-closed gate** (`shareActivation.ts`): a
development build, the `shareV2` switch, **and** `shareAcceptProbe` with at least one allow-listed
digest, **and** `shareDevReceive`. Any one missing — or a packaged build — leaves the advertisement
at 1. While the gate is open the Mac is **synthetic-only**: an offer that is not an allow-listed
probe is declined `not-available` at once and never held for a decision. A receiver that finds 2
negotiated without the gate answers as version 1. The scratch folder must be a real directory (not a
link) whose real path is `<real userData>/dev-share-receive`; it is created, owner-only, at the first
version-2 offer and never before, and there is no fallback to the configured folder or Downloads. It was written from a read of the committed code (the slice 3 review), and three of
that review's findings are facts about the *existing* bulk path that this contract must not inherit
(F1, F3, F4 below).

**The phone's twin gate** (`core/.../link/ShareDevGate.kt`, `Extensions.handshake`) advertises
`share.file: 2` only in a **debuggable** build **and** only for the one trusted handshake after the
debug-manifest-only, `DUMP`-gated `ShareDevV2Activity` armed it. The arm is in memory, is consumed
by that handshake (after the pairing check, so a refused Mac cannot use it), and is gone after any
restart; every other case — including an old Mac with no `ext` — advertises 1. The phone logs, per
session, what it advertised, whether the arm applied, what the Mac advertised and what was negotiated
(version numbers and two booleans; no token, name or path).

#### Accept

```json
request  {"offerId":"s-…","decision":"accept"}
ack      {"offerId":"s-…","state":"accepted"}
```

**Accept is a person's decision on the Mac.** There is no automatic acceptance in any build that ships.
The only non-human accept permitted is a development-build switch that accepts **synthetic probe
offers only**; it defaults off and is ignored by packaged builds. Before sending `accept`, the Mac
checks that its receive folder is available and that its free space is at least
`size + max(256 MiB, ⌈size / 10⌉)`. If not, it declines with `folder-unavailable` or
`insufficient-space` instead, and it makes the same check when the offer arrives.

**The Mac's receive window** (`main/shareWindow.ts`, `renderer/shareWindow.ts`; revised 2026-09-25,
`docs/feature-a-receive-window.md`) is a small Sidekick-owned utility window that appears **without
taking focus** (`showInactive`, normal window level, never on all Spaces) when an offer arrives,
whether or not the main window is open. It shows the paired phone's name **from the Mac's pairing
record** (the offer's `from` only as a note when it differs), the sanitised file name, the type, the
exact byte count and the destination folder, with **Decline** and **Accept** — and a type glyph, never
a preview, because nothing of the file exists on the Mac before Accept. The page may send back only
an `offerId` and `accept` | `decline`; any other field refuses the request whole, and the folder, the
checks and the session are looked up in the main process. An Accept is honoured only from that
window, only while it is visible, not minimised and focused (a first click on the inactive window
only focuses it) — otherwise it is refused and the offer keeps waiting; Decline is always honoured.
**It is the only decision surface**: the main window's card shows status and a *Show* button, and
`share-decide` from any other page is refused. **Closing the window is not declining** — the offer
keeps waiting and expires honestly. There is still no macOS notification and no Dock bounce. A
refusal by the destination checks is recorded as `refused` with its reason and shown, never as
declined. The window says "Saved" only after the Mac published a verified file, and "Expired" never
reads as declined.

**The destination check, before any byte moves.** When the offer arrives, and again at Accept, the
Mac establishes that its receive folder can make the exclusive save described below. It creates a
uniquely named, Sidekick-owned empty file (`.sidekick-link-probe-<random>`) directly in the folder,
hard-links it to a second unique name, then deletes both, and **only a completed link counts as
support**:

| What happened | Answer |
|---|---|
| the link succeeded, and both probe files were deleted | supported: the offer may proceed |
| the link failed with `EXDEV`, `ENOTSUP`, `EPERM` or `ENOSYS` | decline `unsupported-destination` |
| the probe file could not be created, or the result was anything else (`EACCES`, `ENOSPC`, a timeout, an unexpected error) | decline `folder-unavailable` — **the check could not establish support, so it fails safe** and says so in the Mac's log with the error |
| a probe file could not be deleted afterwards | decline `folder-unavailable`, and log the probe's name so the person can remove it; the leftover is an empty file with Sidekick's prefix |

**The check is not a substitute for the exclusive save.** A folder can change between the check and
the save (a drive swapped, permissions changed), so the save itself still publishes by hard link and
still refuses with `unsupported-destination` if the link fails there.

#### The share root

A `share:<offerId>` root permits **exactly one operation**: `fs.transfer.begin` with
`direction: "pull"`, `rootId` = `share:<offerId>`, and `id: "0"`, on **the session the offer was made
on**, while the offer is `accepted` (or failed with its retry window open) and not expired. The ack
always carries `"offset": 0`. Every other use answers `NOT_FOUND` with `feature: "share"`, never
`ROOT_NOT_GRANTED` (review F7):

- `fs.list`, `fs.stat`, `fs.thumb`, `fs.mkdir`, `fs.delete`, and a push `fs.transfer.begin`;
- a pull with any `id` other than `"0"`;
- a pull before `accept`, after a decline, expiry or cancel, or while another pull of it is live;
- any request about the root from a session other than the offer's;
- `fs.transfer.cancel` for a share transfer from a session other than its own.

#### The bulk socket is bound to the session

For a share pull, the phone refuses — closing the socket with a logged reason — a bulk connection
whose token resolves to **a different session** from the one that began the pull, and a header whose
`offset` is not `0` — in both cases **without consuming the pending pull**, so a wrong claim cannot
take the rightful session's transfer away. The share `transferId` is `ts-` + 22 base64url
characters (128 random bits); a `fs.transfer.cancel` naming one is answered by Share, and only for
its own session. **The existing Files and Photos pulls
do not bind the session and use predictable ids** (review F1, F2; defect 148). The share pull adds
the binding itself rather than relying on a rule the code does not have.

#### What the phone streams, and what its `done` means

The phone streams **the staged private copy only** — never the shared URI. It digests while it sends;
if that digest differs from the offer's `sha256`, the copy changed after it was offered: the phone
sends `fs.transfer.done {ok:false, code:"CHECKSUM_MISMATCH"}` and `share.cancel{staging-lost}`, and
deletes it.

**The phone's `fs.transfer.done {ok:true}` is the sender's verdict only** — every byte was read and
sent. It is not a save, and nothing may present it as one.

#### The Mac's receive

The Mac writes to **its own partial**, `.<offerId>.sidekick-share.part`, in the receive folder. Share
never uses `<name>.part`, because the existing pull deletes an unrecorded `<name>.part` it does not
own (review F4; defect 151). It then checks, in order:

1. no 30 seconds pass without a byte (else `interrupted`);
2. `received === size` (else `truncated`);
3. the SHA-256 of what arrived equals the offer's `sha256` (else `checksum`).

**Publication is exclusive at the moment of saving.** The final name is chosen with the usual
`name (2).ext` rule, and the partial is published with a **hard link** to that name, which fails if
anything already exists there, and then the partial is unlinked. On `EEXIST` the Mac chooses the next
free name and tries again, at most 20 times. **If the receive folder's filesystem cannot make a hard
link** (`EXDEV`, `ENOTSUP`, `EPERM` — an exFAT drive, some network shares), **the save is refused**
with `unsupported-destination`. There is no placeholder-then-rename fallback and no overwrite. The
existing Files and Photos pulls publish with `rename`, which replaces a file that appeared after the
name was chosen (review F3; defect 150). Share does not.

**Progress is the receiver's own count.** The receive window shows the bytes this Mac has received
and handed to its partial (no wire message carries progress, and none is needed). It never reads 100%
before the file is saved: all bytes in reads *checking before saving*, and "Saved" waits for the
length, the digest and the exclusive publication. A thumbnail is drawn only of the published file,
made on the Mac by QuickLook from the local file; **Open** and **Show in Finder** act only on the
path the Mac recorded at publication, after re-checking it is still that file (same device, inode and
size, not a link). The page never sends or receives a path.

On any failure the Mac deletes its partial. **Share writes no `.failed` sidecar** (review F5); the
failure is reported in `share.saved` and on the Mac's own screen.

**A file name is never proof of ownership.** Each attempt's partial is
`.<offerId>.<nonce>.sidekick-share.part`, with a fresh 128-bit nonce, and it is created exclusively:
if **anything** already exists at that path, the pull is refused and that file is left untouched. The
Mac keeps a private **ownership ledger** in its own data folder, which records each temporary file it
creates (partials and destination-probe files) before creation, and then the file's device and
inode, birth time and the most bytes it may hold — and, recorded before the file is created, its
**parent folder's identity** (real path, device, inode, birth time; a parent that is a symlink records
none). The startup sweep lists no folder, and is **scoped**: it may delete only in the folders it is
given, which is the scratch folder while the development gate is open and **nothing at all** otherwise
— and, **only when `share.ask` is active**, in a folder an entry *proves*: its parent path is still a
real folder (not a link) with the recorded real path, device, inode and birth time. The receive-folder
setting is never consulted, so changing it, replacing the folder, or mounting another volume at the
same path widens nothing; a folder that cannot be proven is kept in the ledger and reported. For each ledger entry it deletes the file only if the path is
clean (absolute, no `..`), its parent is exactly an allowed folder that is itself a real directory
with an unchanged real path, its name is one of Sidekick's two temporary shapes, `lstat` finds a
regular file whose device, inode and birth time match and whose size is within the recorded bound,
and the file opened with `O_NOFOLLOW` is still that device and inode. Otherwise it deletes nothing,
leaves the file, and logs the path and the check that failed. A lookalike name, a replaced file, a
symlink, a folder, or anything outside the scope is never deleted. Device and inode can be reused
after a file is deleted by someone else; birth time and size make a false match less likely and are
not a guarantee — which is why scope and name are checked as well.

**Nothing is saved before it is on disk and checked.** The partial is flushed (a write error is a
failed save), its on-disk length must equal the bytes received, the length must equal the offer's
size, the SHA-256 must equal the offer's digest, and a cancel that arrived while flushing or
verifying stops it — all before the exclusive publication. A cancel that arrives *during* publication
cannot unpublish the file: the Mac records it as saved but unacknowledged and sends no verdict for an
offer the phone has cancelled.

**What those words mean, exactly, as built (stated 2026-09-25; nothing about the behaviour changed):**

- **"Flushed"** means the partial's Node write stream finished — `Writable.end()` returned with no
  error — so every byte had been handed to the operating system. **No `fsync` is called anywhere on
  this path.** "On disk" in the sentence above therefore means *in the operating system's file cache*,
  and the save is **not proven to survive a power loss or a kernel panic**.
- **"The SHA-256 must equal the offer's digest"** is computed over the bytes **as they arrived** from
  the socket, before they were written. What was written is checked by **length only** (`stat` equals
  bytes received). The file is not read back from disk.
- **"Exclusive publication"** is a hard link to a name that did not exist (`link` refuses an existing
  name), then removal of the partial's name.
- **Therefore `share.saved {ok:true}` from a Mac of this build promises:** every offered byte arrived,
  their SHA-256 matched the offer, the file's length on disk matched, and the file became visible under
  a name that replaced nothing. **It does not promise the file will survive a power loss.**

Any later strengthening of this promise (for example `fsync` before the link) is a change to the
Mac's preconditions, not to the message. It has to be written here with its date. A phone cannot tell
which promise a given Mac build made, so the phone's copy must never claim more than the weakest one.

If the phone does not acknowledge a `share.saved {ok:true}`, the file is still on the Mac, verified and
published; the Mac records the offer as saved **but unacknowledged** and does not present it as
confirmed by the phone.

#### `share.saved` — request, Mac → phone

```json
request  {"offerId":"s-…","ok":true,"bytes":3874112,"verified":true,"savedAs":"IMG_2041 (2).jpg"}
request  {"offerId":"s-…","ok":false,"reason":"checksum"}
ack      {"offerId":"s-…","state":"saved"}          // or "failed"
```

This is **the receiver's verdict, and the only thing that makes the phone say "Saved"**. `savedAs` is a
file name only, never a path. `reason` is one of `checksum`, `truncated`, `interrupted`,
`insufficient-space`, `write-failed`, `unsupported-destination`. Errors follow `share.respond`'s rules
(`NOT_FOUND` and `BAD_REQUEST`, `feature: "share"`), and it is answered once per attempt.

**No false "Saved":** if the phone has finished sending and no `share.saved` arrives within **60
seconds**, or the session ends first, the offer becomes failed (`unconfirmed`) — never saved.

#### Saved on the Mac, verdict not acknowledged

The Mac can publish a verified file and then not hear the phone acknowledge `share.saved {ok:true}`
(the request timed out, the phone had already passed its 60-second deadline and answered
`NOT_FOUND`, or the link dropped). **Then the two sides hold two different, honest facts**, and
neither may be rounded into the other:

| | The Mac | The phone |
|---|---|---|
| state | `saved-unacknowledged` | failed (`unconfirmed`) |
| says | *"Saved on this Mac; confirmation to phone unknown"* — never an unqualified two-sided success | that the Mac did not confirm, and **may** have kept the file — never "Saved", and never a plain send failure |
| the file | kept. A lost acknowledgement is never a reason to delete a verified, published file | its staged copy follows the Retry window as usual |

- **A verdict that arrives after the phone's deadline does not revive the offer.** It is answered
  `NOT_FOUND`, the phone stays `unconfirmed`, and the Mac records `saved-unacknowledged`.
- **The Mac never retries an offer it has published.** A published offer is `saved` or
  `saved-unacknowledged`, never failed, so there is nothing to retry — and the Mac refuses a Retry
  for it outright as well, because a second pull would write a second copy. The phone's open Retry
  window after `unconfirmed` is therefore used only when the Mac had *not* published (its own
  `ok:false` was the verdict that was lost).
- **A duplicate can still arise** if the person shares the same file again as a new offer. It is
  published under the usual collision-safe name (`name (2).ext`), never over the first copy, and the
  Mac shows **before Accept** that a file with the same SHA-256 was already saved in this run, naming
  it and whether the phone ever confirmed it. That memory is the Mac's, in-process only, like the
  offers.

No wire message changes: this section states what each side does with the messages above.

#### Retry, and what is kept

After `share.saved {ok:false}` (any reason but `staging-lost`), the phone keeps its staged copy for a
**Retry window** of `min(failedAt + 5 min, expiresAtMs)`. During it the Mac may send a new
`fs.transfer.begin` for the same root, which starts again **from byte 0**; there is no resume. When
the window closes the offer expires: `share.cancel{expired}`, and the staged copy is deleted. `saved`,
a decline, an expiry, a cancel from either side, a closed window, and the session ending each delete
the staged copy. A Retry in a shipping build is a person's action on the Mac.

#### Cancel during a transfer

`share.cancel` from either side stops a live pull: the phone stops streaming and deletes the staged
copy, and the Mac deletes its partial. Neither side reports `saved`.

### Version 3 — several pending offers (development builds since 2026-09-29; release gated on the owner)

> **Advertised by development builds; not approved for release.** The argument is
> `docs/feature-a-multi-offer-proposal.md` (**rev 4, 2026-09-26**). Since 2026-09-29 the debuggable phone and
> the unpackaged Mac advertise `share.file 3` on every handshake (below), so the builds the owner runs are
> the builds under test. **A release phone and a packaged Mac advertise 2** until the owner flips one
> release-policy switch on each side, and with them approves the values marked **PROVISIONAL** below —
> none of which is approved for production (owner, 2026-09-26). This section is **Path S** — files copied privately before they are
> offered. Large files are **Path L**, below.

**Negotiation.** `share.file: 3` by the existing rule `min(mine, theirs)`: 3 + 3 → 3, 3 + 2 → 2; a
version-2 peer keeps version 2 exactly. `share.ask` is unchanged and still required for ordinary Send.
Every version-2 rule holds at 3 except these.

- **Several files at once need 3.** At a negotiated 2, the phone refuses a selection of more than one
  file before reading or copying anything, and says the Mac needs updating.
- **One file is never a selection.** A `SEND_MULTIPLE` carrying one file is a single-file share, under
  the version-2 rules, at any version.
- **Who advertises 3 (since 2026-09-29).** One rule per side, each with one release-policy switch that is
  **off**:
  - The **phone** advertises 3 when the version-2 transfer is on **and** `Extensions.multiFile(debuggable)`
    holds — every debuggable build, and a release build only once `Extensions.MULTI_FILE_RELEASE` is
    flipped. The same switch is the manifest's `@bool/share_many_enabled`, which lists the multi-select
    screen in the share sheet; a test holds the two equal. A debuggable phone can be **held at 2** for one
    handshake (a debug-source-set activity behind `android.permission.DUMP`, in memory, consumed by that
    handshake) to reproduce a version-2 phone; the hold can only lower the version.
  - The **Mac** advertises 3 when `share.ask` is active with the synthetic-only gate closed — so every
    offer is still held for a person — **and** it is not packaged, or `SHARE_V3_RELEASE` is flipped. An
    unpackaged Mac can be held at 2 with the `shareV3Off` debug switch
    (`CONNECTSUITE_DEBUG_SWITCHES=shareV3Off`) to reproduce a version-2 Mac.
  - Both sides log the advertised and negotiated `share.file` on every handshake, and why.

**1 · Several live offers.** At most **10** live offers per session (proposed), enforced by both sides;
`busy` means *the session already holds 10*. The phone checks its own count before it offers; a `busy`
decline of a file from a selection sends that file back to *waiting for room* (rule 5), under the same
cap. Each offer is independent: its own `offerId`, answer, expiry and end. `item` stays **one object**.
**Every offer is decided on its own**: there is no group Accept or Decline, and deciding one offer
changes no other offer.

**2 · One pull at a time, in Accept order.** The Mac pulls one share per session at a time, in the order
its offers were **accepted**. An accepted offer waiting its turn is **queued** on the Mac and `accepted` on
the phone. A second concurrent share pull on one session is refused by the phone (`BAD_REQUEST`,
`feature: "share"`).

**3 · Accepted offers leave the 10-minute TTL.** A waiting offer expires at `expiresAtMs` exactly as in
version 2. **A queued offer does not expire while queued**: it ends only by `share.cancel` from either
side, the session ending, or the phone's backstop — an accepted offer whose pull has not begun **60
minutes** (PROVISIONAL, development only; the production value is open) after the Accept is ended by
the phone with `share.cancel{expired}`. A Retry is queued at the back.

**4 · Space.** *Phone:* a file is admitted when its private copy is **about to start**, not when it is
offered. `Σ` is the total of copies already held for live offers; those bytes are already absent from
`free` and are never subtracted again. A copy leaves `Σ` when its offer ends, in any state.

- **A file alone (`Σ = 0`):** the version-2 rule, **unchanged**: `s + max(256 MiB, ⌈s/10⌉) ≤ free`. No
  reading below applies to it.
- **An extra file (`Σ > 0`):** it may be copied only up to `min(Bq, Bs)`, from readings at most **5 s**
  old (PROVISIONAL) taken immediately before the copy, and re-checked while it runs and when it
  finishes:
  - `Bq = ⌊Q · ½⌋ − N − Σ − w`, where `Q` is `StorageManager.getCacheQuotaBytes`, `N` is the rest of
    this app's cache, and `w` is what this copy has already written;
  - `Bs` = the largest `x` with `x + max(256 MiB, ⌈(Σ + w + x)/10⌉) ≤ usable − (⌈3% · total⌉ + 1 GiB)`.
  - ½, 3% + 1 GiB and 5 s are **PROVISIONAL**.
  - A missing, stale or impossible reading refuses **only the extra copy**. In a selection the file
    waits for room (rule 5).
- **From the single-file sheet, an extra copy is refused, never left waiting** (owner, 2026-09-26).
  When `Σ > 0` and the budget refuses it, or a reading is missing or stale, the sheet copies and offers
  nothing and states the refusal with the **measured** `min(Bq, Bs)` (or that no measurement was
  possible). It offers a **Try again** that the person taps, which re-runs this rule with fresh readings
  while the sheet is open. With `Σ = 0` the sheet is version 2, unchanged. No message is sent for a
  refused attempt.
- **`Q` is not a guarantee.** It is the size above which the platform clears this app's cache first —
  read live, different per device and per day, and **not** a promise that a copy below it survives. A
  copy the platform removes ends that offer alone, as `staging-lost` (see `share.cancel`).
- **There is no fixed cap and no per-file size limit** in this contract.

*Mac:* at the offer and at Accept, `free ≥ R + size + max(256 MiB, ⌈size/10⌉)`, where `R` sums the
reservations: a queued offer reserves `size`; the receiving offer reserves `size − bytes written`; every
reservation is released when its offer ends in any state, including saved (its bytes are then a real
file). A Retry re-reserves through the Accept check.

**5 · A selection (Stage B): phone behaviour; no new message.** Argued in the proposal, §11–§15.

- **Before anything is read or copied**, a selection is refused whole **only** for:
  - more than 10 files — never truncated;
  - an item that is a folder or not a `content:` URI;
  - another share still preparing on the phone;
  - a negotiated version below 3 with more than one file.
- **Size never refuses a selection.**
- **Copies run one at a time.** Each file is offered **as soon as its copy is ready**, so a selection's
  offers arrive over time.
- **Waiting for room.** A file waits when its extra copy does not fit rule 4, when 10 offers are live,
  or when it is an unknown-size file awaiting its one retry.
  - It is re-evaluated when any live offer on the session ends, when a copy finishes or fails, and
    every 5 s.
  - Waiting files go **oldest first**, and a waiting file is never overtaken by another waiting file.
  - Each file is tried at most once, twice for the unknown-size retry.
  - A file that could not fit even with every held copy released **fails at once** instead of waiting.
  - **Stall clock (PROPOSED for review, not approved).** A wait is bounded by *stalled* time, not
    elapsed time. At each evaluation the clock is **paused** if the file would be admitted with every
    **in-progress** offer's copy and slot released — in progress meaning accepted and queued,
    receiving, or checking, each already bounded by its own rule. Otherwise it **runs**: waiting on
    unanswered offers, on a reading the paused case does not bypass, or on space short for other
    reasons. A pause keeps the counted time, a resume continues it, and it is never reset while the
    file waits. It uses a monotonic clock.
  - A file ends **not sent** after **10 minutes of running time**, or **60 minutes** after it began
    waiting, paused or not (both PROVISIONAL, development only). It also ends not sent when the
    phone's share screen closes or the session ends.
- **Unknown sizes are admitted file by file.** At most **one** retry is allowed, only with `Σ = 0`, and
  only after the first attempt's partial copy has been deleted **and its absence verified**.
- **A file never offered produces no message at all.** A file's failure ends only that file. Leaving
  the phone's screen never withdraws a file already offered.
- **The phone reads a shared URI only while the screen that received it is alive.** Files already
  offered continue from their private copies after it closes. Files not yet prepared end **not sent**.

**Optional, Stage B only: `group`.** `share.offer` may carry `group: {"id": "g-<22 base64url>",
"index": 1…count, "count": 1…10}` for files shared together.
- It is sent only at a negotiated 3, never to a version-2 Mac.
- A present but malformed `group` is declined `malformed-offer`.
- **Display only, authorising nothing:**
  - the Mac never waits for `count` offers to arrive;
  - it never treats a missing index as an error;
  - it shows cards sharing an `id` **without** a group header if their `count` values disagree.

**Unchanged at 3:** Saved on the Mac only after that offer's bytes are flushed, length- and SHA-256-verified
and exclusively published, and on the phone only on an acknowledged `share.saved {ok:true}`;
`saved-unacknowledged`; the share root and its session binding; the nonce'd partial and ownership ledger.
**A Path S offer never survives its session**: a disconnect or a restart of either app ends every live
offer, deletes every private copy and partial, and nothing re-offers on reconnect.

### Large files — resumable streaming, `share.stream` (PROPOSED 2026-09-25 — research, not implemented)

> **Not implemented; no value here is locked; no large transfer has been run.** The argument, the
> Gallery-versus-picker guarantees and the readings still owed are `docs/feature-a-large-file-proposal.md`.
> **There is no file-size limit of its own**; 4 GiB appears only as the FAT32 filesystem limit.
>
> **Revised 2026-09-25 after a code review; still not approved.** The section heading's word
> *resumable* is **not yet a promise** — see *Resume* and *Change detection* below for what continuing
> after an interruption can and cannot guarantee. **Unknown-length sources are outside this section
> entirely**: they stay on the private-copy path (version 2 / 3), which already bounds them by the
> phone's free space, until space limits, bounded writes, failure handling and truthful progress are
> defined for them.

**Negotiation.** A separate extension, `share.stream: 1`, negotiated only together with `share.file ≥ 3`
and `share.ask`. It is separate because it changes a security property: a paused stream **outlives its
session** and is bound to the **paired identity** (pinned certificate and `deviceId`) as well as to each
new session's token.

**Source.** Only a document whose grant the phone **persisted** (`ACTION_OPEN_DOCUMENT` with
`takePersistableUriPermission`, or a file inside an already-persisted `fs.*` tree). **A persisted grant
proves access only.** It proves nothing about whether the bytes are stable, whether the descriptor can
seek, whether the length is known, or whether the document is a real file rather than a cloud, pipe or
virtual one. Each of those is established when the file is opened, never inferred from the grant.
**`ACTION_OPEN_DOCUMENT` is not called anywhere in the current code**, and no picker document has been
probed on the SM-S938B.

**Gallery shares (`ACTION_SEND`), stated precisely.** Access comes from a grant tied to the receiving
activity, and it holds **while that activity exists** — which is how the private-copy path reads it
today.

- **Measured:** after the activity was destroyed, reads failed with `SecurityException` at +1 s,
  +30 s and +120 s on the Pixel 10 emulator, and at +2 s for Samsung **My Files** on the SM-S938B.
- **Not settled:** Samsung **Gallery** stayed readable after Finish. That reading is **confounded**,
  because Sidekick's own `READ_MEDIA_IMAGES` opens `content://media` URIs with no grant at all.
- **Not measured:** a stopped-but-not-destroyed activity held open for hours; the activity being
  destroyed under memory pressure.

So a Gallery file **could** be streamed while its sheet stays alive. This section does **not** propose
that as resumable. If it is ever built, it is *one attempt; share again after any interruption*.

**Offer.** `share.offer` as at version 3, with `item.sha256` **absent** and
`item.digest: {"kind": "chunked-sha256", "chunk": <bytes>}`. **The chunk size is unlocked.** 64 MiB was
a placeholder; see *Durability checkpoints* below for what has to be measured first. The offer also
carries `item.resumable: true | false`. `true` requires that, at open time, the descriptor
`fstat`s as a regular file with a non-negative size **and** `lseek` succeeds. Otherwise it is `false`,
and such a stream runs as one attempt and cannot pause. `item.size` is required: a source whose length
is not known when opened is not offered on this path.

**Integrity.** As each chunk's bytes leave, the phone sends `share.chunk {offerId, index, sha256}`
(event, phone → Mac). The Mac hashes what arrived and, on a mismatch, re-pulls that chunk by offset, at
most twice, then fails `checksum`. After the last byte the phone sends `share.chunk {offerId, index:
"root", sha256, chunk, length}` — the root is SHA-256 over the ordered chunk digests — and the Mac saves
only if the root, the length and every chunk agree, then publishes exclusively.

**Resume.** `fs.transfer.begin` on a `share:` root may carry a non-zero offset **only** under
`share.stream`, and only on a chunk boundary the Mac has verified; the Mac truncates its partial to that
boundary first. After a disconnect or restart the phone sends `share.resume {offerId, identity,
verifiedThrough}` (event, phone → Mac) on the new session; the Mac resumes only when the peer's pinned
certificate and `deviceId` equal those of the Accept, the record is under 24 hours old (proposed), the
partial and the destination folder pass their identity checks, and the phone reports the source identity
(size, last-modified, and for media `GENERATION_MODIFIED`) unchanged. **No second Accept is asked; a
resume is always shown and always cancellable.** Re-pairing or forgetting the phone discards every paused
record. The phone reaches the offset by **seeking** a descriptor proven seekable at open. It never
re-reads the prefix, as the bulk channel does today (see *Resume* under the bulk channel).

**Change detection, and what a continued transfer can promise.** The source identity is re-checked
before every attempt, every 1 GiB, and after the last byte; any difference ends the stream with the new
reason `source-changed`.

**Metadata does not prove the bytes are unchanged.** An in-place change that keeps the same size and
moves no recorded field cannot be detected by these checks. That includes a change inside chunks
**already sent** before an interruption. So a transfer that continued after an interruption promises
only this: *the saved file is exactly the bytes the phone read, chunk by chunk, across its attempts*.
It does **not** promise that they are one consistent version of the source.

Two stronger checks are proposed. Neither is decided:

- **Re-verify on continue.** Before sending past the offset, the phone re-reads every chunk already
  sent and compares each digest with the Mac's recorded one. This catches any change to the sent part
  that persists at the moment of continuing. It costs a full read of the prefix on the phone (no
  network). It is only allowed for local, seekable sources.
- **Verify after save.** After the last chunk, the phone re-reads the whole source and compares its
  root with the Mac's. This catches any change during the transfer that persists at the end. It costs
  one full read on the phone.

Neither catches a change that was made and then reverted, or one made after the final read. **The
word *resumable* may appear in anything a person reads only once one of these checks is chosen and
built.** Until then the card says *continued from where it stopped*, and the Saved detail says *saved
as read from the phone*.

**Durability checkpoints.** A record saying *verified through chunk N* may be written only after
chunks 0…N are on disk. Otherwise a crash leaves a record that claims bytes the disk never kept. There
are two ways to guarantee that:

- **`fsync` at a checkpoint** before the record advances;
- **re-hash from disk on continue**: the Mac re-reads its partial from the last trusted checkpoint and
  truncates at the first chunk that does not match.

How often to checkpoint is separate from the chunk size, and **neither is locked**. On this Mac, the
cost of `fsync` against its own disk and against an external drive has not been measured, and
`F_FULLFSYNC` (the only call that asks the drive to empty its own cache) is not reachable from Node.

**Space.** Margin `max(256 MiB, min(⌈size/10⌉, 8 GiB))` (proposed). Free space is re-read every 1 GiB; if
it falls below the remaining bytes + 1 GiB the stream **pauses** with `destination-full` rather than
failing a publish. Publication is exclusive: a hard link, or `renamex_np(RENAME_EXCL)` where the volume
supports it (**unmeasured on exFAT**); neither → `unsupported-destination` before Accept.

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
`NO_MEDIA_SESSION`, `TARGET_STALE`, `ROOT_NOT_GRANTED`, `NO_SPACE`, `CHECKSUM_MISMATCH`,
`PHONE_NOT_FOREGROUND`

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
