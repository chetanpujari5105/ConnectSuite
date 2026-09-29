import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FilesClient, digestOf } from './files';

/**
 * Mac → phone above 64 MiB was sent with **no digest**, so the phone could only ever report
 * `verified: false` for the files most likely to be damaged in transit (2026-09-29, the overnight
 * record §9). These tests drive the product's `FilesClient.push` against a fake link and a fake bulk
 * client, and read the `fs.transfer.begin` payload the phone would have received.
 *
 * The file above the old ceiling is **sparse** (`truncate`), so the test costs 65 MiB of hashing and
 * no disk.
 */

const OLD_CEILING = 64 * 1024 * 1024;

function harness() {
  const begins: Array<Record<string, unknown>> = [];
  const link = {
    isConnected: () => true,
    request: async (type: string, payload: Record<string, unknown>) => {
      if (type === 'fs.transfer.begin') begins.push(payload);
      return { type, payload: { transferId: 't-test', offset: 0, chunkMax: 262144 } };
    },
  };
  const bulk = { push: async () => ({ ok: true, bytes: 0, elapsedMs: 1 }) };
  const client = new FilesClient(
    () => link as never,
    () => bulk as never,
    () => ({ host: '127.0.0.1', token: 'tok' }),
  );
  return { client, begins };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sidekick-push-'));
}

test('a push above the old 64 MiB ceiling carries the whole file’s digest', { timeout: 30_000 }, async () => {
  const dir = tempDir();
  const big = join(dir, 'big.bin');
  writeFileSync(big, '');
  truncateSync(big, OLD_CEILING + 1);
  const expected = createHash('sha256');
  expected.update(Buffer.alloc(OLD_CEILING + 1));

  const { client, begins } = harness();
  const outcome = await client.push({ rootId: 'downloads:connectsuite', path: '', source: big });

  assert.equal(outcome.ok, true);
  assert.equal(begins.length, 1);
  assert.equal(begins[0]!.size, OLD_CEILING + 1);
  assert.equal(begins[0]!.sha256, expected.digest('hex'), 'the phone is given a digest to check against');
});

test('a digest the caller already computed is sent as-is, so a renamed retry does not re-read the file', async () => {
  const dir = tempDir();
  const file = join(dir, 'x.bin');
  writeFileSync(file, randomBytes(4096));
  const { client, begins } = harness();
  await client.push({ rootId: 'r', path: '', source: file, name: 'x (2).bin', sha256: 'ab'.repeat(32) });
  assert.equal(begins[0]!.sha256, 'ab'.repeat(32));
  assert.equal(begins[0]!.name, 'x (2).bin');
});

test('a caller whose hash failed sends no digest (unverified), never an empty or made-up one', async () => {
  const dir = tempDir();
  const file = join(dir, 'y.bin');
  writeFileSync(file, randomBytes(10));
  const { client, begins } = harness();
  await client.push({ rootId: 'r', path: '', source: file, sha256: null });
  assert.equal('sha256' in begins[0]!, false);
});

test('digestOf equals a one-shot SHA-256 and reports progress with a denominator-sized total', async () => {
  const dir = tempDir();
  const file = join(dir, 'z.bin');
  const bytes = randomBytes(3 * 1024 * 1024 + 7);
  writeFileSync(file, bytes);
  const seen: number[] = [];
  const result = await digestOf(file, { onProgress: (n) => seen.push(n), progressEveryMs: 0 });
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.aborted, false);
  assert.ok(seen.length >= 1, 'progress was reported');
  assert.ok(seen.every((n, i) => n <= bytes.length && (i === 0 || n >= seen[i - 1]!)), 'monotonic, bounded');
});

test('digestOf stops when aborted and returns no digest', async () => {
  const dir = tempDir();
  const file = join(dir, 'w.bin');
  writeFileSync(file, '');
  truncateSync(file, 512 * 1024 * 1024);
  const abort = new AbortController();
  const running = digestOf(file, {
    signal: abort.signal,
    progressEveryMs: 0,
    onProgress: (n) => { if (n >= 8 * 1024 * 1024) abort.abort(); },
  });
  const result = await running;
  assert.equal(result.aborted, true);
  assert.equal(result.sha256, null);
  assert.ok(result.bytes < 512 * 1024 * 1024, `stopped early (${result.bytes} bytes read)`);
});

test('digestOf on a missing file is null with the reason, not a throw', async () => {
  const result = await digestOf(join(tempDir(), 'absent.bin'));
  assert.equal(result.sha256, null);
  assert.equal(result.aborted, false);
  assert.match(result.error ?? '', /ENOENT/);
});
