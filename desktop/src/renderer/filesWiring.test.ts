import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import '../shared/filesRoots';
import '../shared/sendBatch';
import '../shared/filesListing';
import './icons';
import './stateBlock';
import './files';

/**
 * Defect 156 — **the running app's Files pane had no Pause, Resume or Cancel.**
 *
 * `renderer.ts` built the pane's bridge as an inline object literal that passed `fsPull` through and
 * not `fsPullStop`, `fsPausedPulls` or `fsCancelPaused`. The preload exposed all three and the main
 * process handled them, but the pane draws Pause and Cancel only when its bridge has `fsPullStop`,
 * and reads the paused list only through `fsPausedPulls` — so on hardware (T2, 2026-09-30 13:55) a
 * 200 MiB block pull ran with no Pause on screen. Every Files-pane test was green, because each one
 * gave the view **its own bridge double that already had the three calls** (`filesView.test.ts`'s
 * `withPullControls`): the tests were right about the view and never reached the wiring.
 *
 * So nothing here builds a bridge. The bridge and the event subscriptions come from the same two
 * functions the page calls — `filesBridgeFrom` and `wireFilesEvents` — and the only double is
 * `connect`, standing in for the preload, which is the layer that was already correct. The third
 * test holds `renderer.ts` to calling those two functions, so the tested wiring is the shipped one.
 */

const here = __dirname;
const filesSource = readFileSync(join(here, 'files.ts'), 'utf8');
const preloadSource = readFileSync(join(here, '..', 'preload.ts'), 'utf8');
const rendererSource = readFileSync(join(here, 'renderer.ts'), 'utf8');

const g = globalThis as Record<string, unknown>;
type Bridge = Record<string, (...args: unknown[]) => unknown>;
const filesBridgeFrom = g.filesBridgeFrom as (connect: unknown) => Bridge;
const wireFilesEvents = g.wireFilesEvents as (connect: unknown, view: unknown) => void;

/** Comments stripped, so a name mentioned in prose is never mistaken for a call or a use. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every call the Files view makes on its bridge — read from the view's own code, not listed here. */
const viewCalls = [...new Set([...code(filesSource).matchAll(/this\.bridge\.([A-Za-z]+)/g)].map((m) => m[1]!))].sort();

test('156: the page\'s bridge carries every call the Files view makes, each reaching connect under its own name', () => {
  // Control: the name list really was read from the view, and includes calls known to work and the three that did not.
  for (const known of ['fsPull', 'fsRoots', 'fsPullStop', 'fsPausedPulls', 'fsCancelPaused']) {
    assert.ok(viewCalls.includes(known), `control: the view's calls include ${known} (read ${viewCalls.length}: ${viewCalls.join(', ')})`);
  }
  // Control: the preload check can tell an exposed call from an absent one.
  const exposed = (name: string) => new RegExp(`^\\s+${name}: `, 'm').test(preloadSource);
  assert.ok(exposed('fsPull') && !exposed('fsNoSuchCall'), 'control: the preload check separates present from absent');

  const calls: Array<[string, unknown[]]> = [];
  const connect = new Proxy({}, {
    get: (_t, name) => (...args: unknown[]) => { calls.push([String(name), args]); return `from connect.${String(name)}`; },
  });
  const bridge = filesBridgeFrom(connect);
  const missing = viewCalls.filter((name) => typeof bridge[name] !== 'function');
  assert.deepEqual(missing, [], `the page's bridge lacks calls the view makes: ${missing.join(', ')}`);
  for (const name of viewCalls) {
    assert.ok(exposed(name), `the preload exposes ${name} on connect`);
    calls.length = 0;
    const back = bridge[name]!({ probe: name });
    assert.equal(back, `from connect.${name}`, `${name} returns what connect returned`);
    // A call that takes nothing (fsRoots, fsPickSend, fsPausedPulls) forwards nothing; the rest forward their argument.
    const args = bridge[name]!.length === 0 ? [] : [{ probe: name }];
    assert.deepEqual(calls, [[name, args]], `${name} forwards to connect.${name}, once`);
  }
});

const DOWNLOADS = { rootId: 'downloads:connectsuite', label: 'Received files', kind: 'downloads', writable: true, freeBytes: 1e10 };
const SIZE = 200 * 1024 * 1024;
const ENTRY = { id: '1000308768', name: 'sample-200mb.bin', dir: false, size: SIZE, mtimeMs: 3, mime: 'application/octet-stream' };
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

