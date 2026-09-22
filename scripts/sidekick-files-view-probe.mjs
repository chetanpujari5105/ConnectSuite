/**
 * Feature D, live: list/grid, sort and filter over the phone's Received files folder.
 *
 * Every step is a Mac-side view change. The phone is asked only `fs.list` (the pane's own open)
 * and `fs.thumb` (grid pictures) — both reads. The probe reports the phone-side request count
 * before and after from the Mac log so "nothing changes on the phone" is a reading, not a promise.
 *
 * Usage: node scripts/sidekick-files-view-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

const p = await openProbe({ port: 9222 });
const show = (r) => { console.log('  ' + format(r)); return r; };
const ROWS = `[...document.querySelectorAll('#files-table .files-row:not(.files-row--head) .files-cell-name > span:nth-child(2)')].map(s => s.textContent)`;

const over = await p.act({
  what: 'Files → Received files, list view',
  run: `(() => { shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); if (document.querySelector('#files-view-list')?.getAttribute('aria-pressed') !== 'true') document.querySelector('#files-view-list')?.click(); return /received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && document.querySelectorAll('#files-table .files-row:not(.files-row--head)').length > 0; })()`,
  within: 30000,
});
if (!over.landed) { console.log('  FAIL  not over a populated Received files'); process.exit(1); }

const names = show(await p.read({ question: 'rows as drawn, default name order', read: ROWS, control: `__probe.count('#files-table .files-row--head')` })).value;

await p.act({ what: 'sort: Size, descending', run: `(() => { const s = document.querySelector('#files-sort'); s.value = 'size'; s.dispatchEvent(new Event('change')); if (document.querySelector('#files-sort-dir').textContent === '↑') document.querySelector('#files-sort-dir').click(); return true; })()`, expect: `document.querySelector('#files-sort-dir').textContent === '↓' && document.querySelector('#files-sort').value === 'size'` });
show(await p.read({
  question: 'size-descending: are the drawn sizes non-increasing among files?',
  read: `(() => { const sizes = files.displayed().filter(e => !e.dir).map(e => e.size); return { first5: files.displayed().slice(0,5).map(e => e.name + ' ' + e.size), nonIncreasing: sizes.every((v, i) => i === 0 || sizes[i-1] >= v), drawnMatchesModel: JSON.stringify(${ROWS}) === JSON.stringify(files.displayed().map(e => e.name)) }; })()`,
  control: `files.displayed().length`,
}));

await p.act({ what: 'filter "sidekick-pass"', run: `(() => { const i = document.querySelector('#files-search'); i.value = 'sidekick-pass'; i.dispatchEvent(new Event('input')); return true; })()`, expect: `document.querySelectorAll('#files-table .files-row:not(.files-row--head)').length > 0 && ${ROWS}.every(n => /sidekick-pass/i.test(n))`, within: 3000 });
show(await p.read({ question: 'filtered rows and footer', read: `({ rows: ${ROWS}.length, footer: document.querySelector('#files-footer').textContent, loaded: files.entries.length })`, control: `__probe.count('#files-search')` }));

await p.act({ what: 'filter to nothing', run: `(() => { const i = document.querySelector('#files-search'); i.value = 'zzqqxx-no-such'; i.dispatchEvent(new Event('input')); return true; })()`, expect: `!!document.querySelector('#files-table [data-state="filtered-empty"]')`, within: 3000 });
show(await p.read({ question: 'filtered-empty state', read: `__probe.text('#files-table [data-state="filtered-empty"]')`, control: `__probe.count('#files-search')` }));

await p.act({ what: 'grid view, filter "sidekick-pass"', run: `(() => { const i = document.querySelector('#files-search'); i.value = 'sidekick-pass'; i.dispatchEvent(new Event('input')); document.querySelector('#files-view-grid').click(); return true; })()`, expect: `document.querySelectorAll('#files-table .files-tile').length > 0`, within: 3000 });
show(await p.read({
  question: 'grid tiles: pictures for images, badges for the rest',
  read: `[...document.querySelectorAll('#files-table .files-tile')].map(t => t.querySelector('.files-tile-name').textContent + ' → ' + (t.querySelector('img') ? 'picture' : t.querySelector('.files-tile-badge')?.textContent))`,
  control: `__probe.count('#files-table.files-table--grid')`,
  settle: { until: (v) => v.some((x) => /picture/.test(x)), within: 10000 },
}));
console.log(`  (default-order names seen: ${names.length})`);
process.exit(0);
