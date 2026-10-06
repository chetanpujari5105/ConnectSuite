/*
 * Audit S4 through the PRODUCTION wiring: the real `main.ts` is loaded with Electron stubbed, every
 * `ipc.handle` / `ipc.on` it registers at import time is captured, and those real listeners are called
 * with forged events. Side effects are observed where Electron would perform them (the settings store,
 * `shell`, `clipboard`, `startDrag`), so "refused" here means the feature never ran, not merely that a
 * refusal object came back.
 *
 * Not reached: handlers registered after `app.whenReady()` (the receive window's, the webcam's) —
 * starting the app would start discovery on the real network. Those are covered by `shareWindow` /
 * `ipcAuth` tests and by the isolated Electron run in `docs/evidence/s4-ipc-2026-10-06/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const userData = mkdtempSync(join(tmpdir(), 'ipc-wiring-'));
const storeData = new Map<string, unknown>();
const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const effects: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive || k === 'toString' ? () => '' : noop),
  apply: () => noop,
  construct: () => noop,
});
const stub = <T extends object>(t: T) => new Proxy(t, { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : noop) });
const electron = stub({
  app: stub({
    getPath: () => userData, isPackaged: false, getName: () => 'Sidekick', getVersion: () => '2.0.0',
    whenReady: () => new Promise(() => undefined), getAppPath: () => process.cwd(),
    getFileIcon: () => Promise.resolve({ isEmpty: () => true }),
    setLoginItemSettings: () => effects.push('login-item'),
  }),
  ipcMain: { handle: (c: string, l: never) => listeners.set(c, l), on: (c: string, l: never) => listeners.set(c, l), removeHandler: () => undefined },
  shell: stub({
    showItemInFolder: (p: string) => effects.push(`reveal ${p}`),
    openExternal: (u: string) => { effects.push(`open ${u}`); return Promise.resolve(); },
    openPath: (p: string) => { effects.push(`openPath ${p}`); return Promise.resolve(''); },
  }),
  clipboard: stub({ writeText: (t: string) => effects.push(`clipboard ${t}`), readText: () => '', availableFormats: () => [], has: () => false, read: () => '' }),
});
const moduleWithLoad = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
const realLoad = moduleWithLoad._load;
moduleWithLoad._load = function (r: string, ...rest: unknown[]) {
  if (r === 'electron') return electron;
  if (r === 'electron-store') {
    return class {
      constructor(o?: { defaults?: Record<string, unknown> }) { for (const [k, v] of Object.entries(o?.defaults ?? {})) if (!storeData.has(k)) storeData.set(k, v); }
      get(k: string) { return storeData.get(k); }
      set(k: string, v: unknown) { storeData.set(k, v); effects.push(`store ${k}`); }
    };
  }
  return realLoad.call(this, r, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const main = require('./main') as typeof import('./main');
const { windows, producedFiles, chosenSources } = main.ipcBoundaryForTests;
const RENDERER = join(__dirname, '..', 'renderer');
const PAGE = { main: join(RENDERER, 'index.html'), float: join(RENDERER, 'float.html'), share: join(RENDERER, 'share-window.html') };

class Contents {
  dragged: unknown[] = [];
  isDestroyed() { return false; }
  startDrag(item: unknown) { this.dragged.push(item); }
  send() { /* events */ }
}
const mainWin = new Contents();
const floatWin = new Contents();
const shareWin = new Contents();
windows.register('main', mainWin, PAGE.main);
windows.register('float', floatWin, PAGE.float);
windows.register('share', shareWin, PAGE.share);
const from = (sender: Contents, page: string, parent: unknown = null) => ({ sender, senderFrame: { url: pathToFileURL(page).href, parent } });
const call = (channel: string, event: unknown, ...args: unknown[]) => {
  const l = listeners.get(channel);
  assert.ok(l, `control: ${channel} is registered by main.ts`);
  return l(event, ...args);
};
const refused = (r: unknown) => (r as { refused?: boolean } | undefined)?.refused === true;
const settle = () => new Promise((r) => setTimeout(r, 30));

test('control: main.ts registered its handlers through the guard, and the main window with a valid payload works', async () => {
  assert.ok(listeners.size > 100, `only ${listeners.size} listeners captured`);
  effects.length = 0;
  call('set-manual-address', from(mainWin, PAGE.main), '192.0.2.10');
  assert.equal(storeData.get('manualAddress'), '192.0.2.10');
  assert.ok(effects.includes('store manualAddress'));
});

test('the float and receive windows cannot Forget, pair, send SMS, dial, use the clipboard or read settings', async () => {
  storeData.set('paired', { deviceId: 'd', deviceName: 'Phone', fingerprint: 'AA', pairedAt: 1 });
  effects.length = 0;
  for (const [win, page] of [[floatWin, PAGE.float], [shareWin, PAGE.share]] as const) {
    assert.ok(refused(call('forget-device', from(win, page))));
    assert.ok(refused(await call('pairing-qr', from(win, page), true)));
    assert.ok(refused(await call('sms-send', from(win, page), { threadId: 't', body: 'hi' })));
    assert.ok(refused(await call('call-dial', from(win, page), '5551234')));
    assert.ok(refused(call('clip-use', from(win, page), 'attacker text')));
    assert.ok(refused(call('settings', from(win, page))));
    assert.ok(refused(call('log-tail', from(win, page), 10)));
  }
  await settle();
  assert.deepEqual(effects, [], 'zero privileged side effects');
  assert.deepEqual(storeData.get('paired'), { deviceId: 'd', deviceName: 'Phone', fingerprint: 'AA', pairedAt: 1 }, 'Forget did not run');
});

