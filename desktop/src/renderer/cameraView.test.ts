import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
// The page loads these before the pane; the pane builds component 11's state block and its glyphs.
import './icons';
import './stateBlock';
import './camera';

/**
 * The Camera pane's **view class**, driven for real, with the canvas painter replaced by a recorder —
 * the DOM double does not model a canvas, and the drawing math is asserted separately through the
 * matrix the painter hands to `setTransform`.
 *
 * Several assertions here are about absence (no request sent, no picture drawn); each is paired with
 * a positive control on the same pane.
 */

installFakeDocument();

type State = Record<string, unknown> & { kind: string };

class FakeBridge {
  readonly calls: string[] = [];
  stateListener: ((state: State) => void) | null = null;
  frameListener: ((frame: Record<string, unknown>) => void) | null = null;
  acks = 0;
  async cameraRequest(facing: string) {
    this.calls.push(`request:${facing}`);
    return { ok: true };
  }
  async cameraStop() {
    this.calls.push('stop');
    return { ok: true };
  }
  async cameraSwitch(facing: string) {
    this.calls.push(`switch:${facing}`);
    return { ok: true };
  }
  async cameraCurrent(): Promise<State> {
    return { kind: 'idle' };
  }
  ackLog: Array<[string, string]> = [];
  cameraFrameAck(streamId: string, outcome: string) {
    this.acks += 1;
    this.ackLog.push([streamId, outcome]);
  }
  onCameraState(listener: (state: State) => void) {
    this.stateListener = listener;
  }
  onCameraFrame(listener: (frame: Record<string, unknown>) => void) {
    this.frameListener = listener;
  }
}

class RecordingPainter {
  painted: number[] = [];
  clears = 0;
  stream: string | null = null;
  setStream(streamId: string | null) {
    this.stream = streamId;
  }
  paint(frame: { sequence: number }) {
    this.painted.push(frame.sequence);
  }
  clear() {
    this.clears += 1;
  }
}

interface View {
  setAvailability(a: Record<string, unknown>): void;
  setState(s: State): void;
  routeChanged(screen: string): void;
}

const rules = (globalThis as Record<string, any>).__cameraRules;
const STREAM = '0123456789abcdef0123456789abcdef';
const READY = { kind: 'ready' };
const LIVE: State = { kind: 'live', streamId: STREAM, facing: 'back', width: 1280, height: 720, frameRate: 15, stalled: false, framesReceived: 3, notice: null };

function mount() {
  const bridge = new FakeBridge();
  const painter = new RecordingPainter();
  const els = { block: el('div'), stage: el('div'), controls: el('div'), status: el('p'), notice: el('p') };
  let tick: (() => void) | null = null;
  let now = 1_000_000;
  const CameraView = (globalThis as Record<string, any>).CameraView;
  const view: View = new CameraView(bridge, els, painter, () => now, (fn: () => void) => {
    tick = fn;
    return () => {
      tick = null;
    };
  });
  return {
    bridge,
    painter,
    els,
    view,
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    ticking: () => tick !== null,
  };
}

const buttons = (root: FakeElement) => root.queryAll('button');
const labels = (root: FakeElement) => buttons(root).map((b) => b.textContent.trim());
const press = (root: FakeElement, label: string) => {
  const button = buttons(root).find((b) => b.textContent.trim() === label);
  assert.ok(button, `no "${label}" button among ${JSON.stringify(labels(root))}`);
  button.dispatch('click');
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- availability ------------------------------------------------------------------------------

test('three different panes for disconnected, an older phone, and a phone that says no', () => {
  const pane = mount();
  assert.match(pane.els.block.textContent, /not connected/);

  pane.view.setAvailability(rules.cameraAvailability(true, ['mirror'], []));
  assert.match(pane.els.block.textContent, /Update Sidekick on your phone/);

  pane.view.setAvailability(rules.cameraAvailability(true, [], [{ name: 'camera', reason: 'not built yet — waiting on camera.request' }]));
  assert.match(pane.els.block.textContent, /not offering its camera/);
  assert.match(pane.els.block.textContent, /not built yet — waiting on camera\.request/);

  // None of the three may offer a request.
  assert.equal(labels(pane.els.controls).includes('Ask phone for camera'), false);
  // Control: the same pane offers it the moment the phone advertises camera.
  pane.view.setAvailability(rules.cameraAvailability(true, ['camera'], []));
  assert.ok(labels(pane.els.controls).includes('Ask phone for camera'));
});

// ---- the request ---------------------------------------------------------------------------------

test('arriving at the pane asks the phone nothing; only the button does, with the chosen camera', async () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.routeChanged('camera');
  await settle();
  assert.deepEqual(pane.bridge.calls, [], 'the pane asked the phone by itself');

  press(pane.els.controls, 'Front camera');
  assert.equal(buttons(pane.els.controls).find((b) => b.textContent === 'Front camera')!.getAttribute('aria-pressed'), 'true');
  press(pane.els.controls, 'Ask phone for camera');
  assert.deepEqual(pane.bridge.calls, ['request:front']);
});

