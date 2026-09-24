import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkDestination, realFs } from './shareDestination';
import { FileShareLedger, recordCreatedFrom, sweepLedger } from './shareLedger';

/**
 * The ownership rule: nothing is deleted because of its name. The sweep deletes a file only when the
 * ledger recorded **that file** — its exact path, device and inode — being created by this app.
 */

const tmp = (): string => mkdtempSync(join(tmpdir(), 'share-ledger-'));
const ledgerIn = (): FileShareLedger => new FileShareLedger(join(tmp(), 'share-temporary-files.json'));

test('a recorded, identity-matched file is deleted and the entry forgotten', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = join(d, 'ours.part');
  await ledger.recordIntent(p);
  writeFileSync(p, 'ours', { flag: 'wx' });
  await recordCreatedFrom(ledger, p);
  assert.deepEqual(await sweepLedger(ledger), { deleted: 1, forgotten: 0 });
  assert.equal(existsSync(p), false);
  assert.deepEqual(await ledger.entries(), []);
});

test('an entry with no recorded identity (a crash before creation) deletes nothing — even a file now at that path', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = join(d, 'intended.part');
  await ledger.recordIntent(p);
  writeFileSync(p, 'somebody else’s file');
  assert.deepEqual(await sweepLedger(ledger), { deleted: 0, forgotten: 1 });
  assert.equal(readFileSync(p, 'utf8'), 'somebody else’s file');
  assert.deepEqual(await ledger.entries(), []);
});

test('a recorded file that was replaced by another (a different inode) is left alone', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = join(d, 'ours.part');
  await ledger.recordIntent(p);
  writeFileSync(p, 'ours', { flag: 'wx' });
  await recordCreatedFrom(ledger, p);
  const keep = join(d, 'keep');
  writeFileSync(keep, 'placeholder'); // holds an inode so the replacement cannot reuse ours
  unlinkSync(p);
  writeFileSync(p, 'a different file with the same name');
  assert.notEqual(lstatSync(p).ino, undefined);
  assert.deepEqual(await sweepLedger(ledger), { deleted: 0, forgotten: 1 });
  assert.equal(readFileSync(p, 'utf8'), 'a different file with the same name');
});

test('a symlink at a recorded path is never followed or deleted', async () => {
  const d = tmp();
  const outside = join(tmp(), 'target');
  writeFileSync(outside, 'must survive');
  const ledger = ledgerIn();
  const p = join(d, 'ours.part');
  await ledger.recordIntent(p);
  writeFileSync(p, 'ours', { flag: 'wx' });
  await recordCreatedFrom(ledger, p);
  unlinkSync(p);
  symlinkSync(outside, p);
  assert.deepEqual(await sweepLedger(ledger), { deleted: 0, forgotten: 1 });
  assert.equal(lstatSync(p).isSymbolicLink(), true);
  assert.equal(readFileSync(outside, 'utf8'), 'must survive');
});

test('a file that merely LOOKS like ours, never recorded, is invisible to the sweep', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const lookalike = join(d, '.s-Q3v9aP0kT7mR2xW8yB4nZc.AAAAAAAAAAAAAAAAAAAAAA.sidekick-share.part');
  writeFileSync(lookalike, 'not ours');
  const probeLike = join(d, '.sidekick-link-probe-AAAAAAAAAAAAAAAAAAAAAA');
  writeFileSync(probeLike, '');
  assert.deepEqual(await sweepLedger(ledger), { deleted: 0, forgotten: 0 });
  assert.equal(readFileSync(lookalike, 'utf8'), 'not ours');
  assert.equal(existsSync(probeLike), true);
});

test('the destination check leaves the ledger empty when it cleans up, and recoverable when it cannot', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  assert.deepEqual(await checkDestination(d, 1, realFs, ledger), { ok: true });
  assert.deepEqual(await ledger.entries(), []);

  const e = tmp();
  const stuck = ledgerIn();
  const v = await checkDestination(e, 1, { ...realFs, unlink: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } }, stuck);
  assert.equal((v as { reason: string }).reason, 'folder-unavailable');
  assert.equal((await stuck.entries()).length, 2, 'both probe files recorded with their identity');
  assert.deepEqual(await sweepLedger(stuck), { deleted: 2, forgotten: 0 });
});
