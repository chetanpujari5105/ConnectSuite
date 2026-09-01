import { clipboard } from 'electron';
import { MessageType, type PhoneResult } from '../shared/protocol';
import {
  ClipHistory,
  byteLength,
  shouldSend,
  tooLarge,
  type ClipItem,
  MAX_TEXT_BYTES,
} from '../shared/clipboardHistory';
import { ask, rows } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of the clipboard — and the direction that works is not the one people expect.
 *
 * ### What the hardware reading decided
 *
 * `docs/testing.md` → **Slice 11**. Android refuses a clipboard read to any app that is not
 * **focused** — a bound AccessibilityService does not help, a foreground service does not help, and
 * an app cannot even read back a clip it wrote itself. Writes are unrestricted. So:
 *
 *  - **Mac → phone** works whenever the link is up. Send it and the phone offers it.
 *  - **Phone → Mac** arrives only when somebody opens ConnectSuite on the phone, which is when it
 *    may look. A `clip.request` to a backgrounded phone answers `PHONE_NOT_FOREGROUND`, and that is
 *    a live pane with a sentence in it — not a grey chip, because **there is no permission to
 *    grant** and a fixHint pointing at Settings would send somebody hunting for a switch that does
 *    not exist.
 *
 * ### The Mac's own clipboard is never written without being asked
 *
 * An arriving entry lands in the history and waits for [use]. A clipboard is a single-slot store
 * with no undo: writing to it destroys whatever the person was about to paste, and they find out
 * when they paste it. That is a design decision rather than a platform limit — `clipboard.writeText`
 * is free — and if it is ever revisited it is revisited **with an undo**, which is one of the
 * reasons the history exists in version one.
 *
 * ### Nothing here logs clipboard text
 *
 * The logger writes to a rotating file. Lengths, kinds, counters — never content. The same rule
 * binds the phone, and it is the reason "memory only" is not enough on its own.
 */
export class ClipboardClient {
  private readonly history = new ClipHistory();

  /**
   * The last text this side received, and the whole of the echo rule.
   *
   * Written by [onPush] (a socket event) and read by [send] (an IPC call from the renderer). Two
   * callers, so its concurrency is stated rather than only its type — the failure it prevents is
   * this Mac bouncing the phone's entry straight back at it, which a one-slot store plus two
   * writers produces on its own.
   */
  private lastReceived: string | null = null;

  private sent = 0;
  private received = 0;
  private refused = 0;

  constructor(
    private readonly link: () => LinkClient | null,
    private readonly notify: (entry: ClipItem) => void,
  ) {}

  private tally(): string {
    return `${this.sent} sent / ${this.received} received / ${this.refused} refused since launch`;
  }

  /** A `clip.push` from the phone. Stored and offered; the Mac's clipboard is not touched. */
  onPush(payload: Record<string, unknown>): void {
    const kind = String(payload.kind ?? 'text') as ClipItem['kind'];
    const text = typeof payload.text === 'string' ? payload.text : undefined;
    const entry: ClipItem = {
      kind,
      text,
      atMs: Number(payload.atMs ?? Date.now()),
      source: 'phone',
      package: typeof payload.package === 'string' ? payload.package : undefined,
      appName: typeof payload.appName === 'string' ? payload.appName : undefined,
    };

    this.received += 1;
    if (text !== undefined) this.lastReceived = text;
    const stored = this.history.add(entry);
    this.notify(entry);
    log.info(
      'clipboard',
      `clip.push from the phone: kind=${kind}, ${text ? byteLength(text) : 0} bytes, ` +
        `${stored ? 'held' : 'not held (sensitive)'} — ${this.tally()}`,
    );
  }

