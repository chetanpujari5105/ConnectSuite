import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipEcho, type SendTrigger } from './clipEcho';

/**
 * The cycle proof. This is the test the whole auto-apply change was gated on.
 *
 * ### The shape, and why it is not two peers agreeing with each other
 *
 * The obvious proof — wire a Mac `ClipEcho` to a phone `ClipEcho` and watch them settle — proves
 * only that two copies of one rule agree, which they will, being copies. It is the
 * `MediaPayloadsTest` mistake with a network in the middle: delete the rule from both and the run
 * stays green.
 *
 * So the peer here is **adversarial**. It pushes back everything it receives, immediately, forever,
 * and it is free to lie about `source` and `atMs`. If one real `ClipEcho` cannot be driven into a
 * cycle by a peer that does nothing but echo, then it cannot be driven into one by the other side of
 * this product either — whatever that side does, and whatever it is changed into later. That is a
 * stronger claim than the pair, and it survives someone adding a clipboard watcher to the Mac.
 *
 * ### The instrument reports its own bound
 *
 * `exchange` stops at a hop cap and says so. A run that ends at the cap has proven nothing about
 * convergence — it has proven the instrument ran out — and `reportable` is false for it, so a cycle
 * cannot be read as a pass because the number that came back was small. `CLAUDE.md`, the 200-page
 * probe that reported its own ending as the pager's.
 *
 * ### The control that matters more than the no-cycle assertion
 *
 * A guard that refuses every send passes a no-cycle test perfectly. `a genuine second copy still
 * sends` is the known-positive: it proves the interlock is discriminating rather than merely
 * silent. Without it this file would be evidence of nothing, in the way an empty accessibility tree
 * is evidence of nothing.
 */

const HOP_CAP = 50;

interface Run {
  /** Pushes the side under test emitted, in order. */
  pushes: string[];
  /**
   * Why each refusal happened, in order — and this field is the whole reason the file is honest.
   *
   * The first version of this test recorded only `pushes`, and the mutation run that was supposed
   * to prove it could see the defect **stayed green with the echo rule deleted**: `wroteLocally`
   * arms `lastSent` too, so the `unchanged` rule caught every echo and the run still converged to
   * one push. The test was not weak, it was measuring a different guard than the one it was named
   * for — `CLAUDE.md`'s rule about a test that models the thing under test, arriving by a route
   * nobody had thought of, in a file written to apply that rule.
   *
   * Asserting *which* guard refused is what separates them. Two guards that both stop the cycle is
   * a good property; a test that cannot say which one is running is not evidence for either.
   */
  refusals: ('echo' | 'unchanged')[];
  hops: number;
  stopped: 'converged' | 'hop cap';
  /** False when the run ended at the cap: it holds no finding about convergence either way. */
  reportable: boolean;
}

interface SideOptions {
  /** Does this side write its own clipboard when something arrives? */
  autoApply: boolean;
  /** What fires the send path. `automatic` is the phone's focus; `user` is the Mac's button. */
  trigger: SendTrigger;
  /** An echoing peer that rewrites the metadata on the way back, to prove `source` is not load-bearing. */
  peerLies?: boolean;
}

/**
 * One side under test against a peer that echoes everything, run until it settles or the cap.
 *
 * The trigger is fired after **every** clipboard write, which is the worst case rather than the real
 * one: the phone's real trigger is window focus and the Mac's is a click, and neither fires on a
 * write we performed ourselves. Proving it against a change-driven trigger proves it against both.
 */
function exchange(seed: string, options: SideOptions): Run {
  const echo = new ClipEcho();
  let clipboard = seed;
  const pushes: string[] = [];
  const refusals: ('echo' | 'unchanged')[] = [];
  let hops = 0;

  // The peer's queue. It echoes whatever it is handed, so anything in here is on its way back.
  let inFlight: string | null = null;
  let pending = true; // a trigger is armed for the seed

  while (hops < HOP_CAP) {
    if (pending) {
      pending = false;
      const decision = echo.maySend(clipboard, options.trigger);
      if (decision.send) {
        pushes.push(clipboard);
        echo.sent(clipboard);
        inFlight = clipboard; // the adversary echoes it back unchanged in value
      } else {
        refusals.push(decision.why);
      }
    }

    if (inFlight === null) {
      return { pushes, refusals, hops, stopped: 'converged', reportable: true };
    }

    // The arrival. `peerLies` changes only the metadata, which this rule never consults — the point
    // of the option is to show that it does not.
    const arriving = inFlight;
    inFlight = null;
    hops += 1;

    echo.arrived(arriving);
    if (options.autoApply) {
      clipboard = arriving;
      echo.wroteLocally(arriving);
      pending = true; // worst case: the write itself re-arms the trigger
    }
  }

  return { pushes, refusals, hops, stopped: 'hop cap', reportable: false };
}

