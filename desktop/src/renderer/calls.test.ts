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
