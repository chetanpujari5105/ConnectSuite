/*
 * Defect 207 (a): a build that cannot open the stored Mac identity must never overwrite it.
 *
 * Runs the real `loadStoredIdentity` / `startOver` against real files in a temporary folder. The one
 * thing replaced is the sealing box — Electron's `safeStorage`, which cannot load under `node --test` —
 * and the replacement is the case that matters: a box that cannot open what another build sealed.
 * **Not reached here:** the native dialog in `main.ts` and the real Keychain; the isolated Electron run
 * recorded in `docs/testing.md` → *Defect 207* reaches both.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import forge from 'node-forge';
import { loadStoredIdentity, startOver, type SealingBox } from './identityStore';

function mint(name: string) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: name }]);
  cert.setIssuer([{ name: 'commonName', value: name }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  return { certPem, keyPem: forge.pki.privateKeyToPem(keys.privateKey), fingerprint: `FP-${name}`, deviceName: 'Mac' };
}

/** A box keyed by a label: what one build seals, a build with another label cannot open. */
function box(label: string, available = true): SealingBox {
  return {
    available: () => available,
    seal: (text) => Buffer.from(`${label}|${Buffer.from(text).toString('base64')}`),
    open: (data) => {
      const [l, body] = data.toString().split('|');
      if (l !== label) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return Buffer.from(body!, 'base64').toString();
    },
  };
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const A = mint('A');
let minted = 0;
const mintB = () => { minted += 1; return mint('B'); };

function folderSealedBy(label: string) {
  const dir = mkdtempSync(join(tmpdir(), 'identity-207-'));
  writeFileSync(join(dir, 'cert.pem'), A.certPem);
  writeFileSync(join(dir, 'key.enc'), box(label).seal(A.keyPem));
  return dir;
}

test('a stored identity this build can open is used, and nothing is written (control)', () => {
  const dir = folderSealedBy('dev');
  const before = [sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))];
  minted = 0;
  const loaded = loadStoredIdentity(dir, box('dev'), mintB);
  assert.equal(loaded.kind, 'stored');
  assert.equal(minted, 0);
  assert.deepEqual([sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))], before);
});

test('defect 207: a key sealed by another build is kept byte for byte, and no identity is minted', () => {
  const dir = folderSealedBy('dev');
  const before = [sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))];
  minted = 0;
  const loaded = loadStoredIdentity(dir, box('packaged'), mintB);
  assert.equal(loaded.kind, 'blocked', 'an undecryptable identity was replaced');
  assert.equal(minted, 0, 'a new identity was minted silently');
  assert.deepEqual([sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))], before, 'the stored identity changed');
  assert.deepEqual(readdirSync(dir).sort(), ['cert.pem', 'key.enc']);
  assert.match((loaded as { reason: string }).reason, /cannot open|could not open/);
});

test('a key on disk with encryption unavailable is kept — the old path deleted both files', () => {
  const dir = folderSealedBy('dev');
  const before = [sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))];
  const loaded = loadStoredIdentity(dir, box('dev', false), mintB);
  assert.equal(loaded.kind, 'blocked');
  assert.match((loaded as { reason: string }).reason, /encryption is not available/, 'the person is told the wrong cause');
  assert.ok(existsSync(join(dir, 'key.enc')) && existsSync(join(dir, 'cert.pem')));
  assert.deepEqual([sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))], before);
});

test('a mismatched pair and a lone half are kept and reported, never replaced', () => {
  const dir = folderSealedBy('dev');
  writeFileSync(join(dir, 'cert.pem'), mint('C').certPem);
  const before = sha(join(dir, 'cert.pem'));
  assert.equal(loadStoredIdentity(dir, box('dev'), mintB).kind, 'blocked');
  assert.equal(sha(join(dir, 'cert.pem')), before);

  const lone = mkdtempSync(join(tmpdir(), 'identity-207-'));
  writeFileSync(join(lone, 'cert.pem'), A.certPem);
  assert.equal(loadStoredIdentity(lone, box('dev'), mintB).kind, 'blocked');
  assert.deepEqual(readdirSync(lone), ['cert.pem']);
});

test('nothing stored: an identity is created and sealed (the first launch)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-207-'));
  minted = 0;
  const loaded = loadStoredIdentity(dir, box('dev'), mintB);
  assert.equal(loaded.kind, 'created');
  assert.equal(minted, 1);
  assert.equal(box('dev').open(readFileSync(join(dir, 'key.enc'))), (loaded as { identity: { keyPem: string } }).identity.keyPem);
});

test('nothing stored and no encryption: created in memory, nothing written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-207-'));
  const loaded = loadStoredIdentity(dir, box('dev', false), mintB);
  assert.equal(loaded.kind, 'created');
  assert.equal((loaded as { persisted: boolean }).persisted, false);
  assert.deepEqual(readdirSync(dir), []);
});

test('start over is the person’s act: the old files move aside intact, a new identity is sealed', () => {
  const dir = folderSealedBy('dev');
  const before = [sha(join(dir, 'cert.pem')), sha(join(dir, 'key.enc'))];
  const result = startOver(dir, box('packaged'), mintB, new Date('2026-10-08T14:40:37Z'));
  assert.ok(result.retiredTo.startsWith(join(dir, 'retired-')));
  assert.deepEqual([sha(join(result.retiredTo, 'cert.pem')), sha(join(result.retiredTo, 'key.enc'))], before,
    'the retired identity is not the one that was stored');
  assert.equal(box('packaged').open(readFileSync(join(dir, 'key.enc'))), result.identity.keyPem);
  // And the next launch of this build uses it.
  assert.equal(loadStoredIdentity(dir, box('packaged'), mintB).kind, 'stored');
});

test('the blocked prompt says nothing was changed, defaults to Quit, and states the cost of starting over', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { blockedPrompt } = require('./identityStore') as typeof import('./identityStore');
  const p = blockedPrompt('this copy of Sidekick cannot open the stored private key — it was sealed by a different build');
  assert.equal(p.buttons[p.defaultId], 'Quit Sidekick');
  assert.equal(p.cancelId, p.defaultId);
  assert.match(p.detail, /Nothing has been changed/);
  assert.match(p.detail, /pair .*again/);
  assert.match(p.detail, /kept/);
  assert.doesNotMatch(p.message + p.detail, /deleted|replaced/i);
  assert.deepEqual(p.buttons, ['Quit Sidekick', 'Show the Key’s Folder', 'Start Over with a New Key…']);
});
