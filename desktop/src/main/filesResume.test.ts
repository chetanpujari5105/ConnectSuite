import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, openSync, readSync, writeSync, closeSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BulkClient } from './bulk';
import { FilesClient } from './files';
import { PullResumeStore, MAX_RESUME_RECORDS, STORE_FULL_SENTENCE } from './pullResume';
import { blockCountFor, blockSizeFor, rootOf } from '../shared/fsBlocks';
import { pullPartPathFor } from '../shared/transferFiles';

/**
 * L2 on the Mac, end to end through the product's `FilesClient.pull` and `BulkClient.pull` over a real
 * local socket. **The phone here is a fake**: it answers `fs.transfer.begin`, serves bytes from the
 * offset the Mac claims and emits `fs.transfer.blocks` / `done` the way the contract says. The real
 * phone half is `BlockPullSenderTest` / `FsBlocksWiringTest`; the hardware run is what joins them.
 * Files are generated, just over 64 MiB so the real block rule applies, in temp folders.
 */

const T = { timeout: 120_000 };
const MiB = 1024 * 1024;
const SIZE = 64 * MiB + 300 * 1024;
const BS = blockSizeFor(SIZE);
const COUNT = blockCountFor(SIZE, BS);
const MTIME = 1_759_140_000_000;
const PHONE_FP = 'AA:BB:fake-phone';
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const SOURCE = randomBytes(SIZE);
const DIGESTS = Array.from({ length: COUNT }, (_, i) => sha(SOURCE.subarray(i * BS, Math.min(SIZE, (i + 1) * BS))));

interface Scenario {
  /** What the fake phone answers to `resume` (default: accept exactly what was asked). */
  resumeAnswer?: (asked: Record<string, unknown>) => Record<string, unknown>;
  /** Stop sending after this many bytes of this transfer and wait (an interruption). */
  stallAfter?: number;
  /** Serve these bytes instead of SOURCE (a changed or corrupted source). */
  bytes?: Buffer;
  negotiated?: Record<string, number>;
}

