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
import { SESSION_ENDED_EVENT } from '../shared/session';

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
  /** Close the phone's socket after this many bytes of the first transfer (a link drop, not a Pause). */
  dropAfter?: number;
  /** The phone ends with this `fs.transfer.done` instead of a success. */
  done?: Record<string, unknown>;
  /** Wait this long after each 256 KiB chunk, so a transfer is still moving when a test acts on it. */
  paceMs?: number;
}

function harness(scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-l2-'));
  const folder = join(root, 'Sidekick');
  mkdirSync(folder);
  const resumeStore = new PullResumeStore(join(root, 'pull-resume'));
  const clock = { now: Date.now() };
  const agreed: Array<{ transferId: string; blocks: boolean; resumedFrom: number }> = [];
  const link = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const begins: Array<Record<string, unknown>> = [];
  const cancels: Array<Record<string, unknown>> = [];
  let n = 0;
  const pending = new Map<string, { from: number }>();
  link.isConnected = () => true;
  link.token = () => sessionRef.token;
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
  // The control channel: once a session has ended, nothing the phone says on it reaches the Mac —
  // the block digests and the verdict are dropped, as the phone logged on hardware (defect 157).
  const control = { down: false };
  const sessionRef = { token: 'tok' };
  const emit = (type: string, payload: Record<string, unknown>) => { if (!control.down) link.emit('message', { type, payload }); };
  /** The session [token] ends, the way `LinkClient.teardown` reports it. The fake phone keeps streaming. */
  const endSession = (token: string, reason = 'user disconnected') => { control.down = true; link.emit(SESSION_ENDED_EVENT, { token, reason }); };
  /** A new session is up under [token]. */
  const reconnect = (token: string) => { control.down = false; sessionRef.token = token; };

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
    const cut = scenario.dropAfter !== undefined && n === 1 ? from + scenario.dropAfter : undefined;
    const until = cut ?? (scenario.stallAfter !== undefined && n === 1 ? from + scenario.stallAfter : SIZE);
    let sentBlock = Math.floor(from / BS);
    for (let at = from; at < until; at += 256 * 1024) {
      if (socket.destroyed) return; // the Mac hung up: a real phone's next write would fail here
      const piece = bytes.subarray(at, Math.min(until, at + 256 * 1024));
      const len = Buffer.alloc(4);
      len.writeUInt32BE(piece.length);
      if (!socket.write(Buffer.concat([len, piece]))) await new Promise((r) => socket.once('drain', r));
      if (scenario.paceMs) await new Promise((r) => setTimeout(r, scenario.paceMs));
      const complete = Math.floor(Math.min(until, at + 256 * 1024) / BS);
      if (complete > sentBlock) {
        emit('fs.transfer.blocks', { transferId: header.transferId, first: sentBlock, sha256: DIGESTS.slice(sentBlock, complete) });
        sentBlock = complete;
      }
    }
    if (cut !== undefined) { setTimeout(() => socket.destroy(), 50); return; } // the link drops
    if (until < SIZE) return; // stalled: wait for the Mac to hang up
    if (sentBlock < COUNT) emit('fs.transfer.blocks', { transferId: header.transferId, first: sentBlock, sha256: DIGESTS.slice(sentBlock) });
    setTimeout(() => emit('fs.transfer.done', scenario.done ? { transferId: header.transferId, ...scenario.done } : { transferId: header.transferId, ok: true, bytes: SIZE, sha256: sha(bytes), blockSize: BS, blockCount: COUNT, manifestRoot: rootOf(DIGESTS), verified: true }), 20);
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
    () => ({ host: '127.0.0.1', token: sessionRef.token }),
    {
      resume: { store: () => resumeStore, phone: () => PHONE_FP },
      receiveFolder: async () => ({ ok: true, folder }),
      now: () => clock.now,
      onPullAgreed: (info) => agreed.push(info),
    },
  );
  const pull = () => client.pull({ rootId: 'saf:primary', id: 'doc-1', name: 'clip.bin', size: SIZE });
  const done = () => { server.close(); rmSync(root, { recursive: true, force: true }); };
  return { client, pull, begins, cancels, folder, resumeStore, scenario, done, clock, agreed, endSession, reconnect, link };
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

