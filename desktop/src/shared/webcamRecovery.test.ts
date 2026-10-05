import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KEYFRAME_ACK_TIMEOUT_MS,
  KEYFRAME_IDR_WAIT_MS,
  KEYFRAME_IGNORED_REASONS,
  KEYFRAME_MIN_INTERVAL_MS,
  KeyframeRecovery,
  keyframeSender,
  readKeyframeAck,
  type KeyframeAnswer,
} from './webcamRecovery';

/**
 * The `webcam.keyframe` policy (docs/protocol.md → `webcam.keyframe`, version 2) on a manual clock. The
 * phone is a scripted answer per request — a **stand-in**: nothing here touches a link, an encoder or a
 * codec. What reaches the phone, and what the bridge reports, is held by `webcamKeyframe.test.ts` and the
 * Swift `ChainSignalTests`.
 */
const T = { timeout: 5_000 };
const S = '0123456789abcdef0123456789abcdef';
const S2 = 'fedcba9876543210fedcba9876543210';

interface Harness {
  r: KeyframeRecovery;
  sent: Array<{ sessionId: string; generation: number; answer: (a: KeyframeAnswer) => void }>;
  logs: string[];
  tick(ms: number): void;
  flush(): Promise<void>;
  supported: { v: boolean };
}

function harness(): Harness {
  let now = 50_000;
  const timeouts: Array<{ fn: () => void; at: number; cleared: boolean }> = [];
  const sent: Harness['sent'] = [];
  const logs: string[] = [];
  const supported = { v: true };
  const r = new KeyframeRecovery({
    timers: {
      now: () => now,
      setTimeout: (fn, ms) => {
        const e = { fn, at: now + ms, cleared: false };
        timeouts.push(e);
        return e;
      },
      clearTimeout: (h) => {
        if (h) (h as { cleared: boolean }).cleared = true;
      },
    },
    supported: () => supported.v,
    send: (sessionId, generation) => new Promise<KeyframeAnswer>((answer) => sent.push({ sessionId, generation, answer })),
    log: { info: (m) => logs.push(`I ${m}`), warn: (m) => logs.push(`W ${m}`) },
  });
  return {
    r,
    sent,
    logs,
    supported,
    tick: (ms) => {
      now += ms;
      for (const t of [...timeouts]) {
        if (!t.cleared && t.at <= now) {
          t.cleared = true;
          t.fn();
        }
      }
    },
    flush: async () => {
      for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

test('an overflow’s break asks once, and request → IDR → recovered are three readings', T, async () => {
  const h = harness();
  h.r.setLive(S, 3);
  h.r.chainBroken(S, 3, 'queue-full');
  assert.equal(h.sent.length, 1);
  assert.deepEqual([h.sent[0]!.sessionId, h.sent[0]!.generation], [S, 3]);
  h.tick(40);
  h.sent[0]!.answer({ kind: 'accepted', generation: 3 });
  await h.flush();
  assert.equal(h.r.counts().idrReceived, 0, 'an accepted ack is not an IDR');
  h.tick(60);
  h.r.idrReceived(S, 3);
  h.tick(15);
  h.r.chainRecovered(S, 3);
  const c = h.r.counts();
  assert.deepEqual(
    [c.breaks, c.requested, c.accepted, c.idrReceived, c.recoveries, c.recoveredAfterRequest, c.requestToIdrLastMs, c.requestToRecoveredLastMs],
    [1, 1, 1, 1, 1, 1, 100, 115],
  );
});

test('a decode failure’s break asks the same way', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'decode-failed');
  assert.equal(h.sent.length, 1);
  assert.ok(h.logs.some((l) => l.includes('webcam.keyframe sent')));
});

test('repeats while a request is outstanding are coalesced into it', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.chainBroken(S, 1, 'decode-failed');
  h.r.chainBroken(S, 1, 'compose-failed');
  assert.equal(h.sent.length, 1);
  assert.equal(h.r.counts().coalesced, 2);
});

test('at most one request per second: a break inside the second is ONE deferred request', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.sent[0]!.answer({ kind: 'ignored', reason: 'not-running', generation: 1 });
  await h.flush();
  h.tick(200);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.chainBroken(S, 1, 'queue-full');
  assert.equal(h.sent.length, 1, 'nothing sent inside the second');
  assert.deepEqual([h.r.counts().deferred, h.r.counts().coalesced], [1, 1]);
  h.tick(KEYFRAME_MIN_INTERVAL_MS - 200 - 1);
  assert.equal(h.sent.length, 1);
  h.tick(1);
  assert.equal(h.sent.length, 2, 'sent exactly when the second has passed');
});

test('a deferred request is dropped if the picture recovers first', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.sent[0]!.answer({ kind: 'refused', code: 'NOT_FOUND' });
  await h.flush();
  h.tick(100);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.chainRecovered(S, 1);
  h.tick(KEYFRAME_MIN_INTERVAL_MS);
  assert.equal(h.sent.length, 1);
  assert.equal(h.r.counts().deferredDropped, 1);
});

test('refused, ignored and lost each end the request — and nothing retries it', T, async () => {
  for (const answer of [
    { kind: 'refused', code: 'UNAUTHORIZED' },
    { kind: 'ignored', reason: 'stale-generation', generation: 2 },
    { kind: 'lost', why: 'webcam.keyframe timed out after 2000 ms' },
  ] as KeyframeAnswer[]) {
    const h = harness();
    h.r.setLive(S, 1);
    h.r.chainBroken(S, 1, 'queue-full');
    h.sent[0]!.answer(answer);
    await h.flush();
    h.tick(10 * KEYFRAME_IDR_WAIT_MS);
    assert.equal(h.sent.length, 1, `${answer.kind}: no retry`);
    const c = h.r.counts();
    assert.equal(c.refused + c.ignored + c.timedOut, 1, answer.kind);
    // The break is still open, and the next break for it may ask again (after the second).
    h.r.chainBroken(S, 1, 'queue-full');
    assert.equal(h.sent.length, 2, `${answer.kind}: a NEW break asks again`);
  }
});

