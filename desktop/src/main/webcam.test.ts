import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcamClaim } from '../shared/webcamWire';
import {
  OTHER_TOKEN,
  SESSION,
  SESSION_2,
  TOKEN,
  deferred,
  goldenAU,
  makeAU,
  rig,
  type Rig,
} from './webcam.testkit';

/**
 * The production `WebcamController`, driven against **stand-ins** for the phone link, the stream socket
 * and the bridge (`webcam.testkit.ts`). Where a test needs the bridge to report Sidekick Camera installed
 * and a producer identity configured, that is **injected** (`rig.ready()`); the real bridge on this Mac
 * reports neither, and `webcamBridge.test.ts` holds the controller to that.
 *
 * Every test has a hard timeout.
 */
const T = { timeout: 5_000 };

/** A consumer arrives, the phone acks, its owner taps, the phone goes running. */
async function toRunning(r: Rig, generation = 7): Promise<void> {
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.controller.onState({ sessionId: SESSION, state: 'running', generation, facing: 'front', width: 1920, height: 1080, frameRate: 30, codec: 'h264' });
}

// ---- nothing is asked for that could not be shown ---------------------------------------------------

test('no bridge helper: nothing is sent and the reason is said', T, async () => {
  const r = rig({ bridgePresent: false });
  assert.equal(r.controller.start().ok, false);
  const asked = await r.controller.askPhone('front');
  assert.equal(asked.ok, false);
  assert.match(asked.reason ?? '', /not built/);
  assert.equal(r.last().bridge, 'absent');
  assert.equal(r.requests().length, 0);
});

test('Sidekick Camera not installed: consumers cannot arrive, Ask phone is refused with a sentence, nothing is sent', T, async () => {
  const r = rig();
  r.ready({ device: false, producer: false });
  const asked = await r.controller.askPhone('front');
  assert.equal(asked.ok, false);
  assert.match(asked.reason ?? '', /not installed on this Mac/);
  assert.equal(r.last().device, 'not-installed');
  assert.equal(r.requests().length, 0);
  assert.equal(r.sockets.length, 0);
});

test('no producer identity in this build: fail closed — no request, automatic or asked', T, async () => {
  const r = rig();
  r.ready({ device: true, producer: false });
  r.consumers(1);
  await r.flush();
  const asked = await r.controller.askPhone('front');
  assert.equal(asked.ok, false);
  assert.match(asked.reason ?? '', /no signing identity/);
  assert.equal(r.last().producer, 'unconfigured');
  assert.equal(r.requests().length, 0);
});

test('a bridge process that has not said ready is not a reason to ask', T, async () => {
  const r = rig();
  r.controller.start();
  r.bridge().report({ op: 'consumers', count: 1 }); // before ready: ignored as a request trigger
  await r.flush();
  assert.equal(r.requests().length, 0);
  assert.equal((await r.controller.askPhone('front')).ok, false);
  assert.equal(r.requests().length, 0);
});

test('no consumers: a ready bridge and an able phone send nothing by themselves', T, async () => {
  const r = rig();
  r.ready();
  await r.flush();
  assert.equal(r.requests().length, 0);
  assert.equal(r.last().blocker, null);
});

test('enumeration alone causes no request and no capture: listing, opening and formats are not consumers', T, async () => {
  const r = rig();
  r.ready();
  // The bridge reports consumers only from started source streams. Repeated zeros — what a meeting app
  // listing or opening the device produces — are not an episode.
  r.consumers(0);
  r.consumers(0);
  await r.flush();
  assert.equal(r.requests().length, 0);
  assert.equal(r.sockets.length, 0);
  assert.equal(r.bridge().aus(), 0);
});