/** The preload's `connect`, as far as the Files pane reaches it. Its calls are recorded; its events are held for the test to fire. */
function fakeConnect() {
  const calls: string[] = [];
  const handlers: Record<string, (payload: unknown) => void> = {};
  let paused: unknown[] = [];
  let resolvePull: ((r: unknown) => void) | null = null;
  const on = (name: string) => (callback: (payload: unknown) => void) => { handlers[name] = callback; };
  const connect = {
    fsRoots: async () => ({ ok: true, data: { roots: [DOWNLOADS], grantHint: null, push: true } }),
    fsList: async () => ({ ok: true, data: { entries: [ENTRY], hasMore: false } }),
    fsSend: async () => ({ ok: false }),
    fsPickSend: async () => ({ ok: false }),
    fsCancel: async () => ({ ok: true }),
    fsSendAbort: async () => ({ aborted: false }),
    pathForFile: () => '',
    fsPull: (o: { id: string }) => { calls.push(`pull:${o.id}`); return new Promise((r) => { resolvePull = r; }); },
    fsPullStop: async (o: { transferId: string; how: string }) => { calls.push(`stop:${o.transferId}:${o.how}`); return { stopped: true }; },
    fsPausedPulls: async () => { calls.push('paused'); return paused; },
    fsCancelPaused: async (o: { rootId: string; id: string }) => { calls.push(`cancelPaused:${o.id}`); paused = []; return { removed: true }; },
    fsDrag: () => undefined,
    fsThumbs: async () => ({ ok: false }),
    onPushAgreed: on('onPushAgreed'),
    onPushChecking: on('onPushChecking'),
    onPullAgreed: on('onPullAgreed'),
    onPullFinished: on('onPullFinished'),
    onMessage: on('onMessage'),
    onStatus: on('onStatus'),
  };
  return {
    connect, calls, handlers,
    setPaused: (rows: unknown[]) => { paused = rows; },
    finishPull: async (result: unknown) => { resolvePull!(result); await settle(); },
  };
}

function mountFromConnect(connect: unknown) {
  const fake = installFakeDocument();
  const parts = [el('div'), el('div'), el('div'), el('p'), el('div'), el('div'), el('div'), el('div'), el('div'), el('div'), el('div')];
  const View = g.FilesView as new (...args: unknown[]) => { refresh(): Promise<void>; setAdvertised(on: boolean, r: string | null): void };
  const view = new View(filesBridgeFrom(connect), ...parts);
  wireFilesEvents(connect, view);
  const [, rail, , , , , table, , , detail] = parts as FakeElement[];
  return { view, rail: rail!, table: table!, detail: detail!, restore: fake.restore };
}

test('156: through the page\'s own bridge and subscriptions, a block pull shows Pause; Pause keeps it; the paused copy shows Resume and what is kept', async () => {
  const f = fakeConnect();
  const pane = mountFromConnect(f.connect);
  try {
    pane.view.setAdvertised(true, null);
    await pane.view.refresh();
    const byId = (id: string) => pane.detail.queryAll(`#${id}`);
    const row = pane.table.queryAll('.files-row').find((r) => r.textContent.includes(ENTRY.name));
    assert.ok(row, 'control: the listing drew the entry');
    row!.dispatch('click');
    row!.dispatch('dblclick');
    await settle();
    assert.deepEqual(f.calls.filter((c) => c.startsWith('pull:')), [`pull:${ENTRY.id}`], 'one pull asked for, through the page bridge');
    assert.equal(byId('files-pull-pause').length, 0, 'control: nothing to pause before the Mac agreed a block pull');

    // The agreement arrives the way the running app delivers it: through connect.onPullAgreed.
    assert.equal(typeof f.handlers.onPullAgreed, 'function', 'the page subscribed to onPullAgreed');
    f.handlers.onPullAgreed!({ transferId: 'tf-1', rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, resumedFrom: 0, blocks: true });
    assert.equal(byId('files-pull-pause').length, 1, 'Pause is drawn for a block pull in flight');
    assert.equal(byId('files-pull-cancel').length, 1, 'Cancel is drawn beside it');
    byId('files-pull-pause')[0]!.click();
    await settle();
    assert.deepEqual(f.calls.filter((c) => c.startsWith('stop:')), ['stop:tf-1:pause'], 'Pause reached connect.fsPullStop for that transfer');

    f.setPaused([{ rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, size: SIZE, verifiedBytes: 100 * 1024 * 1024, updatedAtMs: 1 }]);
    await f.finishPull({ ok: false, paused: true, reason: 'Paused.' });
    assert.ok(f.calls.includes('paused'), 'the paused list was read through connect.fsPausedPulls');
    assert.match(byId('files-pull-paused')[0]?.textContent ?? '', /^Paused: .+ of .+ is on this Mac, checked block by block\./);
    assert.equal(byId('files-copy-to-mac')[0]?.textContent, 'Resume');
    assert.equal(byId('files-pull-cancel-paused').length, 1, 'the paused copy has its own Cancel');

    // A pull the Mac finished by itself reaches the view through connect.onPullFinished.
    f.setPaused([]);
    assert.equal(typeof f.handlers.onPullFinished, 'function', 'the page subscribed to onPullFinished');
    f.handlers.onPullFinished!({ rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, result: { ok: true, path: '/tmp/x.bin', verified: true, verifiedBy: 'blocks', resumedFrom: 104857600 } });
    await settle();
    assert.match(pane.detail.textContent, /Verified block by block/);
    assert.equal(byId('files-pull-paused').length, 0, 'nothing is shown paused once it finished');
  } finally {
    pane.restore();
  }
});

