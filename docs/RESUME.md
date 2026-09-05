# Resume here — written 2026-09-05, end of the contact-photographs sitting

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · One-line state

**Contact photographs are drawn on the Calls pane, and the feature uncovered a defect that had been
invisible for a phase: a shared file loaded as a plain `<script>` may not carry an `export`, and one
had been breaking that rule and working anyway.** Two questions were also answered without building
anything — self-managed (WhatsApp) calls, and mic-on-the-Mac — and the answer to the second is
*nobody can build it*, so no sitting was spent on it.

## 1 · What is built, and what proved it

| Built | Proof |
|---|---|
| **Contact photographs** on all four Calls discs — live card, log row, Contacts row, *Frequently called* | **22 of 53 discs** carry a photo, **22 of 22** keep their initials underneath; `calls-with-photos.png` |
| `ContactPhotos` — one store per pane: caches absences, joins in-flight, counts failures, drops on disconnect | 9 tests, **6 mutations each red on exactly one test**; a full redraw refetches nothing (`found 6 → 6`) |
| **Defect 94** — the `export` rule, fixed in `discHue.ts` and `contactPhotos.ts` | 8th commit hook, shown to deny with the defect reintroduced and fall silent restored |
| `scripts/call-photos-probe.mjs` — the pane's numbers, through `probe.mjs` | every reading `stopped=settled` with a control |
| `probe.mjs` — `format()` now refuses an `act` result; `formatAct()` added | fixture is the sentence that actually printed |
| A latent **parallel-test race** fixed (`check-debt-claims.test.mjs` patched a shared file on disk) | 10 consecutive parallel runs at `fail 0`; checksum unchanged across a run |

**Tests:** Mac **565 → 580**. Scripts **79 → 89**. Phone unchanged in behaviour (two log lines added,
`sync-module` suite green).

## 2 · Committed

```
21313a8  Contact photographs on the Calls pane, and defect 94
```

Working tree has `CLAUDE.md` and this file uncommitted at the time of writing. All nine commit hooks
green.

## 3 · The three questions that were asked, and their answers

### 1. Contact photos — **done**, and it needed no contract change

`contacts.get` has carried an optional base64 PNG since Phase 4 as one of the contract's two
deliberate exceptions to *no binary in JSON*, capped at 64 KiB and downscaled by the phone. The
Contacts pane already used it. Calls simply never asked.

**The measurement came first**, and it is the reason the cache is shaped the way it is:

| | contacts | share | source size |
|---|---|---|---|
| rows total | 665 | — | — |
| `photo_id` — a **thumbnail** | **224** | 34% | 96 px |
| `photo_file_id` — a **display photo** | **17** | 2.6% | 720 px |
| no picture at all | **441** | 66% | — |

Two thirds of the book has no picture, so *there isn't one* is the ordinary answer and an absence is
cached exactly as hard as a hit.

**The one thing the design still cannot be matched on is resolution, and it is a phone fact.** 207
of the 224 pictures exist only at 96 px. The card's disc is 104 px at DPR 2, so most faces are drawn
from a 96 px source at 208 device pixels and are soft. `photo_dimensions` reports
`thumbnail_max_dim=96`; there is no larger image to fetch.

### 2. WhatsApp calls — **the app does see them.** What it cannot do is *name* them

This contradicts the premise in the brief, and the evidence is already in this repo:
`docs/defects.md` → 47, measured 2026-08-31 off `dumpsys telecom`.

A 68-minute incoming WhatsApp **video** call produced a complete episode: the phone minted `c13`,
sent `call.incoming`, and logged `Call c13 ended answered after 4080849ms` — which agrees with
telecom's own analytics to within the 14.2 s of ringing. `CallWatcher` is built on
`TelephonyManager` call state, and on this handset a self-managed call moves that state.

**What is missing is identity, not detection.** A self-managed call carries no
`EXTRA_INCOMING_NUMBER` — correctly, there is no phone number — so the card reads
**`Unknown number · In progress`**. That is true and useless, and it is *pixel-identical to a
withheld-number cellular call*. Two very different facts, one card. That is the lookalike family
this repo keeps paying for, and it is the real defect here.

**What naming it would take, cheapest first:**

- **The notification listener, which is already granted.** WhatsApp posts an ongoing call
  notification, and the relay already receives it with `AppLabels.of` resolving *WhatsApp*. This
  needs **no new permission and no new grant** — it is a correlation between an episode with no
  number and a live call-category notification. It is the honest route and the one I would take.
- **An `InCallService` with `METADATA_INCLUDE_SELF_MANAGED_CALLS`**, which is the only route that
  gets the `PhoneAccountHandle` properly. It needs the user to grant a **role**, and whether
  self-managed calls are visible to it at all on this handset is **unmeasured** — see below.

**Answer and reject on a self-managed call is unmeasured, and the stimulus is named.** `call.answer`
is `TelecomManager.acceptRingingCall()` and `call.reject` is `TelecomManager.endCall()`; whether
either reaches a self-managed call is a device question, not a documentation one. It needs **one
live self-managed call** — and the cheap version needs no second person: start a solo Google Meet
call, which is also a self-managed `ConnectionService`, then send `call.reject` from the Mac and
read whether telecom ends it. **Do not guess the answer into the UI** — a Reject button that returns
success and hangs up nothing is worse than an absent one, which is the `apps.launch` finding in a
different namespace.

### 3. Answering on the Mac with your mic — **your understanding is right. Do not spend a sitting.**

This is not a thing we chose not to build. There is no route for any third-party app:

- `CAPTURE_AUDIO_OUTPUT` is **signature|privileged**. It cannot be granted to us.
- `AudioPlaybackCaptureConfiguration` — the MediaProjection audio path that exists since Android 10
  — cannot capture `USAGE_VOICE_COMMUNICATION`, and the in-call stream is exactly that.
