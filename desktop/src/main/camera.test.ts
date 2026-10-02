import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAMERA_STALL_MS,
  CameraController,
  type CameraFrameMessage,
  type CameraPaneState,
  type CameraSocket,
} from './camera';

/**
 * The Mac's camera controller, driven for real against a fake link, a fake socket and a fake clock.
 * Every assertion is about the production controller's behaviour; nothing here restates its rules.
 */

const TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);
const STREAM = '0123456789abcdef0123456789abcdef';
const OTHER_STREAM = 'fedcba9876543210fedcba9876543210';

function goldenFrame(sequence: number): Buffer {
  const text = readFileSync(join(__dirname, '../../../docs/fixtures/camera-frame-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
  const bytes = Buffer.from(text, 'hex');
  bytes.writeUInt32BE(sequence, 13 + 10);
  return bytes;
}

/** The golden frame from the named camera: the facing byte is the camera header's third. */
function frameFrom(sequence: number, facing: 'back' | 'front'): Buffer {
  const bytes = goldenFrame(sequence);
  bytes[13 + 2] = facing === 'front' ? 1 : 0;
  return bytes;
}

class FakeSocket implements CameraSocket {
  data: Array<(chunk: Buffer) => void> = [];
  closers: Array<(reason: string) => void> = [];
  destroyed = false;
  onData(listener: (chunk: Buffer) => void): void {
    this.data.push(listener);
  }
  onClose(listener: (reason: string) => void): void {
    this.closers.push(listener);
  }
  destroy(): void {
    this.destroyed = true;
  }
  feed(chunk: Buffer): void {
    for (const l of this.data) l(chunk);
  }
  hangUp(): void {
    for (const l of this.closers) l('closed by the phone');
  }
}

interface Harness {
  controller: CameraController;
  sent: Array<{ type: string; payload: Record<string, unknown> }>;
  sockets: Array<{ host: string; claim: string; socket: FakeSocket }>;
  states: CameraPaneState[];
  frames: CameraFrameMessage[];
  /** Every lifecycle line the production controller wrote, as `I …` / `W …`. */
  logs: string[];
  link: { connected: boolean; token: string | null };
  clock: { now: number; intervals: Array<() => void>; timeouts: Array<{ fn: () => void; at: number }> };
  reply: (type: string, payload: Record<string, unknown>) => Promise<{ payload?: unknown }>;
  tick: (ms: number) => void;
  last: () => CameraPaneState;
}

function harness(): Harness {
  const h = {
    sent: [],
    sockets: [],
    states: [],
    frames: [],
    logs: [],
    link: { connected: true, token: TOKEN as string | null },
    clock: { now: 1_000_000, intervals: [], timeouts: [] },
    reply: async (type: string) =>
      type === 'camera.request'
        ? { payload: { state: 'awaiting-approval', streamId: STREAM, facing: 'back', expiresInMs: 30_000, message: 'On your phone.' } }
        : type === 'camera.stop'
          ? { payload: { stopped: true } }
          : { payload: {} },
  } as unknown as Harness;
  h.controller = new CameraController({
    link: {
      isConnected: () => h.link.connected,
      token: () => h.link.token,
      address: () => '10.0.0.2',
      request: (type, payload) => {
        h.sent.push({ type, payload });
        return h.reply(type, payload);
      },
    },
    openSocket: (host, claim) => {
      const socket = new FakeSocket();
      h.sockets.push({ host, claim, socket });
      return socket;
    },
    emitState: (state) => h.states.push(state),
    emitFrame: (frame) => h.frames.push(frame),
    log: { info: (m) => h.logs.push(`I ${m}`), warn: (m) => h.logs.push(`W ${m}`) },
    timers: {
      now: () => h.clock.now,
      setInterval: (fn) => h.clock.intervals.push(fn),
      clearInterval: () => {
        h.clock.intervals = [];
      },
      setTimeout: (fn, ms) => {
        const entry = { fn, at: h.clock.now + ms };
        h.clock.timeouts.push(entry);
        return entry;
      },
      clearTimeout: (entry) => {
        h.clock.timeouts = h.clock.timeouts.filter((t) => t !== entry);
      },
    },
  });
  h.tick = (ms) => {
    h.clock.now += ms;
    for (const fn of [...h.clock.intervals]) fn();
    for (const t of [...h.clock.timeouts]) {
      if (t.at <= h.clock.now) {
        h.clock.timeouts = h.clock.timeouts.filter((x) => x !== t);
        t.fn();
      }
    }
  };
  h.last = () => h.states[h.states.length - 1] ?? h.controller.current();
  return h;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function toStarting(h: Harness): Promise<FakeSocket> {
  await h.controller.request('back');
  h.controller.onState({ state: 'starting', streamId: STREAM, facing: 'back' });
  return h.sockets[0]!.socket;
}

async function toLive(h: Harness): Promise<FakeSocket> {
  const socket = await toStarting(h);
  socket.feed(goldenFrame(1));
  assert.equal(h.last().kind, 'live');
  return socket;
}

// ---- consent and the socket ---------------------------------------------------------------------

test('a request opens no socket — only the phone saying `starting` does', async () => {
  const h = harness();
  await h.controller.request('back');
  assert.equal(h.last().kind, 'requesting');
  assert.equal(h.sockets.length, 0, 'a socket opened before the phone allowed anything');
  assert.deepEqual(h.sent, [{ type: 'camera.request', payload: { facing: 'back' } }]);

  h.controller.onState({ state: 'starting', streamId: STREAM, facing: 'back' });
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0]!.claim, `${TOKEN} camera ${STREAM}`);
  assert.equal(h.last().kind, 'connecting');
});

test('the requesting state carries the stream id and the expiry the phone gave', async () => {
  const h = harness();
  await h.controller.request('front');
  const state = h.last();
  assert.equal(state.kind, 'requesting');
  if (state.kind !== 'requesting') return;
  assert.equal(state.streamId, STREAM);
  assert.equal(state.facing, 'front');
  assert.equal(state.expiresAtMs, h.clock.now + 30_000);
});

test('a refusal is drawn with the phone’s code and words, and opens nothing', async () => {
  const h = harness();
  h.reply = async () => {
    const error = Object.assign(new Error('CAMERA_BUSY: The phone is mirroring its screen'), {
      code: 'CAMERA_BUSY',
      phoneMessage: 'The phone is mirroring its screen, so the camera is not offered.',
      fixHint: 'Stop mirroring first.',
    });
    throw error;
  };
  const result = await h.controller.request('back');
  assert.equal(result.ok, false);
  assert.deepEqual(h.last(), {
    kind: 'refused',
    code: 'CAMERA_BUSY',
    message: 'The phone is mirroring its screen, so the camera is not offered.',
    fixHint: 'Stop mirroring first.',
  });
  assert.equal(h.sockets.length, 0);
});

test('a second request while one is open is refused on this side and sends nothing', async () => {
  const h = harness();
  await h.controller.request('back');
  const result = await h.controller.request('front');
  assert.equal(result.ok, false);
  assert.equal(h.sent.filter((s) => s.type === 'camera.request').length, 1);
});

test('a malformed facing or no connection sends nothing', async () => {
  const h = harness();
  assert.equal((await h.controller.request('sideways')).ok, false);
  h.link.connected = false;
  assert.equal((await h.controller.request('back')).ok, false);
  assert.deepEqual(h.sent, []);
});

// ---- frames, stalls and the renderer ------------------------------------------------------------

test('frames reach the renderer one at a time; a slow page gets the newest, never a backlog', async () => {
  const h = harness();
  const socket = await toLive(h);
  assert.equal(h.frames.length, 1);
  for (let s = 2; s <= 6; s++) socket.feed(goldenFrame(s));
  assert.equal(h.frames.length, 1, 'frames were sent while the renderer still held one');
  h.controller.frameAck();
  assert.deepEqual(h.frames.map((f) => f.sequence), [1, 6]);
  h.controller.frameAck();
  assert.equal(h.frames.length, 2, 'nothing was left waiting');
});

test('two seconds without a frame hides the picture, and the next frame shows it again', async () => {
  const h = harness();
  const socket = await toLive(h);
  h.tick(CAMERA_STALL_MS - 100);
  assert.equal((h.last() as { stalled?: boolean }).stalled, false);
  h.tick(200);
  assert.equal((h.last() as { stalled?: boolean }).stalled, true);
  socket.feed(goldenFrame(2));
  assert.equal((h.last() as { stalled?: boolean }).stalled, false);
});

test('`running` before any frame is live but stalled — no picture is claimed before one exists', async () => {
  const h = harness();
  await toStarting(h);
  h.controller.onState({ state: 'running', streamId: STREAM, facing: 'back', width: 1280, height: 720, frameRate: 15 });
  const state = h.last();
  assert.equal(state.kind, 'live');
  assert.equal((state as { stalled: boolean }).stalled, true);
  assert.equal((state as { frameRate: number }).frameRate, 15);
});

test('a malformed frame stops the stream and says so, rather than drawing it', async () => {
  const h = harness();
  const socket = await toLive(h);
  const bad = goldenFrame(2);
  bad[13] = 9; // unknown version
  socket.feed(bad);
  assert.equal(h.last().kind, 'error');
  assert.equal((h.last() as { code: string }).code, 'MALFORMED_FRAME');
  assert.equal(socket.destroyed, true);
  await settle();
  assert.deepEqual(h.sent.at(-1), { type: 'camera.stop', payload: { streamId: STREAM } });
  assert.equal(h.frames.length, 1, 'the malformed frame reached the renderer');
});

test('a frame claiming more than the cap stops the stream from its header alone', async () => {
  const h = harness();
  const socket = await toLive(h);
  const header = Buffer.alloc(13);
  header[0] = 1;
  header.writeUInt32BE(2 * 1024 * 1024, 9);
  socket.feed(header);
  assert.equal(h.last().kind, 'error');
  assert.equal(socket.destroyed, true);
});

// ---- stop, switch and their repeats -------------------------------------------------------------

test('stop ends the stream at once, tells the phone, and a second stop sends nothing', async () => {
  const h = harness();
  const socket = await toLive(h);
  await h.controller.stop();
  assert.equal(socket.destroyed, true);
  assert.equal(h.last().kind, 'ended');
  assert.equal((h.last() as { reason: string }).reason, 'stopped-by-mac');
  assert.deepEqual(h.sent.at(-1), { type: 'camera.stop', payload: { streamId: STREAM } });
  const before = h.sent.length;
  assert.deepEqual(await h.controller.stop(), { ok: true });
  assert.equal(h.sent.length, before);
});

test('stop while the request is still in flight withdraws it the moment the phone answers', async () => {
  const h = harness();
  let release!: () => void;
  h.reply = (type) =>
    type === 'camera.request'
      ? new Promise((resolve) => {
          release = () => resolve({ payload: { state: 'awaiting-approval', streamId: STREAM, expiresInMs: 30_000 } });
        })
      : Promise.resolve({ payload: {} });
  const pending = h.controller.request('back');
  await h.controller.stop();
  assert.equal(h.last().kind, 'ended');
  release();
  await pending;
  await settle();
  assert.deepEqual(h.sent.at(-1), { type: 'camera.stop', payload: { streamId: STREAM } });
  assert.equal(h.last().kind, 'ended', 'the late ack resurrected a request');
});

test('a switch asks inside the stream, and a refused switch leaves the picture live with a notice', async () => {
  const h = harness();
  await toLive(h);
  await h.controller.switchCamera('front');
  assert.deepEqual(h.sent.at(-1), { type: 'camera.switch', payload: { streamId: STREAM, facing: 'front' } });
  assert.equal(h.sockets.length, 1, 'a switch opened a second socket');

  h.reply = async () => {
    throw Object.assign(new Error('CAMERA_UNAVAILABLE'), { code: 'CAMERA_UNAVAILABLE', phoneMessage: 'No front camera.' });
  };
  await h.controller.switchCamera('front');
  assert.equal(h.last().kind, 'live');
  assert.equal((h.last() as { notice: string }).notice, 'No front camera.');
});

test('the facing follows the frames, which carry it in-band', async () => {
  const h = harness();
  const socket = await toLive(h);
  const back = goldenFrame(2);
  back[13 + 2] = 0; // facing back
  socket.feed(back);
  assert.equal((h.last() as { facing: string }).facing, 'back');
});

// ---- endings, ownership and replacement sessions ------------------------------------------------

test('the phone’s stop ends the stream with its reason and its counts', async () => {
  const h = harness();
  const socket = await toLive(h);
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'left-screen', framesSent: 90, framesDropped: 3 });
  const state = h.last();
  assert.equal(state.kind, 'ended');
  assert.equal((state as { reason: string }).reason, 'left-screen');
  assert.equal((state as { framesSent: number }).framesSent, 90);
  assert.equal((state as { framesReceived: number }).framesReceived, 1);
  assert.equal(socket.destroyed, true);
});

