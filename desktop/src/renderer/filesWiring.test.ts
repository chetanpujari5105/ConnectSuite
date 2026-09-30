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
  const [, , , , , , table, , , detail] = parts as FakeElement[];
  return { view, table: table!, detail: detail!, restore: fake.restore };
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
