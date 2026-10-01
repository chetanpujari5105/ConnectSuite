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