test('156: renderer.ts builds the Files pane only through filesBridgeFrom and wireFilesEvents', () => {
  const src = code(rendererSource);
  const builds = [...src.matchAll(/createFilesView\(([^)]*\)?)\)/g)].map((m) => m[0]);
  assert.deepEqual(builds, ['createFilesView(filesBridgeFrom(connect))'], 'one construction, from the tested bridge builder');
  assert.equal((src.match(/wireFilesEvents\(connect, files\)/g) ?? []).length, 1, 'the tested subscriptions are the ones wired');
  for (const event of ['onPullAgreed', 'onPullFinished', 'onPushAgreed', 'onPushChecking']) {
    assert.equal(new RegExp(`connect\\.${event}\\(`).test(src), false, `connect.${event} is subscribed only inside wireFilesEvents`);
  }
  // Control: the matcher sees a construction when one is there, and the comment stripper keeps code.
  assert.equal([...'const x = createFilesView({ a });'.matchAll(/createFilesView\(([^)]*\)?)\)/g)].length, 1);
});

// ---- Workstream 3: the pane's controls and sentences, through the page's own bridge and events -------
//
// Every pane here is built by `filesBridgeFrom` + `wireFilesEvents` over a double of `connect` alone (the
// preload), so no production method is supplied by a test. Send, pull, Pause, the paused list and the
// phone's events all travel the routes the running app uses.

const OTHER = { rootId: 'saf:primary%3ADocuments', label: 'Documents', kind: 'saf', writable: false, freeBytes: 1e10 };
/** The same id in the other root, as an app-private path id could be — a different file entirely. */
const TWIN = { id: ENTRY.id, name: 'unrelated-notes.txt', dir: false, size: 1234, mtimeMs: 4, mime: 'text/plain' };

function fakeConnect2() {
  const calls: string[] = [];
  const handlers: Record<string, (payload: unknown) => void> = {};
  let paused: unknown[] = [];
  const pulls: Array<(r: unknown) => void> = [];
  const on = (name: string) => (callback: (payload: unknown) => void) => { handlers[name] = callback; };
  const connect = {
    fsRoots: async () => ({ ok: true, data: { roots: [DOWNLOADS, OTHER], grantHint: null, push: true } }),
    fsList: async (o: { rootId: string }) => ({ ok: true, data: { entries: o.rootId === OTHER.rootId ? [TWIN] : [ENTRY], hasMore: false } }),
    fsSend: async (o: { source: string }) => { calls.push(`send:${o.source}`); return { ok: true }; },
    fsPickSend: async () => ({ ok: false }),
    fsCancel: async () => ({ ok: true }),
    fsSendAbort: async () => ({ aborted: false }),
    pathForFile: () => '',
    fsPull: (o: { rootId: string; id: string }) => { calls.push(`pull:${o.rootId}:${o.id}`); return new Promise((r) => { pulls.push(r); }); },
    fsPullStop: async (o: { transferId: string; how: string }) => { calls.push(`stop:${o.transferId}:${o.how}`); return { stopped: true }; },
    fsPausedPulls: async () => paused,
    fsCancelPaused: async () => { paused = []; return { removed: true }; },
    fsDrag: () => undefined,
    fsThumbs: async () => ({ ok: false }),
    onPushAgreed: on('onPushAgreed'),
    onPushChecking: on('onPushChecking'),
    onPullAgreed: on('onPullAgreed'),
    onPullFinished: on('onPullFinished'),
    onMessage: on('onMessage'),
    onStatus: on('onStatus'),
  };
  return {
    connect, calls, handlers,
    setPaused: (rows: unknown[]) => { paused = rows; },
    /** Resolves the oldest unresolved pull. */
    finishPull: async (result: unknown) => { const r = pulls.shift(); assert.ok(r, 'control: a pull was waiting'); r!(result); await settle(); },
    pending: () => pulls.length,
  };
}

