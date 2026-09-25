import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { newPartNonce, sharePartPath } from './shareDestination';
import { FileShareLedger, parentIdentityOf, recordCreatedFrom, recordIntentFrom, sweepLedger, type LedgerEntry, type SweepScope } from './shareLedger';

/**
 * Runbook §11 — the production sweep, scoped by the **parent folder each entry proves**, never by the
 * receive-folder setting. Every case is adversarial and leaves the file it could have deleted in place;
 * the positive control first shows that the same sweep does delete a proven partial, so "left
 * untouched" below is a decision and not a sweep that does nothing.
 */

const offerId = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const tmp = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'share-parent-')));
const ledgerIn = (): FileShareLedger => new FileShareLedger(join(tmp(), 'share-temporary-files.json'));
/** What `main.ts` passes when `share.ask` is active: no explicit folder, only what entries prove. */
const production: SweepScope = { allowedParents: [], byRecordedParent: true };

/** A partial created the way the pull creates one (bulk.ts): intent with parent, exclusive create, identity. */
async function partial(ledger: FileShareLedger, folder: string, content = 'partial', maxBytes = 1000): Promise<string> {
  const p = sharePartPath(folder, offerId, newPartNonce());
  await recordIntentFrom(ledger, p);
  writeFileSync(p, content, { flag: 'wx' });
  await recordCreatedFrom(ledger, p, maxBytes);
  return p;
}

async function rewrite(ledger: FileShareLedger, change: (e: LedgerEntry) => LedgerEntry): Promise<void> {
  const file = (ledger as unknown as { file: string }).file;
  const entries = JSON.parse(readFileSync(file, 'utf8')) as LedgerEntry[];
  writeFileSync(file, JSON.stringify(entries.map(change)));
}

test('the intent records the parent folder identity before the file exists, and the create keeps it', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  const p = sharePartPath(folder, offerId, newPartNonce());
  await recordIntentFrom(ledger, p);
  const [intent] = await ledger.entries();
  assert.equal(intent!.parent?.real, folder);
  assert.equal(existsSync(p), false, 'recorded before creation');
  writeFileSync(p, 'x', { flag: 'wx' });
  await recordCreatedFrom(ledger, p, 10);
  const [created] = await ledger.entries();
  assert.deepEqual(created!.parent, intent!.parent);
  assert.equal(typeof created!.ino, 'number');
});

test('control: production scope deletes a partial whose parent and own identity both still match', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 1);
  assert.deepEqual(r.left, []);
  assert.equal(existsSync(p), false);
  assert.deepEqual(await ledger.entries(), []);
});

test('outside production scope (version 1, or the development gate) the same entry is kept and its file untouched', async () => {
  const folder = tmp();
  const scratch = tmp();
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  for (const scope of [{ allowedParents: [] }, { allowedParents: [scratch] }] as SweepScope[]) {
    const r = await sweepLedger(ledger, scope);
    assert.deepEqual(r.left, [{ path: p, why: 'outside-scope' }]);
    assert.equal(r.kept, 1);
  }
  assert.equal(readFileSync(p, 'utf8'), 'partial');
});

test('folder replacement: the receive folder moved away and a new one made at the same path — nothing deleted in either', async () => {
  const root = tmp();
  const folder = join(root, 'Sidekick');
  mkdirSync(folder);
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  renameSync(folder, join(root, 'Sidekick-moved'));
  mkdirSync(folder);
  // Somebody's file at exactly the recorded name, in the new folder.
  writeFileSync(p, 'a stranger’s bytes');
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'parent-not-proven' }]);
  assert.equal(r.kept, 1, 'kept in the ledger: a folder that cannot be proven may prove itself later');
  assert.equal(readFileSync(p, 'utf8'), 'a stranger’s bytes');
  assert.equal(readFileSync(join(root, 'Sidekick-moved', basename(p)), 'utf8'), 'partial', 'the moved original is untouched too');
});

test('the parent swapped for a symlink to where the real partial now lives — the link is never followed', async () => {
  const root = tmp();
  const folder = join(root, 'Sidekick');
  mkdirSync(folder);
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  renameSync(folder, join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), folder);
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'parent-not-proven' }]);
  assert.equal(existsSync(join(root, 'elsewhere', basename(p))), true);
});

test('the file itself swapped for a symlink to a person’s file — neither the link nor its target is deleted', async () => {
  const folder = tmp();
  const personal = join(tmp(), 'tax-return.pdf');
  writeFileSync(personal, 'personal');
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  unlinkSync(p);
  symlinkSync(personal, p);
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'not-a-regular-file' }]);
  assert.equal(readFileSync(personal, 'utf8'), 'personal');
});