test('an older phone (no capability, or no negotiated ext) gets no webcam.* at all, and the pane says update', T, async () => {
  for (const variant of ['no-capability', 'no-ext'] as const) {
    const r = rig();
    if (variant === 'no-capability') r.phone.capabilities = ['camera'];
    else r.phone.negotiated = {};
    r.ready();
    r.consumers(1);
    await r.flush();
    assert.equal(r.requests().length, 0, variant);
    assert.equal(r.last().phone.kind, 'older-phone', variant);
    assert.match(r.last().blocker ?? '', /needs an update/, variant);
    assert.equal((await r.controller.askPhone()).ok, false, variant);
    assert.equal(r.requests().length, 0, variant);
  }
});

test("the phone listing webcam as unavailable: its reason is shown and nothing is sent", T, async () => {
  const r = rig();
  r.phone.unavailable = { webcam: 'This build of Sidekick does not include the webcam.' };
  r.ready();
  r.consumers(1);
  await r.flush();
  assert.equal(r.requests().length, 0);
  assert.equal(r.last().blocker, 'This build of Sidekick does not include the webcam.');
});

test('no phone connected: a consumer episode sends nothing, and a later reconnect does not ask for it', T, async () => {
  const r = rig();
  r.phone.connected = false;
  r.ready();
  r.consumers(1);
  await r.flush();
  r.phone.connected = true;
  r.controller.onCapabilitiesChanged();
  await r.flush();
  assert.equal(r.requests().length, 0);
});

// ---- the flow ---------------------------------------------------------------------------------------

test('request → approval → frames → Stop: one request, socket only after the tap, AUs only after running, stop first', T, async () => {
  const r = rig();
  r.ready();
  r.consumers(1);
  await r.flush();
  assert.deepEqual(r.requests('webcam.request').map((s) => s.payload), [{ facing: 'front', trigger: 'consumer' }]);
  assert.equal(r.sockets.length, 0, 'the ack is not approval: no socket');
  assert.equal(r.last().session?.phase, 'awaiting-approval');

  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  assert.equal(r.sockets.length, 1);
  assert.equal(r.sockets[0]!.claim, webcamClaim(TOKEN, SESSION));

  // The golden AU outruns `running` on the other connection: held, not forwarded, not dropped.
  const socket = r.sockets[0]!;
  socket.feed(goldenAU());
  assert.equal(r.bridge().aus(), 0, 'nothing reaches the bridge before running');

  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 7, facing: 'front' });
  socket.feed(makeAU({ sequence: 2, keyframe: false }));
  socket.feed(makeAU({ sequence: 3, keyframe: false }));
  const order = r.events.filter((e) => e.startsWith('bridge.'));
  assert.deepEqual(order, ['bridge.session-live 0123 g7', 'bridge.au 0123 seq16909060', 'bridge.au 0123 seq2', 'bridge.au 0123 seq3']);
  assert.equal(r.bridge().calls.filter((c) => c.op === 'au')[0]!.bytes, goldenAU().length, 'forwarded verbatim');

  await r.controller.stop();
  const tail = r.events.slice(r.events.indexOf('link.webcam.stop person'));
  assert.deepEqual(tail, ['link.webcam.stop person', 'socket.destroy', 'bridge.session-ended 0123 stopped-by-mac'], 'stop written first, then the socket, then the bridge');
  socket.feed(makeAU({ sequence: 4, keyframe: true }));
  assert.equal(r.bridge().aus(), 3, 'no frame forwarded after Stop');
  assert.equal(r.last().session, null);
  assert.equal(r.last().lastEnded?.reason, 'stopped-by-mac');
});

test('multiple consumers: no second request; only the last one leaving stops — at once, before any ack', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.consumers(2);
  r.consumers(3);
  r.consumers(1);
  assert.equal(r.requests('webcam.request').length, 1);
  assert.equal(r.last().session?.phase, 'running');
  // The phone's stop ack is held forever: the Mac must not wait for it.
  r.phone.reply = () => new Promise(() => undefined);
  r.consumers(0);
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'no-consumers' });
  assert.equal(r.sockets[0]!.destroyed, true);
  assert.equal(r.last().session, null);
  assert.equal(r.last().lastEnded?.reason, 'no-consumers');
});

