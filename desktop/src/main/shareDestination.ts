import { randomBytes } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { candidateName } from '../shared/shareNames';
import { recordCreatedFrom, recordIntentFrom, type ShareLedger } from './shareLedger';

/**
 * Where a shared file lands on the Mac, and how — docs/protocol.md → Share → Version 2. Four
 * operations, each the only place its rule lives:
 *
 * - [checkDestination]: before any byte moves (at the offer and again at Accept), is the folder
 *   usable, big enough, and able to make the exclusive save? **Only a completed hard link counts as
 *   support**; anything the check cannot establish fails closed as `folder-unavailable`.
 * - [publishExclusive]: the save itself, by **hard link** to a free name — `link()` refuses an
 *   existing name, so a file that appears after the name was chosen is never replaced. `EEXIST`
 *   chooses the next name; a filesystem without hard links refuses (`unsupported-destination`), with
 *   no placeholder-then-rename fallback (owner decision 1).
 * - [sharePartPath]: the partial's name, `.<offerId>.<nonce>.sidekick-share.part` — never
 *   `<name>.part` (defect 151) — with a fresh random nonce per attempt. **A name is never proof of
 *   ownership**: the pull creates the partial exclusively and refuses if anything is already there;
 *   it never deletes a file it did not create. What may be deleted later is decided by the private
 *   ownership ledger (`shareLedger.ts`), by device and inode — never by a name pattern.
 *
 * Files and Photos do not use any of this; their `rename`-over (defect 150) is unchanged here.
 */

export type DestinationFailure = 'folder-unavailable' | 'insufficient-space' | 'unsupported-destination';
export type PublishFailure = 'unsupported-destination' | 'write-failed';

/** The filesystem calls, injectable so tests can make a link fail or a disk be full. */
export interface DestinationFs {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  access(path: string, mode: number): Promise<void>;
  statfs(path: string): Promise<{ bavail: number | bigint; bsize: number | bigint }>;
  writeFileExclusive(path: string): Promise<void>;
  link(existing: string, created: string): Promise<void>;
  unlink(path: string): Promise<void>;
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean; size: number }>;
}

export const realFs: DestinationFs = {
  stat: (p) => fsp.stat(p),
  access: (p, m) => fsp.access(p, m),
  statfs: (p) => fsp.statfs(p),
  writeFileExclusive: (p) => fsp.writeFile(p, '', { flag: 'wx' }),
  link: (a, b) => fsp.link(a, b),
  unlink: (p) => fsp.unlink(p),
  lstat: (p) => fsp.lstat(p),
};

const MIB = 1024 * 1024;
const OFFER_ID = /^s-[A-Za-z0-9_-]{22}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const NO_HARD_LINKS = new Set(['EXDEV', 'ENOTSUP', 'EPERM', 'ENOSYS', 'EOPNOTSUPP']);
export const MAX_NAME_ATTEMPTS = 20;

/** `size + max(256 MiB, ⌈size / 10⌉)` — the same formula as the phone's staging preflight. */
export function spaceNeeded(size: number): number {
  return size + Math.max(256 * MIB, Math.ceil(size / 10));
}

/** 128 random bits, base64url: one per pull attempt, so no two attempts ever share a partial name. */
export function newPartNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function sharePartPath(folder: string, offerId: string, nonce: string): string {
  if (!OFFER_ID.test(offerId)) throw new Error('not an offer id');
  if (!NONCE.test(nonce)) throw new Error('not a partial nonce');
  return join(folder, `.${offerId}.${nonce}.sidekick-share.part`);
}

function code(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
}

function probeName(): string {
  return `.sidekick-link-probe-${randomBytes(16).toString('base64url')}`;
}

export type DestinationVerdict =
  | { ok: true }
  | { ok: false; reason: DestinationFailure; detail: string };

/**
 * Is [folder] usable, with room for [size], and able to publish by hard link? Every step is
 * checked; any error that is not a clear "no hard links here" is `folder-unavailable` — the check
 * could not establish support, so it fails closed and says why in `detail`.
 */
