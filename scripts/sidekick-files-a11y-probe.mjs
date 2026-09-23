/**
 * Feature D review: the Files toolbar and listing at the window's minimum (1100 × 700, emulated and
 * cleared), and keyboard reachability — real Tab key events through CDP (`Input.dispatchKeyEvent`),
 * the focused element and its `:focus-visible` state read after each. DOM reads go through probe.mjs;
 * this file's own socket sends key events only.
 */
import { openProbe, format } from './probe.mjs';

const p = await openProbe({ port: 9222 });
const target = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page' && t.url.includes('/renderer/index.'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
const cdp = (method, params) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const tab = async (shift = false) => {
  const base = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};

const LAYOUT = `(() => { const tb = __probe.one('.files-toolbar'); const listing = document.querySelector('.files-listing'); const detail = document.querySelector('#files-detail');
  const vis = (el) => { const r = el.getBoundingClientRect(); const l = listing.getBoundingClientRect(); return r.width > 0 && r.left >= l.left - 1 && r.right <= l.right + 1; };
  const controls = ['#files-search', '#files-sort', '#files-sort-dir', '#files-view-list', '#files-view-grid', '#files-send-to-phone'].map(s => [s, !!document.querySelector(s) && vis(document.querySelector(s))]);
  return { viewport: innerWidth + 'x' + innerHeight, toolbarRows: Math.round(tb.getBoundingClientRect().height), toolbarOverflowX: tb.scrollWidth > tb.clientWidth + 1, listingOverflowX: listing.scrollWidth > listing.clientWidth + 1, pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1, controlsInside: Object.fromEntries(controls), detailWidth: Math.round(detail.getBoundingClientRect().width), searchWidth: Math.round(document.querySelector('#files-search').getBoundingClientRect().width), tilesPerRow: (() => { const t = [...document.querySelectorAll('.files-tile')]; if (!t.length) return null; const top = t[0].getBoundingClientRect().top; return t.filter(x => Math.abs(x.getBoundingClientRect().top - top) < 2).length; })() }; })()`;

await p.act({ what: 'Files, Received files, list', run: `(() => { if (shell.screen !== 'files') shell.route('files'); document.querySelector('#files-view-list')?.click(); return true; })()`, expect: `/received/i.test(document.querySelector('#files-crumbs')?.textContent||'') && files.viewMode === 'list' && files.entries.length > 0`, within: 20000 });
console.log('  ' + format(await p.read({ question: 'layout at the running window size', read: LAYOUT, control: `__probe.count('#files-tools')` })));
await p.rawEmulate({ width: 1100, height: 700 });
await new Promise((r) => setTimeout(r, 300));
try {
  console.log('  ' + format(await p.read({ question: 'layout at the minimum window, list view', read: LAYOUT, control: `innerWidth === 1100 ? 1 : 0` })));
  await p.act({ what: 'grid', run: `(() => { document.querySelector('#files-view-grid').click(); return true; })()`, expect: `document.querySelectorAll('.files-tile').length > 0` });
  console.log('  ' + format(await p.read({ question: 'layout at the minimum window, grid view', read: LAYOUT, control: `innerWidth === 1100 ? 1 : 0` })));
  await p.act({ what: 'back to list', run: `(() => { document.querySelector('#files-view-list').click(); return true; })()`, expect: `files.viewMode === 'list'` });
} finally {
  await p.rawEmulate(null);
}

// ---- keyboard: start in the search field, Tab forward through the toolbar ----
await p.act({ what: 'focus the search field', run: `(() => { document.querySelector('#files-search').focus(); return true; })()`, expect: `document.activeElement?.id === 'files-search'` });
const seen = [];
for (let i = 0; i < 7; i += 1) {
  await tab();
  const r = await p.read({ question: `focus after Tab ${i + 1}`, read: `(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id || null, tag: a.tagName.toLowerCase(), cls: (a.className && a.className.baseVal === undefined ? a.className : '').split(' ')[0], label: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 30), focusVisible: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`, control: `document.activeElement ? 1 : 0` });
  seen.push(r.value);
}
for (const s of seen) console.log('   Tab →', JSON.stringify(s));
console.log('  ' + format(await p.read({ question: 'are rows/tiles reachable by keyboard? (tabindex on any row)', read: `({ rowsFocusable: [...document.querySelectorAll('#files-table .files-row:not(.files-row--head)')].filter(r => r.tabIndex >= 0).length, rows: document.querySelectorAll('#files-table .files-row:not(.files-row--head)').length, headSortButtons: document.querySelectorAll('.files-head-sort').length })`, control: `__probe.count('#files-table')` })));
ws.close();
process.exit(0);