test('a no-consumers ending does not spend anything: the next episode asks again', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.consumers(0);
  await r.flush();
  r.consumers(1);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 2);
});

test('the bridge ending a session for no consumers makes main send webcam.stop no-consumers', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.bridge().report({ op: 'session-ended', sessionId: SESSION, reason: 'no-consumers' });
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'no-consumers' });
  assert.equal(r.last().session, null);
});

test('Ask phone with no consumer: allowed, and the session is stopped no-consumers as it goes live', T, async () => {
  const r = rig();
  r.ready();
  assert.equal((await r.controller.askPhone('back')).ok, true);
  assert.deepEqual(r.requests('webcam.request')[0]!.payload, { facing: 'back', trigger: 'person' });
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.sockets[0]!.feed(goldenAU());
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 7 });
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'no-consumers' });
  assert.equal(r.bridge().aus(), 0, 'nothing fed with nobody watching');
  assert.equal(r.bridge().calls.some((c) => c.op === 'session-live'), false);
});

// ---- spent episodes ---------------------------------------------------------------------------------

for (const reason of ['declined', 'expired', 'stopped-on-phone', 'left-screen', 'capture-failed', 'too-hot']) {
  test(`${reason} spends the episode: consumer changes inside it ask nothing more`, T, async () => {
    const r = rig();
    r.ready();
    r.consumers(1);
    await r.flush();
    r.controller.onState({ sessionId: SESSION, state: 'stopped', reason, framesSent: 0, framesDropped: 0 });
    assert.equal(r.last().lastEnded?.reason, reason);
    r.consumers(2);
    r.consumers(1);
    r.controller.onCapabilitiesChanged();
    await r.flush();
    assert.equal(r.requests('webcam.request').length, 1);
    // The person can still ask.
    assert.equal((await r.controller.askPhone()).ok, true);
    assert.equal(r.requests('webcam.request').length, 2);
  });
}

test("expiry with no word from the phone: ended here after expiry + slack, withdrawn, and spent", T, async () => {
  const r = rig();
  r.ready();
  r.consumers(1);
  await r.flush();
  r.tick(30_000);
  assert.equal(r.last().session?.phase, 'awaiting-approval');
  r.tick(5_000);
  assert.equal(r.last().session, null);
  assert.equal(r.last().lastEnded?.reason, 'expired');
  // The Mac gave up waiting: a failure on this side, never worded on the phone as a person's Stop.
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'no-answer' });
  r.consumers(2);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1);
});

test('a refusal (CAMERA_BUSY) spends the episode — no retry loop', T, async () => {
  const r = rig();
  r.phone.reply = async (type) => {
    if (type === 'webcam.request') throw Object.assign(new Error('busy'), { code: 'CAMERA_BUSY', phoneMessage: 'The Camera pane is using it.' });
    return { payload: {} };
  };
  r.ready();
  r.consumers(1);
  await r.flush();
  r.consumers(2);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1);
  assert.equal(r.last().lastEnded?.code, 'CAMERA_BUSY');
});

// ---- cancellation and late acks ---------------------------------------------------------------------

test('Cancel during the ack: nothing opens, and the late ack is withdrawn with the cancel\'s cause', T, async () => {
  const r = rig();
  const ack = deferred<{ payload?: unknown }>();
  r.phone.reply = async (type) => (type === 'webcam.request' ? ack.promise : { payload: { stopped: true } });
  r.ready();
  r.consumers(1);
  await r.flush();
  await r.controller.stop();
  assert.equal(r.last().session, null);
  assert.equal(r.requests('webcam.stop').length, 0, 'no session id to stop yet');
  ack.resolve({ payload: { state: 'awaiting-approval', sessionId: SESSION, expiresInMs: 30_000 } });
  await r.flush();
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'person' });
  // A state for the withdrawn session changes nothing and opens nothing.
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  assert.equal(r.sockets.length, 0);
});