test('inode reuse: the partial deleted by someone else and a new file made at its name — left, even with a matching inode', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  unlinkSync(p);
  writeFileSync(p, 'new owner');
  // Strongest form: pretend the filesystem handed the new file our old device AND inode. Birth time differs.
  const { dev, ino } = (await import('node:fs')).lstatSync(p);
  await rewrite(ledger, (e) => ({ ...e, dev, ino }));
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.left, [{ path: p, why: 'identity-mismatch' }]);
  assert.equal(readFileSync(p, 'utf8'), 'new owner');
});

test('a changed receive-folder setting widens nothing: the old folder’s entry is still proven, a forged one in the new folder is not', async () => {
  const oldFolder = tmp();
  const newFolder = tmp();
  const ledger = ledgerIn();
  const old = await partial(ledger, oldFolder);
  // A lookalike in the folder the setting now names, with an entry forged to carry the OLD folder's identity.
  const forged = sharePartPath(newFolder, offerId, newPartNonce());
  writeFileSync(forged, 'not ours');
  const oldEntry = (await ledger.entries()).find((e) => e.path === old)!;
  const st = (await import('node:fs')).lstatSync(forged);
  await ledger.recordCreated(forged, { dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs, maxBytes: 1000 });
  await rewrite(ledger, (e) => (e.path === forged ? { ...e, parent: oldEntry.parent } : e));
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 1, 'only the entry whose own parent proves itself');
  assert.equal(existsSync(old), false);
  assert.deepEqual(r.left, [{ path: forged, why: 'parent-not-proven' }]);
  assert.equal(readFileSync(forged, 'utf8'), 'not ours');
});

test('a remounted volume (different device for the same path) is not proven', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  await rewrite(ledger, (e) => ({ ...e, parent: { ...e.parent!, dev: e.parent!.dev + 1 } }));
  const r = await sweepLedger(ledger, production);
  assert.deepEqual(r.left, [{ path: p, why: 'parent-not-proven' }]);
  assert.equal(existsSync(p), true);
});

test('interrupted saves: a crash before the create deletes nothing; after it the partial is cleaned; one that grew is left', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  // 1. Intent recorded, crash before the exclusive create; then somebody's file appears at that name.
  const early = sharePartPath(folder, offerId, newPartNonce());
  await recordIntentFrom(ledger, early);
  writeFileSync(early, 'somebody else');
  // 2. Created and recorded, crash mid-write: a short partial.
  const mid = await partial(ledger, folder, 'half', 1000);
  // 3. A recorded partial that now holds more than it ever could.
  const grown = await partial(ledger, folder, 'x', 4);
  writeFileSync(grown, 'x'.repeat(50));
  const r = await sweepLedger(ledger, production);
  assert.equal(r.deleted, 1);
  assert.equal(existsSync(mid), false, 'the interrupted partial is cleaned');
  assert.deepEqual(new Set(r.left.map((l) => `${basename(l.path)}:${l.why}`)),
    new Set([`${basename(early)}:no-recorded-identity`, `${basename(grown)}:larger-than-recorded`]));
  assert.equal(readFileSync(early, 'utf8'), 'somebody else');
  assert.equal(readFileSync(grown, 'utf8').length, 50);
});

test('an entry written before §11 (no parent recorded) is never proven by production scope', async () => {
  const folder = tmp();
  const ledger = ledgerIn();
  const p = await partial(ledger, folder);
  await rewrite(ledger, ({ parent: _drop, ...e }) => e);
  const r = await sweepLedger(ledger, production);
  assert.deepEqual(r.left, [{ path: p, why: 'parent-not-proven' }]);
  assert.equal(existsSync(p), true);
});

test('an explicit scope folder replaced since the entry was recorded is not proven either (the scratch path)', async () => {
  const root = tmp();
  const scratch = join(root, 'dev-share-receive');
  mkdirSync(scratch);
  const ledger = ledgerIn();
  const p = await partial(ledger, scratch);
  renameSync(scratch, join(root, 'old'));
  mkdirSync(scratch);
  writeFileSync(p, 'lookalike');
  const r = await sweepLedger(ledger, { allowedParents: [scratch] });
  assert.deepEqual(r.left, [{ path: p, why: 'parent-not-proven' }]);
  assert.equal(readFileSync(p, 'utf8'), 'lookalike');
});

test('a parent that is a symlink has no identity at all — the link is never followed, even to a real folder', async () => {
  const root = tmp();
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'link'));
  assert.notEqual(await parentIdentityOf(join(root, 'real')), null, 'control: the real folder has one');
  assert.equal(await parentIdentityOf(join(root, 'link')), null);
  // And so a partial "created" through the link is recorded with no parent, which production never proves.
  const ledger = ledgerIn();
  const p = await partial(ledger, join(root, 'link'));
  assert.equal((await ledger.entries())[0]!.parent, undefined);
  assert.deepEqual((await sweepLedger(ledger, production)).left, [{ path: p, why: 'parent-not-proven' }]);
});
