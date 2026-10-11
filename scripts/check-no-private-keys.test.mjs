// Fixtures for scripts/check-no-private-keys.mjs. Every key here is generated IN MEMORY for the length
// of one test and never written anywhere — the fixtures need real key shapes, and a committed fixture
// key would be the very thing the guard exists to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { findPrivateKeys } from './check-no-private-keys.mjs';

const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });

test('an Ed25519 private key in PEM is refused', () => {
  const pem = ed.privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.ok(findPrivateKeys(pem, 'notes.txt').some((r) => /PEM private-key block/.test(r)));
});

test('the same key pasted without its header — base64 body, and hex — is refused', () => {
  const der = ed.privateKey.export({ type: 'pkcs8', format: 'der' });
  assert.ok(findPrivateKeys(`const k = '${der.toString('base64')}';`, 'src/x.ts').some((r) => /base64/.test(r)));
  assert.ok(findPrivateKeys(der.toString('hex'), 'x.txt').some((r) => /hex/.test(r)));
});

test('other private keys are refused: RSA PKCS#1, encrypted PKCS#8, a private JWK', () => {
  assert.ok(findPrivateKeys(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }), 'a').length > 0);
  const encrypted = rsa.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' });
  assert.ok(findPrivateKeys(encrypted, 'a').length > 0);
  const jwk = JSON.stringify(ed.privateKey.export({ format: 'jwk' }));
  assert.ok(findPrivateKeys(jwk, 'k.json').some((r) => /JWK/.test(r)));
});

test('a key-material file name is refused whatever it holds', () => {
  for (const name of ['trial/private.pem', 'release.jks', 'upload.keystore', 'x.p12', 'id_ed25519', 'sidekick.key']) {
    assert.ok(findPrivateKeys('', name).length > 0, name);
  }
});

test('control: the PUBLIC key passes — as PEM text, as the base64 the app embeds, and as a public JWK', () => {
  assert.deepEqual(findPrivateKeys(ed.publicKey.export({ type: 'spki', format: 'pem' }), 'docs/x.md'), []);
  assert.deepEqual(findPrivateKeys(ed.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), 'src/main/trialKey.ts'), []);
  assert.deepEqual(findPrivateKeys(JSON.stringify(ed.publicKey.export({ format: 'jwk' })), 'k.json'), []);
});

test('control: prose about private keys, and this guard and its own test, pass', () => {
  assert.deepEqual(findPrivateKeys('Keep the private key offline. Never commit a PRIVATE KEY file.', 'docs/a.md'), []);
  for (const own of ['check-no-private-keys.mjs', 'check-no-private-keys.test.mjs']) {
    const text = readFileSync(new URL(own, import.meta.url), 'utf8');
    assert.deepEqual(findPrivateKeys(text, `scripts/${own}`), [], own);
  }
});