test('a waiting request says who decides, counts down, and can be cancelled', () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.setState({ kind: 'requesting', facing: 'back', streamId: STREAM, expiresAtMs: 1_000_000 + 30_000, message: 'On your phone.', fixHint: null });
  assert.match(pane.els.block.textContent, /allow it on your phone/);
  assert.match(pane.els.block.textContent, /expires in 30 s/);
  assert.doesNotMatch(pane.els.block.textContent, /starting/i, 'the pane claimed the camera was starting');
  pane.advance(10_000);
  assert.match(pane.els.block.textContent, /expires in 20 s/);
  press(pane.els.controls, 'Cancel request');
  assert.deepEqual(pane.bridge.calls, ['stop']);
  pane.view.setState({ kind: 'ended', streamId: STREAM, reason: 'stopped-by-mac', message: 'Stopped.', fixHint: null, framesSent: null, framesDropped: null, framesReceived: 0 });
  assert.equal(pane.ticking(), false, 'the countdown outlived the request');
});

// ---- the stop policy ---------------------------------------------------------------------------

test('leaving the pane stops an open stream or request, and leaving an idle pane sends nothing', () => {
  const idle = mount();
  idle.view.setAvailability(READY);
  idle.view.routeChanged('camera');
  idle.view.routeChanged('overview');
  assert.deepEqual(idle.bridge.calls, []);

  for (const state of [
    LIVE,
    { kind: 'requesting', facing: 'back', streamId: null, expiresAtMs: null, message: null, fixHint: null },
    { kind: 'connecting', streamId: STREAM, facing: 'back' },
  ] as State[]) {
    const pane = mount();
    pane.view.setAvailability(READY);
    pane.view.setState(state);
    pane.view.routeChanged('camera');
    pane.view.routeChanged('files');
    assert.deepEqual(pane.bridge.calls, ['stop'], `${state.kind}: leaving did not stop`);
  }
});

// ---- live, stalled and ended ---------------------------------------------------------------------

test('live shows the picture, the status and both controls; frames are painted', () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.setState(LIVE);
  assert.equal(pane.els.stage.hidden, false);
  assert.equal(pane.els.block.hidden, true);
  assert.equal(pane.els.status.textContent, 'Live · back camera · 1280 × 720 · up to 15 fps');
  assert.deepEqual(labels(pane.els.controls), ['Switch to front camera', 'Stop camera']);
  pane.bridge.frameListener!({ streamId: STREAM, sequence: 7 });
  assert.deepEqual(pane.painter.painted, [7]);
  press(pane.els.controls, 'Switch to front camera');
  press(pane.els.controls, 'Stop camera');
  assert.deepEqual(pane.bridge.calls, ['switch:front', 'stop']);
});

/**
 * Changed 2026-10-03 (defect 172): a stalled stream's frames are painted onto the hidden stage, because
 * the main process shows the picture again only when the page reports a fresh frame drawn. Acking them
 * unpainted, as the first version did, would have left a stalled stream stalled for good.
 */
test('a stalled stream hides the picture and says why; its frames still paint, behind the hidden stage', () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.setState({ ...LIVE, stalled: true });
  assert.equal(pane.els.stage.hidden, true);
  assert.match(pane.els.block.textContent, /never shown as live/);
  pane.bridge.frameListener!({ streamId: STREAM, sequence: 8 });
  assert.deepEqual(pane.painter.painted, [8]);
  assert.equal(pane.bridge.acks, 0, 'the painter acks it, with what became of it');
  // Control: a frame for another stream is acked unpainted, and says why.
  pane.bridge.frameListener!({ streamId: 'f'.repeat(32), sequence: 9 });
  assert.deepEqual(pane.painter.painted, [8]);
  assert.deepEqual(pane.bridge.ackLog, [['f'.repeat(32), 'not-live']]);
});

test('an ended stream clears the picture, says how it ended with the counts, and offers to ask again', () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.setState(LIVE);
  const clearsBefore = pane.painter.clears;
  pane.view.setState({ kind: 'ended', streamId: STREAM, reason: 'left-screen', message: 'The camera screen closed.', fixHint: 'Keep it open.', framesSent: 900, framesDropped: 12, framesReceived: 880 });
  assert.equal(pane.els.stage.hidden, true);
  assert.ok(pane.painter.clears > clearsBefore, 'the last frame was left on the canvas');
  assert.equal(pane.painter.stream, null);
  assert.match(pane.els.block.textContent, /900 frames sent by the phone, 12 dropped there; 880 received here/);
  assert.ok(labels(pane.els.controls).includes('Ask again'));
  // A frame for the ended stream is acked and not painted.
  pane.bridge.frameListener!({ streamId: STREAM, sequence: 9 });
  assert.deepEqual(pane.painter.painted, []);
});

