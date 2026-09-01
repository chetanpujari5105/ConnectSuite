import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipHistory, byteLength, tooLarge, MAX_TEXT_BYTES } from './clipboardHistory';

test('a sensitive item is never stored', () => {
  const history = new ClipHistory();
  assert.equal(history.add({ kind: 'sensitive', atMs: 1, source: 'phone' }), false);
  assert.equal(history.size, 0);
});

test('the cap counts UTF-8 bytes, so emoji cannot slip past a length check', () => {
  // 20,000 emoji: 40,000 UTF-16 units, 80,000 bytes. A `.length` check would let it through, and
  // the phone's twin test learned the same thing by going red at 40,000.
  const emoji = '😀'.repeat(20_000);
  assert.equal(emoji.length, 40_000);
  assert.equal(byteLength(emoji), 80_000);
  assert.equal(tooLarge(emoji), true);
});

test('exactly at the cap is allowed, one byte over is not', () => {
  assert.equal(tooLarge('a'.repeat(MAX_TEXT_BYTES)), false);
  assert.equal(tooLarge('a'.repeat(MAX_TEXT_BYTES + 1)), true);
});

// The echo rule's test moved to `clipEcho.test.ts` with the rule itself. It is not duplicated here:
// a test left behind over a deleted function passes forever and reads like coverage.

test('duplicates collapse to the most recent occurrence', () => {
  const history = new ClipHistory();
  history.add({ kind: 'text', text: 'one', atMs: 1, source: 'phone' });
  history.add({ kind: 'text', text: 'two', atMs: 2, source: 'phone' });
  history.add({ kind: 'text', text: 'one', atMs: 3, source: 'phone' });

  const entries = history.newestFirst();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'one');
  assert.equal(entries[0].atMs, 3, 'the collapsed entry keeps the new timestamp');
  assert.equal(entries[1].text, 'two');
});

test('the history is bounded and drops the oldest', () => {
  const history = new ClipHistory(3);
  for (let i = 1; i <= 5; i += 1) {
    history.add({ kind: 'text', text: `entry ${i}`, atMs: i, source: 'phone' });
  }
  assert.deepEqual(history.newestFirst().map((e) => e.text), ['entry 5', 'entry 4', 'entry 3']);
});

test('clear reports how much it removed', () => {
  const history = new ClipHistory();
  history.add({ kind: 'text', text: 'one', atMs: 1, source: 'phone' });
  assert.equal(history.clear(), 1);
  assert.equal(history.clear(), 0);
});