// ---- slice 5c: what a reconnect may resume by itself, forget, and a changed source -------------

test('a link drop is an interruption: it is offered for automatic resume, and that resume saves the source', T, async () => {
  const h = harness({ dropAfter: 20 * MiB });
  try {
    const first = await h.pull();
    assert.equal(first.paused, true, JSON.stringify(first));
    assert.deepEqual(h.cancels, [], 'nobody asked the phone to stop: the link dropped');
    const auto = h.client.takeAutoResumable();
    assert.deepEqual(auto.map((o) => o.id), ['doc-1']);
    assert.deepEqual(h.client.takeAutoResumable(), [], 'offered once');
    const r = await h.client.pull(auto[0]!); // exactly what main.ts does on the reconnect
    assert.equal(r.ok, true, r.reason);
    assert.ok((r.resumedFrom ?? 0) > 0, 'it resumed rather than starting over');
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE));
  } finally { h.done(); }
});

test('a Pause the person chose is kept but never resumed by a reconnect', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    const first = h.pull();
    await whenReceiving(h, 5 * MiB);
    await h.client.stopPull('t-1', 'pause');
    assert.equal((await first).paused, true);
    assert.deepEqual(h.client.takeAutoResumable(), []);
    assert.equal((await h.client.pausedPulls()).length, 1, 'still listed for a Resume click');
  } finally { h.done(); }
});

test('an interruption more than 10 minutes old waits for Resume', T, async () => {
  const h = harness({ dropAfter: 10 * MiB });
  try {
    await h.pull();
    h.clock.now += 10 * 60 * 1000 + 1;
    assert.deepEqual(h.client.takeAutoResumable(), []);
    assert.equal((await h.client.pausedPulls()).length, 1);
  } finally { h.done(); }
});

test('the pane is told which pulls can be paused: block pulls yes, the old path no', T, async () => {
  const a = harness();
  const b = harness({ negotiated: {} });
  try {
    await a.pull();
    await b.pull();
    assert.deepEqual(a.agreed.map((x) => [x.transferId, x.blocks, x.resumedFrom]), [['t-1', true, 0]]);
    assert.deepEqual(b.agreed.map((x) => x.blocks), [false]);
  } finally { a.done(); b.done(); }
});

test('forget the phone: its records go, its owned partial is deleted, and nothing is auto-resumed', T, async () => {
  const h = harness({ dropAfter: 10 * MiB });
  try {
    writeFileSync(join(h.folder, 'mine.txt'), 'the person’s file');
    await h.pull();
    assert.equal(await h.client.forgetPhone(PHONE_FP), 1);
    assert.deepEqual(await h.resumeStore.all(), []);
    assert.deepEqual(readdirSync(h.folder), ['mine.txt'], 'the owned partial is gone; the person’s file is not');
    assert.deepEqual(h.client.takeAutoResumable(), []);
  } finally { h.done(); }
});

test('forget the phone never deletes a file that now stands where its partial was', T, async () => {
  const h = harness({ dropAfter: 10 * MiB });
  try {
    await h.pull();
    const part = pullPartPathFor(join(h.folder, 'clip.bin'));
    rmSync(part);
    writeFileSync(part, 'not ours any more');
    await h.client.forgetPhone(PHONE_FP);
    assert.equal(readFileSync(part, 'utf8'), 'not ours any more');
    assert.deepEqual(await h.resumeStore.all(), []);
  } finally { h.done(); }
});

test('SOURCE_CHANGED from the phone: nothing saved, the partial and the record are gone', T, async () => {
  const h = harness({ done: { ok: false, code: 'SOURCE_CHANGED', why: 'source-changed', message: 'clip.bin changed on the phone while it was being sent, so it was not saved.' } });
  try {
    const r = await h.pull();
    assert.equal(r.ok, false);
    assert.equal(r.sourceChanged, true);
    assert.match(r.reason ?? '', /changed on the phone/);
    assert.equal(existsSync(join(h.folder, 'clip.bin')), false);
    assert.equal(existsSync(pullPartPathFor(join(h.folder, 'clip.bin'))), false);
    assert.deepEqual(await h.resumeStore.all(), []);
    assert.deepEqual(h.client.takeAutoResumable(), [], 'a changed file is not resumed');
  } finally { h.done(); }
});

