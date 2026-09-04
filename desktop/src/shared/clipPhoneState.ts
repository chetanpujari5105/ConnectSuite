/**
 * The phone direction's state, as one value — defect 85.
 *
 * ### The defect this exists to make impossible
 *
 * A user copied on their phone, pressed ⌘V on the Mac, got the Mac's own last clip, looked at the
 * Clipboard pane and concluded the feature was broken. It was not: Android refuses a background
 * clipboard read to every app (`docs/testing.md` → Slice 11), so the phone sends only while
 * ConnectSuite is open on it, and opening it delivered the clip immediately.
 *
 * The pane could not have told them that. Its one live strip was about Mac → phone; the Android
 * explanation was standing copy in the *other* column at `top=828` in an 865 px window — **21% on
 * screen** — and the left column's entire chrome was 299 characters that mentioned neither Android
 * nor the limit. So *Android refused the read*, *the link is down* and *the app has crashed* drew
 * the identical blank.
 *
 * ### Nothing is the resting state of a working feature
 *
 * That sentence is the whole design constraint, and it rules out the obvious fix. A banner that
 * appears when nothing has arrived would be showing almost always, because almost always nothing
 * has arrived and that is *correct*. A warning that is usually wrong is one people train themselves
 * past, and then it is not there on the day it is right.
 *
 * So [WAITING] is not a warning. It is an affirmative statement that the feature is working and
 * what the next move is, and it carries the recipe **at the moment of need** rather than as
 * permanent copy read once and then unseen.
 *
 * ### Two mechanisms, because one is a bug away from none
 *
 * The same pair the Files pane uses, and for the same reason (`filesRoots.ts`):
 *
 * 1. **A tagged union.** There is no `isWaiting` boolean beside an `error` field, so "working and
 *    quiet" and "broken" cannot both be true, cannot both be false, and cannot disagree. The render
 *    switches on `id` and the compiler checks it is exhaustive.
 * 2. **The states differ in four independent ways** — tone, icon, headline verb, and whether an
 *    action exists — asserted pairwise by [describeClipPhone]'s tests, so removing any one fails.
 *
 * The pair that must never converge is **[WAITING] against [OFFLINE] and [UNAVAILABLE]**: working
 * and quiet, against broken and quiet. Those two drew the identical picture and are the defect.
 *
 * ### There is no `export` keyword in this file, and that is load-bearing
 *
 * The renderer loads `src/shared/*.js` as **plain `<script>` tags**, so `tsc` emitting a CommonJS
 * `exports.foo = …` gives `ReferenceError: exports is not defined` in the browser — the module dies
 * on its first line and every function in it is undefined.
 *
 * **This was not caught by the suite, and could not have been.** The first version of this file used
 * `export function`, all 484 tests passed, and the pane threw on every single draw: the tests reach
 * this module through `tsx`, which is a path the renderer never takes. That is verbatim the failure
 * `CLAUDE.md` records against `SmsStore` and defect 50 — *a test that reaches the thing by a path the
 * app never takes can pass forever over a feature that has never worked* — and here the feature had
 * never worked, for the whole of its first build. It was found by opening the page and reading the
 * console, which is the same way defect 67 was found.
 *
 * So: plain declarations, and the two bindings at the bottom. `filesRoots.ts` and `clipLink.ts` are
 * the same shape for the same reason.
 */

/** Which of the four. Named so a log line and a test can say the same word as the code. */
type ClipPhoneStateId = 'waiting' | 'received' | 'offline' | 'unavailable';

const WAITING: ClipPhoneStateId = 'waiting';
const RECEIVED: ClipPhoneStateId = 'received';
const OFFLINE: ClipPhoneStateId = 'offline';
const UNAVAILABLE: ClipPhoneStateId = 'unavailable';

/**
 * What this Mac knows about the phone direction. Every field is something this machine can vouch
 * for — there is no field here whose value the phone asserts about itself.
 */
interface ClipPhoneFacts {
  /** Is the link up at all? `false` makes every other field unanswerable, and the state says so. */
  connected: boolean;
  /** Does the phone advertise `clipboard`? A phone can be connected and not offering it. */
  advertised: boolean;
  /**
   * The phone's own sentence for why it is not offering it. Verbatim — it knows which grant is
   * missing and this side does not. `null` when it did not say.
   */
  unavailableReason: string | null;
  /**
   * **This Mac's clock**, when a clip last arrived from the phone — never the phone's.
   *
   * The distinction is load-bearing: a phone entry's `atMs` is when the *phone read* it, which can
   * be minutes before it crossed and is on a clock this machine cannot vouch for. A line that says
   * "2 minutes ago" has to mean two minutes ago *here*, or the one number the user checks against
   * their own memory is measured against somebody else's clock.
   */
  lastArrivedAtMs: number | null;
  /** Now, on the same clock as [lastArrivedAtMs]. Injected so the age is testable. */
  nowMs: number;
}

