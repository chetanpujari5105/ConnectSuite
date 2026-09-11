import assert from 'node:assert/strict';
import test from 'node:test';

const { captureAspect, containedPicture, pointInCapture } = require('./captureFit') as typeof import('./captureFit');

/**
 * The three handsets on the desk, plus a turn. Real geometries, not illustrations:
 *
 *  - SM-S938B at FHD+ is **1080×2408**, which is ~20:9 and **not** the 19.5:9 the box asserted —
 *    the reference device was already wrong, by 1.6px a side, which is exactly why one device hid
 *    this for a phase.
 *  - moto g34 5G and moto g45 5G are both **720×1600**, exactly 9:20.
 *  - any of them turned is the same numbers the other way up.
 */
const SAMSUNG = { width: 1080, height: 2408 };
const MOTO = { width: 720, height: 1600 };
const SAMSUNG_LANDSCAPE = { width: 2408, height: 1080 };

/** The element the pane measured on 2026-09-09, before the fix. */
const OLD_ELEMENT = { left: 0, top: 0, width: 266, height: 569.4 };

test('the aspect comes from the stream, and three phones give three different answers', () => {
  assert.equal(captureAspect(SAMSUNG)!.toFixed(4), '0.4485');
  assert.equal(captureAspect(MOTO)!.toFixed(4), '0.4500');
  assert.equal(captureAspect(SAMSUNG_LANDSCAPE)!.toFixed(4), '2.2296');
  // The number the box used to hard-code, present here only so the difference is visible.
  assert.notEqual(captureAspect(SAMSUNG)!.toFixed(4), (9 / 19.5).toFixed(4));
  assert.notEqual(captureAspect(MOTO)!.toFixed(4), (9 / 19.5).toFixed(4));
});

test('no geometry is null, never a default — the 9:19.5 assumption may not come back by the side door', () => {
  assert.equal(captureAspect(null), null);
  assert.equal(captureAspect(undefined), null);
  assert.equal(captureAspect({ width: 0, height: 2400 }), null);
  assert.equal(captureAspect({ width: 1080, height: 0 }), null);
  assert.equal(captureAspect({ width: Number.NaN, height: 2400 }), null);
});

test('a box sized from the same geometry has no letterbox at all', () => {
  // What the stage now does: width from height through the aspect. The picture fills it.
  for (const capture of [SAMSUNG, MOTO, SAMSUNG_LANDSCAPE]) {
    const height = 569.4;
    const element = { width: height * captureAspect(capture)!, height };
    const picture = containedPicture(element, capture);
    assert.ok(Math.abs(picture.left) < 0.001, `left bar for ${capture.width}x${capture.height}`);
    assert.ok(Math.abs(picture.top) < 0.001, `top bar for ${capture.width}x${capture.height}`);
    assert.ok(Math.abs(picture.width - element.width) < 0.001);
  }
});

test('the corners map to the corners, on every one of the three phones and turned', () => {
  for (const capture of [SAMSUNG, MOTO, SAMSUNG_LANDSCAPE]) {
    const height = 569.4;
    const element = { left: 40, top: 12, width: height * captureAspect(capture)!, height };

    const topLeft = pointInCapture({ x: element.left, y: element.top }, element, capture);
    assert.deepEqual([Math.round(topLeft.x), Math.round(topLeft.y)], [0, 0]);

    const bottomRight = pointInCapture(
      { x: element.left + element.width, y: element.top + element.height },
      element,
      capture,
    );
    assert.deepEqual(
      [Math.round(bottomRight.x), Math.round(bottomRight.y)],
      [capture.width, capture.height],
    );

    const middle = pointInCapture(
      { x: element.left + element.width / 2, y: element.top + element.height / 2 },
      element,
      capture,
    );
    assert.deepEqual(
      [Math.round(middle.x), Math.round(middle.y)],
      [Math.round(capture.width / 2), Math.round(capture.height / 2)],
    );
  }
});

/**
 * **The defect, at its own measurements.** This is the test that goes red if `pointInCapture` is
 * reverted to dividing by the element — which is what `pointAt` did, and what its doc comment
 * asserted was safe.
 *
 * The old expression is written out here as a *fixture of the bug*, not as a second copy of the
 * rule: it is what the code used to say, kept so the size of the error is on the record rather than
 * described in prose.
 */
test('a letterboxed element maps a tap to the wrong place, and this says by how much', () => {
  const naive = (clientY: number) => ((clientY - OLD_ELEMENT.top) / OLD_ELEMENT.height) * SAMSUNG_LANDSCAPE.height;

  const picture = containedPicture(OLD_ELEMENT, SAMSUNG_LANDSCAPE);
  // 225px of black above and below a 119.3px picture: the picture was 21% of the box's height.
  assert.equal(picture.height.toFixed(1), '119.3');
  assert.equal(picture.top.toFixed(1), '225.0');

  // The top edge of the phone, which is the top edge of the *picture*.
  const atPictureTop = OLD_ELEMENT.top + picture.top;
  assert.equal(Math.round(pointInCapture({ x: 133, y: atPictureTop }, OLD_ELEMENT, SAMSUNG_LANDSCAPE).y), 0);
  // The old mapping put that same click 427 pixels down a 1080-pixel screen — 40% of the way in.
  assert.equal(Math.round(naive(atPictureTop)), 427);

  // Portrait is smaller and just as real: ~20 capture pixels at the edge on a moto.
  const motoPicture = containedPicture(OLD_ELEMENT, MOTO);
  const atMotoRight = OLD_ELEMENT.left + motoPicture.left + motoPicture.width;
  assert.equal(Math.round(pointInCapture({ x: atMotoRight, y: 200 }, OLD_ELEMENT, MOTO).x), MOTO.width);
  const naiveX = ((atMotoRight - OLD_ELEMENT.left) / OLD_ELEMENT.width) * MOTO.width;
  assert.ok(
    MOTO.width - naiveX > 12,
    `the moto's edge error should be tens of pixels, got ${(MOTO.width - naiveX).toFixed(1)}`,
  );
});

test('outsideBy reads zero on the picture and grows off it, and the point is clamped either way', () => {
  const picture = containedPicture(OLD_ELEMENT, SAMSUNG_LANDSCAPE);
  const onIt = pointInCapture({ x: 133, y: OLD_ELEMENT.top + picture.top + 10 }, OLD_ELEMENT, SAMSUNG_LANDSCAPE);
  assert.equal(onIt.outsideBy, 0);

  // A click in the black bar. Clamped to the phone's top edge, and it says it was off the picture.
  const inTheBar = pointInCapture({ x: 133, y: OLD_ELEMENT.top + 4 }, OLD_ELEMENT, SAMSUNG_LANDSCAPE);
  assert.equal(inTheBar.y, 0);
  assert.ok(inTheBar.outsideBy > 200, `expected a large outsideBy, got ${inTheBar.outsideBy}`);

  // And on a correctly sized box there is nowhere to be outside: the far corner reads 0.
  const height = 569.4;
  const exact = { left: 0, top: 0, width: height * captureAspect(MOTO)!, height };
  assert.equal(pointInCapture({ x: exact.width, y: exact.height }, exact, MOTO).outsideBy, 0);
});
