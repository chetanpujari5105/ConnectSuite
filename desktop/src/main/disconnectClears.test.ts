import assert from 'node:assert/strict';
import test from 'node:test';

import { AppsClient } from './apps';
import { PhotosClient } from './photos';

/**
 * PC-only audit F1 (2026-10-07): `main.ts` runs every disconnect clear on **each** non-connected status
 * tick — correctly, since a late ack can land after the drop — and several clears logged even when they
 * removed nothing. One outage wrote 148 × "Cleared 0 …" lines per pane and rotated the soak's own
 * evidence out of the 512 KB log. A clear with nothing to remove now says nothing; one that removes
 * something still says so, with its count.
 */
function linesFrom(tag: string, act: () => void): string[] {
  const seen: string[] = [];
  const real = console.log;
  console.log = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
  try {
    act();
  } finally {
    console.log = real;
  }
  return seen.filter((l) => l.includes(`[${tag}]`));
}

test('photos: an empty clear is silent on every tick; a clear that drops thumbnails is logged once', () => {
  const p = new PhotosClient(() => null, () => null, () => ({ host: null, token: null }));
  assert.deepEqual(linesFrom('photos', () => { p.clear(); p.clear(); p.clear(); }), []);
  (p as unknown as { thumbs: Map<string, string> }).thumbs.set('1', '/t/1.jpg');
  const held = linesFrom('photos', () => { p.clear(); p.clear(); });
  assert.equal(held.length, 1, `control: a clear that removed something is logged: ${held.join(' | ')}`);
  assert.match(held[0]!, /cleared 1 cached thumbnail/);
});

test('apps: an empty clear is silent on every tick; a clear that drops icons is logged once', () => {
  const a = new AppsClient(() => null);
  assert.deepEqual(linesFrom('apps', () => { a.clear(); a.clear(); a.clear(); }), []);
  (a as unknown as { icons: Map<string, string> }).icons.set('com.example', '/i/1.png');
  const held = linesFrom('apps', () => { a.clear(); a.clear(); });
  assert.equal(held.length, 1, `control: a clear that removed something is logged: ${held.join(' | ')}`);
  assert.match(held[0]!, /cleared 1 cached app icon/);
});
