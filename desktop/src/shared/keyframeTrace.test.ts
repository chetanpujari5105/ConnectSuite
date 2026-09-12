import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyframeTrace } from './keyframeTrace';

/**
 * Request, ack and IDR are three counts, not one.
 *
 * Before this existed there was **no evidence in this repo that a single `mirror.keyframe` had ever
 * produced an IDR** — the request was one line ending in `.catch(() => undefined)`. A count with no
 * denominator is not evidence; a path with neither number is not even a count.
 */
// ---- the counting -------------------------------------------------------------------------------

test('a request, its ack and the IDR are three separate counts', () => {
  // The whole point. "12 requested / 12 acked / 0 answered" is the sentence that would have ended
  // the float investigation on day one, and it is unsayable if an ack is counted as an answer.
  let t = 1000;
  const trace = new KeyframeTrace(() => t);
  trace.onRequest('float opened mid-stream');
  trace.onAck();
  assert.deepEqual(trace.snapshot(), { requested: 1, acked: 1, answered: 0, awaiting: true });
  assert.ok(trace.tally().includes('1 requested / 1 acked / 0 answered'), trace.tally());
});

test('an ack is reported as not being a frame', () => {
  const trace = new KeyframeTrace(() => 0);
  trace.onRequest('x');
  assert.ok(trace.onAck().includes('an ack is not a frame'));
});

test('the IDR that answers a request is timed from the request', () => {
  let t = 5_000;
  const trace = new KeyframeTrace(() => t);
  trace.onRequest('mid-stream start');
  t = 5_240;
  const line = trace.onKeyframe();
  assert.ok(line!.includes('ARRIVED after 240 ms'), line!);
  assert.deepEqual(trace.snapshot(), { requested: 1, acked: 0, answered: 1, awaiting: false });
});

test('an unrequested keyframe is not counted as an answer', () => {
  // An idle stream emits periodic IDRs. Counting those would make the answered figure meaningless
  // and would say a request worked when nothing was asked — the decoration rule, in a counter.
  const trace = new KeyframeTrace(() => 0);
  assert.equal(trace.onKeyframe(), null);
  assert.equal(trace.snapshot().answered, 0);
});

test('a second keyframe does not answer the same request twice', () => {
  const trace = new KeyframeTrace(() => 0);
  trace.onRequest('x');
  assert.notEqual(trace.onKeyframe(), null);
  assert.equal(trace.onKeyframe(), null);
  assert.equal(trace.snapshot().answered, 1);
});

test('a failure carries the tally, so the ratio survives a run of failures', () => {
  const trace = new KeyframeTrace(() => 0);
  trace.onRequest('x');
  const line = trace.onRequestFailed('timed out after 5000ms');
  assert.ok(line.includes('timed out after 5000ms'));
  assert.ok(line.includes('1 requested'), line);
});
