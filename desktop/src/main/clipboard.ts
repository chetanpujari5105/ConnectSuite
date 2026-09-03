import { clipboard } from 'electron';
import { MessageType, type PhoneResult } from '../shared/protocol';
import {
  ClipHistory,
  byteLength,
  tooLarge,
  type ClipItem,
  MAX_TEXT_BYTES,
} from '../shared/clipboardHistory';
import { ClipEcho, type SendTrigger } from '../shared/clipEcho';
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
 * ### This Mac applies what arrives, and what that cost
 *
 * It did not, at first. An entry landed in the history and waited for a click, on the argument that
 * a clipboard is a single-slot store with no undo. That argument was right and the conclusion was
 * wrong: it made the feature a list to operate rather than a clipboard, and the whole point is that
 * ⌘V works without touching anything.
 *
 * `docs/protocol.md` named the condition for changing it — *"if this is ever revisited, it is
 * revisited with an undo, not by removing the confirmation"* — so [captureDisplaced] runs first. The
 * text this Mac's clipboard held is put in the history as a `displaced` entry before it is
 * overwritten, and **Restore puts it back**. That is the undo the contract asked for, and it is the
 * reason auto-apply is defensible here and not on the phone: the phone may not read its own
 * clipboard in the background, so it cannot see what it is about to destroy. Same platform question,
 * opposite answer, and the asymmetry is a measurement rather than a preference.
 *
 * A `displaced` entry's **text is never rendered**. It is the one item in this history nobody chose
 * to put there, and on this platform it may be a password — see [looksConcealed] for how far that
 * check actually goes, which is not as far as it looks.
 *
 * ### Nothing here logs clipboard text
 *
 * The logger writes to a rotating file. Lengths, kinds, counters — never content. The same rule
 * binds the phone, and it is the reason "memory only" is not enough on its own.
 */
export class ClipboardClient {
  private readonly history = new ClipHistory();

  /**
   * The echo interlock, and the whole of what stops two auto-applying clipboards writing each other
   * in a circle. One home, in `src/shared/`, so `clipEcho.test.ts` calls the rule rather than
   * modelling it — and so this class holds no clipboard-comparison state of its own.
   */
  private readonly echo = new ClipEcho();

  private sent = 0;
  private received = 0;
  private applied = 0;
  private refused = 0;

  constructor(
    private readonly link: () => LinkClient | null,
    private readonly notify: (entry: ClipItem & { applied: boolean }) => void,
    /**
     * Called whenever the history changes for a reason the renderer did not ask for.
     *
     * The watcher sends without anybody clicking anything, so the pane has no event to refresh on
     * and the list sat at *"Nothing yet"* over a history with entries in it — found by the pane
     * probe, which reads the list rather than trusting that a send implies a redraw. An arrival
     * already had `notify`; this is the other half, and the two exist separately because "something
     * arrived" and "the list moved" are different facts and the pane says different things about
     * them.
     */
    private readonly onChanged: () => void = () => {},
  ) {}

  private tally(): string {
    return (
      `${this.sent} sent / ${this.received} received / ${this.applied} of ${this.received} applied / ` +
      `${this.refused} refused since launch`
    );
  }

  /**
   * Whether the current pasteboard is marked concealed — a password manager's copy.
   *
   * **Measured, and the measurement did not reach as far as the check does.** `docs/testing.md` →
   * Slice 12: `clipboard.read(TYPE)` returns the marker when one is genuinely on the pasteboard
   * (written with `writeBuffer`, read back as `"1"`) and returns `""` for ordinary text — so the
   * read path is live and it is not a query that answers `""` to everything. What could **not** be
   * built with Electron's API is a pasteboard carrying text *and* the marker at once:
   * `clipboard.write({ [TYPE]: … })` silently drops the custom type, and `writeBuffer` replaces the
   * whole pasteboard. So the real case — 1Password's actual copy — is **unmeasured on this Mac**.
   *
   * Which is why this is defence in depth and not the safeguard. The safeguard is that a `displaced`
   * entry's text is never drawn: if this check silently returns `""` for a real password manager,
   * the password sits in a memory-only history that renders as a Restore button and is gone on
   * disconnect. Getting the check wrong costs nothing; relying on it would have.
   */
  private looksConcealed(): boolean {
    try {
      return clipboard.read('org.nspasteboard.ConcealedType') !== '';
    } catch {
      return false;
    }
  }

  /**
   * Puts whatever this Mac's clipboard holds into the history, so applying over it is undoable.
   *
   * Returns whether anything was captured, which is a thing the log line needs: "applied over
   * nothing" and "applied over something we could not keep" are different events, and a person
   * looking for their Restore button deserves to find out which happened.
   */
  private captureDisplaced(incoming: string): 'captured' | 'nothing there' | 'concealed' | 'same text' {
    const current = clipboard.readText();
    if (!current) return 'nothing there';
    if (current === incoming) return 'same text';
    if (this.looksConcealed()) return 'concealed';

    this.history.add({ kind: 'displaced', text: current, atMs: Date.now(), source: 'mac' });
    return 'captured';
  }

