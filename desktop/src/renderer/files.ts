/**
 * The Files pane: the folders the phone has shared, and what is inside them.
 *
 * Built against the design canvas — a left rail of roots, a name/date/size table, and a 320px
 * detail card — with three of its elements deliberately absent because the wire cannot serve them.
 * Those are `docs/design-departures.md` rows **F1–F7**; read them before adding anything the
 * mockup shows and this does not.
 *
 * ### The state this pane exists to get right
 *
 * A pane showing no folders and a pane whose request failed are the same picture. Everything that
 * keeps them apart lives in `src/shared/filesRoots.ts` — a tagged union so they cannot both be true,
 * and four independent differences so no single mistake collapses them. This file **renders** that
 * decision and does not re-take it: there is no `if (roots.length === 0)` here, and there must not
 * be one, or the rule would have two homes and they would disagree.
 *
 * ### There is no upload affordance and adding one is not a small change
 *
 * The canvas draws *"Drop files to send to phone"*. `direction: "push"` answers
 * `FEATURE_UNAVAILABLE`, and `docs/protocol.md` says a Files pane must not draw the affordance
 * against this build. `uploadAffordance(pushAvailable)` is the one condition, driven by the
 * capability rather than a constant, so the tile appears in the same moment push ships and not by
 * anyone remembering.
 *
 * Module-free like the other panes: the page is CSP-locked and loads plain scripts, so the pure
 * half hangs on `globalThis` and `filesRoots.test.ts` runs against it.
 */

interface FilesBridgeResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  fixHint?: string;
  code?: string;
}

interface FilesBridge {
  fsRoots(): Promise<
    FilesBridgeResult<{ roots: FsRootRow[]; grantHint: string | null; push?: boolean }>
  >;
  fsList(options: {
    rootId: string;
    path?: string;
    limit?: number;
    afterName?: string;
    afterId?: string;
  }): Promise<FilesBridgeResult<{ entries: FsEntryRow[]; hasMore: boolean }>>;
  fsPush(options: {
    rootId: string;
    path: string;
    source: string;
    overwrite?: boolean;
  }): Promise<{ ok: boolean; bytes?: number; reason?: string; code?: string; fixHint?: string }>;
}

/** One page. The phone caps at 500; 200 is its own default and fills the table several times. */
const FILES_PAGE = 200;

class FilesView {
  private fetch: FilesFetch = { kind: 'idle' };
  private roots: FsRootRow[] = [];
  private grantHint: string | null = null;
  private selectedRoot: string | null = null;

  private path = '';
  private entries: FsEntryRow[] = [];
  private hasMore = false;
  private loading = false;
  private listFailure: { reason: string; code: string | null } | null = null;
  private selected: FsEntryRow | null = null;

  /** True when the phone advertises `files`. False draws M5 with the phone's own sentence. */
  private advertised = false;
  private unavailableReason: string | null = null;

  /**
   * Whether the phone will receive files — **the phone's own answer, from the roots ack.**
   *
   * Not a constant and not a guess. A phone built before push shipped omits the field, and an
   * absent field is read as `false`: the drop target must never appear over a phone that would
   * answer `FEATURE_UNAVAILABLE`. This is the one condition; the tile, the banner and the
   * `uploadAffordance` check all read it.
   */
  private pushAvailable = false;

  /** What the last push said, so the pane can report a refusal the phone gave a reason for. */
  private lastPush: { ok: boolean; text: string } | null = null;

  constructor(
    private readonly bridge: FilesBridge,
    private readonly banner: HTMLElement,
    private readonly rail: HTMLElement,
    private readonly hintEl: HTMLElement,
    private readonly wallEl: HTMLElement,
    private readonly crumbs: HTMLElement,
    private readonly stateEl: HTMLElement,
    private readonly table: HTMLElement,
    private readonly footer: HTMLElement,
    private readonly drop: HTMLElement,
    private readonly detail: HTMLElement,
  ) {
    // The drop target. Registered once and *shown* conditionally, rather than wired up when push
    // appears: a listener added later is a listener that can be added twice, and this pane already
    // learned what two callers do to one state machine.
    for (const type of ['dragover', 'dragenter'] as const) {
      this.drop.addEventListener(type, (event) => {
        if (!this.pushAvailable) return;
        event.preventDefault();
        this.drop.classList.add('is-over');
      });
    }
    this.drop.addEventListener('dragleave', () => this.drop.classList.remove('is-over'));
    this.drop.addEventListener('drop', (event) => {
      event.preventDefault();
      this.drop.classList.remove('is-over');
      if (!this.pushAvailable) return;
      const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
      void this.sendFiles(files);
    });

    this.table.addEventListener('scroll', () => {
      // The third condition is the one whose absence made the Photos grid load forever: a table
      // shorter than its own viewport satisfies "near the bottom" permanently.
      if (!this.hasMore || this.loading) return;
      if (this.table.scrollHeight <= this.table.clientHeight) return;
      if (this.table.scrollTop + this.table.clientHeight >= this.table.scrollHeight - 300) {
        void this.loadMore();
      }
    });
  }

