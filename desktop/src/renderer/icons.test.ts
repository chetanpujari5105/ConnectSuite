/**
 * The icon set's guard.
 *
 * **The defect this is named for**: the build shipped with no icons at all. The Mirror tool rail's
 * Capture and Refresh drew a bordered `.tool-glyph` span with nothing inside it, so both rendered
 * as empty rings — visible in a screenshot and invisible to `tsc`, to `npm test`, and to every
 * other check in the repo. Nothing threw, because nothing asked for an icon.
 *
 * **Shown to fail**: deleting the `capture` entry from `ICON_GEOMETRY` turns "every icon the shell
 * asks for exists" red in navModel.test.ts and "no icon is empty" red here. Replacing a `<path>`
 * with `''` turns "no icon is empty" red on its own. Both were put back.
 *
 * The control the CLAUDE.md rule asks for is `control_the emptiness check can actually see an
 * empty icon` below: an absence is only evidence once the same query has been shown to return a
 * known positive, and "every icon is non-empty" over a table where nothing is empty is exactly the
 * shape of a check that cannot fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ICON_GEOMETRY, ICON_NAMES, FILLED_ICONS, strokeForSize } = require('./icons.ts');

test('no icon is empty — this is the defect the file was written for', () => {
  for (const name of ICON_NAMES) {
    const geometry = ICON_GEOMETRY[name];
    assert.ok(
      typeof geometry === 'string' && geometry.trim().length > 0,
      `${name} has no geometry — it would draw as an empty ring, which is what shipped`,
    );
    // A wrapper with no drawing instruction inside it is empty in the way that matters, and it is
    // not caught by a length check. Every icon must contain at least one mark.
    assert.match(
      geometry,
      /<(path|rect|circle|line|polyline|polygon|ellipse)\b/,
      `${name} contains no drawable element`,
    );
  }
});

test('control_the emptiness check can actually see an empty icon', () => {
  // The same predicate, run against the thing it is meant to catch. Without this the test above is
  // a green light over a table nobody has proven the assertion can read.
  const blank = '';
  const wrapperOnly = '<g></g>';
  for (const bad of [blank, wrapperOnly]) {
    const passes =
      bad.trim().length > 0 && /<(path|rect|circle|line|polyline|polygon|ellipse)\b/.test(bad);
    assert.equal(passes, false, `the predicate accepted ${JSON.stringify(bad)} as a drawn icon`);
  }
});

test('every icon is authored on the 24px grid', () => {
  // Not a viewBox assertion — iconSvg sets that. This is about the *geometry*: a path drawn on a
  // 48px or 100px grid still renders, scaled wrong and clipped, at every size.
  //
  // It checks **magnitude**, not sign, and the first version of this test did not — it read the
  // `-2.5` in `a2.5 2.5 0 0 1-2.5 2.5` as a coordinate off the left edge and failed the `mirror`
  // icon, which is correct. Path data interleaves absolute coordinates with relative deltas and
  // arc flags, and telling them apart needs a parser, not a regex. So the assertion is narrowed to
  // the thing a regex genuinely can decide: inside a 24-unit box, neither a coordinate nor a delta
  // can exceed 24. That is a weaker check than "every coordinate is on the grid" and it is stated
  // as the weaker one rather than dressed up as the stronger.
  //
  // The number pattern has to cover `.45` as well as `0.45` — path data drops the leading zero,
  // and a `\d+(\.\d+)?` pattern reads `-.45` as the integer 45 and fails the `messages` icon for
  // a coordinate it does not have. That was the second false positive this one assertion produced
  // before it was right, which is the rule about controls earning its place inside a test file.
  for (const name of ICON_NAMES) {
    const magnitudes = (ICON_GEOMETRY[name].match(/\d+\.\d+|\.\d+|\d+/g) ?? []).map(Number);
    const offGrid = magnitudes.filter((n) => n > 25);
    assert.deepEqual(
      offGrid,
      [],
      `${name} has values past the 24px grid: ${offGrid.join(', ')}`,
    );
  }
});

test('control_the grid check can see an icon drawn on the wrong grid', () => {
  // A 100-unit path, which is what lifting an icon from a 100x100 set looks like. The second half
  // of this control is that a leading-dot decimal is *not* flagged, which is the false positive
  // the pattern above was fixed for.
  const wrongGrid = '<path d="M10 50L90 50"/>';
  const magnitudes = (wrongGrid.match(/\d+\.\d+|\.\d+|\d+/g) ?? []).map(Number);
  assert.notDeepEqual(
    magnitudes.filter((n) => n > 25),
    [],
    'the predicate failed to notice a path drawn on a 100px grid',
  );

  const leadingDot = '<path d="M4.2 20.4l1.3-.45"/>';
  assert.deepEqual(
    (leadingDot.match(/\d+\.\d+|\.\d+|\d+/g) ?? []).map(Number).filter((n) => n > 25),
    [],
    'the predicate read a leading-dot decimal as an integer',
  );
});

test('stroke weight stays inside the handoff range of 1.5 to 1.7', () => {
  // Every size the shell actually renders at, plus the ends.
  for (const size of [12, 14, 15, 16, 17, 20, 24, 64]) {
    const stroke = strokeForSize(size);
    assert.ok(stroke >= 1.5 && stroke <= 1.7, `${size}px got a ${stroke} stroke`);
  }
});

test('a smaller icon gets a heavier stroke, never a lighter one', () => {
  // The reason the weight is a function of size at all: a 1.5 stroke at 14px reads as a smudge.
  // Asserting the *direction* catches a future edit that inverts the ternary, which a range check
  // on its own would not.
  const sizes = [12, 14, 16, 18, 20, 24];
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(
      strokeForSize(sizes[i]!) <= strokeForSize(sizes[i - 1]!),
      `${sizes[i]}px is stroked heavier than ${sizes[i - 1]}px`,
    );
  }
});

/**
 * The filled set, as **two named questions rather than one list**.
 *
 * This assertion used to be `deepEqual([...FILLED_ICONS], ['dots'])` — "only the overflow mark is
 * filled". It went red on 2026-09-16 when the media transport arrived, and the tempting repair was
 * to paste four names into the array, which is the counting guard CLAUDE.md warns about: a list
 * that gets one longer every time tells you the total changed and never *which* member appeared.
 *
 * The two questions the one list was conflating:
 *
 *  - **`dots` is filled because it is a mark** — a row of three discs, which has no outline form.
 *  - **The transport four are filled because they are shapes.** A triangle and two bars are drawn
 *    solid by every system that draws them, SF Symbols included, and a stroked triangle reads as
 *    the outline of a button rather than as the glyph on it.
 *
 * Anything that is neither is stroked, and that third assertion is the one doing the real work:
 * it is what goes red when a fifth name is added for no stated reason.
 */