test('Ask phone during a withdrawal waits for it, then sends exactly one request', T, async () => {
  const r = rig();
  const ack = deferred<{ payload?: unknown }>();
  let first = true;
  r.phone.reply = async (type) => {
    if (type === 'webcam.request') {
      if (first) {
        first = false;
        return ack.promise;
      }
      return { payload: { state: 'awaiting-approval', sessionId: SESSION_2, expiresInMs: 30_000 } };
    }
    return { payload: { stopped: true } };
  };
  r.ready();
  r.consumers(1);
  await r.flush();
  await r.controller.stop();
  const asking = r.controller.askPhone();
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1, 'not sent while the old request is still on the phone');
  ack.resolve({ payload: { sessionId: SESSION } });
  assert.equal((await asking).ok, true);
  const types = r.requests().map((s) => `${s.type}${s.payload.cause ? ` ${String(s.payload.cause)}` : ''}`);
  assert.deepEqual(types, ['webcam.request', 'webcam.stop person', 'webcam.request']);
});

test('rapid consumer changes during an ack: one request in flight, withdrawn no-consumers, then one for the newest episode', T, async () => {
  const r = rig();
  const acks: Array<ReturnType<typeof deferred<{ payload?: unknown }>>> = [];
  r.phone.reply = async (type) => {
    if (type === 'webcam.request') {
      const d = deferred<{ payload?: unknown }>();
      acks.push(d);
      return d.promise;
    }
    return { payload: { stopped: true } };
  };
  r.ready();
  r.consumers(1);
  r.consumers(0);
  r.consumers(1);
  r.consumers(0);
  r.consumers(1);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1, 'never two requests on the phone at once');
  acks[0]!.resolve({ payload: { sessionId: SESSION } });
  await r.flush();
  assert.deepEqual(r.requests('webcam.stop').map((s) => s.payload), [{ sessionId: SESSION, cause: 'no-consumers' }]);
  assert.equal(r.requests('webcam.request').length, 2, 'the episode still on gets its one request after the withdrawal');
  acks[1]!.resolve({ payload: { sessionId: SESSION_2 } });
  await r.flush();
  assert.equal(r.last().session?.sessionId, SESSION_2);
  r.consumers(2);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 2);
});

// ---- ownership --------------------------------------------------------------------------------------

test('replacement sessions and stale generations: only the current session, connection and generation count', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r, 3);
  const first = r.sockets[0]!;
  first.feed(makeAU({ generation: 3, sequence: 1 }));
  first.feed(makeAU({ generation: 2, sequence: 2 })); // stale
  assert.equal(r.bridge().aus(), 1);
  // A `running` for an older generation is ignored; a newer one is passed on.
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 2 });
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 4 });
  assert.deepEqual(
    r.bridge().calls.filter((c) => c.op === 'session-live').map((c) => c.generation),
    [3, 4],
  );
  first.feed(makeAU({ generation: 3, sequence: 3 })); // now stale
  assert.equal(r.bridge().aus(), 1);

  // The phone ends it, and the person asks again: a new session, a new socket.
  r.controller.onState({ sessionId: SESSION, state: 'stopped', reason: 'stopped-on-phone' });
  assert.equal((await r.controller.askPhone()).ok, true);
  r.controller.onState({ sessionId: SESSION_2, state: 'starting' });
  r.controller.onState({ sessionId: SESSION_2, state: 'running', generation: 1 });
  // The old session's late bytes, a late `running` for it, and its socket closing change nothing.
  first.feed(makeAU({ generation: 9, sequence: 9 }));
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 9 });
  first.hangUp();
  assert.equal(r.bridge().aus(SESSION_2), 0);
  assert.equal(r.last().session?.sessionId, SESSION_2);
  assert.equal(r.bridge().calls.filter((c) => c.op === 'session-live' && c.sessionId === SESSION).length, 2);
  // An event carrying another connection's token for the live session id is not this session's.
  r.phone.token = OTHER_TOKEN;
  r.controller.onState({ sessionId: SESSION_2, state: 'stopped', reason: 'declined' });
  assert.equal(r.last().session?.sessionId, SESSION_2);
});

