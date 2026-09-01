/**
 * The echo interlock: the whole of what stops two clipboards writing each other in a circle.
 *
 * ### Why this is an object rather than two fields
 *
 * It used to be two `private` fields on `ClipboardClient` and two `@Volatile`s on `ClipFeature`,
 * each assigned from three places. That was fine while **neither side applied anything without a
 * tap** — a person is a rate limiter, and a loop that needs a human to press a button twice per hop
 * is not a loop. Auto-apply removes the human from the cycle on both ends, so the interlock stops
 * being a nicety and becomes the thing the feature rests on.
 *
 * A rule that the feature rests on gets **one home**, so a test can call it rather than model it —
 * `CLAUDE.md`, and the reason `MediaPayloads.cursorOf` exists. `clipEcho.test.ts` drives this class
 * against a peer that echoes everything back forever; if the rule lived in the caller, that test
 * would be checking a second copy of it and would stay green with the real one deleted.
 *
 * `scripts/check-clip-echo.mjs` is the other half: it fails if `lastReceived` or `lastSent` is
 * declared anywhere but here and its Kotlin twin, so the caller cannot quietly grow a third copy.
 *
 * ### The two rules, and they are not the same rule
 *
 * - **`echo`** — never send text identical to the last text this side *received*. A rule about what
 *   to send, not a filter on what arrives: the receiver cannot tell an echo from somebody genuinely
 *   copying the same string twice, so the decision is made where the knowledge is.
 * - **`unchanged`** — an *automatic* trigger does not re-send a clipboard that has not changed. This
 *   is not an echo guard and does not stop one; it stops the phone re-sending the same string every
 *   time somebody opens the app. It applies to automatic triggers only, because a person who clicks
 *   Send has said what they want and should not be argued with.
 *
 * ### What survives a link drop, and why they differ
 *
 * `lastSent` clears: the Mac on the other end may be a different Mac, or the same one with an empty
 * history, and it should get this phone's clipboard on the next focus.
 *
 * **`lastReceived` does not clear**, and that changed when auto-apply landed. Clearing it opens a
 * one-hop bounce: the Mac applies X to the phone, the link drops, the phone comes back, reads X off
 * its own clipboard with the interlock disarmed, and sends X home — where a Mac that auto-applies
 * writes X over whatever the person has copied since. One hop, terminating, and it silently replaces
 * live work with a stale entry, which is the exact harm auto-apply is on probation for.
 *
 * It is one string, never rendered, never sent, never logged, and the clipboard it came from is
 * still holding it — so keeping it is not a retention decision in the sense the history's is. The
 * history clears on disconnect because it is a store somebody can read.
 */

export type SendTrigger = 'user' | 'automatic';

/**
 * Why a send did or did not happen. A reason rather than a boolean because both refusals get said
 * out loud — a silent no-op is what makes the next person delete the gate to find out what it did.
 */
export type SendDecision =
  | { send: true }
  | { send: false; why: 'echo' }
  | { send: false; why: 'unchanged' };

export class ClipEcho {
  /** The last text this side received from the other side. The echo interlock, and nothing else. */
  private lastReceived: string | null = null;

  /** The last text this side sent. Suppresses automatic re-sends of an unchanged clipboard. */
  private lastSent: string | null = null;

  /**
   * Text arrived from the other side. Call this **before** writing any clipboard with it.
   *
   * The ordering is the whole interlock. A write that lands before the interlock is armed leaves a
   * window in which this side's own trigger can read its own new clipboard and send it back.
   */
  arrived(text: string): void {
    this.lastReceived = text;
  }

  /**
   * This side wrote its own clipboard with `text` — auto-apply, Restore, or Use this.
   *
   * **Arms only the unchanged rule, and the narrowing is a finding rather than a tidy-up.** It used
   * to arm both, and a mutation that removed the `lastReceived` half left **every test green** —
   * the same two-guards-one-test shape that let an earlier version of this file pass with the echo
   * rule deleted. The half was redundant for the case it was written for and wrong for the case it
   * was reachable in:
   *
   * - **An arriving entry** is already covered by [arrived], which runs before the write and
   *   survives a link drop. Arming `lastReceived` a second time here changed nothing.
   * - **A Restore** is the case where it was the only guard — and there it made an explicit *Send
   *   this Mac's clipboard* click afterwards refuse as an echo, over text the person had just
   *   deliberately put back. A click is an instruction; the interlock exists to stop machines
   *   looping, not to overrule people.
   *
   * What is left is the rule the watcher actually needs: **a clipboard this side wrote is not a
   * copy this side made**, so the next poll must not read it back out and send it.
   */
  wroteLocally(text: string): void {
    this.lastSent = text;
  }

  /** May this side send `text` now? `user` skips the unchanged rule; nothing skips the echo rule. */
  maySend(text: string, trigger: SendTrigger): SendDecision {
    if (text === this.lastReceived) return { send: false, why: 'echo' };
    if (trigger === 'automatic' && text === this.lastSent) return { send: false, why: 'unchanged' };
    return { send: true };
  }

  /** Record a send that actually left. Called on success, never on the attempt. */
  sent(text: string): void {
    this.lastSent = text;
  }

  /** The link dropped. `lastSent` goes; `lastReceived` stays — see the class comment. */
  linkDropped(): void {
    this.lastSent = null;
  }
}
