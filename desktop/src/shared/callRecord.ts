import type { CallEnded, IncomingCall } from './protocol';

/**
 * What the Mac is allowed to **keep** about a call — the one home of the rules in
 * `docs/protocol.md` → Calls → *What a Mac may keep about a call*.
 *
 * The wire carries full numbers and contact names, and the live card draws them while a call is
 * showing. That is display. This file decides what reaches **disk**, which is two places with two
 * different rules:
 *
 *  - **the rotating log** — a call is named by its tail (`number …67`) or `no number`. Never a full
 *    number, never a contact name. The call id and state are carried by the caller's sentence;
 *  - **the persisted Activity history** — a call is named by its contact name, or
 *    {@link UNKNOWN_NUMBER}. Never a number.
 *
 * One function per rule, called from every site, because a second expression of either is how the
 * old Activity row came to store raw numbers: it read `c.name`, a field the payload does not have
 * (`contactName` is), so its `?? c.number` fallback fired on every row.
 *
 * Main-process only. The page does not load this file, so it may `export` (defect 94 is about
 * files `index.html` loads as classic scripts).
 */

export const UNKNOWN_NUMBER = 'Unknown number';

/**
 * Three or more digits anywhere make a stored name "possibly a number". This is deliberately
 * conservative: a contact saved under a phone number, or a name like `Room 101`, is stored as
 * {@link UNKNOWN_NUMBER} rather than risk keeping a number. Losing a label costs less than keeping
 * a number on disk, and the live card still draws the real name while the call is showing.
 */
const NUMBER_LIKE = /\d[^\d]*\d[^\d]*\d/;

/** The last two digits of a number as `…67`, or `null` when there are fewer than two. */
export function numberTail(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? `…${digits.slice(-2)}` : null;
}

/** How a call is named in the rotating log: by its tail, or `no number`. */
export function callLogWho(call: { number?: string | null }): string {
  const tail = numberTail(call.number);
  return tail ? `number ${tail}` : 'no number';
}

/**
 * How a call is named in the persisted Activity history: the contact name, or
 * {@link UNKNOWN_NUMBER}. Never a number and never a blank.
 *
 * Also the scrub applied to history written before the rule existed, whose details were raw
 * numbers, `""` or `"unknown"` — so the writer and the reader share one rule rather than two.
 */
export function callHistoryName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim();
  if (!name || name.toLowerCase() === 'unknown' || NUMBER_LIKE.test(name)) return UNKNOWN_NUMBER;
  return name;
}

export interface CallActivityRow {
  kind: string;
  detail: string;
}

const STATE_KIND: Record<string, string> = {
  ringing: 'Call ringing',
  active: 'Call in progress',
  dialing: 'Call dialling',
};

const DISPOSITION_KIND: Record<string, string> = {
  missed: 'Missed call',
  answered: 'Call ended',
  rejected: 'Call rejected',
  // The protocol's `declined` means the *other* end hung up first. "Declined" alone would read as
  // something this side did.
  declined: 'Call ended — other side hung up',
};

/**
 * The Activity rows for calls: one per state a call actually enters, and one when it ends.
 *
 * Held state is the last `(callId, state)` recorded, so a re-sent `call.incoming` — the phone
 * re-sends one when the inbound number arrives late (defect 45) — is not a second row. It is
 * cleared when a call **ends**, not when the card is cleared by a disconnect: a call replayed after
 * a reconnect is the same call, but ids restart at `c1` when the phone process restarts, so an id
 * that rings again after ending is a new episode.
 */
export class CallActivityRows {
  private last: { callId: string; state: string } | null = null;

  /** A row for a card change, or `null` when there is nothing new to record. */
  changed(call: IncomingCall | null): CallActivityRow | null {
    if (!call || !call.state) return null;
    if (this.last && this.last.callId === call.callId && this.last.state === call.state) return null;
    this.last = { callId: call.callId, state: call.state };
    return {
      kind: STATE_KIND[call.state] ?? 'Call',
      detail: callHistoryName(call.contactName),
    };
  }

  /**
   * A row for a call that ended. `card` is the call the Mac was showing for that id, when it was
   * showing one — the only source of a contact name, since `call.ended` carries none.
   */
  ended(ended: CallEnded, card: IncomingCall | null): CallActivityRow {
    if (this.last?.callId === ended.callId) this.last = null;
    const named = card && card.callId === ended.callId ? card.contactName : undefined;
    return {
      kind: DISPOSITION_KIND[ended.disposition] ?? 'Call ended',
      detail: callHistoryName(named),
    };
  }
}