test('disconnect and reconnect: ended without a wire stop, consent not reused, no automatic re-request', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  const socket = r.sockets[0]!;
  r.phone.connected = false;
  r.controller.onSessionEnded(TOKEN, false);
  assert.equal(r.last().lastEnded?.reason, 'disconnected');
  assert.equal(r.requests('webcam.stop').length, 0, 'no stop on a connection that is gone');
  assert.equal(socket.destroyed, true);
  assert.ok(r.events.includes('bridge.session-ended 0123 disconnected'));
  socket.feed(makeAU({ sequence: 5 }));
  assert.equal(r.bridge().aus(), 0);

  r.phone.connected = true;
  r.phone.token = OTHER_TOKEN;
  r.controller.onCapabilitiesChanged();
  r.consumers(2);
  await r.flush();
  // The old session's news on the new connection is not this Mac's session any more.
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 7 });
  assert.equal(r.requests('webcam.request').length, 1, 'the episode was spent by the disconnect');
  assert.equal(r.sockets.length, 1);
  assert.equal(r.bridge().calls.filter((c) => c.op === 'session-live').length, 1);
  // The person asks: a new request on the new connection, a new session id — never the old one.
  assert.equal((await r.controller.askPhone()).ok, true);
  assert.equal(r.last().session?.sessionId, SESSION_2);
});

test('a session ended by this Mac\'s own Disconnect says so', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.controller.onSessionEnded(TOKEN, true);
  assert.equal(r.last().lastEnded?.reason, 'disconnected-here');
  r.controller.onSessionEnded(OTHER_TOKEN, false);
  assert.equal(r.last().lastEnded?.reason, 'disconnected-here', 'another connection ending changes nothing');
});

// ---- the Mac's lifecycle ----------------------------------------------------------------------------

for (const event of ['suspend', 'lock-screen', 'user-switch'] as const) {
  test(`${event}: webcam.stop shutdown at once, nothing forwarded after, the episode spent`, T, async () => {
    const r = rig();
    r.ready();
    await toRunning(r);
    await r.controller.lifecycle(event);
    assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'shutdown' });
    r.sockets[0]!.feed(makeAU({ sequence: 9 }));
    assert.equal(r.bridge().aus(), 0);
    r.consumers(2);
    await r.flush();
    assert.equal(r.requests('webcam.request').length, 1);
    assert.equal(r.bridge().stopped, false, 'the device stays published');
  });
}

test('quit and the development switch off stop the session and the bridge', T, async () => {
  for (const event of ['quit', 'dev-switch-off'] as const) {
    const r = rig();
    r.ready();
    await toRunning(r);
    await r.controller.lifecycle(event);
    assert.equal(r.requests('webcam.stop').at(-1)?.payload.cause, 'shutdown', event);
    assert.equal(r.bridge().stopped, true, event);
    assert.equal(r.last().bridge, 'stopped', event);
  }
});

// ---- the bridge failing -----------------------------------------------------------------------------

test('a bridge crash mid-session stops the phone, and a restarted bridge cannot mint an automatic request', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.bridge().crash();
  assert.equal(r.last().bridge, 'failed');
  assert.equal(r.last().lastEnded?.reason, 'bridge-failed');
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'bridge-failed' });
  r.sockets[0]!.feed(makeAU({ sequence: 9 }));
  assert.match(r.last().blocker ?? '', /ended unexpectedly/);
  // Started again; the meeting app never let go, so this is the same episode, already spent.
  r.controller.start();
  r.bridge().report({ op: 'ready', deviceInstalled: true, producerIdentityConfigured: true });
  r.consumers(1);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1);
});

