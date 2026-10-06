import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintBytes, isHex64, newNonceHex, newSecretHex, proof, transcript, verifyProof } from './pairingV2';

/**
 * Pairing v2's proofs on the Mac, against `docs/fixtures/pairing-v2-vectors.json` — computed by Python's
 * `hmac`/`hashlib`, an implementation that is neither app's. The phone's `PairingV2Test` reads the same
 * file, so the two apps agree byte for byte through a third party rather than through each other.
 */

interface Vector {
  name: string;
  secret: string;
  macFingerprint: string;
  phoneFingerprint: string;
  macNonce: string;
  phoneNonce: string;
  phoneTranscript: string;
  phoneProof: string;
  macTranscript: string;
  macProof: string;
}

const vectors: Vector[] = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'fixtures', 'pairing-v2-vectors.json'), 'utf8'),
).vectors;
const t = (v: Vector) => ({
  macFingerprint: v.macFingerprint,
  phoneFingerprint: v.phoneFingerprint,
  macNonce: v.macNonce,
  phoneNonce: v.phoneNonce,
});

test('transcripts and proofs match the independent vectors in both directions', () => {
  assert.equal(vectors.length, 3, 'control: the fixture holds vectors');
  for (const v of vectors) {
    for (const role of ['phone', 'mac'] as const) {
      assert.equal(transcript(role, t(v)).toString('hex'), v[`${role}Transcript`], `${v.name} ${role} transcript`);
      assert.equal(proof(v.secret, role, t(v)), v[`${role}Proof`], `${v.name} ${role} proof`);
      assert.equal(verifyProof(v.secret, role, t(v), v[`${role}Proof`]), true);
    }
  }
});

test('a proof fails for the other role, another secret, either certificate, either nonce, or a bad shape', () => {
  const [v, w] = vectors as [Vector, Vector];
  const ok = (secret: string, role: 'phone' | 'mac', inputs: ReturnType<typeof t>, candidate: unknown) =>
    verifyProof(secret, role, inputs, candidate);
  assert.equal(ok(v.secret, 'phone', t(v), v.phoneProof), true, 'control');
  assert.equal(ok(v.secret, 'mac', t(v), v.phoneProof), false, 'domain separation');
  assert.equal(ok(w.secret, 'phone', t(v), v.phoneProof), false, 'wrong secret');
  assert.equal(ok(v.secret, 'phone', { ...t(v), phoneFingerprint: w.phoneFingerprint }, v.phoneProof), false, 'relayed: another phone certificate');
  assert.equal(ok(v.secret, 'phone', { ...t(v), macFingerprint: w.macFingerprint }, v.phoneProof), false, 'another Mac certificate');
  assert.equal(ok(v.secret, 'phone', { ...t(v), macNonce: w.macNonce }, v.phoneProof), false, 'altered Mac nonce');
  assert.equal(ok(v.secret, 'phone', { ...t(v), phoneNonce: w.phoneNonce }, v.phoneProof), false, 'altered phone nonce');
  assert.equal(ok(v.secret, 'phone', t(v), v.phoneProof.toUpperCase()), false, 'uppercase is not the encoding');
  assert.equal(ok(v.secret, 'phone', t(v), v.phoneProof.slice(2)), false, 'truncated');
  assert.equal(ok(v.secret, 'phone', t(v), undefined), false, 'missing');
  assert.equal(ok('zz', 'phone', t(v), v.phoneProof), false, 'a malformed secret is false, not a throw');
});

test('fresh secrets and nonces are 32 CSPRNG bytes in the wire encoding, and never repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = newSecretHex();
    const n = newNonceHex();
    assert.ok(isHex64(s) && isHex64(n));
    assert.ok(!seen.has(s) && !seen.has(n));
    seen.add(s).add(n);
  }
  assert.equal(fingerprintBytes('AB:'.repeat(31) + 'AB')?.length, 32);
  assert.equal(fingerprintBytes('AB:CD'), null);
});
