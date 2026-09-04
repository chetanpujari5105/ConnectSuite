import { discHue } from '../shared/discHue';
import assert from 'node:assert/strict';
import test from 'node:test';

import '../renderer/calls';

/**
 * Defect 35 — the call card was labelled with nothing at all.
 *
 * These run against the renderer's own functions, not a copy of the rule. `calls.ts` is a plain
 * `<script>` with no top-level side effects, so importing it here executes nothing and the pure
 * label rules come back off the global it hangs them on. Testing a second copy would be the same
 * shape as the lookalike queries this project keeps recording: it would pass while the code that
 * actually draws the card went on drawing a blank.
 *
 * **Shown to fail against the defect**: restore `contactName ?? number ?? 'Unknown number'` in
 * `callWho` and the first two assertions go red; restore the unconditional `${label} · ${number}`
 * in `callStatus` and the fourth does.
 */
const labels = (globalThis as Record<string, unknown>).__callLabels as {
  firstNonEmpty(...values: Array<string | undefined | null>): string | undefined;
  callWho(call: { contactName?: string; number?: string }): string;
  callStatus(call: { state: string; number?: string }): string;
};

test('an empty number falls through to Unknown number, as `??` never did', () => {
  // The exact payload the phone sent: `call.incoming c3 (ringing) from , no contact name`.
  assert.equal(labels.callWho({ number: '' }), 'Unknown number');
  assert.equal(labels.callWho({ number: '', contactName: '' }), 'Unknown number');
  assert.equal(labels.callWho({}), 'Unknown number');
});

test('a real number or name still wins over the fallback', () => {
  // The control. A fallback that fires for everything is not a fixed fallback, it is a broken
  // pane — and it would satisfy the test above perfectly.
  assert.equal(labels.callWho({ number: '+919800000003' }), '+919800000003');
  assert.equal(
    labels.callWho({ number: '+919800000003', contactName: 'Ada Lovelace' }),
    'Ada Lovelace',
    'the name wins when contacts can supply one',
  );
});

test('whitespace is empty, because a card of spaces is still blank', () => {
  assert.equal(labels.callWho({ contactName: '   ', number: '+15551234567' }), '+15551234567');
});

test('the status line drops its separator when there is no number', () => {
  assert.equal(labels.callStatus({ state: 'ringing', number: '' }), 'Ringing');
  assert.equal(labels.callStatus({ state: 'dialing', number: '' }), 'Dialling');
  assert.equal(labels.callStatus({ state: 'active', number: '' }), 'In progress');
});

test('the status line keeps its separator when there is one', () => {
  // The control for the test above: proving the bullet is gone means nothing unless it is shown
  // to still appear where it belongs.
  assert.equal(
    labels.callStatus({ state: 'ringing', number: '+919800000003' }),
    'Ringing · +919800000003',
  );
});

test('firstNonEmpty is the rule the rest of the pane can reuse', () => {
  assert.equal(labels.firstNonEmpty('', 'b'), 'b');
  assert.equal(labels.firstNonEmpty(undefined, null, 'c'), 'c');
  assert.equal(labels.firstNonEmpty('', undefined), undefined);
});

// ---- The disc colour, which is the design's per-contact fill ---------------------------------------

/**
 * `discKeyOf` decides what a disc's colour is keyed on, and the answer is deliberately **not** the
 * initials.
 *
 * This phone's log is the reason. It has six consecutive `VENKY SIT` rows and an `SB` that is a
 * different person from another `SB` two rows below — so keying on the two letters in the circle
 * would give the same colour to different people, which is precisely the confusion the colour was
 * added to break. Keying on the name (or the number, when there is no name) gives one person one
 * colour and two people two.
 */
test('a disc is coloured by who it is, not by the two letters in it', () => {
  const keyOf = (globalThis as Record<string, unknown>).__callLabels as {
    discKeyOf(entry: { contactName?: string; number?: string }): string;
    callInitials(entry: { contactName?: string; number?: string }): string;
  };

  const sahil = { contactName: 'Sahil Bhapkar' };
  const saurabh = { contactName: 'Saurabh Bhapkar' };
  // The control: these two genuinely collide on the thing we are NOT keying on.
  assert.equal(
    keyOf.callInitials(sahil),
    keyOf.callInitials(saurabh),
    'control: the two names must share initials, or this test proves nothing',
  );
  assert.notEqual(keyOf.discKeyOf(sahil), keyOf.discKeyOf(saurabh));
  assert.notEqual(discHue(keyOf.discKeyOf(sahil)), discHue(keyOf.discKeyOf(saurabh)));
});

test('the same person is the same colour every time, and a nameless caller falls back to the number', () => {
  const keyOf = (globalThis as Record<string, unknown>).__callLabels as {
    discKeyOf(entry: { contactName?: string; number?: string }): string;
  };
  // Deterministic: a colour that changes when a list is redrawn looks like the row changed.
  assert.equal(discHue('Sahil Bhapkar'), discHue('Sahil Bhapkar'));
  assert.equal(keyOf.discKeyOf({ contactName: 'Mom', number: '+911' }), 'Mom');
  assert.equal(keyOf.discKeyOf({ number: '+919800000001' }), '+919800000001');
  // Defect 35's shape: an empty string is not a name, and `??` would have let it through.
  assert.equal(keyOf.discKeyOf({ contactName: '', number: '+91980' }), '+91980');
  // Never throws on nothing at all — a disc is drawn from whatever a provider sent.
  assert.equal(typeof discHue(keyOf.discKeyOf({})), 'number');
});

test('every hue is a legal one, over the whole of this phone’s real log', () => {
  // The control this needs is range, not a spot check: an `hsl()` outside 0–359 silently renders as
  // nothing in some engines and as a wrapped hue in others, and neither says so.
  const names = [
    'Chetan', 'Sahil Chaudhary', 'Saurabh Bhapkar', 'VENKY SIT', 'Mother', '+919800000001',
    '', '#', 'Ω', '🙂 emoji name', 'a'.repeat(400),
  ];
  for (const name of names) {
    const hue = discHue(name);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${JSON.stringify(name)} → ${hue}`);
  }
});
