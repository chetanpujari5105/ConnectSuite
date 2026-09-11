# Four mirror problems, diagnosed before anything was built — 2026-09-09

Four symptoms were reported together, in priority order, after a floating window hung during an
investor demo. This is the diagnosis that was asked for **before** any fix, kept because three of
its four conclusions are still the plan and one of them was **refuted by measurement** and is worth
keeping refuted.

A rendered version of this file is published as an artifact for sharing:
<https://claude.ai/code/artifact/b1c908cd-9a04-4a53-a37c-ba027fbc1b4e>. This file is the record;
where they differ, this one wins.

**Agreed order of work, 2026-09-10:** §3 → §1 → §4's instrument → §2.

## The short answer: four symptoms, three roots

| | Symptom | Root |
|---|---|---|
| 3 + the accuracy half of 2 | black bars, rotation, **and wrong tap coordinates** | **One bug.** A fixed 9:19.5 aspect asserted in three places, one of which is a comment inside the coordinate mapper. **Defect 99 — fixed on the pane 2026-09-10, Slice 37** |
| 1 + possibly the spikes in 4 | float stuck, main pane janky | **Plausibly one bug**, with a one-minute test that settles it |
| 2 (its existence) | float takes no input | Not a bug — unbuilt on purpose (M13). Plus **one wire gap nobody had noticed** |
| 4 | 9 / 11 / 99 / 134 ms | **Its own root.** The instrument subtracts a pipeline stage before you read it |

**And the habit under all four: none of these paths logs its success case.** The keyframe path logs
nothing at either end. The float cannot say which of two failure states it is in. The aspect box
never met a phone with a different aspect. The latency split has no per-stage number.

## §1 — the floating window

`mirror.keyframe` **is** requested, from `float.ts:96` and from `main.ts:629`, and the handler chain
is complete: `MirrorFeature.kt:103` → `MirrorEngine.requestKeyframe()` → `ScreenEncoder.kt:471` →
`setParameters(PARAMETER_KEY_REQUEST_SYNC_FRAME)`. The observation behind the report is right anyway,
and worse than it looks: **two states render the identical sentence.**

- **State A — no decoder, no request, no recovery.** `H264Canvas.push()` returns at
  `if (!decoder || decoder.state !== 'configured')`, which sits **before** the keyframe branch. A
  float that never receives a config frame drops every access unit including IDRs, asks for nothing,
  and cannot recover until the phone spontaneously re-emits SPS/PPS — a rotation or a reconfigure.
- **State B — a request storm.** With a decoder, `requestKeyframe()` fires on **every non-key
  frame** — up to 60/s, no rate limit, no dedup, each a control-channel envelope with a 5 s timer
  (`link.ts:219`), each asking MediaCodec to make the next frame an IDR. Against
  `VideoChannel.QUEUE_DEPTH = 4`, whose `offer()` sheds the **newcomer** once the queue holds only
  keyframes.

**The test that splits them costs nothing and needs no code:** open the float mid-session and watch
the main pane's latency. Degrades → B, and §1 and §4 are one bug. Unchanged → A.

**A hypothesis tested and refuted.** The config replay looked like it was racing the renderer — main
sends the retained SPS/PPS on `ready-to-show`, before `float.js` registers `onVideoFrame`. Measured
in the float window: `domContentLoadedEventEnd 230.3ms` against `first-paint 260.0ms`, so the scripts
run first; and a `status` message sent from the same callback **did** reach the renderer (the overlay
was replaced by its sentence). **Not the mechanism.** Recorded because it was one paragraph from
being published as one.

**Why nobody can say which state it is.** Four silent discards, none of which review would flag:
`.catch(() => undefined)` twice on the Mac (`main.ts:629`, `:1036`); `encoder.get()?.requestKeyframe()`
(`MirrorEngine.kt:1013`) — a null encoder mid-swap, **and the handler still acks**; and
`runCatching { codec?.setParameters(…) }.onFailure` (`ScreenEncoder.kt:472`), where `?.` short-circuits,
`runCatching` succeeds and `onFailure` never fires. `docs/protocol.md:227` already warns that the ack
means the request reached the encoder, not that a keyframe was produced. **There is no evidence in
this repo that a single `mirror.keyframe` has ever produced an IDR.**

The demo's own evidence is gone: 6,334 lines across both Mac log files, 13 tags present,
**`[video]` count 0**.

