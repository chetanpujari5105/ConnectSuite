import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * **What the Mac may delete, recorded before it exists.** A private record, in the app's own data
 * folder, of every temporary file the share receive creates in a receive folder — partials and
 * destination-probe files — with the **device and inode** of the file it actually created.
 *
 * A file name is never proof of ownership: any app, or a person, can create a file whose name looks
 * like one of ours. So nothing in the share path deletes a file because of its name. A temporary file
 * is deleted only when a ledger entry names its exact path **and** its device and inode still match
 * the file this process created. Everything else — a lookalike name, a replaced file, a symlink, a
 * directory — is left alone, and a stale entry is simply forgotten.
 *
 * Order of writes, which is what makes a crash safe:
 * 1. `recordIntent(path)` — before the file is created;
 * 2. create it exclusively (`wx`) — refusing if anything is already there;
 * 3. `recordCreated(path, dev, ino)` — from the file just created;
 * 4. `forget(path)` — after it is deleted or published.
 * A crash after 1 leaves an entry with no identity: the sweep forgets it and deletes nothing.
 */
export interface LedgerEntry {
  path: string;
  dev?: number;
  ino?: number;
}

export interface ShareLedger {
  recordIntent(path: string): Promise<void>;
  recordCreated(path: string, dev: number, ino: number): Promise<void>;
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

  recordCreated(path: string, dev: number, ino: number): Promise<void> {
    return this.update((es) => [...es.filter((e) => e.path !== path), { path, dev, ino }]);
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

/** Records an exclusively created file's identity from a fresh `lstat`, so the entry is about *that* file. */
export async function recordCreatedFrom(ledger: ShareLedger, path: string): Promise<void> {
  const st = await fsp.lstat(path);
  await ledger.recordCreated(path, st.dev, st.ino);
}

export interface LedgerSweepResult {
  deleted: number;
  /** Entries dropped without deleting anything: no identity, gone, not a regular file, or a different file. */
  forgotten: number;
}

/**
 * The startup sweep. For each entry: delete the file **only** if it is a regular file (never a
 * symlink or a folder) whose device and inode match the recorded ones; in every other case delete
 * nothing and forget the entry. It never lists a folder, so it cannot find anything it did not record.
 */
export async function sweepLedger(ledger: ShareLedger): Promise<LedgerSweepResult> {
  let deleted = 0;
  let forgotten = 0;
  for (const e of await ledger.entries()) {
    try {
      const st = await fsp.lstat(e.path).catch(() => null);
      const ours = st !== null && e.dev !== undefined && e.ino !== undefined &&
        st.isFile() && !st.isSymbolicLink() && st.dev === e.dev && st.ino === e.ino;
      if (ours) {
        await fsp.unlink(e.path);
        deleted += 1;
      } else {
        forgotten += 1;
      }
    } catch {
      forgotten += 1;
    }
    await ledger.forget(e.path).catch(() => undefined);
  }
  return { deleted, forgotten };
}
