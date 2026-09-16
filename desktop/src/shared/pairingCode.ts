/**
 * P5 — what the pairing screen says about the code currently on it.
 *
 * ### Why this is not the countdown the design draws
 *
 * `ConnectSuite.dc.html` draws a ticking countdown, and a countdown was the obvious build. It would
 * have been decoration, and measurably so: the renderer re-arms the token every **60 seconds** while
 * the pairing screen is up (`keepPairingArmed`), and `armPairing` pushes `expiresAt` out by the full
 * five minutes each time. A clock wired to that number counts from 5:00 to about 4:00, jumps back to
 * 5:00, and **can never reach zero while anyone is looking at it** — a number that looks like
 * information and is not, which is the one thing this project rules out everywhere.
 *
 * ### What is true instead, and it is a state the app could not previously draw
 *
 * The re-arm is a timer in a renderer. It stops when the Mac sleeps, and it does not catch up. So
 * the case that actually happens is: the pairing screen is left open, the lid closes, and the QR on
 * screen is now **a picture of a token this Mac will refuse** — under a line reading *"valid while
 * this code is on screen"*, which by then is false.
 *
 * That was undrawable before `pairingExpiresAt` reached the renderer, and it is the honest P5:
 *
 * | | when | what the screen owes |
 * |---|---|---|
 * | `none` | no code armed yet | nothing; the screen has not claimed anything |
 * | `fresh` | more than a minute left | the standing copy. The re-arm keeps it here |
 * | `expiring` | a minute or less | a real number, because this is only reachable once the re-arm has stopped |
 * | `stale` | past it | say so, and point at the button that fixes it |
 *
 * **`expiring` is the interesting one.** With a 60 s re-arm against a 5 minute TTL it is unreachable
 * in normal running — which is the point. Seeing it means the timer has stopped, and the user is
 * about to photograph a code that will not work.
 *
 * ### Why the caller passes `now`
 *
 * So a test can reach the transition. `CLAUDE.md`'s defect 67 is a feature whose rule had eleven
 * passing tests and had never once worked, because the *write* of the field it read was somewhere no
 * test could go. A rule that reads `Date.now()` internally is that shape by construction.
 *
 * ### No `export` keyword, and that is load-bearing
 *
 * The renderer loads `src/shared/*.js` as plain `<script>` tags. A CommonJS `exports.foo = …` throws
 * `ReferenceError: exports is not defined` on its first line and every declaration below it is dead
 * — defect 94, which shipped green with 484 tests because the tests reach the module through `tsx`,
 * a path the renderer never takes. Plain declarations, two bindings at the bottom.
 */

/** Below this, the screen shows a real number instead of the standing copy. */
const PAIR_CODE_WARN_MS = 60 * 1000;

interface PairingCodeState {
  kind: 'none' | 'fresh' | 'expiring' | 'stale';
  /** The line under the QR. Never empty for a code that is on screen. */
  text: string;
  /** Whether *Show a fresh code* is the thing to press. Drives emphasis, not existence. */
  urgent: boolean;
  /** Whole seconds left, or null when there is no number worth showing. */
  secondsLeft: number | null;
}

function pairingCodeState(
  expiresAt: number | null | undefined,
  nowMs: number,
  deviceName?: string,
  host?: string,
): PairingCodeState {
  // The standing copy, kept exactly as it was: it is true whenever the code is good, and it says
  // the useful thing — that leaving this screen open is what keeps the code alive.
  const standing =
    deviceName && host
      ? `${deviceName} at ${host} — valid while this code is on screen.`
      : 'Valid while this code is on screen.';

  if (expiresAt === null || expiresAt === undefined) {
    return { kind: 'none', text: standing, urgent: false, secondsLeft: null };
  }

  const remaining = expiresAt - nowMs;
  if (remaining <= 0) {
    /*
     * The sentence names what the user can see and what to do, and claims nothing about why. A Mac
     * that slept, a Mac that was busy, a clock that stepped — they all land here and the screen
     * cannot tell them apart, so it does not guess. Same discipline as the folder picker: when the
     * platform returns one result for several causes, nothing is explained afterwards.
     */
    return {
      kind: 'stale',
      text: 'This code has expired. Show a fresh code to pair.',
      urgent: true,
      secondsLeft: 0,
    };
  }

  if (remaining <= PAIR_CODE_WARN_MS) {
    const seconds = Math.ceil(remaining / 1000);
    return {
      kind: 'expiring',
      text: `This code expires in ${seconds}s. Show a fresh code if your phone is not ready.`,
      urgent: false,
      secondsLeft: seconds,
    };
  }

  return { kind: 'fresh', text: standing, urgent: false, secondsLeft: Math.ceil(remaining / 1000) };
}

{
  const g = globalThis as Record<string, unknown>;
  g.pairingCodeState = pairingCodeState;
}
if (typeof module !== 'undefined') {
  module.exports = { pairingCodeState, PAIR_CODE_WARN_MS };
}