test('accepted but no IDR within the bound: the wait expires, counted, and nothing retries', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.sent[0]!.answer({ kind: 'accepted', generation: 1 });
  await h.flush();
  h.tick(KEYFRAME_IDR_WAIT_MS - 1);
  assert.equal(h.r.counts().idrTimeouts, 0);
  h.tick(1);
  assert.equal(h.r.counts().idrTimeouts, 1);
  h.tick(10_000);
  assert.equal(h.sent.length, 1);
  h.r.idrReceived(S, 1);
  assert.equal(h.r.counts().idrReceived, 0, 'an IDR after the wait is not credited to the request');
});

test('a periodic IDR recovering an unasked break is a recovery without a request', T, async () => {
  const h = harness();
  h.supported.v = false;
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  assert.equal(h.sent.length, 0, 'version 1 peer: nothing sent');
  h.r.chainRecovered(S, 1);
  const c = h.r.counts();
  assert.deepEqual([c.unsupported, c.recoveries, c.recoveredWithoutRequest, c.recoveredAfterRequest], [1, 1, 1, 0]);
});

test('a break for another session or another generation asks nothing', T, async () => {
  const h = harness();
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.setLive(S, 2);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.chainBroken(S, 3, 'queue-full');
  h.r.chainBroken(S2, 2, 'queue-full');
  assert.equal(h.sent.length, 0);
  assert.equal(h.r.counts().stale, 4);
});

test('a switch or reconfiguration while a request is pending abandons it; its late answer changes nothing', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.setLive(S, 2);
  h.sent[0]!.answer({ kind: 'accepted', generation: 1 });
  await h.flush();
  h.tick(KEYFRAME_IDR_WAIT_MS * 2);
  const c = h.r.counts();
  assert.deepEqual([c.abandoned, c.lateAnswers, c.accepted, c.idrTimeouts], [1, 1, 1, 0]);
  h.r.idrReceived(S, 1);
  assert.equal(h.r.counts().idrReceived, 0);
});

test('a Stop while a request or a deferral is pending ends both, and nothing is sent after', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.sent[0]!.answer({ kind: 'ignored', reason: 'rate-limited', generation: 1 });
  await h.flush();
  h.r.chainBroken(S, 1, 'queue-full'); // deferred
  h.r.setLive(null);
  h.tick(KEYFRAME_MIN_INTERVAL_MS * 3);
  assert.equal(h.sent.length, 1, 'no request after the Stop');
  assert.equal(h.r.counts().deferredDropped, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.chainRecovered(S, 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.r.counts().recoveries, 0, 'an ended session recovers nothing');
});

test('a new session starts with no rate-limit debt from the old one', T, async () => {
  const h = harness();
  h.r.setLive(S, 1);
  h.r.chainBroken(S, 1, 'queue-full');
  h.r.setLive(S2, 1);
  h.r.chainBroken(S2, 1, 'queue-full');
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1]!.sessionId, S2);
});

test('the ack is read strictly: anything outside the contract is lost, never a guessed accept', T, () => {
  assert.deepEqual(readKeyframeAck({ result: 'accepted', generation: 4 }), { kind: 'accepted', generation: 4 });
  assert.equal(readKeyframeAck({ result: 'accepted' }).kind, 'lost');
  assert.equal(readKeyframeAck({ result: 'accepted', generation: 0 }).kind, 'lost');
  assert.equal(readKeyframeAck({}).kind, 'lost');
  assert.equal(readKeyframeAck(undefined).kind, 'lost');
  assert.equal(readKeyframeAck({ stopped: true }).kind, 'lost');
  assert.deepEqual(readKeyframeAck({ result: 'ignored', reason: 'rate-limited', generation: 2 }), { kind: 'ignored', reason: 'rate-limited', generation: 2 });
  assert.deepEqual(readKeyframeAck({ result: 'ignored', reason: 'sunspots' }), { kind: 'ignored', reason: 'unrecognised', generation: null });
});

test('the sender turns an error with a code into refused, anything else into lost — and sends the contract’s payload', T, async () => {
  const calls: Array<{ type: string; payload: Record<string, unknown>; ms: number }> = [];
  const refusing = keyframeSender(async (type, payload, ms) => {
    calls.push({ type, payload, ms });
    throw Object.assign(new Error('no such session'), { code: 'NOT_FOUND' });
  }, 'webcam.keyframe');
  assert.deepEqual(await refusing(S, 5), { kind: 'refused', code: 'NOT_FOUND' });
  assert.deepEqual(calls[0], { type: 'webcam.keyframe', payload: { sessionId: S, generation: 5 }, ms: KEYFRAME_ACK_TIMEOUT_MS });
  const timingOut = keyframeSender(async () => {
    throw new Error('webcam.keyframe timed out');
  }, 'webcam.keyframe');
  assert.equal((await timingOut(S, 5)).kind, 'lost');
});

test('the ignored reasons are the vocabulary fixture’s, in order', T, () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../../../docs/fixtures/webcam-vocabulary-v1.json'), 'utf8'));
  assert.deepEqual([...KEYFRAME_IGNORED_REASONS], fixture.keyframeIgnoredReasons);
});
