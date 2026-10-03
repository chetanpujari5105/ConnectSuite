import { createHash } from 'node:crypto';
import { BLOCK_PULL_ABOVE_BYTES, BlockPullVerifier, blockCountFor, blockPlanFor, rootOf } from '../shared/fsBlocks';
import { FS_BLOCKS } from '../shared/extensions';
import { TransferDigest } from '../shared/transferDigest';
import { createPartialExclusive, deleteOwnedPartial, openOwnedPartial, ownedPartial, PullResumeStore, verifyAndTrimPrefix, type ResumeRecord } from './pullResume';
import type { FileHandle } from 'node:fs/promises';
import { pullPartPathFor } from '../shared/transferFiles';
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
import { SESSION_ENDED_EVENT, type SessionEnded } from '../shared/session';

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
  /** A block pull that stopped with its owned partial and record kept — it can be resumed. */
  paused?: boolean;
  /** Paused because this Mac's destination ran low on space. */
  noSpace?: boolean;
  /** The person cancelled; the owned partial and record are gone. */
  cancelled?: boolean;
  /** The phone's file changed; nothing was saved and the partial is gone. */
  sourceChanged?: boolean;
  /** Where a resumed pull started. */
  resumedFrom?: number;
  /**
   * Who or what stopped a paused pull (defect 165): the person (it waits for Resume), an interruption
   * (it also continues by itself on a reconnect within [AUTO_RESUME_WINDOW_MS]), or low space. The pane
   * words each once, so a `reason` here is a clause, never a second "kept" sentence.
   */
  stoppedBy?: 'person' | 'interruption' | 'no-space';
  /**
   * The phone refused this pull's resume in its ack, the old partial was discarded, and the pull really
   * did start again from byte 0 — the only case in which "started again from the beginning" is true.
   * `why` is the phone's (`source-changed`), or `not-accepted-as-asked`.
   */
  restarted?: { why: string };
}

/** How often an in-flight block pull saves its verified count. */
export const RECORD_SAVE_EVERY_MS = 2_000;
/** Why a pull stopped when its session ended (defect 157). An interruption: kept, and resumable. */
export const SESSION_ENDED_REASON = 'the connection to the phone ended';

/** A pull interrupted less than this long ago resumes on reconnect without a click (same run only). */
export const AUTO_RESUME_WINDOW_MS = 10 * 60 * 1000;

