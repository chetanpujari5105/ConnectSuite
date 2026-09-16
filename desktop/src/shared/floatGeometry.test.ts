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
  BOTTOM_BAR,
  RATIO,
  PORTRAIT_RATIO,
  MARGIN,
  MIN_WIDTH,
  DEFAULT_WIDTH,
  pictureWidthFor,
  heightFor,
  maxWidthFor,
  maxPictureWidthFor,
  clampWidth,
  clampX,
  clampY,
  resolveBounds,
  boundsForDrag,
  boundsForCornerDrag,
  boundsForRatioChange,
  ratioOfCapture,
  type WorkArea,
} from './floatGeometry.ts';

/**
 * The design's own window, and the numbers the README quotes against it.
 *
 * It carries an **origin** as of defect 113. Zero here, because the design's canvas is the primary
 * display — but the field exists, and the second-monitor tests below give it a real one.
 */
const DESIGN: WorkArea = { x: 0, y: 0, width: 1440, height: 920 };

/** A 1512-wide MacBook with a 1920-wide monitor to its right — the desk the bug was found on. */
const SECOND: WorkArea = { x: 1512, y: 0, width: 1920, height: 1080 };

/** And one to the LEFT, where the origin is negative and a sign error cannot hide. */
const LEFT: WorkArea = { x: -1920, y: -120, width: 1920, height: 1080 };

/** The phone in landscape: 2340x1080. */
const LANDSCAPE = 1080 / 2340;

test('the transcription agrees with the figure the README quotes', () => {
  // "maxWidth() = floor((920 - TITLE - MARGIN*2) / RATIO)   // ≈ 401 at 920px tall".
  //
  // This is the control on the whole file: it checks the constants were copied correctly, without
  // trusting either the code or my reading of the document alone. If TITLE, RATIO or MARGIN were
  // mistyped, every other test here would still pass — they would just be testing a different
  // window — and this is the one that would not.
  // Both numbers, so the document stays checkable beside the build rather than being redefined by a
  // change that made it smaller. The README assumes TITLE is the only vertical chrome and yields
  // 401; ours also carries BOTTOM_BAR and yields 383. Defect 118.
  assert.equal(Math.floor((DESIGN.height - TITLE - MARGIN * 2) / RATIO), 401, 'the README, transcribed');
  assert.equal(maxPictureWidthFor(DESIGN.height), 383, 'ours, one BOTTOM_BAR shorter');
  assert.equal(maxWidthFor(DESIGN.height), 383, 'and there is no side chrome to add back');
  assert.equal(TITLE, 34);
  assert.equal(BOTTOM_BAR, 40);
  assert.equal(MARGIN, 8);
  assert.equal(RATIO, 19.5 / 9);
  assert.equal(PORTRAIT_RATIO, 19.5 / 9);
});