  /** Called whenever the phone's capability set changes. Redraws; never refetches on its own. */
  setAdvertised(advertised: boolean, reason: string | null): void {
    if (this.advertised === advertised && this.unavailableReason === reason) return;
    this.advertised = advertised;
    this.unavailableReason = reason;
    if (!advertised) {
      this.fetch = {
        kind: 'unavailable',
        // The phone's sentence, verbatim. It knows which grant is missing; this side does not.
        reason: reason ?? 'This phone is not offering the Files feature right now.',
      };
    } else if (this.fetch.kind === 'unavailable') {
      this.fetch = { kind: 'idle' };
      void this.refresh();
      return;
    }
    this.render();
  }

  /**
   * Loads the roots, then opens the first one. Safe to call again; this is what Retry calls.
   *
   * ### Serialised, because two things legitimately ask for it at once
   *
   * The route opening and the capability arriving are both correct reasons to refresh, and on a
   * cold start they happen within a frame of each other. The first version let both run: one
   * fetched the roots and listed 28 entries, the second reset the listing underneath it and its own
   * `fs.list` then timed out, and **the pane settled on an empty table with no error** — the exact
   * confusion this pane exists to prevent, arriving through the back door. Concurrency, not copy.
   *
   * A second caller joins the run in flight rather than starting another.
   */
  private inFlight: Promise<void> | null = null;

  async refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runRefresh(): Promise<void> {
    if (!this.advertised) {
      this.render();
      return;
    }
    this.fetch = { kind: 'loading' };
    this.render();
    const result = await this.bridge.fsRoots();
    if (!result.ok) {
      this.fetch = {
        kind: 'failed',
        reason: result.reason ?? 'The phone did not answer.',
        code: result.code ?? null,
        ...(result.fixHint ? { fixHint: result.fixHint } : {}),
      };
      this.roots = [];
      this.render();
      return;
    }
    this.roots = result.data?.roots ?? [];
    this.grantHint = result.data?.grantHint ?? null;
    this.pushAvailable = pushOffered(result.data?.push);
    this.fetch = { kind: 'ready', roots: this.roots, grantHint: this.grantHint };
    if (this.selectedRoot === null || !this.roots.some((r) => r.rootId === this.selectedRoot)) {
      // Prefer a granted tree over the app-private root: `ConnectSuite`'s own folder is always
      // present and is almost never what someone opened this pane to look at.
      this.selectedRoot = (this.roots.find((r) => r.kind === 'tree') ?? this.roots[0])?.rootId
        ?? null;
    }
    this.render();
    await this.openPath('');
  }