test('an unknown sender, a subframe of the main window and a replaced main window are refused', async () => {
  effects.length = 0;
  const stranger = new Contents();
  assert.ok(refused(call('clip-use', from(stranger, PAGE.main), 'x')));
  assert.ok(refused(call('clip-use', from(mainWin, PAGE.main, { parent: 'frame' }), 'x')));
  assert.ok(refused(call('clip-use', from(mainWin, join(RENDERER, 'evil.html')), 'x')));
  const replacement = new Contents();
  windows.register('main', replacement, PAGE.main);
  assert.ok(refused(call('clip-use', from(mainWin, PAGE.main), 'x')), 'the old main window is a stranger now');
  windows.register('main', mainWin, PAGE.main);
  await settle();
  assert.deepEqual(effects, []);
  call('clip-use', from(mainWin, PAGE.main), 'control text');
  assert.ok(effects.some((e) => e === 'clipboard control text'), 'control: the registered main window may use it');
});

test('an invalid payload causes zero side effects', async () => {
  effects.length = 0;
  const before = storeData.get('manualAddress');
  assert.ok(refused(call('set-manual-address', from(mainWin, PAGE.main), 42)));
  assert.ok(refused(call('set-manual-address', from(mainWin, PAGE.main), 'x'.repeat(300))));
  assert.ok(refused(call('appearance-set', from(mainWin, PAGE.main), 'neon')));
  assert.ok(refused(call('login-item-set', from(mainWin, PAGE.main), 'yes')));
  assert.ok(refused(call('clip-open', from(mainWin, PAGE.main), { url: 'https://example.com' })));
  await settle();
  assert.equal(storeData.get('manualAddress'), before);
  assert.deepEqual(effects, []);
});

test('only the main window may arm a pairing code; the floating and receive windows never reach it', async () => {
  // Before startup the link does not exist, so a main-window call reaches the handler and throws
  // "Link not ready" — the control that the handler is reachable at all.
  await assert.rejects(Promise.resolve().then(() => call('pairing-qr', from(mainWin, PAGE.main), false)), /Link not ready/);
  assert.ok(refused(await call('pairing-qr', from(floatWin, PAGE.float), true)));
  assert.ok(refused(await call('pairing-qr', from(shareWin, PAGE.share), false)));
  assert.equal(listeners.has('pairing-qr-render'), false, 'the arbitrary-payload QR renderer is gone');
});

test('fs-drag drags only files this app produced; reveal-saved reveals only those', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipc-wiring-files-'));
  const produced = join(dir, 'pulled.bin');
  const other = join(dir, 'other.bin');
  writeFileSync(produced, 'x');
  writeFileSync(other, 'y');
  call('fs-drag', from(mainWin, PAGE.main), [other]);
  call('fs-drag', from(mainWin, PAGE.main), ['/etc/hosts']);
  await settle();
  assert.equal(mainWin.dragged.length, 0, 'unauthorised paths are not dragged');
  effects.length = 0;
  const r = call('reveal-saved', from(mainWin, PAGE.main), { path: other }) as { ok: boolean };
  assert.equal(r.ok, false);
  assert.deepEqual(effects, []);

  producedFiles.grant(produced);
  call('fs-drag', from(mainWin, PAGE.main), [produced]);
  await settle();
  assert.equal(mainWin.dragged.length, 1, 'control: a produced file is dragged');
  call('fs-drag', from(mainWin, PAGE.main), [produced, other]);
  await settle();
  assert.equal(mainWin.dragged.length, 1, 'one ungranted path refuses the whole drag');
  assert.equal((call('reveal-saved', from(mainWin, PAGE.main), { path: produced }) as { ok: boolean }).ok, true);
});

test('fs-send reads only a file the person picked or dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipc-wiring-send-'));
  const secret = join(dir, 'id_rsa');
  writeFileSync(secret, 'not really a key');
  const r = (await call('fs-send', from(mainWin, PAGE.main), { rootId: 'r', path: '', source: secret })) as { ok: boolean; reason?: string };
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /not chosen or dropped/);
  call('fs-grant-source', from(floatWin, PAGE.float), secret);
  await settle();
  assert.equal(chosenSources.has(secret), false, 'the float window cannot grant a source');
  call('fs-grant-source', from(mainWin, PAGE.main), secret);
  await settle();
  assert.equal(chosenSources.has(secret), true, 'control: the main window’s drop grant');
  const after = (await call('fs-send', from(mainWin, PAGE.main), { rootId: 'r', path: '', source: secret }).catch?.((e: Error) => ({ ok: false, reason: e.message }))) as { reason?: string } | undefined;
  assert.doesNotMatch(after?.reason ?? '', /not chosen or dropped/, 'control: a granted source passes the gate');
});
