import { test } from 'node:test';
import assert from 'node:assert/strict';

const { timebaseVerdict, stagesFor, medianOf } = require('./latencyStages') as {
  timebaseVerdict: (a: { ptsUs: number; monoUs: number } | null) => {
    verdict: 'shared' | 'rebased' | 'unclear'; lagUs: number | null; why: string;
  };
  stagesFor: (i: {
    ptsUs: number;
    anchor: { ptsUs: number; monoUs: number } | null;
    clockOffsetMs: number | undefined;
    arrivedAtMs: number | null;
    paintedAtMs: number;
  }) => { encodeMs: number | null; wireMs: number | null; macMs: number | null; totalMs: number | null; origin: string; splitReliable: boolean };
  medianOf: (xs: readonly number[]) => number | null;
};

/**
 * The anchor bug: `monoUs` is stamped at encoder *output* and was used as the *capture* instant, so
 * every published total was short by the anchor frame's encode duration — silently, and constantly.
 */

// ---- the timebase question ----------------------------------------------------------------------

test('a small positive lag is an encode duration, so the clocks are shared', () => {
  const v = timebaseVerdict({ ptsUs: 81_234_567, monoUs: 81_240_567 });
  assert.equal(v.verdict, 'shared');
  assert.equal(v.lagUs, 6_000);
  assert.match(v.why, /6\.0 ms/);
});

test('a lag the size of an uptime means PTS was rebased, not encoded slowly', () => {
  // Six orders of magnitude apart, so there is no judgement call between these two.
  const v = timebaseVerdict({ ptsUs: 1_000, monoUs: 840_000_000 });
  assert.equal(v.verdict, 'rebased');
  assert.match(v.why, /uptime/);
});

test('output before capture is impossible on one clock', () => {
  assert.equal(timebaseVerdict({ ptsUs: 500, monoUs: 100 }).verdict, 'rebased');
});

test('no anchor is unclear, and unclear is a third answer rather than a guess', () => {
  // A verdict that cannot say "I don't know" says something wrong instead.
  const v = timebaseVerdict(null);
  assert.equal(v.verdict, 'unclear');
  assert.equal(v.lagUs, null);
});

// ---- the stages ----------------------------------------------------------------------------------

test('THE DEFECT — the old anchor loses exactly the encode duration', () => {
  // One frame, 6 ms of encode, arriving 20 ms after capture and painted 5 ms after that.
  const anchor = { ptsUs: 1_000_000, monoUs: 1_006_000 };
  const s = stagesFor({
    ptsUs: 1_000_000,
    anchor,
    clockOffsetMs: 0,
    arrivedAtMs: 1_020,
    paintedAtMs: 1_025,
  });
  assert.equal(s.origin, 'capture');
  assert.equal(s.encodeMs, 6);
  assert.equal(s.totalMs, 25);
  // The old computation anchored capture to monoUs and would have reported 19 — the 6 ms of encode
  // silently removed from the front. That difference IS the defect.
  const oldTotal = s.totalMs! - s.encodeMs!;
  assert.equal(oldTotal, 19);
});

test('the stages add up to the total, so nothing is unaccounted for', () => {
  const s = stagesFor({
    ptsUs: 2_000_000,
    anchor: { ptsUs: 2_000_000, monoUs: 2_004_000 },
    clockOffsetMs: 0,
    arrivedAtMs: 2_030,
    paintedAtMs: 2_038,
  });
  assert.equal(s.encodeMs! + s.wireMs! + s.macMs!, s.totalMs);
});

test('a rebased timebase reports from encoder output and SAYS so', () => {
  // The old code reported exactly this number and called it capture-to-paint. The number is fine;
  // the label was the lie.
  const s = stagesFor({
    ptsUs: 5_000,
    anchor: { ptsUs: 4_000, monoUs: 900_000_000 },
    clockOffsetMs: 0,
    arrivedAtMs: 900_020,
    paintedAtMs: 900_025,
  });
  assert.equal(s.origin, 'encoder-output');
  assert.equal(s.encodeMs, null, 'encode is not knowable when PTS is rebased — null, never 0');
  assert.equal(s.totalMs, 24);
});

