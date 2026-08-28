/**
 * The gate: given a live call card, may the watcher press Reject on it?
 *
 * Its own module, imported by `step70-watch.mjs` and exercised by `step70-gate.test.mjs`, because
 * of the rule this defect produced — **a check that does not gate the action is decoration.** The
 * predicate that decides whether to act has to be the same expression that decides what was seen,
 * and it has to be readable on its own before someone else's phone is involved.
 *
 * It returns *reasons to refuse*. An empty array is the only thing that authorises a click, so
 * adding a new card shape defaults to refusing rather than to acting.
 */

/** Digits only, so `+91 88000 00004`, `+918800000004` and `8800000004` compare equal. */
export const digits = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * @param card `{ hidden, who, status }` as read from the live card.
 * @param wantDigits the expected caller's number, digits only.
 * @returns [] when this is the call under test; otherwise one string per reason to refuse.
 */
export function gateReasons(card, wantDigits) {
  const reasons = [];
  if (!card || card.hidden) return ['no live card on screen'];

  const status = card.status ?? '';
  const seen = digits(`${card.who ?? ''} ${status}`);

  // 1. It must be an inbound call that is still ringing. `Dialling` is an outgoing call — the one
  //    the first version of this script hung up — and `In progress` means it has been answered,
  //    at which point 35c is no longer readable and rejecting it would drop a live conversation.
  if (!/ringing/i.test(status)) {
    reasons.push(`state is ${JSON.stringify(status)}, not Ringing`);
  }

  // 2. It must be the expected caller. Without this the gate would accept any inbound call — a
  //    real one arriving mid-test is not the second person's, and rejecting it is somebody else's
  //    call dropped.
  if (!wantDigits || !seen.includes(wantDigits)) {
    reasons.push(`card does not carry ${wantDigits || '(no number given)'}`);
  }

  return reasons;
}

/** One line for the log when the gate refuses, so a skip is never silent. */
export function skipLine(card, reasons) {
  return `SKIPPING a live card, not touching it — ${reasons.join('; ')}` +
    `\n    who=${JSON.stringify(card?.who ?? null)} status=${JSON.stringify(card?.status ?? null)}`;
}