test('a socket that closes first reads stream-lost until the phone says why', async () => {
  const h = harness();
  const socket = await toLive(h);
  socket.hangUp();
  assert.equal((h.last() as { reason: string }).reason, 'stream-lost');
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stopped-on-phone', framesSent: 10, framesDropped: 0 });
  assert.equal((h.last() as { reason: string }).reason, 'stopped-on-phone');
});

test('news about another stream, or from a replaced session, changes nothing', async () => {
  const h = harness();
  await toLive(h);
  const before = h.states.length;
  h.controller.onState({ state: 'stopped', streamId: OTHER_STREAM, reason: 'declined' });
  h.controller.onState({ state: 'running', streamId: OTHER_STREAM, facing: 'front', width: 1, height: 1 });
  h.link.token = OTHER_TOKEN; // a replacement session
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'declined' });
  assert.equal(h.states.length, before);
  assert.equal(h.controller.current().kind, 'live');
});

test('its own session ending ends the stream; another session ending does not', async () => {
  const h = harness();
  const socket = await toLive(h);
  h.controller.onSessionEnded(OTHER_TOKEN);
  assert.equal(h.controller.current().kind, 'live');
  h.controller.onSessionEnded(TOKEN);
  assert.equal(h.last().kind, 'ended');
  assert.equal((h.last() as { reason: string }).reason, 'disconnected');
  assert.equal(socket.destroyed, true);
});

