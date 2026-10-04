import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import './icons';
import './stateBlock';
import './camera';
import './webcam';

/**
 * The "Use as webcam" section's **view class**, driven for real against a recording stand-in for the
 * preload bridge. The statuses are the main process's `WebcamStatus` shape; that the main process sends
 * these for the matching events is `webcamWiring.test.ts`'s job.
 *
 * Absences (nothing asked, nothing stopped) are each paired with a positive control on the same section.
 */

installFakeDocument();

type Status = Record<string, any>;

class FakeBridge {
  readonly calls: string[] = [];
  listener: ((s: Status) => void) | null = null;
  current: Status = idle();
  askResult: { ok: boolean; reason?: string } = { ok: true };
  async webcamCurrent() {
    this.calls.push('current');
    return this.current;
  }
  async webcamAsk(facing: string) {
    this.calls.push(`ask:${facing}`);
    return this.askResult;
  }
  async webcamStop() {
    this.calls.push('stop');
    return { ok: true };
  }
  async webcamSwitch(facing: string) {
    this.calls.push(`switch:${facing}`);
    return { ok: true };
  }
  onWebcamState(listener: (s: Status) => void) {
    this.listener = listener;
  }
}

function idle(over: Status = {}): Status {
  return {
    bridge: 'running', bridgeDetail: null, device: 'installed', producer: 'configured', consumers: 1,
    phone: { kind: 'ready' }, blocker: null, session: null, lastEnded: null, ...over,
  };
}

const session = (phase: string, over: Status = {}) => ({
  phase, sessionId: phase === 'requesting' ? null : '0123456789abcdef0123456789abcdef', trigger: 'consumer', facing: 'front', generation: 1, size: null, ...over,
});

function mount(current: Status = idle()) {
  const bridge = new FakeBridge();
  bridge.current = current;
  const els = { block: el('div'), status: el('p'), note: el('p'), controls: el('div') };
  const Panel = (globalThis as Record<string, any>).WebcamView;
  const panel = new Panel(bridge, els);
  return { bridge, els, panel, push: (s: Status) => bridge.listener!(s) };
}

