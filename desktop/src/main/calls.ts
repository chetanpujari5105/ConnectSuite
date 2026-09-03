import { EventEmitter } from 'node:events';
import {
  MessageType,
  type CallEnded,
  type CallLogEntry,
  type IncomingCall,
  type PhoneAck,
  type PhoneResult,
} from '../shared/protocol';
import { ask, rows } from './feature';
import { debugSwitches } from './debugSwitches';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of calls: the call happening now, the log of the ones that are not, and dialling.
 *
 * ### Every action names the call it is aimed at
 *
 * `call.answer` and `call.reject` accept an omitted `callId`, which the protocol defines as "the
 * call in progress". This client never uses that shape. It sends the id of the call it is
 * *showing*, always, and the phone compares it against the call actually in progress
 * (`CallFailure.DifferentCall`).
 *
 * The reason is step 61. A card on the Mac outlives the call it describes — the call ends, the
 * `call.ended` has not arrived or has been missed, and the user clicks Reject on a row that is no
 * longer true. With an omitted id that click rejects **whatever is ringing now**, which may be a
 * different person entirely. It is the call-feature equivalent of a tap landing in the wrong app,
 * except that the other party sees it: their call was declined by someone who was trying to
 * decline somebody else's.
 *
 * Naming the call turns a silent misfire into a refusal with a sentence. That is the whole trade,
 * and it is why the convenience shape is left unused rather than merely discouraged.
 */
/**
 * How a call is named in this Mac's log. Three cases, and the fourth one is the point.
 *
 * Defect 43. This was a ternary with two branches, so a call carrying no number at all rendered as
 * `from , no contact name` — a comma with nothing before it, which is *the exact string defect 35
 * is named for*: "Defect 35 was found in this line reading `from ,`".
 *
 * It had never been reached, because until defect 42 was fixed a phone-placed outgoing call always
 * arrived carrying the previous call's number. Fixing 42 made the honest blank reachable for the
 * first time, and this line was waiting for it. The renderer already handled the case correctly —
 * `callWho` falls back to "Unknown number" and `callStatus` drops the bullet — so the card was
 * right and only the log was wrong, which is why nothing caught it sooner.
 *
 * Exported for its test.
 */
export function whoLine(call: { contactName?: string; number?: string }): string {
  const number = (call.number ?? '').trim();
  const name = (call.contactName ?? '').trim();
  if (name && number) return `from ${name} (${number})`;
  if (name) return `from ${name}, no number`;
  if (number) return `from ${number}, no contact name`;
  // The phone says the same thing in its own log, and for the same reason: this is a real state —
  // a withheld caller ID, or an outgoing call the platform gives us no number for — and naming it
  // is what stops a reader hunting for a bug in the formatter.
  return 'with no number from the platform';
}

export class CallClient extends EventEmitter {
  /** The call the Mac is currently showing, or null. Set by `call.incoming`, cleared by `call.ended`. */
  private current: IncomingCall | null = null;

  private incoming = 0;
  private ended = 0;
  private acted = 0;
  private refused = 0;

  constructor(private readonly link: () => LinkClient | null) {
    super();
  }

  /** Actions beside refusals, per CLAUDE.md. */
  private tally(): string {
    return `${this.incoming} rang / ${this.ended} ended / ${this.acted} acted on / ` +
      `${this.refused} refused since launch`;
  }

  currentCall(): IncomingCall | null {
    return this.current;
  }

  onIncoming(payload: Record<string, unknown>): void {
    const call = payload as unknown as IncomingCall;
    if (typeof call.callId !== 'string' || !call.callId) {
      log.warn('calls', 'Dropped a call.incoming with no callId — it could not be acted on safely');
      return;
    }
    this.current = call;
    this.incoming += 1;
    log.info('calls', `call.incoming ${call.callId} (${call.state}) ${whoLine(call)} — ${this.tally()}`);
    this.emit('changed', this.current);
  }

  onEnded(payload: Record<string, unknown>): void {
    const ended = payload as unknown as CallEnded;
    // Step 61's window, held open on purpose: the card stays showing a call the phone has already
    // finished, so a Reject click reaches a `callId` the phone no longer has and the
    // `NO_ACTIVE_CALL` path runs. Off unless asked for on the command line.
    if (debugSwitches().stallCallEnded) {
      log.warn(
        'calls',
        `stallCallEnded: swallowing call.ended for ${ended.callId} — the card is now stale on purpose`,
      );
      return;
    }
    this.ended += 1;
    log.info(
      'calls',
      `call.ended ${ended.callId} ${ended.disposition} after ${Math.round((ended.durationMs ?? 0) / 1000)}s` +
        ` — ${this.tally()}`,
    );
    // Only if it is the call being shown. A late `call.ended` for a previous call must not blank a
    // card describing the one ringing now — the same aiming mistake this class exists to prevent,
    // pointed the other way.
    if (this.current && this.current.callId !== ended.callId) {
      log.info('calls', `Kept the card: ${ended.callId} ended, but ${this.current.callId} is current`);
      this.emit('ended', ended);
      return;
    }
    this.current = null;
    this.emit('ended', ended);
    this.emit('changed', this.current);
  }