test('a session ending while the request is in flight ends it, and the late ack opens nothing', async () => {
  const h = harness();
  let release!: () => void;
  h.reply = (type) =>
    type === 'camera.request'
      ? new Promise((resolve) => {
          release = () => resolve({ payload: { streamId: STREAM, expiresInMs: 30_000 } });
        })
      : Promise.resolve({ payload: {} });
  const pending = h.controller.request('back');
  h.controller.onSessionEnded(TOKEN);
  h.link.token = OTHER_TOKEN;
  release();
  await pending;
  assert.equal(h.last().kind, 'ended');
  h.controller.onState({ state: 'starting', streamId: STREAM });
  assert.equal(h.sockets.length, 0);
});

test('a request nobody answers is ended here if the phone never says it expired', async () => {
  const h = harness();
  await h.controller.request('back');
  h.tick(30_000);
  assert.equal(h.last().kind, 'requesting');
  h.tick(5_000);
  assert.equal(h.last().kind, 'ended');
  assert.equal((h.last() as { reason: string }).reason, 'expired');
  await settle();
  assert.deepEqual(h.sent.at(-1), { type: 'camera.stop', payload: { streamId: STREAM } });
});

test('an ack without a usable stream id is an error, not a request', async () => {
  const h = harness();
  h.reply = async () => ({ payload: { state: 'awaiting-approval', streamId: 'not-hex' } });
  await h.controller.request('back');
  assert.equal(h.last().kind, 'error');
});

