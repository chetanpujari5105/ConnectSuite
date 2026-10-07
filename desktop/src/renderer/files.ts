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
 * ### Sending to the phone is gated on the phone's own answer
 *
 * The drop tile and **Send to phone…** exist only while the roots ack says `push: true` —
 * `uploadAffordance(pushAvailable)` is the one condition — and only over a writable folder. Both
 * routes end on the same confirmation card, and the batch it starts is drawn from **the phone's**
 * `fs.transfer.progress` and `fs.transfer.done`, never from this Mac's write count
 * (`shared/sendBatch.ts`).
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

/** What a pull ends with, as the main process reports it (`FilesClient.pull`). */
type PullResult = {
    ok: boolean;
    path?: string;
    bytes?: number;
    verified?: boolean;
    verifiedBy?: 'prehash' | 'blocks';
    reason?: string;
    fixHint?: string;
    paused?: boolean;
    noSpace?: boolean;
    cancelled?: boolean;
    sourceChanged?: boolean;
    resumedFrom?: number;
    stoppedBy?: 'person' | 'interruption' | 'no-space';
    restarted?: { why: string };
  };

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
  /**
   * One file to the phone, collision-safe: a name already there is offered again as `name (2)`, and
   * `sentAs` is the name the phone took. Nothing on this Mac asks the phone to overwrite.
   */
  fsSend(options: {
    rootId: string;
    path: string;
    source: string;
  }): Promise<{ ok: boolean; reason?: string; code?: string; fixHint?: string; sentAs?: string }>;
  /** **Send to phone…**'s picker. Optional so a double without a picker still constructs. */
  fsPickSend?(): Promise<
    | { ok: true; data: { files: Array<{ source: string; name: string; size: number }>; skipped: number } }
    | { ok: false; reason?: string }
  >;
  fsCancel?(options: { transferId: string }): Promise<{ ok: boolean; reason?: string }>;
  /** Stop a file this Mac is still hashing before its first byte. Optional for doubles. */
  fsSendAbort?(options: { source: string }): Promise<{ aborted: boolean }>;
  /** Defect 132 — the supported way to get a dropped file's path. */
  pathForFile?(file: File): string;
  /**
   * S4: a drop is confirmed in the main process's **native** sheet, which names every file; only its
   * **Send** lets `fsSend` read them. Optional for doubles — without it a drop sends nothing.
   */
  fsConfirmDrop?(paths: string[]): Promise<
    | { ok: true; data: { files: Array<{ source: string; name: string; size: number }>; skipped: number } }
    | { ok: false; reason?: string }
  >;
  fsPull(options: {
    rootId: string;
    id: string;
    name: string;
    size: number;
  }): Promise<PullResult>;
  fsPullStop?(options: { transferId: string; how: 'pause' | 'cancel' }): Promise<{ stopped: boolean }>;
  fsPausedPulls?(): Promise<Array<{ rootId: string; id: string; name: string; size: number; verifiedBytes: number; updatedAtMs: number }>>;
  fsCancelPaused?(options: { rootId: string; id: string }): Promise<{ removed: boolean; partial?: string }>;
  /** Synchronous by necessity — see the preload comment. Nothing may be awaited before it. */
  fsDrag(paths: string[]): void;

  /**
   * Thumbnails for `fs.*` ids, batched in the main process at the phone's cap of 32.
   *
   * Separate from the photo browser's because `fs.*` and `media.*` are disjoint id spaces: asking
   * `media.thumb` for a SAF document id answers `ok: true` with zero entries. That is the whole
   * reason `fs.thumb` exists.
   */
  fsThumbs(options: {
    rootId: string;
    ids: string[];
    maxEdge?: number;
  }): Promise<{ ok: boolean; entries?: [string, string][]; reason?: string; code?: string }>;
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

  /**
   * The row the detail card describes — the last one clicked, and the anchor a shift-click extends
   * from. Never a directory's stand-in: it is whatever was clicked, and the card reads it directly.
   */
  private selected: FsEntryRow | null = null;

  /**
   * Every selected row's id, `selected` included.
   *
   * A `Set` rather than an array because the only questions asked of it are membership and size,
   * and because a row appearing twice in a multi-file drag would hand Finder a duplicate.
   */
  private selectedIds = new Set<string>();

  /** Where a shift-click measures from. Moves on a plain or ⌘ click, not on a shift-click. */
  private selectionAnchorId: string | null = null;

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

  /**
   * Files chosen and not yet confirmed. **Nothing moves until Send is pressed** — the card names the
   * phone, the folder, the count and the total first, for a drop and for the picker alike.
   */
  private pendingSend: Array<{ source: string; name: string; size: number }> | null = null;

  /** Files that could not be offered at all (no path on disk, unreadable), counted for the card. */
  private pendingSkipped = 0;

  /**
   * The batch in flight, or the last one until it is dismissed. Its numbers are **the phone's** —
   * `fs.transfer.progress` bytes and the `fs.transfer.done` verdict — see `shared/sendBatch.ts`.
   */
  private batch: SendBatch | null = null;

  /** Where the batch is going, captured at Send, so navigating mid-batch cannot re-aim it. */
  private batchTarget: { rootId: string; path: string } | null = null;

  /** The phone's name, from the connection status, for the confirmation and the headline. */
  private phoneName = 'your phone';

  /*
   * Feature D: how the loaded entries are shown. `visibleEntries` (shared/filesListing.ts) owns the
   * rule; these are its inputs. View and sort persist per viewer; the filter belongs to one folder
   * and is cleared when the folder changes.
   */
  private viewMode: FilesViewMode = readPref('sidekick.files.view', ['list', 'grid'], 'list');
  private sortKey: FilesSortKey = readPref('sidekick.files.sort', ['name', 'date', 'size', 'type'], 'name');
  private sortDir: FilesSortDir = readPref('sidekick.files.dir', ['asc', 'desc'], 'asc');
  private query = '';
  private queryTimer: ReturnType<typeof setTimeout> | null = null;
  private toolbar: {
    search: HTMLInputElement;
    sort: HTMLSelectElement;
    dir: HTMLButtonElement;
    list: HTMLButtonElement;
    grid: HTMLButtonElement;
    send: HTMLButtonElement;
    group: HTMLElement;
  } | null = null;

  /** The entries as drawn: filtered and sorted. Never reorders [entries], which is the pager's. */
  private displayed(): FsEntryRow[] {
    return visibleEntries(this.entries, { query: this.query, sort: this.sortKey, dir: this.sortDir });
  }

  /**
   * Entry id → where that file now sits on this Mac.
   *
   * **Finder will not take a promise of a file, only a file.** `webContents.startDrag` needs a path
   * that exists at the instant the drag begins, and a `dragstart` handler cannot await a copy over
   * the network — the gesture is over long before the bytes are. So a row becomes draggable *after*
   * it has been copied, and a drag of an uncopied row starts the copy and says so.
   *
   * That is the platform's ordering rather than a limitation of this pane, and it is stated to the
   * user in one sentence instead of being hidden behind a spinner that cannot finish in time.
   */
  /**
   * Local copies and pulls in flight, both by [pullKey] — root **and** id (defect 164). An id is only
   * meaningful inside its root, and keying by id alone let a pull in one folder mark a same-id file in
   * another as copying, and a pull finishing after navigation clear the wrong key.
   */
  private localCopies = new Map<string, string>();

  /** Ids currently being copied, so a second drag on the same row does not start a second transfer. */
  private copying = new Set<string>();

  /**
   * The names of the files this Mac is pushing right now — up to `SEND_WINDOW` of one batch, each its
   * own `transferId` and its own bulk connection. Empty when none.
   */
  private pushing = new Map<string, string>();

  /**
   * Told what this pane is doing, so the status island can say it while it is happening.
   *
   * A transfer is the one thing on this Mac that is *in flight* rather than instantaneous, which is
   * what qualifies it for the island under the current-state rule. Reported from the same two
   * places that already track it — [copying] and [pushing] — rather than from a third count, so the
   * island cannot claim a transfer the pane is not running.
   */
  onWorkChanged: ((work: { verb: string; subject: string } | null) => void) | null = null;

  /**
   * The one place that turns the two in-flight sets into a sentence, called from every edge of
   * both. A pull and a push cannot overlap in practice — a drop and a drag are two gestures — but
   * if they ever do, the count is honest rather than the pane picking a favourite.
   */
  private reportWork(): void {
    const total = this.copying.size + this.pushing.size;
    if (total === 0) {
      this.onWorkChanged?.(null);
      return;
    }
    if (total > 1) {
      this.onWorkChanged?.({ verb: 'Transferring', subject: `${total} files` });
      return;
    }
    if (this.pushing.size > 0) {
      this.onWorkChanged?.({ verb: 'Sending', subject: [...this.pushing.values()][0]! });
      return;
    }
    this.onWorkChanged?.({ verb: 'Copying', subject: this.copyingName ?? 'a file' });
  }

  /** The name behind the single id in [copying], kept so [reportWork] has something to say. */
  private copyingName: string | null = null;

  /** What the last copy said. The pull's own sentence, including the phone's refusal. */
  private lastPull: { ok: boolean; text: string } | null = null;

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
    /** The listing's toolbar. Optional so the view test's eleven-element mount still constructs. */
    private readonly tools: HTMLElement | null = null,
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
      void this.offerDropped(files);
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

  /**
   * The one row or tile that carries `tabindex=0` — the listing's single tab stop (a roving
   * tabindex), so Tab reaches the list once rather than stopping on every file. Follows the last
   * clicked or keyed entry; the first drawn entry when there is none.
   */
  private focusId: string | null = null;

  /** The folder last opened, as root + path — the filter belongs to exactly this. */
  private openedKey: string | null = null;

  private async openPath(path: string): Promise<void> {
    // The filter is for the folder on screen; carrying it into another would hide that folder's
    // files behind a word typed about a different one. Keyed by root **and** path: every root's top
    // level is path '', so a path-only check kept "multi" typed in Received files as the filter over
    // Documents (found in the D review, live).
    const key = `${this.selectedRoot ?? ''}\u0000${path}`;
    if (key !== this.openedKey) this.query = '';
    this.openedKey = key;
    this.path = path;
    this.entries = [];
    this.hasMore = false;
    this.listFailure = null;
    this.selected = null;
    this.selectedIds.clear();
    this.selectionAnchorId = null;
    // Both caches are per-folder: ids are only meaningful inside a root, and holding them across a
    // navigation is how a stale picture ends up beside a new name.
    this.thumbCache.clear();
    this.thumbAsked.clear();
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

  /** Called by the renderer whenever the connection status names the phone. */
  setPhoneName(name: string | null | undefined): void {
    const next = name && name.trim() ? name.trim() : 'your phone';
    if (next === this.phoneName) return;
    this.phoneName = next;
    // A (re)connected phone is when a paused pull may have become resumable, or been resumed for us.
    void this.refreshPaused();
    this.render();
  }

  /** `fs.blocks` pulls in flight on this pane, by [pullKey] → the `transferId` Pause and Cancel name. */
  private readonly pullIds = new Map<string, string>();
  /** Paused block pulls this Mac keeps for the paired phone, by [pullKey]. */
  private paused = new Map<string, { name: string; size: number; verifiedBytes: number }>();

  /** A block pull was agreed (main's `fs-pull-agreed`): Pause and Cancel can now name it. */
  onPullAgreed(info: { transferId: string; rootId: string; id: string; name: string; resumedFrom: number; blocks: boolean }): void {
    if (!info.blocks) return;
    this.pullIds.set(pullKey(info.rootId, info.id), info.transferId);
    this.render();
  }

  /** A pull the Mac resumed by itself after a reconnect has ended. */
  onPullFinished(info: { rootId: string; id: string; name: string; result: PullResult }): void {
    this.pullIds.delete(pullKey(info.rootId, info.id));
    this.applyPullResult(info.rootId, info.id, info.name, info.result);
    void this.refreshPaused();
    this.render();
  }

  private async refreshPaused(): Promise<void> {
    if (!this.bridge.fsPausedPulls) return;
    const list = await this.bridge.fsPausedPulls().catch(() => null);
    if (!list) return;
    this.paused = new Map(list.map((p) => [pullKey(p.rootId, p.id), { name: p.name, size: p.size, verifiedBytes: p.verifiedBytes }]));
    this.render();
  }

  /** The key of [id] in the folder on screen; entries drawn are always the selected root's. */
  private keyFor(id: string): string | null {
    return this.selectedRoot === null ? null : pullKey(this.selectedRoot, id);
  }

  private localOf(id: string): string | undefined {
    const key = this.keyFor(id);
    return key === null ? undefined : this.localCopies.get(key);
  }

  private isCopying(id: string): boolean {
    const key = this.keyFor(id);
    return key !== null && this.copying.has(key);
  }

  /** One place a pull's outcome becomes the pane's state: the local copy, and the sentence. */
  private applyPullResult(rootId: string, id: string, name: string, result: PullResult): void {
    // Only a success changes the local copy: a Copy again that fails, pauses or is cancelled leaves the
    // earlier, valid copy where it was (defect 163).
    if (result.ok && result.path) this.localCopies.set(pullKey(rootId, id), result.path);
    this.lastPull = { ok: result.ok || result.paused === true || result.cancelled === true, text: pullOutcomeText(name, result) };
  }

  /** **Send to phone…** — the picker, then the same confirmation a drop gets. */
  async pickAndOffer(): Promise<void> {
    if (!this.bridge.fsPickSend || !this.canSendHere()) return;
    const picked = await this.bridge.fsPickSend();
    if (!picked.ok) return; // cancelled, or nothing chosen: nothing changes, nothing to say
    this.offer(picked.data.files, picked.data.skipped);
  }

  /**
   * A drop becomes an offer, not a send.
   *
   * **Defect 132:** `file.path` does not exist in Electron ≥ 32, so every drop used to end in
   * *"could not be read from this drop"*. The path now comes from `webUtils` through the bridge. A
   * file with no path on disk — a drag out of a browser — is counted as skipped and named on the card
   * rather than sent as zero bytes.
   */
  private async offerDropped(files: File[]): Promise<void> {
    if (!files.length) return;
    const paths: string[] = [];
    let skipped = 0;
    for (const file of files) {
      const source = this.bridge.pathForFile?.(file) ?? '';
      if (!source) {
        skipped += 1;
        continue;
      }
      paths.push(source);
    }
    if (paths.length === 0) {
      this.offer([], skipped);
      return;
    }
    // S4: this page cannot vouch for a drop — the main process asks in a native sheet naming every
    // file, and that sheet is the confirmation. Cancel there: nothing changes and nothing is said.
    if (!this.bridge.fsConfirmDrop) return;
    const confirmed = await this.bridge.fsConfirmDrop(paths).catch(() => null);
    if (!confirmed) return;
    if (!confirmed.ok) {
      if (confirmed.reason && confirmed.reason !== 'cancelled' && confirmed.reason !== 'busy') {
        this.lastPull = { ok: false, text: confirmed.reason };
        this.render();
      }
      return;
    }
    this.offer(confirmed.data.files, skipped + confirmed.data.skipped);
    if (this.pendingSend && this.pendingSend.length > 0) await this.confirmSend();
  }

  private offer(files: Array<{ source: string; name: string; size: number }>, skipped: number): void {
    // One entry per path: the same file dropped twice is one send, never two copies on the phone.
    const unique = [...new Map(files.map((f) => [f.source, f])).values()];
    if (unique.length === 0 && skipped === 0) return;
    this.pendingSend = unique;
    this.pendingSkipped = skipped;
    this.render();
  }

  /** Only a ready pane over a writable folder, on a phone that serves push, can be sent to. */
  private canSendHere(): boolean {
    if (!this.pushAvailable || this.fetch.kind !== 'ready' || this.selectedRoot === null) return false;
    const root = this.roots.find((r) => r.rootId === this.selectedRoot);
    return root?.writable === true;
  }

  private cancelOffer(): void {
    this.pendingSend = null;
    this.pendingSkipped = 0;
    this.render();
  }

  /**
   * Sends the confirmed files — **up to `SEND_WINDOW` at once**, each one `transferId`, one file, one
   * bulk connection, exactly as the protocol has it; a batch is this pump rather than a protocol
   * feature.
   *
   * The batch model decides what may start ([sendBatchNext]: the window, and a file whose name could
   * collide on the phone waiting for the earlier one's verdict) and what each item's state is; this
   * method only drives the bridge. Progress and the verdict arrive separately, as the phone's own
   * events, through [onPushAgreed] and [onTransferEvent] — and a finished write or a verdict can free
   * a slot, so both call [pumpSend].
   */
  private async confirmSend(): Promise<void> {
    const files = this.pendingSend;
    if (!files || files.length === 0 || this.selectedRoot === null) return;
    if (this.batch && !sendBatchSettled(this.batch)) return;
    this.pendingSend = null;
    this.pendingSkipped = 0;
    this.batchTarget = { rootId: this.selectedRoot, path: this.path };
    this.batch = sendBatchCreate(files, this.phoneName, this.crumbLabel());
    this.render();
    await new Promise<void>((allStarted) => {
      this.sendDrained = allStarted;
      this.pumpSend();
    });
    // Show what landed. The listing is re-read from the phone, never patched from what we sent.
    if (this.batchTarget && this.selectedRoot === this.batchTarget.rootId && this.path === this.batchTarget.path) {
      await this.openPath(this.path);
    }
  }

  /** Resolves [confirmSend] once every file has its verdict, or Stop was pressed and nothing is writing. */
  private sendDrained: (() => void) | null = null;

  /** Starts every file the model allows now. Called after each edge that can free a slot. */
  private pumpSend(): void {
    const target = this.batchTarget;
    for (let next = this.batch ? sendBatchNext(this.batch) : null; next && this.batch && target; next = sendBatchNext(this.batch)) {
      const item = next;
      this.batch = sendBatchOnStarted(this.batch, item.source);
      this.pushing.set(item.source, item.name);
      this.reportWork();
      void this.bridge
        .fsSend({ rootId: target.rootId, path: target.path, source: item.source })
        .catch((error: unknown) => ({ ok: false, reason: String(error) }))
        .then((result: { ok: boolean; reason?: string; code?: string }) => {
          this.pushing.delete(item.source);
          this.reportWork();
          if (this.batch) this.batch = sendBatchOnWriteFinished(this.batch, item.source, result);
          this.render();
          this.pumpSend();
        });
    }
    this.render();
    const over = !this.batch || sendBatchSettled(this.batch) || (this.batch.stopped && this.pushing.size === 0);
    if (over && this.sendDrained) {
      // Every file has the phone's verdict (or Stop was pressed and nothing is still writing). Until
      // then a verdict can free a slot and start the next file, through [onTransferEvent].
      const done = this.sendDrained;
      this.sendDrained = null;
      done();
    }
  }

  /** This Mac has hashed `hashed` bytes of a file it is about to send. Called by the renderer. */
  onPushChecking(checking: { source: string; hashed: number }): void {
    if (!this.batch) return;
    const next = sendBatchOnChecking(this.batch, checking.source, checking.hashed);
    if (next === this.batch) return;
    this.batch = next;
    this.render();
  }

  /** The phone acked a send; from here its events carry this id. Called by the renderer. */
  onPushAgreed(agreed: { source: string; transferId: string; name: string }): void {
    if (!this.batch) return;
    const next = sendBatchOnAgreed(this.batch, agreed.source, agreed.transferId, agreed.name);
    if (next === this.batch) return;
    this.batch = next;
    this.render();
    // Stop was pressed while this file's agreement was in flight: it has an id now, so stop it too.
    if (this.batch.stopped && this.bridge.fsCancel) void this.bridge.fsCancel({ transferId: agreed.transferId });
  }

  /**
   * `fs.transfer.progress` and `fs.transfer.done`, straight from the phone. Ids this batch does not
   * hold — a pull, a photo — fall through untouched, because `updateItem` matches nothing.
   */
  onTransferEvent(envelope: unknown): void {
    if (!this.batch) return;
    const message = envelope as { type?: string; payload?: Record<string, unknown> };
    const payload = message?.payload;
    if (!payload || typeof payload.transferId !== 'string') return;
    let next = this.batch;
    if (message.type === 'fs.transfer.progress' && typeof payload.bytes === 'number') {
      next = sendBatchOnProgress(this.batch, payload.transferId, payload.bytes);
    } else if (message.type === 'fs.transfer.done') {
      next = sendBatchOnDone(this.batch, {
        transferId: payload.transferId,
        ok: payload.ok === true,
        ...(typeof payload.bytes === 'number' ? { bytes: payload.bytes } : {}),
        ...(typeof payload.verified === 'boolean' ? { verified: payload.verified } : {}),
        ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
        ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
      });
    }
    if (next === this.batch) return;
    this.batch = next;
    // A progress tick moves one item's `delivered`, which only the send card reads, and it cannot
    // settle the batch — so it redraws the card and not the listing. Measured by the overnight UI
    // harness: a full render is ~9 ms at 200 rows and ~42 ms at 1,000, and ticks arrive up to four
    // a second per file in flight.
    if (message.type === 'fs.transfer.progress') {
      this.renderDetail();
      return;
    }
    this.render();
    // A verdict frees a window slot, and releases any file waiting on this one's name.
    if (message.type === 'fs.transfer.done') this.pumpSend();
  }

  /** Stop: queued files are not started; every one in flight is cancelled on the phone. */
  private async stopBatch(): Promise<void> {
    if (!this.batch) return;
    // `sending` **or** `confirming`: the Mac's write finishes well before the phone has the bytes —
    // measured live, the item was `confirming` at 866 ms with the phone reporting 30% — so a Stop
    // that looked only for `sending` would leave the phone receiving a file the person stopped.
    // Every such file, not the first: several are in flight at once. One still waiting for its
    // agreement has no id yet; [onPushAgreed] stops it when the id arrives.
    const live = this.batch.items.filter(
      (i) => (i.phase === 'sending' || i.phase === 'confirming') && i.transferId,
    );
    // Still being hashed on this Mac: no id, no bytes sent. Ending the hash ends the send, and
    // its IPC resolves as "stopped before it started".
    const hashing = this.batch.items.filter((i) => i.phase === 'sending' && !i.transferId);
    this.batch = sendBatchStop(this.batch);
    this.render();
    if (this.bridge.fsSendAbort) {
      await Promise.all(hashing.map((i) => this.bridge.fsSendAbort!({ source: i.source })));
    }
    if (this.bridge.fsCancel) {
      await Promise.all(live.map((i) => this.bridge.fsCancel!({ transferId: i.transferId! })));
    }
  }

  private dismissBatch(): void {
    if (this.batch && !sendBatchSettled(this.batch)) return;
    this.batch = null;
    this.batchTarget = null;
    this.render();
  }

  /**
   * Copies one entry to this Mac, so it can be opened, kept, or dragged into Finder.
   *
   * Serialised per entry by [copying]: a second click, or a second drag, joins nothing and starts
   * nothing. Two callers on one fetch is the mistake this pane already made once with `refresh()`,
   * and here the cost would be two transfers writing the same `.part`.
   */
  /**
   * Pending selection-triggered copy. One timer, because one row is selected at a time.
   *
   * Cleared and rescheduled on every selection, so arrow-keying or clicking down a list starts a
   * copy for the row you **stopped on** rather than one for every row you passed through. Without
   * this, browsing a 600-row directory would pull 600 files.
   */
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long a row must stay selected before its bytes are worth fetching. */
  private static readonly PREFETCH_DELAY_MS = 250;

  /**
   * How many selected files may be fetched speculatively.
   *
   * **Derived from the measurement, not chosen.** A pull costs ~104 ms of fixed overhead — one
   * control round trip and one TLS bulk connection, per file, before any bytes — so eight files is
   * about 830 ms, which fits inside the time it takes to move a hand to Finder. Twenty is two
   * seconds and a hundred is ten, both of which are a link busy with work nobody asked for.
   *
   * Above this, selecting costs nothing and the copy waits to be asked. The number moves only if
   * that per-file cost is measured again; it is not a comfort setting.
   */
  private static readonly PREFETCH_MAX_FILES = 8;

  /**
   * Fixed cost of one pull, measured — a control round trip plus a TLS bulk connection, before any
   * bytes. 215 KB and 104 MB differ by 1.3 s of wire and by nothing here. It is what
   * [PREFETCH_MAX_FILES] is derived from and what the multi-selection card quotes, so the two can
   * never drift into disagreeing about the same number.
   */
  private static readonly PULL_OVERHEAD_MS = 104;

  /**
   * Start the copy when a row is *selected*, so the first drag is a drag rather than a refusal.
   *
   * **Finder will not take a promise of a file, only a file.** `webContents.startDrag` needs a path
   * that exists at the instant the gesture begins, and `dragstart` cannot await a network copy — the
   * gesture is over long before the bytes are. That ordering is the platform's and does not change.
   * What changes is *when the copy starts*: selection precedes the drag by however long it takes to
   * move the mouse, and that is the window this uses.
   *
   * The `dragstart` refusal stays, because the copy may still be in flight and a wrong answer to
   * Finder is worse than an honest one. It is now the uncommon path rather than the guaranteed
   * first experience of the feature.
   *
   * Directories are never fetched: `fs.transfer` moves one file, and a folder copy is a loop the
   * Mac would have to drive, which is a transfer queue and not this pane.
   */
  /**
   * What a click does to the selection: replace, toggle (⌘/Ctrl), or extend (⇧).
   *
   * The range is taken over `this.entries`, which is the order the phone returned and the order
   * drawn — never over a re-sorted copy, or a shift-click would select a range the user cannot see.
   * Directories are allowed in a selection so ⌘A-style sweeps behave, and are filtered out where it
   * matters: nothing copies them, nothing drags them.
   */
  private selectOn(entry: FsEntryRow, event: MouseEvent): void {
    const extend = event.shiftKey;
    const toggle = event.metaKey || event.ctrlKey;

    if (extend && this.selectionAnchorId !== null) {
      // Over the **drawn** order — sorted and filtered — or a shift-click would select a range the
      // person cannot see. It used to be `this.entries` when the drawn order was the phone's.
      const shown = this.displayed();
      const from = shown.findIndex((e) => e.id === this.selectionAnchorId);
      const to = shown.findIndex((e) => e.id === entry.id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        this.selectedIds = new Set(shown.slice(lo, hi + 1).map((e) => e.id));
        this.selected = entry;
        return;
      }
      // Anchor scrolled out of the loaded window. Fall through to a plain click rather than
      // guessing at a range whose other end is not in `entries` — a selection the user cannot see
      // is worse than a selection they have to make again.
    }

    if (toggle) {
      if (this.selectedIds.has(entry.id) && this.selectedIds.size > 1) {
        this.selectedIds.delete(entry.id);
        // The card follows something still selected, so it never describes a deselected row.
        if (this.selected?.id === entry.id) {
          const survivor = this.entries.find((e) => this.selectedIds.has(e.id));
          this.selected = survivor ?? null;
        }
      } else {
        this.selectedIds.add(entry.id);
        this.selected = entry;
      }
      this.selectionAnchorId = entry.id;
      return;
    }

    this.selectedIds = new Set([entry.id]);
    this.selected = entry;
    this.selectionAnchorId = entry.id;
  }

  /** The selected rows, in the drawn order, files only. The order Finder receives them in. */
  private selectedFiles(): FsEntryRow[] {
    return this.displayed().filter((e) => this.selectedIds.has(e.id) && !e.dir);
  }

  /** Thumbnails that have arrived, keyed by entry id. Cleared when the folder changes. */
  private thumbCache = new Map<string, string>();

  /** Ids already asked about, so a redraw does not re-ask. Holds "has none" as well as "arrived". */
  private thumbAsked = new Set<string>();

  private thumbFor(entry: FsEntryRow): string | undefined {
    return this.thumbCache.get(entry.id);
  }

  /**
   * Ask for one entry's thumbnail, once.
   *
   * **Once**, including when the answer is "this file has none" — `thumbAsked` is added to before
   * the request, not after it, so a folder of documents does not re-ask on every redraw. A redraw
   * happens on every click, so the difference is between one request and one per interaction.
   *
   * Directories are never asked about: the phone answers `NO_THUMBNAIL` for them by contract, and
   * spending a round trip to be told something the wire already guarantees is a request that only
   * has one possible answer.
   */
  private async requestThumb(entry: FsEntryRow): Promise<void> {
    if (entry.dir || this.selectedRoot === null) return;
    if (this.thumbAsked.has(entry.id)) return;
    this.thumbAsked.add(entry.id);
    const result = await this.bridge.fsThumbs({ rootId: this.selectedRoot, ids: [entry.id] });
    if (!result.ok || !result.entries) return;
    let arrived = false;
    for (const [id, data] of result.entries) {
      this.thumbCache.set(id, data);
      if (id === entry.id) arrived = true;
    }
    // Redraw only if this entry is still the one on screen and something actually came back. A
    // render on every reply would fight the selection the user has moved on to.
    if (arrived && this.selected?.id === entry.id) this.render();
  }

  /** The one home for the decision. Called twice — once to schedule, once at the moment of acting. */
  private prefetchable(entry: FsEntryRow): boolean {
    return shouldPrefetchForDrag({
      isDir: entry.dir,
      rootSelected: this.selectedRoot !== null,
      alreadyLocal: this.localOf(entry.id) !== undefined,
      alreadyCopying: this.isCopying(entry.id),
    });
  }

  private prefetchSelection(): void {
    if (this.prefetchTimer !== null) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
    const wanted = this.selectedFiles();
    if (wanted.length === 0) return;

    // **The 104 ms ceiling, applied rather than only documented.** Each file costs one control round
    // trip and one TLS bulk connection — measured at ~104 ms mean, and that is fixed cost before any
    // bytes. Speculating on a large selection would spend it without being asked: 100 files is ten
    // seconds of link the user never requested, and they may have selected them to drag, to delete,
    // or by dragging a marquee across the table by accident.
    //
    // So speculation is capped and the explicit path is not. Above the cap the copy waits for the
    // drag or for **Copy to Mac**, which is the user asking for it.
    if (wanted.length > FilesView.PREFETCH_MAX_FILES) return;
    const ids = wanted.map((e) => e.id);

    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      // Re-tested at the moment of acting, not when the timer was set: the selection can have moved
      // on, the pane can have navigated, a copy can have finished. The predicate that decides
      // whether to act is the same expression that decided what was seen, evaluated again here — a
      // check that does not gate the action is decoration.
      const still = this.selectedFiles();
      if (still.length !== ids.length || !still.every((e, i) => e.id === ids[i])) return;
      for (const entry of still) {
        if (this.prefetchable(entry)) void this.copyToMac(entry);
      }
    }, FilesView.PREFETCH_DELAY_MS);
  }

  /** [again]: Copy again over a local copy, which is kept unless the new copy succeeds (defect 163). */
  private async copyToMac(entry: FsEntryRow, again = false): Promise<void> {
    if (this.selectedRoot === null || entry.dir) return;
    // The root is captured now: the person may open another folder before this pull ends (defect 164).
    const rootId = this.selectedRoot;
    const key = pullKey(rootId, entry.id);
    if (this.copying.has(key) || (!again && this.localCopies.has(key))) return;
    this.copying.add(key);
    this.copyingName = entry.name;
    this.reportWork();
    this.lastPull = { ok: true, text: `Copying ${entry.name} to this Mac…` };
    this.render();
    try {
      const result = await this.bridge.fsPull({
        rootId,
        id: entry.id,
        name: entry.name,
        size: entry.size,
      });
      // `verified` is the phone's word and is repeated rather than upgraded; the fix hint travels with
      // the reason. Both now live in [pullOutcomeText], beside a paused, cancelled or changed pull.
      this.applyPullResult(rootId, entry.id, entry.name, result);
    } finally {
      this.pullIds.delete(key);
      void this.refreshPaused();
      this.copying.delete(key);
      if (this.copying.size === 0) this.copyingName = null;
      // In the `finally`, so a throw cannot leave the island narrating a copy that is over. That is
      // the whole contract of `setWork` — nothing expires on a timer, so whoever starts the work
      // owes the clear on every path out.
      this.reportWork();
      this.render();
    }
  }

  private render(): void {
    const view = filesPaneView(this.fetch, this.pushAvailable);

    /*
     * M6 — advertised, and one direction degraded. A **compact** state block over a working pane
     * (D67), `partial` rather than `error`: half a feature is not a failure, and the tone map puts
     * a partial result in amber. It was `files-banner`, two rules of its own.
     *
     * Driven by one fact, so the block and the drop tile cannot disagree: this phone is not
     * offering the receive direction, so there is nothing to drop onto and the block says why.
     */
    this.banner.replaceChildren();
    this.banner.hidden = !(view.degraded && this.fetch.kind === 'ready');
    if (!this.banner.hidden) {
      this.banner.appendChild(
        stateBlock({
          kind: 'partial',
          headline: 'This phone does not accept files',
          body:
            'Copying to the Mac works. Sending files to this phone does not — it is not offering ' +
            'that direction, so there is nothing here to drop files onto.',
          compact: true,
        }),
      );
    }

    // Drawn once, in whichever place is actually visible. The wall is standing copy on both sides
    // of this product — the phone's Folders screen carries it in every state — and it must not
    // appear twice on the one screen where both homes are on show.
    //
    // **Granted trees, never the root count.** `Received files` and `ConnectSuite` are on every
    // phone, so `roots.length <= 1` became permanently false the day the grant-free destination
    // landed — and the state card, which is where the `Download` wall lives, stopped drawing for
    // everyone. `CLAUDE.md` already carries this exact failure one row up: a state checked in the
    // situation that makes it easy to render rather than the one users are in.
    // One value, two flags. Both homes are set from `homes` below and neither is the negation of
    // the other's variable — see `downloadWallHome`, which carries why this left the renderer.
    const homes = wallHomeVisibility(
      downloadWallHome({
        ready: this.fetch.kind === 'ready',
        sharedFolders: sharedFolderCount(this.roots),
      }),
    );
    // F4: the canvas draws two drop tiles. One condition decides whether either exists, and it is
    // the phone's answer rather than a constant — so the tile appears the moment a phone that
    // serves push connects, and never over one that does not.
    const canUpload = uploadAffordance(this.pushAvailable) && this.canSendHere();
    this.drop.hidden = !canUpload;
    if (canUpload) {
      this.drop.textContent = this.batch && !sendBatchSettled(this.batch)
        ? 'A send is in progress. Drop more files when it has finished.'
        : `Drop files here to send them to ${this.crumbLabel()}`;
    }
    this.renderTools(canUpload);

    this.renderRail(homes.railLine);
    this.renderState(view, homes.stateCard);
    this.renderCrumbs();
    this.renderTable();
    this.renderDetail();
  }

  /**
   * The listing's toolbar. **Send to phone…** is drawn under exactly the drop tile's condition, so
   * the two affordances cannot disagree about whether this folder accepts files.
   */
  private renderTools(canUpload: boolean): void {
    if (!this.tools) return;
    const t = this.toolbar ?? this.buildToolbar(this.tools);
    // The listing controls exist whenever there is a listing; Send only where the folder takes files.
    const listing = this.fetch.kind === 'ready' && !this.listFailure;
    t.group.hidden = !listing;
    t.send.hidden = !canUpload || !this.bridge.fsPickSend;
    t.send.disabled = this.batch !== null && !sendBatchSettled(this.batch);
    t.send.setAttribute('aria-label', `Send files to ${this.crumbLabel()}`);
    // Only written back when nobody is typing: a render inside the debounce (a click on Grid, a
    // progress tick) used to put the *old* query into the field and erase the new one before the
    // debounce read it — caught live by the Feature D probe. A programmatic change (Clear filter,
    // a new folder) arrives with no pending keystrokes, and is written.
    if (this.queryTimer === null && t.search.value !== this.query) t.search.value = this.query;
    t.sort.value = this.sortKey;
    t.dir.textContent = this.sortDir === 'asc' ? '↑' : '↓';
    t.dir.setAttribute(
      'aria-label',
      `Sort ${this.sortDir === 'asc' ? 'ascending' : 'descending'} — press to reverse`,
    );
    t.list.setAttribute('aria-pressed', String(this.viewMode === 'list'));
    t.grid.setAttribute('aria-pressed', String(this.viewMode === 'grid'));
  }

  /**
   * Built once. Rebuilding on every render would replace the search field under the person typing
   * in it — focus and caret gone on each keystroke.
   */
  private buildToolbar(host: HTMLElement): NonNullable<FilesView['toolbar']> {
    const group = document.createElement('div');
    group.className = 'files-tool-group';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'files-search';
    search.id = 'files-search';
    search.placeholder = 'Filter this folder';
    // Says what it searches: the files already loaded here — there is no device-wide search.
    search.setAttribute('aria-label', 'Filter the files loaded in this folder by name');
    search.addEventListener('input', () => {
      if (this.queryTimer !== null) clearTimeout(this.queryTimer);
      this.queryTimer = setTimeout(() => {
        this.queryTimer = null;
        this.query = search.value;
        this.render();
      }, 120);
    });
    search.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && search.value) {
        search.value = '';
        this.query = '';
        this.render();
      }
    });

    const sort = document.createElement('select');
    sort.className = 'files-sort';
    sort.id = 'files-sort';
    sort.setAttribute('aria-label', 'Sort by');
    for (const [value, label] of [
      ['name', 'Name'],
      ['date', 'Date modified'],
      ['size', 'Size'],
      ['type', 'Type'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      sort.append(option);
    }
    sort.addEventListener('change', () => this.setSort(sort.value as FilesSortKey, this.sortDir));

    const dir = document.createElement('button');
    dir.type = 'button';
    dir.className = 'button files-tool files-sort-dir';
    dir.id = 'files-sort-dir';
    dir.addEventListener('click', () => this.setSort(this.sortKey, this.sortDir === 'asc' ? 'desc' : 'asc'));

    const views = document.createElement('div');
    views.className = 'files-view-toggle';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'View');
    const mk = (mode: FilesViewMode, label: string, icon: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'files-view-button';
      b.id = `files-view-${mode}`;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.append(iconSvg(icon, 14));
      b.addEventListener('click', () => {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        writePref('sidekick.files.view', mode);
        this.render();
      });
      views.append(b);
      return b;
    };
    const list = mk('list', 'List view', 'list');
    const grid = mk('grid', 'Grid view', 'grid');

    group.append(search, sort, dir, views);

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'button files-tool files-send-button';
    // A stable name, so a driver presses it by its label and never by a coordinate.
    send.id = 'files-send-to-phone';
    send.append(iconSvg('upload', 14), document.createTextNode('Send to phone…'));
    send.addEventListener('click', () => void this.pickAndOffer());

    host.append(group, send);
    this.toolbar = { search, sort, dir, list, grid, send, group };
    return this.toolbar;
  }

  private setSort(key: FilesSortKey, dir: FilesSortDir): void {
    this.sortKey = key;
    this.sortDir = dir;
    writePref('sidekick.files.sort', key);
    writePref('sidekick.files.dir', dir);
    this.render();
  }

  private renderRail(railLine: boolean): void {
    this.rail.replaceChildren();

    // The `Download` wall. It belongs in the pane rather than in a document: a Mac user meets it by
    // looking for a file that is definitely on their phone and definitely not in this list.
    //
    // Set here, once, **before any early return.** The not-ready path used to assign it a second
    // time as `true`, which was redundant — `downloadWallHome` already answers `state-card` when the
    // pane is not ready, so `railLine` is already false — and a redundant second assignment to one
    // of two complementary flags is precisely how these two drifted apart twice.
    this.wallEl.textContent = DOWNLOAD_WALL;
    this.wallEl.hidden = !railLine;

    if (this.fetch.kind !== 'ready') {
      this.hintEl.textContent = '';
      this.hintEl.hidden = true;
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
      // `rootName`: the two fixed roots by kind, a granted tree by the phone's breadcrumb. The rootId
      // is the machine handle and never appears.
      const named = rootName(root);
      name.textContent = named.name;
      const meta = document.createElement('span');
      meta.className = 'files-root-meta';
      meta.textContent = [named.where, root.writable ? 'read and write' : 'read only', freeSpace(root.freeBytes)]
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

  }

  /**
   * The pane-level state, as a **compact** state block (D67's approved two-layout system).
   *
   * It used to be `files-state-card` — sixteen CSS rules, four glyph characters and its own colour
   * ramp, one of six private vocabularies drawing the same six facts as component 11. Two of them
   * appeared **in one screenshot**: this card, red and left-aligned in the rail column, beside the
   * detail column's centred `state-block` saying *Nothing selected*.
   *
   * Compact rather than full, because this lives in a narrow column: the full layout is centred in
   * a pane-sized region and would leave the rail's width mostly empty.
   *
   * **M2 and M4 still differ in four independent ways** — the rule
   * `docs/phase-5-files-onboarding-proposal.md` §3 insists on — and they now differ *by
   * construction* rather than by four fields written out per branch: `empty` and `error` carry
   * different tones, different glyphs, different headlines, and only one of them is allowed an
   * action. `filesView.test.ts` asserts all four on the rendered block.
   */
  private renderState(view: FilesPaneView, stateCard: boolean): void {
    this.stateEl.replaceChildren();
    this.stateEl.hidden = !stateCard;
    if (!stateCard) return;

    const block = stateBlock({
        kind: view.kind,
        headline: view.headline,
        body: view.body,
        code: view.code ?? undefined,
        // `empty` keeps the pane's own glyph; every other kind takes the component's.
        icon: view.kind === 'empty' ? 'files' : undefined,
        compact: true,
        action: view.retry ? { label: 'Try again', run: () => void this.refresh() } : undefined,
    });
    // The state's identity stays readable from the DOM — `filesView.test.ts` and the probes both
    // name states by M-id, and the component has no opinion about a caller's own labels.
    block.dataset.state = view.id;
    this.stateEl.appendChild(block);
  }

  /** Where a dropped file would land, in the same words the breadcrumb uses. */
  private crumbLabel(): string {
    const root = this.roots.find((r) => r.rootId === this.selectedRoot);
    if (!root) return 'this phone';
    return [rootName(root).name, ...this.path.split('/').filter(Boolean)].join(' › ');
  }

  private renderCrumbs(): void {
    this.crumbs.replaceChildren();
    if (this.fetch.kind !== 'ready' || this.selectedRoot === null) return;
    const root = this.roots.find((r) => r.rootId === this.selectedRoot);
    if (!root) return;
    // F6: the canvas's first crumb is "Internal storage", which is a fiction under SAF. The root's
    // own label is the real first segment.
    const segments = [rootName(root).name, ...this.path.split('/').filter(Boolean)];
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
      // After it is in the document, so the browser can say whether the ellipsis cut it.
      titleWhenClipped(crumb, segment);
    });
  }

  private renderTable(): void {
    // Read BEFORE the rows are replaced: emptying the table moves focus to the page, so asking
    // afterwards always answered "no" and any redraw not started by a key — a copy finishing —
    // dropped the keyboard out of the list (seen live after Enter).
    const hadFocus =
      typeof document !== 'undefined' && !!document.activeElement &&
      this.table.contains?.(document.activeElement as Node) === true;
    this.table.replaceChildren();
    if (this.fetch.kind !== 'ready') {
      this.footer.textContent = '';
      return;
    }
    if (this.listFailure) {
      /*
       * A directory that would not load is its own failure, distinct from the roots failing, and
       * it gets the same treatment rather than an empty table that looks like an empty folder.
       *
       * **The second `files-state-card` in this file, and the one that makes the case for D67.**
       * It was a hand-built copy of the card twenty lines above it: same classes, same structure,
       * a second `Try again`. Two copies of one vocabulary inside one pane is how six of them
       * accumulated across the app. It is `stateBlock` now, like its sibling, so the next change
       * to what a failure looks like reaches both without anyone remembering this one exists.
       */
      const card = stateBlock({
        kind: 'error',
        headline: 'Couldn’t open this folder',
        body: this.listFailure.reason,
        code: this.listFailure.code ?? undefined,
        compact: true,
        action: { label: 'Try again', run: () => void this.openPath(this.path) },
      });
      card.dataset.state = 'M4';
      this.table.append(card);
      this.footer.textContent = '';
      return;
    }

    const shown = this.displayed();
    const grid = this.viewMode === 'grid';
    // A redraw replaces every row; `hadFocus` (read above, before the rows went) brings the
    // keyboard back to the same file afterwards.
    if (this.focusId === null || !shown.some((e) => e.id === this.focusId)) {
      this.focusId = shown[0]?.id ?? null;
    }
    this.table.classList.toggle('files-table--grid', grid);
    this.table.setAttribute('aria-label', grid ? 'Files, as a grid' : 'Files');

    if (!grid) {
      // The header sorts, as in Finder: press a column to sort by it, press it again to reverse.
      const header = document.createElement('div');
      header.className = 'files-row files-row--head';
      for (const [label, cls, key] of [
        ['NAME', 'files-cell-name', 'name'],
        ['DATE MODIFIED', 'files-cell-date', 'date'],
        ['SIZE', 'files-cell-size', 'size'],
      ] as const) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `${cls} files-head-sort`;
        const active = this.sortKey === key;
        cell.textContent = active ? `${label} ${this.sortDir === 'asc' ? '↑' : '↓'}` : label;
        cell.setAttribute(
          'aria-sort',
          active ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
        );
        cell.addEventListener('click', () =>
          this.setSort(key, active && this.sortDir === 'asc' ? 'desc' : 'asc'),
        );
        header.append(cell);
      }
      this.table.append(header);
    }

    if (shown.length === 0 && this.entries.length > 0 && this.query.trim()) {
      // Filtered to nothing is not an empty folder, and must not look like one.
      const none = stateBlock({
        kind: 'empty',
        icon: 'search',
        headline: `Nothing loaded here matches “${this.query.trim()}”`,
        body: this.hasMore
          ? 'Only the files loaded so far are searched. Load more, or clear the filter.'
          : 'The filter covers every file in this folder.',
        compact: true,
        action: {
          label: 'Clear filter',
          run: () => {
            this.query = '';
            this.render();
          },
        },
      });
      none.dataset.state = 'filtered-empty';
      this.table.append(none);
    }

    if (this.entries.length === 0 && !this.loading && !this.hasMore) {
      // The phone listed nothing. Said as exactly that — not "this folder is empty": on the
      // SM-S938B the phone answers 0 for granted DCIM, Documents and Pictures trees that are not
      // empty (defect 137), so the pane cannot know emptiness, only what it was told.
      const none = stateBlock({
        kind: 'empty',
        icon: 'files',
        headline: 'No files listed here',
        body: 'The phone returned nothing for this folder.',
        compact: true,
      });
      none.dataset.state = 'listed-empty';
      this.table.append(none);
    }

    for (const entry of shown) {
      const cell = grid ? this.tileFor(entry) : this.rowFor(entry);
      this.wireEntry(cell, entry);
      this.table.append(cell);
    }
    if (grid) this.requestGridThumbs(shown);
    if (hadFocus) this.focusCell(this.focusId);

    if (this.loading) {
      const more = document.createElement('div');
      more.className = 'files-loading';
      more.textContent = 'Loading…';
      this.table.append(more);
    }

    // F5: never a total. `fs.list` has no count, and getting one means paging to exhaustion. With a
    // filter or a sort in force the footer says they cover only what is loaded, and it carries an
    // explicit Load more — a filtered list may be too short to scroll, so scrolling cannot be the
    // only way to reach the rest.
    this.footer.replaceChildren();
    const text = document.createElement('span');
    text.textContent = listingFooter({
      shown: shown.length,
      loaded: this.entries.length,
      hasMore: this.hasMore,
      query: this.query,
      sorted: this.sortKey !== 'name' || this.sortDir !== 'asc',
    });
    this.footer.append(text);
    if (this.hasMore && !this.loading) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'files-load-more';
      more.id = 'files-load-more';
      more.textContent = 'Load more';
      more.addEventListener('click', () => void this.loadMore());
      this.footer.append(more);
    }
  }

  /**
   * Keys on a focused row or tile. Only what a pointer already does:
   * arrows = a plain click on the next row (Shift = a shift-click), Space = click, Enter = the same
   * as a double-click — open a folder, or **Copy to Mac** for a file. Nothing new is invented.
   */
  private onEntryKey(event: KeyboardEvent, entry: FsEntryRow): void {
    const shown = this.displayed();
    const at = shown.findIndex((e) => e.id === entry.id);
    if (at === -1) return;
    const columns = this.viewMode === 'grid' ? this.gridColumns() : 1;
    const step: Record<string, number> = this.viewMode === 'grid'
      ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
      : { ArrowUp: -1, ArrowDown: 1 };
    let target: number | null = null;
    if (event.key in step) target = Math.min(shown.length - 1, Math.max(0, at + step[event.key]!));
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = shown.length - 1;

    if (target !== null) {
      event.preventDefault();
      const next = shown[target]!;
      this.selectOn(next, { shiftKey: event.shiftKey, metaKey: false, ctrlKey: false } as MouseEvent);
      this.focusId = next.id;
      this.render();
      this.focusCell(next.id);
      this.prefetchSelection();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      this.selectOn(entry, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey } as MouseEvent);
      this.render();
      this.focusCell(entry.id);
      this.prefetchSelection();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Exactly the double-click handler's two branches.
      if (entry.dir) void this.openPath(this.path ? `${this.path}/${entry.name}` : entry.name);
      else void this.copyToMac(entry);
    }
  }

  /** How many tiles share the first row, measured — never assumed from a width. */
  private gridColumns(): number {
    const tiles = Array.from(this.table.querySelectorAll('.files-tile')) as HTMLElement[];
    if (tiles.length === 0 || typeof tiles[0]!.getBoundingClientRect !== 'function') return 1;
    const top = tiles[0]!.getBoundingClientRect().top;
    return Math.max(1, tiles.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2).length);
  }

  private focusCell(id: string | null): void {
    if (id === null) return;
    const cells = [
      ...Array.from(this.table.querySelectorAll('.files-row')),
      ...Array.from(this.table.querySelectorAll('.files-tile')),
    ];
    const cell = cells.find(
      (c) => (c as HTMLElement).dataset?.id === id,
    ) as HTMLElement | undefined;
    if (cell && typeof cell.focus === 'function') cell.focus();
  }

  /** One list row: name (with the resolved app label beside a package folder), date, size. */
  private rowFor(entry: FsEntryRow): HTMLElement {
    const row = document.createElement('div');
    row.className = 'files-row';
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
    return row;
  }

  /**
   * One grid tile. A picture only where the phone sent one (`fs.thumb`, images and videos only);
   * every other file is a neutral badge carrying its real extension — never a stand-in image.
   */
  private tileFor(entry: FsEntryRow): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'files-tile';
    tile.setAttribute('role', 'gridcell');
    tile.title = entry.name;
    const art = document.createElement('div');
    art.className = 'files-tile-art';
    const thumb = this.thumbCache.get(entry.id);
    if (thumb) {
      const img = document.createElement('img');
      img.className = 'files-tile-thumb';
      img.src = `data:image/jpeg;base64,${thumb}`;
      img.alt = '';
      art.append(img);
    } else if (entry.dir) {
      art.classList.add('is-folder');
      art.append(iconSvg('files', 28));
    } else {
      const badge = document.createElement('span');
      badge.className = 'files-tile-badge';
      badge.textContent = fileBadge(entry);
      art.append(badge);
    }
    const name = document.createElement('span');
    name.className = 'files-tile-name';
    name.textContent = entry.name;
    const meta = document.createElement('span');
    meta.className = 'files-tile-meta';
    meta.textContent = entry.dir ? (entry.displayName ?? 'Folder') : fileBytes(entry.size);
    tile.append(art, name, meta);
    return tile;
  }

  /** Selection, open, and drag to Finder — identical for a row and a tile. */
  private wireEntry(cell: HTMLElement, entry: FsEntryRow): void {
    if (this.selectedIds.has(entry.id)) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-selected', 'true');
    } else {
      cell.setAttribute('aria-selected', 'false');
    }
    // Keyboard: one tab stop for the whole listing, and a name that says what the row is.
    cell.tabIndex = entry.id === this.focusId ? 0 : -1;
    cell.dataset.id = entry.id;
    cell.setAttribute(
      'aria-label',
      entry.dir
        ? `${entry.name}, folder`
        : `${entry.name}, ${fileBytes(entry.size)}` +
          (entry.mtimeMs ? `, modified ${new Date(entry.mtimeMs).toLocaleDateString()}` : ''),
    );
    cell.addEventListener('focus', () => {
      this.focusId = entry.id;
    });
    cell.addEventListener('keydown', (event) => this.onEntryKey(event as KeyboardEvent, entry));
    cell.addEventListener('click', (event) => {
      this.focusId = entry.id;
      this.selectOn(entry, event as MouseEvent);
      this.render();
      this.prefetchSelection();
    });
    cell.addEventListener('dblclick', () => {
      if (entry.dir) void this.openPath(this.path ? `${this.path}/${entry.name}` : entry.name);
      else void this.copyToMac(entry);
    });

    // Drag to Finder. A folder is never draggable — `fs.transfer` moves one file and a folder
    // copy is a loop the Mac would have to drive, which is a transfer queue and not this.
    if (entry.dir) return;
    const local = this.localOf(entry.id);
    cell.draggable = true;
    if (local) cell.classList.add('is-local');
    // The wait, at the row rather than only in the detail card. A selected row whose bytes are
    // still arriving is the one state where a drag will be refused, so it is the one state that
    // has to be legible without reading the card on the other side of the pane.
    if (this.isCopying(entry.id)) {
      cell.classList.add('is-copying');
      cell.setAttribute('aria-busy', 'true');
    }
    cell.addEventListener('dragstart', (event) => {
      // Dragging a row that is not in the selection drags **that row**, and makes it the
      // selection — the behaviour every file manager has, and the one that avoids a drag
      // quietly carrying rows the user selected somewhere further up the table.
      const dragging = this.selectedIds.has(entry.id) ? this.selectedFiles() : [entry];

      const ready = dragging.filter((e) => this.localOf(e.id) !== undefined);
      if (ready.length !== dragging.length) {
        // **The drag is cancelled, and the copies start.** Finder needs files that exist at the
        // instant the gesture begins; awaiting them here would hand it nothing and look like a
        // drag that did not register. Partial is not an option either — handing over the ready
        // half of a selection is a silent wrong answer, which is defect 56's shape.
        event.preventDefault();
        for (const e of dragging) {
          if (this.prefetchable(e)) void this.copyToMac(e);
        }
        return;
      }

      // `startDrag` must be called while this handler is still on the stack — the bridge sends
      // rather than invokes, and nothing here may be awaited.
      event.preventDefault();
      this.bridge.fsDrag(dragging.map((e) => this.localOf(e.id)!));
    });
  }

  /**
   * Grid thumbnails, batched at the phone's cap by the main process, asked **once** per id —
   * including when the answer is "none" — and only for images and videos, which are the only files
   * the phone can make one for. Redraws once when any arrive.
   */
  private requestGridThumbs(shown: FsEntryRow[]): void {
    if (this.selectedRoot === null) return;
    const rootId = this.selectedRoot;
    const wanted = shown.filter((e) => mayHaveThumbnail(e) && !this.thumbAsked.has(e.id)).map((e) => e.id);
    if (wanted.length === 0) return;
    for (const id of wanted) this.thumbAsked.add(id);
    void this.bridge.fsThumbs({ rootId, ids: wanted }).then((result) => {
      if (!result.ok || !result.entries || this.selectedRoot !== rootId) return;
      let arrived = 0;
      for (const [id, data] of result.entries) {
        this.thumbCache.set(id, data);
        arrived += 1;
      }
      if (arrived > 0 && this.viewMode === 'grid') this.render();
    });
  }

  private renderDetail(): void {
    this.detail.replaceChildren();

    // A send being confirmed, or running, owns the column: it is what the person just did, and a
    // file's details beside it would compete with the one decision on screen.
    if (this.pendingSend !== null) {
      this.renderSendConfirm(this.pendingSend);
      this.markArrival('confirm');
      return;
    }
    if (this.batch !== null) {
      this.renderSendBatch(this.batch);
      this.markArrival('batch');
      // Defect 162: a send still running owns the column — its Stop is the decision on screen. A
      // *settled* send is a result: it stays on show with its Done, but a file selected afterwards gets
      // its own details and controls beneath it, so a pull started then can be paused or cancelled
      // without first dismissing a card about a different transfer.
      if (!sendBatchSettled(this.batch) || (this.selected === null && this.selectedIds.size <= 1)) return;
    } else {
      this.lastCard = null;
    }

    // More than one row selected: the card describes the *set*, because describing one of them and
    // acting on all of them is the mismatch that makes a multi-file drag feel like it misfired.
    if (this.selectedIds.size > 1) {
      const files = this.selectedFiles();
      const summary = multiSelectionSummary({
        files: files.length,
        totalBytes: files.reduce((sum, e) => sum + e.size, 0),
        prefetchMax: FilesView.PREFETCH_MAX_FILES,
        perFileOverheadMs: FilesView.PULL_OVERHEAD_MS,
      });

      const title = document.createElement('h3');
      title.className = 'files-detail-title';
      title.textContent = summary.headline;

      const note = document.createElement('p');
      note.className = 'files-detail-note';
      note.textContent = summary.note;

      const copied = files.filter((e) => this.localOf(e.id) !== undefined).length;
      const ready = document.createElement('p');
      ready.className = 'files-detail-note';
      // The denominator, so "3 ready" cannot be read as "3 left to go".
      ready.textContent = `${copied} of ${files.length} on this Mac.`;

      const button = document.createElement('button');
      button.className = 'files-detail-action';
      button.textContent =
        copied === files.length ? 'Drag them to Finder' : `Copy ${files.length - copied} to this Mac`;
      button.disabled = copied === files.length;
      button.addEventListener('click', () => {
        for (const e of files) {
          if (this.prefetchable(e)) void this.copyToMac(e);
        }
      });

      this.detail.append(title, note, ready, button);
      return;
    }

    const entry = this.selected;
    if (!entry) {
      // The shared empty state (component 11), not a stray sentence.
      this.detail.append(
        stateBlock({
          kind: 'empty',
          icon: 'files',
          headline: 'Nothing selected',
          body: 'Choose a file to see its details, save it to this Mac, or reveal it in Finder.',
        }),
      );
      return;
    }
    const title = document.createElement('h3');
    title.className = 'files-detail-title';
    title.textContent = entry.name;
    this.detail.append(title);

    // F-2, which needed the protocol. The image is drawn only when the bytes are already here —
    // never a spinner that may never resolve, and never a box for a file that has no thumbnail,
    // because most files do not and an empty frame on every `.txt` is worse than no frame.
    const cached = this.thumbFor(entry);
    if (cached) {
      const img = document.createElement('img');
      img.className = 'files-detail-thumb';
      img.src = `data:image/jpeg;base64,${cached}`;
      // Its own dimensions, so a thumbnail is never drawn larger than it was made — the Photos pane
      // upscaled one two and a half times and it looked like a rendering bug in the encoder.
      img.alt = '';
      this.detail.append(img);
    }
    void this.requestThumb(entry);

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

    if (entry.dir) return;

    const local = this.localOf(entry.id);
    const button = document.createElement('button');
    button.className = 'files-detail-action';
    button.type = 'button';
    // A stable accessibility name, because a coordinate is a guess about a layout that is still
    // moving — `CLAUDE.md`'s first driving rule, met by giving the target a name rather than by
    // remembering a pixel.
    button.id = 'files-copy-to-mac';
    const key = this.selectedRoot === null ? null : pullKey(this.selectedRoot, entry.id);
    const paused = key ? this.paused.get(key) : undefined;
    const running = key ? this.pullIds.get(key) : undefined;
    if (this.isCopying(entry.id)) {
      button.textContent = 'Copying…';
      button.disabled = true;
    } else if (paused) {
      button.textContent = 'Resume';
      button.setAttribute('aria-label', `Resume copying ${entry.name} to this Mac`);
    } else if (local) {
      button.textContent = 'Copy again';
    } else {
      button.textContent = 'Copy to Mac';
    }
    button.addEventListener('click', () => {
      // Copy again keeps the copy it would replace until a new one has actually arrived (defect 163);
      // deleting it first left the pane with no copy at all when the new attempt failed.
      void this.copyToMac(entry, local !== undefined);
    });
    this.detail.append(button);

    // `fs.blocks` (owner decision D2): Pause keeps what has arrived, Cancel deletes only this copy's part.
    const control = (id: string, label: string, aria: string, act: () => void): void => {
      const b = document.createElement('button');
      b.className = 'files-detail-action';
      b.type = 'button';
      b.id = id;
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', act);
      this.detail.append(b);
    };
    if (this.isCopying(entry.id) && running && this.bridge.fsPullStop) {
      const stop = this.bridge.fsPullStop.bind(this.bridge);
      control('files-pull-pause', 'Pause', `Pause copying ${entry.name}; what has arrived is kept`, () => void stop({ transferId: running, how: 'pause' }));
      control('files-pull-cancel', 'Cancel', `Cancel copying ${entry.name}; the part received is deleted`, () => void stop({ transferId: running, how: 'cancel' }));
    } else if (paused && !this.isCopying(entry.id)) {
      const pausedNote = document.createElement('p');
      pausedNote.className = 'files-detail-note';
      pausedNote.id = 'files-pull-paused';
      pausedNote.textContent = pausedSentence(paused.verifiedBytes, paused.size);
      this.detail.append(pausedNote);
      if (this.bridge.fsCancelPaused && this.selectedRoot !== null) {
        const cancel = this.bridge.fsCancelPaused.bind(this.bridge);
        const rootId = this.selectedRoot;
        control('files-pull-cancel-paused', 'Cancel', `Cancel the paused copy of ${entry.name}; the part received is deleted`, () => {
          void cancel({ rootId, id: entry.id }).then(() => {
            this.lastPull = { ok: true, text: `${entry.name} — cancelled. The part that had arrived was deleted.` };
            return this.refreshPaused();
          });
        });
      }
    }

    const note = document.createElement('p');
    note.className = 'files-detail-note';
    note.id = 'files-drag-note';
    // Two sentences, and which one shows is the whole state. The unavailable case says what to do
    // rather than what is missing.
    note.textContent = local
      ? `On this Mac at ${local}. Drag the row into Finder to put it anywhere.`
      : 'Copy it to the Mac before dragging it to Finder — Finder needs the file itself, not a ' +
        'promise of one, so the drag cannot fetch it as it starts.';
    this.detail.append(note);

    if (this.lastPull) {
      const status = document.createElement('p');
      status.className = 'files-detail-note';
      status.classList.toggle('is-error', !this.lastPull.ok);
      status.textContent = this.lastPull.text;
      this.detail.append(status);
    }
  }

  /** The confirmation: phone, folder, count, total, and the collision rule — then Send or Cancel. */
  /** Which send card was drawn last, so the arrival plays once per card and not on each redraw. */
  private lastCard: 'confirm' | 'batch' | null = null;

  /**
   * One frame of `.is-arriving`, then removed — only when the card is new. Progress events redraw the
   * batch card several times a second; replaying the entrance on each would be motion for nothing.
   */
  private markArrival(kind: 'confirm' | 'batch'): void {
    if (this.lastCard === kind) return;
    this.lastCard = kind;
    const card = this.detail.querySelector('.files-send');
    if (!card) return;
    card.classList.add('is-arriving');
    card.classList.add('motion-fade');
    // After the next paint, the same shape as `overview.ts`'s `afterNextPaint`; with no paint loop
    // (the view test's DOM double) the mark comes off at once and the card simply is there.
    const settle = () => card.classList.remove('is-arriving');
    if (typeof requestAnimationFrame !== 'function') settle();
    else requestAnimationFrame(() => requestAnimationFrame(settle));
  }

  private renderSendConfirm(files: Array<{ source: string; name: string; size: number }>): void {
    const card = document.createElement('section');
    card.className = 'files-send';
    card.setAttribute('aria-label', 'Send to phone');

    const title = document.createElement('h3');
    title.className = 'files-detail-title';
    const total = files.reduce((sum, f) => sum + f.size, 0);
    title.textContent = files.length === 0
      ? 'Nothing to send'
      : `Send ${files.length} file${files.length === 1 ? '' : 's'} to ${this.phoneName}?`;
    card.append(title);

    const facts = document.createElement('dl');
    facts.className = 'files-detail-facts';
    for (const [key, value] of [
      ['To', this.crumbLabel()],
      ['Total', fileBytes(total)],
    ] as const) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    }
    card.append(facts);

    if (files.length > 0) {
      const list = document.createElement('ul');
      list.className = 'files-send-list';
      const SHOWN = 6;
      for (const f of files.slice(0, SHOWN)) {
        const li = document.createElement('li');
        li.className = 'files-send-item';
        const name = document.createElement('span');
        name.className = 'files-send-name';
        name.textContent = f.name;
        const size = document.createElement('span');
        size.className = 'files-send-meta';
        size.textContent = fileBytes(f.size);
        li.append(name, size);
        list.append(li);
      }
      if (files.length > SHOWN) {
        const more = document.createElement('li');
        more.className = 'files-send-more';
        more.textContent = `and ${files.length - SHOWN} more`;
        list.append(more);
      }
      card.append(list);
    }

    const notes: string[] = [];
    if (this.pendingSkipped > 0) {
      notes.push(
        `${this.pendingSkipped} item${this.pendingSkipped === 1 ? ' was' : 's were'} left out — ` +
          'only files saved on this Mac can be sent, not folders or items dragged from an app.',
      );
    }
    notes.push(
      'Nothing on the phone is replaced. A name that is already there arrives as “name (2)”.',
    );
    for (const text of notes) {
      const p = document.createElement('p');
      p.className = 'files-detail-note';
      p.textContent = text;
      card.append(p);
    }

    const actions = document.createElement('div');
    actions.className = 'files-send-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button';
    cancel.id = 'files-send-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancelOffer());
    actions.append(cancel);
    if (files.length > 0) {
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'button primary-action';
      send.id = 'files-send-confirm';
      send.textContent = 'Send';
      send.addEventListener('click', () => void this.confirmSend());
      actions.append(send);
    }
    card.append(actions);
    this.detail.append(card);
  }

  private renderSendBatch(batch: SendBatch): void {
    const summary = sendBatchSummary(batch);
    const settled = sendBatchSettled(batch);

    const card = document.createElement('section');
    card.className = 'files-send';
    card.setAttribute('aria-label', 'Sending to phone');
    card.dataset.state = settled ? (summary.failed > 0 ? 'partial' : 'done') : 'sending';

    const title = document.createElement('h3');
    title.className = 'files-detail-title';
    title.textContent = summary.headline;
    card.append(title);

    // One bar for the batch, from bytes the phone reported. `progress` with a real value — never an
    // indeterminate bar: a small file emits no progress at all, and then the bar simply jumps.
    const bar = document.createElement('progress');
    bar.className = 'files-send-bar';
    bar.max = 1;
    bar.value = summary.fraction;
    bar.setAttribute('aria-label', `${Math.round(summary.fraction * 100)}% delivered to the phone`);
    card.append(bar);

    const detail = document.createElement('p');
    detail.className = 'files-detail-note';
    detail.textContent = summary.detail;
    card.append(detail);

    const list = document.createElement('ul');
    list.className = 'files-send-list';
    for (const item of batch.items) {
      const li = document.createElement('li');
      li.className = 'files-send-item';
      li.dataset.phase = item.phase;
      const name = document.createElement('span');
      name.className = 'files-send-name';
      name.textContent = item.name;
      const status = sendItemStatus(item);
      const meta = document.createElement('span');
      meta.className = `files-send-meta is-${status.tone}`;
      // A glyph only where the state has settled one way or the other; in flight, the bar says it.
      if (status.tone === 'good') meta.append(iconSvg('check', 12));
      if (status.tone === 'bad') meta.append(iconSvg('alert', 12));
      meta.append(document.createTextNode(status.text));
      li.append(name, meta);
      if ((item.phase === 'sending' || item.phase === 'confirming') && item.size > 0) {
        const own = document.createElement('progress');
        own.className = 'files-send-bar files-send-bar--item';
        own.max = item.size;
        own.value = item.delivered;
        li.append(own);
      }
      list.append(li);
    }
    card.append(list);

    const actions = document.createElement('div');
    actions.className = 'files-send-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    if (settled) {
      button.id = 'files-send-done';
      button.textContent = 'Done';
      button.addEventListener('click', () => this.dismissBatch());
    } else {
      button.id = 'files-send-stop';
      button.textContent = 'Stop';
      button.addEventListener('click', () => void this.stopBatch());
    }
    actions.append(button);
    card.append(actions);

    if (!settled && batch.items.some((i) => i.phase === 'sending' || i.phase === 'confirming')) {
      const note = document.createElement('p');
      note.className = 'files-detail-note';
      note.textContent =
        'Stopping keeps what has arrived as a partial file on the phone; sending the same file again resumes it.';
      card.append(note);
    }
    this.detail.append(card);
  }

}

