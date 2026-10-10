import { test } from 'node:test';
import assert from 'node:assert/strict';

const { shouldRefreshOnReturn, mergeFirstPage, RETURN_MIN_GAP_MS } = require('./returnRefresh') as {
  shouldRefreshOnReturn: (i: { trigger: 'route' | 'focus' | 'visible' | 'reconnect'; nowMs: number; lastAskedAtMs: number | null; inFlight: boolean }) => boolean;
  mergeFirstPage: <T>(held: T[], fresh: T[], hasMore: boolean, id: (t: T) => string) => { items: T[]; added: number; removed: number; reset: boolean };
  RETURN_MIN_GAP_MS: number;
};

const id = (s: string) => s;

test('a pane that never asked asks on any return', () => {
  for (const trigger of ['route', 'focus', 'visible', 'reconnect'] as const) {
    assert.equal(shouldRefreshOnReturn({ trigger, nowMs: 0, lastAskedAtMs: null, inFlight: false }), true, trigger);
  }
});

test('a focus and a route in the same second are one ask; a reconnect always asks', () => {
  const just = { nowMs: 10_000, lastAskedAtMs: 10_000 - (RETURN_MIN_GAP_MS - 1), inFlight: false };
  assert.equal(shouldRefreshOnReturn({ trigger: 'focus', ...just }), false);
  assert.equal(shouldRefreshOnReturn({ trigger: 'route', ...just }), false);
  assert.equal(shouldRefreshOnReturn({ trigger: 'reconnect', ...just }), true);
  assert.equal(shouldRefreshOnReturn({ trigger: 'focus', nowMs: 10_000, lastAskedAtMs: 10_000 - RETURN_MIN_GAP_MS, inFlight: false }), true);
});

test('a request in flight is never doubled, even by a reconnect', () => {
  for (const trigger of ['route', 'focus', 'visible', 'reconnect'] as const) {
    assert.equal(shouldRefreshOnReturn({ trigger, nowMs: 99_999, lastAskedAtMs: 0, inFlight: true }), false, trigger);
  }
});

test('new items go on top and the pages already scrolled through are kept', () => {
  const merged = mergeFirstPage(['A', 'B', 'C', 'D', 'E', 'F'], ['N', 'A', 'C', 'D'], true, id);
  assert.deepEqual(merged.items, ['N', 'A', 'C', 'D', 'E', 'F']);
  assert.equal(merged.added, 1);
  assert.equal(merged.removed, 1, 'B left the window the fresh page covers — deleted on the phone');
  assert.equal(merged.reset, false);
});

test('nothing changed is a no-op with the same order', () => {
  const merged = mergeFirstPage(['A', 'B', 'C'], ['A', 'B'], true, id);
  assert.deepEqual(merged.items, ['A', 'B', 'C']);
  assert.equal(merged.added + merged.removed, 0);
});

test('a fresh page sharing nothing with what is held, with more to come, resets rather than splicing a hole', () => {
  const merged = mergeFirstPage(['A', 'B'], ['X', 'Y'], true, id);
  assert.equal(merged.reset, true);
  assert.deepEqual(merged.items, ['A', 'B'], 'the held list is returned untouched for the caller to replace');
});

test('without more pages the fresh page is the whole list, so held items beyond it are gone', () => {
  assert.deepEqual(mergeFirstPage(['A', 'B', 'C'], ['N', 'A'], false, id), { items: ['N', 'A'], added: 1, removed: 2, reset: false });
  assert.deepEqual(mergeFirstPage(['A', 'B'], ['X'], false, id), { items: ['X'], added: 1, removed: 2, reset: false });
  assert.deepEqual(mergeFirstPage([], ['X'], true, id), { items: ['X'], added: 1, removed: 0, reset: false });
});
