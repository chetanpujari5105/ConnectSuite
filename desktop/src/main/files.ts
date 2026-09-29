import { createHash } from 'node:crypto';
import { BlockPullVerifier, blockPlanFor } from '../shared/fsBlocks';
import { createReadStream, promises as fsp } from 'node:fs';
import { basename, join } from 'node:path';
import { MessageType, type PhoneResult } from '../shared/protocol';
import type { BulkClient } from './bulk';
import { ensureReceiveFolder } from './downloads';
import { sanitizeShareName } from '../shared/shareNames';
import { spaceNeeded } from './shareDestination';

// `shared/filesRoots.ts` is a plain script, not a module — it has to be loadable by a `<script>` tag
// in the CSP-locked renderer, so it has no top-level `export` and a `module.exports` shim instead.
// Same file, three consumers; `pushOffered` must have one home because it has two readers.
const sharedRoots = require('../shared/filesRoots') as {
  pushOffered: (raw: unknown) => boolean;
};
import { ask, rows, FS_LIST_TIMEOUT_MS } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

/** Where a pulled file landed on this Mac, and what it cost to get here. */
export interface PullOutcome {
  ok: boolean;
  path?: string;
  bytes?: number;
  elapsedMs?: number;
  /** Whether a digest agreed in advance actually matched. `false` means nobody checked. */
  verified?: boolean;
  /** How it was verified: a digest agreed before (`prehash`), or block by block (`blocks`, `fs.blocks`). */
  verifiedBy?: 'prehash' | 'blocks';
  reason?: string;
  fixHint?: string;
  code?: string;
}

/** What a push attempt reports back to the renderer. The phone's verdict arrives separately. */
export interface PushOutcome {
  ok: boolean;
  transferId?: string;
  bytes?: number;
  elapsedMs?: number;
  reason?: string;
  fixHint?: string;
  code?: string;
  resumedFrom?: number;
}

/**
 * Read size for hashing a file before a push. 1 MiB reads hash at ≈ 1.7 GB/s on this Mac against
 * ≈ 0.95 GB/s with the stream default of 64 KiB (measured 2026-09-29, 256 MiB and 1 GiB files).
 */
const DIGEST_READ_BYTES = 1024 * 1024;

/** The phone's batch cap, from `docs/protocol.md`. Asking for more is refused, not truncated. */
const FS_THUMB_BATCH = 32;

/**
 * The Mac's half of Files — both directions now, and the two clients they run on.
 *
 * ### Four verbs on the control channel, two on the bulk socket
 *
 * `roots` and `list` are `fs.list`; [pull] and [push] each agree a transfer on the control channel
 * and then hand the `transferId` to [BulkClient]. That split is the protocol's, not a convenience:
 * the control channel decides *what* moves and the bulk socket moves it, and nothing about the
 * second step is specific to Files — `media.original` hands the same client the same shape.
 *
 * ### This client does not gate itself on the capability
 *
 * Same rule `PhotosClient` follows and for the same reason: gating would turn a partly-working
 * feature into a dead one. The pane draws what the phone says, including the phone's own sentence
 * when `files` is not advertised. The one thing that *is* gated is the upload affordance, and it is
 * gated on the phone's own `push` field rather than on this client's existence.
 */
export class FilesClient {
  private listCount = 0;
  private rootsCount = 0;
  private failures = 0;

  constructor(
    private readonly link: () => LinkClient | null,
    private readonly bulk: () => BulkClient | null,
    private readonly session: () => { host: string | null; token: string | null },
  ) {}

  /** Whether the phone said it will receive files. Absent in the roots ack means **no**. */
  private pushServed = false;

  pushAvailable(): boolean {
    return this.pushServed;
  }