test('an ending with no picture grows no line of zeros', () => {
  const line = rules.cameraCountsLine({ kind: 'ended', streamId: null, reason: 'declined', message: '', fixHint: null, framesSent: null, framesDropped: null, framesReceived: 0 });
  assert.equal(line, null);
});

test('busy, permission and a phone with no camera are three different blocks', () => {
  const spec = (state: State) => rules.cameraPaneSpec(READY, state, 0);
  const busy = spec({ kind: 'refused', code: 'CAMERA_BUSY', message: 'Mirroring.', fixHint: null });
  assert.equal(busy.block.kind, 'permission');
  assert.equal(busy.canRequest, true);
  const wall = spec({ kind: 'refused', code: 'CAMERA_UNAVAILABLE', message: 'No camera.', fixHint: null });
  assert.equal(wall.block.kind, 'wall');
  assert.equal(wall.canRequest, false, 'a wall offered a retry');
  const denied = spec({ kind: 'ended', streamId: null, reason: 'permission-denied', message: 'off', fixHint: null, framesSent: null, framesDropped: null, framesReceived: 0 });
  assert.equal(denied.block.kind, 'permission');
});

test('defect 167: no ending prints its internal reason as text on the pane', () => {
  const spec = (state: State) => rules.cameraPaneSpec(READY, state, 0);
  const reasons = [
    'declined', 'expired', 'permission-denied', 'camera-unavailable', 'camera-in-use', 'stopped-by-mac',
    'stopped-on-phone', 'left-screen', 'stream-closed', 'capture-failed', 'disconnected', 'stream-lost',
  ] as const;
  for (const reason of reasons) {
    const block = spec({ kind: 'ended', streamId: STREAM, reason, message: 'A sentence.', fixHint: null, framesSent: 3, framesDropped: 0, framesReceived: 3 }).block!;
    // Control: the block was drawn and carries the sentence it was given.
    assert.ok(block.body.includes('A sentence.'), reason);
    assert.equal(block.code, undefined, `${reason} grew a code line`);
    // The defect was a line that *is* the token. `expired` and `declined` are also English words in
    // honest headlines, so only the hyphenated tokens — which no sentence contains — are searched for.
    const texts = [block.headline, ...block.body];
    assert.ok(!texts.includes(reason), `${reason} is a line of the pane`);
    if (reason.includes('-')) assert.ok(!texts.some((t) => t.includes(reason)), `${reason} reached the text`);
  }
  // An ending nobody explained claims no failure and no cause in its headline.
  assert.equal(spec({ kind: 'ended', streamId: STREAM, reason: 'stream-closed', message: 'm', fixHint: null, framesSent: null, framesDropped: null, framesReceived: 0 }).block!.headline, 'The camera stream ended');
});

// ---- the drawing math ----------------------------------------------------------------------------

/** Applies the matrix exactly as `setTransform` does. */
function apply(m: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f].map((v) => Math.round(v * 1000) / 1000);
}

test('a landscape frame turned a quarter is fitted upright, centred, with its aspect kept', () => {
  // 4x2 frame, one quarter turn clockwise, into a 100x100 box: upright it is 2x4, so 50x100 wide-centred.
  const m = rules.cameraDrawMatrix(4, 2, 1, false, 100, 100);
  assert.deepEqual([m.drawW, m.drawH], [50, 100]);
  assert.deepEqual(apply(m, 0, 0), [75, 0], 'the frame’s top-left goes to the upright top-right');
  assert.deepEqual(apply(m, 4, 0), [75, 100]);
  assert.deepEqual(apply(m, 0, 2), [25, 0]);
});

test('mirroring is applied to the upright picture, after the turn', () => {
  const m = rules.cameraDrawMatrix(4, 2, 1, true, 100, 100);
  assert.deepEqual(apply(m, 0, 0), [25, 0]);
  assert.deepEqual(apply(m, 4, 0), [25, 100]);
});

test('an unturned frame is letterboxed, never stretched or cropped', () => {
  const m = rules.cameraDrawMatrix(1280, 720, 0, false, 400, 400);
  assert.deepEqual([m.drawW, m.drawH], [400, 225]);
  assert.deepEqual(apply(m, 0, 0), [0, 87.5]);
  assert.deepEqual(apply(m, 1280, 720), [400, 312.5]);
});