// ---- defect 167: a Mac Stop keeps its own reason, whichever channel the phone hears first --------

test('stop writes camera.stop while the stream socket is still open, then closes everything in the same tick', async () => {
  const h = harness();
  const socket = await toLive(h);
  let socketOpenWhenStopWritten: boolean | null = null;
  h.reply = async (type) => {
    if (type === 'camera.stop') socketOpenWhenStopWritten = !socket.destroyed;
    return { payload: { stopped: true } };
  };
  const pending = h.controller.stop();
  // Synchronously, before any ack: the picture, the socket and the stall watch are gone.
  assert.equal(socketOpenWhenStopWritten, true, 'the socket closed before the phone was told why');
  assert.equal(socket.destroyed, true);
  assert.equal(h.last().kind, 'ended');
  assert.equal(h.clock.intervals.length, 0, 'the stall watch outlived the stop');
  await pending;
  // The phone heard the stop first and agrees: its counts are taken, the reason is unchanged.
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stopped-by-mac', framesSent: 40, framesDropped: 0 });
  const state = h.last() as Extract<CameraPaneState, { kind: 'ended' }>;
  assert.equal(state.reason, 'stopped-by-mac');
  assert.equal(state.framesSent, 40);
});

test('a socket close the phone heard before the stop does not turn a Mac Stop into a lost connection', async () => {
  // The hardware reading of 2026-10-02, verbatim: the phone ended the stream as stream-closed 7 ms
  // before the stop arrived, and its `stopped` replaced this Mac's own reason.
  const h = harness();
  await toLive(h);
  await h.controller.stop();
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 2325, framesDropped: 0 });
  const state = h.last() as Extract<CameraPaneState, { kind: 'ended' }>;
  assert.equal(state.reason, 'stopped-by-mac');
  assert.equal(state.message, 'You stopped the camera from this Mac.');
  assert.equal(state.fixHint, null);
  assert.equal(state.framesSent, 2325, 'the phone’s counts were lost with its reason');
  assert.equal(state.framesReceived, 1);
});