**Asymmetry worth citing:** the phone rate-limits *its own* keyframe requests, with a comment saying
why (`MirrorContractTest` :259-269 — *"asking again in 700ms would cost a real keyframe every
700ms"*). Neither Mac-side decoder rate-limits at all.

**Should the float share the main pane's decoded frames?** No — keep two decoders, as M14 already
decided. A readback and a copy per frame at 60fps costs more than a second decode, and Electron
cannot hand a GPU-backed `VideoFrame` between renderer processes. The defect is the **start**, not
the second decode: the float should *ask* for the parameter sets once its listeners are up, main
should answer with the retained config **or say there is none**, and the request must be rate-limited
to one in flight.

## §2 — input in the floating window

Correctly unbuilt and recorded (M13). Three things the row does not say:

1. **The wire is already there.** `inputTap` / `inputSwipe` / `inputScroll` / `inputGlobal` are on the
   shared preload bridge and their `ipcMain` handlers are not window-gated; the float already calls
   `inputGlobal`.
2. **The float never receives `mirror.rotate`.** `main.ts:872` uses `send()` — main window only —
   while `mirror-state`, `mirror-stopped` and `video-frame` all use `sendAll()`. A float that took
   taps today would send the pre-rotation `geometryId` and would not cancel a drag in progress:
   defects 19 and 20 reintroduced in the second window. **One word, and it lands before any pointer
   handler.**
3. **It cannot ship before §3**, or every tap inherits the letterbox offset.

## §3 — the picture does not fit

Fixed on the pane; the full record with all measurements is `docs/testing.md` → Phase 7 Slice 37,
and the register row is defect 99. The float window's `RATIO = 19.5 / 9` is the same defect in a
third place and is **still live**, waiting on §1's geometry plumbing.

## §4 — where the time goes

The split (`total` / `link` / `decode`, `mirror.ts:680`) is fine. The problem is upstream.

`capturedAtMacMs()` maps a frame's PTS onto the Mac's clock through an anchor pair
`(ptsUs, monoUs)` from `mirror.stats`, and **both halves are stamped at encoder output**:

```kotlin
// ScreenEncoder.kt:375-376, inside onOutputBufferAvailable
lastPtsUs  = info.presentationTimeUs
lastMonoUs = System.nanoTime() / 1_000
```

Mapping through that pair **defines** the anchor frame's capture instant to be its encoder-output
instant, so for every frame `capturedAtPhone(f) = trueCapture(f) + E`, where `E` is one frame's
encode latency. `total` is short by `E`; `link` is short by `E` and has **no sign guard** (only a
±10 s bound on `total`), so a negative link latency renders as `-7 ms`.

This holds whatever the PTS base — if an encoder rebases PTS to zero, the offset absorbs the whole
uptime and the bias is still exactly the anchor frame's encode latency.

The anchor refreshes every 2 s (`STATS_INTERVAL_MS`) from **whatever frame happened to be last**, and
a keyframe's `E` is far larger than a P-frame's. **So two of the four reported figures may differ
mostly in which frame was the anchor.** 9 ms is not a plausible capture-to-paint figure with an
H.264 encode in it; that is the tell.

Not measured at all: queue wait in `VideoChannel` (depth 4 ≈ 66 ms of headroom at 60fps), socket
write time, main→renderer IPC, and paint.

**The measurement, before any proposal.** Five numbers, four nearly free, each published beside its
denominator:

1. phone, capture→encoded: `lastMonoUs − lastPtsUs` — both halves already exist and are read
   together on purpose; publish the difference as a duration rather than only as an origin;
2. phone, queue wait and write time, beside `VideoDropTally.acceptedNow` so the drops have a
   denominator;
3. wire: `arrivedAt` is already stamped in `video.ts` and becomes meaningful once the anchor stops
   eating the encode stage;
4. IPC: stamp at `sendAll`, read at `onVideoFrame`;
5. decode submit→output, and output→after `drawImage`.

**Fix the anchor first**: estimate the offset from the **minimum** of `(arrival − pts)` over a window
— the standard one-way-delay-min estimator — or send two timestamps (composed, encoded) so the
encode stage is a stage rather than the origin.

**Suspects, pre-registered so nothing is rationalised afterwards:** the keyframe storm whenever the
float is open; `QUEUE_DEPTH = 4` at 60fps; and `writeFrame`'s `write(header)` / `write(data)` /
`flush()` — two writes per frame on the TLS stream, which can put a 13-byte header in its own record.

**"Sometimes errors" is not diagnosed and must not be guessed.** Five sentences are reachable —
`the video stream desynchronised` (a length over `MAX_FRAME`), `the phone closed the video
connection`, `MirrorFailure.EncoderDied`, and the two decoder-failure sentences. The screenshot is
owed; picking one now would be the absence rule with the confidence turned up.
