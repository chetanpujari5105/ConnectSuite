import { app, safeStorage } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { chooseIdentity } from './identityPair';
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
 * the platform has no encryption available we refuse to store the key in plaintext and generate a
 * fresh identity each launch instead, which fails loudly (the phone rejects the new fingerprint)
 * rather than quietly leaving a private key on disk.
 */
export function loadIdentity(): Identity {
  const dir = join(app.getPath('userData'), 'identity');
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.enc');

  const choice = chooseIdentity(readStored(certPath, keyPath));
  if (choice.use === 'stored') {
    const certPem = readFileSync(certPath, 'utf8');
    const keyPem = safeStorage.decryptString(readFileSync(keyPath));
    const fingerprint = fingerprintOf(certPem);
    // The success case is logged at the same volume as the failure case. A silent happy path is
    // why a mismatched pair sat on this disk for a day while every connect attempt failed: the
    // only identity lines ever written were on paths that were not being taken.
    log.info('identity', `Stored identity ${fingerprint.slice(0, 23)}… loaded`);
    return { certPem, keyPem, fingerprint, deviceName: macName() };
  }

  log.warn('identity', `Regenerating identity: ${choice.reason}`);
  const created = generate();

  // Both halves reach the disk or neither does. Writing the certificate while the key stays in
  // memory leaves a pair that can never be used: the next launch reads a new certificate beside
  // an old key, decrypts that key without error, and every tls.connect then throws
  // KEY_VALUES_MISMATCH *synchronously* — aborting discovery before a socket opens, so no
  // address and no cable can help. That is exactly what happened here on 2026-09-07.
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath, safeStorage.encryptString(created.keyPem));
    writeFileSync(certPath, created.certPem);
    log.info('identity', `New identity ${created.fingerprint.slice(0, 23)}… stored; re-pair this Mac`);
  } else {
    // Leave nothing behind rather than a certificate with no key to match it.
    rmSync(certPath, { force: true });
    rmSync(keyPath, { force: true });
    log.warn(
      'identity',
      `New identity ${created.fingerprint.slice(0, 23)}… kept in memory only — safeStorage is ` +
        'unavailable, so nothing was written and this Mac must be re-paired every launch until it returns',
    );
  }
  return created;
}

/**
 * What is actually readable on disk, as two independent questions.
 *
 * Each half is read in its own try: a certificate that survives a key that does not is the state
 * the caller has to be able to see, and a single try/catch around both would collapse it into
 * "nothing stored" and lose the reason.
 */
function readStored(certPath: string, keyPath: string): { certPem: string | null; keyPem: string | null } {
  let certPem: string | null = null;
  let keyPem: string | null = null;
  try {
    if (existsSync(certPath)) certPem = readFileSync(certPath, 'utf8');
  } catch (error) {
    log.warn('identity', `Stored certificate unreadable: ${String(error)}`);
  }
  try {
    if (existsSync(keyPath) && safeStorage.isEncryptionAvailable()) {
      keyPem = safeStorage.decryptString(readFileSync(keyPath));
    }
  } catch (error) {
    log.warn('identity', `Stored private key undecryptable: ${String(error)}`);
  }
  return { certPem, keyPem };
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
