/**
 * The Photos pane: albums, a thumbnail grid, and one honest sentence about what it cannot do.
 *
 * Built against the design canvas — 188px `ALBUMS` rail and grid inside one panel, 320px detail
 * card beside it — on **three** of the photo browser's four verbs.
 *
 * ### This pane draws the state the four-state model had never exercised
 *
 * `docs/mac-ui-design-proposals.md` names four states that must not look alike, and the third —
 * *the phone has this feature and is not fully offering it* — had no drawn version anywhere in the
 * app, because until now every feature was either finished or absent. Photos is the first that is
 * neither: `media.buckets`, `media.list` and `media.thumb` all answer, `media.original` does not
 * exist, and so the `photos` capability is **not advertised** and the chip stays grey while the
 * pane works.
 *
 * That inconsistency is deliberate and it is drawn deliberately. The rule it follows:
 *
 *  - **The pane does not gate on the capability.** Gating would turn a partly-working feature into
 *    a dead one, and would tell the user "unavailable" about something they can see working.
 *  - **It says which half is missing, in the same words as the thing they will try.** Not
 *    "limited functionality" — *"Full-size originals need the file channel, which is the next
 *    slice. Thumbnails work now."* A user who double-clicks a photo has already been told why
 *    nothing opens.
 *  - **`--warning`, never `--destructive`.** A feature arriving in two halves is not a failure, and
 *    red in a connection product reads as "the link is down".
 *
 * The genuinely unavailable state is still here and still separate: with the photos permission
 * ungranted the phone answers `PERMISSION_DENIED`, and that draws the phone's own sentence and its
 * fix hint, with no grid at all. Those two must not look alike either — one says *this works, but
 * not all of it*, the other says *this does not work yet, and here is the switch*.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts, so a top-level
 * `export` would emit a module the renderer cannot require. The pure half hangs on `globalThis` for
 * `photos.test.ts`.
 */

interface MediaBucketRow {
  bucketId: string;
  bucketName: string;
  count: number;
  newestMs: number;
  coverId: string;
  packageName?: string;
  appName?: string;
}

interface MediaItemRow {
  id: string;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  dateMs: number;
  durationMs: number | null;
  ownerPackage?: string;
  ownerAppName?: string;
}

interface PhotosResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  fixHint?: string;
  code?: string;
}

interface PhotosBridge {
  mediaBuckets(): Promise<PhotosResult<MediaBucketRow[]>>;
  mediaList(options: {
    bucketId?: string;
    limit?: number;
    before?: number;
    beforeId?: string;
  }): Promise<PhotosResult<{ items: MediaItemRow[]; hasMore: boolean }>>;
  mediaThumbs(options: { ids: string[]; maxEdge?: number }): Promise<
    PhotosResult<Array<[string, string]>>
  >;
  mediaOriginal(options: { id: string }): Promise<
    PhotosResult<{ path: string; bytes: number; elapsedMs: number }>
  >;
}

/**
 * How many items one page asks for. The phone caps this at 500; 120 fills the grid twice over.
 *
 * Named `PHOTOS_PAGE` rather than `PAGE` because every renderer file is loaded as a plain script
 * into one global scope — `sms.ts` already has a `PAGE`, and two `const`s with one name is a
 * redeclaration the compiler catches and the browser would not.
 */
const PHOTOS_PAGE = 120;

/**
 * What the pane can and cannot do, as one sentence each — or null when it can do all of it.
 *
 * **Driven by the capability, not by a constant**, which is the whole point. `photos` goes green at
 * the moment the phone has all four verbs *and* serves the bulk channel; this notice must disappear
 * in that same moment, because a banner saying "thumbnails only" over a pane that opens originals
 * is the stale-copy defect this pane replaced on its way in. One condition, one source of truth: if
 * the phone is advertising `photos`, full-size works and the banner is gone.
 *
 * Pure, and hung on the global, because it is the copy this pane exists to get right and a test
 * that asserted a second copy of it would be asserting nothing. See `photos.test.ts`.
 */
