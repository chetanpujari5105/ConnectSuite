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

export type IdentityChoice =
  | { use: 'stored' }
  | { use: 'create' }
  | { use: 'blocked'; reason: string };

/**
 * Which identity a launch should use, given what is on disk and what this build could open.
 *
 * **Defect 207: only an empty folder may be filled.** Anything on disk that this build cannot use is
 * kept exactly as it is and reported — never replaced. The old rule regenerated in every unusable case,
 * which was right for a half-written pair and wrong for the case that matters: a key sealed by a
 * *different build* (a development copy and a packaged copy on one profile, or an update that changes
 * the signature) is perfectly good for the build that sealed it, and replacing it destroyed the pairing
 * of that build and every phone that trusted it. Starting over is the person's act (`startOver`).
 *
 * The mismatched pair is still caught here — it is the case this function was first written for: every
 * `tls.connect` throws `KEY_VALUES_MISMATCH` synchronously, so it can never be "used" — but it is now
 * reported rather than silently replaced.
 */
export function chooseIdentity(stored: {
  certExists: boolean;
  keyExists: boolean;
  certPem: string | null;
  keyPem: string | null;
  sealingAvailable: boolean;
}): IdentityChoice {
  const { certExists, keyExists, certPem, keyPem, sealingAvailable } = stored;
  if (!certExists && !keyExists) return { use: 'create' };
  if (keyExists && !sealingAvailable) {
    return { use: 'blocked', reason: 'this Mac’s keychain encryption is not available to this copy of Sidekick, so it cannot open the stored key' };
  }
  if (!keyExists) return { use: 'blocked', reason: 'the stored private key is missing (the certificate is still there)' };
  if (!certExists || certPem === null) return { use: 'blocked', reason: 'the stored certificate is missing or unreadable (the key is still there)' };
  if (keyPem === null) {
    return { use: 'blocked', reason: 'this copy of Sidekick cannot open the stored private key — it was sealed by a different build' };
  }
  if (!keyMatchesCert(certPem, keyPem)) {
    return { use: 'blocked', reason: 'the stored certificate and private key are from different identities' };
  }
  return { use: 'stored' };
}