test('a delayed or repeated terminal event changes nothing after the first', async () => {
  const h = harness();
  await toLive(h);
  await h.controller.stop();
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 10, framesDropped: 1 });
  const settled = h.states.length;
  const first = h.last();
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 10, framesDropped: 1 });
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'left-screen', framesSent: 99, framesDropped: 9 });
  assert.equal(h.states.length, settled, 'a repeat was drawn again');
  assert.deepEqual(h.controller.current(), first);
});

test('stop while requesting, starting or running ends at once as stopped-by-mac and tells the phone once', async () => {
  for (const reach of ['requesting', 'connecting', 'live'] as const) {
    const h = harness();
    if (reach === 'requesting') await h.controller.request('back');
    if (reach === 'connecting') await toStarting(h);
    if (reach === 'live') await toLive(h);
    assert.equal(h.last().kind, reach);
    await h.controller.stop();
    assert.equal((h.last() as { reason: string }).reason, 'stopped-by-mac', reach);
    assert.deepEqual(h.sent.filter((s) => s.type === 'camera.stop'), [{ type: 'camera.stop', payload: { streamId: STREAM } }], reach);
    // Whatever the phone then says about it, the ending is this Mac's.
    h.controller.onState({ state: 'stopped', streamId: STREAM, reason: reach === 'requesting' ? 'stopped-by-mac' : 'stream-closed', framesSent: 0, framesDropped: 0 });
    assert.equal((h.last() as { reason: string }).reason, 'stopped-by-mac', reach);
    assert.equal(await h.controller.stop().then(() => h.sent.filter((s) => s.type === 'camera.stop').length), 1, `${reach}: stop is not idempotent`);
  }
});

