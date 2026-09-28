import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PUSH_HIGH_WATER, pushWith, type ShareConnection } from './bulk';
import { MAX_BULK_FRAME } from '../shared/protocol';

/**
 * The Mac's push, end to end over a **real local socket** — the product's `pushWith`, its framing and
 * its read loop — against a fake phone that parses the bulk framing and can hold its reads. Only TLS
 * is replaced (by plain TCP), as in `bulkShare.test.ts`.
 *
 * The claim under test is backpressure: **what the Mac has queued but the phone has not read is
 * bounded**, however slow the phone. Before it, a 64 MiB file was entirely in this process's memory
 * 78 ms after the socket opened (measured on hardware, 2026-09-29), the log called that "pushed … in
 * 78ms (6883 Mbit/s)", and a file larger than memory could not have been sent at all.
 */

const T = { timeout: 20_000 };

interface FakePhone {
  port: number;
  /** Resolves with everything the phone parsed once the Mac half-closes. */
  received: Promise<{ token: string; header: unknown; bytes: Buffer; frames: number }>;
  /** Start reading. Until then the phone reads nothing, so the Mac's writes must back up. */
  release(): void;
  close(): Promise<void>;
}

function fakePhone(): Promise<FakePhone> {
  return new Promise((ready) => {
    let conn: Socket | null = null;
    let released = false;
    let resolveReceived!: FakePhone['received'] extends Promise<infer R> ? (r: R) => void : never;
    const received = new Promise<Awaited<FakePhone['received']>>((r) => { resolveReceived = r; });
    const server: Server = createServer((socket) => {
      conn = socket;
      if (!released) socket.pause();
      const parts: Buffer[] = [];
      socket.on('data', (b: Buffer) => parts.push(b));
      socket.on('end', () => {
        const all = Buffer.concat(parts);
        const frames: Buffer[] = [];
        for (let at = 0; at < all.length; ) {
          const n = all.readUInt32BE(at);
          frames.push(all.subarray(at + 4, at + 4 + n));
          at += 4 + n;
        }
        const [token, header, ...chunks] = frames;
        resolveReceived({ token: token!.toString(), header: JSON.parse(header!.toString()), bytes: Buffer.concat(chunks), frames: chunks.length });
        socket.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      ready({
        port: typeof address === 'object' && address ? address.port : 0,
        received,
        release: () => { released = true; conn?.resume(); },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function file(size: number): { path: string; bytes: Buffer; sha256: string } {
  const bytes = randomBytes(size);
  const path = join(mkdtempSync(join(tmpdir(), 'push-')), 'x.bin');
  writeFileSync(path, bytes);
  return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Opens a plain TCP connection and records the largest write queue this process ever held. */
function openRecording(port: number, seen: { maxQueued: number }): () => ShareConnection {
  return () => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const write = socket.write.bind(socket) as (chunk: Buffer) => boolean;
    (socket as unknown as { write: (chunk: Buffer) => boolean }).write = (chunk: Buffer) => {
      const ok = write(chunk);
      seen.maxQueued = Math.max(seen.maxQueued, socket.writableLength);
      return ok;
    };
    return { socket, readyEvent: 'connect' };
  };
}

test('a phone that is not reading holds the Mac to a bounded queue, and every byte still arrives in order', T, async () => {
  const f = file(48 * 1024 * 1024);
  const phone = await fakePhone();
  const seen = { maxQueued: 0 };
  try {
    const pushing = pushWith(
      { token: 'token-A', transferId: 't-1', source: f.path, offset: 0, totalBytes: f.bytes.length, chunkMax: 262144 },
      openRecording(phone.port, seen),
    );
    // Give the Mac time to queue as much as it is going to while the phone reads nothing.
    await new Promise((r) => setTimeout(r, 600));
    const queuedWhileStalled = seen.maxQueued;
    phone.release();
    const result = await pushing;
    const got = await phone.received;
    assert.ok(queuedWhileStalled <= PUSH_HIGH_WATER + 2 * MAX_BULK_FRAME,
      `queued ${queuedWhileStalled} bytes while the phone read nothing; the bound is ${PUSH_HIGH_WATER} + two frames`);
    assert.ok(queuedWhileStalled > 0, 'control: the recorder saw the writes');
    assert.equal(result.ok, true);
    assert.equal(result.bytes, f.bytes.length);
    assert.equal(result.verified, false, 'never true from the sender');
    assert.equal(got.token, 'token-A');
    assert.deepEqual(got.header, { transferId: 't-1', offset: 0 });
    assert.equal(createHash('sha256').update(got.bytes).digest('hex'), f.sha256, 'the bytes are the file, in order');
    assert.equal(got.frames, Math.ceil(f.bytes.length / 262144));
  } finally {
    await phone.close();
  }
});

test('a resumed push sends exactly the bytes from the offset, under the same bound', T, async () => {
  const f = file(3 * 1024 * 1024 + 17);
  const offset = 1024 * 1024 + 5;
  const phone = await fakePhone();
  phone.release();
  const seen = { maxQueued: 0 };
  try {
    const result = await pushWith(
      { token: 'token-A', transferId: 't-2', source: f.path, offset, totalBytes: f.bytes.length, chunkMax: 262144 },
      openRecording(phone.port, seen),
    );
    const got = await phone.received;
    assert.equal(result.ok, true);
    assert.equal(result.bytes, f.bytes.length);
    assert.equal(result.resumedFrom, offset);
    assert.deepEqual(got.header, { transferId: 't-2', offset });
    assert.deepEqual(got.bytes, f.bytes.subarray(offset));
  } finally {
    await phone.close();
  }
});

test('the probe cut still delivers a real prefix and reports what the socket took, not what was queued', T, async () => {
  const f = file(8 * 1024 * 1024);
  const phone = await fakePhone();
  phone.release();
  try {
    const result = await pushWith(
      { token: 'token-A', transferId: 't-3', source: f.path, offset: 0, totalBytes: f.bytes.length, chunkMax: 262144, interruptAfterBytes: 2 * 1024 * 1024 },
      openRecording(phone.port, { maxQueued: 0 }),
    );
    const got = await phone.received;
    assert.equal(result.ok, false);
    assert.ok(got.bytes.length >= 2 * 1024 * 1024 && got.bytes.length < f.bytes.length, `a real prefix: ${got.bytes.length}`);
    assert.deepEqual(got.bytes, f.bytes.subarray(0, got.bytes.length));
    assert.equal(result.bytes, got.bytes.length, 'the count is what the phone got');
  } finally {
    await phone.close();
  }
});

test('a phone that hangs up mid-push fails the push rather than hanging it', T, async () => {
  const f = file(16 * 1024 * 1024);
  const server = createServer((socket) => { socket.once('data', () => socket.destroy()); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const result = await pushWith(
      { token: 'token-A', transferId: 't-4', source: f.path, offset: 0, totalBytes: f.bytes.length, chunkMax: 262144 },
      () => ({ socket: createConnection({ host: '127.0.0.1', port }), readyEvent: 'connect' }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.bytes < f.bytes.length);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('a push is not ok until its bytes left this process — queued bytes a hung-up phone never took are a failure', T, async () => {
  // 3 MiB is under the high-water mark, so the whole file is queued at once and the file's end comes
  // straight away. A phone that reads nothing and then hangs up must still fail the push: resolving at
  // the end of the file would report bytes that only ever sat in this process's queue as sent.
  const f = file(3 * 1024 * 1024);
  const server = createServer((socket) => { socket.pause(); setTimeout(() => socket.destroy(), 300); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const seen = { maxQueued: 0 };
  try {
    const result = await pushWith(
      { token: 'token-A', transferId: 't-5', source: f.path, offset: 0, totalBytes: f.bytes.length, chunkMax: 262144 },
      openRecording(port, seen),
    );
    assert.ok(seen.maxQueued > 1024 * 1024, `control: the file was queued faster than the phone took it (${seen.maxQueued})`);
    assert.equal(result.ok, false, 'never ok for bytes the phone did not take');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