  /** Asks the phone for what it holds now. Only answerable while ConnectSuite is on screen there. */
  async request(): Promise<PhoneResult<ClipItem>> {
    const result = await ask(
      this.link(),
      'clipboard',
      MessageType.CLIP_REQUEST,
      {},
      (ack): ClipItem => ({
        kind: String(ack.kind ?? 'text') as ClipItem['kind'],
        text: typeof ack.text === 'string' ? ack.text : undefined,
        atMs: Number(ack.atMs ?? Date.now()),
        source: 'phone',
        package: typeof ack.package === 'string' ? ack.package : undefined,
        appName: typeof ack.appName === 'string' ? ack.appName : undefined,
      }),
    );
    if (result.ok) {
      if (result.data.text !== undefined) this.lastReceived = result.data.text;
      this.history.add(result.data);
      log.info('clipboard', `clip.request → kind=${result.data.kind} — ${this.tally()}`);
    } else {
      this.refused += 1;
      // Logged at info rather than warn: an unfocused phone is the ordinary state of a phone, not
      // a fault. A warn here would fill the file with the feature working as designed.
      log.info('clipboard', `clip.request refused: ${result.reason ?? 'no reason given'} — ${this.tally()}`);
    }
    return result;
  }

  /** Sends this Mac's current clipboard to the phone, which offers rather than applies it. */
  async send(): Promise<PhoneResult<{ bytes: number }>> {
    const text = clipboard.readText();
    if (!text) {
      return { ok: false, reason: 'This Mac’s clipboard has no text in it.' };
    }
    if (tooLarge(text)) {
      this.refused += 1;
      log.info(
        'clipboard',
        `Refused to send ${byteLength(text)} bytes, over the ${MAX_TEXT_BYTES} byte cap; ` +
          `nothing was truncated — ${this.tally()}`,
      );
      return {
        ok: false,
        reason:
          `That is ${Math.round(byteLength(text) / 1024)} KB, over the ` +
          `${MAX_TEXT_BYTES / 1024} KB clipboard limit. Nothing was sent, and nothing was cut short — ` +
          'send it as a file instead.',
      };
    }
    if (!shouldSend(text, this.lastReceived)) {
      // Not an error and not silent. This is the echo rule doing its job, and a person who copied
      // the same string twice deserves to know why the second one did not move.
      log.info('clipboard', `Not sending: identical to the last entry received — ${this.tally()}`);
      return { ok: false, reason: 'That is the entry the phone just sent — not sending it back.' };
    }

    const entry: ClipItem = { kind: 'text', text, atMs: Date.now(), source: 'mac' };
    const result = await ask(
      this.link(),
      'clipboard',
      MessageType.CLIP_PUSH,
      { kind: 'text', text, atMs: entry.atMs, source: 'mac' },
      () => ({ bytes: byteLength(text) }),
    );
    if (result.ok) {
      this.sent += 1;
      this.history.add(entry);
      log.info('clipboard', `clip.push → phone: ${byteLength(text)} bytes — ${this.tally()}`);
    }
    return result;
  }

  /** The phone's history, newest first. This Mac's own is [entries]. */
  async phoneHistory(limit = 20): Promise<PhoneResult<ClipItem[]>> {
    return ask(
      this.link(),
      'clipboard',
      MessageType.CLIP_HISTORY,
      { limit },
      (ack) => rows(ack, 'entries') as unknown as ClipItem[],
    );
  }

  entries(): ClipItem[] {
    return this.history.newestFirst();
  }

  /**
   * Puts an entry on this Mac's clipboard. The only thing that ever writes it, and only on a tap.
   *
   * `lastReceived` is set to what we just wrote so the next `send` does not push it back to the
   * phone it came from — belt and braces with the echo rule, since the two guards fail differently.
   */
  use(text: string): void {
    clipboard.writeText(text);
    this.lastReceived = text;
    log.info('clipboard', `Applied an entry to this Mac's clipboard: ${byteLength(text)} bytes — ${this.tally()}`);
  }

  /** Cleared on disconnect — an entry held against a phone that has gone is a stale claim. */
  clear(): number {
    const had = this.history.clear();
    this.lastReceived = null;
    log.info('clipboard', `Cleared ${had} clipboard entries: the link dropped`);
    return had;
  }
}
