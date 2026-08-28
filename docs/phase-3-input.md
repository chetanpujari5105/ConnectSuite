# Phase 3 — Input injection (AccessibilityService)

Written 2026-08-26, after Phase 2 closed and the legacy ADB mirror was deleted.

Goal: the Mac's mirror canvas becomes interactive. Click, drag, scroll, type, and back/home/recents
reach the phone. No ADB — locked decision #1. The transport is the existing control channel.

`android-connect-suite-claude-code-prompt.md` describes this as `adb shell input tap x y` behind a
wireless-debugging wizard. That is the v1 design and it is not what we are building; the message
names are the only thing carried over.

---

## What already exists

More than it looks. Phase 3 is mostly wiring, not invention.

| Piece | Where | State |
|---|---|---|
| Six message names | `Messages.kt:117-122`, `protocol.ts:40-45` | Constants defined both sides |
| Capability contract | `CapabilityContract.kt:55-64` | `input` already contracted against all six types |
| Permission gate | `Capabilities.kt:119` | `isAccessibilityServiceEnabled()` already gates `input` |
| Handler registry | `LinkServer.register()` | Working; `MirrorFeature` is the reference caller |
| Capability liveness | `capabilities.changed` | Emitted on register/unregister and on resume |

So the capability turns itself on the moment handlers are registered and the user has enabled the
service. Nothing in the contract layer needs changing. What is missing is the service, the payload
schemas, and the Mac's input surface.

**`isAccessibilityServiceEnabled()` matches any service under our package prefix** — it does not
name a class. Ours will satisfy it as soon as it is enabled, and no second detector is needed.

---

## Platform walls, specific to input

These are not design choices. Establish them before writing code, because two of the six message
types cannot mean what their names suggest.

- **Arbitrary key injection is impossible.** There is no public API for an AccessibilityService to
  inject a `KeyEvent`. `INJECT_EVENTS` is signature-level and unavailable to us forever. Volume,
  power, and hardware keys cannot be synthesised. `input.key` must therefore be scoped down to what
  `performGlobalAction` offers, or answered with a reason string — not silently dropped.
- **`performGlobalAction` is the whole of `input.global`.** BACK, HOME, RECENTS, NOTIFICATIONS,
  QUICK_SETTINGS, POWER_DIALOG, LOCK_SCREEN (28+), TAKE_SCREENSHOT (30+), DPAD directions (33+).
  Note POWER_DIALOG opens the power menu; it is not a power-button press. The protocol line in
  `docs/protocol.md` currently promises "back/home/recents/power" — **power is wrong and must be
  corrected in the contract before it is implemented.**
- **`input.text` sets, it does not type.** The only route is `ACTION_SET_TEXT` on the focused
  editable node, which replaces the field's entire contents. Appending means reading the current
  text first, which needs `canRetrieveWindowContent`. IME composing state is lost, and password
  fields commonly refuse. Decide and document whether `input.text` is replace-semantics (honest,
  simple) or append-semantics (needs a read, can still fail).
- **`dispatchGesture` cannot reach FLAG_SECURE surfaces, the keyguard, or parts of system UI** —
  the same wall Phase 2 hit for capture, so the phone is already showing black there. Input should
  fail with the same vocabulary the mirror uses, not a new one.
- **One gesture at a time.** A `dispatchGesture` issued while another is in flight is dropped.
  A drag arriving as many small strokes needs `StrokeDescription.continueStroke`, not N calls.
- **The user must enable the service by hand in Settings.** It cannot be granted programmatically
  and it cannot be prompted for the way MediaProjection can. `ACTION_ACCESSIBILITY_SETTINGS` is a
  deep link, nothing more. This is the phase's onboarding cost and it is unavoidable.
- **Play policy.** An AccessibilityService used for remote control is a declared, permitted use,
  but it requires the `accessibilityServiceConfig` metadata and a policy declaration on the listing.
  Worth getting right now rather than at submission.

