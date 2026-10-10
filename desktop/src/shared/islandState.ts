/**
 * What the status island says, computed from the live link and nothing else.
 *
 * ### The rule
 *
 * **The island shows current state. A recorded event is history, and history is what the Activity
 * pane is for.** If a line is worth narrating it has to be happening now, and it must never
 * contradict the connection state drawn beside it in the device strip.
 *
 * ### What this replaces, and why it is a deletion rather than a filter
 *
 * `shared/islandRota.ts` held a six-slot ring of *strings* that a 5.2-second timer cycled into the
 * pill. Two facts about it, and the second is the defect:
 *
 *  - **There was no clock in it.** `ActivityEvent` carries `at: Date.now()`; `islandLineFor` took
 *    `{ category, kind, detail }` and dropped it at the boundary, and the ring was never cleared —
 *    not on disconnect, not on reconnect, not on a pairing change. A line's maximum age was the
 *    length of the session, and it came round every ~31 seconds for the whole of it.
 *  - **The text came from history and the tone came from the live link**, in one statement:
 *    `setIsland(this.events[this.eventIndex]!, toneOf(this.status))`. A stale sentence painted in
 *    the live colour is a claim that the sentence is current. So a refusal from ten minutes ago
 *    cycled in green beside a strip reading `Connected · 12 ms`, and `Connected · 12 ms` cycled in
 *    amber beside a strip reading `Reconnecting`.
 *
 * A filter over that ring would have been the wrong fix: it would leave a second writer on a
 * surface with one job, deciding from a different source on a different clock. The ring is gone and
 * the timer with it. There is one writer, and it computes from the same status the strip reads.
 *
 * ### Why the reason is a `kind` and never the classified sentence
 *
 * `LinkFailure.message` is prose for a full-width surface, and the `dropped` case reads *"The
 * connection to your phone dropped. Reconnecting."* — a sentence that **names a connection state**.
 * Put that in the pill beside a strip saying `Disconnected` and the island contradicts it while
 * carrying a perfectly current fact. So the island reads `LinkFailure.kind`, a closed enum of five,
 * and maps it here to a clause that contains no connection vocabulary at all. The prose keeps its
 * homes — the pairing screen, Activity, Settings → Advanced — where there is room for it.
 *
 * That is the difference between this and a filter: a filter tests the prose for connection words
 * and passes until somebody writes a new sentence. This cannot express the wrong thing.
 */

/** live / working / down / idle — the four the dots, chips and island all read. */
type IslandTone = 'live' | 'working' | 'down' | 'idle';

/**
 * The tone rules, reached the one way that works in both places this file runs: in the browser
 * `shared/linkTone.js` is a plain <script> loaded before this one, so its declarations are already
 * on `globalThis`; under `node --test` there is no script tag, so it is `require`d.
 *
 * **They are called here rather than passed in, and that is the load-bearing decision in this
 * file.** A `tone` parameter would let a caller hand the island a colour the strip does not have —
 * which is the defect, since the old rota's text and tone came from two different sources in one
 * statement. The island cannot be *told* what the connection state is; it computes it from the
 * same two functions the strip, the sidebar card and the hero call.
 */
const islandToneRules = (
  typeof module !== 'undefined'
    ? require('./linkTone')
    : (globalThis as unknown as Record<string, unknown>)
) as {
  linkTone: (
    p: string | undefined,
    h: { kind: string } | undefined,
    l: boolean,
    e: string | undefined,
  ) => IslandTone;
  linkToneLabel: (p: string | undefined, h: { kind: string } | undefined, l: boolean) => string;
};


/**
 * The link, exactly as the strip reads it. Deliberately the same fields, because the two surfaces
 * answering one question from two inputs is how they came to disagree in the first place.
 */
interface IslandLink {
  phase?: string;
  pairing?: { kind: 'unpaired' | 'paired' | 'repudiated' };
  paired?: boolean;
  rttMs?: number;
  /**
   * The classified sentence. **Read for the tone and never rendered here** — `linkTone`'s last
   * branch is `lastError ? 'down' : 'idle'`, so withholding it would give the island a different
   * colour from the strip in exactly the state where the colour matters. It goes in, it does not
   * come out.
   */
  lastError?: string | null;
  /** `LinkFailure.kind` from the main process. The only failure fact rendered — see the file comment. */
  lastFailureKind?: string | null;
}

/**
 * Something this Mac is doing **right now**, or `null`.
 *
 * The contract is the whole of it: a caller sets this when work starts and clears it when the work
 * stops, so the island cannot outlive the thing it describes. Nothing here is time-based, because a
 * duration would be this file re-inventing the rota — a line that keeps talking after the fact is
 * over is the defect, whether it lasts five seconds or five minutes.
 *
 * A clipboard sync is deliberately **not** one of these. `clip-send` is a request and its reply,
 * and `clip-arrived` is an instant; neither has a duration, so under the rule above both are
 * history the moment they exist. They are recorded in Activity and acknowledged by the toast.
 */