interface PreparedResume { record: ResumeRecord; handle: FileHandle; digest: TransferDigest; from: number }
interface OwnedPull { record: ResumeRecord; handle: FileHandle; digest: TransferDigest; from: number }

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
    private readonly extra: {
      /** `fs.blocks` resume: the record store, and the paired phone's pinned fingerprint that keys it. */
      resume?: { store: () => PullResumeStore | null; phone: () => string | null };
      now?: () => number;
      /** Tests only: where pulls land. The product uses the configured receive folder. */
      receiveFolder?: typeof ensureReceiveFolder;
      /** A pull was agreed: its `transferId`, so the pane can offer Pause and Cancel for it. */
      onPullAgreed?: (info: { transferId: string; rootId: string; id: string; name: string; resumedFrom: number; blocks: boolean }) => void;
    } = {},
  ) {}

  private get resume() {
    return this.extra.resume;
  }

  private now(): number {
    return (this.extra.now ?? Date.now)();
  }

  /** Block pulls in flight, for Pause and Cancel. */
  private readonly active = new Map<string, { abort: AbortController; name: string; record: ResumeRecord | null }>();
  private readonly cancelled = new Set<string>();
  /** Paused by the person: kept, but never resumed without a click (only interruptions are). */
  private readonly pausedByPerson = new Set<string>();
  /** Pulls interrupted in this run, for the 10-minute automatic resume on reconnect. */
  private readonly interrupted = new Map<string, { options: { rootId: string; id: string; name: string; size: number }; atMs: number }>();

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
    const ready = await (this.extra.receiveFolder ?? ensureReceiveFolder)();
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

    // `fs.blocks` (docs/protocol.md → Block-verified, resumable pulls): decided before the phone is asked,
    // because a resume is part of the request. Only on a negotiated session, above 64 MiB, with a store.
    const phone = this.resume?.phone() ?? null;
    const blocksExpected = (link.negotiated()[FS_BLOCKS] ?? 0) >= 1 && options.size > BLOCK_PULL_ABOVE_BYTES && !!this.resume && !!phone;
    const store = this.resume?.store();
    let prepared: PreparedResume | null = null;
    if (blocksExpected && store && phone) {
      await store.sweep(this.now());
      const record = await store.find(phone, options.rootId, options.id);
      if (record) prepared = await this.prepareResume(store, record);
      if (!prepared) {
        const room = await store.reserve(this.now());
        if (!room.ok) {
          log.warn('files', `pull of ${options.name} refused on this Mac: ${room.why}`);
          return { ok: false, reason: room.why };
        }
      }
    }
    const resumeRequest = prepared
      ? {
          resume: {
            size: prepared.record.size,
            mtimeMs: prepared.record.mtimeMs,
            blockSize: prepared.record.blockSize,
            verifiedBlocks: prepared.record.digests.length,
            prefixRoot: rootOf(prepared.record.digests),
          },
        }
      : {};

    const agreed = await ask(
      link,
      'files',
      MessageType.FS_TRANSFER_BEGIN,
      { direction: 'pull', rootId: options.rootId, id: options.id, ...resumeRequest },
      (payload) => ({
        transferId: String(payload.transferId ?? ''),
        size: typeof payload.size === 'number' ? payload.size : options.size,
        mtimeMs: typeof payload.mtimeMs === 'number' ? payload.mtimeMs : null,
        sha256: payload.sha256 == null ? null : String(payload.sha256),
        blockSize: typeof payload.blockSize === 'number' ? payload.blockSize : null,
        blockCount: typeof payload.blockCount === 'number' ? payload.blockCount : null,
        resume: (payload.resume && typeof payload.resume === 'object' ? payload.resume : null) as { accepted?: unknown; from?: unknown; why?: unknown } | null,
      }),
    );
    if (!agreed.ok) {
      this.failures += 1;
      await prepared?.handle.close().catch(() => undefined);
      log.warn('files', `pull of ${options.name} refused: ${agreed.reason}`);
      return {
        ok: false,
        reason: agreed.reason,
        ...(agreed.fixHint ? { fixHint: agreed.fixHint } : {}),
        ...(agreed.code ? { code: agreed.code } : {}),
      };
    }

    // Only on a session that negotiated it, and only with block fields that match the shared rule
    // exactly. Block fields from a session that did not negotiate it are ignored and logged (rule S1).
    const blocksPlan = blockPlanFor(link.negotiated(), agreed.data);
    if (blocksPlan.kind === 'refused') {
      this.failures += 1;
      await prepared?.handle.close().catch(() => undefined);
      log.warn('files', `pull of ${options.name} refused on this Mac: ${blocksPlan.why}`);
      await link.request(MessageType.FS_TRANSFER_CANCEL, { transferId: agreed.data.transferId, reason: 'bad-request' }, 5_000).catch(() => undefined);
      return { ok: false, reason: 'The phone described the file in a way this Mac cannot check, so nothing was fetched.' };
    }
    if (blocksPlan.kind === 'ignored') log.warn('files', `pull of ${options.name}: ${blocksPlan.why}`);
    const transferId = agreed.data.transferId;

    // The owned partial and its record: the prepared resume if the phone accepted exactly it, else a
    // fresh exclusive partial under a free name (the refused one is discarded only if it is ours).
    let owned: OwnedPull | null = null;
    let restartedWhy: string | null = null;
    if (blocksPlan.kind === 'blocks' && store && phone) {
      const r = agreed.data.resume;
      const acceptedHere = prepared !== null && r?.accepted === true && r.from === prepared.from &&
        agreed.data.size === prepared.record.size && agreed.data.mtimeMs === prepared.record.mtimeMs &&
        blocksPlan.blockSize === prepared.record.blockSize;
      if (prepared && acceptedHere) {
        owned = { record: prepared.record, handle: prepared.handle, digest: prepared.digest, from: prepared.from };
        // Not "re-hashed by the phone": the phone's acceptance is provisional until it has re-hashed the
        // prefix on the bulk thread, and that verdict has not arrived yet (defect 158).
        log.info('files', `pull of ${options.name} resumes at ${prepared.from} of ${agreed.data.size} bytes (${prepared.record.digests.length} blocks verified on this Mac; the phone accepted provisionally and re-hashes them before sending)`);
      } else {
        if (prepared) {
          await prepared.handle.close().catch(() => undefined);
          restartedWhy = r?.accepted === false ? String(r.why ?? 'source-changed') : 'not-accepted-as-asked';
          const partial = await store.discard(prepared.record, true);
          log.info('files', `pull of ${options.name}: the phone ${r?.accepted === false ? `refused the resume (${String(r.why)})` : 'did not accept the resume as asked'}; starting again from 0; old ${partial}`);
        }
        owned = await this.freshOwned(store, phone, options, ready.folder, agreed.data, blocksPlan.blockSize);
      }
    } else if (prepared) {
      await prepared.handle.close().catch(() => undefined);
      log.info('files', `pull of ${options.name}: the phone did not take the block path this time; the paused record is kept`);
    }

    const verifier = blocksPlan.kind === 'blocks'
      ? new BlockPullVerifier(agreed.data.size, blocksPlan.blockSize, blocksPlan.blockCount, owned?.record.digests ?? [])
      : undefined;
    const onMessage = (envelope: unknown): void => {
      const m = envelope as { type?: string; payload?: Record<string, unknown> };
      if (!verifier || m?.payload?.transferId !== transferId) return;
      // Only the session this pull was agreed on speaks for it: a transfer id belongs to its session, and
      // a verdict surfacing on a replacement one is not this pull's (defect 158).
      if (link.token() !== token) return;
      if (m.type === MessageType.FS_TRANSFER_BLOCKS) verifier.onBlocks(m.payload);
      if (m.type === MessageType.FS_TRANSFER_DONE) verifier.onDone(m.payload);
    };
    if (verifier) link.on('message', onMessage);

    const destination = owned ? owned.record.destination : await pullDestination(ready.folder, options.name);
    this.extra.onPullAgreed?.({ transferId, rootId: options.rootId, id: options.id, name: options.name, resumedFrom: owned?.from ?? 0, blocks: verifier !== undefined });
    const abort = new AbortController();
    this.active.set(transferId, { abort, name: options.name, record: owned?.record ?? null });
    // The pull is bound to the session its socket claims with. When that session ends — a user
    // Disconnect, the phone closing the link — the pull stops here at once, as an **interruption**:
    // not the person's Pause (manual resume only) and not Cancel (which deletes), so the owned partial
    // and its record are kept and a reconnect within 10 minutes resumes it. Without this the phone
    // streamed on and the Mac waited 30 s for a verdict the dead session could never carry (defect
    // 157). A replacement session has a different token and is left alone.
    const onSessionEnded = (ended: SessionEnded): void => {
      if (ended.token !== token || abort.signal.aborted) return;
      log.info('files', `pull ${transferId} (${options.name}) stopped: the session it ran on ended (${ended.reason}); what has arrived is kept`);
      abort.abort(SESSION_ENDED_REASON);
    };
    link.on(SESSION_ENDED_EVENT, onSessionEnded);
    // The session may already have ended while this pull was being agreed, before anything listened.
    // Who ended it is not known here, so it is not claimed to be this Mac (`byThisMac` is true only when known).
    if (link.token() !== token) onSessionEnded({ token, reason: 'it ended while the pull was being agreed', byThisMac: false });
    // The record follows the verified count, so an interruption loses at most a few seconds of blocks.
    // Saves run one at a time and are awaited before a discard, so a save started by the timer cannot
    // land after the record was deleted and bring a rejected record back (defect 158 widened that window).
    let saving: Promise<void> = Promise.resolve();
    const persist = async (): Promise<void> => {
      if (!owned || !verifier || !store) return;
      const record = owned.record;
      saving = saving.then(async () => {
        record.digests = verifier.verifiedDigests();
        record.updatedAtMs = this.now();
        await store.save(record).catch((e: unknown) => log.warn('files', `resume record for ${options.name} not saved: ${String(e)}`));
      });
      await saving;
    };
    const timer = owned ? setInterval(() => void persist(), RECORD_SAVE_EVERY_MS) : null;

    const result = await bulk
      .pull({
        host,
        token,
        transferId,
        destination,
        expectedBytes: agreed.data.size,
        expectedSha256: agreed.data.sha256,
        ...(verifier ? { blocks: verifier } : {}),
        signal: abort.signal,
        spaceCheck: (remaining) => pullSpaceRefusal(ready.folder, remaining),
        ...(owned
          ? {
              owned: {
                handle: owned.handle,
                offset: owned.from,
                digest: owned.digest,
                deleteOwned: () => deleteOwnedPartial(owned!.record),
              },
            }
          : {}),
      })
      .finally(() => {
        if (verifier) link.off('message', onMessage);
        link.off(SESSION_ENDED_EVENT, onSessionEnded);
        if (timer) clearInterval(timer);
        this.active.delete(transferId);
      });

    if (owned && store) {
      await saving;
      if (result.ok || result.discarded) {
        await store.discard(owned.record, result.discarded === true);
      } else if (this.cancelled.delete(transferId)) {
        const partial = await store.discard(owned.record, true);
        log.info('files', `pull of ${options.name} cancelled; ${partial}; nothing of it is kept`);
        return { ok: false, reason: 'Cancelled. Nothing was saved.', cancelled: true };
      } else {
        await persist();
        const chosen = this.pausedByPerson.delete(transferId);
        log.info('files', `pull of ${options.name} ${chosen ? 'paused by the person' : 'interrupted'} at ${owned.record.digests.length} verified blocks of ${blocksPlan.kind === 'blocks' ? blocksPlan.blockCount : '?'}; the partial and record are kept${chosen ? '; it resumes only on Resume' : ''}`);
        // Only an interruption (link drop, sleep, no verdict, low space) may resume by itself on a
        // reconnect; a Pause the person chose waits for their Resume.
        if (!chosen) this.interrupted.set(`${options.rootId}\u0000${options.id}`, { options, atMs: this.now() });
        return {
          ok: false,
          reason: result.reason ?? 'the transfer stopped',
          paused: true,
          stoppedBy: chosen ? 'person' : result.noSpace ? 'no-space' : 'interruption',
          ...(result.noSpace ? { noSpace: true } : {}),
        };
      }
    }
    if (!result.ok) {
      this.failures += 1;
      // A discarded pull (changed source, corrupt block) has nothing to resume: it must not come back on a
      // reconnect, even if an earlier interruption of it was waiting there (defect 158).
      if (result.discarded) this.interrupted.delete(`${options.rootId}\u0000${options.id}`);
      log.warn('files', `pull of ${options.name} did not finish: ${result.reason}`);
      return { ok: false, reason: result.reason ?? 'The transfer did not finish.', ...(result.sourceChanged ? { sourceChanged: true } : {}) };
    }
    this.interrupted.delete(`${options.rootId}\u0000${options.id}`);
    const verified = result.verified;
    log.info(
      'files',
      `pulled ${options.name} (${result.bytes} bytes) to ${result.path}, ` +
        `verified=${verified} ` +
        (result.verifiedBy === 'blocks'
          ? '(block by block: every block matched what the phone read)'
          : verified ? '(agreed in advance and matched)' : '(no digest was agreed in advance)') +
        (result.resumedFrom ? `, resumed from ${result.resumedFrom}` : ''),
    );
    return {
      ok: true,
      path: result.path!,
      bytes: result.bytes,
      elapsedMs: result.elapsedMs,
      verified,
      ...(result.verifiedBy ? { verifiedBy: result.verifiedBy } : {}),
      ...(result.resumedFrom ? { resumedFrom: result.resumedFrom } : {}),
      ...(restartedWhy !== null ? { restarted: { why: restartedWhy } } : {}),
    };
  }

  /** Pause (keeps the owned partial and record) or Cancel (deletes only that transfer's owned partial). */
  async stopPull(transferId: string, how: 'pause' | 'cancel'): Promise<{ stopped: boolean }> {
    const running = this.active.get(transferId);
    if (!running) return { stopped: false };
    if (how === 'cancel') this.cancelled.add(transferId);
    else this.pausedByPerson.add(transferId);
    await this.link()?.request(MessageType.FS_TRANSFER_CANCEL, { transferId, reason: how === 'cancel' ? 'user' : 'pause' }, 5_000).catch(() => undefined);
    running.abort.abort(how === 'cancel' ? 'Cancelled.' : 'Paused.');
    log.info('files', `pull ${transferId} (${running.name}) ${how === 'cancel' ? 'cancelled' : 'paused'} by the person`);
    return { stopped: true };
  }

  /** The paused block pulls this Mac holds for the paired phone (for the Files pane). */
  async pausedPulls(): Promise<Array<{ rootId: string; id: string; name: string; size: number; verifiedBytes: number; updatedAtMs: number }>> {
    const store = this.resume?.store();
    const phone = this.resume?.phone();
    if (!store || !phone) return [];
    await store.sweep(this.now());
    return (await store.all())
      .filter((r) => r.phone === phone)
      .map((r) => ({ rootId: r.rootId, id: r.id, name: r.name, size: r.size, verifiedBytes: r.digests.length * r.blockSize, updatedAtMs: r.updatedAtMs }));
  }

  /** Cancel a paused pull that is not running: its record goes, and its partial only if owned. */
  async cancelPaused(rootId: string, id: string): Promise<{ removed: boolean; partial?: string }> {
    const store = this.resume?.store();
    const phone = this.resume?.phone();
    if (!store || !phone) return { removed: false };
    const record = await store.find(phone, rootId, id);
    if (!record) return { removed: false };
    const partial = await store.discard(record, true);
    this.interrupted.delete(`${rootId}\u0000${id}`);
    log.info('files', `paused pull of ${record.name} cancelled; ${partial}`);
    return { removed: true, partial };
  }

  /**
   * Pulls interrupted in this run within the last 10 minutes — the only ones a reconnect may resume
   * without a click (docs/protocol.md). Returned and forgotten; the caller restarts each.
   */
  takeAutoResumable(): Array<{ rootId: string; id: string; name: string; size: number }> {
    const out: Array<{ rootId: string; id: string; name: string; size: number }> = [];
    for (const [key, v] of this.interrupted) {
      if (this.now() - v.atMs <= AUTO_RESUME_WINDOW_MS) out.push(v.options);
      this.interrupted.delete(key);
    }
    return out;
  }

  /** Forget or re-pair: every record for that phone goes, each partial only if owned. */
  async forgetPhone(fingerprint: string): Promise<number> {
    const store = this.resume?.store();
    this.interrupted.clear();
    return store ? store.forgetPhone(fingerprint) : 0;
  }

  /** At start: expire records older than 7 days (owned partials only). */
  async sweepResumeRecords(): Promise<number> {
    const store = this.resume?.store();
    return store ? (await store.sweep(this.now())).length : 0;
  }

  private async prepareResume(store: PullResumeStore, record: ResumeRecord): Promise<PreparedResume | null> {
    const count = blockCountFor(record.size, record.blockSize);
    // A resume must leave at least one block to send; a record verified to the end keeps all but the last.
    if (record.digests.length >= count) record.digests = record.digests.slice(0, count - 1);
    if (record.digests.length === 0) {
      const partial = await store.discard(record, true);
      log.info('files', `resume record for ${record.name} had no verified block; starting again; ${partial}`);
      return null;
    }
    const own = await ownedPartial(record);
    if (!own.owned) {
      await store.discard(record, false);
      log.warn('files', `resume record for ${record.name} dropped: ${own.why}; the file at that path was not touched`);
      return null;
    }
    let handle: FileHandle | null = null;
    try {
      handle = await openOwnedPartial(record);
      const digest = new TransferDigest();
      const v = await verifyAndTrimPrefix(handle, record, digest);
      if (!v.ok) {
        await handle.close();
        const partial = await store.discard(record, true);
        log.warn('files', `resume of ${record.name} refused on this Mac: ${v.why}; ${partial}`);
        return null;
      }
      return { record, handle, digest, from: v.from };
    } catch (e) {
      await handle?.close().catch(() => undefined);
      await store.discard(record, false);
      log.warn('files', `resume record for ${record.name} dropped: ${String(e)}; the file at that path was not touched`);
      return null;
    }
  }

  private async freshOwned(
    store: PullResumeStore,
    phone: string,
    options: { rootId: string; id: string; name: string },
    folder: string,
    ack: { size: number; mtimeMs: number | null },
    blockSize: number,
  ): Promise<OwnedPull> {
    const destination = await pullDestination(folder, options.name);
    const { handle, dev, ino } = await createPartialExclusive(pullPartPathFor(destination));
    const now = this.now();
    const record: ResumeRecord = {
      v: 1, phone, rootId: options.rootId, id: options.id, name: basename(destination), size: ack.size,
      mtimeMs: ack.mtimeMs ?? 0, blockSize, digests: [], destination, folderReal: await fsp.realpath(folder),
      partDev: dev, partIno: ino, createdAtMs: now, updatedAtMs: now,
    };
    await store.save(record);
    return { record, handle, digest: new TransferDigest(), from: 0 };
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
    // A name is free only if neither the file nor a Sidekick partial for it exists: a paused transfer's
    // partial (`fs.blocks`) may stand where no final file is yet, and a new pull choosing that name would
    // treat it as an unrecorded partial and delete it.
    const taken = async (path: string): Promise<boolean> => fsp.lstat(path).then(() => true, () => false);
    if (!(await taken(candidate)) && !(await taken(pullPartPathFor(candidate)))) return candidate;
  }
  // A thousand collisions on one name is not a case worth a cleverer scheme; the timestamp is
  // unique enough and says plainly that something unusual happened.
  return join(folder, `${stem} (${Date.now()})${extension}`);
}

