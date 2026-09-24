import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkDestination, newPartNonce, realFs, sharePartPath } from './shareDestination';
import { FileShareLedger, isSidekickTemporaryName, recordCreatedFrom, sweepLedger, type SweepScope } from './shareLedger';

/**
 * The ownership rule: nothing is deleted because of its name. The sweep deletes a file only when the
 * ledger recorded **that file** — its exact path, device, inode and birth time — being created by
 * this app, **inside the one folder the sweep is scoped to**, under one of Sidekick's own two names.
 * Every other case leaves the file exactly as it was and reports it.
 */

const offerId = 's-Q3v9aP0kT7mR2xW8yB4nZc';
// realpath: on macOS tmpdir() is under /var, a symlink to /private/var; the sweep compares real paths.
const tmp = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'share-ledger-')));
const ledgerIn = (): FileShareLedger => new FileShareLedger(join(tmp(), 'share-temporary-files.json'));
const scoped = (d: string): SweepScope => ({ allowedParents: [d] });

/** A partial created the way `pullShareWith` creates one: intent, exclusive create, identity. */
async function ours(ledger: FileShareLedger, d: string, content = 'ours', maxBytes = 1000): Promise<string> {
  const p = sharePartPath(d, offerId, newPartNonce());
  await ledger.recordIntent(p);
  writeFileSync(p, content, { flag: 'wx' });
  await recordCreatedFrom(ledger, p, maxBytes);
  return p;
}

// ---- the positive control: without it, every "left untouched" below could be a sweep that does nothing

test('control: a recorded, identity-matched partial inside the scope is deleted and forgotten', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 1);
  assert.deepEqual(r.left, []);
  assert.equal(existsSync(p), false);
  assert.deepEqual(await ledger.entries(), []);
});

test('with no scope (every run that is not a version-2 development run) the sweep deletes nothing and keeps the entry', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  const r = await sweepLedger(ledger);
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'outside-scope' }]);
  assert.equal(r.kept, 1);
  assert.equal(readFileSync(p, 'utf8'), 'ours');
  assert.equal((await ledger.entries()).length, 1, 'kept, so a run with that scope can still prove it');
});

// ---- the four the task names ------------------------------------------------------------------

test('a crafted entry pointing OUTSIDE the scratch folder is left untouched — even with a matching identity and our name', async () => {
  const scratch = tmp();
  const elsewhere = tmp();
  const ledger = ledgerIn();
  // A genuinely ours-shaped file with its real identity recorded — the strongest possible forgery.
  const p = await ours(ledger, elsewhere, 'a file somewhere the sweep must never reach');
  const r = await sweepLedger(ledger, scoped(scratch));
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'outside-scope' }]);
  assert.equal(readFileSync(p, 'utf8'), 'a file somewhere the sweep must never reach');
});

test('a crafted entry that climbs out with `..` is refused as an unclean path', async () => {
  const scratch = tmp();
  const victimDir = tmp();
  const victim = join(victimDir, `.${offerId}.${'A'.repeat(22)}.sidekick-share.part`);
  writeFileSync(victim, 'victim');
  const st = lstatSync(victim);
  const ledger = ledgerIn();
  const crafted = `${scratch}/../${victimDir.split('/').pop()}/${victim.split('/').pop()}`;
  await ledger.recordCreated(crafted, { dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs, maxBytes: 1000 });
  const r = await sweepLedger(ledger, scoped(scratch));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'not-a-clean-path');
  assert.equal(readFileSync(victim, 'utf8'), 'victim');
});

test('a scope folder swapped for a symlink is not followed: the file behind it survives', async () => {
  const base = tmp();
  const scratch = join(base, 'dev-share-receive');
  mkdirSync(scratch);
  const ledger = ledgerIn();
  const p = await ours(ledger, scratch, 'ours, but reached through a link now');
  // Move the real folder away and put a link to it where the scratch folder was.
  const moved = join(base, 'moved');
  renameSync(scratch, moved);
  symlinkSync(moved, scratch);
  const r = await sweepLedger(ledger, scoped(scratch));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'parent-not-a-real-folder');
  assert.equal(readFileSync(join(moved, p.split('/').pop()!), 'utf8'), 'ours, but reached through a link now');
});

test('a REPLACED file (same name, different inode) is left untouched', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  writeFileSync(join(d, 'keep'), 'placeholder'); // holds an inode so the replacement cannot reuse ours
  unlinkSync(p);
  writeFileSync(p, 'a different file with the same name');
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'identity-mismatch' }]);
  assert.equal(readFileSync(p, 'utf8'), 'a different file with the same name');
});