  private async openPath(path: string): Promise<void> {
    this.path = path;
    this.entries = [];
    this.hasMore = false;
    this.listFailure = null;
    this.selected = null;
    await this.loadMore();
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.selectedRoot === null) return;
    if (this.entries.length > 0 && !this.hasMore) return;
    this.loading = true;
    this.render();
    // The cursor is the last entry received, echoed back untouched — never rebuilt from a name we
    // formatted, which is how a boundary starts skipping a tie group.
    const last = this.entries[this.entries.length - 1];
    try {
      const result = await this.bridge.fsList({
        rootId: this.selectedRoot,
        path: this.path,
        limit: FILES_PAGE,
        ...(last ? { afterName: last.name, afterId: last.id } : {}),
      });
      if (!result.ok) {
        this.listFailure = {
          reason: result.reason ?? 'The phone did not answer.',
          code: result.code ?? null,
        };
        return;
      }
      const page = result.data ?? { entries: [], hasMore: false };
      const known = new Set(this.entries.map((e) => e.id));
      this.entries = this.entries.concat(page.entries.filter((e) => !known.has(e.id)));
      this.hasMore = page.hasMore;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Sends dropped files, one at a time.
   *
   * **Serially, not in parallel**, and that is the protocol rather than caution: one `transferId`,
   * one file, one bulk connection. A folder copy is this loop, which is why it is a loop here and
   * not a protocol feature.
   */
  private async sendFiles(files: File[]): Promise<void> {
    if (!files.length || this.selectedRoot === null) return;
    for (const file of files) {
      // Electron exposes the real path on a dropped File. Without one there is nothing to read, and
      // saying so beats sending zero bytes and reporting success.
      const source = (file as File & { path?: string }).path;
      if (!source) {
        this.lastPush = { ok: false, text: `${file.name} could not be read from this drop.` };
        this.render();
        continue;
      }
      this.lastPush = { ok: true, text: `Sending ${file.name}…` };
      this.render();
      const result = await this.bridge.fsPush({
        rootId: this.selectedRoot,
        path: this.path,
        source,
      });
      this.lastPush = result.ok
        ? { ok: true, text: `${file.name} sent. The phone reports whether it arrived intact.` }
        : {
            ok: false,
            // The phone's own sentence, and its code beside it. A generic failure here would throw
            // away the one thing that distinguishes "already there" from "no room".
            text: `${file.name} — ${result.reason ?? 'the phone refused it.'}` +
              (result.code ? ` (${result.code})` : ''),
          };
      this.render();
    }
    await this.openPath(this.path);
  }

  private render(): void {
    const view = filesPaneView(this.fetch, this.pushAvailable);

    // M6 — advertised, and one direction degraded. A banner over a working pane, never red.
    this.banner.hidden = !(view.degraded && this.fetch.kind === 'ready');
    if (!this.banner.hidden) {
      // Driven by one fact, so the banner and the drop tile cannot disagree: this phone is not
      // offering the receive direction, so there is nothing to drop onto and the banner says why.
      this.banner.textContent =
        'Copying to the Mac works. Sending files to this phone does not — it is not offering that ' +
        'direction, so there is nothing here to drop files onto.';
    }

    // Drawn once, in whichever place is actually visible. The wall is standing copy on both sides
    // of this product — the phone's Folders screen carries it in every state — and it must not
    // appear twice on the one screen where both homes are on show.
    const showsState = this.fetch.kind !== 'ready' || this.roots.length <= 1;
    // F4: the canvas draws two drop tiles. One condition decides whether either exists, and it is
    // the phone's answer rather than a constant — so the tile appears the moment a phone that
    // serves push connects, and never over one that does not.
    const canUpload = uploadAffordance(this.pushAvailable) && this.fetch.kind === 'ready';
    this.drop.hidden = !canUpload;
    if (canUpload) {
      this.drop.textContent = this.lastPush?.text
        ?? `Drop files here to send them to ${this.crumbLabel()}`;
      this.drop.classList.toggle('is-error', this.lastPush?.ok === false);
    }

    this.renderRail(showsState);
    this.renderState(view, showsState);
    this.renderCrumbs();
    this.renderTable();
    this.renderDetail();
  }

  private renderRail(showsState: boolean): void {
    this.rail.replaceChildren();
    if (this.fetch.kind !== 'ready') {
      this.hintEl.textContent = '';
      this.hintEl.hidden = true;
      this.wallEl.hidden = true;
      return;
    }
    for (const root of this.roots) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'files-root';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(root.rootId === this.selectedRoot));
      if (root.rootId === this.selectedRoot) row.classList.add('is-selected');
      const name = document.createElement('span');
      name.className = 'files-root-name';
      // The breadcrumb the phone sent. The rootId is the machine handle and never appears.
      name.textContent = root.label;
      const meta = document.createElement('span');
      meta.className = 'files-root-meta';
      meta.textContent = [root.writable ? 'read and write' : 'read only', freeSpace(root.freeBytes)]
        .filter(Boolean)
        .join(' · ');
      row.append(name, meta);
      row.addEventListener('click', () => {
        if (this.selectedRoot === root.rootId) return;
        this.selectedRoot = root.rootId;
        void this.openPath('');
      });
      this.rail.append(row);
    }
    // Rendered verbatim, unparsed — the same standing the capability `unavailable` strings have.
    this.hintEl.textContent = this.grantHint ?? '';
    this.hintEl.hidden = !this.grantHint;