test('a genuine loss reads stream-lost, takes the phone’s reason when it comes, and names no cause', async () => {
  const h = harness();
  const socket = await toLive(h);
  socket.hangUp();
  const lost = h.last() as Extract<CameraPaneState, { kind: 'ended' }>;
  assert.equal(lost.reason, 'stream-lost');
  // Another stream's ending is not this one's account, even while this one's reason is only a guess.
  h.controller.onState({ state: 'stopped', streamId: OTHER_STREAM, reason: 'left-screen', framesSent: 77, framesDropped: 0 });
  assert.deepEqual(h.controller.current(), lost);
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 5, framesDropped: 0 });
  const closed = h.last() as Extract<CameraPaneState, { kind: 'ended' }>;
  assert.equal(closed.reason, 'stream-closed', 'a guess was not replaced by the phone’s account');
  assert.equal(closed.framesSent, 5);
  for (const sentence of [lost.message, lost.fixHint, closed.message, closed.fixHint]) {
    assert.doesNotMatch(sentence ?? '', /network|wi-?fi|router|same/i, `an unsupported diagnosis: ${sentence}`);
  }
  assert.equal(h.sent.filter((s) => s.type === 'camera.stop').length, 0, 'a loss nobody asked for sent a stop');
});

test('a stale stop or ending for an old stream, or from a replaced session, never touches the next one', async () => {
  const h = harness();
  await toLive(h);
  await h.controller.stop();
  // A new request, for a new stream, in the same session.
  h.reply = async (type) =>
    type === 'camera.request'
      ? { payload: { state: 'awaiting-approval', streamId: OTHER_STREAM, expiresInMs: 30_000 } }
      : { payload: { stopped: false } };
  await h.controller.request('front');
  h.controller.onState({ state: 'starting', streamId: OTHER_STREAM, facing: 'front' });
  const next = h.sockets[1]!.socket;
  next.feed(frameFrom(1, 'front'));
  assert.equal(h.last().kind, 'live');
  const before = h.states.length;
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 1, framesDropped: 0 });
  h.controller.onState({ state: 'running', streamId: STREAM, facing: 'back', width: 1, height: 1 });
  h.link.token = OTHER_TOKEN; // and a replacement session's news about the current stream
  h.controller.onState({ state: 'stopped', streamId: OTHER_STREAM, reason: 'declined' });
  h.link.token = TOKEN;
  assert.equal(h.states.length, before, 'stale news reached the live stream');
  assert.equal(next.destroyed, false);
  assert.equal(h.controller.current().kind, 'live');
});

test('a stop the phone never answers still ends everything at once, and frames after it are refused', async () => {
  for (const answer of ['never', 'timeout'] as const) {
    const h = harness();
    const socket = await toLive(h);
    h.reply = (type) =>
      type !== 'camera.stop'
        ? Promise.resolve({ payload: {} })
        : answer === 'never'
          ? new Promise(() => undefined)
          : Promise.reject(new Error('camera.stop timed out after 5000ms'));
    const pending = h.controller.stop();
    assert.equal(socket.destroyed, true, answer);
    assert.equal(h.last().kind, 'ended', answer);
    const frames = h.frames.length;
    socket.feed(goldenFrame(2));
    assert.equal(h.frames.length, frames, `${answer}: a frame was drawn after stop`);
    assert.equal(h.controller.current().kind, 'ended', answer);
    if (answer === 'timeout') {
      await pending;
      assert.ok(h.logs.some((l) => l.startsWith('W camera.stop for 01234567… failed')), 'the failed stop went unlogged');
    }
  }
});

// ---- defect 168: the Mac logs the lifecycle, once per step, never per frame --------------------