// ---- the painter: decode, draw, and what becomes of every frame (defect 172, 2026-10-03) ---------------
// A fake canvas and a hand-released decoder: the browser's JPEG decoder is not available here, so the
// frames are synthetic descriptions and "decoding" is a promise the test resolves. What this cannot reach
// is `createImageBitmap` itself.

const Painter = (globalThis as Record<string, any>).CameraCanvasPainter;

class FakeBitmap {
  closes = 0;
  constructor(readonly width: number, readonly height: number) {}
  close() {
    this.closes += 1;
  }
}

function painterRig() {
  const ops: string[] = [];
  const context = {
    setTransform: () => ops.push('transform'),
    clearRect: () => ops.push('clear'),
    drawImage: () => ops.push('draw'),
  };
  const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 300, getContext: () => context };
  const pending: Array<{ resolve: (b: FakeBitmap) => void; reject: (e: Error) => void }> = [];
  const bitmaps: FakeBitmap[] = [];
  const acks: Array<[string, string]> = [];
  (globalThis as Record<string, any>).window ??= {};
  (globalThis as Record<string, any>).window.devicePixelRatio = 2;
  const painter = new Painter(canvas, (id: string, outcome: string) => acks.push([id, outcome]), () =>
    new Promise<FakeBitmap>((resolve, reject) => pending.push({ resolve, reject })),
  );
  const decodeAs = (w: number, h: number) => {
    const b = new FakeBitmap(w, h);
    bitmaps.push(b);
    pending.shift()!.resolve(b);
  };
  return { painter, ops, acks, pending, bitmaps, decodeAs, settle: () => new Promise((r) => setImmediate(r)) };
}

const frame = (sequence: number, extra: Record<string, unknown> = {}) => ({
  streamId: STREAM, sequence, facing: 'back', rotation: 0, mirrored: false, width: 640, height: 480, jpeg: new Uint8Array([0xff, 0xd8]), ...extra,
});

test('painter: a frame drawn as described is acked drawn, and its bitmap closed once', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1));
  r.decodeAs(640, 480);
  await r.settle();
  assert.deepEqual(r.acks, [[STREAM, 'drawn']]);
  assert.ok(r.ops.includes('draw'));
  assert.deepEqual(r.bitmaps.map((b) => b.closes), [1]);
});

test('painter: pixels that are not the size the header says are not drawn, and say so', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1));
  r.decodeAs(480, 640);
  await r.settle();
  assert.deepEqual(r.acks, [[STREAM, 'size-mismatch']]);
  assert.ok(!r.ops.includes('draw'), 'drawn with a description written for other pixels');
  assert.deepEqual(r.bitmaps.map((b) => b.closes), [1]);
});

test('painter: an undecodable JPEG is one lost frame, acked as such, and the next one still draws', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1));
  r.pending.shift()!.reject(new Error('bad jpeg'));
  await r.settle();
  r.painter.paint(frame(2));
  r.decodeAs(640, 480);
  await r.settle();
  assert.deepEqual(r.acks, [[STREAM, 'undecodable'], [STREAM, 'drawn']]);
});

test('painter: a decode that finishes after Stop draws nothing, closes its bitmap, and acks late', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1));
  r.painter.setStream(null); // the stream ended while decoding
  const clearsAtStop = r.ops.filter((o) => o === 'clear').length;
  r.decodeAs(640, 480);
  await r.settle();
  assert.deepEqual(r.acks, [[STREAM, 'late']]);
  assert.ok(!r.ops.includes('draw'));
  assert.ok(clearsAtStop >= 1, 'control: the stop cleared the canvas');
  assert.deepEqual(r.bitmaps.map((b) => b.closes), [1]);
});

test('painter: while decoding, a newer frame replaces the waiting one, which is acked replaced — one ack per frame', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1));
  r.painter.paint(frame(2));
  r.painter.paint(frame(3)); // replaces 2
  assert.deepEqual(r.acks, [[STREAM, 'replaced']]);
  r.decodeAs(640, 480);
  await r.settle();
  r.decodeAs(640, 480);
  await r.settle();
  assert.deepEqual(r.acks.map((a) => a[1]), ['replaced', 'drawn', 'drawn']);
  assert.equal(r.acks.length, 3, 'three frames, three acks');
  assert.ok(r.bitmaps.every((b) => b.closes === 1));
});

test('painter: a frame for another stream is never decoded, and is acked late', async () => {
  const r = painterRig();
  r.painter.setStream(STREAM);
  r.painter.paint(frame(1, { streamId: 'e'.repeat(32) }));
  await r.settle();
  assert.equal(r.pending.length, 0);
  assert.deepEqual(r.acks, [['e'.repeat(32), 'late']]);
});