    // The `Download` wall. It belongs in the pane rather than in a document: a Mac user meets it by
    // looking for a file that is definitely on their phone and definitely not in this list. Shown
    // here whenever the state card — which carries the same sentence in its own copy — is not.
    this.wallEl.textContent = DOWNLOAD_WALL;
    this.wallEl.hidden = showsState;
  }

  private renderState(view: FilesPaneView, showsState: boolean): void {
    this.stateEl.replaceChildren();
    // The rule that keeps M2 and M4 apart is expressed once, in `filesPaneView`. This only draws it.
    this.stateEl.hidden = !showsState;
    if (!showsState) return;

    const card = document.createElement('div');
    card.className = `files-state-card files-state--${view.tone}`;
    card.dataset.state = view.id;

    const head = document.createElement('div');
    head.className = 'files-state-head';
    const glyph = document.createElement('span');
    glyph.className = `files-state-glyph files-state-glyph--${view.icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = GLYPH[view.icon];
    const headline = document.createElement('h3');
    headline.className = 'files-state-headline';
    headline.textContent = view.headline;
    head.append(glyph, headline);
    card.append(head);

    for (const paragraph of view.body) {
      const p = document.createElement('p');
      p.className = 'files-state-body';
      p.textContent = paragraph;
      card.append(p);
    }

    if (view.code) {
      const code = document.createElement('code');
      code.className = 'files-state-code';
      // Diagnosable beats tidy: a generic "something went wrong" is the same information as a
      // blank pane.
      code.textContent = view.code;
      card.append(code);
    }

    if (view.retry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'files-retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void this.refresh());
      card.append(retry);
    }

    this.stateEl.append(card);
  }

  /** Where a dropped file would land, in the same words the breadcrumb uses. */
  private crumbLabel(): string {
    const root = this.roots.find((r) => r.rootId === this.selectedRoot);
    if (!root) return 'this phone';
    return [root.label, ...this.path.split('/').filter(Boolean)].join(' › ');
  }

  private renderCrumbs(): void {
    this.crumbs.replaceChildren();
    if (this.fetch.kind !== 'ready' || this.selectedRoot === null) return;
    const root = this.roots.find((r) => r.rootId === this.selectedRoot);
    if (!root) return;
    // F6: the canvas's first crumb is "Internal storage", which is a fiction under SAF. The root's
    // own label is the real first segment.
    const segments = [root.label, ...this.path.split('/').filter(Boolean)];
    segments.forEach((segment, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'files-crumb-sep';
        sep.textContent = '›';
        this.crumbs.append(sep);
      }
      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.className = 'files-crumb';
      crumb.textContent = segment;
      const target = segments.slice(1, index + 1).join('/');
      crumb.addEventListener('click', () => void this.openPath(target));
      this.crumbs.append(crumb);
    });
  }

  private renderTable(): void {
    this.table.replaceChildren();
    if (this.fetch.kind !== 'ready') {
      this.footer.textContent = '';
      return;
    }
    if (this.listFailure) {
      // A directory that would not load is its own failure, distinct from the roots failing, and it
      // gets the same treatment rather than an empty table that looks like an empty folder.
      const card = document.createElement('div');
      card.className = 'files-state-card files-state--destructive';
      card.dataset.state = 'M4';
      const headline = document.createElement('h3');
      headline.className = 'files-state-headline';
      headline.textContent = 'Couldn’t open this folder';
      const body = document.createElement('p');
      body.className = 'files-state-body';
      body.textContent = this.listFailure.reason;
      card.append(headline, body);
      if (this.listFailure.code) {
        const code = document.createElement('code');
        code.className = 'files-state-code';
        code.textContent = this.listFailure.code;
        card.append(code);
      }
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'files-retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void this.openPath(this.path));
      card.append(retry);
      this.table.append(card);
      this.footer.textContent = '';
      return;
    }

    const header = document.createElement('div');
    header.className = 'files-row files-row--head';
    for (const [label, cls] of [
      ['NAME', 'files-cell-name'],
      ['DATE MODIFIED', 'files-cell-date'],
      ['SIZE', 'files-cell-size'],
    ] as const) {
      const cell = document.createElement('span');
      cell.className = cls;
      cell.textContent = label;
      header.append(cell);
    }
    this.table.append(header);

    for (const entry of this.entries) {
      const row = document.createElement('div');
      row.className = 'files-row';
      if (this.selected?.id === entry.id) row.classList.add('is-selected');
      row.setAttribute('role', 'row');

      const name = document.createElement('span');
      name.className = 'files-cell-name';
      const glyph = document.createElement('span');
      glyph.className = 'files-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = entry.dir ? '▸' : '·';
      const text = document.createElement('span');
      // `name` is the real path component and stays that way — prettifying it breaks navigation.
      // A package-shaped folder that resolves to an installed app carries `displayName` beside it,
      // and that is what goes in the muted second line, never in place of the name.
      text.textContent = entry.name;
      name.append(glyph, text);
      if (entry.displayName && entry.displayName !== entry.name) {
        const label = document.createElement('span');
        label.className = 'files-cell-app';
        label.textContent = entry.displayName;
        name.append(label);
      }

      const date = document.createElement('span');
      date.className = 'files-cell-date';
      date.textContent = entry.mtimeMs
        ? new Date(entry.mtimeMs).toLocaleString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';

      const size = document.createElement('span');
      size.className = 'files-cell-size';
      size.textContent = entry.dir ? '—' : fileBytes(entry.size);

      row.append(name, date, size);
      row.addEventListener('click', () => {
        this.selected = entry;
        this.render();
      });
      row.addEventListener('dblclick', () => {
        if (entry.dir) void this.openPath(this.path ? `${this.path}/${entry.name}` : entry.name);
      });
      this.table.append(row);
    }

    if (this.loading) {
      const more = document.createElement('div');
      more.className = 'files-loading';
      more.textContent = 'Loading…';
      this.table.append(more);
    }

    // F5: never a total. `fs.list` has no count, and getting one means paging to exhaustion.
    this.footer.textContent = loadedFooter(this.entries.length, this.hasMore);
  }

  private renderDetail(): void {
    this.detail.replaceChildren();
    const entry = this.selected;
    if (!entry) {
      const empty = document.createElement('p');
      empty.className = 'files-detail-empty';
      empty.textContent = 'Select a file to see its details.';
      this.detail.append(empty);
      return;
    }
    const title = document.createElement('h3');
    title.className = 'files-detail-title';
    title.textContent = entry.name;
    this.detail.append(title);

    const facts: Array<[string, string]> = [
      ['Kind', entry.dir ? 'Folder' : entry.mime],
      ['Size', entry.dir ? '—' : fileBytes(entry.size)],
      [
        'Modified',
        entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleString() : 'not reported by the phone',
      ],
    ];
    const grid = document.createElement('dl');
    grid.className = 'files-detail-facts';
    for (const [key, value] of facts) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      grid.append(dt, dd);
    }
    this.detail.append(grid);
    // No "Copy to Mac" button yet: this pane is the read surface, and the pull path belongs with
    // the transfer queue rather than bolted onto a detail card the day the pane lands.
  }
}

const GLYPH: Record<FilesPaneView['icon'], string> = {
  folder: '▤',
  alert: '!',
  lock: '⌁',
  spinner: '◌',
};

function fileBytes(bytes: number): string {
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

/**
 * Builds the pane, or returns null if its elements are not in the document.
 *
 * The bridge is **passed in** rather than reached for. The first version of this function looked up
 * a global by name and got `undefined` — the bridge is exposed as `connect`, not `connectSuite` —
 * and the pane then rendered nothing at all, silently, because a null view has no error path. A
 * parameter cannot be spelled wrong without the compiler saying so.
 */
function createFilesView(bridge: FilesBridge): FilesView | null {
  const banner = document.getElementById('files-banner');
  const rail = document.getElementById('files-roots');
  const hint = document.getElementById('files-grant-hint');
  const wall = document.getElementById('files-wall');
  const crumbs = document.getElementById('files-crumbs');
  const state = document.getElementById('files-state');
  const table = document.getElementById('files-table');
  const footer = document.getElementById('files-footer');
  const drop = document.getElementById('files-drop');
  const detail = document.getElementById('files-detail');
  if (
    !banner || !rail || !hint || !wall || !crumbs || !state || !table || !footer || !drop || !detail
  ) {
    return null;
  }
  return new FilesView(
    bridge, banner, rail, hint, wall, crumbs, state, table, footer, drop, detail,
  );
}

(globalThis as Record<string, unknown>).createFilesView = createFilesView;
