import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MAC_EXT } from '../shared/extensions';
import { advertisedExt, resolveScratchFolder, scratchFolderPath, shareV2Activation, type ShareV2Inputs } from './shareActivation';

/**
 * The pre-live gate. The property worth pinning is that version 2 is advertised **only** with every
 * condition at once, and that each missing one — including the packaged build — leaves the Mac at 1.
 */

const all: ShareV2Inputs = { packaged: false, shareV2: true, shareAcceptProbe: true, acceptProbeDigests: 1, shareDevReceive: true };

test('control: every development condition at once activates version 2, synthetic-only and scratch-only', () => {
  const a = shareV2Activation(all);
  assert.deepEqual(a, { active: true, syntheticOnly: true, scratchOnly: true });
  assert.deepEqual(advertisedExt(a), { 'share.file': 2 });
});

test('any single condition missing fails closed to share.file 1', () => {
  const cases: [string, Partial<ShareV2Inputs>][] = [
    ['packaged', { packaged: true }],
    ['no shareV2', { shareV2: false }],
    ['no synthetic-only accept', { shareAcceptProbe: false }],
    ['no allow-listed digest', { acceptProbeDigests: 0 }],
    ['no scratch receive', { shareDevReceive: false }],
  ];
  for (const [label, over] of cases) {
    const a = shareV2Activation({ ...all, ...over });
    assert.equal(a.active, false, label);
    assert.deepEqual(advertisedExt(a), { 'share.file': 1 }, label);
  }
});

test('a packaged build is refused even with every switch on, and says so first', () => {
  const a = shareV2Activation({ ...all, packaged: true });
  assert.equal(a.active, false);
  assert.match((a as { why: string }).why, /packaged/);
});

test('the default — no switches — advertises exactly what this Mac always has: MAC_EXT, share.file 1', () => {
  const a = shareV2Activation({ packaged: false, shareV2: false, shareAcceptProbe: false, acceptProbeDigests: 0, shareDevReceive: false });
  assert.equal(advertisedExt(a), MAC_EXT);
  assert.equal(MAC_EXT['share.file'], 1, 'the build constant itself is unchanged');
});

// ---- the scratch folder -------------------------------------------------------------------------

const userData = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'share-userdata-')));

test('the scratch folder is <userData>/dev-share-receive and nothing else', () => {
  assert.equal(scratchFolderPath('/x/Sidekick'), '/x/Sidekick/dev-share-receive');
});

test('without create, an absent scratch folder is reported and NOT created', async () => {
  const u = userData();
  const r = await resolveScratchFolder(u, false);
  assert.equal(r.ok, false);
  assert.equal(existsSync(scratchFolderPath(u)), false);
});

test('with create, it is made (owner-only) and resolves to itself', async () => {
  const u = userData();
  const r = await resolveScratchFolder(u, true);
  assert.deepEqual(r, { ok: true, folder: scratchFolderPath(u) });
});

test('a symlink planted at the scratch path is refused and not followed — the Downloads it points at is never used', async () => {
  const u = userData();
  const downloads = mkdtempSync(join(tmpdir(), 'pretend-downloads-'));
  symlinkSync(downloads, scratchFolderPath(u));
  const r = await resolveScratchFolder(u, true);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not a real folder/);
});

test('a file at the scratch path is refused', async () => {
  const u = userData();
  writeFileSync(scratchFolderPath(u), 'not a folder');
  assert.equal((await resolveScratchFolder(u, true)).ok, false);
});

test('an app data folder that does not exist is refused rather than created with its parents', async () => {
  const u = join(userData(), 'missing', 'deeper');
  const r = await resolveScratchFolder(u, true);
  assert.equal(r.ok, false);
  assert.equal(existsSync(u), false);
});

test('an existing real scratch folder is accepted as is', async () => {
  const u = userData();
  mkdirSync(scratchFolderPath(u));
  assert.deepEqual(await resolveScratchFolder(u, false), { ok: true, folder: scratchFolderPath(u) });
});
