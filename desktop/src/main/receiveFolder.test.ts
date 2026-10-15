import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareReceiveFolder } from './downloads';
import { PhotosClient } from './photos';

/**
 * Save to Mac when the receive folder cannot be written (2026-10-15).
 *
 * The stimulus is a real failing `mkdir`, not a stubbed one: a plain **file** sits where the parent
 * folder should be, so creating the folder fails with `ENOTDIR` from the filesystem itself. The case
 * that matters in the field — a fresh macOS account answering Don't Allow to the Downloads prompt,
 * `EPERM` — cannot be produced from a test, and these tests do not claim to reach it; they reach
 * the same `catch`.
 */

function blockedFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'sk-receive-'));
  writeFileSync(join(root, 'Downloads'), 'a file where a folder should be');
  return join(root, 'Downloads', 'Sidekick');
}

test('the default folder that cannot be created is a refusal with a sentence, not a throw', async () => {
  const folder = blockedFolder();
  const ready = await prepareReceiveFolder(null, folder);
  assert.equal(ready.ok, false);
  if (ready.ok) return;
  assert.match(ready.reason, /could not create the folder/);
  assert.match(ready.reason, /Nothing was copied\./);
  assert.ok(ready.reason.includes(folder), 'the sentence names the folder');
  assert.match(ready.fixHint, /Settings → File transfer/);
});

test('control: the default folder that can be created is created and returned', async () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'sk-receive-')), 'Downloads', 'Sidekick');
  const ready = await prepareReceiveFolder(null, folder);
  assert.deepEqual(ready, { ok: true, folder });
  assert.equal(existsSync(folder), true);
});

test('Save to Mac into a folder that cannot be created refuses with a sentence and cancels the agreed transfer', async () => {
  const requests: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let pulled = 0;
  const link = {
    isConnected: () => true,
    request: async (type: string, payload: Record<string, unknown>) => {
      requests.push({ type, payload });
      return {
        type,
        payload: type === 'media.original'
          ? { transferId: 'tf-blocked', size: 1000, mime: 'image/jpeg', name: 'IMG.jpg', sha256: null, chunkMax: 262144 }
          : {},
      };
    },
  };
  const bulk = { pull: async () => { pulled += 1; return { ok: true }; } };
  const client = new PhotosClient(() => link as never, () => bulk as never, () => ({ host: '127.0.0.1', token: 't' }));

  const result = await client.original('7', blockedFolder());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason ?? '', /could not create the folder .* \(ENOTDIR\)\. Nothing was copied\./);
  assert.equal(pulled, 0, 'no bulk socket is opened for a file with nowhere to go');
  const cancel = requests.find((r) => r.type === 'fs.transfer.cancel');
  assert.ok(cancel, 'the phone is told, so it is not left holding an agreed transfer');
  assert.equal(cancel.payload.transferId, 'tf-blocked');
});