  /**
   * The roots, from `fs.list` with no `rootId`. There is no `fs.roots` and there should not be one.
   *
   * `grantHint` is rendered verbatim and never parsed — the same standing the capability
   * `unavailable` strings have.
   */
  async roots(): Promise<
    PhoneResult<{ roots: FsRootRow[]; grantHint: string | null; push: boolean }>
  > {
    const result = await ask(
      this.link(),
      'files',
      MessageType.FS_LIST,
      {},
      (payload) => ({
        roots: rows(payload, 'roots').map(toRoot),
        grantHint: typeof payload.grantHint === 'string' ? payload.grantHint : null,
        // Absent means false. Every phone built before push shipped omits this, and reading a
        // missing field as "unknown" would end with a drop target over a phone that cannot receive.
        push: sharedRoots.pushOffered(payload.push),
      }),
    );
    if (result.ok) {
      this.rootsCount += 1;
      this.pushServed = result.data.push;
      // The success line, with the denominator beside it — a count on its own reads as whichever
      // story the reader already believes.
      log.info(
        'files',
        `fs.list roots → ${result.data.roots.length} root(s): ` +
          `${result.data.roots.map((r) => r.rootId).join(', ')} — ` +
          `${this.rootsCount} ok / ${this.failures} failed since start`,
      );
    } else {
      this.failures += 1;
      log.warn(
        'files',
        `fs.list roots failed: ${result.reason} — ${this.rootsCount} ok / ${this.failures} failed`,
      );
    }
    return result;
  }

  /**
   * Thumbnails for `fs.*` ids, batched at the phone's cap.
   *
   * ### Why this is not `photos.thumbsFor`
   *
   * `fs.*` and `media.*` are **disjoint id spaces** — a SAF document id and a `MediaStore` `_ID`
   * name different things, and asking `media.thumb` for the former answers `ok: true` with zero
   * entries, a silent empty. That is why `fs.thumb` exists as a thirteenth message name rather than
   * a second addressing mode on an existing one.
   *
   * ### The two caches, and why a failure is remembered
   *
   * `thumbs` holds what arrived; `noThumb` holds ids the phone said have none. Both are needed:
   * without the second, every redraw of a folder of documents re-asks for thumbnails that will never
   * exist, which is 32 ids of control traffic per scroll for a permanent answer. Keyed by
   * `rootId + id` because an id is only meaningful inside its root.
   *
   * A `NO_THUMBNAIL` is **not** a failure and is not counted as one. Most files are not images.
   */
  private readonly thumbs = new Map<string, string>();
  private readonly noThumb = new Set<string>();
  private thumbsMade = 0;
  private thumbsNone = 0;
  private thumbsGone = 0;
  private thumbCacheHits = 0;

  private thumbKey(rootId: string, id: string): string {
    return `${rootId}\u0000${id}`;
  }

  async thumbsFor(
    rootId: string,
    ids: string[],
    maxEdge = 256,
  ): Promise<PhoneResult<Map<string, string>>> {
    const wanted = ids.filter((id) => {
      const key = this.thumbKey(rootId, id);
      return !this.thumbs.has(key) && !this.noThumb.has(key);
    });
    this.thumbCacheHits += ids.length - wanted.length;

    for (let i = 0; i < wanted.length; i += FS_THUMB_BATCH) {
      const batch = wanted.slice(i, i + FS_THUMB_BATCH);
      const result = await ask(
        this.link(),
        'files',
        MessageType.FS_THUMB,
        { rootId, ids: batch, maxEdge },
        (payload) =>
          rows(payload, 'thumbs').map((row) => ({
            id: String(row.id ?? ''),
            data: typeof row.data === 'string' ? row.data : null,
            error: typeof row.error === 'string' ? row.error : null,
          })),
      );
      if (!result.ok) return result;
      for (const thumb of result.data) {
        const key = this.thumbKey(rootId, thumb.id);
        if (thumb.data) {
          this.thumbs.set(key, thumb.data);
          this.thumbsMade += 1;
        } else {
          this.noThumb.add(key);
          if (thumb.error === 'NOT_FOUND') this.thumbsGone += 1;
          else this.thumbsNone += 1;
        }
      }
    }

    // Made beside both ways of having none, and the cache hits beside all three: a hit rate with no
    // misses next to it cannot tell a warm cache from one nothing consults.
    log.info(
      'files',
      `fs.thumb ${rootId} → ${this.thumbsMade} made / ${this.thumbsNone} without one / ` +
        `${this.thumbsGone} gone / ${this.thumbCacheHits} from cache, since start`,
    );

    const answer = new Map<string, string>();
    for (const id of ids) {
      const data = this.thumbs.get(this.thumbKey(rootId, id));
      if (data) answer.set(id, data);
    }
    return { ok: true, data: answer };
  }

