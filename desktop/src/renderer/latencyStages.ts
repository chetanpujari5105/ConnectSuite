/**
 * Where a frame's latency is spent — and the anchor bug that hid one whole stage.
 *
 * ### What was wrong
 *
 * `mirror.stats` carries `ptsUs` and `monoUs` for one recently encoded frame, and the contract
 * describes them as *"the PTS of a recently encoded frame and the phone's monotonic clock reading
 * for that same frame"* — a sentence that never says **which moment** in that frame's life. The two
 * are not the same moment:
 *
 * | field | stamped | by |
 * |---|---|---|
 * | `ptsUs` | when the display pipeline composited the frame — **capture** | the Surface |
 * | `monoUs` | `System.nanoTime()` at `dequeueOutputBuffer` — **after encoding** | our own loop |
 *
 * The Mac anchored capture time to `monoUs`:
 *
 *     capturedAtPhoneMs = (ptsUs - anchorPts)/1000 + anchorMono/1000
 *
 * For the anchor frame that returns `anchorMono` — the instant it *left the encoder*. So every
 * reported total was short by the anchor frame's encode duration, constantly, until the next
 * anchor. **The encode stage was not measured; it was subtracted.** Figures of 9, 11, 99 and 134 ms
 * were all quoted against that origin.
 *
 * ### The fix needs no protocol change, and that is the point
 *
 * Both timestamps were already on the wire. They were being read as one anchor pair instead of as
 * two stage boundaries, so the repair is arithmetic rather than a new field:
 *
 *     encodeLagUs = monoUs - ptsUs        ← a stage, on the phone, for the anchor frame
 *     capturedAtPhoneUs = ptsUs           ← the capture instant, directly
 *
 * This holds **only if PTS shares a timebase with `System.nanoTime()`**, which is the one thing that
 * has to be measured rather than assumed — see [timebaseVerdict]. If it does not, capture time is
 * not knowable on the phone at all (nothing in the app observes the frame before the encoder hands
 * it back), and the honest report is a pipeline that starts at encode-output, labelled as such.
 * Guessing between those two is exactly how the stage went missing in the first place.
 */

/** Microseconds. A frame's life, as far as the two ends can actually see it. */
interface StageInput {
  /** The frame's PTS — the capture instant if the timebase is shared. */
  ptsUs: number;
  /** The anchor frame's PTS and monotonic reading at encoder output, from `mirror.stats`. */
  anchor: { ptsUs: number; monoUs: number } | null;
  /** Phone monotonic ms → this Mac's `Date.now()` ms, from the pong estimator. */
  clockOffsetMs: number | undefined;
  /** `Date.now()` when the access unit finished arriving on the Mac. */
  arrivedAtMs: number | null;
  /** `Date.now()` when the frame was painted. */
  paintedAtMs: number;
}

/**
 * Is PTS on the same clock as `System.nanoTime()`?
 *
 * The whole anchor fix rests on this, and it is answerable from two numbers already on the wire:
 * `monoUs - ptsUs` is the encode lag when the timebases match, and roughly the phone's uptime when
 * PTS has been rebased to zero. Those differ by six orders of magnitude, so there is no judgement
 * call — but the middle band is reported as `unclear` rather than forced into one of the two,
 * because a verdict that cannot say "I don't know" will say something wrong instead.
 */
type Timebase = 'shared' | 'rebased' | 'unclear';

function timebaseVerdict(anchor: { ptsUs: number; monoUs: number } | null): {
  verdict: Timebase;
  lagUs: number | null;
  why: string;
} {
  if (!anchor || anchor.monoUs <= 0 || anchor.ptsUs <= 0) {
    return { verdict: 'unclear', lagUs: null, why: 'no anchor pair yet' };
  }
  const lagUs = anchor.monoUs - anchor.ptsUs;
  if (lagUs < 0) {
    // Encoder output before capture is impossible on one clock, so the two are not one clock.
    return { verdict: 'rebased', lagUs, why: 'monoUs precedes ptsUs, which one clock cannot do' };
  }
  if (lagUs <= 500_000) {
    return { verdict: 'shared', lagUs, why: `encode lag ${(lagUs / 1000).toFixed(1)} ms — a plausible encode duration` };
  }
  return {
    verdict: 'rebased',
    lagUs,
    why: `monoUs - ptsUs is ${(lagUs / 1e6).toFixed(0)} s, which is an uptime, not an encode`,
  };
}

