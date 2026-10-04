# Camera v2 — the decode-overflow recovery gap (defect 177): what was measured, and four options

**Status: a proposal. Nothing below is implemented** except the diagnostics in §3. No wire message, no
keyframe policy, no queue bound and no quality target has changed. Each option in §5 needs its own
approval, and two of them change `docs/protocol.md` first.

## 1. The finding

The 2026-10-04 19:57 IST encoder spike (`docs/evidence/camera-v2-encoder-spike-2026-10-04/`), back
camera, 1920 × 1080 at 30 fps, 8 Mbit/s, IDR every 2 s:

| Reading | Value |
|---|---|
| AUs received by the bridge | 421 |
| dropped from a full decode stage (`droppedDecodeQueue`) | **1** |
| refused by the gate while it waited for an IDR (`gate.awaitingKeyframe`) | **54** — 12.8% of the stream |
| decode stage high-water mark (`maxWaiting`) | 4 of 4 |
| decoded | 366 (8 IDR + 358 P) |

One overflow cost **54 frames, about 1.8 s of picture**. The arithmetic pins where in a GOP it happened,
without any timing: 8 IDRs over 421 AUs, the first and the last both IDRs, is a **60-frame GOP**; 54
refused means the dropped AU was at **GOP index 5** (60 − 5 − 1 = 54). Index 5 is the first index past
the stage's capacity with the GOP's own IDR still in flight: IDR decoding, indexes 1–4 waiting, 5
dropped. So at the moment of the drop, **that GOP's IDR had not finished decode and compose** while five
more AUs arrived.

**Not established:** which GOP it was, how long that IDR took, or how fast the five arrived. The run
recorded no timings. Wi-Fi is not assumed and nothing here measures it.

## 2. What the code does (inspected)

- **Admission** (`BridgeCore.accessUnit`): an accepted AU joins a 4-slot stage. A full stage drops a
  non-IDR and tells the gate, which then refuses every AU until an IDR with SPS and PPS — correctly: a
  skipped reference cannot be decoded around. An IDR arriving at a full stage replaces everything waiting.
- **Scheduling**: one serial queue does decode **and then** compose for each AU, in order; the next
  decode waits for the previous compose. Decode is synchronous (`VTDecompressionSessionDecodeFrame`,
  no async flag).
- **Startup**: the first IDR pays for three setups on the critical path — the `VTDecompressionSession`
  (needs the SPS/PPS, so it cannot exist earlier), the composer's pixel-buffer pool and transfer session
  (created on the first frame), and the rotation session (created on the first rotated frame; the run's
  rotation was 1).
- **Compose, every frame**: a quarter-turn rotation, a CPU fill of the whole 1080p output (luma by
  `memset`, chroma by a per-byte loop), then a letterbox transfer.
- **The probe's input**: records arrive on stdin from Electron main and are processed in whatever chunks
  the pipe delivers, so anything that delays main or the socket shows up here as a burst.

## 3. What is measured now (built, tested, metadata only)

`PipelineDiagnostics` (`desktop/native/SidekickCamera/Sources/WebcamBridge/`), 35 fixed integer counters
in every `counts` status, never a byte of a frame, nothing logged per frame, and one summary line at the
decode probe's exit:

| Question | Counters |
|---|---|
| when an overflow occurs | `diag.overflow.first.{atReceived, sinceLiveUs, gopIndex, inFlightUs, decodesBefore}`, `diag.overflow.events`, IDR flushes |
| queue high-water and wait | `maxWaiting` (existing), `diag.queueWait.{maxUs,totalUs}` |
| decode / compose duration | `diag.decode.*`, `diag.compose.*`, `diag.service.*` — count, total, max, **first**, over the 33.3 ms budget |
| arrival shape | `diag.arrival.maxGapUs`, `diag.arrival.maxPerFrame` (most AUs inside one frame interval) |
| time from drop to a usable frame | `diag.recovery.{count,maxUs,lastUs,maxRefused,open,unrecovered}` — the first frame **admitted after** the break that reaches the sink; frames admitted earlier and decoded later do not count |
| frames dropped by each stage | the existing `gate.*`, `droppedDecodeQueue`, `decodeErrors`, `composeErrors`, `supersededSink`, plus `diag.discardedEnded.{beforeDecode,afterDecode}` |
| delayed completion after Stop | `diag.afterEnd.{completions,maxLateUs}` |
| invariants | `invariantHolds` (existing); diagnostics agree with the accounting in all six scenarios; the key set is fixed and ≤ 64 of main's 128 |

Tests: `PipelineDiagnosticsTests.swift`, a manual clock the test sets and a gated decoder that holds or
charges a chosen decode call, so every number is exact. Mutations D1–D4 red (D2 green first: the test
overflowed only in the first GOP, where a GOP index that is never reset looks right; a later-GOP test was
added).

## 4. Readings on this Mac (generated streams, not the field)

A **release**-built probe (built into a scratch path, not `.build/release`), 150 AUs of 1080p High with
rotation 1, paced at 33.3 ms, five runs:

| | first frame | steady state (mean) |
|---|---|---|
| decode | 60–67 ms (session creation) | ~3.1 ms |
| compose | 30–42 ms (pool, transfer and rotation sessions) | ~6.2 ms |
| service (decode + compose) | **92–106 ms** — the only frame over budget | ~9 ms, ≈ 3.5× headroom |
| queue wait behind it | up to 54–68 ms | — |

- With smooth arrivals (≤ 1 per frame interval), about 3 AUs land during the first frame and fit:
  **no overflow** in four runs.
- In one run the probe started while the stream was already being written; 17 AUs arrived inside one
  frame interval during that first frame, and the result was **the field signature exactly**: overflow at
  AU 6, GOP index 5, **54 refused**, recovery after 1.65 s.

**The debug suite's numbers are not these.** Debug compose measured ~50 ms mean, every frame over budget,
because the chroma fill is a per-byte loop a debug build does not optimise. That reading would have
described a bridge that cannot sustain 20 fps; the release build sustains ~100.

**So the strongest hypothesis — unproven for the field — is a burst of ≥ 5 AUs during a slow IDR,
most plausibly the first one.** The next run's `diag.overflow.first.*` settles it: `decodesBefore 0` and
`gopIndex 5` with a large `inFlightUs` is the startup case; a later GOP with a small one is something else.

## 5. Options, compared

| | What it changes | Recovery after any drop | Prevents this overflow? | Cost |
|---|---|---|---|---|
| **A. Remove the startup stall** | Create the composer (pool, transfer, rotation sessions) at `session-live`, before the first AU; optionally fill only the letterbox bars instead of the whole frame | unchanged (≤ 2 s) | partly: first-frame service ~100 → ~65 ms, so a burst must be ≥ 6–7 instead of ≥ 5 | a few MB of pool allocated ~1 s earlier; no contract change. The decoder session cannot be pre-created (needs SPS/PPS) |
| **A′. Pipeline decode and compose** | Two serial stages instead of one | unchanged | partly, at startup only marginally (the first decode still blocks) | one more decoded 1080p buffer in flight (~3 MB); ordering is still per-stage FIFO |
| **B. Request an IDR after a receiver-side drop** | `webcam.keyframe {sessionId, generation}`, Mac → phone, the addition `docs/protocol.md` already names; the phone already has an internal `RequestKeyframe` effect | ≤ 2 s → round trip + one encode (estimate 0.1–0.3 s, **unmeasured**) | no — it shortens the gap, from any cause | contract change and version bump. **Rate limit**: at most one outstanding per session and generation, and at most one per second. **Ownership**: the phone ignores a request for a session or generation that is not its live one; the Mac never asks for an ended one. Each request costs one IDR (here up to 647 KB, ~0.65 s of the 8 Mbit/s budget), and an IDR is itself the kind of large AU that precedes a burst — hence the limit |
| **C. Shorter periodic IDR (1 s)** | Encoder keyframe interval | ≤ 2 s → ≤ 1 s, no wire change | no | at a fixed 8 Mbit/s, IDRs take a larger share of the bits — with the run's sizes (IDR up to 647 KB against a 34 KB mean AU) roughly 30% → 45% — so P-frame quality drops, or the bitrate rises to hold it. Twice as many large-AU bursts |
| **D. A bounded queue increase (4 → 6)** | The bridge decode stage's bound, in `docs/protocol.md`'s bounded-buffering table | unchanged | yes for bursts of ≤ 6 during the first frame | memory: two more **compressed** AUs (~70 KB typical, ≤ 1.3 MB if both were IDRs). Latency: only while backlogged — at ~9 ms service, two more slots add ≤ ~18 ms and drain in ~50 ms after the first frame; steady state stays at ≤ 1 waiting with 3.5× headroom. Contract change |

**Ruled out, whatever the trade-off:** skipping a reference frame and continuing to decode as though the
chain were intact. The existing admission rule — drop the newest non-IDR, then refuse until an IDR — is
correct and stays.

**Recommendation, for approval:** A first (no contract change, removes a third of the stall), then the
next supervised run with these diagnostics to name the field's cause. If recovery gaps remain visible
after that, **B** is the real fix for the gap from any cause, with the limits above. D is cheap but
changes the contract for a burst that has not yet been measured in the field. C is not recommended: it
trades picture quality for every user against a recovery that B shortens further.

## 6. A second finding, from writing the tests — not fixed

**After a decode *failure*, P-frames already waiting in the stage are still decoded.** The gate refuses
everything new, but the up to 4 AUs admitted before the failure reference a picture the decoder never
produced, and the loop decodes them anyway (`diag.chain.decodedAfterFailure`; on this Mac VideoToolbox
returned a picture for both in the test). That is decoding as though the chain were intact. The fix
would be to drop the waiting non-IDRs on a decode failure, the same way an IDR flush drops them; the cost
is up to 4 frames that would otherwise be shown with artefacts. It changes the bridge's drop rule, so it
is proposed here rather than made. (Compose failures are different: the decode chain is intact, and the
current rule refuses frames that could have been shown — conservative, not wrong.)

## 7. What would settle the field cause

One supervised spike with the current probe, which now prints `pipeline: overflow …` at exit and carries
the `diag.*` counters in its report. **It needs its own approval** — none was given for a new capture.