  /**
   * One page of a directory.
   *
   * The cursor is `(afterName, afterId)` from the **last entry received**, echoed back untouched.
   * Rebuilding it from anything else is how a page boundary starts skipping entries that share a
   * display name — which a `DocumentsProvider` does not promise are unique, and whose row order is
   * not ours.
   */
  async list(options: {
    rootId: string;
    path?: string;
    limit?: number;
    afterName?: string;
    afterId?: string;
  }): Promise<PhoneResult<{ entries: FsEntryRow[]; hasMore: boolean }>> {
    const startedAt = Date.now();
    const result = await ask(
      this.link(),
      'files',
      MessageType.FS_LIST,
      {
        rootId: options.rootId,
        path: options.path ?? '',
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.afterName !== undefined
          ? { afterName: options.afterName, afterId: options.afterId }
          : {}),
      },
      (payload) => ({
        entries: rows(payload, 'entries').map(toEntry),
        hasMore: payload.hasMore === true,
      }),
      FS_LIST_TIMEOUT_MS,
    );
    if (result.ok) {
      this.listCount += 1;
      // A green pager needs a clock beside it — defect 55. The elapsed time is on the line because
      // `limit` bounds the frame and never the work, and a slow page is invisible behind a spinner.
      log.info(
        'files',
        `fs.list ${options.rootId}/${options.path ?? ''} → ${result.data.entries.length} entries, ` +
          `hasMore=${result.data.hasMore}, ${Date.now() - startedAt} ms — ` +
          `${this.listCount} ok / ${this.failures} failed since start`,
      );
    } else {
      this.failures += 1;
      log.warn('files', `fs.list ${options.rootId} failed: ${result.reason}`);
    }
    return result;
  }

  /**
   * Copies one file from the phone to this Mac. The other half of push, and what drag to Finder
   * needs before Finder will take anything.
   *
   * ### It lands in a real folder, not a temporary one
   *
   * `~/Downloads/Sidekick`, the same folder `media.original` uses, with a suffixed name rather
   * than an overwrite. A drag that handed Finder a file in `/tmp` would work and then evaporate:
   * the user drops it into a folder, macOS moves or copies it, and the copy they keep points at
   * something the next reboot deletes. A file the user can find again without this app running is
   * the only honest thing to hand them.
   *
   * ### `verified` is the phone's word and is passed through, not upgraded
   *
   * Above the phone's 64 MB pre-hash ceiling no digest is agreed, and `verified: false` says so.
   * Defect 56 is what happens when a receiver treats "nothing checked it" as "it is fine", and this
   * side must not repeat it in the other direction: the pull's own length check is
   * `bulk.pull`'s, and this reports what it was told.
   */
  async pull(options: {
    rootId: string;
    id: string;
    name: string;
    size: number;
  }): Promise<PullOutcome> {
    const link = this.link();
    if (!link?.isConnected()) return { ok: false, reason: 'The phone is not connected.' };
    const bulk = this.bulk();
    const { host, token } = this.session();
    if (!bulk || !host || !token) {
      return { ok: false, reason: 'The file channel is not ready.' };
    }

    // Settled before the phone is asked, so an unavailable receive folder refuses here rather than
    // leaving the phone holding an agreed transfer nobody claims.
    const ready = await ensureReceiveFolder();
    if (!ready.ok) {
      log.warn('files', `pull of ${options.name} refused on this Mac: receive folder unavailable`);
      return { ok: false, reason: ready.reason, fixHint: ready.fixHint };
    }

    // Room first (large-file increment L3): a pull that cannot fit is refused before the phone is asked,
    // with the numbers, rather than failing part-way through a multi-gigabyte file.
    const short = await pullSpaceRefusal(ready.folder, options.size);
    if (short) {
      log.warn('files', `pull of ${options.name} refused on this Mac: ${short}`);
      return { ok: false, reason: short };
    }

    const agreed = await ask(
      link,
      'files',
      MessageType.FS_TRANSFER_BEGIN,
      { direction: 'pull', rootId: options.rootId, id: options.id },
      (payload) => ({
        transferId: String(payload.transferId ?? ''),
        size: typeof payload.size === 'number' ? payload.size : options.size,
        sha256: payload.sha256 == null ? null : String(payload.sha256),
        blockSize: typeof payload.blockSize === 'number' ? payload.blockSize : null,
        blockCount: typeof payload.blockCount === 'number' ? payload.blockCount : null,
      }),
    );
    if (!agreed.ok) {
      this.failures += 1;
      log.warn('files', `pull of ${options.name} refused: ${agreed.reason}`);
      return {
        ok: false,
        reason: agreed.reason,
        ...(agreed.fixHint ? { fixHint: agreed.fixHint } : {}),
        ...(agreed.code ? { code: agreed.code } : {}),
      };
    }

    // `fs.blocks` (docs/protocol.md → Block-verified, resumable pulls): only on a session that
    // negotiated it, and only with block fields that match the shared rule exactly. Block fields from a
    // session that did not negotiate it are ignored and logged (rule S1).
    const blocksPlan = blockPlanFor(link.negotiated(), agreed.data);
    if (blocksPlan.kind === 'refused') {
      this.failures += 1;
      log.warn('files', `pull of ${options.name} refused on this Mac: ${blocksPlan.why}`);
      await link.request(MessageType.FS_TRANSFER_CANCEL, { transferId: agreed.data.transferId, reason: 'bad-request' }, 5_000).catch(() => undefined);
      return { ok: false, reason: 'The phone described the file in a way this Mac cannot check, so nothing was fetched.' };
    }
    if (blocksPlan.kind === 'ignored') log.warn('files', `pull of ${options.name}: ${blocksPlan.why}`);
    const verifier = blocksPlan.kind === 'blocks'
      ? new BlockPullVerifier(agreed.data.size, blocksPlan.blockSize, blocksPlan.blockCount)
      : undefined;
    const transferId = agreed.data.transferId;
    const onMessage = (envelope: unknown): void => {
      const m = envelope as { type?: string; payload?: Record<string, unknown> };
      if (!verifier || m?.payload?.transferId !== transferId) return;
      if (m.type === MessageType.FS_TRANSFER_BLOCKS) verifier.onBlocks(m.payload);
      if (m.type === MessageType.FS_TRANSFER_DONE) verifier.onDone(m.payload);
    };
    if (verifier) link.on('message', onMessage);

    const destination = await pullDestination(ready.folder, options.name);

    const result = await bulk
      .pull({
        host,
        token,
        transferId,
        destination,
        expectedBytes: agreed.data.size,
        expectedSha256: agreed.data.sha256,
        ...(verifier ? { blocks: verifier } : {}),
      })
      .finally(() => {
        if (verifier) link.off('message', onMessage);
      });
    if (!result.ok) {
      this.failures += 1;
      log.warn('files', `pull of ${options.name} did not finish: ${result.reason}`);
      return { ok: false, reason: result.reason ?? 'The transfer did not finish.' };
    }
    const verified = result.verified;
    log.info(
      'files',
      `pulled ${options.name} (${result.bytes} bytes) to ${result.path}, ` +
        `verified=${verified} ` +
        (result.verifiedBy === 'blocks'
          ? '(block by block: every block matched what the phone read)'
          : verified ? '(agreed in advance and matched)' : '(no digest was agreed in advance)'),
    );
    return {
      ok: true,
      path: result.path!,
      bytes: result.bytes,
      elapsedMs: result.elapsedMs,
      verified,
      ...(result.verifiedBy ? { verifiedBy: result.verifiedBy } : {}),
    };
  }

  /**
   * Sends one local file to a folder the phone has shared.
   *
   * ### The verdict is not decided here, and that is deliberate
   *
   * This resolves when the bytes are written. **Whether they were right is the phone's to say**, on
   * `fs.transfer.done` over the control channel, because the phone is the receiver and the receiver
   * is the side that hashes what actually landed. A Mac that reported success here would be saying
   * *I finished sending*, dressed as *the file is on the phone* — the same collapse `verified`
   * exists to prevent on a pull.
   *
   * ### The digest is computed before anything is agreed
   *
   * The phone compares what lands against this number, so it must be over the whole file and must
   * exist before `fs.transfer.begin`. **It is computed for every size.** Until 2026-09-29 files above
   * 64 MiB were sent with no digest and arrived `verified: false`, on the reasoning that hashing
   * first reads the file twice. Measured, that second read is ≈ 2% of the transfer: this Mac hashes at
   * ≈ 1.7 GB/s and the wire moves ≈ 40 MB/s — a 4 GB video costs ≈ 2.5 s of hashing against ≈ 100 s of
   * sending. An unverified file is not worth 2%.
   *
   * A caller that retries under another name passes [sha256] so the file is read once, not once per
   * attempt; `null` there means the caller's own hash failed and the push goes unverified, logged.
   *
   * ### `overwrite` is not sent unless the caller asked for it
   *
   * The phone refuses with `TARGET_STALE` when something is already at that name, and that refusal
   * is the only thing between a push and a file the user already had. Defaulting it here would
   * remove the protection from the side that does not own the data.
   */
  async push(options: {
    rootId: string;
    path: string;
    source: string;
    overwrite?: boolean;
    /**
     * The name to ask the phone for, when it is not the file's own — a collision retry sends
     * `name (2).ext`. Absent means the local file's basename, which is what every push sent before.
     */
    name?: string;
    /**
     * Told the `transferId` the moment the phone acks, **before** the bytes move.
     *
     * Without it the renderer learns the id only when the push resolves, which is after every
     * `fs.transfer.progress` for that id has already gone past unrecognised — and the only progress
     * left to draw would be this Mac's own write count, which is bytes queued, not bytes delivered.
     */
    onAgreed?: (transferId: string, name: string) => void;
    /**
     * The file's digest, when the caller already computed it ([digestOf]). Absent: computed here.
     * `null`: the caller tried and could not read it — sent unverified, and said so in the log.
     */
    sha256?: string | null;
  }): Promise<PushOutcome> {
    const link = this.link();
    if (!link?.isConnected()) return { ok: false, reason: 'The phone is not connected.' };
    const bulk = this.bulk();
    const { host, token } = this.session();
    if (!bulk || !host || !token) {
      return { ok: false, reason: 'The file channel is not ready.' };
    }

    const name = options.name ?? basename(options.source);
    let size: number;
    try {
      size = (await fsp.stat(options.source)).size;
    } catch (error) {
      return { ok: false, reason: `Could not read ${name}: ${(error as Error).message}` };
    }

    const sha256 = options.sha256 !== undefined ? options.sha256 : (await digestOf(options.source)).sha256;
    if (sha256 === null) {
      log.warn(
        'files',
        `${name} (${size} bytes) could not be read to hash it, so no digest was agreed and this ` +
          'transfer will report verified=false',
      );
    }

    const agreed = await ask(
      link,
      'files',
      MessageType.FS_TRANSFER_BEGIN,
      {
        direction: 'push',
        rootId: options.rootId,
        path: options.path,
        name,
        size,
        ...(sha256 ? { sha256 } : {}),
        ...(options.overwrite ? { overwrite: true } : {}),
      },
      (payload) => ({
        transferId: String(payload.transferId ?? ''),
        offset: typeof payload.offset === 'number' ? payload.offset : 0,
        chunkMax: typeof payload.chunkMax === 'number' ? payload.chunkMax : 262144,
      }),
    );
    if (!agreed.ok) {
      this.failures += 1;
      log.warn('files', `push of ${name} refused: ${agreed.reason}`);
      return {
        ok: false,
        reason: agreed.reason,
        ...(agreed.fixHint ? { fixHint: agreed.fixHint } : {}),
        ...(agreed.code ? { code: agreed.code } : {}),
      };
    }

    options.onAgreed?.(agreed.data.transferId, name);

    const result = await bulk.push({
      host,
      token,
      transferId: agreed.data.transferId,
      source: options.source,
      offset: agreed.data.offset,
      totalBytes: size,
      chunkMax: agreed.data.chunkMax,
    });
    if (result.ok) {
      log.info(
        'files',
        `pushed ${name} (${result.bytes} bytes) to ${options.rootId}/${options.path}` +
          `${agreed.data.offset > 0 ? `, resumed from ${agreed.data.offset}` : ''}; the phone ` +
          'reports the verdict on fs.transfer.done',
      );
    } else {
      this.failures += 1;
    }
    return {
      ok: result.ok,
      transferId: agreed.data.transferId,
      bytes: result.bytes,
      elapsedMs: result.elapsedMs,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(agreed.data.offset > 0 ? { resumedFrom: agreed.data.offset } : {}),
    };
  }
}

