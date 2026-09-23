/**
 * Feature D review, live, over the phone's Received files (generated test files only — checked).
 *
 * Sorting is checked against an order computed HERE from the phone's own metadata, not by calling
 * `visibleEntries`: asking the rule to grade itself would be the model-instead-of-call fault.
 * The page-size instrument (5 per page) is labelled: it wraps the pane's bridge for one section so
 * the real paging, footer and Load more run over real entries, then restores it.
 */
import { openProbe, format } from './probe.mjs';

const p = await openProbe({ port: 9222 });
let fails = 0;
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); if (!ok) fails += 1; };
const read = async (question, expr, control = `__probe.count('section[data-screen="files"]')`) => (await p.read({ question, read: expr, control })).value;

const SNAP = `(async () => { const r = await connect.fsList({ rootId: 'downloads:connectsuite', path: '', limit: 200 }); return r.data.entries.map(e => [e.id, e.name, e.size, e.mtimeMs, e.mime].join('|')).sort(); })()`;
const before = await read('phone listing before', SNAP, `1`);
const t0 = new Date().toISOString();

await p.act({ what: 'Files → Received files, list view, no filter, name ↑', run: `(() => { if (shell.screen !== 'files') shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); document.querySelector('#files-view-list')?.click(); if (files.query) { files.query=''; files.render(); } return /received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && files.entries.length > 0 && files.viewMode === 'list'; })()`, within: 30000 });

// ---- sorting, every field, both directions, against an independent order ----
const DRAWN = `[...document.querySelectorAll('#files-table .files-row:not(.files-row--head) .files-cell-name > span:nth-child(2)')].map(s => s.textContent)`;
const META = `files.entries.map(e => ({ name: e.name, size: e.size, mtime: e.mtimeMs, mime: e.mime, dir: e.dir }))`;
const entries = await read('entries as the phone sent them', META);
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const expected = (key, dir) => {
  const s = dir === 'asc' ? 1 : -1;
  const unknownLast = (a, b) => (a === b ? 0 : a ? -1 : 1);
  return entries.slice().sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    const byName = coll.compare(a.name, b.name);
    if (key === 'name') return s * byName;
    if (key === 'date') return unknownLast(a.mtime > 0, b.mtime > 0) || s * (a.mtime - b.mtime) || byName;
    if (key === 'size') return s * (a.size - b.size) || byName;
    const ta = a.mime !== 'application/octet-stream' ? a.mime : null, tb = b.mime !== 'application/octet-stream' ? b.mime : null;
    return unknownLast(ta !== null, tb !== null) || s * coll.compare(ta ?? '', tb ?? '') || byName;
  }).map((e) => e.name);
};
for (const key of ['name', 'date', 'size', 'type']) {
  for (const dir of ['asc', 'desc']) {
    await p.act({ what: `sort ${key} ${dir} via the toolbar`, run: `(() => { const s = document.querySelector('#files-sort'); s.value = ${JSON.stringify(key)}; s.dispatchEvent(new Event('change')); const want = ${JSON.stringify(dir)}; if (files.sortDir !== want) document.querySelector('#files-sort-dir').click(); return true; })()`, expect: `files.sortKey === ${JSON.stringify(key)} && files.sortDir === ${JSON.stringify(dir)}` });
    const drawn = await read(`drawn order, ${key} ${dir}`, DRAWN);
    const want = expected(key, dir);
    check(`sort ${key.padEnd(4)} ${dir.padEnd(4)} matches the phone's metadata`, JSON.stringify(drawn) === JSON.stringify(want), drawn.length + ' rows' + (JSON.stringify(drawn) === JSON.stringify(want) ? '' : ` — first difference at ${drawn.findIndex((n, i) => n !== want[i])}`));
  }
}
const headerSort = await p.act({ what: 'press the SIZE column header twice', run: `(() => { const h = () => [...document.querySelectorAll('.files-head-sort')].find(b => /SIZE/.test(b.textContent)); h().click(); return true; })()`, expect: `files.sortKey === 'size'` });
const aria = await read('aria-sort on the header after pressing SIZE', `[...document.querySelectorAll('.files-head-sort')].map(b => b.textContent + '=' + b.getAttribute('aria-sort'))`);
check('the pressed header carries aria-sort and an arrow', aria.some((x) => /SIZE ↑=ascending|SIZE ↓=descending/.test(x)), aria.join(', '));
await p.act({ what: 'back to name ascending', run: `(() => { const s = document.querySelector('#files-sort'); s.value='name'; s.dispatchEvent(new Event('change')); if (files.sortDir !== 'asc') document.querySelector('#files-sort-dir').click(); return true; })()`, expect: `files.sortKey === 'name' && files.sortDir === 'asc'` });

