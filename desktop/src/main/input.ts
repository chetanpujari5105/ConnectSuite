import { MessageType, type InputResult, type PhoneRequestError } from '../shared/protocol';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of input: one request at a time, in order, with the phone's reason on failure.
 *
 * Ordering is not a nicety. The phone dispatches one gesture at a time and drops anything that
 * arrives while another is in flight, so two overlapping requests would mean one gesture happening
 * and one vanishing. Chaining them here means the second waits rather than being lost, and the
 * queue bound means a phone that has stopped answering produces a clear refusal instead of an
 * unbounded backlog of taps that will all arrive at once when it wakes up.
 *
 * The renderer's coalescing is what keeps this queue near-empty in normal use: a drag becomes one
 * swipe, and a burst of wheel events becomes one scroll.
 *
 * **Nothing here throws.** Every method resolves with an [InputResult], because the only consumer
 * is an `ipcMain.handle` and `ipcRenderer.invoke` rewraps a rejection as `Error invoking remote
 * method 'input-key': Error: <message>`. The phone composes its refusals carefully — that is
 * locked decision 6 — and nine words of Electron plumbing in front of every one of them defeats
 * the point of composing them (defect 22). The parts travel separately and the renderer puts them
 * on the canvas.
 */
export class InputClient {
  /** The tail of the in-flight chain. Resolved when nothing is outstanding. */
  private tail: Promise<unknown> = Promise.resolve();

  private queued = 0;

  // The denominator. The phone keeps the same pair (`InputFeature.tally`) and the Mac kept only
  // half of it: refusals were logged and deliveries were not, which is the shape defect 18 hid in
  // — 187 refusals that looked like a clumsy user until the success count turned out to be zero.
  private delivered = 0;
  private refused = 0;

  constructor(private readonly link: () => LinkClient | null) {}

  /**
   * Longest a single input request may take.
   *
   * The phone's own budget is the gesture's duration plus two seconds, and the protocol caps a
   * gesture at five, so this is that plus room for a slow link. A timeout here is reported to the
   * user as a failure, so it must not be tighter than the phone's own patience — otherwise the
   * Mac says "it did not work" about a tap that did.
   */
  private static readonly TIMEOUT_MS = 9_000;

  /**
   * How many requests may be waiting behind the one in flight.
   *
   * Small on purpose. Input is a live conversation with a phone in the user's hand; a tap that has
   * been sitting in a queue for four seconds is not one they still want delivered.
   */
  private static readonly MAX_QUEUED = 8;

  /**
   * How long a gesture may sit in this queue before it is thrown away instead of sent.
   *
   * Defect 20's Mac half. Chosen against the phone's measured dispatch time rather than by feel: a
   * gesture takes its own duration plus about 4ms on the phone, so the common strokes cost 63ms
   * (tap), 103ms (scroll) and 203ms (swipe). 400ms is therefore roughly two scrolls' worth of
   * waiting — enough that a normal burst of coalesced wheel events still gets through in order,
   * and short enough that nothing survives the app switch it was aimed across.
   *
   * Deliberately shorter than TIMEOUT_MS by an order of magnitude. That timeout is about a phone
   * that has stopped answering; this is about a gesture that has stopped being meaningful, and the
   * second happens long before the first.
   */
  private static readonly STALE_MS = 400;

  tap(payload: Record<string, unknown>): Promise<InputResult> {
    return this.send(MessageType.INPUT_TAP, payload);
  }

  swipe(payload: Record<string, unknown>): Promise<InputResult> {
    return this.send(MessageType.INPUT_SWIPE, payload);
  }

  scroll(payload: Record<string, unknown>): Promise<InputResult> {
    return this.send(MessageType.INPUT_SCROLL, payload);
  }

  key(key: string): Promise<InputResult> {
    return this.send(MessageType.INPUT_KEY, { key });
  }

  text(text: string, mode: 'replace' | 'append'): Promise<InputResult> {
    return this.send(MessageType.INPUT_TEXT, { text, mode });
  }

  global(action: string): Promise<InputResult> {
    return this.send(MessageType.INPUT_GLOBAL, { action });
  }

  /** A refusal the Mac made for itself. Counted and logged like the phone's, for the same reason. */
  private refuse(type: string, reason: string): InputResult {
    this.refused += 1;
    log.warn('input', `${type} refused here: ${reason} — ${this.tally()}`);
    return { ok: false, reason };
  }

  private tally(): string {
    return `${this.delivered} delivered / ${this.refused} refused since launch`;
  }