/** What hashing a file produced: the digest, or why there is none. */
export interface DigestResult {
  sha256: string | null;
  /** Bytes read — the denominator for a digest that stopped early. */
  bytes: number;
  aborted: boolean;
  error?: string;
}

/**
 * SHA-256 of a whole file, read [DIGEST_READ_BYTES] at a time.
 *
 * `onProgress` is called with the bytes hashed so far, at most every `progressEveryMs`, so a multi-
 * gigabyte file shows movement rather than a silent pause before its first byte is sent. `signal`
 * stops the read: a person who presses Stop on a 100 GB file should not wait a minute for a hash of
 * a file they no longer want sent.
 */
export async function digestOf(
  path: string,
  options: { onProgress?: (bytes: number) => void; signal?: AbortSignal; progressEveryMs?: number } = {},
): Promise<DigestResult> {
  const every = options.progressEveryMs ?? 250;
  return new Promise((resolve) => {
    let bytes = 0;
    let settled = false;
    const finish = (result: DigestResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    if (options.signal?.aborted) {
      finish({ sha256: null, bytes: 0, aborted: true });
      return;
    }
    const hash = createHash('sha256');
    const stream = createReadStream(path, { highWaterMark: DIGEST_READ_BYTES });
    const onAbort = () => {
      stream.destroy();
      finish({ sha256: null, bytes, aborted: true });
    };
    options.signal?.addEventListener('abort', onAbort);
    let lastReport = Date.now();
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
      const now = Date.now();
      if (options.onProgress && now - lastReport >= every) {
        lastReport = now;
        options.onProgress(bytes);
      }
    });
    stream.on('end', () => finish({ sha256: hash.digest('hex'), bytes, aborted: false }));
    stream.on('error', (error) => finish({ sha256: null, bytes, aborted: false, error: error.message }));
  });
}