/** What each item is doing, in the phone's words where the phone has said something. */
function sendItemStatus(item: SendItem): { text: string; tone: 'neutral' | 'live' | 'good' | 'bad' } {
  switch (item.phase) {
    case 'queued':
      return { text: 'Waiting', tone: 'neutral' };
    case 'sending':
    case 'confirming':
      // Both phases draw the **phone's** count. `confirming` means this Mac has finished writing,
      // which happens long before the phone has received the bytes — so while the phone is still
      // counting, the count is what is true; once it has all of them, the verdict is what is owed.
      if (item.delivered > 0 && item.delivered < item.size) {
        return { text: `${fileBytes(item.delivered)} of ${fileBytes(item.size)} on the phone`, tone: 'live' };
      }
      // Every size is hashed before its first byte, so the phone can check what lands. A large
      // file spends visible seconds here; say what is happening rather than "Starting…".
      if (item.phase === 'sending' && !item.transferId && item.checked > 0 && item.checked < item.size) {
        return { text: `Checking ${fileBytes(item.checked)} of ${fileBytes(item.size)} before sending`, tone: 'live' };
      }
      return {
        text: item.phase === 'sending' ? 'Starting…' : 'Waiting for the phone to confirm',
        tone: 'live',
      };
    case 'arrived':
      return {
        text:
          (item.sentAs && item.sentAs !== item.name ? `Arrived as ${item.sentAs}` : 'Arrived') +
          (item.verified ? ' · checksum matched' : ' · not checksummed'),
        tone: 'good',
      };
    case 'failed':
      return { text: item.reason ?? 'Failed', tone: 'bad' };
    case 'cancelled':
      return { text: item.reason ?? 'Stopped', tone: 'neutral' };
  }
}

