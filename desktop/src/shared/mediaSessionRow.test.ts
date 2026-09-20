import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { mediaSessionRow } = createRequire(import.meta.url)(
  './mediaSessionRow.ts',
) as typeof import('./mediaSessionRow');

const playing = {
  active: true,
  package: 'com.spotify.music',
  appName: 'Spotify',
  title: 'Teardrop',
  artist: 'Massive Attack',
  album: 'Mezzanine',
  playing: true,
  canSkipNext: true,
  canSkipPrevious: false,
};
const notif = { package: 'com.spotify.music', title: 'Teardrop', text: 'Massive Attack' };

test('the playing app’s notification becomes the media row, from the session’s own words', () => {
  const row = mediaSessionRow(notif, playing);
  assert.ok(row);
  assert.equal(row!.title, 'Teardrop');
  assert.equal(row!.subtitle, 'Massive Attack — Mezzanine');
  assert.equal(row!.playing, true);
});

/**
 * The rule the frame is drawn for: **only** where the packages match. Every other notification in
 * the feed is an ordinary one, and there is never a *Nothing playing* row in a list.
 */
test('another app’s notification is not the media row, and neither is one with no session', () => {
  assert.equal(mediaSessionRow({ package: 'com.google.android.gm', title: 'Priya' }, playing), null);
  assert.equal(mediaSessionRow(notif, null), null);
  assert.equal(mediaSessionRow(notif, { ...playing, active: false }), null);
  // The control: the matching notification with the live session really does produce a row.
  assert.ok(mediaSessionRow(notif, playing));
});

test('a control the session does not offer is not reported as available', () => {
  const row = mediaSessionRow(notif, playing)!;
  assert.equal(row.canSkipNext, true);
  assert.equal(row.canSkipPrevious, false, 'a skip the session refuses was reported as available');
  // Absent fields are refusals, not unknowns: the protocol sends what it allows.
  const bare = mediaSessionRow(notif, { active: true, package: notif.package, title: 'x' })!;
  assert.equal(bare.canSkipNext, false);
  assert.equal(bare.canSkipPrevious, false);
  assert.equal(bare.playing, false);
});

test('a paused session still draws the row — pausing is not the absence of a session', () => {
  const row = mediaSessionRow(notif, { ...playing, playing: false });
  assert.ok(row);
  assert.equal(row!.playing, false);
});

test('a session with no title falls back to the notification, and to nothing rather than a blank row', () => {
  const fromNotif = mediaSessionRow(notif, { ...playing, title: undefined });
  assert.equal(fromNotif?.title, 'Teardrop');
  assert.equal(
    mediaSessionRow({ package: notif.package }, { ...playing, title: '   ' }),
    null,
    'a row with nothing to say was drawn anyway',
  );
});

test('the subtitle carries what exists and no separator for what does not', () => {
  assert.equal(mediaSessionRow(notif, { ...playing, album: undefined })!.subtitle, 'Massive Attack');
  assert.equal(mediaSessionRow(notif, { ...playing, artist: undefined })!.subtitle, 'Mezzanine');
  assert.equal(mediaSessionRow(notif, { ...playing, artist: undefined, album: undefined })!.subtitle, '');
});
