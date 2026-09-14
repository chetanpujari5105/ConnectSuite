import { test } from 'node:test';
import assert from 'node:assert/strict';

const { summariseMark } = require('./markWindow') as {
  summariseMark: (
    samples: readonly { at: number; totalMs: number; encodeMs: number | null; wireMs: number | null; macMs: number | null }[],
    markedAt: number,
    windowMs: number,
    label: string,
  ) => {
    samples: number; fps: number | null; medianTotalMs: number | null; worstTotalMs: number | null;
    longestGapMs: number | null; clean: boolean; why: string;
  };
};

/** A steady stream at `fps`, every frame `totalMs` old when painted. */
function steady(fps: number, totalMs: number, seconds: number, endAt = 100_000) {
  const interval = 1000 / fps;
  const n = Math.round(fps * seconds);
  return Array.from({ length: n }, (_, i) => ({
    at: endAt - (n - 1 - i) * interval,
    totalMs,
    encodeMs: 14,
    wireMs: 6,
    macMs: 2,
  }));
}

test('a steady stream marks clean, and clean is a finding with a sentence', () => {
  const s = summariseMark(steady(60, 25, 5), 100_000, 5_000, 'felt fine');
  assert.equal(s.clean, true);
  assert.ok(s.samples > 250, `${s.samples} samples`);
  assert.ok(Math.abs(s.fps! - 60) < 1);
  assert.match(s.why, /nothing stands out/);
});

test('one bad frame in five seconds is caught, which a median alone would bury', () => {
  // The whole point: 299 good frames and one 300 ms frame. The median does not move.
  const samples = steady(60, 25, 5);
  samples[150] = { ...samples[150]!, totalMs: 300 };
  const s = summariseMark(samples, 100_000, 5_000, 'stutter');
  assert.equal(s.medianTotalMs, 25, 'the median is unmoved — that is why it cannot be the test');
  assert.equal(s.worstTotalMs, 300);
  assert.equal(s.clean, false);
  assert.match(s.why, /worst frame 300 ms/);
});

test('a stall shows as a gap between paints, not as latency at all', () => {
  // Frames that arrive late but evenly have good totals; the picture still froze. The gap is the
  // only place this appears, which is why it is measured separately.
  const samples = steady(60, 25, 5);
  const cut = samples.slice(0, 150).concat(samples.slice(180));
  const s = summariseMark(cut, 100_000, 5_000, 'froze');
  assert.equal(s.clean, false);
  assert.match(s.why, /longest gap between paints/);
  assert.ok(s.longestGapMs! > 400, `${s.longestGapMs}`);
});

test('an empty window is the loudest reading and is never clean', () => {
  // A frozen picture produces no samples at all. Reporting that as "clean" would invert the finding.
  const s = summariseMark([], 100_000, 5_000, 'nothing moved');
  assert.equal(s.samples, 0);
  assert.equal(s.clean, false);
  assert.match(s.why, /NO FRAMES PAINTED/);
});

test('the outlier test scales with the window, because 25 ms is good at 120fps and awful at 1fps', () => {
  // A fixed threshold would call this idle stream broken. It is not — it is idle.
  const idle = steady(1, 120, 10);
  const s = summariseMark(idle, 100_000, 10_000, 'idle');
  assert.equal(s.clean, true, s.why);
  // And the same stream with one frame five times the median is still caught.
  const withSpike = steady(1, 120, 10);
  withSpike[5] = { ...withSpike[5]!, totalMs: 600 };
  assert.equal(summariseMark(withSpike, 100_000, 10_000, 'idle spike').clean, false);
});

test('only samples inside the window count, so an old stall does not dirty a fresh mark', () => {
  const old = steady(60, 25, 5, 80_000);
  old[10] = { ...old[10]!, totalMs: 900 };
  const recent = steady(60, 25, 5, 100_000);
  const s = summariseMark([...old, ...recent], 100_000, 5_000, 'fresh');
  assert.equal(s.clean, true, s.why);
  assert.ok(s.worstTotalMs! < 100);
});

test('the window reaches BACK from the mark, because the event precedes the keypress', () => {
  // Samples after the mark are excluded: a person presses a key after deciding, so everything
  // relevant is already in the past.
  const before = steady(60, 25, 2, 100_000);
  const after = steady(60, 900, 2, 102_000).filter((x) => x.at > 100_000);
  const s = summariseMark([...before, ...after], 100_000, 5_000, 'after is not evidence');
  assert.equal(s.clean, true, s.why);
});
