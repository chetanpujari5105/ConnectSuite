import { EventEmitter } from 'node:events';
import {
  MessageType,
  type PhoneAck,
  type PhoneResult,
  type SmsMessage,
  type SmsThread,
} from '../shared/protocol';
import { ask, rows } from './feature';
import { debugSwitches } from './debugSwitches';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of SMS: a thread list, a page of messages, and one send.
 *
 * ### The send rule is enforced by the shape of this class
 *
 * `docs/protocol.md` requires that the Mac *"must never take the recipient from whichever thread
 * the UI has open"* — it resolves the recipient from the thread it is sending into, and sends
 * that. The obvious way to write that is `send(threadId, addresses, body)` with a comment asking
 * callers to pass the right addresses. That comment would be the only thing standing between a
 * stale pane and a message delivered to the wrong person.
 *
 * So [send] does **not** take addresses. It takes a `threadId` and a body, and looks the
 * recipients up in the thread rows this client itself received from the phone. A renderer that has
 * drifted — a list index off by one, a pane switched between composing and sending — cannot supply
 * a wrong recipient, because it cannot supply one at all.
 *
 * That is the Mac's half. The phone still verifies against the provider at send time and refuses
 * the pair with `RECIPIENT_MISMATCH`, because this side holds a copy and a copy is exactly what
 * goes stale. Two independent facts, checked on the side that holds the truth.
 *
 * This is the one guard in Phase 4 protecting an outcome that cannot be undone. Every other
 * failure is recoverable by clicking again; a message delivered to the wrong person is visible to
 * someone who was never meant to see it, and the user finds out from them.
 */
export class SmsClient extends EventEmitter {
  /** The most recent thread page, by id. The only source [send] will take a recipient from. */
  private threads = new Map<string, SmsThread>();

  private sent = 0;
  private refused = 0;
  private received = 0;

  constructor(private readonly link: () => LinkClient | null) {
    super();
  }

  /** Sends beside refusals, per CLAUDE.md: a refusal count with no denominator says nothing. */
  private tally(): string {
    return `${this.sent} sent / ${this.refused} refused / ${this.received} received since launch`;
  }

  async listThreads(options: { limit?: number; before?: number } = {}): Promise<
    PhoneResult<{ threads: SmsThread[]; hasMore: boolean }>
  > {
    const payload: Record<string, unknown> = {};
    if (options.limit) payload.limit = options.limit;
    if (options.before) payload.before = options.before;

    const result = await ask(
      this.link(),
      'sms',
      MessageType.SMS_THREADS,
      payload,
      (ack) => ({
        threads: rows(ack, 'threads') as unknown as SmsThread[],
        hasMore: ack.hasMore === true,
      }),
    );
    if (result.ok) {
      // Merged rather than replaced: paging back through older threads must not drop the newer
      // ones that [send] resolves its recipients from.
      for (const thread of result.data.threads) this.threads.set(thread.threadId, thread);
      const named = result.data.threads.filter((t) => t.contactName).length;
      // Both numbers. "12 threads" says nothing about whether contacts is doing its job; the
      // second number is what makes step 59's two states distinguishable at a glance.
      log.info(
        'sms',
        `sms.threads → ${result.data.threads.length} threads, ${named} with a contact name, ` +
          `hasMore=${result.data.hasMore} — ${this.tally()}`,
      );
    }
    return result;
  }

  async listMessages(
    threadId: string,
    options: { limit?: number; before?: number } = {},
  ): Promise<PhoneResult<{ threadId: string; messages: SmsMessage[]; hasMore: boolean }>> {
    const payload: Record<string, unknown> = { threadId };
    if (options.limit) payload.limit = options.limit;
    if (options.before) payload.before = options.before;

    const result = await ask(
      this.link(),
      'sms',
      MessageType.SMS_MESSAGES,
      payload,
      (ack) => ({
        threadId: typeof ack.threadId === 'string' ? ack.threadId : threadId,
        messages: rows(ack, 'messages') as unknown as SmsMessage[],
        hasMore: ack.hasMore === true,
      }),
    );
    if (result.ok) {
      const withAttachments = result.data.messages.filter((m) => m.hasAttachments).length;
      log.info(
        'sms',
        `sms.messages thread ${threadId} → ${result.data.messages.length} messages ` +
          `(${withAttachments} with attachments this build does not fetch), ` +
          `hasMore=${result.data.hasMore}`,
      );
    }
    return result;
  }

  /** One `sms.received`. Carries exactly one message plus its thread id. */
  onReceived(payload: Record<string, unknown>): void {
    const threadId = typeof payload.threadId === 'string' ? payload.threadId : null;
    const message = (rows(payload, 'messages')[0] as unknown as SmsMessage) ?? null;
    if (!threadId || !message) {
      log.warn('sms', 'Dropped an sms.received with no thread or no message');
      return;
    }
    this.received += 1;
    // The name, or the number, and which one it was. Step 59's whole expectation is that this is
    // never blank, so the log records which of the two states produced the line.
    const who = message.address;
    const name = this.threads.get(threadId)?.contactName;
    log.info(
      'sms',
      `sms.received in thread ${threadId} from ${name ? `${name} (${who})` : `${who}, no contact name`}` +
        ` — ${this.tally()}`,
    );
    this.emit('received', { threadId, message });
  }

