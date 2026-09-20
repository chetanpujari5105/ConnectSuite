import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeElement, installFakeDocument, installFakeWindow } from './domDouble.testkit';

installFakeDocument();
installFakeWindow();
import './overflowTitle';

const titleWhenClipped = (globalThis as Record<string, any>).titleWhenClipped as (
  el: any,
  text: string,
) => void;

function cell(scrollWidth: number, clientWidth: number) {
  const el = new FakeElement('span');
  el.scrollWidth = scrollWidth;
  el.clientWidth = clientWidth;
  return el;
}

/**
 * The defect. `activity-detail` is `text-overflow: ellipsis`, so the intent was right and the
 * attribute was set unconditionally — nine rows on screen with a tooltip repeating the line under
 * the pointer, 9 of 9 in the sweep that found it.
 */
test('text that fits gets no tooltip', () => {
  const el = cell(120, 400);
  titleWhenClipped(el, 'Sent clip.mp4 to the phone');
  assert.equal(el.title, '', 'the element’s own visible text was put under the pointer');
  assert.equal(el.getAttribute('title'), null);
});

test('text the layout clipped gets the whole string', () => {
  const el = cell(640, 400);
  titleWhenClipped(el, 'Sent a very long file name indeed.mp4 to the phone');
  assert.equal(el.title, 'Sent a very long file name indeed.mp4 to the phone');
});

/**
 * The half that goes wrong second: a title set while the column was narrow and never cleared is a
 * stale tooltip describing a clipping that no longer happens. The clear is unconditional for
 * exactly this reason, and the test drives the transition over one element rather than two.
 */
test('a tooltip does not outlive the clipping that earned it', () => {
  const el = cell(640, 400);
  titleWhenClipped(el, 'a long detail');
  assert.equal(el.title, 'a long detail', 'control: it was set');
  el.clientWidth = 900;
  titleWhenClipped(el, 'a long detail');
  assert.equal(el.getAttribute('title'), null, 'the tooltip survived the widening');
});

/** Equal widths are a fitting string; a sub-pixel tie is not a reason to repeat the line. */
test('exactly fitting is fitting', () => {
  const el = cell(400, 400);
  titleWhenClipped(el, 'exactly this wide');
  assert.equal(el.getAttribute('title'), null);
});

// ---- titleIfItAdds — the sibling rule ------------------------------------------------------------

const titleIfItAdds = (globalThis as Record<string, any>).titleIfItAdds as (
  el: any,
  text: string,
) => void;

function labelled(text: string) {
  const el = new FakeElement('span');
  el.textContent = text;
  return el;
}

/**
 * The second instance of defect 127, and the first one the sweep found rather than a person.
 * Overview's `recent-when` draws `activityClock` and its tooltip was `activityWhen` — and past an
 * hour `activityWhen` *returns* `activityClock`, so an older row's tooltip repeated itself while a
 * newer one did not.
 */
test('a tooltip identical to the element’s own text is not set', () => {
  const el = labelled('Yesterday 14:03');
  titleIfItAdds(el, 'Yesterday 14:03');
  assert.equal(el.getAttribute('title'), null);
});

test('a tooltip that says something else is set', () => {
  const el = labelled('14:03');
  titleIfItAdds(el, '42m ago');
  assert.equal(el.title, '42m ago');
});

/** Whitespace is not information. Trimmed on both sides, so a stray space is not "something else". */
test('whitespace does not make two strings different', () => {
  const el = labelled('  14:03 ');
  titleIfItAdds(el, '14:03');
  assert.equal(el.getAttribute('title'), null);
});

test('an empty tooltip is no tooltip', () => {
  const el = labelled('14:03');
  titleIfItAdds(el, '   ');
  assert.equal(el.getAttribute('title'), null);
});

/** The same transition trap as its sibling: a row that ages past the hour must lose its tooltip. */
test('a tooltip does not outlive the difference that earned it', () => {
  const el = labelled('14:03');
  titleIfItAdds(el, '42m ago');
  assert.equal(el.title, '42m ago', 'control: it was set');
  el.textContent = 'Yesterday 14:03';
  titleIfItAdds(el, 'Yesterday 14:03');
  assert.equal(el.getAttribute('title'), null, 'the tooltip survived becoming a duplicate');
});
