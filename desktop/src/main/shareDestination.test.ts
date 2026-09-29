import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAX_NAME_ATTEMPTS,
  checkDestination,
  publishExclusive,
  realFs,
  sharePartPath,
  spaceNeeded,
  type DestinationFs,
} from './shareDestination';

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const nonce = 'NNNNNNNNNNNNNNNNNNNNNN';
const dir = (): string => mkdtempSync(join(tmpdir(), 'share-dest-'));
const err = (code: string): Error => Object.assign(new Error(code), { code });
const withFs = (over: Partial<DestinationFs>): DestinationFs => ({ ...realFs, ...over });

// ---- checkDestination ------------------------------------------------------------------------

test('a real writable folder with room passes, and the probe files are gone afterwards', async () => {
  const d = dir();
  assert.deepEqual(await checkDestination(d, 100_000), { ok: true });
  assert.deepEqual(readdirSync(d), []);
});

test('154: a probe name swapped for another file between the link and the delete is left untouched and reported', async () => {
  const d = dir();
  let swapped = '';
  const v = await checkDestination(d, 1, withFs({
    link: async (a, b) => {
      await realFs.link(a, b);
      // Something else takes the second probe's name before the cleanup runs.
      renameSync(b, `${b}.moved-aside`);
      writeFileSync(b, 'not the probe');
      swapped = b;
    },
  }));
  assert.ok(swapped, 'control: the swap happened');
  assert.equal(readFileSync(swapped, 'utf8'), 'not the probe', 'the replacement survives the cleanup');
  assert.equal(v.ok, false);
  assert.match((v as { detail: string }).detail, /now another file, left untouched/);
  // The probe's own first name was still its own and is removed; its moved-aside link is the probe too.
  assert.equal(existsSync(swapped.replace(/-2$/, '')), false);
});

test('not enough space is insufficient-space, with the numbers', async () => {
  const d = dir();
  const v = await checkDestination(d, 100_000, withFs({ statfs: async () => ({ bavail: 1, bsize: 4096 }) }));
  assert.equal(v.ok, false);
  assert.equal((v as { reason: string }).reason, 'insufficient-space');
  assert.equal(spaceNeeded(0), 256 * 1024 * 1024);
});

test('a filesystem that refuses hard links is unsupported-destination, and nothing is left behind', async () => {
  for (const c of ['EXDEV', 'ENOTSUP', 'EPERM', 'ENOSYS']) {
    const d = dir();
    const v = await checkDestination(d, 1, withFs({ link: async () => { throw err(c); } }));
    assert.equal((v as { reason: string }).reason, 'unsupported-destination', c);
    assert.deepEqual(readdirSync(d), [], `probe cleaned up after ${c}`);
  }
});

test('anything the check cannot establish fails closed as folder-unavailable', async () => {
  const cases: [string, Partial<DestinationFs>][] = [
    ['unexpected link error', { link: async () => { throw err('EIO'); } }],
    ['probe cannot be created', { writeFileExclusive: async () => { throw err('EACCES'); } }],
    ['free space unreadable', { statfs: async () => { throw err('EIO'); } }],
    ['free space not a number', { statfs: async () => ({ bavail: Number.NaN, bsize: 1 }) }],
    ['not writable', { access: async () => { throw err('EACCES'); } }],
  ];
  for (const [why, over] of cases) {
    const v = await checkDestination(dir(), 1, withFs(over));
    assert.equal((v as { reason: string }).reason, 'folder-unavailable', why);
  }
  assert.equal((await checkDestination(join(dir(), 'missing'), 1) as { reason: string }).reason, 'folder-unavailable');
});

test('a probe file that cannot be deleted fails closed and is named', async () => {
  const v = await checkDestination(dir(), 1, withFs({ unlink: async () => { throw err('EPERM'); } }));
  assert.equal((v as { reason: string }).reason, 'folder-unavailable');
  assert.match((v as { detail: string }).detail, /sidekick-link-probe-/);
});

// ---- publishExclusive ------------------------------------------------------------------------

function partWith(d: string, content: string): string {
  const p = sharePartPath(d, id, nonce);
  writeFileSync(p, content);
  return p;
}

test('publishes by link under the wanted name, and leaves the partial for the caller to remove by identity', async () => {
  const d = dir();
  const part = partWith(d, 'hello');
  const r = await publishExclusive(part, d, 'x.bin');
  assert.deepEqual(r.ok && r.savedAs, 'x.bin');
  assert.equal(readFileSync(join(d, 'x.bin'), 'utf8'), 'hello');
  assert.equal(lstatSync(part).ino, lstatSync(join(d, 'x.bin')).ino, 'the partial is a second name for the published file');
});