/**
 * A per-viewer convenience — the view and sort someone last chose. `localStorage` can be absent or
 * throw (a private profile, cleared site data), so a failed read is the default and a failed write
 * is nothing: the pane never depends on it.
 */
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Remembering is a convenience; forgetting is not a failure.
  }
}

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
  const tools = document.getElementById('files-tools');
  if (
    !banner || !rail || !hint || !wall || !crumbs || !state || !table || !footer || !drop || !detail
  ) {
    return null;
  }
  return new FilesView(
    bridge, banner, rail, hint, wall, crumbs, state, table, footer, drop, detail, tools,
  );
}

/**
 * The page's `window.connect`, as far as the Files pane reaches it: the preload's calls under their
 * own names, and the event subscriptions the pane consumes. Every call here is always exposed by the
 * preload, so none is optional on this side — only the view's bridge treats some as optional, for
 * doubles.
 */
interface FilesConnect {
  fsRoots: FilesBridge['fsRoots'];
  fsList: FilesBridge['fsList'];
  fsSend: FilesBridge['fsSend'];
  fsPickSend: NonNullable<FilesBridge['fsPickSend']>;
  fsCancel: NonNullable<FilesBridge['fsCancel']>;
  fsSendAbort: NonNullable<FilesBridge['fsSendAbort']>;
  pathForFile: NonNullable<FilesBridge['pathForFile']>;
  fsConfirmDrop: NonNullable<FilesBridge['fsConfirmDrop']>;
  fsPull: FilesBridge['fsPull'];
  fsPullStop: NonNullable<FilesBridge['fsPullStop']>;
  fsPausedPulls: NonNullable<FilesBridge['fsPausedPulls']>;
  fsCancelPaused: NonNullable<FilesBridge['fsCancelPaused']>;
  fsDrag: FilesBridge['fsDrag'];
  fsThumbs: FilesBridge['fsThumbs'];
  onPushAgreed(callback: (agreed: Parameters<FilesView['onPushAgreed']>[0]) => void): void;
  onPushChecking(callback: (checking: Parameters<FilesView['onPushChecking']>[0]) => void): void;
  onPullAgreed(callback: (info: Parameters<FilesView['onPullAgreed']>[0]) => void): void;
  onPullFinished(callback: (info: Parameters<FilesView['onPullFinished']>[0]) => void): void;
  onMessage(callback: (envelope: unknown) => void): void;
  onStatus(callback: (status: { deviceName?: string | null }) => void): void;
}

