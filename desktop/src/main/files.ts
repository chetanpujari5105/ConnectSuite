import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import { basename } from 'node:path';
import { MessageType, type PhoneResult } from '../shared/protocol';
import type { BulkClient } from './bulk';

// `shared/filesRoots.ts` is a plain script, not a module — it has to be loadable by a `<script>` tag
// in the CSP-locked renderer, so it has no top-level `export` and a `module.exports` shim instead.
// Same file, three consumers; `pushOffered` must have one home because it has two readers.
const sharedRoots = require('../shared/filesRoots') as {
  pushOffered: (raw: unknown) => boolean;
};
import { ask, rows } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of Files — the read verbs the pane needs, and nothing it must not offer.
 *
 * ### `push` is not here, and its absence is the feature
 *
 * `fs.transfer.begin` with `direction: "push"` answers `FEATURE_UNAVAILABLE` on this build.
 * `docs/protocol.md` states the consequence for this side directly — *"A Files pane must not draw an
 * upload affordance against this build"* — so there is no upload method on this client at all.
 * Having one that always failed would put the decision in the renderer, where the canvas's drop tile
 * would eventually be wired to it.
 *
 * ### This client does not gate itself on the capability
 *
 * Same rule `PhotosClient` follows and for the same reason: gating would turn a partly-working
 * feature into a dead one. The pane draws what the phone says, including the phone's own sentence
 * when `files` is not advertised.
 */
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
 * The ceiling above which a file is sent without a digest agreed in advance.
 *
 * The same number the phone uses on a pull, for the same reason: hashing first means reading the
 * file twice, and a 4 GB video would hold the control channel for the length of a full read with no
 * progress to report. Above it the transfer is honest about being unverified rather than silently
 * downgraded.
 */
const PREHASH_CEILING = 64 * 1024 * 1024;

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
   * exist before `fs.transfer.begin`. Above [PREHASH_CEILING] it is skipped, the phone is told
   * nothing, and `fs.transfer.done` reports `verified: false`.
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
  }): Promise<PushOutcome> {
    const link = this.link();
    if (!link?.isConnected()) return { ok: false, reason: 'The phone is not connected.' };
    const bulk = this.bulk();
    const { host, token } = this.session();
    if (!bulk || !host || !token) {
      return { ok: false, reason: 'The file channel is not ready.' };
    }

    const name = basename(options.source);
    let size: number;
    try {
      size = (await fsp.stat(options.source)).size;
    } catch (error) {
      return { ok: false, reason: `Could not read ${name}: ${(error as Error).message}` };
    }

    const sha256 = size <= PREHASH_CEILING ? await digestOf(options.source) : null;
    if (sha256 === null) {
      log.info(
        'files',
        `${name} is ${size} bytes; no digest was agreed in advance, so this transfer will report ` +
          'verified=false',
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

async function digestOf(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
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
