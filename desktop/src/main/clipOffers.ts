import { randomUUID } from 'node:crypto';
import { tooLarge } from '../shared/clipboardHistory';

/**
 * S7 (defect 185): which arriving phone text this Mac applies, and the pending offers it holds instead.
 *
 * `docs/protocol.md` → *Provenance*. The phone stamps every `clip.push` with `origin`, decided by the code
 * path that built it — `clipboard` for its own focused clipboard read, `selection` for text another
 * app handed to the exported `SendSelectionActivity`. **Only the exact string `clipboard` is applied.**
 * Everything else — `selection`, an absent field (every older phone), a different case, a number — is
 * offered, so a value nobody has thought of fails safe. Electron-free; the clock and ids are injectable.
 */

/** The one value that may write this Mac's clipboard on arrival. Compared exactly. */
export const ORIGIN_CLIPBOARD = 'clipboard';
export const ORIGIN_SELECTION = 'selection';

/** Apply or offer — decided from the payload alone. */
export function arrivalAction(payload: Record<string, unknown>): 'apply' | 'offer' {
  return payload.origin === ORIGIN_CLIPBOARD ? 'apply' : 'offer';
}

/** For log lines: which class of origin arrived. Never the value itself when it is not one we know. */
export function originClass(payload: Record<string, unknown>): 'clipboard' | 'selection' | 'absent' | 'unrecognised' {
  if (payload.origin === ORIGIN_CLIPBOARD) return 'clipboard';
  if (payload.origin === ORIGIN_SELECTION) return 'selection';
  if (!('origin' in payload) || payload.origin === undefined) return 'absent';
  return 'unrecognised';
}

/** At most this many offers wait at once; the oldest goes first. */
export const OFFERS_MAX = 5;
/** An offer nobody acted on is withdrawn after this long. The clipboard is never touched by it. */
export const OFFER_TTL_MS = 10 * 60 * 1_000;

/**
 * The native notification's fixed copy. **No part of it is derived from the offer** — no text, no
 * preview, no URL, no app name — because macOS keeps delivered notifications in Notification Center,
 * which is a store this app does not control.
 */
export const OFFER_NOTIFICATION = {
  title: 'Text offered from your phone',
  body: 'Open Sidekick to review it. Nothing was copied.',
} as const;

export interface ClipOffer {
  id: string;
  text: string;
  atMs: number;
  appName?: string;
  package?: string;
  /** The control session the offer arrived on. Copy is refused on any other. */
  session: string;
  expiresAtMs: number;
}

export type OfferRefusal = 'unknown' | 'expired' | 'other-session';

export class ClipOffers {
  private readonly offers = new Map<string, ClipOffer>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = randomUUID,
    private readonly max = OFFERS_MAX,
    private readonly ttlMs = OFFER_TTL_MS,
  ) {}

  /**
   * Holds [text] as a pending offer. Returns the offer, plus any offers it pushed out (to withdraw their
   * notifications) — or null when the text is over the namespace cap and is not kept at all.
   */
  create(entry: { text: string; atMs: number; appName?: string; package?: string; session: string }): {
    offer: ClipOffer;
    evicted: string[];
  } | null {
    if (tooLarge(entry.text)) return null;
    const evicted = this.sweep();
    const offer: ClipOffer = { ...entry, id: this.newId(), expiresAtMs: this.now() + this.ttlMs };
    this.offers.set(offer.id, offer);
    while (this.offers.size > this.max) {
      const oldest = this.offers.keys().next().value as string;
      this.offers.delete(oldest);
      evicted.push(oldest);
    }
    return { offer, evicted };
  }

  /**
   * Consumes offer [id] for a Copy on [session]. Single use: whatever the answer, the offer cannot be
   * copied twice. A refusal from another session leaves it pending for its own.
   */
  take(id: string, session: string | null): { ok: true; offer: ClipOffer } | { ok: false; refusal: OfferRefusal } {
    const offer = this.offers.get(id);
    if (!offer) return { ok: false, refusal: 'unknown' };
    if (this.now() > offer.expiresAtMs) {
      this.offers.delete(id);
      return { ok: false, refusal: 'expired' };
    }
    if (session === null || session !== offer.session) return { ok: false, refusal: 'other-session' };
    this.offers.delete(id);
    return { ok: true, offer };
  }

  dismiss(id: string): boolean {
    return this.offers.delete(id);
  }

  has(id: string): boolean {
    const offer = this.offers.get(id);
    return offer !== undefined && this.now() <= offer.expiresAtMs;
  }

  /** Removes expired offers; returns their ids. */
  sweep(): string[] {
    const gone: string[] = [];
    for (const [id, offer] of this.offers) {
      if (this.now() > offer.expiresAtMs) {
        this.offers.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  /** Every pending offer's id — on disconnect, all of them go. */
  clear(): string[] {
    const ids = [...this.offers.keys()];
    this.offers.clear();
    return ids;
  }

  get size(): number {
    return this.offers.size;
  }
}

export function offerRefusalText(refusal: OfferRefusal): string {
  switch (refusal) {
    case 'unknown':
      return 'That offer is no longer waiting — it was copied, dismissed or replaced. Nothing was copied now.';
    case 'expired':
      return 'That offer expired after 10 minutes. Nothing was copied.';
    case 'other-session':
      return 'That offer came over an earlier connection to your phone. Nothing was copied.';
  }
}