test('a file swapped in at the partial path after the link is not removed by the publisher', async () => {
  const d = dir();
  const part = partWith(d, 'shared');
  const r = await publishExclusive(part, d, 'x.bin', withFs({
    link: async (a, b) => {
      await realFs.link(a, b);
      renameSync(a, join(d, 'moved-aside'));
      writeFileSync(a, 'somebody else’s file', { flag: 'wx' }); // swapped in right after the link
    },
  }));
  assert.equal(r.ok, true);
  assert.equal(readFileSync(part, 'utf8'), 'somebody else’s file');
});

test('an existing file is never replaced: the share lands as (2)', async () => {
  const d = dir();
  writeFileSync(join(d, 'x.bin'), 'the owner’s file');
  const r = await publishExclusive(partWith(d, 'shared'), d, 'x.bin');
  assert.equal(r.ok && r.savedAs, 'x (2).bin');
  assert.equal(readFileSync(join(d, 'x.bin'), 'utf8'), 'the owner’s file');
});

test('the final-name race: a file created after the name was chosen is not overwritten', async () => {
  const d = dir();
  let raced = false;
  const r = await publishExclusive(partWith(d, 'shared'), d, 'x.bin', realFs, async (path) => {
    if (!raced) {
      raced = true;
      writeFileSync(path, 'appeared in between'); // lands after lstat said "free"
    }
  });
  assert.equal(r.ok && r.savedAs, 'x (2).bin');
  assert.equal(readFileSync(join(d, 'x.bin'), 'utf8'), 'appeared in between');
  assert.equal(readFileSync(join(d, 'x (2).bin'), 'utf8'), 'shared');
});

test('rename-over is not how it publishes: with link refusing, the save is refused and nothing is written', async () => {
  const d = dir();
  writeFileSync(join(d, 'x.bin'), 'keep me');
  const r = await publishExclusive(partWith(d, 'shared'), d, 'x.bin', withFs({ link: async () => { throw err('ENOTSUP'); } }));
  assert.deepEqual(r.ok, false);
  assert.equal((r as { reason: string }).reason, 'unsupported-destination');
  assert.equal(readFileSync(join(d, 'x.bin'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(d, 'x (2).bin')), false);
});

test('twenty taken names is a write failure, never an overwrite', async () => {
  const d = dir();
  for (let n = 1; n <= MAX_NAME_ATTEMPTS; n += 1) writeFileSync(join(d, n === 1 ? 'x.bin' : `x (${n}).bin`), `owner ${n}`);
  const r = await publishExclusive(partWith(d, 'shared'), d, 'x.bin');
  assert.equal((r as { reason: string }).reason, 'write-failed');
  assert.equal(readFileSync(join(d, 'x.bin'), 'utf8'), 'owner 1');
});

// ---- names ------------------------------------------------------------------------------------

test('sharePartPath refuses anything that is not an offer id', () => {
  assert.throws(() => sharePartPath('/tmp', '../../etc/passwd', nonce));
  assert.throws(() => sharePartPath('/tmp', 's-short', nonce));
  assert.throws(() => sharePartPath('/tmp', id, '../x'));
  assert.equal(sharePartPath('/tmp', id, nonce), `/tmp/.${id}.${nonce}.sidekick-share.part`);
});

// ---- reservations (version 3) --------------------------------------------------------------------

test('reserved bytes come out of free space before the offer is judged; 0 reserved is the version-2 rule', async () => {
  const MiB = 1024 * 1024;
  const size = 10 * MiB;
  const needed = spaceNeeded(size);
  const freeFs = (free: number) => withFs({ statfs: async () => ({ bavail: free, bsize: 1 }) });
  assert.deepEqual(await checkDestination(dir(), size, freeFs(needed), null, 0), { ok: true }, 'exactly enough, nothing reserved');
  const short = await checkDestination(dir(), size, freeFs(needed), null, 1);
  assert.equal((short as { reason: string }).reason, 'insufficient-space', 'one reserved byte tips it');
  assert.match((short as { detail: string }).detail, /after 1 reserved/);
  assert.deepEqual(await checkDestination(dir(), size, freeFs(needed + 500), null, 500), { ok: true }, 'reserved exactly covered');
});

test('an unreadable reservation fails closed rather than being read as none', async () => {
  for (const bad of [-1, Number.NaN, 1.5]) {
    const v = await checkDestination(dir(), 1, realFs, null, bad);
    assert.equal((v as { reason: string }).reason, 'folder-unavailable', String(bad));
  }
});
