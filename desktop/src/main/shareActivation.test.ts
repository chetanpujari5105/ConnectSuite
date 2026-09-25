import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MAC_EXT, negotiateAll, ordinarySendNegotiated } from '../shared/extensions';
import {
  advertisedExt,
  receiverMode,
  resolveScratchFolder,
  scratchFolderPath,
  SHARE_PRODUCTION_READINESS,
  shareAskActivation,
  shareV2Activation,
  type ShareV2Inputs,
} from './shareActivation';

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

// ---- the production promise: share.ask (docs/protocol.md → Extensions) ---------------------------

const closedDev = shareV2Activation({ ...all, shareV2: false });
const openDev = shareV2Activation(all);
const ready = { syntheticRunPassed: true, receiveFolderCleanupScoped: true };

const notReady = { syntheticRunPassed: false, receiveFolderCleanupScoped: false };

test('this build: both readiness facts are recorded (3e passed 2026-09-25; §11 in 5e20963) — pinned', () => {
  // Recorded in the reviewed activation commit with its evidence (docs/testing.md → slice 3e, §11).
  // Turning either back to false is the way to close production sharing again.
  assert.deepEqual({ ...SHARE_PRODUCTION_READINESS }, { syntheticRunPassed: true, receiveFolderCleanupScoped: true });
  const a = shareAskActivation({ development: closedDev, readiness: SHARE_PRODUCTION_READINESS });
  assert.deepEqual(a, { active: true, syntheticOnly: false });
  assert.deepEqual(advertisedExt(closedDev, a), { 'share.file': 2, 'share.ask': 1 });
  // With the development switches all on, it is still synthetic-only and never share.ask.
  const withDev = shareAskActivation({ development: openDev, readiness: SHARE_PRODUCTION_READINESS });
  assert.equal(withDev.active, false);
  assert.deepEqual(advertisedExt(openDev, withDev), { 'share.file': 2 });
});

test('not ready: both facts false keeps share.ask closed and names both blockers', () => {
  const a = shareAskActivation({ development: closedDev, readiness: notReady });
  assert.equal(a.active, false);
  assert.equal(a.active === false && a.blockers.length, 2);
  assert.deepEqual(advertisedExt(closedDev, a), { 'share.file': 1 });
});

test('control: both facts recorded and the development gate closed opens share.ask with share.file 2', () => {
  const a = shareAskActivation({ development: closedDev, readiness: ready });
  assert.deepEqual(a, { active: true, syntheticOnly: false });
  assert.deepEqual(advertisedExt(closedDev, a), { 'share.file': 2, 'share.ask': 1 });
});

test('either readiness fact missing keeps share.ask closed, and names that fact', () => {
  for (const [label, readiness, word] of [
    ['no 3e', { ...ready, syntheticRunPassed: false }, 'slice 3e'],
    ['no scoped cleanup', { ...ready, receiveFolderCleanupScoped: false }, '§11'],
  ] as const) {
    const a = shareAskActivation({ development: closedDev, readiness });
    assert.equal(a.active, false, label);
    assert.ok(a.active === false && a.blockers.length === 1 && a.blockers[0]!.includes(word), label);
    assert.deepEqual(advertisedExt(closedDev, a), { 'share.file': 1 }, label);
  }
});

test('the development gate open closes share.ask even with every fact recorded — the promises are opposite', () => {
  const a = shareAskActivation({ development: openDev, readiness: ready });
  assert.equal(a.active, false);
  // Even handed an open ask (a caller bug), the development advertisement carries no share.ask.
  assert.deepEqual(advertisedExt(openDev, { active: true, syntheticOnly: false }), { 'share.file': 2 });
});

interface OrdinaryCase { why: string; negotiated: Record<string, number> | null; send: boolean }
const ordinary = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/fixtures/share-ordinary-send.json'), 'utf8'),
) as { cases: OrdinaryCase[] };

test('the shared fixture: ordinary Send only with share.file ≥ 2 and share.ask ≥ 1', () => {
  // Control: the fixture has both answers, so agreeing with it is not agreeing with a constant.
  assert.ok(ordinary.cases.some((c) => c.send) && ordinary.cases.some((c) => !c.send));
  for (const c of ordinary.cases) assert.equal(ordinarySendNegotiated(c.negotiated), c.send, c.why);
});

test('end to end over negotiation: only a production Mac enables the phone’s ordinary Send', () => {
  // What a current phone advertises: share.ask always; share.file 1, or 2 for one armed debug handshake.
  const phones = [{ 'share.file': 1, 'share.ask': 1 }, { 'share.file': 2, 'share.ask': 1 }];
  const production = shareAskActivation({ development: closedDev, readiness: ready });
  const today = shareAskActivation({ development: closedDev, readiness: notReady });
  const macs: [string, Readonly<Record<string, number>>][] = [
    ['version 1 Mac', advertisedExt(closedDev, today)],
    ['synthetic-only development Mac', advertisedExt(openDev, today)],
    ['production Mac (not buildable yet)', advertisedExt(closedDev, production)],
  ];
  const got = macs.map(([label, mac]) => [label, phones.map((p) => ordinarySendNegotiated(negotiateAll(mac, p)))]);
  assert.deepEqual(got, [
    ['version 1 Mac', [false, false]],
    ['synthetic-only development Mac', [false, false]],
    ['production Mac (not buildable yet)', [false, true]],
  ]);
});

// ---- the receiver's mode: no allowlist and no auto-accept outside the synthetic-only gate --------

test('receiverMode: the allowlist reaches the receiver only while the synthetic-only development gate is open', () => {
  const digests = new Set(['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
  const production = shareAskActivation({ development: closedDev, readiness: ready });
  const closed = shareAskActivation({ development: closedDev, readiness: notReady });
  const dev = receiverMode(openDev, closed, digests);
  assert.deepEqual(dev.version2, { allowed: true, syntheticOnly: true });
  assert.equal(dev.acceptProbeDigests.size, 1, 'control: the development gate does carry the allowlist');
  // The hole this exists for: shareAcceptProbe + digests set, shareV2 not, share.ask open.
  const prod = receiverMode(closedDev, production, digests);
  assert.deepEqual(prod.version2, { allowed: true, syntheticOnly: false });
  assert.equal(prod.acceptProbeDigests.size, 0, 'Ask mode never auto-accepts, whatever the environment says');
  const v1 = receiverMode(closedDev, closed, digests);
  assert.deepEqual(v1.version2, { allowed: false, syntheticOnly: true });
  assert.equal(v1.acceptProbeDigests.size, 0);
});
