import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { ensureReceiveFolder } from './downloads';
import {
  MessageType,
  type MediaBucket,
  type MediaItem,
  type MediaOriginalTicket,
  type MediaThumb,
  type PhoneResult,
} from '../shared/protocol';
import type { BulkClient } from './bulk';
import { ask, rows } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';
import { pullDestination } from './files';

/**
 * The Mac's half of the photo browser — three verbs of four.
 *
 * `media.original` is not here. It resolves a `MediaStore` id to a transfer on the bulk channel,
 * nothing serves that channel yet, and so **the `photos` capability is not advertised** even though
 * every request in this file is answered. That is the situation the pane has to draw, and it is why
 * this client does not gate itself on the capability: a client that refused to ask because the chip
 * is grey would turn a partly-working feature into a dead one.
 *
 * ### Thumbnails are batched here rather than in the renderer
 *
 * The phone caps `ids` at 32 per request, so a 400-tile grid is a queue of batches, not one call.
 * Doing that in the renderer would put the cap in two places and let them drift; doing it here also
 * means the cache lives beside the batching that fills it. [THUMB_BATCH] must never exceed the
 * phone's own cap — it is the same number on purpose, and the phone refuses `BAD_REQUEST` above it,
 * which is the check that matters.
 */
export class PhotosClient {
  /** id → base64 JPEG. Thumbnails are immutable for an id, so this never goes stale in place. */
  private thumbs = new Map<string, string>();

  /** Ids that came back with a per-item error, so a dead tile is not asked for on every scroll. */
  private missing = new Set<string>();

  /**
   * Ids the phone has, and cannot make a thumbnail for.
   *
   * Deliberately NOT in [missing]: that set is "stop asking", which is right for a deleted photo
   * and wrong for a corrupt one — the row is listable and `media.original` may still serve it.
   * Counted separately so the log line can tell the two apart, which is the whole of defect 57.
   */
  private thumbsUnrenderable = 0;

  private bucketCount = 0;
  private listCount = 0;
  private thumbsMade = 0;
  private thumbsFailed = 0;
  private cacheHits = 0;

  constructor(
    private readonly link: () => LinkClient | null,
    private readonly bulk: () => BulkClient | null,
    private readonly session: () => { host: string | null; token: string | null },
  ) {}

  /** Every album, newest first. */
  async buckets(): Promise<PhoneResult<MediaBucket[]>> {
    const result = await ask(
      this.link(),
      'photos',
      MessageType.MEDIA_BUCKETS,
      {},
      (payload) => rows(payload, 'buckets').map(toBucket),
    );
    if (result.ok) {
      this.bucketCount = result.data.length;
      const items = result.data.reduce((sum, one) => sum + one.count, 0);
      log.info('photos', `media.buckets → ${result.data.length} albums, ${items} items in total`);
    }
    return result;
  }

  /**
   * One page of a bucket, newest first.
   *
   * `before`/`beforeId` are passed through untouched. The cursor is the phone's contract and the
   * Mac's job is to echo back the last item it received — inventing one here, or rounding the
   * timestamp, is how a page boundary starts skipping rows inside a burst.
   */
  async list(options: {
    bucketId?: string;
    limit?: number;
    before?: number;
    beforeId?: string;
  }): Promise<PhoneResult<{ items: MediaItem[]; hasMore: boolean }>> {
    const payload: Record<string, unknown> = { limit: options.limit ?? 200 };
    if (options.bucketId) payload.bucketId = options.bucketId;
    if (options.before !== undefined) payload.before = options.before;
    if (options.beforeId !== undefined) payload.beforeId = options.beforeId;

    const result = await ask(
      this.link(),
      'photos',
      MessageType.MEDIA_LIST,
      payload,
      (ack) => ({
        items: rows(ack, 'items').map(toItem),
        hasMore: ack.hasMore === true,
      }),
    );
    if (result.ok) {
      this.listCount += result.data.items.length;
      log.info(
        'photos',
        `media.list → ${result.data.items.length} items, hasMore=${result.data.hasMore}, ` +
          `${this.listCount} drawn since launch`,
      );
    }
    return result;
  }

