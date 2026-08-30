/**
 * The float window's geometry, against the README that specifies it.
 *
 * The README records this as an invariant learned from a real bug — a window that was legal while
 * being dragged and off the desktop after a preset — so the tests are written against the failure
 * rather than against the formula: each one describes a way out of the work area and asserts it is
 * closed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TITLE,
  RATIO,
  MARGIN,
  MIN_WIDTH,
  DEFAULT_WIDTH,
  heightFor,
  maxWidthFor,
  clampWidth,
  clampX,
  clampY,
  resolveBounds,
  boundsForDrag,
  boundsForCornerDrag,
} from './floatGeometry.ts';

/** The design's own window, and the numbers the README quotes against it. */
const DESIGN: { width: number; height: number } = { width: 1440, height: 920 };

test('the transcription agrees with the figure the README quotes', () => {
  // "maxWidth() = floor((920 - TITLE - MARGIN*2) / RATIO)   // ≈ 401 at 920px tall".
  //
  // This is the control on the whole file: it checks the constants were copied correctly, without
  // trusting either the code or my reading of the document alone. If TITLE, RATIO or MARGIN were
  // mistyped, every other test here would still pass — they would just be testing a different
  // window — and this is the one that would not.
  assert.equal(maxWidthFor(DESIGN.height), 401);
  assert.equal(TITLE, 34);
  assert.equal(MARGIN, 8);
  assert.equal(RATIO, 19.5 / 9);
});

test('height follows from width, and width is the only input', () => {
  assert.equal(heightFor(300), Math.round(300 * RATIO) + TITLE);
  assert.equal(heightFor(DEFAULT_WIDTH), 684);
  // The ratio holds across the range rather than at one convenient value.
  for (const width of [MIN_WIDTH, 260, 300, 350, 401]) {
    assert.equal(heightFor(width) - TITLE, Math.round(width * RATIO));
  }
});

test('maxWidth is derived from the available height, not hard-coded', () => {
  // The bug this guards is a 401 pasted in as a constant. A shorter work area — a smaller display,
  // or a Mac whose menu bar and Dock have taken their cut — must produce a smaller cap.
  assert.ok(maxWidthFor(800) < maxWidthFor(920));
  assert.ok(maxWidthFor(1400) > maxWidthFor(920));
  // And the window it produces actually fits, which is the property the number exists for.
  for (const height of [600, 800, 920, 1080, 1440]) {
    assert.ok(
      heightFor(maxWidthFor(height)) + MARGIN * 2 <= height,
      `a max-width window does not fit in ${height}pt`,
    );
  }
});

test('a size preset cannot escape the desktop — the README names this one', () => {
  // "Clamping drag alone is not enough — presets and corner-resize escape the desktop without it."
  //
  // A window sitting low, then grown by a preset: its Y was legal for the old width and is not for
  // the new one. Nothing about this gesture involves a drag, which is exactly why clamping drag
  // alone missed it.
  const low = resolveBounds({ x: 900, y: 700, width: 240 }, DESIGN);
  assert.equal(low.y + low.height + MARGIN <= DESIGN.height, true);

  const grown = resolveBounds({ x: low.x, y: low.y, width: 401 }, DESIGN);
  assert.ok(grown.y < low.y, 'growing the window did not pull it back up the screen');
  assert.ok(
    grown.y + grown.height + MARGIN <= DESIGN.height,
    'the preset left the window hanging off the bottom',
  );
});

test('a corner drag cannot escape the desktop either', () => {
  // The same failure by the other gesture: width driven up by a corner drag while Y stays put.
  let bounds = resolveBounds({ x: 1000, y: 600, width: MIN_WIDTH }, DESIGN);
  for (let width = MIN_WIDTH; width <= 500; width += 10) {
    bounds = resolveBounds({ x: bounds.x, y: bounds.y, width }, DESIGN);
    assert.ok(
      bounds.y >= MARGIN && bounds.y + bounds.height + MARGIN <= DESIGN.height,
      `width ${width} put the window off the desktop at y=${bounds.y}`,
    );
    assert.ok(bounds.width <= maxWidthFor(DESIGN.height), 'the corner drag beat the width cap');
  }
});

test('smart-fit returns to the medium default and re-clamps Y with it', () => {
  // "Double-click title bar (or green light) → Smart-fit back to the 300px medium default", and
  // the state table's "Double-click title bar → width = 300, then re-clamp Y".
  const wide = resolveBounds({ x: 20, y: 20, width: 401 }, DESIGN);
  const fitted = resolveBounds({ x: wide.x, y: wide.y, width: DEFAULT_WIDTH }, DESIGN);
  assert.equal(fitted.width, DEFAULT_WIDTH);
  assert.equal(fitted.height, heightFor(DEFAULT_WIDTH));
  assert.ok(fitted.y >= MARGIN);
});

test('width is clamped to [220, maxWidth]', () => {
  assert.equal(clampWidth(10, DESIGN.height), MIN_WIDTH);
  assert.equal(clampWidth(9999, DESIGN.height), 401);
  assert.equal(clampWidth(300, DESIGN.height), 300);
});

