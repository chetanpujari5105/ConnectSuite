import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PhotosClient } from './photos';
import { pullSpaceRefusal } from './files';

/**
 * Photos pulls (2026-09-29):
 * - the phone's `sha256` in the `media.original` ack was parsed and **never passed** to the pull, so a
 *   photo could not be verified even from a phone that hashed it;
 * - large-file increment L3: a pull that cannot fit is refused before any byte, with the numbers, and
 *   the phone's agreed transfer is cancelled rather than left waiting.
 * Driven through the product's `PhotosClient.original` with a fake link and bulk client, into a temp
 * folder (`into`), never the person's receive folder.
 */

function harness(ticket: Record<string, unknown>) {
  const requests: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  const link = {
    isConnected: () => true,
    request: async (type: string, payload: Record<string, unknown>) => {
      requests.push({ type, payload });
      return { type, payload: type === 'media.original' ? ticket : {} };
    },
  };
  const bulk = {
    pull: async (o: Record<string, unknown>) => {
      pulls.push(o);
      return { ok: true, path: String(o.destination), bytes: Number(o.expectedBytes), elapsedMs: 1, verified: o.expectedSha256 != null };
    },
  };
  const client = new PhotosClient(() => link as never, () => bulk as never, () => ({ host: '127.0.0.1', token: 't' }));
  return { client, requests, pulls };
}

test('the digest the phone agreed reaches the pull', async () => {
  const sha = 'ab'.repeat(32);
  const h = harness({ transferId: 'tf-x', size: 1000, mime: 'image/jpeg', name: 'IMG.jpg', sha256: sha, chunkMax: 262144 });
  const r = await h.client.original('42', mkdtempSync(join(tmpdir(), 'sk-photo-')));
  assert.equal(r.ok, true);
  assert.equal(h.pulls.length, 1);
  assert.equal(h.pulls[0]!.expectedSha256, sha);
});

test('a phone that sent no digest gives an unverified pull, never an invented digest', async () => {
  const h = harness({ transferId: 'tf-y', size: 1000, mime: 'image/jpeg', name: 'IMG.jpg', sha256: null, chunkMax: 262144 });
  await h.client.original('43', mkdtempSync(join(tmpdir(), 'sk-photo-')));
  assert.equal(h.pulls[0]!.expectedSha256, null);
});

test('L3: a file that cannot fit is refused before any byte, and the phone’s agreed transfer is cancelled', async () => {
  // Control: the refusal rule itself, with a fake statfs.
  const tight = async () => ({ bavail: 100, bsize: 4096 }); // 409,600 bytes free
  const sentence = await pullSpaceRefusal('/x', 5_000_000_000, tight);
  assert.match(sentence ?? '', /needs 5\.5 GB free in the receive folder and has 1 MB\. Nothing was copied\./);
  assert.equal(await pullSpaceRefusal('/x', 1_000, async () => ({ bavail: 1e6, bsize: 4096 })), null, 'room: no refusal');
  assert.equal(await pullSpaceRefusal('/x', 1_000, async () => { throw new Error('ENOTSUP'); }), null, 'an unreadable free space does not block the pull');

  // Through the product: a size larger than any disk.
  const h = harness({ transferId: 'tf-z', size: 1e18, mime: 'video/mp4', name: 'huge.mp4', sha256: null, chunkMax: 262144 });
  const r = await h.client.original('44', mkdtempSync(join(tmpdir(), 'sk-photo-')));
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /isn't room on this Mac/);
  assert.equal(h.pulls.length, 0, 'no bytes were pulled');
  const cancel = h.requests.find((q) => q.type === 'fs.transfer.cancel');
  assert.deepEqual(cancel?.payload, { transferId: 'tf-z', reason: 'no-space' });
});

test('a thumbnail asked at another size is fetched at that size, not served from the first size’s cache', async () => {
  const asked: number[] = [];
  const link = {
    isConnected: () => true,
    request: async (type: string, payload: Record<string, unknown>) => {
      if (type === 'media.thumb') asked.push(Number(payload.maxEdge));
      return { type, payload: { thumbs: (payload.ids as string[]).map((id) => ({ id, mime: 'image/jpeg', width: 1, height: 1, data: `edge-${payload.maxEdge}` })) } };
    },
  };
  const client = new PhotosClient(() => link as never, () => null, () => ({ host: null, token: null }));
  const a = await client.thumbsFor(['7'], 256);
  const b = await client.thumbsFor(['7'], 512);
  const c = await client.thumbsFor(['7'], 256);
  assert.deepEqual(asked, [256, 512], 'each size asked once; the repeat at 256 is a cache hit');
  assert.equal(a.ok && a.data.get('7')?.includes('edge-256'), true);
  assert.equal(b.ok && b.data.get('7')?.includes('edge-512'), true);
  assert.equal(c.ok && c.data.get('7')?.includes('edge-256'), true);
});