/**
 * The Files pane's bridge, built from the page's `connect` — **the one the running app uses**.
 *
 * It lives here rather than as an object literal in `renderer.ts` so a test can call it: that literal
 * was top-level code no test could reach, and it omitted Pause, Resume and Cancel's three calls while
 * every Files-pane test passed, because each test built its own bridge that had them (defect 156).
 */
function filesBridgeFrom(connect: FilesConnect): FilesBridge {
  return {
    fsRoots: () => connect.fsRoots(),
    fsList: (options) => connect.fsList(options),
    fsSend: (options) => connect.fsSend(options),
    fsPickSend: () => connect.fsPickSend(),
    fsCancel: (options) => connect.fsCancel(options),
    fsSendAbort: (options) => connect.fsSendAbort(options),
    pathForFile: (file) => connect.pathForFile(file),
    fsConfirmDrop: (paths) => connect.fsConfirmDrop(paths),
    fsPull: (options) => connect.fsPull(options),
    fsPullStop: (options) => connect.fsPullStop(options),
    fsPausedPulls: () => connect.fsPausedPulls(),
    fsCancelPaused: (options) => connect.fsCancelPaused(options),
    fsDrag: (paths) => connect.fsDrag(paths),
    fsThumbs: (options) => connect.fsThumbs(options),
  };
}