// ---- L1/L2 T4-A: one byte corrupted in transit ---------------------------------------------------
//
// The phone's probe flips one byte after hashing it (FsCorruptionProbeTest), so the digests the Mac is
// sent are of the true bytes and the bytes are not. Here the fake phone does the same: it serves a
// copy with one byte flipped against DIGESTS of SOURCE. The expected outcome is the contract's
// (docs/large-file-l1-l2-rules-2026-09-29.md §4 and S8), checked through the product's FilesClient.

test('T4-A: a corrupt block is named, nothing is published, only its own partial and record go, a .failed is left beside a free name, and nothing retries', T, async () => {
  const K = 300;
  const AT = K * BS + 64 * 1024; // 64 KiB into block K, as 104,923,136 is into block 800
  const bad = Buffer.from(SOURCE);
  bad[AT] ^= 0xff;
  // The first pull (another file) is paused by the person before the flipped byte, so its partial and
  // record are what must survive the corrupt one.
  const h = harness({ bytes: bad, stallAfter: 20 * MiB });
  try {
    const other = h.pull();
    await whenReceiving(h, 5 * MiB);
    await h.client.stopPull('t-1', 'pause');
    assert.equal((await other).paused, true, 'control: the other pull is paused, with its record');
    const kept = await h.resumeStore.all();
    assert.equal(kept.length, 1);
    const keptPart = pullPartPathFor(join(h.folder, 'clip.bin'));
    const keptBytes = readFileSync(keptPart).length;
    writeFileSync(join(h.folder, 'other.bin'), 'the person’s own file');

    const r = await h.client.pull({ rootId: 'saf:primary', id: 'doc-2', name: 'other.bin', size: SIZE });

    assert.equal(r.ok, false);
    assert.equal(r.paused, undefined, 'not a pause: nothing of it is kept to resume');
    assert.equal(r.sourceChanged, undefined, 'not a changed source');
    assert.match(r.reason ?? '', new RegExp(`damaged \\(block ${K} does not match what the phone read\\)`));
    assert.equal(existsSync(join(h.folder, 'other (2).bin')), false, 'nothing published');
    assert.equal(existsSync(pullPartPathFor(join(h.folder, 'other (2).bin'))), false, 'its own partial is deleted');
    const failed = join(h.folder, 'other (2).bin.failed');
    assert.ok(existsSync(failed), `a .failed beside the free name: ${readdirSync(h.folder).join(', ')}`);
    assert.match(readFileSync(failed, 'utf8'), /^Sidekick transfer failed/);
    assert.equal(readFileSync(join(h.folder, 'other.bin'), 'utf8'), 'the person’s own file', 'the person’s file at the name is untouched');
    assert.deepEqual(
      new Set(readdirSync(h.folder)),
      new Set(['other.bin', 'other (2).bin.failed', keptPart.split('/').pop()!]),
      'nothing else was created or removed',
    );
    assert.deepEqual((await h.resumeStore.all()).map((x) => x.id), ['doc-1'], 'only the corrupt pull’s record is gone');
    assert.equal(readFileSync(keptPart).length, keptBytes, 'the other pull’s partial is untouched');
    assert.deepEqual(h.client.takeAutoResumable(), [], 'nothing is offered for automatic resume');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(h.begins.length, 2, 'no automatic retry: the phone was asked twice, once per pull');
  } finally { h.done(); }
});

// ---- defect 157: a session ending stops the pull it owns, keeps what is resumable ----------------
//
// Hardware (L1/L2 T3, 2026-09-30): after the Mac's Disconnect at 40%, the phone streamed on over the
// bulk socket, the digests and verdict were dropped with the control session, and the Mac waited its
// full 30 s for a `done` that could never come before it called the pull interrupted. The fake phone
// here streams on exactly like that — the Mac must stop by itself, on the session's end.

/** How long a stop may take from the session's end to the pull settling: the socket is destroyed in the
 * same tick, then the bytes already accepted are flushed and the record saved. Before the fix: 30 s. */
