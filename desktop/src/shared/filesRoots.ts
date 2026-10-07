/**
 * The Files pane's state, as one value — and the reason it is one value.
 *
 * ### The empty state and the failed state are the same picture unless something stops them
 *
 * A pane showing no folders and a pane whose request died look identical to a user and, more to the
 * point, to the code that draws them. This project has recorded that shape seven times against
 * probes and providers (`CLAUDE.md`); here it is ours to make impossible rather than to detect.
 *
 * Two mechanisms, because one is a bug away from none:
 *
 * 1. **The state is a tagged union.** There is no `isEmpty` boolean beside an `error` field, so
 *    "empty" and "failed" cannot both be true, cannot both be false, and cannot disagree. The render
 *    switches on `kind` and the compiler checks it is exhaustive.
 * 2. **The two views differ in four independent ways** — tone, icon, headline verb, and whether a
 *    retry exists. `filesRoots.test.ts` asserts all four differ, so removing any one of them fails.
 *
 * ### Why the phone's Folders screen has four states and this has six
 *
 * Not an inconsistency — the surfaces have different failure modes. The phone reads
 * `persistedUriPermissions` in-process and cannot fail; this asks over a link that drops. Drawing a
 * failure state there would be unreachable decoration, and *not* drawing one here would be the trap
 * above. `docs/phase-5-files-onboarding-proposal.md` §3.1.
 */

interface FsRootRow {
  rootId: string;
  label: string;
  /**
   * `downloads` | `app` | `tree` | `all`. An unrecognised kind is shown plainly, never discarded.
   *
   * **Only `tree` is a folder the user shared.** `downloads` and `app` are on every phone before
   * anything is granted, so counting the list length to decide whether the user has shared anything
   * gives the wrong answer — and gave it here once already, see [sharedFolderCount].
   */
  kind: string;
  writable: boolean;
  freeBytes: number | null;
}

/** One entry in a directory listing, as the wire sends it. */
interface FsEntryRow {
  /** The phone's stable handle. `fs.stat`, `fs.delete` and `fs.transfer.begin` name this. */
  id: string;
  /**
   * The real path component, always — it is what the Mac sends back to navigate.
   *
   * Prettifying it would break navigation: the path is data and only the label is a sentence. Where
   * a component is a package id *and* an app by that name is installed, `displayName` goes beside
   * it, never instead of it.
   */
  name: string;
  dir: boolean;
  size: number;
  mtimeMs: number;
  mime: string;
  packageName?: string;
  displayName?: string;
}

/** What the last `fs.list` for roots did. Five cases; the sixth state rides on top — see [degraded]. */
type FilesFetch =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; roots: FsRootRow[]; grantHint: string | null }
  | { kind: 'failed'; reason: string; code: string | null; fixHint?: string }
  | { kind: 'unavailable'; reason: string; fixHint?: string };

/** The six states of the proposal, as ids, so the tests and the record use the same names. */
type FilesStateId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

interface FilesPaneView {
  id: FilesStateId;
  headline: string;
  /** Paragraphs, in order. Rendered as text — never as HTML. */
  body: string[];
  /**
   * Which of component 11's kinds this state is, and the **only** thing that decides how it draws.
   *
   * It replaces the `tone` and `icon` this interface used to carry. Those were written out per
   * branch beside a `files-state-card` that no longer exists: the pane drew its own surface, its
   * own glyph characters (`▤ ! ⌁ ◌`) and its own colour ramp, which is one of the six private
   * vocabularies D67 counted. The kind is what `stateBlock` takes, and the tone, the glyph and
   * whether an action is allowed are all its rules now — so a pane cannot disagree with the
   * component about what `error` looks like.
   */
  kind: 'loading' | 'empty' | 'error' | 'permission';
  /** Only the failed state offers one. This is one of the four M2/M4 differences. */
  retry: boolean;
  /** The phone's error code, shown in mono beneath the sentence. Diagnosable beats tidy. */
  code: string | null;
  /**
   * M6 — `files` is advertised and `push` is not served. A banner over a **working** pane, and the
   * thing that must switch the upload affordance off. Not a fetch state: it coexists with M2 and M3.
   */
  degraded: boolean;
  /** Driven by the phone's `push` field. See [uploadAffordance]. */
  upload: boolean;
}

