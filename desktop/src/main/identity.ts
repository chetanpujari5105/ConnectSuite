import { app, safeStorage } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
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

  if (existsSync(certPath) && existsSync(keyPath) && safeStorage.isEncryptionAvailable()) {
    try {
      const certPem = readFileSync(certPath, 'utf8');
      const keyPem = safeStorage.decryptString(readFileSync(keyPath));
      return { certPem, keyPem, fingerprint: fingerprintOf(certPem), deviceName: macName() };
    } catch (error) {
      log.warn('identity', `Stored identity unreadable, regenerating: ${String(error)}`);
    }
  }

  const created = generate();
  writeFileSync(certPath, created.certPem);
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath, safeStorage.encryptString(created.keyPem));
  } else {
    log.warn('identity', 'safeStorage unavailable — key kept in memory only for this session');
  }
  log.info('identity', `New identity ${created.fingerprint.slice(0, 23)}…`);
  return created;
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
    { name: 'organizationName', value: 'ConnectSuite' },
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