  async log(options: { limit?: number; before?: number } = {}): Promise<
    PhoneResult<{ calls: CallLogEntry[]; hasMore: boolean }>
  > {
    const payload: Record<string, unknown> = {};
    if (options.limit) payload.limit = options.limit;
    if (options.before) payload.before = options.before;

    const result = await ask(
      this.link(),
      'calls',
      MessageType.CALL_LOG,
      payload,
      // `entries`, not `calls`. The key is the protocol's, not the feature's name — reading the
      // wrong one returns a well-formed empty list rather than an error, which is how this shipped
      // as "the call log is empty" against a phone holding 1,999 rows.
      (ack) => ({
        calls: rows(ack, 'entries') as unknown as CallLogEntry[],
        hasMore: ack.hasMore === true,
      }),
    );
    if (result.ok) {
      const named = result.data.calls.filter((c) => c.contactName).length;
      // Both numbers, for the same reason as the SMS thread list: a call log is a column of phone
      // numbers without contacts, and the second figure is what says which of the two states this is.
      log.info(
        'calls',
        `call.log → ${result.data.calls.length} entries, ${named} with a contact name, ` +
          `hasMore=${result.data.hasMore}`,
      );
    }
    return result;
  }

  /** Answers the call this Mac is showing. Never "whatever is ringing". */
  async answer(): Promise<PhoneAck> {
    return this.act('answer', MessageType.CALL_ANSWER);
  }

  /** Rejects the call this Mac is showing. Never "whatever is ringing". See the class comment. */
  async reject(): Promise<PhoneAck> {
    return this.act('reject', MessageType.CALL_REJECT);
  }

  private async act(verb: string, type: string): Promise<PhoneAck> {
    const call = this.current;
    if (!call) {
      this.refused += 1;
      log.warn('calls', `${verb} refused here: no call is showing — ${this.tally()}`);
      return {
        ok: false,
        reason: `There is no call to ${verb} — this Mac is not showing one.`,
        fixHint: 'The call may have ended while this Mac was still showing it.',
      };
    }
    // The `callId` is the whole point. An omitted id would mean "the call in progress", which is
    // exactly the call this Mac may no longer be describing.
    const result = await ask(
      this.link(),
      'calls',
      type,
      { callId: call.callId },
      () => ({}),
    );
    if (result.ok) {
      this.acted += 1;
      log.info('calls', `call.${verb} delivered for ${call.callId} — ${this.tally()}`);
      return { ok: true };
    }
    this.refused += 1;
    log.warn('calls', `call.${verb} refused by the phone for ${call.callId}: ${result.reason} — ${this.tally()}`);
    // A refusal aimed at a stale card means the card is wrong, so it is dropped. Leaving it up
    // would invite the same click again, against the same dead id, forever.
    if (result.code === 'NO_ACTIVE_CALL') {
      this.current = null;
      this.emit('changed', this.current);
    }
    return result;
  }

  /**
   * Places a call.
   *
   * There is no dialler screen to cancel on and nobody holding the phone, so the confirmation has
   * to happen on this side before the request is sent — the renderer does that. By the time this
   * runs, the call is being placed.
   */
  async dial(number: string): Promise<PhoneAck> {
    const trimmed = number.trim();
    if (!trimmed) {
      this.refused += 1;
      // Defect 53. This used to move the counter and write nothing, so `N refused` had an unknown
      // part of N with no line above it anywhere. The number is not logged: it is empty, which is
      // the whole cause.
      log.warn('calls', `dial refused here: no number was given — ${this.tally()}`);
      return { ok: false, reason: 'No number was given, so nothing was dialled.' };
    }
    const result = await ask(
      this.link(),
      'calls',
      MessageType.CALL_DIAL,
      { number: trimmed },
      (ack) => ({ callId: typeof ack.callId === 'string' ? ack.callId : null }),
    );
    if (result.ok) {
      this.acted += 1;
      log.info('calls', `call.dial placed to ${trimmed} (${result.data.callId}) — ${this.tally()}`);
      return { ok: true };
    }
    this.refused += 1;
    // Defect 53. The reason reaches the caller and is rendered; it did not reach the log, so the
    // tally could not be decomposed by anyone reading the file afterwards. The number dialled is
    // named because a refusal is about a specific attempt.
    log.warn('calls', `call.dial refused by the phone for ${trimmed}: ${result.reason} — ${this.tally()}`);
    return result;
  }

  /** Drops the card on disconnect. A call this Mac cannot act on must not look actionable. */
  clear(): void {
    if (!this.current) return;
    log.info('calls', 'Cleared the call card: the link dropped');
    this.current = null;
    this.emit('changed', this.current);
  }
}
