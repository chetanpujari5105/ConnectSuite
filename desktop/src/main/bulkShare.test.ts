import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, promises as fsp, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

import { handleWriter, pullShareWith, type ShareConnection, type SharePullResult } from './bulk';
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
  openPart?: (fd: number) => Writable;
  part?: string;
  d?: string;
  ledger?: FileShareLedger;
  onData?: (socketBytes: number) => void;
  openHandle?: (path: string) => Promise<FileHandle>;
  onSocket?: (socket: ShareConnection['socket']) => void;
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
      signal: extra.signal, ledger, openPart: extra.openPart, openHandle: extra.openHandle,
    }, () => {
      const conn = phone.open();
      extra.onSocket?.(conn.socket);
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
  const at = lstatSync(join(d, 'x.bin'));
  assert.deepEqual(result.ok && result.identity, { dev: at.dev, ino: at.ino, size: 100_000 }, 'the identity is the saved file’s');
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
 * It writes to the descriptor the pull created the partial with, and never closes it — the pull owns it.
 */
class SlowFile extends Writable {
  constructor(private readonly fd: number, private readonly drop = -1, private readonly finalDelayMs = 0) {
    super({ highWaterMark: 1024 });
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
    setTimeout(() => cb(), this.finalDelayMs);
  }
}

test('backpressure: a slow disk pauses the socket, the idle timer does not fire on our own pause, and the file is exact', T, async () => {
  const { result, d, data } = await run(600_000, { chunkSize: 64 * 1024 }, { openPart: (fd) => new SlowFile(fd), idleTimeoutMs: 200 });
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
});

test('a write error fails the pull as write-failed, publishes nothing, and does not crash', T, async () => {
  // The pull creates the file for real, exclusively, and records its identity before this writer is
  // asked for — so the write error is what fails it. (An earlier version of this seam could fail at
  // the identity step instead, and so never tested a write error at all: mutation D14 showed it.)
  const failing = (_fd: number): Writable =>
    new Writable({ write: (_c, _e, cb) => cb(new Error('ENOSPC: no space left on device')) });
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
    openPart: (fd) => new SlowFile(fd, 1), // silently drops the second chunk
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
    openPart: (fd) => new SlowFile(fd, -1, 300),
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

// ---- a replacement at the partial path (S2) ------------------------------------------------------------

/**
 * Something else takes the partial's **name** while the pull holds the partial open: this attempt's
 * file is renamed aside (it keeps its inode, and the pull keeps writing to it) and a different file
 * is created at the partial path. Every folder here is a fresh `mkdtemp` under the OS temp folder —
 * no test in this section can reach a configured receive folder.
 *
 * The swap records both inodes, so each test can prove the swap happened rather than assume it.
 */
function partSwap(d: string, part: string, size: number) {
  assert.ok(d.startsWith(tmpdir()), `confined to the OS temp folder: ${d}`);
  const s = { done: false, originalIno: -1, replacementIno: -1, replacement: randomBytes(size), away: join(d, 'moved-aside.bin') };
  const swap = (): void => {
    if (s.done) return;
    s.done = true;
    s.originalIno = lstatSync(part).ino;
    renameSync(part, s.away);
    writeFileSync(part, s.replacement, { flag: 'wx' });
    s.replacementIno = lstatSync(part).ino;
  };
  const proveSwapped = (): void => {
    assert.equal(s.done, true, 'the swap ran');
    assert.notEqual(s.replacementIno, s.originalIno, 'the replacement is a different file');
    assert.equal(lstatSync(s.away).ino, s.originalIno, 'this attempt’s own file is the one moved aside');
  };
  return { s, swap, proveSwapped };
}

const fresh = (): { d: string; part: string } => {
  const d = folder();
  assert.deepEqual(readdirSync(d), [], 'a fresh, empty folder');
  return { d, part: sharePartPath(d, id, newPartNonce()) };
};

test('S2 control: the same harness with the swap never armed saves the file', T, async () => {
  const { d, part } = fresh();
  const { s } = partSwap(d, part, 100_000);
  const { result, data } = await run(100_000, {}, { d, part, onData: () => undefined });
  assert.equal(s.done, false);
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
  assert.deepEqual(readdirSync(d), ['x.bin']);
});

test('S2-A: a replacement at the partial path survives failure cleanup (truncated pull)', T, async () => {
  const { d, part } = fresh();
  const ledger = ledgerIn();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const { result } = await run(100_000, { truncateTo: 60_000, chunkSize: 10_000 }, { d, part, ledger, onData: swap });
  proveSwapped();
  assert.equal(result.ok, false);
  assert.deepEqual(readFileSync(part), s.replacement, 'the replacement is byte-identical after cleanup');
  await sweepLedger(ledger, { allowedParents: [d] });
  assert.deepEqual(readFileSync(part), s.replacement, 'and after the startup sweep');
});

test('S2-A: a replacement at the partial path survives failure cleanup (checksum failure)', T, async () => {
  const { d, part } = fresh();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const { result } = await run(100_000, { corruptAt: 90_000, chunkSize: 10_000 }, { d, part, onData: swap });
  proveSwapped();
  assert.equal(result.ok, false);
  assert.deepEqual(readFileSync(part), s.replacement);
});

test('S2-B: a same-size replacement is never published with the received bytes’ digest, nor reported Saved', T, async () => {
  const { d, part } = fresh();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const { result, data } = await run(100_000, { chunkSize: 10_000 }, { d, part, onData: swap });
  proveSwapped();
  assert.equal(s.replacement.length, data.bytes.length, 'same size, so a length check alone cannot tell them apart');
  assert.equal(result.ok, false, result.ok ? `reported Saved as ${result.savedAs} with sha256 ${result.sha256.slice(0, 12)}…` : '');
  assert.equal(existsSync(join(d, 'x.bin')), false, 'nothing published');
  assert.equal(!result.ok && result.unexpectedFile, undefined, 'nothing was linked, so no unexpected-file state');
  assert.deepEqual(readFileSync(part), s.replacement, 'the replacement is untouched');
  assert.deepEqual(readFileSync(s.away), data.bytes, 'the received bytes went to this attempt’s own file');
});

test('S2: a swap just before publication (after the last look) is linked, caught, not reported Saved, and nothing is deleted', T, async () => {
  const { d, part } = fresh();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const { result, data } = await run(100_000, {}, { d, part, publish: async (p, dd) => { swap(); return publishExclusive(p, dd, 'x.bin'); } });
  proveSwapped();
  assert.equal(result.ok, false);
  assert.match((result as { detail: string }).detail, /x\.bin .*left in place/);
  assert.deepEqual(!result.ok && result.unexpectedFile, { savedAs: 'x.bin', path: join(d, 'x.bin') });
  assert.deepEqual(readFileSync(join(d, 'x.bin')), s.replacement, 'the linked name is left, and it is the newcomer — not claimed as ours');
  assert.deepEqual(readFileSync(part), s.replacement, 'the newcomer keeps its name at the partial path');
  assert.deepEqual(readFileSync(s.away), data.bytes);
});

test('S2: the final name swapped after the link is not reported Saved and the file there is not deleted', T, async () => {
  const { d, part } = fresh();
  const theirs = randomBytes(100_000);
  let swapped = false;
  const { result, data } = await run(100_000, {}, {
    d, part,
    publish: async (p, dd) => {
      const r = await publishExclusive(p, dd, 'x.bin');
      if (r.ok) {
        renameSync(r.path, join(dd, 'ours-moved-aside.bin'));
        writeFileSync(r.path, theirs, { flag: 'wx' });
        swapped = true;
      }
      return r;
    },
  });
  assert.equal(swapped, true);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.unexpectedFile, { savedAs: 'x.bin', path: join(d, 'x.bin') });
  assert.deepEqual(readFileSync(join(d, 'x.bin')), theirs, 'the file now at the final name survives');
  assert.deepEqual(readFileSync(join(d, 'ours-moved-aside.bin')), data.bytes);
  assert.equal(existsSync(part), false, 'the partial, still this attempt’s own file, is removed by identity');
});

test('S2: the partial swapped after the link: Saved (the final name is ours), and the newcomer at the partial path is left for good', T, async () => {
  const { d, part } = fresh();
  const ledger = ledgerIn();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const { result, data } = await run(100_000, {}, {
    d, part, ledger,
    publish: async (p, dd) => { const r = await publishExclusive(p, dd, 'x.bin'); swap(); return r; },
  });
  proveSwapped();
  assert.equal(reason(result), true);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
  assert.equal(lstatSync(join(d, 'x.bin')).ino, s.originalIno, 'the saved file is the one this attempt created');
  assert.deepEqual(readFileSync(part), s.replacement, 'not deleted by the pull');
  await sweepLedger(ledger, { allowedParents: [d] });
  assert.deepEqual(readFileSync(part), s.replacement, 'nor by the startup sweep');
});

test('S2 negative: a symlink swapped in at the partial path is neither published nor followed nor removed', T, async () => {
  const { d, part } = fresh();
  const outside = join(folder(), 'target');
  writeFileSync(outside, randomBytes(100_000));
  const before = readFileSync(outside);
  let swapped = false;
  const { result } = await run(100_000, {}, {
    d, part,
    onData: () => { if (!swapped) { swapped = true; renameSync(part, join(d, 'moved-aside.bin')); symlinkSync(outside, part); } },
  });
  assert.equal(swapped, true);
  assert.equal(result.ok, false);
  assert.match((result as { detail: string }).detail, /symbolic link/);
  assert.equal(lstatSync(part).isSymbolicLink(), true);
  assert.deepEqual(readFileSync(outside), before);
  assert.equal(existsSync(join(d, 'x.bin')), false);
});

test('S2: the saved name emptied after the link is an ordinary failure, not an unexpected file — nothing there was shown to be anyone’s', T, async () => {
  const { d, part } = fresh();
  const { result } = await run(10_000, {}, {
    d, part,
    publish: async (p, dd) => {
      const r = await publishExclusive(p, dd, 'x.bin');
      if (r.ok) renameSync(r.path, join(dd, 'moved-by-someone.bin'));
      return r;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'write-failed');
  assert.equal(!result.ok && result.unexpectedFile, undefined);
  assert.equal(existsSync(join(d, 'moved-by-someone.bin')), true, 'control: the rename happened');
});

test('S2 accepted race, detected: a replacement swapped in between the identity check and the unlink loses its name — and the pull says so', T, async () => {
  const { d, part } = fresh();
  const { s, swap, proveSwapped } = partSwap(d, part, 100_000);
  const realUnlink = fsp.unlink;
  // The one-syscall window the owner accepted, forced open: the swap lands inside the unlink call.
  (fsp as { unlink: typeof fsp.unlink }).unlink = async (p) => {
    if (p === part && !s.done) swap();
    return realUnlink(p);
  };
  let result: SharePullResult;
  try {
    ({ result } = await run(100_000, { truncateTo: 60_000, chunkSize: 10_000 }, { d, part }));
  } finally {
    (fsp as { unlink: typeof fsp.unlink }).unlink = realUnlink;
  }
  proveSwapped();
  assert.equal(existsSync(part), false, 'the accepted race: the replacement lost its name (not prevented)');
  assert.equal(result.ok, false);
  assert.match((result as { detail: string }).detail, /lost its name at the partial path \(this attempt's file went from 1 to 1 links\)/);
  assert.equal(lstatSync(s.away).nlink, 1, 'this attempt’s own file still exists, moved aside');
});

// ---- the real handleWriter ------------------------------------------------------------------------

/**
 * The real `FileHandle`, wrapped so a test can hold, delay or fail one of its writes and count its
 * closes. Everything not overridden goes to the real handle, bound to it.
 */
function watched(real: FileHandle, over: { write?: (n: number, go: () => Promise<unknown>) => Promise<unknown> } = {}) {
  const w = { writes: 0, closes: 0, events: [] as string[], handle: null as unknown as FileHandle, real };
  w.handle = new Proxy(real, {
    get(target, key) {
      if (key === 'write') {
        return (...args: unknown[]) => {
          const n = ++w.writes;
          const go = () => (target.write as (...a: unknown[]) => Promise<unknown>)(...args);
          return over.write ? over.write(n, go) : go();
        };
      }
      if (key === 'close') {
        return () => {
          w.closes += 1;
          w.events.push('close');
          return target.close();
        };
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[key];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return w;
}
const openWatched = (over?: Parameters<typeof watched>[1]) => {
  const all: ReturnType<typeof watched>[] = [];
  const open = async (p: string): Promise<FileHandle> => {
    const w = watched(await fsp.open(p, 'wx'), over);
    all.push(w);
    return w.handle;
  };
  return { all, open };
};

test('handleWriter unit: a real write error surfaces as the stream’s error, and the handle is not closed by the writer', async () => {
  const d = folder();
  writeFileSync(join(d, 'ro'), 'x');
  const h = await fsp.open(join(d, 'ro'), 'r'); // read-only: every write is EBADF from the kernel
  try {
    const out = handleWriter(h);
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      out.once('error', resolve);
      out.write(Buffer.alloc(10));
    });
    assert.equal(error.code, 'EBADF');
    assert.equal(out.destroyed, true);
    assert.ok((await h.stat()).isFile(), 'the handle is still open — only the pull closes it');
  } finally {
    await h.close();
  }
});

test('handleWriter: a write failure mid-transfer fails the pull as write-failed, deletes its own partial, closes the handle once', T, async () => {
  const enospc = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  const w = openWatched({ write: (n, go) => (n === 3 ? Promise.reject(enospc) : go()) });
  const { result, d } = await run(100_000, { chunkSize: 10_000 }, { openHandle: w.open });
  assert.equal(!result.ok && result.reason, 'write-failed');
  assert.match((result as { detail: string }).detail, /ENOSPC/);
  assert.equal(w.all[0]!.writes, 3, 'control: the third write was the one that failed');
  assert.equal(w.all[0]!.closes, 1);
  assert.equal(w.all[0]!.real.fd, -1, 'the real handle is closed');
  assert.deepEqual(readdirSync(d), []);
});

test('handleWriter: backpressure pauses the socket while writes are slow, and the idle timer does not count that pause', T, async () => {
  const frames = 6;
  const w = openWatched({ write: (_n, go) => new Promise((r) => setTimeout(r, 120)).then(go) });
  let pauses = 0;
  const { result, d, data } = await run(frames * 64 * 1024, { chunkSize: 64 * 1024 }, {
    openHandle: w.open,
    idleTimeoutMs: 80, // shorter than one slow write: only a paused idle timer lets this pass
    onSocket: (socket) => {
      const pause = socket.pause.bind(socket);
      socket.pause = () => { pauses += 1; return pause(); };
    },
  });
  assert.equal(reason(result), true, `pauses=${pauses} over ${frames} frames`);
  assert.ok(pauses > 0, `the writer signalled backpressure: ${pauses} pauses over ${frames} frames`);
  assert.deepEqual(readFileSync(join(d, 'x.bin')), data.bytes);
  assert.equal(w.all[0]!.closes, 1);
});

test('handleWriter: a cancel while a write is pending waits for that write, then deletes the partial and closes the handle once', T, async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const w = openWatched({
    write: (n, go) => {
      if (n !== 2) return go();
      w.all[0]!.events.push('write-held');
      return held.then(go).then((v) => { w.all[0]!.events.push('write-settled'); return v; });
    },
  });
  const ac = new AbortController();
  let settled = false;
  const pending = run(100_000, { chunkSize: 10_000 }, {
    openHandle: w.open, signal: ac.signal, idleTimeoutMs: 5000,
    onData: () => { if (w.all[0]?.events.includes('write-held')) ac.abort(); },
  }).then((r) => { settled = true; return r; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ac.signal.aborted, true, 'control: the cancel landed while the write was held');
  assert.equal(settled, false, 'the pull does not report while its write is still in flight');
  assert.equal(w.all[0]!.closes, 0, 'and has not closed the handle under that write');
  release();
  const { result, d } = await pending;
  assert.equal(reason(result), 'cancelled');
  assert.deepEqual(w.all[0]!.events.slice(0, 2), ['write-held', 'write-settled']);
  assert.equal(w.all[0]!.events.at(-1), 'close');
  assert.equal(w.all[0]!.closes, 1);
  assert.deepEqual(readdirSync(d), []);
});

test('the handle is closed exactly once on every exit path', T, async () => {
  const paths: [string, Partial<PhoneBehaviour>, (w: ReturnType<typeof openWatched>) => Extra][] = [
    ['saved', {}, (w) => ({ openHandle: w.open })],
    ['truncated', { truncateTo: 5_000 }, (w) => ({ openHandle: w.open })],
    ['checksum', { corruptAt: 10 }, (w) => ({ openHandle: w.open })],
    ['stalled', { stallAfter: 5_000, chunkSize: 1_000 }, (w) => ({ openHandle: w.open, idleTimeoutMs: 100 })],
    ['publish refused', {}, (w) => ({ openHandle: w.open, publish: async () => ({ ok: false, reason: 'unsupported-destination', detail: 'x' }) })],
    ['unexpected file', {}, (w) => ({
      openHandle: w.open,
      publish: async (p, dd) => { renameSync(p, join(dd, 'aside')); writeFileSync(p, randomBytes(20_000), { flag: 'wx' }); return publishExclusive(p, dd, 'x.bin'); },
    })],
    ['identity not recordable', {}, (w) => ({
      openHandle: w.open,
      ledger: Object.assign(ledgerIn(), { recordCreated: async () => { throw new Error('ledger full'); } }),
    })],
  ];
  for (const [label, behaviour, extra] of paths) {
    const w = openWatched();
    const ac = new AbortController();
    const { result } = await run(20_000, behaviour, { ...extra(w), signal: ac.signal });
    assert.equal(w.all.length, 1, `${label}: one handle opened`);
    assert.equal(w.all[0]!.closes, 1, `${label}: closed once (result ${reason(result)})`);
    assert.equal(w.all[0]!.real.fd, -1, `${label}: the real handle is closed`);
  }
});
