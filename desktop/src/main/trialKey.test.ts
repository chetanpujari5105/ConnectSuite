import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { assembleToken, encodePayload, signingInput, trialKeyUsable, verifyTrialToken } from '../shared/trial';
import { TRIAL_PUBLIC_KEY } from './trialKey';

/**
 * The build's trial public key (2026-10-12). While it was `null` every build — packaged or not —
 * refused every token and never connected to the phone, so its presence is a release requirement,
 * not a nicety. The key is the public half only; the throwaway key below is made in memory and never
 * written, because a committed private key is what `scripts/check-no-private-keys.mjs` refuses.
 */

const SPKI_ED25519_PREFIX = 'MCowBQYDK2VwAyEA';

test('the build carries a public key: 60 characters of base64 Ed25519 SPKI', () => {
  assert.equal(typeof TRIAL_PUBLIC_KEY, 'string', 'TRIAL_PUBLIC_KEY is null — no token can ever be checked');
  const key = TRIAL_PUBLIC_KEY as string;
  assert.equal(key.length, 60);
  assert.ok(key.startsWith(SPKI_ED25519_PREFIX), `not an Ed25519 SPKI header: ${key.slice(0, 16)}`);
  assert.match(key, /^[A-Za-z0-9+/]+=?$/);
  assert.equal(createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'ed25519');
  assert.equal(trialKeyUsable(key), true);
});

test('the key is a public key, and it is the one the build checks against: a stranger-signed token is refused as a bad signature, not as no-key', () => {
  // Control for the no-key branch: the same shape check fails on null, so a pass above is about the key.
  assert.equal(trialKeyUsable(null), false);
  const stranger = generateKeyPairSync('ed25519');
  const body = encodePayload({ v: 1, id: 'Zq3k9Xb2LmT7wP1s', label: 'Stranger', notBefore: '2026-10-01T00:00:00.000Z', notAfter: '2026-11-01T00:00:00.000Z' });
  const token = assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), stranger.privateKey));
  assert.deepEqual(verifyTrialToken(token, TRIAL_PUBLIC_KEY), { kind: 'bad-signature' });
});