function toRoot(row: Record<string, unknown>): FsRootRow {
  return {
    rootId: String(row.rootId ?? ''),
    label: String(row.label ?? ''),
    // An unrecognised `kind` is carried through and shown plainly. `all` is reserved on the wire and
    // this build never sees it; discarding a root we do not recognise would hide storage from the
    // user because we did not know a word.
    kind: String(row.kind ?? 'tree'),
    writable: row.writable === true,
    freeBytes: typeof row.freeBytes === 'number' ? row.freeBytes : null,
  };
}

function toEntry(row: Record<string, unknown>): FsEntryRow {
  return {
    id: String(row.id ?? ''),
    // Always the real path component: it is what the Mac sends back to navigate. Only the label is
    // a sentence, and prettifying this would break navigation.
    name: String(row.name ?? ''),
    dir: row.dir === true,
    size: typeof row.size === 'number' ? row.size : 0,
    mtimeMs: typeof row.mtimeMs === 'number' ? row.mtimeMs : 0,
    mime: String(row.mime ?? 'application/octet-stream'),
    ...(typeof row.packageName === 'string' ? { packageName: row.packageName } : {}),
    ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
  };
}

/**
 * `name`, or `name (2)`, `name (3)` — the first that does not exist.
 *
 * The same rule `PhotosClient` uses and for the same reason: two files really can share a display
 * name across folders, and replacing one someone already pulled is a decision that belongs to them.
 */