async function readyPane() {
  const f = fakeConnect2();
  const pane = mountFromConnect(f.connect);
  pane.view.setAdvertised(true, null);
  await pane.view.refresh();
  const byId = (id: string) => pane.detail.queryAll(`#${id}`);
  const row = () => pane.table.queryAll('.files-row').find((r) => r.textContent.includes(ENTRY.name));
  return { f, pane, byId, row };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts a pull of ENTRY the way a person does when it is not local: one click, then the prefetch. */
async function startPullByClick(p: Awaited<ReturnType<typeof readyPane>>) {
  const row = p.row();
  assert.ok(row, 'control: the listing drew the entry');
  row!.dispatch('click');
  await wait(300); // the pane's own 250 ms prefetch delay
  await settle();
}

/** A send that has finished on the phone, through offer → Send → fsSend → onPushAgreed → fs.transfer.done. */
async function completedSend(p: Awaited<ReturnType<typeof readyPane>>) {
  // The order the running app sees: the phone agrees while the Mac is still writing, the write finishes,
  // then the phone's verdict arrives.
  let written!: (r: unknown) => void;
  (p.f.connect as Record<string, unknown>).fsSend = (o: { source: string }) => { p.f.calls.push(`send:${o.source}`); return new Promise((r) => { written = r; }); };
  (p.pane.view as unknown as { offer(f: unknown[], skipped: number): void }).offer([{ source: '/tmp/sent.bin', name: 'sent.bin', size: 10 }], 0);
  const confirm = p.byId('files-send-confirm');
  assert.equal(confirm.length, 1, 'control: the send asks first');
  confirm[0]!.click();
  await settle();
  p.f.handlers.onPushAgreed!({ source: '/tmp/sent.bin', transferId: 'tp-1', name: 'sent.bin' });
  written({ ok: true });
  await settle();
  p.f.handlers.onMessage!({ type: 'fs.transfer.done', payload: { transferId: 'tp-1', ok: true, bytes: 10, verified: true } });
  await settle();
  assert.equal(p.byId('files-send-done').length, 1, `control: the finished send card is on screen — detail: ${p.pane.detail.textContent.slice(0, 300)} | calls ${p.f.calls.join(',')}`);
}

test('162: after a finished send, a pull of the selected file still gets Pause and Cancel — and the send result stays on show', async () => {
  const p = await readyPane();
  try {
    await completedSend(p);
    await startPullByClick(p);
    assert.deepEqual(p.f.calls.filter((c) => c.startsWith('pull:')), [`pull:${DOWNLOADS.rootId}:${ENTRY.id}`], 'control: the pull began');
    p.f.handlers.onPullAgreed!({ transferId: 'tf-1', rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, resumedFrom: 0, blocks: true });
    assert.equal(p.byId('files-pull-pause').length, 1, 'Pause is drawn although the send card was never dismissed');
    assert.equal(p.byId('files-pull-cancel').length, 1, 'Cancel too');
    assert.equal(p.byId('files-send-done').length, 1, 'the send result is still there, with its Done');
    p.byId('files-pull-pause')[0]!.click();
    await settle();
    assert.deepEqual(p.f.calls.filter((c) => c.startsWith('stop:')), ['stop:tf-1:pause'], 'the drawn Pause pauses that pull');
    await p.f.finishPull({ ok: false, paused: true, stoppedBy: 'person', reason: 'Paused.' });
  } finally { p.pane.restore(); }
});

test('162: a send still running keeps the column — its Stop is the decision on screen', async () => {
  const p = await readyPane();
  try {
    let release!: (r: unknown) => void;
    (p.f.connect as Record<string, unknown>).fsSend = () => new Promise((r) => { release = r; });
    (p.pane.view as unknown as { offer(f: unknown[], skipped: number): void }).offer([{ source: '/tmp/s.bin', name: 's.bin', size: 10 }], 0);
    p.byId('files-send-confirm')[0]!.click();
    await settle();
    p.row()!.dispatch('click');
    await settle();
    assert.equal(p.byId('files-send-stop').length, 1, 'Stop is on screen while the send runs');
    assert.equal(p.byId('files-copy-to-mac').length, 0, 'the file’s controls wait until the send is settled');
    release({ ok: false, reason: 'stopped' });
    await settle();
  } finally { p.pane.restore(); }
});

test('163: Copy again that fails keeps the valid local copy it was replacing; one that succeeds replaces it', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    await p.f.finishPull({ ok: true, path: '/tmp/Sidekick/sample-200mb.bin', verified: true, verifiedBy: 'blocks' });
    assert.equal(p.byId('files-copy-to-mac')[0]?.textContent, 'Copy again', 'control: the entry is local');
    p.byId('files-copy-to-mac')[0]!.click();
    await settle();
    assert.equal(p.f.pending(), 1, 'control: Copy again asked for a new pull');
    await p.f.finishPull({ ok: false, reason: 'The phone could not open the file.' });
    assert.equal(p.byId('files-copy-to-mac')[0]?.textContent, 'Copy again', 'the earlier copy is still known');
    assert.match(p.byId('files-drag-note')[0]?.textContent ?? '', /On this Mac at \/tmp\/Sidekick\/sample-200mb\.bin/);
    p.row()!.dispatch('click');
    await wait(300); await settle();
    assert.equal(p.f.pending(), 0, 'and a row click does not start a pull by itself (T4-A finding 3)');
    p.byId('files-copy-to-mac')[0]!.click();
    await settle();
    await p.f.finishPull({ ok: true, path: '/tmp/Sidekick/sample-200mb (2).bin', verified: true, verifiedBy: 'blocks' });
    assert.match(p.byId('files-drag-note')[0]?.textContent ?? '', /\(2\)\.bin/, 'a successful Copy again points at the new copy');
  } finally { p.pane.restore(); }
});

