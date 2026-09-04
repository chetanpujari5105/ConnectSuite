import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveNotifications } from './liveNotifications';

/** A stand-in for Electron's `Notification` — the registry never calls anything on it. */
const handle = (name: string) => ({ name });

test('a retained handle comes back on release — the click path can find its instance', () => {
  const live = new LiveNotifications<{ name: string }>();
  const a = handle('a');
  live.retain('k1', a);
  assert.equal(live.release('k1'), a);
});

test('releasing a key nobody holds returns null rather than throwing — that is the reading', () => {
  const live = new LiveNotifications<{ name: string }>();
  assert.equal(live.release('never-held'), null);
});

test('a second post under one key hands back the one it superseded', () => {
  const live = new LiveNotifications<{ name: string }>();
  const first = handle('first');
  const second = handle('second');
  assert.equal(live.retain('k1', first), null, 'nothing was held the first time');
  assert.equal(live.retain('k1', second), first, 'the caller is given the old banner to close');
  assert.equal(live.size, 1, 'one key, one handle');
});

test('releaseAll hands back everything held, and holds nothing after', () => {
  const live = new LiveNotifications<{ name: string }>();
  live.retain('k1', handle('a'));
  live.retain('k2', handle('b'));
  const released = live.releaseAll();
  assert.equal(released.length, 2);
  assert.equal(live.size, 0);
  assert.equal(live.release('k1'), null);
});

/**
 * The invariant the whole file exists for: the number the badge draws and the number of handles
 * retained are the same number, because they are the same container.
 *
 * Shown red first against the two-container version this replaces — a `Set` for the badge and a
 * `Map` for retention, with `release` deleting from the set only. That mutation leaves every test
 * above green and fails here at the first release.
 */
test('badge count and retained handles cannot disagree, through every transition', () => {
  const live = new LiveNotifications<{ name: string }>();
  const retained = new Set<{ name: string }>();

  const retain = (key: string, h: { name: string }) => {
    const superseded = live.retain(key, h);
    if (superseded) retained.delete(superseded);
    retained.add(h);
  };
  const release = (key: string) => {
    const h = live.release(key);
    if (h) retained.delete(h);
  };

  retain('k1', handle('a'));
  retain('k2', handle('b'));
  assert.equal(live.size, retained.size, 'after two posts');

  retain('k1', handle('a2'));
  assert.equal(live.size, retained.size, 'after a re-post under a held key');
  assert.equal(live.size, 2);

  release('k2');
  assert.equal(live.size, retained.size, 'after a phone-side removal');

  release('gone');
  assert.equal(live.size, retained.size, 'after a release nobody held');

  for (const h of live.releaseAll()) retained.delete(h);
  assert.equal(live.size, 0);
  assert.equal(retained.size, 0, 'markAllSeen leaves nothing retained — no leak');
});