/**
 * Whether [folder] can take a pull of [size] bytes, by the share path's own rule (`spaceNeeded`: the
 * size plus the larger of 256 MiB and a tenth) so both directions into this Mac judge room the same
 * way. Returns the sentence a person reads when it cannot, or null. A free-space reading that fails is
 * **not** a refusal: the pull proceeds and the write reports its own error, because refusing on an
 * unreadable number would block every pull on a folder whose `statfs` is unsupported.
 */
export async function pullSpaceRefusal(
  folder: string,
  size: number,
  statfs: (p: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }> = (p) => fsp.statfs(p),
): Promise<string | null> {
  if (!Number.isFinite(size) || size <= 0) return null;
  let free: number;
  try {
    const s = await statfs(folder);
    free = Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
  if (!Number.isFinite(free)) return null;
  const need = spaceNeeded(size);
  if (free >= need) return null;
  return `There isn't room on this Mac for that file: it needs ${gib(need)} free in the receive folder and has ${gib(free)}. Nothing was copied.`;
}

/** Decimal units, as Finder counts them (and as the receive window does). */
function gib(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.ceil(n / 1e6)} MB`;
}

/**
 * Where a file the phone names is pulled to: a free name **inside** [folder].
 *
 * The name is the phone's, and `join(folder, '../x')` leaves the folder — so it is re-sanitised with
 * the share path's rules (`/` and `:` become `-`, a leading `.` becomes `_`, control and bidi
 * characters dropped) before a free name is chosen. Files and Photos both come through here.
 */
export async function pullDestination(folder: string, phoneName: string): Promise<string> {
  return freeName(folder, sanitizeShareName(phoneName));
}

async function freeName(folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n += 1) {
    const candidate = join(folder, n === 1 ? name : `${stem} (${n})${extension}`);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
  // A thousand collisions on one name is not a case worth a cleverer scheme; the timestamp is
  // unique enough and says plainly that something unusual happened.
  return join(folder, `${stem} (${Date.now()})${extension}`);
}