const STOP_BOUND_MS = 2_000;
const partialSize = (h: ReturnType<typeof harness>): number => {
  const p = pullPartPathFor(join(h.folder, 'clip.bin'));
  return existsSync(p) ? readFileSync(p).length : -1;
};

test('157: a session ending mid-pull stops that pull at once — owned partial and record kept, nothing published — and a reconnect resumes it', T, async (t) => {
  const h = harness({ paceMs: 8 });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    const t0 = Date.now();
    h.endSession('tok');
    const r = await first;
    const stopMs = Date.now() - t0;
    assert.ok(stopMs < STOP_BOUND_MS, `settled ${stopMs} ms after the session ended (bound ${STOP_BOUND_MS} ms; it waited 30 s for a verdict before)`);
    assert.equal(r.ok, false);
    assert.equal(r.paused, true, `kept as paused (resumable): ${r.reason}`);
    assert.notEqual(r.cancelled, true, 'a session ending is not a Cancel');
    assert.ok(!readdirSync(h.folder).includes('clip.bin'), 'nothing is published');
    const held = partialSize(h);
    assert.ok(held > 0 && held < SIZE, `the owned partial is kept, short of the file (${held} of ${SIZE})`);
    t.diagnostic(`stop latency: ${stopMs} ms from the session ending to the pull settled (bound ${STOP_BOUND_MS} ms); partial held ${held} of ${SIZE} bytes`);
    await new Promise((res) => setTimeout(res, 400));
    assert.equal(partialSize(h), held, 'no byte reaches the partial after the stop, though the phone streams on');
    const [record] = await h.resumeStore.all();
    assert.ok(record, 'the resume record is kept');
    assert.deepEqual(record!.digests, DIGESTS.slice(0, record!.digests.length), 'only true, verified blocks are recorded');
    const auto = h.client.takeAutoResumable();
    assert.equal(auto.length, 1, 'an interruption is offered to the reconnect for automatic resume');

    h.reconnect('tok-2');
    const r2 = await h.client.pull(auto[0]!); // what main.ts does on the reconnect edge
    assert.equal(r2.ok, true, r2.reason);
    assert.equal(r2.resumedFrom, record!.digests.length * BS, 'resumed from the verified block boundary');
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE), 'the resumed file is the source');
    assert.deepEqual(await h.resumeStore.all(), []);
    assert.deepEqual(readdirSync(h.folder), ['clip.bin'], 'partial gone once published');
  } finally { h.done(); }
});

test('157: an old session ending does not stop a replacement session\'s pull', T, async () => {
  const h = harness({ paceMs: 8 });
  try {
    h.reconnect('tok-new');
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    h.link.emit(SESSION_ENDED_EVENT, { token: 'tok-old', reason: 'phone closed the connection' }); // a late teardown of the session it replaced
    const r = await first;
    assert.equal(r.ok, true, r.reason);
    assert.equal(sha(readFileSync(join(h.folder, 'clip.bin'))), sha(SOURCE));
    assert.deepEqual(h.client.takeAutoResumable(), []);
  } finally { h.done(); }
});

test('157: a Pause the person chose stays manual when the session then ends', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    await h.client.stopPull('t-1', 'pause');
    h.endSession('tok');
    const r = await first;
    assert.equal(r.paused, true);
    assert.deepEqual(h.client.takeAutoResumable(), [], 'never resumed by a reconnect');
    assert.equal((await h.client.pausedPulls()).length, 1, 'still listed as paused, waiting for Resume');
  } finally { h.done(); }
});

test('157: Cancel is unchanged when the session then ends — its partial and record go', T, async () => {
  const h = harness({ stallAfter: 20 * MiB });
  try {
    const first = h.pull();
    await whenReceiving(h, 10 * MiB);
    await h.client.stopPull('t-1', 'cancel');
    h.endSession('tok');
    const r = await first;
    assert.equal(r.cancelled, true);
    assert.deepEqual(await h.resumeStore.all(), []);
    assert.deepEqual(readdirSync(h.folder), [], 'no partial left');
    assert.deepEqual(h.client.takeAutoResumable(), []);
  } finally { h.done(); }
});
