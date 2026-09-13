/**
 * The start contract for a window that opens into a stream already running.
 *
 * ### The race this removes
 *
 * `main.ts` used to **push** the retained parameter sets at the float on `onReady` — a webContents
 * event that fires when the page is loaded, not when the page has registered the listener that
 * would catch them. When the push won, the float configured and worked; when it lost, the config
 * frame arrived at a window with no `onVideoFrame` handler, was dropped, and **nothing ever asked
 * again** — `H264Canvas.push` returns above the branch that requests a keyframe, so every later
 * access unit including IDRs went in the bin and the window stayed black in silence (defect 105).
 *
 * Both orderings are legal, neither side is wrong, and no amount of care in either one fixes it.
 * That is `CLAUDE.md`'s own tagged-union lesson: a guarantee about what can be *represented* buys
 * nothing against two events racing to set legal states in the wrong order.
 *
 * ### The contract
 *
 * **The consumer asks; the producer answers.** The float requests the parameter sets when its
 * listeners are up — an event it controls and can only emit after it is ready — and main replies
 * with the retained config or says plainly that there is none. There is no window event in the path
 * and nothing to win or lose.
 *
 * `null` is a real answer here and not a failure: a link that has never carried a config frame has
 * nothing to replay, and saying so lets the float draw *"no stream yet"* instead of waiting forever
 * on something that was never coming. The empty-versus-failed distinction, at the wire.
 *
 * ### Why the rate limit lives here
 *
 * The phone rate-limits its own keyframe requests and says why in a comment; neither Mac decoder
 * did. A consumer that asks on every dropped frame asks sixty times a second, which is the request
 * storm that the obvious fix for defect 105 — hoisting the request above the return — would have
 * produced. So asking is gated by two rules together:
 *
 *  - **one request in flight.** A second ask while one is outstanding is refused, not queued: the
 *    answer to the first is the answer to the second.
 *  - **a floor between attempts.** After an answer (or a timeout), the next ask waits.
 *
 * **A plain script**, loaded by `float.html`, so it declares globals and must never carry an
 * `export` — see defect 94. The float is the only runtime consumer: main *produces* the answer and
 * the float *interprets* it, so the rule has one home here and main declares only the shape it
 * sends. Nothing type-checks across an IPC boundary anyway, which is why the shape is named on both
 * sides rather than shared as a type that would imply a guarantee it cannot give.
 *
 * Pure, clock-injected, and electron-free so `node --test` can reach every branch — the decision is
 * here and the wiring is in `main.ts` and `float.ts`, which is the seam that made `LinkWaitStatus`
 * testable and the `copy()` that broke it invisible.
 */

/** Why an ask was refused, or that it may go. A closed set — a bare boolean cannot be logged. */
type AskVerdict =
  | { ask: true; attempt: number }
  | { ask: false; reason: 'in-flight'; outstandingForMs: number }
  | { ask: false; reason: 'too-soon'; waitMs: number };

const MIN_GAP_MS = 1_000;
/** An answer that never comes must not wedge the gate shut for the life of the window. */
const IN_FLIGHT_TIMEOUT_MS = 5_000;

/**
 * The asking half of the contract: at most one request out, and a floor between attempts.
 *
 * Deliberately **not** a queue. A request that arrives while one is outstanding wants the same
 * thing the outstanding one does, so granting it twice buys nothing and costs a message.
 */
class StartRequestGate {
  private attempts = 0;
  private sentAt: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly minGapMs: number = MIN_GAP_MS,
    private readonly inFlightTimeoutMs: number = IN_FLIGHT_TIMEOUT_MS,
  ) {}

  /** May a request go now? Does not send anything — call [sent] when it actually goes. */
  may(): AskVerdict {
    const t = this.now();
    if (this.sentAt !== null) {
      const outstandingForMs = t - this.sentAt;
      // A reply that never arrives would otherwise hold the gate shut forever, which turns a
      // rate limit into a deadlock — the failure mode a limiter is most likely to add.
      if (outstandingForMs < this.inFlightTimeoutMs) {
        return { ask: false, reason: 'in-flight', outstandingForMs };
      }
      this.sentAt = null;
    }
    if (this.lastSettledAt !== null) {
      const since = t - this.lastSettledAt;
      if (since < this.minGapMs) return { ask: false, reason: 'too-soon', waitMs: this.minGapMs - since };
    }
    return { ask: true, attempt: this.attempts + 1 };
  }

  private lastSettledAt: number | null = null;

  /** A request has gone out. */
  sent(): void {
    this.attempts += 1;
    this.sentAt = this.now();
  }

  /** An answer arrived, of either kind — including "there is no config". */
  settled(): void {
    this.sentAt = null;
    this.lastSettledAt = this.now();
  }

  snapshot(): { attempts: number; inFlight: boolean } {
    return { attempts: this.attempts, inFlight: this.sentAt !== null };
  }
}

/** What main replies with. `null` config is an answer, not an absence of one. */
interface StreamStartAnswer {
  /** The retained parameter sets, or null when the link has never carried one. */
  config: { ptsUs: number; bytes: number } | null;
  /** True when a mirror session is running, so the float can tell "not started" from "no config". */
  sessionRunning: boolean;
}

/**
 * What the consumer should do with an answer. Three outcomes, because "no config" splits in two and
 * collapsing them is the mistake `floatWait.ts` exists to undo one layer up.
 */
function actionFor(answer: StreamStartAnswer): 'configure' | 'wait-for-session' | 'ask-again' {
  if (answer.config) return 'configure';
  // No config and no session: nothing is wrong, there is simply nothing to show yet. Asking again
  // would be a storm against a phone that is not mirroring.
  if (!answer.sessionRunning) return 'wait-for-session';
  // A session is running and no config has been retained — that is a real gap, and the keyframe
  // request is what fills it, because a config frame precedes the IDR that answers one.
  return 'ask-again';
}

// Plain-script globals for the page; module.exports for `node --test`. Never `export` — a file
// loaded by a <script> tag that compiles to CommonJS throws on its first line. Defect 94.
(globalThis as unknown as Record<string, unknown>).StartRequestGate = StartRequestGate;
(globalThis as unknown as Record<string, unknown>).actionFor = actionFor;
if (typeof module !== 'undefined') {
  module.exports = { StartRequestGate, actionFor, MIN_GAP_MS, IN_FLIGHT_TIMEOUT_MS };
}
