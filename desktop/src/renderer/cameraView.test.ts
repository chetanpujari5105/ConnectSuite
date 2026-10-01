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
  cameraFrameAck() {
    this.acks += 1;
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

test('a stalled stream hides the picture and says why; its frames are acked, not painted', () => {
  const pane = mount();
  pane.view.setAvailability(READY);
  pane.view.setState({ ...LIVE, stalled: true });
  assert.equal(pane.els.stage.hidden, true);
  assert.match(pane.els.block.textContent, /never shown as live/);
  pane.bridge.frameListener!({ streamId: STREAM, sequence: 8 });
  assert.deepEqual(pane.painter.painted, []);
  assert.equal(pane.bridge.acks, 1);
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
