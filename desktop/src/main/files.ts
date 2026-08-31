import { MessageType, type PhoneResult } from '../shared/protocol';
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
export class FilesClient {
  private listCount = 0;
  private rootsCount = 0;
  private failures = 0;

  constructor(private readonly link: () => LinkClient | null) {}

  /**
   * The roots, from `fs.list` with no `rootId`. There is no `fs.roots` and there should not be one.
   *
   * `grantHint` is rendered verbatim and never parsed — the same standing the capability
   * `unavailable` strings have.
   */
  async roots(): Promise<PhoneResult<{ roots: FsRootRow[]; grantHint: string | null }>> {
    const result = await ask(
      this.link(),
      'files',
      MessageType.FS_LIST,
      {},
      (payload) => ({
        roots: rows(payload, 'roots').map(toRoot),
        grantHint: typeof payload.grantHint === 'string' ? payload.grantHint : null,
      }),
    );
    if (result.ok) {
      this.rootsCount += 1;
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
