/**
 * The Mac's resume records for block-verified pulls (docs/protocol.md → Block-verified, resumable
 * pulls → What the Mac keeps). Owner decisions of 2026-09-29, each a rule here:
 *
 * - **D3 — at most 16 records and at most 7 days.** Expired records are swept (at start, and before a
 *   new record is made). **When 16 live records exist nothing is evicted**: [reserve] refuses, with the
 *   sentence the contract names, and the pull is never started.
 * - **D5 — the partial lives in the destination folder, and is touched only when it is provably ours**:
 *   a regular file (never a symlink), at the path, device and inode the record holds, in a folder whose
 *   real path is the recorded one, with Sidekick's own partial name, and no longer than the file. A
 *   partial that fails any of these is left exactly where it is; only the record goes.
 * - **D2 — Cancel deletes only that transfer's owned partial** ([discard] with `deletePartial`), Pause
 *   keeps both.
 *
 * Records live in the app's private data folder, keyed by the paired phone's fingerprint + `rootId` +
 * document id, so a record is never offered to a different phone and never sits beside the file.
 */
import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BlockHasher } from '../shared/fsBlocks';
import type { TransferDigest } from '../shared/transferDigest';
import { pullPartPathFor } from '../shared/transferFiles';

export const MAX_RESUME_RECORDS = 16;
export const MAX_RESUME_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const STORE_FULL_SENTENCE =
  '16 paused transfers are already kept on this Mac. Resume or cancel one of them first.';

export interface ResumeRecord {
  v: 1;
  /** The paired phone's pinned certificate fingerprint. */
  phone: string;
  rootId: string;
  id: string;
  name: string;
  size: number;
  mtimeMs: number;
  blockSize: number;
  /** Digests of the leading blocks verified so far, in order. */
  digests: string[];
  /** The final name the pull is heading for; the partial is `pullPartPathFor(destination)`. */
  destination: string;
  /** `realpath` of the destination folder when the record was made. */
  folderReal: string;
  partDev: number;
  partIno: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type Ownership = { owned: true; size: number } | { owned: false; why: string };

/**
 * Whether [record]'s partial is provably this transfer's own. Every clause is a way an unrelated file
 * could be standing at that path: a symlink planted there, a file the person saved under that name,
 * the folder replaced by a link to somewhere else, or the record pointing somewhere it should not.
 */
export async function ownedPartial(record: ResumeRecord): Promise<Ownership> {
  const part = pullPartPathFor(record.destination);
  if (basename(part) !== `.${basename(record.destination)}.sidekick-pull.part`) {
    return { owned: false, why: 'not a Sidekick partial name' };
  }
  const folderReal = await fs.realpath(dirname(part)).catch(() => null);
  if (folderReal === null) return { owned: false, why: 'the folder is gone' };
  if (folderReal !== record.folderReal) return { owned: false, why: `the folder now resolves to ${folderReal}, not ${record.folderReal}` };
  const st = await fs.lstat(part).catch(() => null);
  if (!st) return { owned: false, why: 'the partial is gone' };
  if (st.isSymbolicLink()) return { owned: false, why: 'the partial is a symbolic link' };
  if (!st.isFile()) return { owned: false, why: 'the partial is not a regular file' };
  if (st.dev !== record.partDev || st.ino !== record.partIno) return { owned: false, why: 'a different file now stands at the partial path' };
  if (st.size > record.size) return { owned: false, why: `the partial holds ${st.size} bytes, more than the ${record.size}-byte file` };
  return { owned: true, size: st.size };
}

/** Deletes [record]'s partial only if it is owned, re-checked immediately before the unlink. */
export async function deleteOwnedPartial(record: ResumeRecord): Promise<{ deleted: boolean; why?: string }> {
  const owned = await ownedPartial(record);
  if (!owned.owned) return { deleted: false, why: owned.why };
  await fs.unlink(pullPartPathFor(record.destination));
  return { deleted: true };
}

export class PullResumeStore {
  constructor(
    private readonly dir: string,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  static keyOf(phone: string, rootId: string, id: string): string {
    return createHash('sha256').update(`${phone}\u0000${rootId}\u0000${id}`).digest('hex');
  }

  private pathOf(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  /** Every readable record. A file that does not parse as a record is reported and left alone. */
  async all(): Promise<ResumeRecord[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    const out: ResumeRecord[] = [];
    for (const n of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(n)) continue;
      try {
        const r = JSON.parse(await fs.readFile(join(this.dir, n), 'utf8')) as ResumeRecord;
        if (r?.v === 1 && typeof r.phone === 'string' && Array.isArray(r.digests)) out.push(r);
        else this.log(`resume record ${n} is not a record; left alone`);
      } catch {
        this.log(`resume record ${n} could not be read; left alone`);
      }
    }
    return out;
  }

  /**
   * Expires records older than 7 days: the partial is deleted only if owned, the record always.
   * Returns what was expired, with what happened to each partial.
   */
  async sweep(nowMs: number): Promise<Array<{ record: ResumeRecord; partial: string }>> {
    const expired: Array<{ record: ResumeRecord; partial: string }> = [];
    for (const r of await this.all()) {
      if (nowMs - r.createdAtMs <= MAX_RESUME_AGE_MS) continue;
      const d = await deleteOwnedPartial(r).catch((e: unknown) => ({ deleted: false, why: String(e) }));
      await fs.rm(this.pathOf(PullResumeStore.keyOf(r.phone, r.rootId, r.id)), { force: true });
      const partial = d.deleted ? 'partial deleted' : `partial left in place (${d.why})`;
      this.log(`resume record for ${r.name} (${r.size} bytes) expired after ${Math.round((nowMs - r.createdAtMs) / 3_600_000)} h; ${partial}`);
      expired.push({ record: r, partial });
    }
    return expired;
  }

  async find(phone: string, rootId: string, id: string): Promise<ResumeRecord | null> {
    try {
      const r = JSON.parse(await fs.readFile(this.pathOf(PullResumeStore.keyOf(phone, rootId, id)), 'utf8')) as ResumeRecord;
      return r?.v === 1 && r.phone === phone && r.rootId === rootId && r.id === id ? r : null;
    } catch {
      return null;
    }
  }

  /**
   * May a **new** record be made? Sweeps first; then refuses when 16 live records exist. It never
   * evicts: the person chooses which paused transfer to give up.
   */
  async reserve(nowMs: number): Promise<{ ok: true } | { ok: false; why: string }> {
    await this.sweep(nowMs);
    const live = (await this.all()).length;
    return live >= MAX_RESUME_RECORDS ? { ok: false, why: STORE_FULL_SENTENCE } : { ok: true };
  }

  /** Writes [record] atomically (temp file + rename), readable by this user only. */
  async save(record: ResumeRecord): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = this.pathOf(PullResumeStore.keyOf(record.phone, record.rootId, record.id));
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record), { mode: 0o600, flag: 'w' });
    await fs.rename(tmp, target);
  }

  /** Drops [record]; with [deletePartial] (Cancel, a changed source) its partial goes too, if owned. */
  async discard(record: ResumeRecord, deletePartial: boolean): Promise<string> {
    let partial = 'partial kept';
    if (deletePartial) {
      const d = await deleteOwnedPartial(record).catch((e: unknown) => ({ deleted: false, why: String(e) }));
      partial = d.deleted ? 'partial deleted' : `partial left in place (${d.why})`;
    }
    await fs.rm(this.pathOf(PullResumeStore.keyOf(record.phone, record.rootId, record.id)), { force: true });
    return partial;
  }

  /** Forget or re-pair: every record for [phone] goes, each partial only if owned. */
  async forgetPhone(phone: string): Promise<number> {
    let n = 0;
    for (const r of await this.all()) {
      if (r.phone !== phone) continue;
      const partial = await this.discard(r, true);
      this.log(`resume record for ${r.name} dropped with its phone; ${partial}`);
      n += 1;
    }
    return n;
  }
}