export async function checkDestination(
  folder: string,
  size: number,
  fs: DestinationFs = realFs,
  ledger: ShareLedger | null = null,
  /**
   * Bytes other accepted or receiving offers hold back (`shareReservations.ts`), taken out of free
   * space before this offer is judged. 0 — the default — is version 2, where only one offer is live.
   */
  reserved = 0,
): Promise<DestinationVerdict> {
  try {
    const info = await fs.stat(folder);
    if (!info.isDirectory()) return { ok: false, reason: 'folder-unavailable', detail: 'not a folder' };
    await fs.access(folder, constants.W_OK);
  } catch (error) {
    return { ok: false, reason: 'folder-unavailable', detail: `not usable (${code(error)})` };
  }
  try {
    const s = await fs.statfs(folder);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!Number.isFinite(free)) return { ok: false, reason: 'folder-unavailable', detail: 'free space unknown' };
    if (!Number.isSafeInteger(reserved) || reserved < 0) {
      return { ok: false, reason: 'folder-unavailable', detail: `reserved bytes unreadable (${reserved})` };
    }
    if (free - reserved < spaceNeeded(size)) {
      return reserved > 0
        ? { ok: false, reason: 'insufficient-space', detail: `needs ${spaceNeeded(size)} bytes free after ${reserved} reserved for accepted files, has ${free}` }
        : { ok: false, reason: 'insufficient-space', detail: `needs ${spaceNeeded(size)} bytes free, has ${free}` };
    }
  } catch (error) {
    return { ok: false, reason: 'folder-unavailable', detail: `free space could not be read (${code(error)})` };
  }

  const a = join(folder, probeName());
  const b = `${a}-2`;
  // Each probe file is recorded before it exists and identified after, so a crash mid-check leaves
  // something the startup sweep can prove is ours — and nothing it cannot.
  try {
    if (ledger) await recordIntentFrom(ledger, a);
    await fs.writeFileExclusive(a);
    if (ledger) await recordCreatedFrom(ledger, a, 0);
  } catch (error) {
    await ledger?.forget(a).catch(() => undefined);
    return { ok: false, reason: 'folder-unavailable', detail: `could not create a probe file (${code(error)})` };
  }
  let verdict: DestinationVerdict;
  try {
    if (ledger) await recordIntentFrom(ledger, b);
    await fs.link(a, b);
    if (ledger) await recordCreatedFrom(ledger, b, 0);
    verdict = { ok: true };
  } catch (error) {
    verdict = NO_HARD_LINKS.has(code(error))
      ? { ok: false, reason: 'unsupported-destination', detail: `hard links refused (${code(error)})` }
      : { ok: false, reason: 'folder-unavailable', detail: `the link probe failed unexpectedly (${code(error)})` };
  }
  const leftovers: string[] = [];
  for (const p of [b, a]) {
    try {
      await fs.unlink(p);
      await ledger?.forget(p);
    } catch (error) {
      if (code(error) === 'ENOENT') await ledger?.forget(p).catch(() => undefined);
      else leftovers.push(p); // stays in the ledger: the startup sweep removes it, by identity
    }
  }
  if (leftovers.length > 0) {
    return { ok: false, reason: 'folder-unavailable', detail: `probe file(s) left behind: ${leftovers.join(', ')}` };
  }
  return verdict;
}

export type PublishResult = { ok: true; path: string; savedAs: string } | { ok: false; reason: PublishFailure; detail: string };

/**
 * Publishes [part] as the first free name of [wantedName] in [folder], **by hard link**. `link()`
 * fails with `EEXIST` if anything exists at that name, so the check and the save are one step.
 * [beforeLink] is a test seam for the final-name race.
 *
 * **It does not remove [part].** Removing a name is only safe while that name still refers to the
 * caller's file, and only the caller holds that file's identity (the share pull, from its open
 * handle). A partial swapped between the link and an unlink here would have cost somebody else's file
 * its name; the pull removes the partial itself, after confirming both names are its own file.
 */
export async function publishExclusive(
  part: string,
  folder: string,
  wantedName: string,
  fs: DestinationFs = realFs,
  beforeLink: (path: string) => Promise<void> = async () => undefined,
): Promise<PublishResult> {
  for (let n = 1; n <= MAX_NAME_ATTEMPTS; n += 1) {
    const savedAs = candidateName(wantedName, n);
    const path = join(folder, savedAs);
    const taken = await fs.lstat(path).then(() => true, () => false);
    if (taken) continue;
    await beforeLink(path);
    try {
      await fs.link(part, path);
    } catch (error) {
      const c = code(error);
      if (c === 'EEXIST') continue; // somebody got there between the look and the link: next name
      if (NO_HARD_LINKS.has(c)) return { ok: false, reason: 'unsupported-destination', detail: `hard links refused (${c})` };
      return { ok: false, reason: 'write-failed', detail: `link failed (${c})` };
    }
    // Linked. The partial is left for the caller, which removes it by identity.
    return { ok: true, path, savedAs };
  }
  return { ok: false, reason: 'write-failed', detail: `no free name after ${MAX_NAME_ATTEMPTS} attempts` };
}
