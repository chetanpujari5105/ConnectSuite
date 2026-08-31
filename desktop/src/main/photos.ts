import {
  MessageType,
  type MediaBucket,
  type MediaItem,
  type MediaThumb,
  type PhoneResult,
} from '../shared/protocol';
import { ask, rows } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

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

  private bucketCount = 0;
  private listCount = 0;
  private thumbsMade = 0;
  private thumbsFailed = 0;
  private cacheHits = 0;

  constructor(private readonly link: () => LinkClient | null) {}

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
        } else {
          this.missing.add(thumb.id);
          this.thumbsFailed += 1;
        }
      }
    }

    log.info(
      'photos',
      `media.thumb → ${this.thumbsMade} made / ${this.thumbsFailed} failed / ` +
        `${this.cacheHits} served from cache`,
    );
    const answer = new Map<string, string>();
    for (const id of ids) {
      const data = this.thumbs.get(id);
      if (data) answer.set(id, data);
    }
    return { ok: true, data: answer };
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
