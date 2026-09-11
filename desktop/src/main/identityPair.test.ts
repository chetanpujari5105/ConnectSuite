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
  it('uses a stored identity whose halves match', () => {
    assert.deepEqual(chooseIdentity({ certPem: a.certPem, keyPem: a.keyPem }), { use: 'stored' });
  });

  // Defect: a certificate written on 2026-09-07 beside a key written on 2026-08-24. Both readable,
  // both valid, from different identities — and every tls.connect threw KEY_VALUES_MISMATCH
  // synchronously, aborting discovery before any socket opened.
  it('regenerates when the stored halves are from different identities', () => {
    const choice = chooseIdentity({ certPem: a.certPem, keyPem: b.keyPem });
    assert.equal(choice.use, 'regenerate');
    assert.match((choice as { reason: string }).reason, /different identities/);
  });

  it('regenerates when nothing is stored', () => {
    assert.equal(chooseIdentity({ certPem: null, keyPem: null }).use, 'regenerate');
  });

  it('regenerates when only the key survived', () => {
    const choice = chooseIdentity({ certPem: null, keyPem: a.keyPem });
    assert.equal(choice.use, 'regenerate');
    assert.match((choice as { reason: string }).reason, /certificate/);
  });

  it('regenerates when only the certificate survived', () => {
    const choice = chooseIdentity({ certPem: a.certPem, keyPem: null });
    assert.equal(choice.use, 'regenerate');
    assert.match((choice as { reason: string }).reason, /private key/);
  });
});
