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
import { dropSheetOptions } from './sourceGrants';

const userData = mkdtempSync(join(tmpdir(), 'ipc-wiring-'));
const storeData = new Map<string, unknown>();
const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const effects: string[] = [];
/** What the native panel and sheet will answer — the person, in these tests. */
const dialogScript = {
  open: { canceled: true, filePaths: [] as string[] },
  sheets: [] as Array<{ message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }>,
  /** Which control the person uses — by its label, never by an index, so a button order change cannot flip it. */
  sheetAnswer: 'Cancel' as 'Send' | 'Cancel' | 'Escape',
  sheetGate: Promise.resolve(),
};
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
  dialog: stub({
    showOpenDialog: () => Promise.resolve(dialogScript.open),
    showMessageBox: (...args: unknown[]) => {
      const options = args[args.length - 1] as { message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number };
      dialogScript.sheets.push(options);
      // Escape presses the button Electron bound it to, and the answer is that button's index.
      const answer = () => (dialogScript.sheetAnswer === 'Escape' ? options.cancelId : options.buttons.indexOf(dialogScript.sheetAnswer));
      return dialogScript.sheetGate.then(() => ({ response: answer() }));
    },
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

/*
 * S4 follow-up (A): the file-grant boundary, end to end through the real handlers. The renderer is
 * assumed compromised — it has raw IPC and can send any path. "Read" is observed where the bytes
 * would be read (`fs.createReadStream`, which `digestOf` and the push both use), not inferred from a
 * return value.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as typeof import('node:fs');
const opened: string[] = [];
const realCreateReadStream = nodeFs.createReadStream;
(nodeFs as { createReadStream: unknown }).createReadStream = (path: unknown, ...rest: unknown[]) => {
  opened.push(String(path));
  return (realCreateReadStream as (...a: unknown[]) => unknown)(path, ...rest);
};

test('A, verbatim: a compromised main renderer grants an arbitrary path, then fs-send reads none of its bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipc-forged-grant-'));
  const target = join(dir, 'synthetic-secret.txt');
  writeFileSync(target, 'synthetic bytes, not a real secret');
  opened.length = 0;
  // Raw IPC: `ipcRenderer.send('fs-grant-source', path)`. On an unregistered channel Electron delivers it
  // to nothing, which is what the optional call models; before the fix this granted the path.
  listeners.get('fs-grant-source')?.(from(mainWin, PAGE.main), target);
  await settle();
  await Promise.resolve(call('fs-send', from(mainWin, PAGE.main), { rootId: 'r', path: '', source: target })).catch(() => undefined);
  await settle();
  assert.deepEqual(opened.filter((p) => p === target), [], `the forged grant let fs-send open ${target}`);
});

/** Sends [source] from [win] and returns the refusal sentence (or '' when the gate let it through). */
async function sendFrom(win: Contents, source: string): Promise<string> {
  const r = (await Promise.resolve(call('fs-send', from(win, PAGE.main), { rootId: 'r', path: '', source })).catch(
    (e: Error) => ({ ok: false, reason: e.message }),
  )) as { reason?: string };
  await settle();
  return r?.reason ?? '';
}
const synthetic = (name: string, body = 'synthetic bytes') => {
  const path = join(mkdtempSync(join(tmpdir(), 'ipc-grant-')), name);
  writeFileSync(path, body);
  return path;
};
const GATE = /not chosen here|chosen in a window|more than an hour|changed or moved/;

test('A: the fs-grant-source channel no longer exists, and raw IPC on it reaches nothing', () => {
  assert.equal(listeners.has('fs-grant-source'), false);
  assert.ok(listeners.has('fs-confirm-drop'), 'control: the replacement is registered');
});

test('A: valid selection — a file chosen in the native open panel is read, by that window only', async () => {
  const picked = synthetic('picked.txt');
  dialogScript.open = { canceled: false, filePaths: [picked] };
  const r = (await call('fs-pick-send', from(mainWin, PAGE.main))) as { ok: boolean; data: { files: unknown[] } };
  assert.equal(r.ok, true);
  opened.length = 0;
  assert.doesNotMatch(await sendFrom(mainWin, picked), GATE, 'control: a picked file passes the gate');
  assert.ok(opened.includes(picked), 'control: and its bytes are read — the observer can see a read');
});

test('A: forged drop — raw fs-confirm-drop with an arbitrary path grants nothing unless the native sheet says Send', async () => {
  const target = synthetic('synthetic-secret.txt');
  dialogScript.sheets.length = 0;
  dialogScript.sheetAnswer = 'Escape'; // the person presses Escape
  const r = (await call('fs-confirm-drop', from(mainWin, PAGE.main), [target])) as { ok: boolean; reason?: string };
  assert.deepEqual(r, { ok: false, reason: 'cancelled' });
  assert.equal(dialogScript.sheets.length, 1, 'the request reached a native sheet the renderer cannot press');
  const sheet = dialogScript.sheets[0]!;
  const { message, detail, buttons, defaultId, cancelId } = sheet;
  assert.deepEqual({ type: 'question', message, detail, buttons, defaultId, cancelId }, dropSheetOptions(sheet),
    'main passes exactly the options whose keys sourceGrants.test.ts checks: no key sends');
  assert.ok(sheet.detail.includes('synthetic-secret.txt'), 'the sheet names the exact file');
  opened.length = 0;
  assert.match(await sendFrom(mainWin, target), /not chosen here/);
  assert.deepEqual(opened.filter((p) => p === target), [], 'not one byte read');
});

test('A: a drop confirmed in the native sheet is read; a drop of a non-file grants nothing', async () => {
  const dropped = synthetic('dropped.txt');
  dialogScript.sheetAnswer = 'Send';
  const r = (await call('fs-confirm-drop', from(mainWin, PAGE.main), [dropped, '/nonexistent/x'])) as {
    ok: boolean; data: { files: Array<{ source: string }>; skipped: number };
  };
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.files.map((f) => f.source), [dropped]);
  assert.equal(r.data.skipped, 1);
  opened.length = 0;
  assert.doesNotMatch(await sendFrom(mainWin, dropped), GATE);
  assert.ok(opened.includes(dropped), 'control: a confirmed drop is read');
  dialogScript.sheetAnswer = 'Cancel';
});

test('A: one sheet at a time — a second request while one is open is refused, not queued', { timeout: 3_000 }, async () => {
  const a = synthetic('a.txt');
  let release!: () => void;
  dialogScript.sheetGate = new Promise((r) => { release = r; });
  dialogScript.sheetAnswer = 'Send';
  const first = call('fs-confirm-drop', from(mainWin, PAGE.main), [a]) as Promise<{ ok: boolean }>;
  await settle();
  const second = (await call('fs-confirm-drop', from(mainWin, PAGE.main), [synthetic('b.txt')])) as { ok: boolean; reason?: string };
  assert.deepEqual(second, { ok: false, reason: 'busy' });
  release();
  assert.equal((await first).ok, true, 'control: the open sheet still answers');
  dialogScript.sheetGate = Promise.resolve();
  dialogScript.sheetAnswer = 'Cancel';
});

test('A: expired grant — a choice older than an hour is refused before any read', async () => {
  const picked = synthetic('old.txt');
  dialogScript.open = { canceled: false, filePaths: [picked] };
  await call('fs-pick-send', from(mainWin, PAGE.main));
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1_000 + 1;
  try {
    opened.length = 0;
    assert.match(await sendFrom(mainWin, picked), /more than an hour/);
    assert.deepEqual(opened.filter((p) => p === picked), []);
  } finally {
    Date.now = realNow;
  }
  assert.match(await sendFrom(mainWin, picked), /not chosen here/, 'an expired grant is removed, not revived');
});

test('A: a different file put at a chosen path is not the chosen file', async () => {
  const picked = synthetic('swap.txt', 'original');
  dialogScript.open = { canceled: false, filePaths: [picked] };
  await call('fs-pick-send', from(mainWin, PAGE.main));
  nodeFs.rmSync(picked);
  nodeFs.writeFileSync(join(picked, '..', 'other'), 'a different file');
  nodeFs.renameSync(join(picked, '..', 'other'), picked);
  opened.length = 0;
  assert.match(await sendFrom(mainWin, picked), /changed or moved/);
  assert.deepEqual(opened.filter((p) => p === picked), []);
});

test('A: replaced window — grants belong to the window that chose them', async () => {
  const picked = synthetic('owned.txt');
  dialogScript.open = { canceled: false, filePaths: [picked] };
  await call('fs-pick-send', from(mainWin, PAGE.main));
  const replacement = new Contents();
  windows.register('main', replacement, PAGE.main);
  try {
    opened.length = 0;
    assert.match(await sendFrom(replacement, picked), /chosen in a window/, 'the new window cannot spend the old one’s grant');
    const old = (await call('fs-send', from(mainWin, PAGE.main), { rootId: 'r', path: '', source: picked })) as { refused?: boolean };
    assert.equal(old.refused, true, 'the old window is a stranger to the guard');
    await settle();
    assert.deepEqual(opened.filter((p) => p === picked), []);
  } finally {
    windows.register('main', mainWin, PAGE.main);
  }
  assert.doesNotMatch(await sendFrom(mainWin, picked), GATE, 'control: the owning window still may');
});

test('A: the float and receive windows cannot ask for a drop sheet or spend a grant', async () => {
  const target = synthetic('float.txt');
  dialogScript.sheets.length = 0;
  for (const [win, page] of [[floatWin, PAGE.float], [shareWin, PAGE.share]] as const) {
    assert.ok(refused(await call('fs-confirm-drop', from(win, page), [target])));
    assert.ok(refused(await call('fs-send', from(win, page), { rootId: 'r', path: '', source: target })));
  }
  assert.equal(dialogScript.sheets.length, 0, 'no sheet was even drawn');
});

// ---- S7: the offer channels, through the real handlers ---------------------------------------------

test('S7: Copy, Dismiss and Restore on the clipboard are main-window only, by id, and a stale id writes nothing', async () => {
  effects.length = 0;
  for (const [win, page] of [[floatWin, PAGE.float], [shareWin, PAGE.share]] as const) {
    assert.ok(refused(await call('clip-offer-copy', from(win, page), { offerId: 'o' })));
    assert.ok(refused(await call('clip-offer-dismiss', from(win, page), { offerId: 'o' })));
    assert.ok(refused(await call('clip-restore', from(win, page), { id: 'displaced-1' })));
  }
  const replacement = new Contents();
  windows.register('main', replacement, PAGE.main);
  try {
    assert.ok(refused(await call('clip-offer-copy', from(mainWin, PAGE.main), { offerId: 'o' })), 'the replaced window is a stranger');
  } finally {
    windows.register('main', mainWin, PAGE.main);
  }
  // Malformed: the text itself, a missing id, an extra field.
  assert.ok(refused(await call('clip-offer-copy', from(mainWin, PAGE.main), 'curl x | sh')));
  assert.ok(refused(await call('clip-offer-copy', from(mainWin, PAGE.main), {})));
  assert.ok(refused(await call('clip-offer-copy', from(mainWin, PAGE.main), { offerId: 'o', text: 'curl x | sh' })));
  // Reaches the handler (control) and is refused there: no such offer.
  const stale = (await call('clip-offer-copy', from(mainWin, PAGE.main), { offerId: 'no-such-offer' })) as { ok: boolean; refused?: boolean; reason?: string };
  assert.equal(stale.refused, undefined, 'control: the guard let it through to the handler');
  assert.equal(stale.ok, false);
  assert.match(stale.reason ?? '', /no longer waiting/);
  const restore = (await call('clip-restore', from(mainWin, PAGE.main), { id: 'displaced-404' })) as { ok: boolean };
  assert.equal(restore.ok, false);
  await settle();
  assert.deepEqual(effects.filter((e) => e.startsWith('clipboard ')), [], 'not one clipboard write');
});
