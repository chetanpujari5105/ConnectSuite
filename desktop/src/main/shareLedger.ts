import { constants, promises as fsp } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

/**
 * **What the Mac may delete, recorded before it exists.** A private record, in the app's own data
 * folder, of every temporary file the share receive creates in a receive folder — partials and
 * destination-probe files — with the **identity** of the file it actually created: device, inode,
 * birth time, and the most bytes it may ever hold.
 *
 * A file name is never proof of ownership: any app, or a person, can create a file whose name looks
 * like one of ours. So nothing in the share path deletes a file because of its name. A temporary file
 * is deleted only when a ledger entry names its exact path **and** every check in [sweepLedger]
 * passes. Everything else — a lookalike name, a replaced file, a symlink, a directory, a file outside
 * the sweep's scope — is left alone and reported.
 *
 * Order of writes, which is what makes a crash safe:
 * 1. `recordIntent(path)` — before the file is created;
 * 2. create it exclusively (`wx`) — refusing if anything is already there;
 * 3. `recordCreated(path, identity)` — from the file just created;
 * 4. `forget(path)` — after it is deleted or published.
 * A crash after 1 leaves an entry with no identity: the sweep deletes nothing for it.
 *
 * **What the identity does not guarantee.** Device + inode can be reused by the filesystem after
 * our file is deleted by someone else and a new one created. Birth time and the size bound make
 * that much less likely to pass unnoticed; they do not make it impossible. That residue is why the
 * sweep is also confined to one folder and to Sidekick's own two name shapes — each check narrows
 * what a false match could ever touch, and none of them is proof on its own.
 */
export interface LedgerIdentity {
  dev: number;
  ino: number;
  /** `birthtimeMs` from the `lstat` taken right after the exclusive create. */
  birthtimeMs: number;
  /** The most bytes this file may legitimately hold: the offer's size for a partial, 0 for a probe. */
  maxBytes: number;
}

export interface LedgerEntry extends Partial<LedgerIdentity> {
  path: string;
}

export interface ShareLedger {
  recordIntent(path: string): Promise<void>;
  recordCreated(path: string, identity: LedgerIdentity): Promise<void>;
  forget(path: string): Promise<void>;
  entries(): Promise<LedgerEntry[]>;
}

/** A JSON file in the app's private data folder. Writes are serialised and atomic (temp + rename). */
export class FileShareLedger implements ShareLedger {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async read(): Promise<LedgerEntry[]> {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed.filter((e) => e && typeof e.path === 'string') as LedgerEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async write(entries: LedgerEntry[]): Promise<void> {
    await fsp.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(entries));
    await fsp.rename(tmp, this.file);
  }

  private update(change: (entries: LedgerEntry[]) => LedgerEntry[]): Promise<void> {
    const next = this.chain.then(async () => this.write(change(await this.read())));
    this.chain = next.catch(() => undefined);
    return next;
  }

  recordIntent(path: string): Promise<void> {
    return this.update((es) => [...es.filter((e) => e.path !== path), { path }]);
  }

  recordCreated(path: string, identity: LedgerIdentity): Promise<void> {
    return this.update((es) => [...es.filter((e) => e.path !== path), { path, ...identity }]);
  }

  forget(path: string): Promise<void> {
    return this.update((es) => es.filter((e) => e.path !== path));
  }

  async entries(): Promise<LedgerEntry[]> {
    await this.chain;
    return this.read();
  }
}

export function ledgerFile(userData: string): string {
  return join(userData, 'share-temporary-files.json');
}

/**
 * Records an exclusively created file's identity from a fresh `lstat`, so the entry is about *that*
 * file. [maxBytes] is the most it may ever hold (0 for a probe file).
 */
export async function recordCreatedFrom(ledger: ShareLedger, path: string, maxBytes: number): Promise<void> {
  const st = await fsp.lstat(path);
  await ledger.recordCreated(path, { dev: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs, maxBytes });
}

/**
 * The only two names Sidekick gives a temporary file in a receive folder (`shareDestination.ts`):
 * a partial, `.<offerId>.<nonce>.sidekick-share.part`, and a probe,
 * `.sidekick-link-probe-<nonce>` or its link `…-2`. Necessary, never sufficient.
 */
const OWNED_NAME = /^(?:\.s-[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}\.sidekick-share\.part|\.sidekick-link-probe-[A-Za-z0-9_-]{22}(?:-2)?)$/;

export function isSidekickTemporaryName(name: string): boolean {
  return OWNED_NAME.test(name);
}

export type LeftReason =
  | 'outside-scope'
  | 'not-a-clean-path'
  | 'not-a-sidekick-name'
  | 'parent-not-a-real-folder'
  | 'no-recorded-identity'
  | 'not-a-regular-file'
  | 'identity-mismatch'
  | 'larger-than-recorded'
  | 'changed-while-checking'
  | 'unreadable';

export interface LeftFile {
  path: string;
  why: LeftReason;
}

