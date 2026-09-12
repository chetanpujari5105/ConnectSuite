/**
 * Why the float has no picture — a closed set, and the sentence for each.
 *
 * ### Two states wearing one sentence
 *
 * `float.html` and `float.ts` both said *"Waiting for the phone's next keyframe…"*, and it covered
 * two situations needing opposite responses:
 *
 *  - **no decoder at all.** The float opened mid-stream, no config frame ever arrived, and
 *    `H264Canvas.push` returns at `if (!decoder …)` — which sits **above** the branch that asks for
 *    a keyframe. Every access unit is dropped, IDRs included, and **nothing ever asks for
 *    anything.** The sentence was a lie in this state: the phone's next keyframe is dropped too.
 *  - **waiting on a request.** A decoder exists, it is armed, a request is out, and the sentence is
 *    exactly right — it lasts as long as the phone takes to answer.
 *
 * A user watching an empty float could not tell these apart, and neither could this repo, because
 * the keyframe path logged nothing at either end. Same defect as the mirror's eight stop sentences
 * (104): a closed set of causes collapsed into the friendliest member. Same treatment — a closed
 * set, a sentence derived from it, and a `blocking` flag saying whether the state can clear itself.
 *
 * **A plain script**, loaded by `float.html` with a `<script>` tag, so it declares globals and must
 * never carry an `export` — that would compile to CommonJS whose first statement touches `exports`,
 * throwing on line 1 and killing every declaration below it (defect 94).
 * `scripts/check-renderer-scripts.mjs` reads `float.html` as well as `index.html` as of 2026-09-12,
 * which is what makes that enforceable here rather than only in the main window.
 */

/** Every reason the float can be showing no picture. Closed, and ordered by what the user does. */
type FloatWaitKind =
  /** No decoder: nothing has described the stream yet, so frames cannot even be dropped usefully. */
  | 'no-parameter-sets'
  /** A decoder exists and is armed for an IDR; a request is outstanding. */
  | 'awaiting-keyframe'
  /** Asked repeatedly and nothing came back. The phone is answering nothing, or not answering. */
  | 'unanswered'
  /** Frames are being decoded. Nothing to say. */
  | 'running';

interface FloatWaitState {
  kind: FloatWaitKind;
  /** Shown verbatim in the float's overlay. */
  sentence: string;
  /** Second line when there is something to know; null when the state speaks for itself. */
  detail: string | null;
  /**
   * True when the state cannot clear itself without something else changing.
   *
   * The distinction the single sentence destroyed: `awaiting-keyframe` clears the moment the phone
   * answers, and `no-parameter-sets` never clears on its own, because the code that would ask is
   * unreachable from that state.
   */
  blocking: boolean;
}

/** How many unanswered requests before the wait stops being ordinary. */
const UNANSWERED_THRESHOLD = 3;

function floatWaitState(input: {
  hasDecoder: boolean;
  decoding: boolean;
  requested: number;
  answered: number;
}): FloatWaitState {
  if (input.decoding) {
    return { kind: 'running', sentence: 'Mirroring.', detail: null, blocking: false };
  }
  if (!input.hasDecoder) {
    return {
      kind: 'no-parameter-sets',
      sentence: 'The floating window has not been told how to decode this stream yet.',
      // Names the mechanism rather than the symptom, because the symptom — an empty pane — is the
      // same one every other state produces.
      detail:
        'It opened while the phone was already mirroring, so it missed the frame that describes ' +
        'the video. Nothing will appear until the Mac replays it.',
      blocking: true,
    };
  }
  const outstanding = input.requested - input.answered;
  if (outstanding >= UNANSWERED_THRESHOLD) {
    return {
      kind: 'unanswered',
      sentence: 'The phone has not sent a full frame since the floating window asked.',
      detail: `${input.requested} requests, ${input.answered} answered.`,
      blocking: true,
    };
  }
  return {
    kind: 'awaiting-keyframe',
    sentence: 'Waiting for the phone’s next full frame…',
    detail: null,
    blocking: false,
  };
}


// Plain-script global for the page; module.exports for `node --test`. Never `export`.
(globalThis as unknown as Record<string, unknown>).floatWaitState = floatWaitState;
if (typeof module !== 'undefined') module.exports = { floatWaitState, UNANSWERED_THRESHOLD };
