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
 * The card shape a build with defect 45 open produces for *every* inbound ring: the headline falls
 * back to `Unknown number` and the status stops at the label, because `callStatus` only appends the
 * separator when there is a number to put after it. Matched exactly rather than loosely — a card
 * carrying any digits at all is a card whose number *can* be checked, and therefore must be.
 */
export function isBlankInboundCard(card) {
  const who = (card?.who ?? '').trim();
  const status = (card?.status ?? '').trim();
  return who === 'Unknown number' && status === 'Ringing' && digits(`${who} ${status}`) === '';
}

/**
 * @param card `{ hidden, who, status }` as read from the live card.
 * @param wantDigits the expected caller's number, digits only.
 * @param options `{ allowBlankNumber }` — see clause 2. Omitted means the strict gate.
 * @returns [] when this is the call under test; otherwise one string per reason to refuse.
 */
export function gateReasons(card, wantDigits, options = {}) {
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
  //
  //    **The opt-in waiver, and why it must stay opt-in.** Since the defect 42 inbound fix shipped
  //    (phone build `lastUpdateTime=2026-08-29 10:01:54`) no inbound card carries a number at all:
  //    `begin()` publishes the card ~100 ms before `EXTRA_INCOMING_NUMBER` arrives and never
  //    re-publishes, so every ring draws `Unknown number` / `Ringing`. That is defect 45's shipped
  //    behaviour, not a fault in this gate — but it makes this clause unsatisfiable, and an
  //    unsatisfiable gate refuses every card, which on the console is indistinguishable from a ring
  //    that never came. That is the exact failure shape this project keeps recording.
  //
  //    So the caller may waive this one clause with `allowBlankNumber`, and only for a card blank in
  //    the precise shape above. It is never the default, it is named on the line the watcher prints
  //    beside the click, and it widens nothing else: a card carrying digits that are not the
  //    expected ones is still refused, because that card's number could have been checked.
  if (!wantDigits || !seen.includes(wantDigits)) {
    if (options.allowBlankNumber && isBlankInboundCard(card)) {
      // Not a reason to refuse — but never silent. The watcher prints this next to the click.
      reasons.waived = 'no number on the card; allowed by --allow-blank-number (defect 45)';
    } else {
      reasons.push(`card does not carry ${wantDigits || '(no number given)'}`);
    }
  }

  return reasons;
}

/** One line for the log when the gate refuses, so a skip is never silent. */
export function skipLine(card, reasons) {
  return `SKIPPING a live card, not touching it — ${reasons.join('; ')}` +
    `\n    who=${JSON.stringify(card?.who ?? null)} status=${JSON.stringify(card?.status ?? null)}`;
}

/**
 * Does this phone `[calls]` log line record defect 45's option 4 firing **for the call under
 * test**?
 *
 * `--require-correction` originally matched any line containing `card corrected in place`, with no
 * check that the corrected number was the expected one. Paired with `--allow-blank-number` — which
 * this build needs, because every inbound card starts blank — that left a real hole: a blank card
 * from a *different* inbound caller, plus a correction published for that other call, satisfied
 * both gates and authorised the click. Narrow, and exactly the shape of the accident the gate
 * exists for: a reading that was true about something, used to authorise an action against
 * something else.
 *
 * It reads the number out of the line rather than scanning the whole line for the digits, so a
 * timestamp or a counter cannot supply them by coincidence. **It fails closed**: if the log format
 * moves, the regex stops matching, the correction is treated as absent, and the watcher withholds
 * the reject and says so — which is the safe direction for the half of the run that cannot be
 * undone.
 */
export function isCorrectionFor(line, wantDigits) {
  if (!line || !wantDigits) return false;
  const m = /card corrected in place: number (\S+)/.exec(line);
  if (!m) return false;
  return digits(m[1]).includes(digits(wantDigits));
}