  /**
   * Thumbnails for as many ids as asked, in batches the phone will accept.
   *
   * Returns what it has: ids already cached come back without a request, and an id that failed
   * before is not asked for again. Both counts are logged together — a hit rate with no misses
   * beside it cannot tell a warm cache from one nothing consults.
   */
  async thumbsFor(ids: string[], maxEdge = 256): Promise<PhoneResult<Map<string, string>>> {
    const wanted = ids.filter((id) => !this.thumbs.has(id) && !this.missing.has(id));
    this.cacheHits += ids.length - wanted.length;

    for (let i = 0; i < wanted.length; i += THUMB_BATCH) {
      const batch = wanted.slice(i, i + THUMB_BATCH);
      const result = await ask(
        this.link(),
        'photos',
        MessageType.MEDIA_THUMB,
        { ids: batch, maxEdge },
        (payload) => rows(payload, 'thumbs').map(toThumb),
      );
      if (!result.ok) return result;
      for (const thumb of result.data) {
        if (thumb.data) {
          this.thumbs.set(thumb.id, thumb.data);
          this.thumbsMade += 1;
        } else if (thumb.error === 'NO_THUMBNAIL') {
          // Defect 57. The photo is THERE and could not be rendered — it is listable, and
          // `media.original` may well succeed on it. Putting it in `missing` would be the old
          // conflation moved to this end: the tile would go blank and never be asked for again,
          // over a file sitting on the phone.
          this.thumbsUnrenderable += 1;
        } else {
          this.missing.add(thumb.id);
          this.thumbsFailed += 1;
        }
      }
    }

    log.info(
      'photos',
      `media.thumb → ${this.thumbsMade} made / ${this.thumbsFailed} gone / ` +
        `${this.thumbsUnrenderable} undecodable / ${this.cacheHits} served from cache`,
    );
    const answer = new Map<string, string>();
    for (const id of ids) {
      const data = this.thumbs.get(id);
      if (data) answer.set(id, data);
    }
    return { ok: true, data: answer };
  }

  /**
   * Fetches one photo at full size: `media.original`, then the bulk channel.
   *
   * Two steps because they are two different things. The control channel agrees *what* is being
   * moved and hands back a `transferId`; the bulk socket moves the bytes. Nothing about the second
   * step is specific to photos, which is the point — `fs.transfer.begin` will hand this same client
   * the same shape.
   *
   * The file lands in `~/Downloads/Sidekick`, created on demand. A name collision is resolved by
   * suffixing rather than overwriting: two photos really can share a display name across buckets,
   * and silently replacing someone's file to avoid a dialog is the wrong trade.
   */
  /**
   * One photo at the protocol's largest thumbnail, **512 px** — the detail preview, not a tile.
   *
   * Its own cache, keyed by id, because [thumbsFor]'s is keyed by id alone: asking it for 512 after
   * the grid had fetched 256 would return the 256 as a cache hit, and the preview would be the
   * grid's thumbnail upscaled and called sharp. `NO_THUMBNAIL` comes back as `null` with the code,
   * because the photo is there and an original may still load (defect 57).
   */
  private readonly previews = new Map<string, string>();

  async previewThumb(id: string): Promise<PhoneResult<{ data: string | null; error: string | null }>> {
    const cached = this.previews.get(id);
    if (cached) return { ok: true, data: { data: cached, error: null } };
    const result = await ask(
      this.link(),
      'photos',
      MessageType.MEDIA_THUMB,
      { ids: [id], maxEdge: 512 },
      (payload) => rows(payload, 'thumbs').map(toThumb),
    );
    if (!result.ok) return result;
    const row = result.data.find((t) => t.id === id);
    if (row?.data) {
      this.previews.set(id, row.data);
      // Bounded: ~100 KB of base64 each; the last sixty cover any browsing session and cap it at ~6 MB.
      if (this.previews.size > 60) this.previews.delete(this.previews.keys().next().value!);
      return { ok: true, data: { data: row.data, error: null } };
    }
    return { ok: true, data: { data: null, error: row?.error ?? 'NO_THUMBNAIL' } };
  }

