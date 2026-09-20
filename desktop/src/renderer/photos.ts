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
 * The heading over one day's photos — `Today`, `Yesterday`, `Saturday`, `14 May 2024`.
 *
 * `nowMs` is a parameter rather than a `Date.now()` inside, and that is the whole reason this
 * function is testable at all. `CLAUDE.md`'s worked example for defect 67 is a field whose value
 * the test supplies by hand while the product fills it in from somewhere a test cannot reach — the
 * diagnostic being *what writes this, and is that code in the test's reach?* Here the answer is
 * "the caller", every caller is in this file, and the boundary a test needs to sit either side of
 * is midnight, which is not reachable by waiting.
 *
 * Midnight is local and computed by `setHours(0,0,0,0)`, not by subtracting 86,400,000 — a day is
 * not always 24 hours, and on the two days a year it is not, arithmetic on milliseconds puts
 * yesterday's photos under `Today`.
 */
function dayHeading(dateMs: number, nowMs: number): string {
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = midnight.getTime();
  const startOfYesterday = new Date(startOfToday - 1).setHours(0, 0, 0, 0);

  if (dateMs >= startOfToday) return 'Today';
  if (dateMs >= startOfYesterday) return 'Yesterday';

  // Inside the last week, a weekday name is what a person actually holds in their head. Beyond it,
  // a weekday is ambiguous and a date is not.
  const sixDaysBack = new Date(startOfToday);
  sixDaysBack.setDate(sixDaysBack.getDate() - 6);
  if (dateMs >= sixDaysBack.getTime()) {
    return new Date(dateMs).toLocaleDateString([], { weekday: 'long' });
  }

  const then = new Date(dateMs);
  return then.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    // The year only when it is not this one — "14 May 2024" in the design, "14 May" this year.
    ...(then.getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * The items, cut into the day-groups the design draws, **in the order they arrived**.
 *
 * It does not sort. `media.list` already returns `date DESC, id DESC` and the pager's whole
 * correctness argument rests on that ordering being the phone's; re-sorting here would put a second
 * expression of the same rule in a second place, which is the mistake `CLAUDE.md` names as the one
 * that makes a test assert a copy. A group therefore closes as soon as the heading changes, and a
 * day that appears twice in the stream would draw twice — which is a visible defect report rather
 * than a silently repaired one.
 */
function groupByDay(
  items: readonly MediaItemRow[],
  nowMs: number,
): Array<{ heading: string; items: MediaItemRow[] }> {
  const groups: Array<{ heading: string; items: MediaItemRow[] }> = [];
  for (const item of items) {
    const heading = dayHeading(item.dateMs, nowMs);
    const open = groups[groups.length - 1];
    if (open && open.heading === heading) open.items.push(item);
    else groups.push({ heading, items: [item] });
  }
  return groups;
}

/**
 * ### Defect 89 — the duplicate album names, measured and then *not* worked around
 *
 * The rail on this handset draws **150 albums**, among them two rows both reading *WhatsApp
 * Images* (500 items and 5,781), three *WhatsApp Video*, four *WhatsApp Documents*, and names like
 * `1389444597` and `1650884749188`.
 *
 * Measured on the device rather than guessed at. `bucket_display_name` is the **leaf directory name
 * only**, so two different directories collide the moment their last segment matches:
 *
 * ```
 * bucket_id=-1829889111  Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/
 * bucket_id=318896427    Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/
 * bucket_id=278607672    WhatsApp/Media/WhatsApp Images/          ← the pre-scoped-storage location
 * bucket_id=1432227631   Android/.Trash/com.sec.android.gallery3d/…/WhatsApp Images/
 * ```
 *
 * **The fourth one is Samsung Gallery's trash**, and it is the real finding: this pane is showing
 * somebody their deleted photographs as an ordinary album. It is not flagged `is_trashed` either —
 * that column returns nothing on this device, because Samsung Gallery moves files into its own
 * `.Trash` directory rather than using `MediaStore`'s trash. Only the path separates them.
 *
 * The numeric names are the same class of thing and are **not ours to fix**: they are real
 * directories some app created and named with a Unix timestamp. `CLAUDE.md`'s package-id rule
 * covers a package id appearing where a sentence belongs; a folder's own name is not that, and
 * prettifying it would invent a name for a place the user can navigate to.
 *
 * ### Two disambiguators were built here and both were removed, which is the part worth keeping
 *
 * The first appended the item count. It drew `Instagram / 34 / 34 items` — the same number twice,
 * three lines deep — because **the count is already the row's own second column**. True, and it
 * added nothing.
 *
 * The second appended `newestMs` as *Latest 4 Sep 2026*. On the real data **both** WhatsApp Images
 * rows carry the same latest date, so it disambiguated nothing and truncated to
 * `WhatsApp · Latest Sep 4, …` in a 188px rail.
 *
 * Both were found by looking at the running app, not by a test — and each was a true sentence that
 * did not answer the question. So nothing is drawn: the count already differs and is already on the
 * row, which is the whole of what this wire supports. Telling these apart properly needs
 * `relativePath` on `media.buckets`, and hiding the trash bucket needs it too. That is **defect
 * 89**, it is a wire change, and it is recorded rather than half-applied.
 */

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
  /**
   * The banner, which carries the two states this pane can be in and never blurs them.
   *
   * A refusal from the phone replaces the grid; the partial notice sits above a working one. Both
   * are **compact** state blocks now (D67) rather than `photos-banner`, which was five rules and
   * its own headline/detail/fix typography — one of six private vocabularies for the same facts.
   * Compact because this is a full-width notice above a working pane, not an empty region.
   *
   * The tones come from the component: `permission` and `partial` are both amber, which is the
   * approved map — the phone refusing and the feature arriving in halves are both *a real
   * limitation the user may be able to act on*, and neither is a failure.
   */
  private renderBanner(): void {
    this.banner.replaceChildren();
    const failure = this.failure;
    if (failure) {
      this.banner.hidden = false;
      this.banner.appendChild(
        stateBlock({
          kind: 'permission',
          headline: 'The phone is not sharing its photos',
          // The phone's own sentences, verbatim and unjoined — see `stateBlock`'s `body`.
          body: [failure.reason, ...(failure.fixHint ? [failure.fixHint] : [])],
          compact: true,
        }),
      );
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
    this.banner.appendChild(
      stateBlock({ kind: 'partial', headline: notice.headline, body: notice.detail, compact: true }),
    );
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

    // One `Date.now()` for the whole render, so a grid that happens to be drawn across midnight
    // cannot put its first rows under `Today` and its last under `Yesterday`.
    const nowMs = Date.now();
    for (const group of groupByDay(this.items, nowMs)) {
      const section = document.createElement('div');
      section.className = 'photos-group';
      section.appendChild(photoLine('photos-group-title', group.heading));

      const grid = document.createElement('div');
      grid.className = 'photos-grid';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', group.heading);
      section.appendChild(grid);
      this.tiles.appendChild(section);

      for (const item of group.items) grid.appendChild(this.tileFor(item));
    }
  }

  /** One tile. Extracted so the grouping loop above reads as grouping and nothing else. */
  private tileFor(item: MediaItemRow): HTMLElement {
    {
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
      return tile;
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

  /**
   * The design's right column: a preview card and an actions card.
   *
   * ### Three of the design's four Quick actions are removed, not greyed
   *
   * The canvas draws **Import to Mac**, **Share**, **Set as Mac wallpaper** and **Delete from
   * phone**. `media.*` is four verbs — `buckets`, `list`, `thumb`, `original` — and that is the
   * whole namespace, checked against `docs/protocol.md` rather than remembered:
   *
   * | Design's control | Verb it would need | Verdict |
   * |---|---|---|
   * | Import to Mac | `media.original` | **kept** — it exists, and it is gated on the phone advertising the bulk channel |
   * | Share | none | removed |
   * | Set as Mac wallpaper | none | removed |
   * | Delete from phone | none — `fs.delete` is a *SAF path* compare-and-delete and cannot address a `MediaStore` id | removed |
   *
   * Removed rather than disabled, because a greyed control is a promise that it might light up, and
   * these three are not waiting on a permission or a reconnect — nothing was ever built behind
   * them. One line of copy replaces all three, which is the same shape the Calls pane already uses
   * for Mute, speaker and keypad.
   *
   * ### And the metadata grid carries what the wire carries
   *
   * The design's grid reads Taken / Camera / ISO / Size. `media.list` sends no filename and no EXIF
   * at all, so **Camera and ISO are not drawn** — an empty row labelled `ISO` would be worse than
   * its absence, and inventing a value is not on the table. Taken and Size are real; kind, MIME and
   * the owning app are real and the design has no row for them, so they get one.
   */
  private renderDetail(): void {
    this.detail.textContent = '';
    const item = this.items.find((one) => one.id === this.selectedItem);
    if (!item) {
      // The shared empty state (component 11), not a stray sentence.
      this.detail.appendChild(
        stateBlock({
          kind: 'empty',
          icon: 'photos',
          headline: 'Nothing selected',
          body: 'Choose a photo to see its details and save it to this Mac.',
        }),
      );
      // `- 1` for the synthetic All photos row: counting it would report one more album than the
      // phone has, which is a small lie of exactly the kind this pane exists not to tell.
      const real = Math.max(0, this.albums.length - 1);
      this.note.textContent = real
        ? `${real} albums · ${albumCount(this.items.length)} loaded in this one`
        : '';
      return;
    }

    // ---- the preview card ----
    const card = document.createElement('section');
    card.className = 'photos-detail-card';

    const frame = document.createElement('div');
    frame.className = 'photos-detail-frame';
    const preview = this.thumbs.get(item.id);
    if (preview) {
      const img = document.createElement('img');
      img.className = 'photos-detail-preview';
      img.src = `data:image/jpeg;base64,${preview}`;
      img.alt = '';
      frame.appendChild(img);
    }
    card.appendChild(frame);

    const facts = document.createElement('div');
    facts.className = 'photos-detail-facts';
    for (const [label, value, mono] of detailFacts(item)) {
      facts.appendChild(photoLine('photos-detail-fact-label', label));
      facts.appendChild(photoLine(`photos-detail-fact-value${mono ? ' mono' : ''}`, value));
    }
    card.appendChild(facts);
    this.detail.appendChild(card);

    // ---- the actions card ----
    const actions = document.createElement('section');
    actions.className = 'photos-detail-card';
    const title = document.createElement('h3');
    title.className = 'photos-detail-actions-title';
    title.textContent = 'Quick actions';
    actions.appendChild(title);

    if (this.advertised) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button photos-detail-save';
      const busy = this.pulling === item.id;
      button.disabled = this.pulling !== null;
      button.textContent = busy ? 'Saving…' : 'Save to Mac';
      button.addEventListener('click', () => void this.pull(item));
      actions.appendChild(button);

      if (this.lastPull && !busy) {
        // Where the file went, in full. A "saved" toast that does not say where leaves someone
        // hunting through Finder for a file they were told they already have.
        actions.appendChild(
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
      actions.appendChild(
        photoLine(
          'photos-detail-limit',
          'The full-size original stays on the phone — this phone is not offering the file channel.',
        ),
      );
    }

    actions.appendChild(photoLine('photos-detail-refusal', PHOTO_ACTION_REFUSAL));
    this.detail.appendChild(actions);
  }
}

/**
 * The one line that replaces three removed controls.
 *
 * **New copy, and unratified.** `docs/empty-and-failure-states.md` has 83 sentences and none of them
 * fits: the closest is the Calls pane's *"Mute, speaker and keypad tones are on the phone. Nothing
 * on the wire carries them."* — the right shape with the wrong subject, so this is that shape with
 * this pane's nouns rather than a fourth new grammar. It is listed for the vocabulary decision
 * along with everything else and should be read against its siblings rather than on its own.
 */
const PHOTO_ACTION_REFUSAL =
  'Sharing, wallpaper and deleting are on the phone. Nothing on the wire carries them.';

/**
 * The detail card's label/value rows: `[label, value, mono]`, skipping whatever the phone did not
 * send.
 *
 * Pure and on the global, because the decision it makes is *which rows exist*, and a row that draws
 * an empty value is the defect this replaces. A test that asserted a second copy of the list would
 * assert nothing.
 */
function detailFacts(item: MediaItemRow): Array<[string, string, boolean]> {
  const rows: Array<[string, string, boolean]> = [];
  rows.push(['Kind', item.kind === 'video' ? 'Video' : 'Photo', false]);
  rows.push([
    'Taken',
    new Date(item.dateMs).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    false,
  ]);
  // The design's `3.2 MB · 4032 × 3024` on one row. `width`/`height` are null for a file another app
  // wrote and the provider never measured, which is ordinary rather than exceptional — so the
  // dimensions join the row when they exist and the row is just a size when they do not.
  rows.push([
    'Size',
    item.width && item.height
      ? `${fileSize(item.size)} · ${item.width} × ${item.height}`
      : fileSize(item.size),
    true,
  ]);
  if (item.kind === 'video' && item.durationMs) {
    rows.push(['Length', clockOf(item.durationMs), true]);
  }
  rows.push(['Type', item.mime, true]);
  if (item.ownerAppName) rows.push(['Saved by', item.ownerAppName, false]);
  return rows;
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
  dayHeading,
  groupByDay,
  detailFacts,
  PHOTO_ACTION_REFUSAL,
};

// The view class, for `photosView.test.ts`. `photos.ts` touches no DOM at module scope, so a test
// can construct it against `domDouble.testkit.ts` — which is what takes it off
// `check-renderer-views.mjs`'s debt list, where its reason was "the grid paged and measured through
// probe.mjs; no view-level test yet". The probe reading stays the evidence for the *grid*; this
// covers the cursor, the paging guard and the states, which are the parts a probe could not isolate.
(globalThis as Record<string, unknown>).PhotosView = PhotosView;
