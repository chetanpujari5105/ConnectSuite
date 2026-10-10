import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDocument, el } from './domDouble.testkit';
import '../shared/filesRoots';
import '../shared/sendBatch';
import '../shared/filesListing';
import '../shared/returnRefresh';
import './icons';
import './stateBlock';
import './overflowTitle';
import './files';

/**
 * Defect 208 — thumbnails asked of the wrong root after a switch.
 *
 * Hardware, 2026-10-08 stage 11: the phone's provider was asked about a 10-character MediaStore id (a
 * *Received files* id) against the DCIM tree, threw inside `enforceTree`, and the Mac counted three files
 * *gone*. The mechanism, found reading the pane: a root switch while the previous root's listing is still
 * in flight makes the new `loadMore` return at once (`loading` is still true), and when the old page
 * lands it is appended to the **new** root's list — so the grid asks for old ids under the new root, and
 * the new root's own listing is never requested.
 *
 * Driven through the page's own bridge (`filesBridgeFrom`), with the phone's listing held open so the
 * switch lands inside it. **Not reached:** the main process's batching (`files.ts` → `thumbsFor`, its
 * own test) and the phone's refusal (`FsThumbRootTest` on the phone).
 */
const g = globalThis as Record<string, unknown>;
type Bridge = Record<string, (...args: unknown[]) => unknown>;
const filesBridgeFrom = g.filesBridgeFrom as (connect: unknown) => Bridge;
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

const DOWNLOADS = { rootId: 'downloads:connectsuite', label: 'Received files', kind: 'downloads', writable: true, freeBytes: 1e10 };
const DCIM = { rootId: 'saf:primary%3ADCIM', label: 'DCIM', kind: 'tree', writable: false, freeBytes: 1e10 };
const MEDIA_ROW = { id: '1000308768', name: 'received.jpg', dir: false, size: 10, mtimeMs: 1, mime: 'image/jpeg' };
const TREE_ROW = { id: 'primary:DCIM/Camera/IMG_1.jpg', name: 'IMG_1.jpg', dir: false, size: 10, mtimeMs: 2, mime: 'image/jpeg' };
const LISTING: Record<string, unknown[]> = { [DOWNLOADS.rootId]: [MEDIA_ROW], [DCIM.rootId]: [TREE_ROW] };

function mount() {
  const thumbs: Array<{ rootId: string; ids: string[] }> = [];
  const lists: string[] = [];
  const held: Array<() => void> = [];
  const connect = {
    fsRoots: async () => ({ ok: true, data: { roots: [DOWNLOADS, DCIM], grantHint: null, push: true } }),
    // Every listing is held until the test releases it, so a switch can land while one is in flight.
    fsList: (o: { rootId: string }) => {
      lists.push(o.rootId);
      return new Promise((resolve) => held.push(() => resolve({ ok: true, data: { entries: LISTING[o.rootId] ?? [], hasMore: false } })));
    },
    fsThumbs: async (o: { rootId: string; ids: string[] }) => { thumbs.push({ rootId: o.rootId, ids: [...o.ids] }); return { ok: true, entries: [] }; },
    fsSend: async () => ({ ok: false }), fsPickSend: async () => ({ ok: false }), fsCancel: async () => ({ ok: true }),
    fsSendAbort: async () => ({ aborted: false }), pathForFile: () => '', fsPull: async () => ({ ok: false }),
    fsPullStop: async () => ({ stopped: false }), fsPausedPulls: async () => [], fsCancelPaused: async () => ({ removed: false }),
    fsDrag: () => undefined,
  };
  const fake = installFakeDocument();
  const parts = [el('div'), el('div'), el('div'), el('p'), el('div'), el('div'), el('div'), el('div'), el('div'), el('div'), el('div')];
  const View = g.FilesView as new (...args: unknown[]) => { refresh(): Promise<void>; setAdvertised(on: boolean, r: string | null): void };
  const view = new View(filesBridgeFrom(connect), ...parts);
  (view as unknown as { viewMode: string }).viewMode = 'grid';
  const [, rail, , , , , table] = parts as FakeElement[];
  const release = async () => { while (held.length) held.shift()!(); await settle(); };
  return { view, rail: rail!, table: table!, thumbs, lists, release, restore: fake.restore };
}

test('208: a root switch during a listing never asks the new root about the old root’s ids', async () => {
  const p = mount();
  p.view.setAdvertised(true, null);
  void p.view.refresh();
  await settle();
  assert.deepEqual(p.lists, [DCIM.rootId], 'control: the tree is listed first and is still in flight');
  const downloads = p.rail.queryAll('.files-root').find((r) => r.textContent.includes('Received files'));
  assert.ok(downloads, `control: the rail drew Received files — rail: ${p.rail.textContent.slice(0, 200)}`);
  downloads!.dispatch('click');
  await settle();
  await p.release();
  await p.release();

  for (const ask of p.thumbs) {
    for (const id of ask.ids) {
      assert.ok((LISTING[ask.rootId] as Array<{ id: string }>).some((e) => e.id === id),
        `asked ${ask.rootId} about ${id}, which belongs to another root`);
    }
  }
  assert.ok(p.lists.includes(DOWNLOADS.rootId), `the new root was never listed — lists: ${p.lists.join(', ')}`);
  assert.match(p.table.textContent, /received\.jpg/, 'the new root’s file is not on screen');
  assert.doesNotMatch(p.table.textContent, /IMG_1\.jpg/, 'the old root’s file is drawn under the new root');
  assert.ok(p.thumbs.some((t) => t.rootId === DOWNLOADS.rootId && t.ids.includes(MEDIA_ROW.id)),
    `control: the instrument sees a thumbnail request when one is right — thumbs: ${JSON.stringify(p.thumbs)}`);
  p.restore();
});