test('the extension refusing the producer ends the session and blocks every later request', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.bridge().report({ op: 'sink', state: 'refused' });
  assert.equal(r.last().lastEnded?.reason, 'producer-refused');
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'producer-refused' });
  assert.equal(r.last().producer, 'refused');
  r.consumers(0);
  r.consumers(1);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1);
  assert.match((await r.controller.askPhone()).reason ?? '', /refused this copy/);
});

test('a malformed stream closes the session — never resynced, never forwarded', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  const bad = makeAU({ sequence: 2 });
  bad.writeUInt8(2, 13); // webcam version 2
  r.sockets[0]!.feed(makeAU({ sequence: 1 }));
  r.sockets[0]!.feed(Buffer.concat([bad, makeAU({ sequence: 3 })]));
  assert.equal(r.bridge().aus(), 1);
  assert.equal(r.last().lastEnded?.reason, 'malformed-stream');
  assert.equal(r.sockets[0]!.destroyed, true);
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-malformed' });
});

// ---- W3 correction: the bridge's verdict on the live session's stream --------------------------------

test("the bridge rejecting the current session's stream ends it: failure stop first, then socket, then bridge", T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.sockets[0]!.feed(makeAU({ sequence: 1 }));
  r.bridge().report({ op: 'stream-rejected', sessionId: SESSION, generation: 7, violation: 'generation-without-keyframe' });
  const tail = r.events.slice(r.events.indexOf('link.webcam.stop failure'));
  assert.deepEqual(tail.slice(0, 3), ['link.webcam.stop failure', 'socket.destroy', 'bridge.session-ended 0123 malformed-stream']);
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-malformed' });
  assert.equal(r.last().session, null);
  assert.equal(r.last().lastEnded?.reason, 'malformed-stream');
  // No retry loop: the episode is spent, so nothing is asked again by itself.
  r.consumers(2);
  await r.flush();
  assert.equal(r.requests('webcam.request').length, 1);
  // And the log names the violation by its token, never a whole id.
  assert.match(r.logs.join('\n'), /generation-without-keyframe/);
  assert.equal(r.logs.join('\n').includes(SESSION), false);
});

test('a stream-rejected naming another or an ended session cannot stop the replacement', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.consumers(0); // session 1 ends no-consumers; the next episode may ask
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION_2, state: 'starting' });
  r.controller.onState({ sessionId: SESSION_2, state: 'running', generation: 1, facing: 'front' });
  assert.equal(r.last().session?.sessionId, SESSION_2);
  const stops = r.requests('webcam.stop').length;
  // A delayed verdict about session 1, and one about a session nobody here knows.
  r.bridge().report({ op: 'stream-rejected', sessionId: SESSION, generation: 7, violation: 'unknown-version' });
  r.bridge().report({ op: 'stream-rejected', sessionId: 'ffffffffffffffffffffffffffffffff', generation: 1, violation: 'unknown-version' });
  assert.equal(r.last().session?.sessionId, SESSION_2, 'the replacement is untouched');
  assert.equal(r.last().session?.phase, 'running');
  assert.equal(r.requests('webcam.stop').length, stops, 'no stop sent for it');
  assert.equal(r.sockets[1]!.destroyed, false);
});

test('a stream-rejected before running (the session never went live on the bridge) still ends that exact session', T, async () => {
  const r = rig();
  r.ready();
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  r.bridge().report({ op: 'stream-rejected', sessionId: SESSION, generation: 0, violation: 'no-start-code' });
  assert.equal(r.last().session, null);
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-malformed' });
});

