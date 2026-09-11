import { X509Certificate, createPrivateKey } from 'node:crypto';

/**
 * Does this private key belong to this certificate?
 *
 * This is `X509_check_private_key` — the same test the TLS stack runs when it builds a secure
 * context, and the one whose failure it reports as `KEY_VALUES_MISMATCH`. It is *called* rather
 * than reimplemented so the rule has one home: a hand-rolled modulus comparison would be a second
 * expression of the same rule, and the two would eventually disagree with the stack that decides.
 */
export function keyMatchesCert(certPem: string, keyPem: string): boolean {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

export type IdentityChoice = { use: 'stored' } | { use: 'regenerate'; reason: string };

/**
 * Which identity a launch should use, given what was readable on disk.
 *
 * The case this exists for is the last one: a certificate and a key that are each perfectly
 * readable and belong to different identities. Nothing downstream can recover from it — every
 * `tls.connect` throws while building its context, synchronously, so the discovery loop aborts
 * before a single socket opens and neither Wi-Fi nor USB can help. It has to be caught here.
 */
export function chooseIdentity(stored: {
  certPem: string | null;
  keyPem: string | null;
}): IdentityChoice {
  const { certPem, keyPem } = stored;
  if (certPem === null && keyPem === null) return { use: 'regenerate', reason: 'no identity stored yet' };
  if (certPem === null) return { use: 'regenerate', reason: 'the stored certificate is missing or unreadable' };
  if (keyPem === null) return { use: 'regenerate', reason: 'the stored private key is missing or undecryptable' };
  if (!keyMatchesCert(certPem, keyPem)) {
    return {
      use: 'regenerate',
      reason: 'the stored certificate and private key are from different identities',
    };
  }
  return { use: 'stored' };
}
