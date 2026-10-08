import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chooseIdentity } from './identityPair';

/**
 * Reading and writing this Mac's TLS identity, with the sealing injected — no Electron import, so the
 * transition defect 207 is about is reachable from a file-level test (`identityStore.test.ts`).
 *
 * `identity.ts` passes Electron's `safeStorage`. On macOS that seals with a Keychain item whose access
 * belongs to the build that created it, which is why a second build — a packaged copy beside the
 * development one, or an update signed differently — can find a key on disk that it cannot open.
 */
export interface SealingBox {
  available(): boolean;
  seal(text: string): Buffer;
  /** Throws when this build cannot open what was sealed. */
  open(data: Buffer): string;
}

export interface StoredIdentity {
  certPem: string;
  keyPem: string;
  fingerprint: string;
  deviceName: string;
}

export type IdentityLoad =
  | { kind: 'stored'; certPem: string; keyPem: string }
  | { kind: 'created'; identity: StoredIdentity; persisted: boolean }
  /** Something is on disk that this build cannot use. **Nothing was written**; the caller must ask. */
  | { kind: 'blocked'; reason: string; openError: string | null };

const CERT = 'cert.pem';
const KEY = 'key.enc';

/**
 * Defect 207 (a). Loads the stored identity, creates one only into an empty folder, and otherwise
 * returns `blocked` **having written nothing** — no new key minted, no file replaced or removed.
 */
export function loadStoredIdentity(dir: string, box: SealingBox, mint: () => StoredIdentity): IdentityLoad {
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, CERT);
  const keyPath = join(dir, KEY);
  const certExists = existsSync(certPath);
  const keyExists = existsSync(keyPath);
  const sealingAvailable = box.available();

  let certPem: string | null = null;
  let keyPem: string | null = null;
  let openError: string | null = null;
  try {
    if (certExists) certPem = readFileSync(certPath, 'utf8');
  } catch (error) {
    openError = `certificate unreadable: ${String(error)}`;
  }
  try {
    if (keyExists && sealingAvailable) keyPem = box.open(readFileSync(keyPath));
  } catch (error) {
    openError = `key: ${String(error)}`;
  }

  const choice = chooseIdentity({ certExists, keyExists, certPem, keyPem, sealingAvailable });
  if (choice.use === 'stored') return { kind: 'stored', certPem: certPem!, keyPem: keyPem! };
  if (choice.use === 'blocked') return { kind: 'blocked', reason: choice.reason, openError };

  // An empty folder — the first launch on this profile. The only case in which this function writes.
  const created = mint();
  if (!sealingAvailable) return { kind: 'created', identity: created, persisted: false };
  writeSealed(dir, box, created);
  return { kind: 'created', identity: created, persisted: true };
}

/**
 * The person chose *Start over*: the stored files move, unchanged, into `retired-<time>/` beside them
 * — never deleted, so the build that can open them can still be pointed at them — and a new identity is
 * sealed in their place. The caller drops the stored phone in the same step (its record pins the old
 * identity, and a stored phone means no pairing code is asked for).
 */
export function startOver(
  dir: string,
  box: SealingBox,
  mint: () => StoredIdentity,
  now: Date,
): { identity: StoredIdentity; retiredTo: string; persisted: boolean } {
  const retiredTo = join(dir, `retired-${now.toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(retiredTo, { recursive: false });
  for (const name of [CERT, KEY]) {
    if (existsSync(join(dir, name))) renameSync(join(dir, name), join(retiredTo, name));
  }
  const identity = mint();
  if (!box.available()) return { identity, retiredTo, persisted: false };
  writeSealed(dir, box, identity);
  return { identity, retiredTo, persisted: true };
}

/**
 * Both halves reach the disk or neither does: written beside, then renamed into place, key first. A
 * certificate beside an old key is the 2026-09-07 mismatch, and a crash between two plain writes is
 * exactly how one is made.
 */
function writeSealed(dir: string, box: SealingBox, identity: StoredIdentity): void {
  const sealed = box.seal(identity.keyPem);
  writeFileSync(join(dir, `${KEY}.new`), sealed);
  writeFileSync(join(dir, `${CERT}.new`), identity.certPem);
  renameSync(join(dir, `${KEY}.new`), join(dir, KEY));
  renameSync(join(dir, `${CERT}.new`), join(dir, CERT));
}

/**
 * The words for a blocked identity — the native prompt `main.ts` shows before anything dials a phone.
 *
 * Quit is the default and the cancel action, because the commonest cause is a second copy of
 * Sidekick: the right next step is to open the copy that can read the key, and that copy is
 * unharmed only if this one does nothing.
 */
export function blockedPrompt(reason: string): {
  message: string;
  detail: string;
  buttons: [string, string, string];
  defaultId: 0;
  cancelId: 0;
} {
  return {
    message: 'Sidekick can’t use this Mac’s saved key',
    detail:
      `Your phone recognises this Mac by a private key that Sidekick keeps for it. This time ${reason}.\n\n` +
      'Nothing has been changed. If you have another copy of Sidekick — for example one you downloaded and ' +
      'one you built — quit this one and open the copy that made the key.\n\n' +
      'Start Over makes a new key for this Mac. The old key is kept in its folder, not removed, but your ' +
      'phone will not connect to this Mac until you pair them again.',
    buttons: ['Quit Sidekick', 'Show the Key’s Folder', 'Start Over with a New Key…'],
    defaultId: 0,
    cancelId: 0,
  };
}