test('every failure ending names its detail from the closed set; person, no-consumers and shutdown carry none', T, async () => {
  const seen: Array<Record<string, unknown>> = [];
  const endings: Array<[string, (r: Rig) => Promise<void> | void]> = [
    ['person', (r) => r.controller.stop().then(() => undefined)],
    ['no-consumers', (r) => r.consumers(0)],
    ['shutdown', (r) => r.controller.lifecycle('lock-screen')],
    ['bridge-failed', (r) => r.bridge().crash()],
    ['producer-refused', (r) => r.bridge().report({ op: 'sink', state: 'refused' })],
    ['device-unavailable', (r) => r.bridge().report({ op: 'sink', state: 'device-not-installed' })],
    ['stream-malformed', (r) => r.bridge().report({ op: 'stream-rejected', sessionId: SESSION, generation: 7, violation: 'bad-facing' })],
  ];
  for (const [name, act] of endings) {
    const r = rig();
    r.ready();
    await toRunning(r);
    await act(r);
    const payload = r.requests('webcam.stop').at(-1)?.payload;
    assert.ok(payload, `${name}: a stop was written`);
    seen.push(payload);
    if (payload.cause === 'failure') assert.equal(payload.detail, name, name);
    else assert.deepEqual(Object.keys(payload).sort(), ['cause', 'sessionId'], `${name}: no detail`);
  }
  assert.deepEqual(seen.map((p) => p.cause), ['person', 'no-consumers', 'shutdown', 'failure', 'failure', 'failure', 'failure']);
});

test('a stream socket that cannot open ends the session as a Mac failure, not a Stop', T, async () => {
  const r = rig({ openSocketThrows: true });
  r.ready();
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  assert.equal(r.last().session, null);
  assert.deepEqual(r.requests('webcam.stop').at(-1)?.payload, { sessionId: SESSION, cause: 'failure', detail: 'stream-unavailable' });
});

test("the phone's own account of a Mac failure is accepted as a wire reason", T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.controller.onState({ sessionId: SESSION, state: 'stopped', reason: 'mac-failed', framesSent: 4, framesDropped: 0 });
  assert.equal(r.last().lastEnded?.reason, 'mac-failed');
  assert.equal(r.last().lastEnded?.framesSent, 4);
});

test('AUs held before running are bounded at 4 with the keyframe rule', T, async () => {
  const r = rig();
  r.ready();
  r.consumers(1);
  await r.flush();
  r.controller.onState({ sessionId: SESSION, state: 'starting' });
  const s = r.sockets[0]!;
  s.feed(makeAU({ sequence: 1, keyframe: true }));
  for (let i = 2; i <= 9; i++) s.feed(makeAU({ sequence: i, keyframe: false }));
  s.feed(makeAU({ sequence: 10, keyframe: true }));
  s.feed(makeAU({ sequence: 11, keyframe: false }));
  r.controller.onState({ sessionId: SESSION, state: 'running', generation: 7 });
  const seqs = r.events.filter((e) => e.startsWith('bridge.au')).map((e) => e.split('seq')[1]);
  assert.deepEqual(seqs, ['10', '11'], 'the newest keyframe and what follows it; never more than 4 held');
});

// ---- the log ----------------------------------------------------------------------------------------

test('the log names sessions by an 8-character prefix and never carries a token, a whole session id or frame bytes', T, async () => {
  const r = rig();
  r.ready();
  await toRunning(r);
  r.sockets[0]!.feed(goldenAU());
  await r.controller.stop();
  const all = r.logs.join('\n');
  assert.ok(r.logs.length >= 4, 'there is a log to read');
  assert.ok(all.includes(SESSION.slice(0, 8)), 'positive control: the prefix is there');
  assert.equal(all.includes(TOKEN), false);
  assert.equal(all.includes(SESSION), false);
  assert.equal(all.includes(goldenAU().subarray(29).toString('hex')), false);
  assert.equal(all.includes('6742001f'), false);
  assert.match(all, /1 AUs received here, 1 forwarded to the bridge/);
});
