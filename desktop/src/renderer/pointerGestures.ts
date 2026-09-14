/**
 * One gesture recogniser for every window that shows the phone.
 *
 * ### Why this is a file and not a method
 *
 * The float window is about to take pointer input. Three things in this path are safety-critical —
 * the **mapping** (a gesture aimed at the wrong pixel presses something the user cannot see), the
 * **drag cancellation on rotation**, and the **geometry stamp** that lets the phone refuse a gesture
 * computed against a screen shape it has left. All three already exist in `MirrorView`, and all
 * three are defects 19 and 20, which cost a sitting each.
 *
 * A second window with its own copy would be the copy that does not get the next fix. So the
 * recogniser moves here, `MirrorView` is refactored onto it, and the float uses the same object.
 * That is the point of the extraction: **not that the float needs one, but that there must not be
 * two.** The mapping half already lives in `captureFit.ts` for the same reason.
 *
 * ### What it holds and what it deliberately does not
 *
 * It holds the **state machine**: what a press accumulates, when a drag is thinned, whether a
 * release is a tap or a swipe, and how long it lasted. It does **not** hold the mapping (that is
 * `pointInCapture`), the transport (the caller sends), or any DOM (so `node --test` reaches every
 * branch, which is the seam rule the `LinkWaitStatus` defect exists to teach).
 *
 * It is a plain script, loaded by both pages with a `<script>` tag, so it declares globals and must
 * never carry an `export`. Defect 94.
 */

/** A point already mapped into capture pixels, with the stamp it was mapped against. */
interface MappedPoint {
  x: number;
  y: number;
  geom: { id: number; width: number; height: number };
}

/** What a release produced. `none` carries a reason, because a gesture that vanishes is defect 19. */
type GestureResult =
  | { kind: 'none'; reason: 'never-started' | 'cancelled-by-turn' | 'geometry-gone' }
  | { kind: 'tap'; x: number; y: number; durationMs: number; geom: MappedPoint['geom'] }
  | { kind: 'swipe'; points: { x: number; y: number }[]; durationMs: number; geom: MappedPoint['geom'] };

/*
 * **Moved from `mirror.ts`, values unchanged.** The first draft of this file invented 40 and 80 for
 * the two floors; the shipped values are 60 and 120. An extraction that quietly changes behaviour is
 * worse than the copy it replaces, and the compiler caught it only because the old constants were
 * still there to collide with — which is an argument for deleting the originals in the same change
 * rather than leaving them for later.
 */

/**
 * How far the pointer must move, in capture pixels, before a drag records another point.
 *
 * Well below what anyone can aim at, and enough to keep a slow drag across a 2340-pixel screen
 * inside the protocol's 100-point limit.
 */
const DRAG_POINT_SPACING = 4;

/** The protocol's cap. A path at this length is thinned rather than truncated. */
const MAX_DRAG_POINTS = 100;

/** A tap the user perceives as instant still needs to last long enough for the phone to see it. */
const MIN_TAP_MS = 60;

/** A drag sent as an instantaneous stroke reads as a fling; this floor keeps it a drag. */
const MIN_SWIPE_MS = 120;

/** The protocol's ceiling on a single gesture. */
const MAX_GESTURE_MS = 5_000;

class GestureRecogniser {
  /** Points of the drag in progress, in capture pixels, or null when not pressing. */
  private drag: { x: number; y: number }[] | null = null;
  private downAt = 0;
  /**
   * The phone turned while a press was in flight.
   *
   * Kept as a flag rather than dropping the drag outright, because the release still has to say
   * *why* nothing was sent. A press that silently vanishes is the failure defect 19 was, and the
   * sentence is the whole fix.
   */
  private cancelledByTurn = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get pressing(): boolean {
    return this.drag !== null;
  }

  /** True once a turn has cancelled a press, until the next release reports it. */
  get cancelled(): boolean {
    return this.cancelledByTurn;
  }

  /**
   * A press began. `null` means the caller could not map it — the phone has not said what shape its
   * screen is — and the caller owes the user a sentence.
   */
  down(point: MappedPoint | null): 'started' | 'no-geometry' {
    if (!point) return 'no-geometry';
    this.cancelledByTurn = false;
    this.downAt = this.now();
    this.drag = [{ x: point.x, y: point.y }];
    return 'started';
  }

  /**
   * The pointer moved. Accumulated rather than sent: one `input.swipe` per move would be thirty
   * gestures for one drag, the phone dispatches one at a time, and twenty-nine would be dropped —
   * leaving neither a drag nor a tap.
   */
  move(point: MappedPoint | null): void {
    const drag = this.drag;
    if (!drag || !point) return;
    const last = drag[drag.length - 1]!;
    if (Math.hypot(point.x - last.x, point.y - last.y) < DRAG_POINT_SPACING) return;
    if (drag.length >= MAX_DRAG_POINTS - 1) {
      // Thinned rather than refused: a drag that stops being recorded half way ends in the wrong
      // place. One short of the limit, because the release point is appended afterwards.
      this.drag = drag.filter((_, index) => index % 2 === 0);
    }
    this.drag!.push({ x: point.x, y: point.y });
  }

  /** The phone turned. Any press in flight was aimed at a screen shape that no longer exists. */
  cancelForTurn(): void {
    if (this.drag) this.cancelledByTurn = true;
    this.drag = null;
  }

  /** A press ended. Returns what to send, or why nothing is being sent. */
  up(point: MappedPoint | null): GestureResult {
    const drag = this.drag;
    this.drag = null;

    if (!drag) {
      if (this.cancelledByTurn) {
        this.cancelledByTurn = false;
        return { kind: 'none', reason: 'cancelled-by-turn' };
      }
      return { kind: 'none', reason: 'never-started' };
    }
    this.cancelledByTurn = false;
    // The geometry went away between press and release — a mirror stop, or a restart.
    if (!point) return { kind: 'none', reason: 'geometry-gone' };

    const heldMs = this.now() - this.downAt;
    if (drag.length < 2) {
      // A press that never moved. Its duration is the user's, so a long press arrives as one —
      // there is no separate long-press message and there does not need to be.
      return {
        kind: 'tap',
        x: point.x,
        y: point.y,
        durationMs: Math.max(MIN_TAP_MS, Math.min(heldMs, MAX_GESTURE_MS)),
        geom: point.geom,
      };
    }
    return {
      kind: 'swipe',
      points: [...drag, { x: point.x, y: point.y }],
      durationMs: Math.max(MIN_SWIPE_MS, Math.min(heldMs, MAX_GESTURE_MS)),
      geom: point.geom,
    };
  }
}

// Plain-script globals for the page; module.exports for `node --test`. Never `export` — defect 94.
(globalThis as unknown as Record<string, unknown>).GestureRecogniser = GestureRecogniser;
if (typeof module !== 'undefined') {
  module.exports = {
    GestureRecogniser,
    DRAG_POINT_SPACING,
    MAX_DRAG_POINTS,
    MIN_TAP_MS,
    MIN_SWIPE_MS,
    MAX_GESTURE_MS,
  };
}