test('height follows from the PICTURE width, and width is the only input', () => {
  assert.equal(heightFor(300), Math.round(300 * RATIO) + TITLE + BOTTOM_BAR);
  // The ratio holds across the range rather than at one convenient value.
  for (const width of [MIN_WIDTH, 260, 300, 350, 383]) {
    assert.equal(heightFor(width) - TITLE - BOTTOM_BAR, Math.round(pictureWidthFor(width) * RATIO));
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
  assert.equal(clampWidth(10, DESIGN), MIN_WIDTH);
  assert.equal(clampWidth(9999, DESIGN), 383);
  assert.equal(clampWidth(300, DESIGN), 300);
});

test('width is capped by the work area WIDTH too, not only by its height', () => {
  // The gap defect 114's rotation test found. On a 500pt-wide area the height cap allows 985 and the
  // display allows 484; the narrower one has to win, and until this line nothing asked it to.
  const narrow: WorkArea = { x: 0, y: 0, width: 500, height: 1000 };
  assert.equal(clampWidth(9999, narrow, LANDSCAPE), 500 - MARGIN * 2);
  // And the height cap still wins where IT is the narrower of the two — the original rule intact.
  assert.equal(clampWidth(9999, DESIGN, PORTRAIT_RATIO), maxWidthFor(DESIGN.height));
});

test('a work area too short for the minimum window still yields a legal Y', () => {
  // The inner Math.max in clampY. On a work area shorter than the smallest possible window the
  // upper bound goes negative, and without the guard Y would clamp to a value above the top edge —
  // a window dragged off the top of the screen, which on macOS cannot be dragged back.
  const tiny: WorkArea = { x: 0, y: 0, width: 400, height: 200 };
  const bounds = resolveBounds({ x: 0, y: 0, width: MIN_WIDTH }, tiny);
  assert.equal(bounds.y, MARGIN);
  assert.ok(bounds.y >= MARGIN, 'the window was placed above the top of the work area');
});

test('X is clamped against the work area width, independently of the ratio', () => {
  assert.equal(clampX(-500, 300, DESIGN), MARGIN);
  assert.equal(clampX(9999, 300, DESIGN), DESIGN.width - 300 - MARGIN);
  assert.equal(clampX(500, 300, DESIGN), 500);
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
  // 383 is the cap at the design's 920pt with a bottom bar; 401 was the cap before it. Iterating
  // past the cap asserts a width the clamp is right to refuse.
  for (const width of [MIN_WIDTH, 260, 340, 383]) {
    const bounds = boundsForCornerDrag({ x: origin.x + width }, origin, DESIGN);
    assert.equal(bounds.x, origin.x, `corner drag moved X at width ${width}`);
    assert.equal(bounds.width, width);
    // Height is derived from width and from nothing else — the whole 9:19.5 lock in one assertion.
    assert.equal(bounds.height, heightFor(width));
    assert.equal(bounds.y, clampY(origin.y, width, DESIGN));
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

/*
 * ---- Defect 113: the window could not be dragged to a second monitor -------------------------
 *
 * Written against the report rather than the formula. Every coordinate here is a global screen
 * point, which is what the old `{ width, height }` work area could not represent.
 */

test('a window on the second display stays on it instead of snapping back to the first', () => {
  // The reported failure exactly: the pointer has crossed to the monitor on the right, so the
  // requested x is 1900 — a perfectly legal position on a work area that runs from 1512 to 3432.
  // With no origin, `clampX` compared 1900 against a width of 1920 and answered 1900 by luck; at
  // 3300 it answered 1920 - 300 - 8 = 1612, dragging the window back onto the laptop.
  const bounds = resolveBounds({ x: 3300, y: 400, width: DEFAULT_WIDTH }, SECOND);
  assert.ok(bounds.x >= SECOND.x, `landed at x=${bounds.x}, left of the display's own origin`);
  assert.ok(bounds.x + bounds.width <= SECOND.x + SECOND.width);
  assert.ok(
    bounds.x > DESIGN.width,
    'getBounds() must report an x outside the primary display, which is the report\'s own check',
  );
});

test('a drag across the boundary is clamped against the display the POINTER is over', () => {
  // The handover. The window is at x=1400 on the laptop; the cursor moves to 2000, on the monitor.
  // Clamped against the monitor's area the window follows; clamped against the laptop's it would be
  // pinned at 1512-300-8 = 1204 and the crossing could never complete.
  const crossing = boundsForDrag({ x: 2000, y: 300 }, { x: 40, y: 10 }, DEFAULT_WIDTH, SECOND);
  assert.equal(crossing.x, 1960);
  const pinned = boundsForDrag({ x: 2000, y: 300 }, { x: 40, y: 10 }, DEFAULT_WIDTH, DESIGN);
  assert.ok(pinned.x < DESIGN.width, 'the control: against the laptop it IS pinned, as it was');
  assert.ok(crossing.x > pinned.x, 'so the area passed in is what decides, and it is the pointer\'s');
});

test('a display to the left has a negative origin, and the clamp follows it there too', () => {
  // A sign error would pass every test on a right-hand monitor and fail here. The margin is measured
  // from the display's own edges, which are -1920 and -120.
  const far = resolveBounds({ x: -9999, y: -9999, width: DEFAULT_WIDTH }, LEFT);
  assert.equal(far.x, LEFT.x + MARGIN);
  assert.equal(far.y, LEFT.y + MARGIN);
  const low = resolveBounds({ x: 9999, y: 9999, width: DEFAULT_WIDTH }, LEFT);
  assert.equal(low.x, LEFT.x + LEFT.width - DEFAULT_WIDTH - MARGIN);
  assert.ok(low.y + low.height + MARGIN <= LEFT.y + LEFT.height);
});

test('every resolved window is legal on a display whose origin is not zero', () => {
  // The whole-input-space invariant again, this time where the origin is doing work. Run on all
  // three areas, because a clamp that is right only where x = 0 is the defect.
  for (const area of [DESIGN, SECOND, LEFT]) {
    for (const x of [-9999, area.x - 1, area.x, area.x + 700, 99999]) {
      for (const y of [-9999, area.y - 1, area.y, area.y + 300, 99999]) {
        for (const width of [-10, MIN_WIDTH, 300, 9999]) {
          const b = resolveBounds({ x, y, width }, area);
          assert.ok(b.x >= area.x + MARGIN, `x=${b.x} is left of ${area.x}`);
          assert.ok(b.x + b.width + MARGIN <= area.x + area.width || b.width >= area.width - MARGIN);
          assert.ok(b.y >= area.y + MARGIN, `y=${b.y} is above ${area.y}`);
        }
      }
    }
  }
});

/*
 * ---- Defect 114: the window did not turn when the phone did ----------------------------------
 */

test('the ratio is read from the capture, and "not said yet" is not portrait', () => {
  assert.equal(ratioOfCapture({ width: 1080, height: 2340 }), 2340 / 1080);
  assert.equal(ratioOfCapture({ width: 2340, height: 1080 }), LANDSCAPE);
  // Null, not a guess. "The phone has not said" and "the phone is portrait" are different facts,
  // and a caller that cannot tell them apart cannot know whether it is drawing a shape or a default.
  assert.equal(ratioOfCapture(null), null);
  assert.equal(ratioOfCapture({}), null);
  assert.equal(ratioOfCapture({ width: 0, height: 2340 }), null);
});

test('a landscape window is landscape — the height follows the announced ratio, not 19.5:9', () => {
  const portrait = resolveBounds({ x: 100, y: 100, width: 336 }, DESIGN, PORTRAIT_RATIO);
  const landscape = resolveBounds({ x: 100, y: 100, width: 336 }, DESIGN, LANDSCAPE);
  assert.ok(portrait.height > portrait.width, 'portrait must be taller than it is wide');
  assert.ok(landscape.height < landscape.width, `landscape came out ${landscape.width}x${landscape.height}`);
  assert.equal(landscape.height, Math.round(pictureWidthFor(336) * LANDSCAPE) + TITLE + BOTTOM_BAR);
});

test('turning the phone keeps the picture area instead of keeping the width', () => {
  // The bug in one assertion. Keeping the width through a turn is what produces "landscape content
  // renders tiny": a 336pt window whose picture is 300x650 becomes 300x138, a fifth of the area.
  const before = resolveBounds({ x: 200, y: 100, width: 336 }, DESIGN, PORTRAIT_RATIO);
  const after = boundsForRatioChange(before, PORTRAIT_RATIO, LANDSCAPE, DESIGN);

  const areaBefore = pictureWidthFor(before.width) * (before.height - TITLE);
  const areaAfter = pictureWidthFor(after.width) * (after.height - TITLE);
  assert.ok(
    Math.abs(areaAfter - areaBefore) / areaBefore < 0.08,
    `picture area moved from ${areaBefore} to ${areaAfter} — more than the rounding this allows`,
  );
  assert.ok(after.width > before.width, 'a landscape phone needs a wider window, not the same one');
  assert.ok(after.height < before.height);
  // And the top-left is held, which is what "preserving its position" means.
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
});

test('turning back returns to about the window you started from', () => {
  const start = resolveBounds({ x: 200, y: 100, width: 336 }, DESIGN, PORTRAIT_RATIO);
  const turned = boundsForRatioChange(start, PORTRAIT_RATIO, LANDSCAPE, DESIGN);
  const back = boundsForRatioChange(turned, LANDSCAPE, PORTRAIT_RATIO, DESIGN);
  assert.ok(Math.abs(back.width - start.width) <= 4, `${start.width} → ${turned.width} → ${back.width}`);
});

test('a rotation that cannot fit is clamped, not left hanging off the desktop', () => {
  // A tall portrait window turning landscape wants to get much wider. On a narrow work area it
  // cannot, and the answer has to be a legal window rather than the one the area-preserving
  // arithmetic asked for.
  const narrow: WorkArea = { x: 0, y: 0, width: 500, height: 1000 };
  const before = resolveBounds({ x: 10, y: 10, width: maxWidthFor(1000) }, narrow, PORTRAIT_RATIO);
  const after = boundsForRatioChange(before, PORTRAIT_RATIO, LANDSCAPE, narrow);
  assert.ok(after.x + after.width + MARGIN <= narrow.width, `${after.x}+${after.width} overflows 500`);
  assert.ok(after.y + after.height + MARGIN <= narrow.height);
});

test('a ratio of zero or NaN falls back rather than producing an infinite window', () => {
  // A phone that reports a zero-width capture, or a division that went wrong upstream. The window
  // must stay finite and legal; `usable()` is what makes that true rather than hoped for.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const b = resolveBounds({ x: 100, y: 100, width: 300 }, DESIGN, bad);
    assert.ok(Number.isFinite(b.height) && b.height > TITLE, `ratio ${bad} gave height ${b.height}`);
    assert.equal(b.height, heightFor(300, PORTRAIT_RATIO));
  }
});

/*
 * ---- Defect 115: the control rail is width, not an overlay -----------------------------------
 */

test('the chrome comes out of the height, so the picture keeps the phone\'s exact aspect', () => {
  // The reason the bar is not drawn over the canvas: if it were, the window height would be
  // unchanged and the picture would silently lose its bottom BOTTOM_BAR points to a strip of
  // chrome — defect 115's dead zone by another route. Defect 118.
  for (const width of [MIN_WIDTH, 300, 383]) {
    const b = resolveBounds({ x: 100, y: 100, width }, DESIGN);
    const picture = { w: pictureWidthFor(b.width), h: b.height - TITLE - BOTTOM_BAR };
    assert.equal(picture.w, b.width, 'the picture spans the whole window width');
    assert.ok(
      Math.abs(picture.h / picture.w - PORTRAIT_RATIO) < 0.01,
      `picture ${picture.w}x${picture.h} is ${(picture.h / picture.w).toFixed(3)}, not ${PORTRAIT_RATIO.toFixed(3)}`,
    );
  }
});

test('the minimum window still leaves a picture worth looking at', () => {
  // With no side chrome the floor IS the picture, which is strictly more than the 184pt the vertical
  // rail left. Kept as an assertion rather than deleted: it is the guard on any future side chrome.
  assert.ok(pictureWidthFor(MIN_WIDTH) >= 150, `picture is ${pictureWidthFor(MIN_WIDTH)}pt at the floor`);
});

/*
 * ---- Defect 118: the controls move to a bottom bar, and the chrome changes axis ----------------
 *
 * Written before the formula changed, against the shape the bar has to produce. Each one fails on
 * the RAIL build for a different reason, which is the point: a single test that merely reads the
 * new constant would go green the moment the constant existed, without the arithmetic following it.
 */

test('the window has no side chrome — the picture is the full window width', () => {
  // RAIL took 36pt out of the width. A bottom bar takes nothing out of it, so a 300pt window shows
  // 300pt of phone. This is the whole axis swap in one assertion.
  for (const width of [MIN_WIDTH, 300, 420]) {
    assert.equal(pictureWidthFor(width), width, `a ${width}pt window must show ${width}pt of picture`);
  }
});

test('the bottom bar is height, taken below the picture, the way TITLE is taken above it', () => {
  // height = picture + TITLE + BOTTOM_BAR. The failure this closes is a bar drawn *over* the
  // picture: that leaves the window height unchanged, and the picture silently loses its bottom
  // BOTTOM_BAR points to a strip of chrome — which is defect 115's dead zone by another route.
  const b = resolveBounds({ x: 100, y: 100, width: 300 }, DESIGN);
  const pictureHeight = b.height - TITLE - BOTTOM_BAR;
  assert.equal(b.width, 300);
  assert.equal(pictureHeight, Math.round(300 * PORTRAIT_RATIO));
  assert.equal(b.height, Math.round(300 * PORTRAIT_RATIO) + TITLE + BOTTOM_BAR);
});

test('the picture keeps the phone\'s exact aspect with the bar below it', () => {
  // The letterboxing failure stated as a ratio rather than as a height: if the bar were subtracted
  // from the picture instead of added to the window, every window would show a picture squashed by
  // BOTTOM_BAR/ratio and the canvas's object-fit would letterbox it.
  for (const width of [MIN_WIDTH, 300, 420]) {
    for (const ratio of [PORTRAIT_RATIO, LANDSCAPE, 16 / 9]) {
      const b = resolveBounds({ x: 40, y: 40, width }, DESIGN, ratio);
      const picture = { w: pictureWidthFor(b.width), h: b.height - TITLE - BOTTOM_BAR };
      assert.ok(
        Math.abs(picture.h / picture.w - ratio) < 0.01,
        `picture ${picture.w}x${picture.h} is ${(picture.h / picture.w).toFixed(3)}, not ${ratio.toFixed(3)}`,
      );
    }
  }
});

test('the height budget shrinks by the bar, so the widest window is narrower than the README\'s', () => {
  // The README's figure assumes TITLE is the only vertical chrome. A bottom bar is ours, so the cap
  // has to come down — and a cap that did not follow is a window taller than the display.
  const readmeFigure = Math.floor((DESIGN.height - TITLE - MARGIN * 2) / RATIO);
  assert.equal(readmeFigure, 401, 'the README transcription itself is unchanged');
  assert.ok(
    maxPictureWidthFor(DESIGN.height) < readmeFigure,
    `with a ${BOTTOM_BAR}pt bar the cap must be under ${readmeFigure}, got ${maxPictureWidthFor(DESIGN.height)}`,
  );
  // And the window it produces still fits, which is the property the number exists for.
  for (const height of [600, 800, 920, 1080, 1440]) {
    assert.ok(
      heightFor(maxWidthFor(height)) + MARGIN * 2 <= height,
      `a max-width window does not fit in ${height}pt`,
    );
  }
});

test('the window cap is the picture cap — there is no side chrome to add back', () => {
  assert.equal(maxWidthFor(DESIGN.height), Math.max(MIN_WIDTH, maxPictureWidthFor(DESIGN.height)));
});

test('turning the phone still preserves the picture area, with the bar in the budget', () => {
  // Defect 114 must survive the axis swap. The area is now width x (height - TITLE - BOTTOM_BAR).
  const before = resolveBounds({ x: 200, y: 100, width: 300 }, DESIGN, PORTRAIT_RATIO);
  const after = boundsForRatioChange(before, PORTRAIT_RATIO, LANDSCAPE, DESIGN);
  const areaOf = (b: { width: number; height: number }) => pictureWidthFor(b.width) * (b.height - TITLE - BOTTOM_BAR);
  assert.ok(
    Math.abs(areaOf(after) - areaOf(before)) / areaOf(before) < 0.08,
    `picture area moved from ${areaOf(before)} to ${areaOf(after)}`,
  );
  assert.ok(after.width > before.width);
  assert.equal(after.x, before.x);
});

test('the narrowest window is still wide enough to hold five controls in a row', () => {
  // The bar's own constraint, and the one the vertical rail never had: five 26pt controls with 8pt
  // gaps and 8pt of padding either side need 162 + 32 + 16 = 210pt. A MIN_WIDTH below that would
  // ship a bar whose buttons overflow or wrap, which no test of the picture would ever notice.
  const needed = 5 * 26 + 4 * 8 + 16;
  assert.ok(MIN_WIDTH >= needed, `MIN_WIDTH ${MIN_WIDTH} cannot hold a ${needed}pt control row`);
});
