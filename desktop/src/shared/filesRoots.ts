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
  /** `app` | `tree` | `all`. An unrecognised kind is shown plainly, never discarded. */
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
  tone: 'neutral' | 'warning' | 'destructive';
  icon: 'folder' | 'alert' | 'lock' | 'spinner';
  /** Only the failed state offers one. This is one of the four M2/M4 differences. */
  retry: boolean;
  /** The phone's error code, shown in mono beneath the sentence. Diagnosable beats tidy. */
  code: string | null;
  /**
   * M6 — `files` is advertised and `push` is not served. A banner over a **working** pane, and the
   * thing that must switch the upload affordance off. Not a fetch state: it coexists with M2 and M3.
   */
  degraded: boolean;
  /** Never true in this build. See [uploadAffordance]. */
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
 * Whether an upload affordance may be drawn. **Always false in this build.**
 *
 * `direction: "push"` answers `FEATURE_UNAVAILABLE`; `docs/protocol.md` says *"A Files pane must not
 * draw an upload affordance against this build"* and `docs/RESUME.md` says it again. The canvas
 * draws a "Drop files to send to phone" tile, so this is the one place that decision lives, and it
 * takes the capability rather than a constant — the tile returns when push does, in the same moment,
 * from one fact.
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
        tone: 'neutral',
        icon: 'spinner',
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
        tone: 'warning',
        icon: 'lock',
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
        tone: 'destructive',
        icon: 'alert',
        retry: true,
        code: fetch.code,
        degraded,
        upload,
      };
    case 'ready': {
      const many = fetch.roots.length > 1;
      return {
        id: many ? 'M3' : 'M2',
        headline: many
          ? `This phone has shared ${fetch.roots.length} folders`
          : 'This phone has shared one folder',
        // The almost-empty case is the dangerous one: one working root looks like a broken list of
        // many, so it says plainly that the list is short by design.
        body: many
          ? [ADDED_ON_THE_PHONE, DOWNLOAD_WALL]
          : [
              'ConnectSuite’s own folder is always here. To browse more of the phone, open ' +
                'ConnectSuite on the phone and go to Sync › Folders.',
              ADDED_ON_THE_PHONE,
              DOWNLOAD_WALL,
            ],
        tone: 'neutral',
        icon: 'folder',
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
 * The plain-script shape `appLabel.ts` documents: no top-level `export`, a `module.exports` shim at
 * the foot. That makes this one file loadable by a `<script>` tag in the CSP-locked renderer,
 * `require`-able from the main process, and `require`-able from `node --test` — one implementation,
 * three consumers, and its declarations are global to the TypeScript project so `main/files.ts` and
 * `preload.ts` get full types from the same file the pane calls at runtime.
 *
 * A second copy of `filesPaneView` in the renderer is the copy that would not get the next fix, and
 * the M2/M4 distinction is exactly the rule that must not have two homes.
 */
if (typeof module !== 'undefined') {
  module.exports = {
    filesPaneView,
    uploadAffordance,
    pushOffered,
    freeSpace,
    loadedFooter,
    DOWNLOAD_WALL,
    ADDED_ON_THE_PHONE,
  };
}