interface IslandWork {
  /** A present participle: `Copying`, `Sending`. */
  verb: string;
  /** What it is being done to. A file name, or `3 files`. */
  subject: string;
}

/**
 * The phases in which a socket attempt is **in flight right now**.
 *
 * ### Found on hardware, in the state the sample window had missed
 *
 * The first 30-second reading of this pill had a healthy link throughout, so every non-`live` state
 * was proven by the cross-product and by the DOM-level session test and **not** by a sighting. The
 * phone then went away on its own, and the pill read:
 *
 * ```
 * Connecting · no answer on any known address
 * ```
 *
 * Both halves true, and the sentence self-contradictory to read: it is dialling something while
 * saying nothing answered. The reason belongs to the *last completed* attempt; the label belongs to
 * the one in flight. Nothing contradicts the strip — the strip said `Connecting` too — which is why
 * neither the invariant nor the session test caught it, and why it was found by looking at the
 * screen. That is the same way defect 67 was found, and it is the standing argument for running the
 * thing rather than only testing it.
 *
 * So the reason accompanies a state that is **settled** — `Disconnected · …`, and `Reconnecting · …`
 * which by construction means *the last attempt failed and I am waiting to try again*. It is
 * withheld for the moment we are actually dialling. The pill therefore alternates between
 * `Reconnecting · no answer on any known address` and `Connecting` as the discovery order sweeps its
 * candidates, and both are true at the instant they are drawn.
 *
 * `searching` is here for robustness rather than for an observed case: `link.ts` reaches it only
 * when there is no failure at all (`setPhase(this.lastFailure ? 'reconnecting' : 'searching')`), so
 * the reason is already null there — but a phase list that depends on a caller's `?:` staying that
 * way is a rule with two homes.
 */
const DIALLING = new Set(['searching', 'connecting', 'handshaking']);

/**
 * The reason clause for a failure, from the closed set of `LinkFailure.kind`.
 *
 * None of these contains a connection state, which is the property that makes the contradiction
 * test pass rather than a coincidence of wording. `unknown` returns null: a failure this Mac could
 * not classify has nothing to add to the label, and *"something went wrong"* beside `Disconnected`
 * is a word count rather than a fact.
 */
function islandReason(kind: string | null | undefined): string | null {
  switch (kind) {
    case 'certificate-refused':
      return 'the phone no longer recognises this Mac';
    case 'unreachable':
      return 'no answer on any known address';
    case 'dropped':
      return 'the phone closed the connection';
    case 'protocol':
      return 'this Mac and the phone run different versions';
    default:
      return null;
  }
}

/**
 * The island's text and tone for one moment.
 *
 * The tone is `linkTone` and the connection claim is `linkToneLabel` — **the same two functions the
 * strip, the sidebar card and the Overview hero call**, not a fifth opinion. Everything this
 * function adds is a suffix to that label, and the two suffixes are mutually exclusive by state:
 *
 *  - a **reason**, only when the tone is not `live`. An error while connected is not happening.
 *  - **work**, only when the tone *is* `live`, and it replaces the label rather than suffixing it —
 *    `Copying clip.mp4` is a current fact whose truth already requires a connection.
 *
 * [now] is not a parameter and there is no timestamp anywhere in this file. That is the fix stated
 * as a type: a function with no clock cannot show a stale line.
 */
function islandState(
  link: IslandLink | null,
  work: IslandWork | null,
): { text: string; tone: IslandTone } {
  if (!link) return { text: 'Starting…', tone: 'idle' };

  const tone = islandToneRules.linkTone(
    link.phase,
    link.pairing,
    link.paired ?? false,
    link.lastError ?? undefined,
  );
  const label = islandToneRules.linkToneLabel(link.phase, link.pairing, link.paired ?? false);

  if (tone === 'live') {
    if (work) return { text: `${work.verb} ${work.subject}`, tone };
    // The latency is the live reading, not a remembered one. Absent before the first heartbeat, and
    // the label stands alone rather than carrying a dash — the same reason the battery slot is
    // removed rather than dashed, one surface over.
    return { text: link.rttMs === undefined ? label : `${label} · ${link.rttMs} ms`, tone };
  }

  // A reason explains why we are **not** connected. While a socket attempt is actually in flight it
  // explains the *previous* attempt, which is a different moment — see [DIALLING].
  const reason = DIALLING.has(link.phase ?? '') ? null : islandReason(link.lastFailureKind);
  return { text: reason ? `${label} · ${reason}` : label, tone };
}

{
  const g = globalThis as Record<string, unknown>;
  g.islandState = islandState;
  g.islandReason = islandReason;
}

if (typeof module !== 'undefined') {
  module.exports = { islandState, islandReason };
}