test('an auto-applying side against a peer that echoes forever does not cycle', () => {
  const run = exchange('https://example.com/a-thing', { autoApply: true, trigger: 'automatic' });

  assert.equal(run.stopped, 'converged', `run ended at ${run.stopped} after ${run.hops} hops`);
  assert.equal(run.reportable, true);
  // Exactly one push: the original. Everything after it is the interlock refusing.
  assert.deepEqual(run.pushes, ['https://example.com/a-thing']);
  // And it is the *echo* rule refusing, not the unchanged rule that happens to be armed beside it.
  // Without this line the test passes with the echo rule deleted — measured, not supposed.
  assert.deepEqual(run.refusals, ['echo']);
});

test('a lying peer cannot restart the cycle by rewriting source', () => {
  // `source` and `atMs` are the fields a receiver could try to reason from, and this rule does not
  // touch either. It compares text, on the send side, where the knowledge is. A peer that claims
  // every echo is a fresh phone copy changes nothing.
  const run = exchange('token-abc', { autoApply: true, trigger: 'automatic', peerLies: true });

  assert.equal(run.stopped, 'converged');
  assert.deepEqual(run.pushes, ['token-abc']);
  assert.deepEqual(run.refusals, ['echo']);
});

test('a user-triggered side does not cycle either, and for a different reason', () => {
  // The Mac's send is a click, so its `unchanged` rule is deliberately not applied — a person who
  // presses Send twice means it. The echo rule alone has to carry this case.
  const run = exchange('a line of text', { autoApply: true, trigger: 'user' });

  assert.equal(run.stopped, 'converged');
  assert.deepEqual(run.pushes, ['a line of text']);
  assert.deepEqual(run.refusals, ['echo']);
});

test('a genuine second copy still sends — the interlock discriminates, it is not just silent', () => {
  // The control. A guard that refused everything would sail through all three tests above, and this
  // file would be evidence of nothing. Everything here is a real send that must survive.
  const echo = new ClipEcho();

  assert.deepEqual(echo.maySend('one', 'automatic'), { send: true });
  echo.sent('one');

  // Something arrives and is applied. Both guards are now armed against that text.
  echo.arrived('two');
  echo.wroteLocally('two');
  assert.deepEqual(echo.maySend('two', 'automatic'), { send: false, why: 'echo' });

  // The person copies something new. It goes.
  assert.deepEqual(echo.maySend('three', 'automatic'), { send: true });
  echo.sent('three');

  // And an unchanged clipboard on an automatic trigger is refused for the other reason entirely —
  // two refusals with two names, because collapsing them would hide which one is doing the work.
  assert.deepEqual(echo.maySend('three', 'automatic'), { send: false, why: 'unchanged' });
  // The same text on a user trigger goes: a click is an instruction.
  assert.deepEqual(echo.maySend('three', 'user'), { send: true });
});

test('a link drop does not disarm the echo interlock, and that is what stops the reconnect bounce', () => {
  // The bounce this prevents, in full: the Mac applies X to the phone; the link drops; the phone
  // comes back and its focus trigger reads X off its own clipboard; with the interlock cleared it
  // sends X home; a Mac that auto-applies then writes X over whatever the person copied in the
  // meantime. One hop, terminating, and it destroys live work — which is the harm auto-apply is on
  // probation for, arriving by the one route the no-cycle proof does not cover.
  const echo = new ClipEcho();
  echo.arrived('X');
  echo.wroteLocally('X');

  echo.linkDropped();

  assert.deepEqual(echo.maySend('X', 'automatic'), { send: false, why: 'echo' });
  // `lastSent` is gone, though: a reconnect may be a different Mac, and it should get what this
  // phone actually has. The distinction is visible here — the refusal is `echo`, not `unchanged`.
  assert.deepEqual(echo.maySend('Y', 'automatic'), { send: true });
});

