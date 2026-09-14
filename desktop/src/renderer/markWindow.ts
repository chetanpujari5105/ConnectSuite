/**
 * What the stages looked like around the moment a person said "that was bad".
 *
 * ### Why this exists
 *
 * Slices 46 and 47 measured the mirror pipeline at idle, 60 fps and 120 fps and found it clean:
 * nothing dropped, ~25 ms capture-to-paint, peak under 40 ms. Three named suspects all failed. So
 * the transport has been instrumented as far as instrumenting it is worth, and **the only instrument
 * left is the person watching**.
 *
 * A description after the fact is not a reading — it carries no timestamp, so it cannot be matched
 * against anything. This turns "that felt wrong" into a bounded window with numbers in it, taken
 * while the session is still live.
 *
 * ### What a mark is, and what it deliberately is not
 *
 * It is **the stages over the seconds before the key was pressed**, because the thing being reported
 * has already happened by the time a hand reaches a keyboard. Human reaction to a visual glitch is
 * a few hundred milliseconds, and people press a key after deciding rather than at the instant, so
 * the window reaches back seconds and reports the **worst** sample in it as well as the median. A
 * median over a window containing one 300 ms stall would hide the stall, which is the entire event.
 *
 * It is **not** a verdict. If every mark comes back clean that is a real answer — it means what is
 * being called unsmooth is not latency — and this must not launder that into "no problem found" by
 * summarising the window into a single number.
 */

interface MarkSample {
  /** `Date.now()` when the frame was painted. */
  at: number;
  totalMs: number;
  encodeMs: number | null;
  wireMs: number | null;
  macMs: number | null;
  /** False when the encode/wire split overshot for this frame — see latencyStages.ts. */
  splitReliable?: boolean;
}

interface MarkSummary {
  label: string;
  markedAt: number;
  windowMs: number;
  /** How many painted frames fell inside the window. The denominator for everything below. */
  samples: number;
  /** Frames per second across the window, computed from the samples' own timestamps. */
  fps: number | null;
  medianTotalMs: number | null;
  /** The worst frame in the window. The event, if there was one. */
  worstTotalMs: number | null;
  /** The gap between consecutive painted frames — a stall shows here and nowhere else. */
  longestGapMs: number | null;
  medianEncodeMs: number | null;
  medianWireMs: number | null;
  medianMacMs: number | null;
  /**
   * True when nothing in the window stands out: no sample far above the median and no gap far above
   * the frame interval. **A clean mark is a finding, not an absence of one.**
   */
  clean: boolean;
  why: string;
  /**
   * How many frames in the window had an untrustworthy encode/wire split. **Not** a reason to call
   * the mark dirty — the total is still sound — but a reason not to read the two halves.
   */
  unreliableSplits: number;
}

function markMedian(xs: readonly (number | null)[]): number | null {
  const a = xs.filter((x): x is number => typeof x === 'number').sort((p, q) => p - q);
  if (a.length === 0) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/**
 * Summarise the samples falling inside `windowMs` before `markedAt`.
 *
 * `clean` is decided against the window's own median rather than a fixed threshold, because 25 ms is
 * good at 120 fps and terrible at 1 fps, and a constant would be wrong at one of them. A frame is
 * an outlier at **three times** the median total, and a gap is a stall at **three times** the median
 * interval between paints — both deliberately loose, so that a mark called dirty really is.
 */
function summariseMark(
  samples: readonly MarkSample[],
  markedAt: number,
  windowMs: number,
  label: string,
): MarkSummary {
  const inWindow = samples.filter((s) => s.at <= markedAt && s.at >= markedAt - windowMs);
  const base: MarkSummary = {
    label,
    markedAt,
    windowMs,
    samples: inWindow.length,
    fps: null,
    medianTotalMs: null,
    worstTotalMs: null,
    longestGapMs: null,
    medianEncodeMs: null,
    medianWireMs: null,
    medianMacMs: null,
    clean: false,
    why: '',
    unreliableSplits: 0,
  };
  if (inWindow.length === 0) {
    // No painted frames at all in the window is the loudest possible reading, and it must never be
    // reported as "clean" — an empty window is the picture being frozen.
    return { ...base, why: 'NO FRAMES PAINTED in the window — the picture was stopped, not slow' };
  }

  const ordered = [...inWindow].sort((a, b) => a.at - b.at);
  const totals = ordered.map((s) => s.totalMs);
  const medianTotal = markMedian(totals)!;
  const worst = Math.max(...totals);

  let longestGap: number | null = null;
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i]!.at - ordered[i - 1]!.at;
    gaps.push(gap);
    if (longestGap === null || gap > longestGap) longestGap = gap;
  }
  const medianGap = markMedian(gaps);
  const spanMs = ordered[ordered.length - 1]!.at - ordered[0]!.at;
  const fps = spanMs > 0 ? ((ordered.length - 1) / spanMs) * 1000 : null;

  const latencyOutlier = worst > medianTotal * 3;
  const stall = longestGap !== null && medianGap !== null && medianGap > 0 && longestGap > medianGap * 3;

  const reasons: string[] = [];
  if (latencyOutlier) reasons.push(`worst frame ${worst.toFixed(0)} ms against a median of ${medianTotal.toFixed(0)} ms`);
  if (stall) reasons.push(`longest gap between paints ${longestGap!.toFixed(0)} ms against a median of ${medianGap!.toFixed(0)} ms`);

  return {
    ...base,
    unreliableSplits: ordered.filter((x) => x.splitReliable === false).length,
    fps,
    medianTotalMs: medianTotal,
    worstTotalMs: worst,
    longestGapMs: longestGap,
    medianEncodeMs: markMedian(ordered.map((s) => s.encodeMs)),
    medianWireMs: markMedian(ordered.map((s) => s.wireMs)),
    medianMacMs: markMedian(ordered.map((s) => s.macMs)),
    clean: !latencyOutlier && !stall,
    why: reasons.length > 0
      ? reasons.join('; ')
      : 'nothing stands out — no frame far above the median and no gap far above the interval',
  };
}

// Plain-script globals for the page; module.exports for `node --test`. Never `export` — defect 94.
(globalThis as unknown as Record<string, unknown>).summariseMark = summariseMark;
if (typeof module !== 'undefined') module.exports = { summariseMark };