/**
 * The Files pane's event subscriptions, on the view the page built. A send is drawn from the phone's
 * own events: the id arrives the moment the phone acks, then every `fs.transfer.progress`/`done` for
 * it is routed here; the pane ignores ids it does not hold, so a pull or a photo passing through
 * changes nothing. A block pull's agreement is what lets Pause and Cancel name it.
 */
function wireFilesEvents(connect: FilesConnect, view: FilesView): void {
  connect.onPushAgreed((agreed) => view.onPushAgreed(agreed));
  connect.onPushChecking((checking) => view.onPushChecking(checking));
  connect.onPullAgreed((info) => view.onPullAgreed(info));
  connect.onPullFinished((info) => view.onPullFinished(info));
  connect.onMessage((envelope) => view.onTransferEvent(envelope));
  connect.onStatus((status) => view.setPhoneName(status.deviceName));
}

/**
 * What a finished pull says about how it was checked — three different facts, three sentences. A
 * block-verified pull (`fs.blocks`) had no digest agreed *before* the copy, so it must not borrow the
 * pre-hash sentence; and an unverified pull must never be dressed as either (defect 56 in reverse).
 */
function pullCheckSentence(result: { verified?: boolean; verifiedBy?: 'prehash' | 'blocks' }): string {
  if (result.verified === true && result.verifiedBy === 'blocks') {
    return 'Verified block by block: every part matched what the phone read, and the file did not change while it was copied.';
  }
  if (result.verified === true) return 'Its checksum matched the one agreed before the copy.';
  return 'No checksum was agreed in advance, so nothing compared the bytes.';
}
(globalThis as Record<string, unknown>).pullCheckSentence = pullCheckSentence;