/** Every stage this pair of machines can actually see, in milliseconds. Null where unknowable. */
interface Stages {
  /**
   * Whether the encode/wire **split** can be trusted for this frame.
   *
   * `capture → arrived` is a real measured interval. Splitting it into encode and wire is not: the
   * encode figure is sampled from **one frame every two seconds** (`mirror.stats`) and applied to
   * every frame in between. When that sampled frame encoded unusually slowly — a keyframe, or one
   * that waited — the estimate overshoots and `wireMs` comes out **negative**, which is physically
   * impossible and is therefore the split telling on itself.
   *
   * Found by the first mark ever taken: `encode 34.6 ms, wire -8.0 ms` against a measured encode of
   * 14-18 ms in the slices before it. The totals were right; the division was not. A clamp here
   * would have hidden exactly the signal that revealed it, so nothing is clamped — the flag says the
   * split is unreliable and the caller reports the total instead.
   */
  splitReliable: boolean;
  /** Capture → encoder output, sampled from the anchor frame. Null unless the timebase is shared. */
  encodeMs: number | null;
  /** Encoder output → arrival on the Mac. Phone queue + socket write + wire, not yet separable. */
  wireMs: number | null;
  /** Arrival → painted. Mac IPC + WebCodecs decode + canvas. */
  macMs: number | null;
  /** Capture → painted. The figure a person feels. */
  totalMs: number | null;
  /** Which origin the total is measured from — the sentence that was missing. */
  origin: 'capture' | 'encoder-output';
}

function stagesFor(input: StageInput): Stages {
  const { verdict, lagUs } = timebaseVerdict(input.anchor);
  const offset = input.clockOffsetMs;
  if (offset === undefined || !input.anchor) {
    return { encodeMs: null, wireMs: null, macMs: null, totalMs: null, origin: 'encoder-output', splitReliable: true };
  }

  const macMs = input.arrivedAtMs === null ? null : input.paintedAtMs - input.arrivedAtMs;

  if (verdict === 'shared' && lagUs !== null) {
    // PTS is the capture instant on the phone's monotonic clock.
    const capturedAtMac = input.ptsUs / 1000 + offset;
    const encodedAtMac = capturedAtMac + lagUs / 1000;
    const wireMs = input.arrivedAtMs === null ? null : input.arrivedAtMs - encodedAtMac;
    return {
      encodeMs: lagUs / 1000,
      wireMs,
      macMs,
      totalMs: input.paintedAtMs - capturedAtMac,
      origin: 'capture',
      // Negative wire is impossible, so it is the sampled encode estimate exceeding this frame's
      // real pipeline. Reported, never clamped.
      splitReliable: wireMs === null ? true : wireMs >= 0,
    };
  }

  // PTS cannot be trusted as a wall-clock capture instant. Report from encoder output and **say
  // so** — the old code reported exactly this number and called it capture-to-paint.
  const encodedAtPhoneMs = (input.ptsUs - input.anchor.ptsUs) / 1000 + input.anchor.monoUs / 1000;
  const encodedAtMac = encodedAtPhoneMs + offset;
  return {
    encodeMs: null,
    wireMs: input.arrivedAtMs === null ? null : input.arrivedAtMs - encodedAtMac,
    macMs,
    totalMs: input.paintedAtMs - encodedAtMac,
    origin: 'encoder-output',
    // No encode figure is claimed in this branch, so there is no split to be unreliable.
    splitReliable: true,
  };
}

/** The median of a list, or null for an empty one. A median over nothing is not zero. */
function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((p, q) => p - q);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

// Plain-script globals for the page; module.exports for `node --test`. Never `export` — defect 94.
(globalThis as unknown as Record<string, unknown>).timebaseVerdict = timebaseVerdict;
(globalThis as unknown as Record<string, unknown>).stagesFor = stagesFor;
(globalThis as unknown as Record<string, unknown>).medianOf = medianOf;
if (typeof module !== 'undefined') module.exports = { timebaseVerdict, stagesFor, medianOf };
