import assert from 'node:assert/strict';
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

import { pullShareWith, type SharePullResult } from './bulk';
import { newPartNonce, publishExclusive, sharePartPath, type PublishResult } from './shareDestination';
import { FileShareLedger, sweepLedger } from './shareLedger';
import { startFakePhone, synthetic, type PhoneBehaviour } from './sharePhone.testkit';

/**
 * The share pull end to end over a **real local socket**: the Mac's `pullShareWith`, `FrameReader`,
 * digest, partial, ownership ledger and exclusive publish, against a fake phone speaking the bulk
 * framing. Only TLS is replaced (by plain TCP).
 *
 * A watchdog closes the fake phone after 4 s, so a mutation that removes the idle timer turns a
 * stall into a red `truncated` rather than a hang that never reports.
 */

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const tx = 'ts-AAAAAAAAAAAAAAAAAAAAAA';
const T = { timeout: 10_000 };

const folder = (): string => mkdtempSync(join(tmpdir(), 'share-pull-'));
const ledgerIn = (): FileShareLedger => new FileShareLedger(join(mkdtempSync(join(tmpdir(), 'share-ledger-')), 'l.json'));

interface Extra {
  idleTimeoutMs?: number;
  publish?: (part: string, d: string) => Promise<PublishResult>;
  signal?: AbortSignal;
  openPart?: (path: string) => Writable;
  part?: string;
  d?: string;
  ledger?: FileShareLedger;
  onData?: (socketBytes: number) => void;
}

async function run(size: number, behaviour: Partial<PhoneBehaviour> = {}, extra: Extra = {}) {
  const d = extra.d ?? folder();
  const ledger = extra.ledger ?? ledgerIn();
  const data = synthetic(size);
  const phone = await startFakePhone({ bytes: data.bytes, ...behaviour });
  const watchdog = setTimeout(() => void phone.close(), 4000);
  const part = extra.part ?? sharePartPath(d, id, newPartNonce());
  try {
    const result: SharePullResult = await pullShareWith({
      token: 'token-A', transferId: tx, part, expectedBytes: size, expectedSha256: data.sha256,
      idleTimeoutMs: extra.idleTimeoutMs ?? 2000,
      publish: (p) => (extra.publish ? extra.publish(p, d) : publishExclusive(p, d, 'x.bin')),
      signal: extra.signal, ledger, openPart: extra.openPart,
    }, () => {
      const conn = phone.open();
      if (extra.onData) {
        let n = 0;
        conn.socket.on('data', (b: Buffer) => { n += b.length; extra.onData!(n); });
      }
      return conn;
    });
    return { result, d, data, seen: phone.seen, ledger, part };
  } finally {
    clearTimeout(watchdog);
    await phone.close();
  }
}

const reason = (r: SharePullResult): string | true => (r.ok ? true : r.reason);

// ---- the happy path -------------------------------------------------------------------------------

test('100 KB arrives, flushes, verifies, publishes; header is offset 0 with the session token; ledger left empty', T, async () => {
  const { result, d, data, seen, ledger } = await run(100_000);
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
  assert.deepEqual(readdirSync(d), ['x.bin']);
  assert.equal(seen[0]!.token, 'token-A');
  assert.deepEqual(seen[0]!.header, { transferId: tx, offset: 0 });
  assert.deepEqual(await ledger.entries(), []);
});

test('zero bytes: completed by the close, verified against the empty-input digest', T, async () => {
  const { result, d } = await run(0);
  assert.equal(reason(result), true);
  assert.equal(readFileSync(join(d, 'x.bin')).length, 0);
});

test('a larger synthetic file (5 MB, twenty frames) arrives whole', T, async () => {
  const { result, d, data } = await run(5 * 1024 * 1024);
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
});

// ---- ownership (review item 2) ---------------------------------------------------------------------

test('an unrelated regular file at the candidate partial path is refused, untouched, and survives the startup sweep', T, async () => {
  const d = folder();
  const part = sharePartPath(d, id, newPartNonce());
  writeFileSync(part, 'an unrelated file that happens to have our name');
  const before = readFileSync(part);
  const ledger = ledgerIn();
  const { result } = await run(10_000, {}, { d, part, ledger });
  assert.equal(reason(result), 'write-failed');
  assert.deepEqual(readFileSync(part), before, 'byte-identical after the attempted pull');
  await sweepLedger(ledger);
  assert.deepEqual(readFileSync(part), before, 'byte-identical after the startup sweep');
  assert.deepEqual(readdirSync(d), [part.split('/').pop()]);
});