/** Opens a fresh partial: exclusive create, never through a symlink. Returns its identity. */
export async function createPartialExclusive(part: string): Promise<{ handle: fs.FileHandle; dev: number; ino: number }> {
  const handle = await fs.open(part, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  const st = await handle.stat();
  return { handle, dev: st.dev, ino: st.ino };
}

/**
 * Opens an owned partial for a resume: no-follow, then the open file's own device and inode must equal
 * the record's — checked on the descriptor, so nothing can be swapped in between the check and the use.
 */
export async function openOwnedPartial(record: ResumeRecord): Promise<fs.FileHandle> {
  const handle = await fs.open(pullPartPathFor(record.destination), constants.O_RDWR | constants.O_NOFOLLOW);
  const st = await handle.stat();
  if (!st.isFile() || st.dev !== record.partDev || st.ino !== record.partIno) {
    await handle.close();
    throw new Error('the partial is not the one this record created');
  }
  return handle;
}

/**
 * Before a resume (rule S5): reads the first `record.digests.length` blocks back from the owned
 * partial **through its identity-checked handle**, hashes them, and requires every one to equal the
 * record; primes [digest] with the same bytes in the same pass. Then truncates the partial to exactly
 * the verified length — an unverified tail is never kept. Any difference refuses the resume.
 */
export async function verifyAndTrimPrefix(
  handle: fs.FileHandle,
  record: ResumeRecord,
  digest: TransferDigest,
): Promise<{ ok: true; from: number } | { ok: false; why: string }> {
  const n = record.digests.length;
  const from = n * record.blockSize;
  const st = await handle.stat();
  if (st.size < from) return { ok: false, why: `the partial holds ${st.size} bytes, fewer than the ${from} its record verified` };
  const hasher = new BlockHasher(record.blockSize);
  const buffer = Buffer.alloc(Math.min(record.blockSize, 1 << 20));
  let at = 0;
  while (at < from) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, from - at), at);
    if (bytesRead <= 0) return { ok: false, why: `the partial ended at ${at} while reading back ${from} bytes` };
    const piece = buffer.subarray(0, bytesRead);
    hasher.update(piece);
    digest.primeChunk(piece);
    at += bytesRead;
  }
  const mine = hasher.finish();
  for (let i = 0; i < n; i += 1) {
    if (mine[i] !== record.digests[i]) return { ok: false, why: `block ${i} of the partial changed since it was verified` };
  }
  digest.finishPriming(from);
  if (st.size > from) await handle.truncate(from);
  return { ok: true, from };
}