test('164: a pull in one folder never marks a same-id file in another folder as copying, and finishing there clears the right one', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    p.f.handlers.onPullAgreed!({ transferId: 'tf-9', rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, resumedFrom: 0, blocks: true });
    // Navigate to the other folder while the pull runs, and select its unrelated file with the same id.
    const railRows = p.pane.rail.queryAll('.files-root');
    assert.equal(railRows.length, 2, 'control: both folders are on the rail');
    railRows.find((r) => r.textContent.includes(OTHER.label))!.dispatch('click');
    await settle();
    const twin = p.pane.table.queryAll('.files-row').find((r) => r.textContent.includes(TWIN.name));
    assert.ok(twin, 'control: the other folder is listed');
    twin!.dispatch('click');
    await settle();
    assert.notEqual(p.byId('files-copy-to-mac')[0]?.textContent, 'Copying…', 'the unrelated file is not copying');
    assert.equal(p.byId('files-pull-pause').length, 0, 'and has no Pause of someone else’s pull');
    // The first pull ends while the other folder is open; back home, nothing stale is left.
    await p.f.finishPull({ ok: true, path: '/tmp/Sidekick/sample-200mb.bin', verified: true, verifiedBy: 'blocks' });
    railRows.find((r) => r.textContent.includes(DOWNLOADS.label))!.dispatch('click');
    await settle();
    p.row()!.dispatch('click');
    await settle();
    assert.equal(p.byId('files-pull-pause').length, 0, 'no stale Pause for a pull that ended elsewhere');
    assert.equal(p.byId('files-copy-to-mac')[0]?.textContent, 'Copy again', 'its result landed on the right file');
    // Copy it again: until the phone agrees the new pull, nothing may offer to pause — a Pause drawn now
    // would be bound to the finished transfer's id, if that id had been left under this file's key.
    p.byId('files-copy-to-mac')[0]!.click();
    await settle();
    assert.equal(p.f.pending(), 1, 'control: the new pull began');
    assert.equal(p.byId('files-pull-pause').length, 0, 'no Pause bound to tf-9, the pull that already ended');
    await p.f.finishPull({ ok: false, cancelled: true, reason: 'Cancelled. Nothing was saved.' });
  } finally { p.pane.restore(); }
});