test('a symlink at the partial path refuses without following it', T, async () => {
  const d = folder();
  const outside = join(folder(), 'target');
  writeFileSync(outside, 'must survive');
  const part = sharePartPath(d, id, newPartNonce());
  symlinkSync(outside, part);
  const { result } = await run(10, {}, { d, part });
  assert.equal(reason(result), 'write-failed');
  assert.equal(lstatSync(part).isSymbolicLink(), true);
  assert.equal(readFileSync(outside, 'utf8'), 'must survive');
});

test('every attempt gets a fresh partial name', () => {
  const names = new Set(Array.from({ length: 1000 }, () => sharePartPath('/f', id, newPartNonce())));
  assert.equal(names.size, 1000);
});

test('an unrelated .part and a person’s files are never touched by a failing pull', T, async () => {
  const d = folder();
  writeFileSync(join(d, 'x.bin.part'), 'another app');
  writeFileSync(join(d, 'x.bin'), 'a person’s file');
  const { result } = await run(10_000, { corruptAt: 5 }, { d });
  assert.equal(reason(result), 'checksum');
  assert.deepEqual(readdirSync(d).sort(), ['x.bin', 'x.bin.part']);
  assert.equal(readFileSync(join(d, 'x.bin.part'), 'utf8'), 'another app');
});

// ---- failures delete only this attempt's own partial --------------------------------------------------

test('truncation: fewer bytes than offered; own partial deleted, ledger empty, nothing published', T, async () => {
  const { result, d, ledger } = await run(100_000, { truncateTo: 60_000 });
  assert.equal(reason(result), 'truncated');
  assert.deepEqual(readdirSync(d), []);
  assert.deepEqual(await ledger.entries(), []);
});

test('over-sending is refused the same way', T, async () => {
  const { result, d } = await run(100_000, { extra: 10 });
  assert.equal(reason(result), 'truncated');
  assert.deepEqual(readdirSync(d), []);
});

test('corruption: one flipped byte is a checksum failure, no file, no .failed sidecar', T, async () => {
  const { result, d } = await run(100_000, { corruptAt: 4096 });
  assert.equal(reason(result), 'checksum');
  assert.deepEqual(readdirSync(d), []);
});

test('stall: silence beyond the idle timeout is interrupted, and the partial goes', T, async () => {
  const started = Date.now();
  const { result, d } = await run(100_000, { stallAfter: 20_000, chunkSize: 10_000 }, { idleTimeoutMs: 150 });
  assert.equal(reason(result), 'interrupted');
  assert.ok(Date.now() - started < 3000, 'bounded by the idle timer, not the watchdog');
  assert.deepEqual(readdirSync(d), []);
});

test('an unsupported destination at publication refuses the save and deletes only its own partial', T, async () => {
  const { result, d } = await run(100_000, {}, {
    publish: async () => ({ ok: false, reason: 'unsupported-destination', detail: 'no hard links' }),
  });
  assert.equal(reason(result), 'unsupported-destination');
  assert.deepEqual(readdirSync(d), []);
});

// ---- writing and completion (review item 3) ----------------------------------------------------------

/**
 * A real file written slowly through a tiny buffer: forces backpressure. [finalDelayMs] holds the
 * final flush open for a fixed time, so a test can land an event inside that window deterministically.
 */
class SlowFile extends Writable {
  private fd: number;
  constructor(path: string, private readonly drop = -1, private readonly finalDelayMs = 0) {
    super({ highWaterMark: 1024 });
    this.fd = openSync(path, 'wx');
  }
  private n = 0;
  override _write(chunk: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    const skip = this.n++ === this.drop;
    setTimeout(() => {
      if (!skip) writeSync(this.fd, chunk);
      cb();
    }, 3);
  }
  override _final(cb: (e?: Error | null) => void): void {
    setTimeout(() => {
      closeSync(this.fd);
      cb();
    }, this.finalDelayMs);
  }
}

test('backpressure: a slow disk pauses the socket, the idle timer does not fire on our own pause, and the file is exact', T, async () => {
  const { result, d, data } = await run(600_000, { chunkSize: 64 * 1024 }, { openPart: (p) => new SlowFile(p), idleTimeoutMs: 200 });
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
});