/**
 * The `Download` wall, in the pane rather than in a document.
 *
 * A Mac user will otherwise discover it by looking for a file that is definitely on their phone and
 * definitely not in this list. Two lines here; a whole support conversation otherwise.
 */
const DOWNLOAD_WALL =
  "Files saved straight into the phone's Download folder can't be reached from here at all. " +
  'Android refuses that folder to every app. A folder inside Download is fine.';

/**
 * The good news that keeps the almost-empty state from being a dead end.
 *
 * `Received files` is `Download/ConnectSuite` through `MediaStore` and needs **no grant of any
 * kind**, so a phone that has shared nothing can still be sent a file. Before this root existed, a
 * pane with no granted folders could do nothing at all, and the copy had no better offer than
 * "go to the phone".
 */
const RECEIVED_FILES_ALWAYS_WORKS =
  'You can send files to this phone without sharing anything: they land in Received files, which ' +
  'is the Download › ConnectSuite folder on the phone.';

/**
 * What the rail, the breadcrumb, the drop tile and the send card call a root — **one home**.
 *
 * The two roots on every phone are named by `kind`, in this app's own words, rather than by the
 * phone's `label`. Phones up to 2026-10-08 label the app-private root `ConnectSuite`, which is the
 * on-disk name of the **other** root's folder (`Download/ConnectSuite`, *Received files*); on
 * 2026-10-07 a root chosen by that name was app-private, the drop tile promised *"…send them to
 * ConnectSuite"*, and the file landed where My Files cannot see it. `where` says what each one is on
 * the phone, so neither can be taken for the other. A granted tree, and any `kind` this Mac does not
 * know, keep the phone's label and no `where` — shown plainly, never discarded.
 */
function rootName(root: { kind: string; label: string }): { name: string; where: string | null } {
  switch (root.kind) {
    case 'downloads':
      return { name: 'Received files', where: 'Download/ConnectSuite on the phone' };
    case 'app':
      return { name: 'Sidekick private storage', where: 'Private to Sidekick — not shown in My Files' };
    default:
      return { name: root.label, where: null };
  }
}

/**
 * There is no `fs.grant`, and there is not going to be one.
 *
 * The inventory is fixed at twelve types. A thirteenth that made the phone open a picker would be
 * the Mac reaching for a consent surface only a person holding the phone can answer — a feature that
 * works only when the user is already at the device. So the pane must not draw an "Add folder"
 * button, and this sentence is what stands in its place.
 */
const ADDED_ON_THE_PHONE =
  'Folders are added on the phone, one at a time — the Mac cannot ask for them.';

/**
 * How many folders the **user** has shared — `kind === 'tree'`, never the list length.
 *
 * Written as a named function with this comment because the list-length version shipped and was
 * wrong the moment a second grant-free root appeared: `Received files` and `ConnectSuite` are on
 * every phone, so `roots.length > 1` was permanently true and the pane told a user who had shared
 * nothing that their phone had shared two folders. The almost-empty state — the one the whole
 * `Download` wall lives in — became unreachable in the same edit.
 *
 * That is `CLAUDE.md`'s third instrument row exactly: *check a state in the situation the user is
 * in*. The situation changed underneath the check.
 */
function sharedFolderCount(roots: FsRootRow[]): number {
  return roots.filter((root) => root.kind === 'tree').length;
}

/**
 * Whether an upload affordance may be drawn — **the phone's own answer, never a constant.**
 *
 * It was `false` for two slices while `direction: "push"` answered `FEATURE_UNAVAILABLE`, and it
 * went true the moment a phone serving push connected, from the `push` field in the roots ack and
 * nothing else. The canvas draws a "Drop files to send to phone" tile; this is the one place that
 * decision lives, so the tile, the degraded banner and this check cannot disagree.
 */
function uploadAffordance(pushAvailable: boolean): boolean {
  return pushAvailable;
}

