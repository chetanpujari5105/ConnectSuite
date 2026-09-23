/**
 * Defect 138, live: the Files listing's columns at the window minimum (1100 × 700, emulated then
 * cleared) and at the running size, in List and Grid, over Received files (generated test files).
 */
import { openProbe, format } from './probe.mjs';

const p = await openProbe({ port: 9222 });
await p.act({ what: 'Files → Received files', run: `(() => { if (shell.screen !== 'files') shell.route('files'); return true; })()`,
  expect: `(() => { const r=[...document.querySelectorAll('#files-roots .files-root')].find(x => /received/i.test(x.textContent||'')); if (r && !/received/i.test(document.querySelector('#files-crumbs')?.textContent||'')) r.click(); return /received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && files.entries.length > 0 && !files.loading; })()`, within: 20000 });
const M = `(() => { const tb = document.querySelector('#files-table'); const rows = [...tb.querySelectorAll('.files-row:not(.files-row--head)')]; const tiles = [...tb.querySelectorAll('.files-tile')];
  const nameW = rows.map(r => Math.round(r.querySelector('.files-cell-name').getBoundingClientRect().width));
  const dateShown = rows.length ? getComputedStyle(rows[0].querySelector('.files-cell-date')).display !== 'none' : null;
  const top = tiles[0]?.getBoundingClientRect().top;
  const tb2 = document.querySelector('.files-toolbar'); const listing = document.querySelector('.files-listing');
  const inside = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), l = listing.getBoundingClientRect(); return r.width > 0 && r.left >= l.left - 1 && r.right <= l.right + 1; };
  return { viewport: innerWidth + 'x' + innerHeight, mode: files.viewMode, listingContentW: listing.clientWidth - 24,
    rowColumns: rows[0] ? getComputedStyle(rows[0]).gridTemplateColumns : null, nameWidthMin: rows.length ? Math.min(...nameW) : null, dateColumn: dateShown,
    sizeText: rows[0]?.querySelector('.files-cell-size').textContent ?? null, tableOverflowX: tb.scrollWidth > tb.clientWidth + 1,
    tilesPerRow: tiles.length ? tiles.filter(t => Math.abs(t.getBoundingClientRect().top - top) < 2).length : null,
    toolbarInside: ['#files-search','#files-sort','#files-sort-dir','#files-view-list','#files-view-grid','#files-send-to-phone'].every(inside),
    detailW: Math.round(document.querySelector('#files-detail').getBoundingClientRect().width) }; })()`;
const run = async (label) => {
  for (const mode of ['list', 'grid']) {
    await p.act({ what: mode, run: `(() => { document.querySelector('#files-view-${mode}').click(); return true; })()`, expect: `files.viewMode === '${mode}' && document.querySelectorAll('#files-table ${mode === 'list' ? '.files-row' : '.files-tile'}').length > 0` });
    console.log('  ' + format(await p.read({ question: `${label}, ${mode}`, read: M, control: `__probe.count('.files-listing')` })));
  }
};
await run('running size');
await p.rawEmulate({ width: 1100, height: 700 });
await new Promise((r) => setTimeout(r, 300));
try { await run('window minimum'); } finally { await p.rawEmulate(null); }
await p.act({ what: 'back to list', run: `(() => { document.querySelector('#files-view-list').click(); return true; })()`, expect: `files.viewMode === 'list'` });
process.exit(0);