- `MediaRecorder.AudioSource.VOICE_CALL` has required a system permission since Android 10.
- The remaining route, recording through an AccessibilityService, violates Play policy.

Uplink is walled the same way: there is no API to inject audio into a cellular call's microphone
path. So it is both directions, not one.

**The Bluetooth line on screen is the correct and complete answer**, and it is already the documented
one in `CLAUDE.md`'s first platform wall and in `docs/protocol.md`. Nothing has changed. The only
thing I would add is that this is now the **second** time the question has been asked and answered
from first principles, so the answer is written here rather than re-derived a third time.

## 4 · Messages and Photos — both already done, measured in the running app

The brief lists these as outstanding. They are not: both landed earlier on 2026-09-05, in commits
`e546b8b` and `39e4b40`. If they look unchanged, the running app is stale — rebuild and relaunch.

Measured just now through `probe.mjs`, in the build currently running:

| | Reading | Control |
|---|---|---|
| **Photos** — the stacked-thumbnail bug (defect 88) | 120 tiles, **149×149 square**, **0 overlapping pairs**, worst overlap **0 px** | 120 tiles found |
| **Messages** — three columns and defect 93 | `280px 611px 300px`, **50** thread rows, **50** previews with text, **0** at zero height | 698 elements in the pane |

Screenshots of the current build are at `/tmp/photos-now.png` and `/tmp/messages-now.png` — not
committed, since `docs/evidence/phase-7-design-2026-09-05/` already holds the compare images.

## 5 · Half-built and readable

- **Nothing is mid-edit.** `npm test`, `node --test scripts/*.test.mjs`, and
  `:sync-module:testDebugUnitTest` are all green, and every commit hook passes.
- **`.icon-button`** still draws at zero height on every pane it appears on — unchanged from the last
  handoff, still recorded as unmeasured rather than folded in as a pass.
- **The device-status rings still do not sweep in** — unchanged, and still deliberate.

## 6 · What needs your hands

1. **The vocabulary decision — still the blocking item, unchanged.** `docs/empty-and-failure-states.md`
   has 83 sentences and three uses of one pattern. Nothing was added to it this sitting.
2. **Defect 89** — deleted photographs listed as an ordinary album. Needs `relativePath` on
   `media.buckets`, which is a wire change. Unchanged.
3. **One live self-managed call**, if you want the answer/reject question settled — see §3.2. A solo
   Google Meet call is the version that needs no second person.
4. **The phone is off the USB bus.** Two readings for §3.2 were queued and not taken because
   `scripts/target-device.sh` correctly refused rather than guessing: the protection level of
   `CONTROL_INCALL_EXPERIENCE`, and whether any `InCallService` on this handset declares
   `METADATA_INCLUDE_SELF_MANAGED_CALLS`. Both are reads; reconnect and they take a minute.

## 7 · What I would do next, and why

1. **Name the WhatsApp call on the card**, via the notification listener. It is the only item from
   this brief that is both unbuilt and unblocked, it needs no permission, and *"WhatsApp video call"*
   against today's *"Unknown number"* is the largest single legibility win left on the pane.
2. **Then the remaining panes against the design** — Mirror, Files, Notifications, Apps, Activity.
   Unchanged from the last handoff, about ten minutes each.
3. **Then Phase 8 signing**, unchanged: it needs an Apple account, which is yours to open.

## 8 · Left changed on your devices

- **The phone: nothing.** Two `adb` **reads** only, against `content://com.android.contacts` — the
  contact count and the provider's photo dimensions. No taps, no installs, no writes. It is now
  disconnected from USB.
- **The Mac: one dev Electron run on `--remote-debugging-port=9222`**, rebuilt and relaunched several
  times; the last relaunch is the one running. `pkill -f "node_modules/.bin/electron"` matches it.
- **A synthetic call card was driven onto the Calls pane** to photograph the live card, and **put
  back** with `calls.refresh()` — verified by the idle card returning. Nothing on the phone was
  dialled, answered or rejected at any point.
- Headless Chrome was started and killed once per shot; none should be left.

## 9 · The findings worth carrying past this repo

1. **A `function` declaration is hoisted onto `globalThis` before a script's body runs, and a `class`
   is not.** That one asymmetry is why a file that throws on its first line can appear to work
   perfectly for a phase, and why the same mistake made with a class is fatal and silent. Every
   layer was green because every layer was testing a loader the browser does not use.
2. **Two instruments on one fact disagreed and both were right.** The DOM says 22 discs carry a
   photograph; the store says 6 were found. 50 log rows are 17 distinct numbers and one contact
   appears on many rows — *photographs fetched* and *discs painted* are counts of different things.
   Any ratio between them would have been the units error that once produced a fictional 45% gap.
3. **`probe.mjs` hit its own failure family.** `format()` printed `NOT REPORTABLE — the instrument
   gave up` over a stimulus that had landed, because an `act` result has different fields from a
   read. The file written to stop instruments from misreporting themselves was misreporting itself,
   in the run that produced this feature's numbers.
4. **A latent race surfaces when something unrelated moves.** A fixture that patched a shared file
   on disk had been safe for as long as the suite happened to schedule around it; a ninth test file
   changed the scheduling and an unrelated test failed with a perfectly accurate message about a
   file that existed for forty milliseconds.
5. **The brief's premise about WhatsApp calls was wrong in the useful direction.** The app does see
   them — it has since Phase 4, proven in defect 47's own record. Checking the record before
   building found that the feature to build is *naming*, not *detection*, which is a much smaller
   and much cheaper thing.