/** How a state reads. Four fields, and four is not decoration — see the header. */
interface ClipPhoneView {
  id: ClipPhoneStateId;
  /**
   * The headline. **Its verb is one of the four differences**, so two states may not open with the
   * same word — asserted.
   */
  headline: string;
  /** The sentence under it. Where the recipe lives in [WAITING]. */
  detail: string;
  /**
   * `ready` is not a tone any other state uses, and it is deliberately not `neutral`: the resting
   * state of a working feature should read as *working*, not as an absence of news.
   */
  tone: 'ready' | 'done' | 'warning';
  icon: 'phone' | 'check' | 'unlink' | 'lock';
  /**
   * The label of the one action, or `null` when there is nothing to do.
   *
   * **`null` is a claim, not a gap.** [WAITING] and [RECEIVED] offer nothing because nothing is
   * wrong, and offering a Retry there would say something is. The broken states offer one because
   * there is a move to make. This is the fourth difference and the one most likely to be "tidied"
   * into a button on every state.
   */
  action: string | null;
}

/** Rounded to the unit a person would use out loud. Seconds are noise on a clipboard. */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The recipe, in the state where it is actionable.
 *
 * This is the sentence that was 828 px below the fold. It is not moved here — the standing copy
 * stays where it is for someone reading the pane cold — it is *repeated* at the one moment a person
 * is asking the question it answers.
 *
 * **It names two routes, and it was rewritten the hour the second one shipped.** Its first version
 * said only *"copy on the phone, then open ConnectSuite there"*, which was true and became the
 * *wrong one of two paths* the moment `SendSelectionActivity` landed — the exact failure defect 63
 * records, where a second implementation of something the product already had leaves every existing
 * sentence about the first quietly ambiguous. Nothing in the build could have flagged it: the
 * sentence was still accurate, still tested, and describing the slower route as though it were the
 * only one. The toolbar route is named **first** because it is the cheaper gesture.
 */
const RECIPE =
  'Select the text on the phone and tap “Send to Mac”, or copy it and open ConnectSuite there. ' +
  'Android only lets an app read the clipboard while it is on screen — a rule for every app, not ' +
  'a missing piece of this one — so the toolbar route is the quicker of the two.';

/**
 * The state, from the facts.
 *
 * Order matters and is stated: **connection is asked first**, because a disconnected phone cannot
 * advertise anything and cannot have failed to send. Deciding `advertised` first would report a
 * stale capability list as a permission problem — a confident wrong answer about the phone, from
 * data that is merely old.
 */
function describeClipPhone(facts: ClipPhoneFacts): ClipPhoneView {
  if (!facts.connected) {
    return {
      id: OFFLINE,
      headline: 'Not connected to your phone',
      detail:
        'Nothing can arrive from the phone until the link is back. This is not the Android ' +
        'clipboard limit — it is the connection.',
      tone: 'warning',
      icon: 'unlink',
      action: 'Reconnect',
    };
  }
  if (!facts.advertised) {
    return {
      id: UNAVAILABLE,
      headline: 'Your phone is not offering its clipboard',
      // The phone's sentence verbatim when it gave one: it knows which grant is missing.
      detail:
        facts.unavailableReason ??
        'The phone is connected but is not advertising the clipboard feature right now.',
      tone: 'warning',
      icon: 'lock',
      action: 'Check the phone',
    };
  }
  if (facts.lastArrivedAtMs === null) {
    return {
      id: WAITING,
      // **An affirmative verb.** "Waiting" would be accurate and would read as a stall; the feature
      // is working and the sentence has to say so before it says what to do.
      headline: 'Ready for anything you copy on the phone',
      detail: RECIPE,
      tone: 'ready',
      icon: 'phone',
      action: null,
    };
  }
  return {
    id: RECEIVED,
    headline: `Arrived from the phone ${ago(facts.nowMs - facts.lastArrivedAtMs)}`,
    detail:
      'It went straight onto this Mac’s clipboard, so ⌘V pastes it. ' +
      'For the next one, select it on the phone and tap “Send to Mac”.',
    tone: 'done',
    icon: 'check',
    action: null,
  };
}

/**
 * The newest arrival from the phone, **on this Mac's clock**, or `null`.
 *
 * Split out because picking the wrong timestamp is the easiest mistake available here and it is
 * invisible once made: `atMs` is the phone's clock and is right there on the same row. An entry
 * with no `receivedAtMs` is one this Mac did not witness arriving, and it is skipped rather than
 * falling back to `atMs` — a number from the wrong clock is worse than no number.
 */
function lastArrivalFromPhone(
  entries: readonly { source?: string; receivedAtMs?: number }[],
): number | null {
  let newest: number | null = null;
  for (const entry of entries) {
    if (entry.source !== 'phone') continue;
    if (typeof entry.receivedAtMs !== 'number') continue;
    if (newest === null || entry.receivedAtMs > newest) newest = entry.receivedAtMs;
  }
  return newest;
}

/**
 * The renderer loads plain `<script>` tags and cannot `require`, so the pure half hangs on
 * `globalThis` — the seam rule (`src/renderer/calls.ts`), not an exception to it. The test imports
 * the module properly and runs the same functions the pane calls.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.describeClipPhone = describeClipPhone;
  g.lastArrivalFromPhone = lastArrivalFromPhone;
}

if (typeof module !== 'undefined') {
  module.exports = { describeClipPhone, lastArrivalFromPhone, WAITING, RECEIVED, OFFLINE, UNAVAILABLE };
}