test('a work area too short for the minimum window still yields a legal Y', () => {
  // The inner Math.max in clampY. On a work area shorter than the smallest possible window the
  // upper bound goes negative, and without the guard Y would clamp to a value above the top edge —
  // a window dragged off the top of the screen, which on macOS cannot be dragged back.
  const tiny = { width: 400, height: 200 };
  const bounds = resolveBounds({ x: 0, y: 0, width: MIN_WIDTH }, tiny);
  assert.equal(bounds.y, MARGIN);
  assert.ok(bounds.y >= MARGIN, 'the window was placed above the top of the work area');
});

test('X is clamped against the work area width, independently of the ratio', () => {
  assert.equal(clampX(-500, 300, DESIGN.width), MARGIN);
  assert.equal(clampX(9999, 300, DESIGN.width), DESIGN.width - 300 - MARGIN);
  assert.equal(clampX(500, 300, DESIGN.width), 500);
});

test('every resolved window is legal, from any requested position at any width', () => {
  // The invariant stated once over the whole input space rather than per gesture, because the
  // gestures are just names for calls into resolveBounds and a new one must not need a new test.
  for (const x of [-9999, -1, 0, 700, 5000]) {
    for (const y of [-9999, -1, 0, 500, 5000]) {
      for (const width of [-10, 0, MIN_WIDTH, 300, 401, 9999]) {
        const b = resolveBounds({ x, y, width }, DESIGN);
        assert.ok(b.width >= MIN_WIDTH && b.width <= maxWidthFor(DESIGN.height));
        assert.equal(b.height, heightFor(b.width));
        assert.ok(b.x >= MARGIN && b.x + b.width + MARGIN <= DESIGN.width);
        assert.ok(b.y >= MARGIN && b.y + b.height + MARGIN <= DESIGN.height);
      }
    }
  }
});

/*
 * The two drag gestures. Both are written against the failure the README names — a window that is
 * legal mid-gesture and illegal after it — rather than against the arithmetic.
 */

test('a drag holds the grab point under the cursor instead of snapping the corner to it', () => {
  // Grabbed 120pt in and 12pt down the title bar; the pointer then moves to (500, 300). The window
  // must land at (380, 288), not at (500, 300) — snapping is the bug this offset exists to prevent.
  const bounds = boundsForDrag({ x: 500, y: 200 }, { x: 120, y: 12 }, DEFAULT_WIDTH, DESIGN);
  assert.equal(bounds.x, 380);
  assert.equal(bounds.y, 188);
  assert.equal(bounds.width, DEFAULT_WIDTH);
  assert.equal(bounds.height, heightFor(DEFAULT_WIDTH));
});

test('a drag toward an edge is clamped by the same expression a preset is', () => {
  // The point of routing drag through resolveBounds: the two gestures cannot disagree about where
  // the desktop ends. Drag hard into the bottom-right and assert it lands exactly where a preset
  // asking for the same illegal position would.
  const dragged = boundsForDrag({ x: 9999, y: 9999 }, { x: 0, y: 0 }, DEFAULT_WIDTH, DESIGN);
  const preset = resolveBounds({ x: 9999, y: 9999, width: DEFAULT_WIDTH }, DESIGN);
  assert.deepEqual(dragged, preset);
  assert.ok(dragged.y + dragged.height + MARGIN <= DESIGN.height);
  assert.ok(dragged.x + dragged.width + MARGIN <= DESIGN.width);
});

test('a corner drag resizes without moving the window it is anchored to', () => {
  // The failure this closes is a corner drag that also drags: the top-left must stay put for the
  // whole gesture, or the window walks across the desktop while being resized. Y is still re-read
  // through the clamp, because growing tall enough can legitimately push the window back up.
  const origin = { x: 100, y: 60 };
  for (const width of [MIN_WIDTH, 260, 340, 401]) {
    const bounds = boundsForCornerDrag({ x: origin.x + width }, origin, DESIGN);
    assert.equal(bounds.x, origin.x, `corner drag moved X at width ${width}`);
    assert.equal(bounds.width, width);
    // Height is derived from width and from nothing else — the whole 9:19.5 lock in one assertion.
    assert.equal(bounds.height, heightFor(width));
    assert.equal(bounds.y, clampY(origin.y, width, DESIGN.height));
  }
});

test('a corner drag inward stops at the minimum width rather than inverting the window', () => {
  // Dragging the corner back past the window's own left edge asks for a negative width. Clamped,
  // not honoured: a negative width would make heightFor negative and place the window above the
  // top edge, where macOS gives no way to drag it back.
  const bounds = boundsForCornerDrag({ x: 40 }, { x: 100, y: 60 }, DESIGN);
  assert.equal(bounds.width, MIN_WIDTH);
  assert.equal(bounds.height, heightFor(MIN_WIDTH));
  assert.ok(bounds.y >= MARGIN);
});
