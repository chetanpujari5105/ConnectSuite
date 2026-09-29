import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { pullPartPathFor } from '../shared/transferFiles';
import { pullDestination } from './files';
import {
  createPartialExclusive,
  deleteOwnedPartial,
  MAX_RESUME_AGE_MS,
  openOwnedPartial,
  ownedPartial,
  PullResumeStore,
  STORE_FULL_SENTENCE,
  type ResumeRecord,
} from './pullResume';

/**
 * The owner's decisions D2, D3 and D5 (2026-09-29) as behaviour, in real temporary folders: records
 * capped at 16 and 7 days with refusal rather than eviction, and a partial touched only when it is
 * provably this transfer's own — never a symlink, a replaced file, a final file or a stranger's.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_790_000_000_000;

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-resume-'));
  const folder = join(root, 'Sidekick');
  mkdirSync(folder);
  return { root, folder, store: new PullResumeStore(join(root, 'pull-resume')) };
}

/** A record with a real, owned partial of [bytes] bytes. */
async function withPartial(folder: string, name: string, bytes = 100, over: Partial<ResumeRecord> = {}): Promise<ResumeRecord> {
  const destination = join(folder, name);
  const { handle, dev, ino } = await createPartialExclusive(pullPartPathFor(destination));
  await handle.write(Buffer.alloc(bytes, 7));
  await handle.close();
  return {
    v: 1, phone: 'fp-phone-A', rootId: 'saf:primary', id: `doc-${name}`, name, size: 1000, mtimeMs: 1, blockSize: 131072,
    digests: [], destination, folderReal: realpathSync(folder), partDev: dev, partIno: ino, createdAtMs: NOW, updatedAtMs: NOW,
    ...over,
  };
}

test('a record round-trips, and belongs to one phone only', async () => {
  const { root, folder, store } = setup();
  const r = await withPartial(folder, 'a.bin');
  await store.save(r);
  assert.deepEqual(await store.find('fp-phone-A', 'saf:primary', 'doc-a.bin'), r);
  assert.equal(await store.find('fp-phone-B', 'saf:primary', 'doc-a.bin'), null, 'never offered to another phone');
  assert.equal(statSync(join(root, 'pull-resume')).mode & 0o777, 0o700, 'records are private to this user');
  assert.deepEqual(readdirSync(folder), ['.a.bin.sidekick-pull.part'], 'nothing of the record sits beside the file');
});

test('D3: with 16 live records a new one is refused and nothing is evicted', async () => {
  const { folder, store } = setup();
  for (let i = 0; i < 16; i += 1) await store.save(await withPartial(folder, `f${i}.bin`, 10, { createdAtMs: NOW - i * DAY / 4 }));
  const before = readdirSync(folder).sort();
  assert.deepEqual(await store.reserve(NOW), { ok: false, why: STORE_FULL_SENTENCE });
  assert.equal((await store.all()).length, 16, 'no record evicted');
  assert.deepEqual(readdirSync(folder).sort(), before, 'no partial touched');
  // 15 is room for one more.
  await store.discard((await store.all())[0]!, false);
  assert.deepEqual(await store.reserve(NOW), { ok: true });
});

test('D3: a record older than 7 days is expired — its owned partial deleted, the boundary kept', async () => {
  const { folder, store } = setup();
  const old = await withPartial(folder, 'old.bin', 10, { createdAtMs: NOW - MAX_RESUME_AGE_MS - 1 });
  const edge = await withPartial(folder, 'edge.bin', 10, { createdAtMs: NOW - MAX_RESUME_AGE_MS });
  await store.save(old);
  await store.save(edge);
  const expired = await store.sweep(NOW);
  assert.deepEqual(expired.map((e) => [e.record.name, e.partial]), [['old.bin', 'partial deleted']]);
  assert.equal(existsSync(pullPartPathFor(old.destination)), false);
  assert.ok(await store.find('fp-phone-A', 'saf:primary', 'doc-edge.bin'), 'exactly 7 days old is kept');
  assert.ok(existsSync(pullPartPathFor(edge.destination)));
});