test('a SYMLINK at a recorded path is never followed or deleted', async () => {
  const d = tmp();
  const outside = join(tmp(), 'target');
  writeFileSync(outside, 'must survive');
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  unlinkSync(p);
  symlinkSync(outside, p);
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'not-a-regular-file');
  assert.equal(lstatSync(p).isSymbolicLink(), true);
  assert.equal(readFileSync(outside, 'utf8'), 'must survive');
});

test('a LOOKALIKE never recorded is invisible to the sweep', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const lookalike = join(d, `.${offerId}.${'A'.repeat(22)}.sidekick-share.part`);
  writeFileSync(lookalike, 'not ours');
  const probeLike = join(d, `.sidekick-link-probe-${'A'.repeat(22)}`);
  writeFileSync(probeLike, '');
  const r = await sweepLedger(ledger, scoped(d));
  assert.deepEqual(r, { deleted: 0, gone: 0, left: [], kept: 0 });
  assert.equal(readFileSync(lookalike, 'utf8'), 'not ours');
  assert.equal(existsSync(probeLike), true);
});

test('a LOOKALIKE entry naming a file that is not Sidekick-shaped is left, even with its real identity', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = join(d, 'holiday.jpg');
  writeFileSync(p, 'a person’s photo');
  const st = lstatSync(p);
  await ledger.recordCreated(p, { dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs, maxBytes: 1_000_000 });
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'not-a-sidekick-name');
  assert.equal(readFileSync(p, 'utf8'), 'a person’s photo');
});

// ---- the additional checks ----------------------------------------------------------------------

test('an entry with no recorded identity (a crash before creation) deletes nothing — even a file now at that path', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = sharePartPath(d, offerId, newPartNonce());
  await ledger.recordIntent(p);
  writeFileSync(p, 'somebody else’s file');
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'no-recorded-identity');
  assert.equal(readFileSync(p, 'utf8'), 'somebody else’s file');
});

test('a birth time that differs from the record is a different file, whatever its inode says', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  const e = (await ledger.entries())[0]!;
  await ledger.recordCreated(p, { dev: e.dev!, ino: e.ino!, birthtimeMs: e.birthtimeMs! - 5000, maxBytes: 1000 });
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'identity-mismatch');
  assert.equal(existsSync(p), true);
});

test('a file larger than it could ever legitimately be is left', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d, 'x'.repeat(20), 10);
  const r = await sweepLedger(ledger, scoped(d));
  assert.equal(r.deleted, 0);
  assert.equal(r.left[0]!.why, 'larger-than-recorded');
  assert.equal(existsSync(p), true);
});

test('an entry whose file is already gone is forgotten, and nothing is deleted for it', async () => {
  const d = tmp();
  const ledger = ledgerIn();
  const p = await ours(ledger, d);
  unlinkSync(p);
  assert.deepEqual(await sweepLedger(ledger, scoped(d)), { deleted: 0, gone: 1, left: [], kept: 0 });
  assert.deepEqual(await ledger.entries(), []);
});

test('the name rule accepts exactly the two shapes Sidekick creates', () => {
  assert.equal(isSidekickTemporaryName(`.${offerId}.${'A'.repeat(22)}.sidekick-share.part`), true);
  assert.equal(isSidekickTemporaryName(`.sidekick-link-probe-${'A'.repeat(22)}`), true);
  assert.equal(isSidekickTemporaryName(`.sidekick-link-probe-${'A'.repeat(22)}-2`), true);
  for (const bad of ['holiday.jpg', 'holiday.jpg.part', `${offerId}.${'A'.repeat(22)}.sidekick-share.part`,
    `.sidekick-link-probe-${'A'.repeat(21)}`, `.sidekick-link-probe-${'A'.repeat(22)}-3`, `.${offerId}.x.sidekick-share.part`]) {
    assert.equal(isSidekickTemporaryName(bad), false, bad);
  }
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
  assert.deepEqual(await sweepLedger(stuck), { deleted: 0, gone: 0, left: (await stuck.entries()).map((x) => ({ path: x.path, why: 'outside-scope' })), kept: 2 },
    'unscoped, the probes are reported and kept');
  const r = await sweepLedger(stuck, scoped(e));
  assert.equal(r.deleted, 2, 'scoped to their folder, both are proven and deleted');
});