function harness(scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-l2-'));
  const folder = join(root, 'Sidekick');
  mkdirSync(folder);
  const resumeStore = new PullResumeStore(join(root, 'pull-resume'));
  const link = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const begins: Array<Record<string, unknown>> = [];
  const cancels: Array<Record<string, unknown>> = [];
  let n = 0;
  const pending = new Map<string, { from: number }>();
  link.isConnected = () => true;
  link.negotiated = () => scenario.negotiated ?? { 'fs.blocks': 1 };
  link.request = async (type: string, payload: Record<string, unknown>) => {
    if (type === 'fs.transfer.cancel') { cancels.push(payload); return { type, payload: { stopped: true } }; }
    begins.push(payload);
    const transferId = `t-${++n}`;
    const asked = payload.resume as Record<string, unknown> | undefined;
    const answer = asked ? (scenario.resumeAnswer?.(asked) ?? { accepted: true, from: Number(asked.verifiedBlocks) * BS }) : undefined;
    pending.set(transferId, { from: answer?.accepted === true ? Number(answer.from) : 0 });
    return { type, payload: { transferId, direction: 'pull', size: SIZE, mtimeMs: MTIME, name: 'clip.bin', mime: 'application/octet-stream', sha256: null, offset: 0, chunkMax: 262144, blockSize: BS, blockCount: COUNT, ...(answer ? { resume: answer } : {}) } };
  };
  const emit = (type: string, payload: Record<string, unknown>) => link.emit('message', { type, payload });

  // The fake phone's bulk port: reads the token and header, serves from the claimed offset.
  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let frames = 0;
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (frames < 2 && buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const len = buf.readUInt32BE(0);
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        frames += 1;
        if (frames === 2) void serve(socket, JSON.parse(frame.toString()) as { transferId: string; offset: number });
      }
    });
  });
  const serve = async (socket: Socket, header: { transferId: string; offset: number }) => {
    const bytes = scenario.bytes ?? SOURCE;
    const from = header.offset;
    const until = scenario.stallAfter !== undefined && n === 1 ? from + scenario.stallAfter : SIZE;
    let sentBlock = Math.floor(from / BS);
    for (let at = from; at < until; at += 256 * 1024) {
      const piece = bytes.subarray(at, Math.min(until, at + 256 * 1024));
      const len = Buffer.alloc(4);
      len.writeUInt32BE(piece.length);
      if (!socket.write(Buffer.concat([len, piece]))) await new Promise((r) => socket.once('drain', r));
      const complete = Math.floor(Math.min(until, at + 256 * 1024) / BS);
      if (complete > sentBlock) {
        emit('fs.transfer.blocks', { transferId: header.transferId, first: sentBlock, sha256: DIGESTS.slice(sentBlock, complete) });
        sentBlock = complete;
      }
    }
    if (until < SIZE) return; // stalled: wait for the Mac to hang up
    if (sentBlock < COUNT) emit('fs.transfer.blocks', { transferId: header.transferId, first: sentBlock, sha256: DIGESTS.slice(sentBlock) });
    setTimeout(() => emit('fs.transfer.done', { transferId: header.transferId, ok: true, bytes: SIZE, sha256: sha(bytes), blockSize: BS, blockCount: COUNT, manifestRoot: rootOf(DIGESTS), verified: true }), 20);
    socket.end();
  };
  const listening = new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)));
  const real = new BulkClient({} as never);
  const bulk = {
    pull: async (o: Parameters<BulkClient['pull']>[0]) => {
      const port = await listening;
      return real.pull({ ...o, connect: () => ({ socket: createConnection({ host: '127.0.0.1', port }) as unknown as TLSSocket, readyEvent: 'connect' }) });
    },
  };
  const client = new FilesClient(
    () => link as never,
    () => bulk as never,
    () => ({ host: '127.0.0.1', token: 'tok' }),
    {
      resume: { store: () => resumeStore, phone: () => PHONE_FP },
      receiveFolder: async () => ({ ok: true, folder }),
    },
  );
  const pull = () => client.pull({ rootId: 'saf:primary', id: 'doc-1', name: 'clip.bin', size: SIZE });
  const done = () => { server.close(); rmSync(root, { recursive: true, force: true }); };
  return { client, pull, begins, cancels, folder, resumeStore, scenario, done };
}

/** Waits until the transfer is in flight (its first bytes written), then acts. */
async function whenReceiving(h: ReturnType<typeof harness>, bytes: number): Promise<void> {
  const part = pullPartPathFor(join(h.folder, 'clip.bin'));
  for (let i = 0; i < 400; i += 1) {
    if (existsSync(part) && readFileSync(part).length >= bytes) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the transfer never got going');
}

test('a fresh block pull saves the file verified, and leaves no record and no partial', T, async () => {
  const h = harness();
  try {
    const r = await h.pull();
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.verifiedBy, 'blocks');
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE));
    assert.deepEqual(readdirSync(h.folder), ['clip.bin']);
    assert.deepEqual(await h.resumeStore.all(), [], 'the record is gone once the file is saved');
    assert.equal(h.begins[0]!.resume, undefined, 'nothing to resume the first time');
  } finally { h.done(); }
});

test('Pause keeps the owned partial and a record; the next pull resumes from the verified blocks and saves the whole file', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    await new Promise((r) => setTimeout(r, 2200)); // at least one record save
    assert.deepEqual(await h.client.stopPull('t-1', 'pause'), { stopped: true });
    const paused = await first;
    assert.equal(paused.paused, true, paused.reason);
    assert.deepEqual(h.cancels.map((c) => c.reason), ['pause']);
    const [record] = await h.resumeStore.all();
    assert.ok(record && record.digests.length > 0, 'a record with verified blocks');
    assert.deepEqual(record!.digests, DIGESTS.slice(0, record!.digests.length), 'the recorded digests are the true ones');
    assert.ok(existsSync(pullPartPathFor(join(h.folder, 'clip.bin'))), 'the partial is kept');
    assert.equal((await h.client.pausedPulls()).length, 1);

    const r = await h.pull();
    assert.equal(r.ok, true, r.reason);
    const asked = h.begins[1]!.resume as Record<string, unknown>;
    assert.equal(asked.verifiedBlocks, record!.digests.length);
    assert.equal(asked.prefixRoot, rootOf(DIGESTS, record!.digests.length));
    assert.equal(r.resumedFrom, record!.digests.length * BS);
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE), 'the resumed file is the source, byte for byte');
    assert.deepEqual(await h.resumeStore.all(), []);
    assert.deepEqual(readdirSync(h.folder), ['clip.bin'], 'no partial left');
  } finally { h.done(); }
});

