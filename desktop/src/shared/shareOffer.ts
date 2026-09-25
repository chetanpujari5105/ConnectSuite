/**
 * The Mac's side of a share offer — docs/protocol.md → Share, slice 2 of
 * `docs/phase-7-share-plan.md`. Pure and electron-free: `main/share.ts` wires it to the link.
 *
 * **This revision never accepts.** An offer that passes validation is answered with the
 * `not-available` decline, a protocol stub rather than a person's decision; there is no card and
 * no Accept of any kind. Validation still matters now, because it is the boundary every later
 * revision inherits: an offer that is malformed, replayed, unnegotiated or one-too-many is refused
 * here before anything could ever act on it.
 */

export const OFFER_TTL_MS = 10 * 60 * 1000;
/** Clock skew tolerated between phone and Mac when judging `expiresAtMs`. */
export const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type DeclineReason =
  | 'not-available'
  | 'not-negotiated'
  | 'malformed-offer'
  | 'busy'
  | 'user'
  | 'folder-unavailable'
  | 'insufficient-space'
  | 'unsupported-destination';

export interface ShareItem {
  itemId: '0';
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface ShareOfferPayload {
  offerId: string;
  rootId: string;
  from: string;
  item: ShareItem;
  expiresAtMs: number;
}

/** What to do with one incoming `share.offer`. */
export type OfferVerdict =
  /** No usable `offerId`: there is nothing a `share.respond` could name. Logged only. */
  | { kind: 'unanswerable'; why: string }
  /** An `offerId` already seen this run. The first was answered once; this is logged, not answered. */
  | { kind: 'replay'; offerId: string }
  | { kind: 'decline'; offerId: string; reason: DeclineReason; why: string }
  /** Valid. The caller answers it (in this revision, with the `not-available` stub). */
  | { kind: 'valid'; offer: ShareOfferPayload; macExpiresAtMs: number };

const OFFER_ID = /^s-[A-Za-z0-9_-]{22}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIME = /^[^/\s]+\/[^/\s]+$/;

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Field rules from the contract's table. Returns the first broken rule, or null. */
export function malformation(p: Record<string, unknown>, nowMs: number): string | null {
  const offerId = p.offerId as string;
  if (p.rootId !== `share:${offerId}`) return 'rootId is not share:<offerId>';
  if (typeof p.from !== 'string' || p.from.length < 1 || p.from.length > 128) return 'from out of rule';
  const item = p.item;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return 'item is not one object';
  const i = item as Record<string, unknown>;
  if (i.itemId !== '0') return 'itemId is not "0"';
  if (typeof i.name !== 'string' || utf8Bytes(i.name) < 1 || utf8Bytes(i.name) > 255) return 'name out of rule';
  if (typeof i.mime !== 'string' || i.mime.length > 127 || !MIME.test(i.mime)) return 'mime out of rule';
  if (typeof i.size !== 'number' || !Number.isSafeInteger(i.size) || i.size < 0) return 'size out of rule';
  if (typeof i.sha256 !== 'string' || !SHA256.test(i.sha256)) return 'sha256 out of rule';
  const e = p.expiresAtMs;
  if (typeof e !== 'number' || !Number.isSafeInteger(e)) return 'expiresAtMs is not an integer';
  if (e <= nowMs) return 'expiresAtMs is already past';
  if (e > nowMs + OFFER_TTL_MS + EXPIRY_SKEW_MS) return 'expiresAtMs is too far ahead';
  return null;
}

interface Held {
  sessionKey: string;
  macExpiresAtMs: number;
}

/**
 * One Mac run's view of offers. `seen` spans the run, so a replay on a later session is still a
 * replay; `held` is only the offers still live (which, outside the debug `shareSilent` switch, is
 * none — every valid offer is answered at once).
 */
export class ShareOfferBook {
  private readonly seen = new Set<string>();
  private readonly held = new Map<string, Held>();

  /**
   * [ctx.maxLiveOffers] is how many offers one session may hold live at once. **Absent means 1** — the
   * version-2 contract, and the only value any caller passes today. Version 3 (docs/protocol.md →
   * Share → Version 3, PROPOSED, not advertised by either side) would raise it; the number is still a
   * proposal, so it is a parameter here and no value for it is written into this file.
   */
  receive(
    payload: unknown,
    ctx: { negotiated: boolean; sessionKey: string; nowMs: number; maxLiveOffers?: number },
  ): OfferVerdict {
    const limit = ctx.maxLiveOffers ?? 1;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      // A caller bug, not a peer's: refused loudly rather than read as "no limit".
      throw new TypeError(`maxLiveOffers must be a positive integer, got ${limit}`);
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { kind: 'unanswerable', why: 'payload is not an object' };
    }
    const p = payload as Record<string, unknown>;
    const offerId = p.offerId;
    if (typeof offerId !== 'string' || !OFFER_ID.test(offerId)) {
      return { kind: 'unanswerable', why: 'offerId missing or malformed' };
    }
    if (this.seen.has(offerId)) return { kind: 'replay', offerId };
    this.seen.add(offerId);

    if (!ctx.negotiated) {
      return { kind: 'decline', offerId, reason: 'not-negotiated', why: 'share.file was not negotiated on this session' };
    }
    const bad = malformation(p, ctx.nowMs);
    if (bad) return { kind: 'decline', offerId, reason: 'malformed-offer', why: bad };
    this.expire(ctx.nowMs);
    let live = 0;
    for (const h of this.held.values()) if (h.sessionKey === ctx.sessionKey) live += 1;
    if (live >= limit) {
      const why = limit === 1 ? 'another offer from this session is live' : `this session already holds ${live} live offers (the limit is ${limit})`;
      return { kind: 'decline', offerId, reason: 'busy', why };
    }
    const macExpiresAtMs = Math.min(p.expiresAtMs as number, ctx.nowMs + OFFER_TTL_MS);
    return { kind: 'valid', offer: p as unknown as ShareOfferPayload, macExpiresAtMs };
  }

  /** Keep a valid offer live without answering it (debug `shareSilent` only). */
  hold(offerId: string, sessionKey: string, macExpiresAtMs: number): void {
    this.held.set(offerId, { sessionKey, macExpiresAtMs });
  }

  /**
   * An accepted offer waiting its turn (version 3) is still live, but past its 10-minute offer TTL.
   * Without this, [expire] would drop it from the live count while it is still queued, and the
   * session could take an eleventh offer. Moves only an offer already held; returns whether it was.
   */
  extend(offerId: string, untilMs: number): boolean {
    const h = this.held.get(offerId);
    if (!h) return false;
    h.macExpiresAtMs = untilMs;
    return true;
  }

  isHeld(offerId: string): boolean {
    return this.held.has(offerId);
  }

  /** `share.cancel` from the phone. Returns whether this Mac was still holding it. */
  cancelled(offerId: string): boolean {
    return this.held.delete(offerId);
  }

  /** Offers past the Mac's own expiry, removed and returned. */
  expire(nowMs: number): string[] {
    const gone: string[] = [];
    for (const [id, h] of this.held) {
      if (nowMs >= h.macExpiresAtMs) {
        this.held.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  /** The session ended: its offers die with it, without a message. */
  sessionEnded(sessionKey: string): string[] {
    const gone: string[] = [];
    for (const [id, h] of this.held) {
      if (h.sessionKey === sessionKey) {
        this.held.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }
}
