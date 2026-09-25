import type { ReceiveState, ShareCardSnapshot } from './share';

/**
 * The receive window's decisions, without Electron — so a test can reach every one of them.
 * `shareWindow.ts` is the half that owns a `BrowserWindow` and chooses nothing.
 *
 * docs/feature-a-receive-window.md §4.2 is the argument: a Sidekick-owned utility window that appears
 * **without taking focus**, at the normal window level, in the top-right of the work area — never a
 * Notification Center alert, never a Dock bounce, never `alwaysOnTop`.
 */

export const SHARE_WINDOW_WIDTH = 360;
export const SHARE_WINDOW_MIN_HEIGHT = 120;
export const SHARE_WINDOW_MAX_HEIGHT = 560;
/** The gap to the work area's edge: the handoff's card inset (16). */
export const SHARE_WINDOW_INSET = 16;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Top right of the **work area** — below the menu bar, clear of a Dock on either side — which is
 * where a transient Mac surface is expected and where it covers the least of what someone is doing.
 * A work area narrower than the window gets the window at its left edge rather than off screen.
 */
export function shareWindowBounds(area: Area, height: number): Area {
  const width = Math.min(SHARE_WINDOW_WIDTH, area.width);
  const h = Math.min(clampShareWindowHeight(height) ?? SHARE_WINDOW_MIN_HEIGHT, area.height);
  return {
    x: Math.round(area.x + Math.max(0, area.width - width - SHARE_WINDOW_INSET)),
    y: Math.round(area.y + Math.min(SHARE_WINDOW_INSET, Math.max(0, area.height - h))),
    width,
    height: h,
  };
}

/** The page reports its content height; anything that is not a finite number is ignored. */
export function clampShareWindowHeight(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(SHARE_WINDOW_MAX_HEIGHT, Math.max(SHARE_WINDOW_MIN_HEIGHT, raw)));
}

/** States in which an offer needs somebody to look: a decision, or a refusal nobody on this Mac saw. */
const ATTENTION: ReadonlySet<ReceiveState> = new Set<ReceiveState>(['awaiting-decision', 'refused']);

/**
 * The offers that have **just** come to need attention since [seen] was last updated — each at most
 * once, so a snapshot republished for a byte count never re-presents a window somebody closed.
 * [seen] is updated in place with every id in the list.
 */
export function newlyNeedingAttention(seen: Set<string>, snapshots: readonly ShareCardSnapshot[]): string[] {
  const fresh: string[] = [];
  for (const s of snapshots) {
    if (seen.has(s.offerId)) continue;
    seen.add(s.offerId);
    if (ATTENTION.has(s.state)) fresh.push(s.offerId);
  }
  return fresh;
}

const OFFER_ID = /^s-[A-Za-z0-9_-]{22}$/;

/**
 * `{offerId}` and nothing else — the shape every receive-window request takes that is not a decision.
 * Same rule as `parseShareDecision`: any other key refuses the request whole, so a page cannot put a
 * path beside a valid id.
 */
export function parseOfferRequest(raw: unknown): { ok: true; offerId: string } | { ok: false; why: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'not an object' };
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'offerId') return { ok: false, why: `unexpected fields: ${keys.sort().join(', ')}` };
  const offerId = (raw as { offerId: unknown }).offerId;
  if (typeof offerId !== 'string' || !OFFER_ID.test(offerId)) return { ok: false, why: 'not an offer id' };
  return { ok: true, offerId };
}

/**
 * **Version 3 only.** A file that was accepted and **queued** — so nobody was necessarily watching when
 * its turn came — and then ended *not saved* with a Retry open needs a person again: the window is
 * re-presented for it, without focus (proposal rev 3 §5). A queued file starting, progressing or being
 * saved re-presents nothing. [queued] remembers which offers were queued in their current attempt and
 * is updated in place; each failure is returned once.
 */
export function failedAfterQueue(queued: Set<string>, snapshots: readonly ShareCardSnapshot[]): string[] {
  const fresh: string[] = [];
  for (const s of snapshots) {
    if (s.state === 'queued') {
      queued.add(s.offerId);
      continue;
    }
    if (!queued.has(s.offerId)) continue;
    if (s.state === 'accepting' || s.state === 'receiving') continue;
    queued.delete(s.offerId);
    if (s.state === 'failed' && s.canRetry) fresh.push(s.offerId);
  }
  return fresh;
}
