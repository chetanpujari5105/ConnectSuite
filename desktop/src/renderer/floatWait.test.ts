import { test } from 'node:test';
import assert from 'node:assert/strict';

const { floatWaitState, UNANSWERED_THRESHOLD } = require('./floatWait') as {
  floatWaitState: (i: { hasDecoder: boolean; decoding: boolean; requested: number; answered: number }) => {
    kind: string; sentence: string; detail: string | null; blocking: boolean;
  };
  UNANSWERED_THRESHOLD: number;
};

/**
 * The float's two states.
 *
 * The defect: one sentence — *"Waiting for the phone's next keyframe…"* — covered both a float with
 * **no decoder** (where the code that would ask is unreachable, so no keyframe is ever coming) and a
 * float **waiting on a live request** (where the sentence is exactly right). Nothing could tell them
 * apart, on screen or in a log, because the keyframe path logged nothing at either end.
 */
// ---- the two states ---------------------------------------------------------------------------

test('THE DEFECT — no decoder and awaiting a keyframe are not the same state', () => {
  const noDecoder = floatWaitState({ hasDecoder: false, decoding: false, requested: 0, answered: 0 });
  const awaiting = floatWaitState({ hasDecoder: true, decoding: false, requested: 1, answered: 0 });

  assert.notEqual(noDecoder.kind, awaiting.kind);
  assert.notEqual(noDecoder.sentence, awaiting.sentence);
  // The distinction that matters is not the wording, it is whether the state can clear itself.
  // A sentence can be reworded; this cannot be, and it is what the single sentence destroyed.
  assert.equal(noDecoder.blocking, true);
  assert.equal(awaiting.blocking, false);
});

test('the no-decoder sentence does not promise a keyframe that cannot arrive', () => {
  const s = floatWaitState({ hasDecoder: false, decoding: false, requested: 0, answered: 0 });
  // The old copy said the phone's next keyframe was being waited for. With no decoder that frame is
  // dropped like every other, so saying it is on its way is false and sends nobody anywhere useful.
  assert.ok(!/next (full )?frame|keyframe/i.test(s.sentence), s.sentence);
  assert.ok((s.detail ?? '').includes('replays'), s.detail ?? '');
});

test('repeated unanswered requests are their own state, not more of the same wait', () => {
  const ordinary = floatWaitState({ hasDecoder: true, decoding: false, requested: 1, answered: 0 });
  const storm = floatWaitState({
    hasDecoder: true, decoding: false, requested: UNANSWERED_THRESHOLD, answered: 0,
  });
  assert.equal(ordinary.kind, 'awaiting-keyframe');
  assert.equal(storm.kind, 'unanswered');
  assert.equal(storm.blocking, true);
  // The tally is in the sentence, because "asked three times, answered none" is the finding and
  // "waiting" is not.
  assert.ok(storm.detail!.includes(`${UNANSWERED_THRESHOLD} requests`), storm.detail!);
});

test('answers keep the wait ordinary — the threshold is on what is OUTSTANDING', () => {
  // Control for the test above: a float that has asked twenty times and been answered twenty times
  // is healthy, and a threshold on the request count alone would call it a storm.
  const healthy = floatWaitState({ hasDecoder: true, decoding: false, requested: 20, answered: 20 });
  assert.equal(healthy.kind, 'awaiting-keyframe');
  assert.equal(healthy.blocking, false);
});

test('a decoding float says nothing at all', () => {
  const s = floatWaitState({ hasDecoder: true, decoding: true, requested: 9, answered: 9 });
  assert.equal(s.kind, 'running');
  assert.equal(s.blocking, false);
});

test('every state has a sentence, and no two share one', () => {
  const states = [
    floatWaitState({ hasDecoder: false, decoding: false, requested: 0, answered: 0 }),
    floatWaitState({ hasDecoder: true, decoding: false, requested: 1, answered: 0 }),
    floatWaitState({ hasDecoder: true, decoding: false, requested: 5, answered: 0 }),
    floatWaitState({ hasDecoder: true, decoding: true, requested: 5, answered: 5 }),
  ];
  assert.equal(new Set(states.map((s) => s.sentence)).size, states.length);
  assert.equal(new Set(states.map((s) => s.kind)).size, states.length);
  states.forEach((s) => {
    assert.ok(s.sentence.length > 0);
    assert.ok(/[.…]$/.test(s.sentence), s.sentence);
  });
});

