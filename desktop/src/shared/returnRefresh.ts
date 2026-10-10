/**
 * Coming back to a pane: when to ask the phone again, and how to fold the answer into what is shown.
 * One rule for every pane — written 2026-10-10 (UX batch, section 1b) after Photos was measured on
 * hardware: a photo taken while the pane stayed open never appeared, because nothing told the Mac,
 * and leaving and returning showed it only by throwing the whole grid away and reloading it.
 *
 * ### When — [shouldRefreshOnReturn]
 *
 * There is no "the phone's media changed" message on the wire, and this batch does not add one. So
 * the Mac asks at the moments a person can be expecting something new: the pane is **routed to**,
 * the window **regains focus** or becomes **visible** (they took a photo, came back to the Mac), or
 * the link **comes back**. Focus and a route often fire within the same second (clicking the Dock
 * icon onto a sidebar row), so two triggers inside [RETURN_MIN_GAP_MS] are one ask — except a
 * reconnect, which always asks, because everything held was last true before the drop. A request
 * already in flight is never doubled; the caller joins it.
 *
 * ### How — [mergeFirstPage]
 *
 * The pane asks for its **first page only** and merges it into the list it holds, so a person
 * scrolled down page four stays on page four. The fresh page is authoritative for the window it
 * covers; everything the pane held *after* that window is kept, in order:
 *
 *   held   = [A, B, C, D, E, F]      fresh page (hasMore) = [N, A, C, D]
 *   merged = [N, A, C, D, E, F]      N added at the top; B gone (deleted on the phone); E, F kept
 *
 * The window's end is the deepest held item the fresh page also contains. If the fresh page shares
 * **nothing** with what is held and the phone says there is more, the gap between them is unknown —
 * more new items than one page — and the honest answer is `reset`: reload from the top rather than
 * splice two lists with a hole between them.
 *
 * Plain script: the renderer loads it with a `<script>` tag; the tests `require` it.
 */

type ReturnTrigger = 'route' | 'focus' | 'visible' | 'reconnect';

/** Two triggers closer than this are one ask. A focus and a route land together routinely. */
const RETURN_MIN_GAP_MS = 2000;

function shouldRefreshOnReturn(input: {
  trigger: ReturnTrigger;
  nowMs: number;
  /** When this pane last asked the phone; null when it never has. */
  lastAskedAtMs: number | null;
  inFlight: boolean;
}): boolean {
  if (input.inFlight) return false;
  if (input.lastAskedAtMs === null) return true;
  if (input.trigger === 'reconnect') return true;
  return input.nowMs - input.lastAskedAtMs >= RETURN_MIN_GAP_MS;
}

type FirstPageMerge<T> = {
  items: T[];
  /** Ids in the fresh page that were not held — new on the phone. */
  added: number;
  /** Held ids inside the fresh page's window that the page no longer carries — gone on the phone. */
  removed: number;
  /** True when the fresh page and the held list cannot be joined; the caller reloads from the top. */
  reset: boolean;
};

function mergeFirstPage<T>(
  held: readonly T[],
  fresh: readonly T[],
  freshHasMore: boolean,
  idOf: (item: T) => string,
): FirstPageMerge<T> {
  const freshIds = new Set(fresh.map(idOf));
  const heldIds = new Set(held.map(idOf));
  let deepest = -1;
  for (let i = held.length - 1; i >= 0; i--) {
    if (freshIds.has(idOf(held[i]!))) {
      deepest = i;
      break;
    }
  }
  const added = fresh.filter((item) => !heldIds.has(idOf(item))).length;
  if (deepest === -1) {
    // Nothing in common. Without more pages, the fresh page *is* the whole list; with more, there is
    // an unknown gap between it and what is held.
    if (held.length > 0 && freshHasMore) return { items: [...held], added: 0, removed: 0, reset: true };
    return { items: [...fresh], added, removed: held.length, reset: false };
  }
  const window = held.slice(0, deepest + 1);
  const removed = window.filter((item) => !freshIds.has(idOf(item))).length;
  // Without more pages, the fresh page is the whole list and anything held beyond it is gone too.
  const tail = freshHasMore ? held.slice(deepest + 1) : [];
  const tailRemoved = freshHasMore ? 0 : held.length - (deepest + 1);
  return { items: [...fresh, ...tail], added, removed: removed + tailRemoved, reset: false };
}

{
  const g = globalThis as Record<string, unknown>;
  g.RETURN_MIN_GAP_MS = RETURN_MIN_GAP_MS;
  g.shouldRefreshOnReturn = shouldRefreshOnReturn;
  g.mergeFirstPage = mergeFirstPage;
}

if (typeof module !== 'undefined') {
  module.exports = { RETURN_MIN_GAP_MS, shouldRefreshOnReturn, mergeFirstPage };
}
