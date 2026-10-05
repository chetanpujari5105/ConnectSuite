import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, SESSION_2, deferred, makeAU, rig, type Rig } from './webcam.testkit';

/**
 * `webcam.keyframe` through the production `WebcamController` (docs/protocol.md → `webcam.keyframe`,
 * version 2), driven against the test kit's **stand-ins** for the phone link, the stream socket and the
 * bridge. The bridge's `chain-broken` / `chain-recovered` here are injected reports; the real bridge's are
 * held by the Swift `ChainSignalTests`. Sidekick Camera installed and a producer identity configured are
 * **injected** (`rig.ready()`), as everywhere in these tests.
 */
const T = { timeout: 5_000 };

function v2(r: Rig): void {
  r.phone.negotiated = { webcam: 2 };
  const base = r.phone.reply;
  r.phone.reply = async (type, payload) =>
    type === 'webcam.keyframe' ? { payload: { result: 'accepted', generation: payload.generation } } : base(type, payload);
}

async function toRunning(r: Rig, generation = 7): Promise<void> {
  r.ready();
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.controller.onState({ sessionId: SESSION, state: 'running', generation, facing: 'front', width: 1920, height: 1080 });
}

const broken = (sessionId = SESSION, generation = 7) =>
  ({ op: 'chain-broken', sessionId, generation, cause: 'queue-full' }) as const;

test('version 2: a broken chain asks the phone once, for exactly this session and generation', T, async () => {
  const r = rig();
  v2(r);
  await toRunning(r);
  assert.equal(r.requests('webcam.keyframe').length, 0, 'nothing is asked before a break');
  r.bridge().report(broken());
  await r.flush();
  assert.deepEqual(r.requests('webcam.keyframe').map((q) => q.payload), [{ sessionId: SESSION, generation: 7 }]);
  // An IDR of this generation reaches main, then the bridge recovers: the three readings, apart.
  r.sockets[0]!.feed(makeAU({ generation: 7, keyframe: true }));
  r.bridge().report({ op: 'chain-recovered', sessionId: SESSION, generation: 7 });
  const c = r.controller.recoveryCounts();
  assert.deepEqual([c.requested, c.accepted, c.idrReceived, c.recoveredAfterRequest], [1, 1, 1, 1]);
});

test('version 1 negotiated (an older phone or Mac): nothing is sent, recovery waits for the periodic IDR', T, async () => {
  const r = rig();
  r.phone.negotiated = { webcam: 1 };
  await toRunning(r);
  r.bridge().report(broken());
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 0);
  assert.equal(r.controller.recoveryCounts().unsupported, 1);
});

test('a break reported for another session, or before running, asks nothing', T, async () => {
  const r = rig();
  v2(r);
  r.ready();
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.bridge().report(broken()); // starting: the owner tapped, the bridge has not been told live
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 7 });
  r.bridge().report(broken(SESSION_2));
  r.bridge().report(broken(SESSION, 6));
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 0);
  assert.ok(r.logs.some((l) => l.includes('not the running session; ignored')));
});

test('a replaced bridge’s late report changes nothing for the session after it', T, async () => {
  const r = rig();
  v2(r);
  await toRunning(r);
  const old = r.bridge();
  old.crash(); // the session ends bridge-failed; the episode is spent
  r.controller.start();
  r.bridge().report({ op: 'ready', deviceInstalled: true, producerIdentityConfigured: true });
  r.bridge().report({ op: 'consumers', count: 1 });
  await r.controller.askPhone('front');
  r.controller.onState({ sessionId: SESSION_2, state: 'starting' });
  r.controller.onState({ sessionId: SESSION_2, state: 'running', generation: 1 });
  old.report(broken(SESSION_2, 1));
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 0, 'the old bridge is not this session’s');
  r.bridge().report(broken(SESSION_2, 1));
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 1);
});

test('a Stop while a request is pending: nothing after it, and its late answer changes nothing', T, async () => {
  const r = rig();
  v2(r);
  const held = deferred<{ payload?: unknown }>();
  const base = r.phone.reply;
  r.phone.reply = (type, payload) => (type === 'webcam.keyframe' ? held.promise : base(type, payload));
  await toRunning(r);
  r.bridge().report(broken());
  await r.controller.stop();
  held.resolve({ payload: { result: 'accepted', generation: 7 } });
  await r.flush();
  r.bridge().report(broken());
  r.tick(10_000);
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 1);
  assert.equal(r.requests('webcam.request').length, 1, 'nothing restarts');
  const c = r.controller.recoveryCounts();
  assert.deepEqual([c.abandoned, c.lateAnswers], [1, 1]);
});

test('a switch while a request is pending abandons it; the new generation starts with its own IDR', T, async () => {
  const r = rig();
  v2(r);
  const held = deferred<{ payload?: unknown }>();
  const base = r.phone.reply;
  r.phone.reply = (type, payload) => (type === 'webcam.keyframe' ? held.promise : base(type, payload));
  await toRunning(r);
  r.bridge().report(broken());
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 8 });
  held.resolve({ payload: { result: 'accepted', generation: 7 } });
  await r.flush();
  r.bridge().report(broken(SESSION, 7));
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 1, 'generation 7’s break is history');
  assert.equal(r.controller.recoveryCounts().abandoned, 1);
});

test('the phone refusing or ignoring is counted, and the end-of-session line carries every counter', T, async () => {
  const r = rig();
  r.phone.negotiated = { webcam: 2 };
  const base = r.phone.reply;
  r.phone.reply = async (type, payload) => {
    if (type === 'webcam.keyframe') throw Object.assign(new Error('That webcam session belongs to a different connection.'), { code: 'UNAUTHORIZED' });
    return base(type, payload);
  };
  await toRunning(r);
  r.bridge().report(broken());
  await r.flush();
  await r.controller.stop();
  assert.equal(r.controller.recoveryCounts().refused, 1);
  assert.ok(r.logs.some((l) => /keyframe recovery since launch: 1 breaks, 1 requested \(0 accepted, 0 ignored, 1 refused, 0 lost\)/.test(l)), r.logs.join('\n'));
});

test('no request is ever sent without a consented, running session', T, async () => {
  const r = rig();
  v2(r);
  r.ready();
  r.bridge().report(broken());
  r.consumers(1);
  await r.flush();
  r.bridge().report(broken()); // awaiting approval: the phone's owner has not tapped
  await r.flush();
  assert.equal(r.requests('webcam.keyframe').length, 0);
});
