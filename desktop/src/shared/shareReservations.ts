/**
 * **Mac space accounting for several share offers — version 3, PROPOSED** (docs/protocol.md → Share →
 * Version 3 §4; docs/feature-a-multi-offer-proposal.md rev 3 §4). Pure, so the rule has one home that
 * the receiver calls and a test calls.
 *
 * What an offer holds back from the destination's free space, by state:
 *
 * | state | reserved | why |
 * |---|---|---|
 * | `accepting` | `size` | a person authorised it; its bytes are coming |
 * | `queued` | `size` | authorised, waiting its turn; nothing written yet |
 * | `receiving` | `size − bytes already written` | the written part is **already absent from free**, so counting it again would double-count |
 * | anything else | 0 | released: a published file is real bytes now (no longer a reservation), and every other end wrote nothing that stays |
 *
 * **This is accounting, not a guarantee.** Other apps use the same disk; free space can fall below
 * what was reserved, and the transfer then fails honestly as `write-failed`. The check it feeds is
 * `free − reserved ≥ size + max(256 MiB, ⌈size/10⌉)` — the version-2 rule with the others' claims
 * taken out first.
 */

export interface ReservingOffer {
  offerId: string;
  state: string;
  size: number;
  /** Receiver-measured bytes written in the current attempt; null before a pull began. */
  receivedBytes: number | null;
}

/** The bytes one offer holds back right now. */
export function reservationOf(o: ReservingOffer): number {
  switch (o.state) {
    case 'accepting':
    case 'queued':
      return o.size;
    case 'receiving':
      return Math.max(0, o.size - (o.receivedBytes ?? 0));
    default:
      return 0;
  }
}

/** The sum of every offer's reservation, **leaving out [exceptOfferId]** — the offer being judged. */
export function reservedBytes(offers: Iterable<ReservingOffer>, exceptOfferId: string | null = null): number {
  let total = 0;
  for (const o of offers) if (o.offerId !== exceptOfferId) total += reservationOf(o);
  return total;
}
