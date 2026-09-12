/**
 * Request → ack → IDR, counted.
 *
 * `CLAUDE.md`'s oldest rule is that a count with no denominator is not evidence. The keyframe path
 * had **neither number**: no requests counted, no answers counted, and no way to say whether a
 * single `mirror.keyframe` has ever produced an IDR in the life of this project. That silence is
 * why the float could fail through an entire demo unnoticed.
 *
 * "12 requested / 12 acked / 0 answered" is the sentence this exists to make sayable, and it is the
 * one that would have ended the float investigation on day one.
 *
 * A main-process **module** — `src/shared/` holds both classic scripts and modules, and the two sets
 * are disjoint by convention. The float's half of the vocabulary is `renderer/floatWait.ts`, which
 * is a script and carries no exports.
 *
 * Deliberately **not** a rate limiter. The phone rate-limits its own keyframe requests with a
 * comment explaining why and neither Mac decoder does; that is the next change, and it wants this
 * measurement to exist first so a before and an after are comparable.
 */
export class KeyframeTrace {
  private requested = 0;
  private acked = 0;
  private answered = 0;
  private lastRequestAt: number | null = null;
  /** Set while a request is out, so the IDR that answers it can be attributed and timed. */
  private awaiting = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** A `mirror.keyframe` is about to go. Returns the line to log. */
  onRequest(reason: string): string {
    this.requested += 1;
    this.lastRequestAt = this.now();
    this.awaiting = true;
    return `keyframe requested (${reason}) — ${this.tally()}`;
  }

  /** The phone acked the request. An ack is not an IDR and is counted separately for that reason. */
  onAck(): string {
    this.acked += 1;
    return `keyframe request acked — ${this.tally()}; an ack is not a frame`;
  }

  /** The request failed or timed out. */
  onRequestFailed(why: string): string {
    return `keyframe request failed: ${why} — ${this.tally()}`;
  }

  /**
   * A keyframe arrived. Returns a line when it answers an outstanding request, else null —
   * the periodic IDRs of an idle stream are not evidence that a request worked.
   */
  onKeyframe(): string | null {
    if (!this.awaiting) return null;
    this.awaiting = false;
    this.answered += 1;
    const waited = this.lastRequestAt === null ? null : this.now() - this.lastRequestAt;
    return `keyframe ARRIVED after ${waited ?? '?'} ms — ${this.tally()}`;
  }

  /** Every counter together. A request count on its own says nothing about whether it worked. */
  tally(): string {
    return `${this.requested} requested / ${this.acked} acked / ${this.answered} answered by an IDR`;
  }

  snapshot(): { requested: number; acked: number; answered: number; awaiting: boolean } {
    return { requested: this.requested, acked: this.acked, answered: this.answered, awaiting: this.awaiting };
  }
}