const buttons = (root: FakeElement) => root.queryAll('button');
const labels = (root: FakeElement) => buttons(root).map((b) => b.textContent.trim());
const press = (root: FakeElement, label: string) => {
  const button = buttons(root).find((b) => b.textContent.trim() === label);
  assert.ok(button, `no "${label}" among ${JSON.stringify(labels(root))}`);
  button.dispatch('click');
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('mounting reads the state and asks the phone nothing; only Ask phone does, with the chosen camera', async () => {
  const s = mount();
  await settle();
  assert.deepEqual(s.bridge.calls, ['current']);
  assert.ok(labels(s.els.controls).includes('Ask phone'), 'control: the button is offered');
  press(s.els.controls, 'Back camera');
  press(s.els.controls, 'Ask phone');
  await settle();
  assert.deepEqual(s.bridge.calls, ['current', 'ask:back']);
});

test('blocked setup states say why and offer no Ask: no bridge, not installed, no identity, refused, an older phone, not connected', async () => {
  const cases: Array<[Status, RegExp, RegExp]> = [
    [idle({ bridge: 'absent', blocker: 'The camera bridge is not available: the camera bridge is not built.' }), /not built/, /bridge absent/],
    [idle({ device: 'not-installed', blocker: 'Sidekick Camera is not installed on this Mac, so nothing could show the picture.' }), /not installed/, /Sidekick Camera not-installed/],
    [idle({ producer: 'unconfigured', blocker: 'This build of Sidekick has no signing identity for Sidekick Camera, so the camera would refuse its pictures.' }), /no signing identity/, /producer identity unconfigured/],
    [idle({ producer: 'refused', blocker: 'Sidekick Camera refused this copy of Sidekick as its picture source.' }), /refused this copy/, /producer identity refused/],
    [idle({ phone: { kind: 'older-phone' }, blocker: "The phone's Sidekick needs an update to be used as a webcam." }), /needs an update/, /bridge running/],
    [idle({ phone: { kind: 'not-connected' }, blocker: 'Not connected to the phone.' }), /not connected/, /bridge running/],
  ];
  for (const [status, sentence, facts] of cases) {
    const s = mount(status);
    await settle();
    assert.match(s.els.block.textContent, sentence);
    assert.match(s.els.block.textContent, facts);
    assert.equal(labels(s.els.controls).includes('Ask phone'), false, String(sentence));
  }
});

test('requesting, awaiting approval, starting and running each say what is true and offer the right control', async () => {
  const s = mount();
  await settle();
  s.push(idle({ session: session('requesting') }));
  assert.match(s.els.block.textContent, /Asking your phone/);
  assert.deepEqual(labels(s.els.controls), ['Cancel request']);
  s.push(idle({ session: session('awaiting-approval') }));
  assert.match(s.els.block.textContent, /Waiting for you to allow it on your phone/);
  assert.match(s.els.block.textContent, /An app on this Mac started Sidekick Camera/);
  s.push(idle({ session: session('starting') }));
  assert.match(s.els.block.textContent, /starting/);
  assert.deepEqual(labels(s.els.controls), ['Switch to back camera', 'Stop webcam']);
  s.push(idle({ session: session('running', { size: { width: 1280, height: 720, targetWidth: 1920, targetHeight: 1080 } }) }));
  assert.equal(s.els.block.hidden, true);
  assert.match(s.els.status.textContent, /Live as Sidekick Camera · front camera · 1280×720 \(target 1920×1080\)/);
  press(s.els.controls, 'Switch to back camera');
  press(s.els.controls, 'Stop webcam');
  await settle();
  assert.deepEqual(s.bridge.calls.slice(1), ['switch:back', 'stop']);
});

test('ended: how it ended, said once, and Ask is offered again — never re-asked by itself', async () => {
  const s = mount();
  await settle();
  s.push(idle({ lastEnded: { sessionId: 'x', reason: 'mac-failed', code: null, framesSent: 40, framesDropped: 0, received: 40, forwarded: 40 } }));
  assert.match(s.els.block.textContent, /This Mac could not continue the webcam/);
  assert.doesNotMatch(s.els.block.textContent, /Stopped from this Mac/);
  assert.ok(labels(s.els.controls).includes('Ask phone'));
  // A reconnect pushes fresh status; the section redraws and asks nothing.
  s.push(idle({ lastEnded: { sessionId: 'x', reason: 'disconnected', code: null, framesSent: null, framesDropped: null, received: 0, forwarded: 0 } }));
  await settle();
  assert.deepEqual(s.bridge.calls, ['current']);
});

test("a refused Ask shows the main process's sentence verbatim", async () => {
  const s = mount();
  await settle();
  s.bridge.askResult = { ok: false, reason: 'A webcam request or session is already open' };
  press(s.els.controls, 'Ask phone');
  await settle();
  assert.equal(s.els.note.textContent, 'A webcam request or session is already open');
});

test('before the click it says what Ask leads to when no app is using Sidekick Camera', async () => {
  const s = mount(idle({ consumers: 0 }));
  await settle();
  assert.match(s.els.note.textContent, /will stop as soon as it starts/);
  const t = mount(idle({ consumers: 2 }));
  await settle();
  assert.doesNotMatch(t.els.note.textContent, /stop as soon/);
});

test('every ending the controller can report has its own sentence', () => {
  const rules = (globalThis as Record<string, any>).__webcamRules;
  const source = readFileSync(join(__dirname, '../main/webcam.ts'), 'utf8');
  const union = source.slice(source.indexOf('export type WebcamEndReason'), source.indexOf('const GUESSED'));
  const local = [...union.matchAll(/\| '([a-z-]+)'/g)].map((m) => m[1]!);
  const vocabulary = JSON.parse(readFileSync(join(__dirname, '../../../docs/fixtures/webcam-vocabulary-v1.json'), 'utf8')).stoppedReasons as string[];
  const all = [...new Set([...vocabulary, ...local])];
  assert.ok(local.length >= 9 && vocabulary.length >= 13, 'control: both lists were read');
  for (const reason of all) assert.ok(rules.WEBCAM_ENDINGS[reason], `no sentence for ${reason}`);
});

test("the section is separate from Camera v1's: its own card, script and ids; v1's controls are untouched", () => {
  const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="camera-card"') < html.indexOf('id="webcam-card"'));
  for (const id of ['camera-block', 'camera-stage', 'camera-canvas', 'camera-controls', 'webcam-block', 'webcam-controls']) {
    assert.equal(html.split(`id="${id}"`).length, 2, `${id} appears exactly once`);
  }
  assert.ok(html.indexOf('<script src="camera.js">') < html.indexOf('<script src="webcam.js">'));
  const renderer = readFileSync(join(__dirname, 'renderer.ts'), 'utf8');
  const construction = renderer.slice(renderer.indexOf('new WebcamView('), renderer.indexOf(');', renderer.indexOf('new WebcamView(')));
  assert.ok(construction.includes("controls: el('webcam-controls')"), 'control: the construction was found');
  assert.equal(construction.includes('onRoute'), false);
});

test('the section has no route hook at all: leaving the pane stops nothing, returning asks nothing', async () => {
  const s = mount(idle({ session: session('running') }));
  await settle();
  assert.equal(typeof (s.panel as Record<string, unknown>).routeChanged, 'undefined');
  // Control: Camera v1's view does have one — the difference is deliberate.
  assert.equal(typeof (globalThis as Record<string, any>).CameraView.prototype.routeChanged, 'function');
});