export interface LedgerSweepResult {
  deleted: number;
  /** Entries dropped because nothing is at the path any more. Nothing was deleted for them. */
  gone: number;
  /** Files that could not be proven ours: **left in place**, and reported here for the log. */
  left: LeftFile[];
  /** Of [left], entries kept in the ledger because they are outside this run's scope, not disproven. */
  kept: number;
}

export interface SweepScope {
  /**
   * The only folders the sweep may delete in, compared by **exact path** and then by real path.
   * Empty — the default, and the answer in every run where the development scratch receive is not
   * active — means the sweep deletes nothing at all.
   */
  allowedParents: readonly string[];
}

async function realFolder(path: string): Promise<string | null> {
  const st = await fsp.lstat(path).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return null;
  return fsp.realpath(path).catch(() => null);
}

/**
 * The startup sweep. It never lists a folder, so it cannot find anything it did not record, and it
 * deletes an entry's file **only** when every one of these holds:
 *
 * 1. the path is absolute and already normal (no `..`, no doubled separators);
 * 2. its parent is exactly one of [SweepScope.allowedParents], that parent is a real folder (not a
 *    symlink) and resolves to the same real path — so a crafted entry, or a folder swapped for a
 *    link, cannot steer the sweep anywhere else;
 * 3. its name is one of Sidekick's two temporary shapes;
 * 4. the entry has a full recorded identity;
 * 5. `lstat` (which does not follow links) finds a regular file whose device, inode and birth time
 *    match, and whose size is no more than recorded;
 * 6. opened with `O_NOFOLLOW`, the open file is still that device and inode — the last look before
 *    the unlink.
 *
 * `unlink` removes a name, never follows a link, and cannot touch another name for the same bytes —
 * so even a partial whose bytes were already published under a final name only loses its own name.
 *
 * What is left: an entry outside scope stays in the ledger (a later run with that scope may prove
 * it); an entry in scope that failed a check is forgotten, because the check showed the file there is
 * not the one we made. In both cases the **file** is untouched and the path is reported.
 *
 * Residual race: between check 6 and the unlink another process could replace the name. The window
 * is a single syscall, the folder is app-private, and the checks above make the replacement have to
 * be deliberate; it is stated rather than claimed away.
 */
export async function sweepLedger(ledger: ShareLedger, scope: SweepScope = { allowedParents: [] }): Promise<LedgerSweepResult> {
  const result: LedgerSweepResult = { deleted: 0, gone: 0, left: [], kept: 0 };
  const parents = new Map<string, string | null>();
  for (const p of scope.allowedParents) parents.set(p, await realFolder(p));

  const leave = async (e: LedgerEntry, why: LeftReason, keep = false): Promise<void> => {
    result.left.push({ path: e.path, why });
    if (keep) result.kept += 1;
    else await ledger.forget(e.path).catch(() => undefined);
  };

  for (const e of await ledger.entries()) {
    const path = e.path;
    if (!isAbsolute(path) || normalize(path) !== path || path.includes('\0')) {
      await leave(e, 'not-a-clean-path');
      continue;
    }
    const parent = dirname(path);
    if (!parents.has(parent)) {
      await leave(e, 'outside-scope', true);
      continue;
    }
    const realParent = parents.get(parent) ?? null;
    if (realParent === null || (await realFolder(parent)) !== realParent) {
      await leave(e, 'parent-not-a-real-folder', true);
      continue;
    }
    if (!isSidekickTemporaryName(basename(path))) {
      await leave(e, 'not-a-sidekick-name');
      continue;
    }
    let st: Awaited<ReturnType<typeof fsp.lstat>> | null;
    try {
      st = await fsp.lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        result.gone += 1;
        await ledger.forget(path).catch(() => undefined);
      } else {
        await leave(e, 'unreadable', true);
      }
      continue;
    }
    if (e.dev === undefined || e.ino === undefined || e.birthtimeMs === undefined || e.maxBytes === undefined) {
      await leave(e, 'no-recorded-identity');
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink()) {
      await leave(e, 'not-a-regular-file');
      continue;
    }
    if (st.dev !== e.dev || st.ino !== e.ino || st.birthtimeMs !== e.birthtimeMs) {
      await leave(e, 'identity-mismatch');
      continue;
    }
    if (st.size > e.maxBytes) {
      await leave(e, 'larger-than-recorded');
      continue;
    }
    // The last look: open without following a link and ask the open file who it is.
    let still = false;
    try {
      const fh = await fsp.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const now = await fh.stat();
        still = now.isFile() && now.dev === e.dev && now.ino === e.ino;
      } finally {
        await fh.close();
      }
    } catch {
      still = false;
    }
    if (!still) {
      await leave(e, 'changed-while-checking');
      continue;
    }
    try {
      await fsp.unlink(path);
      result.deleted += 1;
      await ledger.forget(path).catch(() => undefined);
    } catch {
      await leave(e, 'unreadable', true);
    }
  }
  return result;
}