test('D3: an expired record whose partial is no longer ours drops the record and leaves the file', async () => {
  const { folder, store } = setup();
  const r = await withPartial(folder, 'x.bin', 10, { createdAtMs: NOW - 8 * DAY });
  await store.save(r);
  const part = pullPartPathFor(r.destination);
  unlinkSync(part);
  writeFileSync(part, 'someone else put this here'); // a new inode at the same path
  const expired = await store.sweep(NOW);
  assert.match(expired[0]!.partial, /left in place \(a different file now stands/);
  assert.equal(readFileSync(part, 'utf8'), 'someone else put this here');
  assert.equal(await store.find('fp-phone-A', 'saf:primary', 'doc-x.bin'), null);
});

test('D5: ownership refuses a symlink, a replaced file, a relocated folder and an oversized partial', async () => {
  const { root, folder } = setup();
  const ok = await withPartial(folder, 'ok.bin');
  assert.deepEqual(await ownedPartial(ok), { owned: true, size: 100 });

  const sym = await withPartial(folder, 'sym.bin');
  const target = join(root, 'elsewhere.txt');
  writeFileSync(target, 'the person’s file');
  unlinkSync(pullPartPathFor(sym.destination));
  symlinkSync(target, pullPartPathFor(sym.destination));
  assert.deepEqual(await ownedPartial(sym), { owned: false, why: 'the partial is a symbolic link' });
  assert.deepEqual(await deleteOwnedPartial(sym), { deleted: false, why: 'the partial is a symbolic link' });
  assert.equal(readFileSync(target, 'utf8'), 'the person’s file', 'a symlink target is never deleted');

  const big = await withPartial(folder, 'big.bin', 2000);
  assert.equal((await ownedPartial(big)).owned, false, 'longer than the file');

  // The folder path replaced by a symlink that leads to the very same partial (same device and
  // inode): only the real-path check can see it, and "no symlink traversal" says refuse.
  const moved = await withPartial(folder, 'moved.bin');
  renameSync(folder, join(root, 'Sidekick-old'));
  symlinkSync(join(root, 'Sidekick-old'), folder);
  const st = statSync(pullPartPathFor(moved.destination));
  assert.deepEqual([st.dev, st.ino], [moved.partDev, moved.partIno], 'control: the same file is reachable through the link');
  const verdict = await ownedPartial(moved);
  assert.equal(verdict.owned, false);
  assert.match((verdict as { why: string }).why, /folder now resolves/);
});

test('D2: Cancel deletes only that transfer’s owned partial — never the final file or a neighbour', async () => {
  const { folder, store } = setup();
  const r = await withPartial(folder, 'clip.bin');
  writeFileSync(join(folder, 'clip.bin'), 'a final file of the same name');
  const neighbour = await withPartial(folder, 'clip (2).bin');
  await store.save(r);
  await store.save(neighbour);
  assert.equal(await store.discard(r, true), 'partial deleted');
  assert.equal(existsSync(pullPartPathFor(r.destination)), false);
  assert.equal(readFileSync(join(folder, 'clip.bin'), 'utf8'), 'a final file of the same name');
  assert.ok(existsSync(pullPartPathFor(neighbour.destination)), 'the other transfer’s partial is untouched');
  assert.ok(await store.find('fp-phone-A', 'saf:primary', 'doc-clip (2).bin'));
});

test('D2: Pause (discard without deleting) keeps the partial', async () => {
  const { folder, store } = setup();
  const r = await withPartial(folder, 'p.bin');
  await store.save(r);
  assert.equal(await store.discard(r, false), 'partial kept');
  assert.ok(existsSync(pullPartPathFor(r.destination)));
});

test('forget / re-pair drops only that phone’s records', async () => {
  const { folder, store } = setup();
  await store.save(await withPartial(folder, 'a1.bin'));
  await store.save(await withPartial(folder, 'b1.bin', 10, { phone: 'fp-phone-B' }));
  assert.equal(await store.forgetPhone('fp-phone-A'), 1);
  assert.deepEqual((await store.all()).map((r) => r.phone), ['fp-phone-B']);
});

test('a fresh partial is created exclusively and never through a symlink; a resume opens only its own inode', async () => {
  const { root, folder } = setup();
  const r = await withPartial(folder, 'r.bin');
  await assert.rejects(createPartialExclusive(pullPartPathFor(r.destination)), /EEXIST/);
  const link = join(folder, '.l.bin.sidekick-pull.part');
  symlinkSync(join(root, 'nowhere'), link);
  await assert.rejects(createPartialExclusive(link), /EEXIST/, 'a dangling symlink is not followed into a new file');
  assert.equal(existsSync(join(root, 'nowhere')), false);

  const h = await openOwnedPartial(r);
  await h.close();
  unlinkSync(pullPartPathFor(r.destination));
  writeFileSync(pullPartPathFor(r.destination), 'replaced');
  await assert.rejects(openOwnedPartial(r), /not the one this record created/);
  unlinkSync(pullPartPathFor(r.destination));
  symlinkSync(join(root, 'x'), pullPartPathFor(r.destination));
  await assert.rejects(openOwnedPartial(r), /ELOOP|ENOENT/);
});

test('a new pull never chooses a name whose paused partial exists', async () => {
  const { folder } = setup();
  await withPartial(folder, 'clip.bin');
  assert.equal(await pullDestination(folder, 'clip.bin'), join(folder, 'clip (2).bin'));
  rmSync(pullPartPathFor(join(folder, 'clip.bin')));
  assert.equal(await pullDestination(folder, 'clip.bin'), join(folder, 'clip.bin'), 'control: free again once the partial is gone');
});
