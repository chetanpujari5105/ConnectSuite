import { MessageType } from '../shared/protocol';
import { SHARE_FILE } from '../shared/extensions';
import { ShareOfferBook, type DeclineReason } from '../shared/shareOffer';
import { log } from './logger';

/** The two things this needs from the link, so it is testable without a socket. */
export interface ShareLink {
  request(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** The negotiated extensions for the current session (docs/protocol.md → Extensions). */
  negotiated(): Readonly<Record<string, number>>;
  /** The current session's token, the key offers are held against. */
  token(): string | null;
}

/**
 * The Mac's answer to share offers — docs/protocol.md → Share, slice 2.
 *
 * **Every valid offer is declined with `not-available`.** That is the protocol stub this revision
 * ships, not a person's decision: there is no card, no Accept, and nothing is saved. The decline is
 * explicit so the phone ends the offer and deletes its staged copy at once, rather than waiting ten
 * minutes for an expiry.
 *
 * `silent` is the debug switch `shareSilent`: validate, then hold the offer **without** answering,
 * so the phone's expiry path can be observed on hardware. Never on in a normal run.
 */
export class ShareReceiver {
  private readonly book = new ShareOfferBook();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private declined = 0;
  private refused = 0;
  private expired = 0;

  constructor(
    private readonly link: ShareLink,
    private readonly silent: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  /** For the tally test: the counts behind every log line's denominator. */
  counts(): { declined: number; refused: number; expired: number } {
    return { declined: this.declined, refused: this.refused, expired: this.expired };
  }

  private tally(): string {
    return `${this.declined} declined not-available / ${this.refused} refused / ${this.expired} expired`;
  }

  onOffer(payload: unknown): void {
    const sessionKey = this.link.token() ?? '';
    const verdict = this.book.receive(payload, {
      negotiated: this.link.negotiated()[SHARE_FILE] !== undefined,
      sessionKey,
      nowMs: this.now(),
    });
    switch (verdict.kind) {
      case 'unanswerable':
        log.warn('share', `share.offer not answerable (${verdict.why}) — nothing sent`);
        return;
      case 'replay':
        log.warn('share', `share.offer ${verdict.offerId} is a replay — already answered once, not answered again`);
        return;
      case 'decline':
        this.refused += 1;
        log.info('share', `share.offer ${verdict.offerId} refused: ${verdict.reason} (${verdict.why}) — ${this.tally()}`);
        this.respond(verdict.offerId, verdict.reason);
        return;
      case 'valid': {
        const { offer } = verdict;
        log.info(
          'share',
          `share.offer ${offer.offerId} valid: ${offer.item.size} bytes, ${offer.item.mime.split('/')[0]}/*, ` +
            `from ${offer.from}`,
        );
        if (this.silent) {
          this.book.hold(offer.offerId, sessionKey, verdict.macExpiresAtMs);
          const wait = Math.max(0, verdict.macExpiresAtMs - this.now());
          this.timers.set(offer.offerId, setTimeout(() => this.onMacExpiry(offer.offerId), wait));
          log.warn('share', `share.offer ${offer.offerId} held WITHOUT an answer (debug shareSilent) — expires in ${Math.round(wait / 1000)}s`);
          return;
        }
        this.declined += 1;
        log.info('share', `share.offer ${offer.offerId} → decline not-available (this version has no receive) — ${this.tally()}`);
        this.respond(offer.offerId, 'not-available');
      }
    }
  }

  /** `share.cancel` event from the phone: `user`, `expired` or `staging-lost`. Never read as a decline. */
  onCancel(payload: unknown): void {
    const p = (payload ?? {}) as { offerId?: unknown; reason?: unknown };
    const offerId = typeof p.offerId === 'string' ? p.offerId : '(no id)';
    const reason = typeof p.reason === 'string' ? p.reason : '(no reason)';
    const wasHeld = typeof p.offerId === 'string' && this.book.cancelled(p.offerId);
    this.clearTimer(offerId);
    // Counted only if this Mac was still holding it. The Mac's own expiry and the phone's
    // `share.cancel{expired}` describe one ending, and on hardware they land ~60 ms apart — counting
    // both reported "2 expired" for one offer (found on the SM-S938B, 2026-09-24).
    if (reason === 'expired' && wasHeld) this.expired += 1;
    log.info('share', `share.cancel ${offerId} from the phone: ${reason}${wasHeld ? '' : ' (not held here)'} — ${this.tally()}`);
  }

  onSessionEnded(sessionKey: string | null): void {
    if (!sessionKey) return;
    for (const id of this.book.sessionEnded(sessionKey)) {
      this.clearTimer(id);
      log.info('share', `share offer ${id} ended with the session — no message`);
    }
  }

  private onMacExpiry(offerId: string): void {
    this.timers.delete(offerId);
    if (this.book.expire(this.now()).includes(offerId)) {
      this.expired += 1;
      log.info('share', `share offer ${offerId} expired on the Mac without an answer — expired, not declined — ${this.tally()}`);
    }
  }

  private clearTimer(offerId: string): void {
    const t = this.timers.get(offerId);
    if (t) clearTimeout(t);
    this.timers.delete(offerId);
  }

  private respond(offerId: string, reason: DeclineReason): void {
    this.link
      .request(MessageType.SHARE_RESPOND, { offerId, decision: 'decline', reason })
      .then((ack) => log.info('share', `share.respond ${offerId} ${reason} → ${JSON.stringify((ack as { payload?: unknown })?.payload ?? ack)}`))
      .catch((error: Error) => log.warn('share', `share.respond ${offerId} ${reason} failed: ${error.message}`));
  }
}