  /**
   * An entry that arrived from the phone: stored, **applied**, and offered as undoable.
   *
   * The order is the interlock. `echo.arrived` is armed *before* the write, because a write that
   * lands first leaves a window in which this side's own send path could read its own new clipboard
   * and push it back to where it came from.
   */
  private receive(entry: ClipItem): void {
    this.received += 1;
    const text = entry.text;
    if (text === undefined || entry.kind !== 'text') {
      this.history.add(entry);
      this.notify({ ...entry, applied: false });
      log.info(
        'clipboard',
        `A ${entry.kind} entry arrived and there was nothing to apply — ${this.tally()}`,
      );
      return;
    }

    this.echo.arrived(text);
    const displaced = this.captureDisplaced(text);
    clipboard.writeText(text);
    this.echo.wroteLocally(text);
    this.applied += 1;

    this.history.add(entry);
    this.notify({ ...entry, applied: true });
    log.info(
      'clipboard',
      `Applied an arriving entry to this Mac's clipboard: ${byteLength(text)} bytes, ` +
        `previous clipboard ${displaced} — ${this.tally()}`,
    );
  }

  /** A `clip.push` from the phone. */
  onPush(payload: Record<string, unknown>): void {
    const kind = String(payload.kind ?? 'text') as ClipItem['kind'];
    this.receive({
      kind,
      text: typeof payload.text === 'string' ? payload.text : undefined,
      atMs: Number(payload.atMs ?? Date.now()),
      source: 'phone',
      package: typeof payload.package === 'string' ? payload.package : undefined,
      appName: typeof payload.appName === 'string' ? payload.appName : undefined,
    });
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
      // Applied for the same reason a push is: somebody asked the phone for its clipboard, and
      // handing them a row to click afterwards is the behaviour this change exists to remove.
      this.receive(result.data);
    } else {
      this.refused += 1;
      // Logged at info rather than warn: an unfocused phone is the ordinary state of a phone, not
      // a fault. A warn here would fill the file with the feature working as designed.
      log.info('clipboard', `clip.request refused: ${result.reason ?? 'no reason given'} — ${this.tally()}`);
    }
    return result;
  }

  /**
   * Sends this Mac's current clipboard to the phone, which offers or applies it per its setting.
   *
   * **The trigger is not decoration.** `user` is a click on *Send this Mac's clipboard* and skips
   * the unchanged rule, because a person who presses a button twice means it. `automatic` is the
   * watcher, and it must not: a poller that skipped the unchanged rule would re-send the same
   * clipboard every 500 ms for as long as the app was open. That is not a cycle and no echo rule
   * would stop it — it is the failure the button was hiding, and it is why this parameter exists
   * rather than the watcher reusing the click's path.
   */
  async send(
    trigger: SendTrigger = 'user',
  ): Promise<PhoneResult<{ bytes: number; applied?: boolean; note?: string }>> {
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

    const decision = this.echo.maySend(text, trigger);
    if (!decision.send) {
      // A click gets a sentence; a poll gets silence. The interlock refusing an unchanged clipboard
      // is the watcher working correctly and happens once or twice a second — logging it would bury
      // the file, and the counters carry the ratio instead.
      if (trigger === 'user') {
        log.info('clipboard', `Not sending: ${decision.why} — ${this.tally()}`);
      }
      return {
        ok: false,
        reason:
          decision.why === 'echo'
            ? 'That is the entry the phone just sent — not sending it back.'
            : 'That is already the last thing sent to the phone.',
      };
    }

    const entry: ClipItem = { kind: 'text', text, atMs: Date.now(), source: 'mac' };
    const result = await ask(
      this.link(),
      'clipboard',
      MessageType.CLIP_PUSH,
      { kind: 'text', text, atMs: entry.atMs, source: 'mac' },
      // The ack says what the phone DID, not merely that it heard. A phone that cannot show a
      // notification refuses to replace its own clipboard — see ClipArrival on the phone side and
      // `clip.push` in docs/protocol.md — and this is the only screen left that can say so.
      (ack) => ({
        bytes: byteLength(text),
        applied: ack?.applied === true,
        note: typeof ack?.reason === 'string' ? ack.reason : undefined,
      }),
    );
    if (result.ok) {
      // Counted, echoed and historied whatever the phone did with it: the transfer happened, the
      // entry is in the phone's history, and the interlock MUST be armed either way — an arrival
      // the phone kept can still come back on its next focused read, and disarming here would be
      // an echo loop that only appears on phones with notifications switched off.
      this.sent += 1;
      this.echo.sent(text);
      this.history.add(entry);
      this.onChanged();
      const what = result.data.applied
        ? 'applied on the phone'
        : `NOT applied — ${result.data.note ?? 'the phone did not say why'}`;
      const line = `clip.push → phone: ${byteLength(text)} bytes, ${what} — ${this.tally()}`;
      if (result.data.applied) log.info('clipboard', line);
      else log.warn('clipboard', line);
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
   * Puts an older entry on this Mac's clipboard, from a click on a history row.
   *
   * Also the Restore path for a `displaced` entry, which is the undo the contract required before
   * the confirmation could be removed. Both tell the interlock this side wrote its own clipboard,
   * so the watcher's next poll does not read the write back out and send it.
   */
  use(text: string): void {
    this.echo.wroteLocally(text);
    clipboard.writeText(text);
    log.info('clipboard', `Applied an entry to this Mac's clipboard: ${byteLength(text)} bytes — ${this.tally()}`);
  }

  /**
   * Cleared on disconnect — an entry held against a phone that has gone is a stale claim.
   *
   * The interlock is **not** fully cleared with it. `ClipEcho.linkDropped` drops what this side last
   * sent and keeps what it last received, which is what stops the reconnect bounce: a phone
   * refocusing after a drop reads back the clip this Mac gave it, and a Mac that auto-applies would
   * write that stale text over whatever the person copied in the meantime. See `clipEcho.ts`.
   */
  clear(): number {
    const had = this.history.clear();
    this.echo.linkDropped();
    this.onChanged();
    log.info('clipboard', `Cleared ${had} clipboard entries: the link dropped`);
    return had;
  }
}
