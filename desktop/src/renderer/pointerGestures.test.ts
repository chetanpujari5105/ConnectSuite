import { test } from 'node:test';
import assert from 'node:assert/strict';

const { GestureRecogniser, DRAG_POINT_SPACING, MAX_DRAG_POINTS, MIN_TAP_MS, MIN_SWIPE_MS, MAX_GESTURE_MS } =
  require('./pointerGestures') as {
    GestureRecogniser: new (now?: () => number) => {
      pressing: boolean;
      cancelled: boolean;
      down(p: unknown): 'started' | 'no-geometry';
      move(p: unknown): void;
      cancelForTurn(): void;
      up(p: unknown): { kind: string; reason?: string; x?: number; y?: number; points?: { x: number; y: number }[]; durationMs?: number; geom?: unknown };
    };
    DRAG_POINT_SPACING: number; MAX_DRAG_POINTS: number;
    MIN_TAP_MS: number; MIN_SWIPE_MS: number; MAX_GESTURE_MS: number;
  };

const GEOM = { id: 7, width: 1080, height: 2340 };
const at = (x: number, y: number) => ({ x, y, geom: GEOM });

/**
 * The gesture recogniser both windows share.
 *
 * Extracted from `MirrorView` so the float does not get a second copy — a second copy is the copy
 * that does not get the next fix, and the three things in here (mapping stamp, drag cancellation,
 * staleness) are defects 19 and 20.
 */

// ---- the drag cancellation, which is defect 19 ---------------------------------------------------

test('a turn mid-press cancels the gesture AND says why on release', () => {
  // A press that silently vanishes is the defect. The reason has to survive to the release, which
  // is why cancellation is a flag rather than just dropping the drag.
  const g = new GestureRecogniser(() => 1000);
  g.down(at(10, 10));
  g.move(at(80, 80));
  g.cancelForTurn();
  assert.equal(g.pressing, false);
  const r = g.up(at(90, 90));
  assert.equal(r.kind, 'none');
  assert.equal(r.reason, 'cancelled-by-turn');
});

test('the cancellation is reported once and then cleared', () => {
  const g = new GestureRecogniser(() => 0);
  g.down(at(0, 0));
  g.cancelForTurn();
  assert.equal(g.up(at(1, 1)).reason, 'cancelled-by-turn');
  // A second release with nothing pressed is not a cancelled turn — it never started.
  assert.equal(g.up(at(1, 1)).reason, 'never-started');
});

test('a turn with no press in flight cancels nothing', () => {
  const g = new GestureRecogniser(() => 0);
  g.cancelForTurn();
  assert.equal(g.cancelled, false);
  assert.equal(g.up(at(1, 1)).reason, 'never-started');
});

// ---- the staleness stamp, which is defect 20 -----------------------------------------------------

test('the stamp on the RELEASE is what travels, not the one from the press', () => {
  // The phone refuses a gesture computed against a screen shape it has left. The release point
  // carries the current stamp, so a gesture that outlived a geometry is refused rather than landing
  // somewhere nobody aimed.
  const g = new GestureRecogniser(() => 0);
  g.down({ x: 0, y: 0, geom: { id: 7, width: 1080, height: 2340 } });
  g.move({ x: 50, y: 50, geom: { id: 7, width: 1080, height: 2340 } });
  const r = g.up({ x: 60, y: 60, geom: { id: 8, width: 2340, height: 1080 } });
  assert.deepEqual(r.geom, { id: 8, width: 2340, height: 1080 });
});

test('geometry going away between press and release sends nothing, with a reason', () => {
  const g = new GestureRecogniser(() => 0);
  g.down(at(0, 0));
  g.move(at(50, 50));
  const r = g.up(null);
  assert.equal(r.kind, 'none');
  assert.equal(r.reason, 'geometry-gone');
});

test('a press with no geometry never starts, and says so', () => {
  const g = new GestureRecogniser(() => 0);
  assert.equal(g.down(null), 'no-geometry');
  assert.equal(g.pressing, false);
});

// ---- tap against swipe ---------------------------------------------------------------------------

test('a press that never moved is a tap, and its duration is the user’s', () => {
  let t = 1000;
  const g = new GestureRecogniser(() => t);
  g.down(at(100, 200));
  t = 1450;
  const r = g.up(at(100, 200));
  assert.equal(r.kind, 'tap');
  assert.equal(r.durationMs, 450, 'a long press arrives as a long press, not a separate message');
  assert.equal(r.x, 100);
});

test('a tap is never shorter than the floor, so a flick still registers', () => {
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(1, 1));
  t = 1;
  assert.equal(g.up(at(1, 1)).durationMs, MIN_TAP_MS);
});

test('a gesture is clamped at the ceiling rather than refused', () => {
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(1, 1));
  t = 60_000;
  assert.equal(g.up(at(1, 1)).durationMs, MAX_GESTURE_MS);
});

test('movement makes it a swipe, and the release point is appended', () => {
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(0, 0));
  g.move(at(0, 40));
  t = 300;
  const r = g.up(at(0, 80));
  assert.equal(r.kind, 'swipe');
  assert.deepEqual(r.points, [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: 80 }]);
  assert.equal(r.durationMs, 300);
});

test('a swipe is never shorter than its own floor', () => {
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(0, 0));
  g.move(at(0, 40));
  t = 5;
  assert.equal(g.up(at(0, 80)).durationMs, MIN_SWIPE_MS);
});

// ---- accumulation and thinning -------------------------------------------------------------------

test('sub-pixel jitter is dropped, so a still finger stays a tap', () => {
  // Without this a hand resting on a trackpad turns every tap into a swipe.
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(100, 100));
  for (let i = 0; i < 20; i += 1) g.move(at(100 + (i % 2), 100));
  t = 200;
  assert.equal(g.up(at(100, 100)).kind, 'tap');
});

test('a point just past the spacing threshold IS recorded', () => {
  // The control for the test above: the filter must drop jitter and keep movement.
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(0, 0));
  g.move(at(DRAG_POINT_SPACING + 1, 0));
  t = 200;
  assert.equal(g.up(at(50, 0)).kind, 'swipe');
});

test('a long drag is thinned rather than truncated, and stays inside the protocol limit', () => {
  // Truncating would end the drag in the wrong place. Thinning keeps its shape.
  let t = 0;
  const g = new GestureRecogniser(() => t);
  g.down(at(0, 0));
  for (let i = 1; i <= 400; i += 1) g.move(at(i * 10, 0));
  t = 900;
  const r = g.up(at(5000, 0));
  assert.equal(r.kind, 'swipe');
  assert.ok(r.points!.length <= MAX_DRAG_POINTS, `${r.points!.length} points`);
  // The path still spans the whole drag: first and last are the real endpoints.
  assert.deepEqual(r.points![0], { x: 0, y: 0 });
  assert.deepEqual(r.points![r.points!.length - 1], { x: 5000, y: 0 });
});

test('moves are ignored when nothing is pressed', () => {
  const g = new GestureRecogniser(() => 0);
  g.move(at(10, 10));
  assert.equal(g.pressing, false);
  assert.equal(g.up(at(10, 10)).reason, 'never-started');
});
