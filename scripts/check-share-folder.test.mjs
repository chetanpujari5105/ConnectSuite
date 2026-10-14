// Fixtures for scripts/check-share-folder.mjs. Keys and tokens are made IN MEMORY for one test and handed to
// the pure `checkShareEntries`; the folder fixtures on disk hold only harmless bytes and a dummy file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkShareEntries, checkShareFolder } from './check-share-folder.mjs';
import { assembleToken, encodePayload, signingInput } from '../desktop/src/shared/trial.ts';

const entry = (path, text) => ({ path, data: Buffer.from(text) });
const ed = generateKeyPairSync('ed25519');
const body = encodePayload({ v: 1, id: 'ShareFolderFixture1', label: 'Fixture', notBefore: '2026-10-01T00:00:00.000Z', notAfter: '2026-11-01T00:00:00.000Z' });
const token = assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), ed.privateKey));

test('control: a folder of ordinary files passes, and the README naming the prefix is fine', () => {
  const r = checkShareEntries([entry('README.txt', 'The token starts with SIDEKICK-TRIAL-1 — copy that.'), entry('Sidekick-2.0.1-arm64.dmg', 'binary')]);
  assert.deepEqual(r.refusals, []);
  assert.equal(r.files, 2);
});

test('a *.sidekick-token file is refused by its name, whatever it holds', () => {
  const r = checkShareEntries([entry('chetan-owner.sidekick-token', 'anything'), entry('Tester.SIDEKICK-TOKEN', '')]);
  assert.equal(r.refusals.length, 2);
  assert.match(r.refusals[0].reasons[0], /beta token file/);
});

test('a complete token pasted into a text file is refused; a cut-off one is not a token', () => {
  assert.equal(checkShareEntries([entry('notes.txt', `hi\n${token}\nbye`)]).refusals.length, 1);
  assert.equal(checkShareEntries([entry('notes.txt', token.slice(0, -10))]).refusals.length, 0, 'control: the shape, not the prefix, is what counts');
});

test('a public CA bundle named .pem is not a private key (the first real run refused certifi by name)', () => {
  assert.equal(checkShareEntries([entry('certifi/cacert.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')]).refusals.length, 0);
});

test('a private key is refused, through the commit guard’s own definition', () => {
  const pem = ed.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const r = checkShareEntries([entry('key-backup.txt', pem)]);
  assert.equal(r.refusals.length, 1);
  assert.match(r.refusals[0].reasons.join(' '), /PEM private-key block/);
  const pub = ed.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.equal(checkShareEntries([entry('public.txt', pub)]).refusals.length, 0, 'control: a public key is fine');
});

test('the folder walk reaches subfolders, skips and counts links, and the CLI exits 1 on a token file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-'));
  mkdirSync(join(dir, 'Intel-untested'));
  writeFileSync(join(dir, 'README.txt'), 'read me');
  writeFileSync(join(dir, 'Intel-untested', 'NOTE.txt'), 'note');
  assert.deepEqual(checkShareFolder(dir).refusals, [], 'control: clean');
  assert.equal(checkShareFolder(dir).files, 2);
  writeFileSync(join(dir, 'Intel-untested', 'someone.sidekick-token'), 'dummy, not a token');
  symlinkSync('/etc/hosts', join(dir, 'outside'));
  const r = checkShareFolder(dir);
  assert.deepEqual(r.refusals.map((f) => f.path), ['Intel-untested/someone.sidekick-token']);
  assert.equal(r.linksSkipped, 1, 'the link is counted, not followed');
  let code = 0;
  try { execFileSync('node', ['scripts/check-share-folder.mjs', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});

test('a missing or empty folder is "could not check", never clean', () => {
  const empty = mkdtempSync(join(tmpdir(), 'share-empty-'));
  for (const dir of [join(empty, 'nope'), empty]) {
    let code = 0;
    try { execFileSync('node', ['scripts/check-share-folder.mjs', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    assert.equal(code, 2, dir);
  }
});
