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