Add the first two and the last to CLAUDE.md's **Platform walls** section once confirmed — they are
the same class of fact as the call-audio and FLAG_SECURE entries already there.

---

## Coordinate mapping — the one thing v1 got wrong twice

The deleted `SpsParsingTest` carried a lesson worth keeping even though its subject was ADB-era:

> The SPS is the only authoritative source for the encoded video's real dimensions, and touch
> coordinates are scaled against them — so getting this wrong makes taps land in the wrong place
> rather than failing visibly.

That still holds. The chain has three links, and they are not the same numbers:

```
Mac canvas (CSS px, letterboxed)
  → decoded frame dimensions (from the SPS, may be macroblock-padded)
    → CaptureGeometry(width, height)         ScreenEncoder.kt:30
      → real display coordinates
```

The encoder may pad to a 16-pixel alignment, so the decoded frame can be *larger* than the requested
capture, and the capture is already a capped scale of the display. Scale against the SPS, then the
geometry — never canvas-to-display directly.

**Rotation makes this live.** Phase 2 established that rotation swaps geometry in place with an
encoder swap and no session restart (test 10), and that the announced angle can lag the geometry by
~63ms (defect 16). A tap that arrives inside that window will map against stale dimensions. Either
stamp coordinates with the geometry generation they were computed for and reject mismatches, or fix
defect 16 first. **This is the reason defect 16 is no longer merely cosmetic** — it was filed as
"Low — self-heals" when nothing consumed the angle. Phase 3 consumes it.

---

## Work, in order

1. **Protocol first** (CLAUDE.md code rule). Define payload schemas for all six types in
   `docs/protocol.md`: coordinates and their reference frame, durations, the global-action
   enumeration, text semantics. Correct the `input.global` line — drop "power". Decide `input.key`'s
   scope here, in writing, before any Kotlin.
2. **`ConnectSuiteInputService : AccessibilityService`** in a new `input-module` (or `sync-module`
   if a fifth module is unwelcome — `mirror-module` is the wrong home, it is the capture path).
   `accessibilityServiceConfig` XML, manifest entry, `canRetrieveWindowContent` only if
   `input.text` needs the read.
3. **`InputFeature.install(context, server)`**, modelled on `MirrorFeature.install`. Register the
   six handlers, then `server.refreshCapabilities()`. Read that method's ordering comment first —
   it documents why sinks are assigned before handlers.
4. **Onboarding**: a card on the Mirror tab that detects the service is off, explains what it is
   for, and deep-links to Settings. This is also the Mac's `input` chip going from grey to live.
5. **Mac side**: pointer and key listeners on the mirror canvas, coordinate transform, and a
   rate limit. Sockets in main, canvas in renderer, intents over IPC — the renderer must not
   compute display coordinates.
6. **Degradation strings** per locked decision #6, one per failure: service disabled, gesture
   refused, secure surface, no focused editable, unsupported key, phone locked.

---

## Acceptance tests to add to `docs/testing.md`

Numbering continues from Phase 2; these become 20+.

| Step | Expectation |
|---|---|
| Service off: click the canvas | The Mac says input is unavailable and why, with the enable path. No silent no-op. |
| Enable the service while connected | The `input` chip goes live **without a reconnect**. This is deferred test 8 finally becoming runnable — `input` is gated on a Settings-revocable grant, which is exactly what test 8 needs. |
| Disable it again while connected | Chip greys within seconds. The other half of test 8. |
| Tap accuracy at Native and at 1080p | A tap lands where clicked at both capture caps, proving the scale chain, not one hardcoded ratio. |
| Tap immediately after a rotation | Lands correctly, or is rejected — never lands in the wrong place. Exercises defect 16's new consequence. |
| Drag across the canvas | One continuous stroke on the phone, not a series of taps. |
| Type into a text field | Text arrives; documented semantics (replace vs append) are what actually happens. |
| Back / home / recents | Each performs its global action. |
| Click into a banking app (FLAG_SECURE) | Named reason, same vocabulary as the mirror's black-frame message. |
| Enable the service, check `clipboard` | Stays **off**. Its permission half opens with the service, but it has no handlers, so the two-gate contract must keep it un-advertised. A regression here means the contract has been bypassed. |

