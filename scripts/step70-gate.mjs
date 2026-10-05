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
 * `--require-correction`: the defect-45 correction line for **the call under test**, or nothing.
 *
 * History, because both earlier forms are the reason for this one's shape:
 *
 * 1. It first matched any `card corrected in place` line. Paired with `--allow-blank-number` — which a
 *    defect-45 build needs, because every inbound card starts blank — a correction published for a
 *    *different* inbound call authorised the click.
 * 2. It then read the number out of the line (`card corrected in place: number (\S+)`) and compared
 *    digits. **559f1da took the number out of the phone's log** (no caller on disk, `docs/protocol.md`
 *    → Calls), so the line now reads `…in place: number arrived 112ms into the ringing…`, the capture
 *    was the word `arrived`, and no correction could ever match: `--require-correction` withheld every
 *    reject. Closed in the safe direction, and useless.
 *
 * Now it ties a correction to a call by **call id**, which is structured and carries nothing about the
 * caller: the correction must name the id of the **one** inbound episode (`Call cN ringing`) that
 * began in the lines this watch has read. Zero episodes, or two (call waiting, a second caller), and
 * there is no correction — the watcher cannot say which call the card is, so it does not guess. The
 * number check stays where it belongs, on the card on the Mac's screen (`gateReasons`), and is
 * re-run immediately before the click.
 *
 * Both line formats carry the id in the same place — the installed APK's `Call c3 ringing from …`
 * and `Call c14 card corrected in place: number +…`, and 559f1da's `Call c3 ringing: number present…`
 * and `Call c14 card corrected in place: number arrived…` — so it reads either without reading a
 * number from either. **It still fails closed**: if the format moves and nothing matches, the
 * correction is absent and the reject is withheld, with the reason printed.
 *
 * @param {string[]} lines the phone's `[calls]` lines since the watch started
 * @returns {{ line: string | null, id: string | null, why: string }}
 */
export function correctionInWatch(lines) {
  const begun = [];
  const corrections = [];
  for (const line of lines ?? []) {
    const b = /\bCall (c\d+) ringing\b/.exec(line);
    if (b && !begun.includes(b[1])) begun.push(b[1]);
    const c = /\bCall (c\d+) card corrected in place\b/.exec(line);
    if (c) corrections.push({ id: c[1], line });
  }
  if (begun.length === 0) return { line: null, id: null, why: 'no inbound episode began in the lines this watch read' };
  if (begun.length > 1) {
    return { line: null, id: null, why: `${begun.length} inbound episodes began (${begun.join(', ')}); a correction cannot be tied to the card` };
  }
  const id = begun[0];
  const mine = corrections.filter((c) => c.id === id);
  if (mine.length === 0) {
    const others = corrections.map((c) => c.id);
    return { line: null, id, why: `no correction for ${id}${others.length ? ` (only for ${others.join(', ')})` : ''}` };
  }
  return { line: mine[mine.length - 1].line, id, why: `correction for ${id}, the one inbound episode of this watch` };
}
