import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_ROLES, IPC_POLICY } from './ipcPolicy';
import type { WindowRole } from './ipcAuth';

/**
 * Audit S4: the three preloads, the policy table and `main.ts` must agree. Read from source, because
 * the preloads are not loadable in Node (they need Electron's renderer) — what each exposes is its
 * object literal, and what each sends is its `ipcRenderer.invoke/send` calls.
 */

const SRC = join(__dirname, '..');
const code = (file: string) => readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function exposed(file: string): { methods: string[]; channels: string[] } {
  const src = code(file);
  const body = src.slice(src.indexOf("exposeInMainWorld('connect', {"));
  const methods = [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!);
  const channels = [...body.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*['`]([^'`$]+)['`]/g)].map((m) => m[1]!);
  if (/ipcRenderer\.invoke\(`share-\$\{action\}`/.test(body)) channels.push('share-cancel', 'share-retry', 'share-open', 'share-reveal');
  return { methods, channels: [...new Set(channels)] };
}

const PRELOADS: Array<[WindowRole, string]> = [['main', 'preload.ts'], ['float', 'preloadFloat.ts'], ['share', 'preloadShare.ts']];

test('every channel each preload can reach is in IPC_POLICY and allowed for that window', () => {
  for (const [role, file] of PRELOADS) {
    const { channels } = exposed(file);
    assert.ok(channels.length > 0, `control: ${file} channels were read`);
    for (const channel of channels) {
      assert.ok(IPC_POLICY[channel], `${file} uses ${channel}, which has no policy`);
      assert.ok(IPC_POLICY[channel]!.roles.includes(role), `${file} exposes ${channel}, which the ${role} window may not call`);
    }
  }
});

test('the floating window exposes exactly its 25 methods and nothing personal', () => {
  const { methods } = exposed('preloadFloat.ts');
  assert.deepEqual([...methods].sort(), [
    'appearanceGet', 'debugSwitches', 'floatClose', 'floatMinimize', 'floatMove', 'floatResize', 'floatSetPinned',
    'floatSmartFit', 'floatState', 'inputGlobal', 'inputScroll', 'inputSwipe', 'inputTap', 'logLine', 'mirrorCapture',
    'mirrorKeyframe', 'onAppearance', 'onFloatChanged', 'onMirrorRotate', 'onMirrorState', 'onMirrorStopped',
    'onStatus', 'onVideoFrame', 'showMainWindow', 'streamStart',
  ]);
});

test('the receive window exposes exactly its 8 methods', () => {
  const { methods } = exposed('preloadShare.ts');
  assert.deepEqual([...methods].sort(), [
    'appearanceGet', 'onAppearance', 'onShareWindow', 'shareAct', 'shareDecide', 'shareWindowClose', 'shareWindowHeight', 'shareWindowState',
  ]);
});

// `share-open` / `share-reveal` act on the window's own offer by id (bound in main); no path crosses IPC.
test('no SMS, dialing, pairing, Forget, file, clipboard, contacts, notification, settings or history API outside the main preload', () => {
  const forbidden = /sms|call|dial|pair|forget|^fs|clip|contact|notif|activity|settings|logTail|download|media|reveal|apps|camera|webcam|address|connect$|disconnect|retry/i;
  for (const file of ['preloadFloat.ts', 'preloadShare.ts']) {
    const { methods, channels } = exposed(file);
    const bad = methods.filter((m) => forbidden.test(m)).concat(channels.filter((c) => !c.startsWith('share-') && /sms|call|pair|forget|^fs|clip|contact|notif|activity|settings|log-tail|download|media|reveal|apps|camera|webcam|address/.test(c)));
    assert.deepEqual(bad, [], `${file} exposes ${bad.join(', ')}`);
  }
  assert.ok(exposed('preload.ts').methods.includes('smsSend'), 'control: the pattern does match the main preload');
});

test('every preload is self-contained: a sandboxed preload may load nothing but electron', () => {
  for (const [, file] of PRELOADS) {
    const runtime = [...code(file).matchAll(/^import (?!type)[^;]* from '([^']+)'/gm)].map((m) => m[1]);
    assert.deepEqual(runtime, ['electron'], `${file} imports ${runtime.join(', ')}`);
  }
});

test('main.ts registers nothing outside the guard, and every policy channel is registered somewhere', () => {
  const main = code('main/main.ts');
  assert.equal((main.match(/ipcMain\.(handle|on)\(/g) ?? []).length, 0, 'a raw ipcMain registration bypasses the guard');
  assert.ok((main.match(/\bipc\.(handle|on)\(/g) ?? []).length > 100, 'control: guarded registrations were found');
  const all = readdirSync(join(SRC, 'main')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => code(`main/${f}`)).join('\n');
  const registered = new Set([...all.matchAll(/ipc\.(?:handle|on)\(\s*'([^']+)'/g)].map((m) => m[1]));
  for (const c of ["webcam-current", "webcam-ask", "webcam-stop", "webcam-switch", "webcam-spike-current", "webcam-spike-run"]) registered.add(c);
  const unregistered = Object.keys(IPC_POLICY).filter((c) => !registered.has(c));
  assert.deepEqual(unregistered, [], 'a policy row with no handler is a stale permission');
});

test('private events never go to the floating or receive window', () => {
  for (const [channel, roles] of Object.entries(EVENT_ROLES)) {
    if (/clip|sms|notif|call|activity|fs-|media|pair|contact/.test(channel)) {
      assert.deepEqual(roles, ['main'], `${channel} would leave the main window`);
    }
  }
  for (const channel of ['clip-arrived', 'activity-recorded', 'fs-pull-finished', 'pair-scanned', 'media-preview-agreed']) {
    assert.equal(EVENT_ROLES[channel], undefined, `${channel} must default to the main window only`);
  }
});

test('sendAll routes every event through EVENT_ROLES; nothing broadcasts to all windows', () => {
  const main = code('main/main.ts');
  const start = main.indexOf('function sendAll(');
  assert.ok(start >= 0, 'control: sendAll was found');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.match(body, /EVENT_ROLES\[channel\]/);
  assert.match(body, /roles\.includes\('float'\) &&/);
  assert.match(body, /roles\.includes\('share'\) &&/);
  assert.equal((main.match(/getAllWindows\(\)\.forEach/g) ?? []).length, 0, 'a broadcast to every window bypasses EVENT_ROLES');
});