/**
 * Whether the phone said it will receive files, read from the roots ack.
 *
 * **Absent is `false`, and so is anything that is not the boolean `true`.** Every phone built before
 * push shipped omits this field, so reading a missing value as "unknown" — or worse, as a reason to
 * try — puts a drop target over a phone that answers `FEATURE_UNAVAILABLE`. The asymmetry is the
 * same one the phone applies to `overwrite`: guessing yes costs the user something, guessing no
 * costs a feature that reappears on the next ack.
 *
 * One home because it has two readers — the main process caches it, the renderer draws from it —
 * and two spellings of "absent means no" is one spelling away from a tile nobody can explain.
 */
function pushOffered(raw: unknown): boolean {
  return raw === true;
}

/** The view for a fetch state. Pure, total, and the only place this copy exists. */
function filesPaneView(fetch: FilesFetch, pushAvailable: boolean): FilesPaneView {
  const degraded = !pushAvailable;
  const upload = uploadAffordance(pushAvailable);
  switch (fetch.kind) {
    case 'idle':
    case 'loading':
      return {
        id: 'M1',
        headline: 'Reading the phone’s folders…',
        body: [],
        kind: 'loading',
        retry: false,
        code: null,
        degraded,
        upload,
      };
    case 'unavailable':
      return {
        id: 'M5',
        // The phone's own sentence, verbatim. Never a Mac-side paraphrase — the phone knows which
        // grant is missing and this side does not.
        headline: 'This phone isn’t offering Files right now',
        body: [fetch.reason, ...(fetch.fixHint ? [fetch.fixHint] : [])],
        kind: 'permission',
        retry: false,
        code: null,
        degraded,
        upload,
      };
    case 'failed':
      return {
        id: 'M4',
        // States what *happened*. M2 states what *is*. That difference is deliberate and tested.
        headline: 'Couldn’t read the phone’s folders',
        body: [fetch.reason, ...(fetch.fixHint ? [fetch.fixHint] : [])],
        kind: 'error',
        retry: true,
        code: fetch.code,
        degraded,
        upload,
      };
    case 'ready': {
      // Folders the **user** shared. `Received files` and `ConnectSuite` are on every phone and
      // counting them here is what made the almost-empty state unreachable once already.
      const shared = sharedFolderCount(fetch.roots);
      const any = shared > 0;
      return {
        id: any ? 'M3' : 'M2',
        headline: any
          ? shared === 1
            ? 'This phone has shared one folder'
            : `This phone has shared ${shared} folders`
          // States what *is*, with no verb of failure in it — the M2/M4 difference, tested.
          : 'This phone hasn’t shared a folder yet',
        // The almost-empty case is the dangerous one: two working roots look like a broken list of
        // many, so it says plainly that the list is short by design — and that sending still works,
        // which is the one thing that makes this state not a dead end.
        body: any
          ? [ADDED_ON_THE_PHONE, DOWNLOAD_WALL]
          : [
              'Received files and Sidekick private storage are always here. To browse more of the ' +
                'phone, open Sidekick on the phone and go to Sync › Folders.',
              RECEIVED_FILES_ALWAYS_WORKS,
              ADDED_ON_THE_PHONE,
              DOWNLOAD_WALL,
            ],
        kind: 'empty',
        retry: false,
        code: null,
        degraded,
        upload,
      };
    }
  }
}