test('the filled set is the overflow mark and the transport, and nothing else', () => {
  // A filled icon rendered with a stroke is a ring, and a stroked icon rendered filled is a blob.
  const transport = ['play', 'pause', 'skip-back', 'skip-forward'];

  assert.ok(FILLED_ICONS.has('dots'), 'the overflow mark is a mark, and marks are filled');
  for (const name of transport) {
    assert.ok(FILLED_ICONS.has(name), `${name} is a transport shape and must be filled`);
  }

  const unexplained = [...FILLED_ICONS].filter((n) => n !== 'dots' && !transport.includes(n));
  assert.deepEqual(unexplained, [], 'a filled icon that is neither a mark nor a transport shape');

  for (const name of FILLED_ICONS) {
    assert.ok(ICON_NAMES.includes(name), `${name} is marked filled but is not an icon`);
  }
});

test('no icon hard-codes a colour — every one takes the row it sits in', () => {
  // currentColor is applied by iconSvg. A stroke or fill baked into the geometry would survive it
  // and give one icon a colour of its own, which is the shape of a hover state that half-works.
  for (const name of ICON_NAMES) {
    assert.doesNotMatch(
      ICON_GEOMETRY[name],
      /(stroke|fill)="(?!none)(?!currentColor)/,
      `${name} carries its own colour`,
    );
  }
});