  async original(
    id: string,
    into?: string,
    onAgreed?: (ticket: { transferId: string; size: number; name: string; mime: string }) => void,
  ): Promise<PhoneResult<{ path: string; bytes: number; elapsedMs: number; name: string; mime: string }>> {
    // The destination is settled **before** the phone is asked: a receive folder on an unplugged
    // drive must refuse here, not after the phone has agreed a transfer nobody will claim.
    let folder: string;
    if (into) {
      folder = into;
    } else {
      const ready = await ensureReceiveFolder();
      if (!ready.ok) {
        return {
          ok: false,
          feature: 'photos',
          type: MessageType.MEDIA_ORIGINAL,
          reason: ready.reason,
          fixHint: ready.fixHint,
        } as PhoneResult<{ path: string; bytes: number; elapsedMs: number; name: string; mime: string }>;
      }
      folder = ready.folder;
    }
    const ticket = await ask(
      this.link(),
      'photos',
      MessageType.MEDIA_ORIGINAL,
      { id },
      (payload): MediaOriginalTicket => ({
        transferId: String(payload.transferId ?? ''),
        size: Number(payload.size ?? 0),
        mime: String(payload.mime ?? 'application/octet-stream'),
        name: String(payload.name ?? `photo-${id}`),
        sha256: payload.sha256 == null ? null : String(payload.sha256),
        chunkMax: Number(payload.chunkMax ?? 0),
      }),
    );
    if (!ticket.ok) return ticket;

    const { host, token } = this.session();
    const bulk = this.bulk();
    if (!host || !token || !bulk) {
      return {
        ok: false,
        feature: 'photos',
        type: MessageType.MEDIA_ORIGINAL,
        reason: 'There is no live session with the phone.',
      } as PhoneResult<{ path: string; bytes: number; elapsedMs: number; name: string; mime: string }>;
    }

    onAgreed?.({
      transferId: ticket.data.transferId,
      size: ticket.data.size,
      name: ticket.data.name,
      mime: ticket.data.mime,
    });
    await fs.mkdir(folder, { recursive: true });
    const destination = await pullDestination(folder, ticket.data.name);

    const result = await bulk.pull({
      host,
      token,
      transferId: ticket.data.transferId,
      destination,
      expectedBytes: ticket.data.size,
    });
    if (!result.ok) {
      return {
        ok: false,
        feature: 'photos',
        type: MessageType.MEDIA_ORIGINAL,
        reason: result.reason ?? 'The transfer did not finish.',
      } as PhoneResult<{ path: string; bytes: number; elapsedMs: number; name: string; mime: string }>;
    }
    return {
      ok: true,
      data: {
        path: result.path!,
        bytes: result.bytes,
        elapsedMs: result.elapsedMs,
        name: ticket.data.name,
        mime: ticket.data.mime,
      },
    };
  }

  /**
   * Drops everything on disconnect.
   *
   * Same reasoning as the contact cache: a thumbnail resolved against a phone that has since been
   * unpaired, or whose library has been edited, is a claim this Mac cannot still stand behind. The
   * `missing` set goes too — an id that failed while the link was dropping deserves another ask.
   */
  clear(): void {
    const held = this.thumbs.size;
    this.thumbs.clear();
    this.previews.clear();
    this.missing.clear();
    this.bucketCount = 0;
    this.listCount = 0;
    log.info('photos', `cleared ${held} cached thumbnails on disconnect`);
  }
}

/** The phone's own cap on `ids`, mirrored so a batch is never refused as BAD_REQUEST. */
const THUMB_BATCH = 32;

function toBucket(row: Record<string, unknown>): MediaBucket {
  return {
    bucketId: String(row.bucketId ?? ''),
    bucketName: String(row.bucketName ?? ''),
    count: Number(row.count ?? 0),
    newestMs: Number(row.newestMs ?? 0),
    coverId: String(row.coverId ?? ''),
    ...(row.packageName ? { packageName: String(row.packageName) } : {}),
    ...(row.appName ? { appName: String(row.appName) } : {}),
  };
}

function toItem(row: Record<string, unknown>): MediaItem {
  return {
    id: String(row.id ?? ''),
    kind: row.kind === 'video' ? 'video' : 'image',
    mime: String(row.mime ?? 'application/octet-stream'),
    size: Number(row.size ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    dateMs: Number(row.dateMs ?? 0),
    durationMs: row.durationMs == null ? null : Number(row.durationMs),
    ...(row.ownerPackage ? { ownerPackage: String(row.ownerPackage) } : {}),
    ...(row.ownerAppName ? { ownerAppName: String(row.ownerAppName) } : {}),
  };
}

function toThumb(row: Record<string, unknown>): MediaThumb {
  return {
    id: String(row.id ?? ''),
    ...(row.mime ? { mime: String(row.mime) } : {}),
    ...(row.width ? { width: Number(row.width) } : {}),
    ...(row.height ? { height: Number(row.height) } : {}),
    ...(row.data ? { data: String(row.data) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
  };
}