test('an unknown clock offset yields no stages at all, rather than stages measured from zero', () => {
  const s = stagesFor({
    ptsUs: 1, anchor: { ptsUs: 1, monoUs: 2 }, clockOffsetMs: undefined,
    arrivedAtMs: 10, paintedAtMs: 20,
  });
  assert.deepEqual(
    [s.encodeMs, s.wireMs, s.macMs, s.totalMs],
    [null, null, null, null],
  );
});

test('a frame with no recorded arrival still yields a total, and null for the halves', () => {
  const s = stagesFor({
    ptsUs: 1_000_000, anchor: { ptsUs: 1_000_000, monoUs: 1_003_000 },
    clockOffsetMs: 0, arrivedAtMs: null, paintedAtMs: 1_030,
  });
  assert.equal(s.totalMs, 30);
  assert.equal(s.encodeMs, 3);
  assert.equal(s.wireMs, null);
  assert.equal(s.macMs, null);
});

test('the clock offset moves every stage boundary together, not the durations', () => {
  const base = {
    ptsUs: 1_000_000, anchor: { ptsUs: 1_000_000, monoUs: 1_005_000 },
    arrivedAtMs: 1_020, paintedAtMs: 1_030,
  };
  const a = stagesFor({ ...base, clockOffsetMs: 0 });
  const b = stagesFor({ ...base, clockOffsetMs: 0, arrivedAtMs: 1_020, paintedAtMs: 1_030 });
  assert.deepEqual(a, b);
  // A different offset shifts when capture happened, so durations from it change by that much —
  // which is why a jittery offset shows as swinging latency with nothing wrong on the link.
  const shifted = stagesFor({ ...base, clockOffsetMs: 5 });
  assert.equal(shifted.totalMs, a.totalMs! - 5);
});

// ---- the median ----------------------------------------------------------------------------------

test('a median over nothing is null, never zero', () => {
  // A zero here would publish "0 ms" for a stage that was never measured — the counter-that-cannot-
  // move failure, one file over.
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([4]), 4);
  assert.equal(medianOf([1, 3]), 2);
  assert.equal(medianOf([5, 1, 3]), 3);
});

// ---- the split that tells on itself ---------------------------------------------------------------

test('a negative wire stage is impossible, so the split is flagged rather than clamped', () => {
  // Found by the first mark ever taken: encode 34.6 ms against a wire of -8.0 ms. The encode figure
  // is sampled once every two seconds and applied to every frame between; when that one frame
  // encoded slowly, the estimate overshoots. The total is still right.
  const s = stagesFor({
    ptsUs: 1_000_000,
    anchor: { ptsUs: 1_000_000, monoUs: 1_034_000 },   // a 34 ms encode sample
    clockOffsetMs: 0,
    arrivedAtMs: 1_026,                                 // this frame arrived 26 ms after capture
    paintedAtMs: 1_028,
  });
  assert.equal(s.splitReliable, false);
  assert.ok(s.wireMs! < 0, `${s.wireMs}`);
  // Not clamped: the negative IS the signal, and a clamp would have hidden what revealed this.
  assert.equal(s.totalMs, 28, 'the total is a real measured interval and stays sound');
});

test('control — an ordinary frame has a reliable split', () => {
  const s = stagesFor({
    ptsUs: 1_000_000,
    anchor: { ptsUs: 1_000_000, monoUs: 1_014_000 },
    clockOffsetMs: 0,
    arrivedAtMs: 1_020,
    paintedAtMs: 1_025,
  });
  assert.equal(s.splitReliable, true);
  assert.equal(s.encodeMs, 14);
  assert.equal(s.wireMs, 6);
});

test('a frame with no arrival has nothing to split, so it is not flagged unreliable', () => {
  const s = stagesFor({
    ptsUs: 1_000_000, anchor: { ptsUs: 1_000_000, monoUs: 1_050_000 },
    clockOffsetMs: 0, arrivedAtMs: null, paintedAtMs: 1_030,
  });
  assert.equal(s.splitReliable, true);
});
