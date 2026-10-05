import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import '../shared/callAudio';
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


/**
 * Defect 124, narrowed by decision 1(c) (2026-10-05).
 *
 * Both audio sentences once offered *pair the Mac over Bluetooth to listen* — the remedy
 * `CLAUDE.md` retracted after measuring it on 2026-09-14. The pane now draws one sentence from
 * `src/shared/callAudio.ts`, and this file still may not name Bluetooth anywhere: the one sentence
 * that does is the capability row's, and the pane must not be able to reach it.
 */
test('the Calls pane draws the approved sentence, which offers no remedy', () => {
  const labels = (globalThis as Record<string, unknown>).__callLabels as { paneAudioSentence(): string };
  const line = labels.paneAudioSentence();
  assert.equal(line, 'Phone call audio on Mac is not available. No Mac and phone have been verified for it.');
  assert.doesNotMatch(line, /bluetooth|pair the mac/i, 'the pane sentence offers the retracted remedy');
});

test('nothing in calls.ts names Bluetooth or reaches the capability sentence', () => {
  const source = readFileSync(join(__dirname, 'calls.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(source.includes('paneAudioSentence'), 'control: the stripped source still holds the code');
  assert.doesNotMatch(source, /bluetooth/i, 'a string in calls.ts mentions Bluetooth');
  assert.doesNotMatch(source, /capability-row|CALL_AUDIO_CAPABILITY_SENTENCE/, 'the pane can reach the capability sentence');
  assert.doesNotMatch(source, /CALL_AUDIO_WALL|CALL_AUDIO_LIVE/, 'a second, local audio sentence came back');
});