test('one session logs request, approval, first frame, switch asked/accepted/confirmed, and one ending with its counts', async () => {
  const h = harness();
  await h.controller.request('back');
  h.controller.onState({ state: 'starting', streamId: STREAM, facing: 'back' });
  const socket = h.sockets[0]!.socket;
  socket.feed(frameFrom(1, 'back'));
  for (let s = 2; s <= 60; s++) socket.feed(frameFrom(s, 'back')); // renderer never acks: 58 replaced, 1 waiting
  await h.controller.switchCamera('front');
  h.controller.onState({ state: 'running', streamId: STREAM, facing: 'front', width: 1280, height: 720, frameRate: 15, switched: true });
  socket.feed(frameFrom(61, 'front'));
  socket.feed(frameFrom(62, 'front'));
  await h.controller.stop();
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 62, framesDropped: 0 });
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 62, framesDropped: 0 });

  assert.deepEqual(h.logs, [
    'I camera.request sent: back camera — 1 requested since launch',
    'I camera.request acknowledged: stream 01234567… awaiting approval on the phone',
    'I camera stream 01234567… allowed on the phone (back camera); opening the stream socket',
    'I camera stream 01234567… live: first frame 1280 × 720 from the back camera — 1 live of 1 requested since launch',
    'I camera.switch to front requested for camera stream 01234567…',
    'I camera.switch to front accepted by the phone for camera stream 01234567…; waiting for its frames',
    'I camera stream 01234567… switch confirmed: frames now from the front camera, 1280 × 720',
    'I camera stream 01234567… ended: stopped-by-mac — 62 received here, 61 not drawn here; no phone counts yet — 1 ended of 1 requested since launch',
    "I camera stream 01234567… phone's account: stream-closed, 62 sent / 0 dropped there (this Mac's stopped-by-mac stands)",
  ]);
});

test('termination is counted and logged once, however many exits fire', async () => {
  const h = harness();
  const socket = await toLive(h);
  await h.controller.stop();
  socket.hangUp(); // a late close of the socket stop already closed
  h.controller.onSessionEnded(TOKEN);
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'stream-closed', framesSent: 3, framesDropped: 0 });
  assert.equal(h.logs.filter((l) => / ended: /.test(l)).length, 1, h.logs.join('\n'));
  // The tally is per launch: a second attempt is the second of each.
  await h.controller.request('back');
  h.controller.onState({ state: 'stopped', streamId: STREAM, reason: 'declined', framesSent: 0, framesDropped: 0 });
  assert.equal(
    h.logs.at(-1),
    'I camera stream 01234567… ended: declined — 0 received here, 0 not drawn here; phone: 0 sent / 0 dropped there — 2 ended of 2 requested since launch',
  );
});

test('a refused switch is logged as refused and never as confirmed', async () => {
  const h = harness();
  const socket = await toLive(h);
  h.reply = async () => {
    throw Object.assign(new Error('CAMERA_UNAVAILABLE'), { code: 'CAMERA_UNAVAILABLE', phoneMessage: 'No front camera.' });
  };
  await h.controller.switchCamera('back');
  socket.feed(goldenFrame(2)); // still the front camera
  assert.ok(h.logs.includes('W camera.switch to back refused for camera stream 01234567…: CAMERA_UNAVAILABLE'), h.logs.join('\n'));
  assert.equal(h.logs.filter((l) => /accepted|confirmed/.test(l)).length, 0);
});

test('no log line carries the session token, the claim or frame bytes', async () => {
  const h = harness();
  const socket = await toLive(h);
  for (let s = 2; s <= 20; s++) socket.feed(goldenFrame(s));
  await h.controller.switchCamera('back');
  await h.controller.stop();
  assert.ok(h.logs.length >= 5, `control: the session was logged (${h.logs.length} lines)`);
  for (const line of h.logs) {
    assert.ok(!line.includes(TOKEN), `token in: ${line}`);
    assert.ok(!line.includes(STREAM), `full stream id in: ${line}`);
    assert.ok(!/ffd8|\bcamera [0-9a-f]{32}\b/i.test(line), `payload or claim in: ${line}`);
  }
  assert.equal(h.logs.filter((l) => /first frame/.test(l)).length, 1, 'frames were logged one by one');
});