That last one is cheap and guards the invariant `CapabilityContract` exists to protect.

---

## Carried into this phase

- **Defect 16** (stale rotation angle) is promoted from Low/cosmetic to a Phase 3 correctness
  dependency, for the reason given above.
- **Defects 13 and 15** stay deferred until input works, per the close-out.
- **Test 8** stops being "not runnable" the moment `input` is advertised.

---

## Decisions taken, 2026-08-26

The brief left four things open. All four are now settled in `docs/protocol.md`, which is the
contract; this is the record of why.

- **`input.key` is text editing plus aliases of the global actions, and nothing else.** Backspace
  (rewrite the focused field one character shorter), Enter (`ACTION_IME_ENTER`, Android 11+), and
  `back`/`home`/`recents`/`notifications`/`quick_settings`/`lock_screen`. The aliases exist because
  a Mac keyboard has an Escape key and a user expects it to go back. Everything else — letters,
  arrows, volume, power, raw keycodes — is answered `UNSUPPORTED_KEY` **by name, with the reason**.
  Written into the protocol as a limitation, not a TODO: `INJECT_EVENTS` is signature-level and
  there is no subset of keycodes an accessibility service may synthesise, so this will not change.
- **`input.global` is six actions and power is not one of them, permanently.** The protocol line
  that promised "back/home/recents/power" was wrong and is corrected. `GLOBAL_ACTION_POWER_DIALOG`
  is also deliberately absent even though the platform offers it: it opens the power menu, which is
  one stray click from switching off the phone the Mac is connected to, with no route back over the
  network. `InputActionsTest` pins both absences so nobody re-adds them on the strength of the name.
- **`input.text` does both, and says which.** `mode: "replace"` (the default) and `mode: "append"`,
  both one `ACTION_SET_TEXT`; append reads the field first, which `canRetrieveWindowContent` gives
  us anyway for backspace. Replace alone would have been the simpler promise, but the Mac's
  keyboard sends one character at a time, and replace-per-keystroke would delete the field on every
  key. Append is what makes typing work; the honest caveat — that neither is *typing*, so composing
  state and autocorrect are lost — is in the protocol rather than worked around.
- **A fifth module, `input-module`.** `sync-module` would have meant the accessibility service
  shipping inside the notifications-and-SMS module, whose manifest and dependencies have nothing to
  do with it; `mirror-module` is the capture path and was ruled out in the brief. The two things
  the modules must agree about are shared through `:core` instead of through each other:
  `ScreenGeometryRegistry` (the capture geometry and its stamp) and `SecureSurfaceMessage` (one
  sentence for one wall). `:app` is the only place that sees both, and it is where the
  `contentBlocked` probe is wired.

### Two things the brief did not anticipate

- **Defect 16's fix is a consistency check, not a re-ordering.** The obvious reading — "it read the
  rotation before the metrics, so swap the lines" — is wrong. Both already come from one `Display`
  object, and re-ordering moves the race rather than closing it. What was missing was any way for
  the phone to notice that portrait metrics at 270° cannot both be true. See `readingIsConsistent`.
- **There is a third guard, on the Mac.** `mirror.rotate` reaches the Mac ahead of the new
  parameter sets, so there is a window where the Mac's canvas still shows the old picture while the
  geometry stamp it would quote is already the new one — the ids agree and the phone's check passes,
  yet the click is against a stale picture. The renderer refuses to send until it has painted a
  frame since the turn. Neither of the brief's two options covers this; it is only visible from the
  side that owns the canvas.

### Onboarding, as built

The card lives on the Mirror tab, as the brief asked, and is passed into `MirrorScreen` as a slot
from `:app` rather than referenced from `mirror-module`. It watches
`Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` through a `ContentObserver`, so walking back from
Settings with the switch flipped updates the card and the Mac's chip at the same moment, with no
polling and no resume hook.