/** How many times a phrase is on screen in the detail column — repetition is the defect, so it is counted. */
const count = (text: string, phrase: RegExp) => (text.match(new RegExp(phrase.source, 'g')) ?? []).length;

test('165: a paused pull says it is paused and what is kept once, with one instruction — no "paused — Paused."', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    p.f.handlers.onPullAgreed!({ transferId: 'tf-2', rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, resumedFrom: 0, blocks: true });
    p.byId('files-pull-pause')[0]!.click();
    p.f.setPaused([{ rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, size: SIZE, verifiedBytes: 100 * 1024 * 1024, updatedAtMs: 1 }]);
    await p.f.finishPull({ ok: false, paused: true, stoppedBy: 'person', reason: 'Paused.' });
    const text = p.pane.detail.textContent;
    assert.match(p.byId('files-pull-paused')[0]?.textContent ?? '', /^Paused: .+ of .+ is on this Mac, checked block by block\./, 'control: the paused note is drawn');
    assert.doesNotMatch(text, /paused — Paused/);
    assert.equal(count(text, /Resume continues from there/), 1, `one instruction: ${text}`);
    assert.equal(count(text, /kept/), 1, `"kept" once: ${text}`);
  } finally { p.pane.restore(); }
});

test('165: an interruption says what stopped it, that it is kept, and how it continues — once each, never "paused"', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    p.f.setPaused([{ rootId: DOWNLOADS.rootId, id: ENTRY.id, name: ENTRY.name, size: SIZE, verifiedBytes: 100 * 1024 * 1024, updatedAtMs: 1 }]);
    await p.f.finishPull({ ok: false, paused: true, stoppedBy: 'interruption', reason: 'the connection to the phone ended' });
    const status = p.pane.detail.queryAll('.files-detail-note').map((n) => n.textContent).find((t) => t.startsWith(ENTRY.name)) ?? '';
    assert.match(status, new RegExp(`^${ENTRY.name.replace('.', '\\.')} stopped: the connection to the phone ended\\.`));
    assert.match(status, /continues by itself if the phone reconnects within 10 minutes/);
    const text = p.pane.detail.textContent;
    assert.equal(count(text, /kept/), 1, text);
    assert.doesNotMatch(status, /paused/i, 'an interruption is not a Pause the person chose');
  } finally { p.pane.restore(); }
});

test('165: "started again from the beginning" appears for a real restart and never otherwise', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    await p.f.finishPull({ ok: true, path: '/tmp/Sidekick/a.bin', verified: true, verifiedBy: 'blocks', restarted: { why: 'source-changed' } });
    assert.match(p.pane.detail.textContent, /The file changed on the phone since it paused, so it started again from the beginning\./);
    p.byId('files-copy-to-mac')[0]!.click();
    await settle();
    await p.f.finishPull({ ok: true, path: '/tmp/Sidekick/a (2).bin', verified: true, verifiedBy: 'blocks', resumedFrom: 1024 });
    assert.doesNotMatch(p.pane.detail.textContent, /started again/, 'a resume is not a restart');
    assert.match(p.pane.detail.textContent, /continued from where it had paused/);
  } finally { p.pane.restore(); }
});

test('165: a source rejection is never worded as paused, through the page route', async () => {
  const p = await readyPane();
  try {
    await startPullByClick(p);
    await p.f.finishPull({ ok: false, sourceChanged: true, reason: `${ENTRY.name} changed on the phone since the transfer paused, so it has to start again.` });
    const status = p.pane.detail.queryAll('.files-detail-note').map((n) => n.textContent).find((t) => t.startsWith(ENTRY.name)) ?? '';
    assert.match(status, /Nothing was saved\.$/, `control: the rejection is shown: ${status}`);
    assert.doesNotMatch(status, /^\S+ paused|Resume continues|kept/);
    assert.equal(p.byId('files-copy-to-mac')[0]?.textContent, 'Copy to Mac', 'nothing local, nothing paused: a plain copy is offered');
  } finally { p.pane.restore(); }
});