test('a write error fails the pull as write-failed, publishes nothing, and does not crash', T, async () => {
  // The file is created for real, exclusively, as production creates it — so the pull gets past the
  // ledger's identity record and reaches the write. (The first version created no file, failed at
  // the identity step instead, and so never tested a write error at all: mutation D14 showed it.)
  const failing = (p: string): Writable => {
    closeSync(openSync(p, 'wx'));
    return new Writable({ write: (_c, _e, cb) => cb(new Error('ENOSPC: no space left on device')) });
  };
  let published = false;
  // 10 KB frames arrive over many ticks, as a real transfer does. In one burst, `complete()` would run
  // in the same tick and attach its own error listener before Node emitted the write error — which is
  // how this test first passed with the write-error listener deleted (an unhandled 'error' crashes the
  // Mac process outright).
  const { result, d } = await run(100_000, { chunkSize: 10_000 }, { openPart: failing, publish: async () => { published = true; return { ok: false, reason: 'write-failed', detail: 'x' }; } });
  assert.equal(reason(result), 'write-failed');
  assert.equal(published, false);
  assert.deepEqual(readdirSync(d), []);
});

test('bytes lost between the socket and the disk are caught by the on-disk length, not saved', T, async () => {
  let published = false;
  const { result, d } = await run(200_000, { chunkSize: 50_000 }, {
    openPart: (p) => new SlowFile(p, 1), // silently drops the second chunk
    publish: async () => { published = true; return { ok: false, reason: 'write-failed', detail: 'x' }; },
  });
  assert.equal(reason(result), 'write-failed');
  assert.equal(published, false, 'never published: the disk did not hold what arrived');
  assert.deepEqual(readdirSync(d), []);
});

test('cancellation racing the last byte: cancelled, nothing published, own partial deleted', T, async () => {
  const ac = new AbortController();
  const size = 100_000;
  let published = false;
  const { result, d } = await run(size, {}, {
    signal: ac.signal,
    onData: (n) => { if (n >= size) ac.abort(); }, // fires before the reader sees the final frame
    publish: async () => { published = true; return { ok: false, reason: 'write-failed', detail: 'x' }; },
  });
  assert.equal(reason(result), 'cancelled');
  assert.equal(published, false);
  assert.deepEqual(readdirSync(d), []);
});

test('cancellation while the last bytes are still flushing to disk: nothing is published', T, async () => {
  const ac = new AbortController();
  const size = 300_000;
  let published = false;
  let armed = false;
  const { result, d } = await run(size, { chunkSize: 30_000 }, {
    signal: ac.signal,
    // The final flush takes a fixed 300 ms, so `complete` is certainly still waiting on the disk when
    // the abort fires 40 ms after the last byte. (A 5 ms delay against a 3 ms flush was flaky: it went
    // red under unrelated mutations in the first run.)
    openPart: (p) => new SlowFile(p, -1, 300),
    onData: (n) => { if (n >= size && !armed) { armed = true; setTimeout(() => ac.abort(), 40); } },
    publish: async () => { published = true; return { ok: false, reason: 'write-failed', detail: 'x' }; },
    idleTimeoutMs: 2000,
  });
  assert.equal(reason(result), 'cancelled');
  assert.equal(published, false, 'the check before publication is the only guard in this window');
  assert.deepEqual(readdirSync(d), []);
});

test('cancellation mid-pull deletes the partial and publishes nothing', T, async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 60);
  const { result, d } = await run(100_000, { stallAfter: 20_000, chunkSize: 10_000 }, { signal: ac.signal, idleTimeoutMs: 5000 });
  assert.equal(reason(result), 'cancelled');
  assert.deepEqual(readdirSync(d), []);
});

test('a cancel that lands during publication cannot unpublish: publication wins and the result says so', T, async () => {
  const ac = new AbortController();
  const { result, d } = await run(10_000, {}, {
    signal: ac.signal,
    publish: async (p, dd) => { ac.abort(); return publishExclusive(p, dd, 'x.bin'); },
  });
  assert.equal(reason(result), true, 'the caller (the receiver) decides what a late cancel means');
  assert.equal(existsSync(join(d, 'x.bin')), true);
});