test('a partial changed while paused is not resumed: its owned partial is discarded and the file fetched again', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    await new Promise((r) => setTimeout(r, 2200));
    await h.client.stopPull('t-1', 'pause');
    await first;
    // Something altered a byte inside the verified prefix of our partial.
    const fd = openSync(pullPartPathFor(join(h.folder, 'clip.bin')), 'r+');
    const one = Buffer.alloc(1);
    readSync(fd, one, 0, 1, 1000);
    one[0] ^= 0xff;
    writeSync(fd, one, 0, 1, 1000);
    closeSync(fd);

    const r = await h.pull();
    assert.equal(h.begins[1]!.resume, undefined, 'no resume was offered from a partial that no longer matches its record');
    assert.equal(r.ok, true, r.reason);
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE));
  } finally { h.done(); }
});

test('the phone refusing the resume (source changed) discards the old partial and starts again from 0', T, async () => {
  const h = harness({ stallAfter: 20 * MiB, resumeAnswer: () => ({ accepted: false, why: 'source-changed' }) });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    await new Promise((r) => setTimeout(r, 2200));
    await h.client.stopPull('t-1', 'pause');
    await first;
    const r = await h.pull();
    assert.ok(h.begins[1]!.resume, 'a resume was asked for');
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.resumedFrom, undefined, 'started from 0');
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE));
    assert.deepEqual(readdirSync(h.folder), ['clip.bin'], 'the old partial is gone, no second copy');
  } finally { h.done(); }
});

test('Cancel deletes only that transfer’s partial and record, and nothing is saved', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    writeFileSync(join(h.folder, 'unrelated.bin'), 'keep me');
    const first = h.pull();
    await whenReceiving(h, 5 * MiB);
    await h.client.stopPull('t-1', 'cancel');
    const r = await first;
    assert.equal(r.cancelled, true, JSON.stringify(r));
    assert.deepEqual(h.cancels.map((c) => c.reason), ['user']);
    assert.deepEqual(readdirSync(h.folder), ['unrelated.bin'], 'no partial, no final file, the neighbour untouched');
    assert.deepEqual(await h.resumeStore.all(), []);
  } finally { h.done(); }
});

test('with 16 paused records a new block pull is refused before the phone is asked — nothing evicted', T, async () => {
  const h = harness();
  try {
    for (let i = 0; i < MAX_RESUME_RECORDS; i += 1) {
      await h.resumeStore.save({ v: 1, phone: PHONE_FP, rootId: 'saf:primary', id: `other-${i}`, name: `o${i}.bin`, size: SIZE, mtimeMs: MTIME, blockSize: BS, digests: [], destination: join(h.folder, `o${i}.bin`), folderReal: h.folder, partDev: 0, partIno: 0, createdAtMs: Date.now(), updatedAtMs: Date.now() });
    }
    const r = await h.pull();
    assert.deepEqual(r, { ok: false, reason: STORE_FULL_SENTENCE });
    assert.equal(h.begins.length, 0, 'the phone was never asked');
    assert.equal((await h.resumeStore.all()).length, MAX_RESUME_RECORDS);
  } finally { h.done(); }
});

test('an older phone (fs.blocks not negotiated) keeps the old path: no resume asked, no record made', T, async () => {
  const h = harness({ negotiated: {} });
  try {
    await h.pull();
    assert.equal(h.begins[0]!.resume, undefined);
    assert.deepEqual(await h.resumeStore.all(), []);
  } finally { h.done(); }
});
