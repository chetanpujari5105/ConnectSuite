import { test } from 'node:test';
import assert from 'node:assert/strict';

// chips.ts is a plain script, not a module — see the comment in it. require() picks up the shim.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chipLabel } = require('./chips') as {
  chipLabel: (capability: string, available: boolean, reason?: string) => string;
};

/**
 * Defect 26: a chip's state was a colour and nothing else.
 *
 * `<span class="cap on">mirror</span>` — the name was the only text, and Chromium collapses an
 * inline span into a bare AXStaticText, so the class did not survive into the accessibility tree.
 * Three capabilities lit and none lit produced a byte-identical tree, which meant a screen reader
 * announced twelve names with no indication which were available, and the colours were
 * green-on-grey.
 */
test('an available capability says so, not just in green', () => {
  assert.equal(chipLabel('mirror', true), 'mirror: available');
});

test('an unavailable capability carries the phone’s own reason', () => {
  assert.equal(
    chipLabel('input', false, 'missing Accessibility'),
    'input: unavailable, missing Accessibility',
  );
});

/**
 * Defect 24 put the reason on the wire, but it is optional there: an older phone sends none. The
 * chip must still state the fact rather than falling back to colour.
 */
test('a missing reason still states the state', () => {
  assert.equal(chipLabel('sms', false), 'sms: unavailable');
});

/** The label starts with the name, because the renderer shows the name and hides only the tail. */
test('the label starts with the capability name', () => {
  for (const [available, reason] of [[true, undefined], [false, 'missing SMS'], [false, undefined]] as const) {
    const label = chipLabel('sms', available, reason);
    assert.ok(label.startsWith('sms'), `${label} must start with the visible text`);
    assert.ok(label.slice(3).length > 0, 'the hidden tail must not be empty');
  }
});
