/**
 * The app window's opening size, against the displays this was measured on.
 *
 * Written against the failure rather than against the formula. Every test below names a way the
 * window ends up larger than the screen it opens on and asserts that route is closed — and the two
 * work areas used are **readings, not examples**: taken from `screen.getAllDisplays()` on the Mac
 * that reported the bug, 2026-09-05.
 *
 * The distinction matters because of the trap in `CLAUDE.md`: a test that re-expresses the rule it
 * is checking (`Math.min(design, area - margin*2)`) would pass against any implementation of that
 * expression, including a wrong one. These assert concrete numbers on concrete work areas instead,
 * so the arithmetic has one home and the test calls it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DESIGN, MARGIN, MIN, sizeFor, minimumsFor, positionFor, fitWindow } from './windowGeometry.ts';

/**
 * The two displays on the Mac that reported this, read from Electron's own `screen` module.
 *
 * `BUILT_IN` is the one the defect is about: 982 tall, less a 33px menu bar and an 84px Dock.
 */
const BUILT_IN = { x: 0, y: 33, width: 1512, height: 865 };
const EXTERNAL = { x: 1512, y: 30, width: 1920, height: 1050 };

test('the design is unchanged on a display that can hold it', () => {
  // The control on the whole file. If `fitWindow` shrank unconditionally every other test here
  // would still pass — they would just be testing a smaller window — and this is the one that
  // would not. The handoff's grid is specified against exactly these numbers.
  const { bounds } = fitWindow(EXTERNAL);
  assert.equal(bounds.width, DESIGN.width);
  assert.equal(bounds.height, DESIGN.height);
});

test('the built-in display no longer receives a window taller than its work area', () => {
  // The defect, in one assertion. Before this module the request was a flat 920 against 865.
  const { bounds } = fitWindow(BUILT_IN);
  assert.ok(
    bounds.height <= BUILT_IN.height,
    `window is ${bounds.height} tall on a ${BUILT_IN.height} work area — this is the bug`,
  );
  assert.equal(bounds.height, BUILT_IN.height - MARGIN * 2);
  // ...and the axis that *did* fit is untouched. A short display must not cost width.
  assert.equal(bounds.width, DESIGN.width);
});

test('the whole window is inside the work area, not merely its origin', () => {
  for (const area of [BUILT_IN, EXTERNAL, { x: 0, y: 0, width: 1280, height: 800 }]) {
    const { bounds } = fitWindow(area);
    assert.ok(bounds.x >= area.x, `left edge ${bounds.x} outside ${area.x}`);
    assert.ok(bounds.y >= area.y, `top edge ${bounds.y} outside ${area.y}`);
    assert.ok(
      bounds.x + bounds.width <= area.x + area.width,
      `right edge ${bounds.x + bounds.width} past ${area.x + area.width}`,
    );
    assert.ok(
      bounds.y + bounds.height <= area.y + area.height,
      `bottom edge ${bounds.y + bounds.height} past ${area.y + area.height}`,
    );
  }
});

test('a window opening on the second display opens on the second display', () => {
  // `workArea.x` is 1512 there. A size-only fix that left the position at the primary's origin
  // would put the window on the wrong screen and nothing about its *size* would look wrong.
  const { bounds } = fitWindow(EXTERNAL);
  assert.ok(bounds.x >= EXTERNAL.x, `opened at x=${bounds.x}, left of the display it belongs to`);
});

test('the resize minimums cannot force a window taller than the screen', () => {
  // The subtle half. A display with less room than MIN.height: capping the opening size alone
  // leaves `minHeight: 700` to win and the window is oversized again by a different route.
  const cramped = { x: 0, y: 0, width: 1024, height: 600 };
  const { bounds, minimum } = fitWindow(cramped);
  assert.ok(minimum.height <= bounds.height, `minHeight ${minimum.height} exceeds the ${bounds.height} we opened at`);
  assert.ok(minimum.width <= bounds.width, `minWidth ${minimum.width} exceeds the ${bounds.width} we opened at`);
  assert.ok(bounds.height <= cramped.height && bounds.width <= cramped.width);
});

test('the minimums are kept whole wherever the display can honour them', () => {
  // The other direction, so the fix above cannot be "shrink the minimums always". Under 1100 the
  // Notifications and Mirror columns fight; that floor still has to exist on a normal display.
  assert.deepEqual(minimumsFor({ width: DESIGN.width, height: DESIGN.height }), { width: MIN.width, height: MIN.height });
});

test('a pathologically small work area yields no negative size', () => {
  const { bounds } = fitWindow({ x: 0, y: 0, width: 10, height: 10 });
  assert.ok(bounds.width >= 0 && bounds.height >= 0, `got ${bounds.width}x${bounds.height}`);
});

test('sizeFor caps each axis independently', () => {
  // Wide and short: height is reduced, width is not. A uniform scale would take both.
  const wideShort = sizeFor({ width: 3000, height: 700 });
  assert.equal(wideShort.width, DESIGN.width);
  assert.equal(wideShort.height, 700 - MARGIN * 2);
  // Narrow and tall: the mirror image.
  const narrowTall = sizeFor({ width: 1000, height: 2000 });
  assert.equal(narrowTall.width, 1000 - MARGIN * 2);
  assert.equal(narrowTall.height, DESIGN.height);
});

test('positionFor centres rather than pinning to the origin', () => {
  // Guards the lazy fix: returning `{x: area.x, y: area.y}` satisfies every containment assertion
  // above and puts the window in the corner of every screen.
  const { x, y } = positionFor(EXTERNAL, { width: DESIGN.width, height: DESIGN.height });
  assert.equal(x, EXTERNAL.x + Math.round((EXTERNAL.width - DESIGN.width) / 2));
  assert.equal(y, EXTERNAL.y + Math.round((EXTERNAL.height - DESIGN.height) / 2));
});