  private async send(type: string, payload: Record<string, unknown>): Promise<InputResult> {
    const client = this.link();
    if (!client?.isConnected()) {
      return this.refuse(type, 'The Mac is not connected to the phone, so that was not sent.');
    }
    if (this.queued >= InputClient.MAX_QUEUED) {
      return this.refuse(type, 'The phone is not keeping up with input, so that one was dropped.');
    }

    this.queued += 1;
    const queuedAt = Date.now();
    // Chained on the previous request rather than fired immediately: see the class comment. The
    // `.catch` keeps one failure from poisoning the chain for everything behind it.
    const run = this.tail
      .catch(() => undefined)
      .then(() => {
        // Defect 20. A gesture is aimed at what the user could see when they made it, and the wait
        // in this queue is exactly the window in which that stops being true — a notification takes
        // focus, the phone switches app, the user's own finger opens something else. Coordinates
        // stay valid for whatever is now in front, which is what makes a late one dangerous rather
        // than merely useless: it lands, silently, somewhere nobody aimed.
        //
        // The phone refuses these too, by comparing the foreground package. This is the cheaper
        // half of the same guard: a stale gesture is not worth a round trip.
        const waited = Date.now() - queuedAt;
        if (waited > InputClient.STALE_MS) {
          throw new Error(
            `That ${type.replace('input.', '')} waited ${waited}ms behind other input, ` +
              'so it was dropped rather than sent to a screen that has moved on.',
          );
        }
        return client.request(type, payload, InputClient.TIMEOUT_MS);
      });
    this.tail = run;

    try {
      await run;
      this.delivered += 1;
      // Logged at the same volume as the refusal below, and carrying the same tally, because a
      // count of refusals with no denominator is not evidence — see CLAUDE.md, and defect 18,
      // which hid behind exactly that.
      log.info('input', `${type} delivered ${aimOf(payload)} — ${this.tally()}`);
      return { ok: true };
    } catch (error) {
      // The phone's own sentence — "No text field has focus…", "That click was worked out against
      // a screen shape the phone has already left…" — is what the user needs to read, so it is
      // passed on rather than replaced with a Mac-flavoured one. The code and the hint travel
      // beside it rather than being folded into one string: the code belongs in the log line
      // above and never in front of a user, and the hint is a second line on the canvas, not a
      // clause. Joining them here is what produced `…typing yet.On the phone: Settings > …`.
      const failure = error as PhoneRequestError;
      this.refused += 1;
      log.warn('input', `${type} refused ${aimOf(payload)}: ${failure.message} — ${this.tally()}`);
      return {
        ok: false,
        reason: failure.phoneMessage ?? failure.message ?? String(error),
        fixHint: failure.fixHint,
        code: failure.code,
      };
    } finally {
      this.queued -= 1;
    }
  }
}

/**
 * Where a gesture was aimed, for the log line beside it.
 *
 * **This was absent, and its absence is why defect 99 could not have been found from a log.** The
 * delivered line said `input.tap delivered — 14 delivered / 0 refused`: proof that a tap went, and
 * silent about *where* — so a mapping that was scaling and offsetting every coordinate by the size
 * of a letterbox produced a log indistinguishable from a correct one, for a phase.
 *
 * The geometry stamp travels with it because a coordinate without the screen shape it was measured
 * against is not a location. `#7 1080x2408` is what makes `x=1063` readable as *17 pixels from the
 * right edge* rather than as a number.
 *
 * Rounded to whole pixels: the phone dispatches at integer precision and a log line carrying six
 * decimals of a value nobody can act on is noise dressed as rigour.
 */
function aimOf(payload: Record<string, unknown>): string {
  const stamp = payload.geom as { id?: number; width?: number; height?: number } | undefined;
  const screen = stamp?.width ? `#${stamp.id ?? '?'} ${stamp.width}x${stamp.height}` : 'no stamp';

  const points = payload.points as Array<{ x: number; y: number }> | undefined;
  if (Array.isArray(points) && points.length > 0) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return `(${Math.round(first.x)},${Math.round(first.y)} → ${Math.round(last.x)},${Math.round(last.y)}, ${points.length} pts on ${screen})`;
  }

  if (typeof payload.x === 'number' && typeof payload.y === 'number') {
    const scroll =
      typeof payload.dx === 'number' && typeof payload.dy === 'number'
        ? ` by ${Math.round(payload.dx)},${Math.round(payload.dy)}`
        : '';
    return `(${Math.round(payload.x)},${Math.round(payload.y)}${scroll} on ${screen})`;
  }

  // input.key and input.text carry no coordinates and there is nothing to aim.
  return `(on ${screen})`;
}
