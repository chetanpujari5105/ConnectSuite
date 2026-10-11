import { app, safeStorage } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { loadStoredIdentity, startOver, type SealingBox } from './identityStore';
import { log } from './logger';

export interface Identity {
  /** PEM certificate presented to the phone. */
  certPem: string;
  /** PEM private key, in memory only. */
  keyPem: string;
  /** SHA-256 over the DER certificate, colon-separated uppercase hex. */
  fingerprint: string;
  deviceName: string;
}

/**
 * This Mac's TLS identity, generated once and reused forever.
 *
 * The private key is written through Electron's safeStorage, which on macOS wraps it with a key
 * held in the login Keychain — so a copy of the app-support folder is not a usable identity. If
 * the platform has no encryption available and nothing is stored, a fresh identity is used for this
 * launch only and nothing is written, rather than leaving a private key on disk in plaintext.
 *
 * **Defect 207: a stored identity this build cannot use is never replaced.** The result is `blocked`
 * with nothing written; `main.ts` asks the person, and only their *Start over* (`startOverIdentity`)
 * moves the old files aside and makes a new key. See `identityStore.ts`.
 */
export type IdentityResult = { kind: 'ready'; identity: Identity } | { kind: 'blocked'; reason: string; dir: string };

/** Exported for the beta trial's clock mark (`trial.ts`), which seals with the same box. */
export const SAFE_STORAGE: SealingBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  seal: (text) => safeStorage.encryptString(text),
  open: (data) => safeStorage.decryptString(data),
};

export function identityDir(): string {
  return join(app.getPath('userData'), 'identity');
}

export function loadIdentity(): IdentityResult {
  const dir = identityDir();
  const loaded = loadStoredIdentity(dir, SAFE_STORAGE, generate);
  if (loaded.kind === 'stored') {
    const fingerprint = fingerprintOf(loaded.certPem);
    // The success case is logged at the same volume as the failure case. A silent happy path is
    // why a mismatched pair sat on this disk for a day while every connect attempt failed: the
    // only identity lines ever written were on paths that were not being taken.
    log.info('identity', `Stored identity ${fingerprint.slice(0, 23)}… loaded`);
    return { kind: 'ready', identity: { certPem: loaded.certPem, keyPem: loaded.keyPem, fingerprint, deviceName: macName() } };
  }
  if (loaded.kind === 'blocked') {
    log.warn('identity', `Stored identity NOT usable by this build, and left untouched (nothing written): ${loaded.reason}` +
      (loaded.openError ? ` — ${loaded.openError}` : ''));
    return { kind: 'blocked', reason: loaded.reason, dir };
  }
  const created = loaded.identity;
  if (loaded.persisted) {
    log.info('identity', `New identity ${created.fingerprint.slice(0, 23)}… stored (the folder was empty)`);
  } else {
    log.warn(
      'identity',
      `New identity ${created.fingerprint.slice(0, 23)}… kept in memory only — safeStorage is ` +
        'unavailable, so nothing was written and this Mac must be re-paired every launch until it returns',
    );
  }
  return { kind: 'ready', identity: created };
}

/** The person chose *Start over* on the blocked prompt. The old files are kept in `retired-…/`. */
export function startOverIdentity(): Identity {
  const result = startOver(identityDir(), SAFE_STORAGE, generate, new Date());
  log.warn('identity', `Started over at the person's request: old identity kept in ${result.retiredTo}; ` +
    `new identity ${result.identity.fingerprint.slice(0, 23)}… ${result.persisted ? 'stored' : 'kept in memory only'}`);
  return result.identity;
}

function generate(): Identity {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `00${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20);

  const attrs = [
    { name: 'commonName', value: macName() },
    { name: 'organizationName', value: 'Sidekick' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  return {
    certPem,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    fingerprint: fingerprintOf(certPem),
    deviceName: macName(),
  };
}

/** Fingerprints are taken over the DER bytes, which is what the phone's Keystore hashes too. */
export function fingerprintOf(certPem: string): string {
  const der = forge.util.createBuffer(
    forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes(),
  );
  const digest = createHash('sha256').update(Buffer.from(der.getBytes(), 'binary')).digest('hex');
  return (digest.match(/../g) ?? []).join(':').toUpperCase();
}

export function fingerprintOfDer(der: Buffer): string {
  const digest = createHash('sha256').update(der).digest('hex');
  return (digest.match(/../g) ?? []).join(':').toUpperCase();
}

function macName(): string {
  const host = hostname().replace(/\.local$/, '');
  return host || `${userInfo().username}'s Mac`;
}
