import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { islandLineFor, islandStatusChange, ISLAND_CATEGORIES } = require_('./islandRota.ts') as {
  islandLineFor(event: { category: string; kind: string; detail: string }): string | null;
  islandStatusChange(
    previous: { phase?: string; lastError?: string | null } | null,
    next: { phase?: string; lastError?: string | null } | null,
  ): { seize: boolean; note: string | null };
  ISLAND_CATEGORIES: readonly string[];
};
const { ACTIVITY_CATEGORIES } = require_('./activity.ts') as { ACTIVITY_CATEGORIES: string[] };

const at = (category: string, kind: string, detail = '') => ({ category, kind, detail });

test('the two the departure names are narrated', () => {
  // S6: the handoff cycles "Clipboard synced" and "Transfer complete · 4.2 MB", and the row said
  // both name features that do not exist. Both exist.
  assert.equal(islandLineFor(at('clipboard', 'Sent to phone', 'from this Mac')), 'Sent to phone · from this Mac');
  assert.equal(islandLineFor(at('files', 'Copied to this Mac', 'clip_final.mp4 · 67 MB')), 'Copied to this Mac · clip_final.mp4 · 67 MB');
});

test('system and mirroring are silent, because the island already says those from the link', () => {
  // The island narrates the connection phase live. A five-minute-old "Connected" history entry
  // alternating with the live one is the same fact twice, in two tenses.
  assert.equal(islandLineFor(at('system', 'ConnectSuite started', 'version 2.0.0')), null);
  assert.equal(islandLineFor(at('mirroring', 'Session started', '1920 × 1080')), null);
});

test('a category nobody has decided about is silent, not narrated', () => {
  // The opposite of what an "everything except system" filter would do. A new category added to
  // `ActivityCategory` falls through to null until somebody chooses.
  assert.equal(islandLineFor(at('screenshots', 'Saved', 'to Desktop')), null);
});

test('every narrated category is a real one, and the two lists are checked against each other', () => {
  // The control on the list itself: a typo in `ISLAND_CATEGORIES` would make that entry silently
  // narrate nothing, forever, with nothing to notice. `ACTIVITY_CATEGORIES` is the enumeration.
  assert.ok(ACTIVITY_CATEGORIES.length >= 6, 'control: the enumeration is populated');
  for (const category of ISLAND_CATEGORIES) {
    assert.ok(
      ACTIVITY_CATEGORIES.includes(category),
      `${category} is narrated by the island and is not an activity category`,
    );
  }
});

test('a long detail is cut, and one with no room is dropped whole', () => {
  const long = islandLineFor(at('files', 'Copied to this Mac', 'x'.repeat(200)));
  assert.ok(long && long.length <= 64, `the line was ${long?.length} characters`);
  assert.match(long ?? '', /…$/);

  // "Sent · …" says less than "Sent" and takes more room to say it, so the detail goes entirely.
  const noRoom = islandLineFor(at('files', 'A'.repeat(60), 'some detail'));
  assert.equal(noRoom, 'A'.repeat(60));
});

test('an empty detail leaves no dangling separator', () => {
  // The same bullet-over-nothing defect 35 produced on the call card.
  assert.equal(islandLineFor(at('calls', 'Missed call')), 'Missed call');
  assert.equal(islandLineFor(at('calls', 'Missed call', '   ')), 'Missed call');
});

test('an event with no kind is not narrated as a bare bullet', () => {
  assert.equal(islandLineFor(at('files', '', 'a detail with no verb')), null);
});

// ---- The reason the rota was never visible ------------------------------------------------------

test('latency jitter does not seize the island', () => {
  // This is the whole defect S6 was hiding. `setIsland` ran on every status update and `rttMs`
  // changes on every heartbeat, so the rota's text was overwritten within a second or two of every
  // cycle. A rota that cycles and is always overwritten looks exactly like a rota with one entry.
  const before = { phase: 'connected', lastError: null };
  const after = { phase: 'connected', lastError: null };
  assert.deepEqual(islandStatusChange(before, after), { seize: false, note: null });
});

test('a phase change does seize it', () => {
  assert.deepEqual(islandStatusChange({ phase: 'searching' }, { phase: 'connected' }), {
    seize: true,
    note: null,
  });
  // And from nothing at all, which is the first status of the session.
  assert.equal(islandStatusChange(null, { phase: 'searching' }).seize, true);
});

test('a new error seizes it and enters the rota; the same error repeated does neither', () => {
  const first = islandStatusChange({ phase: 'connected', lastError: null }, { phase: 'connected', lastError: 'refused' });
  assert.deepEqual(first, { seize: true, note: 'refused' });

  // The same error arriving again with every heartbeat must not fill six slots with one sentence,
  // which is the flooding this function exists to stop, one field over.
  const again = islandStatusChange({ phase: 'connected', lastError: 'refused' }, { phase: 'connected', lastError: 'refused' });
  assert.deepEqual(again, { seize: false, note: null });
});