function pullKey(rootId: string, id: string): string {
  return `${rootId}\u0000${id}`;
}

/** What a paused block pull has kept, in the units a person reads. */
function pausedSentence(verifiedBytes: number, size: number): string {
  // Facts only: what to do next is said once, by the outcome line (defect 165).
  return `Paused: ${fileBytes(verifiedBytes)} of ${fileBytes(size)} is on this Mac, checked block by block.`;
}

/**
 * The sentence for how a pull ended — one home for every outcome, so a paused, cancelled, changed or
 * low-space pull is never worded as a failure it was not, and a success never claims a check that did
 * not happen ([pullCheckSentence]).
 */
function pullOutcomeText(name: string, result: PullResult): string {
  // A reason is a clause from the main process ("the phone closed after 0 of 109051904 bytes") and may
  // carry no full stop; the next sentence must not run on from it (defect 158, seen on hardware).
  const reason = (fallback: string): string => {
    const r = (result.reason ?? fallback).trim();
    return /[.!?]$/.test(r) ? r : `${r}.`;
  };
  if (result.ok) {
    // "Started again" only for a restart that happened: the phone refused the resume and the pull
    // began again at byte 0 (defect 165). A resume is not a restart, and a first pull is neither.
    const restart = result.restarted
      ? (result.restarted.why === 'source-changed'
        ? ' The file changed on the phone since it paused, so it started again from the beginning.'
        : ' It started again from the beginning.')
      : '';
    return `${name} is on this Mac — drag it to Finder from here. ${pullCheckSentence(result)}` +
      (result.resumedFrom ? ' It continued from where it had paused.' : restart);
  }
  if (result.cancelled) return `${name} — cancelled. Nothing was saved, and the part that had arrived was deleted.`;
  if (result.paused && result.noSpace) {
    return `${name} paused — ${reason('this Mac is running out of space.')} What had arrived is kept; free some space, then choose Resume.`;
  }
  // Defect 165: each stop is worded once — who stopped it, that what arrived is kept, and how it goes on.
  if (result.paused && result.stoppedBy === 'person') return `${name} paused. What had arrived is kept; Resume continues from there.`;
  if (result.paused && result.stoppedBy === 'interruption') {
    return `${name} stopped: ${reason('the copy stopped')} What had arrived is kept. It continues by itself if the phone reconnects within 10 minutes, or choose Resume.`;
  }
  if (result.paused) return `${name} paused — ${reason('the copy stopped.')} What had arrived is kept; Resume continues from there.`;
  if (result.sourceChanged) return `${name} — ${reason('the file changed on the phone.')} Nothing was saved.`;
  return `${name} — ${result.reason ?? 'the copy failed.'}` + (result.fixHint ? ` ${result.fixHint}` : '');
}
(globalThis as Record<string, unknown>).pullOutcomeText = pullOutcomeText;

(globalThis as Record<string, unknown>).createFilesView = createFilesView;
(globalThis as Record<string, unknown>).filesBridgeFrom = filesBridgeFrom;
(globalThis as Record<string, unknown>).wireFilesEvents = wireFilesEvents;
// The view class itself, so `filesView.test.ts` drives the real one rather than a paraphrase. It is
// the first entry on `scripts/check-renderer-views.mjs`'s debt list, and it is there because the
// `Download` wall's two homes broke twice — in opposite directions — with a green suite each time.
(globalThis as Record<string, unknown>).FilesView = FilesView;
