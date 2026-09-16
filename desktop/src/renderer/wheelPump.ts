/**
 * One `input.scroll` in flight at a time, and everything that arrives meanwhile is summed.
 *
 * ### The measurement that produced this file — defect 112
 *
 * The old rule was a fixed 60 ms window: wheel deltas were summed for 60 ms and sent, whatever the
 * phone was doing. Two rates, measured on hardware on 2026-09-15, neither guessed:
 *
 * | | |
 * |---|---|
 * | what the Mac **produced** at `WHEEL_WINDOW_MS = 60` | up to **16.7** `input.scroll`/s |
 * | what the phone **consumed**, median over 181 back-to-back gestures in its own log | **8.55** per second (117 ms each) |
 *
 * The phone serialises gestures behind a `Mutex` and each scroll stroke is 100 ms by contract, so
 * production was roughly **twice** consumption for as long as a finger kept moving. The overflow did
 * not vanish quietly either: `InputClient` holds 8 and throws away anything that waited more than
 * 400 ms, so the Mac's own log carries **14 scrolls dropped after waiting 403–486 ms**, each one
 * putting a sentence on the mirror canvas mid-flick. That is the whole of "trackpad input feels
 * laggy and janky, an external mouse is smooth": a mouse emits a few discrete notches and never
 * fills the queue, a trackpad emits a continuous stream — plus macOS's momentum tail after the
 * fingers lift — and fills it every time.
 *
 * ### Why backpressure rather than a longer window
 *
 * A longer window is the 263 ms sampling window with a bigger number in it. It makes the overflow
 * rarer without making it impossible, and it cannot say whether a run that behaved did so because
 * the rate was right or because the flick was short. **The only window that is always correct is the
 * one the phone closes**, so this holds at most one gesture in flight and accumulates into the next
 * one until that gesture comes back. Gestures sent then equals gestures the phone completed, at
 * whatever rate that turns out to be, on any hardware, for any input device.
 *
 * It also removes the need to recognise macOS's momentum phase, which is just as well: a DOM
 * `WheelEvent` in Chromium carries no `phase` or `momentumPhase`, so there is nothing to filter on.
 * Under backpressure a momentum tail does not need filtering — its deltas fold into the sum that is
 * already waiting instead of each one becoming a gesture of its own.
 *
 * ### What it deliberately does not do
 *
 * It does not hold back a small scroll. A single mouse notch is ~17 capture pixels, which is under
 * this handset's 30-pixel touch slop and was arriving as a **tap** — but waiting for a second notch
 * would make one notch do nothing at all, which is worse. The fix for that is on the phone, where
 * the slop is known: `InputGeometry.withSlopHeadroom`, defect 111.
 *
 * Pure, no DOM, no transport: the caller sends. Plain script for the page, `module.exports` for
 * `node --test`, and never an `export` — defect 94.
 */

/** A scroll ready to go, in capture pixels, anchored at the point the pointer is at now. */
interface WheelScroll {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

class WheelPump {
  /** The sum waiting to be sent. Null when there is nothing owed. */
  private pending: WheelScroll | null = null;

  /** Whether a scroll is out with the phone and has not answered yet. */
  private outstanding = false;

  /*
   * Observability, and both halves of it. `events` is the denominator for `sent`: "we sent 9
   * scrolls" says nothing about whether the pump is working, and "9 sent for 61 wheel events"
   * says it exactly. `widest` is the largest number of events that ever folded into one gesture,
   * which is what a trackpad flick looks like from here.
   */
  private events = 0;
  private sent = 0;
  private folded = 0;
  private widest = 0;

  /** True while a scroll is out with the phone. */
  get inFlight(): boolean {
    return this.outstanding;
  }

  /** True when something is owed — the caller pumps until this goes false. */
  get owing(): boolean {
    return this.pending !== null;
  }

  /**
   * A wheel event arrived.
   *
   * The **anchor moves to the newest point** rather than staying at the first of the burst. It
   * selects which scrollable on the phone receives the stroke, and by the time a gesture goes out
   * the user has been looking at wherever the cursor is now, not wherever it was when the flick
   * began. With a 60 ms window the two were never far apart; under backpressure a burst can span
   * several hundred milliseconds and they can be different lists.
   */
  add(scroll: WheelScroll): void {
    this.events += 1;
    if (this.pending) {
      this.folded += 1;
      this.pending = {
        x: scroll.x,
        y: scroll.y,
        dx: this.pending.dx + scroll.dx,
        dy: this.pending.dy + scroll.dy,
      };
      return;
    }
    this.pending = { ...scroll };
  }

  /**
   * What to send now, or null.
   *
   * Null has two quite different causes and neither is an error: nothing is owed, or the phone still
   * has the last one. The caller does not need to tell them apart — it pumps on both `add` and the
   * reply, so whichever it is, the next chance comes immediately.
   *
   * A sum of exactly zero is dropped rather than sent. Two opposite flicks inside one window cancel,
   * and the phone refuses a zero-distance scroll by contract, so sending it would spend a round trip
   * to be told what is already known here.
   */
  due(): WheelScroll | null {
    if (this.outstanding || !this.pending) return null;
    const next = this.pending;
    this.pending = null;
    if (next.dx === 0 && next.dy === 0) return null;
    this.outstanding = true;
    this.sent += 1;
    const foldedIntoThis = this.folded + 1;
    if (foldedIntoThis > this.widest) this.widest = foldedIntoThis;
    this.folded = 0;
    return next;
  }

  /** The phone answered — well or badly. Either way it is no longer holding anything. */
  settled(): void {
    this.outstanding = false;
  }

  /**
   * Whatever is owed is abandoned, and the flight is cleared.
   *
   * Called when the phone turns: a scroll summed against the old screen shape is aimed at a list
   * that may not be there. Silently keeping it would be defect 19 one message type across.
   */
  reset(): void {
    this.pending = null;
    this.outstanding = false;
    this.folded = 0;
  }

  /** The line that goes in the log beside a send: a count and the thing that gives it scale. */
  tally(): string {
    return `${this.sent} sent / ${this.events} wheel events, widest fold ${this.widest}`;
  }
}

// Plain-script global for the page; module.exports for `node --test`. Never `export` — defect 94.
(globalThis as unknown as Record<string, unknown>).WheelPump = WheelPump;
if (typeof module !== 'undefined') module.exports = { WheelPump };