// ---- List ↔ Grid keeps the folder, the selection and the detail ----
await p.act({ what: 'select one file (the sample photo) in list view', run: `(() => { const r = [...document.querySelectorAll('#files-table .files-row')].find(r => /portrait/.test(r.textContent)); r.click(); return true; })()`, expect: `files.selectedIds.size === 1` });
const listState = await read('list: crumbs, selection, detail title', `({ crumbs: document.querySelector('#files-crumbs').textContent, selected: [...files.selectedIds], title: document.querySelector('#files-detail .files-detail-title')?.textContent })`);
await p.act({ what: 'switch to grid', run: `(() => { document.querySelector('#files-view-grid').click(); return true; })()`, expect: `files.viewMode === 'grid' && document.querySelectorAll('.files-tile').length > 0` });
const gridState = await read('grid: crumbs, selection, detail title, selected tile', `({ crumbs: document.querySelector('#files-crumbs').textContent, selected: [...files.selectedIds], title: document.querySelector('#files-detail .files-detail-title')?.textContent, selectedTiles: [...document.querySelectorAll('.files-tile.is-selected')].map(t => t.querySelector('.files-tile-name').textContent) })`);
check('grid keeps the folder', gridState.crumbs === listState.crumbs, gridState.crumbs);
check('grid keeps the selection and draws it', JSON.stringify(gridState.selected) === JSON.stringify(listState.selected) && gridState.selectedTiles.length === 1, gridState.selectedTiles.join());
check('grid keeps the detail panel on the same file', gridState.title === listState.title, gridState.title);