function partialNotice(advertised: boolean): { headline: string; detail: string } | null {
  if (advertised) return null;
  return {
    headline: 'Thumbnails only, for now',
    detail:
      'Albums and thumbnails come from the phone over the control channel. Full-size originals ' +
      'need the file channel, which this phone is not offering — so opening a photo at full size ' +
      'is not available right now.',
  };
}

/** `2,841 items` — a count a person reads, with the thousands separator their locale uses. */
function albumCount(count: number): string {
  return `${count.toLocaleString()}`;
}

/** `4032 × 3024 · 3.7 MB · 15 May 2024, 12:08`, skipping whatever the phone did not send. */
function itemSummary(item: MediaItemRow): string {
  const parts: string[] = [];
  if (item.width && item.height) parts.push(`${item.width} × ${item.height}`);
  parts.push(fileSize(item.size));
  if (item.kind === 'video' && item.durationMs) parts.push(clockOf(item.durationMs));
  parts.push(
    new Date(item.dateMs).toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  );
  return parts.join(' · ');
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** `1:04` for a video length. */
function clockOf(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The label under an album, which is where the package-id rule lands on this pane.
 *
 * A bucket owned by an app carries `packageName` **and** `appName` from the phone. What a person
 * reads is the app name; the package id is never drawn. `AppLabels` on the phone already falls back
 * to the package id when it cannot resolve one, so `appName` is always present when
 * `packageName` is — this function does not need to reconstruct that fallback and must not invent
 * a different one.
 */
function albumSource(bucket: MediaBucketRow): string {
  return bucket.appName ?? '';
}

/**
 * The id of the synthetic first album.
 *
 * `media.list` with no `bucketId` already returns every bucket merged under one ordering, so "All
 * photos" costs nothing on the wire and is what the design canvas puts at the top of the rail. It
 * is also the better default than "whichever bucket holds the newest file", which on this handset
 * opened the pane on `Download`.
 */
const ALL_PHOTOS = '__all__';

class PhotosView {
  private albums: MediaBucketRow[] = [];
  private items: MediaItemRow[] = [];
  private thumbs = new Map<string, string>();
  private selectedAlbum: string | null = null;
  private selectedItem: string | null = null;
  private hasMore = false;
  private loading = false;

  /** Ids `media.list` returned that this pane already held. Must stay 0; see [loadMore]. */
  private repeats = 0;
  private failure: { reason: string; fixHint?: string } | null = null;

  /** True when the phone advertises `photos` — all four verbs and a served bulk channel. */
  private advertised = false;

  /** The id currently being pulled at full size, so the button can say so and not be pressed twice. */
  private pulling: string | null = null;

  /** Where the last pull landed, for the one line that tells the user their file exists. */
  private lastPull: { path: string; bytes: number; elapsedMs: number } | null = null;

  constructor(
    private readonly bridge: PhotosBridge,
    private readonly card: HTMLElement,
    private readonly banner: HTMLElement,
    private readonly note: HTMLElement,
    private readonly rail: HTMLElement,
    private readonly tiles: HTMLElement,
    private readonly detail: HTMLElement,
  ) {
    this.tiles.addEventListener('scroll', () => {
      // Three conditions, and the third is the one whose absence made this load forever. A grid
      // shorter than its own viewport satisfies "near the bottom" permanently — `0 + clientHeight
      // >= scrollHeight - 400` is true the moment the pane opens — so the first version fetched
      // page after page with `scrollTop` still at 0, and 240 tiles became 360 while nobody
      // touched it. A scroll trigger has to require something to scroll.
      if (!this.hasMore || this.loading) return;
      if (this.tiles.scrollHeight <= this.tiles.clientHeight) return;
      const nearBottom =
        this.tiles.scrollTop + this.tiles.clientHeight >= this.tiles.scrollHeight - 400;
      if (nearBottom) void this.loadMore();
    });
  }

  /**
   * Called by the renderer whenever the phone's capability set changes.
   *
   * Only redraws — it never refetches. The three read verbs answer whether or not `photos` is
   * advertised, so a capability change alters what the pane *says about itself*, not what it holds.
   */
  setAdvertised(advertised: boolean): void {
    if (this.advertised === advertised) return;
    this.advertised = advertised;
    this.render();
  }

  /** Loads albums, then the first page of the biggest one. Safe to call again. */
  async refresh(): Promise<void> {
    const result = await this.bridge.mediaBuckets();
    if (!result.ok) {
      this.failure = { reason: result.reason ?? 'The phone did not answer.', fixHint: result.fixHint };
      this.albums = [];
      this.items = [];
      this.render();
      return;
    }
    this.failure = null;
    const buckets = result.data ?? [];
    const total = buckets.reduce((sum, one) => sum + one.count, 0);
    this.albums = buckets.length
      ? [
          {
            bucketId: ALL_PHOTOS,
            bucketName: 'All photos',
            count: total,
            newestMs: buckets[0]?.newestMs ?? 0,
            coverId: buckets[0]?.coverId ?? '',
          },
          ...buckets,
        ]
      : [];
    if (this.selectedAlbum === null && this.albums.length) this.selectedAlbum = ALL_PHOTOS;
    this.render();
    await this.loadAlbum();
  }

  private async loadAlbum(): Promise<void> {
    this.items = [];
    this.selectedItem = null;
    this.hasMore = false;
    await this.loadMore();
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.selectedAlbum === null) return;
    if (this.items.length > 0 && !this.hasMore) return;
    this.loading = true;

    // The cursor is the last item received, echoed back untouched. Rounding it, or rebuilding it
    // from anything but the row the phone sent, is how a page boundary starts skipping the rows
    // that share a second with it — which on a camera roll is a burst, and certain rather than
    // unlucky.
    const last = this.items[this.items.length - 1];
    let page = { items: [] as MediaItemRow[], hasMore: false };
    try {
      const result = await this.bridge.mediaList({
        ...(this.selectedAlbum === ALL_PHOTOS ? {} : { bucketId: this.selectedAlbum }),
        limit: PHOTOS_PAGE,
        ...(last ? { before: last.dateMs, beforeId: last.id } : {}),
      });
      if (!result.ok) {
        this.failure = {
          reason: result.reason ?? 'The phone did not answer.',
          fixHint: result.fixHint,
        };
        this.render();
        return;
      }
      page = result.data ?? { items: [], hasMore: false };

      // The duplicates are counted, not silently dropped. The first version cleared `loading`
      // before appending, so a scroll arriving in that window started a second fetch **with the
      // same cursor** and the page came back twice — 360 tiles carrying 248 distinct photos. The
      // race is fixed below by clearing the flag in `finally`; this stays because a repeat is
      // exactly what a broken cursor looks like, and a pane that de-duplicated in silence would
      // hide it. A count that never moves is the evidence; a count that moves is a defect report.
      const known = new Set(this.items.map((one) => one.id));
      const fresh = page.items.filter((one) => !known.has(one.id));
      this.repeats += page.items.length - fresh.length;
      if (this.repeats > 0) {
        console.warn(
          `[photos] media.list returned ${page.items.length - fresh.length} ids already held ` +
            `(${this.repeats} since launch, ${this.items.length + fresh.length} distinct drawn)`,
        );
      }
      this.items = this.items.concat(fresh);
      this.hasMore = page.hasMore;
    } finally {
      // After the state is updated, never before it: the window between "no longer loading" and
      // "the page is in `items`" is where the duplicate fetch above came from.
      this.loading = false;
    }
    this.render();
    await this.fillThumbs(page.items.map((one) => one.id));
  }

  private async fillThumbs(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const result = await this.bridge.mediaThumbs({ ids, maxEdge: 256 });
    if (!result.ok) return;
    for (const [id, data] of result.data ?? []) this.thumbs.set(id, data);
    this.render();
  }

  private render(): void {
    this.renderBanner();
    this.renderRail();
    this.renderTiles();
    this.renderDetail();
  }

  /**
   * The banner, which carries the two states this pane can be in and never blurs them.
   *
   * A refusal from the phone replaces the grid; the partial notice sits above a working one.
   */
  private renderBanner(): void {
    this.banner.textContent = '';
    const failure = this.failure;
    if (failure) {
      this.banner.hidden = false;
      this.banner.className = 'photos-banner unavailable';
      this.banner.appendChild(photoLine('photos-banner-headline', 'The phone is not sharing its photos'));
      this.banner.appendChild(photoLine('photos-banner-detail', failure.reason));
      if (failure.fixHint) {
        this.banner.appendChild(photoLine('photos-banner-fix', failure.fixHint));
      }
      return;
    }
    const notice = partialNotice(this.advertised);
    if (!notice) {
      // Full capability: no banner at all. The pane says nothing about itself because there is
      // nothing left to explain.
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    this.banner.className = 'photos-banner partial';
    this.banner.appendChild(photoLine('photos-banner-headline', notice.headline));
    this.banner.appendChild(photoLine('photos-banner-detail', notice.detail));
  }

  private renderRail(): void {
    this.rail.textContent = '';
    for (const album of this.albums) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `photos-album${album.bucketId === this.selectedAlbum ? ' on' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(album.bucketId === this.selectedAlbum));

      const name = photoLine('photos-album-name', album.bucketName);
      const count = photoLine('photos-album-count', albumCount(album.count));
      row.appendChild(name);
      row.appendChild(count);

      const source = albumSource(album);
      if (source) row.appendChild(photoLine('photos-album-source', source));

      row.addEventListener('click', () => {
        if (this.selectedAlbum === album.bucketId) return;
        this.selectedAlbum = album.bucketId;
        this.render();
        void this.loadAlbum();
      });
      this.rail.appendChild(row);
    }
  }

  private renderTiles(): void {
    this.tiles.textContent = '';
    if (this.failure) return;

    if (this.items.length === 0) {
      // The design's own empty state, kept rather than replaced by the generic nothing-here card:
      // an album with no photos is a different sentence from a pane with no feature.
      const empty = document.createElement('div');
      empty.className = 'photos-empty';
      empty.appendChild(photoLine('photos-empty-headline', 'Nothing in this album'));
      empty.appendChild(
        photoLine(
          'photos-empty-detail',
          this.loading
            ? 'Asking the phone…'
            : 'Photos you add on your phone appear here the next time this pane is opened.',
        ),
      );
      this.tiles.appendChild(empty);
      return;
    }

    for (const item of this.items) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `photos-tile${item.id === this.selectedItem ? ' on' : ''}`;
      tile.setAttribute('role', 'gridcell');
      // A stable handle on the tile, so a check can count distinct photos rather than distinct
      // aria-labels. Two photos of the same size taken in the same second share a label and are
      // not the same photo — a driving rule this repo already carries, applied to its own UI.
      tile.dataset.id = item.id;
      tile.setAttribute(
        'aria-label',
        `${item.kind === 'video' ? 'Video' : 'Photo'}, ${itemSummary(item)}`,
      );

      const data = this.thumbs.get(item.id);
      if (data) {
        const img = document.createElement('img');
        img.className = 'photos-thumb';
        img.src = `data:image/jpeg;base64,${data}`;
        img.alt = '';
        tile.appendChild(img);
      } else {
        tile.appendChild(photoLine('photos-thumb-pending', ''));
      }

      if (item.kind === 'video') {
        const badge = photoLine('photos-tile-badge', item.durationMs ? clockOf(item.durationMs) : 'Video');
        tile.appendChild(badge);
      }

      tile.addEventListener('click', () => {
        this.selectedItem = item.id;
        this.render();
      });
      this.tiles.appendChild(tile);
    }
  }

  /**
   * Pulls one photo at full size, over the bulk channel.
   *
   * Sequential by construction — the button is disabled while `pulling` is set. One bulk socket per
   * file is the protocol's own shape, and letting a user start six at once would open six sockets
   * to move six photos, which is what the control channel's `transferId` handshake exists to avoid.
   */
  private async pull(item: MediaItemRow): Promise<void> {
    if (this.pulling) return;
    this.pulling = item.id;
    this.render();
    try {
      const result = await this.bridge.mediaOriginal({ id: item.id });
      if (result.ok && result.data) {
        this.lastPull = result.data;
      } else {
        // The phone's own sentence, not a generic one. A failed transfer is the case where a
        // specific reason matters most: "no space" and "the socket dropped" want opposite responses.
        this.failure = { reason: result.reason ?? 'The transfer did not finish.' };
      }
    } finally {
      this.pulling = null;
      this.render();
    }
  }

  private renderDetail(): void {
    this.detail.textContent = '';
    const item = this.items.find((one) => one.id === this.selectedItem);
    if (!item) {
      this.detail.appendChild(photoLine('pane-detail-empty', 'Select a photo to see its details.'));
      // `- 1` for the synthetic All photos row: counting it would report one more album than the
      // phone has, which is a small lie of exactly the kind this pane exists not to tell.
      const real = Math.max(0, this.albums.length - 1);
      this.note.textContent = real
        ? `${real} albums · ${albumCount(this.items.length)} loaded in this one`
        : '';
      return;
    }

    const preview = this.thumbs.get(item.id);
    if (preview) {
      const img = document.createElement('img');
      img.className = 'photos-detail-preview';
      img.src = `data:image/jpeg;base64,${preview}`;
      img.alt = '';
      this.detail.appendChild(img);
    }
    this.detail.appendChild(photoLine('photos-detail-title', item.kind === 'video' ? 'Video' : 'Photo'));
    this.detail.appendChild(photoLine('photos-detail-meta', itemSummary(item)));
    this.detail.appendChild(photoLine('photos-detail-mime mono', item.mime));
    if (item.ownerAppName) {
      this.detail.appendChild(photoLine('photos-detail-owner', `Saved by ${item.ownerAppName}`));
    }

    if (this.advertised) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button photos-detail-save';
      const busy = this.pulling === item.id;
      button.disabled = this.pulling !== null;
      button.textContent = busy ? 'Saving…' : 'Save to Mac';
      button.addEventListener('click', () => void this.pull(item));
      this.detail.appendChild(button);

      if (this.lastPull && !busy) {
        // Where the file went, in full. A "saved" toast that does not say where leaves someone
        // hunting through Finder for a file they were told they already have.
        this.detail.appendChild(
          photoLine(
            'photos-detail-saved',
            `Saved ${fileSize(this.lastPull.bytes)} to ${this.lastPull.path}`,
          ),
        );
      }
    } else {
      // Said here as well as in the banner, because this is the moment someone reaches for it: the
      // detail card is where the Save button lives, and its absence needs a sentence rather than an
      // empty space.
      this.detail.appendChild(
        photoLine(
          'photos-detail-limit',
          'The full-size original stays on the phone — this phone is not offering the file channel.',
        ),
      );
    }
  }
}

function photoLine(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

// Hung on the global for photos.test.ts, per the renderer's testable-seam rule: the test runs the
// code that draws the copy, rather than a second copy of the rule that can drift from it.
(globalThis as Record<string, unknown>).__photoLabels = {
  partialNotice,
  albumCount,
  itemSummary,
  fileSize,
  clockOf,
  albumSource,
};

// The view class, for `photosView.test.ts`. `photos.ts` touches no DOM at module scope, so a test
// can construct it against `domDouble.testkit.ts` — which is what takes it off
// `check-renderer-views.mjs`'s debt list, where its reason was "the grid paged and measured through
// probe.mjs; no view-level test yet". The probe reading stays the evidence for the *grid*; this
// covers the cursor, the paging guard and the states, which are the parts a probe could not isolate.
(globalThis as Record<string, unknown>).PhotosView = PhotosView;