/** `27.2 GB free` — or nothing at all, rather than a plausible zero. */
function freeSpace(bytes: number | null): string {
  if (bytes === null || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]} free`;
}

/**
 * What a listing's footer says about how much of the directory is in hand.
 *
 * **Never a total.** `fs.list` has no count, and getting one means paging to exhaustion — defect
 * 55's 16,377 entries and 490 seconds before the snapshot fix. The canvas's `1,245 items` would be
 * a number with nothing behind it, which is the failure `CLAUDE.md` opens with.
 */
function loadedFooter(loaded: number, hasMore: boolean): string {
  const n = loaded.toLocaleString();
  if (hasMore) return `${n} loaded · more on the phone`;
  return loaded === 1 ? '1 item' : `${n} items`;
}

/**
 * Whether selecting a row should start fetching its bytes, so the *first* drag to Finder is a drag
 * rather than a refusal.
 *
 * ### Why this is a function and not four `if`s in the click handler
 *
 * `showsState` is the cautionary tale: one condition, living in the renderer where no test reaches
 * it, got the empty/failed distinction wrong in slice 7 and wrong the other way in slice 9 — and on
 * the second break four tests went red and **none of them touched the line that failed**. A guard on
 * the function that was written correctly is not a guard on the decision that keeps going wrong. So
 * the decision lives here, where `filesRoots.test.ts` calls it.
 *
 * ### What it decides
 *
 * `webContents.startDrag` needs a path that exists at the instant `dragstart` fires, and that
 * handler cannot await a network copy. Selection precedes the drag by however long it takes to move
 * the mouse, so that is the window. A directory is never fetched — `fs.transfer` moves one file —
 * and a row already copied or already copying is left alone, so browsing does not re-pull.
 */
function shouldPrefetchForDrag(input: {
  isDir: boolean;
  rootSelected: boolean;
  alreadyLocal: boolean;
  alreadyCopying: boolean;
}): boolean {
  if (input.isDir) return false;
  if (!input.rootSelected) return false;
  if (input.alreadyLocal) return false;
  if (input.alreadyCopying) return false;
  return true;
}

/**
 * What the detail card says when more than one row is selected.
 *
 * ### The ~104 ms ceiling, said out loud instead of discovered at 100 files
 *
 * A pull costs about **104 ms of fixed overhead per file** — one control round trip and one TLS bulk
 * connection each, measured, before any bytes move. `docs/phase-5-fs-media-proposal.md` settles the
 * protocol half twice: one `transferId`, one file, one bulk connection, and a multi-file job is n of
 * those driven by the Mac. So the loop is fine at the sizes a person selects and not fine at the
 * sizes a folder contains, and the number where that turns over is worth showing rather than
 * leaving to be met.
 *
 * Below the speculation cap the copies have already started and the card says so. Above it, nothing
 * has been spent and the card says what it would cost, so "copy 60 files" is a decision rather than
 * a surprise. `estimateMs` is deliberately the *overhead* only — it is a floor, not a promise, and
 * the wording never claims otherwise.
 */
function multiSelectionSummary(input: {
  files: number;
  totalBytes: number;
  prefetchMax: number;
  perFileOverheadMs: number;
}): { headline: string; note: string; prefetching: boolean } {
  const prefetching = input.files > 0 && input.files <= input.prefetchMax;
  const overheadMs = input.files * input.perFileOverheadMs;
  const overhead =
    overheadMs >= 1000 ? `${(overheadMs / 1000).toFixed(overheadMs >= 10000 ? 0 : 1)}s` : `${overheadMs}ms`;
  return {
    headline: `${input.files} file${input.files === 1 ? '' : 's'} selected`,
    note: prefetching
      ? `${freeSpaceless(input.totalBytes)} — copying to this Mac now, so you can drag them straight over.`
      : `${freeSpaceless(input.totalBytes)} — that is at least ${overhead} of setup before any bytes move, ` +
        `so nothing is copied until you drag them or press Copy to Mac.`,
    prefetching,
  };
}

/** Bytes, in the same words the size column uses. Named apart from `freeSpace`, which is a volume. */
function freeSpaceless(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Which of the two homes carries the `Download` wall. Exactly one, always. */
type WallHome = 'state-card' | 'rail-line';

/**
 * Where the `Download` wall is drawn — the decision that has now been wrong twice, in both
 * directions, from the same line living in the renderer where no test could reach it.
 *
 * ### Both breaks, because they are the argument for this function existing
 *
 * The wall must appear **exactly once** on screen. It has two homes: the state card's copy carries
 * it when the pane is showing a state, and a plain line in the rail carries it when the pane is
 * showing folders. Slice 7 got the condition wrong one way. Slice 9 got it wrong the other way —
 * `roots.length > 1` became permanently true the day the grant-free `ConnectSuite` destination
 * landed, so the M2 card stopped being drawn at all, on the one screen where the user has done
 * nothing yet.
 *
 * The second break is the instructive one: **four tests went red and none of them touched the line
 * that failed.** `sharedFolderCount` and `filesPaneView` were covered; this condition was not, and a
 * guard on the functions that were written correctly is not a guard on the decision that keeps
 * going wrong. When a bug recurs in one line the question is not whether the new expression is
 * right, it is what would have caught either version — and the answer was nothing, which meant the
 * line was in the wrong file.
 *
 * ### Granted trees, never the root count
 *
 * `sharedFolders` is [sharedFolderCount], not `roots.length`. `Received files` and `ConnectSuite`
 * need no grant and are on every phone, so a root count can never answer "has this user shared
 * anything".
 */
function downloadWallHome(input: { ready: boolean; sharedFolders: number }): WallHome {
  if (!input.ready) return 'state-card';
  if (input.sharedFolders === 0) return 'state-card';
  return 'rail-line';
}

/**
 * The two homes, as the renderer sets them.
 *
 * Returned as a pair from one value rather than computed twice at the two call sites, which is the
 * whole point: `stateEl.hidden` and `wallEl.hidden` were two expressions consuming one boolean in
 * opposite directions, and that is how a fix to one of them left the other drawing nothing. One
 * value in, two flags out, and `filesRoots.test.ts` asserts exactly one is true.
 */
function wallHomeVisibility(home: WallHome): { stateCard: boolean; railLine: boolean } {
  return { stateCard: home === 'state-card', railLine: home === 'rail-line' };
}

/**
 * The plain-script shape `appLabel.ts` documents: no top-level `export`, a `module.exports` shim at
 * the foot. That makes this one file loadable by a `<script>` tag in the CSP-locked renderer,
 * `require`-able from the main process, and `require`-able from `node --test` — one implementation,
 * three consumers, and its declarations are global to the TypeScript project so `main/files.ts` and
 * `preload.ts` get full types from the same file the pane calls at runtime.
 *
 * A second copy of `filesPaneView` in the renderer is the copy that would not get the next fix, and
 * the M2/M4 distinction is exactly the rule that must not have two homes.
 */
/*
 * The same names on `globalThis`, for the same reason `shared/activity.ts` carries this block.
 *
 * In the renderer these are already global — a `<script>` tag's top-level declarations are — so
 * this is a no-op there. It matters under `node --test`, where this file is a CommonJS module and
 * its declarations are module-scoped: without it, `FilesView.render` throws `filesPaneView is not
 * defined` the moment a view test mounts the pane, and the first entry on the renderer-view debt
 * list could not be cleared at all.
 *
 * The alternative was to hand the view its helpers as constructor arguments, which would let a test
 * pass in a second implementation of the very rules it is checking — the model-instead-of-call
 * fault. The view calls the one implementation, in both environments.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.filesPaneView = filesPaneView;
  g.sharedFolderCount = sharedFolderCount;
  g.uploadAffordance = uploadAffordance;
  g.pushOffered = pushOffered;
  g.freeSpace = freeSpace;
  g.loadedFooter = loadedFooter;
  g.shouldPrefetchForDrag = shouldPrefetchForDrag;
  g.multiSelectionSummary = multiSelectionSummary;
  g.downloadWallHome = downloadWallHome;
  g.wallHomeVisibility = wallHomeVisibility;
  g.DOWNLOAD_WALL = DOWNLOAD_WALL;
  g.ADDED_ON_THE_PHONE = ADDED_ON_THE_PHONE;
  g.RECEIVED_FILES_ALWAYS_WORKS = RECEIVED_FILES_ALWAYS_WORKS;
  g.rootName = rootName;
}

if (typeof module !== 'undefined') {
  module.exports = {
    filesPaneView,
    sharedFolderCount,
    uploadAffordance,
    pushOffered,
    freeSpace,
    loadedFooter,
    shouldPrefetchForDrag,
    multiSelectionSummary,
    downloadWallHome,
    wallHomeVisibility,
    DOWNLOAD_WALL,
    ADDED_ON_THE_PHONE,
    RECEIVED_FILES_ALWAYS_WORKS,
    rootName,
  };
}
