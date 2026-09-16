import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FLOAT_RAIL, floatRailIconNames, floatRailTooltip, floatRailGroupStart } = require('./floatRail') as {
  FLOAT_RAIL: { id: string; label: string; tooltip?: string; icon: string; kind: string; action?: string; needsInput: boolean }[];
  floatRailIconNames: () => string[];
  floatRailTooltip: (item: { label: string; tooltip?: string }) => string;
  floatRailGroupStart: () => number;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ICON_GEOMETRY } = require('./icons') as { ICON_GEOMETRY: Record<string, string> };

test('every icon the strip asks for is one that has actually been drawn', () => {
  // The empty-ring defect. Capture and Refresh shipped as bordered spans with no contents, visible
  // in a screenshot and invisible to every check in the repo, because the name was never in an
  // enumeration anything asserted over. This is that enumeration for the float window.
  for (const name of floatRailIconNames()) {
    assert.ok(ICON_GEOMETRY[name], `the strip asks for an icon named "${name}" and none is drawn`);
    assert.ok(ICON_GEOMETRY[name]!.trim().length > 0, `"${name}" resolves to empty geometry — a ring`);
  }
});

test('the control that reveals the main window says it does not close this one', () => {
  // Defect 117's whole risk is a user who will not press the button because they expect to lose the
  // floating window. The label is the fix, so the label is asserted rather than left to a screenshot.
  const reveal = FLOAT_RAIL.find((i) => i.kind === 'reveal');
  assert.ok(reveal, 'there is no way back to the main window from the float');
  assert.match(reveal!.label, /without closing this one/i);
});

test('the two controls that need nothing from the phone are not gated on input', () => {
  // A screenshot is a canvas readback on this Mac and revealing a window is this Mac's own business.
  // Disabling them with the accessibility service off would be refusing something that works.
  for (const kind of ['shot', 'reveal']) {
    const item = FLOAT_RAIL.find((i) => i.kind === kind)!;
    assert.equal(item.needsInput, false, `${kind} must not be gated on the input capability`);
  }
});

test('every global action carries the wire name, and every non-global carries none', () => {
  // A `kind: 'global'` with no `action` is a button that calls `input.global` with `undefined` — a
  // press that produces neither an action nor a sentence, which is the silent no-op class.
  for (const item of FLOAT_RAIL) {
    if (item.kind === 'global') {
      assert.ok(item.action, `${item.id} is a global action with no wire name`);
      assert.equal(item.needsInput, true, `${item.id} needs input and must say so`);
    } else {
      assert.equal(item.action, undefined, `${item.id} is not a global action but carries one`);
    }
  }
});

test('the global actions are ones an AccessibilityService can genuinely perform', () => {
  // `performGlobalAction` is the whole of what is possible and there is no power button. A strip that
  // offered one would be a control that can only ever refuse.
  const possible = ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock_screen'];
  for (const item of FLOAT_RAIL.filter((i) => i.kind === 'global')) {
    assert.ok(possible.includes(item.action!), `${item.action} is not a performGlobalAction`);
  }
});

test('ids are unique, because the DOM is keyed on them', () => {
  const ids = FLOAT_RAIL.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

/*
 * ---- Defect 118: the bar's own facts, which the vertical rail did not have -------------------
 */

test('the phone controls come first, in Android\'s own left-to-right order', () => {
  // The reference the owner described could not be read from this handset — it runs gesture
  // navigation (`navigation_mode = 2`), so it draws no three-button bar of its own, and the Samsung
  // order keys returned null including a control key that should have existed. So the order is the
  // owner's stated one and the AOSP convention, asserted here because it is a one-line flip and a
  // test is the only thing that would notice it flipping by accident.
  const phone = FLOAT_RAIL.filter((i) => i.kind === 'global').map((i) => i.id);
  assert.deepEqual(phone, ['back', 'home', 'recents']);
  // And they are the FIRST three, so the Mac-side controls do not interleave with them.
  assert.deepEqual(FLOAT_RAIL.slice(0, 3).map((i) => i.id), ['back', 'home', 'recents']);
});

test('the Mac-side controls come after the phone ones, as one group', () => {
  const kinds = FLOAT_RAIL.map((i) => i.kind);
  const lastGlobal = kinds.lastIndexOf('global');
  const firstMac = kinds.findIndex((k) => k !== 'global');
  assert.ok(firstMac > lastGlobal, 'a Mac control is interleaved with the phone controls');
});

test('every control has a tooltip, and it is never empty', () => {
  // An empty tooltip is the empty-ring defect in text: a control that appears to explain itself and
  // shows a blank box. The fallback is the accessible name, so this can only fail on a row that sets
  // `tooltip` to an empty string.
  for (const item of FLOAT_RAIL) {
    const text = floatRailTooltip(item);
    assert.ok(text.trim().length > 0, `${item.id} has no tooltip text`);
  }
});

test('the tooltip is short enough to sit over a 220pt window without being clipped', () => {
  // MIN_WIDTH is 220. A tooltip wider than the window is a label the user cannot read, and the
  // reveal control's accessible name — the full "…without closing this one" sentence — is exactly
  // the one that would do it. ~7px per character at the meta size is the rough budget.
  for (const item of FLOAT_RAIL) {
    assert.ok(
      floatRailTooltip(item).length <= 24,
      `${item.id}'s tooltip is ${floatRailTooltip(item).length} chars: "${floatRailTooltip(item)}"`,
    );
  }
});

test('the reveal control\'s SHORT tooltip did not replace its full accessible name', () => {
  // The split defect 118 introduced, and the way it can go wrong: shortening the tooltip by
  // shortening the label. Defect 117's promise has to survive in the string a screen reader reads.
  const reveal = FLOAT_RAIL.find((i) => i.kind === 'reveal')!;
  assert.match(reveal.label, /without closing this one/i);
  assert.notEqual(floatRailTooltip(reveal), reveal.label, 'the short form is the point');
  assert.ok(floatRailTooltip(reveal).length < reveal.label.length);
});

test('a control with no short form falls back to its accessible name, not to nothing', () => {
  // Back, Home and Recents set no `tooltip`. They must still have one, and it must be the same
  // string the screen reader hears — one literal, so there is nothing to keep in step.
  for (const id of ['back', 'home', 'recents']) {
    const item = FLOAT_RAIL.find((i) => i.id === id)!;
    assert.equal(item.tooltip, undefined, `${id} should not carry a second literal`);
    assert.equal(floatRailTooltip(item), item.label);
  }
});

test('exactly one control starts the Mac-side group, and it is the first non-phone one', () => {
  // The separator's position comes from here rather than from a CSS `:first-of-type`, which matched
  // the first *button* — Back — and therefore nothing with the class it was compounded with. The
  // rule parsed and drew nothing, and only a measurement of the running window found it.
  const start = floatRailGroupStart();
  assert.ok(start > 0, 'the group must not start at the first control');
  assert.equal(FLOAT_RAIL[start]!.kind !== 'global', true);
  assert.equal(FLOAT_RAIL[start - 1]!.kind, 'global', 'the control before it must be a phone one');
  // And there is exactly one boundary: every control after it is Mac-side.
  assert.ok(FLOAT_RAIL.slice(start).every((i) => i.kind !== 'global'), 'the groups interleave');
});
