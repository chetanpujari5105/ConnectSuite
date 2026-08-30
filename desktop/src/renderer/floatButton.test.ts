/**
 * The float button's two states, against handoff §2.
 *
 * Written against the failure rather than the formula: the bug this closes is a button that goes on
 * saying "Floating window" while a floating window is open, so pressing it looks like it does
 * nothing. Each test names a way that could happen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { floatButtonLabelsFor } = require('./floatButton.ts');

test('closed and open are different in all three of the things a user perceives', () => {
  const closed = floatButtonLabelsFor(false);
  const open = floatButtonLabelsFor(true);

  // The label, the accessible name and the dot. A state change that moves only one of them is the
  // half-applied version of this rule, and it is what a sighted-only or a screen-reader-only check
  // would let through.
  assert.notEqual(closed.label, open.label);
  assert.notEqual(closed.description, open.description);
  assert.notEqual(closed.dot, open.dot);
});

test('the handoff strings are the strings', () => {
  // Quoted from §2 rather than paraphrased. This is the control on the file: every other assertion
  // here would still pass against two invented labels, and only this one would not.
  assert.equal(floatButtonLabelsFor(false).label, 'Floating window');
  assert.equal(floatButtonLabelsFor(true).label, 'Show floating window');
});

test('the dot is present exactly when the window is open', () => {
  // §2: the dot means "there is a window to show", not "this button does something". A dot that is
  // always on, or always off, carries no information at all — the same failure as a count with no
  // denominator, in one pixel.
  assert.equal(floatButtonLabelsFor(true).dot, true);
  assert.equal(floatButtonLabelsFor(false).dot, false);
});

test('the accessible name says what pressing it will do, in each state', () => {
  // Not "Floating window" twice. When the window is open the button refocuses rather than opens,
  // and a screen reader that announces "open" for a button that focuses has described the wrong
  // action — which is defect 26's shape: a control whose face and whose announcement disagree.
  assert.match(floatButtonLabelsFor(false).description, /open/i);
  assert.match(floatButtonLabelsFor(true).description, /front|focus|show/i);
  assert.doesNotMatch(floatButtonLabelsFor(true).description, /^Open /);
});
