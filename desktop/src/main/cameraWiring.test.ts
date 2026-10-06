import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Camera pane's bridge, end to end through the three files that carry it: the renderer's
 * `CameraBridge` interface → `renderer.ts`'s object literal → `preload.ts` → `main.ts`'s IPC handlers and
 * sends. A method missing anywhere along that path is silent: the button does nothing, or the pane waits
 * forever for a state that is sent on a channel nobody listens to.
 *
 * A source scan, because Electron's IPC cannot be stood up in `node --test`. It proves each end is
 * **written**; that they run together is what the app does, and the hardware sessions saw.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const rendererCamera = src('renderer/camera.ts');
const renderer = src('renderer/renderer.ts');
const preload = src('preload.ts');
const main = src('main/main.ts');

/** The methods the pane declares it needs. */
function bridgeMethods(): string[] {
  const body = rendererCamera.slice(rendererCamera.indexOf('interface CameraBridge {'));
  const block = body.slice(0, body.indexOf('\n}\n'));
  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]!);
}

test('the bridge the pane declares is the seven calls it uses', () => {
  assert.deepEqual(bridgeMethods().sort(), [
    'cameraCurrent', 'cameraFrameAck', 'cameraRequest', 'cameraStop', 'cameraSwitch', 'onCameraFrame', 'onCameraState',
  ]);
});

test('every bridge method is passed by the page and exposed by preload', () => {
  const literal = renderer.slice(renderer.indexOf('const camera = new CameraView('));
  for (const method of bridgeMethods()) {
    assert.match(literal.slice(0, 1200), new RegExp(`\\b${method}: `), `renderer.ts does not pass ${method}`);
    assert.match(preload, new RegExp(`\\b${method}: `), `preload.ts does not expose ${method}`);
    assert.match(renderer, new RegExp(`\\b${method}: CameraBridge\\['${method}'\\]`), `the connect type omits ${method}`);
  }
});

test('every channel preload uses has its other end in the main process', () => {
  const invokes = [...preload.matchAll(/ipcRenderer\.invoke\('(camera-[\w-]+)'/g)].map((m) => m[1]!);
  const sends = [...preload.matchAll(/ipcRenderer\.send\('(camera-[\w-]+)'/g)].map((m) => m[1]!);
  const listens = [...preload.matchAll(/ipcRenderer\.on\('(camera-[\w-]+)'/g)].map((m) => m[1]!);
  assert.deepEqual(invokes.sort(), ['camera-current', 'camera-request', 'camera-stop', 'camera-switch']);
  assert.deepEqual(sends, ['camera-frame-ack']);
  assert.deepEqual(listens.sort(), ['camera-frame', 'camera-state']);
  for (const c of invokes) assert.ok(main.includes(`ipc.handle('${c}'`), `no handler for ${c}`);
  for (const c of sends) assert.ok(main.includes(`ipc.on('${c}'`), `nothing receives ${c}`);
  for (const c of listens) assert.ok(main.includes(`send('${c}'`), `main never sends ${c}`);
});

test('the frame ack carries the stream and the outcome all the way through (defect 172)', () => {
  assert.ok(preload.includes("ipcRenderer.send('camera-frame-ack', streamId, outcome)"));
  assert.ok(main.includes("ipc.on('camera-frame-ack', (_event, streamId: unknown, outcome: unknown) => camera?.frameAck(streamId, outcome))"));
  assert.ok(renderer.includes('cameraFrameAck: (streamId, outcome) => connect.cameraFrameAck(streamId, outcome)'));
  assert.ok(renderer.includes('new CameraCanvasPainter(el<HTMLCanvasElement>(\'camera-canvas\'), (streamId, outcome) => connect.cameraFrameAck(streamId, outcome))'));
});

test('who ended the session reaches the camera (defect 174)', () => {
  assert.ok(main.includes('camera?.onSessionEnded(ended.token, ended.byThisMac)'));
});
