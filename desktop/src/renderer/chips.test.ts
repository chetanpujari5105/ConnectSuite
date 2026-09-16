import { test } from 'node:test';
import assert from 'node:assert/strict';

// chips.ts is a plain script, not a module — see the comment in it. require() picks up the shim.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chipLabel, chipTail, capabilityLabel, CAPABILITY_LABELS } = require('./chips') as {
  chipLabel: (capability: string, available: boolean, reason?: string) => string;
  chipTail: (available: boolean, reason?: string) => string;
  capabilityLabel: (capability: string) => string;
  CAPABILITY_LABELS: Record<string, string>;
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
  assert.equal(chipLabel('mirror', true), 'Mirror: available');
});

test('an unavailable capability carries the phone’s own reason', () => {
  assert.equal(
    chipLabel('input', false, 'missing Accessibility'),
    'Input: unavailable, missing Accessibility',
  );
});

/**
 * Defect 24 put the reason on the wire, but it is optional there: an older phone sends none. The
 * chip must still state the fact rather than falling back to colour.
 */
test('a missing reason still states the state', () => {
  assert.equal(chipLabel('sms', false), 'SMS: unavailable');
});

/**
 * The renderer draws the name and the tail as two nodes. This is the guard that they reassemble
 * into the sentence — asserted by **composition**, not by a `startsWith`.
 *
 * The old version asserted `chipLabel('sms', …).startsWith('sms')` and then `label.slice(3)`, which
 * is the same arithmetic the renderer was doing: slice the name's length off the front. It passed
 * for as long as the visible text *was* the wire id, and the moment `sms` became `SMS` the length
 * still matched by luck — three characters — while `mic` → `Microphone` would have silently cut
 * `rophone: unavailable` down to a fragment. A test that models the renderer's arithmetic cannot
 * catch the renderer's arithmetic being wrong.
 */
test('the visible name and the hidden tail reassemble into the label', () => {
  for (const capability of Object.keys(CAPABILITY_LABELS)) {
    for (const [available, reason] of [[true, undefined], [false, 'missing SMS'], [false, undefined]] as const) {
      assert.equal(
        capabilityLabel(capability) + chipTail(available, reason),
        chipLabel(capability, available, reason),
        `${capability} @ available=${available}`,
      );
      assert.ok(chipTail(available, reason).length > 0, 'the hidden tail must not be empty');
    }
  }
});

/**
 * Defect 28's rule, in a second namespace: a wire handle may appear as a handle, never as the only
 * thing a person reads. `sms` and `mic` are the two that make it visible.
 */
test('every capability the Mac knows about has a readable name, and an unknown one falls back', () => {
  const ALL = [
    'mirror', 'input', 'notifications', 'sms', 'calls', 'contacts',
    'files', 'photos', 'clipboard', 'remote', 'apps', 'mic',
  ];
  for (const capability of ALL) {
    const label = capabilityLabel(capability);
    assert.ok(CAPABILITY_LABELS[capability], `${capability} has no readable name`);
    assert.notEqual(label, capability, `${capability} is still the raw wire id on screen`);
    assert.match(label, /^[A-Z]/, `${label} is lowercase against a sentence-case interface`);
  }
  assert.equal(capabilityLabel('sms'), 'SMS');
  assert.equal(capabilityLabel('mic'), 'Microphone');
  // The honest fallback, and it must stay: a capability this Mac has not met shows its own id
  // rather than a guessed word. Same rule as `AppLabels.of` for a package with no launcher icon.
  assert.equal(capabilityLabel('teleport'), 'teleport');
});
