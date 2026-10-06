import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pairing v2's proofs — `docs/protocol.md` → *Pairing (version 2)*; audit S1, defect 182.
 *
 * Reviewed primitives only: HMAC-SHA256, the platform CSPRNG, and a constant-time compare. Nothing here
 * is a new construction; the transcript is a fixed-layout byte string so the Mac, the phone and the
 * independent Python generator of `docs/fixtures/pairing-v2-vectors.json` cannot disagree about it.
 *
 * The phone's twin is `core/.../link/PairingV2.kt`. Main-process only: this file uses `node:crypto` and
 * is never loaded by the renderer.
 */

export const PAIRING_VERSION = 2;
export const LABEL = 'sidekick/pair/v2';
export type ProofRole = 'phone' | 'mac';

const HEX64 = /^[0-9a-f]{64}$/;

/** 32 bytes from the CSPRNG, as 64 lowercase hex — the QR secret `K` and both nonces. */
export function newSecretHex(): string {
  return randomBytes(32).toString('hex');
}

export const newNonceHex = newSecretHex;

/** Whether [value] is exactly 64 lowercase hex characters. Anything else is refused before any work. */
export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/**
 * A certificate fingerprint as its 32 raw bytes, from any punctuation of 64 hex digits — or null.
 * The QR carries `AB:CD:…`; the transcript carries bytes.
 */
export function fingerprintBytes(fingerprint: string): Buffer | null {
  const hex = fingerprint.replace(/[:\s]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

export interface TranscriptInputs {
  macFingerprint: string;
  phoneFingerprint: string;
  macNonce: string;
  phoneNonce: string;
}

/**
 * `"sidekick/pair/v2" 0x00 role 0x00 Fm(32) Fp(32) Nm(32) Np(32)`. Throws on a malformed input, which a
 * caller treats as a failed proof — never as something to repair.
 */
export function transcript(role: ProofRole, t: TranscriptInputs): Buffer {
  const fm = fingerprintBytes(t.macFingerprint);
  const fp = fingerprintBytes(t.phoneFingerprint);
  if (!fm || !fp) throw new Error('a fingerprint is not 32 bytes of hex');
  if (!isHex64(t.macNonce) || !isHex64(t.phoneNonce)) throw new Error('a nonce is not 64 lowercase hex');
  return Buffer.concat([
    Buffer.from(LABEL, 'ascii'),
    Buffer.from([0]),
    Buffer.from(role, 'ascii'),
    Buffer.from([0]),
    fm,
    fp,
    Buffer.from(t.macNonce, 'hex'),
    Buffer.from(t.phoneNonce, 'hex'),
  ]);
}

/** HMAC-SHA256(K, T(role)) as 64 lowercase hex. */
export function proof(secretHex: string, role: ProofRole, t: TranscriptInputs): string {
  if (!isHex64(secretHex)) throw new Error('the pairing secret is not 64 lowercase hex');
  return createHmac('sha256', Buffer.from(secretHex, 'hex')).update(transcript(role, t)).digest('hex');
}

/**
 * Whether [candidate] is the proof for [role] over [t] under [secretHex]. Constant time in the proof's
 * bytes; any malformed input — the candidate, a nonce, a fingerprint, the secret — is simply `false`.
 */
export function verifyProof(secretHex: string, role: ProofRole, t: TranscriptInputs, candidate: unknown): boolean {
  if (!isHex64(candidate)) return false;
  let expected: string;
  try {
    expected = proof(secretHex, role, t);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
}
