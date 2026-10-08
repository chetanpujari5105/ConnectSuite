import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import forge from 'node-forge';
import { chooseIdentity, keyMatchesCert } from './identityPair';

/** Mint a throwaway self-signed identity, the same shape `identity.ts` generates. */
function mint(name: string): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: name }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const a = mint('Mac-A');
const b = mint('Mac-B');

describe('keyMatchesCert', () => {
  // The positive control. Without it a matcher that always returns false would pass every
  // negative case below and read as a working guard.
  it('accepts a key that belongs to the certificate', () => {
    assert.equal(keyMatchesCert(a.certPem, a.keyPem), true);
  });

  it("rejects a key from a different identity", () => {
    assert.equal(keyMatchesCert(a.certPem, b.keyPem), false);
  });

  it('rejects garbage instead of throwing', () => {
    assert.equal(keyMatchesCert('not a certificate', a.keyPem), false);
    assert.equal(keyMatchesCert(a.certPem, 'not a key'), false);
  });
});

describe('chooseIdentity', () => {
  const on = (certPem: string | null, keyPem: string | null, over: Partial<{ certExists: boolean; keyExists: boolean; sealingAvailable: boolean }> = {}) =>
    chooseIdentity({ certExists: certPem !== null, keyExists: keyPem !== null, certPem, keyPem, sealingAvailable: true, ...over });

  it('uses a stored identity whose halves match', () => {
    assert.deepEqual(on(a.certPem, a.keyPem), { use: 'stored' });
  });

  it('creates only into an empty folder', () => {
    assert.deepEqual(on(null, null), { use: 'create' });
  });

  // Defect: a certificate written on 2026-09-07 beside a key written on 2026-08-24. Both readable,
  // both valid, from different identities — and every tls.connect threw KEY_VALUES_MISMATCH
  // synchronously. Still caught; since defect 207 it is reported rather than replaced.
  it('blocks, rather than replaces, halves from different identities', () => {
    const choice = on(a.certPem, b.keyPem);
    assert.equal(choice.use, 'blocked');
    assert.match((choice as { reason: string }).reason, /different identities/);
  });

  // Defect 207: the key file is there and this build cannot open it — another build sealed it.
  it('blocks when the key exists but this build cannot open it', () => {
    const choice = on(a.certPem, null, { keyExists: true });
    assert.equal(choice.use, 'blocked');
    assert.match((choice as { reason: string }).reason, /different build/);
  });

  it('blocks when the key exists and encryption is unavailable', () => {
    const choice = on(a.certPem, null, { keyExists: true, sealingAvailable: false });
    assert.equal(choice.use, 'blocked');
    assert.match((choice as { reason: string }).reason, /not available/);
  });

  it('blocks when only the key survived', () => {
    const choice = on(null, a.keyPem);
    assert.equal(choice.use, 'blocked');
    assert.match((choice as { reason: string }).reason, /certificate/);
  });

  it('blocks when only the certificate survived', () => {
    const choice = on(a.certPem, null);
    assert.equal(choice.use, 'blocked');
    assert.match((choice as { reason: string }).reason, /private key is missing/);
  });
});