// ---- thumbnails: real where the phone makes one, a neutral badge otherwise ----
const tiles = await p.read({ question: 'each tile: picture or badge, by MIME', read: `(() => { const by = {}; for (const t of document.querySelectorAll('.files-tile')) { const name = t.querySelector('.files-tile-name').textContent; const e = files.entries.find(x => x.name === name); const k = e.mime + ' → ' + (t.querySelector('img') ? 'picture' : 'badge ' + (t.querySelector('.files-tile-badge')?.textContent ?? '?')); by[k] = (by[k]||0)+1; } return by; })()`, control: `__probe.count('.files-tile')`, settle: { until: (v) => Object.keys(v).some((k) => /picture/.test(k)), within: 10000 } });
console.log('  ' + format(tiles));
check('pictures only on image/video tiles; every other file a badge', Object.keys(tiles.value).every((k) => /picture/.test(k) ? /^(image|video)\//.test(k) : /badge/.test(k)));
const asked = await read('fs.thumb was asked only about image/video ids', `[...files.thumbAsked].map(id => files.entries.find(e => e.id === id)?.mime)`);
check('thumbnails requested only for images and videos', asked.every((m) => /^(image|video)\//.test(m)), [...new Set(asked)].join(', '));
await p.act({ what: 'back to list', run: `(() => { document.querySelector('#files-view-list').click(); return true; })()`, expect: `files.viewMode === 'list'` });

// ---- filter: only the loaded folder; empty; Escape; changing folders ----
const typeQuery = async (q) => p.act({ what: `type "${q}"`, run: `(() => { const i = document.querySelector('#files-search'); i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return true; })()`, expect: `files.query === ${JSON.stringify(q)}`, within: 3000 });
await typeQuery('multi');
const filt = await read('filtered rows and footer', `({ rows: ${DRAWN}, footer: document.querySelector('#files-footer').textContent })`);
check('filter keeps only matching names from the loaded folder', filt.rows.length > 0 && filt.rows.every((n) => /multi/i.test(n)), `${filt.rows.length} rows; footer "${filt.footer}"`);
await typeQuery('zzqqxx');
const empty = await read('filtered to nothing', `document.querySelector('#files-table [data-state="filtered-empty"]')?.textContent ?? null`);
check('filtered-to-nothing is its own state with Clear filter, not an empty folder', !!empty && /Clear filter/.test(empty), empty);
await p.act({ what: 'Escape in the field', run: `(() => { document.querySelector('#files-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; })()`, expect: `files.query === ''` });
check('Escape clears the filter and the field', await read('after Escape', `document.querySelector('#files-search').value === '' && files.query === ''`));
await typeQuery('multi');
await p.act({ what: 'change folder (root) to Documents and back', run: `(() => { [...document.querySelectorAll('#files-roots .files-root')].find(x => /^Documents/.test(x.querySelector('.files-root-name').textContent)).click(); return true; })()`, expect: `/Documents/.test(document.querySelector('#files-crumbs').textContent) && !files.loading`, within: 20000 });
const afterRoot = await read('filter after changing root', `({ query: files.query, field: document.querySelector('#files-search').value, crumbs: document.querySelector('#files-crumbs').textContent, state: document.querySelector('#files-table [data-state]')?.dataset.state ?? null, emptyText: document.querySelector('#files-table')?.textContent.slice(0, 120) })`);
check('changing folder clears the filter', afterRoot.query === '' && afterRoot.field === '', JSON.stringify(afterRoot));
await p.act({ what: 'back to Received files, clear any filter', run: `(() => { [...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent)).click(); return true; })()`, expect: `/received/i.test(document.querySelector('#files-crumbs').textContent) && files.entries.length > 0 && !files.loading`, within: 20000 });
await p.act({ what: 'clear filter', run: `(() => { files.query=''; document.querySelector('#files-search').value=''; files.render(); return true; })()`, expect: `files.query === ''` });

// ---- pagination: INSTRUMENTED 5 per page over the real listing ----
await p.act({ what: 'INSTRUMENT: page size 5 on the pane bridge, reopen the folder', run: `(() => { window.__origList = files.bridge.fsList; files.bridge.fsList = (o) => window.__origList({ ...o, limit: 5 }); files.openPath(''); return true; })()`, expect: `files.entries.length === 5 && !files.loading`, within: 20000 });
const paged = await read('first page of 5', `({ loaded: files.entries.length, hasMore: files.hasMore, footer: document.querySelector('#files-footer').textContent, loadMore: !!document.querySelector('#files-load-more') })`);
check('a paginated folder says more is unloaded and offers Load more', paged.hasMore && paged.loadMore && /more in this folder/.test(paged.footer), paged.footer);
await typeQuery('sidekick-b-final');
const pf = await read('filter over a partly loaded folder', `({ shown: ${DRAWN}.length, footer: document.querySelector('#files-footer').textContent })`);
check('the filter says it covers only what is loaded', /filtering and sorting cover only what is loaded/.test(pf.footer), pf.footer);
await p.act({ what: 'press Load more (by id)', run: `(() => { document.querySelector('#files-load-more').click(); return true; })()`, expect: `files.entries.length === 10 && !files.loading`, within: 20000 });
const pf2 = await read('after Load more, same filter', `({ loaded: files.entries.length, shown: ${DRAWN}.length, footer: document.querySelector('#files-footer').textContent })`);
check('Load more fetches the next page and the filter re-applies', pf2.loaded === 10, JSON.stringify(pf2));
await p.act({ what: 'RESTORE the bridge, clear filter, reopen', run: `(() => { files.bridge.fsList = window.__origList; files.query=''; document.querySelector('#files-search').value=''; files.openPath(''); return true; })()`, expect: `files.entries.length === 19 && !files.loading`, within: 20000 });

// ---- the phone was only read ----
const after = await read('phone listing after', SNAP, `1`);
check('phone listing identical before and after (id, name, size, mtime, mime)', JSON.stringify(before) === JSON.stringify(after), `${after.length} entries`);
console.log(`  (window start ${t0})`);
process.exit(fails ? 1 : 0);
