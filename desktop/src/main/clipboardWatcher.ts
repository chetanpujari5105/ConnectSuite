import { clipboard } from 'electron';
import { MARKER_TYPES, nextIntervalMs, skipReason, type SkipReason } from '../shared/clipWatchPolicy';
import { log } from './logger';

/**
 * Watches this Mac's clipboard and sends what you copy, without the button.
 *
 * ### Why polling, said once so nobody re-derives it
 *
 * **`NSPasteboard` has no change notification.** No callback, no KVO, no notification-centre event
 * — every clipboard manager on macOS polls, and Electron does not expose `changeCount` either, so
 * the poll has to read. That is not a shortcut taken here; it is the only shape the platform
 * offers, and the measurements that make it affordable are in `docs/testing.md` → Slice 13.
 *
 * Two of those readings are load-bearing:
 *
 *  - **A read does not bump `changeCount`** — 500 reads left it at 1209, and a single write moved
 *    it to 1210, so the counter was live throughout. Had reads counted as writes the watcher would
 *    have been its own stimulus, sending in a loop with nothing wrong with the interlock.
 *  - **A read costs 0.1 ms at our own 64 KB cap** and 37 ms at 20 MB, which is the whole reason
 *    [nextIntervalMs] exists rather than a constant.
 *
 * ### It only looks while there is somewhere to send
 *
 * [tick] returns immediately when the link is down. A clipboard watcher with no phone attached is
 * reading somebody's passwords for no purpose, and the cheapest way to not do that is to not do it.
 *
 * ### Nothing here logs clipboard text
 *
 * Lengths, skip reasons and counters. The rule binds harder here than anywhere else in the app,
 * because this is the one component that sees *everything* a person copies rather than the things
 * they chose to send.
 */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = 500;
  private running = false;

  private polls = 0;
  private sent = 0;
  private readonly skipped = new Map<SkipReason, number>();

  constructor(
    private readonly linkIsUp: () => boolean,
    private readonly send: () => Promise<{ ok: boolean; reason?: string }>,
  ) {}

  /**
   * Every skip reason with its count, **beside the number of polls that produced them**.
   *
   * A count with no denominator is not evidence: "4 concealed" could be a busy afternoon with a
   * password manager or a marker check that has latched on. `4 concealed of 900 polls` is the first
   * one and cannot be mistaken for the second.
   */
  private tally(): string {
    const skips = [...this.skipped.entries()].map(([why, n]) => `${n} ${why}`).join(', ') || 'none';
    return `${this.sent} sent / ${this.polls} polls / skipped: ${skips} / every ${this.intervalMs}ms`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
    log.info('clipboard', `Watching this Mac's clipboard every ${this.intervalMs}ms; it is read only while the phone is connected`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    log.info('clipboard', `Stopped watching this Mac's clipboard — ${this.tally()}`);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Re-armed after each tick rather than on an interval, so a slow read cannot stack up behind
   * itself — the failure a `setInterval` produces on exactly the 20 MB clipboard this backs off for.
   */
  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  private note(why: SkipReason): void {
    this.skipped.set(why, (this.skipped.get(why) ?? 0) + 1);
  }

  private async tick(): Promise<void> {
    try {
      if (!this.linkIsUp()) return;
      this.polls += 1;

      const started = process.hrtime.bigint();
      const text = clipboard.readText();
      const readMs = Number(process.hrtime.bigint() - started) / 1e6;
      // Measured per poll rather than assumed from the size, so it adapts to a machine under load
      // and to whatever the pasteboard actually costs on it today.
      this.intervalMs = nextIntervalMs(readMs);

      // `has`, never `read`. The convention writes the marker as a present type with **empty
      // data**, so a value check returns false for every real password-manager clip — measured, in
      // `docs/testing.md` → Slice 13, against a pasteboard built by NSPasteboard rather than by
      // Chromium round-tripping its own encoding.
      const markers = new Set(MARKER_TYPES.filter((type) => clipboard.has(type)));
      const why = skipReason(text, markers, Buffer.byteLength(text, 'utf8') > 64 * 1024);
      if (why !== null) {
        // Only counted on a change, not on every poll over the same clip — otherwise one concealed
        // clip left on the pasteboard reads as hundreds of password copies.
        if (why !== 'empty' && text !== this.lastSkipped) this.note(why);
        this.lastSkipped = text;
        return;
      }
      this.lastSkipped = null;

      // The interlock decides whether this is a new copy or our own write coming back; the watcher
      // does not second-guess it and holds no clipboard state of its own. `send` classifies itself
      // as an automatic trigger, which is what makes the unchanged rule apply — without it this
      // would re-send the same clipboard on every tick, forever.
      const result = await this.send();
      if (result.ok) this.sent += 1;
    } catch (error) {
      // A watcher that dies on one bad poll stops watching silently, which is the worst failure it
      // has: everything looks fine and nothing is ever sent again.
      log.warn('clipboard', `A clipboard poll failed (${String(error)}); the watcher is still running — ${this.tally()}`);
    } finally {
      this.schedule();
    }
  }

  /** The last text a skip was counted for, so a clip sitting on the pasteboard is counted once. */
  private lastSkipped: string | null = null;
}