/**
 * ### The premise that was removed
 *
 * Everything above was written when the Mac's send was a **button**. The no-cycle argument said, in
 * as many words, that a cycle needs both ends to send automatically on a clipboard change and that
 * the Mac does not — so the honest thing to ask, when a watcher makes it do exactly that, is
 * whether the interlock was carrying the argument or the button was.
 *
 * It was not the button: the adversarial peer in `exchange` already models a far side that pushes
 * back **everything, immediately, forever**, which is a maximally auto-sending peer, and the
 * `user`-trigger case converges through the echo rule alone. What the button *was* hiding is a
 * different failure that is not a cycle at all, and the tests below are about that.
 */

/**
 * A poller over a clipboard that changes at known ticks. Returns what it pushed, per tick.
 *
 * The real watcher reads the pasteboard every interval and asks the interlock. The failure this
 * models is not an echo — it is a **flood**: an unchanged clipboard re-sent on every tick, forever,
 * which is what happens if the watcher classifies itself as a `user` trigger and skips the
 * unchanged rule. A button could never produce it because a person is not a 500 ms timer.
 */
function poll(echo: ClipEcho, clipboardAt: (tick: number) => string, ticks: number): string[] {
  const pushed: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const text = clipboardAt(tick);
    const decision = echo.maySend(text, 'automatic');
    if (decision.send) {
      pushed.push(text);
      echo.sent(text);
    }
  }
  return pushed;
}

test('a watcher over an unchanged clipboard sends once, not once per tick', () => {
  // 120 ticks is a minute at 500 ms. A `user` trigger here pushes 120 times.
  const pushed = poll(new ClipEcho(), () => 'the same thing all minute', 120);
  assert.deepEqual(pushed, ['the same thing all minute']);
});

test('a watcher sends each genuinely new clip exactly once', () => {
  // The control on the test above: a watcher that sent *nothing* would also pass it. Three copies
  // across sixty ticks must produce three pushes, in order, with no repeats.
  const copies = ['first', 'second', 'third'];
  const pushed = poll(new ClipEcho(), (tick) => copies[Math.min(Math.floor(tick / 20), 2)], 60);
  assert.deepEqual(pushed, copies);
});

test('a watcher does not push back what the other side just applied to this one', () => {
  // The echo case as the watcher actually meets it: the entry arrives, this side writes its own
  // clipboard, and the very next tick reads that write. Without the interlock this is the first
  // hop of the loop, and it is the hop the button used to make impossible by being slow.
  const echo = new ClipEcho();
  echo.arrived('from the other side');
  echo.wroteLocally('from the other side');

  assert.deepEqual(poll(echo, () => 'from the other side', 20), []);
});

test('a watcher does not push a Restore back to the phone', () => {
  // Restore writes this Mac's clipboard, so the watcher sees it. It must not travel: Restore is a
  // local undo of something *this* side did, not an instruction to send. `wroteLocally` is what
  // makes the two indistinguishable to the watcher and correctly handled anyway.
  const echo = new ClipEcho();
  echo.arrived('arrived');
  echo.wroteLocally('arrived');
  echo.wroteLocally('the text Restore put back');

  assert.deepEqual(poll(echo, () => 'the text Restore put back', 20), []);
});

test('both ends automatic: the adversary is now the honest model, and it still converges', () => {
  // `exchange` with an `automatic` trigger *is* the new shape — a side that auto-applies and
  // auto-sends, against a peer that does the same. It was already the strongest case in the file;
  // what changed is that it is no longer hypothetical.
  const run = exchange('https://example.com/both-ends-automatic', { autoApply: true, trigger: 'automatic' });

  assert.equal(run.stopped, 'converged', `run ended at ${run.stopped} after ${run.hops} hops`);
  assert.equal(run.reportable, true);
  assert.deepEqual(run.pushes, ['https://example.com/both-ends-automatic']);
  assert.deepEqual(run.refusals, ['echo']);
});
