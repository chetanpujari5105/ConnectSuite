/**
 * The Files pane's **view** of a folder — which of the loaded entries are shown, and in what order.
 * Feature D, 2026-09-23.
 *
 * ### Only what is loaded, and it says so
 *
 * `fs.list` pages 200 entries at a time and has no count. So sorting and filtering here act on the
 * entries **this Mac has loaded**, never on the folder: a "largest first" over 200 of 16,000 files is
 * the largest of those 200. [listingFooter] says that in the one place a person reads it, and it is
 * not dressed as a folder-wide answer. There is no device-wide search on this wire, and none is
 * implied.
 *
 * ### Folders first, always
 *
 * The phone orders folders first (`docs/protocol.md`), and every sort here keeps that grouping:
 * sorting by size would otherwise scatter folders — which report `size: 0` — to one end for a reason
 * that has nothing to do with them.
 *
 * ### Unknown sorts last, in either direction
 *
 * A `mtimeMs` of 0 means the phone did not report one, and a MIME type of `application/octet-stream`
 * is what the client writes when the phone sent none. Those are absences, not the smallest values,
 * so they go to the end whichever way the list is sorted — reversing a sort must not bring the
 * unknowns to the top and call them newest.
 *
 * Plain script: the renderer loads it with a `<script>` tag; the tests `require` it.
 */

type FilesSortKey = 'name' | 'date' | 'size' | 'type';
type FilesSortDir = 'asc' | 'desc';
type FilesViewMode = 'list' | 'grid';

interface FilesListingEntry {
  id: string;
  name: string;
  dir: boolean;
  size: number;
  mtimeMs: number;
  mime: string;
  displayName?: string;
}

const UNKNOWN_MIME = 'application/octet-stream';

const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The shown entries: filtered by [query] over the name (and resolved app label), then sorted. */
function visibleEntries<T extends FilesListingEntry>(
  entries: T[],
  options: { query: string; sort: FilesSortKey; dir: FilesSortDir },
): T[] {
  const needle = options.query.trim().toLocaleLowerCase();
  const kept = needle
    ? entries.filter(
        (e) =>
          e.name.toLocaleLowerCase().includes(needle) ||
          (e.displayName ?? '').toLocaleLowerCase().includes(needle),
      )
    : entries.slice();
  const sign = options.dir === 'asc' ? 1 : -1;
  const byName = (a: T, b: T) => NAME_ORDER.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return kept.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    switch (options.sort) {
      case 'name':
        return sign * byName(a, b);
      case 'date': {
        const known = unknownLast(a.mtimeMs > 0, b.mtimeMs > 0);
        if (known !== 0) return known;
        return sign * (a.mtimeMs - b.mtimeMs) || byName(a, b);
      }
      case 'size':
        return sign * (a.size - b.size) || byName(a, b);
      case 'type': {
        const ta = typeOf(a);
        const tb = typeOf(b);
        const known = unknownLast(ta !== null, tb !== null);
        if (known !== 0) return known;
        return sign * NAME_ORDER.compare(ta ?? '', tb ?? '') || byName(a, b);
      }
    }
  });
}

/** `-1` if only a is known, `1` if only b is, `0` if both or neither — never flipped by direction. */
function unknownLast(aKnown: boolean, bKnown: boolean): number {
  if (aKnown === bKnown) return 0;
  return aKnown ? -1 : 1;
}

function typeOf(entry: FilesListingEntry): string | null {
  if (entry.dir) return 'folder';
  return entry.mime && entry.mime !== UNKNOWN_MIME ? entry.mime : null;
}

/**
 * A short badge for a file with no picture: the extension, upper-cased, capped — `PDF`, `ZIP`,
 * `DOCX`. Read from the real name; a name with no extension gets `FILE` rather than a guess from the
 * MIME type, which is often the client's own default.
 */
function fileBadge(entry: { name: string; dir: boolean }): string {
  if (entry.dir) return 'Folder';
  const dot = entry.name.lastIndexOf('.');
  if (dot <= 0 || dot === entry.name.length - 1) return 'FILE';
  return entry.name.slice(dot + 1).toUpperCase().slice(0, 4);
}

/** Whether asking the phone for a thumbnail can ever succeed — images and videos only. */
function mayHaveThumbnail(entry: { dir: boolean; mime: string }): boolean {
  return !entry.dir && (entry.mime.startsWith('image/') || entry.mime.startsWith('video/'));
}

/**
 * The footer: what is shown, out of what is loaded, and whether more exists — never a total.
 */
function listingFooter(options: {
  shown: number;
  loaded: number;
  hasMore: boolean;
  query: string;
  sorted: boolean;
}): string {
  const noun = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (options.query.trim()) {
    parts.push(`${options.shown} of ${noun(options.loaded)} loaded match “${options.query.trim()}”`);
  } else {
    parts.push(`${noun(options.loaded)} loaded`);
  }
  if (options.hasMore) {
    parts.push(
      options.query.trim() || options.sorted
        ? 'more in this folder — filtering and sorting cover only what is loaded'
        : 'more in this folder',
    );
  }
  return parts.join(' · ');
}

{
  const g = globalThis as Record<string, unknown>;
  g.visibleEntries = visibleEntries;
  g.fileBadge = fileBadge;
  g.mayHaveThumbnail = mayHaveThumbnail;
  g.listingFooter = listingFooter;
}

if (typeof module !== 'undefined') {
  module.exports = { visibleEntries, fileBadge, mayHaveThumbnail, listingFooter };
}