  /**
   * Sends into a thread, with the recipients taken from the thread this client holds.
   *
   * There is deliberately no parameter for the recipient. See the class comment.
   *
   * A thread this client has never listed is refused here rather than sent without addresses: the
   * phone would refuse it with `BAD_REQUEST` anyway (clause 1 of the send rule), and refusing on
   * this side means the sentence names the real problem — a pane out of step with its data — while
   * the phone's would only say the message was malformed.
   */
  async send(threadId: string, body: string): Promise<PhoneAck> {
    if (body.trim().length === 0) {
      this.refused += 1;
      log.warn('sms', `send refused here: empty body — ${this.tally()}`);
      return {
        ok: false,
        reason: 'An empty message was not sent.',
        fixHint: 'A blank message appears in the conversation and cannot be taken back.',
      };
    }

    const thread = this.threads.get(threadId);
    if (!thread) {
      this.refused += 1;
      log.warn('sms', `send refused here: thread ${threadId} is not one this Mac has listed — ${this.tally()}`);
      return {
        ok: false,
        reason: 'This Mac no longer holds that conversation, so it could not work out who the ' +
          'message would go to. Nothing was sent.',
        fixHint: 'Refresh the conversation list and open the thread again.',
      };
    }

    const addresses = thread.addresses ?? [];
    if (addresses.length === 0) {
      this.refused += 1;
      log.warn('sms', `send refused here: thread ${threadId} lists no recipient — ${this.tally()}`);
      return {
        ok: false,
        reason: 'The phone could not say who is in that conversation, so nothing was sent.',
        fixHint: 'This happens on conversations whose recipients the phone cannot read. ' +
          '"We could not check" must never become "send it anyway".',
      };
    }

    // Step 58a's window, opened on purpose and only on purpose. The guard above makes a mismatched
    // pair unconstructable from the UI, which is the point of it — and which is exactly why the
    // phone's own `RECIPIENT_MISMATCH` cannot otherwise be reached. See debugSwitches.ts.
    const outgoing = debugSwitches().forceRecipientMismatch
      ? [MISMATCH_PROBE_NUMBER]
      : addresses;
    if (outgoing !== addresses) {
      log.warn(
        'sms',
        `forceRecipientMismatch: sending thread ${threadId} with ${MISMATCH_PROBE_NUMBER} instead ` +
          `of ${addresses.join(', ')} — expecting RECIPIENT_MISMATCH, and nothing delivered`,
      );
    }

    const result = await ask(
      this.link(),
      'sms',
      MessageType.SMS_SEND,
      { threadId, addresses: outgoing, body },
      (ack) => ({
        threadId: typeof ack.threadId === 'string' ? ack.threadId : threadId,
        recipients: typeof ack.recipients === 'number' ? ack.recipients : outgoing.length,
      }),
    );

    if (result.ok) {
      this.sent += 1;
      // One message sent, one message reported — step 58. A long body is split by the phone with
      // `divideMessage`, and the count here is recipients, not parts.
      log.info(
        'sms',
        `sms.send delivered to ${result.data.recipients} recipient` +
          `${result.data.recipients === 1 ? '' : 's'} in thread ${result.data.threadId} — ${this.tally()}`,
      );
      return { ok: true };
    }
    this.refused += 1;
    // An `e:` line, not a `w:`. Every other refusal in this project is a feature declining; this
    // one is a prevented harm, and it must be findable in a log by severity alone.
    if (result.code === 'RECIPIENT_MISMATCH') {
      log.error(
        'sms',
        `sms.send REFUSED as a recipient mismatch in thread ${threadId} — nothing was sent to ` +
          `anyone. ${result.reason} — ${this.tally()}`,
      );
    }
    return result;
  }

  /** Drops the thread copy on disconnect, with the rest of the session-scoped state. */
  clear(): void {
    if (this.threads.size === 0) return;
    log.info('sms', `Cleared ${this.threads.size} threads: the link dropped`);
    this.threads.clear();
  }

  /** Test seam: what [send] would resolve as the recipients for a thread. */
  recipientsFor(threadId: string): string[] | null {
    const thread = this.threads.get(threadId);
    return thread ? (thread.addresses ?? []) : null;
  }
}

/**
 * The number `forceRecipientMismatch` substitutes.
 *
 * A documentation-reserved number (555-01xx is reserved for fiction in North America) so that if
 * the guard under test ever fails to hold, the message goes nowhere real. A debug switch that
 * weakens the one guard protecting an unrecoverable outcome should not also pick a number that
 * could belong to somebody.
 */
export const MISMATCH_PROBE_NUMBER = '+15550100';
